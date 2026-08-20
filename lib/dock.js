// FloeDock 岛屿核心（v0.5 重构版）。
//
// 架构要点（吸收此前全部教训）：
//   1. 展开/收起动画 = 自绘插值：一个 16ms 定时器，每帧手动
//      set_size(w,h) + set_position(居中) —— 不依赖 notify / pivot /
//      ease_property 动画自定义属性，几何写入路径唯一且确定。
//   2. 浮层（工具栏/面板/通知/OSD/字幕）在展开态提升到 Main.uiGroup
//      顶层，由本文件直接管理几何；Dock 态回 island 并隐藏（不参与点击）。
//   3. 状态机无补丁标志：一个"当前动画"对象，可随时中断接管。
//   4. 布局尽量用 St 内建控件；IslandLayout 只负责胶囊。

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GnomeDesktop from 'gi://GnomeDesktop';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {
    DOCK_MIN_WIDTH,
    DOCK_H_PADDING,
    DOCK_MIN_HEIGHT,
    NOTIF_PULL,
    HOVER_CLOSE_DELAY,
    State,
    ANIM_FAST,
    ANIM_TOOLBAR,
    ANIM_PANEL,
    ANIM_NOTIF,
    ANIM_OSD,
} from './constants.js';
import {
    clamp,
    timeoutMs,
    clearTimeoutId,
    easeOutCubic,
    easeOutElastic,
    easeInCubic,
} from './utils.js';
import {makeProgressBar} from './widgets.js';

// 真背景模糊（默认 blur=0 不启用）：mutter 49/50 优先 gi://Blur，回退 Shell。
let _BlurNS = null;
let _BlurChecked = false;

async function getBlurNS() {
    if (_BlurChecked)
        return _BlurNS;
    _BlurChecked = true;
    try {
        const mod = await import('gi://Blur');
        _BlurNS = mod.default ?? mod;
    } catch (e) {
        _BlurNS = null;
    }
    return _BlurNS;
}

// ---------------------------------------------------------------------------
// IslandLayout：只负责胶囊（按钮宽度 = 胶囊宽度）与迷你小岛（胶囊左侧）。
// 浮层由本文件顶层管理。
// ---------------------------------------------------------------------------
const MINI_GAP = 8; // 迷你小岛与胶囊的间距

const IslandLayout = GObject.registerClass(
class IslandLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width(container, forHeight) {
        const w = Math.max(DOCK_MIN_WIDTH, container._floeDock?.dockWidth ?? DOCK_MIN_WIDTH);
        return [w, w];
    }

    vfunc_get_preferred_height(container, forWidth) {
        const capsule = container._floeDock?._capsule;
        if (capsule)
            return capsule.get_preferred_height(forWidth);
        return [DOCK_MIN_HEIGHT, DOCK_MIN_HEIGHT];
    }

    vfunc_allocate(container, box, flags) {
        container.set_allocation(box);
        const availW = box.x2 - box.x1;
        const availH = box.y2 - box.y1;
        const dockW = Math.max(DOCK_MIN_WIDTH, container._floeDock?.dockWidth ?? DOCK_MIN_WIDTH);
        const capsule = container._floeDock?._capsule;
        if (!capsule)
            return;
        const cw = Math.min(dockW, availW);
        const cbox = new Clutter.ActorBox();
        cbox.x1 = Math.round((availW - cw) / 2);
        cbox.x2 = cbox.x1 + cw;
        cbox.y1 = 0;
        cbox.y2 = availH;
        capsule.allocate(cbox);

        // 迷你小岛（秒表计时中）：胶囊左侧、垂直居中（溢出岛外不裁剪）
        const mini = container._floeDock?._miniIsland;
        if (mini && mini.visible && mini.get_parent() === container) {
            const [, mw] = mini.get_preferred_width(-1);
            const [, mh] = mini.get_preferred_height(-1);
            const mbox = new Clutter.ActorBox();
            mbox.x1 = Math.round(cbox.x1 - mw - MINI_GAP);
            mbox.x2 = mbox.x1 + mw;
            mbox.y1 = Math.round((availH - mh) / 2);
            mbox.y2 = mbox.y1 + mh;
            mini.allocate(mbox);
        }
    }
});

// 各状态展开动画参数
const STATE_ANIM = {
    // 用无过冲的 easeOutCubic：宽度/高度平滑展开到目标，
    // 不会先过冲再回弹（避免"向两边过伸晃动"和"展开大小与稳定后不一致"）
    [State.TOOLBAR]: {duration: ANIM_TOOLBAR, mode: 'cubic'},
    [State.PANEL]: {duration: ANIM_PANEL, mode: 'cubic'},
    [State.NOTIFICATION]: {duration: ANIM_NOTIF, mode: 'cubic'},
    [State.SUBTITLE]: {duration: ANIM_TOOLBAR, mode: 'cubic'},
    [State.OSD]: {duration: ANIM_OSD, mode: 'cubic'},
};

function easeFor(mode) {
    if (mode === 'elastic')
        return easeOutElastic;
    if (mode === 'in')
        return easeInCubic;
    if (mode === 'cubic')
        return easeOutCubic;
    return easeOutBack;
}

// ---------------------------------------------------------------------------
// FloeIslandButton 增加可动画属性 morph-r（0→1）：用 Clutter ease_property 驱动，
// notify::morph-r 里统一刷新胶囊几何（宽/高/圆角/时钟/锚位）。
// 这取代"每个动画一条 16ms timer 逐帧 set_size"——动画由合成器动画器调度
// （vsync 对齐、统一缓动、无多 timer 抢帧），内容不变形（不用 scale）。
export const FloeIslandButton = GObject.registerClass({
    Properties: {
        'morph-r': GObject.ParamSpec.double(
            'morph-r', '', '', GObject.ParamFlags.READWRITE, 0, 1, 0),
    },
},
class FloeIslandButton extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'FloeIsland | 浮灵岛', true);

        this._ext = ext;
        this._settings = ext.getSettings();
        this._destroyed = false;

        // --- 布局 ---
        this._island = new St.Widget({layout_manager: new IslandLayout()});
        this._island._floeDock = this;

        this._capsule = new St.Widget({
            style_class: 'floedock-capsule',
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: true,
        });
        this._capsule.layout_manager = new Clutter.BinLayout();
        this._clockLabel = new St.Label({
            style_class: 'floedock-clock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._capsule.add_child(this._clockLabel);

        // 胶囊必须第一个加入岛（IslandLayout 依赖其为首个/或显式引用），
        // 迷你小岛/浮层在其后
        this._island.add_child(this._capsule);

        // 迷你小岛：秒表计时时显示在胶囊左侧，实时显示当前计时
        this._miniIsland = new St.Widget({
            style_class: 'floedock-mini-island',
            x_expand: false,
            y_expand: false,
        });
        this._miniIsland.layout_manager = new Clutter.BinLayout();
        this._miniLabel = new St.Label({
            style_class: 'floedock-mini-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._miniIsland.add_child(this._miniLabel);
        this._miniIsland.hide();
        this._miniShown = false;   // 当前是否可见（含淡出中）
        this._miniWanted = false;  // 秒表是否要求显示
        this._miniText = '';
        this._island.add_child(this._miniIsland);

        this._floatLayer = new St.Widget({
            style_class: 'floedock-float',
            reactive: true,
            track_hover: true,
        });
        this._floatLayer.layout_manager = new Clutter.BinLayout();
        this._floatLayer.hide();

        this._island.add_child(this._floatLayer);
        this.add_child(this._island);
        this.add_style_class_name('floedock-button');

        // --- 状态机 ---
        this._surfaces = new Map();
        this._instances = new Map();
        this._currentState = State.DOCK;
        this._restoreState = State.DOCK;
        this._anim = null;          // 当前动画 {timer,...}
        this._pendingPanel = false; // 动画中点击胶囊 → 完成后面板
        this._collapseFromNotif = false; // 从通知态收起：保持顶栏底锚点
        this._panelIsOpen = false;       // 面板态是否处于胶囊形变中
        this._floatOffsetX = 0;
        this._notifPullY = 0; // 通知态下移偏移量
        this._capsuleOverride = null; // 胶囊 OSD 内容（showOsdInfo）
        this._osdBox = null;          // 胶囊内 OSD 内容 widget

        // --- 时钟（与系统面板同源） ---
        this._wallClock = new GnomeDesktop.WallClock();
        this._wallClock.bind_property(
            'clock', this._clockLabel, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        this._clockLabel.connect('notify::text', () => {
            if (this._island.get_stage())
                this._updateDockWidth();
        });
        this.connect('notify::mapped', () => {
            if (this.mapped)
                this._updateDockWidth();
        });

        // --- 主题 ---
        this._themeSignal = this._settings.connect('changed', (s, key) => {
            if (key.startsWith('blur-') || key === 'glass-opacity' ||
                key === 'corner-radius' || key === 'accent-color' ||
                key === 'font-size' || key === 'font-family')
                this._applyTheme();
        });
        this._applyTheme();

        // 胶囊/按钮位置变化（布局/截图重排等）时，浮层位置持续跟随，
        // 防止浮层残留错误位置（如截图后跳到左上角）。通知态走胶囊形变，
        // 浮层不在 uiGroup（父级判定即短路），无需单独定位逻辑。
        this._allocationId = this.connect('notify::allocation', () => {
            if (this._floatLayer.get_parent() !== Main.uiGroup)
                return;
            this._positionFloat();
        });

        // --- 交互 ---
        this._setupInput();

        // morph-r 可动画属性 → 合成器驱动的胶囊形变（见 _morphFrame）
        this._morphFrame = null; // {fromW,fromH,toW,toH,radius,clockFade}
        this.connect('notify::morph-r', () => {
            if (this._morphFrame)
                this._applyMorphFrame(this.morphR);
        });
    }

    // ======================== 公开接口 ========================

    get ext() {
        return this._ext;
    }

    get settings() {
        return this._settings;
    }

    get currentState() {
        return this._currentState;
    }

    get theme() {
        return this._theme;
    }

    /**
     * 强制将胶囊恢复到岛内：用于锁定/解锁后等场景，
     * 确保胶囊不在 uiGroup 中残留，并清理所有展开态的捕获。
     */
    forceResetCapsule() {
        if (this._destroyed)
            return;
        // 先调用 onLeave 清理展开态的捕获（如面板的 captured-event）
        const oldState = this._currentState;
        if (oldState !== State.DOCK) {
            const oldInst = this._instances.get(oldState);
            if (oldInst) {
                oldInst.onLeave?.(false, State.DOCK);
            }
        }
        // 如果胶囊在 uiGroup 中，强制移回岛内
        if (this._capsule.get_parent() === Main.uiGroup) {
            this._capsuleBackToIsland();
        }
        // 确保状态为 DOCK
        if (this._currentState !== State.DOCK) {
            this._currentState = State.DOCK;
            this._collapseFromNotif = false;
            this._panelIsOpen = false;
            this._pendingPanel = false;
            this._floatOffsetX = 0;
            this._notifPullY = 0;
            // 清理 OSD 残留
            if (this._capsuleOverride) {
                this._capsuleOverride = null;
                clearTimeoutId(this._osdHideId);
                this._osdHideId = 0;
                if (this._osdBox) {
                    this._osdBox.destroy();
                    this._osdBox = null;
                }
                this._osdIcon = null;
                this._osdLabel = null;
                this._osdProgress = null;
                this._clockLabel.opacity = 255;
            }
            // 隐藏所有实例
            for (const inst of this._instances.values())
                inst.widget.hide();
            // 确保胶囊可见
            this._capsule.opacity = 255;
            this._capsule.scale_x = 1;
            this._capsule.scale_y = 1;
            this._clockLabel.opacity = 255;
            this._clockLabel.show();
        }
        // 取消动画
        this._animCancel();
    }

    registerSurface(name, factory) {
        this._surfaces.set(name, factory);
    }

    setState(name, params = {}, opts = {}) {
        if (this._destroyed)
            return;
        if (name === this._currentState) {
            if (name !== State.DOCK)
                this._getSurface(name)?.refresh?.(params);
            return;
        }
        const {restore = State.DOCK} = opts;
        this._restoreState = restore;
        this._transitionTo(name, params);
    }

    /**
     * 迷你小岛（秒表计时）：胶囊左侧实时显示当前计时。
     * 仅在 Dock 态显示；其他状态自动隐藏（stopwatch 每 100ms 调用保持同步）。
     */
    setStopwatchMini({visible = false, text = ''} = {}) {
        if (this._destroyed)
            return;
        this._miniWanted = visible;
        this._miniText = text;
        if (text !== this._miniLabel.text)
            this._miniLabel.text = text;
        const show = visible && this._currentState === State.DOCK;
        if (show === this._miniShown)
            return;
        this._miniShown = show;
        if (show) {
            this._miniIsland.show();
            this._miniIsland.ease({
                opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            this._miniIsland.ease({
                opacity: 0, duration: 160, mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    if (!this._miniShown)
                        this._miniIsland.hide();
                },
            });
        }
        this._island.queue_relayout();
    }

    /**
     * OSD 信息显示（灵动岛式）：直接在胶囊内临时显示
     * "图标 + 文字 + 进度条"，结束后平滑恢复时钟。
     */
    showOsdInfo({icon = null, label = '', level = null, maxLevel = 100, duration = 1500} = {}) {
        if (this._destroyed)
            return;
        // 确保在 Dock 态且胶囊可见：若面板/工具栏开着（胶囊被隐藏），
        // 先收起，否则 OSD 渲染进不可见的胶囊（"无法显示"）
        if (this._currentState !== State.DOCK)
            this._transitionTo(State.DOCK, {});
        this._showCapsule();
        this._capsuleOverride = {icon, label, level, maxLevel};
        try {
            this._renderCapsule();
        } catch (e) {
            logError(e, '[floeisland] render capsule');
            // 渲染失败也要清理，否则 _capsuleOverride 残留会禁用 hover
            this._capsuleOverride = null;
            this._osdBox = null;
        }
        clearTimeoutId(this._osdHideId);
        this._osdHideId = timeoutMs(duration, () => {
            this._osdHideId = 0;
            if (this._capsuleOverride) {
                this._capsuleOverride = null;
                this._renderCapsule();
            }
        });
    }

    /** 渲染胶囊内容：时钟 ↔ OSD 信息。连续更新只改值不重建（避免闪烁）。 */
    _renderCapsule() {
        const ov = this._capsuleOverride;
        if (ov) {
            if (!this._osdBox) {
                // 时钟 → OSD：创建 OSD 内容并淡入（局部变量，全部成功才赋值）
                // 注意：St.BoxLayout 无 spacing 属性（GNOME 50 为 CSS 控制）
                const box = new St.BoxLayout({
                    style_class: 'floedock-osd-capsule',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                const icon = new St.Icon({
                    icon_size: 15,
                    style_class: 'floedock-osd-capsule-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                box.add_child(icon);
                const label = new St.Label({
                    style_class: 'floedock-osd-capsule-label',
                    text: '',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                box.add_child(label);
                const progress = makeProgressBar({width: 84, height: 5});
                progress.widget.y_align = Clutter.ActorAlign.CENTER;
                box.add_child(progress.widget);
                progress.setAccent(this._theme?.accent ?? '#ffffff');
                this._capsule.add_child(box);
                box.opacity = 0;
                box.ease({opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                this._clockLabel.ease({opacity: 0, duration: 120});
                // 全部成功后才记录，避免半创建状态
                this._osdBox = box;
                this._osdIcon = icon;
                this._osdLabel = label;
                this._osdProgress = progress;
            }
            // 更新内容（不重建 → 连续调整连贯）
            if (ov.icon) {
                if (typeof ov.icon === 'string')
                    this._osdIcon.icon_name = ov.icon;
                else
                    this._osdIcon.gicon = ov.icon;
                this._osdIcon.show();
            } else {
                this._osdIcon.hide();
            }
            const hasLevel = ov.level !== undefined && ov.level !== null;
            // 显示文字：优先调用方给的 label；否则显示百分比（音量/亮度
            // 的 label 通常为 null，百分比数字最直观）
            let text = ov.label ?? '';
            let frac = 0;
            if (hasLevel) {
                // level 本身就是 0-1 比例（音量 0.5=50%，亮度 0.7=70%）
                frac = clamp(ov.level, 0, 1);
                if (!text)
                    text = `${Math.round(frac * 100)}%`;
            }
            this._osdLabel.text = text;
            this._osdLabel.visible = !!text;
            this._osdProgress.widget.visible = hasLevel;
            if (hasLevel)
                this._osdProgress.setValue(frac);
        } else if (this._osdBox) {
            // OSD → 时钟：OSD 内容淡出移除，时钟淡入
            const box = this._osdBox;
            this._osdBox = null;
            box.ease({
                opacity: 0,
                duration: 120,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => box.destroy(),
            });
            this._clockLabel.ease({opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
        this._updateDockWidth();
    }

    /** 表面运行中调整尺寸（单阶段动画）。 */
    resizeFloat(width, height, {duration = 300, mode = 'cubic'} = {}) {
        const w = clamp(Math.round(width), 0, 8192);
        const h = clamp(Math.round(height), 0, 8192);
        this._animateSize(w, h, duration, mode, null);
    }

    debug(...args) {
        if (this._settings.get_boolean('debug'))
            log(`[floeisland] ${args.join(' ')}`);
    }

    // ======================== 动画引擎 ========================
    // 合成器驱动的胶囊形变（学 QuickShell：动画由 Clutter 动画器 ease_property
    // 调度，vsync 对齐、统一缓动，不用手写多条 16ms timer，也不用 scale。）

    /**
     * 启动一次胶囊形变。支持两类：
     *  - 分两段（axisOrder）：phase1 动一轴→pause→phase2 动另一轴（打开先横后纵，收起先纵后横）
     *  - simul（frame.simul=true）：宽/高/下移同一 e 同步（通知）
     * direction=1 打开（时钟淡出 + 下移 y），0 收起（时钟淡入 + 上移回 y 基）。
     */
    _runCapsuleMorph(frame, {axisOrder = ['w', 'h'], direction = 1, durW = 320, durH = 400, pause = 140, onDone} = {}) {
        this._animCancelMorph();
        this._morphFrame = frame;
        this._morphDir = direction === 1 ? 1 : -1;
        this._morphAxis = axisOrder;
        this._morphDurH = durH;
        this._morphPause = pause;
        this._morphOnDone = onDone;
        this.morphR = 0;
        this._capsule.clip_to_allocation = true;
        if (frame.simul) {
            // simul：单段同时扩/收
            this._morphTask = this.ease_property('morph-r', 1, {
                duration: durW,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => this._morphFinal(),
            });
        } else {
            this._stepMorphPhase(1, 0.5, durW);
        }
    }

    _morphFinal() {
        this._morphTask = null;
        if (this._phasePauseId) {
            GLib.Source.remove(this._phasePauseId);
            this._phasePauseId = 0;
        }
        this.morphR = 1;
        // 保底：把胶囊精确放到 to 尺寸 + 最终圆角（避免 ease 尾帧不精确/拖尾）
        const f = this._morphFrame;
        if (f) {
            const {toW, toH, radius} = f;
            const cx = this._panelCenterX ?? (toW / 2);
            const yAnchor = f.y0 ?? this._panelAnchorY ?? this._capsule.get_y();
            this._capsule.set_size(toW, toH);
            this._capsule.set_position(
                Math.round(cx - toW / 2 + this._floatOffsetX),
                Math.round(yAnchor + (this._morphFrame.pullY ?? 0)));
            this._capsule.set_style(this._notifStyle(this._morphDir === 1 ? radius : 999));
        }
        const done = this._morphOnDone;
        this._morphOnDone = null;
        this._morphFrame = null;
        this._morphAxis = null;
        done?.();
    }

    /** 分两段：phase1 动 axisOrder[0]（至 r=0.5），pause 后 phase2 动 axisOrder[1]（至 r=1）。 */
    _stepMorphPhase(phase, targetR, dur) {
        this.morphR = phase === 1 ? 0 : 0.5;
        this._morphPhase = phase;
        this._morphTask = this.ease_property('morph-r', targetR, {
            duration: dur,
            mode: phase === 1
                ? Clutter.AnimationMode.EASE_OUT_CUBIC
                : Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            onComplete: () => {
                this._morphTask = null;
                if (phase === 1) {
                    this.morphR = 0.5;
                    this._phasePauseId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, this._morphPause, () => {
                        this._phasePauseId = 0;
                        this._stepMorphPhase(2, 1, this._morphDurH);
                    });
                    GLib.Source.set_name_by_id(this._phasePauseId, '[floeisland] morph pause');
                } else {
                    this._morphFinal();
                }
            },
        });
    }

    /** modal→Clutter e 映射（内部 easeFor 用字符串，这里统一到 Clutter AnimationMode）。 */
    _modeToAnimation(mode) {
        if (mode === 'in')
            return Clutter.AnimationMode.EASE_IN_CUBIC;
        if (mode === 'elastic')
            return Clutter.AnimationMode.EASE_OUT_ELASTIC;
        if (mode === 'cubic')
            return Clutter.AnimationMode.EASE_OUT_CUBIC;
        return Clutter.AnimationMode.EASE_OUT_BACK;
    }

    /** morphOnDone 完成时释放，供 _transitionTo/_animateSizeTo 共用。 */
    _morphFinish() {
        if (this._morphTask) {
            this.remove_transition('morph-r');
            this._morphTask = null;
        }
        this._morphFrame = null;
    }

    /** 根据 morph-r 刷新胶囊几何。
     *  simul：宽/高/下移同一 e 同步（通知）。direction 决定 y 方向（开=下拉 +pul，收=上移）。
     *  分两段（默认）：phase1 动 axisOrder[0]，phase2 动 axisOrder[1]（面板）。
     * frame: {fromW,fromH,toW,toH,radius,simul?,pullY?} */
    _applyMorphFrame(r) {
        const f = this._morphFrame;
        if (!f)
            return;
        const {fromW, fromH, toW, toH, radius, simul, pullY = 0, y0} = f;
        const e = easeFor('cubic')(r);
        let w = fromW, h = fromH;
        if (simul) {
            // 宽高同一 e 同步（通知），y 按下移量（开 + / 收 −）
            w = Math.round(fromW + (toW - fromW) * e);
            h = Math.round(fromH + (toH - fromH) * e);
        } else {
            // 分两段：phase1 动本轴（r 0→0.5），phase2 另一轴（r 0.5→1）
            const axis = this._morphAxis ?? ['w', 'h'];
            const a0 = axis[0];
            const a1 = axis[1];
            if (this._morphPhase === 1 || r < 0.5) {
                const er = easeFor('cubic')(Math.min(1, Math.max(0, r * 2)));
                if (a0 === 'w') {
                    w = Math.round(fromW + (toW - fromW) * er);
                    h = fromH;
                } else {
                    h = Math.round(fromH + (toH - fromH) * er);
                    w = fromW;
                }
            } else {
                const er = easeFor('cubic')(Math.min(1, Math.max(0, (r - 0.5) * 2)));
                if (a1 === 'w') {
                    w = Math.round(fromW + (toW - fromW) * er);
                    h = toH;
                } else {
                    h = Math.round(fromH + (toH - fromH) * er);
                    w = toW;
                }
            }
        }
        const yPull = Math.round(pullY * e);
        const cx = this._panelCenterX ?? (fromW / 2);
        const yAnchor = y0 ?? this._panelAnchorY ?? this._capsule.get_y();
        const x = Math.round(cx - w / 2 + this._floatOffsetX);
        const y = Math.round(yAnchor + yPull);
        this._capsule.set_position(x, y);
        this._capsule.set_size(w, h);
        // 圆角：打开式 胶囊→radius（dir=1，前25%快速）；收起式 radius→胶囊999（dir=-1，
        // 后半段 r>0.5 才过渡，让"尺寸先缩、圆角后闭合"，一步到位成胶囊而非中途大胶囊）
        let rv;
        if (this._morphDir === 1) {
            const rq = Math.min(1, r * 4);
            rv = Math.round(999 + (radius - 999) * rq);
        } else {
            const rq = Math.min(1, Math.max(0, (r - 0.5) * 2));
            rv = Math.round(radius + (999 - radius) * rq);
        }
        this._capsule.set_style(this._notifStyle(rv));
        // 时钟：打开式淡出 / 收起式淡入（用整体 e）
        this._clockLabel.opacity = this._morphDir === 1
            ? Math.round(255 * (1 - e))
            : Math.round(255 * e);
        // 通知堆叠点：每 3 帧定位一次（廉价）
        this._dotsTicker = (this._dotsTicker ?? 0) + 1;
        if ((this._dotsTicker & 3) === 0)
            this._positionNotifDots(x, y, w, h);
    }

    /** 停止当前胶囊形变/尺寸动画，并清 morph 状态。 */
    _animCancelMorph() {
        if (this._morphTask) {
            this.remove_transition('morph-r');
            this._morphTask = null;
        }
        this._morphFrame = null;
        this._morphOnDone = null;
    }

    /** 核心：从显式起止尺寸逐帧插值，定位方式由 onPosition 决定。 */
    _animateSizeTo(fromW, fromH, toW, toH, duration, mode, onPosition, onDone) {
        this._animCancel();
        const ease = easeFor(mode);
        const t0 = Date.now();
        this._anim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const t = Math.min(1, (Date.now() - t0) / Math.max(1, duration));
            const e = ease(t);
            const w = Math.round(fromW + (toW - fromW) * e);
            const h = Math.round(fromH + (toH - fromH) * e);
            this._floatLayer.set_size(w, h);
            onPosition?.(w, h);
            if (t >= 1) {
                this._anim = null;
                onDone?.();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._anim, '[floeisland] anim');
    }

    /** 单阶段动画：从浮层当前尺寸到目标。 */
    _animateSize(toW, toH, duration, mode, onDone) {
        this._animateSizeTo(
            Math.max(DOCK_MIN_WIDTH, this._floatLayer.get_width()),
            Math.max(DOCK_MIN_HEIGHT, this._floatLayer.get_height()),
            toW, toH, duration, mode,
            () => this._positionFloat(), onDone);
    }

    /** 两阶段展开：先横拉宽度（高度保持胶囊高），再下沉高度。 */
    _expandTo(toW, toH, {duration, mode, onStage, onDone}) {
        this._animCancel();
        const fromW = Math.max(DOCK_MIN_WIDTH, this._floatLayer.get_width());
        const fromH = DOCK_MIN_HEIGHT;
        this._floatLayer.clip_to_allocation = true;
        onStage?.('pull-start');
        this._animateSizeTo(fromW, fromH, toW, fromH, duration, mode,
            () => this._positionFloat(), () => {
                onStage?.('pull-done');
                this._animateSizeTo(toW, fromH, toW, toH,
                    Math.round(duration * 0.8), mode,
                    () => this._positionFloat(), onDone);
            });
    }

    /**
     * 面板态专用胶囊形变（独立函数，不复用通知形变）。
     * 严格两段时序（每段完整跑完才进下一段，不闪现、不乱序）：
     *   段A（360ms）：时钟淡出 + 岛横向拉长（宽度 dock→面板宽，高度恒为 dock 高）
     *   段B（420ms）：岛纵向拉开（宽度恒面板宽，高度 dock高→面板高），露出模块
     *   段C（260ms）：内容淡入
     * 关键：起点几何全部用确定的 dock 尺寸常量，绝不读可能残留"已拉伸"的动态值。
     */
    _panelCapsuleExpand(toW, toH, {radius = 14, onStage, onDone}) {
        this._animCancel();
        // —— 起点 = Dock 态胶囊尺寸（硬编码确定，杜绝读到"已拉伸"的面板态）
        const rawDockW = this._dockWidth;
        const fromW = (rawDockW > 0 && rawDockW < 300)
            ? Math.round(rawDockW)
            : DOCK_MIN_WIDTH;
        const fromH = DOCK_MIN_HEIGHT;
        const [curX, curY] = this._capsule.get_transformed_position();
        this._capsule.set_size(fromW, fromH);
        this._capsule.set_position(Math.round(curX), Math.round(curY));
        // 固定横轴中心（dock 中心），morph 全程以此为中心向两侧/向下
        this._panelCenterX = curX + fromW / 2;
        this._panelAnchorY = curY;
        this._panelIsOpen = true;
        this._notifFromW = fromW;
        this._notifFromH = fromH;
        this._notifPullY = 0;

        onStage?.('pull-start');
        // 分两段：先横拉(durW) → pause → 纵拉(durH)，横拉结束有间隔再纵拉
        this._runCapsuleMorph({fromW, fromH, toW, toH, radius}, {
            axisOrder: ['w', 'h'],
            direction: 1,
            durW: 300,
            durH: 380,
            pause: 150,
            onDone: () => {
                this._capsule.set_clip_to_allocation(false);
                this._instances.get(State.PANEL)?.widget?.ease({
                    opacity: 255, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                onStage?.('pull-done');
                onStage?.('done');
                onDone?.();
            },
        });
    }

    /**
     * 面板态胶囊形变收起（打开动画的精确反向，完整运行不消失）：
     *   content 淡出 + morph 反向（先缩高 → 后缩宽）→ 归位、时钟淡入
     */
    _panelCapsuleBack({onDone}) {
        this._animCancel();
        this._instances.get(State.PANEL)?.widget?.ease({
            opacity: 0, duration: 160, mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        });
        const dockW = this._notifFromW || this.dockWidth;
        const dockH = this._notifFromH || DOCK_MIN_HEIGHT;
        // 收起前胶囊已是面板尺寸
        const panelW = this._capsule.get_width() || dockW;
        const panelH = this._capsule.get_height() || dockH;
        // 收起：先纵缩(向上)→pause→横缩(横向缩短回岛)，与打开(先横后纵)反向
        this._runCapsuleMorph(
            {fromW: panelW, fromH: panelH, toW: dockW, toH: dockH, radius: Math.max(12, this._theme?.radius ?? 14)},
            {axisOrder: ['h', 'w'], direction: 0, durW: 340, durH: 260, pause: 120, onDone: () => {
                this._panelIsOpen = false;
                this._notifPullY = 0;
                this._capsuleBackToIsland();
                onDone?.();
            }});
    }

    /**
     * 胶囊形变展开：胶囊本身 下移 + 变宽 + 变高 + 圆角 999→radius 同时进行。
     * 通知态：radius 12、pullY NOTIF_PULL（整体下移突破顶栏）。
     * 对齐 preview/notif-demo.html 的"下移+变宽+变高"同时形变思路。
     */
    _morphCapsuleExpand(toW, toH, {radius = 12, pullY = NOTIF_PULL, duration = 400, onStage, onDone}) {
        this._animCancel();
        const fromW = Math.max(DOCK_MIN_WIDTH, this._capsule.get_width());
        const fromH = this._capsule.get_height() || DOCK_MIN_HEIGHT;
        const [curX, curY] = this._capsule.get_transformed_position();
        this._capsule.set_size(fromW, fromH);
        this._capsule.set_position(Math.round(curX), Math.round(curY));
        // 固定横轴中心（dock 中心），simul 同步下移+扩宽+拉高
        this._panelCenterX = curX + fromW / 2;
        this._panelAnchorY = curY;
        this._notifFromW = fromW;
        this._notifFromH = fromH;
        this._notifRadius = radius;
        this._notifPullY = 0;

        onStage?.('pull-start');
        // simul：宽/高/下移 同一 e 同步展开（通知），内容不动、不用 scale
        this._runCapsuleMorph(
            {fromW, fromH, toW, toH, radius, simul: true, pullY},
            {axisOrder: ['w', 'h'], direction: 1, durW: 400, durH: 400, onDone: () => {
                onStage?.('pull-done');
                onDone?.();
            }});
    }

    /**
     * 胶囊形变收起：反向——上移归位 + 缩回宽度 + 缩短高度 同时进行，
     * 圆角 radius→999（过半后恢复胶囊圆角，同演示）。
     */
    _morphCapsuleBack({duration = 300, onDone}) {
        this._animCancel();
        const fromW = Math.max(DOCK_MIN_WIDTH, this._capsule.get_width());
        const fromH = Math.max(DOCK_MIN_HEIGHT, this._capsule.get_height());
        const toW = this._notifFromW || this.dockWidth;
        const toH = this._notifFromH || DOCK_MIN_HEIGHT;
        const radius = this._notifRadius || 12;
        // 收起：simul 同步 缩窄+缩短，同时 y 平滑上移回 dock 顶（pullY 取反抵消展开下移）
        this._morphCurY = this._capsule.get_y();
        this._notifPullY = 0;
        this._runCapsuleMorph(
            {fromW, fromH, toW, toH, radius, simul: true, pullY: -NOTIF_PULL, y0: this._capsule.get_y()},
            {axisOrder: ['w', 'h'], direction: 0, durW: duration, durH: duration, onDone});
    }

    /** 通知态胶囊样式（随形变逐帧更新圆角）。 */
    _notifStyle(radius) {
        const th = this._theme;
        return `
            background-color: rgba(12,13,16,${th.baseAlpha});
            border: 1px solid rgba(255,255,255,${th.borderAlpha});
            border-radius: ${radius}px;
        `;
    }

    /** 堆叠指示点跟随胶囊底部居中。 */
    _positionNotifDots(x, y, w, h) {
        const surf = this._instances.get(State.NOTIFICATION);
        const dots = surf?.dots;
        if (!dots || !dots.visible)
            return;
        const [, dw] = dots.get_preferred_width(-1);
        dots.set_position(Math.round(x + w / 2 - dw / 2), y + h + 8);
    }

    /** 通知态：胶囊提升到 uiGroup 顶层（保持当前位置），准备形变。 */
    _capsuleToTop() {
        if (this._capsule.get_parent() === Main.uiGroup)
            return;
        const [x, y] = this._capsule.get_transformed_position();
        this._reparent(this._capsule, Main.uiGroup);
        Main.uiGroup.set_child_above_sibling(this._capsule, null);
        this._capsule.set_position(x, y);
    }

    /**
     * 通知态胶囊提升 + 强制居中：通知形变必须以顶部居中为锚（灵动岛风格），
     * 不依赖胶囊"当前瞬时变换位置"——那在 relayout 异步时可能取到偏位（如左上角），
     * 导致通知以一种左上角→右下角的错误锚展开。
     */
    _capsuleToTopCentered() {
        const fromW = Math.max(DOCK_MIN_WIDTH, this._capsule.get_width());
        const fromH = this._capsule.get_height() || DOCK_MIN_HEIGHT;
        const monitor = Main.layoutManager.primaryMonitor;
        // 顶部居中：x = 主屏水平中心 - 胶囊半宽；y = 面板底沿（顶部时钟所在）
        const panelH = Main.panel ? Main.panel.get_height() : 0;
        const cx = monitor ? monitor.x + monitor.width / 2 : fromW / 2;
        const x = Math.round(cx - fromW / 2);
        const y = Math.round(panelH - fromH / 2);
        this._reparent(this._capsule, Main.uiGroup);
        Main.uiGroup.set_child_above_sibling(this._capsule, null);
        this._capsule.set_position(x, y);
    }

    /** 胶囊形变态（通知/面板）结束：胶囊回岛、恢复初始岛态，隐藏内容。 */
    _capsuleBackToIsland() {
        this._capsule.clip_to_allocation = false;
        this._capsule.set_size(-1, -1);
        this._capsule.set_position(0, 0);
        this._reparent(this._capsule, this._island);
        this._island.queue_relayout();
        this.queue_relayout();
        this._applyTheme(); // 恢复胶囊样式（border-radius 999）与时钟样式
        // 强制恢复初始岛态：时钟可见、胶囊完整（防反向动画结束后时间不显示）
        this._capsule.opacity = 255;
        this._capsule.scale_x = 1;
        this._capsule.scale_y = 1;
        this._clockLabel.opacity = 255;
        this._clockLabel.show();
        this._panelIsOpen = false;
        for (const sname of [State.NOTIFICATION, State.PANEL]) {
            const surf = this._instances.get(sname);
            if (surf?.widget) {
                surf.widget.opacity = 255; // 复位，下次进入从透明淡入
                surf.widget.hide();
            }
            if (surf?.dots)
                surf.dots.hide();
        }
    }

    /** 收起：胶囊形变态（通知/面板）反向形变归位，浮层态（工具栏）缩回胶囊。 */
    _collapseToDock() {
        this._animCancel();
        this._floatLayer.clip_to_allocation = false;
        const fromNotif = this._collapseFromNotif;
        const fromPanel = this._panelIsOpen;
        const inUiGroup = this._capsule.get_parent() === Main.uiGroup;
        this._collapseFromNotif = false;

        if (fromPanel && inUiGroup) {
            // 面板收起：专用反向动画（内容淡出→上缩→中缩→时钟淡入），完整运行
            this._panelCapsuleBack({});
            return;
        }
        if (fromNotif && inUiGroup) {
            // 通知收起：缩回宽度+高度 同时 上移归位（一个阶段，同演示）
            this._morphCapsuleBack({
                duration: 300,
                mode: 'in',
                onDone: () => {
                    this._notifPullY = 0;
                    this._capsuleBackToIsland();
                },
            });
            return;
        }
        if (fromNotif) {
            this._capsuleBackToIsland();
            return;
        }
        // 工具栏收起：胶囊淡入（与浮层缩回同时进行），避免"突然出现"闪烁
        this._showCapsule();
        this._floatLayer.ease({opacity: 0, duration: 140, mode: Clutter.AnimationMode.EASE_IN_CUBIC});
        this._animateSizeTo(
            this._floatLayer.get_width(), this._floatLayer.get_height(),
            this.dockWidth, DOCK_MIN_HEIGHT, 180, 'in',
            () => this._positionFloat(), () => {
                this._floatLayer.opacity = 255;
                this._floatLayerBack();
            });
    }

    _animCancel() {
        if (this._anim) {
            GLib.source_remove(this._anim);
            this._anim = null;
        }
        this._animCancelMorph();
    }

    /**
     * 浮层几何真源：定位 = 胶囊中心 − 宽/2（水平居中于胶囊）。
     * @param {number} [fw] 当前帧宽度（动画期间传入，避免用过期 allocation）
     * @param {number} [fh] 当前帧高度
     */
    _positionFloat(fw, fh) {
        if (this._floatLayer.get_parent() !== Main.uiGroup)
            return;
        const [cx, cy] = this._capsule.get_transformed_position();
        const cw = this._capsule.get_width();
        const w = fw ?? this._floatLayer.get_width();
        const h = fh ?? this._floatLayer.get_height();
        const x = Math.round(cx + cw / 2 - w / 2 + this._floatOffsetX);
        this._floatLayer.set_position(x, Math.round(cy));
    }

    /** 安全 reparent：GNOME 50 的 add_child 不自动移除旧父（否则 assertion）。 */
    _reparent(actor, newParent) {
        const old = actor.get_parent();
        if (old === newParent)
            return;
        if (old)
            old.remove_child(actor);
        newParent.add_child(actor);
    }

    _floatLayerToTop() {
        if (this._floatLayer.get_parent() === Main.uiGroup)
            return;
        this._reparent(this._floatLayer, Main.uiGroup);
        Main.uiGroup.set_child_above_sibling(this._floatLayer, null);
        this._floatLayer.show();
        this._floatLayer.opacity = 255;
        this._positionFloat();
    }

    _floatLayerBack() {
        this._floatLayer.hide();
        if (this._floatLayer.get_parent() === this._island)
            return;
        this._reparent(this._floatLayer, this._island);
        this._floatLayer.set_position(0, 0);
        this._island.queue_relayout();
    }

    // ======================== 状态机 ========================

    _getSurface(name, parent = this._floatLayer) {
        let inst = this._instances.get(name);
        if (inst)
            return inst;
        const factory = this._surfaces.get(name);
        if (!factory) {
            logError(new Error(`[floeisland] no surface for "${name}"`));
            return null;
        }
        try {
            inst = factory(this, this._ext);
        } catch (e) {
            logError(e, `[floeisland] create surface "${name}"`);
            return null;
        }
        // FILL：表面填满父容器（面板/工具栏始终 = 浮层固定尺寸；
        // 若设 CENTER 会按内容自然尺寸显示，切换 tab 时面板大小随之变化。
        // 通知态/面板态父容器 = 胶囊，内容随胶囊一起形变。）
        inst.widget.x_align = Clutter.ActorAlign.FILL;
        inst.widget.y_align = Clutter.ActorAlign.FILL;
        parent.add_child(inst.widget);
        inst.widget.hide();
        this._instances.set(name, inst);
        return inst;
    }

    _transitionTo(name, params) {
        log(`[floeisland] _transitionTo: ${name} from ${this._currentState}`);
        const old = this._currentState;
        // 通知态/面板态：胶囊自身形变；工具栏/字幕：浮层展开
        const inCapsule = name === State.NOTIFICATION || name === State.PANEL;
        const surf = name === State.DOCK
            ? null
            : this._getSurface(name, inCapsule ? this._capsule : this._floatLayer);
        if (name !== State.DOCK && !surf)
            return;

        // 离开旧状态（必须调 onLeave，否则 surface 的捕获等不清理；
        // 胶囊形变态（通知/面板）内容不立即 hide——由反向形变动画淡出）
        if (old !== State.DOCK) {
            const oldInst = this._instances.get(old);
            if (oldInst) {
                if (old !== State.NOTIFICATION && old !== State.PANEL)
                    oldInst.widget.hide();
                oldInst.onLeave?.(false, name);
            }
        }

        this._currentState = name;
        this._animCancel();
        // 任何状态切换时取消挂起的悬停定时器，避免展开动画期间工具栏误触发
        this._hoverTimer = clearTimeoutId(this._hoverTimer);

        if (name === State.DOCK) {
            this._pendingPanel = false;
            this._floatOffsetX = 0; // 复位通知态偏移
            // 清理 OSD 残留（若有），确保时钟恢复可见，避免切回时闪烁
            if (this._capsuleOverride) {
                this._capsuleOverride = null;
                clearTimeoutId(this._osdHideId);
                this._osdHideId = 0;
                if (this._osdBox) {
                    this._osdBox.destroy();
                    this._osdBox = null;
                }
                this._osdIcon = null;
                this._osdLabel = null;
                this._osdProgress = null;
                this._clockLabel.opacity = 255;
            }
            // 记录从通知/面板态收起：胶囊反向形变归位
            this._collapseFromNotif = old === State.NOTIFICATION || old === State.PANEL;
            if (old === State.NOTIFICATION) {
                // 通知内容淡出、时钟淡入，随反向形变同时进行
                const inst = this._instances.get(State.NOTIFICATION);
                inst?.widget?.ease({
                    opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                });
                inst?.dots?.ease({
                    opacity: 0, duration: 180, mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                });
                this._clockLabel.ease({
                    opacity: 255, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                for (const [sname, inst] of this._instances) {
                    if (sname !== State.NOTIFICATION)
                        inst.widget.hide();
                }
            } else if (old === State.PANEL) {
                // 面板内容淡出由 _panelCapsuleBack 控制节奏（完整反向），
                // 这里只隐藏其它实例，不重复 fade 面板内容
                for (const [sname, inst] of this._instances) {
                    if (sname !== State.PANEL)
                        inst.widget.hide();
                }
            } else {
                for (const inst of this._instances.values())
                    inst.widget.hide();
            }
            // 胶囊形变态（通知/面板）收起：胶囊保持可见（反向形变归位）；
            // 工具栏等浮层态收起：胶囊由 _collapseToDock 淡入（_showCapsule）
            if (old === State.NOTIFICATION || old === State.PANEL) {
                this._capsule.opacity = 255;
                this._capsule.scale_x = 1;
                this._capsule.scale_y = 1;
            }
            this._collapseToDock();
            return;
        }

        // 进入展开态
        const fromDock = old === State.DOCK;

        const finish = () => {
            if (this._currentState !== name)
                return;
            this._floatLayer.clip_to_allocation = false;
            // onEnter 延后到 idle：不在动画回调栈上执行模块创建等重活，
            // 避免与动画/布局时序耦合引发崩溃
            GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => {
                if (this._currentState !== name)
                    return;
                surf.onEnter(params);
                if (name === State.TOOLBAR && !this._isHovered())
                    this.setState(State.DOCK);
                if (this._pendingPanel) {
                    this._pendingPanel = false;
                    this.setState(State.PANEL);
                }
            });
        };

        if (name === State.NOTIFICATION) {
            // 通知态：胶囊形变——胶囊本身下移+变宽+变高成为通知卡片
            if (this._capsuleOverride) {
                // 清理 OSD 残留（若有），避免 OSD 内容残留在形变胶囊内
                this._capsuleOverride = null;
                clearTimeoutId(this._osdHideId);
                this._osdHideId = 0;
                if (this._osdBox) {
                    this._osdBox.destroy();
                    this._osdBox = null;
                }
                this._osdIcon = null;
                this._osdLabel = null;
                this._osdProgress = null;
            }
            this._capsuleBackToIsland(); // 防御：任何来源先回岛再提升
            // 若从浮层态（工具栏）进入，先把浮层收回岛内，避免残留
            if (this._floatLayer.get_parent() === Main.uiGroup)
                this._floatLayerBack();
            // 通知形变强制顶部居中为锚，避免 relayout 异步导致取到偏位展开
            this._capsuleToTopCentered();
            surf.widget.show();
            // 通知内容随形变淡入
            surf.widget.opacity = 0;
            surf.widget.ease({
                opacity: 255, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
            this._clockLabel.ease({opacity: 0, duration: 200});
            const dots = surf.dots;
            if (dots) {
                this._reparent(dots, Main.uiGroup);
                Main.uiGroup.set_child_above_sibling(dots, null);
                dots.show();
                dots.opacity = 0;
                dots.ease({
                    opacity: 255, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
            surf.preShow?.(params);
            const size = surf.getSize();
            const anim = STATE_ANIM[name] ?? STATE_ANIM[State.TOOLBAR];
            this._morphCapsuleExpand(size.width, size.height, {
                radius: 12,
                pullY: NOTIF_PULL,
                duration: anim.duration,
                mode: anim.mode,
                onStage: stage => surf.onExpandStage?.(stage),
                onDone: finish,
            });
            return;
        }
        if (name === State.PANEL) {
            // 面板态：独立胶囊形变（不复用通知形变）。
            // 分阶段完整运行：时钟淡化 → 横向拉长(露搜索栏) → 向下拉出(露模块) → 淡入。
            // 面板内容设为最终尺寸并被胶囊裁剪逐步显露，不逐帧重布局，流畅不卡顿。
            if (this._capsuleOverride) {
                this._capsuleOverride = null;
                clearTimeoutId(this._osdHideId);
                this._osdHideId = 0;
                if (this._osdBox) {
                    this._osdBox.destroy();
                    this._osdBox = null;
                }
                this._osdIcon = null;
                this._osdLabel = null;
                this._osdProgress = null;
            }
            this._capsuleBackToIsland(); // 防御：任何来源先回岛再提升
            if (this._floatLayer.get_parent() === Main.uiGroup)
                this._floatLayerBack();
            this._capsuleToTop();
            const size = surf.getSize();
            // 内容固定最终尺寸 + 顶部对齐，被胶囊裁剪逐步显露（随动画露出）
            surf.widget.width = size.width;
            surf.widget.height = size.height;
            surf.widget.x_align = Clutter.ActorAlign.CENTER;
            surf.widget.y_align = Clutter.ActorAlign.START;
            surf.widget.show();
            surf.widget.opacity = 255;
            // 面板专用分阶段形变动画
            this._panelCapsuleExpand(size.width, size.height, {
                radius: Math.max(12, this._theme?.radius ?? 14),
                onStage: stage => surf.onExpandStage?.(stage),
                onDone: finish,
            });
            return;
        }

        // 其他展开态（工具栏/字幕）：浮层从胶囊展开
        if (old === State.NOTIFICATION || old === State.PANEL)
            this._capsuleBackToIsland(); // 防御：形变态直接切走时复位胶囊
        this._floatLayerToTop();
        this._hideCapsule();
        this._applyBlur(surf.widget);
        surf.widget.show();
        surf.widget.opacity = 255;
        const size = surf.getSize();
        const anim = STATE_ANIM[name] ?? STATE_ANIM[State.TOOLBAR];

        if (fromDock) {
            log(`[floeisland] fromDock=true name=${name}`);
            this._expandTo(size.width, size.height, {
                duration: anim.duration,
                mode: anim.mode,
                onStage: stage => surf.onExpandStage?.(stage),
                onDone: finish,
            });
        } else {
            // 状态间切换（如 TOOLBAR→PANEL）：平滑过渡尺寸，保持连贯
            this._animateSize(size.width, size.height, Math.round(anim.duration * 0.7), anim.mode, () => {
                if (this._currentState !== name)
                    return;
                surf.onExpandStage?.('pull-start');
                surf.onExpandStage?.('pull-done');
                finish();
            });
        }
    }

    _hideCapsule() {
        this._capsule.ease({
            opacity: 0,
            scale_x: 0.92,
            scale_y: 0.92,
            duration: ANIM_FAST,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _showCapsule() {
        this._capsule.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: ANIM_FAST,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    _updateDockWidth() {
        // OSD 信息显示时胶囊按 OSD 内容宽度自适应，否则按时钟宽度
        const content = this._osdBox ?? this._clockLabel;
        const [, nat] = content.get_preferred_width(-1);
        const w = Math.max(DOCK_MIN_WIDTH, nat + 2 * DOCK_H_PADDING);
        if (this._dockWidth === w)
            return;
        this._dockWidth = w;
        this._island.queue_relayout();
    }

    get dockWidth() {
        return this._dockWidth ?? DOCK_MIN_WIDTH;
    }

    // 钉死按钮宽度 = 胶囊宽度
    vfunc_get_preferred_width(_forHeight) {
        const w = Math.max(DOCK_MIN_WIDTH, this.dockWidth ?? DOCK_MIN_WIDTH);
        return [w, w];
    }

    // ======================== 交互 ========================

    /**
     * 指针坐标包含测试：不用 Clutter 的 hover 事件（浮层 show 时尺寸为 0，
     * 收不到 enter 事件，hover 状态不可靠），直接算指针是否在 actor 区域内。
     */
    _pointerIn(actor) {
        if (!actor || !actor.visible)
            return false;
        const [px, py] = global.get_pointer();
        const [ax, ay] = actor.get_transformed_position();
        const [aw, ah] = actor.get_transformed_size();
        return px >= ax && px <= ax + aw && py >= ay && py <= ay + ah;
    }

    /** 指针是否悬停在"岛"上（按钮区域或可见浮层区域）。 */
    _isHovered() {
        return this._pointerIn(this) ||
            (this._floatLayer.visible && this._pointerIn(this._floatLayer));
    }

    _setupInput() {
        this._hoverTimer = 0;
        this._hoverCloseTimer = 0;
        this._osdHideId = 0;

        // 点击胶囊 → 面板（通知态 → 收起，同演示"点击/Esc 收起"）
        const onCapsuleClick = () => {
            this._hoverTimer = clearTimeoutId(this._hoverTimer);
            if (this._currentState === State.NOTIFICATION) {
                this.setState(State.DOCK);
                return;
            }
            // 防御：若胶囊意外残留在 uiGroup（形变未归位），先收回岛内
            if (this._currentState === State.DOCK && this._capsule.get_parent() === Main.uiGroup)
                this._capsuleBackToIsland();
            if (this._anim) {
                // 展开动画中点击：完成后进入面板
                this._pendingPanel = true;
                return;
            }
            if (this._currentState === State.DOCK || this._currentState === State.TOOLBAR)
                this.setState(State.PANEL);
        };
        this._clickGesture = new Clutter.ClickGesture();
        this._clickGesture.connect('recognize', onCapsuleClick);
        this._capsule.add_action(this._clickGesture);
        this._capsule.connect('button-press-event', (actor, event) => {
            if (event.get_button() === 1) {
                onCapsuleClick();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // hover：指针坐标实时判定（不用 Clutter hover 事件，避免
        // 浮层刚 show 时尺寸为 0 导致 hover 状态丢失而误收起）
        const updateHover = () => {
            const hovered = this._isHovered();
            if (!hovered) {
                this._hoverTimer = clearTimeoutId(this._hoverTimer);
                if (this._currentState === State.TOOLBAR && !this._hoverCloseTimer) {
                    this._hoverCloseTimer = timeoutMs(HOVER_CLOSE_DELAY, () => {
                        this._hoverCloseTimer = 0;
                        if (this._currentState !== State.TOOLBAR)
                            return;
                        if (this._isHovered())
                            return;
                        if (this._anim) {
                            // 动画中：finish 时会检查 hover 自动收回
                            this._hoverCloseTimer = timeoutMs(150, updateHover);
                            return;
                        }
                        this.setState(State.DOCK);
                    });
                }
                return;
            }
            this._hoverCloseTimer = clearTimeoutId(this._hoverCloseTimer);
            if (this._currentState !== State.DOCK)
                return;
            // OSD 信息显示期间不展开工具栏（避免胶囊淡出带走 OSD）
            if (this._capsuleOverride)
                return;
            // 计时器已存在则不重置（否则 100ms 轮询会无限推迟工具栏展开）
            if (this._hoverTimer)
                return;
            const delay = this._settings.get_int('hover-delay');
            this._hoverTimer = timeoutMs(delay, () => {
                this._hoverTimer = 0;
                if (this._currentState === State.DOCK && !this._anim && this._isHovered())
                    this.setState(State.TOOLBAR);
            });
        };
        // 用 100ms 轮询替代 hover 事件（指针实时判定）
        this._hoverPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            updateHover();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._hoverPollId, '[floeisland] hover poll');
    }

    // ======================== 主题 ========================

    _applyTheme() {
        const blur = this._settings.get_int('blur-strength');
        const opacity = this._settings.get_int('glass-opacity');
        const radius = this._settings.get_int('corner-radius');
        const accent = this._settings.get_string('accent-color') || '#ffffff';
        const fontSize = this._settings.get_int('font-size');
        const fontFamily = this._settings.get_string('font-family') || 'Inter';

        const base = clamp(Math.round(255 * opacity / 100), 0, 255);
        const top = clamp(base + Math.round(14 * blur / 100), 0, 255);
        const border = clamp(20 + blur / 4, 20, 55);

        this._theme = {
            blur,
            opacity,
            radius,
            accent,
            fontSize,
            fontFamily,
            blurRadius: blur > 0 ? Math.max(8, Math.round(blur * 0.8)) : 0,
            baseAlpha: (base / 255).toFixed(3),
            topAlpha: (top / 255).toFixed(3),
            borderAlpha: (border / 255).toFixed(3),
        };

        // 胶囊：与面板/工具栏统一近黑（rgba(12,13,16)），无割裂
        this._capsule.set_style(`
            background-color: rgba(12,13,16,${this._theme.baseAlpha});
            border: 1px solid rgba(255,255,255,${this._theme.borderAlpha});
            border-radius: 999px;
        `);
        this._clockLabel.set_style(`
            font-size: ${fontSize}px;
            font-family: ${fontFamily}, 'Noto Sans CJK SC', 'Cantarell', sans-serif;
            font-weight: 260;
            letter-spacing: 0.5px;
            font-feature-settings: 'tnum';
            color: rgba(255,255,255,0.98);
        `);
        this._applyBlur(this._capsule);
    }

    /** 真背景模糊（默认关闭）。优先 gi://Blur，回退 Shell.BlurEffect。 */
    async _applyBlur(actor) {
        const radius = this._theme?.blurRadius ?? 0;
        const effects = actor.get_effects();
        for (const fx of effects) {
            if (fx instanceof Shell.BlurEffect) {
                actor.remove_effect(fx);
                fx.run_dispose();
            }
        }
        if (radius <= 0 || !actor)
            return;
        try {
            const ns = await getBlurNS();
            const fx = ns
                ? new ns.BlurEffect({
                    mode: ns.BlurMode.BACKGROUND,
                    radius,
                    brightness: 1.0,
                    corner_radius: this._theme?.radius ?? 14,
                })
                : new Shell.BlurEffect({
                    mode: Shell.BlurMode.BACKGROUND,
                    radius,
                    brightness: 1.0,
                });
            actor.add_effect(fx);
        } catch (e) {
            logError(e, '[floeisland] blur effect');
        }
    }

    // ======================== 清理 ========================

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._hoverTimer = clearTimeoutId(this._hoverTimer);
        this._hoverCloseTimer = clearTimeoutId(this._hoverCloseTimer);
        this._osdHideId = clearTimeoutId(this._osdHideId);
        if (this._hoverPollId) {
            GLib.source_remove(this._hoverPollId);
            this._hoverPollId = 0;
        }
        this._animCancel();
        // 安全复位：通知态/展开态中禁用时，胶囊与浮层可能被提升到 uiGroup，
        // 先收回岛内再销毁整棵 actor 树（避免残留渲染在屏幕上）
        this._reparent(this._capsule, this._island);
        this._reparent(this._floatLayer, this._island);
        if (this._themeSignal) {
            this._settings.disconnect(this._themeSignal);
            this._themeSignal = 0;
        }
        if (this._allocationId) {
            this.disconnect(this._allocationId);
            this._allocationId = 0;
        }
        for (const [name, inst] of this._instances) {
            try {
                inst.destroy?.();
            } catch (e) {
                logError(e, `[floeisland] destroy surface ${name}`);
            }
        }
        this._instances.clear();
        if (this._wallClock) {
            this._wallClock.run_dispose();
            this._wallClock = null;
        }
        super.destroy();
    }
});

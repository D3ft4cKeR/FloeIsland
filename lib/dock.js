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
    easeOutBack,
    easeOutElastic,
    easeInCubic,
} from './utils.js';

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
// IslandLayout：只负责胶囊（按钮宽度 = 胶囊宽度）。浮层由本文件顶层管理。
// ---------------------------------------------------------------------------
const IslandLayout = GObject.registerClass(
class IslandLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width(container, forHeight) {
        const w = Math.max(DOCK_MIN_WIDTH, container._floeDock?.dockWidth ?? DOCK_MIN_WIDTH);
        return [w, w];
    }

    vfunc_get_preferred_height(container, forWidth) {
        const capsule = container.get_first_child();
        if (capsule)
            return capsule.get_preferred_height(forWidth);
        return [DOCK_MIN_HEIGHT, DOCK_MIN_HEIGHT];
    }

    vfunc_allocate(container, box, flags) {
        container.set_allocation(box);
        const availW = box.x2 - box.x1;
        const availH = box.y2 - box.y1;
        const dockW = Math.max(DOCK_MIN_WIDTH, container._floeDock?.dockWidth ?? DOCK_MIN_WIDTH);
        const capsule = container.get_first_child();
        if (!capsule)
            return;
        const cw = Math.min(dockW, availW);
        const cbox = new Clutter.ActorBox();
        cbox.x1 = Math.round((availW - cw) / 2);
        cbox.x2 = cbox.x1 + cw;
        cbox.y1 = 0;
        cbox.y2 = availH;
        capsule.allocate(cbox);
    }
});

// 各状态展开动画参数
const STATE_ANIM = {
    [State.TOOLBAR]: {duration: ANIM_TOOLBAR, mode: 'back'},
    [State.PANEL]: {duration: ANIM_PANEL, mode: 'back'},
    [State.NOTIFICATION]: {duration: ANIM_NOTIF, mode: 'elastic'},
    [State.SUBTITLE]: {duration: ANIM_TOOLBAR, mode: 'back'},
    [State.OSD]: {duration: ANIM_OSD, mode: 'back'},
};

function easeFor(mode) {
    if (mode === 'elastic')
        return easeOutElastic;
    if (mode === 'in')
        return easeInCubic;
    return easeOutBack;
}

// ---------------------------------------------------------------------------
export const FloeDockButton = GObject.registerClass(
class FloeDockButton extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'FloeDock 浮冰灵动岛', true);

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

        this._floatLayer = new St.Widget({
            style_class: 'floedock-float',
            reactive: true,
            track_hover: true,
        });
        this._floatLayer.layout_manager = new Clutter.BinLayout();
        this._floatLayer.hide();

        this._island.add_child(this._capsule);
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
        this._floatOffsetX = 0;

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

        // --- 交互 ---
        this._setupInput();
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

    /** OSD：临时上岛，自动收起后恢复。 */
    showOsd(params = {}) {
        if (this._destroyed)
            return;
        if (this._currentState === State.OSD) {
            this._getSurface(State.OSD)?.onEnter(params);
        } else {
            this._restoreState = this._currentState;
            this._transitionTo(State.OSD, params);
        }
        clearTimeoutId(this._osdHideId);
        this._osdHideId = timeoutMs(params.duration ?? 1500, () => {
            this._osdHideId = 0;
            if (this._currentState === State.OSD)
                this.setState(this._restoreState);
        });
    }

    /** 表面运行中调整尺寸（单阶段动画）。 */
    resizeFloat(width, height, {duration = 300, mode = 'cubic'} = {}) {
        const w = clamp(Math.round(width), 0, 8192);
        const h = clamp(Math.round(height), 0, 8192);
        this._animateSize(w, h, duration, mode, null);
    }

    setFloatOffsetX(x, {duration = 300} = {}) {
        this._floatOffsetX = x;
        this._positionFloat();
    }

    debug(...args) {
        if (this._settings.get_boolean('debug'))
            log(`[floedock] ${args.join(' ')}`);
    }

    // ======================== 动画引擎 ========================

    /** 单阶段插值动画：每帧 set_size + 居中定位。 */
    _animateSize(toW, toH, duration, mode, onDone) {
        this._animCancel();
        const fromW = this._floatLayer.get_width();
        const fromH = this._floatLayer.get_height();
        const ease = easeFor(mode);
        const t0 = Date.now();
        this._anim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const t = Math.min(1, (Date.now() - t0) / Math.max(1, duration));
            const e = ease(t);
            this._floatLayer.set_size(
                Math.round(fromW + (toW - fromW) * e),
                Math.round(fromH + (toH - fromH) * e));
            this._positionFloat();
            if (t >= 1) {
                this._anim = null;
                onDone?.();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._anim, '[floedock] anim');
    }

    /** 两阶段展开：先横拉宽度（高度保持胶囊高），再下沉高度。 */
    _expandTo(toW, toH, {duration, mode, onStage, onDone}) {
        this._animCancel();
        const fromW = Math.max(DOCK_MIN_WIDTH, this._floatLayer.get_width());
        const fromH = DOCK_MIN_HEIGHT;
        this._floatLayer.clip_to_allocation = true;
        onStage?.('pull-start');
        this._animateSizePhase(fromW, fromH, toW, fromH, duration, mode, () => {
            onStage?.('pull-done');
            this._animateSizePhase(toW, fromH, toW, toH,
                Math.round(duration * 0.8), mode, onDone);
        });
    }

    _animateSizePhase(fromW, fromH, toW, toH, duration, mode, onDone) {
        const ease = easeFor(mode);
        const t0 = Date.now();
        this._anim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const t = Math.min(1, (Date.now() - t0) / Math.max(1, duration));
            const e = ease(t);
            this._floatLayer.set_size(
                Math.round(fromW + (toW - fromW) * e),
                Math.round(fromH + (toH - fromH) * e));
            this._positionFloat();
            if (t >= 1) {
                this._anim = null;
                onDone?.();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._anim, '[floedock] anim');
    }

    /** 收起：快速缩回胶囊尺寸 + 淡出，完成后回 island。 */
    _collapseToDock() {
        this._animCancel();
        this._floatLayer.clip_to_allocation = false;
        this._floatLayer.ease({opacity: 0, duration: 140, mode: Clutter.AnimationMode.EASE_IN_CUBIC});
        this._animateSizePhase(
            this._floatLayer.get_width(), this._floatLayer.get_height(),
            this.dockWidth, DOCK_MIN_HEIGHT, 180, 'in', () => {
                this._floatLayer.opacity = 255;
                this._floatLayerBack();
            });
    }

    _animCancel() {
        if (this._anim) {
            GLib.source_remove(this._anim);
            this._anim = null;
        }
    }

    /** 浮层几何真源：定位 = 按钮中心 − 宽/2（水平居中于胶囊）。 */
    _positionFloat() {
        if (this._floatLayer.get_parent() !== Main.uiGroup)
            return;
        const [bx, by] = this.get_transformed_position();
        const [fw, fh] = this._floatLayer.get_size();
        const x = Math.round(bx + this.get_width() / 2 - fw / 2 + this._floatOffsetX);
        this._floatLayer.set_position(x, Math.round(by));
    }

    _floatLayerToTop() {
        if (this._floatLayer.get_parent() === Main.uiGroup)
            return;
        Main.uiGroup.add_child(this._floatLayer);
        Main.uiGroup.set_child_above_sibling(this._floatLayer, null);
        this._floatLayer.show();
        this._floatLayer.opacity = 255;
        this._positionFloat();
    }

    _floatLayerBack() {
        this._floatLayer.hide();
        if (this._floatLayer.get_parent() === this._island)
            return;
        this._island.add_child(this._floatLayer);
        this._floatLayer.set_position(0, 0);
        this._island.queue_relayout();
    }

    // ======================== 状态机 ========================

    _getSurface(name) {
        let inst = this._instances.get(name);
        if (inst)
            return inst;
        const factory = this._surfaces.get(name);
        if (!factory) {
            logError(new Error(`[floedock] no surface for "${name}"`));
            return null;
        }
        try {
            inst = factory(this, this._ext);
        } catch (e) {
            logError(e, `[floedock] create surface "${name}"`);
            return null;
        }
        inst.widget.x_align = Clutter.ActorAlign.CENTER;
        inst.widget.y_align = Clutter.ActorAlign.CENTER;
        this._floatLayer.add_child(inst.widget);
        inst.widget.hide();
        this._instances.set(name, inst);
        return inst;
    }

    _transitionTo(name, params) {
        const old = this._currentState;
        const surf = name === State.DOCK ? null : this._getSurface(name);
        if (name !== State.DOCK && !surf)
            return;

        // 离开旧状态（必须调 onLeave，否则 surface 的捕获等不清理）
        if (old !== State.DOCK) {
            const oldInst = this._instances.get(old);
            if (oldInst) {
                oldInst.widget.hide();
                oldInst.onLeave?.(false, name);
            }
        }

        this._currentState = name;
        this._animCancel();

        if (name === State.DOCK) {
            this._pendingPanel = false;
            for (const inst of this._instances.values())
                inst.widget.hide();
            this._showCapsule();
            this._collapseToDock();
            return;
        }

        // 进入展开态
        const fromDock = old === State.DOCK;
        this._floatLayerToTop();
        this._hideCapsule();
        this._applyBlur(surf.widget);
        surf.widget.show();
        surf.widget.opacity = 255;
        const size = surf.getSize();
        const anim = STATE_ANIM[name] ?? STATE_ANIM[State.TOOLBAR];

        const finish = () => {
            if (this._currentState !== name)
                return;
            this._floatLayer.clip_to_allocation = false;
            surf.onEnter(params);
            if (name === State.TOOLBAR && !this._isHovered())
                this.setState(State.DOCK);
            if (this._pendingPanel) {
                this._pendingPanel = false;
                this.setState(State.PANEL);
            }
        };

        if (fromDock) {
            this._expandTo(size.width, size.height, {
                duration: anim.duration,
                mode: anim.mode,
                onStage: stage => surf.onExpandStage?.(stage),
                onDone: finish,
            });
        } else {
            // 状态间切换：直接到位
            this._floatLayer.set_size(size.width, size.height);
            this._positionFloat();
            surf.onExpandStage?.('pull-start');
            surf.onExpandStage?.('pull-done');
            finish();
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
        const [, nat] = this._clockLabel.get_preferred_width(-1);
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

        // 点击胶囊 → 面板
        const onCapsuleClick = () => {
            this._hoverTimer = clearTimeoutId(this._hoverTimer);
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
        GLib.Source.set_name_by_id(this._hoverPollId, '[floedock] hover poll');
    }

    // ======================== 主题 ========================

    _applyTheme() {
        const blur = this._settings.get_int('blur-strength');
        const opacity = this._settings.get_int('glass-opacity');
        const radius = this._settings.get_int('corner-radius');
        const accent = this._settings.get_string('accent-color') || '#7fd4ff';
        const fontSize = this._settings.get_int('font-size');
        const fontFamily = this._settings.get_string('font-family') || 'DejaVu Sans Mono';

        const base = clamp(Math.round(255 * opacity / 100), 0, 255);
        const top = clamp(base + Math.round(14 * blur / 100), 0, 255);
        const border = clamp(28 + blur / 3, 28, 70);

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

        // 胶囊：纯黑不透明底（简约）
        this._capsule.set_style(`
            background-gradient-direction: vertical;
            background-gradient-start: rgba(26,32,44,${this._theme.topAlpha});
            background-gradient-end: rgba(10,13,19,${this._theme.baseAlpha});
            border: 1px solid rgba(255,255,255,${this._theme.borderAlpha});
            border-radius: 999px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.5), 0 6px 20px rgba(0,0,0,0.4);
        `);
        this._clockLabel.set_style(`
            font-size: ${fontSize}px;
            font-family: ${fontFamily};
            font-weight: 300;
            color: rgba(255,255,255,0.96);
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
            logError(e, '[floedock] blur effect');
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
        if (this._themeSignal) {
            this._settings.disconnect(this._themeSignal);
            this._themeSignal = 0;
        }
        for (const [name, inst] of this._instances) {
            try {
                inst.destroy?.();
            } catch (e) {
                logError(e, `[floedock] destroy surface ${name}`);
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

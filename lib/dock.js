// FloeDock 岛屿核心。
//
// 结构：
//   FloeDockButton (PanelMenu.Button, 常驻顶部面板 center 盒，替代系统时钟)
//     └── _island (St.Widget, 自定义 IslandLayout)
//           ├── _capsule   胶囊态 UI（时钟文本，宽度 = 时钟文本宽 + padding）
//           └── _floatLayer 浮层（悬停工具栏 / 通知 / 全功能面板 / OSD / 字幕）
//
// 按钮的 preferred width 永远等于胶囊宽度，因此无论浮层如何伸缩，
// 面板布局都保持不动；浮层作为子 actor 自由溢出绘制（St 默认不裁剪）。

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GnomeDesktop from 'gi://GnomeDesktop';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// 真背景模糊：mutter 49/50 优先使用独立的 gi://Blur 模块
// （blur-my-shell 同款），不可用时回退 Shell.BlurEffect。
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
import {clamp, easeProperty, timeoutMs, clearTimeoutId} from './utils.js';

// ---------------------------------------------------------------------------
// IslandLayout：胶囊固定宽，浮层按 floatWidth/floatHeight 自由分配（可溢出）。
// ---------------------------------------------------------------------------
const IslandLayout = GObject.registerClass(
class IslandLayout extends Clutter.LayoutManager {
    _init() {
        super._init();
    }

    vfunc_get_preferred_width(container, forHeight) {
        const dock = container._floeDock;
        const w = Math.max(DOCK_MIN_WIDTH, dock?.dockWidth ?? DOCK_MIN_WIDTH);
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
        const dock = container._floeDock;
        const availW = box.x2 - box.x1;
        const availH = box.y2 - box.y1;
        const dockW = Math.max(DOCK_MIN_WIDTH, dock?.dockWidth ?? DOCK_MIN_WIDTH);

        const children = container.get_children();
        if (children.length > 0) {
            const capsule = children[0];
            const cw = Math.min(dockW, availW);
            const cbox = new Clutter.ActorBox();
            cbox.x1 = Math.round((availW - cw) / 2);
            cbox.x2 = cbox.x1 + cw;
            cbox.y1 = 0;
            cbox.y2 = availH;
            capsule.allocate(cbox, flags);
        }
        if (children.length > 1) {
            // 浮层相对 island 水平居中展开（island 宽度被钉死为胶囊宽度，
            // 且按钮在面板 center box 中天然居中，因此浮层即以胶囊为中心）。
            const floatLayer = children[1];
            const fw = dock?.floatWidth ?? 0;
            const fh = dock?.floatHeight ?? 0;
            const fx = dock?.floatOffsetX ?? 0;
            const fbox = new Clutter.ActorBox();
            fbox.x1 = Math.round((availW - fw) / 2 + fx);
            fbox.x2 = fbox.x1 + fw;
            fbox.y1 = 0;
            fbox.y2 = fh;
            floatLayer.allocate(fbox, flags);
        }
    }
});

// ---------------------------------------------------------------------------
// FillLayout：子 actor 铺满容器（浮层用它，使表面自然尺寸与浮层尺寸一致）。
// ---------------------------------------------------------------------------
const FillLayout = GObject.registerClass(
class FillLayout extends Clutter.LayoutManager {
    vfunc_allocate(container, box, flags) {
        container.set_allocation(box);
        const w = box.x2 - box.x1;
        const h = box.y2 - box.y1;
        for (const child of container.get_children()) {
            const cbox = new Clutter.ActorBox();
            cbox.x1 = 0;
            cbox.y1 = 0;
            cbox.x2 = w;
            cbox.y2 = h;
            child.allocate(cbox, flags);
        }
    }
});

// 各状态展开动画的参数
const STATE_ANIM = {
    [State.TOOLBAR]: {duration: ANIM_TOOLBAR, mode: Clutter.AnimationMode.EASE_OUT_BACK},
    [State.PANEL]: {duration: ANIM_PANEL, mode: Clutter.AnimationMode.EASE_OUT_BACK},
    [State.NOTIFICATION]: {duration: ANIM_NOTIF, mode: Clutter.AnimationMode.EASE_OUT_ELASTIC},
    [State.SUBTITLE]: {duration: ANIM_TOOLBAR, mode: Clutter.AnimationMode.EASE_OUT_BACK},
    [State.OSD]: {duration: ANIM_OSD, mode: Clutter.AnimationMode.EASE_OUT_BACK},
};

// ---------------------------------------------------------------------------
export const FloeDockButton = GObject.registerClass({
    Properties: {
        'float-width': GObject.ParamSpec.double(
            'float-width', '', '', GObject.ParamFlags.READWRITE, 0, 8192, 0),
        'float-height': GObject.ParamSpec.double(
            'float-height', '', '', GObject.ParamFlags.READWRITE, 0, 8192, 0),
        'float-offset-x': GObject.ParamSpec.double(
            'float-offset-x', '', '', GObject.ParamFlags.READWRITE, -2000, 2000, 0),
    },
}, class FloeDockButton extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'FloeDock 浮冰灵动岛', true); // dontCreateMenu: 自定义点击行为

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
        // 胶囊用 BinLayout 让时钟文本水平垂直都居中
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
        this._floatLayer.layout_manager = new FillLayout();
        this._floatLayer._floeDock = this;
        // 浮层几何变化时同步顶层尺寸与位置
        this.connect('notify::float-width', () => this._syncFloatGeometry());
        this.connect('notify::float-height', () => this._syncFloatGeometry());
        this.connect('notify::float-offset-x', () => this._syncFloatGeometry());
        this.connect('notify::allocation', () => this._syncFloatGeometry());

        this._island.add_child(this._capsule);
        this._island.add_child(this._floatLayer);
        this.add_child(this._island);
        this.add_style_class_name('floedock-button');

        // --- 状态机 ---
        this._surfaces = new Map();     // name -> factory(dock, ext)
        this._instances = new Map();    // name -> surface instance
        this._currentState = State.DOCK;
        this._restoreState = State.DOCK;
        this._transitioning = false;
        this._osdHideId = 0;

        // --- 时钟（与系统面板同源：GnomeDesktop.WallClock） ---
        this._wallClock = new GnomeDesktop.WallClock();
        this._wallClock.bind_property(
            'clock', this._clockLabel, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        this._clockLabel.connect('notify::text', () => {
            // 入舞台后才计算宽度（避免 theme-node 警告）
            if (this._island.get_stage())
                this._updateDockWidth();
        });
        // GNOME 50 移除了 'map' 信号，改用 notify::mapped
        this.connect('notify::mapped', () => {
            if (this.mapped)
                this._updateDockWidth();
        });

        // --- 主题 ---
        this._themeSignal = this._settings.connect('changed', (s, key) => {
            if (key.startsWith('blur-') || key === 'glass-opacity' ||
                key === 'corner-radius' || key === 'accent-color' ||
                key === 'font-size')
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

    /** 注册一个状态表面。factory: (dock, ext) => surface */
    registerSurface(name, factory) {
        this._surfaces.set(name, factory);
    }

    /**
     * 请求切换到某个状态。
     * @param {string} name State.*
     * @param {object} [params] 传给表面 onEnter 的参数
     * @param {object} [opts] {restore: 离开该状态后回到哪一态}
     */
    setState(name, params = {}, opts = {}) {
        if (this._destroyed || this._transitioning)
            return;
        if (name === this._currentState) {
            if (name !== State.DOCK) {
                const surf = this._getSurface(name);
                surf?.refresh?.(params);
            }
            return;
        }
        const {restore = State.DOCK} = opts;
        this._restoreState = restore;
        this._transitionTo(name, params);
    }

    /** OSD 语义：临时上岛，自动收起后恢复之前状态。 */
    showOsd(params = {}) {
        if (this._destroyed || this._transitioning)
            return;
        this._osdHideId = clearTimeoutId(this._osdHideId);
        if (this._currentState === State.OSD) {
            const surf = this._getSurface(State.OSD);
            surf?.onEnter(params);
        } else {
            this._restoreState = this._currentState;
            this._transitionTo(State.OSD, params);
        }
        const duration = params.duration ?? 1500;
        this._osdHideId = timeoutMs(duration, () => {
            this._osdHideId = 0;
            if (this._currentState === State.OSD)
                this.setState(this._restoreState);
        });
    }

    /** 表面主动请求重新调整浮层尺寸（动画）。 */
    resizeFloat(width, height, {duration = 300, mode = Clutter.AnimationMode.EASE_OUT_CUBIC} = {}) {
        const w = clamp(Math.round(width), 0, 8192);
        const h = clamp(Math.round(height), 0, 8192);
        if (this.floatWidth === w && this.floatHeight === h)
            return;
        easeProperty(this, 'float-width', w, {duration, mode});
        easeProperty(this, 'float-height', h, {duration, mode});
    }

    setFloatOffsetX(x, {duration = 400, mode = Clutter.AnimationMode.EASE_OUT_CUBIC} = {}) {
        if (this.floatOffsetX === x)
            return;
        easeProperty(this, 'float-offset-x', x, {duration, mode});
    }

    /** 日志（debug 开关控制）。 */
    debug(...args) {
        if (this._settings.get_boolean('debug'))
            log(`[floedock] ${args.join(' ')}`);
    }

    // ======================== 内部实现 ========================

    _getSurface(name) {
        let inst = this._instances.get(name);
        if (inst)
            return inst;
        const factory = this._surfaces.get(name);
        if (!factory) {
            logError(new Error(`[floedock] no surface registered for "${name}"`));
            return null;
        }
        try {
            inst = factory(this, this._ext);
        } catch (e) {
            logError(e, `[floedock] create surface "${name}"`);
            return null;
        }
        this._floatLayer.add_child(inst.widget);
        inst.widget.hide();
        this._instances.set(name, inst);
        return inst;
    }

    /**
     * 浮层提升到 uiGroup 顶层：
     * 1) BlurEffect(BACKGROUND) 才能采样到面板后方真实内容（panel 有离屏重定向，
     *    子 actor 的模糊只能采样到面板自身内容）；
     * 2) 位置以胶囊为中心，宽度向两侧展开、高度向下打开。
     */
    _floatLayerToTop() {
        if (this._floatLayer.get_parent() === Main.uiGroup)
            return;
        Main.uiGroup.add_child(this._floatLayer);
        Main.uiGroup.set_child_above_sibling(this._floatLayer, null);
        this._floatLayer.show(); // 展开态可见（Dock 态已 hide，避免遮挡/误触发）
        this._syncFloatGeometry();
    }

    _floatLayerBack() {
        // Dock 态隐藏浮层：隐藏的 actor 不参与点击检测，
        // 否则残留的 reactive 区域会"虚空"打开面板
        this._floatLayer.hide();
        if (this._floatLayer.get_parent() === this._island)
            return;
        this._island.add_child(this._floatLayer);
        this._floatLayer.set_position(0, 0);
        this._island.queue_relayout();
    }

    /** 浮层在 uiGroup 时：同步尺寸并定位（居中于按钮/胶囊）。 */
    _syncFloatGeometry() {
        if (this._floatLayer.get_parent() !== Main.uiGroup)
            return;
        this._floatLayer.width = this.floatWidth;
        this._floatLayer.height = this.floatHeight;
        const [bx, by] = this.get_transformed_position();
        const bw = this.get_width();
        const fw = this.floatWidth;
        this._floatLayer.set_position(
            Math.round(bx + bw / 2 - fw / 2 + this.floatOffsetX),
            Math.round(by));
    }

    _transitionTo(name, params) {
        const old = this._currentState;
        const surf = name === State.DOCK ? null : this._getSurface(name);
        if (name !== State.DOCK && !surf)
            return;

        // 离开任何非 Dock 状态都必须调用 onLeave（否则 fullPanel 的
        // stage 捕获处理器不会断开，会吞掉全局点击）
        if (old !== State.DOCK) {
            const oldInst = this._instances.get(old);
            if (oldInst) {
                oldInst.widget.hide();
                oldInst.onLeave?.(false, name);
            }
        }

        this._currentState = name;
        this._transitioning = true;

        if (name === State.DOCK) {
            this._pendingPanel = false;
            for (const inst of this._instances.values())
                inst.widget.hide();
            this._showCapsule();
            this.resizeFloat(this.dockWidth, DOCK_MIN_HEIGHT, {duration: 220});
            this.setFloatOffsetX(0, {duration: 220});
            // 收起：浮层缩小淡出后回到 island
            this._floatLayer.scale_x = 1;
            this._floatLayer.scale_y = 1;
            this._floatLayer.opacity = 255;
            if (this._floatLayer.get_parent() === Main.uiGroup) {
                this._floatLayer.ease({
                    scale_x: 0.1,
                    scale_y: 0.1,
                    opacity: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    onComplete: () => this._floatLayerBack(),
                });
            } else {
                this._floatLayerBack();
            }
            this._transitioning = false;
            return;
        }

        // 进入展开态：胶囊淡出；浮层提升到 uiGroup 顶层（真背景模糊 + 居中于胶囊）
        const fromDock = old === State.DOCK;
        this._floatLayerToTop();
        this._hideCapsule();
        this._applyBlur(surf.widget); // 展开表面同样应用真背景模糊
        const size = surf.getSize();
        const anim = STATE_ANIM[name] ?? STATE_ANIM[State.TOOLBAR];
        surf.widget.show();
        surf.widget.opacity = 255;

        // 浮层全尺寸就位，用 scale 从胶囊中心对称展开：
        // 阶段一 scale_x（左右横拉），阶段二 scale_y（向下打开）
        this.floatWidth = size.width;
        this.floatHeight = size.height;
        this._syncFloatGeometry();
        this._floatLayer.opacity = 255;
        this._floatLayer.pivot_point = new Graphene.Point({x: 0.5, y: 0});

        const onExpandDone = () => {
            this._transitioning = false;
            if (this._currentState !== name) {
                this._pendingPanel = false; // 动画被中断，丢弃挂起的面板请求
                return;
            }
            surf.onEnter(params);
            // 工具栏展开完成时鼠标已不在 → 立即收回（修复"悬停后无法自动收起"）
            if (name === State.TOOLBAR &&
                !this.hover && !this._floatLayer.hover)
                this.setState(State.DOCK);
            // 展开期间用户点击了胶囊 → 展开完成后立刻进入面板
            if (this._pendingPanel) {
                this._pendingPanel = false;
                this.setState(State.PANEL);
            }
        };

        if (!fromDock) {
            // 状态间直接切换（如通知 → 面板）：不重播展开动画
            this._floatLayer.scale_x = 1;
            this._floatLayer.scale_y = 1;
            surf.onExpandStage?.('pull-start');
            surf.onExpandStage?.('pull-done');
            onExpandDone();
            return;
        }

        const scaleX0 = Math.max(0.12, (this.dockWidth ?? DOCK_MIN_WIDTH) / size.width);
        this._floatLayer.scale_x = scaleX0;
        this._floatLayer.scale_y = 0.12;
        surf.onExpandStage?.('pull-start');
        // 阶段一：左右横拉（scale_x，从胶囊宽度到全宽，中心对称）
        this._floatLayer.ease({
            scale_x: 1,
            duration: anim.duration,
            mode: anim.mode,
            onComplete: () => {
                surf.onExpandStage?.('pull-done');
                // 阶段二：向下打开（scale_y）
                this._floatLayer.ease({
                    scale_y: 1,
                    duration: Math.round(anim.duration * 0.8),
                    mode: anim.mode,
                    onComplete: onExpandDone,
                });
            },
        });
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

    // 钉死按钮宽度 = 胶囊宽度，防止被面板布局拉伸导致浮层错位
    vfunc_get_preferred_width(_forHeight) {
        const w = Math.max(DOCK_MIN_WIDTH, this.dockWidth ?? DOCK_MIN_WIDTH);
        return [w, w];
    }

    _setupInput() {
        this._pendingPanel = false;

        // 点击胶囊 → 打开全功能面板。
        // GNOME 50 的 ClickGesture 用 recognize 信号；recognize 时 get_button
        // 并不可靠，因此不依赖按钮号判断（右键/中键打开面板也无妨）。
        const openPanelFromClick = () => {
            this._hoverTimer = clearTimeoutId(this._hoverTimer);
            this._hoverCloseTimer = clearTimeoutId(this._hoverCloseTimer);
            if (this._transitioning) {
                // 正在展开（如工具栏）：等展开完成后再进入面板
                this._pendingPanel = true;
                return;
            }
            this.setState(State.PANEL);
        };

        this._clickGesture = new Clutter.ClickGesture();
        this._clickGesture.connect('recognize', openPanelFromClick);
        this._capsule.add_action(this._clickGesture);
        // 兜底：island 上直接监听（覆盖胶囊区域；浮层显示时交给表面处理）
        this._island.reactive = true;
        this._island.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            if (this._currentState !== State.DOCK && this._currentState !== State.TOOLBAR)
                return Clutter.EVENT_PROPAGATE;
            log('[floedock] click → open panel (state=' + this._currentState + ')');
            openPanelFromClick();
            return Clutter.EVENT_STOP;
        });

        // hover：按钮与浮层任一 hover 即视为悬停；离开带缓冲延迟，避免闪烁
        this._hoverTimer = 0;
        this._hoverCloseTimer = 0;
        const updateHover = () => {
            const hovered = this.hover || this._floatLayer.hover;
            if (!hovered) {
                // 离开：先取消展开计时，再延迟收起（缓冲移动）
                this._hoverTimer = clearTimeoutId(this._hoverTimer);
                if (this._currentState === State.TOOLBAR && !this._hoverCloseTimer) {
                    this._hoverCloseTimer = timeoutMs(HOVER_CLOSE_DELAY, () => {
                        this._hoverCloseTimer = 0;
                        if (this._currentState !== State.TOOLBAR)
                            return;
                        if (this.hover || this._floatLayer.hover)
                            return;
                        if (this._transitioning) {
                            // 收起动画进行中：稍后重试
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
                // 触发时再次确认仍在 Dock 态（期间可能已点击打开面板）
                if (this._currentState === State.DOCK && !this._transitioning)
                    this.setState(State.TOOLBAR);
            });
        };
        this.connect('notify::hover', updateHover);
        this._floatLayer.connect('notify::hover', updateHover);
    }

    _applyTheme() {
        const blur = this._settings.get_int('blur-strength');
        const opacity = this._settings.get_int('glass-opacity');
        const radius = this._settings.get_int('corner-radius');
        const accent = this._settings.get_string('accent-color') || '#7fd4ff';
        const fontSize = this._settings.get_int('font-size');
        const fontFamily = this._settings.get_string('font-family') || 'DejaVu Sans Mono';

        const base = clamp(Math.round(255 * opacity / 100), 0, 255);
        // 渐变用暗底（深蓝灰），让背景模糊透出来
        const top = clamp(base + Math.round(16 * blur / 100), 0, 255);
        const border = clamp(40 + blur / 2, 40, 95);
        const glow = clamp(18 + blur / 3, 18, 60);

        this._theme = {
            blur,
            opacity,
            radius,
            accent,
            fontSize,
            fontFamily,
            blurRadius: blur > 0 ? Math.max(6, Math.round(blur * 0.6)) : 0,
            baseAlpha: (base / 255).toFixed(3),
            topAlpha: (top / 255).toFixed(3),
            borderAlpha: (border / 255).toFixed(3),
            glowAlpha: (glow / 255).toFixed(3),
        };

        // 胶囊内联样式（半透明暗底渐变，配合 Shell.BlurEffect 真背景模糊）
        this._capsule.set_style(`
            background-gradient-direction: vertical;
            background-gradient-start: rgba(48,64,92,${this._theme.topAlpha});
            background-gradient-end: rgba(22,30,48,${this._theme.baseAlpha});
            border: 1px solid rgba(255,255,255,${this._theme.borderAlpha});
            border-radius: 999px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.30),
                        0 6px 18px rgba(0,0,0,0.18);
        `);
        this._clockLabel.set_style(`
            font-size: ${fontSize}px;
            font-family: ${fontFamily};
            font-weight: 300;
            color: rgba(255,255,255,0.95);
        `);
        this._applyBlur(this._capsule);
    }

    /**
     * 给 actor 应用/更新真背景模糊（BACKGROUND 模式）。
     * 优先 gi://Blur（mutter 49/50 新 API），回退 Shell.BlurEffect。
     */
    async _applyBlur(actor) {
        const radius = this._theme?.blurRadius ?? 0;
        // 移除旧效果
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
            let fx;
            if (ns) {
                fx = new ns.BlurEffect({
                    mode: ns.BlurMode.BACKGROUND,
                    radius,
                    brightness: 1.0,
                    corner_radius: this._theme?.radius ?? 14,
                });
            } else {
                fx = new Shell.BlurEffect({
                    mode: Shell.BlurMode.BACKGROUND,
                    radius,
                    brightness: 1.0,
                });
            }
            actor.add_effect(fx);
        } catch (e) {
            logError(e, '[floedock] blur effect');
        }
    }

    /** 禁用时清理。 */
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._hoverTimer = clearTimeoutId(this._hoverTimer);
        this._hoverCloseTimer = clearTimeoutId(this._hoverCloseTimer);
        this._osdHideId = clearTimeoutId(this._osdHideId);
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

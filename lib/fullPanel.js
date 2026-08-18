// 模块三：全功能面板（点击 Dock 态展开）。
// 结构：全盘搜索栏 → Tab 标签栏（滑动亮条指示器）→ 内容分页区（左右滑动切换）。
// 点击面板外区域 / 按 Esc 关闭。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    PANEL_HEIGHT,
    PANEL_MAX_WIDTH,
    PANEL_MARGIN,
    HOVER_CLOSE_DELAY,
    State,
} from './constants.js';
import {SearchController} from './search.js';
import {createMessagesModule} from './messagesModule.js';
import {createWeatherModule} from './weatherModule.js';
import {createCalendarModule} from './calendarModule.js';
import {createMusicModule} from './musicModule.js';
import {createTimerModule} from './timerModule.js';
import {createTranslateModule} from './translateModule.js';
import {createColorPickerModule} from './colorPickerModule.js';
import {fadeInUp, clamp, timeoutMs, clearTimeoutId} from './utils.js';

// ---------------------------------------------------------------------------
// PanelLayout：vbox 铺满；搜索结果显示层覆盖在内容区上方（不参与流式布局）。
// ---------------------------------------------------------------------------
const PanelLayout = GObject.registerClass(
class PanelLayout extends Clutter.LayoutManager {
    vfunc_allocate(container, box, flags) {
        container.set_allocation(box);
        const availW = box.x2 - box.x1;
        const availH = box.y2 - box.y1;
        for (const child of container.get_children()) {
            if (child === container._vbox) {
                const cbox = new Clutter.ActorBox();
                cbox.x1 = 0;
                cbox.y1 = 0;
                cbox.x2 = availW;
                cbox.y2 = availH;
                child.allocate(cbox, flags);
            } else if (child === container._resultsLayer) {
                if (!child.visible)
                    continue;
                const sh = container._searchRowH ?? 52;
                const cbox = new Clutter.ActorBox();
                cbox.x1 = 0;
                cbox.y1 = sh;
                cbox.x2 = availW;
                cbox.y2 = availH;
                child.allocate(cbox, flags);
            }
        }
    }

    vfunc_get_preferred_width(container, forHeight) {
        const vbox = container._vbox;
        if (vbox)
            return vbox.get_preferred_width(forHeight);
        return [PANEL_MAX_WIDTH, PANEL_MAX_WIDTH];
    }

    vfunc_get_preferred_height(container, forWidth) {
        const vbox = container._vbox;
        if (vbox)
            return vbox.get_preferred_height(forWidth);
        return [PANEL_HEIGHT, PANEL_HEIGHT];
    }
});

// ---------------------------------------------------------------------------
// TabsRow：带可动画的指示器位置/宽度属性。
// ---------------------------------------------------------------------------
const TabsRow = GObject.registerClass({
    Properties: {
        'indicator-x': GObject.ParamSpec.double(
            'indicator-x', '', '', GObject.ParamFlags.READWRITE, 0, 2000, 0),
        'indicator-w': GObject.ParamSpec.double(
            'indicator-w', '', '', GObject.ParamFlags.READWRITE, 0, 600, 40),
    },
}, class TabsRow extends St.Widget {
    _init(params) {
        super._init(params);
        this._tabBox = null;
        this._indicator = null;
    }

    vfunc_get_preferred_width(container, forHeight) {
        if (this._tabBox)
            return this._tabBox.get_preferred_width(forHeight);
        return [0, 0];
    }

    vfunc_get_preferred_height(container, forWidth) {
        if (this._tabBox)
            return this._tabBox.get_preferred_height(forWidth);
        return [36, 36];
    }

    vfunc_allocate(box, flags) {
        this.set_allocation(box);
        const availW = box.x2 - box.x1;
        const availH = box.y2 - box.y1;
        for (const child of this.get_children()) {
            if (child === this._tabBox) {
                const cbox = new Clutter.ActorBox();
                cbox.x1 = 0;
                cbox.y1 = 0;
                cbox.x2 = availW;
                cbox.y2 = availH;
                child.allocate(cbox, flags);
            } else if (child === this._indicator && child.visible) {
                const cbox = new Clutter.ActorBox();
                cbox.x1 = this.indicatorX;
                cbox.y1 = availH - 4;
                cbox.x2 = cbox.x1 + this.indicatorW;
                cbox.y2 = availH;
                child.allocate(cbox, flags);
            }
        }
    }
});

// ---------------------------------------------------------------------------
export function createFullPanel(dock, ext) {
    const settings = ext.getSettings();
    const theme = dock.theme;

    // ===================== 根容器 =====================
    const root = new St.Widget({
        style_class: 'floedock-panel',
        reactive: true,
        track_hover: true,
        clip_to_allocation: false,
    });
    const layout = new PanelLayout();
    root.layout_manager = layout;

    const vbox = new St.BoxLayout({
        style_class: 'floedock-panel-body',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    root._vbox = vbox;
    root.add_child(vbox);

    const resultsLayer = new St.Widget({
        style_class: 'floedock-search-results-layer',
        reactive: true,
    });
    root._resultsLayer = resultsLayer;
    root._searchRowH = 52;
    root.add_child(resultsLayer);

    // 面板玻璃样式（圆角/主题色来自设置）
    const applyPanelStyle = () => {
        root.set_style(`
            background-gradient-direction: vertical;
            background-gradient-start: rgba(255,255,255,${theme.topAlpha});
            background-gradient-end: rgba(30,40,60,${theme.baseAlpha});
            border: 1px solid rgba(255,255,255,${theme.borderAlpha});
            border-radius: ${Math.max(14, theme.radius)}px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 18px 60px rgba(0,0,0,0.28);
        `);
        resultsLayer.set_style(`border-radius: ${Math.max(12, theme.radius - 2)}px;`);
    };
    applyPanelStyle();

    // ===================== 1. 搜索栏 =====================
    const searchRow = new St.Bin({
        style_class: 'floedock-search-row',
        x_expand: true,
        height: 44,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const searchEntry = new St.Entry({
        style_class: 'floedock-search-entry',
        hint_text: '搜索文件与应用…',
        can_focus: true,
        x_expand: true,
    });
    searchRow.child = searchEntry;
    vbox.add_child(searchRow);

    // 搜索结果下拉（覆盖内容区）
    const resultsScroll = new St.ScrollView({
        style_class: 'floedock-search-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
    });
    const resultsList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
    });
    const resultsViewport = new St.Viewport();
    resultsViewport.add_child(resultsList);
    resultsScroll.add_child(resultsViewport);
    resultsLayer.add_child(resultsScroll);
    resultsLayer.hide();

    const searchController = new SearchController({
        entry: searchEntry,
        ext,
        onResults: (rows, gen) => renderResults(rows, gen),
    });

    function renderResults(rows, gen) {
        if (gen !== searchController._gen)
            return;
        resultsList.destroy_all_children();
        if (rows.length === 0) {
            resultsLayer.hide();
            return;
        }
        for (const row of rows)
            resultsList.add_child(buildResultRow(row));
        resultsLayer.show();
    }

    function buildResultRow(row) {
        const btn = new St.BoxLayout({
            style_class: 'floedock-search-result',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        const icon = new St.Icon({
            icon_size: 20,
            style_class: 'floedock-search-result-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (row.gicon)
            icon.gicon = row.gicon;
        else if (row.iconName)
            icon.icon_name = row.iconName;
        btn.add_child(icon);

        const v = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const t = new St.Label({
            text: row.title,
            style_class: 'floedock-search-result-title',
            x_align: Clutter.ActorAlign.START,
        });
        v.add_child(t);
        if (row.subtitle) {
            const s = new St.Label({
                text: row.subtitle,
                style_class: 'floedock-search-result-subtitle',
                x_align: Clutter.ActorAlign.START,
            });
            v.add_child(s);
        }
        btn.add_child(v);
        btn.connect('button-press-event', () => {
            row.run();
            dock.setState(State.DOCK);
            return Clutter.EVENT_STOP;
        });
        return btn;
    }

    // ===================== 2. Tab 标签栏 =====================
    const tabsRow = new TabsRow({
        style_class: 'floedock-tabs',
        x_expand: true,
        height: 36,
    });
    const tabBox = new St.BoxLayout({
        style_class: 'floedock-tab-box',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    tabsRow._tabBox = tabBox;
    tabsRow.add_child(tabBox);

    const indicator = new St.Widget({
        style_class: 'floedock-tab-indicator',
        reactive: false,
        height: 4,
        y_expand: false,
    });
    tabsRow._indicator = indicator;
    tabsRow.add_child(indicator);
    vbox.add_child(tabsRow);

    // ===================== 3. 内容分页区 =====================
    const contentArea = new St.Widget({
        style_class: 'floedock-pager',
        reactive: true,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });
    const pagesBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    contentArea.add_child(pagesBox);
    vbox.add_child(contentArea);

    // 内容区尺寸变化时（面板展开动画期间）防抖同步页面宽度
    let widthSyncId = 0;
    contentArea.connect('notify::allocation', () => {
        if (widthSyncId)
            return;
        widthSyncId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 120, () => {
            widthSyncId = 0;
            if (pagesBox.get_n_children() > 0)
                syncPageWidths();
        });
    });

    // ===================== 模块注册 =====================
    const modules = []; // {title, icon, create, instance}
    const addModule = (title, icon, create) => modules.push({title, icon, create, instance: null});

    addModule('消息', 'preferences-system-notifications-symbolic', createMessagesModule);
    addModule('天气', 'weather-clear-symbolic', createWeatherModule);
    addModule('日历', 'calendar-today-symbolic', createCalendarModule);
    addModule('音乐', 'multimedia-player-symbolic', createMusicModule);
    addModule('计时', 'timer-symbolic', createTimerModule);
    addModule('翻译', 'input-keyboard-symbolic', createTranslateModule);
    addModule('取色', 'color-select-symbolic', createColorPickerModule);

    // ===================== 构建 UI =====================
    let currentIndex = 0;
    let captureId = 0;

    const MODULE_SETTING = {
        '消息': 'module-messages',
        '天气': 'module-weather',
        '日历': 'module-calendar',
        '音乐': 'module-music',
        '计时': 'module-timer',
        '翻译': 'module-translate',
        '取色': 'module-colorpicker',
    };

    function isModuleEnabled(m) {
        const key = MODULE_SETTING[m.title];
        return key ? settings.get_boolean(key) : true;
    }

    function buildTabs() {
        tabBox.destroy_all_children();
        indicator.hide();
        for (const m of modules) {
            if (!isModuleEnabled(m))
                continue;
            const btn = new St.BoxLayout({
                style_class: 'floedock-tab',
                reactive: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const lbl = new St.Label({
                text: m.title,
                style_class: 'floedock-tab-label',
            });
            btn.add_child(lbl);
            btn._module = m;
            btn.connect('button-press-event', (actor, ev) => {
                switchTo(modules.indexOf(btn._module));
                return Clutter.EVENT_STOP;
            });
            tabBox.add_child(btn);
        }
        if (tabBox.get_n_children() > 0) {
            indicator.show();
            updateIndicator(0, false);
        }
    }

    function ensurePages() {
        while (pagesBox.get_n_children() < modules.length) {
            const i = pagesBox.get_n_children();
            const m = modules[i];
            if (!m.instance) {
                try {
                    m.instance = m.create({dock, ext});
                } catch (e) {
                    logError(e, `[floedock] create module "${m.title}"`);
                }
            }
            const page = new St.Widget({
                style_class: 'floedock-page',
                x_expand: false,
                y_expand: true,
                width: 640, // 占位宽度，openPanel 时按内容区实际宽度更新
                // BinLayout + 默认 FILL：模块内容铺满整页（否则挤在左上角）
                layout_manager: new Clutter.BinLayout(),
            });
            if (m.instance)
                page.add_child(m.instance.widget);
            page._moduleIndex = i;
            pagesBox.add_child(page);
        }
    }

    // 手动同步页面宽度（GNOME 50 的 BindConstraint 行为不可靠，弃用）
    function syncPageWidths() {
        const w = contentArea.get_width() || 640;
        for (const page of pagesBox.get_children())
            page.width = w;
    }

    function pageForIndex(index) {
        const page = pagesBox.get_children()[index];
        return page ?? null;
    }

    function tabXOf(index) {
        const children = [...tabBox.get_children()];
        if (children.length === 0)
            return {x: 0, w: 40};
        // 按模块找对应 tab（tab 与模块可能因设置开关而错位）
        const target = children.find(c => c._module === modules[index]) ??
            children[Math.min(index, children.length - 1)];
        // 布局后优先用实际坐标，未布局时用 preferred 累加
        const x = target.get_x() > 0 ? target.get_x() : (() => {
            let absX = 0;
            for (const c of children) {
                if (c === target)
                    break;
                const [, w] = c.get_preferred_width(-1);
                absX += Math.round(w) + 2;
            }
            return absX;
        })();
        const w = target.get_width() > 0 ? target.get_width()
            : Math.max(24, Math.round(target.get_preferred_width(-1)[1]));
        return {x: Math.round(x), w};
    }

    function updateIndicator(index, animate = true) {
        const {x, w} = tabXOf(index);
        if (animate) {
            tabsRow.ease_property('indicator-x', x, {
                duration: 340,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            tabsRow.ease_property('indicator-w', w, {
                duration: 340,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            tabsRow.indicatorX = x;
            tabsRow.indicatorW = w;
        }
        tabsRow.queue_relayout();
    }

    function switchTo(index, {animate = true} = {}) {
        index = clamp(index, 0, modules.length - 1);
        ensurePages();
        syncPageWidths();

        const prev = modules[currentIndex]?.instance;
        const next = modules[index]?.instance;

        const oldPage = pageForIndex(currentIndex);
        const newPage = pageForIndex(index);

        if (index !== currentIndex) {
            prev?.deactivate?.();
            currentIndex = index;
            try {
                next?.activate?.();
            } catch (e) {
                logError(e, `[floedock] activate module "${modules[index]?.title}"`);
            }
        } else if (animate === false) {
            // 面板首次打开：激活当前模块
            try {
                next?.activate?.();
            } catch (e) {
                logError(e, `[floedock] activate module "${modules[index]?.title}"`);
            }
        }

        const pageWidth = contentArea.get_width() || 640;

        if (!animate || oldPage === newPage) {
            // 直接显示目标页（无动画）
            for (const page of pagesBox.get_children()) {
                page.visible = page === newPage;
                page.translation_x = 0;
                page.opacity = 255;
            }
        } else {
            // 旧页向左滑出并隐藏，新页从右侧滑入（不依赖 clip/整体位移）
            newPage.visible = true;
            newPage.translation_x = pageWidth;
            newPage.opacity = 0;
            newPage.ease({
                translation_x: 0,
                opacity: 255,
                duration: 320,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
            oldPage.translation_x = 0;
            oldPage.ease({
                translation_x: -pageWidth,
                opacity: 0,
                duration: 260,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    oldPage.visible = false;
                    oldPage.translation_x = 0;
                    oldPage.opacity = 255;
                },
            });
        }
        updateIndicator(index, animate);
    }

    // 横向滑动切换（Clutter 手势动作在 GNOME 50 已移除，手动跟踪指针）
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeTracking = false;
    let swipeActive = false;

    contentArea.connect('button-press-event', (a, ev) => {
        if (ev.get_button() === 1) {
            swipeTracking = true;
            swipeActive = false;
            [swipeStartX, swipeStartY] = ev.get_coords();
        }
        return Clutter.EVENT_PROPAGATE;
    });
    contentArea.connect('motion-event', (a, ev) => {
        if (!swipeTracking)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        const dx = x - swipeStartX;
        const dy = y - swipeStartY;
        if (!swipeActive && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy))
            swipeActive = true;
        if (swipeActive) {
            // 跟随手指拖动当前页
            const page = pageForIndex(currentIndex);
            if (page)
                page.translation_x = dx;
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    contentArea.connect('button-release-event', (a, ev) => {
        if (!swipeActive) {
            swipeTracking = false;
            return Clutter.EVENT_PROPAGATE;
        }
        const [x] = ev.get_coords();
        const dx = x - swipeStartX;
        swipeTracking = false;
        swipeActive = false;
        if (dx < -50)
            switchTo(currentIndex + 1);
        else if (dx > 50)
            switchTo(currentIndex - 1);
        else
            switchTo(currentIndex); // 回弹
        return Clutter.EVENT_STOP;
    });

    // ===================== 面板开合 =====================
    let panelReady = false;
    let hoverCloseId = 0;

    // 鼠标离开面板 → 延迟关闭（第 10 条需求）
    root.connect('notify::hover', () => {
        if (!panelReady)
            return;
        if (root.hover) {
            hoverCloseId = clearTimeoutId(hoverCloseId);
        } else {
            hoverCloseId = timeoutMs(HOVER_CLOSE_DELAY, () => {
                hoverCloseId = 0;
                if (!root.hover && panelReady)
                    dock.setState(State.DOCK);
            });
        }
    });

    function openPanel() {
        ensurePages();
        buildTabs();
        switchTo(0, {animate: false});
        // 内容区在展开完成（onEnter）时淡入；搜索框/Tab 由 onExpandStage 分阶段显示
        contentArea.opacity = 0;
        fadeInUp(contentArea, {duration: 260, delayMs: 60});

        searchEntry.text = '';
        resultsLayer.hide();
        GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => {
            global.stage.set_key_focus(searchEntry.clutter_text);
        });
        installCapture();
        panelReady = true;
    }

    function closePanel() {
        panelReady = false;
        hoverCloseId = clearTimeoutId(hoverCloseId);
        widthSyncId = clearTimeoutId(widthSyncId);
        searchController.stop();
        if (captureId) {
            global.stage.disconnect(captureId);
            captureId = 0;
        }
        if (global.stage.get_key_focus() === searchEntry.clutter_text)
            global.stage.set_key_focus(null);
        for (const m of modules)
            m.instance?.deactivate?.();
    }

    function installCapture() {
        if (captureId)
            global.stage.disconnect(captureId);
        captureId = global.stage.connect('captured-event', (stage, event) => {
            if (event.type() === Clutter.EventType.KEY_RELEASE) {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    if (searchEntry.text) {
                        searchEntry.text = '';
                        return Clutter.EVENT_STOP;
                    }
                    dock.setState(State.DOCK);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }
            if (event.type() !== Clutter.EventType.BUTTON_RELEASE)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            const [rx, ry] = root.get_transformed_position();
            const rw = root.get_width();
            const rh = root.get_height();
            if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh)
                return Clutter.EVENT_PROPAGATE;
            dock.setState(State.DOCK);
            return Clutter.EVENT_STOP;
        });
    }

    // ===================== 表面 =====================
    // 展开阶段回调：pull-start 显示搜索框，pull-done 显示 Tab，onEnter 显示内容
    const onExpandStage = stage => {
        if (stage === 'pull-start') {
            searchRow.opacity = 0;
            tabsRow.opacity = 0;
            contentArea.opacity = 0;
            fadeInUp(searchRow, {duration: 220});
        } else if (stage === 'pull-done') {
            fadeInUp(tabsRow, {duration: 220});
        }
    };

    return {
        widget: root,

        getSize() {
            const monitor = Main.layoutManager.primaryMonitor;
            const width = Math.min(PANEL_MAX_WIDTH, monitor.width - 2 * PANEL_MARGIN);
            const maxH = monitor.height - Main.panel.get_height() - PANEL_MARGIN;
            const height = Math.max(280, Math.min(PANEL_HEIGHT, maxH));
            return {width, height};
        },

        onExpandStage,

        onEnter() {
            openPanel();
        },

        onLeave(animate, nextState) {
            closePanel();
        },

        destroy() {
            closePanel();
            searchController.destroy();
            for (const m of modules)
                m.instance?.destroy?.();
            modules.length = 0;
            root.destroy_all_children();
        },
    };
}

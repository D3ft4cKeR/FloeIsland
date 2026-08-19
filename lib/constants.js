// Shared constants for FloeIsland | 浮灵岛.
// Keep this file free of gi:// / resource:// imports so it can be
// syntax-checked and unit-tested with plain node/gjs.

export const UUID = 'floeisland@floeisland.github.io';
export const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.floeisland';
export const ROLE = 'floeisland';

// --- dock capsule ---------------------------------------------------------
export const DOCK_MIN_WIDTH = 104;      // minimum capsule width in px
export const DOCK_H_PADDING = 20;       // horizontal padding around the clock text
export const DOCK_MIN_HEIGHT = 30;      // fallback capsule height in px

// --- geometry -------------------------------------------------------------
export const TOOL_PITCH = 32;           // pitch (px) between hover-toolbar buttons
export const TOOL_DIAMETER = 28;        // toolbar button diameter
export const TOOLBAR_PADDING = 8;       // toolbar side padding
export const TOOLBAR_HEIGHT = 34;       // toolbar height (compact, fits the panel)
export const PANEL_HEIGHT = 244;        // 面板高度：搜索行+标签行+两行内容（两个通知）
export const PANEL_MAX_WIDTH = 640;     // full panel max width
export const PANEL_MARGIN = 24;         // keep full panel this far from screen edge
export const NOTIF_HEIGHT = 96;         // notification state height (capsule morph target, demo=90)
export const NOTIF_PULL = 36;           // 通知态岛体下移距离（突破顶栏下边界，同演示 36px）
export const SUBTITLE_HEIGHT = 56;      // subtitle state height
export const OSD_HEIGHT = 64;           // system OSD state height
export const OSD_TIMEOUT_MS = 1500;     // how long the OSD stays before collapsing
export const HOVER_CLOSE_DELAY = 300;   // leave grace period (ms) before collapsing toolbar/panel

// --- animation ------------------------------------------------------------
export const ANIM_FAST = 200;
export const ANIM_TOOLBAR = 400;
export const ANIM_PANEL = 500;
export const ANIM_NOTIF = 600;
export const ANIM_OSD = 300;
export const TOOL_STAGGER_MS = 40;      // delay between toolbar icon pop-ins
export const HOVER_LIMIT_PX = 24;       // hover leave tolerance before collapsing

// --- state names ----------------------------------------------------------
export const State = Object.freeze({
    DOCK: 'dock',
    TOOLBAR: 'toolbar',
    PANEL: 'panel',
    NOTIFICATION: 'notification',
    SUBTITLE: 'subtitle',
    OSD: 'osd',
    LOCK: 'lock',
});

// --- misc -----------------------------------------------------------------
export const SCREENSHOT_DIR = 'Pictures'; // under $HOME
export const RECORDING_DIR = 'Videos';    // under $HOME
export const MAX_SEARCH_RESULTS = 8;
export const MAX_NOTIF_LIST = 30;         // messages module history cap

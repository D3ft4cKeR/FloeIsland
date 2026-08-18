// 模块六：系统状态上岛。
//
// 接管 Main.osdWindowManager（音量/亮度/麦克风/静音 OSD）、
// SettingsDaemon.Rfkill（飞行模式）、ScreenshotUI（录屏指示/截图确认），
// 将反馈显示在岛屿上而非默认 OSD。

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {OSD_HEIGHT} from './constants.js';
import {clamp} from './utils.js';
import {makeProgressBar} from './widgets.js';

// ---------------------------------------------------------------------------
// OSD 表面
// ---------------------------------------------------------------------------
export function createOsdSurface(dock, ext) {
    const theme = dock.theme;

    const box = new St.BoxLayout({
        style_class: 'floedock-osd',
        reactive: false,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const icon = new St.Icon({
        icon_size: 26,
        style_class: 'floedock-osd-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(icon);

    const vbox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(vbox);

    const label = new St.Label({
        style_class: 'floedock-osd-label',
        x_align: Clutter.ActorAlign.CENTER,
    });
    vbox.add_child(label);

    const progress = makeProgressBar({width: 120, height: 6});
    progress.widget.x_align = Clutter.ActorAlign.CENTER;
    vbox.add_child(progress.widget);

    let pendingAnim = 0;

    const applyStyle = () => {
        box.set_style(`
            background-gradient-direction: vertical;
            background-gradient-start: rgba(255,255,255,${theme.topAlpha});
            background-gradient-end: rgba(255,255,255,${theme.baseAlpha});
            border: 1px solid rgba(255,255,255,${theme.borderAlpha});
            border-radius: ${Math.max(12, Math.round(theme.radius * 0.8))}px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.28), 0 8px 28px rgba(0,0,0,0.18);
            padding: 0 18px;
        `);
        progress.setAccent(theme.accent);
    };

    return {
        widget: box,

        getSize() {
            let w = 170;
            if (label.visible && label.text) {
                const [, nat] = label.get_preferred_width(-1);
                w = Math.max(w, nat + 92);
            }
            return {width: w, height: OSD_HEIGHT};
        },

        onEnter(params = {}) {
            applyStyle();
            if (params.icon) {
                if (typeof params.icon === 'string')
                    icon.icon_name = params.icon;
                else
                    icon.gicon = params.icon;
                icon.show();
            } else {
                icon.hide();
            }

            label.text = params.label ?? '';
            label.visible = !!params.label;

            const hasLevel = params.level !== undefined && params.level !== null;
            progress.widget.visible = hasLevel;
            if (hasLevel) {
                const max = params.maxLevel > 0 ? params.maxLevel : 100;
                progress.setValue(clamp(params.level / max, 0, 1));
            }

            // 图标弹入 + 文本淡入
            if (pendingAnim)
                GLib.source_remove(pendingAnim);
            icon.opacity = 0;
            icon.scale_x = 0.4;
            icon.scale_y = 0.4;
            pendingAnim = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 30, () => {
                pendingAnim = 0;
                icon.ease({
                    opacity: 255,
                    scale_x: 1,
                    scale_y: 1,
                    duration: 320,
                    mode: Clutter.AnimationMode.EASE_OUT_BACK,
                });
                label.opacity = 0;
                label.ease({
                    opacity: 255,
                    duration: 220,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    delay: 90,
                });
            });

            dock.resizeFloat(this.getSize().width, OSD_HEIGHT,
                {duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        },

        onLeave(animate, nextState) {
            if (pendingAnim) {
                GLib.source_remove(pendingAnim);
                pendingAnim = 0;
            }
        },

        destroy() {
            if (pendingAnim) {
                GLib.source_remove(pendingAnim);
                pendingAnim = 0;
            }
        },
    };
}

// ---------------------------------------------------------------------------
// OSD 接管
// ---------------------------------------------------------------------------
const KIND_SETTING = {
    volume: 'takeover-volume',
    mute: 'takeover-mute',
    mic: 'takeover-mic',
    brightness: 'takeover-brightness',
};

function iconKind(icon) {
    let name = null;
    try {
        if (icon instanceof Gio.ThemedIcon) {
            const names = icon.get_names();
            if (names.length > 0)
                name = names[0];
        }
    } catch (e) {
        // ignore
    }
    if (!name && typeof icon?.icon_name === 'string')
        name = icon.icon_name;
    if (!name)
        return 'other';
    if (name.includes('audio-volume-muted'))
        return 'mute';
    if (name.includes('audio-volume'))
        return 'volume';
    if (name.includes('microphone') || name.includes('audio-input-mic'))
        return 'mic';
    if (name.includes('brightness'))
        return 'brightness';
    return 'other';
}

export function installOsdTakeover(ext, dock) {
    const settings = ext.getSettings();
    const om = Main.osdWindowManager;
    if (!om)
        return null;

    const origShow = om.show.bind(om);
    const origShowAll = om.showAll.bind(om);
    const origShowOne = om.showOne.bind(om);

    const route = ({icon, label, level, maxLevel}) => {
        dock.showOsd({icon, label, level, maxLevel});
    };

    om.show = (icon, label, levels) => {
        const kind = iconKind(icon);
        const key = KIND_SETTING[kind];
        if (key && settings.get_boolean(key)) {
            const idx = Main.layoutManager.primaryIndex;
            const lv = levels?.[idx];
            route({
                icon,
                label,
                level: lv?.level,
                maxLevel: lv?.maxLevel > 0 ? lv.maxLevel : 100,
            });
            return;
        }
        origShow(icon, label, levels);
    };

    om.showAll = (icon, label, level, maxLevel) => {
        const kind = iconKind(icon);
        const key = KIND_SETTING[kind];
        if (key && settings.get_boolean(key)) {
            route({icon, label, level, maxLevel});
            return;
        }
        origShowAll(icon, label, level, maxLevel);
    };

    om.showOne = (monitorIndex, icon, label, level, maxLevel) => {
        const kind = iconKind(icon);
        const key = KIND_SETTING[kind];
        if (key && settings.get_boolean(key)) {
            if (monitorIndex === Main.layoutManager.primaryIndex)
                route({icon, label, level, maxLevel});
            return;
        }
        origShowOne(monitorIndex, icon, label, level, maxLevel);
    };

    // --- 飞行模式（SettingsDaemon.Rfkill） ---
    let rfkillProxy = null;
    try {
        rfkillProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: 'org.gnome.SettingsDaemon.Rfkill',
            g_object_path: '/org/gnome/SettingsDaemon/Rfkill',
            g_interface_name: 'org.gnome.SettingsDaemon.Rfkill',
        });
    } catch (e) {
        logError(e, '[floedock] rfkill proxy');
    }
    let rfkillSignalId = 0;
    if (rfkillProxy) {
        // 记录上一次值：仅当 AirplaneMode 实际变化时才上岛提示，
        // 并忽略启用初期（系统初始化/状态同步会触发一次误报）
        let lastAirplane = null;
        const ENABLED_AT = Date.now();
        rfkillProxy.init_async(GLib.PRIORITY_DEFAULT, null);
        rfkillSignalId = rfkillProxy.connect('g-properties-changed', (proxy, properties) => {
            const changed = properties.deepUnpack();
            if (!('AirplaneMode' in changed))
                return;
            if (!settings.get_boolean('takeover-airplane'))
                return;
            const on = changed.AirplaneMode.deepUnpack();
            if (lastAirplane === null) {
                lastAirplane = on; // 首次同步：只记录，不提示
                return;
            }
            if (on === lastAirplane)
                return;
            if (Date.now() - ENABLED_AT < 5000)
                return; // 启用 5 秒内的系统级同步忽略
            lastAirplane = on;
            dock.showOsd({
                icon: 'airplane-mode-symbolic',
                label: on ? '飞行模式已开启' : '飞行模式已关闭',
            });
        });
    }

    // --- 录屏指示 + 截图确认（ScreenshotUI） ---
    const ui = Main.screenshotUI;
    let recordSigId = 0;
    let takenSigId = 0;
    if (ui) {
        recordSigId = ui.connect('notify::screencast-in-progress', () => {
            if (!settings.get_boolean('takeover-recording'))
                return;
            const recording = ui.screencast_in_progress;
            dock.showOsd({
                icon: 'media-record-symbolic',
                label: recording ? '正在录制屏幕' : '录制结束',
                duration: recording ? 2200 : 1500,
            });
        });
        takenSigId = ui.connect('screenshot-taken', () => {
            if (!settings.get_boolean('takeover-screenshot'))
                return;
            dock.showOsd({
                icon: 'camera-photo-symbolic',
                label: '已截图',
            });
        });
    }

    return {
        destroy() {
            om.show = origShow;
            om.showAll = origShowAll;
            om.showOne = origShowOne;
            if (rfkillProxy && rfkillSignalId) {
                rfkillProxy.disconnect(rfkillSignalId);
                rfkillSignalId = 0;
            }
            if (ui) {
                if (recordSigId) {
                    ui.disconnect(recordSigId);
                    recordSigId = 0;
                }
                if (takenSigId) {
                    ui.disconnect(takenSigId);
                    takenSigId = 0;
                }
            }
        },
    };
}

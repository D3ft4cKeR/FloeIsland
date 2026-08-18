// 模块六：系统状态上岛。
//
// 接管 Main.osdWindowManager（音量/亮度/麦克风/静音 OSD）、
// SettingsDaemon.Rfkill（飞行模式）、ScreenshotUI（录屏指示/截图确认），
// 将反馈显示在胶囊上（dock.showOsdInfo）而非默认 OSD。

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function installOsdTakeover(ext, dock) {
    const settings = ext.getSettings();
    const om = Main.osdWindowManager;
    if (!om)
        return null;

    const origShow = om.show.bind(om);
    const origShowAll = om.showAll.bind(om);
    const origShowOne = om.showOne.bind(om);

    const route = ({icon, label, level, maxLevel}) => {
        dock.showOsdInfo({icon, label, level, maxLevel});
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
            dock.showOsdInfo({
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
            dock.showOsdInfo({
                icon: 'media-record-symbolic',
                label: recording ? '正在录制屏幕' : '录制结束',
                duration: recording ? 2200 : 1500,
            });
        });
        takenSigId = ui.connect('screenshot-taken', () => {
            if (!settings.get_boolean('takeover-screenshot'))
                return;
            dock.showOsdInfo({
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

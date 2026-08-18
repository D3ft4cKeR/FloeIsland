// 消息模块：最近通知列表。
// 数据来自 Main.messageTray（与系统通知中心同源）；
// 支持点击激活应用、右上角一键清屏（清屏动画：逐条上飘 + 模糊消失）。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MAX_NOTIF_LIST} from './constants.js';
import {formatNoticeTime, fadeOutUp} from './utils.js';

export function createMessagesModule({dock, ext}) {
    const theme = dock.theme;

    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    // --- 标题行 + 一键清屏 ---
    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({
        text: '消息',
        style_class: 'floedock-module-title',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    header.add_child(title);

    const clearBtn = new St.Widget({
        style_class: 'floedock-icon-button',
        reactive: true,
        can_focus: true,
        accessible_name: '一键清屏',
        width: 26,
        height: 26,
        // BinLayout：图标居中
        layout_manager: new Clutter.BinLayout(),
    });
    const trashIcon = new St.Icon({
        icon_name: 'user-trash-symbolic',
        icon_size: 14,
        style_class: 'floedock-icon-button-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    clearBtn.add_child(trashIcon);
    header.add_child(clearBtn);
    root.add_child(header);

    // --- 列表 ---
    const scroll = new St.ScrollView({
        style_class: 'floedock-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
    });
    const listBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
    });
    const viewport = new St.Viewport();
    viewport.add_child(listBox);
    scroll.add_child(viewport);
    root.add_child(scroll);

    const emptyLabel = new St.Label({
        text: '暂无通知',
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    root.add_child(emptyLabel);

    // --- 数据 ---
    const rows = new Map(); // notification -> row widget
    let signals = [];
    let clearAnimId = 0;
    let destroyed = false;

    const connectSignals = () => {
        if (destroyed)
            return;
        disconnectSignals();
        const tray = Main.messageTray;
        if (!tray)
            return;
        const onSourceAdded = (t, source) => {
            const onAdded = (s, n) => addRow(n);
            const onRemoved = (s, n) => removeRow(n);
            source.connect('notification-added', onAdded);
            source.connect('notification-removed', onRemoved);
            signals.push(() => {
                try {
                    source.disconnect(onAdded);
                    source.disconnect(onRemoved);
                } catch (e) {
                    // source already destroyed
                }
            });
            for (const n of source.notifications ?? [])
                addRow(n);
        };
        const addedId = tray.connect('source-added', onSourceAdded);
        const removedId = tray.connect('source-removed', (t, source) => {
            for (const n of source.notifications ?? [])
                removeRow(n);
        });
        signals.push(() => tray.disconnect(addedId));
        signals.push(() => tray.disconnect(removedId));
        for (const source of tray.getSources())
            onSourceAdded(tray, source);
    };

    const disconnectSignals = () => {
        for (const fn of signals)
            fn();
        signals = [];
    };

    const addRow = notification => {
        if (destroyed)
            return; // 模块已销毁，通知回调防御
        if (rows.has(notification) || rows.size >= MAX_NOTIF_LIST)
            return;
        const row = buildRow(notification);
        rows.set(notification, row);
        listBox.insert_child_at_index(row, 0);
        fadeInRow(row);
        emptyLabel.visible = false;
    };

    const removeRow = notification => {
        const row = rows.get(notification);
        if (!row)
            return;
        rows.delete(notification);
        row.destroy();
        emptyLabel.visible = rows.size === 0;
    };

    const clearAll = () => {
        if (clearAnimId) {
            GLib.source_remove(clearAnimId);
            clearAnimId = 0;
        }
        const all = [...rows.keys()];
        let i = 0;
        const step = () => {
            const n = all[i++];
            if (!n) {
                emptyLabel.visible = rows.size === 0;
                return false;
            }
            const row = rows.get(n);
            if (row) {
                rows.delete(n);
                fadeOutUp(row, {
                    duration: 220,
                    toY: -10,
                    onComplete: () => row.destroy(),
                });
                try {
                    n.destroy(); // 从系统通知中心移除
                } catch (e) {
                    // ignore
                }
            }
            return i < all.length;
        };
        clearAnimId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 45, step);
        emptyLabel.visible = false;
    };
    clearBtn.connect('button-press-event', () => {
        clearAll();
        return Clutter.EVENT_STOP;
    });

    const buildRow = notification => {
        const row = new St.BoxLayout({
            style_class: 'floedock-notif-row',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });

        const icon = new St.Icon({
            icon_size: 28,
            style_class: 'floedock-notif-icon',
            y_align: Clutter.ActorAlign.START,
        });
        const srcIcon = notification.source?.icon;
        if (srcIcon)
            icon.gicon = srcIcon;
        else
            icon.icon_name = 'dialog-information-symbolic';
        row.add_child(icon);

        const vbox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });

        const top = new St.BoxLayout({x_expand: true});
        const appLabel = new St.Label({
            text: notification.source?.title ?? '通知',
            style_class: 'floedock-notif-app',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        top.add_child(appLabel);
        const timeLabel = new St.Label({
            text: formatNoticeTime(notification.datetime),
            style_class: 'floedock-notif-time',
            y_align: Clutter.ActorAlign.START,
        });
        top.add_child(timeLabel);
        vbox.add_child(top);

        if (notification.title) {
            const t = new St.Label({
                text: notification.title,
                style_class: 'floedock-notif-title',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            vbox.add_child(t);
        }
        if (notification.body) {
            const b = new St.Label({
                text: notification.body,
                style_class: 'floedock-notif-body',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            b.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            vbox.add_child(b);
        }

        row.add_child(vbox);
        row.connect('button-press-event', () => {
            try {
                notification.activate();
            } catch (e) {
                logError(e, '[floedock] activate notification');
            }
            return Clutter.EVENT_STOP;
        });
        return row;
    };

    const fadeInRow = row => {
        row.opacity = 0;
        row.translation_y = 6;
        row.ease({
            opacity: 255,
            translation_y: 0,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    };

    return {
        widget: root,
        title: '消息',
        icon: 'preferences-system-notifications-symbolic',

        activate() {
            connectSignals();
            emptyLabel.visible = rows.size === 0;
        },

        deactivate() {
            disconnectSignals();
            if (clearAnimId) {
                GLib.source_remove(clearAnimId);
                clearAnimId = 0;
            }
        },

        destroy() {
            destroyed = true;
            disconnectSignals();
            if (clearAnimId) {
                GLib.source_remove(clearAnimId);
                clearAnimId = 0;
            }
            rows.clear();
            listBox.destroy_all_children();
        },
    };
}

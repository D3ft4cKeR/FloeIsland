// 消息模块：最近通知列表。
// 数据来自 Main.messageTray（与系统通知中心同源）；
// 每行消息卡片右侧内联垃圾桶图标，支持滚动和一键清屏。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MAX_NOTIF_LIST} from './constants.js';
import {formatNoticeTime, fadeOutUp} from './utils.js';

export function createMessagesModule({dock, ext}) {
    // --- 顶部整体容器（垂直：可滚动列表 + 底部清空栏） ---
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        spacing: 6,
    });

    // 左侧：消息列表（可滚动）
    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });
    root.add_child(leftCol);

    // --- 可滚动消息列表 ---
    // 垂直 BoxLayout 做视口：clip_to_allocation 裁剪，content 自然高度不展开
    const scroll = new St.BoxLayout({
        style_class: 'floedock-scroll',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        reactive: true,
    });
    const listBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: false,
        style: 'spacing: 2px;',
    });
    scroll.add_child(listBox);
    root.add_child(scroll);

    // 空状态提示（scroll 和 clearBar 之间，居中显示）
    const emptyLabel = new St.Label({
        text: '暂无通知',
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    root.add_child(emptyLabel);

    // 手动滚轮滚动
    let scrollY = 0;
    const clampScroll = () => {
        const contentH = listBox.get_height();
        const viewH = scroll.get_height();
        const max = Math.max(0, contentH - viewH);
        scrollY = Math.max(0, Math.min(scrollY, max));
        listBox.translation_y = -scrollY;
    };
    scroll.connect('scroll-event', (_s, event) => {
        const [, cross] = event.get_scroll_delta();
        if (cross === 0)
            return Clutter.EVENT_PROPAGATE;
        scrollY += cross * 40;
        clampScroll();
        return Clutter.EVENT_STOP;
    });
    // 内容或视口变化时重新 clamp
    listBox.connect('notify::height', clampScroll);
    scroll.connect('notify::height', clampScroll);

    // listBox 宽度同步
    const syncListWidth = () => {
        const w = scroll.get_width();
        if (w > 0 && listBox.width !== w)
            listBox.width = w;
    };
    syncListWidth();
    scroll.connect('notify::allocation', syncListWidth);

    // --- 底部一键清空栏 ---
    const clearBar = new St.BoxLayout({
        style_class: 'floedock-msg-clear-col',
        x_expand: true,
        y_expand: false,
        x_align: Clutter.ActorAlign.END,
        style: 'spacing: 4px;',
        reactive: true,
    });
    const clearBtn = new St.Widget({
        style_class: 'floedock-icon-button floedock-msg-clear-btn',
        reactive: true,
        can_focus: true,
        accessible_name: '一键清空',
        width: 28,
        height: 28,
        x_expand: false,
        y_expand: false,
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
    clearBar.add_child(clearBtn);
    root.add_child(clearBar);

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
        // 新消息到来后重新校准滚动位置
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { clampScroll(); return false; });
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
        // 外层行容器：横向排列（卡片 + 垃圾桶），卡片占满剩余空间
        const row = new St.BoxLayout({
            style_class: 'floedock-notif-row',
            reactive: true,
            track_hover: true,
            x_expand: true,
            style: 'spacing: 4px;',
        });

        // --- 左侧：消息卡片内容（点击激活应用） ---
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.START,
            reactive: true,
        });
        card.connect('button-press-event', () => {
            try {
                notification.activate();
            } catch (e) {
                logError(e, '[floedock] activate notification');
            }
            return Clutter.EVENT_STOP;
        });

        const topBar = new St.BoxLayout({x_expand: true, style: 'spacing: 8px;'});
        const icon = new St.Icon({
            icon_size: 20,
            style_class: 'floedock-notif-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const srcIcon = notification.source?.icon;
        if (srcIcon)
            icon.gicon = srcIcon;
        else
            icon.icon_name = 'dialog-information-symbolic';
        topBar.add_child(icon);

        const textCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const appLabel = new St.Label({
            text: notification.source?.title ?? '通知',
            style_class: 'floedock-notif-app',
            x_align: Clutter.ActorAlign.START,
        });
        textCol.add_child(appLabel);
        if (notification.title) {
            const t = new St.Label({
                text: notification.title,
                style_class: 'floedock-notif-title',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            textCol.add_child(t);
        }
        if (notification.body) {
            const b = new St.Label({
                text: notification.body,
                style_class: 'floedock-notif-body',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            b.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textCol.add_child(b);
        }
        topBar.add_child(textCol);

        const timeLabel = new St.Label({
            text: formatNoticeTime(notification.datetime),
            style_class: 'floedock-notif-time',
            y_align: Clutter.ActorAlign.START,
        });
        topBar.add_child(timeLabel);

        card.add_child(topBar);
        row.add_child(card);

        // --- 右侧：单条删除垃圾桶图标 ---
        const delBtn = new St.Widget({
            style_class: 'floedock-icon-button',
            reactive: true,
            can_focus: true,
            accessible_name: '删除通知',
            width: 28,
            height: 28,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        const delIcon = new St.Icon({
            icon_name: 'edit-delete-symbolic',
            icon_size: 12,
            style_class: 'floedock-icon-button-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        delBtn.add_child(delIcon);
        delBtn.connect('button-press-event', () => {
            removeRow(notification);
            try {
                notification.destroy();
            } catch (e) {
                // already removed
            }
            return Clutter.EVENT_STOP;
        });
        row.add_child(delBtn);

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

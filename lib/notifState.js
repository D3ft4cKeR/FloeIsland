// 模块四：通知展示态。
// 新通知到达 → 岛屿切换为通知展示态：
//   - 卡片向右后方堆叠（偏移 12px，旋转 2°，透明度递减，深度可设置）
//   - 每条展示 notif-duration 秒后自动切换（模糊/上滑/缩放 三种消失动画）
//   - 点击卡片激活对应应用；队列清空后返回 Dock 态
// 同时导出 NotificationWatcher：监听系统通知到达，驱动岛屿状态切换。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {NOTIF_HEIGHT, State} from './constants.js';
import {formatTime, clearTimeoutId} from './utils.js';

// ---------------------------------------------------------------------------
export class NotificationWatcher {
    constructor(ext, dock) {
        this._dock = dock;
        this._signals = [];
        const tray = Main.messageTray;
        if (!tray)
            return;

        const onSourceAdded = (t, source) => {
            const onAdded = (s, n) => this._onNotification(n);
            source.connect('notification-added', onAdded);
            this._signals.push(() => {
                try {
                    source.disconnect(onAdded);
                } catch (e) {
                    // source destroyed
                }
            });
        };

        this._addedId = tray.connect('source-added', onSourceAdded);
        this._signals.push(() => tray.disconnect(this._addedId));
        for (const source of tray.getSources())
            onSourceAdded(tray, source);
    }

    _onNotification(notification) {
        const st = this._dock.currentState;
        // 仅 Dock / 通知态下接管；面板、工具栏打开时忽略（通知仍会进入消息列表）
        if (st === State.DOCK || st === State.NOTIFICATION)
            this._dock.setState(State.NOTIFICATION, {notification});
    }

    destroy() {
        for (const fn of this._signals)
            fn();
        this._signals = [];
    }
}

// ---------------------------------------------------------------------------
export function createNotifSurface(dock, ext) {
    const settings = ext.getSettings();
    const theme = dock.theme;

    const root = new St.Widget({
        style_class: 'floedock-notif',
        reactive: true,
        track_hover: true,
        clip_to_allocation: false,
    });

    const queue = []; // notifications, front = index 0
    let advanceId = 0;
    let timeId = 0;
    let hoverPaused = false;
    let animating = false;

    const depth = () => settings.get_int('notif-stack-depth');
    const duration = () => settings.get_int('notif-duration') * 1000;
    const style = () => settings.get_string('notif-anim-style');

    const stackHolder = new St.Widget({clip_to_allocation: false});
    root.add_child(stackHolder);

    const timeLabel = new St.Label({
        style_class: 'floedock-notif-time',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
    });
    root.add_child(timeLabel);

    // --- 工具 ---
    const fmt = () => formatTime(new Date());

    function updateTime() {
        timeLabel.text = fmt();
    }

    function startTimeTimer() {
        stopTimeTimer();
        timeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => {
            updateTime();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(timeId, '[floedock] notif time');
    }

    function stopTimeTimer() {
        timeId = clearTimeoutId(timeId);
    }

    function enqueue(notification) {
        if (queue.includes(notification))
            return;
        queue.push(notification);
        // 队列最多保留堆叠深度 + 4 条缓冲
        while (queue.length > depth() + 4)
            queue.shift();
    }

    function buildCard(notification, backIndex) {
        const card = new St.BoxLayout({
            style_class: 'floedock-notif-card',
            x_expand: true,
            reactive: backIndex === 0,
            track_hover: backIndex === 0,
        });
        // 与岛/面板统一深色（近黑、无渐变），圆角卡片
        card.set_style(`
            background-color: rgba(12,13,16,${theme.baseAlpha});
            border: 1px solid rgba(255,255,255,${theme.borderAlpha});
            border-radius: ${Math.max(12, Math.round(theme.radius * 0.7))}px;
            padding: 8px 12px;
            margin: 2px 4px;
        `);

        const icon = new St.Icon({
            icon_size: 26,
            style_class: 'floedock-notif-card-icon',
            y_align: Clutter.ActorAlign.START,
        });
        const srcIcon = notification.source?.icon;
        if (srcIcon)
            icon.gicon = srcIcon;
        else
            icon.icon_name = 'dialog-information-symbolic';
        card.add_child(icon);

        const vbox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        const appRow = new St.BoxLayout({x_expand: true});
        const appLabel = new St.Label({
            text: notification.source?.title ?? '通知',
            style_class: 'floedock-notif-card-app',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        appRow.add_child(appLabel);
        vbox.add_child(appRow);

        if (notification.title) {
            const t = new St.Label({
                text: notification.title,
                style_class: 'floedock-notif-card-title',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            vbox.add_child(t);
        }
        if (notification.body) {
            const b = new St.Label({
                text: notification.body,
                style_class: 'floedock-notif-card-body',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            b.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            vbox.add_child(b);
        }
        card.add_child(vbox);

        if (backIndex === 0) {
            // 前卡：点击激活应用
            card.connect('button-press-event', () => {
                const n = queue[0];
                if (!n)
                    return Clutter.EVENT_STOP;
                queue.shift();
                try {
                    n.activate();
                } catch (e) {
                    logError(e, '[floedock] activate notification');
                }
                render();
                if (queue.length === 0)
                    dock.setState(State.DOCK);
                else
                    startAdvance();
                return Clutter.EVENT_STOP;
            });
        } else {
            // 后方堆叠卡：偏移 + 旋转 + 透明度递减
            card.opacity = Math.max(40, 255 - backIndex * 70);
            card.rotation_angle_z = backIndex * 2;
            card.translation_x = backIndex * 12;
            card.scale_x = 1 - backIndex * 0.04;
            card.scale_y = 1 - backIndex * 0.04;
        }
        return card;
    }

    function measureWidth() {
        // 固定宽度：与里界面消息卡片一致（不随通知文字长短变化）
        const maxW = Math.min(440, Main.layoutManager.primaryMonitor.width - 96);
        return Math.max(320, maxW);
    }

    function render() {
        stackHolder.destroy_all_children();
        const shown = queue.slice(0, depth());
        // 先加后卡，再加前卡（z 序）
        for (let i = shown.length - 1; i >= 0; i--)
            stackHolder.add_child(buildCard(shown[i], i));
    }

    function startAdvance() {
        stopAdvance();
        advanceId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, duration(), () => {
            advanceId = 0;
            if (hoverPaused) {
                startAdvance();
                return;
            }
            advance();
        });
        GLib.Source.set_name_by_id(advanceId, '[floedock] notif advance');
    }

    function stopAdvance() {
        advanceId = clearTimeoutId(advanceId);
    }

    function advance() {
        if (animating)
            return;
        if (queue.length === 0) {
            dock.setState(State.DOCK);
            return;
        }
        // 前卡淡出
        animating = true;
        const oldFront = stackHolder.get_children().at(-1);
        if (oldFront) {
            oldFront.ease({
                opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    animating = false;
                    queue.shift();
                    render();
                    // 新前卡淡入
                    const newFront = stackHolder.get_children().at(-1);
                    if (newFront) {
                        newFront.opacity = 0;
                        newFront.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                    }
                    if (queue.length === 0)
                        dock.setState(State.DOCK);
                    else
                        startAdvance();
                },
            });
        } else {
            animating = false;
            queue.shift();
            render();
            if (queue.length === 0)
                dock.setState(State.DOCK);
            else
                startAdvance();
        }
    }

    // hover 暂停轮播
    root.connect('notify::hover', () => {
        hoverPaused = root.hover;
        if (!hoverPaused && queue.length > 0 && !advanceId)
            startAdvance();
    });

    return {
        widget: root,

        getSize() {
            return {width: measureWidth(), height: NOTIF_HEIGHT};
        },

        onEnter(params = {}) {
            if (params.notification)
                enqueue(params.notification);
            updateTime();
            startTimeTimer();
            render();
            // 前卡弹性进入
            const front = stackHolder.get_children().at(-1);
            if (front) {
                front.opacity = 0;
                front.scale_x = 0.9;
                front.scale_y = 0.9;
                front.ease({
                    opacity: 255,
                    scale_x: 1,
                    scale_y: 1,
                    translation_x: 0,
                    rotation_angle_z: 0,
                    duration: 420,
                    mode: Clutter.AnimationMode.EASE_OUT_BACK,
                });
            }
            startAdvance();
            dock.setFloatOffsetX(8, {duration: 400});
            // 展开动画（先下沉突破、再横拉）由 dock._expandNotification 完成，
            // 此处不再 resize（避免二次动画覆盖/打断展开节奏）
        },

        refresh(params = {}) {
            if (params.notification)
                enqueue(params.notification);
            render();
            startAdvance();
        },

        onLeave(animate, nextState) {
            stopAdvance();
            stopTimeTimer();
            animating = false;
            dock.setFloatOffsetX(0, {duration: 300});
            // 卡片快速淡出
            for (const card of stackHolder.get_children())
                card.ease({opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_IN_CUBIC});
        },

        destroy() {
            stopAdvance();
            stopTimeTimer();
            queue.length = 0;
            stackHolder.destroy_all_children();
        },
    };
}

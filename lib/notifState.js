// 模块四：通知展示态（胶囊形变版，对齐 preview/notif-demo.html）。
// 新通知到达 → 岛体整体下移突破顶栏，同时胶囊本身 变宽+变高+圆角 999→12
// 成为通知卡片；通知内容渲染在胶囊内部（左图标+应用名，右标题+正文+右上时间），
// 时钟文字淡出；下方堆叠指示点。显示 notif-duration 秒后切换/收起，反向形变归位。
// 同时导出 NotificationWatcher：监听系统通知到达并屏蔽系统横幅，驱动岛屿切换。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
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
        this._pendingNotify = null;
        const tray = Main.messageTray;
        if (!tray)
            return;

        // 监听通知到达（覆盖经由 messageTray 的所有系统原生通知）
        const onSourceAdded = (t, source) => {
            const onAdded = (s, n) => this._onNotification(n);
            source.connect('notification-added', onAdded);
            this._signals.push(() => {
                try {
                    source.disconnect(onAdded);
                } catch (e) {}
            });
        };

        this._addedId = tray.connect('source-added', onSourceAdded);
        this._signals.push(() => tray.disconnect(this._addedId));
        for (const source of tray.getSources())
            onSourceAdded(tray, source);

        // 系统横幅屏蔽由 extension.js 的 _applyBannerSuppression 统一处理
        // （官方 bannerBlocked 属性，受 suppress-banners 设置控制）。

        // 勿扰模式：读取系统通知设置（show-banners=false = 勿扰）
        this._dnd = new Gio.Settings({schema: 'org.gnome.desktop.notifications'});
        this._dndEnabled = () => {
            try {
                return !this._dnd.get_boolean('show-banners');
            } catch (e) {
                return false;
            }
        };

        // 回到 Dock 态后展示此前（面板/工具栏打开时）缓存的待播通知
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            if (this._pendingNotify && !this._dndEnabled() &&
                (dock.currentState === State.DOCK || dock.currentState === State.NOTIFICATION)) {
                const n = this._pendingNotify;
                this._pendingNotify = null;
                dock.setState(State.NOTIFICATION, {notification: n});
            }
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._pollId, '[floeisland] notif pending poll');
    }

    _onNotification(notification) {
        const dnd = this._dndEnabled();
        log(`[floeisland] notif received: dnd=${dnd} state=${this._dock.currentState} title="${notification.title}"`);
        // 勿扰时完全忽略通知，不上岛也不缓存
        if (dnd)
            return;
        const st = this._dock.currentState;
        // 任意状态都让通知进入展示；面板/工具栏打开时缓存，回到 Dock 后展示
        if (st === State.DOCK || st === State.NOTIFICATION) {
            log(`[floeisland] notif → setState NOTIFICATION`);
            this._dock.setState(State.NOTIFICATION, {notification});
        } else {
            this._pendingNotify = notification;
        }
    }

    destroy() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        try {
            this._dnd?.run_dispose?.();
        } catch (e) {
            // ignore
        }
        this._dnd = null;
        for (const fn of this._signals)
            fn();
        this._signals = [];
    }
}

// ---------------------------------------------------------------------------
export function createNotifSurface(dock, ext) {
    const settings = ext.getSettings();

    const queue = []; // notifications, front = index 0
    let advanceId = 0;
    let hoverPaused = false;

    const duration = () => {
        let s = 2000;
        try {
            const d = settings.get_int('notif-duration');
            s = (d > 0 ? d : 2) * 1000; // 兜底：读不到/为 0 时用默认 2 秒
        } catch (e) {
            s = 2000;
        }
        return s;
    };

    // --- 通知内容：填满胶囊（随胶囊一起形变，自身无背景） ---
    const notifBox = new St.BoxLayout({
        style_class: 'floedock-notif-body',
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        x_expand: true,
        y_expand: true,
        reactive: true,
        track_hover: true,
        clip_to_allocation: true,
    });

    // 左侧：图标 + 应用名
    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: false,
    });
    const icon = new St.Icon({
        icon_size: 26,
        style_class: 'floedock-notif-card-icon',
        x_align: Clutter.ActorAlign.CENTER,
    });
    leftCol.add_child(icon);
    const appLabel = new St.Label({
        style_class: 'floedock-notif-card-app',
        x_align: Clutter.ActorAlign.CENTER,
    });
    leftCol.add_child(appLabel);
    notifBox.add_child(leftCol);

    // 右侧：标题 + 正文（右上角时间）
    const rightCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    const topRow = new St.BoxLayout({x_expand: true});
    const titleLabel = new St.Label({
        style_class: 'floedock-notif-card-title',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    topRow.add_child(titleLabel);
    const timeLabel = new St.Label({
        style_class: 'floedock-notif-time',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
    });
    topRow.add_child(timeLabel);
    // 右上角关闭叉：点击关闭这条通知
    const closeBtn = new St.Widget({
        style_class: 'floedock-notif-close',
        reactive: true,
        track_hover: true,
        can_focus: false,
        width: 20,
        height: 20,
        y_align: Clutter.ActorAlign.START,
        layout_manager: new Clutter.BinLayout(),
    });
    const closeIcon = new St.Icon({
        icon_name: 'window-close-symbolic',
        icon_size: 12,
        style_class: 'floedock-notif-close-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    closeBtn.add_child(closeIcon);
    closeBtn.connect('button-press-event', () => {
        dismissCurrent();
        return Clutter.EVENT_STOP;
    });
    topRow.add_child(closeBtn);
    rightCol.add_child(topRow);

    const bodyLabel = new St.Label({
        style_class: 'floedock-notif-card-body',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    rightCol.add_child(bodyLabel);
    notifBox.add_child(rightCol);

    // 点击内容：激活对应应用（同时胶囊点击会收起，见 dock.onCapsuleClick）
    notifBox.connect('button-press-event', () => {
        const n = queue[0];
        if (!n)
            return Clutter.EVENT_STOP;
        try {
            n.activate();
        } catch (e) {
            logError(e, '[floeisland] activate notification');
        }
        return Clutter.EVENT_STOP;
    });

    // --- 堆叠指示点（dock 负责定位到胶囊下方） ---
    const dots = new St.BoxLayout({
        style_class: 'floedock-notif-dots',
        x_expand: false,
        y_expand: false,
    });
    for (let i = 0; i < 3; i++)
        dots.add_child(new St.Widget({style_class: 'floedock-notif-dot'}));

    // --- 工具 ---

    function enqueue(notification) {
        if (queue.includes(notification))
            return;
        queue.push(notification);
        // 队列最多保留 3 + 4 条缓冲
        while (queue.length > 7)
            queue.shift();
    }

    function updateDots() {
        const remaining = Math.max(0, queue.length - 1);
        dots.visible = remaining > 0;
        const children = dots.get_children();
        for (let i = 0; i < children.length; i++) {
            children[i].visible = i < remaining;
            children[i].opacity = i === 0 ? 255 : 120;
        }
    }

    function render() {
        const n = queue[0];
        if (!n)
            return;
        const srcIcon = n.source?.icon;
        if (srcIcon)
            icon.gicon = srcIcon;
        else
            icon.icon_name = 'dialog-information-symbolic';
        appLabel.text = n.source?.title ?? '通知';
        titleLabel.text = n.title ?? '';
        titleLabel.visible = !!n.title;
        bodyLabel.text = n.body ?? '';
        bodyLabel.visible = !!n.body;
        timeLabel.text = formatTime(n.datetime);
        updateDots();
    }

    function measureWidth() {
        // 固定宽度：与演示一致（不随通知文字长短变化）
        const maxW = Math.min(420, Main.layoutManager.primaryMonitor.width - 96);
        return Math.max(320, maxW);
    }

    function startAdvance() {
        stopAdvance();
        const d = duration();
        log(`[floeisland] notif startAdvance dur=${d} queue=${queue.length}`);
        advanceId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, d, () => {
            advanceId = 0;
            if (hoverPaused) {
                startAdvance();
                return;
            }
            advance();
        });
        GLib.Source.set_name_by_id(advanceId, '[floeisland] notif advance');
    }

    function stopAdvance() {
        advanceId = clearTimeoutId(advanceId);
    }

    function advance() {
        log(`[floeisland] notif advance queue=${queue.length}`);
        if (queue.length <= 1) {
            // 仅剩当前一条（或空）→ 反向形变收起
            dock.setState(State.DOCK);
            return;
        }
        // 内容淡出 → 切换下一条 → 淡入
        notifBox.ease({
            opacity: 0,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                queue.shift();
                render();
                notifBox.ease({
                    opacity: 255,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                startAdvance();
            },
        });
    }

    // 悬停暂停轮播
    notifBox.connect('notify::hover', () => {
        hoverPaused = notifBox.hover;
        if (!hoverPaused && queue.length > 0 && !advanceId)
            startAdvance();
    });

    // 关闭当前这条通知（右上角叉）：从队列与系统通知中心移除，显示下一条或收岛
    function dismissCurrent() {
        const n = queue[0];
        if (!n)
            return;
        queue.shift();
        stopAdvance();
        try {
            n.destroy(); // 从系统通知中心移除
        } catch (e) {
            // ignore
        }
        if (queue.length === 0) {
            dock.setState(State.DOCK);
            return;
        }
        // 还有下一条：淡出当前内容 → 淡入下一条
        notifBox.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                render();
                notifBox.ease({
                    opacity: 255,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                startAdvance();
            },
        });
    }

    return {
        widget: notifBox,
        dots,

        getSize() {
            return {width: measureWidth(), height: NOTIF_HEIGHT};
        },

        // 形变前预渲染（内容随胶囊一起长大，dock 在动画前调用）
        preShow(params = {}) {
            if (params.notification)
                enqueue(params.notification);
            render();
        },

        onEnter(params = {}) {
            if (params.notification)
                enqueue(params.notification);
            render();
            startAdvance();
        },

        refresh(params = {}) {
            if (params.notification)
                enqueue(params.notification);
            render();
            startAdvance();
        },

        onLeave() {
            stopAdvance();
            hoverPaused = false;
        },

        destroy() {
            stopAdvance();
            queue.length = 0;
            dots.destroy_all_children();
        },
    };
}

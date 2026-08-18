// 模块七：锁屏扩展。
// 锁屏时岛屿扩展为全屏覆盖层：大号时间（毛玻璃卡片）+ 日期农历 + 通知列表（最多5条）+ 天气简况。
// 解锁后反向收起。覆盖层为独立顶层 actor（面板在锁屏时隐藏，岛屿随之隐藏）。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {fullInfo, festivalsOf} from './lunar.js';
import {fetchWeatherBrief} from './weatherModule.js';
import {fadeInUp, clearTimeoutId} from './utils.js';

const MAX_LOCK_NOTIFS = 5;

export class LockOverlay {
    constructor(ext, dock) {
        this._ext = ext;
        this._dock = dock;
        this._overlay = null;
        this._timeId = 0;
        this._sessionId = Main.sessionMode.connect('updated', () => this._sync());
        this._sync();
    }

    _isLocked() {
        return Main.sessionMode.currentMode === 'lock';
    }

    _sync() {
        if (this._isLocked())
            this._show();
        else
            this._hide();
    }

    _show() {
        if (this._overlay)
            return;
        const theme = this._dock.theme;

        const overlay = new St.Widget({
            style_class: 'floedock-lock',
            reactive: false,
            x_expand: true,
            y_expand: true,
        });
        overlay.set_style(`
            background-gradient-direction: vertical;
            background-gradient-start: rgba(10,14,22,0.78);
            background-gradient-end: rgba(4,6,10,0.88);
        `);
        const constraint = new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        });
        overlay.add_constraint(constraint);
        Main.uiGroup.add_child(overlay);
        Main.uiGroup.set_child_above_sibling(overlay, null);

        // --- 中央：大时钟毛玻璃卡片 ---
        const center = new St.BoxLayout({
            style_class: 'floedock-lock-center',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        overlay.add_child(center);

        const timeCard = new St.BoxLayout({
            style_class: 'floedock-lock-timecard',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        timeCard.set_style(`
            background-gradient-direction: vertical;
            background-gradient-start: rgba(26,33,46,${theme.topAlpha});
            background-gradient-end: rgba(9,12,19,${theme.baseAlpha});
            border: 1px solid rgba(255,255,255,${theme.borderAlpha});
            border-radius: 28px;
            box-shadow: 0 6px 24px rgba(0,0,0,0.50), 0 24px 80px rgba(0,0,0,0.40);
            padding: 28px 56px;
        `);
        center.add_child(timeCard);

        const bigTime = new St.Label({
            style_class: 'floedock-lock-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        timeCard.add_child(bigTime);

        const dateLine = new St.Label({
            style_class: 'floedock-lock-date',
            x_align: Clutter.ActorAlign.CENTER,
        });
        timeCard.add_child(dateLine);

        const lunarLine = new St.Label({
            style_class: 'floedock-lock-lunar',
            x_align: Clutter.ActorAlign.CENTER,
        });
        timeCard.add_child(lunarLine);

        // --- 天气简况 ---
        const weatherRow = new St.BoxLayout({
            style_class: 'floedock-lock-weather',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const weatherIcon = new St.Icon({
            icon_name: 'weather-clear-symbolic',
            icon_size: 20,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const weatherText = new St.Label({
            style_class: 'floedock-lock-weather-text',
            y_align: Clutter.ActorAlign.CENTER,
        });
        weatherRow.add_child(weatherIcon);
        weatherRow.add_child(weatherText);
        center.add_child(weatherRow);

        // --- 通知列表（最多 5 条） ---
        const notifBox = new St.BoxLayout({
            style_class: 'floedock-lock-notifs',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        overlay.add_child(notifBox);

        // 填充内容
        const updateClock = () => {
            const now = new Date();
            bigTime.text = new Intl.DateTimeFormat(undefined, {
                hour: '2-digit',
                minute: '2-digit',
            }).format(now);
            const info = fullInfo(now.getFullYear(), now.getMonth() + 1, now.getDate());
            const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
            dateLine.text = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${week}`;
            const fests = festivalsOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
            lunarLine.text = `${info.yearName} · ${info.monthName}${info.dayName}` +
                (fests.length > 0 ? ` · ${fests.join(' ')}` : '');
        };
        updateClock();
        this._timeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            updateClock();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._timeId, '[floedock] lock clock');

        // 通知
        const tray = Main.messageTray;
        const notifs = [];
        if (tray) {
            for (const source of tray.getSources()) {
                for (const n of source.notifications ?? []) {
                    if (notifs.length < MAX_LOCK_NOTIFS)
                        notifs.push(n);
                }
            }
        }
        for (const n of notifs) {
            const row = new St.BoxLayout({style_class: 'floedock-lock-notif'});
            const icon = new St.Icon({icon_size: 22, y_align: Clutter.ActorAlign.START});
            if (n.source?.icon)
                icon.gicon = n.source.icon;
            else
                icon.icon_name = 'dialog-information-symbolic';
            row.add_child(icon);
            const v = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
            const app = new St.Label({
                text: n.source?.title ?? '',
                style_class: 'floedock-lock-notif-app',
                x_align: Clutter.ActorAlign.START,
            });
            v.add_child(app);
            if (n.title) {
                const t = new St.Label({
                    text: n.title,
                    style_class: 'floedock-lock-notif-title',
                    x_align: Clutter.ActorAlign.START,
                });
                v.add_child(t);
            }
            if (n.body) {
                const b = new St.Label({
                    text: n.body,
                    style_class: 'floedock-lock-notif-body',
                    x_align: Clutter.ActorAlign.START,
                });
                v.add_child(b);
            }
            row.add_child(v);
            notifBox.add_child(row);
        }

        // 天气（异步，尽力而为）
        fetchWeatherBrief(this._ext.getSettings()).then(brief => {
            if (!this._overlay || !brief)
                return;
            weatherIcon.icon_name = brief.iconName;
            weatherText.text = `${brief.tempC ?? '--'}° ${brief.desc}`;
        });

        // 入场动画：整体淡入 + 内容依次上移
        overlay.opacity = 0;
        overlay.ease({opacity: 255, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        fadeInUp(timeCard, {duration: 380, delayMs: 120, fromY: 24});
        fadeInUp(weatherRow, {duration: 320, delayMs: 320, fromY: 16});
        fadeInUp(notifBox, {duration: 320, delayMs: 420, fromY: 16});

        this._overlay = overlay;
    }

    _hide() {
        if (!this._overlay)
            return;
        const overlay = this._overlay;
        this._overlay = null;
        this._timeId = clearTimeoutId(this._timeId);
        overlay.ease({
            opacity: 0,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => overlay.destroy(),
        });
    }

    destroy() {
        if (this._sessionId) {
            Main.sessionMode.disconnect(this._sessionId);
            this._sessionId = 0;
        }
        this._timeId = clearTimeoutId(this._timeId);
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
    }
}

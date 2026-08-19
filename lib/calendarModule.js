// 日历模块：只显示当天（日视图），节日/节气/农历信息在右侧。
// 农历/节气/节日数据来自 lib/lunar.js（纯 JS，已单测）。
// 布局：无标题栏，root = 横向 BoxLayout —— 左侧当天大信息 + 右侧节日列表，
// 卡片延伸到面板右侧。

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
    fullInfo,
    festivalsOf,
} from './lunar.js';

const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export function createCalendarModule({dock, ext}) {
    const theme = dock.theme;

    // root：横向（左信息 + 右节日），无标题栏
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        spacing: 12,
    });

    // --- 左侧：当天大信息 ---
    const leftCard = new St.BoxLayout({
        style_class: 'floedock-calendar-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
    });

    const dateLine = new St.Label({
        style_class: 'floedock-calendar-day-title',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    leftCard.add_child(dateLine);

    const dayNum = new St.Label({
        style_class: 'floedock-calendar-bignum',
        x_align: Clutter.ActorAlign.START,
    });
    leftCard.add_child(dayNum);

    const lunarLine = new St.Label({
        style_class: 'floedock-calendar-dayinfo-text',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    leftCard.add_child(lunarLine);

    const zodiacLine = new St.Label({
        style_class: 'floedock-calendar-dayinfo-text',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    leftCard.add_child(zodiacLine);

    root.add_child(leftCard);

    // --- 右侧：节日/节气列表 ---
    const festCard = new St.BoxLayout({
        style_class: 'floedock-calendar-card floedock-calendar-festcard',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        width: 150,
    });
    const festTitle = new St.Label({
        text: '节日 · 节气',
        style_class: 'floedock-calendar-dayinfo-title',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    festCard.add_child(festTitle);

    const festBody = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        spacing: 5,
    });
    festCard.add_child(festBody);
    root.add_child(festCard);

    // --- 渲染今天 ---
    function render() {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const d = now.getDate();
        const info = fullInfo(y, m, d);
        const fests = festivalsOf(y, m, d);
        const weekday = WEEK_NAMES[now.getDay()];

        dateLine.text = `${y}年${m}月${d}日 星期${weekday}`;
        dayNum.text = String(d);
        lunarLine.text = `农历 ${info.monthName}${info.dayName}`;
        zodiacLine.text = `${info.yearName} · 生肖${info.zodiac}`;

        // 右侧节日列表：节日/节气优先，其次当月节气
        festBody.destroy_all_children();
        const lines = [];
        if (fests.length > 0)
            lines.push(...fests);
        // 当月节气
        const terms = info.terms ?? [];
        for (const t of terms) {
            const tInfo = fullInfo(y, m, t.day);
            if (t.day !== d)
                lines.push(`${t.name}（${m}月${t.day}日）`);
        }
        if (lines.length === 0) {
            const lbl = new St.Label({
                text: '今日无节日',
                style_class: 'floedock-calendar-dayinfo-text',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            festBody.add_child(lbl);
        } else {
            for (const line of lines) {
                const lbl = new St.Label({
                    text: line,
                    style_class: 'floedock-calendar-dayinfo-fest',
                    x_align: Clutter.ActorAlign.START,
                    x_expand: true,
                });
                festBody.add_child(lbl);
            }
        }
    }

    return {
        widget: root,
        title: '日历',
        icon: 'calendar-today-symbolic',

        activate() {
            render();
        },

        deactivate() {
        },

        destroy() {
            leftCard.destroy_all_children();
            festBody.destroy_all_children();
        },
    };
}

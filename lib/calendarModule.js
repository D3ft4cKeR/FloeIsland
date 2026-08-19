// 日历模块：只显示当天（日视图）。
// 布局：三栏 —— 左年月日 + 中农历信息 + 右节日节气。

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
    fullInfo,
    festivalsOf,
} from './lunar.js';

const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export function createCalendarModule({dock, ext}) {
    const theme = dock.theme;

    // root：三栏横向，裁剪防止卡片溢出
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style: 'spacing: 8px;',
    });

    // --- 左栏：年月日 ---
    const leftCard = new St.BoxLayout({
        style_class: 'floedock-calendar-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const yearLine = new St.Label({
        style_class: 'floedock-calendar-day-title',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    leftCard.add_child(yearLine);

    const dayNum = new St.Label({
        style_class: 'floedock-calendar-bignum',
        x_align: Clutter.ActorAlign.START,
    });
    leftCard.add_child(dayNum);

    root.add_child(leftCard);

    // --- 中栏：农历信息 ---
    const midCard = new St.BoxLayout({
        style_class: 'floedock-calendar-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const lunarTitle = new St.Label({
        text: '农历',
        style_class: 'floedock-calendar-dayinfo-title',
        x_align: Clutter.ActorAlign.START,
    });
    midCard.add_child(lunarTitle);

    const lunarLine = new St.Label({
        style_class: 'floedock-calendar-detail-line1',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    midCard.add_child(lunarLine);

    const zodiacLine = new St.Label({
        style_class: 'floedock-calendar-detail-line2',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    midCard.add_child(zodiacLine);

    const weekdayLine = new St.Label({
        style_class: 'floedock-calendar-detail-line2',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    midCard.add_child(weekdayLine);

    root.add_child(midCard);

    // --- 右栏：节日节气 ---
    const rightCard = new St.BoxLayout({
        style_class: 'floedock-calendar-card floedock-calendar-festcard',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    const festTitle = new St.Label({
        text: '节日 · 节气',
        style_class: 'floedock-calendar-dayinfo-title',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    rightCard.add_child(festTitle);

    const festBody = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: 'spacing: 5px;',
    });
    rightCard.add_child(festBody);
    root.add_child(rightCard);

    // --- 渲染今天 ---
    function render() {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const d = now.getDate();
        const info = fullInfo(y, m, d);
        const fests = festivalsOf(y, m, d);
        const weekday = WEEK_NAMES[now.getDay()];

        // 左栏：年月日
        yearLine.text = `${y}年${m}月${d}日`;
        dayNum.text = String(d);

        // 中栏：农历
        lunarLine.text = `${info.monthName}${info.dayName}`;
        zodiacLine.text = `${info.yearName}年 · 生肖${info.zodiac}`;
        weekdayLine.text = `星期${weekday}`;

        // 右栏：节日节气
        festBody.destroy_all_children();
        const lines = [];
        if (fests.length > 0)
            lines.push(...fests);
        const terms = info.terms ?? [];
        for (const t of terms) {
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
            midCard.destroy_all_children();
            festBody.destroy_all_children();
        },
    };
}

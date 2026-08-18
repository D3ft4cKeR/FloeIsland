// 日历模块：月视图（新历 + 农历小字）+ 日/月/年切换 + 当日详情。
// 农历/节气/节日数据来自 lib/lunar.js（纯 JS，已单测）。

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
    fullInfo,
    festivalsOf,
    lunarYearName,
} from './lunar.js';
import {fadeInUp} from './utils.js';

const WEEK_HEADER = ['一', '二', '三', '四', '五', '六', '日'];

export function createCalendarModule({dock, ext}) {
    const theme = dock.theme;

    // 整体可滚动：内容超出内容区时滚动而非溢出
    const root = new St.ScrollView({
        style_class: 'floedock-module floedock-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
    });
    const vbox = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    const vp = new St.Viewport();
    vp.add_child(vbox);
    root.add_child(vp);

    // --- 头部：标题 + 日/月/年 segmented + 月份导航 ---
    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({text: '日历', style_class: 'floedock-module-title'});
    header.add_child(title);
    header.add_child(new St.Widget({x_expand: true}));

    const segBox = new St.BoxLayout({style_class: 'floedock-segmented'});
    const segButtons = {};
    for (const key of ['日', '月', '年']) {
        const btn = new St.Widget({
            style_class: 'floedock-seg-button',
            reactive: true,
            track_hover: true,
            accessible_name: `${key}视图`,
        });
        const lbl = new St.Label({
            text: key,
            style_class: 'floedock-seg-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.add_child(lbl);
        btn.connect('button-press-event', (actor, ev) => {
            switchView(key);
            return Clutter.EVENT_STOP;
        });
        segBox.add_child(btn);
        segButtons[key] = btn;
    }
    header.add_child(segBox);
    vbox.add_child(header);

    // --- 月份导航行 ---
    const navRow = new St.BoxLayout({style_class: 'floedock-calendar-nav'});
    const prevBtn = makeNavButton('pan-start-symbolic', '上个月');
    const monthLabel = new St.Label({
        style_class: 'floedock-calendar-month',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    const nextBtn = makeNavButton('pan-end-symbolic', '下个月');
    navRow.add_child(prevBtn);
    navRow.add_child(monthLabel);
    navRow.add_child(nextBtn);
    vbox.add_child(navRow);

    // --- 月视图 ---
    const monthView = new St.BoxLayout({
        style_class: 'floedock-calendar-monthview',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    vbox.add_child(monthView);

    // --- 年视图 ---
    const yearView = new St.BoxLayout({
        style_class: 'floedock-calendar-yearview',
        x_expand: true,
        y_expand: true,
    });
    yearView.hide();
    vbox.add_child(yearView);

    // --- 日详情 ---
    const detailBox = new St.BoxLayout({
        style_class: 'floedock-calendar-detail',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    detailBox.hide();
    vbox.add_child(detailBox);

    function makeNavButton(iconName, label) {
        const btn = new St.Widget({
            style_class: 'floedock-icon-button',
            reactive: true,
            track_hover: true,
            accessible_name: label,
            width: 26,
            height: 26,
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: 14,
            style_class: 'floedock-icon-button-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.add_child(icon);
        return btn;
    }

    // --- 状态 ---
    let viewYear = new Date().getFullYear();
    let viewMonth = new Date().getMonth() + 1;
    let currentView = '月';
    let selected = null; // {year, month, day} | null

    const today = new Date();

    function switchView(key) {
        currentView = key;
        for (const k of Object.keys(segButtons))
            segButtons[k].remove_style_pseudo_class('checked');
        segButtons[key].add_style_pseudo_class('checked');
        monthView.visible = key === '月';
        yearView.visible = key === '年';
        detailBox.visible = key === '日' && !!selected;
        if (key === '月') {
            renderMonth();
        } else if (key === '年') {
            renderYear();
        } else {
            if (!selected)
                selected = {year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate()};
            renderDetail(selected);
        }
    }

    function renderMonth() {
        monthView.destroy_all_children();
        monthLabel.text = `${viewYear}年 ${viewMonth}月`;

        // 星期表头
        const weekRow = new St.BoxLayout({style_class: 'floedock-calendar-week'});
        for (const w of WEEK_HEADER) {
            const lbl = new St.Label({
                text: w,
                style_class: 'floedock-calendar-weekday',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            weekRow.add_child(lbl);
        }
        monthView.add_child(weekRow);

        const firstDay = new Date(viewYear, viewMonth - 1, 1);
        const offset = (firstDay.getDay() + 6) % 7; // 周一开头
        const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
        const cells = offset + daysInMonth;
        const rows = Math.ceil(cells / 7);

        const selectedKey = selected ? `${selected.year}-${selected.month}-${selected.day}` : null;
        const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

        for (let r = 0; r < rows; r++) {
            const row = new St.BoxLayout({style_class: 'floedock-calendar-row', x_expand: true});
            for (let c = 0; c < 7; c++) {
                const idx = r * 7 + c;
                const day = idx - offset + 1;
                if (day < 1 || day > daysInMonth) {
                    row.add_child(new St.Widget({x_expand: true, height: 44}));
                    continue;
                }
                const key = `${viewYear}-${viewMonth}-${day}`;
                const info = fullInfo(viewYear, viewMonth, day);
                const fests = festivalsOf(viewYear, viewMonth, day);

                const cell = new St.BoxLayout({
                    style_class: 'floedock-calendar-cell',
                    orientation: Clutter.Orientation.VERTICAL,
                    reactive: true,
                    track_hover: true,
                    x_expand: true,
                    height: 44,
                });
                if (key === todayKey)
                    cell.add_style_pseudo_class('today');
                if (key === selectedKey)
                    cell.add_style_pseudo_class('selected');

                const dayLabel = new St.Label({
                    text: String(day),
                    style_class: 'floedock-calendar-day',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                cell.add_child(dayLabel);

                // 小字：节气/节日优先，其次农历日名
                let small = '';
                if (fests.length > 0)
                    small = fests[0];
                else
                    small = info.dayName;
                const lunarLabel = new St.Label({
                    text: small,
                    style_class: 'floedock-calendar-lunar',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                if (fests.length > 0)
                    lunarLabel.add_style_pseudo_class('fest');
                cell.add_child(lunarLabel);

                cell.connect('button-press-event', (actor, ev) => {
                    selected = {year: viewYear, month: viewMonth, day};
                    renderMonth();
                    renderDetail(selected);
                    return Clutter.EVENT_STOP;
                });
                row.add_child(cell);
            }
            monthView.add_child(row);
        }
    }

    function renderYear() {
        yearView.destroy_all_children();
        const yearLabel = new St.Label({
            text: `${viewYear}年  ${lunarYearName(viewYear).withZodiac}`,
            style_class: 'floedock-calendar-year-title',
            x_align: Clutter.ActorAlign.CENTER,
        });
        yearView.add_child(yearLabel);

        for (let m = 1; m <= 12; m += 3) {
            const row = new St.BoxLayout({x_expand: true});
            for (let k = 0; k < 3 && m + k <= 12; k++) {
                const mm = m + k;
                const mini = new St.BoxLayout({
                    style_class: 'floedock-calendar-mini-month',
                    orientation: Clutter.Orientation.VERTICAL,
                    reactive: true,
                    track_hover: true,
                    x_expand: true,
                    y_expand: true,
                });
                const lbl = new St.Label({
                    text: `${mm}月`,
                    style_class: 'floedock-calendar-mini-title',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                mini.add_child(lbl);

                // 迷你月格：当月节气/初一所在日
                const firstInfo = fullInfo(viewYear, mm, 1);
                const sub = new St.Label({
                    text: `${firstInfo.dayName}`,
                    style_class: 'floedock-calendar-mini-sub',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                mini.add_child(sub);

                mini.connect('button-press-event', (actor, ev) => {
                    viewMonth = mm;
                    switchView('月');
                    return Clutter.EVENT_STOP;
                });
                row.add_child(mini);
            }
            yearView.add_child(row);
        }
    }

    function renderDetail(date) {
        detailBox.destroy_all_children();
        detailBox.show();
        const {year, month, day} = date;
        const info = fullInfo(year, month, day);
        const fests = festivalsOf(year, month, day);
        const weekday = new Date(year, month - 1, day).getDay();
        const weekNames = ['日', '一', '二', '三', '四', '五', '六'];

        const line1 = new St.Label({
            text: `${year}年${month}月${day}日 星期${weekNames[weekday]}`,
            style_class: 'floedock-calendar-detail-line1',
            x_align: Clutter.ActorAlign.START,
        });
        detailBox.add_child(line1);

        const lunarLine = `${info.yearName} · ${info.monthName}${info.dayName} · 生肖${info.zodiac}`;
        const line2 = new St.Label({
            text: lunarLine,
            style_class: 'floedock-calendar-detail-line2',
            x_align: Clutter.ActorAlign.START,
        });
        detailBox.add_child(line2);

        if (fests.length > 0) {
            const line3 = new St.Label({
                text: fests.join(' · '),
                style_class: 'floedock-calendar-detail-fest',
                x_align: Clutter.ActorAlign.START,
            });
            detailBox.add_child(line3);
        }
        fadeInUp(detailBox, {duration: 240, fromY: 6});
    }

    function shiftMonth(delta) {
        viewMonth += delta;
        if (viewMonth < 1) {
            viewMonth = 12;
            viewYear--;
        } else if (viewMonth > 12) {
            viewMonth = 1;
            viewYear++;
        }
        renderMonth();
    }

    prevBtn.connect('button-press-event', () => {
        shiftMonth(-1);
        return Clutter.EVENT_STOP;
    });
    nextBtn.connect('button-press-event', () => {
        shiftMonth(1);
        return Clutter.EVENT_STOP;
    });

    return {
        widget: root,
        title: '日历',
        icon: 'calendar-today-symbolic',

        activate() {
            viewYear = today.getFullYear();
            viewMonth = today.getMonth() + 1;
            selected = null;
            switchView('月');
        },

        deactivate() {
        },

        destroy() {
            monthView.destroy_all_children();
            yearView.destroy_all_children();
            detailBox.destroy_all_children();
        },
    };
}

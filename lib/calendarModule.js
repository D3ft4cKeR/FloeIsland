// 日历模块：日/月/年三视图统一设计语言。
// 月视图（新历 + 农历小字）、年视图（12 月迷你卡）、日视图（当日详情）。
// 农历/节气/节日数据来自 lib/lunar.js（纯 JS，已单测）。
//
// 布局与消息/天气模块一致：root = 垂直 BoxLayout，
// header 固定顶部，内容区 scroll 撑满剩余空间并延伸到面板右侧。

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    fullInfo,
    festivalsOf,
    lunarYearName,
} from './lunar.js';
import {fadeInUp} from './utils.js';

const WEEK_HEADER = ['一', '二', '三', '四', '五', '六', '日'];
const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

// 月视图格子高度：34px，6 行 = 204px + 表头/导航 ≈ 270px，
// 配合右侧当日信息栏，适配两行高度面板
const CAL_CELL_HEIGHT = 34;

export function createCalendarModule({dock, ext}) {
    const theme = dock.theme;

    // root：垂直 BoxLayout（header 固定 + 内容区可滚动）
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    // --- 头部：标题 + 日/月/年 segmented ---
    const header = new St.BoxLayout({
        style_class: 'floedock-module-header',
        x_expand: true,
    });
    const title = new St.Label({
        text: '日历',
        style_class: 'floedock-module-title',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    header.add_child(title);

    const segBox = new St.BoxLayout({style_class: 'floedock-segmented'});
    const segButtons = {};
    for (const key of ['日', '月', '年']) {
        const btn = new St.Widget({
            style_class: 'floedock-seg-button',
            reactive: true,
            track_hover: true,
            accessible_name: `${key}视图`,
            // BinLayout：让文字始终居于按钮正中
            layout_manager: new Clutter.BinLayout(),
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
    root.add_child(header);

    // --- 内容区：可滚动，viewport 撑满宽度 ---
    const scroll = new St.ScrollView({
        style_class: 'floedock-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        enable_mouse_scrolling: true,
    });
    const vbox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        // 不 y_expand：内容自然高度，超出视口时 ScrollView 可滚动
    });
    scroll.add_child(vbox);
    root.add_child(scroll);

    // 内容宽度跟随内容区（与消息/天气模块同理，内容延伸到面板右侧）
    const syncWidth = () => {
        const w = scroll.get_width();
        if (w > 0 && vbox.width !== w)
            vbox.width = w;
    };
    syncWidth();
    scroll.connect('notify::allocation', syncWidth);
    root.connect('notify::allocation', syncWidth);

    // --- 统一卡片容器：三个视图共用同一视觉语言 ---
    const makeCard = () => new St.BoxLayout({
        style_class: 'floedock-calendar-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });

    // --- 月视图卡片：左侧月历网格 + 右侧当日信息（节日/节气/农历） ---
    const monthCard = makeCard();
    vbox.add_child(monthCard);

    const navRow = new St.BoxLayout({
        style_class: 'floedock-calendar-nav',
        x_expand: true,
    });
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
    monthCard.add_child(navRow);

    // 月视图主体：横向 —— 左网格 + 右当日信息
    const monthBody = new St.BoxLayout({
        x_expand: true,
        y_expand: true,
        spacing: 10,
    });
    monthCard.add_child(monthBody);

    const monthView = new St.BoxLayout({
        style_class: 'floedock-calendar-monthview',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    monthBody.add_child(monthView);

    // 右侧当日信息栏（节日/节气/农历，选中日期后更新）
    const dayInfo = new St.BoxLayout({
        style_class: 'floedock-calendar-dayinfo',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        width: 130,
    });
    const dayInfoTitle = new St.Label({
        style_class: 'floedock-calendar-dayinfo-title',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    dayInfo.add_child(dayInfoTitle);
    const dayInfoBody = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        spacing: 4,
    });
    dayInfo.add_child(dayInfoBody);
    monthBody.add_child(dayInfo);

    // --- 年视图卡片：年份标题 + 12 月迷你卡 ---
    const yearCard = makeCard();
    yearCard.hide();
    vbox.add_child(yearCard);

    const yearTitle = new St.Label({
        style_class: 'floedock-calendar-year-title',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    yearCard.add_child(yearTitle);

    const yearGrid = new St.BoxLayout({
        style_class: 'floedock-calendar-yeargrid',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    yearCard.add_child(yearGrid);

    // --- 日视图卡片：所选日期详情 ---
    const dayCard = makeCard();
    dayCard.hide();
    vbox.add_child(dayCard);

    const dayTitle = new St.Label({
        style_class: 'floedock-calendar-day-title',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    dayCard.add_child(dayTitle);

    const dayBody = new St.BoxLayout({
        style_class: 'floedock-calendar-day-body',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    dayCard.add_child(dayBody);

    function makeNavButton(iconName, label) {
        const btn = new St.Widget({
            style_class: 'floedock-icon-button',
            reactive: true,
            track_hover: true,
            accessible_name: label,
            width: 26,
            height: 26,
            // BinLayout：图标在圆形按钮内居中
            layout_manager: new Clutter.BinLayout(),
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
        // 三个视图互斥显示：绝不混叠（避免布局挤压变形）
        monthCard.visible = key === '月';
        yearCard.visible = key === '年';
        dayCard.visible = key === '日';
        if (key === '月') {
            renderMonth();
        } else if (key === '年') {
            renderYear();
        } else {
            if (!selected)
                selected = {year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate()};
            renderDay(selected);
        }
    }

    function renderMonth() {
        monthView.destroy_all_children();
        monthLabel.text = `${viewYear}年 ${viewMonth}月`;

        // 星期表头
        const weekRow = new St.BoxLayout({style_class: 'floedock-calendar-week', x_expand: true});
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
                    row.add_child(new St.Widget({x_expand: true, height: CAL_CELL_HEIGHT}));
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
                    height: CAL_CELL_HEIGHT,
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

                // 小字：节气/节日优先，其次农历日名。
                // 创建后设置 clamp/ellipsize（GNOME 50 构造参数不可靠，
                // 会抛异常中断整个 rows 循环 → 日历无日期显示）
                let small = '';
                if (fests.length > 0)
                    small = fests[0];
                else
                    small = info.dayName;
                const lunarLabel = new St.Label({
                    text: small,
                    style_class: 'floedock-calendar-lunar',
                    x_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                });
                try {
                    lunarLabel.clamp_text = true;
                    lunarLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                } catch (e) {
                    // 忽略：ellipsize 失败不影响显示
                }
                if (fests.length > 0)
                    lunarLabel.add_style_pseudo_class('fest');
                cell.add_child(lunarLabel);

                cell.connect('button-press-event', (actor, ev) => {
                    selected = {year: viewYear, month: viewMonth, day};
                    // 选中日期 → 更新右侧当日信息栏（不离开月视图）
                    renderMonth();
                    updateDayInfo(selected);
                    return Clutter.EVENT_STOP;
                });
                row.add_child(cell);
            }
            monthView.add_child(row);
        }
        // 渲染完网格后，同步右侧当日信息（默认今天）
        updateDayInfo(selected ?? {year: viewYear, month: viewMonth, day: today.getDate()});
    }

    /** 更新右侧当日信息栏：农历 + 节日/节气。 */
    function updateDayInfo(date) {
        const {year, month, day} = date;
        const info = fullInfo(year, month, day);
        const fests = festivalsOf(year, month, day);
        dayInfoTitle.text = `${month}月${day}日`;

        dayInfoBody.destroy_all_children();
        const lines = [];
        if (fests.length > 0)
            lines.push(...fests.map(f => ({text: f, fest: true})));
        const terms = info.terms?.filter(t => t.day === day) ?? [];
        for (const t of terms)
            lines.push({text: t.name, fest: true});
        if (lines.length === 0)
            lines.push({text: '无节日', fest: false});
        lines.push({text: `农历${info.monthName}${info.dayName}`, fest: false});
        lines.push({text: `${info.yearName} · ${info.zodiac}`, fest: false});

        for (const l of lines) {
            const lbl = new St.Label({
                text: l.text,
                style_class: l.fest
                    ? 'floedock-calendar-dayinfo-fest'
                    : 'floedock-calendar-dayinfo-text',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            dayInfoBody.add_child(lbl);
        }
    }

    function renderYear() {
        yearGrid.destroy_all_children();
        yearTitle.text = `${viewYear}年  ${lunarYearName(viewYear).withZodiac}`;

        for (let m = 1; m <= 12; m += 3) {
            const row = new St.BoxLayout({x_expand: true, style_class: 'floedock-calendar-year-row'});
            for (let k = 0; k < 3 && m + k <= 12; k++) {
                const mm = m + k;
                const mini = new St.BoxLayout({
                    style_class: 'floedock-calendar-mini-month',
                    orientation: Clutter.Orientation.VERTICAL,
                    reactive: true,
                    track_hover: true,
                    x_expand: true,
                });
                const lbl = new St.Label({
                    text: `${mm}月`,
                    style_class: 'floedock-calendar-mini-title',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                mini.add_child(lbl);

                // 迷你月格：当月农历初一
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
            yearGrid.add_child(row);
        }
    }

    function renderDay(date) {
        dayBody.destroy_all_children();
        const {year, month, day} = date;
        const info = fullInfo(year, month, day);
        const fests = festivalsOf(year, month, day);
        const weekday = new Date(year, month - 1, day).getDay();

        dayTitle.text = `${year}年${month}月${day}日  星期${WEEK_NAMES[weekday]}`;

        const lunarLine = `${info.yearName} · ${info.monthName}${info.dayName} · 生肖${info.zodiac}`;
        const line2 = new St.Label({
            text: lunarLine,
            style_class: 'floedock-calendar-detail-line2',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        dayBody.add_child(line2);

        if (fests.length > 0) {
            const line3 = new St.Label({
                text: fests.join(' · '),
                style_class: 'floedock-calendar-detail-fest',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            dayBody.add_child(line3);
        }

        const line1 = new St.Label({
            text: `农历 ${info.monthName}${info.dayName}`,
            style_class: 'floedock-calendar-detail-line1',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        dayBody.add_child(line1);

        fadeInUp(dayBody, {duration: 240, fromY: 6});
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
            yearGrid.destroy_all_children();
            dayBody.destroy_all_children();
        },
    };
}

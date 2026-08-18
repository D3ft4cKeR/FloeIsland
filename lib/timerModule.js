// 附加模块：倒计时 / 秒表。
// 纯本地实现；倒计时结束时在岛屿上显示 OSD 提醒。
//
// 设计语言：深色卡片风 —— 内容块复用 .floedock-calendar-card（深色背景 + 圆角 14px），
// 大号时间显示复用 .floedock-timer-display（44pt / weight 200 / tnum），内联补充
// 等宽字体族与字距，视觉上接近苹果计时器；按钮复用 .floedock-timer-action /
// .floedock-timer-chip。所有交互走 button-press-event（GNOME 50 不用 ClickGesture）。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {clearTimeoutId} from './utils.js';

export function createTimerModule({dock, ext}) {
    // 大号时间显示的补充样式：等宽字体 + 字距（比 stylesheet 默认 44pt 略小，
    // 适配两行高度面板）
    const DISPLAY_EXTRA = 'font-family: "Ubuntu Mono", "DejaVu Sans Mono", ' +
        '"Noto Sans Mono", monospace; letter-spacing: 1px; font-size: 34pt;';
    // 状态小字（内联实现，避免新增 CSS 类）
    const STATUS_STYLE = 'color: rgba(255, 255, 255, 0.45); font-size: 10pt;';
    // 选中预设高亮（内联实现，避免新增 CSS 类；白色系与全局一致）
    const ACTIVE_CHIP_STYLE = 'background-color: rgba(255, 255, 255, 0.28); ' +
        'border-color: rgba(255, 255, 255, 0.60);';

    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    // ===================== 头部：标题 + segmented 切换 =====================
    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({
        text: '计时',
        style_class: 'floedock-module-title',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    header.add_child(title);

    const segBox = new St.BoxLayout({style_class: 'floedock-segmented'});
    const segButtons = {};
    for (const key of ['倒计时', '秒表']) {
        const btn = new St.Widget({
            style_class: 'floedock-seg-button',
            reactive: true,
            track_hover: true,
            can_focus: true,
            accessible_name: key,
        });
        const lbl = new St.Label({
            text: key,
            style_class: 'floedock-seg-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.add_child(lbl);
        btn.connect('button-press-event', (actor, ev) => {
            switchMode(key);
            return Clutter.EVENT_STOP;
        });
        segBox.add_child(btn);
        segButtons[key] = btn;
    }
    header.add_child(segBox);
    root.add_child(header);

    // ===================== 可滚动内容区 =====================
    // St.ScrollView > St.Viewport > 内容 vbox（可滚动；内容宽度跟随 scroll）
    const scroll = new St.ScrollView({
        style_class: 'floedock-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
        hscrollbar_policy: St.PolicyType.NEVER,
    });
    const viewport = new St.Viewport({x_expand: true});
    const content = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        spacing: 8,
    });
    viewport.add_child(content);
    scroll.add_child(viewport);
    root.add_child(scroll);

    // 内容宽度跟随 ScrollView（参考 messagesModule.syncListWidth；
    // 只设置 content 宽度，viewport 由 ScrollView 内部管理）
    const syncListWidth = () => {
        const w = scroll.get_width();
        if (w > 0 && content.width !== w)
            content.width = w;
    };
    syncListWidth();
    scroll.connect('notify::allocation', syncListWidth);
    root.connect('notify::allocation', syncListWidth);

    // ===================== 倒计时 =====================
    const countCard = new St.BoxLayout({
        style_class: 'floedock-calendar-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    content.add_child(countCard);

    const countDisplay = new St.Label({
        text: '00:00',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    countDisplay.set_style(DISPLAY_EXTRA);
    countCard.add_child(countDisplay);

    const countStatus = new St.Label({
        text: '准备就绪',
        x_align: Clutter.ActorAlign.CENTER,
    });
    countStatus.set_style(STATUS_STYLE);
    countCard.add_child(countStatus);

    // 预设 1 / 3 / 5 / 10 / 25 分钟
    const presetRow = new St.BoxLayout({
        style_class: 'floedock-timer-presets',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const presetChips = {};
    for (const minutes of [1, 3, 5, 10, 25]) {
        const chip = new St.Widget({
            style_class: 'floedock-timer-chip',
            reactive: true,
            track_hover: true,
            can_focus: true,
            accessible_name: `${minutes} 分钟`,
            layout_manager: new Clutter.BinLayout(), // 文字居中
        });
        const lbl = new St.Label({
            text: `${minutes}分`,
            style_class: 'floedock-timer-chip-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        chip.add_child(lbl);
        chip.connect('button-press-event', (actor, ev) => {
            setCountdown(minutes * 60);
            highlightPreset(minutes);
            customEntry.text = '';
            return Clutter.EVENT_STOP;
        });
        presetRow.add_child(chip);
        presetChips[minutes] = chip;
    }
    countCard.add_child(presetRow);

    // 自定义分钟 + 开始
    const customRow = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
    const customEntry = new St.Entry({
        style_class: 'floedock-timer-entry',
        hint_text: '自定义分钟数',
        can_focus: true,
        width: 140,
    });
    customRow.add_child(customEntry);
    const customBtn = makeBtn('开始', 'floedock-timer-action');
    customRow.add_child(customBtn);
    countCard.add_child(customRow);

    // 主控制：开始 / 暂停 / 重置
    const countCtrlRow = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
    const countStartBtn = makeBtn('开始', 'floedock-timer-action');
    const countResetBtn = makeBtn('重置', 'floedock-timer-action');
    countCtrlRow.add_child(countStartBtn);
    countCtrlRow.add_child(countResetBtn);
    countCard.add_child(countCtrlRow);

    let countRemaining = 0;
    let countTotal = 0;
    let countTimer = 0;
    let countRunning = false;

    /** 高亮当前选中的预设（自定义输入时清除）。 */
    function highlightPreset(minutes) {
        for (const m of Object.keys(presetChips)) {
            const chip = presetChips[m];
            if (m === minutes) {
                if (!chip._floedockActive) {
                    chip.set_style(ACTIVE_CHIP_STYLE);
                    chip._floedockActive = true;
                }
            } else if (chip._floedockActive) {
                chip.set_style('');
                chip._floedockActive = false;
            }
        }
    }

    function setCountdown(totalSec) {
        if (totalSec <= 0)
            return;
        countTotal = totalSec;
        countRemaining = totalSec;
        countRunning = false;
        stopCountTimer();
        setCountStartLabel('开始');
        setStatus(countStatus, '准备就绪');
        renderCount();
    }

    function setCountStartLabel(text) {
        countStartBtn.get_child_at_index(0).text = text;
    }

    function renderCount() {
        const m = Math.floor(countRemaining / 60);
        const s = countRemaining % 60;
        countDisplay.text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function stopCountTimer() {
        countTimer = clearTimeoutId(countTimer);
    }

    function startCount() {
        if (countRemaining <= 0)
            return;
        if (countRunning)
            return;
        countRunning = true;
        setCountStartLabel('暂停');
        setStatus(countStatus, '计时中');
        countTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            countRemaining--;
            if (countRemaining <= 0) {
                countRemaining = 0;
                countRunning = false;
                renderCount();
                setCountStartLabel('开始');
                onFinished();
                return GLib.SOURCE_REMOVE;
            }
            renderCount();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(countTimer, '[floedock] countdown');
    }

    function pauseCount() {
        countRunning = false;
        setCountStartLabel('开始');
        setStatus(countStatus, '已暂停');
        stopCountTimer();
    }

    function onFinished() {
        setStatus(countStatus, '时间到');
        dock.showOsdInfo({
            icon: 'alarm-symbolic',
            label: '倒计时结束',
            duration: 2500,
        });
        dock.debug('countdown finished');
    }

    /** 读取自定义输入并设置倒计时；返回有效分钟数（无效返回 0）。 */
    function commitCustom() {
        const min = parseInt(customEntry.text, 10);
        if (!Number.isNaN(min) && min > 0) {
            setCountdown(min * 60);
            highlightPreset(null);
            return min;
        }
        return 0;
    }

    countStartBtn.connect('button-press-event', () => {
        if (countRunning)
            pauseCount();
        else
            startCount();
        return Clutter.EVENT_STOP;
    });
    countResetBtn.connect('button-press-event', () => {
        countRunning = false;
        stopCountTimer();
        countRemaining = countTotal;
        setCountStartLabel('开始');
        setStatus(countStatus, '准备就绪');
        renderCount();
        return Clutter.EVENT_STOP;
    });
    customBtn.connect('button-press-event', () => {
        if (commitCustom() > 0)
            startCount();
        return Clutter.EVENT_STOP;
    });
    customEntry.connect('key-press-event', (entry, ev) => {
        const sym = ev.get_key_symbol();
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
            if (commitCustom() > 0)
                startCount();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    // GNOME 50：St.Entry 的文本变化需监听 clutter_text 的 text-changed
    customEntry.clutter_text.connect('text-changed', () => {
        if (countRunning)
            return; // 运行中不打扰
        const min = parseInt(customEntry.text, 10);
        if (!Number.isNaN(min) && min > 0) {
            setCountdown(min * 60); // 实时预览
            highlightPreset(null);
        }
    });

    // ===================== 秒表 =====================
    const stopCard = new St.BoxLayout({
        style_class: 'floedock-calendar-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    stopCard.hide();
    content.add_child(stopCard);

    const stopDisplay = new St.Label({
        text: '00:00.0',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    stopDisplay.set_style(DISPLAY_EXTRA);
    stopCard.add_child(stopDisplay);

    const stopStatus = new St.Label({
        text: '准备就绪',
        x_align: Clutter.ActorAlign.CENTER,
    });
    stopStatus.set_style(STATUS_STYLE);
    stopCard.add_child(stopStatus);

    const stopCtrlRow = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
    const stopStartBtn = makeBtn('开始', 'floedock-timer-action');
    const lapBtn = makeBtn('计次', 'floedock-timer-action');
    const stopResetBtn = makeBtn('重置', 'floedock-timer-action');
    stopCtrlRow.add_child(stopStartBtn);
    stopCtrlRow.add_child(lapBtn);
    stopCtrlRow.add_child(stopResetBtn);
    stopCard.add_child(stopCtrlRow);

    // 计次列表（最多 5 条，最新在上）
    const lapHint = new St.Label({
        text: '点击「计次」记录分段时间',
        x_align: Clutter.ActorAlign.CENTER,
    });
    lapHint.set_style(STATUS_STYLE);
    stopCard.add_child(lapHint);

    const lapBox = new St.BoxLayout({
        style_class: 'floedock-timer-laps',
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
    });
    stopCard.add_child(lapBox);

    let stopMs = 0;
    let stopBase = 0;
    let stopTimer = 0;
    let stopRunning = false;
    let lapCount = 0;

    function renderStop() {
        const ms = stopMs;
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const d = Math.floor((ms % 1000) / 100);
        stopDisplay.text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
    }

    function stopStopTimer() {
        stopTimer = clearTimeoutId(stopTimer);
    }

    function setStopStartLabel(text) {
        stopStartBtn.get_child_at_index(0).text = text;
    }

    function startStopwatch() {
        if (stopRunning)
            return;
        stopRunning = true;
        setStopStartLabel('暂停');
        setStatus(stopStatus, '计时中');
        stopBase = Date.now() - stopMs;
        stopTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            stopMs = Date.now() - stopBase;
            renderStop();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(stopTimer, '[floedock] stopwatch');
    }

    function pauseStopwatch() {
        stopRunning = false;
        setStopStartLabel('开始');
        setStatus(stopStatus, '已暂停');
        stopStopTimer();
    }

    stopStartBtn.connect('button-press-event', () => {
        if (stopRunning)
            pauseStopwatch();
        else
            startStopwatch();
        return Clutter.EVENT_STOP;
    });
    lapBtn.connect('button-press-event', () => {
        if (!stopRunning)
            return Clutter.EVENT_STOP;
        lapCount++;
        lapHint.hide();
        const lbl = new St.Label({
            text: `第${lapCount}次   ${stopDisplay.text}`,
            style_class: 'floedock-timer-lap',
            x_align: Clutter.ActorAlign.CENTER,
        });
        lapBox.insert_child_at_index(lbl, 0);
        while (lapBox.get_n_children() > 5)
            lapBox.get_last_child().destroy();
        return Clutter.EVENT_STOP;
    });
    stopResetBtn.connect('button-press-event', () => {
        stopRunning = false;
        stopStopTimer();
        stopMs = 0;
        lapCount = 0;
        lapBox.destroy_all_children();
        lapHint.show();
        renderStop();
        setStopStartLabel('开始');
        setStatus(stopStatus, '准备就绪');
        return Clutter.EVENT_STOP;
    });

    // ===================== 模式切换 =====================
    function switchMode(key) {
        for (const k of Object.keys(segButtons))
            segButtons[k].remove_style_pseudo_class('checked');
        segButtons[key].add_style_pseudo_class('checked');
        countCard.visible = key === '倒计时';
        stopCard.visible = key === '秒表';
        syncListWidth();
    }

    function makeBtn(text, styleClass) {
        const btn = new St.Widget({
            style_class: styleClass,
            reactive: true,
            track_hover: true,
            can_focus: true,
            accessible_name: text,
            layout_manager: new Clutter.BinLayout(), // 文字居中
        });
        const lbl = new St.Label({
            text,
            style_class: 'floedock-timer-action-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.add_child(lbl);
        return btn;
    }

    function setStatus(label, text) {
        label.text = text;
    }

    switchMode('倒计时');

    return {
        widget: root,
        title: '计时',
        icon: 'timer-symbolic',

        activate() {
            renderCount();
            renderStop();
            syncListWidth();
        },

        deactivate() {
            // 计时器在后台继续运行（切 Tab 不中断）
        },

        destroy() {
            stopCountTimer();
            stopStopTimer();
        },
    };
}

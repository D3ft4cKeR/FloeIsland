// 附加模块：倒计时 / 秒表。
// 纯本地实现；倒计时结束时在岛屿上显示 OSD 提醒。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {clearTimeoutId} from './utils.js';

export function createTimerModule({dock, ext}) {
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({text: '计时', style_class: 'floedock-module-title'});
    header.add_child(title);
    header.add_child(new St.Widget({x_expand: true}));

    // 倒计时 / 秒表 切换
    const segBox = new St.BoxLayout({style_class: 'floedock-segmented'});
    const segButtons = {};
    for (const key of ['倒计时', '秒表']) {
        const btn = new St.Widget({
            style_class: 'floedock-seg-button',
            reactive: true,
            track_hover: true,
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

    // ===================== 倒计时 =====================
    const countBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    root.add_child(countBox);

    const countDisplay = new St.Label({
        text: '00:00',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
    });
    countBox.add_child(countDisplay);

    const presetRow = new St.BoxLayout({
        style_class: 'floedock-timer-presets',
        x_align: Clutter.ActorAlign.CENTER,
    });
    for (const minutes of [1, 3, 5, 10, 25]) {
        const chip = new St.Widget({
            style_class: 'floedock-timer-chip',
            reactive: true,
            track_hover: true,
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
            return Clutter.EVENT_STOP;
        });
        presetRow.add_child(chip);
    }
    countBox.add_child(presetRow);

    const customRow = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
    const customEntry = new St.Entry({
        style_class: 'floedock-timer-entry',
        hint_text: '自定义分钟数',
        can_focus: true,
        width: 140,
    });
    customRow.add_child(customEntry);
    const customBtn = new St.Widget({
        style_class: 'floedock-timer-action',
        reactive: true,
        track_hover: true,
    });
    const customBtnLabel = new St.Label({
        text: '开始',
        style_class: 'floedock-timer-action-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    customBtn.add_child(customBtnLabel);
    customRow.add_child(customBtn);
    countBox.add_child(customRow);

    const countCtrlRow = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
    const countStartBtn = makeBtn('开始', 'floedock-timer-action');
    const countResetBtn = makeBtn('重置', 'floedock-timer-action');
    countCtrlRow.add_child(countStartBtn);
    countCtrlRow.add_child(countResetBtn);
    countBox.add_child(countCtrlRow);

    let countRemaining = 0;
    let countTotal = 0;
    let countTimer = 0;
    let countRunning = false;

    function setCountdown(totalSec) {
        if (totalSec <= 0)
            return;
        countTotal = totalSec;
        countRemaining = totalSec;
        countRunning = false;
        stopCountTimer();
        renderCount();
        countStartBtn.get_child_at_index(0).text = '开始';
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
        countStartBtn.get_child_at_index(0).text = '暂停';
        countTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            countRemaining--;
            if (countRemaining <= 0) {
                countRemaining = 0;
                countRunning = false;
                renderCount();
                countStartBtn.get_child_at_index(0).text = '开始';
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
        countStartBtn.get_child_at_index(0).text = '开始';
        stopCountTimer();
    }

    function onFinished() {
        dock.showOsdInfo({
            icon: 'alarm-symbolic',
            label: '倒计时结束',
            duration: 2500,
        });
        dock.debug('countdown finished');
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
        renderCount();
        countStartBtn.get_child_at_index(0).text = '开始';
        return Clutter.EVENT_STOP;
    });
    customBtn.connect('button-press-event', () => {
        const min = parseInt(customEntry.text, 10);
        if (!Number.isNaN(min) && min > 0)
            setCountdown(min * 60);
        return Clutter.EVENT_STOP;
    });
    customEntry.connect('key-press-event', (entry, ev) => {
        if (ev.get_key_symbol() === Clutter.KEY_Return) {
            const min = parseInt(entry.text, 10);
            if (!Number.isNaN(min) && min > 0)
                setCountdown(min * 60);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    // ===================== 秒表 =====================
    const stopBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    stopBox.hide();
    root.add_child(stopBox);

    const stopDisplay = new St.Label({
        text: '00:00.0',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
    });
    stopBox.add_child(stopDisplay);

    const stopCtrlRow = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
    const stopStartBtn = makeBtn('开始', 'floedock-timer-action');
    const lapBtn = makeBtn('计次', 'floedock-timer-action');
    const stopResetBtn = makeBtn('重置', 'floedock-timer-action');
    stopCtrlRow.add_child(stopStartBtn);
    stopCtrlRow.add_child(lapBtn);
    stopCtrlRow.add_child(stopResetBtn);
    stopBox.add_child(stopCtrlRow);

    const lapBox = new St.BoxLayout({
        style_class: 'floedock-timer-laps',
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
    });
    stopBox.add_child(lapBox);

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

    function startStopwatch() {
        if (stopRunning)
            return;
        stopRunning = true;
        stopStartBtn.get_child_at_index(0).text = '暂停';
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
        stopStartBtn.get_child_at_index(0).text = '开始';
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
        const lbl = new St.Label({
            text: `第${lapCount}次  ${stopDisplay.text}`,
            style_class: 'floedock-timer-lap',
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
        renderStop();
        stopStartBtn.get_child_at_index(0).text = '开始';
        return Clutter.EVENT_STOP;
    });

    // ===================== 模式切换 =====================
    function switchMode(key) {
        for (const k of Object.keys(segButtons))
            segButtons[k].remove_style_pseudo_class('checked');
        segButtons[key].add_style_pseudo_class('checked');
        countBox.visible = key === '倒计时';
        stopBox.visible = key === '秒表';
    }

    function makeBtn(text, styleClass) {
        const btn = new St.Widget({
            style_class: styleClass,
            reactive: true,
            track_hover: true,
            // BinLayout：文字居中
            layout_manager: new Clutter.BinLayout(),
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

    switchMode('倒计时');

    return {
        widget: root,
        title: '计时',
        icon: 'timer-symbolic',

        activate() {
            renderCount();
            renderStop();
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

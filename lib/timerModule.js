// 倒计时模块：左右结构 —— 左大时间（完整显示，无状态文字），
// 右按钮（开始/暂停、重置）。分/秒自定义输入，可多次设置。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {clearTimeoutId} from './utils.js';

export function createTimerModule({dock, ext}) {
    const FONT = 'font-family: "Ubuntu Mono", "DejaVu Sans Mono", monospace; letter-spacing: 1px; font-size: 42pt;';
    const HINT = 'color: rgba(255,255,255,0.45); font-size: 10pt;';

    // root：横向（左时间+输入，右按钮）
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });

    // --- 左侧：大时间 + 分/秒输入 ---
    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const display = new St.Label({
        text: '00:00',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    display.set_style(FONT);
    leftCol.add_child(display);

    const inputRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    const entryMin = new St.Entry({style_class: 'floedock-timer-entry', hint_text: '分', can_focus: true, width: 52});
    const entrySec = new St.Entry({style_class: 'floedock-timer-entry', hint_text: '秒', can_focus: true, width: 52});
    inputRow.add_child(entryMin);
    inputRow.add_child(entrySec);
    leftCol.add_child(inputRow);

    const hintLabel = new St.Label({
        text: '输入分/秒后点开始',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    hintLabel.set_style(HINT);
    leftCol.add_child(hintLabel);

    root.add_child(leftCol);

    // --- 右侧：按钮列（纵向） ---
    const btnCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const startBtn = makeBtn('开始');
    const resetBtn = makeBtn('重置');
    btnCol.add_child(startBtn);
    btnCol.add_child(resetBtn);
    root.add_child(btnCol);

    let remaining = 0, total = 0, timer = 0, running = false;

    function setCountdown(s) {
        if (s <= 0) return false;
        total = s;
        remaining = s;
        running = false;
        stopT();
        startBtn.get_child_at_index(0).text = '开始';
        render();
        return true;
    }
    function render() {
        const m = Math.floor(remaining / 60), s = remaining % 60;
        display.text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    function stopT() { timer = clearTimeoutId(timer); }
    function startC() {
        if (running) return;
        // 时间已用完或未设置 → 从输入重新设置（支持多次设置）
        if (remaining <= 0) {
            const mi = parseInt(entryMin.text, 10) || 0;
            const se = parseInt(entrySec.text, 10) || 0;
            const t = mi * 60 + se;
            if (t <= 0) {
                hintLabel.text = '请输入有效时间';
                return;
            }
            setCountdown(t);
        }
        running = true;
        startBtn.get_child_at_index(0).text = '暂停';
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            remaining--;
            if (remaining <= 0) {
                remaining = 0;
                running = false;
                render();
                startBtn.get_child_at_index(0).text = '开始';
                hintLabel.text = '时间到';
                dock.showOsdInfo({icon: 'alarm-symbolic', label: '倒计时结束', duration: 2500});
                return GLib.SOURCE_REMOVE;
            }
            render();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(timer, '[floedock] countdown');
    }
    function pauseC() {
        running = false;
        startBtn.get_child_at_index(0).text = '开始';
        stopT();
    }
    startBtn.connect('button-press-event', () => {
        if (running) { pauseC(); return Clutter.EVENT_STOP; }
        startC();
        return Clutter.EVENT_STOP;
    });
    resetBtn.connect('button-press-event', () => {
        // 重置 = 清空时间，回到可重新设置状态
        running = false; stopT();
        remaining = 0;
        total = 0;
        startBtn.get_child_at_index(0).text = '开始';
        hintLabel.text = '输入分/秒后点开始';
        render();
        return Clutter.EVENT_STOP;
    });
    const commitOnEnter = (_e, ev) => {
        if (ev.get_key_symbol() === Clutter.KEY_Return) {
            const mi = parseInt(entryMin.text, 10) || 0;
            const se = parseInt(entrySec.text, 10) || 0;
            const t = mi * 60 + se;
            if (t > 0) {
                setCountdown(t);
                hintLabel.text = '已设置，点开始';
                if (!running) startC();
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    };
    entryMin.connect('key-press-event', commitOnEnter);
    entrySec.connect('key-press-event', commitOnEnter);

    return {
        widget: root, title: '倒计时', icon: 'alarm-symbolic',
        activate() { render(); },
        deactivate() {},
        destroy() { stopT(); },
    };
}

function makeBtn(text) {
    const btn = new St.Widget({
        style_class: 'floedock-timer-action', reactive: true, track_hover: true,
        can_focus: true, layout_manager: new Clutter.BinLayout(),
    });
    btn.add_child(new St.Label({text, style_class: 'floedock-timer-action-label', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
    return btn;
}

// 倒计时模块：左右结构 —— 左大时间（完整显示）+ 设置（分/秒输入、预设），
// 右按钮（开始/暂停、重置）。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {clearTimeoutId} from './utils.js';

export function createTimerModule({dock, ext}) {
    const FONT = 'font-family: "Ubuntu Mono", "DejaVu Sans Mono", monospace; letter-spacing: 1px; font-size: 34pt;';
    const STATUS = 'color: rgba(255,255,255,0.45); font-size: 10pt;';
    const ACTIVE = 'background-color: rgba(255,255,255,0.28); border-color: rgba(255,255,255,0.60);';

    // root：横向（左时间+设置，右按钮）
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style: 'spacing: 14px;',
    });

    // --- 左侧：时间 + 设置 ---
    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 6px;',
    });

    const display = new St.Label({
        text: '00:00',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    display.set_style(FONT);
    leftCol.add_child(display);

    const statusLabel = new St.Label({text: '准备就绪', x_align: Clutter.ActorAlign.CENTER, x_expand: true});
    statusLabel.set_style(STATUS);
    leftCol.add_child(statusLabel);

    // 自定义时间输入行（分 + 秒）
    const inputRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: 'spacing: 6px;',
    });
    const entryMin = new St.Entry({style_class: 'floedock-timer-entry', hint_text: '分', can_focus: true, width: 50});
    const entrySec = new St.Entry({style_class: 'floedock-timer-entry', hint_text: '秒', can_focus: true, width: 50});
    inputRow.add_child(entryMin);
    inputRow.add_child(entrySec);
    leftCol.add_child(inputRow);

    // 预设芯片（一行，紧凑）
    const chipRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: 'spacing: 4px;',
    });
    root._pc = {};
    for (const m of [1, 3, 5, 10, 25]) {
        const chip = new St.Widget({
            style_class: 'floedock-timer-chip', reactive: true, track_hover: true,
            can_focus: true, layout_manager: new Clutter.BinLayout(),
        });
        chip.add_child(new St.Label({text: `${m}m`, style_class: 'floedock-timer-chip-label', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER}));
        chip.connect('button-press-event', () => { setCountdown(m * 60); highlightPreset(m); entryMin.text = ''; entrySec.text = ''; return Clutter.EVENT_STOP; });
        chipRow.add_child(chip);
        root._pc[m] = chip;
    }
    leftCol.add_child(chipRow);

    root.add_child(leftCol);

    // --- 右侧：按钮列（纵向） ---
    const btnCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 8px;',
    });
    const startBtn = makeBtn('开始');
    const resetBtn = makeBtn('重置');
    btnCol.add_child(startBtn);
    btnCol.add_child(resetBtn);
    root.add_child(btnCol);

    let remaining = 0, total = 0, timer = 0, running = false;

    function highlightPreset(m) {
        for (const k of Object.keys(root._pc ?? {})) {
            const c = root._pc[k];
            if (parseInt(k) === m) { if (!c._a) { c.set_style(ACTIVE); c._a = true; } }
            else if (c._a) { c.set_style(''); c._a = false; }
        }
    }
    function setCountdown(s) { if (s <= 0) return; total = s; remaining = s; running = false; stopT(); startBtn.get_child_at_index(0).text = '开始'; statusLabel.text = '准备就绪'; render(); }
    function render() { const m = Math.floor(remaining / 60), s = remaining % 60; display.text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
    function stopT() { timer = clearTimeoutId(timer); }
    function startC() {
        if (remaining <= 0 || running) return;
        running = true; startBtn.get_child_at_index(0).text = '暂停'; statusLabel.text = '计时中';
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            remaining--;
            if (remaining <= 0) { remaining = 0; running = false; render(); startBtn.get_child_at_index(0).text = '开始'; statusLabel.text = '时间到'; dock.showOsdInfo({icon: 'alarm-symbolic', label: '倒计时结束', duration: 2500}); return GLib.SOURCE_REMOVE; }
            render(); return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(timer, '[floedock] countdown');
    }
    function pauseC() { running = false; startBtn.get_child_at_index(0).text = '开始'; statusLabel.text = '已暂停'; stopT(); }
    function commitCustom() {
        const mi = parseInt(entryMin.text, 10) || 0, se = parseInt(entrySec.text, 10) || 0;
        const t = mi * 60 + se; if (t > 0) { setCountdown(t); highlightPreset(null); return true; } return false;
    }
    startBtn.connect('button-press-event', () => { if (running) { pauseC(); return Clutter.EVENT_STOP; } if (remaining <= 0) commitCustom(); startC(); return Clutter.EVENT_STOP; });
    resetBtn.connect('button-press-event', () => { running = false; stopT(); remaining = total; startBtn.get_child_at_index(0).text = '开始'; statusLabel.text = '准备就绪'; render(); return Clutter.EVENT_STOP; });
    entryMin.connect('key-press-event', (_e, ev) => { if (ev.get_key_symbol() === Clutter.KEY_Return) { if (commitCustom()) startC(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; });
    entrySec.connect('key-press-event', (_e, ev) => { if (ev.get_key_symbol() === Clutter.KEY_Return) { if (commitCustom()) startC(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; });

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

// 秒表模块：左右结构 —— 左大时间（完整显示），右按钮（开始/暂停、计次、重置）。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {clearTimeoutId} from './utils.js';

export function createStopwatchModule({dock, ext}) {
    const FONT = 'font-family: "Ubuntu Mono", "DejaVu Sans Mono", monospace; letter-spacing: 1px; font-size: 34pt;';
    const STATUS = 'color: rgba(255,255,255,0.45); font-size: 10pt;';

    // root：横向（左时间 + 右按钮）
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style: 'spacing: 14px;',
    });

    // --- 左侧：时间（不省略，完整显示） ---
    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 4px;',
    });

    const display = new St.Label({
        text: '00:00.0',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    display.set_style(FONT);
    leftCol.add_child(display);

    const statusLabel = new St.Label({text: '准备就绪', x_align: Clutter.ActorAlign.CENTER, x_expand: true});
    statusLabel.set_style(STATUS);
    leftCol.add_child(statusLabel);

    // 计次列表（最多 5 条，左列下方）
    const lapBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: 'spacing: 2px;',
    });
    leftCol.add_child(lapBox);

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
    const lapBtn = makeBtn('计次');
    const resetBtn = makeBtn('重置');
    btnCol.add_child(startBtn);
    btnCol.add_child(lapBtn);
    btnCol.add_child(resetBtn);
    root.add_child(btnCol);

    let ms = 0, base = 0, timer = 0, running = false, lapCount = 0;

    function render() {
        const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), d = Math.floor((ms % 1000) / 100);
        display.text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
    }
    function stopT() { timer = clearTimeoutId(timer); }
    function startS() {
        if (running) return;
        running = true; startBtn.get_child_at_index(0).text = '暂停'; statusLabel.text = '计时中';
        base = Date.now() - ms;
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { ms = Date.now() - base; render(); return GLib.SOURCE_CONTINUE; });
        GLib.Source.set_name_by_id(timer, '[floedock] stopwatch');
    }
    function pauseS() { running = false; startBtn.get_child_at_index(0).text = '开始'; statusLabel.text = '已暂停'; stopT(); }

    startBtn.connect('button-press-event', () => { running ? pauseS() : startS(); return Clutter.EVENT_STOP; });
    lapBtn.connect('button-press-event', () => {
        if (!running) return Clutter.EVENT_STOP;
        lapCount++;
        const lbl = new St.Label({text: `#${lapCount}  ${display.text}`, style_class: 'floedock-timer-lap', x_align: Clutter.ActorAlign.CENTER});
        lapBox.insert_child_at_index(lbl, 0);
        while (lapBox.get_n_children() > 5) lapBox.get_last_child().destroy();
        return Clutter.EVENT_STOP;
    });
    resetBtn.connect('button-press-event', () => {
        running = false; stopT(); ms = 0; lapCount = 0;
        lapBox.destroy_all_children(); render();
        startBtn.get_child_at_index(0).text = '开始'; statusLabel.text = '准备就绪';
        return Clutter.EVENT_STOP;
    });

    return {
        widget: root, title: '秒表', icon: 'chronometer-symbolic',
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

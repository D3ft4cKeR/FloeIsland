// 秒表模块：左右结构 —— 左大时间（完整显示 MM:SS.cc）+ 计次列表（最多 3 条，
// 不向下溢出），右按钮（开始/暂停、计次、重置）。
// 计时时在时间岛左侧显示迷你小岛实时显示当前计时（dock.setStopwatchMini）。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {clearTimeoutId} from './utils.js';

export function createStopwatchModule({dock, ext}) {
    const FONT = 'font-family: "Ubuntu Mono", "DejaVu Sans Mono", monospace; letter-spacing: 1px; font-size: 40pt;';
    const HINT = 'color: rgba(255,255,255,0.45); font-size: 10pt;';
    const MAX_LAPS = 3;

    // root：横向（左时间+计次，右按钮）
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });

    // --- 左侧：大时间 + 计次列表 ---
    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const display = new St.Label({
        text: '00:00.00',
        style_class: 'floedock-timer-display',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    display.set_style(FONT);
    leftCol.add_child(display);

    // 计次列表（clip 防溢出，最多 3 条）
    const lapBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });
    const lapHint = new St.Label({
        text: '点「计次」记录',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    lapHint.set_style(HINT);
    lapBox.add_child(lapHint);
    leftCol.add_child(lapBox);

    root.add_child(leftCol);

    // --- 右侧：按钮列（纵向） ---
    const btnCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
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
        const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), c = Math.floor((ms % 1000) / 10);
        display.text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
        // 计时中：在时间岛左侧实时显示迷你小岛
        dock.setStopwatchMini?.({visible: ms > 0, text: display.text});
    }
    function stopT() { timer = clearTimeoutId(timer); }
    function startS() {
        if (running) return;
        running = true; startBtn.get_child_at_index(0).text = '暂停';
        base = Date.now() - ms;
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => { ms = Date.now() - base; render(); return GLib.SOURCE_CONTINUE; });
        GLib.Source.set_name_by_id(timer, '[floeisland] stopwatch');
    }
    function pauseS() { running = false; startBtn.get_child_at_index(0).text = '开始'; stopT(); }

    startBtn.connect('button-press-event', () => { running ? pauseS() : startS(); return Clutter.EVENT_STOP; });
    lapBtn.connect('button-press-event', () => {
        if (!running) return Clutter.EVENT_STOP;
        lapCount++;
        lapHint.hide();
        const lbl = new St.Label({
            text: `#${lapCount}  ${display.text}`,
            style_class: 'floedock-timer-lap',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        lapBox.insert_child_at_index(lbl, 1); // 插到提示语之后，最新在上
        // 最多保留 3 条，超出移除最旧（不向下溢出）
        while (lapBox.get_n_children() > MAX_LAPS + 1)
            lapBox.get_last_child().destroy();
        return Clutter.EVENT_STOP;
    });
    resetBtn.connect('button-press-event', () => {
        running = false; stopT(); ms = 0; lapCount = 0;
        lapBox.destroy_all_children();
        lapHint.show();
        render();
        startBtn.get_child_at_index(0).text = '开始';
        dock.setStopwatchMini?.({visible: false});
        return Clutter.EVENT_STOP;
    });

    return {
        widget: root, title: '秒表', icon: 'alarm-symbolic',
        activate() { render(); },
        deactivate() {},
        destroy() {
            stopT();
            dock.setStopwatchMini?.({visible: false});
        },
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

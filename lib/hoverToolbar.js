// 模块二：悬停工具栏。
// 悬停 ≥ hover-delay 毫秒后唤出，宽度弹性展开到 工具数×48 + padding，
// 每个工具图标从中心点依次缩放淡入（间隔 40ms）。

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {TOOL_PITCH, TOOL_DIAMETER, TOOLBAR_PADDING, TOOLBAR_HEIGHT, TOOL_STAGGER_MS, State} from './constants.js';
import {timeoutMs, clearTimeoutId} from './utils.js';
import {
    captureFullscreen,
    openScreenshotUI,
    openScreencastUI,
    toggleAudioRecording,
    isRecordingAudio,
    openPrefs,
} from './actions.js';

export function createHoverToolbar(dock, ext) {
    const settings = ext.getSettings();

    const box = new St.BoxLayout({
        style_class: 'floedock-toolbar',
        reactive: true,
        track_hover: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    // 空白区域点击 → 打开全功能面板（与"点击胶囊弹面板"一致）
    box.connect('button-press-event', (actor, event) => {
        if (event.get_button() === 1) {
            dock.setState(State.PANEL);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    const buttons = [];
    let refreshId = 0;

    const toolDefs = () => [
        {
            icon: 'camera-photo-symbolic',
            label: '截图',
            run: async () => {
                // 先收起工具栏回胶囊，再在胶囊上显示截图确认
                dock.setState(State.DOCK);
                const path = await captureFullscreen();
                dock.showOsdInfo({
                    icon: 'camera-photo-symbolic',
                    label: path ? '已截图' : '截图失败',
                });
                if (path)
                    dock.debug('screenshot saved:', path);
            },
        },
        {
            icon: 'edit-select-all-symbolic',
            label: '区域截图',
            run: () => {
                dock.setState(State.DOCK);
                openScreenshotUI();
            },
        },
        {
            icon: 'audio-input-microphone-symbolic',
            label: '录音',
            run: () => {
                const {recording, file} = toggleAudioRecording();
                dock.showOsdInfo({
                    icon: recording
                        ? 'media-record-symbolic'
                        : 'audio-input-microphone-symbolic',
                    label: recording ? '正在录音…' : '录音已停止',
                    duration: recording ? 2200 : 1200,
                });
                if (recording)
                    dock.debug('recording to', file);
            },
        },
        {
            icon: 'media-record-symbolic',
            label: '全屏录像',
            run: () => {
                dock.setState(State.DOCK);
                openScreencastUI();
            },
        },
        {
            icon: 'view-more-symbolic',
            label: '更多',
            run: () => dock.setState(State.PANEL),
        },
        {
            icon: 'settings-symbolic',
            label: '设置',
            run: () => {
                dock.setState(State.DOCK); // 先收起工具栏，避免残留浮层
                openPrefs();
            },
        },
    ];

    function build() {
        box.destroy_all_children();
        buttons.length = 0;
        for (const def of toolDefs()) {
            const btn = new St.Widget({
                style_class: 'floedock-tool',
                reactive: true,
                track_hover: true,
                can_focus: true,
                accessible_name: def.label,
                x_expand: false,
                y_expand: false,
                width: TOOL_DIAMETER,
                height: TOOL_DIAMETER,
                // BinLayout：让图标内容在圆形按钮内居中
                layout_manager: new Clutter.BinLayout(),
            });
            const icon = new St.Icon({
                icon_name: def.icon,
                icon_size: 18,
                style_class: 'floedock-tool-icon',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.add_child(icon);
            btn._def = def;
            // 每个按钮单独应用真背景模糊（工具栏整体背景透明，模糊无效）
            dock._applyBlur(btn);

            btn.connect('notify::hover', () => {
                // 悬停：轻微放大 + 亮度提升（幅度小，避免溢出工具栏）
                if (btn.hover) {
                    btn.ease({
                        scale_x: 1.08,
                        scale_y: 1.08,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                    icon.ease({
                        opacity: 255,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                } else {
                    btn.ease({
                        scale_x: 1,
                        scale_y: 1,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_BACK,
                    });
                    icon.ease({
                        opacity: 220,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                }
            });
            btn.connect('button-press-event', (actor, event) => {
                if (event.get_button() === 1) {
                    btn._def.run();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            box.add_child(btn);
            buttons.push(btn);
        }
    }

    build();
    const changedId = settings.connect('changed', () => build()); // 工具配置变化时重建

    const surface = {
        widget: box,
        _changedId: changedId,

        getSize() {
            return {
                width: buttons.length * TOOL_PITCH + 2 * TOOLBAR_PADDING,
                height: TOOLBAR_HEIGHT,
            };
        },

        onEnter() {
            // 图标从中心点依次缩放淡入
            buttons.forEach((btn, i) => {
                btn.opacity = 0;
                btn.scale_x = 0.4;
                btn.scale_y = 0.4;
                btn.ease({
                    opacity: 255,
                    scale_x: 1,
                    scale_y: 1,
                    duration: 240,
                    mode: Clutter.AnimationMode.EASE_OUT_BACK,
                    delay: i * TOOL_STAGGER_MS,
                });
            });
            // 录音中：高亮录音按钮
            if (isRecordingAudio()) {
                buttons[2]?.add_style_pseudo_class('recording');
            } else {
                buttons[2]?.remove_style_pseudo_class('recording');
            }
            refreshId = timeoutMs(1000, () => {
                refreshId = 0;
                if (isRecordingAudio())
                    buttons[2]?.add_style_pseudo_class('recording');
                else
                    buttons[2]?.remove_style_pseudo_class('recording');
            });
        },

        onLeave(animate, nextState) {
            refreshId = clearTimeoutId(refreshId);
            // 收起：图标向下淡出
            buttons.forEach((btn, i) => {
                btn.ease({
                    opacity: 0,
                    scale_x: 0.5,
                    scale_y: 0.5,
                    translation_y: 6,
                    duration: 140,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    delay: i * 12,
                });
            });
        },

        destroy() {
            refreshId = clearTimeoutId(refreshId);
            if (this._changedId) {
                settings.disconnect(this._changedId);
                this._changedId = 0;
            }
            box.destroy_all_children();
        },
    };

    return surface;
}

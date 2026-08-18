// 共享组件：Spinner / 图片 / 进度条。
// GNOME 50 移除了 St.Spinner、St.ProgressBar、St.Image，
// 此处提供替代实现（Spinner 用 Shell 自带的 ui/animation.js；图片用
// St.ImageContent；进度条用 track+fill 两个 St.Widget 自绘）。

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Spinner} from 'resource:///org/gnome/shell/ui/animation.js';

import {clamp} from './utils.js';

/** 加载动画（Shell 自带 Spinner，样式类 'spinner'）。 */
export function makeSpinner(size = 24) {
    return new Spinner(size);
}

/**
 * 图片组件：St.Widget + St.ImageContent（等比缩放、保持纵横比）。
 * @returns {{widget: St.Widget, setPixbuf, setFile, setData, clear, content}}
 */
export function makeImage({width = null, height = null, xExpand = false, yExpand = false} = {}) {
    const widget = new St.Widget({
        x_expand: xExpand,
        y_expand: yExpand,
    });
    if (width !== null)
        widget.width = width;
    if (height !== null)
        widget.height = height;
    const content = St.ImageContent.new_with_preferred_size(1, 1);
    widget.set_content(content);

    return {
        widget,
        content,
        setPixbuf(pixbuf) {
            if (!pixbuf)
                return;
            try {
                content.set_pixbuf(pixbuf);
            } catch (e) {
                logError(e, '[floedock] set_pixbuf');
            }
        },
        setFile(file) {
            try {
                content.set_file(file);
            } catch (e) {
                logError(e, '[floedock] set_file');
            }
        },
        setData(bytes) {
            try {
                content.set_data(bytes);
            } catch (e) {
                logError(e, '[floedock] set_data');
            }
        },
        clear() {
            try {
                content.clear();
            } catch (e) {
                // ignore
            }
        },
    };
}

/**
 * 进度条组件（track + fill）。
 * @returns {{widget: St.Widget, setValue: (number)=>void, setAccent: (string)=>void}}
 */
export function makeProgressBar({width = 120, height = 6} = {}) {
    const track = new St.Widget({
        width,
        height,
        reactive: false,
        x_expand: false,
        y_expand: false,
    });
    track.set_style(`
        background-color: rgba(0,0,0,0.40);
        border-radius: ${Math.round(height / 2)}px;
    `);

    const fill = new St.Widget({
        width: 0,
        height,
        y_expand: false,
        x_expand: false,
    });
    fill.set_style(`
        background-color: #7fd4ff;
        border-radius: ${Math.round(height / 2)}px;
        width: 0px;
    `);
    track.add_child(fill);

    const setValue = v => {
        const frac = clamp(v, 0, 1);
        fill._last = frac;
        fill.set_style(`
            background-color: ${fill._accent ?? '#7fd4ff'};
            border-radius: ${Math.round(height / 2)}px;
            width: ${Math.round(frac * width)}px;
            height: ${height}px;
        `);
    };
    fill._accent = null;

    return {
        widget: track,
        setValue,
        setAccent(color) {
            fill._accent = color;
            setValue(fill._last ?? 0);
        },
    };
}

// 附加模块：颜色选择器。
// Wayland 下无法直接取屏幕像素，采用「截屏 → 点击取色」方案：
// 捕获主屏截图显示在模块内，点击图片采样颜色，显示 HEX/RGB 并一键复制。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';

import {copyToClipboard} from './utils.js';
import {makeImage} from './widgets.js';

export function createColorPickerModule({dock, ext}) {
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({text: '取色', style_class: 'floedock-module-title'});
    header.add_child(title);
    header.add_child(new St.Widget({x_expand: true}));

    const captureBtn = new St.Widget({
        style_class: 'floedock-translate-go',
        reactive: true,
        track_hover: true,
    });
    const captureLabel = new St.Label({
        text: '重新截图',
        style_class: 'floedock-translate-go-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    captureBtn.add_child(captureLabel);
    header.add_child(captureBtn);
    root.add_child(header);

    const hint = new St.Label({
        text: '点击下方屏幕截图上的任意位置取色',
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
    });
    root.add_child(hint);

    const image = makeImage({xExpand: true, yExpand: true});
    image.widget.reactive = true;
    image.widget.set_style(`
        border-radius: ${Math.max(8, ext.getSettings().get_int('corner-radius') - 4)}px;
    `);
    root.add_child(image.widget);

    const resultRow = new St.BoxLayout({
        style_class: 'floedock-colorpicker-result',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const swatch = new St.Widget({
        style_class: 'floedock-colorpicker-swatch',
        width: 28,
        height: 28,
        y_align: Clutter.ActorAlign.CENTER,
    });
    resultRow.add_child(swatch);
    const hexLabel = new St.Label({
        style_class: 'floedock-colorpicker-hex',
        y_align: Clutter.ActorAlign.CENTER,
    });
    resultRow.add_child(hexLabel);
    const rgbLabel = new St.Label({
        style_class: 'floedock-colorpicker-rgb',
        y_align: Clutter.ActorAlign.CENTER,
    });
    resultRow.add_child(rgbLabel);
    const copyBtn = new St.Widget({
        style_class: 'floedock-translate-go',
        reactive: true,
        track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const copyLbl = new St.Label({
        text: '复制',
        style_class: 'floedock-translate-go-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    copyBtn.add_child(copyLbl);
    resultRow.add_child(copyBtn);
    root.add_child(resultRow);

    let pixbuf = null;

    async function capture() {
        hint.text = '正在截取屏幕…';
        const shot = new Shell.Screenshot();
        const stream = Gio.MemoryOutputStream.new_resizable();
        try {
            await shot.screenshot(false, stream);
            const bytes = stream.steal_as_bytes();
            const memStream = Gio.MemoryInputStream.new_from_bytes(bytes);
            pixbuf = GdkPixbuf.Pixbuf.new_from_stream(memStream, null);
            if (pixbuf)
                image.setPixbuf(pixbuf);
            hint.text = '点击下方屏幕截图上的任意位置取色';
        } catch (e) {
            logError(e, '[floedock] colorpicker capture');
            hint.text = '截图失败';
        }
    }

    // 点击取色：把事件坐标映射回 pixbuf 像素
    image.widget.connect('button-press-event', (actor, event) => {
        if (!pixbuf)
            return Clutter.EVENT_STOP;
        const [x, y] = event.get_coords();
        const [imgX, imgY] = image.widget.get_transformed_position();
        const imgW = image.widget.get_width();
        const imgH = image.widget.get_height();
        const pw = pixbuf.get_width();
        const ph = pixbuf.get_height();
        if (imgW <= 0 || imgH <= 0)
            return Clutter.EVENT_STOP;

        // 等比缩放映射（St.Image 保持宽高比居中）
        const scale = Math.min(imgW / pw, imgH / ph);
        const dispW = pw * scale;
        const dispH = ph * scale;
        const offX = imgX + (imgW - dispW) / 2;
        const offY = imgY + (imgH - dispH) / 2;
        const px = Math.floor((x - offX) / scale);
        const py = Math.floor((y - offY) / scale);
        if (px < 0 || py < 0 || px >= pw || py >= ph)
            return Clutter.EVENT_STOP;

        const pixels = pixbuf.get_pixels();
        const rowstride = pixbuf.get_rowstride();
        const nChannels = pixbuf.get_n_channels();
        const idx = py * rowstride + px * nChannels;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
        hexLabel.text = hex;
        rgbLabel.text = `rgb(${r}, ${g}, ${b})`;
        swatch.set_style(`background-color: ${hex}; border-radius: 6px;`);
        return Clutter.EVENT_STOP;
    });

    captureBtn.connect('button-press-event', () => {
        capture();
        return Clutter.EVENT_STOP;
    });
    copyBtn.connect('button-press-event', () => {
        copyToClipboard(hexLabel.text);
        copyLbl.text = '已复制';
        GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1200, () => {
            copyLbl.text = '复制';
        });
        return Clutter.EVENT_STOP;
    });

    return {
        widget: root,
        title: '取色',
        icon: 'color-select-symbolic',

        activate() {
            capture();
        },

        deactivate() {
        },

        destroy() {
            pixbuf = null;
        },
    };
}

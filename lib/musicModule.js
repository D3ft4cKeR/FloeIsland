// 音乐模块：MPRIS 播放器控制。
// 专辑封面模糊暗化作为模块背景；进度条可拖动；无播放时显示占位。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup';

import {MprisWatcher} from './mpris.js';
import {clamp, clearTimeoutId} from './utils.js';
import {makeImage} from './widgets.js';

const FillLayout = GObject.registerClass(
class FillLayout extends Clutter.LayoutManager {
    vfunc_allocate(container, box, flags) {
        container.set_allocation(box);
        const w = box.x2 - box.x1;
        const h = box.y2 - box.y1;
        for (const child of container.get_children()) {
            const cbox = new Clutter.ActorBox();
            cbox.x1 = 0;
            cbox.y1 = 0;
            cbox.x2 = w;
            cbox.y2 = h;
            child.allocate(cbox, flags);
        }
    }
});

export function createMusicModule({dock, ext}) {
    const settings = ext.getSettings();

    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    // --- 头部 ---
    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({text: '音乐', style_class: 'floedock-module-title'});
    header.add_child(title);
    const playerLabel = new St.Label({
        style_class: 'floedock-music-player',
        x_align: Clutter.ActorAlign.END,
        x_expand: true,
    });
    header.add_child(playerLabel);
    root.add_child(header);

    // --- 主体（封面背景 + 内容） ---
    const body = new St.Widget({
        style_class: 'floedock-music-body',
        x_expand: true,
        y_expand: true,
    });
    body.layout_manager = new FillLayout();
    root.add_child(body);

    const bgImage = makeImage({xExpand: true, yExpand: true});
    body.add_child(bgImage.widget);

    const dim = new St.Widget({
        style_class: 'floedock-music-dim',
        x_expand: true,
        y_expand: true,
    });
    body.add_child(dim);

    const content = new St.BoxLayout({
        style_class: 'floedock-music-content',
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    body.add_child(content);

    const cover = makeImage({width: 92, height: 92});
    cover.widget.x_align = Clutter.ActorAlign.CENTER;
    content.add_child(cover.widget);

    const trackLabel = new St.Label({
        style_class: 'floedock-music-track',
        x_align: Clutter.ActorAlign.CENTER,
    });
    content.add_child(trackLabel);

    const artistLabel = new St.Label({
        style_class: 'floedock-music-artist',
        x_align: Clutter.ActorAlign.CENTER,
    });
    content.add_child(artistLabel);

    // 控制按钮
    const controls = new St.BoxLayout({style_class: 'floedock-music-controls'});
    const btnPrev = makeControlButton('media-skip-backward-symbolic', '上一曲');
    const btnPlay = makeControlButton('media-playback-start-symbolic', '播放/暂停');
    const btnNext = makeControlButton('media-skip-forward-symbolic', '下一曲');
    controls.add_child(btnPrev);
    controls.add_child(btnPlay);
    controls.add_child(btnNext);
    content.add_child(controls);

    // 进度条
    const progressRow = new St.BoxLayout({
        style_class: 'floedock-music-progress-row',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const timeLabel = new St.Label({
        text: '0:00',
        style_class: 'floedock-music-time',
        y_align: Clutter.ActorAlign.CENTER,
    });
    progressRow.add_child(timeLabel);

    const track = new St.Widget({
        style_class: 'floedock-music-trackbar',
        reactive: true,
        width: 200,
        height: 8,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const fill = new St.Widget({
        style_class: 'floedock-music-trackbar-fill',
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    fill.set_style(`
        width: 0px;
        height: 4px;
        border-radius: 2px;
        background-color: ${dock.theme.accent};
    `);
    track.add_child(fill);
    progressRow.add_child(track);

    const durationLabel = new St.Label({
        text: '0:00',
        style_class: 'floedock-music-time',
        y_align: Clutter.ActorAlign.CENTER,
    });
    progressRow.add_child(durationLabel);
    content.add_child(progressRow);

    // --- 空态 ---
    const emptyBox = new St.BoxLayout({
        style_class: 'floedock-music-empty',
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    const emptyIcon = new St.Icon({
        icon_name: 'multimedia-player-symbolic',
        icon_size: 56,
        style_class: 'floedock-music-empty-icon',
        x_align: Clutter.ActorAlign.CENTER,
    });
    emptyBox.add_child(emptyIcon);
    const emptyText = new St.Label({
        text: '未在播放',
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
    });
    emptyBox.add_child(emptyText);
    root.add_child(emptyBox);

    function makeControlButton(iconName, label) {
        const btn = new St.Widget({
            style_class: 'floedock-music-control',
            reactive: true,
            track_hover: true,
            accessible_name: label,
            width: 34,
            height: 34,
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: 18,
            style_class: 'floedock-music-control-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.add_child(icon);
        btn._icon = icon; // St.Widget 无 child 属性，保存图标引用
        return btn;
    }

    // --- 数据 ---
    let watcher = null;
    let player = null;
    let posTimer = 0;
    let artSession = null;
    let changedUnsub = null;
    let seeking = false;

    function fmtTime(us) {
        const s = Math.max(0, Math.floor(us / 1e6));
        const m = Math.floor(s / 60);
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    function getArtSession() {
        if (!artSession)
            artSession = new Soup.Session();
        return artSession;
    }

    function loadCover(url) {
        if (!url) {
            cover.clear();
            bgImage.clear();
            return;
        }
        const loadFromBytes = bytes => {
            try {
                const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
                if (!pixbuf)
                    return;
                cover.setPixbuf(pixbuf);
                // 模糊背景：小图放大（双线性）模拟高斯模糊
                const w = pixbuf.get_width();
                const h = pixbuf.get_height();
                if (w > 0 && h > 0) {
                    const small = pixbuf.scale_simple(24, Math.max(1, Math.round(24 * h / w)),
                        GdkPixbuf.InterpType.BILINEAR);
                    const blurred = small.scale_simple(w, h, GdkPixbuf.InterpType.BILINEAR);
                    bgImage.setPixbuf(blurred);
                } else {
                    bgImage.setPixbuf(pixbuf);
                }
            } catch (e) {
                logError(e, '[floedock] decode art');
            }
        };

        if (url.startsWith('file://')) {
            Gio.File.new_for_uri(url).load_contents_async(null, (f, res) => {
                try {
                    const [ok, bytes] = f.load_contents_finish(res);
                    if (ok)
                        loadFromBytes(bytes);
                } catch (e) {
                    // ignore
                }
            });
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
            const msg = Soup.Message.new('GET', url);
            getArtSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    loadFromBytes(bytes);
                } catch (e) {
                    // ignore
                }
            });
        }
    }

    function syncPlayer() {
        player = watcher?.pick() ?? null;
        if (!player) {
            showEmpty();
            return;
        }
        showPlayer();
    }

    function showEmpty() {
        playerLabel.text = '';
        emptyBox.show();
        body.hide();
        stopPosTimer();
    }

    function showPlayer() {
        emptyBox.hide();
        body.show();
        const md = player.metadata;
        playerLabel.text = player.identity;
        trackLabel.text = player.title || '未知曲目';
        artistLabel.text = player.artist || player.album || '';
        loadCover(player.artUrl);

        btnPlay._icon.icon_name = player.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        const len = player.lengthUs;
        if (len > 0)
            durationLabel.text = fmtTime(len);
        else
            durationLabel.text = '--:--';
        updateProgress();
        startPosTimer();
    }

    function updateProgress() {
        if (!player || seeking)
            return;
        const len = player.lengthUs;
        const pos = player.positionUs;
        timeLabel.text = fmtTime(pos);
        const frac = len > 0 ? clamp(pos / len, 0, 1) : 0;
        setFillWidth(frac);
    }

    function startPosTimer() {
        stopPosTimer();
        posTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (player?.playing)
                updateProgress();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(posTimer, '[floedock] music pos');
    }

    function stopPosTimer() {
        posTimer = clearTimeoutId(posTimer);
    }

    // --- 控制 ---
    btnPrev.connect('button-press-event', () => {
        player?.previous();
        return Clutter.EVENT_STOP;
    });
    btnNext.connect('button-press-event', () => {
        player?.next();
        return Clutter.EVENT_STOP;
    });
    btnPlay.connect('button-press-event', () => {
        player?.playPause();
        return Clutter.EVENT_STOP;
    });

    // 可拖动进度条（Clutter 手势动作在 GNOME 50 已移除，手动处理指针事件）
    const setFillWidth = frac => {
        fill.set_style(`
            width: ${Math.round(frac * 200)}px;
            height: 4px;
            border-radius: 2px;
            background-color: ${dock.theme.accent};
        `);
    };
    let dragSeeking = false;
    const seekFromEvent = (event, commit) => {
        if (!player)
            return;
        const [tx] = track.get_transformed_position();
        const [, px] = event.get_coords();
        const frac = clamp((px - tx) / track.get_width(), 0, 1);
        const len = player.lengthUs;
        if (commit) {
            if (len > 0)
                player.setPosition(Math.round(frac * len));
            seeking = false;
            updateProgress();
        } else if (len > 0) {
            seeking = true;
            timeLabel.text = fmtTime(frac * len);
            setFillWidth(frac);
        }
    };
    track.connect('button-press-event', (a, ev) => {
        if (ev.get_button() === 1) {
            dragSeeking = true;
            seekFromEvent(ev, false);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    track.connect('motion-event', (a, ev) => {
        if (dragSeeking) {
            seekFromEvent(ev, false);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    track.connect('button-release-event', (a, ev) => {
        if (dragSeeking) {
            dragSeeking = false;
            seekFromEvent(ev, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    return {
        widget: root,
        title: '音乐',
        icon: 'multimedia-player-symbolic',

        activate() {
            const preferred = settings.get_string('music-player');
            watcher = new MprisWatcher({preferredBusName: preferred});
            changedUnsub = watcher.onChanged(() => syncPlayer());
            syncPlayer();
        },

        deactivate() {
            stopPosTimer();
            if (changedUnsub) {
                changedUnsub();
                changedUnsub = null;
            }
            if (watcher) {
                watcher.destroy();
                watcher = null;
            }
            player = null;
        },

        destroy() {
            this.deactivate();
            body.destroy_all_children();
        },
    };
}

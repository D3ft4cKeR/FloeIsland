// 音乐模块：MPRIS 播放器控制。
// 布局：左侧方形封面 + 右侧半透明白色信息面板（歌名 / 歌手 / 控制按钮）。
// 无播放时显示占位。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup';

import {MprisWatcher, PlaybackStatus} from './mpris.js';
import {clamp, clearTimeoutId} from './utils.js';
import {makeImage} from './widgets.js';

export function createMusicModule({dock, ext}) {
    const settings = ext.getSettings();

    const COVER_SIZE = 100;

    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });

    // ==================== 主体（有播放器时显示）：左封面 + 右信息 ====================
    const body = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style: 'padding: 10px 12px;',
    });

    // 左侧：方形封面（垂直居中）
    const coverWidget = makeImage({width: COVER_SIZE, height: COVER_SIZE});
    coverWidget.widget.style = 'border-radius: 12px;';
    coverWidget.widget.y_align = Clutter.ActorAlign.CENTER;
    const coverPlaceholder = new St.Icon({
        icon_name: 'audio-x-generic-symbolic',
        icon_size: 36,
        style_class: 'floedock-music-empty-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    coverWidget.widget.add_child(coverPlaceholder);
    body.add_child(coverWidget.widget);

    // 右侧：半透明白色信息面板（覆盖在封面右侧）
    const infoPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style: 'padding: 8px 12px;',
    });
    infoPanel.set_style(`
        background-color: rgba(255, 255, 255, 0.08);
        border-left: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0 12px 12px 0;
        padding: 8px 12px;
    `);
    body.add_child(infoPanel);

    // 歌曲名
    const trackLabel = new St.Label({
        style_class: 'floedock-music-track',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    infoPanel.add_child(trackLabel);

    // 歌手
    const artistLabel = new St.Label({
        style_class: 'floedock-music-artist',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    infoPanel.add_child(artistLabel);

    // 弹性间距
    const spacer = new St.Widget({y_expand: true});
    infoPanel.add_child(spacer);

    // 控制按钮（上一曲 / 播放暂停 / 下一曲）
    const controls = new St.BoxLayout({
        x_align: Clutter.ActorAlign.START,
        });
    const btnPrev = makeControlButton('media-skip-backward-symbolic', '上一曲');
    const btnPlay = makeControlButton('media-playback-start-symbolic', '播放/暂停');
    const btnNext = makeControlButton('media-skip-forward-symbolic', '下一曲');
    controls.add_child(btnPrev);
    controls.add_child(btnPlay);
    controls.add_child(btnNext);
    infoPanel.add_child(controls);

    root.add_child(body);

    function makeControlButton(iconName, label) {
        const btn = new St.Widget({
            style_class: 'floedock-music-control',
            reactive: true,
            track_hover: true,
            accessible_name: label,
            width: 30,
            height: 30,
            layout_manager: new Clutter.BinLayout(),
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: 14,
            style_class: 'floedock-music-control-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.add_child(icon);
        btn._icon = icon;
        return btn;
    }

    // ==================== 数据 ====================
    let watcher = null;
    let player = null;
    let posTimer = 0;
    let artSession = null;
    let changedUnsub = null;
    const playerUnsubs = new Map();
    let lastRenderKey = '';

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
            coverWidget.clear();
            coverPlaceholder.show();
            return;
        }
        coverPlaceholder.hide();
        const loadFromBytes = bytes => {
            try {
                const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
                if (!pixbuf)
                    return;
                coverWidget.setPixbuf(pixbuf);
            } catch (e) {
                logError(e, '[floedock] decode art');
                coverPlaceholder.show();
            }
        };

        if (url.startsWith('file://')) {
            Gio.File.new_for_uri(url).load_contents_async(null, (f, res) => {
                try {
                    const [ok, bytes] = f.load_contents_finish(res);
                    if (ok)
                        loadFromBytes(bytes);
                    else
                        coverPlaceholder.show();
                } catch (e) {
                    coverPlaceholder.show();
                }
            });
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
            const msg = Soup.Message.new('GET', url);
            getArtSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    loadFromBytes(bytes);
                } catch (e) {
                    coverPlaceholder.show();
                }
            });
        }
    }

    function reconcilePlayers() {
        const current = new Set(watcher?.players ?? []);
        for (const [p, unsub] of playerUnsubs) {
            if (!current.has(p)) {
                unsub();
                playerUnsubs.delete(p);
            }
        }
        for (const p of current) {
            if (!playerUnsubs.has(p)) {
                playerUnsubs.set(p, p.onChanged(what => {
                    if (what === 'metadata')
                        syncPlayer();
                }));
            }
        }
    }

    function syncPlayer() {
        if (!(player && watcher?.players.includes(player)
            && player.status !== PlaybackStatus.STOPPED)) {
            player = watcher?.pick() ?? null;
        }
        if (!player) {
            lastRenderKey = '';
            const names = watcher?.players.map(p => p.busName) ?? [];
            log(`[floedock] music: no player picked; found: ${names.join(', ') || '(none)'}`);
            showEmpty();
            return;
        }
        const md = player.metadata;
        const key = [
            player.busName,
            player.status,
            md['xesam:title'] ?? '',
            md['xesam:artist'] ?? '',
            md['mpris:artUrl'] ?? '',
        ].join('|');
        if (key === lastRenderKey)
            return;
        lastRenderKey = key;
        showPlayer();
    }

    function showEmpty() {
        // 默认显示布局（左封面 + 右信息），未播放时显示占位文案
        body.show();
        coverWidget.clear();
        coverPlaceholder.show();
        trackLabel.text = '未在播放';
        artistLabel.text = '打开任意播放器即可显示';
        btnPlay._icon.icon_name = 'media-playback-start-symbolic';
        stopPosTimer();
    }

    function showPlayer() {
        body.show();
        trackLabel.text = player.title || '未知曲目';
        artistLabel.text = player.artist || player.album || '';
        loadCover(player.artUrl);
        btnPlay._icon.icon_name = player.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
    }

    // 控制按钮
    btnPrev.connect('button-press-event', () => { player?.previous(); return Clutter.EVENT_STOP; });
    btnNext.connect('button-press-event', () => { player?.next(); return Clutter.EVENT_STOP; });
    btnPlay.connect('button-press-event', () => { player?.playPause(); return Clutter.EVENT_STOP; });

    function startPosTimer() {
        stopPosTimer();
        posTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (player?.playing)
                syncPlayer(); // 更新播放/暂停图标
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(posTimer, '[floedock] music pos');
    }

    function stopPosTimer() {
        posTimer = clearTimeoutId(posTimer);
    }

    return {
        widget: root,
        title: '音乐',
        icon: 'multimedia-player-symbolic',

        activate() {
            const preferred = settings.get_string('music-player');
            watcher = new MprisWatcher({preferredBusName: preferred});
            changedUnsub = watcher.onChanged(() => {
                reconcilePlayers();
                syncPlayer();
            });
            reconcilePlayers();
            syncPlayer();
            startPosTimer();
        },

        deactivate() {
            stopPosTimer();
            if (changedUnsub) {
                changedUnsub();
                changedUnsub = null;
            }
            for (const [, unsub] of playerUnsubs)
                unsub();
            playerUnsubs.clear();
            if (watcher) {
                watcher.destroy();
                watcher = null;
            }
            player = null;
            lastRenderKey = '';
        },

        destroy() {
            this.deactivate();
        },
    };
}

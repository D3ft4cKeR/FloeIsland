// 音乐模块：MPRIS 播放器控制。
// 专辑封面模糊暗化作为模块背景；进度条可拖动；无播放时显示占位。

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

const FillLayout = GObject.registerClass(
class FillLayout extends Clutter.LayoutManager {
    // GNOME 50 要求 LayoutManager 子类实现 preferred 尺寸方法，
    // 否则布局失败（"do not implement get_preferred_width/height"）→ 内容不显示
    vfunc_get_preferred_width(container, forHeight) {
        let min = 0;
        let nat = 0;
        for (const child of container.get_children()) {
            const [cmin, cnat] = child.get_preferred_width(forHeight);
            min = Math.max(min, cmin);
            nat = Math.max(nat, cnat);
        }
        return [min, nat];
    }

    vfunc_get_preferred_height(container, forWidth) {
        let min = 0;
        let nat = 0;
        for (const child of container.get_children()) {
            const [cmin, cnat] = child.get_preferred_height(forWidth);
            min = Math.max(min, cmin);
            nat = Math.max(nat, cnat);
        }
        return [min, nat];
    }

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
            child.allocate(cbox);
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

    // 无标题栏：内容区直接占满（可滚动）
    const scroll = new St.ScrollView({
        style_class: 'floedock-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        enable_mouse_scrolling: true,
    });
    // 内容舞台：直接挂到 scroll（GNOME 50 ScrollView 内部管理 viewport，
    // 手动 St.Viewport 会导致滚动失效）；body 与 emptyBox 叠放
    const stage = new St.Widget({
        x_expand: true,
        y_expand: true,
    });
    stage.layout_manager = new FillLayout();
    scroll.add_child(stage);
    root.add_child(scroll);

    // --- 主体（深色卡片，紧凑适配矮面板） ---
    const body = new St.BoxLayout({
        style_class: 'floedock-music-body',
        x_expand: true,
        y_expand: true,
    });
    stage.add_child(body);

    // 左侧：封面（64px 圆角；无封面时显示占位图标）
    const coverCol = new St.BoxLayout({
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const cover = makeImage({width: 64, height: 64});
    const coverPlaceholder = new St.Icon({
        icon_name: 'audio-x-generic-symbolic',
        icon_size: 28,
        style_class: 'floedock-music-empty-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    cover.widget.add_child(coverPlaceholder);
    coverCol.add_child(cover.widget);
    body.add_child(coverCol);

    // 右侧：信息 + 控制（纵向排布）
    const right = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'floedock-music-right',
    });
    body.add_child(right);

    // 播放器名（原标题栏位置，移到正文顶部小字显示）
    const playerLabel = new St.Label({
        style_class: 'floedock-music-player',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    right.add_child(playerLabel);

    const trackLabel = new St.Label({
        style_class: 'floedock-music-track',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    right.add_child(trackLabel);

    const artistLabel = new St.Label({
        style_class: 'floedock-music-artist',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    right.add_child(artistLabel);

    // 控制按钮（上一曲 / 播放暂停 / 下一曲）
    const controls = new St.BoxLayout({
        style_class: 'floedock-music-controls',
        x_align: Clutter.ActorAlign.START,
    });
    const btnPrev = makeControlButton('media-skip-backward-symbolic', '上一曲');
    const btnPlay = makeControlButton('media-playback-start-symbolic', '播放/暂停');
    const btnNext = makeControlButton('media-skip-forward-symbolic', '下一曲');
    controls.add_child(btnPrev);
    controls.add_child(btnPlay);
    controls.add_child(btnNext);
    right.add_child(controls);

    // 进度条
    const progressRow = new St.BoxLayout({
        style_class: 'floedock-music-progress-row',
        x_align: Clutter.ActorAlign.FILL,
        x_expand: true,
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
        x_expand: true,
        height: 6,
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
    right.add_child(progressRow);

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
        text: '未检测到播放',
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
    });
    emptyBox.add_child(emptyText);
    stage.add_child(emptyBox);

    function makeControlButton(iconName, label) {
        const btn = new St.Widget({
            style_class: 'floedock-music-control',
            reactive: true,
            track_hover: true,
            accessible_name: label,
            width: 30,
            height: 30,
            // BinLayout：图标在圆形按钮内居中
            layout_manager: new Clutter.BinLayout(),
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: 16,
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
    const playerUnsubs = new Map(); // MprisPlayer -> onChanged 取消函数
    let lastRenderKey = ''; // 上次渲染摘要，避免重复刷新

    function fmtTime(us) {
        const s = Math.max(0, Math.floor(us / 1e6));
        const m = Math.floor(s / 60);
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    // 实例名如 org.mpris.MediaPlayer2.firefox.instance1234 → 显示 "firefox"
    function displayName(p) {
        return String(p.identity).replace(/\.instance[^.]*$/, '');
    }

    function getArtSession() {
        if (!artSession)
            artSession = new Soup.Session();
        return artSession;
    }

    function loadCover(url) {
        if (!url) {
            // 浏览器等播放器通常不提供 mpris:artUrl → 清空图片，显示默认占位图标
            cover.clear();
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
                cover.setPixbuf(pixbuf);
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

    // 与 watcher 中的播放器列表对齐：为新播放器订阅 onChanged，
    // 移除已消失播放器的订阅（watcher 转发的 player-changed 与这里的
    // 订阅会重复触发，由 syncPlayer 的渲染摘要去重）
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
        // 当前播放器仍存在且未停止 → 保留；否则重新 pick（优先正在播放的）
        if (!(player && watcher?.players.includes(player)
            && player.status !== PlaybackStatus.STOPPED)) {
            player = watcher?.pick() ?? null;
        }
        if (!player) {
            lastRenderKey = '';
            // 诊断：列出检测到的 MPRIS 播放器
            const names = watcher?.players.map(p => p.busName) ?? [];
            log(`[floedock] music: no player picked; found: ${names.join(', ') || '(none)'}`);
            showEmpty();
            return;
        }
        // 播放状态/曲目/封面未变则跳过重绘（position 变化由定时器处理）
        const md = player.metadata;
        const key = [
            player.busName,
            player.status,
            md['xesam:title'] ?? '',
            md['xesam:artist'] ?? '',
            md['mpris:artUrl'] ?? '',
            player.lengthUs,
        ].join('|');
        if (key === lastRenderKey)
            return;
        lastRenderKey = key;
        log(`[floedock] music: picked ${player.busName} status=${player.status} title="${player.title}"`);
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
        playerLabel.text = displayName(player);
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
        const tw = track.get_width() || 120;
        fill.set_style(`
            width: ${Math.round(frac * tw)}px;
            height: 3px;
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
            changedUnsub = watcher.onChanged(() => {
                reconcilePlayers();
                syncPlayer();
            });
            // 创建 watcher 后立即订阅现有播放器并刷新一次
            reconcilePlayers();
            syncPlayer();
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
            body.destroy_all_children();
        },
    };
}

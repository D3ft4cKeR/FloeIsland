// 模块五：字幕展示态。
// 当 MPRIS 播放器正在播放且元数据含歌词（xesam:lyrics，支持 LRC 时间轴格式）时，
// 岛屿切换为字幕态：左侧圆形专辑封面 + 右侧逐行滚动字幕；
// 宽度随当前字幕行长度动态变化。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

import {SUBTITLE_HEIGHT, State} from './constants.js';
import {FloeMprisWatcher} from './mpris.js';
import {parseLrc, lrcIndexAt} from './lrc.js';
import {clearTimeoutId} from './utils.js';
import {makeImage} from './widgets.js';

// ---------------------------------------------------------------------------
export function createSubtitleSurface(dock, ext) {
    const theme = dock.theme;

    const root = new St.BoxLayout({
        style_class: 'floedock-subtitle',
        reactive: false,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    root.set_style(`
        background-gradient-direction: vertical;
        background-gradient-start: rgba(28,35,50,${theme.topAlpha});
        background-gradient-end: rgba(10,13,20,${theme.baseAlpha});
        border: 1px solid rgba(255,255,255,${theme.borderAlpha});
        border-radius: 999px;
        padding: 0 14px;
    `);

    const cover = makeImage({width: 36, height: 36});
    root.add_child(cover.widget);

    const textLabel = new St.Label({
        style_class: 'floedock-subtitle-text',
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.START,
    });
    root.add_child(textLabel);

    let player = null;
    let lines = [];       // parsed LRC or plain lines
    let currentIdx = 0;
    let plainIdx = 0;
    let plainTimer = 0;
    let tickTimer = 0;

    const fmtLine = text => (text ?? '').replace(/\s+/g, ' ').trim();

    function setLine(text) {
        const t = fmtLine(text);
        if (textLabel.text === t)
            return;
        // 旧行上移淡出，新行从下方上移淡入
        textLabel.ease({
            opacity: 0,
            translation_y: -10,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                textLabel.text = t;
                textLabel.opacity = 0;
                textLabel.translation_y = 10;
                textLabel.ease({
                    opacity: 255,
                    translation_y: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                resizeToText();
            },
        });
    }

    function resizeToText() {
        const [, natW] = textLabel.get_preferred_width(-1);
        const w = Math.min(480, 52 + natW + 28);
        dock.resizeFloat(w, SUBTITLE_HEIGHT,
            {duration: 260, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    function loadCover(url) {
        if (!url) {
            cover.clear();
            return;
        }
        if (url.startsWith('file://')) {
            Gio.File.new_for_uri(url).load_contents_async(null, (f, res) => {
                try {
                    const [ok, bytes] = f.load_contents_finish(res);
                    if (ok) {
                        const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                        cover.setPixbuf(GdkPixbuf.Pixbuf.new_from_stream(stream, null));
                    }
                } catch (e) {
                    // ignore
                }
            });
        }
        // http(s) 封面：字幕态为轻量展示，仅处理 file://（README 说明）
    }

    function refreshFromPlayer() {
        if (!player)
            return;
        const md = player.metadata;
        const lyrics = md['xesam:lyrics'] ?? md['xesam:asText'] ?? '';
        if (!lyrics) {
            leave();
            return;
        }
        const parsed = parseLrc(lyrics);
        if (parsed) {
            lines = parsed;
            stopPlainTimer();
            startTick();
        } else {
            lines = [];
            currentIdx = 0;
            plainIdx = 0;
            stopTick();
            startPlainTimer();
        }
        loadCover(player.artUrl);
    }

    function startTick() {
        stopTick();
        tickTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            if (!player || !player.playing) {
                return GLib.SOURCE_CONTINUE;
            }
            const posMs = player.positionUs / 1000;
            const idx = lrcIndexAt(lines, posMs);
            if (idx !== currentIdx) {
                currentIdx = idx;
                setLine(lines[idx]?.text ?? '');
            }
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(tickTimer, '[floeisland] subtitle tick');
    }

    function stopTick() {
        tickTimer = clearTimeoutId(tickTimer);
    }

    function startPlainTimer() {
        stopPlainTimer();
        plainTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2600, () => {
            if (!player || !player.playing) {
                return GLib.SOURCE_CONTINUE;
            }
            const text = player.lyrics || '';
            const plain = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            if (plain.length > 0) {
                plainIdx = (plainIdx + 1) % plain.length;
                setLine(plain[plainIdx]);
            }
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(plainTimer, '[floeisland] subtitle plain');
    }

    function stopPlainTimer() {
        plainTimer = clearTimeoutId(plainTimer);
    }

    function leave() {
        if (dock.currentState === State.SUBTITLE)
            dock.setState(State.DOCK);
    }

    return {
        widget: root,

        getSize() {
            return {width: 200, height: SUBTITLE_HEIGHT};
        },

        onEnter(params = {}) {
            player = params.player ?? null;
            if (!player) {
                leave();
                return;
            }
            textLabel.text = '';
            refreshFromPlayer();
            resizeToText();
        },

        refresh(params = {}) {
            if (params.player && params.player !== player) {
                player = params.player;
                refreshFromPlayer();
            }
        },

        onLeave(animate, nextState) {
            stopTick();
            stopPlainTimer();
            player = null;
            lines = [];
            textLabel.ease({opacity: 0, duration: 120});
        },

        destroy() {
            stopTick();
            stopPlainTimer();
        },
    };
}

// ---------------------------------------------------------------------------
// 字幕驱动：全局监听 MPRIS，有歌词且正在播放 → 切换字幕态。
// ---------------------------------------------------------------------------
export class SubtitleDriver {
    constructor(ext, dock) {
        this._ext = ext;
        this._dock = dock;
        this._watcher = new FloeMprisWatcher({
            preferredBusName: ext.getSettings().get_string('music-player'),
        });
        this._unsub = this._watcher.onChanged(() => this._sync());
        this._playerChanged = null;
        this._sync();
    }

    _sync() {
        const player = this._watcher.pick();
        if (this._playerChanged) {
            this._playerChanged();
            this._playerChanged = null;
        }
        if (!player) {
            if (this._dock.currentState === State.SUBTITLE)
                this._dock.setState(State.DOCK);
            return;
        }
        this._playerChanged = player.onChanged(what => {
            if (what !== 'metadata' && what !== 'seeked')
                return;
            const st = this._dock.currentState;
            if (st === State.DOCK || st === State.SUBTITLE) {
                const lyrics = player.metadata['xesam:lyrics'] ?? player.metadata['xesam:asText'];
                if (lyrics && player.playing)
                    this._dock.setState(State.SUBTITLE, {player});
                else if (st === State.SUBTITLE)
                    this._dock.setState(State.DOCK);
            }
        });
        // 初始检查
        const lyrics = player.metadata['xesam:lyrics'] ?? player.metadata['xesam:asText'];
        if (lyrics && player.playing && this._dock.currentState === State.DOCK)
            this._dock.setState(State.SUBTITLE, {player});
    }

    destroy() {
        if (this._playerChanged) {
            this._playerChanged();
            this._playerChanged = null;
        }
        if (this._unsub) {
            this._unsub();
            this._unsub = null;
        }
        if (this._watcher) {
            this._watcher.destroy();
            this._watcher = null;
        }
    }
}

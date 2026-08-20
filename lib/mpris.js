// MPRIS 客户端 —— 基于 gnome-shell 官方 js/ui/mpris.js (GNOME 50) 成熟实现改写。
// 出处: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/gnome-50/js/ui/mpris.js
// 关键成熟点（源自官方）：
//   · Gio.DBusProxy.makeProxyWrapper + loadInterfaceXML 生成类型化代理
//   · canPlay 门槛：只有 CanPlay 的播放器才暴露给 UI
//   · notify::g-name-owner 检测播放器断连并自动关闭
//   · Metadata 逐 key deepUnpack、属性直接访问
// 保留本扩展 musicModule 需要的 API 面（playing/title/artist/artUrl/controls/pick 等）。

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';

const DBusIface = loadInterfaceXML('org.freedesktop.DBus');
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);

const MprisIface = loadInterfaceXML('org.mpris.MediaPlayer2');
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(MprisIface);

const MprisPlayerIface = loadInterfaceXML('org.mpris.MediaPlayer2.Player');
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MprisPlayerIface);

const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';

export const PlaybackStatus = Object.freeze({
    PLAYING: 'Playing',
    PAUSED: 'Paused',
    STOPPED: 'Stopped',
});

// ---------------------------------------------------------------------------
export const MprisPlayer = GObject.registerClass({
    Properties: {
        'can-play': GObject.ParamSpec.boolean(
            'can-play', null, null, GObject.ParamFlags.READABLE, false),
    },
    Signals: {
        'changed': {},
    },
}, class MprisPlayer extends GObject.Object {
    _init(busName, {preferred = false} = {}) {
        super._init();
        this._busName = busName;
        this.preferred = preferred;
        this._canPlay = false;
        this._playerProxy = new MprisPlayerProxy(Gio.DBus.session, busName,
            '/org/mpris/MediaPlayer2', this._onPlayerProxyReady.bind(this));
        this._mprisProxy = new MprisProxy(Gio.DBus.session, busName,
            '/org/mpris/MediaPlayer2', this._onMprisProxyReady.bind(this));
    }

    get busName() {
        return this._busName;
    }

    get canPlay() {
        return this._canPlay;
    }

    get status() {
        const s = this._playerProxy.PlaybackStatus;
        return (s === 'Playing' || s === 'Paused') ? s : PlaybackStatus.STOPPED;
    }

    get playing() {
        return this.status === PlaybackStatus.PLAYING;
    }

    get metadata() {
        const meta = {};
        for (const prop in this._playerProxy.Metadata ?? {})
            meta[prop] = this._playerProxy.Metadata[prop].deepUnpack();
        return meta;
    }

    get title() {
        return this.metadata['xesam:title'] ?? '';
    }

    get artist() {
        const a = this.metadata['xesam:artist'];
        if (Array.isArray(a))
            return a.join(', ');
        return String(a ?? '');
    }

    get album() {
        return this.metadata['xesam:album'] ?? '';
    }

    get artUrl() {
        return this.metadata['mpris:artUrl'] ?? '';
    }

    get lengthUs() {
        const len = this.metadata['mpris:length'];
        return len ? Number(len) : 0;
    }

    get identity() {
        return this._mprisProxy.Identity ?? this._busName.slice(MPRIS_PLAYER_PREFIX.length);
    }

    playPause() {
        this._playerProxy.PlayPauseAsync().catch(logError);
    }

    next() {
        this._playerProxy.NextAsync().catch(logError);
    }

    previous() {
        this._playerProxy.PreviousAsync().catch(logError);
    }

    /** 订阅本播放器变化（保留模块旧 API：回调带 'metadata' 标识）。 */
    onChanged(callback) {
        const id = this.connect('changed', () => callback('metadata'));
        return () => {
            try {
                this.disconnect(id);
            } catch (e) {
                // already gone
            }
        };
    }

    _close() {
        try {
            this._playerProxy?.disconnectObject(this);
        } catch (e) {}
        this._playerProxy = null;
        try {
            this._mprisProxy?.disconnectObject(this);
        } catch (e) {}
        this._mprisProxy = null;
    }

    _onMprisProxyReady() {
        this._mprisProxy.connectObject('notify::g-name-owner', () => {
            if (!this._mprisProxy.g_name_owner)
                this._close();
        }, this);
        // 总线可能在连接前就消失，再确认一次
        if (!this._mprisProxy.g_name_owner)
            this._close();
    }

    _onPlayerProxyReady() {
        this._playerProxy.connectObject(
            'g-properties-changed', this._updateState.bind(this), this);
        this._updateState();
    }

    _updateState() {
        const canPlay = !!this._playerProxy.CanPlay;
        if (this._canPlay !== canPlay) {
            this._canPlay = canPlay;
            this.notify('can-play');
        }
        this.emit('changed');
    }

    destroy() {
        this._close();
        try {
            this.run_dispose();
        } catch (e) {}
    }
});

// ---------------------------------------------------------------------------
export const MprisWatcher = GObject.registerClass({
    Signals: {
        'player-added': {},
        'player-removed': {},
    },
}, class MprisWatcher extends GObject.Object {
    _init({preferredBusName = ''} = {}) {
        super._init();
        this._players = new Map();
        this._preferredBusName = preferredBusName;
        this._signalId = 0;
        this._proxy = new DBusProxy(Gio.DBus.session,
            'org.freedesktop.DBus', '/org/freedesktop/DBus',
            this._onProxyReady.bind(this));
    }

    /** 只暴露 canPlay（CanControl）的播放器，同官方。 */
    get players() {
        return [...this._players.values()].filter(p => p.canPlay);
    }

    onChanged(callback) {
        const ids = [
            this.connect('player-added', () => callback('player-changed')),
            this.connect('player-removed', () => callback('player-changed')),
        ];
        return () => {
            for (const id of ids) {
                try {
                    this.disconnect(id);
                } catch (e) {}
            }
        };
    }

    _addPlayer(busName) {
        if (this._players.has(busName))
            return;
        const player = new MprisPlayer(busName, {
            preferred: busName === this._preferredBusName,
        });
        this._players.set(busName, player);
        player.connectObject('notify::can-play', () => {
            if (player.canPlay)
                this.emit('player-added', player);
            else
                this.emit('player-removed', player);
        }, this);
    }

    _removePlayer(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;
        this._players.delete(busName);
        try {
            player.disconnectObject(this);
        } catch (e) {}
        if (player.canPlay)
            this.emit('player-removed', player);
        player.destroy();
    }

    async _onProxyReady() {
        try {
            const [names] = await this._proxy.ListNamesAsync();
            names.forEach(name => {
                if (name.startsWith(MPRIS_PLAYER_PREFIX))
                    this._addPlayer(name);
            });
        } catch (e) {
            // ignore
        }
        this._signalId = this._proxy.connectSignal('NameOwnerChanged',
            this._onNameOwnerChanged.bind(this));
    }

    _onNameOwnerChanged(proxy, sender, [name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PLAYER_PREFIX))
            return;
        if (oldOwner)
            this._removePlayer(name);
        if (newOwner)
            this._addPlayer(name);
    }

    /** 选一个播放器：正在播放 > 暂停 > 首选 > 任意（均限 canPlay）。 */
    pick() {
        const all = this.players;
        if (all.length === 0)
            return null;
        const preferred = all.find(p => p.preferred);
        if (preferred?.playing)
            return preferred;
        const playing = all.find(p => p.playing);
        if (playing)
            return playing;
        const paused = all.find(p => p.status === PlaybackStatus.PAUSED);
        if (paused)
            return paused;
        return preferred ?? all[0];
    }

    destroy() {
        if (this._signalId) {
            try {
                this._proxy.disconnectSignal(this._signalId);
            } catch (e) {}
            this._signalId = 0;
        }
        try {
            this._proxy?.disconnectObject(this);
        } catch (e) {}
        this._proxy = null;
        for (const p of this._players.values()) {
            try {
                p.disconnectObject(this);
            } catch (e) {}
            p.destroy();
        }
        this._players.clear();
        try {
            this.run_dispose();
        } catch (e) {}
    }
});

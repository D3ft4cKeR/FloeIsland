// MPRIS 客户端：发现 org.mpris.MediaPlayer2.* 播放器、订阅属性变化、
// 提供播放控制（播放/暂停/上一曲/下一曲/跳转）。

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const PLAYER_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const ROOT_IFACE = 'org.mpris.MediaPlayer2';

export const PlaybackStatus = Object.freeze({
    PLAYING: 'Playing',
    PAUSED: 'Paused',
    STOPPED: 'Stopped',
});

/**
 * 播放器封装：监听 Player 属性变化，暴露常用属性与操作。
 */
export class MprisPlayer {
    constructor(busName, {preferred = false} = {}) {
        this.busName = busName;
        this.preferred = preferred;
        this._signals = [];
        this._listeners = new Set(); // callbacks(updatedFlags)
        this._destroyed = false;

        this._playerProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: busName,
            g_object_path: PLAYER_PATH,
            g_interface_name: PLAYER_IFACE,
        });
        this._rootProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: busName,
            g_object_path: PLAYER_PATH,
            g_interface_name: ROOT_IFACE,
        });

        this._signals.push(this._playerProxy.connect('g-properties-changed',
            (_p, properties) => {
                this._onPropsChanged(properties);
            }));
        this._signals.push(this._playerProxy.connect('g-signal',
            (_p, sender, name) => {
                if (name === 'Seeked')
                    this._notify('seeked');
            }));

        // 异步初始化（失败时静默）；成功后通知一次，让订阅者能拿到初始
        // 播放状态/元数据（D-Bus 属性首次加载不会触发 g-properties-changed）。
        // 用回调形式而非 Promise（兼容所有 gjs 版本）。
        this._playerProxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
            try {
                proxy.init_finish(res);
                if (!this._destroyed)
                    this._notify('metadata');
            } catch (e) {
                // 播放器未响应等：静默
            }
        });
        this._rootProxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
            try {
                proxy.init_finish(res);
            } catch (e) {
                // ignore
            }
        });
    }

    /** 订阅变化。返回取消函数。 */
    onChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _notify(what) {
        for (const cb of this._listeners)
            cb(what);
    }

    _onPropsChanged(properties) {
        let changed = false;
        for (const prop in properties.deepUnpack()) {
            switch (prop) {
            case 'PlaybackStatus':
            case 'Metadata':
                changed = true;
                break;
            case 'Position':
                this._notify('position');
                break;
            }
        }
        if (changed)
            this._notify('metadata');
    }

    // --- 属性 ---
    get playable() {
        return !!this._playerProxy.get_cached_property('CanPlay');
    }

    get status() {
        return this._playerProxy.get_cached_property('PlaybackStatus')?.deepUnpack()
            ?? PlaybackStatus.STOPPED;
    }

    get playing() {
        return this.status === PlaybackStatus.PLAYING;
    }

    get canGoNext() {
        return this._playerProxy.get_cached_property('CanGoNext')?.deepUnpack() ?? false;
    }

    get canGoPrev() {
        return this._playerProxy.get_cached_property('CanGoPrevious')?.deepUnpack() ?? false;
    }

    get canControl() {
        return this._playerProxy.get_cached_property('CanControl')?.deepUnpack() ?? false;
    }

    get canSeek() {
        return this._playerProxy.get_cached_property('CanSeek')?.deepUnpack() ?? false;
    }

    get metadata() {
        return this._playerProxy.get_cached_property('Metadata')?.deepUnpack() ?? {};
    }

    get positionUs() {
        const p = this._playerProxy.get_cached_property('Position');
        // int64 deepUnpack 可能是 BigInt，统一转 Number
        return p ? Number(p.deepUnpack()) : 0;
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

    get lyrics() {
        return this.metadata['xesam:lyrics'] ?? '';
    }

    get identity() {
        return this._rootProxy.get_cached_property('Identity')?.deepUnpack()
            ?? this.busName.slice(MPRIS_PREFIX.length);
    }

    get lengthUs() {
        const len = this.metadata['mpris:length'];
        return len ? Number(len) : 0;
    }

    // --- 操作 ---
    callMethod(name, args = []) {
        if (!this.canControl && name !== 'Raise')
            return;
        this._playerProxy.call(
            name,
            new GLib.Variant(`(${args.map(a => a.t).join('')})`, args.map(a => a.v)),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null);
    }

    playPause() {
        this.callMethod('PlayPause');
    }

    next() {
        this.callMethod('Next');
    }

    previous() {
        this.callMethod('Previous');
    }

    seek(offsetUs) {
        this.callMethod('Seek', [{t: 'x', v: offsetUs}]);
    }

    setPosition(positionUs) {
        if (!this.canSeek)
            return;
        this._playerProxy.call('SetPosition',
            new GLib.Variant('(ox)', [PLAYER_PATH, positionUs]),
            Gio.DBusCallFlags.NONE, -1, null, null);
    }

    destroy() {
        this._destroyed = true;
        for (const id of this._signals) {
            try {
                this._playerProxy.disconnect(id);
            } catch (e) {
                // proxy already gone
            }
        }
        this._signals = [];
        this._listeners.clear();
    }
}

/**
 * 播放器发现器：监听 D-Bus NameOwnerChanged（arg0 前缀匹配
 * org.mpris.MediaPlayer2.*，兼容任意实例名含 .instance 后缀），
 * 维护 MprisPlayer 列表，并转发播放器属性变化。
 */
export class MprisWatcher {
    constructor({preferredBusName = ''} = {}) {
        this._players = new Map(); // busName -> MprisPlayer
        this._playerUnsubs = new Map(); // busName -> player.onChanged 取消函数
        this._listeners = new Set();
        this._preferredBusName = preferredBusName;
        this._subId = 0;

        // arg0 以 '.' 结尾 → GDBus 生成 arg0namespace 前缀匹配，
        // 覆盖 firefox / spotify / vlc 等任意实例（含 .instanceXXXX 后缀）
        this._subId = Gio.DBus.session.signal_subscribe(
            null,
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            MPRIS_PREFIX,
            Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner && !oldOwner)
                    this._add(name);
                else if (!newOwner && oldOwner)
                    this._remove(name);
            });

        // 初始枚举（ListNames 返回裸 as，deepUnpack 即字符串数组）
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/gnome/Shell', // path 不影响
            'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    const unpacked = reply.deepUnpack();
                    const names = Array.isArray(unpacked) ? unpacked
                        : (Array.isArray(unpacked?.[0]) ? unpacked[0] : []);
                    for (const name of names) {
                        if (typeof name === 'string' && name.startsWith(MPRIS_PREFIX))
                            this._add(name);
                    }
                } catch (e) {
                    // ignore
                }
            });
    }

    _add(busName) {
        if (this._players.has(busName))
            return;
        const player = new MprisPlayer(busName, {
            preferred: busName === this._preferredBusName,
        });
        this._players.set(busName, player);
        // 播放器属性变化（PlaybackStatus/Metadata）→ 转发给订阅者，
        // 让 UI 在“开始播放 / 暂停 / 换曲”时能重新 pick 并刷新
        // （Position/Seeked 高频变化不转发，进度由各 UI 自己的定时器处理）
        this._playerUnsubs.set(busName, player.onChanged(what => {
            if (what === 'metadata')
                this._notify('player-changed');
        }));
        this._notify('player-added');
    }

    _remove(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;
        const unsub = this._playerUnsubs.get(busName);
        if (unsub) {
            unsub();
            this._playerUnsubs.delete(busName);
        }
        player.destroy();
        this._players.delete(busName);
        this._notify('player-removed');
    }

    onChanged(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _notify(what) {
        for (const cb of this._listeners)
            cb(what);
    }

    /**
     * 选择播放器：正在播放(playing) 的优先，其次 paused，最后任意。
     * 用户首选（music-player 设置）在“在播”与“兜底”时优先；
     * 已停止(Stopped)的播放器不会被当作“在播/暂停”的替代选中。
     */
    pick() {
        const all = [...this._players.values()];
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

    get players() {
        return [...this._players.values()];
    }

    destroy() {
        if (this._subId) {
            Gio.DBus.session.signal_unsubscribe(this._subId);
            this._subId = 0;
        }
        for (const [, unsub] of this._playerUnsubs)
            unsub();
        this._playerUnsubs.clear();
        for (const p of this._players.values())
            p.destroy();
        this._players.clear();
        this._listeners.clear();
    }
}

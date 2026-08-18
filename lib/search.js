// 全盘文件搜索：Tracker3 / locate / 自定义命令 / 仅应用。
// 应用结果来自 Gio.AppInfo，文件结果来自所选后端命令的 stdout 行。

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {MAX_SEARCH_RESULTS} from './constants.js';
import {launchApp, openPath} from './actions.js';

/**
 * @param {object} opts {entry: St.Entry, onResults: (rows, gen) => void, ext}
 * rows: [{iconName?, gicon?, title, subtitle, run()}]
 */
export class SearchController {
    constructor({entry, onResults, ext}) {
        this._entry = entry;
        this._onResults = onResults;
        this._settings = ext.getSettings();
        this._gen = 0;
        this._debounceId = 0;
        this._proc = null;
        this._rows = [];

        this._entry.connect('text-changed', () => this._onTextChanged());
        this._entry.connect('key-press-event', (entry, event) => {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Escape) {
                if (entry.text) {
                    entry.text = '';
                    this._onTextChanged();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }
            if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
                if (this._rows.length > 0)
                    this._rows[0].run();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _onTextChanged() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        const q = this._entry.text.trim();
        if (!q) {
            this._gen++;
            this._killProc();
            this._onResults([], this._gen);
            return;
        }
        this._debounceId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 250, () => {
            this._debounceId = 0;
            this._run(q);
        });
    }

    _killProc() {
        if (this._proc) {
            try {
                this._proc.force_exit();
            } catch (e) {
                // ignore
            }
            this._proc = null;
        }
    }

    async _run(q) {
        const gen = ++this._gen;
        this._killProc();

        const apps = searchApps(q);
        let files = [];

        const backend = this._settings.get_string('search-backend');
        if (backend !== 'apps-only') {
            try {
                files = await this._runBackend(backend, q, gen);
            } catch (e) {
                logError(e, '[floedock] search backend');
            }
        }

        if (gen !== this._gen)
            return;

        const rows = [...apps, ...files].slice(0, MAX_SEARCH_RESULTS);
        this._rows = rows;
        this._onResults(rows, gen);
    }

    _runBackend(backend, q, gen) {
        return new Promise((resolve) => {
            let argv;
            if (backend === 'locate') {
                argv = ['locate', '-i', '--existing', q];
            } else if (backend === 'command') {
                const cmd = (this._settings.get_string('search-command') || '')
                    .replaceAll('{q}', q);
                argv = ['sh', '-c', cmd];
            } else {
                // tracker
                argv = ['tracker3', 'search', q];
            }

            let proc;
            try {
                proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE);
            } catch (e) {
                resolve([]);
                return;
            }
            this._proc = proc;

            const lines = [];
            const stream = proc.get_stdout_pipe();
            const readChunk = () => {
                stream.read_bytes_async(8192, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                    let bytes = null;
                    try {
                        const [ok, b] = s.read_bytes_finish(res);
                        if (ok)
                            bytes = b;
                    } catch (e) {
                        bytes = null;
                    }
                    if (!bytes) {
                        this._proc = null;
                        const rows = lines
                            .filter(Boolean)
                            .map(line => makeFileRow(line))
                            .filter(Boolean)
                            .slice(0, MAX_SEARCH_RESULTS);
                        resolve(gen === this._gen ? rows : []);
                        return;
                    }
                    lines.push(...bytes.toArray()
                        .map(b => String.fromCharCode(b)).join('')
                        .split('\n')
                        .filter(l => l.trim()));
                    readChunk();
                });
            };
            readChunk();
        });
    }

    stop() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        this._killProc();
        this._gen++;
    }

    destroy() {
        this.stop();
    }
}

function searchApps(q) {
    const needle = q.toLowerCase();
    const out = [];
    for (const info of Gio.AppInfo.get_all()) {
        const name = info.get_name() || '';
        const desc = info.get_description() || '';
        const id = info.get_id() || '';
        if (name.toLowerCase().includes(needle) ||
            desc.toLowerCase().includes(needle) ||
            id.toLowerCase().includes(needle)) {
            out.push({
                gicon: info.get_icon(),
                iconName: 'application-x-executable-symbolic',
                title: name,
                subtitle: desc || id.replace(/\.desktop$/, ''),
                run: () => launchApp(id),
            });
        }
    }
    return out;
}

function makeFileRow(line) {
    let path = line.trim();
    if (!path)
        return null;
    if (path.startsWith('file://'))
        path = Gio.File.new_for_uri(path).get_path();
    if (!path || !path.startsWith('/'))
        return null;
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return null;
    const idx = path.lastIndexOf('/');
    return {
        iconName: 'text-x-generic-symbolic',
        title: path.slice(idx + 1),
        subtitle: path.slice(0, idx),
        run: () => openPath(path),
    };
}

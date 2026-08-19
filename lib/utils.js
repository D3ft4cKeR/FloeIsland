// Small helpers shared across FloeDock modules.
// Only gi:// imports are allowed here so the file stays importable with
// a standalone `gjs` (no resource:// paths).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

// --- 缓动函数（t ∈ [0,1]）-------------------------------------------------
/** easeOutBack：过冲回弹（用于展开动画）。 */
export function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** easeOutElastic：弹性（用于通知态）。 */
export function easeOutElastic(t) {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

/** easeInCubic：快入（用于收起）。 */
export function easeInCubic(t) {
    return t * t * t;
}

/** easeOutCubic：快出。 */
export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

/**
 * Promise-based timeout. Returns a function that cancels the timer.
 * The returned promise never resolves after cancellation.
 */
export function delay(ms) {
    let id = 0;
    const promise = new Promise(resolve => {
        id = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, ms, () => resolve());
        GLib.Source.set_name_by_id(id, '[floedock] delay');
    });
    return {
        promise,
        cancel() {
            if (id) {
                GLib.source_remove(id);
                id = 0;
            }
        },
    };
}

/** One-shot timeout; returns the source id (0 = could not create). */
export function timeoutMs(ms, callback) {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        callback();
        return GLib.SOURCE_REMOVE;
    });
    GLib.Source.set_name_by_id(id, '[floedock] timeout');
    return id;
}

export function clearTimeoutId(id) {
    if (id) {
        GLib.source_remove(id);
        return 0;
    }
    return 0;
}

/**
 * Run a command without a shell. Lines of stdout are passed to `onLine`
 * (called from the main loop). `onExit` receives the exit status.
 */
export function runCommand(argv, {onLine = null, onExit = null} = {}) {
    let proc;
    try {
        proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE);
    } catch (e) {
        logError(e, '[floedock] failed to spawn command');
        onExit?.(-1);
        return null;
    }
    const stdout = proc.get_stdout_pipe();
    if (stdout && onLine) {
        readLines(stdout, onLine).catch(err =>
            logError(err, '[floedock] reading command output'));
    }
    proc.wait_check_async(null, (p, res) => {
        let status = -1;
        try {
            status = p.get_exit_status();
        } catch (e) {
            // subprocess failed to start / crashed
        }
        onExit?.(status);
    });
    return proc;
}

async function readLines(stream, onLine) {
    const buf = new Uint8Array(4096);
    let pending = '';
    while (true) {
        const {bytes, status} = await new Promise(resolve => {
            stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const [ok, bytes] = s.read_bytes_finish(res);
                    resolve({bytes: ok ? bytes : null, status: ok ? 0 : 1});
                } catch {
                    resolve({bytes: null, status: 1});
                }
            });
        });
        if (status !== 0 || !bytes)
            break;
        pending += bytes.toArray().map(b => String.fromCharCode(b)).join('');
        let idx;
        while ((idx = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, idx).replace(/\r$/, '');
            pending = pending.slice(idx + 1);
            if (line.length > 0)
                onLine(line);
        }
    }
    if (pending.length > 0)
        onLine(pending);
}

/** "2026-02-17 14-30-00" used for screenshot file names (GNOME style). */
export function screenshotTimestamp(date = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
        `${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

export function safeFilenamePart(name) {
    return String(name).replace(/[\/\\:*?"<>|]/g, '_').trim() || 'unknown';
}

/** Format a GLib.DateTime / JS Date as "HH:MM" in the user's locale. */
export function formatTime(dt) {
    try {
        if (!dt) return '';
        const date = dt instanceof Date ? dt : new Date(dt * 1000);
        if (isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
        }).format(date);
    } catch (e) {
        return '';
    }
}

/** Format a relative-ish short time for notification rows: "14:32" or "昨天". */
export function formatNoticeTime(dt) {
    let date;
    if (dt instanceof Date) {
        date = dt;
    } else if (dt && typeof dt.to_unix === 'function') {
        // GLib.DateTime
        date = new Date(dt.to_unix() * 1000);
    } else {
        date = new Date();
    }
    const now = new Date();
    const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
    if (diffDays <= 0)
        return formatTime(date);
    if (diffDays === 1)
        return '昨天';
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** Ease a widget's registered double property (e.g. 'float-width'). */
export function easeProperty(actor, prop, value, {
    duration = 400,
    mode = Clutter.AnimationMode.EASE_OUT_BACK,
    onComplete = null,
} = {}) {
    actor.ease_property(prop, value, {
        duration,
        mode,
        onComplete: onComplete || undefined,
    });
}

export function easeScale(actor, scaleX, scaleY, {
    duration = 300,
    mode = Clutter.AnimationMode.EASE_OUT_BACK,
    onComplete = null,
} = {}) {
    actor.ease({
        scale_x: scaleX,
        scale_y: scaleY,
        duration,
        mode,
        onComplete: onComplete || undefined,
    });
}

/** Fade + slight upward drift, used for text entry animations. */
export function fadeInUp(actor, {
    duration = 250,
    mode = Clutter.AnimationMode.EASE_OUT_CUBIC,
    fromY = 8,
    delayMs = 0,
} = {}) {
    actor.opacity = 0;
    actor.translation_y = fromY;
    actor.ease({
        opacity: 255,
        translation_y: 0,
        duration,
        mode,
        delay: delayMs,
    });
}

export function fadeOutUp(actor, {
    duration = 200,
    mode = Clutter.AnimationMode.EASE_IN_CUBIC,
    toY = -8,
    onComplete = null,
} = {}) {
    actor.ease({
        opacity: 0,
        translation_y: toY,
        duration,
        mode,
        onComplete: onComplete || undefined,
    });
}

/** Best-effort home dir. */
export function homeDir() {
    return GLib.get_home_dir() || GLib.getenv('HOME') || '/';
}

export function ensureDir(path) {
    try {
        GLib.mkdir_with_parents(path, 0o755);
        return true;
    } catch (e) {
        logError(e, '[floedock] mkdir failed');
        return false;
    }
}

/** Copy text to the X11/Wayland clipboard. */
export function copyToClipboard(text) {
    try {
        const clip = St.Clipboard.get_default();
        clip.set_text(St.ClipboardType.CLIPBOARD, text);
        clip.set_text(St.ClipboardType.PRIMARY, text);
    } catch (e) {
        logError(e, '[floedock] clipboard');
    }
}

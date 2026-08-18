// 壳层动作：截图 / 录屏 / 录音 / 启动应用。
// 供悬停工具栏与各模块复用。

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {homeDir, ensureDir, screenshotTimestamp} from './utils.js';

// 新版 GLib 将 DesktopAppInfo 移入 GioUnix；此处做兼容
const DesktopAppInfo = GioUnix?.DesktopAppInfo ?? Gio.DesktopAppInfo;

// ScreenshotUI 的私有 UIMode 枚举（js/ui/screenshot.js 未导出，但数值稳定）：
//   SCREENSHOT=0（交互式，可选屏幕/区域/窗口/录像）, SCREENCAST=1（直接进入录像模式）
const UIMode = {SCREENSHOT: 0, SCREENCAST: 1, SCREENSHOT_ONLY: 2};

/** 全屏截图（非交互），保存到 ~/Pictures，返回文件路径（失败返回 null）。 */
export async function captureFullscreen({includeCursor = true} = {}) {
    const dir = `${homeDir()}/Pictures`;
    ensureDir(dir);
    const file = Gio.File.new_for_path(
        `${dir}/Screenshot from ${screenshotTimestamp()}.png`);
    const shot = new Shell.Screenshot();
    const stream = Gio.MemoryOutputStream.new_resizable();
    try {
        await shot.screenshot(includeCursor, stream);
        const bytes = stream.steal_as_bytes();
        await new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(
                bytes, null, false, Gio.FileCreateFlags.NONE, null,
                (f, res) => {
                    try {
                        f.replace_contents_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
        });
        return file.get_path();
    } catch (e) {
        logError(e, '[floedock] captureFullscreen');
        return null;
    }
}

/** 打开 GNOME 交互式截图/录屏 UI（区域/窗口/屏幕选择）。 */
export function openScreenshotUI() {
    Main.screenshotUI.open().catch(e =>
        logError(e, '[floedock] openScreenshotUI'));
}

/** 打开交互式录屏 UI。 */
export function openScreencastUI() {
    Main.screenshotUI.open(UIMode.SCREENCAST).catch(e =>
        logError(e, '[floedock] openScreencastUI'));
}

// --- 录音（PipeWire） ------------------------------------------------------

let _audioRec = null; // {proc, file}

/** 切换录音。返回 {recording, file}。 */
export function toggleAudioRecording() {
    if (_audioRec) {
        try {
            _audioRec.proc.force_exit();
        } catch (e) {
            logError(e, '[floedock] stop recording');
        }
        const file = _audioRec.file;
        _audioRec = null;
        return {recording: false, file};
    }

    const dir = `${homeDir()}/Videos`;
    ensureDir(dir);
    const file = `${dir}/Record from ${screenshotTimestamp()}.flac`;

    const attempts = [
        ['pw-record', '--target', 'default', file],
        ['parec', '--file-format=wav', `${dir}/Record from ${screenshotTimestamp()}.wav`],
    ];
    let proc = null;
    for (const argv of attempts) {
        try {
            proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            if (proc) {
                _audioRec = {proc, file: argv.includes('parec') ? argv[argv.length - 1] : file};
                return {recording: true, file: _audioRec.file};
            }
        } catch (e) {
            // try next command
        }
    }
    return {recording: false, file: null};
}

/** 是否正在录音。 */
export function isRecordingAudio() {
    return _audioRec !== null;
}

// --- 应用启动 --------------------------------------------------------------

/** 通过 app id 启动应用。 */
export function launchApp(appId) {
    if (!appId)
        return false;
    try {
        const info = new DesktopAppInfo(appId);
        if (info) {
            info.launch([], null);
            return true;
        }
        // 兜底：把 appId 当命令名
        Gio.AppInfo.create_from_commandline(appId, null,
            Gio.AppInfoCreateFlags.NONE)?.launch([], null);
        return true;
    } catch (e) {
        logError(e, `[floedock] launch ${appId}`);
        return false;
    }
}

/** 用默认应用打开本地文件路径。 */
export function openPath(path) {
    if (!path)
        return false;
    try {
        return Gio.app_info_launch_default_for_uri(
            Gio.File.new_for_path(path).get_uri(), null);
    } catch (e) {
        logError(e, `[floedock] open ${path}`);
        return false;
    }
}

/** 打开 FloeDock 设置窗口。 */
export function openPrefs() {
    try {
        const proc = Gio.Subprocess.new(
            ['gnome-shell-extension-prefs', 'floedock@floedock.github.io'],
            Gio.SubprocessFlags.NONE);
        void proc;
    } catch (e) {
        logError(e, '[floedock] open prefs');
    }
}

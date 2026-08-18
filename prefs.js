// FloeDock 设置界面（GNOME Extensions Preferences, Adw）。
// 自包含实现：不 import resource:// 的 Extension 基类（某些环境下
// prefs 进程加载不到该资源），改用 Gio.Settings 直接读写。
// 分类：外观 / 行为 / 模块 / 高级。

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {SETTINGS_SCHEMA} from './lib/constants.js';

let _settings = null;

function getSettings() {
    if (!_settings)
        _settings = Gio.Settings.new(SETTINGS_SCHEMA);
    return _settings;
}

export default class FloeDockPrefs {
    // 兼容旧式 prefs 加载器
    init() {}

    buildPreferencesWindow() {
        const window = new Adw.PreferencesWindow();
        window.set_search_enabled(true);

        window.add(this._appearancePage());
        window.add(this._behaviorPage());
        window.add(this._modulesPage());
        window.add(this._advancedPage());

        return window;
    }

    // ---------- 外观 ----------
    _appearancePage() {
        const page = new Adw.PreferencesPage({
            title: '外观',
            icon_name: 'preferences-desktop-theme-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: '浮冰玻璃',
            description: '背景模糊为真模糊（Shell.BlurEffect），半透明暗底渐变叠加其上',
        });
        group.add(this._spinRow('blur-strength', '模糊强度', '0 = 无模糊，100 = 重霜', 0, 100, 1));
        group.add(this._spinRow('glass-opacity', '透明度', '玻璃底色不透明度（%），越高模糊越明显', 0, 100, 1));
        group.add(this._spinRow('corner-radius', '圆角半径', '展开面板的圆角（px）；胶囊态始终为全圆角', 0, 48, 1));
        group.add(this._entryRow('accent-color', '主题色', 'CSS 颜色，如 #7fd4ff'));
        group.add(this._spinRow('font-size', '时钟字号', '胶囊时钟文字大小（px）', 8, 48, 1));
        group.add(this._entryRow('font-family', '时钟字体', '如 DejaVu Sans Mono / Noto Sans CJK SC / Ubuntu Mono'));
        page.add(group);
        return page;
    }

    // ---------- 行为 ----------
    _behaviorPage() {
        const page = new Adw.PreferencesPage({
            title: '行为',
            icon_name: 'preferences-system-notifications-symbolic',
        });

        const group = new Adw.PreferencesGroup({title: '交互'});
        group.add(this._spinRow('hover-delay', '悬停延迟 (ms)', '悬停多久后唤出工具栏', 100, 3000, 50));
        group.add(this._switchRow('suppress-banners', '接管系统通知横幅', '禁用默认横幅，通知全部显示在岛屿上'));
        page.add(group);

        const notif = new Adw.PreferencesGroup({title: '通知展示态'});
        notif.add(this._spinRow('notif-duration', '展示时长 (秒)', '每条通知停留秒数', 1, 5, 1));
        notif.add(this._spinRow('notif-stack-depth', '堆叠深度', '后方可见的堆叠通知条数', 2, 5, 1));
        notif.add(this._enumRow('notif-anim-style', '切换动画风格',
            ['模糊消失', '上滑消失', '缩放消失']));
        page.add(notif);

        const takeover = new Adw.PreferencesGroup({title: '系统状态上岛'});
        takeover.add(this._switchRow('takeover-volume', '音量', '音量调整显示在岛屿上'));
        takeover.add(this._switchRow('takeover-brightness', '亮度', '亮度调整显示在岛屿上'));
        takeover.add(this._switchRow('takeover-mute', '静音', '静音/取消静音反馈上岛'));
        takeover.add(this._switchRow('takeover-airplane', '飞行模式', '飞行模式开关反馈上岛'));
        takeover.add(this._switchRow('takeover-mic', '麦克风', '麦克风禁用/启用反馈上岛'));
        takeover.add(this._switchRow('takeover-recording', '屏幕录制', '录屏开始/结束指示上岛'));
        takeover.add(this._switchRow('takeover-screenshot', '截图确认', '截图完成确认上岛'));
        page.add(takeover);

        return page;
    }

    // ---------- 模块 ----------
    _modulesPage() {
        const page = new Adw.PreferencesPage({
            title: '模块',
            icon_name: 'applications-system-symbolic',
        });

        const modules = new Adw.PreferencesGroup({title: '面板 Tab'});
        modules.add(this._switchRow('module-messages', '消息', '最近通知列表'));
        modules.add(this._switchRow('module-weather', '天气', 'wttr.in / OpenWeatherMap'));
        modules.add(this._switchRow('module-calendar', '日历', '农历 + 节气 + 节日'));
        modules.add(this._switchRow('module-music', '音乐', 'MPRIS 播放器控制'));
        modules.add(this._switchRow('module-timer', '计时', '倒计时 / 秒表'));
        modules.add(this._switchRow('module-translate', '翻译', '快速翻译输入'));
        modules.add(this._switchRow('module-colorpicker', '取色', '截屏取色'));
        page.add(modules);

        const weather = new Adw.PreferencesGroup({title: '天气'});
        weather.add(this._enumRow('weather-provider', '数据源', ['wttr.in（无需 Key）', 'OpenWeatherMap']));
        weather.add(this._entryRow('weather-api-key', 'API Key', 'OpenWeatherMap 需要'));
        weather.add(this._entryRow('weather-city', '城市', '如 Beijing；留空自动检测'));
        weather.add(this._enumRow('weather-unit', '单位', ['公制 (°C)', '英制 (°F)']));
        page.add(weather);

        const search = new Adw.PreferencesGroup({title: '搜索'});
        search.add(this._enumRow('search-backend', '搜索后端',
            ['Tracker3', 'Locate', '自定义命令', '仅应用']));
        search.add(this._entryRow('search-command', '自定义命令',
            '每行输出作为一个结果；用 {q} 表示查询词'));
        page.add(search);

        const music = new Adw.PreferencesGroup({title: '音乐'});
        music.add(this._entryRow('music-player', '首选播放器',
            'MPRIS 总线名，如 org.mpris.MediaPlayer2.spotify；留空自动选择'));
        page.add(music);

        return page;
    }

    // ---------- 高级 ----------
    _advancedPage() {
        const page = new Adw.PreferencesPage({
            title: '高级',
            icon_name: 'preferences-system-symbolic',
        });
        const group = new Adw.PreferencesGroup({title: '调试'});
        group.add(this._switchRow('debug', '调试模式',
            '输出详细日志：journalctl --user -b -o cat | grep floedock'));

        const resetGroup = new Adw.PreferencesGroup({title: '恢复'});
        const resetRow = new Adw.ActionRow({
            title: '重置默认值',
            subtitle: '把所有设置恢复为默认',
        });
        const resetBtn = new Gtk.Button({label: '重置', valign: Gtk.Align.CENTER});
        resetBtn.add_css_class('destructive-action');
        resetBtn.connect('clicked', () => {
            const settings = getSettings();
            for (const key of settings.settings_schema.list_keys())
                settings.reset(key);
        });
        resetRow.add_suffix(resetBtn);
        resetRow.activatable_widget = resetBtn;
        resetGroup.add(resetRow);
        page.add(resetGroup);

        const about = new Adw.PreferencesGroup({title: '关于'});
        const aboutRow = new Adw.ActionRow({
            title: 'FloeDock 浮冰灵动岛',
            subtitle: 'GNOME 50 顶部面板动态岛 · 许可证 GPL-3.0',
        });
        about.add(aboutRow);
        page.add(about);

        return page;
    }

    // ---------- 行控件 ----------
    _spinRow(key, title, subtitle, lower, upper, step) {
        const settings = getSettings();
        const adjustment = Gtk.Adjustment.new(settings.get_int(key), lower, upper, step, step, 0);
        const row = new Adw.SpinRow({title, subtitle, adjustment});
        row.value = settings.get_int(key);
        row.connect('notify::value', () => settings.set_int(key, Math.round(row.value)));
        return row;
    }

    _switchRow(key, title, subtitle) {
        const settings = getSettings();
        const row = new Adw.SwitchRow({title, subtitle});
        row.active = settings.get_boolean(key);
        row.connect('notify::active', () => settings.set_boolean(key, row.active));
        return row;
    }

    _entryRow(key, title, subtitle) {
        const settings = getSettings();
        const row = new Adw.EntryRow({title, subtitle});
        row.text = settings.get_string(key);
        row.connect('changed', () => settings.set_string(key, row.text));
        return row;
    }

    _enumRow(key, title, nicks) {
        const settings = getSettings();
        const list = new Gtk.StringList();
        for (const n of nicks)
            list.append(n);
        const row = new Adw.ComboRow({title, model: list});
        row.selected = settings.get_enum(key);
        row.connect('notify::selected', () => settings.set_enum(key, row.selected));
        return row;
    }
}

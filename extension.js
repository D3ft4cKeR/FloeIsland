// FloeIsland | 浮灵岛 — GNOME Shell 扩展入口（ESModules）。

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {FloeIslandButton} from './lib/dock.js';
import {createHoverToolbar} from './lib/hoverToolbar.js';
import {installOsdTakeover} from './lib/osdState.js';
import {createFullPanel} from './lib/fullPanel.js';
import {createNotifSurface, NotificationWatcher} from './lib/notifState.js';
import {createSubtitleSurface, SubtitleDriver} from './lib/subtitleState.js';
import {ROLE, State, SETTINGS_SCHEMA} from './lib/constants.js';

export default class FloeIslandExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._dock = new FloeIslandButton(this);
        this._dock.registerSurface(State.TOOLBAR, createHoverToolbar);
        this._dock.registerSurface(State.PANEL, createFullPanel);
        this._dock.registerSurface(State.NOTIFICATION, createNotifSurface);
        this._dock.registerSurface(State.SUBTITLE, createSubtitleSurface);

        // 接管顶部面板时钟位置（center 盒，原 dateMenu 隐藏）
        Main.panel.addToStatusArea(ROLE, this._dock, 0, 'center');
        this._hideDateMenu();

        // 系统 OSD 接管（音量/亮度/飞行模式/录屏/截图）
        this._osdTakeover = installOsdTakeover(this, this._dock);

        // 通知 → 岛屿展示
        this._notifWatcher = new NotificationWatcher(this, this._dock);

        // 字幕 → 岛屿展示（MPRIS 歌词）
        this._subtitleDriver = new SubtitleDriver(this, this._dock);

        // 会话模式变化（锁定/解锁等）后，面板会重新布局并 show() 各容器，需要再次隐藏
        this._sessionUpdatedId = Main.sessionMode.connect(
            'updated', () => {
                this._hideDateMenu();
                this._applyBannerSuppression();
                // 解锁后确保胶囊恢复到岛内：锁定时胶囊可能处于通知态/面板态
                // （被提升到 uiGroup），解锁后需要强制恢复到 DOCK 状态和位置
                if (this._dock) {
                    this._dock.forceResetCapsule();
                }
            });

        this._applyBannerSuppression();
        this._bannerSettingId = this._settings.connect('changed', (s, key) => {
            if (key === 'suppress-banners')
                this._applyBannerSuppression();
        });

        this._dock.debug('enabled');
    }

    disable() {
        if (this._bannerSettingId) {
            this._settings.disconnect(this._bannerSettingId);
            this._bannerSettingId = 0;
        }
        if (this._sessionUpdatedId) {
            Main.sessionMode.disconnect(this._sessionUpdatedId);
            this._sessionUpdatedId = 0;
        }
        if (this._osdTakeover) {
            this._osdTakeover.destroy();
            this._osdTakeover = null;
        }
        if (this._notifWatcher) {
            this._notifWatcher.destroy();
            this._notifWatcher = null;
        }
        if (this._subtitleDriver) {
            this._subtitleDriver.destroy();
            this._subtitleDriver = null;
        }
        if (this._dock) {
            this._dock.destroy();
            this._dock = null;
        }
        // 恢复系统时钟
        const dateMenu = Main.panel?.statusArea?.dateMenu;
        if (dateMenu?.container)
            dateMenu.container.show();
        // 恢复默认通知横幅
        if (Main.messageTray)
            Main.messageTray.bannerBlocked = false;
        this._settings = null;
    }

    _hideDateMenu() {
        const dateMenu = Main.panel?.statusArea?.dateMenu;
        if (dateMenu?.container && dateMenu.container.visible)
            dateMenu.container.hide();
    }

    _applyBannerSuppression() {
        if (!Main.messageTray)
            return;
        const suppress = this._settings?.get_boolean('suppress-banners') ?? true;
        Main.messageTray.bannerBlocked = suppress;
    }
}

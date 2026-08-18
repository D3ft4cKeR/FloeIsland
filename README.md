# FloeDock 浮冰灵动岛

> 一块浮在 GNOME 顶部面板时钟位置上的「浮冰雕」式灵动岛。
> 悬停唤出快捷工具栏，点击展开全功能面板；通知、字幕、音量/亮度 OSD 全部「上岛」。
> 目标环境：**Ubuntu 26.04 / GNOME 50 / Wayland / GJS (ESModules)**。

![GNOME](https://img.shields.io/badge/GNOME-50-blue) ![Shell](https://img.shields.io/badge/shell--version-50-orange) ![License](https://img.shields.io/badge/License-GPL--3.0-green)

---

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 🧊 Dock 态 | 紧凑圆角半透明胶囊，恰好覆盖面板时间日期区域，宽度随文本自适应；多层玻璃拟态 |
| 🛠 悬停工具栏 | 悬停 ≥300ms 唤出：截图 / 区域截图 / 录音 / 全屏录像 / 更多；图标依次弹性淡入 |
| 🗂 全功能面板 | 全盘搜索栏 + 六个 Tab：消息 / 天气 / 日历(农历) / 音乐 / 计时 / 翻译，可左右滑动切换 |
| 🔔 通知展示态 | 新通知上岛，卡片向后堆叠（偏移/旋转/递减），自动轮播，点击激活应用 |
| 💬 字幕展示态 | MPRIS 播放器歌词（`xesam:lyrics`，支持 LRC 时间轴）逐行滚动展示 |
| 📶 系统状态上岛 | 接管音量 / 亮度 / 静音 / 飞行模式 / 麦克风 / 录屏 / 截图确认 OSD |
| 🔒 锁屏扩展 | 锁屏时岛屿扩展为全屏：大时钟卡片 + 农历日期 + 通知列表 + 天气简况 |

## 依赖

```bash
sudo apt install gnome-shell-extension-prefs gnome-tweaks \
    gir1.2-gtop-2.0 gir1.2-clutter-1.0 gir1.2-gtk-4.0 \
    libgtk-4-dev libadwaita-1-dev gettext make zip
```

可选组件（按需）：
- 录音：`pipewire-utils`（`pw-record`，默认）或 `parec`（pulseaudio-utils）
- 搜索：`tracker3`（默认）或 `plocate`（`locate`）
- 天气：wttr.in 无需任何 Key；OpenWeatherMap 需在设置中填 API Key

## 安装

### 方式一：一键脚本（推荐）

```bash
chmod +x install.sh
./install.sh            # 校验 → 打包 → 卸载旧版 → 安装 → 启用 → 状态检查
./install.sh --uninstall   # 卸载
```

脚本会强制清空旧目录再安装，避免"改了代码但版本号不变"之类的残留问题；安装后自动检查扩展状态，ERROR 时直接给出抓日志命令。

### 方式二：手动

```bash
make zip                                   # 打包（同时校验 schema 与语法）
gnome-extensions install floedock@floedock.github.io.zip --force
gnome-extensions disable floedock@floedock.github.io   # 强制重载
gnome-extensions enable floedock@floedock.github.io
gnome-extensions info floedock@floedock.github.io      # 查看 版本/状态
```

或直接安装到用户目录：`make install`；强制重装：`make reinstall`。

> ⚠️ GNOME 50 / Wayland：修改后需要**注销重新登录**才会加载新代码；首次安装后同样需要重登录。
> 排错：`make status` 看状态，`make logs` 抓日志。

### 常见问题

| 症状 | 处理 |
| --- | --- |
| `状态: ERROR` | `make logs`，把 `JS ERROR` 和 Stack trace 发给我 |
| `enable` 提示"扩展不存在" | 刚装完还没重登录，Shell 尚未扫描到新目录 |
| 版本号不更新 | 用 `./install.sh`（会强制清空旧目录） |
| 修改代码后无变化 | Wayland 下必须注销重登录，`enable/disable` 只对已加载的扩展生效 |

卸载：`./install.sh --uninstall` 或 `make uninstall`。

## 使用

- **左键点击**胶囊 → 展开全功能面板（再次点击外部 / `Esc` 关闭）
- **悬停**胶囊 → 唤出快捷工具栏（延迟可在设置中调整）
- **通知到达** → 岛屿自动切换为通知展示态，点击卡片打开对应应用
- **调整音量 / 亮度** → OSD 显示在岛屿上（可在设置中关闭某类接管）
- **锁屏** → 岛屿扩展为全屏时钟

### 工具栏按钮

| 按钮 | 行为 |
| --- | --- |
| 📷 截图 | 立即截取全屏到 `~/Pictures` |
| 🖼 区域截图 | 打开 GNOME 交互式截图 UI |
| 🎙 录音 | 切换录音（`pw-record`），再次点击停止，文件在 `~/Videos` |
| 🎬 全屏录像 | 打开交互式录屏 UI |
| ⋯ 更多 | 直接打开全功能面板 |

### 设置（GNOME Extensions 偏好设置）

分类：**外观**（模糊强度 / 透明度 / 圆角 / 主题色 / 字号）、**行为**（悬停延迟、通知时长 / 堆叠深度 / 切换动画、各 OSD 接管开关）、**模块**（各 Tab 开关、天气数据源 / API Key / 城市、搜索后端、首选播放器）、**高级**（调试日志、重置默认值）。

## 项目结构

```
FloeDock/
├── extension.js            # 扩展入口（注册所有状态表面与驱动器）
├── metadata.json           # uuid / shell-version / settings-schema
├── prefs.js                # Adw 设置界面
├── stylesheet.css          # 玻璃拟态样式
├── schemas/                # GSettings schema（含全部设置项）
├── lib/
│   ├── dock.js             # 岛屿核心：胶囊 + 浮层 + 状态机 + 主题
│   ├── hoverToolbar.js     # 模块二：悬停工具栏
│   ├── fullPanel.js        # 模块三：搜索 / Tab / 分页面板
│   ├── search.js           # 搜索后端（tracker/locate/command/apps）
│   ├── messagesModule.js   # 消息 Tab
│   ├── weatherModule.js    # 天气 Tab（wttr.in / OpenWeatherMap）
│   ├── calendarModule.js   # 日历 Tab（农历 / 节气 / 节日）
│   ├── mpris.js            # MPRIS 客户端与播放器发现
│   ├── musicModule.js      # 音乐 Tab
│   ├── notifState.js       # 模块四：通知展示态
│   ├── subtitleState.js    # 模块五：字幕展示态
│   ├── osdState.js         # 模块六：OSD 接管
│   ├── lockOverlay.js      # 模块七：锁屏扩展
│   ├── timerModule.js      # 倒计时 / 秒表
│   ├── translateModule.js  # 翻译（MyMemory API）
│   ├── lunar.js            # 农历 / 节气 / 节日（纯 JS）
│   ├── lrc.js              # LRC 歌词解析（纯 JS）
│   ├── actions.js          # 截图 / 录屏 / 录音 / 启动应用
│   ├── constants.js        # 常量
│   └── utils.js            # 工具函数
├── po/                     # 翻译骨架（en/zh_CN）
├── tests/                  # 语法检查与农历/歌词单元测试
├── Makefile                # make check / install / zip / uninstall
└── LICENSE                 # GPL-3.0
```

## 设计说明与已知限制

- **玻璃拟态**：St（libst）不支持 CSS `backdrop-filter`，浮冰玻璃效果由「多层半透明渐变 + 高光 + 外阴影」近似；真实背景模糊需要采样舞台内容，代价过高，故未实现。
- **布局稳定**：岛屿按钮的 preferred 宽度恒等于胶囊宽度（时钟文本 + 内边距），所有展开态（工具栏 / 通知 / 面板 / OSD）都是浮层的溢出子 actor，不会推动面板上的其他元素。
- **亮度 OSD**：GNOME 50 的亮度由 Shell 自身经 `Main.osdWindowManager` 显示，可被完整接管；飞行模式经 `org.gnome.SettingsDaemon.Rfkill` 监听。
- **字幕**：依赖播放器在 MPRIS 元数据中提供 `xesam:lyrics`（或 `xesam:asText`），多数播放器不提供；LRC 文件自动跟随不在范围内（见 `lib/lrc.js` 可复用解析器）。
- **录音**：`pw-record` 需要 `pipewire-utils`；`parec` 为回退方案（raw 数据，无容器格式）。
- **多显示器**：岛屿固定在主显示器面板时钟位置；OSD 接管仅作用于主显示器。
- **性能**：所有动画均为 Clutter 属性动画（GPU 合成），无 JS 逐帧绘制；D-Bus 信号与超时均在销毁时清理。

## 调试

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep floedock
```

在设置 → 高级中开启「调试模式」后输出详细日志。

## 许可证

GPL-3.0，见 [LICENSE](LICENSE)。

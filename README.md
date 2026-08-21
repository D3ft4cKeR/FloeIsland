# FloeIsland | 浮灵岛

> 一块浮在 GNOME 顶部面板时钟位置上的「浮灵岛」Dynamic Island 式扩展。
> 悬停唤出快捷工具栏，点击展开全功能面板；通知、歌词字幕、音量/亮度 OSD 全部「上岛」。
>
> 目标环境：**Ubuntu 26.04 / GNOME 50 / Wayland / GJS (ESModules)**。

![GNOME](https://img.shields.io/badge/GNOME-50-blue) ![Version](https://img.shields.io/badge/version-1.0.0-orange) ![Shell](https://img.shields.io/badge/shell--version-50-green) ![License](https://img.shields.io/badge/License-GPL--3.0-red)

---

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 🧊 Dock 态 | 紧凑圆角胶囊，恰好覆盖面板时钟区域，宽度随文本自适应，近黑无彩色强调 |
| 🛠 悬停工具栏 | 悬停 ≥延迟唤出快捷工具栏：**截图 / 录音 / 录屏**，图标依次弹性淡入 |
| 🗂 全功能面板 | 顶部全盘搜索栏 + 六个 Tab：**消息 / 天气 / 日历(农历) / 音乐 / 秒表 / 翻译**，左右滑动切换 |
| 🔔 通知展示态 | 新通知以「灵动岛胶囊形变」上岛：岛体下移+变宽+变高成为通知卡，自动轮播，点击激活应用 |
| ⏱ 迷你小岛 | 秒表计时时，在时间岛左侧额外出现一个迷你胶囊实时显示 `MM:SS.cc` |
| 📶 系统状态上岛 | 接管音量 / 亮度 / 静音 / 飞行模式 / 麦克风 / 录屏 / 截图确认 OSD |

## 依赖

```bash
sudo apt install gnome-shell-extensions-prefs make zip unzip glib-compile-schemas
```

可选组件（按需）：
- 录音：`pipewire-utils`（`pw-record`，默认）或 `parec`
- 搜索：`tracker3`（默认）或 `plocate`（`locate`）
- 天气：wttr.in 无需 Key；OpenWeatherMap 需在设置填 API Key

## 安装（全新系统）

**一键脚本（推荐）：**

```bash
git clone https://github.com/D3ft4cKeR/FloeIsland.git
cd ./FloeIsland
./install.sh            # 校验 → 打包 → 卸载旧版 → 安装 → 启用 → 状态检查
```

一个脚本就能完成校验、打包、安装、启用和状态检查，出错时直接给出抓日志命令。安装后 **注销重新登录**（Wayland / GNOME 50 必需）即可生效。

## 卸载（无后遗症）

```bash
./uninstall.sh          #在插件文件夹打开
```

卸载脚本会：禁用扩展 → 删除扩展目录 → **清除本扩展的 GSettings 设置** → 删除临时 zip。扩展禁用后**自动恢复默认的系统通知横幅与面板日期时钟**，不会留下任何残留。

## 使用

- **左键点击**胶囊 → 展开全功能面板（鼠标点外部 / 移动到外部 / `Esc` 关闭）
- **悬停**胶囊 → 唤出快捷工具栏
- **通知到达** → 岛自动切换为通知展示态（胶囊自身形变），点击打开应用
- **调节音量/亮度** → OSD 显示在岛上
- **秒表计时** → 时间岛左侧出现迷你小岛实时显示计时

### 工具栏按钮

| 按钮 | 行为 |
| --- | --- |
| 📷 截图 | 立即截图到 `~/Pictures` |
| 🎙 录音 | 切换录音（`pw-record`），再点停止，文件在 `~/Videos` |
| 🎬 录屏 | 打开交互式录屏 UI |

### 全功能面板 Tab

| Tab | 说明 |
| --- | --- |
| 消息 | 最近通知列表，可滚动、单条删除、一键清空 |
| 天气 | 当前天气 + 逐小时/逐日预报（wttr.in / OpenWeatherMap） |
| 日历 | 当日农历 + 生肖 + 节日/节气，卡片布局 |
| 音乐 | MPRIS 播放器控制：封面 + 歌名/歌手 + 上一曲/播放/下一曲 |
| 秒表 | 开始/暂停、计次（最多 3 条）、重置；计时时左侧显示迷你小岛 |
| 翻译 | 在线翻译（MyMemory API 等） |

搜索栏：输入实时搜索**应用 + 文件 + 「浏览器(必应)搜索」**，结果卡单击即可打开/启动。

### 设置（GNOME Extensions 偏好）

**不可用！**

## 项目结构

```
FloeIsland/
├── install.sh            # 一键安装 / 卸载脚本
├── uninstall.sh          # 独立卸载脚本（无后遗症）
├── extension.js          # 扩展入口（注册所有状态表面与驱动器）
├── metadata.json         # uuid / shell-version / settings-schema / 版本
├── prefs.js              # Adw 设置界面
├── stylesheet.css        # 玻璃拟态样式
├── schemas/              # GSettings schema（含全部设置项）
├── lib/
│   ├── dock.js           # 岛屿核心：胶囊 + 浮层 + 状态机 + 形变动画 + 主题
│   ├── hoverToolbar.js   # 悬停工具栏（截图 / 录音 / 录屏）
│   ├── fullPanel.js      # 搜索 / Tab / 分页面板
│   ├── search.js         # 搜索后端（tracker/locate/command/apps）+ 普通应用启动
│   ├── messagesModule.js # 消息 Tab
│   ├── weatherModule.js  # 天气 Tab
│   ├── calendarModule.js # 日历 Tab（农历 / 节气 / 节日）
│   ├── mpris.js          # MPRIS 客户端与播放器发现（对齐 gnome-shell 官方实现）
│   ├── musicModule.js    # 音乐 Tab
│   ├── stopwatchModule.js# 秒表 Tab（含迷你小岛驱动）
│   ├── notifState.js     # 通知展示态（胶囊形变动画 + 系统通知接入）
│   ├── subtitleState.js  # 字幕展示态
│   ├── osdState.js       # OSD 接管
│   ├── translateModule.js# 翻译 Tab
│   ├── lunar.js          # 农历 / 节气 / 节日（纯 JS）
│   ├── lrc.js            # LRC 歌词解析（纯 JS）
│   ├── actions.js        # 截图 / 录屏 / 录音 / 打开文件
│   ├── constants.js      # 常量（UUID / schema / 尺寸）
│   └── utils.js          # 工具函数
├── po/                   # 翻译骨架
├── tests/                # 语法检查与农历/歌词单元测试
├── Makefile              # make check / test / zip / install / uninstall
└── LICENSE               # GPL-3.0
```

## 设计说明

- **动画**：通知展示态与里界面均为**胶囊自身形变**（下移/拉宽/拉高/圆角过渡）的插值动画，先横后纵、有始有终，有几率跳闪突然消失；面板内容预布局，动画只动胶囊几何以减少重绘。
- **通知接管**：通过 `MessageTray` 的官方 `bannerBlocked` 屏蔽系统横幅，通知仍进通知中心/消息 Tab；任意状态到达的通知回到 Dock 后都会上岛展示。
- **布局稳定**：岛屿 preferred 宽度恒等于胶囊宽度，所有展开态均为浮层子 actor，不推挤面板其他元素。
- **多显示器**：岛屿固定在主显示器面板时钟位置；OSD 接管仅作用于主显示器。
- **性能 / 稳定性**：所有定时器与 D-Bus 订阅在销毁时清理；禁用/卸载后恢复系统默认行为。

## 调试

```bash
make logs                            # journalctl 抓 floeisland 日志
journalctl -f -o cat /usr/bin/gnome-shell | grep floeisland
```

在设置 → 高级开启「调试模式」后日志更详细。

## 制作人

- **D3ft4cKeR** — 项目构想与持续开发
- **DeepSeek v4 Flash with DeepSeek Harness** — 架构实现、动画/交互调优、代码生成
- **Xiaomi Mimo V2.5 with MimoCode** — 协同开发与迭代

## 许可证

GPL-3.0，见 [LICENSE](LICENSE)。

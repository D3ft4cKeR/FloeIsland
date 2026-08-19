#!/usr/bin/env bash
# ============================================================================
# FloeIsland | 浮灵岛 — 卸载脚本
#
# 用法:  ./uninstall.sh
#
# 作用: 禁用并删除扩展目录，并清除本扩展保存的设置（若存在），做到无后遗症。
# ============================================================================
set -euo pipefail

UUID="floeisland@floeisland.github.io"
BASE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
EXT_DIR="$BASE_DIR/$UUID"

info() { printf '\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
skip() { printf '\033[1;33m  · %s\033[0m\n' "$*"; }

info "卸载 FloeIsland | 浮灵岛 ($UUID)"

# 1. 禁用扩展
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" 2>/dev/null && ok "已禁用扩展" || skip "扩展本就未启用/无法禁用"
else
    skip "未找到 gnome-extensions，跳过禁用"
fi

# 2. 删除扩展目录
if [ -d "$EXT_DIR" ]; then
    rm -rf "$EXT_DIR"
    ok "已删除扩展目录 $EXT_DIR"
else
    skip "扩展目录不存在：$EXT_DIR"
fi

# 3. 清除本扩展的 GSettings 设置（如有残留）
if command -v dconf >/dev/null 2>&1; then
    if dconf read "/org/gnome/shell/extensions/floeisland/" >/dev/null 2>&1; then
        dconf reset -f /org/gnome/shell/extensions/floeisland/ 2>/dev/null || true
        ok "已清除扩展设置"
    else
        skip "无本扩展设置残留"
    fi
else
    skip "未找到 dconf，跳过设置清理（一般不会残留）"
fi

# 4. 删除随安装生成的临时 zip（如有）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$SCRIPT_DIR/$UUID.zip"
[ -f "$ZIP" ] && rm -f "$ZIP" && ok "已删除临时包 $ZIP" || true

info "完成。FloeIsland 已完全卸载，无后遗症。重新登录后生效。"

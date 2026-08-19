#!/usr/bin/env bash
# ============================================================================
# FloeIsland | 浮灵岛 — 一键安装 / 更新 / 卸载脚本
#
# 用法:
#   ./install.sh         安装或更新（校验→打包→卸载旧版→安装→启用→检查）
#   ./install.sh --uninstall   卸载
#   ./install.sh --reload      Shell 内热重载扩展（仅 X11；Wayland 请重登录）
#
# 说明: 每次安装都会先完整删除旧目录，避免"版本号没更新"之类的残留问题。
# ============================================================================
set -euo pipefail

UUID="floeisland@floeisland.github.io"
BASE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
EXT_DIR="$BASE_DIR/$UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$SCRIPT_DIR/$UUID.zip"

info()  { printf '\033[1;36m== %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m  ✘ %s\033[0m\n' "$*"; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }

uninstall() {
    info "卸载 $UUID"
    gnome-extensions disable "$UUID" 2>/dev/null || true
    rm -rf "$EXT_DIR"
    if command -v dconf >/dev/null 2>&1; then
        dconf reset -f /org/gnome/shell/extensions/floeisland/ 2>/dev/null || true
    fi
    ok "已删除 $EXT_DIR 并清除本扩展设置（如存在）"
}

# ---------------------------------------------------------------------------
if [ "${1:-}" = "--uninstall" ]; then
    uninstall
    exit 0
fi

# --- 前置检查 ---------------------------------------------------------------
have make   || fail "缺少 make（sudo apt install make）"
have zip    || fail "缺少 zip（sudo apt install zip）"
have unzip  || fail "缺少 unzip（sudo apt install unzip）"
have gnome-extensions || fail "缺少 gnome-extensions"
have glib-compile-schemas || fail "缺少 glib-compile-schemas（sudo apt install libglib2.0-bin）"

# --- 1. 校验 -----------------------------------------------------------------
info "1/5 校验 schema 与语法"
( cd "$SCRIPT_DIR" && make check )

# --- 2. 打包 -----------------------------------------------------------------
info "2/5 打包"
rm -f "$ZIP"
( cd "$SCRIPT_DIR" && make zip ) || ( cd "$SCRIPT_DIR" && make zip )

# --- 3. 卸载旧版 --------------------------------------------------------------
info "3/5 移除旧版本（避免残留）"
gnome-extensions disable "$UUID" 2>/dev/null || true
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"

# --- 4. 安装 -----------------------------------------------------------------
info "4/5 安装到 $EXT_DIR"
unzip -qo "$ZIP" -d "$EXT_DIR"
if [ -d "$EXT_DIR/schemas" ]; then
    glib-compile-schemas "$EXT_DIR/schemas" && ok "编译 GSettings schema"
fi

# --- 5. 启用并检查 ------------------------------------------------------------
info "5/5 启用扩展"
gnome-extensions enable "$UUID"

STATUS="$(gnome-extensions info "$UUID" 2>/dev/null | grep '状态' || true)"
echo "  $STATUS"
if echo "$STATUS" | grep -q 'ERROR'; then
    warn "扩展加载报错，抓取日志："
    echo "  journalctl --user -b -o cat | grep -B 2 -A 25 floeisland | tail -60"
    exit 1
fi

if echo "$STATUS" | grep -q '已启用: 是'; then
    ok "安装成功！"
    echo ""
    echo "下一步:"
    echo "  · X11   → 按 Alt+F2 输入 r 回车，或注销重登录"
    echo "  · Wayland → 注销重新登录"
    echo "  · 验证  → gnome-extensions info $UUID"
    echo "  · 日志  → journalctl --user -b -o cat | grep -B 2 -A 25 floeisland | tail -60"
else
    warn "扩展已安装但未处于启用状态，请注销重新登录后再执行:"
    echo "  gnome-extensions enable $UUID"
fi

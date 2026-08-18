# FloeDock 浮冰灵动岛 — build / install helpers
#
# 常用命令:
#   make check        校验 schema + 全部 JS 语法
#   make test         运行单元测试（农历 / 节气 / 节日 / LRC）
#   make zip          打包为可安装 zip
#   make install      安装到用户扩展目录（不校验，最快）
#   make reinstall    强制重装（删旧目录 → 校验 → 打包 → 安装 → 启用）
#   make status       查看扩展状态
#   make logs         抓取 floedock 相关日志
#   make uninstall    卸载
#
# 推荐直接用 ./install.sh 一键脚本（含状态检查与错误提示）。

UUID = floedock@floedock.github.io
SCHEMA = org.gnome.shell.extensions.floedock.gschema.xml
EXT_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

# 打包时包含的顶层内容（.ref/、tests/、Makefile、install.sh 等不入包）
ZIP_CONTENTS = metadata.json extension.js prefs.js stylesheet.css lib schemas po README.md LICENSE

.PHONY: check test zip install reinstall uninstall status logs clean

## 校验 schema 与源码（不安装）
check:
	@echo "== schema =="
	glib-compile-schemas --strict schemas/
	@echo "== syntax =="
	@node tests/check-syntax.mjs
	@rm -f schemas/gschemas.compiled

## 单元测试（农历 / 节气 / 节日 / LRC 解析）
test:
	@node tests/lunar.test.mjs
	@node tests/lrc.test.mjs

## 打包为可安装 zip
zip: check
	rm -f $(UUID).zip
	zip -qr $(UUID).zip $(ZIP_CONTENTS) -x schemas/gschemas.compiled
	@echo "Built $(UUID).zip"

## 快速安装（不做校验，适合已校验过的情况）
install:
	mkdir -p $(EXT_DIR)
	cp metadata.json extension.js prefs.js stylesheet.css $(EXT_DIR)/
	cp -r lib $(EXT_DIR)/
	cp -r schemas $(EXT_DIR)/
	@if [ -d po ]; then cp -r po $(EXT_DIR)/; fi
	glib-compile-schemas $(EXT_DIR)/schemas 2>/dev/null || true
	@echo "Installed to $(EXT_DIR) — log out/in (Wayland) or Alt+F2 r (X11) to activate."

## 强制重装（删旧目录 → 校验 → 打包 → 安装 → 启用 → 状态）
reinstall: check
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(EXT_DIR)
	mkdir -p $(EXT_DIR)
	cp metadata.json extension.js prefs.js stylesheet.css $(EXT_DIR)/
	cp -r lib $(EXT_DIR)/
	cp -r schemas $(EXT_DIR)/
	@if [ -d po ]; then cp -r po $(EXT_DIR)/; fi
	glib-compile-schemas $(EXT_DIR)/schemas
	gnome-extensions enable $(UUID)
	@echo "--- status ---"
	@gnome-extensions info $(UUID) | grep -E "版本|状态|已启用" || true

## 查看扩展状态
status:
	@gnome-extensions info $(UUID) | grep -E "版本|状态|已启用|路径" || echo "扩展未安装"

## 抓取 floedock 相关日志
logs:
	@journalctl --user -b -o cat | grep -B 2 -A 25 floedock | tail -80

uninstall:
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(EXT_DIR)
	@echo "Removed $(EXT_DIR)"

clean:
	rm -f $(UUID).zip
	rm -f schemas/gschemas.compiled

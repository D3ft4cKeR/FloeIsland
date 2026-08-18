# FloeDock 浮冰灵动岛 — build / install helpers
UUID = floedock@floedock.github.io
SCHEMA = org.gnome.shell.extensions.floedock.gschema.xml
EXT_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

# 打包时包含的顶层内容（.ref/、tests/、Makefile 等不入包）
ZIP_CONTENTS = metadata.json extension.js prefs.js stylesheet.css lib schemas po README.md LICENSE

.PHONY: check install uninstall zip clean test

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

## 安装到用户扩展目录（需要重新登录生效）
install: check
	mkdir -p $(EXT_DIR)
	cp metadata.json extension.js prefs.js stylesheet.css $(EXT_DIR)/
	cp -r lib $(EXT_DIR)/
	cp -r schemas $(EXT_DIR)/
	@if [ -d po ]; then cp -r po $(EXT_DIR)/; fi
	@echo "Installed to $(EXT_DIR)"
	@echo "Restart the session (log out/in) to activate."

uninstall:
	rm -rf $(EXT_DIR)
	@echo "Removed $(EXT_DIR)"

## 打包为可安装 zip
zip: check
	rm -f $(UUID).zip
	zip -qr $(UUID).zip $(ZIP_CONTENTS) -x schemas/gschemas.compiled
	@echo "Built $(UUID).zip"
	@echo "Install with:  gnome-extensions install $(UUID).zip --force"
	@echo "Enable with:   gnome-extensions enable $(UUID)"

clean:
	rm -f $(UUID).zip
	rm -f schemas/gschemas.compiled

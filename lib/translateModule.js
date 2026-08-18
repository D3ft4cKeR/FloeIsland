// 附加模块：翻译快速输入。
// 默认使用 MyMemory 免费 API（无需 Key），支持 中↔英 方向切换；
// 结果可一键复制到剪贴板。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Soup from 'gi://Soup';

import {copyToClipboard} from './utils.js';
import {makeSpinner} from './widgets.js';

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

export function createTranslateModule({dock, ext}) {
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({text: '翻译', style_class: 'floedock-module-title'});
    header.add_child(title);
    header.add_child(new St.Widget({x_expand: true}));

    // 方向切换：中→英 / 英→中
    const dirBtn = new St.Widget({
        style_class: 'floedock-translate-dir',
        reactive: true,
        track_hover: true,
    });
    const dirLabel = new St.Label({
        text: '中 → EN',
        style_class: 'floedock-translate-dir-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    dirBtn.add_child(dirLabel);
    header.add_child(dirBtn);
    root.add_child(header);

    let zhToEn = true;

    const inputRow = new St.BoxLayout({style_class: 'floedock-translate-inputrow'});
    const input = new St.Entry({
        style_class: 'floedock-translate-input',
        hint_text: '输入要翻译的文本…',
        can_focus: true,
        x_expand: true,
    });
    inputRow.add_child(input);
    const goBtn = new St.Widget({
        style_class: 'floedock-translate-go',
        reactive: true,
        track_hover: true,
    });
    const goLabel = new St.Label({
        text: '翻译',
        style_class: 'floedock-translate-go-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    goBtn.add_child(goLabel);
    inputRow.add_child(goBtn);
    root.add_child(inputRow);

    const resultBox = new St.BoxLayout({
        style_class: 'floedock-translate-result',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    root.add_child(resultBox);

    const statusLabel = new St.Label({
        text: '输入文本后点击「翻译」',
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    resultBox.add_child(statusLabel);

    const spinner = makeSpinner(24);
    spinner.hide();
    resultBox.add_child(spinner);

    const resultText = new St.Label({
        style_class: 'floedock-translate-result-text',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
        y_expand: true,
    });
    resultText.hide();
    resultBox.add_child(resultText);

    const copyRow = new St.BoxLayout({x_align: Clutter.ActorAlign.START});
    const copyBtn = new St.Widget({
        style_class: 'floedock-translate-go',
        reactive: true,
        track_hover: true,
    });
    const copyLabel = new St.Label({
        text: '复制',
        style_class: 'floedock-translate-go-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    copyBtn.add_child(copyLabel);
    copyRow.add_child(copyBtn);
    copyRow.hide();
    resultBox.add_child(copyRow);

    let session = null;
    let generation = 0;

    function getSession() {
        if (!session)
            session = new Soup.Session();
        return session;
    }

    function setStatus(text) {
        statusLabel.text = text;
        statusLabel.show();
        resultText.hide();
        copyRow.hide();
    }

    async function translate() {
        const q = input.text.trim();
        if (!q)
            return;
        const gen = ++generation;
        statusLabel.hide();
        spinner.show();
        spinner.play();

        const langpair = zhToEn ? 'zh|en' : 'en|zh';
        const url = `${MYMEMORY_URL}?q=${encodeURIComponent(q)}&langpair=${langpair}`;

        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('Accept', 'application/json');
        try {
            const bytes = await new Promise((resolve, reject) => {
                getSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                    try {
                        resolve(s.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            if (gen !== generation)
                return;
            spinner.stop();
            spinner.hide();
            const data = JSON.parse(new TextDecoder().decode(bytes.toArray()));
            const translated = data?.responseData?.translatedText;
            if (translated && translated !== 'NO QUERY SPECIFIED') {
                resultText.text = translated;
                resultText.show();
                copyRow.show();
            } else {
                setStatus('翻译失败：' + (data?.responseStatus ?? 'unknown'));
            }
        } catch (e) {
            if (gen !== generation)
                return;
            spinner.stop();
            spinner.hide();
            setStatus('网络请求失败（需要联网）');
        }
    }

    goBtn.connect('button-press-event', () => {
        translate();
        return Clutter.EVENT_STOP;
    });
    input.connect('key-press-event', (entry, ev) => {
        if (ev.get_key_symbol() === Clutter.KEY_Return) {
            translate();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    dirBtn.connect('button-press-event', () => {
        zhToEn = !zhToEn;
        dirLabel.text = zhToEn ? '中 → EN' : 'EN → 中';
        return Clutter.EVENT_STOP;
    });
    copyBtn.connect('button-press-event', () => {
        copyToClipboard(resultText.text);
        copyLabel.text = '已复制';
        GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1200, () => {
            copyLabel.text = '复制';
        });
        return Clutter.EVENT_STOP;
    });

    return {
        widget: root,
        title: '翻译',
        icon: 'input-keyboard-symbolic',

        activate() {
            input.text = '';
            setStatus('输入文本后点击「翻译」');
        },

        deactivate() {
            generation++;
            spinner.stop();
        },

        destroy() {
            generation++;
            spinner.stop();
        },
    };
}

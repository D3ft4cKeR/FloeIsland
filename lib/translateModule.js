// 附加模块：翻译快速输入。
// 默认使用 MyMemory 免费 API（无需 Key）。
// 特性：
//  - 9 个常用语言方向，右上角按钮点击循环切换（中↔英 / 中→日韩法德西 / 日韩→中）；
//  - 输入停顿 700ms 自动翻译（防抖），点「翻译」或回车强制翻译；
//  - 中↔英 两个方向支持自动检测：CJK 字符占比 > 30% 判为中文（中→英），否则英→中；
//  - 结果可一键复制到剪贴板；网络失败 / API 错误 / 空输入均有明确状态提示。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Soup from 'gi://Soup';

import {clearTimeoutId, copyToClipboard} from './utils.js';
import {makeSpinner} from './widgets.js';

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const DEBOUNCE_MS = 700;
const EMPTY_HINT = '输入文本后自动翻译，或点「翻译」';

// 语言方向表（MyMemory langpair）。auto=true 的方向在翻译时会按输入内容
// 自动检测中↔英；其余方向固定使用所选 langpair。
const DIRECTIONS = [
    {label: '中 → 英', pair: 'zh|en', auto: true},
    {label: '英 → 中', pair: 'en|zh', auto: true},
    {label: '中 → 日', pair: 'zh|ja'},
    {label: '中 → 韩', pair: 'zh|ko'},
    {label: '中 → 法', pair: 'zh|fr'},
    {label: '中 → 德', pair: 'zh|de'},
    {label: '中 → 西', pair: 'zh|es'},
    {label: '日 → 中', pair: 'ja|zh'},
    {label: '韩 → 中', pair: 'ko|zh'},
];
const PAIR_LABELS = {};
for (const d of DIRECTIONS)
    PAIR_LABELS[d.pair] = d.label;

// 简单启发式：统计 CJK 表意字符占非空白字符的比例，> 30% 判定为中文。
function cjkRatio(text) {
    let cjk = 0;
    let total = 0;
    for (const ch of text) {
        if (/\s/.test(ch))
            continue;
        total++;
        const code = ch.codePointAt(0);
        if ((code >= 0x3400 && code <= 0x4DBF) ||   // CJK 扩展 A
            (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK 统一表意文字
            (code >= 0xF900 && code <= 0xFAFF))     // CJK 兼容表意文字
            cjk++;
    }
    return total === 0 ? 0 : cjk / total;
}

function detectPair(q) {
    return cjkRatio(q) > 0.3 ? 'zh|en' : 'en|zh';
}

export function createTranslateModule({dock, ext}) {
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    // --- 标题行：标题 + 右侧方向切换按钮 ---
    const header = new St.BoxLayout({style_class: 'floedock-module-header'});
    const title = new St.Label({
        text: '翻译',
        style_class: 'floedock-module-title',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    header.add_child(title);

    const dirBtn = new St.Widget({
        style_class: 'floedock-translate-dir',
        reactive: true,
        track_hover: true,
        can_focus: true,
        accessible_name: '切换翻译方向',
        layout_manager: new Clutter.BinLayout(), // 文字居中
    });
    const dirLabel = new St.Label({
        text: DIRECTIONS[0].label,
        style_class: 'floedock-translate-dir-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    dirBtn.add_child(dirLabel);
    header.add_child(dirBtn);
    root.add_child(header);

    // --- 内容区：ScrollView > Viewport > vbox（可滚动） ---
    const scroll = new St.ScrollView({
        style_class: 'floedock-scroll',
        x_expand: true,
        y_expand: true,
        overlay_scrollbars: true,
        hscrollbar_policy: St.PolicyType.NEVER,
    });
    const vbox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    const viewport = new St.Viewport({x_expand: true});
    viewport.add_child(vbox);
    scroll.add_child(viewport);
    root.add_child(scroll);

    // 内容宽度跟随 scroll（与消息/日历模块同理，内容延伸到面板右侧）
    const syncWidth = () => {
        const w = scroll.get_width();
        if (w > 0 && vbox.width !== w)
            vbox.width = w;
    };
    syncWidth();
    scroll.connect('notify::allocation', syncWidth);
    root.connect('notify::allocation', syncWidth);

    // --- 输入行：输入框 + 「翻译」按钮 ---
    const inputRow = new St.BoxLayout({
        style_class: 'floedock-translate-inputrow',
        x_expand: true,
    });
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
        layout_manager: new Clutter.BinLayout(), // 文字居中
    });
    const goLabel = new St.Label({
        text: '翻译',
        style_class: 'floedock-translate-go-label',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    goBtn.add_child(goLabel);
    inputRow.add_child(goBtn);
    vbox.add_child(inputRow);

    // --- 结果卡片（深色卡片，同日历模块视觉语言） ---
    const card = new St.BoxLayout({
        style_class: 'floedock-calendar-card',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    vbox.add_child(card);

    const statusLabel = new St.Label({
        text: EMPTY_HINT,
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    card.add_child(statusLabel);

    const loadingRow = new St.BoxLayout({
        style_class: 'floedock-translate-loading',
        x_align: Clutter.ActorAlign.CENTER,
    });
    const spinner = makeSpinner(16);
    const loadingLabel = new St.Label({
        text: '翻译中…',
        style_class: 'floedock-empty',
    });
    loadingRow.add_child(spinner);
    loadingRow.add_child(loadingLabel);
    loadingRow.hide();
    card.add_child(loadingRow);

    // 自动检测方向且与所选方向不一致时的小提示
    const dirHint = new St.Label({
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    dirHint.set_style('font-size: 9.5pt;');
    dirHint.hide();
    card.add_child(dirHint);

    const resultText = new St.Label({
        style_class: 'floedock-translate-result-text',
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });
    resultText.clutter_text.line_wrap = true; // 长文本自动换行
    resultText.hide();
    card.add_child(resultText);

    const copyRow = new St.BoxLayout({x_align: Clutter.ActorAlign.START});
    const copyBtn = new St.Widget({
        style_class: 'floedock-translate-go',
        reactive: true,
        track_hover: true,
        layout_manager: new Clutter.BinLayout(), // 文字居中
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
    card.add_child(copyRow);

    // --- 状态 ---
    let dirIndex = 0;
    let session = null;
    let generation = 0;
    let debounceId = 0;
    let copyResetId = 0;

    function getSession() {
        if (!session)
            session = new Soup.Session();
        return session;
    }

    function stopLoading() {
        loadingRow.hide();
        spinner.stop();
    }

    function setStatus(text) {
        stopLoading();
        statusLabel.text = text;
        statusLabel.show();
        resultText.hide();
        copyRow.hide();
        dirHint.hide();
    }

    function showLoading() {
        statusLabel.hide();
        resultText.hide();
        copyRow.hide();
        dirHint.hide();
        loadingRow.show();
        spinner.play();
    }

    function showResult(text, hint) {
        stopLoading();
        resultText.text = text;
        resultText.show();
        copyRow.show();
        if (hint) {
            dirHint.text = hint;
            dirHint.show();
        }
    }

    // 当前生效的 langpair：中↔英 两个方向按输入自动检测，其余方向固定。
    function getEffectivePair(q) {
        const dir = DIRECTIONS[dirIndex];
        return dir.auto ? detectPair(q) : dir.pair;
    }

    // 自动检测把方向从所选默认切换成了另一侧时，返回提示文案。
    function autoHint(pair) {
        const dir = DIRECTIONS[dirIndex];
        if (!dir.auto || pair === dir.pair)
            return '';
        return `已自动识别方向：${PAIR_LABELS[pair]}`;
    }

    async function translate() {
        debounceId = clearTimeoutId(debounceId);
        const q = input.text.trim();
        if (!q) {
            setStatus('输入内容为空');
            return;
        }
        const gen = ++generation; // 竞态：旧请求返回时不再更新 UI
        showLoading();

        const pair = getEffectivePair(q);
        const url = `${MYMEMORY_URL}?q=${encodeURIComponent(q)}&langpair=${pair}`;
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
                return; // 已有更新的请求接管 UI

            const httpStatus = msg.get_status();
            if (httpStatus !== 200) {
                setStatus(`网络请求失败（HTTP ${httpStatus}）`);
                return;
            }

            const data = JSON.parse(new TextDecoder().decode(bytes.toArray()));
            const apiStatus = Number(data?.responseStatus);
            const translated = data?.responseData?.translatedText;
            if (apiStatus === 200 && translated && translated !== 'NO QUERY SPECIFIED') {
                showResult(translated, autoHint(pair));
            } else if (apiStatus === 200) {
                setStatus('翻译失败：服务返回空结果');
            } else {
                const detail = data?.responseDetails ? `（${data.responseDetails}）` : '';
                const code = Number.isFinite(apiStatus) ? apiStatus : '异常响应';
                setStatus(`翻译失败：服务错误 ${code}${detail}`);
            }
        } catch (e) {
            if (gen !== generation)
                return;
            setStatus('网络请求失败（需要联网）');
        }
    }

    // 输入变化：作废在途请求 → 700ms 防抖后自动翻译；清空输入则回到提示态。
    input.connect('changed', () => {
        generation++;
        debounceId = clearTimeoutId(debounceId);
        const q = input.text.trim();
        if (!q) {
            setStatus(EMPTY_HINT);
            return;
        }
        debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            debounceId = 0;
            translate();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(debounceId, '[floedock] translate debounce');
    });

    // 回车强制翻译
    input.connect('key-press-event', (entry, ev) => {
        const sym = ev.get_key_symbol();
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
            translate();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    goBtn.connect('button-press-event', () => {
        translate();
        return Clutter.EVENT_STOP;
    });

    // 循环切换语言方向；输入非空时立即用新方向重译
    dirBtn.connect('button-press-event', () => {
        dirIndex = (dirIndex + 1) % DIRECTIONS.length;
        dirLabel.text = DIRECTIONS[dirIndex].label;
        dirHint.hide();
        if (input.text.trim())
            translate();
        return Clutter.EVENT_STOP;
    });

    copyBtn.connect('button-press-event', () => {
        copyToClipboard(resultText.text);
        copyLabel.text = '已复制';
        copyResetId = clearTimeoutId(copyResetId);
        copyResetId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1200, () => {
            copyResetId = 0;
            copyLabel.text = '复制';
        });
        return Clutter.EVENT_STOP;
    });

    return {
        widget: root,
        title: '翻译',
        icon: 'input-keyboard-symbolic',

        activate() {
            generation++;
            debounceId = clearTimeoutId(debounceId);
            stopLoading();
            dirHint.hide();
            input.text = ''; // 触发 changed → 回到提示态
            setStatus(EMPTY_HINT);
        },

        deactivate() {
            generation++;
            debounceId = clearTimeoutId(debounceId);
            stopLoading();
        },

        destroy() {
            generation++;
            debounceId = clearTimeoutId(debounceId);
            copyResetId = clearTimeoutId(copyResetId);
            stopLoading();
        },
    };
}

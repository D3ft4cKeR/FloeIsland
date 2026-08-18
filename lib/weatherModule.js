// 天气模块：wttr.in（无需 Key）/ OpenWeatherMap（需 API Key）。
// 数据通过 libsoup3 异步获取；加载动画（Spinner + 逐项淡入）、错误态。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Soup from 'gi://Soup';

import {fadeInUp} from './utils.js';
import {makeSpinner} from './widgets.js';

const WTTR_BASE = 'https://wttr.in';
const OWM_BASE = 'https://api.openweathermap.org/data/2.5';

const WEATHER_ICONS = {
    113: 'weather-clear-symbolic',
    116: 'weather-few-clouds-symbolic',
    119: 'weather-clouds-symbolic',
    122: 'weather-overcast-symbolic',
    143: 'weather-fog-symbolic',
    176: 'weather-showers-symbolic',
    179: 'weather-snow-symbolic',
    182: 'weather-snow-rain-symbolic',
    185: 'weather-snow-rain-symbolic',
    200: 'weather-storm-symbolic',
    227: 'weather-snow-symbolic',
    230: 'weather-snow-symbolic',
    248: 'weather-fog-symbolic',
    260: 'weather-fog-symbolic',
    263: 'weather-showers-symbolic',
    266: 'weather-showers-symbolic',
    281: 'weather-showers-symbolic',
    284: 'weather-showers-symbolic',
    293: 'weather-showers-symbolic',
    296: 'weather-showers-symbolic',
    299: 'weather-rain-symbolic',
    302: 'weather-rain-symbolic',
    305: 'weather-rain-symbolic',
    308: 'weather-rain-symbolic',
    311: 'weather-rain-symbolic',
    314: 'weather-rain-symbolic',
    317: 'weather-rain-symbolic',
    320: 'weather-rain-symbolic',
    323: 'weather-snow-symbolic',
    326: 'weather-snow-symbolic',
    329: 'weather-snow-symbolic',
    332: 'weather-snow-symbolic',
    335: 'weather-snow-symbolic',
    338: 'weather-snow-symbolic',
    350: 'weather-snow-symbolic',
    353: 'weather-showers-symbolic',
    356: 'weather-showers-symbolic',
    359: 'weather-rain-symbolic',
    362: 'weather-snow-rain-symbolic',
    365: 'weather-snow-rain-symbolic',
    368: 'weather-snow-symbolic',
    371: 'weather-snow-symbolic',
    374: 'weather-snow-symbolic',
    377: 'weather-snow-rain-symbolic',
    386: 'weather-storm-symbolic',
    389: 'weather-storm-symbolic',
    392: 'weather-storm-symbolic',
    395: 'weather-storm-symbolic',
};

function wttrIcon(code) {
    return WEATHER_ICONS[code] ?? 'weather-clear-symbolic';
}

function owmIcon(id) {
    const c = Math.floor(id / 100);
    if (id >= 200 && id < 300)
        return 'weather-storm-symbolic';
    if (id >= 300 && id < 400)
        return 'weather-showers-symbolic';
    if (id >= 500 && id < 600)
        return 'weather-rain-symbolic';
    if (id >= 600 && id < 700)
        return 'weather-snow-symbolic';
    if (id >= 700 && id < 800)
        return 'weather-fog-symbolic';
    if (id === 800)
        return 'weather-clear-symbolic';
    if (id === 801)
        return 'weather-few-clouds-symbolic';
    if (id <= 804)
        return 'weather-clouds-symbolic';
    void c;
    return 'weather-clear-symbolic';
}

/**
 * 轻量天气摘要（锁屏 / 通知等场景复用）。
 * @returns {Promise<{tempC:number|null, desc:string, iconName:string}|null>}
 */
export async function fetchWeatherBrief(settings) {
    const provider = settings.get_string('weather-provider');
    const city = settings.get_string('weather-city').trim();
    const session = new Soup.Session();

    const fetchJson = url => new Promise(resolve => {
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('Accept', 'application/json');
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                resolve(JSON.parse(new TextDecoder().decode(bytes.toArray())));
            } catch (e) {
                resolve(null);
            }
        });
    });

    try {
        if (provider === 'wttr') {
            const url = city
                ? `${WTTR_BASE}/${encodeURIComponent(city)}?format=j1`
                : `${WTTR_BASE}/?format=j1`;
            const data = await fetchJson(url);
            const cur = data?.current_condition?.[0];
            if (!cur)
                return null;
            return {
                tempC: Number(cur.temp_C) || null,
                desc: cur.weatherDesc?.[0]?.value ?? '',
                iconName: wttrIcon(Number(cur.weatherCode)),
            };
        }
        const key = settings.get_string('weather-api-key').trim();
        if (!key)
            return null;
        const url = `${OWM_BASE}/weather?q=${encodeURIComponent(city || 'Beijing')}&appid=${key}&units=metric&lang=zh_cn`;
        const data = await fetchJson(url);
        if (!data?.main)
            return null;
        return {
            tempC: Math.round(data.main.temp),
            desc: data.weather?.[0]?.description ?? '',
            iconName: owmIcon(data.weather?.[0]?.id ?? 800),
        };
    } catch (e) {
        logError(e, '[floedock] weather brief');
        return null;
    } finally {
        session.abort();
    }
}

export function createWeatherModule({dock, ext}) {
    const settings = ext.getSettings();

    // 与消息模块一致的结构：root = 垂直 BoxLayout，
    // header 固定顶部，内容区（scroll）撑满剩余空间；
    // viewport 撑满宽度，内容逐项占满，不再堆在左边
    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const header = new St.BoxLayout({
        style_class: 'floedock-module-header',
        x_expand: true,
    });
    const title = new St.Label({
        text: '天气',
        style_class: 'floedock-module-title',
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    header.add_child(title);
    const refreshBtn = new St.Widget({
        style_class: 'floedock-icon-button',
        reactive: true,
        width: 26,
        height: 26,
        accessible_name: '刷新',
        // BinLayout：图标居中
        layout_manager: new Clutter.BinLayout(),
    });
    const refreshIcon = new St.Icon({
        icon_name: 'view-refresh-symbolic',
        icon_size: 14,
        style_class: 'floedock-icon-button-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    refreshBtn.add_child(refreshIcon);
    header.add_child(refreshBtn);
    root.add_child(header);

    // 内容区可滚动：viewport 撑满宽度，内容占满整行
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
        y_expand: true,
    });
    const vp = new St.Viewport({x_expand: true});
    vp.add_child(vbox);
    scroll.add_child(vp);
    root.add_child(scroll);

    // 内容宽度跟随内容区（与消息模块 syncListWidth 同理，避免挤在左边）
    const syncWidth = () => {
        const w = scroll.get_width();
        if (w > 0 && vbox.width !== w)
            vbox.width = w;
    };
    syncWidth();
    scroll.connect('notify::allocation', syncWidth);
    root.connect('notify::allocation', syncWidth);

    // 加载态
    const loadingBox = new St.BoxLayout({
        style_class: 'floedock-weather-loading',
        x_expand: true,
        y_expand: true,
    });
    const spinner = makeSpinner(28);
    const loadingLabel = new St.Label({text: '加载天气数据…', style_class: 'floedock-empty'});
    loadingBox.add_child(spinner);
    loadingBox.add_child(loadingLabel);
    vbox.add_child(loadingBox);

    // 错误态
    const errorLabel = new St.Label({
        style_class: 'floedock-empty',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    errorLabel.hide();
    vbox.add_child(errorLabel);

    // 内容态
    const content = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    content.hide();
    vbox.add_child(content);

    // --- 当前天气 ---
    const nowRow = new St.BoxLayout({
        style_class: 'floedock-weather-now',
        x_expand: true,
    });
    const nowIcon = new St.Icon({icon_size: 44, style_class: 'floedock-weather-now-icon'});
    nowRow.add_child(nowIcon);
    const nowV = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
    const tempLabel = new St.Label({
        style_class: 'floedock-weather-temp',
        x_align: Clutter.ActorAlign.START,
    });
    nowV.add_child(tempLabel);
    const descLabel = new St.Label({
        style_class: 'floedock-weather-desc',
        x_align: Clutter.ActorAlign.START,
    });
    nowV.add_child(descLabel);
    nowRow.add_child(nowV);
    content.add_child(nowRow);

    // --- 今日详情（2 列网格：竖向排布改为左右两列，减少高度） ---
    const detailGrid = new St.BoxLayout({
        style_class: 'floedock-weather-details',
        x_expand: true,
    });
    const detailColA = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style_class: 'floedock-weather-detail-col',
    });
    const detailColB = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style_class: 'floedock-weather-detail-col',
    });
    detailGrid.add_child(detailColA);
    detailGrid.add_child(detailColB);
    content.add_child(detailGrid);

    let session = null;
    let generation = 0;

    function getSession() {
        if (!session)
            session = new Soup.Session();
        return session;
    }

    function fetchJson(url, gen) {
        return new Promise((resolve) => {
            const msg = Soup.Message.new('GET', url);
            msg.request_headers.append('Accept', 'application/json');
            getSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                if (gen !== generation) {
                    resolve(null);
                    return;
                }
                try {
                    const bytes = s.send_and_read_finish(res);
                    const text = new TextDecoder().decode(bytes.toArray());
                    resolve(JSON.parse(text));
                } catch (e) {
                    logError(e, '[floedock] weather fetch');
                    resolve(null);
                }
            });
        });
    }

    function showLoading() {
        spinner.play();
        loadingBox.show();
        errorLabel.hide();
        content.hide();
    }

    function showError(msg) {
        spinner.stop();
        loadingBox.hide();
        errorLabel.text = msg || '天气数据加载失败';
        errorLabel.show();
        content.hide();
    }

    function showContent() {
        spinner.stop();
        loadingBox.hide();
        errorLabel.hide();
        content.show();
    }

    // 详情项交替放入左右两列（2 列网格），每行撑满列宽
    let detailIdx = 0;
    function setDetail(key, value) {
        const row = new St.BoxLayout({
            style_class: 'floedock-weather-detail',
            x_expand: true,
        });
        const k = new St.Label({text: key, style_class: 'floedock-weather-detail-key'});
        const v = new St.Label({
            text: value,
            style_class: 'floedock-weather-detail-value',
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
        });
        row.add_child(k);
        row.add_child(v);
        (detailIdx++ % 2 === 0 ? detailColA : detailColB).add_child(row);
        return row;
    }

    function fillWttr(data) {
        const cur = data.current_condition?.[0];
        const today = data.weather?.[0];
        if (!cur)
            return false;

        tempLabel.text = `${cur.temp_C ?? '--'}°`;
        descLabel.text = cur.weatherDesc?.[0]?.value ?? '';
        nowIcon.icon_name = wttrIcon(Number(cur.weatherCode));

        setDetail('体感', `${cur.FeelsLikeC ?? '--'}°`);
        setDetail('最高/最低', `${today?.maxtempC ?? '--'}° / ${today?.mintempC ?? '--'}°`);
        setDetail('降水概率', `${today?.hourly?.[0]?.chanceofrain ?? '--'}%`);
        setDetail('湿度', `${cur.humidity ?? '--'}%`);
        setDetail('风速', `${cur.windspeedKmph ?? '--'} km/h`);
        setDetail('紫外线', cur.uvIndex ?? '--');
        setDetail('能见度', `${cur.visibility ?? '--'} km`);
        const astro = data.weather?.[0]?.astronomy?.[0];
        if (astro) {
            setDetail('日出', astro.sunrise ?? '--');
            setDetail('日落', astro.sunset ?? '--');
        }
        return true;
    }

    function fillOwm(data) {
        const cur = data;
        tempLabel.text = `${Math.round(cur.main?.temp ?? 0)}°`;
        descLabel.text = cur.weather?.[0]?.description ?? '';
        nowIcon.icon_name = owmIcon(cur.weather?.[0]?.id ?? 800);

        setDetail('体感', `${Math.round(cur.main?.feels_like ?? 0)}°`);
        setDetail('最高/最低',
            `${Math.round(cur.main?.temp_max ?? 0)}° / ${Math.round(cur.main?.temp_min ?? 0)}°`);
        setDetail('湿度', `${cur.main?.humidity ?? '--'}%`);
        setDetail('风速', `${Math.round((cur.wind?.speed ?? 0) * 3.6)} km/h`);
        setDetail('气压', `${cur.main?.pressure ?? '--'} hPa`);
        setDetail('能见度', `${(cur.visibility / 1000).toFixed(1)} km`);
        setDetail('日出', new Date(cur.sys?.sunrise * 1000).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit',
        }));
        setDetail('日落', new Date(cur.sys?.sunset * 1000).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit',
        }));
        return true;
    }

    function clearDetailGrid() {
        detailColA.destroy_all_children();
        detailColB.destroy_all_children();
        detailIdx = 0;
    }

    async function load() {
        const gen = ++generation;
        clearDetailGrid();
        showLoading();

        const provider = settings.get_string('weather-provider');
        const city = settings.get_string('weather-city').trim();
        let ok = false;

        if (provider === 'wttr') {
            const url = city
                ? `${WTTR_BASE}/${encodeURIComponent(city)}?format=j1`
                : `${WTTR_BASE}/?format=j1`;
            const data = await fetchJson(url, gen);
            if (data)
                ok = fillWttr(data);
        } else {
            const key = settings.get_string('weather-api-key').trim();
            const loc = city || 'Beijing';
            if (key) {
                const url = `${OWM_BASE}/weather?q=${encodeURIComponent(loc)}&appid=${key}&units=metric&lang=zh_cn`;
                const data = await fetchJson(url, gen);
                if (data)
                    ok = fillOwm(data);
            }
        }

        if (gen !== generation)
            return;
        if (ok) {
            showContent();
            // 内容逐项淡入
            [...content.get_children()].forEach((child, i) => {
                fadeInUp(child, {duration: 300, delayMs: i * 90, fromY: 10});
            });
        } else {
            showError(provider === 'openweather' && !settings.get_string('weather-api-key')
                ? '未配置 OpenWeatherMap API Key'
                : '天气数据加载失败');
        }
    }

    refreshBtn.connect('button-press-event', () => {
        load();
        return Clutter.EVENT_STOP;
    });

    return {
        widget: root,
        title: '天气',
        icon: 'weather-clear-symbolic',

        activate() {
            load();
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

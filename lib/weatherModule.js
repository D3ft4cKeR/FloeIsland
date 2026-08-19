// 天气模块：wttr.in / OpenWeatherMap。三栏：左温度+图标 / 中5项 / 右4项。

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Soup from 'gi://Soup';

import {fadeInUp} from './utils.js';
import {makeSpinner} from './widgets.js';

const WTTR_BASE = 'https://wttr.in';
const OWM_BASE = 'https://api.openweathermap.org/data/2.5';
const WEATHER_ICONS = {
    113: 'weather-clear-symbolic', 116: 'weather-few-clouds-symbolic',
    119: 'weather-clouds-symbolic', 122: 'weather-overcast-symbolic',
    143: 'weather-fog-symbolic', 176: 'weather-showers-symbolic',
    179: 'weather-snow-symbolic', 182: 'weather-snow-rain-symbolic',
    185: 'weather-snow-rain-symbolic', 200: 'weather-storm-symbolic',
    227: 'weather-snow-symbolic', 230: 'weather-snow-symbolic',
    248: 'weather-fog-symbolic', 260: 'weather-fog-symbolic',
    263: 'weather-showers-symbolic', 266: 'weather-showers-symbolic',
    293: 'weather-showers-symbolic', 296: 'weather-showers-symbolic',
    299: 'weather-rain-symbolic', 302: 'weather-rain-symbolic',
    305: 'weather-rain-symbolic', 308: 'weather-rain-symbolic',
    311: 'weather-rain-symbolic', 314: 'weather-rain-symbolic',
    323: 'weather-snow-symbolic', 326: 'weather-snow-symbolic',
    329: 'weather-snow-symbolic', 332: 'weather-snow-symbolic',
    353: 'weather-showers-symbolic', 356: 'weather-showers-symbolic',
    359: 'weather-rain-symbolic', 362: 'weather-snow-rain-symbolic',
    368: 'weather-snow-symbolic', 371: 'weather-snow-symbolic',
    386: 'weather-storm-symbolic', 389: 'weather-storm-symbolic',
    392: 'weather-storm-symbolic', 395: 'weather-storm-symbolic',
};
function wttrIcon(c) { return WEATHER_ICONS[c] ?? 'weather-clear-symbolic'; }
function owmIcon(id) {
    if (id >= 200 && id < 300) return 'weather-storm-symbolic';
    if (id >= 300 && id < 400) return 'weather-showers-symbolic';
    if (id >= 500 && id < 600) return 'weather-rain-symbolic';
    if (id >= 600 && id < 700) return 'weather-snow-symbolic';
    if (id >= 700 && id < 800) return 'weather-fog-symbolic';
    if (id === 800) return 'weather-clear-symbolic';
    if (id === 801) return 'weather-few-clouds-symbolic';
    if (id <= 804) return 'weather-clouds-symbolic';
    return 'weather-clear-symbolic';
}

export async function fetchWeatherBrief(settings) {
    const provider = settings.get_string('weather-provider');
    const city = settings.get_string('weather-city').trim();
    const session = new Soup.Session();
    const fetchJson = url => new Promise(resolve => {
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('Accept', 'application/json');
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try { resolve(JSON.parse(new TextDecoder().decode(s.send_and_read_finish(res).toArray()))); }
            catch { resolve(null); }
        });
    });
    try {
        if (provider === 'wttr') {
            const url = city ? `${WTTR_BASE}/${encodeURIComponent(city)}?format=j1` : `${WTTR_BASE}/?format=j1`;
            const data = await fetchJson(url);
            const cur = data?.current_condition?.[0];
            if (!cur) return null;
            return {tempC: Number(cur.temp_C) || null, desc: cur.weatherDesc?.[0]?.value ?? '', iconName: wttrIcon(Number(cur.weatherCode))};
        }
        const key = settings.get_string('weather-api-key').trim();
        if (!key) return null;
        const data = await fetchJson(`${OWM_BASE}/weather?q=${encodeURIComponent(city || 'Beijing')}&appid=${key}&units=metric&lang=zh_cn`);
        if (!data?.main) return null;
        return {tempC: Math.round(data.main.temp), desc: data.weather?.[0]?.description ?? '', iconName: owmIcon(data.weather?.[0]?.id ?? 800)};
    } catch { return null; } finally { session.abort(); }
}

export function createWeatherModule({dock, ext}) {
    const settings = ext.getSettings();
    const K = 'color: rgba(255,255,255,0.50); font-size: 9.5pt;';
    const V = 'color: rgba(255,255,255,0.92); font-size: 9.5pt;';

    const root = new St.BoxLayout({
        style_class: 'floedock-module',
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });

    const loadingBox = new St.BoxLayout({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const spinner = makeSpinner(28);
    loadingBox.add_child(spinner);
    loadingBox.add_child(new St.Label({text: '加载天气…', style_class: 'floedock-empty'}));
    root.add_child(loadingBox);

    const errorLabel = new St.Label({style_class: 'floedock-empty', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
    errorLabel.hide();
    root.add_child(errorLabel);

    const content = new St.BoxLayout({x_expand: true});
    content.hide();
    root.add_child(content);

    // 左栏：温度 + 亮色图标 + 描述
    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true,
        y_align: Clutter.ActorAlign.CENTER, });
    const tempLabel = new St.Label({style_class: 'floedock-weather-temp', x_align: Clutter.ActorAlign.START});
    leftCol.add_child(tempLabel);
    const nowIcon = new St.Icon({icon_size: 40, style_class: 'floedock-weather-now-icon'});
    nowIcon.set_style('color: #ffd78f;'); // 亮金色图标
    leftCol.add_child(nowIcon);
    const descLabel = new St.Label({style_class: 'floedock-weather-desc', x_align: Clutter.ActorAlign.START});
    leftCol.add_child(descLabel);
    content.add_child(leftCol);

    // 中栏：5项信息
    const midCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true,
        y_align: Clutter.ActorAlign.CENTER, });
    function makeD(p, l) {
        const r = new St.BoxLayout({});
        const k = new St.Label({text: l}); k.set_style(K);
        const v = new St.Label({x_align: Clutter.ActorAlign.END, x_expand: true}); v.set_style(V);
        r.add_child(k); r.add_child(v); p.add_child(r); return v;
    }
    const feelsV = makeD(midCol, '体感');
    const humidV = makeD(midCol, '湿度');
    const windV = makeD(midCol, '风速');
    const visV = makeD(midCol, '能见度');
    const highV = makeD(midCol, '高/低');
    content.add_child(midCol);

    // 右栏：4项信息
    const rightCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true,
        y_align: Clutter.ActorAlign.CENTER, });
    const uvV = makeD(rightCol, '紫外线');
    const riseV = makeD(rightCol, '日出');
    const setV = makeD(rightCol, '日落');
    const rainV = makeD(rightCol, '降水');
    content.add_child(rightCol);

    let session = null, generation = 0;
    function getSession() { if (!session) session = new Soup.Session(); return session; }
    function fetchJson(url, gen) {
        return new Promise(resolve => {
            const msg = Soup.Message.new('GET', url);
            msg.request_headers.append('Accept', 'application/json');
            getSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                if (gen !== generation) { resolve(null); return; }
                try { resolve(JSON.parse(new TextDecoder().decode(s.send_and_read_finish(res).toArray()))); }
                catch { resolve(null); }
            });
        });
    }
    function showLoading() { spinner.play(); loadingBox.show(); errorLabel.hide(); content.hide(); }
    function showError(msg) { spinner.stop(); loadingBox.hide(); errorLabel.text = msg || '天气加载失败'; errorLabel.show(); content.hide(); }
    function showContent() { spinner.stop(); loadingBox.hide(); errorLabel.hide(); content.show(); }

    function fillWttr(data) {
        const cur = data.current_condition?.[0], today = data.weather?.[0];
        if (!cur) return false;
        tempLabel.text = `${cur.temp_C ?? '--'}°`;
        descLabel.text = cur.weatherDesc?.[0]?.value ?? '';
        nowIcon.icon_name = wttrIcon(Number(cur.weatherCode));
        feelsV.text = `${cur.FeelsLikeC ?? '--'}°`;
        humidV.text = `${cur.humidity ?? '--'}%`;
        windV.text = `${cur.windspeedKmph ?? '--'} km/h`;
        visV.text = `${cur.visibility ?? '--'} km`;
        highV.text = `${today?.maxtempC ?? '--'}° / ${today?.mintempC ?? '--'}°`;
        uvV.text = cur.uvIndex ?? '--';
        const astro = today?.astronomy?.[0];
        riseV.text = astro?.sunrise ?? '--';
        setV.text = astro?.sunset ?? '--';
        rainV.text = `${today?.hourly?.[0]?.chanceofrain ?? '--'}%`;
        return true;
    }
    function fillOwm(d) {
        const c = d;
        tempLabel.text = `${Math.round(c.main?.temp ?? 0)}°`;
        descLabel.text = c.weather?.[0]?.description ?? '';
        nowIcon.icon_name = owmIcon(c.weather?.[0]?.id ?? 800);
        feelsV.text = `${Math.round(c.main?.feels_like ?? 0)}°`;
        humidV.text = `${c.main?.humidity ?? '--'}%`;
        windV.text = `${Math.round((c.wind?.speed ?? 0) * 3.6)} km/h`;
        visV.text = `${(c.visibility / 1000).toFixed(1)} km`;
        highV.text = `${Math.round(c.main?.temp_max ?? 0)}° / ${Math.round(c.main?.temp_min ?? 0)}°`;
        uvV.text = '--';
        riseV.text = new Date(c.sys?.sunrise * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        setV.text = new Date(c.sys?.sunset * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        rainV.text = '--';
        return true;
    }

    async function load() {
        const gen = ++generation;
        showLoading();
        const provider = settings.get_string('weather-provider');
        const city = settings.get_string('weather-city').trim();
        let ok = false;
        if (provider === 'wttr') {
            const url = city ? `${WTTR_BASE}/${encodeURIComponent(city)}?format=j1` : `${WTTR_BASE}/?format=j1`;
            const data = await fetchJson(url, gen);
            if (data) ok = fillWttr(data);
        } else {
            const key = settings.get_string('weather-api-key').trim();
            if (key) {
                const data = await fetchJson(`${OWM_BASE}/weather?q=${encodeURIComponent(city || 'Beijing')}&appid=${key}&units=metric&lang=zh_cn`, gen);
                if (data) ok = fillOwm(data);
            }
        }
        if (gen !== generation) return;
        if (ok) { showContent(); [...content.get_children()].forEach((c, i) => fadeInUp(c, {duration: 250, delayMs: i * 60, fromY: 6})); }
        else showError(provider === 'openweather' && !settings.get_string('weather-api-key') ? '未配置 API Key' : '天气加载失败');
    }

    return {
        widget: root, title: '天气', icon: 'weather-clear-symbolic',
        activate() { load(); },
        deactivate() { generation++; spinner.stop(); },
        destroy() { generation++; spinner.stop(); },
    };
}

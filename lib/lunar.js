// 农历（Lunar calendar）计算：1900 – 2100 年。
// 纯 JS 实现，无任何 gi 依赖，可用 node/gjs 单独运行与单测。
//
// 数据表：每年一个 4 位十六进制数，编码当年闰月信息：
//   bit 0-3   闰月月份（0 = 无闰月）
//   bit 4-15  该年 12 个月的大小月（1 = 30 天大月，0 = 29 天小月），bit4=正月 … bit15=腊月
// 该表为社区广泛使用的标准农历数据表（1900–2100）。

const LUNAR_INFO = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520, // 2100
];

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

// 1900-01-31 = 农历 1900 年正月初一
const BASE_UTC_MS = Date.UTC(1900, 0, 31);

const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const SHENG_XIAO = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DAY_NAMES = [
    '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

// ---------------------------------------------------------------------------
// 节气：以 1900-01-06 02:05 为基准、按回归年长度累加分钟数的经典速算法。
// termInfo[n] 为该节气相对基准的分钟偏移；n 见 TERM_NAMES。
// ---------------------------------------------------------------------------
const TERM_NAMES = [
    '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
    '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
    '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
    '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
];
const TERM_INFO = [
    0, 21208, 42467, 63836, 85337, 107014,
    128867, 150921, 173149, 195551, 218072, 240693,
    263343, 285989, 308563, 331033, 353350, 375494,
    397447, 419210, 440795, 462224, 483532, 504758,
];
const TROPICAL_YEAR_MS = 31556925974.7;

/** 返回该农历年有多少个月（含闰月）。 */
function yearMonths(lunarYear) {
    return (LUNAR_INFO[lunarYear - MIN_YEAR] & 0x0f) === 0 ? 12 : 13;
}

/** 该农历年的总天数（按数据表逐月累加，而非固定 354/384）。 */
export function lunarYearDays(lunarYear) {
    let sum = 0;
    for (let m = 1; m <= 12; m++)
        sum += monthDays(lunarYear, m, false);
    const lm = leapMonth(lunarYear);
    if (lm !== 0)
        sum += monthDays(lunarYear, lm, true);
    return sum;
}

/** 返回该农历年的闰月月份（1-12），无闰月返回 0。 */
export function leapMonth(lunarYear) {
    return LUNAR_INFO[lunarYear - MIN_YEAR] & 0x0f;
}

/** 返回农历年某月（1-12）的天数；isLeap 指定是否闰月。
 * 闰月天数存放在年份数值的最高位 0x10000，而非月份位之后。 */
export function monthDays(lunarYear, month, isLeap = false) {
    if (month < 1 || month > 12)
        throw new RangeError(`bad lunar month ${month}`);
    const info = LUNAR_INFO[lunarYear - MIN_YEAR];
    if (isLeap)
        return (info & 0x10000) !== 0 ? 30 : 29;
    return (info & (0x10000 >> month)) !== 0 ? 30 : 29;
}

function daysBetweenSolar(year, month, day) {
    return Math.round((Date.UTC(year, month - 1, day) - BASE_UTC_MS) / 86400000);
}

function daysBetweenLunar(year, month, day, isLeap) {
    let offset = 0;
    for (let y = MIN_YEAR; y < year; y++)
        offset += lunarYearDays(y);
    const lm = leapMonth(year);
    for (let m = 1; m < month; m++) {
        offset += monthDays(year, m, false);
        if (m === lm)
            offset += monthDays(year, m, true);
    }
    if (isLeap) {
        if (lm !== month)
            throw new RangeError('not a leap month');
        offset += monthDays(year, month, false);
    }
    offset += day - 1;
    return offset;
}

/**
 * 公历 → 农历。
 * @param {number} year 公历年
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @returns {{lunarYear:number, lunarMonth:number, lunarDay:number, isLeap:boolean}}
 */
export function solarToLunar(year, month, day) {
    if (year < MIN_YEAR || year > MAX_YEAR)
        throw new RangeError(`year out of range ${year}`);
    let offset = daysBetweenSolar(year, month, day);
    if (offset < 0)
        throw new RangeError('date before 1900-01-31');

    let lunarYear = MIN_YEAR;
    while (lunarYear <= MAX_YEAR) {
        const days = lunarYearDays(lunarYear);
        if (offset < days)
            break;
        offset -= days;
        lunarYear++;
    }
    if (lunarYear > MAX_YEAR)
        throw new RangeError('date after 2100');

    const lm = leapMonth(lunarYear);
    let lunarMonth = 1;
    let isLeap = false;
    for (; lunarMonth <= 12; lunarMonth++) {
        let monthLen = monthDays(lunarYear, lunarMonth, false);
        if (offset < monthLen)
            break;
        offset -= monthLen;
        if (lunarMonth === lm) {
            const leapLen = monthDays(lunarYear, lunarMonth, true);
            if (offset < leapLen) {
                isLeap = true;
                break;
            }
            offset -= leapLen;
        }
    }
    return {
        lunarYear,
        lunarMonth,
        lunarDay: offset + 1,
        isLeap,
    };
}

/** 农历 → 公历。isLeap 仅对闰月有意义。返回 {year, month, day}。 */
export function lunarToSolar(lunarYear, lunarMonth, lunarDay, isLeap = false) {
    if (lunarYear < MIN_YEAR || lunarYear > MAX_YEAR)
        throw new RangeError(`year out of range ${lunarYear}`);
    const offset = daysBetweenLunar(lunarYear, lunarMonth, lunarDay, isLeap);
    const ms = BASE_UTC_MS + offset * 86400000;
    const d = new Date(ms);
    return {year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate()};
}

/** 农历年份名称，如 "甲辰"（含生肖："甲辰龙年"）。 */
export function lunarYearName(lunarYear) {
    const stem = TIAN_GAN[(lunarYear - 4) % 10];
    const branch = DI_ZHI[(lunarYear - 4) % 12];
    const zodiac = SHENG_XIAO[(lunarYear - 4) % 12];
    return {stem, branch, zodiac, full: `${stem}${branch}`, withZodiac: `${stem}${branch}${zodiac}年`};
}

/** 农历月名称；闰月加 "闰" 前缀。 */
export function lunarMonthName(lunarMonth, isLeap = false) {
    return (isLeap ? '闰' : '') + MONTH_NAMES[lunarMonth - 1] + '月';
}

/** 农历日名称。 */
export function lunarDayName(lunarDay) {
    return DAY_NAMES[lunarDay - 1];
}

/**
 * 计算某年某月的节气列表（该月内出现的所有节气）。
 * 使用基准日 + 回归年长的速算法，日期精确到天。
 * @returns {Array<{name:string, day:number}>}
 */
export function solarTermsOfMonth(year, month) {
    const terms = [];
    for (let n = 0; n < 24; n++) {
        const ms = BASE_UTC_MS_TERM + TROPICAL_YEAR_MS * (year - 1900) + TERM_INFO[n] * 60000;
        const d = new Date(ms);
        if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month)
            terms.push({name: TERM_NAMES[n], day: d.getUTCDate()});
    }
    return terms;
}

// 节气基准：1900-01-06 02:05 UTC（该速算法的锚点，对应当年小寒）。
const BASE_UTC_MS_TERM = Date.UTC(1900, 0, 6, 2, 5);

/**
 * 某公历日的完整农历信息（日历格子用）。
 * @returns {{solar:{year,month,day}, lunar:{year,month,day,isLeap},
 *            yearName:string, monthName:string, dayName:string,
 *            zodiac:string, terms:Array<{name:string, day:number}>,
 *            isToday:boolean}}
 */
export function fullInfo(year, month, day) {
    const l = solarToLunar(year, month, day);
    const yName = lunarYearName(l.lunarYear);
    const terms = solarTermsOfMonth(year, month);
    return {
        solar: {year, month, day},
        lunar: l,
        yearName: yName.withZodiac,
        ganZhi: yName.full,
        zodiac: yName.zodiac,
        monthName: lunarMonthName(l.lunarMonth, l.isLeap),
        dayName: lunarDayName(l.lunarDay),
        terms,
        isToday: false,
    };
}

/** 判断某公历日是否为某个节气（返回节气名或 null）。 */
export function termOfDay(year, month, day) {
    const terms = solarTermsOfMonth(year, month);
    const hit = terms.find(t => t.day === day);
    return hit ? hit.name : null;
}

// --- 节日 ------------------------------------------------------------------
const SOLAR_FESTIVALS = {
    '1-1': '元旦',
    '2-14': '情人节',
    '3-8': '妇女节',
    '3-12': '植树节',
    '4-1': '愚人节',
    '5-1': '劳动节',
    '5-4': '青年节',
    '6-1': '儿童节',
    '7-1': '建党节',
    '8-1': '建军节',
    '9-10': '教师节',
    '10-1': '国庆节',
    '12-25': '圣诞节',
};

const LUNAR_FESTIVALS = {
    '1-1': '春节',
    '1-15': '元宵节',
    '2-2': '龙抬头',
    '5-5': '端午节',
    '7-7': '七夕',
    '7-15': '中元节',
    '8-15': '中秋节',
    '9-9': '重阳节',
    '12-8': '腊八节',
    '12-23': '北方小年',
    '12-24': '南方小年',
};

/**
 * 某公历日的节日（含节气）。返回数组，如 ['春节'] 或 ['立春']；无则空数组。
 */
export function festivalsOf(year, month, day) {
    const out = [];
    const term = termOfDay(year, month, day);
    if (term)
        out.push(term);

    const solar = SOLAR_FESTIVALS[`${month}-${day}`];
    if (solar)
        out.push(solar);

    const l = solarToLunar(year, month, day);
    const key = `${l.lunarMonth}-${l.lunarDay}`;
    const lunarFest = LUNAR_FESTIVALS[key];
    if (lunarFest) {
        if (!l.isLeap) // 闰月不过节
            out.push(lunarFest);
    }
    // 除夕：腊月最后一天
    if (l.lunarMonth === 12 && l.lunarDay === 29) {
        // 若腊月只有 29 天则为除夕
        if (monthDays(l.lunarYear, 12, false) === 29)
            out.push('除夕');
    } else if (l.lunarMonth === 12 && l.lunarDay === 30) {
        out.push('除夕');
    }
    return out;
}

export {TERM_NAMES};

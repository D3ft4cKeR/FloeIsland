import {solarToLunar, lunarToSolar, lunarYearName, solarTermsOfMonth, termOfDay} from '../lib/lunar.js';

let failures = 0;
function check(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
        failures++;
        console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    } else {
        console.log(`ok   ${name}`);
    }
}

// 春节锚点（正月初一）
check('1900-01-31', solarToLunar(1900, 1, 31), {lunarYear: 1900, lunarMonth: 1, lunarDay: 1, isLeap: false});
check('2024-02-10 春节', solarToLunar(2024, 2, 10), {lunarYear: 2024, lunarMonth: 1, lunarDay: 1, isLeap: false});
check('2025-01-29 春节', solarToLunar(2025, 1, 29), {lunarYear: 2025, lunarMonth: 1, lunarDay: 1, isLeap: false});
check('2026-02-17 春节', solarToLunar(2026, 2, 17), {lunarYear: 2026, lunarMonth: 1, lunarDay: 1, isLeap: false});
check('2024 中秋', solarToLunar(2024, 9, 17), {lunarYear: 2024, lunarMonth: 8, lunarDay: 15, isLeap: false});
check('2024-12-31', solarToLunar(2024, 12, 31), {lunarYear: 2024, lunarMonth: 12, lunarDay: 1, isLeap: false});
check('2026-01-01', solarToLunar(2026, 1, 1), {lunarYear: 2025, lunarMonth: 11, lunarDay: 13, isLeap: false});

// 闰月：2025 闰六月
check('2025 leap month', solarToLunar(2025, 7, 25), {lunarYear: 2025, lunarMonth: 6, lunarDay: 1, isLeap: true});
check('2025-08-01 闰六月廿三?', solarToLunar(2025, 8, 16), {lunarYear: 2025, lunarMonth: 6, lunarDay: 23, isLeap: true});

// 反向
check('lunarToSolar 2025 闰六月初一', lunarToSolar(2025, 6, 1, true), {year: 2025, month: 7, day: 25});
check('lunarToSolar 2024 正月初一', lunarToSolar(2024, 1, 1), {year: 2024, month: 2, day: 10});

// 干支 / 生肖
check('2024 甲辰龙', lunarYearName(2024).withZodiac, '甲辰龙年');
check('2025 乙巳蛇', lunarYearName(2025).withZodiac, '乙巳蛇年');
check('2026 丙午马', lunarYearName(2026).withZodiac, '丙午马年');

// 节气
check('2024 立春 02-04', termOfDay(2024, 2, 4), '立春');
check('2024 清明 04-04', termOfDay(2024, 4, 4), '清明');
check('2024 冬至 12-21', termOfDay(2024, 12, 21), '冬至');
check('2025 春分 03-20', termOfDay(2025, 3, 20), '春分');
check('2026 立春 02-04', termOfDay(2026, 2, 4), '立春');
check('2026 夏至 06-21', termOfDay(2026, 6, 21), '夏至');

// 2 月节气数量（立春+雨水）
check('2026-02 terms', solarTermsOfMonth(2026, 2).map(t => t.name), ['立春', '雨水']);

if (failures === 0)
    console.log('\nALL PASS');
else
    process.exit(1);

// LRC 解析器单元测试（node）。
import {parseLrc, lrcIndexAt} from '../lib/lrc.js';

let failures = 0;
const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
        failures++;
        console.log(`FAIL ${name}: got ${JSON.stringify(got)}`);
    } else {
        console.log(`ok   ${name}`);
    }
};

const lines = parseLrc('[00:12.34]第一行\n[00:20.00]第二行 hello\n[00:30.5]第三行\n[ti:标题]\n[ar:歌手]');
check('parse + 过滤元数据 + 排序', lines, [
    {timeMs: 12340, text: '第一行'},
    {timeMs: 20000, text: '第二行 hello'},
    {timeMs: 30500, text: '第三行'},
]);
check('idx@0s', lrcIndexAt(lines, 0), 0);
check('idx@15s', lrcIndexAt(lines, 15000), 0);
check('idx@25s', lrcIndexAt(lines, 25000), 1);
check('idx@40s', lrcIndexAt(lines, 40000), 2);
check('plain text -> null', parseLrc('无时间轴的一行\n第二行'), null);
check('空输入 -> null', parseLrc(''), null);
check('毫秒精度 [00:00.5]', parseLrc('[00:00.5]a')[0].timeMs, 500);

if (failures === 0)
    console.log('\nALL PASS');
else
    process.exit(1);

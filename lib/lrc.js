// LRC 歌词解析（纯 JS，可用 node/gjs 直接单测）。

/**
 * 解析 LRC 文本：返回 [{timeMs, text}]（按时间排序）。
 * 文本不含时间轴时返回 null（调用方按纯文本滚动处理）。
 */
export function parseLrc(lrc) {
    const lines = lrc.split(/\r?\n/);
    const timed = [];
    let hasTime = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line)
            continue;
        const meta = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
        const text = line.replace(/\[[^\]]*\]/g, '').trim();
        if (meta.length === 0)
            continue;
        hasTime = true;
        for (const m of meta) {
            const min = parseInt(m[1], 10);
            const sec = parseInt(m[2], 10);
            const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
            timed.push({timeMs: min * 60000 + sec * 1000 + frac, text});
        }
    }
    if (!hasTime)
        return null;
    return timed.filter(t => t.text).sort((a, b) => a.timeMs - b.timeMs);
}

/** 给定播放位置（毫秒），返回当前字幕行索引。 */
export function lrcIndexAt(lines, posMs) {
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].timeMs <= posMs)
            idx = i;
        else
            break;
    }
    return idx;
}

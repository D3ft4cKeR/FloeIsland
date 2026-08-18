const base = 'file:///home/d3ft4cker/FloeDock/';
const mods = ['constants', 'utils', 'lunar', 'lrc', 'mpris'];
for (const name of mods) {
    const mod = await import(base + 'lib/' + name + '.js');
    print(`OK lib/${name}.js (${Object.keys(mod).length} exports)`);
}
const {solarToLunar} = await import(base + 'lib/lunar.js');
print('lunar 2026-02-17:', JSON.stringify(solarToLunar(2026, 2, 17)));

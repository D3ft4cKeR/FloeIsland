// Syntax-check every extension JS file as ESM (no execution, no gi imports).
// Usage: node tests/check-syntax.mjs
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [];
const walk = dir => {
    for (const name of readdirSync(dir)) {
        if (name.startsWith('.'))
            continue;
        const p = resolve(dir, name);
        if (statSync(p).isDirectory())
            walk(p);
        else if (name.endsWith('.js'))
            files.push(p);
    }
};
walk(resolve(root, 'lib'));
files.push(resolve(root, 'extension.js'));
if (statSync(resolve(root, 'prefs.js'), {throwIfNoEntry: false})?.isFile())
    files.push(resolve(root, 'prefs.js'));

const require = createRequire(import.meta.url);
const {check} = require('node:module').builtinModules?.length ? {check: null} : {};
// Use node's internal ESM syntax check via dynamic import of a data: URL won't
// work (no file://). Instead, rely on `node --check` semantics through
// `vm.SourceTextModule`? Node lacks a public "parse only" API, so we shell out.
import {execFileSync} from 'node:child_process';
let failed = 0;
for (const f of files) {
    try {
        execFileSync(process.execPath, ['--input-type=module', '--check'],
            {input: readFileSync(f), stdio: ['pipe', 'ignore', 'pipe']});
        console.log(`  ok  ${f.replace(root + '/', '')}`);
    } catch (e) {
        failed++;
        console.log(`FAIL  ${f.replace(root + '/', '')}`);
        console.log(String(e.stderr).split('\n').slice(0, 6).join('\n'));
    }
}
if (failed) {
    console.error(`\n${failed} file(s) failed syntax check`);
    process.exit(1);
}
console.log('\nall syntax checks passed');

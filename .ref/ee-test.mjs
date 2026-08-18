import * as Signals from 'resource:///org/gnome/gjs/modules/core/signals.js';
class Foo extends Signals.EventEmitter {
    fire() { this.emit('open-state-changed', true); }
}
const f = new Foo();
print('connectObject type:', typeof f.connectObject);
print('disconnectObject type:', typeof f.disconnectObject);
let got = 0;
f.connectObject('open-state-changed', () => got++, f);
f.fire();
print('signal delivered:', got === 1 ? 'OK' : 'FAIL');
f.disconnectObject(f);
f.fire();
print('after disconnect delivered:', got === 1 ? 'OK' : 'FAIL');

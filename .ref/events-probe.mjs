import Clutter from 'gi://Clutter';
const actor = new Clutter.Actor();
const candidates = ['button-press-event', 'button-release-event', 'motion-event', 'enter-event', 'leave-event', 'key-press-event', 'key-release-event', 'notify::mapped', 'map', 'unmap', 'notify::hover', 'allocation-changed', 'destroy', 'style-changed', 'notify::allocation', 'captured-event', 'touch-event', 'scroll-event'];
for (const s of candidates) {
    try { actor.connect(s, () => {}); print('OK  ', s); } catch (e) { print('MISS', s); }
}

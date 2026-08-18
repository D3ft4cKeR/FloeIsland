import Clutter from 'gi://Clutter';
const g = new Clutter.ClickGesture();
for (const s of ['recognize', 'may-recognize', 'released', 'pressed', 'cancel', 'canceled', 'clicked', 'long-press', 'press', 'release', 'begin', 'end']) {
    try { g.connect(s, () => {}); print('signal OK:', s); } catch (e2) { print('no signal:', s); }
}
print('button:', typeof g.get_button);
print('coords_abs:', typeof g.get_coords_abs);

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
const gtype = Clutter.ClickGesture.$gtype;
try {
    const ids = GObject.signal_list_ids(gtype);
    const names = ids.map(id => GObject.signal_name(id));
    print('signals:', names.join(', '));
} catch (e) {
    print('signal_list_ids failed:', String(e).slice(0, 80));
    // fallback: try connecting candidate names
    const g = new Clutter.ClickGesture();
    for (const s of ['recognize', 'may-recognize', 'released', 'pressed', 'cancel', 'canceled', 'clicked', 'long-press', 'press', 'release']) {
        try { g.connect(s, () => {}); print('signal OK:', s); g.disconnect_all?.(); } catch (e2) { print('no signal:', s); }
    }
}

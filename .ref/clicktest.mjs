import Clutter from 'gi://Clutter';
const g = new Clutter.ClickGesture();
print('--- methods ---');
for (const m of ['get_coords_abs', 'get_button', 'get_press_count', 'get_n_press', 'get_n_clicks', 'get_current_click', 'get_last_event', 'get_click_count', 'is_dragging']) {
    try { print(m, ':', typeof g[m]); } catch (e) { print(m, ': THROWS'); }
}
print('--- signals ---');
const info = Clutter.ClickGesture.$gtype._getSignals?.() ?? [];

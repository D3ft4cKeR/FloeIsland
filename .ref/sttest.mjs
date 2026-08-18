import St from 'gi://St';
const w = new St.Widget({style_class: 'x'});
w.set_style('--my-var: rgba(255,0,0,0.5); background-color: var(--my-var); border-radius: 12px;');
const node = w.get_theme_node();
print('bg:', node.get_background_color().to_string());
print('radius tl:', node.get_corner_radius(St.Corner.TOPLEFT));

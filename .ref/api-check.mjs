import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup';
import GnomeDesktop from 'gi://GnomeDesktop';

const need = (ns, names) => {
    for (const n of names)
        print(ns._name + '.' + n, ns[n] !== undefined ? 'OK' : '** MISSING **');
};
need(St, ['Spinner', 'ProgressBar', 'Clipboard', 'Image', 'ImageContent', 'Viewport', 'ScrollView', 'Entry', 'Bin', 'BoxLayout', 'Label', 'Icon', 'Widget', 'ScrollBar']);
need(Clutter, ['SwipeAction', 'SwipeDirection', 'DragAction', 'ClickGesture', 'AnimationMode', 'BindConstraint', 'BindCoordinate', 'Orientation', 'ActorAlign', 'EventType', 'Keyval']);
need(Shell, ['Screenshot']);
need(GdkPixbuf, ['Pixbuf']);
need(Soup, ['Session', 'Message']);
need(GnomeDesktop, ['WallClock']);
print('St.ProgressBar.value prop:', 'value' in St.ProgressBar.prototype ? 'OK' : 'MISSING');
print('Clutter.SwipeAction.get_direction:', typeof Clutter.SwipeAction.prototype.get_direction);

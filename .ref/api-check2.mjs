import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup';
import GnomeDesktop from 'gi://GnomeDesktop';

const probe = (label, fn) => {
    try {
        const v = fn();
        print(`${label}: ${v ? 'OK' : 'MISSING'}`);
    } catch (e) {
        print(`${label}: THROWS ${e.message?.slice(0, 60) ?? e}`);
    }
};

print('versions — St:', St.GIRepository ? 'n/a' : 'ok');
probe('St.Spinner', () => St.Spinner);
probe('St.ProgressBar', () => St.ProgressBar);
probe('St.Clipboard', () => St.Clipboard);
probe('St.Image', () => St.Image);
probe('St.ImageContent', () => St.ImageContent);
probe('St.Viewport', () => St.Viewport);
probe('St.ScrollView', () => St.ScrollView);
probe('St.Entry', () => St.Entry);
probe('Clutter.SwipeAction', () => Clutter.SwipeAction);
probe('Clutter.SwipeDirection', () => Clutter.SwipeDirection);
probe('Clutter.DragAction', () => Clutter.DragAction);
probe('Clutter.ClickGesture', () => Clutter.ClickGesture);
probe('Clutter.AnimationMode.EASE_OUT_BACK', () => Clutter.AnimationMode.EASE_OUT_BACK);
probe('Clutter.AnimationMode.EASE_OUT_ELASTIC', () => Clutter.AnimationMode.EASE_OUT_ELASTIC);
probe('Shell.Screenshot', () => Shell.Screenshot);
probe('GdkPixbuf.Pixbuf', () => GdkPixbuf.Pixbuf);
probe('Soup.Session', () => Soup.Session);
probe('GnomeDesktop.WallClock', () => GnomeDesktop.WallClock);

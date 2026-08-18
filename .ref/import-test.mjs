import {solarToLunar, fullInfo} from '../lib/lunar.js';
import * as C from '../lib/constants.js';
import {clamp, formatTime} from '../lib/utils.js';
print('lunar:', JSON.stringify(solarToLunar(2026, 2, 17)));
print('fullInfo:', JSON.stringify(fullInfo(2026, 2, 4)));
print('constants:', C.State.DOCK, C.PANEL_HEIGHT);
print('clamp:', clamp(150, 0, 100), 'time:', formatTime(new Date()));

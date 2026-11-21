import { lockScroll } from '../../../src/lib/scrollLock';
import { watchOverlays } from '../../../src/lib/overlayScrollLock';
(window as unknown as { lockScroll: typeof lockScroll; watchOverlays: typeof watchOverlays }).lockScroll = lockScroll;
(window as unknown as { watchOverlays: typeof watchOverlays }).watchOverlays = watchOverlays;

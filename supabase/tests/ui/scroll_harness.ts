import { lockScroll } from '../../../src/lib/scrollLock';
(window as unknown as { lockScroll: typeof lockScroll }).lockScroll = lockScroll;

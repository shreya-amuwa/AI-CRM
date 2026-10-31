/** The chat's height calculation for phones (no browser needed). */
import { fitHeight, isShortViewport, keyboardOpen } from '../../src/lib/chat/viewportFit.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}

// the panel starts 122px down a 844px window and a 65px tab bar is fixed over the bottom: it gets what is left
check(fitHeight({ elementTop: 122, viewportHeight: 844, reserveBelow: 65 }) === 657, 'the panel takes the room between its top and the tab bar');
// the page was scrolled by 60px: getBoundingClientRect().top is already 62, adding the scroll again (the old code) would take 60px too much off
check(fitHeight({ elementTop: 62, viewportHeight: 844, reserveBelow: 65 }) === 717, 'a scrolled page is measured from the window, the scroll offset is not added again');
// scrolled so far that the top is above the window: never more than the visible height
check(fitHeight({ elementTop: -300, viewportHeight: 600, reserveBelow: 0 }) === 600, 'a panel scrolled partly off the top never claims more than the visible height');
// iOS: the visible area sits 40px below the layout viewport while the keyboard is open
check(fitHeight({ elementTop: 140, viewportHeight: 400, viewportOffsetTop: 40, reserveBelow: 0 }) === 300, 'the visual viewport offset is taken off the top');
check(fitHeight({ elementTop: 20, viewportHeight: 400, viewportOffsetTop: 40, reserveBelow: 0 }) === 400, 'a top above the visible area counts as the top of it');
// a window with no room still gets the message box
check(fitHeight({ elementTop: 300, viewportHeight: 320, reserveBelow: 65 }) === 80, 'a tiny window gets the small minimum, not 420px');
check(fitHeight({ elementTop: 0, viewportHeight: 700.9 }) === 700, 'whole pixels');
check(fitHeight({ elementTop: 100, viewportHeight: 500, reserveBelow: -20 }) === 400, 'a negative reserve is ignored');

// the keyboard
check(keyboardOpen({ layoutHeight: 844, viewportHeight: 508, textFieldFocused: false, touch: true }), 'iOS: the visual viewport is much shorter than the layout viewport');
check(keyboardOpen({ layoutHeight: 464, viewportHeight: 464, textFieldFocused: true, touch: true }), 'Android: the window shrank and a text box has the focus');
check(!keyboardOpen({ layoutHeight: 844, viewportHeight: 844, textFieldFocused: true, touch: false }), 'a desktop with a focused box has no keyboard');
check(!keyboardOpen({ layoutHeight: 844, viewportHeight: 800, textFieldFocused: false, touch: true }), 'the address bar changing the height a little is not a keyboard');
check(isShortViewport(300) && !isShortViewport(700), 'a window under 460px is short');

console.log(`=== ${passed} VIEWPORT FIT CHECKS PASSED ===`);

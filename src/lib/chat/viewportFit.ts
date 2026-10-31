/**
 * The height a full-screen panel (a chat) may take: what is VISIBLE below its top edge, less what is fixed over the bottom of the
 * window (a tab bar). Kept free of the DOM so it can be tested.
 *
 *  - `elementTop` is `getBoundingClientRect().top`: it is already measured from the top of the LAYOUT viewport, so the page's scroll
 *    offset must not be added to it again (the earlier code added `scrollY`, which made the panel shorter by the scrolled distance).
 *  - `viewportOffsetTop` is how far the visible area (`visualViewport`) sits below the layout viewport; on iOS Safari it is not 0 while
 *    the keyboard is open and the page has been scrolled up to show the field.
 *  - A panel scrolled partly off the top never claims more than the visible height.
 */
export interface FitInput {
  elementTop: number;
  /** `visualViewport.height` (or `innerHeight` where that does not exist). */
  viewportHeight: number;
  viewportOffsetTop?: number;
  /** Something fixed over the bottom of the window that the panel must stay clear of (0 while the keyboard is open). */
  reserveBelow?: number;
  /** Never smaller than this (the message box alone), so a tiny window still shows something. */
  min?: number;
}

export function fitHeight({ elementTop, viewportHeight, viewportOffsetTop = 0, reserveBelow = 0, min = 80 }: FitInput): number {
  const topInView = Math.max(0, elementTop - viewportOffsetTop);
  const room = viewportHeight - topInView - Math.max(0, reserveBelow);
  return Math.max(min, Math.floor(room));
}

/** The on-screen keyboard is taking at least this much of the window. */
export const KEYBOARD_MIN_PX = 120;

/**
 * Whether the on-screen keyboard is open. Browsers that resize only the visual viewport (iOS Safari) show it as a gap between the
 * layout and the visual viewport; browsers that resize the whole window (Android Chrome) do not, so a focused text field on a touch
 * screen counts too.
 */
export function keyboardOpen(o: { layoutHeight: number; viewportHeight: number; textFieldFocused: boolean; touch: boolean }): boolean {
  if (o.layoutHeight - o.viewportHeight >= KEYBOARD_MIN_PX) return true;
  return o.touch && o.textFieldFocused;
}

/** A window this short (a phone on its side, or the keyboard open) has no room for a chat's title bar. */
export const SHORT_VIEWPORT_PX = 460;
export const isShortViewport = (viewportHeight: number) => viewportHeight < SHORT_VIEWPORT_PX;

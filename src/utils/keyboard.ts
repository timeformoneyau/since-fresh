export interface OpenKeyboard {
  /** Its top edge on screen, as reported. */
  top: number;
  /** Its height, as reported (on Android, above the nav bar). */
  height: number;
  /** Where the screen ends. */
  screenBottom: number;
  /** Space below the keyboard the phone keeps for its nav bar (Android). */
  belowKeyboard: number;
}

/**
 * How far the keyboard covers a view, from where the view ends on screen.
 * Zero when the keyboard is closed, and zero when the phone has already moved
 * the view clear of it (so the space is never added twice).
 *
 * Android 11+ reports a top edge that leaves out the nav bar, though the
 * keyboard's window covers it too; its height plus the nav bar, measured up
 * from the bottom of the screen, gives the real edge. Whichever edge is
 * higher wins, so a phone that reports either way is covered.
 */
export function keyboardOverlap(viewBottom: number, keyboard: OpenKeyboard | null): number {
  if (keyboard === null) return 0;
  const top = Math.min(keyboard.top, keyboard.screenBottom - keyboard.height - keyboard.belowKeyboard);
  return Math.max(0, Math.round(viewBottom - top));
}

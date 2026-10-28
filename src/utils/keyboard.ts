/**
 * How far the keyboard covers a view, from where the view ends on screen and
 * where the keyboard's top edge is. Zero when the keyboard is closed, and
 * zero when the phone has already moved the view clear of it (so the space
 * is never added twice).
 */
export function keyboardOverlap(viewBottom: number, keyboardTop: number | null): number {
  if (keyboardTop === null) return 0;
  return Math.max(0, Math.round(viewBottom - keyboardTop));
}

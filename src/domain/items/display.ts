/**
 * Pure display rules for the list and item screens. No I/O and no date
 * library, so they run under the Node test runner.
 */

import type { ItemStatus, StatusLabel } from '../../types';

/** Label shown for an item with no repeat (previously "Tracked only"). */
export const ONCE_OFF = 'Once off';

/** Text of the status chip: the status, or "Once off" when there's no repeat. */
export function chipLabel(label: StatusLabel | null): string {
  return label ?? ONCE_OFF;
}

/**
 * How far through its interval an item is, from 0 to 1 (elapsed ÷ interval,
 * clamped). null for once-off items, which have no bar.
 */
export function intervalProgress(status: ItemStatus): number | null {
  if (status.label === null || status.daysUntilDue === null) return null;
  const interval = status.daysSince + status.daysUntilDue;
  if (interval <= 0) return 1;
  return Math.min(1, Math.max(0, status.daysSince / interval));
}

const NEEDS_A_LOOK: ReadonlySet<StatusLabel> = new Set([
  "It's been a while",
  'Getting overdue',
  'Long overdue',
]);
const COMING_UP: ReadonlySet<StatusLabel> = new Set(['Coming up', 'About now']);

/**
 * Second line of the summary card, e.g. "2 could use a look · 2 coming up".
 * null when nothing needs a look or is coming up.
 */
export function summaryCounts(labels: Array<StatusLabel | null>): string | null {
  const look = labels.filter((l) => l !== null && NEEDS_A_LOOK.has(l)).length;
  const soon = labels.filter((l) => l !== null && COMING_UP.has(l)).length;
  const parts = [
    look > 0 ? `${look} could use a look` : null,
    soon > 0 ? `${soon} coming up` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "Done today", "Last done yesterday", "Last done 38 days ago". */
export function lastDoneText(daysSince: number): string {
  if (daysSince <= 0) return 'Done today';
  if (daysSince === 1) return 'Last done yesterday';
  return `Last done ${daysSince} days ago`;
}

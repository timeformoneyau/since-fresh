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

type Unit = 'days' | 'weeks' | 'months' | 'years';

/** "30 days", "1 week", "6 months". */
export function intervalText(value: number, unit: Unit): string {
  return `${value} ${value === 1 ? unit.slice(0, -1) : unit}`;
}

/** Subtitle on the item screen: "Repeats every 30 days", "Repeats every year", or "Once off". */
export function repeatText(value: number | null, unit: Unit | null): string {
  if (value === null || unit === null) return ONCE_OFF;
  return value === 1 ? `Repeats every ${unit.slice(0, -1)}` : `Repeats every ${intervalText(value, unit)}`;
}

/** "today", "yesterday", "38 days ago". */
export function daysAgoText(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** "today", "tomorrow", "in 24 days". */
export function daysAheadText(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Caption under the "Due" marker at the top of a repeating item's history. */
export function dueCaption(daysUntilDue: number, value: number, unit: Unit): string {
  if (daysUntilDue > 0) return `Due ${daysAheadText(daysUntilDue)}`;
  return `${intervalText(value, unit)} after your last one. Still waiting.`;
}

/**
 * Caption for a history entry. gapFromPrevious is the days since the entry
 * before it, or null for the first ever entry.
 */
export function entryCaption(gapFromPrevious: number | null): string {
  if (gapFromPrevious === null) return 'First time · when you started tracking';
  if (gapFromPrevious === 0) return 'Done again · same day as the last';
  if (gapFromPrevious === 1) return 'Done again · 1 day after the last';
  return `Done again · ${gapFromPrevious} days after the last`;
}

/** "4 entries · about every 32 days", or "1 entry". */
export function historySummary(count: number, usualDays: number | null): string {
  const entries = count === 1 ? '1 entry' : `${count} entries`;
  return usualDays === null ? entries : `${entries} · about every ${usualDays} days`;
}

/** Under a starter on the empty list: "Every 12 months", or how a date starter works. */
export function starterCaption(s: { repeatValue: number; repeatUnit: Unit; until?: { repeat: boolean } }): string {
  if (s.until) return s.until.repeat ? 'Every year, from its due date' : 'Once, by its due date';
  return `Every ${intervalText(s.repeatValue, s.repeatUnit)}`;
}

import type { SinceItem, StatusLabel, ItemStatus } from '../types';
import { getDaysSince, getDaysUntilDue } from './dateUtils.ts';
import { nextDueOf, comingUpDays } from '../domain/items/due.ts';

/** Shared label assignment once a due date + "coming up" threshold are known. */
function labelForDaysUntilDue(daysUntilDue: number, threshold: number): StatusLabel {
  if (daysUntilDue > threshold) return 'All good';
  if (daysUntilDue > 0) return 'Coming up';
  if (daysUntilDue >= -2) return 'About now';
  if (daysUntilDue >= -14) return "It's been a while";
  if (daysUntilDue >= -45) return 'Getting overdue';
  return 'Long overdue';
}

/**
 * The item's status against its due date: last done + repeat, or the date
 * set on a date item ("until it's due", domain/items/due.ts). daysSince
 * counts from lastDoneDate, which on a date item not done yet is the day it
 * was added, so the progress bar runs from then to the due date.
 */
export function computeItemStatus(item: SinceItem): ItemStatus {
  const daysSince = getDaysSince(item.lastDoneDate);
  const nextDueDate = nextDueOf(item);

  if (nextDueDate === null) {
    return { label: null, daysSince, daysUntilDue: null, nextDueDate: null };
  }

  const daysUntilDue = getDaysUntilDue(nextDueDate);
  const label = labelForDaysUntilDue(daysUntilDue, comingUpDays(item)!);

  return { label, daysSince, daysUntilDue, nextDueDate };
}

/** Sort order index — lower = shown first */
export function statusSortOrder(label: StatusLabel | null): number {
  switch (label) {
    case 'Long overdue':      return 0;
    case 'Getting overdue':   return 1;
    case "It's been a while": return 2;
    case 'About now':         return 3;
    case 'Coming up':         return 4;
    case 'All good':          return 5;
    case null:                return 6; // non-repeating last
    default:                  return 7;
  }
}

export function sortItems(items: SinceItem[]): SinceItem[] {
  return [...items].sort((a, b) => {
    const sa = computeItemStatus(a);
    const sb = computeItemStatus(b);

    const orderDiff = statusSortOrder(sa.label) - statusSortOrder(sb.label);
    if (orderDiff !== 0) return orderDiff;

    // Within overdue groups: most overdue first (most negative daysUntilDue)
    if (sa.daysUntilDue !== null && sb.daysUntilDue !== null) {
      if (sa.daysUntilDue < 0 && sb.daysUntilDue < 0) {
        return sa.daysUntilDue - sb.daysUntilDue; // e.g. -60 before -30
      }
      // Within future groups: nearest due first
      if (sa.daysUntilDue > 0 && sb.daysUntilDue > 0) {
        return sa.daysUntilDue - sb.daysUntilDue;
      }
    }

    // Non-repeating: most days since first
    return sb.daysSince - sa.daysSince;
  });
}

/** Secondary line text shown in item card */
export function secondaryLine(status: ItemStatus): string {
  const { label, daysUntilDue, nextDueDate } = status;

  if (label === null || daysUntilDue === null || nextDueDate === null) {
    return 'Kept as a record';
  }

  const absDays = Math.abs(daysUntilDue);

  switch (label) {
    case 'All good':
      if (daysUntilDue === 1) return 'Tomorrow';
      return `Next in ${daysUntilDue} days`;
    case 'Coming up':
      if (daysUntilDue === 1) return 'Tomorrow';
      return `Next in ${daysUntilDue} days`;
    case 'About now':
      if (daysUntilDue === 0) return 'Due today';
      if (daysUntilDue === -1) return 'Overdue by 1 day';
      return `Overdue by ${absDays} days`;
    case "It's been a while":
      return `Overdue by ${absDays} days`;
    case 'Getting overdue':
      return `Overdue by ${absDays} days`;
    case 'Long overdue':
      return `Overdue by ${absDays} days`;
    default:
      return '';
  }
}

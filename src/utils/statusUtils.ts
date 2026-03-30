import { SinceItem, StatusLabel, ItemStatus } from '../types';
import {
  getDaysSince,
  getNextDueDate,
  getDaysUntilDue,
  intervalToDays,
  comingUpThreshold,
} from './dateUtils';

export function computeItemStatus(item: SinceItem): ItemStatus {
  const daysSince = getDaysSince(item.lastDoneDate);

  if (item.repeatValue === null || item.repeatUnit === null) {
    return { label: null, daysSince, daysUntilDue: null, nextDueDate: null };
  }

  const nextDueDate = getNextDueDate(item.lastDoneDate, item.repeatValue, item.repeatUnit);
  const daysUntilDue = getDaysUntilDue(nextDueDate);
  const approxInterval = intervalToDays(item.repeatValue, item.repeatUnit);
  const threshold = comingUpThreshold(approxInterval);

  let label: StatusLabel;
  if (daysUntilDue > threshold) {
    label = 'All good';
  } else if (daysUntilDue > 0) {
    label = 'Coming up';
  } else if (daysUntilDue >= -2) {
    label = 'About now';
  } else if (daysUntilDue >= -14) {
    label = "It's been a while";
  } else if (daysUntilDue >= -45) {
    label = 'Getting overdue';
  } else {
    label = 'Long overdue';
  }

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
    return 'No repeat set';
  }

  const absDays = Math.abs(daysUntilDue);

  switch (label) {
    case 'All good':
      if (daysUntilDue === 1) return 'Due tomorrow';
      return `Due in ${daysUntilDue} days`;
    case 'Coming up':
      if (daysUntilDue === 1) return 'Due tomorrow';
      return `Due in ${daysUntilDue} days`;
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

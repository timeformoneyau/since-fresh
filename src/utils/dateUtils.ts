import {
  differenceInCalendarDays,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  format,
  parseISO,
  startOfDay,
} from 'date-fns';
import { RepeatUnit } from '../types';

/** Return today as a YYYY-MM-DD string */
export function todayString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** Parse a YYYY-MM-DD string to a Date at midnight local time */
export function parseDate(dateStr: string): Date {
  return startOfDay(parseISO(dateStr));
}

/** Format a Date for display, e.g. "28 Mar 2026" */
export function formatDisplay(date: Date): string {
  return format(date, 'd MMM yyyy');
}

/** Format a Date to a YYYY-MM-DD storage string */
export function formatStorage(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** Number of whole calendar days from lastDoneDate to today */
export function getDaysSince(lastDoneDateStr: string): number {
  const last = parseDate(lastDoneDateStr);
  const today = startOfDay(new Date());
  return differenceInCalendarDays(today, last);
}

/** Compute the next due date given last done + repeat interval */
export function getNextDueDate(
  lastDoneDateStr: string,
  repeatValue: number,
  repeatUnit: RepeatUnit,
): Date {
  const last = parseDate(lastDoneDateStr);
  switch (repeatUnit) {
    case 'days':
      return addDays(last, repeatValue);
    case 'weeks':
      return addWeeks(last, repeatValue);
    case 'months':
      return addMonths(last, repeatValue);
    case 'years':
      return addYears(last, repeatValue);
  }
}

/** Days from today until the due date. Negative = overdue. */
export function getDaysUntilDue(nextDueDate: Date): number {
  const today = startOfDay(new Date());
  return differenceInCalendarDays(nextDueDate, today);
}

/**
 * Approximate interval length in days for threshold calculations.
 * Uses rough values for months/years since these thresholds don't need calendar accuracy.
 */
export function intervalToDays(repeatValue: number, repeatUnit: RepeatUnit): number {
  switch (repeatUnit) {
    case 'days':
      return repeatValue;
    case 'weeks':
      return repeatValue * 7;
    case 'months':
      return repeatValue * 30;
    case 'years':
      return repeatValue * 365;
  }
}

/** Return the "coming up" threshold in days before due for a given interval length */
export function comingUpThreshold(intervalDays: number): number {
  if (intervalDays <= 14) return 1;
  if (intervalDays <= 45) return 3;
  if (intervalDays <= 120) return 7;
  if (intervalDays <= 240) return 14;
  if (intervalDays <= 540) return 30;
  return 45;
}

/** Human-readable "X days ago" / "X weeks ago" etc for daysSince */
export function humaniseDaysSince(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return '1 month ago';
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  if (days < 730) return '1 year ago';
  return `${Math.floor(days / 365)} years ago`;
}

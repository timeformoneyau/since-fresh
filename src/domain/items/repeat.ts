import type { RepeatUnit } from '../../types';

/** The stepper's limits on Add and Edit. */
export const MIN_REPEAT = 1;
export const MAX_REPEAT = 99;

const DAYS: Record<RepeatUnit, number> = { days: 1, weeks: 7, months: 30, years: 365 };

/**
 * A repeat moved to another unit, via days (a month is 30, a year 365),
 * rounded to the nearest whole number and kept within the stepper's limits.
 * The same unit gives the value back as it is, so converting from the value
 * someone set by hand never drifts: 20 days → months → days is 20 again.
 */
export function convertRepeat(value: number, from: RepeatUnit, to: RepeatUnit): number {
  if (from === to) return value;
  const converted = Math.round((value * DAYS[from]) / DAYS[to]);
  return Math.min(MAX_REPEAT, Math.max(MIN_REPEAT, converted));
}

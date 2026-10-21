/**
 * The time of day reminders go out: one for all of them, chosen in Account
 * (or Settings, with no account). Kept on this phone only. Pure, so it runs
 * under `npm test`; reminderTimeStore.ts saves it.
 */

import { DEFAULT_REMINDER_TIME, type ReminderTime } from './plan.ts';

export { DEFAULT_REMINDER_TIME, type ReminderTime };

/** A short fixed list keeps it simple and needs no native time picker. */
export const REMINDER_TIME_OPTIONS: ReminderTime[] = [
  { hour: 7, minute: 0 },
  { hour: 8, minute: 0 },
  { hour: 9, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 18, minute: 0 },
  { hour: 20, minute: 0 },
];

/** Storage format version. Later versions may add fields only. */
export const REMINDER_TIME_VERSION = 1;

export function sameTime(a: ReminderTime, b: ReminderTime): boolean {
  return a.hour === b.hour && a.minute === b.minute;
}

/** "9 am", "12 pm", "6:30 pm". */
export function formatReminderTime({ hour, minute }: ReminderTime): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const m = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;
  return `${h}${m} ${hour < 12 ? 'am' : 'pm'}`;
}

/** testID-friendly: "0900". */
export function timeKey({ hour, minute }: ReminderTime): string {
  return `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
}

/** What was saved, or 9 am when nothing (or nothing readable) was. */
export function parseReminderTime(raw: string | null): ReminderTime {
  if (!raw) return DEFAULT_REMINDER_TIME;
  try {
    const { hour, minute } = JSON.parse(raw) as Partial<ReminderTime>;
    const ok =
      Number.isInteger(hour) && Number.isInteger(minute) &&
      hour! >= 0 && hour! <= 23 && minute! >= 0 && minute! <= 59;
    return ok ? { hour: hour!, minute: minute! } : DEFAULT_REMINDER_TIME;
  } catch {
    return DEFAULT_REMINDER_TIME;
  }
}

export function serializeReminderTime(time: ReminderTime): string {
  return JSON.stringify({ version: REMINDER_TIME_VERSION, hour: time.hour, minute: time.minute });
}

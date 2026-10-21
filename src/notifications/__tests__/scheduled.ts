/**
 * A stand-in for the phone's notification store, for component tests: what
 * is scheduled after the app has done its work. Call useScheduledStore() in
 * a beforeEach.
 */
import * as Notifications from 'expo-notifications';
import { format } from 'date-fns';

export interface Scheduled { identifier: string; body: string; date: Date }

const store = new Map<string, Scheduled>();

export function useScheduledStore(): void {
  store.clear();
  (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(
    async (req: { identifier: string; content: { body: string }; trigger: { date: Date } }) => {
      store.set(req.identifier, { identifier: req.identifier, body: req.content.body, date: req.trigger.date });
      return req.identifier;
    },
  );
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () =>
    [...store.keys()].map((identifier) => ({ identifier })),
  );
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(async (id: string) => {
    store.delete(id);
  });
  (Notifications.cancelAllScheduledNotificationsAsync as jest.Mock).mockImplementation(async () => store.clear());
}

export function scheduled(): Scheduled[] {
  return [...store.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** How many are scheduled on each calendar day. */
export function perDay(): Map<string, number> {
  const days = new Map<string, number>();
  for (const s of store.values()) {
    const key = format(s.date, 'yyyy-MM-dd');
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  return days;
}

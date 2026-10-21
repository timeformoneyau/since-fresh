import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, subDays, subMonths, addDays, addWeeks } from 'date-fns';
import App from '../../../App';
import { createItem } from '../../domain/items/service';
import { snoozeNote } from '../../domain/snooze/rules';
import { useScheduledStore, scheduled } from '../../notifications/__tests__/scheduled';

const today = new Date();
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
// Monthly, due 10 days ago
const overdueLastDone = ymd(subDays(subMonths(today, 1), 10));

beforeEach(async () => {
  await AsyncStorage.clear();
  useScheduledStore();
});

async function seed(lastDoneDate = overdueLastDone) {
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate, repeatValue: 1, repeatUnit: 'months' });
}

async function openDetail() {
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Gutters-history'));
  await screen.findByTestId('detail-status-card');
}

it('snoozes for a week: the status stays true, reminders wait, one comes back', async () => {
  await seed();
  await openDetail();
  fireEvent.press(screen.getByTestId('detail-not-yet-button'));
  expect(screen.getByText('Remind me again in')).toBeTruthy();
  fireEvent.press(screen.getByTestId('snooze-1-week'));

  const note = snoozeNote(ymd(addWeeks(today, 1)), today)!;
  expect(await screen.findByText(`${note}. Reminders start again then.`)).toBeTruthy();
  expect(screen.queryByTestId('detail-not-yet-button')).toBeNull();
  // "How long it's been" is untouched
  expect(screen.getByText('Overdue by 10 days')).toBeTruthy();

  const ids = scheduled().map((s) => s.identifier);
  expect(ids.some((id) => id.endsWith('_snooze_end'))).toBe(true);
  const end = scheduled().find((s) => s.identifier.endsWith('_snooze_end'))!;
  expect(ymd(end.date)).toBe(ymd(addWeeks(today, 1)));
  expect(end.body).toBe('Gutters overdue by 17 days');
  // Nothing for this item before then
  for (const s of scheduled()) {
    if (s.identifier.includes('Gutters') || s.identifier.includes('_grouped_')) {
      expect(s.date.getTime()).toBeGreaterThanOrEqual(end.date.getTime());
    }
  }

  // The list shows the note too
  fireEvent.press(screen.getByTestId('detail-back'));
  expect(await screen.findByTestId('item-Gutters-snoozed')).toHaveTextContent(note);
});

it('is only offered when something is due', async () => {
  await seed(ymd(subDays(subMonths(today, 1), -5))); // due in 5 days
  await openDetail();
  expect(screen.queryByTestId('detail-not-yet-button')).toBeNull();
});

it('can be cancelled from the menu, and undone from the toast', async () => {
  await seed();
  await openDetail();
  fireEvent.press(screen.getByTestId('detail-not-yet-button'));
  fireEvent.press(screen.getByTestId('snooze-cancel'));
  expect(screen.getByTestId('detail-not-yet-button')).toBeTruthy();

  fireEvent.press(screen.getByTestId('detail-not-yet-button'));
  fireEvent.press(screen.getByTestId('snooze-3-days'));
  await screen.findByTestId('detail-snoozed');
  fireEvent.press(await screen.findByText('Undo'));
  expect(await screen.findByTestId('detail-not-yet-button')).toBeTruthy();
  expect(scheduled().some((s) => s.identifier.endsWith('_snooze_end'))).toBe(false);
});

it('marking done ends the snooze', async () => {
  await seed();
  await openDetail();
  fireEvent.press(screen.getByTestId('detail-not-yet-button'));
  fireEvent.press(screen.getByTestId('snooze-1-month'));
  await screen.findByTestId('detail-snoozed');

  fireEvent.press(screen.getByTestId('detail-mark-done-button'));
  await waitFor(() => expect(screen.queryByTestId('detail-snoozed')).toBeNull());
  expect(scheduled().some((s) => s.identifier.endsWith('_snooze_end'))).toBe(false);
  expect(JSON.parse((await AsyncStorage.getItem('@since_snoozes_v1'))!).snoozes).toEqual({});
});

it('stays on this phone: snoozing queues nothing to sync', async () => {
  await seed();
  const queueBefore = await AsyncStorage.getItem('@since_sync_queue_v1');
  await openDetail();
  fireEvent.press(screen.getByTestId('detail-not-yet-button'));
  fireEvent.press(screen.getByTestId('snooze-1-week'));
  await screen.findByTestId('detail-snoozed');
  expect(await AsyncStorage.getItem('@since_sync_queue_v1')).toBe(queueBefore);
});

it('a snooze shorter than a week names the day', () => {
  expect(snoozeNote(ymd(addDays(today, 3)), today)).toBe(`Snoozed until ${format(addDays(today, 3), 'EEEE')}`);
});

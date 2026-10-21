import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, subDays, subMonths, addDays } from 'date-fns';
import App from '../../../App';
import { createItem } from '../../domain/items/service';
import { useScheduledStore, scheduled } from '../../notifications/__tests__/scheduled';

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const times = () => [...new Set(scheduled().map((s) => format(s.date, 'HH:mm')))];

beforeEach(async () => {
  await AsyncStorage.clear();
  useScheduledStore();
});

async function seed() {
  // Monthly, due in 10 days: coming up, due and overdue reminders ahead
  await createItem({
    name: 'Air filter', category: 'Household',
    lastDoneDate: ymd(addDays(subMonths(new Date(), 1), 10)), repeatValue: 1, repeatUnit: 'months',
  });
  // Overdue, so grouped notices too
  await createItem({
    name: 'Gutters', category: 'Household',
    lastDoneDate: ymd(subDays(subMonths(new Date(), 1), 10)), repeatValue: 1, repeatUnit: 'months',
  });
}

async function openSettings(listShows: string) {
  render(<App />);
  await screen.findByTestId(listShows);
  fireEvent.press(screen.getByTestId('main-account-button'));
  return screen.findByTestId('reminder-time-0900');
}

it('reminders go out at 9 am until changed', async () => {
  await seed();
  expect(times()).toEqual(['09:00']);
  const nine = await openSettings('item-Gutters');
  expect(nine.props.accessibilityState).toEqual({ selected: true });
});

it('choosing another time moves every scheduled reminder to it', async () => {
  await seed();
  const before = scheduled().map((s) => s.identifier).sort();
  await openSettings('item-Gutters');

  fireEvent.press(screen.getByTestId('reminder-time-1800'));
  expect(await screen.findByText('Reminders will come at 6 pm')).toBeTruthy();
  await waitFor(() => expect(times()).toEqual(['18:00']));
  // Same reminders, new time
  expect(scheduled().map((s) => s.identifier).sort()).toEqual(before);
  expect(screen.getByTestId('reminder-time-1800').props.accessibilityState).toEqual({ selected: true });
});

it('the chosen time is kept, and used for items added later', async () => {
  await openSettings('empty-add-button');
  fireEvent.press(screen.getByTestId('reminder-time-0700'));
  await screen.findByText('Reminders will come at 7 am');
  await seed();
  expect(times()).toEqual(['07:00']);
  expect(JSON.parse((await AsyncStorage.getItem('@since_reminder_time_v1'))!)).toMatchObject({ hour: 7, minute: 0 });
});

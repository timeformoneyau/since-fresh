import React from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import App from '../../../App';
import { createItem } from '../../domain/items/service';
import { REMINDERS_COPY } from '../permission';

/**
 * Notification permission (Play hardening B): never asked at launch; once,
 * after an explanation, when the first repeating item is saved; "Not now" is
 * a real answer; a calm notice while reminders are off; settings once
 * Android won't show its prompt again; everything rescheduled once granted.
 */
const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const LIST_LOADS = { timeout: 5000 };

const UNDETERMINED = { status: 'undetermined', granted: false, canAskAgain: true };
const DENIED_FOR_GOOD = { status: 'denied', granted: false, canAskAgain: false };
const GRANTED = { status: 'granted', granted: true, canAskAgain: true };

let listeners: Array<(s: AppStateStatus) => void> = [];
let openSettings: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  getPermissions.mockResolvedValue(UNDETERMINED);
  requestPermissions.mockResolvedValue(GRANTED);
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    listeners.push(fn as (s: AppStateStatus) => void);
    return { remove: () => { listeners = listeners.filter((l) => l !== fn); } } as never;
  });
});

afterAll(() => {
  // Other suites expect permission granted (jest.ui.setup.js)
  getPermissions.mockResolvedValue({ status: 'granted' });
});

/** From the empty list: Add → name → (repeats by default) → Track this. */
async function addRepeating(name: string) {
  fireEvent.press(await screen.findByTestId(screen.queryByTestId('empty-add-button') ? 'empty-add-button' : 'main-add-button', {}, LIST_LOADS));
  fireEvent.changeText(await screen.findByTestId('add-name-input'), name);
  fireEvent.press(screen.getByTestId('add-save-button'));
}

it('is never asked for at launch', async () => {
  render(<App />);
  await screen.findByTestId('empty-add-button', {}, LIST_LOADS);
  expect(requestPermissions).not.toHaveBeenCalled();
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalled();
});

it('a once-off item asks nothing', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button', {}, LIST_LOADS));
  // ("Passport" would start on "Until it's due", which has reminders)
  fireEvent.changeText(await screen.findByTestId('add-name-input'), 'Haircut');
  fireEvent.press(screen.getByTestId('add-onceoff-option'));
  fireEvent.press(screen.getByTestId('add-save-button'));
  await screen.findByTestId('item-Haircut');
  expect(screen.queryByTestId('reminders-permission-screen')).toBeNull();
});

it("a one-off date item (\"Until it's due\") is reminded, so it explains first", async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button', {}, LIST_LOADS));
  fireEvent.changeText(await screen.findByTestId('add-name-input'), 'Passport');
  fireEvent.press(screen.getByTestId('add-due-in-1-year'));
  fireEvent.press(screen.getByTestId('add-save-button'));
  expect(await screen.findByText(REMINDERS_COPY.body)).toBeTruthy();
});

it('the first repeating item explains first; Not now is a real answer and is never asked again', async () => {
  render(<App />);
  await addRepeating('Water plants');

  expect(await screen.findByText(REMINDERS_COPY.body)).toBeTruthy();
  expect(requestPermissions).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('reminders-not-now-button'));

  await screen.findByTestId('item-Water plants');
  expect(requestPermissions).not.toHaveBeenCalled();

  // The list says, calmly, that reminders are off; hiding it is for good
  await screen.findByTestId('reminders-off-notice');
  expect(screen.getByText(REMINDERS_COPY.offNotice)).toBeTruthy();
  fireEvent.press(screen.getByTestId('reminders-off-dismiss'));
  await waitFor(() => expect(screen.queryByTestId('reminders-off-notice')).toBeNull());

  // Another repeating item: no explanation, no prompt
  await addRepeating('Gutters');
  await screen.findByTestId('item-Gutters');
  expect(screen.queryByTestId('reminders-permission-screen')).toBeNull();
  expect(requestPermissions).not.toHaveBeenCalled();
  expect(screen.queryByTestId('reminders-off-notice')).toBeNull();
});

it('Turn on shows the system prompt, and once granted everything is scheduled', async () => {
  render(<App />);
  await addRepeating('Dentist');
  fireEvent.press(await screen.findByTestId('reminders-turn-on-button'));

  await screen.findByTestId('item-Dentist');
  expect(requestPermissions).toHaveBeenCalledTimes(1);
  expect(schedule).toHaveBeenCalled();
});

it('reminders are plain date triggers, so they schedule without the exact-alarm permission', async () => {
  render(<App />);
  await addRepeating('Filter');
  fireEvent.press(await screen.findByTestId('reminders-turn-on-button'));

  await waitFor(() => expect(schedule).toHaveBeenCalled());
  for (const [request] of schedule.mock.calls) {
    expect(request.trigger).toEqual({ type: 'date', date: expect.any(Date) });
  }
});

it("once Android won't show its prompt again, the button opens settings instead", async () => {
  getPermissions.mockResolvedValue(DENIED_FOR_GOOD);
  render(<App />);
  await addRepeating('Car service');

  expect(await screen.findByText(REMINDERS_COPY.blockedBody)).toBeTruthy();
  expect(screen.getByTestId('reminders-turn-on-button')).toHaveTextContent(REMINDERS_COPY.openSettings);
  fireEvent.press(screen.getByTestId('reminders-turn-on-button'));

  await screen.findByTestId('item-Car service');
  expect(openSettings).toHaveBeenCalledTimes(1);
  expect(requestPermissions).not.toHaveBeenCalled();
});

it('the notice opens settings, and turning reminders on there is noticed on return', async () => {
  await AsyncStorage.setItem('@since_reminder_prompt_v1', JSON.stringify({ explained: true }));
  await createItem({ name: 'Smoke alarm', category: 'Household', lastDoneDate: '2026-09-01', repeatValue: 1, repeatUnit: 'years' });
  getPermissions.mockResolvedValue(DENIED_FOR_GOOD);
  render(<App />);

  fireEvent.press(await screen.findByTestId('reminders-off-settings', {}, LIST_LOADS));
  expect(openSettings).toHaveBeenCalled();

  // Turned on in settings, then back to the app
  schedule.mockClear();
  getPermissions.mockResolvedValue(GRANTED);
  await act(async () => {
    listeners.forEach((l) => l('background'));
    listeners.forEach((l) => l('active'));
  });
  await waitFor(() => expect(screen.queryByTestId('reminders-off-notice')).toBeNull());
  expect(schedule).toHaveBeenCalled();
  expect(requestPermissions).not.toHaveBeenCalled();
});

it('no notice without repeating items, or with reminders on', async () => {
  await createItem({ name: 'Passport', category: 'Admin', lastDoneDate: '2026-09-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  await screen.findByTestId('item-Passport', {}, LIST_LOADS);
  expect(screen.queryByTestId('reminders-off-notice')).toBeNull();
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import App from '../../../App';
import { createItem, getDerivedItems } from '../../domain/items/service';
import { rescheduleAllNotifications } from '../../notifications/scheduler';
import { todayString } from '../../utils/dateUtils';

/**
 * Households on the phone (sync plan, PR 6), with a household already known
 * (as the sync engine stores it). Runs local-only, so nothing reaches a
 * server: these check what the screens offer and what gets saved.
 */
const ME = 'user-me';
const SAM = 'user-sam';
const HOME = 'household-home';

async function inHousehold(myRole: 'owner' | 'member', mutes: string[] = []) {
  await AsyncStorage.setItem('@since_household_v1', JSON.stringify({
    userId: ME,
    household: {
      id: HOME,
      name: 'Home',
      members: [
        { userId: ME, displayName: 'Alex', role: myRole },
        { userId: SAM, displayName: 'Sam', role: myRole === 'owner' ? 'member' : 'owner' },
      ],
    },
    mutes,
  }));
}

/** Put a shared item of Sam's on the phone, as a sync would. */
async function samsSharedItem(name: string, lastDone = '2026-01-05') {
  const raw = await AsyncStorage.getItem('@since_v1_items');
  const items = raw ? JSON.parse(raw).items : [];
  items.push({
    id: `sam-${name}`, name, category: 'Household', lastDoneDate: lastDone,
    history: [{ id: 'by-sam', date: lastDone, createdBy: SAM }, { id: 'first', date: '2026-01-01', createdBy: SAM }],
    repeatValue: 1, repeatUnit: 'weeks',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ownerId: SAM, householdId: HOME,
  });
  await AsyncStorage.setItem('@since_v1_items', JSON.stringify({ version: 3, items }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('without a household, there is no filter, no tag and no "Who is this for?"', async () => {
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2026-05-01', repeatValue: 6, repeatUnit: 'months' });
  render(<App />);
  await screen.findByTestId('item-Gutters');
  expect(screen.queryByTestId('main-filter-all')).toBeNull();
  fireEvent.press(screen.getByTestId('main-add-button'));
  await screen.findByTestId('add-name-input');
  expect(screen.queryByTestId('add-household-option')).toBeNull();
});

it('adding an item for the household shares it, and the list tags and filters it', async () => {
  await inHousehold('member');
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2026-05-01', repeatValue: 6, repeatUnit: 'months' });
  render(<App />);
  await screen.findByTestId('item-Gutters');

  fireEvent.press(screen.getByTestId('main-add-button'));
  fireEvent.changeText(await screen.findByTestId('add-name-input'), 'Bins');
  fireEvent.press(screen.getByTestId('add-household-option'));
  fireEvent.press(screen.getByTestId('add-onceoff-option'));
  fireEvent.press(screen.getByTestId('add-save-button'));
  await screen.findByTestId('item-Bins');

  const bins = (await getDerivedItems()).find((i) => i.name === 'Bins')!;
  expect(bins.householdId).toBe(HOME);
  expect(screen.getByTestId('item-Bins-household-tag')).toBeTruthy();
  expect(screen.queryByTestId('item-Gutters-household-tag')).toBeNull();

  fireEvent.press(screen.getByTestId('main-filter-household'));
  await waitFor(() => expect(screen.queryByTestId('item-Gutters')).toBeNull());
  expect(screen.getByTestId('item-Bins')).toBeTruthy();
  fireEvent.press(screen.getByTestId('main-filter-mine'));
  await waitFor(() => expect(screen.queryByTestId('item-Bins')).toBeNull());
  expect(screen.getByTestId('item-Gutters')).toBeTruthy();
});

it("a member can't delete, or change who it's for on, someone else's shared item", async () => {
  await inHousehold('member');
  await samsSharedItem('Recycling');
  render(<App />);
  await screen.findByTestId('item-Recycling');
  expect(screen.queryByTestId('item-Recycling-delete')).toBeNull();

  fireEvent.press(screen.getByTestId('item-Recycling-edit'));
  await screen.findByTestId('edit-name-input');
  expect(screen.queryByTestId('edit-household-option')).toBeNull();
  expect(screen.queryByTestId('edit-delete-button')).toBeNull();
});

it("the household's owner can delete a member's shared item", async () => {
  await inHousehold('owner');
  await samsSharedItem('Recycling');
  render(<App />);
  await screen.findByTestId('item-Recycling');
  expect(screen.getByTestId('item-Recycling-delete')).toBeTruthy();
});

it('the item screen says who did each entry, and offers "Remind me about this"', async () => {
  await inHousehold('member');
  await samsSharedItem('Recycling');
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Recycling-history'));
  expect(await screen.findByTestId('history-done-by-0')).toHaveTextContent('Done by Sam');
  expect(screen.getByTestId('detail-remind-me')).toBeTruthy();
});

it("muted shared items get no reminders on this phone; everything else still does", async () => {
  await inHousehold('member', [`${SAM}/sam-Recycling`]);
  // Done today, weekly: its reminders are all still to come
  await samsSharedItem('Recycling', todayString());
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2026-01-01', repeatValue: 1, repeatUnit: 'years' });
  jest.clearAllMocks();

  await rescheduleAllNotifications(await getDerivedItems());
  const ids = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map((c) => c[0].identifier as string);
  expect(ids.some((id) => id.includes('sam-Recycling'))).toBe(false);
  expect(ids.some((id) => !id.includes('sam-Recycling') && !id.includes('grouped'))).toBe(true);
});

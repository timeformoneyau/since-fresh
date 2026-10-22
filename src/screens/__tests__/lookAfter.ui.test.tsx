import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { format, subDays, subMonths } from 'date-fns';
import App from '../../../App';
import { createItem, getDerivedItems } from '../../domain/items/service';

/**
 * Who looks after a shared item (Shared load), with a household already
 * known on the phone (as the sync engine stores it). Runs local-only, so
 * these check what the screens offer, what gets saved and what's reminded.
 */
type ReactTestInstance = ReturnType<typeof screen.getByTestId>;

const ME = 'user-me';
const SAM = 'user-sam';
const JO = 'user-jo';
const HOME = 'household-home';
const FIRST = { timeout: 5000 };
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

async function inHousehold() {
  await AsyncStorage.setItem('@since_household_v1', JSON.stringify({
    userId: ME,
    household: {
      id: HOME,
      name: 'Home',
      members: [
        { userId: SAM, displayName: 'Sam', role: 'owner' },
        { userId: ME, displayName: 'Alex', role: 'member' },
        { userId: JO, displayName: 'Jo', role: 'member' },
      ],
    },
    mutes: [],
  }));
}

/** A shared item of Sam's, as a sync would put it on the phone. */
async function samsItem(name: string, lastDone: string, lookedAfterBy?: string | null) {
  const raw = await AsyncStorage.getItem('@since_v1_items');
  const items = raw ? JSON.parse(raw).items : [];
  items.push({
    id: `sam-${name}`, name, category: 'Household', lastDoneDate: lastDone,
    history: [{ id: `${name}-e`, date: lastDone, createdBy: SAM }],
    repeatValue: 1, repeatUnit: 'months',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ownerId: SAM, householdId: HOME,
    ...(lookedAfterBy !== undefined ? { lookedAfterBy } : {}),
  });
  await AsyncStorage.setItem('@since_v1_items', JSON.stringify({ version: 3, items }));
}

/** testIDs of headings and cards, top to bottom. */
function order(): string[] {
  const shown = (n: ReactTestInstance) =>
    typeof n.type === 'string' && typeof n.props.testID === 'string' && /^(group-.+|item-[^-]+)$/.test(n.props.testID);
  return screen.UNSAFE_root.findAll(shown).map((n: ReactTestInstance) => n.props.testID as string);
}

const scheduled = () =>
  jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.map(([n]) => n.identifier ?? '');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

it('outside a household: no "By person" and no "Who looks after this?"', async () => {
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2026-05-01', repeatValue: 6, repeatUnit: 'months' });
  // A "By person" saved while in a household shows as Most urgent
  await AsyncStorage.setItem('@since_list_view_v1', JSON.stringify({ version: 1, view: 'person' }));
  render(<App />);
  await screen.findByTestId('item-Gutters', {}, FIRST);
  expect(screen.queryByTestId('main-view-person')).toBeNull();
  expect(screen.getByTestId('main-view-urgent').props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(screen.getByTestId('main-add-button'));
  fireEvent.press(await screen.findByTestId('add-onceoff-option'));
  expect(screen.queryByTestId('add-look-after-anyone')).toBeNull();
});

it('Add: the choice appears for a household item only, starts at Anyone, and is saved', async () => {
  await inHousehold();
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2026-05-01', repeatValue: 6, repeatUnit: 'months' });
  render(<App />);
  await screen.findByTestId('item-Gutters', {}, FIRST);

  fireEvent.press(screen.getByTestId('main-add-button'));
  fireEvent.changeText(await screen.findByTestId('add-name-input'), 'Bins');
  expect(screen.queryByTestId('add-look-after-anyone')).toBeNull(); // Just me by default
  fireEvent.press(screen.getByTestId('add-household-option'));
  expect(screen.getByText('Who looks after this?')).toBeTruthy();
  expect(screen.getByTestId('add-look-after-anyone').props.accessibilityState).toEqual({ checked: true, disabled: undefined });
  expect(screen.getByTestId('add-look-after-you')).toBeTruthy();
  fireEvent.press(screen.getByTestId(`add-look-after-${SAM}`));
  fireEvent.press(screen.getByTestId('add-save-button'));
  await screen.findByTestId('item-Bins');

  const bins = (await getDerivedItems()).find((i) => i.name === 'Bins')!;
  expect(bins.householdId).toBe(HOME);
  expect(bins.lookedAfterBy).toBe(SAM);
  // A quiet tag names the person
  expect(within(screen.getByTestId('item-Bins-looked-after-tag')).getByText('Sam')).toBeTruthy();
  expect(screen.getByTestId('item-Bins-looked-after-tag').props.accessibilityLabel).toBe('Sam looks after this');
  // Nobody chosen: no tag
  expect(screen.queryByTestId('item-Gutters-looked-after-tag')).toBeNull();
});

it("Add: a person chosen and then switched back to Just me isn't saved", async () => {
  await inHousehold();
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button', {}, FIRST));
  fireEvent.changeText(await screen.findByTestId('add-name-input'), 'Passport');
  fireEvent.press(screen.getByTestId('add-household-option'));
  fireEvent.press(screen.getByTestId('add-look-after-you'));
  fireEvent.press(screen.getByTestId('add-justme-option'));
  fireEvent.press(screen.getByTestId('add-save-button'));
  await screen.findByTestId('item-Passport', {}, FIRST);
  const passport = (await getDerivedItems())[0];
  expect(passport.householdId ?? null).toBeNull();
  expect(passport.lookedAfterBy ?? null).toBeNull();
});

it("item screen: I'll look after this, then hand it to someone else; reminders follow", async () => {
  await inHousehold();
  await samsItem('Bins', ymd(subDays(new Date(), 1))); // done yesterday, so its reminders are ahead
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Bins-history', {}, FIRST));
  await screen.findByTestId('detail-look-after');
  expect(screen.getByTestId('detail-look-after-anyone').props.accessibilityState.checked).toBe(true);

  jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
  fireEvent.press(screen.getByTestId('detail-look-after-you'));
  await waitFor(() => expect(screen.getByTestId('detail-look-after-you').props.accessibilityState.checked).toBe(true));
  expect(screen.getByTestId('detail-look-after-you').props.accessibilityLabel).toBe("I'll look after this");
  expect((await getDerivedItems())[0].lookedAfterBy).toBe(ME);
  expect(scheduled().some((id) => id.includes('sam-Bins'))).toBe(true);

  jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
  fireEvent.press(screen.getByTestId(`detail-look-after-${JO}`));
  await waitFor(async () => expect((await getDerivedItems())[0].lookedAfterBy).toBe(JO));
  expect(scheduled().some((id) => id.includes('sam-Bins'))).toBe(false);

  // Anyone can still mark it done
  fireEvent.press(screen.getByTestId('detail-mark-done-button'));
  await waitFor(async () => expect((await getDerivedItems())[0].history.length).toBe(2));
});

it('item screen: a Just me item has no choice', async () => {
  await inHousehold();
  await createItem({ name: 'Passport', category: 'Admin', lastDoneDate: '2026-05-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Passport-history', {}, FIRST));
  await screen.findByTestId('detail-add-past-entry');
  expect(screen.queryByTestId('detail-look-after')).toBeNull();
});

it("Edit: any member can change who looks after someone else's item, but not who it's for", async () => {
  await inHousehold();
  await samsItem('Bins', '2026-10-01', SAM);
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Bins-edit', {}, FIRST));
  await screen.findByTestId('edit-name-input');
  expect(screen.queryByTestId('edit-household-option')).toBeNull();
  expect(screen.getByTestId(`edit-look-after-${SAM}`).props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByTestId('edit-look-after-anyone'));
  fireEvent.press(screen.getByTestId('edit-save-button'));
  await screen.findByTestId('item-Bins');
  expect((await getDerivedItems())[0].lookedAfterBy).toBeNull();
  expect(screen.queryByTestId('item-Bins-looked-after-tag')).toBeNull();
});

it('Edit: changing my item to Just me clears who looks after it', async () => {
  await inHousehold();
  await createItem({
    name: 'Mower', category: 'Household', lastDoneDate: '2026-10-01', repeatValue: 1, repeatUnit: 'months',
    householdId: HOME, lookedAfterBy: JO,
  });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Mower-edit', {}, FIRST));
  fireEvent.press(await screen.findByTestId('edit-justme-option'));
  expect(screen.queryByTestId('edit-look-after-anyone')).toBeNull();
  fireEvent.press(screen.getByTestId('edit-save-button'));
  await screen.findByTestId('item-Mower');
  expect((await getDerivedItems())[0].lookedAfterBy).toBeNull();
});

describe('By person', () => {
  async function seed() {
    await inHousehold();
    const monthAgo = (days: number) => ymd(subDays(subMonths(new Date(), 1), days));
    await samsItem('Rego', monthAgo(20), JO);          // most urgent
    await samsItem('Gutters', monthAgo(10));           // Anyone
    await samsItem('Filter', monthAgo(5), ME);
    await samsItem('Bins', monthAgo(1), SAM);
    await createItem({ name: 'Dentist', category: 'Health', lastDoneDate: monthAgo(2), repeatValue: 1, repeatUnit: 'months' });
    render(<App />);
    await screen.findByTestId('item-Rego', {}, FIRST);
  }

  it('groups You (with Just me items), each member, then Anyone, most urgent first inside each', async () => {
    await seed();
    fireEvent.press(screen.getByTestId('main-view-person'));
    await screen.findByTestId('group-person-you');
    expect(order()).toEqual([
      'group-person-you', 'item-Filter', 'item-Dentist',
      `group-person-member-${SAM}`, 'item-Bins',
      `group-person-member-${JO}`, 'item-Rego',
      'group-person-anyone', 'item-Gutters',
    ]);
    expect(within(screen.getByTestId(`group-person-member-${JO}`)).getByText('Jo')).toBeTruthy();
    expect(within(screen.getByTestId('group-person-you')).getByText('2')).toBeTruthy();
    // Remembered after a restart
    expect(JSON.parse((await AsyncStorage.getItem('@since_list_view_v1'))!).view).toBe('person');
  });

  it('combines with the Just me / Household filter; the summary still shows', async () => {
    await seed();
    fireEvent.press(screen.getByTestId('main-view-person'));
    fireEvent.press(screen.getByTestId('main-filter-household'));
    await waitFor(() => expect(screen.queryByTestId('item-Dentist')).toBeNull());
    expect(order()).toEqual([
      'group-person-you', 'item-Filter',
      `group-person-member-${SAM}`, 'item-Bins',
      `group-person-member-${JO}`, 'item-Rego',
      'group-person-anyone', 'item-Gutters',
    ]);
    fireEvent.press(screen.getByTestId('main-filter-mine'));
    await waitFor(() => expect(order()).toEqual(['group-person-you', 'item-Dentist']));
    expect(screen.getByTestId('summary-card')).toBeTruthy();
  });
});

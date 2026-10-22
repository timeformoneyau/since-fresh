import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, subDays, subMonths } from 'date-fns';
import App from '../../../App';
import { createItem } from '../../domain/items/service';

type ReactTestInstance = ReturnType<typeof screen.getByTestId>;

const VIEW_KEY = '@since_list_view_v1';
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const ago = (days: number) => ymd(subDays(new Date(), days));

beforeEach(() => AsyncStorage.clear());

/** Three items over two categories; Rego is the most urgent. */
async function seed() {
  const add = (name: string, category: string, lastDoneDate: string) =>
    createItem({ name, category, lastDoneDate, repeatValue: 1, repeatUnit: 'months' });
  await add('Rego', 'Auto', ymd(subDays(subMonths(new Date(), 1), 20)));   // overdue 20 days
  await add('Gutters', 'Household', ymd(subDays(subMonths(new Date(), 1), 5)));
  await add('Tyres', 'Auto', ago(2));                                      // not due for weeks
}

/** testIDs of headings and cards, top to bottom. */
function order(): string[] {
  const shown = (n: ReactTestInstance) =>
    typeof n.type === 'string' && typeof n.props.testID === 'string' && /^(group-.+|item-[^-]+)$/.test(n.props.testID);
  return screen.UNSAFE_root.findAll(shown).map((n: ReactTestInstance) => n.props.testID as string);
}

async function openList() {
  render(<App />);
  await screen.findByTestId('item-Rego');
}

it('starts as "Most urgent": one list, no headings, as before', async () => {
  await seed();
  await openList();
  expect(screen.getByTestId('main-view-urgent').props.accessibilityState).toEqual({ selected: true });
  expect(screen.queryByTestId('group-Auto')).toBeNull();
  expect(order()).toEqual(['item-Rego', 'item-Gutters', 'item-Tyres']);
});

it('"By category" groups under headings with counts, most urgent group first', async () => {
  await seed();
  await openList();
  fireEvent.press(screen.getByTestId('main-view-category'));

  expect(await screen.findByTestId('group-Auto')).toBeTruthy();
  expect(within(screen.getByTestId('group-Auto')).getByText('2')).toBeTruthy();
  expect(within(screen.getByTestId('group-Household')).getByText('1')).toBeTruthy();
  expect(order()).toEqual(['group-Auto', 'item-Rego', 'item-Tyres', 'group-Household', 'item-Gutters']);

  // and back
  fireEvent.press(screen.getByTestId('main-view-urgent'));
  await waitFor(() => expect(screen.queryByTestId('group-Auto')).toBeNull());
  expect(order()).toEqual(['item-Rego', 'item-Gutters', 'item-Tyres']);
});

it('remembers the choice on this phone', async () => {
  await seed();
  await openList();
  fireEvent.press(screen.getByTestId('main-view-category'));
  await waitFor(async () =>
    expect(JSON.parse((await AsyncStorage.getItem(VIEW_KEY))!)).toMatchObject({ view: 'category' }),
  );
  screen.unmount();

  render(<App />);
  expect(await screen.findByTestId('group-Auto')).toBeTruthy();
  expect(screen.getByTestId('main-view-category').props.accessibilityState).toEqual({ selected: true });
});

it.each([
  ['missing', null],
  ['unreadable', 'not json'],
  ['unknown', JSON.stringify({ version: 1, view: 'alphabetical' })],
])('falls back to "Most urgent" and loses nothing when the stored value is %s', async (_name, raw) => {
  await seed();
  if (raw !== null) await AsyncStorage.setItem(VIEW_KEY, raw);
  await openList();
  await waitFor(() => expect(order()).toEqual(['item-Rego', 'item-Gutters', 'item-Tyres']));
  expect(screen.getByTestId('main-view-urgent').props.accessibilityState).toEqual({ selected: true });
});

it('items in any category appear, including old "Food" items and ones with none', async () => {
  const raw = (await AsyncStorage.getItem('@since_v1_items')) ?? JSON.stringify({ version: 3, items: [] });
  const base = { history: [{ id: 'e', date: ago(3) }], lastDoneDate: ago(3), repeatValue: null, repeatUnit: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const items = [...JSON.parse(raw).items,
    { ...base, id: 'milk', name: 'Milk', category: 'Food' },
    { ...base, id: 'odd', name: 'Mystery', category: '' }];
  await AsyncStorage.setItem('@since_v1_items', JSON.stringify({ version: 3, items }));
  await AsyncStorage.setItem(VIEW_KEY, JSON.stringify({ version: 1, view: 'category' }));

  render(<App />);
  expect(await screen.findByTestId('group-Food')).toBeTruthy();
  expect(screen.getByTestId('group-No category')).toBeTruthy();
  expect(screen.getByTestId('item-Milk')).toBeTruthy();
  expect(screen.getByTestId('item-Mystery')).toBeTruthy();
});

it('mark done and Undo work in the grouped view', async () => {
  await seed();
  await AsyncStorage.setItem(VIEW_KEY, JSON.stringify({ version: 1, view: 'category' }));
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Rego-done'));
  expect(await screen.findByText('Rego marked as done')).toBeTruthy();
  // Rego is no longer urgent, so Household now leads
  await waitFor(() => expect(order()[0]).toBe('group-Household'));
  fireEvent.press(screen.getByText('Undo'));
  await waitFor(() => expect(order()[0]).toBe('group-Auto'));
});

it('combines with the household filter', async () => {
  await AsyncStorage.setItem('@since_household_v1', JSON.stringify({
    userId: 'me',
    household: { id: 'home', name: 'Home', members: [{ userId: 'me', displayName: 'Alex', role: 'owner' }] },
    mutes: [],
  }));
  await seed();
  await createItem({ name: 'Bins', category: 'Household', lastDoneDate: ago(1), repeatValue: 1, repeatUnit: 'weeks', householdId: 'home' });
  await AsyncStorage.setItem(VIEW_KEY, JSON.stringify({ version: 1, view: 'category' }));
  render(<App />);
  await screen.findByTestId('group-Auto');

  fireEvent.press(screen.getByTestId('main-filter-household'));
  await waitFor(() => expect(order()).toEqual(['group-Household', 'item-Bins']));
  fireEvent.press(screen.getByTestId('main-filter-mine'));
  await waitFor(() => expect(order()).toEqual(['group-Auto', 'item-Rego', 'item-Tyres', 'group-Household', 'item-Gutters']));
});

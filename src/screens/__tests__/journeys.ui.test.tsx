import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import App from '../../../App';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createItem } from '../../domain/items/service';

// Each test renders the whole app in local-only mode (jest.ui.setup.js),
// starting from an empty list.
beforeEach(() => AsyncStorage.clear());

type ListState = 'empty' | 'list';

/**
 * The list renders empty for a moment while items load, so say which state to
 * expect: the empty state shows "Add something", the list header shows ＋.
 */
async function openAdd(from: ListState) {
  fireEvent.press(await screen.findByTestId(from === 'empty' ? 'empty-add-button' : 'main-add-button'));
  return screen.findByTestId('add-name-input');
}

async function addItem(from: ListState, name: string, repeat?: { value: string; unit: string }) {
  fireEvent.changeText(await openAdd(from), name);
  if (repeat) {
    fireEvent.changeText(screen.getByTestId('add-repeat-input'), repeat.value);
    fireEvent.press(screen.getByTestId(`add-unit-${repeat.unit}`));
  }
  fireEvent.press(screen.getByTestId('add-save-button'));
  return screen.findByTestId(`item-${name}`);
}

it('adds an item with a name only (no repeat) and shows it on the list', async () => {
  render(<App />);
  await addItem('empty', 'Haircut');
  expect(screen.getByText('Haircut')).toBeTruthy();
  expect(screen.getAllByText('Tracked only').length).toBeGreaterThan(0);
});

it('adds an item with a repeat cycle', async () => {
  render(<App />);
  await addItem('empty', 'Water plants', { value: '2', unit: 'weeks' });
  expect(await screen.findByText(/in 14 days/)).toBeTruthy();
});

it('marks an item done from the list', async () => {
  await createItem({
    name: 'Car service',
    category: 'Auto',
    lastDoneDate: '2026-01-01',
    repeatValue: null,
    repeatUnit: null,
  });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Car service-done'));
  await waitFor(() =>
    expect(screen.getByTestId('item-Car service')).toHaveTextContent(/Done today/),
  );
});

it('edits an item name', async () => {
  render(<App />);
  await addItem('empty', 'Gutters');

  fireEvent.press(screen.getByTestId('item-Gutters-edit'));
  const nameInput = await screen.findByTestId('edit-name-input');
  await waitFor(() => expect(nameInput.props.value).toBe('Gutters'));
  fireEvent.changeText(nameInput, 'Clean gutters');
  fireEvent.press(screen.getByTestId('edit-save-button'));

  expect(await screen.findByTestId('item-Clean gutters')).toBeTruthy();
  expect(screen.queryByTestId('item-Gutters')).toBeNull();
});

it('deletes an item from the list (swipe action), then Undo brings it back with its history', async () => {
  await createItem({ name: 'Passport', category: 'Admin', lastDoneDate: '2025-05-01', repeatValue: 10, repeatUnit: 'years' });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Passport-done'));
  fireEvent.press(await screen.findByTestId('toast-action')); // undo that, keep history at 1
  fireEvent.press(await screen.findByTestId('item-Passport-delete'));

  expect(await screen.findByText('Passport deleted')).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('item-Passport')).toBeNull());

  fireEvent.press(screen.getByTestId('toast-action'));
  expect(await screen.findByTestId('item-Passport')).toHaveTextContent(/days ago/);
});

it('deletes an item from the Edit screen, then Undo brings it back', async () => {
  render(<App />);
  await addItem('empty', 'Smoke alarm');

  fireEvent.press(screen.getByTestId('item-Smoke alarm-edit'));
  fireEvent.press(await screen.findByTestId('edit-delete-button'));

  expect(await screen.findByText('Smoke alarm deleted')).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('item-Smoke alarm')).toBeNull());
  fireEvent.press(screen.getByTestId('toast-action'));
  expect(await screen.findByTestId('item-Smoke alarm')).toBeTruthy();
});

it('marks done from the list, then Undo puts the previous date back', async () => {
  await createItem({ name: 'Gym bag', category: 'Health', lastDoneDate: '2026-01-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Gym bag-done'));
  await waitFor(() => expect(screen.getByTestId('item-Gym bag')).toHaveTextContent(/Done today/));
  expect(screen.getByText('Gym bag marked as done')).toBeTruthy();

  fireEvent.press(screen.getByTestId('toast-action'));
  await waitFor(() => expect(screen.getByTestId('item-Gym bag')).toHaveTextContent(/days ago/));
});

it('History screen: Mark done today, Undo from the toast, and Undo later from the list', async () => {
  await createItem({ name: 'Bike chain', category: 'Other', lastDoneDate: '2026-01-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Bike chain-history'));

  // Nothing to undo yet: only the entry from adding it
  await screen.findByTestId('detail-mark-done-button');
  expect(screen.queryByTestId('detail-undo-latest')).toBeNull();

  fireEvent.press(screen.getByTestId('detail-mark-done-button'));
  expect(await screen.findByTestId('detail-undo-latest')).toBeTruthy();
  fireEvent.press(screen.getByTestId('toast-action'));
  await waitFor(() => expect(screen.queryByTestId('detail-undo-latest')).toBeNull());

  // Mark done again, then undo it later from History
  fireEvent.press(screen.getByTestId('detail-mark-done-button'));
  fireEvent.press(await screen.findByTestId('detail-undo-latest'));
  await waitFor(() => expect(screen.queryByTestId('detail-undo-latest')).toBeNull());
});

it('History screen has a visible way to Edit', async () => {
  await createItem({ name: 'Boiler', category: 'Household', lastDoneDate: '2026-01-01', repeatValue: 1, repeatUnit: 'years' });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Boiler-history'));
  fireEvent.press(await screen.findByTestId('detail-edit-button'));
  expect(await screen.findByTestId('edit-name-input')).toBeTruthy();
});

it('Add: the repeat is clearly optional, and leaving it blank saves a tracked-only item', async () => {
  render(<App />);
  await openAdd('empty');
  expect(screen.getByText('Repeat every (optional)')).toBeTruthy();
  expect(screen.getByPlaceholderText('No repeat')).toBeTruthy();
  expect(screen.getByText(/Leave blank to just keep track/)).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('add-name-input'), 'Hair dye');
  fireEvent.press(screen.getByTestId('add-save-button'));
  expect(await screen.findByTestId('item-Hair dye')).toHaveTextContent(/Tracked only/);
});

it('Add: tapping Save with no name shows the hint, typing a name clears it', async () => {
  render(<App />);
  await openAdd('empty');
  expect(screen.getByText('Name')).toBeTruthy();
  expect(screen.queryByTestId('add-save-hint')).toBeNull();

  fireEvent.press(screen.getByTestId('add-save-button'));
  expect(await screen.findByText('Add a name to save')).toBeTruthy();

  fireEvent.changeText(screen.getByTestId('add-name-input'), 'Dentist');
  expect(screen.queryByTestId('add-save-hint')).toBeNull();
});

it('Edit: clearing the name and tapping Save shows the hint', async () => {
  await createItem({ name: 'Boiler', category: 'Household', lastDoneDate: '2026-01-01', repeatValue: 1, repeatUnit: 'years' });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Boiler-edit'));
  const nameInput = await screen.findByTestId('edit-name-input');
  await waitFor(() => expect(nameInput.props.value).toBe('Boiler'));
  fireEvent.changeText(nameInput, '');
  fireEvent.press(screen.getByTestId('edit-save-button'));
  expect(await screen.findByTestId('edit-save-hint')).toBeTruthy();
});

it('Finance is offered as a category', async () => {
  render(<App />);
  await openAdd('empty');
  fireEvent.press(screen.getByText('Other')); // the category row shows the current one
  expect(await screen.findByText('Finance')).toBeTruthy();
});

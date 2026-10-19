import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import App from '../../../App';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { createItem, addHistoryEntry } from '../../domain/items/service';
import { todayString as todayIso } from '../../utils/dateUtils';

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
  expect(screen.getAllByText('Once off').length).toBeGreaterThan(0);
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
    repeatValue: 1,
    repeatUnit: 'years',
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
  await createItem({ name: 'Gym bag', category: 'Health', lastDoneDate: '2026-01-01', repeatValue: 1, repeatUnit: 'years' });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Gym bag-done'));
  await waitFor(() => expect(screen.getByTestId('item-Gym bag')).toHaveTextContent(/Done today/));
  expect(screen.getByText('Gym bag marked as done')).toBeTruthy();

  fireEvent.press(screen.getByTestId('toast-action'));
  await waitFor(() => expect(screen.getByTestId('item-Gym bag')).toHaveTextContent(/days ago/));
});

it('Item screen: Done today, Undo from the toast, and later remove the entry from its edit screen', async () => {
  await createItem({ name: 'Bike chain', category: 'Other', lastDoneDate: '2026-01-01', repeatValue: 3, repeatUnit: 'months' });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Bike chain-history'));

  expect(await screen.findByTestId('detail-history-summary')).toHaveTextContent('1 entry');
  fireEvent.press(screen.getByTestId('detail-mark-done-button'));
  await waitFor(() => expect(screen.getByTestId('detail-history-summary')).toHaveTextContent('2 entries'));
  fireEvent.press(screen.getByTestId('toast-action'));
  await waitFor(() => expect(screen.getByTestId('detail-history-summary')).toHaveTextContent('1 entry'));

  // Done again, then delete that entry later from its edit screen
  fireEvent.press(screen.getByTestId('detail-mark-done-button'));
  await waitFor(() => expect(screen.getByTestId('detail-history-summary')).toHaveTextContent('2 entries'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
  fireEvent.press(screen.getByTestId('history-edit-0'));
  fireEvent.press(await screen.findByTestId('entry-delete-button'));
  await waitFor(() => expect(screen.getByTestId('detail-history-summary')).toHaveTextContent('1 entry'));
  alert.mockRestore();
});

it('Item screen: status columns, the due marker and the history timeline', async () => {
  // Every 30 days; done 3 times, latest long ago, so it's overdue
  const created = await createItem({ name: 'Haircut', category: 'Health', lastDoneDate: '2025-06-06', repeatValue: 30, repeatUnit: 'days' });
  await addHistoryEntry(created.id, '2025-07-08');
  await addHistoryEntry(created.id, '2025-08-09');
  await addHistoryEntry(created.id, '2025-09-11');
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Haircut-history'));

  expect(await screen.findByText('Repeats every 30 days')).toBeTruthy();
  const card = screen.getByTestId('detail-status-card');
  expect(card).toHaveTextContent(/Last done.*11 Sep/);
  expect(card).toHaveTextContent(/Was due.*11 Oct/);
  expect(card).toHaveTextContent(/Usually.*32 days.*between each/);
  expect(screen.getByTestId('detail-history-summary')).toHaveTextContent('4 entries · about every 32 days');
  expect(screen.getByTestId('detail-due-marker')).toHaveTextContent(/Due 11 Oct 2025.*30 days after your last one\. Still waiting\./);
  expect(screen.getByTestId('history-entry-0')).toHaveTextContent(/11 Sep 2025.*Done again · 33 days after the last/);
  expect(screen.getByTestId('history-entry-3')).toHaveTextContent(/6 Jun 2025.*First time · when you started tracking/);
  expect(screen.getByLabelText('Edit the 11 Sep 2025 entry')).toBeTruthy();
});

it('Item screen: a once-off item has no Done today and no due marker', async () => {
  await createItem({ name: 'Passport', category: 'Admin', lastDoneDate: '2025-05-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Passport-history'));
  expect(await screen.findAllByText('Once off')).not.toHaveLength(0);
  expect(screen.queryByTestId('detail-mark-done-button')).toBeNull();
  expect(screen.queryByTestId('detail-due-marker')).toBeNull();
  expect(screen.getByTestId('detail-add-past-entry')).toBeTruthy();
});

it('Edit entry: the note saves; a date outside the neighbours is refused; the last entry stays', async () => {
  const created = await createItem({ name: 'Filter', category: 'Household', lastDoneDate: '2025-03-01', repeatValue: 3, repeatUnit: 'months' });
  await addHistoryEntry(created.id, '2025-06-01');
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Filter-history'));

  // Newest entry: add a note
  fireEvent.press(await screen.findByTestId('history-edit-0'));
  expect(await screen.findByText('Filter · entry 2 of 2')).toBeTruthy();
  expect(screen.getByTestId('entry-date-help')).toHaveTextContent('Somewhere between 1 Mar 2025 and today.');
  fireEvent.changeText(screen.getByTestId('entry-note-input'), 'New brand');
  fireEvent.press(screen.getByTestId('entry-save-button'));
  expect(await screen.findByText('New brand')).toBeTruthy();

  // Move the newest entry to the year before its older neighbour: refused
  fireEvent.press(screen.getByTestId('history-edit-0'));
  fireEvent.press(await screen.findByTestId('entry-date-button'));
  fireEvent.press(await screen.findByTestId('date-year-2024'));
  fireEvent.press(screen.getByTestId('date-picker-done'));
  fireEvent.press(screen.getByTestId('entry-save-button'));
  expect(await screen.findByTestId('entry-error')).toHaveTextContent(/between the entries either side/);
});

it('Edit entry: the only entry can\'t be deleted', async () => {
  await createItem({ name: 'Mattress', category: 'Household', lastDoneDate: '2025-03-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Mattress-history'));
  fireEvent.press(await screen.findByTestId('history-edit-0'));
  fireEvent.press(await screen.findByTestId('entry-delete-button'));
  expect(await screen.findByTestId('entry-error')).toHaveTextContent(
    'Every item needs at least one entry. Delete the item instead.',
  );
});

it('Item screen: add a past entry', async () => {
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: todayIso(), repeatValue: 1, repeatUnit: 'years' });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Gutters-history'));
  fireEvent.press(await screen.findByTestId('detail-add-past-entry'));
  fireEvent.press(await screen.findByTestId(`date-year-${new Date().getFullYear() - 1}`));
  fireEvent.press(screen.getByTestId('date-picker-done'));
  await waitFor(() => expect(screen.getByTestId('detail-history-summary')).toHaveTextContent('2 entries'));
  // An older entry doesn't change when it was last done
  expect(screen.getByTestId('detail-status-card')).toHaveTextContent(/Last done.*today/);
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
  expect(await screen.findByTestId('item-Hair dye')).toHaveTextContent(/Once off/);
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

it('List card: a repeating item has a status chip, a progress bar and a Done pill', async () => {
  await createItem({ name: 'Bins', category: 'Household', lastDoneDate: '2020-01-01', repeatValue: 1, repeatUnit: 'weeks' });
  render(<App />);
  const card = await screen.findByTestId('item-Bins');
  expect(card).toHaveTextContent(/Long overdue/);
  expect(card).toHaveTextContent(/Overdue by \d+ days/);
  expect(screen.getByTestId('item-Bins-done')).toBeTruthy();
  expect(screen.getByTestId('item-Bins-bar')).toBeTruthy();
});

it('List card: a once-off item shows "Once off", no Done pill and no bar', async () => {
  await createItem({ name: 'Passport photo', category: 'Admin', lastDoneDate: '2026-01-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  const card = await screen.findByTestId('item-Passport photo');
  expect(card).toHaveTextContent(/Once off/);
  expect(card).toHaveTextContent(/Kept as a record/);
  expect(screen.queryByTestId('item-Passport photo-done')).toBeNull();
  expect(screen.queryByTestId('item-Passport photo-bar')).toBeNull();
});

it('Summary card counts what could use a look, and drops the line when all is good', async () => {
  await createItem({ name: 'Gutters', category: 'Household', lastDoneDate: '2020-01-01', repeatValue: 1, repeatUnit: 'years' });
  await createItem({ name: 'Boiler', category: 'Household', lastDoneDate: '2020-01-01', repeatValue: 1, repeatUnit: 'years' });
  render(<App />);
  expect(await screen.findByTestId('summary-card')).toHaveTextContent(/2 could use a look/);

  fireEvent.press(screen.getByTestId('item-Gutters-done'));
  fireEvent.press(await screen.findByTestId('item-Boiler-done'));
  await waitFor(() => expect(screen.getByTestId('summary-card')).not.toHaveTextContent(/could use a look/));
  expect(screen.getByTestId('summary-card')).toHaveTextContent(/All good/);
});

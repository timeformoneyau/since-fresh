import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import App from '../../../App';
import { createItem } from '../../domain/items/service';

// Each test renders the whole app in local-only mode (jest.ui.setup.js).
// Items persist across tests in this file, so each test uses its own name.

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

/** Confirm the next Alert by pressing its destructive button ("Delete"). */
function confirmNextAlert() {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _msg, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
}

it('adds an item with a name only (no repeat) and shows it on the list', async () => {
  render(<App />);
  await addItem('empty', 'Haircut');
  expect(screen.getByText('Haircut')).toBeTruthy();
  expect(screen.getAllByText('Tracked only').length).toBeGreaterThan(0);
});

it('adds an item with a repeat cycle', async () => {
  render(<App />);
  await addItem('list', 'Water plants', { value: '2', unit: 'weeks' });
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
  await addItem('list', 'Gutters');

  fireEvent.press(screen.getByTestId('item-Gutters-edit'));
  const nameInput = await screen.findByTestId('edit-name-input');
  await waitFor(() => expect(nameInput.props.value).toBe('Gutters'));
  fireEvent.changeText(nameInput, 'Clean gutters');
  fireEvent.press(screen.getByTestId('edit-save-button'));

  expect(await screen.findByTestId('item-Clean gutters')).toBeTruthy();
  expect(screen.queryByTestId('item-Gutters')).toBeNull();
});

it('deletes an item from the list (after confirming)', async () => {
  render(<App />);
  await addItem('list', 'Passport');

  confirmNextAlert();
  fireEvent.press(screen.getByTestId('item-Passport-delete'));
  await waitFor(() => expect(screen.queryByTestId('item-Passport')).toBeNull());
});

it('deletes an item from the Edit screen (after confirming)', async () => {
  render(<App />);
  await addItem('list', 'Smoke alarm');

  fireEvent.press(screen.getByTestId('item-Smoke alarm-edit'));
  const deleteBtn = await screen.findByTestId('edit-delete-button');
  confirmNextAlert();
  fireEvent.press(deleteBtn);
  await waitFor(() => expect(screen.queryByTestId('item-Smoke alarm')).toBeNull());
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../../App';
import { createItem, getDerivedItems } from '../../domain/items/service';
import { formatDisplay } from '../../utils/dateUtils';

// Changing the unit converts the number (via days) instead of keeping it, and
// switching back gives the number that was set by hand, not a rounded one.
beforeEach(() => AsyncStorage.clear());

const value = (prefix: string) => screen.getByTestId(`${prefix}-repeat-value`);

function stepTo(target: number) {
  const current = () => Number(value('add').props.children);
  while (current() > target) fireEvent.press(screen.getByTestId('add-stepper-minus'));
  while (current() < target) fireEvent.press(screen.getByTestId('add-stepper-plus'));
}

it('Add: 20 days becomes 3 weeks, then 1 month, then 20 days again', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button'));
  await screen.findByTestId('add-name-input');
  stepTo(20);

  fireEvent.press(screen.getByTestId('add-unit-weeks'));
  expect(value('add')).toHaveTextContent('3');
  fireEvent.press(screen.getByTestId('add-unit-months'));
  expect(value('add')).toHaveTextContent('1');
  fireEvent.press(screen.getByTestId('add-unit-days'));
  expect(value('add')).toHaveTextContent('20');
});

it('Add: Next due follows the converted value, and the stepper sets a new starting point', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button'));
  await screen.findByTestId('add-name-input');
  fireEvent.press(screen.getByTestId('add-today'));
  stepTo(14);

  fireEvent.press(screen.getByTestId('add-unit-weeks'));
  expect(value('add')).toHaveTextContent('2');
  const inTwoWeeks = new Date();
  inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);
  expect(screen.getByTestId('add-next-due')).toHaveTextContent(`Next due ${formatDisplay(inTwoWeeks)}`, { exact: false });

  // 3 weeks set by hand is now what other units come from
  fireEvent.press(screen.getByTestId('add-stepper-plus'));
  fireEvent.press(screen.getByTestId('add-unit-days'));
  expect(value('add')).toHaveTextContent('21');
});

it('Add: a suggestion still starts the stepper, and converts like a value set by hand', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button'));
  fireEvent.changeText(await screen.findByTestId('add-name-input'), 'Dentist');
  expect(value('add')).toHaveTextContent('6');
  expect(screen.getByTestId('add-unit-months').props.accessibilityState).toEqual({ selected: true });

  fireEvent.press(screen.getByTestId('add-unit-weeks'));
  expect(value('add')).toHaveTextContent('26');
  fireEvent.press(screen.getByTestId('add-unit-months'));
  expect(value('add')).toHaveTextContent('6');
});

it('Edit: starts from the stored value and unit, converts, and saves the converted value', async () => {
  await createItem({ name: 'Filter', category: 'Household', lastDoneDate: '2026-01-01', repeatValue: 3, repeatUnit: 'months' });
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Filter-edit'));
  await waitFor(() => expect(value('edit')).toHaveTextContent('3'));

  fireEvent.press(screen.getByTestId('edit-unit-weeks'));
  expect(value('edit')).toHaveTextContent('13');
  fireEvent.press(screen.getByTestId('edit-unit-years'));
  expect(value('edit')).toHaveTextContent('1');
  fireEvent.press(screen.getByTestId('edit-unit-months'));
  expect(value('edit')).toHaveTextContent('3');

  fireEvent.press(screen.getByTestId('edit-unit-weeks'));
  fireEvent.press(screen.getByTestId('edit-save-button'));
  await screen.findByTestId('item-Filter');
  const [saved] = await getDerivedItems();
  expect(saved).toMatchObject({ repeatValue: 13, repeatUnit: 'weeks' });
});

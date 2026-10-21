import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../../App';
import { loadItems } from '../../domain/items/storage';

beforeEach(() => AsyncStorage.clear());

it('tapping a starter opens Add filled in with its name and usual gap', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('starter-Smoke alarm battery'));
  expect(await screen.findByTestId('add-name-input')).toHaveProp('value', 'Smoke alarm battery');
  expect(screen.getByTestId('add-repeat-value')).toHaveTextContent('12');
  expect(screen.getByTestId('add-unit-months').props.accessibilityState).toMatchObject({ selected: true });
  // Nothing is created by tapping it
  expect(await loadItems()).toEqual([]);
});

it('a starter can be changed before it is saved', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('starter-Gutters'));
  const name = await screen.findByTestId('add-name-input');
  fireEvent.changeText(name, 'Gutters, back of house');
  fireEvent.press(screen.getByTestId('add-stepper-minus'));
  fireEvent.press(screen.getByTestId('add-save-button'));

  expect(await screen.findByTestId('item-Gutters, back of house')).toBeTruthy();
  const [saved] = await loadItems();
  expect(saved).toMatchObject({ name: 'Gutters, back of house', category: 'Household', repeatValue: 11, repeatUnit: 'months' });
});

it('the starters show only on an empty list', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('starter-Dentist'));
  fireEvent.press(await screen.findByTestId('add-save-button'));
  await screen.findByTestId('item-Dentist');
  expect(screen.queryByTestId('starter-Gutters')).toBeNull();
});

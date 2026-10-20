import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../../App';
import { createItem } from '../../domain/items/service';

// Marking done and deleting fail here, as they could if the item vanished
// (e.g. a sync removed it) between the list loading and the tap.
jest.mock('../../domain/items/service', () => ({
  ...jest.requireActual('../../domain/items/service'),
  markItemDone: jest.fn(() => Promise.reject(new Error('Item not found'))),
  deleteItem: jest.fn(() => Promise.reject(new Error('Item not found'))),
}));

beforeEach(() => AsyncStorage.clear());

async function seed() {
  await createItem({
    name: 'Car service',
    category: 'Auto',
    lastDoneDate: '2026-01-01',
    repeatValue: 1,
    repeatUnit: 'years',
  });
}

it('says calmly when marking done from the list fails', async () => {
  await seed();
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Car service-done'));
  expect(await screen.findByText("Couldn't save that. Please try again.")).toBeTruthy();
});

it('says calmly when deleting from the list fails', async () => {
  await seed();
  render(<App />);
  await screen.findByTestId('item-Car service');
  fireEvent.press(screen.getByTestId('item-Car service-delete'));
  expect(await screen.findByText("Couldn't delete that. Please try again.")).toBeTruthy();
});

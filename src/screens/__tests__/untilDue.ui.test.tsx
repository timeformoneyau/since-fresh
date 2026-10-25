import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../../App';
import { loadItems } from '../../domain/items/storage';
import { createItem } from '../../domain/items/service';
import { todayString } from '../../utils/dateUtils';
import { quickPickDate } from '../../domain/items/due';

/** "Until it's due" on Add and Edit (the form) through the real app. */
beforeEach(() => AsyncStorage.clear());

const checked = (id: string) => screen.getByTestId(id).props.accessibilityState;

async function openAdd() {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button'));
  return screen.findByTestId('add-name-input');
}

describe('How do you want to track it?', () => {
  it('starts on "Since I last did it", with the path as before', async () => {
    await openAdd();
    expect(checked('add-track-since')).toMatchObject({ checked: true });
    expect(checked('add-track-until')).toMatchObject({ checked: false });
    expect(screen.getByTestId('add-repeats-option')).toBeTruthy();
    expect(screen.getByTestId('add-last-done-button')).toBeTruthy();
    expect(screen.queryByTestId('add-due-date-button')).toBeNull();
  });

  it('a name like "Car rego" preselects "Until it\'s due"; a choice made sticks', async () => {
    const name = await openAdd();
    fireEvent.changeText(name, 'Car rego');
    expect(checked('add-track-until')).toMatchObject({ checked: true });
    fireEvent.press(screen.getByTestId('add-track-since'));
    fireEvent.changeText(name, 'Car rego renewal');
    expect(checked('add-track-since')).toMatchObject({ checked: true });
  });

  it('the Until path asks when it is due, with no "When did you last do it?"', async () => {
    await openAdd();
    fireEvent.press(screen.getByTestId('add-track-until'));
    expect(screen.getByTestId('add-due-date-button')).toHaveTextContent('Choose a date');
    expect(screen.queryByTestId('add-last-done-button')).toBeNull();
    expect(screen.queryByTestId('add-repeats-option')).toBeNull();
    expect(screen.getByText("Use the cancel-by date, not the end date, if you're tracking a trial or subscription.")).toBeTruthy();
    // No repeat by default, and the helper doesn't say "no reminders"
    expect(checked('add-repeat-after-no')).toMatchObject({ checked: true });
    expect(screen.queryByTestId('add-repeat-value')).toBeNull();
    expect(screen.getByTestId('add-until-once-info')).not.toHaveTextContent(/no reminders/);
  });

  it("won't save until a due date is chosen, and says so", async () => {
    const name = await openAdd();
    fireEvent.changeText(name, 'Cancel Audible');
    fireEvent.press(screen.getByTestId('add-track-until'));
    fireEvent.press(screen.getByTestId('add-save-button'));
    expect(await screen.findByTestId('add-save-hint')).toHaveTextContent('Choose when it is due to save');
    expect(await loadItems()).toEqual([]);
  });

  it('a trial: "In 3 months", no repeat, saved as a one-off date item', async () => {
    const name = await openAdd();
    fireEvent.changeText(name, 'Audible trial');
    fireEvent.press(screen.getByTestId('add-due-in-3-months'));
    expect(checked('add-due-in-3-months')).toMatchObject({ selected: true });
    expect(checked('add-due-in-1-month')).toMatchObject({ selected: false });
    fireEvent.press(screen.getByTestId('add-save-button'));

    expect(await screen.findByTestId('item-Audible trial')).toBeTruthy();
    const [saved] = await loadItems();
    expect(saved).toMatchObject({
      name: 'Audible trial', dueDate: quickPickDate(3, 'months', todayString()), repeatValue: null, repeatUnit: null, history: [],
    });
  });

  it('repeating after that starts at every 1 year', async () => {
    const name = await openAdd();
    fireEvent.changeText(name, 'Home insurance');
    fireEvent.press(screen.getByTestId('add-due-in-1-year'));
    fireEvent.press(screen.getByTestId('add-repeat-after-yes'));
    expect(checked('add-repeat-after-yes')).toMatchObject({ checked: true });
    expect(screen.getByTestId('add-repeat-value')).toHaveTextContent('1');
    expect(checked('add-unit-years')).toMatchObject({ selected: true });
    expect(screen.queryByTestId('add-until-once-info')).toBeNull();
    fireEvent.press(screen.getByTestId('add-save-button'));
    await screen.findByTestId('item-Home insurance');
    expect((await loadItems())[0]).toMatchObject({ repeatValue: 1, repeatUnit: 'years', dueDate: quickPickDate(1, 'years', todayString()) });
  });

  it('the car rego starter opens on Until, repeating yearly, asking the date', async () => {
    render(<App />);
    expect(await screen.findByText('Every year, from its due date')).toBeTruthy();
    fireEvent.press(screen.getByTestId('starter-Car rego'));
    await screen.findByTestId('add-name-input');
    expect(checked('add-track-until')).toMatchObject({ checked: true });
    expect(checked('add-repeat-after-yes')).toMatchObject({ checked: true });
    expect(screen.getByTestId('add-repeat-value')).toHaveTextContent('1');
    expect(screen.getByTestId('add-due-date-button')).toHaveTextContent('Choose a date');
    // Other starters as before
    expect(await loadItems()).toEqual([]);
  });

  it('the new choices meet the tap target and expose their state', async () => {
    await openAdd();
    fireEvent.press(screen.getByTestId('add-track-until'));
    for (const id of ['add-track-since', 'add-track-until', 'add-repeat-after-no', 'add-repeat-after-yes']) {
      expect(screen.getByTestId(id).props.accessibilityRole).toBe('radio');
    }
    for (const id of ['add-due-in-1-month', 'add-due-in-3-months', 'add-due-in-1-year', 'add-due-date-button']) {
      expect(screen.getByTestId(id).props.accessibilityRole).toBe('button');
      expect(screen.getByTestId(id).props.accessibilityLabel).toBeTruthy();
    }
  });
});

describe('Edit', () => {
  async function openEdit(name: string) {
    render(<App />);
    fireEvent.press(await screen.findByTestId(`item-${name}-edit`));
    return screen.findByTestId('edit-name-input');
  }

  it("a date item shows how it's tracked as a label, and its due date can change", async () => {
    await createItem({ name: 'Car rego', category: 'Auto', lastDoneDate: todayString(), repeatValue: 1, repeatUnit: 'years', dueDate: quickPickDate(1, 'months', todayString()) });
    await openEdit('Car rego');
    const label = screen.getByTestId('edit-track-label');
    expect(within(label).getByText("Until it's due")).toBeTruthy();
    expect(screen.queryByTestId('edit-track-since')).toBeNull();
    expect(screen.queryByTestId('edit-last-done-button')).toBeNull();
    expect(checked('edit-repeat-after-yes')).toMatchObject({ checked: true });

    fireEvent.press(screen.getByTestId('edit-due-in-3-months'));
    fireEvent.press(screen.getByTestId('edit-save-button'));
    await screen.findByTestId('item-Car rego');
    expect((await loadItems())[0]).toMatchObject({ dueDate: quickPickDate(3, 'months', todayString()), history: [] });
  });

  it('a "since" item shows its label and the path as before', async () => {
    await createItem({ name: 'Dentist', category: 'Health', lastDoneDate: '2026-09-01', repeatValue: 6, repeatUnit: 'months' });
    await openEdit('Dentist');
    expect(within(screen.getByTestId('edit-track-label')).getByText('Since I last did it')).toBeTruthy();
    expect(screen.getByTestId('edit-last-done-button')).toBeTruthy();
    fireEvent.press(screen.getByTestId('edit-save-button'));
    await screen.findByTestId('item-Dentist');
    expect('dueDate' in (await loadItems())[0]).toBe(false);
  });
});

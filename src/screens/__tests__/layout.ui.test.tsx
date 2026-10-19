import React from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import App from '../../../App';
import { createItem } from '../../domain/items/service';

// Edge-to-edge Android: the app draws under the status bar and the navigation
// bar, and must keep its own content clear of both. Odd sizes, so a match
// can't come from ordinary layout padding by coincidence.
const INSETS = { top: 37, bottom: 53, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => {
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  const metrics = { frame: { x: 0, y: 0, width: 360, height: 780 }, insets: INSETS };
  return {
    ...mock,
    initialWindowMetrics: metrics,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      mock.SafeAreaProvider({ children, initialMetrics: metrics }),
  };
});

function flat(style: unknown) {
  return StyleSheet.flatten(style as never) ?? {};
}

/** Whether some container around the element pads its top by the status bar inset. */
function isBelowStatusBar(testID: string) {
  // (RN's own SafeAreaView does nothing on Android, so it never counts here)
  for (let node = screen.getByTestId(testID).parent; node; node = node.parent) {
    const s = flat(node.props.style) as { paddingTop?: number };
    if (node.type === View && s.paddingTop === INSETS.top) return true;
  }
  return false;
}

function expectKeyboardSafe(minBottomPadding: number) {
  const kav = screen.UNSAFE_getByType(KeyboardAvoidingView);
  expect(kav.props.behavior).toBe('padding');
  // Below a native-stack header, so it must offset by the header's height
  expect(kav.props.keyboardVerticalOffset).toBeGreaterThan(0);
  const scroll = kav.findByType(ScrollView);
  const pb = (flat(scroll.props.contentContainerStyle) as { paddingBottom?: number }).paddingBottom;
  expect(pb).toBeGreaterThanOrEqual(minBottomPadding + INSETS.bottom);
}

it('empty list keeps its content below the status bar', async () => {
  render(<App />);
  await screen.findByTestId('empty-add-button');
  // The navy header band runs under the status bar; its ＋ must not
  expect(isBelowStatusBar('main-add-button')).toBe(true);
});

it('Add screen: keyboard avoidance and Save clear of the nav bar', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button'));
  await screen.findByTestId('add-name-input');
  expectKeyboardSafe(60);
});

it('list header buttons sit below the status bar', async () => {
  await createItem({ name: 'Milk', category: 'Other', lastDoneDate: '2026-01-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  await screen.findByTestId('main-add-button');
  expect(isBelowStatusBar('main-add-button')).toBe(true);
});

it('Edit screen: keyboard avoidance and Save clear of the nav bar', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Milk-edit'));
  await screen.findByTestId('edit-name-input');
  expectKeyboardSafe(60);
});

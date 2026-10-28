import React from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

type ReactTestInstance = ReturnType<typeof screen.getByTestId>;
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

// The keyboard as Android reports it (ReactRootView): shown, with its top edge
// on screen and its height above the nav bar; hidden, with the visible window
// height, which under edge-to-edge is shorter than the app's own frame.
const SCREEN = 780;
const KEYBOARD = 280;
const KEYBOARD_TOP = SCREEN - INSETS.bottom - KEYBOARD;
const SHOWN = { endCoordinates: { screenX: 0, screenY: KEYBOARD_TOP, width: 360, height: KEYBOARD } };
const HIDDEN = { endCoordinates: { screenX: 0, screenY: SCREEN - INSETS.top - INSETS.bottom, width: 360, height: 0 } };
const HEADER = INSETS.top + 56;

let keyboardListeners: Record<string, ((e: unknown) => void)[]> = {};
beforeEach(() => {
  keyboardListeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, fn: (e: unknown) => void) => {
    (keyboardListeners[name] ??= []).push(fn);
    return { remove: () => { keyboardListeners[name] = keyboardListeners[name].filter((f) => f !== fn); } };
  }) as never);
  // Every screen view sits under the header and reaches the bottom of the
  // screen. As on Android: measure gives page positions from the top of the
  // screen (the app draws edge to edge), measureInWindow from below the status
  // bar (seen on the CI emulator, where it put Save behind the keyboard)
  const proto = View.prototype as unknown as { measure: unknown; measureInWindow: unknown };
  proto.measure = (cb: (x: number, y: number, w: number, h: number, px: number, py: number) => void) =>
    cb(0, 0, 360, SCREEN - HEADER, 0, HEADER);
  proto.measureInWindow = (cb: (x: number, y: number, w: number, h: number) => void) =>
    cb(0, HEADER - INSETS.top, 360, SCREEN - HEADER);
});
afterEach(() => jest.restoreAllMocks());

async function keyboard(name: 'keyboardDidShow' | 'keyboardDidHide', event: unknown) {
  await act(async () => { for (const fn of keyboardListeners[name] ?? []) fn(event); });
}

function ancestors(testID: string): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  for (let node = screen.getByTestId(testID).parent; node; node = node.parent) out.push(node);
  return out;
}

/** Space kept below an element by the views around it. */
function bottomPadding(testID: string) {
  return ancestors(testID)
    .filter((n) => n.type === View)
    .reduce((sum, n) => sum + ((flat(n.props.style) as { paddingBottom?: number }).paddingBottom ?? 0), 0);
}

/** Lay out the screen, as the phone does once it's drawn. */
async function layOut(testID: string) {
  for (const node of ancestors(testID)) {
    if (node.props.onLayout) {
      await act(async () => node.props.onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: 0, width: 360, height: SCREEN - HEADER } } }));
    }
  }
}

/**
 * The save button stays put below the form (not inside the scroll), clear of
 * the gesture bar, above the keyboard while it's open, and with no space left
 * over once it closes.
 */
async function expectSaveBarKeyboardSafe(prefix: 'add' | 'edit') {
  const save = `${prefix}-save-button`;
  await layOut(save);
  expect(ancestors(save).some((n) => n.type === ScrollView)).toBe(false);
  expect(ancestors(`${prefix}-name-input`).some((n) => n.type === ScrollView)).toBe(true);
  expect(bottomPadding(save)).toBeGreaterThanOrEqual(INSETS.bottom);
  expect(bottomPadding(save)).toBeLessThanOrEqual(INSETS.bottom + 24);

  await keyboard('keyboardDidShow', SHOWN);
  expect(bottomPadding(save)).toBeGreaterThanOrEqual(SCREEN - KEYBOARD_TOP);

  await keyboard('keyboardDidHide', HIDDEN);
  expect(bottomPadding(save)).toBeGreaterThanOrEqual(INSETS.bottom);
  expect(bottomPadding(save)).toBeLessThanOrEqual(INSETS.bottom + 24);
}

it('empty list keeps its content below the status bar', async () => {
  render(<App />);
  await screen.findByTestId('empty-add-button');
  // The navy header band runs under the status bar; its ＋ must not
  expect(isBelowStatusBar('main-add-button')).toBe(true);
});

it('Add screen: Track this pinned above the keyboard and the nav bar, nothing left over when the keyboard closes', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('empty-add-button'));
  await screen.findByTestId('add-name-input');
  await expectSaveBarKeyboardSafe('add');
});

it('list header buttons sit below the status bar', async () => {
  await createItem({ name: 'Milk', category: 'Other', lastDoneDate: '2026-01-01', repeatValue: null, repeatUnit: null });
  render(<App />);
  await screen.findByTestId('main-add-button');
  expect(isBelowStatusBar('main-add-button')).toBe(true);
});

it('Edit screen: Save changes pinned above the keyboard and the nav bar, nothing left over when the keyboard closes', async () => {
  render(<App />);
  fireEvent.press(await screen.findByTestId('item-Milk-edit'));
  await screen.findByTestId('edit-name-input');
  await expectSaveBarKeyboardSafe('edit');
});

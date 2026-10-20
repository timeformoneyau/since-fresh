import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import App from '../../../App';
import { createItem } from '../../domain/items/service';

/**
 * Sign-in with cloud sync configured. jest.ui.setup.js runs every other test
 * local-only; here a fake Supabase auth client stands in, and the cloud
 * tables are empty.
 */
type Session = { user: { id: string; email: string } };
type AuthListener = (event: string, session: Session | null) => void;

const mockAuth = {
  session: null as Session | null,
  listeners: [] as AuthListener[],
  emit(event: string) {
    mockAuth.listeners.forEach((l) => l(event, mockAuth.session));
  },
  signInWithOtp: jest.fn(async (_args: unknown) => ({ error: null })),
  verifyOtp: jest.fn(async ({ email }: { email: string }) => {
    mockAuth.session = { user: { id: mockAuth.nextUserId, email } };
    mockAuth.emit('SIGNED_IN');
    return { error: null };
  }),
  signOut: jest.fn(async (_args?: unknown) => {
    mockAuth.session = null;
    mockAuth.emit('SIGNED_OUT');
    return { error: null };
  }),
  nextUserId: 'user-b',
};

const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: mockAuth.session }, error: null }),
    getUser: async () => ({ data: { user: mockAuth.session?.user ?? null }, error: null }),
    onAuthStateChange: (listener: AuthListener) => {
      mockAuth.listeners.push(listener);
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signInWithOtp: (args: unknown) => mockAuth.signInWithOtp(args),
    verifyOtp: (args: { email: string }) => mockAuth.verifyOtp(args),
    signOut: (args?: unknown) => mockAuth.signOut(args),
  },
};

jest.mock('../../lib/supabase', () => ({
  isCloudSyncConfigured: () => true,
  getSupabase: () => mockClient,
  requireSupabase: () => mockClient,
}));

jest.mock('../../domain/items/cloudStorage', () => ({
  currentUserId: async () => 'user-b',
  cloudLoadItems: async () => [],
  cloudUpsertMany: async () => {},
  cloudDeleteMany: async () => {},
  cloudLoadTombstones: async () => [],
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth.session = null;
  mockAuth.listeners = [];
  mockAuth.nextUserId = 'user-b';
  jest.clearAllMocks();
});

async function seed(name: string) {
  await createItem({ name, category: 'Auto', lastDoneDate: '2026-01-01', repeatValue: null, repeatUnit: null });
}

/** From the list: Account → Sign in → email → code → back on the list. */
async function signInFromList(email: string) {
  fireEvent.press(await screen.findByTestId('main-account-button'));
  fireEvent.press(await screen.findByTestId('account-sign-in-button'));
  fireEvent.changeText(await screen.findByTestId('signin-email-input'), email);
  fireEvent.press(screen.getByTestId('signin-send-code-button'));
  fireEvent.changeText(await screen.findByTestId('code-input'), '123456');
  fireEvent.press(screen.getByTestId('code-continue-button'));
}

it('opens straight to the list when signed out, with no sign-in step', async () => {
  render(<App />);
  expect(await screen.findByTestId('empty-add-button')).toBeTruthy();
  expect(screen.queryByTestId('signin-email-input')).toBeNull();
});

it('signs in with an emailed code, no password, and keeps the list', async () => {
  await seed('Car service');
  render(<App />);
  await screen.findByTestId('item-Car service');

  await signInFromList(' Sam@Example.com ');

  expect(mockAuth.signInWithOtp).toHaveBeenCalledWith({
    email: 'sam@example.com',
    options: { shouldCreateUser: true },
  });
  expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
    email: 'sam@example.com',
    token: '123456',
    type: 'email',
  });
  // First sign-in on this phone adopts the list (ownership.ts).
  expect(await screen.findByTestId('item-Car service')).toBeTruthy();
  expect(await AsyncStorage.getItem('@since_owner_v1')).toBe('user-b');

  fireEvent.press(screen.getByTestId('main-account-button'));
  expect(await screen.findByTestId('account-email')).toHaveTextContent('sam@example.com');
});

describe("another account's list on the phone", () => {
  beforeEach(async () => {
    await seed("A's item");
    await AsyncStorage.setItem('@since_owner_v1', 'user-a');
  });

  it('asks first, and Cancel keeps the list and stays signed out', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Cancel')?.onPress?.();
    });
    render(<App />);
    await screen.findByTestId("item-A's item");

    await signInFromList('b@example.com');

    await waitFor(() => expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(Alert.alert).toHaveBeenCalledWith(
      "This phone has another account's list",
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
    );
    expect(await screen.findByTestId("item-A's item")).toBeTruthy();
    expect(await AsyncStorage.getItem('@since_owner_v1')).toBe('user-a');
  });

  it('Remove and continue clears that list and shows this account', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Remove and continue')?.onPress?.();
    });
    render(<App />);
    await screen.findByTestId("item-A's item");

    await signInFromList('b@example.com');

    expect(await screen.findByTestId('empty-add-button')).toBeTruthy();
    expect(screen.queryByTestId("item-A's item")).toBeNull();
    expect(await AsyncStorage.getItem('@since_owner_v1')).toBe('user-b');
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });
});

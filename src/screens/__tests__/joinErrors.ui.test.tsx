import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HouseholdSetupScreen from '../HouseholdSetupScreen';
import { HOUSEHOLD_COPY } from '../../domain/household/errors';
import type { RootStackParamList } from '../../types';

/**
 * Joining with a code (migration 006): a wrong code and too many tries both
 * read in plain words, keep what was typed and stay on the screen. The
 * household calls are stood in for; nothing reaches a server.
 */
const mockJoin = jest.fn();
jest.mock('../../domain/household/cloud', () => ({
  joinHousehold: (...args: unknown[]) => mockJoin(...args),
}));
const mockSync = jest.fn(async () => 'synced');
jest.mock('../../domain/sync/engine', () => ({ syncNow: () => mockSync() }));

const Stack = createNativeStackNavigator<RootStackParamList>();

function renderJoin() {
  render(
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="HouseholdSetup" component={HouseholdSetupScreen} initialParams={{ mode: 'join' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

async function tryCode(code: string) {
  fireEvent.changeText(await screen.findByTestId('household-first-input'), code);
  fireEvent.changeText(screen.getByTestId('household-name-input'), 'Alex');
  fireEvent.press(screen.getByTestId('household-submit-button'));
}

beforeEach(() => jest.clearAllMocks());

it('a wrong code says so, keeps the code and stays on the screen', async () => {
  // As PostgREST reports the body join_household returns with HTTP 404
  mockJoin.mockRejectedValueOnce({ code: 'P0002', message: "That code isn't right or has expired.", hint: null, details: null });
  renderJoin();
  await tryCode('aaaa-aaaa');

  expect(await screen.findByText(HOUSEHOLD_COPY.wrongCode)).toBeTruthy();
  expect(screen.getByTestId('household-first-input').props.value).toBe('AAAA-AAAA');
  expect(screen.getByTestId('household-name-input').props.value).toBe('Alex');
  expect(screen.getByTestId('household-submit-button')).toHaveTextContent('Join');
  expect(mockSync).not.toHaveBeenCalled();
});

it('a wrong code returned as data (HTTP 200) is still a wrong code, not a join', async () => {
  mockJoin.mockResolvedValueOnce({ code: 'P0002', message: "That code isn't right or has expired.", hint: null, details: null });
  renderJoin();
  await tryCode('AAAA-AAAA');
  expect(await screen.findByText(HOUSEHOLD_COPY.wrongCode)).toBeTruthy();
  expect(mockSync).not.toHaveBeenCalled();
});

it('too many wrong codes says to wait, and the next try can still go', async () => {
  mockJoin.mockRejectedValueOnce({
    code: 'P0001', message: "Too many codes that didn't work. Wait 15 minutes, then try again.",
    hint: 'since_join_rate_limited', details: null,
  });
  renderJoin();
  await tryCode('BBBB-BBBB');
  expect(await screen.findByText(HOUSEHOLD_COPY.rateLimited)).toBeTruthy();
  expect(screen.getByTestId('household-first-input').props.value).toBe('BBBB-BBBB');

  // Typing again clears the message; trying again works once the wait is over
  mockJoin.mockRejectedValueOnce({ code: 'P0001', message: 'x', hint: 'since_join_busy', details: null });
  await tryCode('BBBB-BBBC');
  expect(await screen.findByText(HOUSEHOLD_COPY.joinBusy)).toBeTruthy();
  expect(screen.queryByText(HOUSEHOLD_COPY.rateLimited)).toBeNull();
});

it('a full household says so', async () => {
  mockJoin.mockRejectedValueOnce({ code: 'P0001', message: 'That household is full.', hint: 'since_household_full', details: null });
  renderJoin();
  await tryCode('CCCC-CCCC');
  expect(await screen.findByText(HOUSEHOLD_COPY.householdFull)).toBeTruthy();
});

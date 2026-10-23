import React from 'react';
import { Text } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as Updates from 'expo-updates';
import ErrorBoundary, { RECOVERY_COPY } from '../ErrorBoundary';

/** A fatal error shows a calm recovery screen; Restart Since reloads the app. Nothing is sent anywhere. */
jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(async () => {}) }));

let broken = true;
function Fragile() {
  if (broken) throw new Error('boom');
  return <Text testID="fine">Fine</Text>;
}

beforeEach(() => {
  broken = true;
  jest.clearAllMocks();
  // React logs caught render errors; keep the test output readable
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

it('a crash shows the recovery screen instead of closing the app', () => {
  render(<ErrorBoundary><Fragile /></ErrorBoundary>);
  expect(screen.getByTestId('error-recovery')).toBeTruthy();
  expect(screen.getByText(RECOVERY_COPY.heading)).toBeTruthy();
  expect(screen.getByText(RECOVERY_COPY.body)).toBeTruthy();
  expect(screen.getByTestId('error-restart-button')).toHaveTextContent('Restart Since');
  for (const copy of Object.values(RECOVERY_COPY)) expect(copy).not.toMatch(/!/);
});

it('Restart Since reloads the app', async () => {
  render(<ErrorBoundary><Fragile /></ErrorBoundary>);
  fireEvent.press(screen.getByTestId('error-restart-button'));
  await waitFor(() => expect(Updates.reloadAsync).toHaveBeenCalledTimes(1));
});

it("where a reload isn't possible, Restart Since shows the app again", async () => {
  (Updates.reloadAsync as jest.Mock).mockRejectedValueOnce(new Error('not available'));
  render(<ErrorBoundary><Fragile /></ErrorBoundary>);
  broken = false;
  fireEvent.press(screen.getByTestId('error-restart-button'));
  expect(await screen.findByTestId('fine')).toBeTruthy();
});

it('with no error, the app shows as usual', () => {
  broken = false;
  render(<ErrorBoundary><Fragile /></ErrorBoundary>);
  expect(screen.getByTestId('fine')).toBeTruthy();
  expect(screen.queryByTestId('error-recovery')).toBeNull();
});

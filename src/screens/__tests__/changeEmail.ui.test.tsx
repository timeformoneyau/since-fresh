import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ChangeEmailScreen from '../ChangeEmailScreen';
import EnterCodeScreen from '../auth/EnterCodeScreen';
import { AUTH_COPY } from '../../domain/auth/errors';

/**
 * Change email doesn't reveal which addresses have accounts (readiness audit
 * Q27): an address another account holds goes the same way as a free one, to
 * the code screen with the same words. A stand-in Supabase auth client.
 */
const mockAuth = {
  updateUser: jest.fn(async (_args: unknown): Promise<{ error: unknown }> => ({ error: null })),
  verifyOtp: jest.fn(async (_args: unknown): Promise<{ error: unknown }> => ({ error: null })),
  resend: jest.fn(async (_args: unknown): Promise<{ error: unknown }> => ({ error: null })),
};
const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'me', email: 'me@example.com' } } }, error: null }),
    updateUser: (args: unknown) => mockAuth.updateUser(args),
    verifyOtp: (args: unknown) => mockAuth.verifyOtp(args),
    resend: (args: unknown) => mockAuth.resend(args),
  },
};
jest.mock('../../lib/supabase', () => ({
  isCloudSyncConfigured: () => true,
  getSupabase: () => mockClient,
  requireSupabase: () => mockClient,
}));

/** As auth-js reports an address already in use. */
const taken = () => Object.assign(new Error('A user with this email address has already been registered'), {
  name: 'AuthApiError', status: 422, code: 'email_exists',
});

const Stack = createNativeStackNavigator();

function renderFlow() {
  render(
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="ChangeEmail" component={ChangeEmailScreen} />
          <Stack.Screen name="EnterCode" component={EnterCodeScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

async function changeTo(email: string) {
  fireEvent.changeText(await screen.findByLabelText('New email'), email);
  fireEvent.press(screen.getByText('Send code'));
  return screen.findByTestId('code-input');
}

beforeEach(() => jest.clearAllMocks());

it('a free address goes to the code screen', async () => {
  renderFlow();
  await changeTo('new@example.com');
  expect(screen.getByText(/We're sending a code to new@example\.com/)).toBeTruthy();
});

it("an address another account holds reads exactly the same, and nothing says it's taken", async () => {
  mockAuth.updateUser.mockResolvedValueOnce({ error: taken() });
  renderFlow();
  await changeTo('taken@example.com');
  expect(screen.getByText(/We're sending a code to taken@example\.com/)).toBeTruthy();
  expect(screen.queryByText(/already used/)).toBeNull();

  // Any code then reads as a wrong code
  mockAuth.verifyOtp.mockResolvedValueOnce({ error: taken() });
  fireEvent.changeText(screen.getByTestId('code-input'), '123456');
  fireEvent.press(screen.getByText('Continue'));
  expect(await screen.findByText(AUTH_COPY.badCode)).toBeTruthy();
});

it('other errors still show on the change-email screen', async () => {
  mockAuth.updateUser.mockResolvedValueOnce({
    error: Object.assign(new Error('bad'), { name: 'AuthApiError', status: 400, code: 'email_address_invalid' }),
  });
  renderFlow();
  fireEvent.changeText(await screen.findByLabelText('New email'), 'nope@');
  fireEvent.press(screen.getByText('Send code'));
  expect(await screen.findByText(AUTH_COPY.invalidEmail)).toBeTruthy();
  expect(screen.queryByTestId('code-input')).toBeNull();
});

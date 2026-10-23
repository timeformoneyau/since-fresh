import React from 'react';
import { Alert, Share } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HouseholdSection from '../../components/HouseholdSection';

/**
 * Invites (Play hardening B): "Invite someone" reuses the code already
 * waiting rather than making one per tap; the owner sees it with its expiry,
 * can make a new one or turn it off; removing someone says the code stopped
 * working. The household's server calls are stood in for.
 */
type Row = { code: string; expiresAt: string; revoked?: boolean };
const mockInvites: Row[] = [];
const mockCloud = {
  fetchActiveInvites: jest.fn(async () => mockInvites.filter((r) => !r.revoked).reverse()),
  createInvite: jest.fn(async () => {
    const code = `NEWCODE${mockInvites.length}`;
    mockInvites.push({ code, expiresAt: '2026-10-30T09:00:00.000Z' });
    return code;
  }),
  revokeInvite: jest.fn(async (code: string) => {
    mockInvites.forEach((r) => { if (r.code === code) r.revoked = true; });
  }),
  removeMember: jest.fn(async () => {
    mockInvites.forEach((r) => { r.revoked = true; });
  }),
};
jest.mock('../../domain/household/cloud', () => ({
  fetchActiveInvites: () => mockCloud.fetchActiveInvites(),
  createInvite: () => mockCloud.createInvite(),
  revokeInvite: (code: string) => mockCloud.revokeInvite(code),
  removeMember: () => mockCloud.removeMember(),
}));
jest.mock('../../domain/sync/engine', () => ({ syncNow: jest.fn(async () => 'synced') }));

const Stack = createNativeStackNavigator();

async function asOwner() {
  await AsyncStorage.setItem('@since_household_v1', JSON.stringify({
    userId: 'me',
    household: {
      id: 'home', name: 'Home',
      members: [
        { userId: 'me', displayName: 'Alex', role: 'owner' },
        { userId: 'sam', displayName: 'Sam', role: 'member' },
      ],
    },
    mutes: [],
  }));
}

function renderSection() {
  render(
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Account" component={HouseholdSection} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

/** Press a button in the last alert shown. */
function pressAlert(alert: jest.SpyInstance, text: string) {
  const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as Array<{ text: string; onPress?: () => void }>;
  return act(async () => { await buttons.find((b) => b.text === text)!.onPress?.(); });
}

let alert: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockInvites.length = 0;
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  await asOwner();
});

it('the first tap makes a code; after that the same code is shown, with when it stops working', async () => {
  renderSection();
  fireEvent.press(await screen.findByTestId('household-invite-button'));
  await waitFor(() => expect(mockCloud.createInvite).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0][1]).toMatch(/NEWC-ODE0/);
  expect(alert.mock.calls[0][1]).toMatch(/works until Fri 30 Oct/);

  // The section now shows it; tapping again shares it, no new code
  expect(await screen.findByTestId('household-invite-code')).toHaveTextContent(/NEWC-ODE0/);
  expect(screen.getByTestId('household-invite-code')).toHaveTextContent(/Works until Fri 30 Oct/);
  fireEvent.press(screen.getByTestId('household-invite-button'));
  expect(Share.share).toHaveBeenCalledWith({ message: expect.stringContaining('NEWC-ODE0') });
  expect(mockCloud.createInvite).toHaveBeenCalledTimes(1);
});

it('a code already waiting (from another phone or an earlier tap) is reused', async () => {
  mockInvites.push({ code: 'ABCDEFGH', expiresAt: '2026-10-29T09:00:00.000Z' });
  renderSection();
  expect(await screen.findByTestId('household-invite-code')).toHaveTextContent(/ABCD-EFGH/);
  expect(mockCloud.createInvite).not.toHaveBeenCalled();
});

it('Make a new code turns off the old one and shows the new one', async () => {
  mockInvites.push({ code: 'OLDCODE1', expiresAt: '2026-10-29T09:00:00.000Z' });
  renderSection();
  fireEvent.press(await screen.findByTestId('household-new-code-button'));
  await pressAlert(alert, 'Make a new code');

  expect(mockCloud.revokeInvite).toHaveBeenCalledWith('OLDCODE1');
  expect(mockCloud.createInvite).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByTestId('household-invite-code')).toHaveTextContent(/NEWC-ODE1/));
});

it('Turn off this code stops it, and Invite someone comes back', async () => {
  mockInvites.push({ code: 'OLDCODE1', expiresAt: '2026-10-29T09:00:00.000Z' });
  renderSection();
  fireEvent.press(await screen.findByTestId('household-stop-code-button'));
  await pressAlert(alert, 'Turn off');

  expect(mockCloud.revokeInvite).toHaveBeenCalledWith('OLDCODE1');
  await waitFor(() => expect(screen.queryByTestId('household-invite-code')).toBeNull());
  expect(screen.getByTestId('household-invite-button')).toHaveTextContent('Invite someone');
});

it('removing someone says the code stopped working and a new one is needed', async () => {
  mockInvites.push({ code: 'OLDCODE1', expiresAt: '2026-10-29T09:00:00.000Z' });
  renderSection();
  await screen.findByTestId('household-invite-code');
  fireEvent.press(screen.getByTestId('household-member-Sam'));
  await pressAlert(alert, 'Remove');
  await pressAlert(alert, 'Remove');

  expect(mockCloud.removeMember).toHaveBeenCalled();
  const [title, body] = alert.mock.calls[alert.mock.calls.length - 1];
  expect(title).toBe('Sam has been removed');
  expect(body).toMatch(/stopped working/);
  expect(body).toMatch(/make a new code/);
  expect(body).not.toMatch(/!/);
  await waitFor(() => expect(screen.queryByTestId('household-invite-code')).toBeNull());
});

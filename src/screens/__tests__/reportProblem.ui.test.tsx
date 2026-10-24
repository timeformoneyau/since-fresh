import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HouseholdSection from '../../components/HouseholdSection';
import HouseholdSetupScreen from '../HouseholdSetupScreen';

/**
 * Google Play's user-generated content policy, in households: the rules on
 * what's OK to share are shown before creating or joining and in Account →
 * Household, and "Report a problem" emails support. It's hidden while no
 * support address is set (report.ts).
 */
const mockSupport = { email: '' };
jest.mock('../../domain/household/report', () => {
  const mocked = { ...jest.requireActual('../../domain/household/report'), __esModule: true };
  // Read at each render, so a test can set it
  Object.defineProperty(mocked, 'SUPPORT_EMAIL', { get: () => mockSupport.email });
  return mocked;
});
jest.mock('../../domain/household/cloud', () => ({ fetchActiveInvites: jest.fn(async () => []) }));
jest.mock('../../domain/sync/engine', () => ({ syncNow: jest.fn(async () => 'synced') }));

const Stack = createNativeStackNavigator();

async function inHousehold(role: 'owner' | 'member') {
  await AsyncStorage.setItem('@since_household_v1', JSON.stringify({
    userId: 'me',
    household: {
      id: 'home-1', name: 'Home',
      members: [
        { userId: 'me', displayName: 'Alex', role },
        { userId: 'sam', displayName: 'Sam', role: role === 'owner' ? 'member' : 'owner' },
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

function renderSetup(mode: 'create' | 'join') {
  render(
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="HouseholdSetup" component={HouseholdSetupScreen} initialParams={{ mode }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

let openURL: jest.SpyInstance;
let alert: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockSupport.email = '';
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

it.each(['owner', 'member'] as const)('a household %s sees what is OK to share and can report a problem by email', async (role) => {
  mockSupport.email = 'help@example.com';
  await inHousehold(role);
  renderSection();

  expect(await screen.findByTestId('household-rules')).toHaveTextContent(/nothing abusive, hateful, sexual or illegal/);
  fireEvent.press(screen.getByTestId('household-report-button'));
  expect(openURL).toHaveBeenCalledTimes(1);
  const url: string = openURL.mock.calls[0][0];
  expect(url).toMatch(/^mailto:help@example\.com\?subject=/);
  expect(decodeURIComponent(url)).toMatch(/Reference: home-1/);
});

it('without an email app, it says where to write', async () => {
  mockSupport.email = 'help@example.com';
  openURL.mockRejectedValue(new Error('no app'));
  await inHousehold('member');
  renderSection();

  fireEvent.press(await screen.findByTestId('household-report-button'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('No email app found', expect.stringContaining('help@example.com')));
});

it('while no support address is set, Report a problem is hidden, and the rules still show', async () => {
  await inHousehold('member');
  renderSection();

  await screen.findByTestId('household-rules');
  expect(screen.queryByTestId('household-report-button')).toBeNull();
});

it.each([
  ['create', /By creating a household, you agree to this/],
  ['join', /By joining, you agree to this/],
] as const)('%s shows the rules before going ahead', async (mode, agreement) => {
  renderSetup(mode);
  const rules = await screen.findByTestId('household-rules');
  expect(rules).toHaveTextContent(/Keep them kind/);
  expect(rules).toHaveTextContent(agreement);
});

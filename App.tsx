import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans/700Bold';
import { getSupabase, isCloudSyncConfigured } from './src/lib/supabase';
import { RootStackParamList } from './src/types';
import { ToastProvider } from './src/components/Toast';
import { requestNotificationPermissions, rescheduleAllNotifications } from './src/notifications/scheduler';
import { loadItems } from './src/domain/items/storage';
import { reconcileDeviceOwnership, syncInBackground } from './src/domain/sync/engine';

// App screens
import MainListScreen from './src/screens/MainListScreen';
import AddItemScreen from './src/screens/AddItemScreen';
import EditItemScreen from './src/screens/EditItemScreen';
import DetailScreen from './src/screens/DetailScreen';
import EditHistoryEntryScreen from './src/screens/EditHistoryEntryScreen';
import AccountScreen from './src/screens/AccountScreen';
import ChangeEmailScreen from './src/screens/ChangeEmailScreen';
import SignInScreen from './src/screens/auth/SignInScreen';
import EnterCodeScreen from './src/screens/auth/EnterCodeScreen';
import { colours, fonts } from './src/theme/tokens';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // SDK 54 split the old shouldShowAlert into banner + list.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Keep the splash screen up until the fonts are ready, so the first screen
// never shows in the system font
SplashScreen.preventAutoHideAsync().catch(() => {});

const AppStack = createNativeStackNavigator<RootStackParamList>();

const stackOptions = {
  headerStyle: { backgroundColor: colours.background },
  headerShadowVisible: false,
  headerTintColor: colours.textPrimary,
  headerBackTitle: 'Back',
  contentStyle: { backgroundColor: colours.background },
  headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 17 },
};

/**
 * Asked before signing in removes a list that belongs to another account
 * (sync/ownership.ts). Declining keeps the list and stays signed out.
 */
function confirmReplaceList(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'This phone has another account\'s list',
      'Signing in removes that list from this phone and shows this account\'s list instead.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Remove and continue', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function AppNavigator() {
  return (
    <AppStack.Navigator screenOptions={stackOptions}>
      <AppStack.Screen name="Main" component={MainListScreen} options={{ headerShown: false }} />
      <AppStack.Screen name="Add" component={AddItemScreen} options={{ title: '' }} />
      <AppStack.Screen name="Edit" component={EditItemScreen} options={{ title: '' }} />
      <AppStack.Screen name="Detail" component={DetailScreen} options={{ headerShown: false }} />
      <AppStack.Screen name="EditEntry" component={EditHistoryEntryScreen} options={{ title: '' }} />
      <AppStack.Screen
        name="Account"
        component={AccountScreen}
        options={{ title: isCloudSyncConfigured() ? 'Account' : 'Backup' }}
      />
      <AppStack.Screen name="SignIn" component={SignInScreen} options={{ title: 'Sign in' }} />
      <AppStack.Screen
        name="ChangeEmail"
        component={ChangeEmailScreen}
        options={{ title: 'Change email' }}
      />
      <AppStack.Screen
        name="EnterCode"
        component={EnterCodeScreen}
        options={({ route }) => ({
          title: route.params.purpose === 'sign_in' ? 'Sign in' : 'Confirm email',
        })}
      />
    </AppStack.Navigator>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });
  const fontsReady = fontsLoaded || fontError !== null;
  const [loading, setLoading] = useState(isCloudSyncConfigured());
  const [reconciling, setReconciling] = useState(false);
  // The account the ownership rule last ran for. An email change verifies
  // with SIGNED_IN for the same account, which needs no reconcile.
  const reconciledUserId = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();

    (async () => {
      // With an existing session, apply the ownership rule before the list
      // is shown or reminders are scheduled, so another account's items are
      // never displayed, rescheduled or uploaded without asking.
      if (supabase) {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (s) {
          const result = await reconcileDeviceOwnership(s.user.id, confirmReplaceList);
          if (result !== 'cancelled') reconciledUserId.current = s.user.id;
        }
        setLoading(false);
      }

      // Notifications are local and account-independent, so a local-only
      // install still gets reminders.
      await requestNotificationPermissions();
      const items = await loadItems();
      await rescheduleAllNotifications(items);
      syncInBackground();
    })();

    if (!supabase) return; // Local-only build: no accounts at all.

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') reconciledUserId.current = null;
      if (event === 'SIGNED_IN' && s) {
        if (s.user.id === reconciledUserId.current) {
          // Same account (e.g. an email-change code): keep the screen as is.
          syncInBackground();
          return;
        }
        reconciledUserId.current = s.user.id;
        // Adopt, resume or replace the local list (ownership.ts), then sync.
        // Hold the list back until the local part is done.
        setReconciling(true);
        reconcileDeviceOwnership(s.user.id, confirmReplaceList)
          .then((result) => {
            if (result === 'cancelled') reconciledUserId.current = null;
          })
          .finally(() => {
            setReconciling(false);
            syncInBackground();
          });
      }
      // SIGNED_OUT deliberately wipes nothing here. Only an explicit sign-out
      // clears the phone (auth/service.ts); after an expired session (signed
      // out by sync/engine.ts) the ownership rule decides at the next sign-in.
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // A font that fails to load falls back to the system font rather than
    // keeping the splash screen up
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  if (!fontsReady) return null;

  if (loading || reconciling) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colours.textMuted} />
      </View>
    );
  }

  // Signing in is optional: the list is always shown, and an account (when
  // cloud sync is configured) only adds backup from the Account screen.
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colours.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

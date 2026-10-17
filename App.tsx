import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import type { Session } from '@supabase/supabase-js';
import { getSupabase, isCloudSyncConfigured } from './src/lib/supabase';
import { RootStackParamList, AuthStackParamList } from './src/types';
import { colours } from './src/components/colours';
import { requestNotificationPermissions, rescheduleAllNotifications } from './src/notifications/scheduler';
import { loadItems } from './src/domain/items/storage';
import { reconcileDeviceOwnership, syncInBackground } from './src/domain/sync/engine';

// App screens
import MainListScreen from './src/screens/MainListScreen';
import AddItemScreen from './src/screens/AddItemScreen';
import EditItemScreen from './src/screens/EditItemScreen';
import DetailScreen from './src/screens/DetailScreen';
import AccountScreen from './src/screens/AccountScreen';
import ChangePasswordScreen from './src/screens/ChangePasswordScreen';

// Auth screens
import SignInScreen from './src/screens/auth/SignInScreen';
import SignUpScreen from './src/screens/auth/SignUpScreen';
import ForgotPasswordScreen from './src/screens/auth/ForgotPasswordScreen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // SDK 54 split the old shouldShowAlert into banner + list.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const AppStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

const stackOptions = {
  headerStyle: { backgroundColor: colours.background },
  headerShadowVisible: false,
  headerTintColor: colours.textPrimary,
  headerBackTitle: 'Back',
  contentStyle: { backgroundColor: colours.background },
  headerTitleStyle: { fontWeight: '600' as const, fontSize: 17 },
};

function AppNavigator() {
  return (
    <AppStack.Navigator screenOptions={stackOptions}>
      <AppStack.Screen name="Main" component={MainListScreen} options={{ headerShown: false }} />
      <AppStack.Screen name="Add" component={AddItemScreen} options={{ title: 'Track something' }} />
      <AppStack.Screen name="Edit" component={EditItemScreen} options={{ title: 'Edit' }} />
      <AppStack.Screen name="Detail" component={DetailScreen} options={{ title: 'History' }} />
      <AppStack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
      <AppStack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: 'Change password' }}
      />
    </AppStack.Navigator>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ ...stackOptions, headerShown: false }}>
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isCloudSyncConfigured());
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();

    (async () => {
      // With an existing session, apply the ownership rule before the list
      // is shown or reminders are scheduled, so another account's items are
      // never displayed, rescheduled or uploaded.
      if (supabase) {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (s) await reconcileDeviceOwnership(s.user.id);
        setSession(s);
        setLoading(false);
      }

      // Notifications are local and account-independent, so a local-only
      // install still gets reminders.
      await requestNotificationPermissions();
      const items = await loadItems();
      await rescheduleAllNotifications(items);
      syncInBackground();
    })();

    if (!supabase) return; // Local-only build: no auth gate at all.

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' && s) {
        // Adopt, resume or replace the local list (ownership.ts), then sync.
        // Hold the list back until the local part is done.
        setReconciling(true);
        reconcileDeviceOwnership(s.user.id)
          .finally(() => {
            setReconciling(false);
            syncInBackground();
          });
      }
      // SIGNED_OUT deliberately wipes nothing here. Only an explicit sign-out
      // clears the phone (auth/service.ts); after an expired session the
      // ownership rule decides at the next sign-in.
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading || reconciling) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colours.textMuted} />
      </View>
    );
  }

  // When cloud sync is not configured the app runs entirely local-first, with
  // no sign-in step. Sync and auth are additive, never a prerequisite.
  const showApp = !isCloudSyncConfigured() || session !== null;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {showApp ? <AppNavigator /> : <AuthNavigator />}
      </NavigationContainer>
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

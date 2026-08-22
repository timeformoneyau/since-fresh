import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { RootStackParamList } from './src/types';
import { colours } from './src/components/colours';
import MainListScreen from './src/screens/MainListScreen';
import AddItemScreen from './src/screens/AddItemScreen';
import EditItemScreen from './src/screens/EditItemScreen';
import ScanFoodScreen from './src/screens/ScanFoodScreen';
import { requestNotificationPermissions, rescheduleAllNotifications } from './src/notifications/scheduler';
import { loadItems } from './src/domain/items/storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // SDK 54 split the old shouldShowAlert into banner + list.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  useEffect(() => {
    (async () => {
      await requestNotificationPermissions();
      const items = await loadItems();
      await rescheduleAllNotifications(items);
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colours.background },
            headerShadowVisible: false,
            headerTintColor: colours.textPrimary,
            headerBackTitle: 'Back',
            contentStyle: { backgroundColor: colours.background },
            headerTitleStyle: { fontWeight: '600', fontSize: 17 },
          }}
        >
          <Stack.Screen name="Main" component={MainListScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Add" component={AddItemScreen} options={{ title: 'Track something' }} />
          <Stack.Screen name="Edit" component={EditItemScreen} options={{ title: 'Edit' }} />
          <Stack.Screen
            name="ScanFood"
            component={ScanFoodScreen}
            options={{ title: 'Scan food', headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

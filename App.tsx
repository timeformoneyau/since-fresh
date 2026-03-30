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
import { requestNotificationPermissions } from './src/notifications/scheduler';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  useEffect(() => {
    requestNotificationPermissions();
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
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

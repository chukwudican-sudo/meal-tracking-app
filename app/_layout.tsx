import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import 'react-native-reanimated';

import { AppDarkTheme } from '@/constants/theme';
import { ToastHost } from '@/components/ToastHost';
import { UndoSnackbarHost } from '@/components/UndoSnackbarHost';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeProvider value={AppDarkTheme}>
      <View style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="(tabs)"    options={{ headerShown: false }} />
          <Stack.Screen name="settings"  options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="meal/[id]" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="cart"      options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="modal"     options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <UndoSnackbarHost />
        <ToastHost />
      </View>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

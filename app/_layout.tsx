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
          <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
          <Stack.Screen name="settings"      options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="meal/[id]"     options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="cart"          options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="profile"       options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="notifications" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="kitchen"       options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="recipes/saved"             options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="recipes/category/[type]"   options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="recipe/[id]"               options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ai/what-can-i-make"        options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ai/custom"                 options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />

          {/* Profile sub-pages */}
          <Stack.Screen name="profile/edit-goal"         options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="profile/personal-details"  options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="profile/dietary"           options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="profile/nutrition-goals"   options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />

          {/* Settings sub-pages */}
          <Stack.Screen name="settings/account"                 options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings/account-delete-confirm"  options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings/notifications"           options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings/help"                    options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings/feedback"                options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="settings/coming-soon"             options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />

          <Stack.Screen name="modal"         options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <UndoSnackbarHost />
        <ToastHost />
      </View>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

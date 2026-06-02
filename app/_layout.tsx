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

// Shared options for full-screen "modal" pages: they slide up from the bottom
// like a modal but fill the entire screen (no card-sheet gap at the top).
const fullScreenSlide = {
  presentation: 'fullScreenModal',
  headerShown: false,
  animation: 'slide_from_bottom',
} as const;

export default function RootLayout() {
  return (
    <ThemeProvider value={AppDarkTheme}>
      <View style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
          <Stack.Screen name="settings"      options={fullScreenSlide} />
          <Stack.Screen name="meal/[id]"     options={{ presentation: 'fullScreenModal', headerShown: false }} />
          <Stack.Screen name="cart"          options={fullScreenSlide} />
          <Stack.Screen name="profile"       options={fullScreenSlide} />
          <Stack.Screen name="notifications" options={fullScreenSlide} />
          <Stack.Screen name="kitchen"       options={fullScreenSlide} />
          <Stack.Screen name="recipes/saved"             options={fullScreenSlide} />
          <Stack.Screen name="recipes/category/[type]"   options={fullScreenSlide} />
          <Stack.Screen name="recipe/[id]"               options={fullScreenSlide} />
          <Stack.Screen name="ai/what-can-i-make"        options={fullScreenSlide} />
          <Stack.Screen name="ai/custom"                 options={fullScreenSlide} />

          {/* Profile sub-pages */}
          <Stack.Screen name="profile/edit-goal"         options={fullScreenSlide} />
          <Stack.Screen name="profile/personal-details"  options={fullScreenSlide} />
          <Stack.Screen name="profile/dietary"           options={fullScreenSlide} />
          <Stack.Screen name="profile/nutrition-goals"   options={fullScreenSlide} />

          {/* Settings sub-pages */}
          <Stack.Screen name="settings/account"                 options={fullScreenSlide} />
          <Stack.Screen name="settings/account-delete-confirm"  options={fullScreenSlide} />
          <Stack.Screen name="settings/notifications"           options={fullScreenSlide} />
          <Stack.Screen name="settings/help"                    options={fullScreenSlide} />
          <Stack.Screen name="settings/feedback"                options={fullScreenSlide} />
          <Stack.Screen name="settings/coming-soon"             options={fullScreenSlide} />

          {/* Plan sub-pages */}
          <Stack.Screen name="plan/build"                       options={fullScreenSlide} />
          <Stack.Screen name="plan/find"                        options={fullScreenSlide} />
          <Stack.Screen name="plan/category/[type]"             options={fullScreenSlide} />
          <Stack.Screen name="plan/[id]"                        options={fullScreenSlide} />
          <Stack.Screen name="plan/day/[date]"                  options={fullScreenSlide} />

          {/* Generic fallback `modal` route stays as a card-sheet. */}
          <Stack.Screen name="modal"         options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <UndoSnackbarHost />
        <ToastHost />
      </View>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

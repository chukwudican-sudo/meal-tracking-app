import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { AppDarkTheme } from '@/constants/theme';
import { ToastHost } from '@/components/ToastHost';
import { UndoSnackbarHost } from '@/components/UndoSnackbarHost';
import { AuthProvider } from '@/lib/auth';
import { SyncProvider } from '@/lib/sync/SyncProvider';
import { configurePurchases } from '@/lib/purchases';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Configure the RevenueCat SDK once, at module load — before AuthProvider's
// first session lookup resolves, so identity sync (lib/auth.tsx) always finds
// the SDK already configured.
configurePurchases();

// Shared options for full-screen pages: standard iOS push presentation so they
// slide in from the right (and back out to the right). `card` is required for
// the `animation` prop to apply — `fullScreenModal` would force a bottom-up
// modal animation regardless.
const fullScreenSlide = {
  presentation: 'card',
  headerShown: false,
  animation: 'slide_from_right',
} as const;

export default function RootLayout() {
  return (
    // SafeAreaProvider must wrap the entire app so that every SafeAreaView
    // and useSafeAreaInsets() call from react-native-safe-area-context can
    // resolve real device insets. We pass `initialMetrics` so the very
    // first render frame already has correct top/bottom values instead of
    // briefly rendering with zero insets (which causes content to flash
    // above the notch / Dynamic Island during navigation transitions).
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider value={AppDarkTheme}>
        <AuthProvider>
        <SyncProvider>
        <View style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
            <Stack.Screen name="onboarding"    options={{ headerShown: false, animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="auth/forgot-password"  options={fullScreenSlide} />
            <Stack.Screen name="auth/reset"            options={{ headerShown: false, animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="auth/callback"         options={{ headerShown: false, animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="auth/verify-code"      options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="settings"      options={fullScreenSlide} />
            <Stack.Screen name="meal/[id]"     options={{ presentation: 'card', headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="cart"          options={fullScreenSlide} />
            <Stack.Screen name="profile"       options={fullScreenSlide} />
            <Stack.Screen name="notifications" options={fullScreenSlide} />
            <Stack.Screen name="kitchen"       options={fullScreenSlide} />
            <Stack.Screen name="grocery/planned-ingredients" options={fullScreenSlide} />
            <Stack.Screen name="recipes/saved"             options={fullScreenSlide} />
            <Stack.Screen name="recipes/category/[type]"   options={fullScreenSlide} />
            <Stack.Screen name="recipe/[id]"               options={fullScreenSlide} />
            <Stack.Screen name="recipe/detail/[id]"        options={fullScreenSlide} />
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

            {/* Meal edit sub-pages (driven by mealEditSession) */}
            <Stack.Screen name="meal-edit/macro/[key]"            options={fullScreenSlide} />
            <Stack.Screen name="meal-edit/ingredient/[id]"        options={fullScreenSlide} />

            {/* Generic fallback `modal` route stays as a card-sheet. */}
            <Stack.Screen name="modal"         options={{ presentation: 'modal', title: 'Modal' }} />

            {/* Reusable Pro paywall — always opened via lib/paywall.ts#openPaywall. */}
            <Stack.Screen
              name="paywall"
              options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }}
            />
          </Stack>
          <UndoSnackbarHost />
          <ToastHost />
        </View>
        </SyncProvider>
        </AuthProvider>
        <StatusBar style="light" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

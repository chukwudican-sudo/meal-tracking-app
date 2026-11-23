// Single Supabase client for the whole app. Import `supabase` from here.
//
// The URL + publishable key come from EXPO_PUBLIC_ env vars (see .env). The
// publishable key is safe to ship in the bundle — Row Level Security is what
// actually protects data, so every table MUST have RLS enabled.

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

if (!supabaseUrl || !supabasePublishableKey) {
  // Fail loudly in dev rather than silently getting "Invalid API key" at runtime.
  throw new Error(
    'Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your .env, then restart the dev server.',
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    // Persist the session in AsyncStorage so users stay signed in across launches.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL to parse the session from (that's a web-only concern).
    detectSessionInUrl: false,
    // PKCE dates from link-style auth emails (deleted Nov 21, 2026: signup and
    // reset now verify a 6-digit code with verifyOtp, which doesn't depend on
    // the flow type). Left as is rather than change a working auth setting.
    flowType: 'pkce',
  },
});

// Supabase can only auto-refresh the access token while the app is in the
// foreground. Start/stop the refresh loop based on app state so we don't burn
// resources (or hit "Auth session missing") in the background.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

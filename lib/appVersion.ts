// The version line at the bottom of Settings → Help, e.g.
// "Version 1.0.0 (4) · Update Nov 26 (3f2a9c)", so a tester can say exactly
// which build — and which over-the-air update on top of it — they're on when
// they report a bug (Nov 25). The update part shows only while an update is
// running instead of the code the build shipped with.

import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type * as ExpoUpdates from 'expo-updates';

type UpdatesModule = typeof ExpoUpdates;

// expo-updates is loaded only when its native code is in the build: dev builds
// made before Nov 25 don't have it, and importing the package there throws at
// startup (same pattern as expo-notifications in lib/notifications/reminders).
let cachedUpdates: UpdatesModule | null | undefined;
function getUpdates(): UpdatesModule | null {
  if (cachedUpdates !== undefined) return cachedUpdates;
  if (!requireOptionalNativeModule('ExpoUpdates')) {
    cachedUpdates = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedUpdates = require('expo-updates') as UpdatesModule;
  } catch {
    cachedUpdates = null;
  }
  return cachedUpdates;
}

export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '?';
  // CFBundleVersion of the installed binary: the EAS build number.
  const build = Platform.OS === 'ios' ? Constants.platform?.ios?.buildNumber : null;
  let label = `Version ${version}${build ? ` (${build})` : ''}`;
  const updates = getUpdates();
  if (updates?.isEnabled && !updates.isEmbeddedLaunch && updates.createdAt) {
    const day = updates.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    label += ` · Update ${day}${updates.updateId ? ` (${updates.updateId.slice(0, 6)})` : ''}`;
  }
  return __DEV__ ? `${label} · dev` : label;
}

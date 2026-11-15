// App variants (Nov 14): the dev build installs as a separate app, "Macrotri
// Dev" (own app ID, storage and link scheme), so it sits next to the
// TestFlight / App Store "Macrotri" on the same phone — no deleting to switch,
// and dev data can never mix into a production account.
//
// APP_VARIANT=development is set by the development EAS profile (eas.json) and
// by `npm run dev` (Metro must serve the same config the dev build was made
// with). Unset = the real app exactly as app.json describes it: preview,
// TestFlight and App Store builds never set it.
const IS_DEV = process.env.APP_VARIANT === 'development';

// A stray APP_VARIANT (e.g. added to the expo.dev environment) must never turn
// a preview/TestFlight/App Store build into the dev app. The EAS build server
// sets EAS_BUILD_PROFILE, so the build stops here. (eas-cli on the Mac doesn't
// set it; a variable exported only in the shell makes the local read and the
// server disagree, and signing fails.)
const profile = process.env.EAS_BUILD_PROFILE;
if (IS_DEV && profile && profile !== 'development') {
  throw new Error(`APP_VARIANT=development is set for the "${profile}" build — remove it.`);
}

module.exports = ({ config }) => {
  if (!IS_DEV) return config;
  return {
    ...config,
    name: 'Macrotri Dev',
    scheme: 'mealapp-dev',
    ios: { ...config.ios, bundleIdentifier: 'com.alex.mealapp.dev' },
    android: { ...config.android, package: 'com.alex.mealapp.dev' },
  };
};

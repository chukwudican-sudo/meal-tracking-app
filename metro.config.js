// Metro = Expo's default config, wrapped by Sentry so every bundle carries
// debug IDs: crash reports then point at real lines of our source (source maps
// are uploaded by the Sentry plugin during EAS builds — needs SENTRY_AUTH_TOKEN
// in the EAS environment).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);

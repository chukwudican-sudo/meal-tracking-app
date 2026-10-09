# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Testing in-app purchases (RevenueCat)

`react-native-purchases` is a native module — **Expo Go cannot load it**. To
test the paywall/purchase flow you need an actual dev build, which is a manual
step you run once (not something the agent can trigger from inside the
codebase, since it needs your Apple/EAS credentials):

- Fastest if you already have Xcode installed locally:
  ```bash
  npx expo run:ios
  ```
  This builds a real dev-client binary and installs it on a simulator/device.
  After that, `npx expo start` reconnects to it like normal.
- Or, without Xcode, via an EAS cloud dev build (needs an Expo account):
  ```bash
  npx eas build --profile development --platform ios
  ```

Set `EXPO_PUBLIC_REVENUECAT_API_KEY` in `.env` first (see `.env.example`) — a
RevenueCat **Test Store** key lets you exercise the full purchase/restore flow
without waiting on App Store review. Swap it for the production key later by
changing only that one line.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

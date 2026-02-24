# Dangdangpang Mobile (Expo)

## Overview
- This app wraps the deployed Dangdangpang web game in a native shell using `react-native-webview`.
- Default web URL: `https://dangdangpang.vercel.app`
- You can override URL with `EXPO_PUBLIC_WEB_URL`.

## Run
```bash
cd /Users/doyoulovez/Documents/dangdangpang/mobile
nvm use
npm install
npm run start
```

## Simulator
```bash
# iOS Simulator (macOS + Xcode)
nvm use
npm run ios

# Android Emulator
nvm use
npm run android
```

## Prerequisites for Simulator
- iOS: install full Xcode from App Store, then run:
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```
- Android: install Android Studio + SDK + Emulator, create at least one AVD.

Node note:
- This project is pinned to Node 20 (`.nvmrc`) for Expo stability.

## Set custom web URL
```bash
cd /Users/doyoulovez/Documents/dangdangpang/mobile
EXPO_PUBLIC_WEB_URL="https://your-vercel-domain.vercel.app" npm run start
```

## Ads (AdMob)
- Native banner ad is already wired in `App.tsx` via `react-native-google-mobile-ads`.
- Current app IDs are Google test IDs (safe for development).
- For production, replace in `/Users/doyoulovez/Documents/dangdangpang/mobile/app.json`:
  - `plugins[0][1].androidAppId`
  - `plugins[0][1].iosAppId`
- Optional banner unit IDs:
  - `EXPO_PUBLIC_ADMOB_BANNER_ANDROID=ca-app-pub-xxx/yyy`
  - `EXPO_PUBLIC_ADMOB_BANNER_IOS=ca-app-pub-xxx/yyy`

Note: AdMob native modules require an Expo development build or EAS build (not plain Expo Go).

## Build/Deploy (EAS)
```bash
cd /Users/doyoulovez/Documents/dangdangpang/mobile
npx eas login
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
```

## Notes
- If web URL is unreachable, app shows retry overlay.
- Current architecture is quickest path to app release while web keeps evolving.
- Next migration step (optional): move game UI from web to native screens progressively.

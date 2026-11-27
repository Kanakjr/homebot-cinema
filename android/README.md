# HomeBot Cinema Android app

A lightweight Android companion app for phones, tablets, and Android TV / Google TV that hosts the responsive HomeBot Cinema web application inside a hardened Chromium WebView shell with edge-to-edge system bars and first-run server configuration.

## Features

- **First-Run Server Setup & Switcher**:
  - Prompts for a validated server URL on first launch (`https://...` or local LAN/loopback `http://...`), normalized via `ServerUrlConfig`.
  - Accessible anytime from the Android **Switch Server** launcher shortcut (`ACTION_CHANGE_SERVER`) or on connection failure.
- **Full Household & Plugin Parity**:
  - Supports multi-profile picker, PIN lock, Hero carousel, Continue Watching, Upcoming calendar, Downloads, Search, AI Copilot, Remote control, and Vault directly from your server.
- **Hardened WebView & Video Support**:
  - Edge-to-edge dark system bars with display cutout & navigation bar insets (hidden automatically in fullscreen playback).
  - Scoped cleartext rules (`res/xml/network_security_config.xml`) blocking plain HTTP to public hosts while allowing local LAN/emulator testing (`10.0.2.2`, `127.0.0.1`, `localhost`, `.local`, `.lan`, `.home.arpa`).
  - `MIXED_CONTENT_NEVER_ALLOW`, disabled local `file://` and `content://` access, `BuildConfig.DEBUG`-gated WebView debugging, dynamic cookie domain handling, and a transparent `1x1` default video poster.

## Architecture

- **Activity Shell**: Single `MainActivity` (`ComponentActivity` + `WebView` + native setup/error overlays + fullscreen container).
- **Storage**: AndroidX DataStore Preferences (`UserPreferences`) for the saved server URL, active profile, and Cloudflare Access token.
- **Build & Test**: Lightweight AndroidX `core-ktx`, `activity-ktx`, `lifecycle-runtime-ktx`, `datastore-preferences`, and JUnit (`ServerUrlConfigTest`).

## Build

### Prerequisites
- JDK 21 (e.g. `brew install openjdk@21`)
- Android SDK command-line tools with API 35 (`brew install android-commandlinetools`)

### Commands
```bash
# Build debug APK:
scripts/build-android.sh

# Private build for your own household: your server baked in, so a fresh install skips the setup screen
# (the user can still change it later). Leave CINEMA_ORIGIN unset for a public build.
CINEMA_ORIGIN=https://your-host scripts/build-android.sh

# Or run unit tests, lint, and APK build directly:
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The compiled APK is generated at:
`android/app/build/outputs/apk/debug/app-debug.apk`

To install on a connected Android phone or Android TV device with ADB:
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

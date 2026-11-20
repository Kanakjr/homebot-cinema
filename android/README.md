# HomeBot Cinema Android app

A native Android companion app for phones, tablets, and Android TV / Google TV. Built with modern Kotlin, Jetpack Compose, Material 3, and AndroidX Media3 (ExoPlayer).

Plays streams directly from your HomeBot Cinema server with native hardware decoding, seamless profile sync, and full remote-control integration.

## Features

- **Multi-Profile Household**: Instant switching between household profiles with custom avatars, PIN protection, and isolated watch histories.
- **Home Experience**:
  - Hero carousel with featured titles and direct play
  - 16:9 snap-scrolling *Continue Watching* row with exact time left and "Next up" episode tracking
  - *Upcoming* releases row showing upcoming show episodes in the next 14 days
  - Dynamic catalog rows from configured Stremio addons
- **Rich Title Details**:
  - Full backdrop art, metadata, runtime, genres, and ratings (IMDb, MDBList Rotten Tomatoes / Metacritic)
  - Release scraper stream selection sorted best-first by quality profile with live swarm health probes
  - Season and episode list with progress bars and next-up markers
- **Native Video Player (Media3 / ExoPlayer)**:
  - Hardware-accelerated H.264, HEVC, and AV1 decoding
  - HLS adaptive bitrate streaming and direct MP4/MKV playback
  - Audio track selector (stereo, 5.1 surround, multi-language)
  - Subtitle selector (embedded text/bitmap and external WebVTT/SRT)
  - Gesture controls: swipe vertically for volume and brightness, double-tap / swipe horizontally to seek
  - Aspect ratio toggle (fit, fill, 16:9, zoom) and playback speed controls (0.5x - 2.0x)
  - Android MediaSession (`CinemaMediaSessionService`) for system notification controls, lock screen metadata, and background playback
- **Remote Control & Casting**:
  - Integrates with the `remote` plugin (`plugins/remote/`)
  - Push-to-play: tap Cast to send any movie or episode directly to your living room Mac Mini or Apple TV
  - Remote control mode: real-time play, pause, seek, volume, and virtual D-pad navigation over persistent Server-Sent Events (SSE)

## Architecture

- **UI**: 100% Jetpack Compose with Material 3 theming and Android TV Compose (`androidx.tv.material`)
- **Navigation**: Navigation Compose with deep link support
- **Playback**: AndroidX Media3 (`androidx.media3.exoplayer`, `androidx.media3.session`, `androidx.media3.ui`)
- **Networking**: OkHttp with Kotlinx Serialization and coroutines
- **Storage**: AndroidX DataStore Preferences for remembered server URL, active profile, and auth tokens
- **Images**: Coil Compose for cached poster and backdrop loading

## Build

### Prerequisites
- JDK 21 (e.g. `brew install openjdk@21`)
- Android SDK command-line tools with API 35 (`brew install android-commandlinetools`)

### Commands
```bash
# Using the helper build script:
scripts/build-android.sh

# Or directly with Gradle:
cd android
./gradlew assembleDebug
```

The compiled APK will be generated at:
`android/app/build/outputs/apk/debug/app-debug.apk`

To install on a connected Android phone or Android TV device with ADB:
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

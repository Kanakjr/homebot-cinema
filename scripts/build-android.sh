#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/android"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"

echo "==> Building HomeBot Cinema Android app..."
echo "    JAVA_HOME: ${JAVA_HOME}"
echo "    ANDROID_HOME: ${ANDROID_HOME}"

cd "${ANDROID_DIR}"
./gradlew assembleDebug "$@"

echo "==> APK generated successfully at:"
echo "    ${ANDROID_DIR}/app/build/outputs/apk/debug/app-debug.apk"

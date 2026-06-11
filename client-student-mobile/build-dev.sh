#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$HOME/builds/cooperative-mobile"

echo "==> Синхронизирую исходники в $BUILD_DIR"
rsync -a --delete \
  --exclude=node_modules \
  --exclude=android \
  --exclude=ios \
  --exclude=.expo \
  --exclude=package-lock.json \
  "$SCRIPT_DIR/" "$BUILD_DIR/"

cd "$BUILD_DIR"

echo "==> Устанавливаю зависимости"
npm install --prefer-offline

if [ ! -d android ] || [ app.json -nt android/.prebuild-stamp ]; then
  echo "==> expo prebuild"
  rm -rf android
  npx expo prebuild --platform android --no-install
  sed -i 's/abiFilters "arm64-v8a", "armeabi-v7a", "x86", "x86_64"/abiFilters "arm64-v8a"/' \
    android/app/build.gradle
  sed -i "s/classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')/classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0')/" \
    android/build.gradle
  # expo-dev-launcher-gradle-plugin is compiled with Kotlin 1.9.25 but react-native-gradle-plugin needs 2.1.0
  sed -i 's/kotlin("jvm") version "1\.9\.[0-9]*"/kotlin("jvm") version "2.1.0"/' \
    ../node_modules/expo-dev-launcher/expo-dev-launcher-gradle-plugin/build.gradle.kts
  # expo-dev-menu references packageDebugAssets which doesn't exist in RN 0.81+
  sed -i 's/  packageDebugAssets\.dependsOn copyAssets/  def t1 = tasks.findByName("packageDebugAssets"); if (t1) t1.dependsOn copyAssets/' \
    ../node_modules/expo-dev-menu/android/build.gradle
  sed -i 's/  packageReleaseWithDevMenuAssets\.dependsOn copyAssets/  def t2 = tasks.findByName("packageReleaseWithDevMenuAssets"); if (t2) t2.dependsOn copyAssets/' \
    ../node_modules/expo-dev-menu/android/build.gradle
  touch android/.prebuild-stamp
fi

echo "==> Собираю debug APK (dev client)"
cd android
./gradlew assembleDebug --console=plain

APK=$(find app/build/outputs/apk/debug -name "*.apk" | head -1)
echo ""
cp "$APK" "$BUILD_DIR/../cooperative-student-dev.apk"
echo "==> Готово: ~/builds/cooperative-student-dev.apk"
echo ""
echo "Теперь запустите Metro: ./start-metro.sh"
echo "И установите APK на эмулятор/устройство."

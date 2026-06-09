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

if [ ! -d android ]; then
  echo "==> Первый запуск: expo prebuild"
  npx expo prebuild --platform android --no-install
fi

echo "==> Собираю APK"
cd android
./gradlew assembleRelease

APK=$(find app/build/outputs/apk/release -name "*.apk" | head -1)
echo ""
echo "==> Готово: $BUILD_DIR/android/$APK"
cp "$APK" "$BUILD_DIR/../cooperative-student.apk"
echo "==> Скопировано в ~/builds/cooperative-student.apk"

#!/bin/bash
set -e

BUILD_DIR="$HOME/builds/cooperative-mobile"

if [ ! -d "$BUILD_DIR/node_modules" ]; then
  echo "Сначала запустите build-dev.sh"
  exit 1
fi

cd "$BUILD_DIR"

SERVER_IP=$(hostname -I | awk '{print $1}')
echo "==> Запускаю Metro на $SERVER_IP:8083"
echo "==> В приложении введите: $SERVER_IP:8083"
echo ""

REACT_NATIVE_PACKAGER_HOSTNAME="$SERVER_IP" npx expo start --dev-client --port 8083

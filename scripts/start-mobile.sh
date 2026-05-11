#!/bin/bash
set -e

cd /workspaces/bar-app/mobile

if [ ! -d "node_modules" ]; then
  echo "Installing mobile dependencies..."
  npm install
fi

echo "Ensuring Expo ngrok is installed..."
npx expo install @expo/ngrok

echo "Starting Expo tunnel..."
npx expo start --tunnel

#!/bin/bash
set -e

cd /workspaces/bar-app/mobile

echo "Installing dependencies..."
npm install

echo "Installing Expo tunnel dependency..."
npx expo install @expo/ngrok

echo "Starting Expo tunnel..."
npx expo start --tunnel

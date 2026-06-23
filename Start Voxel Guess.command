#!/bin/bash
cd "$(dirname "$0")"
clear
printf '\nStarting Voxel Guess...\n\n'
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org and run this file again."
  read -r -p "Press Return to close..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing required packages (first launch only)..."
  npm install || { read -r -p "Install failed. Press Return to close..."; exit 1; }
fi
HOST_TOKEN=$(node -e "process.stdout.write(require('crypto').randomBytes(18).toString('hex'))")
export HOST_TOKEN
(sleep 2; open "http://localhost:3000/host.html?token=$HOST_TOKEN") >/dev/null 2>&1 &
npm start
read -r -p "Press Return to close..."

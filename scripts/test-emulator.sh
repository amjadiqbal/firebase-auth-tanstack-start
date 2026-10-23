#!/usr/bin/env bash
# Runs test/emulator/ against a real Firebase Auth Emulator (firebase-tools, no Java needed for auth).
set -euo pipefail
cd "$(dirname "$0")/.."
npx -y firebase-tools@15.34.1 emulators:exec --only auth --project demo-fats-ci \
  --config test/emulator/firebase.json 'npx vitest run --config vitest.emulator.config.ts'

#!/usr/bin/env bash
# Packs exactly what a commit ships: exports <ref> with `git archive`, installs, builds and runs `npm pack` there.
#   scripts/pack-from-git.sh <ref> <out-dir>
set -euo pipefail
REF=${1:-HEAD}; OUT=${2:?out dir}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" archive --format=tar "$REF" | tar -x -C "$WORK"
cd "$WORK"
npm ci --no-audit --no-fund
npm run --silent build
mkdir -p "$OUT"
npm pack --pack-destination "$OUT"

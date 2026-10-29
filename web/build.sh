#!/bin/sh
# Compile OBS overlay TypeScript into plain single-file JS bundles.
# The dashboard is a Vite + React SPA built from web/frontend
# (`make frontend`); this script only rebuilds the overlay files.
set -e
cd "$(dirname "$0")"
rm -rf compiled
trap 'rm -rf compiled' EXIT
if [ -x frontend/node_modules/.bin/tsc ]; then
  frontend/node_modules/.bin/tsc -p tsconfig.json --outDir compiled
elif command -v tsc >/dev/null 2>&1; then
  tsc -p tsconfig.json --outDir compiled
else
  npx -y -p typescript@5.6 tsc -p tsconfig.json --outDir compiled
fi
cat compiled/overlay.js > overlay/overlay.js
cat compiled/judge.js > overlay/judge.js
cat compiled/appearance.js > overlay/appearance.js
echo "overlay built: overlay/overlay.js overlay/judge.js overlay/appearance.js"

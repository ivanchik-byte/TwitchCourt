#!/bin/sh
# Compile OBS overlay TypeScript into plain single-file JS bundles.
# The dashboard is a Vite + React SPA built from web/frontend
# (`make frontend`); this script only rebuilds the overlay files.
set -e
cd "$(dirname "$0")"
rm -rf compiled
if command -v tsc >/dev/null 2>&1; then
  tsc --ignoreConfig --target ES2020 --strict --outDir compiled src/overlay.ts src/judge.ts
else
  npx -y -p typescript@5.6 tsc --ignoreConfig --target ES2020 --strict --outDir compiled src/overlay.ts src/judge.ts
fi
cat compiled/overlay.js > overlay/overlay.js
cat compiled/judge.js > overlay/judge.js
rm -rf compiled
echo "overlay built: overlay/overlay.js overlay/judge.js"

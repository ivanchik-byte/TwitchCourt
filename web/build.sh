#!/bin/sh
# Compile desk TypeScript into plain single-file JS bundles.
# Output stays dependency-free so the Go embed needs no toolchain.
set -e
cd "$(dirname "$0")"
rm -rf compiled
tsc --ignoreConfig --target ES2020 --strict --outDir compiled src/particles.ts src/gooey.ts src/desk.ts src/settings.ts src/modes.ts src/overlay.ts
cat compiled/particles.js compiled/gooey.js compiled/desk.js > dashboard/app.js
cat compiled/particles.js compiled/gooey.js compiled/settings.js > dashboard/settings.js
cat compiled/particles.js compiled/gooey.js compiled/modes.js > dashboard/modes.js
cat compiled/overlay.js > overlay/overlay.js
rm -rf compiled
echo "frontend built: dashboard/app.js dashboard/settings.js dashboard/modes.js overlay/overlay.js"

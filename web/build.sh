#!/bin/sh
# Compile TypeScript pages and bundle each with the shared protocol.
# Output stays plain single-file JS so the Go embed needs no toolchain.
set -e
cd "$(dirname "$0")"
rm -rf compiled/overlay compiled/dashboard
tsc --ignoreConfig --target ES2020 --strict --outDir compiled/overlay src/overlay.ts
tsc --ignoreConfig --target ES2020 --strict --outDir compiled/dashboard src/dashboard.ts
cp compiled/overlay/overlay.js overlay/courtroom.js
cp compiled/dashboard/dashboard.js dashboard/app.js
rm -rf compiled
echo "frontend built: overlay/courtroom.js dashboard/app.js"

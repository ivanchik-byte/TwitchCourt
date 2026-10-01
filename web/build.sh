#!/bin/sh
# Compile the control desk TypeScript into a single plain JS bundle.
# Output stays dependency-free so the Go embed needs no toolchain.
set -e
cd "$(dirname "$0")"
rm -rf compiled
tsc --ignoreConfig --target ES2020 --strict --outDir compiled src/desk.ts
cp compiled/desk.js dashboard/app.js
rm -rf compiled
echo "frontend built: dashboard/app.js"

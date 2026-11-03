#!/usr/bin/env bash
# Builds the extension for distribution, with only the files Chromium needs:
#   dist/whiskybase-lookup/              unpacked (for "Load unpacked")
#   dist/whiskybase-lookup-<version>.zip the same, zipped
# Prints the zip's path.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
name="whiskybase-lookup"
rm -rf dist
mkdir -p "dist/$name"
cp -r manifest.json src popup "dist/$name/"
mkdir -p "dist/$name/icons"
cp icons/*.png "dist/$name/icons/"

(cd "dist/$name" && zip -r -X -q "../$name-$version.zip" .)
echo "dist/$name-$version.zip"

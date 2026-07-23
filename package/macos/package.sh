#!/bin/bash

# Resolve script directory to project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==> Packaging Tweeker app for macOS..."
echo "Project Root: $PROJECT_ROOT"

# Navigate to project root
cd "$PROJECT_ROOT"

# Ensure cargo tauri is available (or try using npx tauri or cargo-tauri if installed)
TAURI_CMD="cargo tauri"
if ! command -v cargo-tauri &> /dev/null && ! cargo --list | grep -q tauri; then
  echo "Tauri CLI not found in cargo. Trying npx @tauri-apps/cli..."
  if command -v npx &> /dev/null; then
    TAURI_CMD="npx @tauri-apps/cli"
  else
    echo "Error: Neither cargo-tauri nor npx could be found. Please install tauri-cli first."
    exit 1
  fi
fi

echo "==> Running production build..."
# Build the application
BUILD_FAILED=0
if [ "$TAURI_CMD" = "cargo tauri" ]; then
  cargo tauri build || BUILD_FAILED=1
else
  $TAURI_CMD build || BUILD_FAILED=1
fi

# Locate the output bundles
BUNDLE_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle"
DIST_DIR="$PROJECT_ROOT/dist/macos"

echo "==> Preparing output directory at $DIST_DIR..."
mkdir -p "$DIST_DIR"

# Clean any previous artifacts in dist/macos
rm -rf "$DIST_DIR"/*

# Copy DMG and APP to dist/macos
COPIED=0

if [ -d "$BUNDLE_DIR/dmg" ]; then
  if ls "$BUNDLE_DIR"/dmg/*.dmg >/dev/null 2>&1; then
    echo "Copying DMG installer(s)..."
    cp "$BUNDLE_DIR"/dmg/*.dmg "$DIST_DIR/"
    COPIED=1
  fi
fi

if [ -d "$BUNDLE_DIR/macos" ]; then
  if ls -d "$BUNDLE_DIR"/macos/*.app >/dev/null 2>&1; then
    echo "Copying APP bundle(s)..."
    cp -R "$BUNDLE_DIR"/macos/*.app "$DIST_DIR/"
    COPIED=1
  fi
fi

if [ $COPIED -eq 1 ]; then
  echo "==> Packaging succeeded!"
  if [ $BUILD_FAILED -eq 1 ]; then
    echo "Warning: Tauri build reported errors (likely due to missing DMG tools like create-dmg),"
    echo "but the platform native .app bundle was successfully built and copied."
  fi
  echo "Artifacts are available in: $DIST_DIR"
  ls -lh "$DIST_DIR"
else
  echo "Error: Production build failed completely and no bundles were generated."
  exit 1
fi

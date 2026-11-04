#!/bin/sh
# Makes "Deal Desk.zip" to send to a colleague: the app only. Deals come from the shared Deal Desk folder on Google Drive.
# Usage: ./package.sh [path to an installed Deal Desk.app]   (default: ~/Desktop/Deal Desk.app – used only for the
#        built-in Python runtime and the icon; no deal data is copied)
# Apple Silicon Macs only (the built-in Python is arm64).
set -e
cd "$(dirname "$0")"
SRC="${1:-$HOME/Desktop/Deal Desk.app}"
[ -f "$SRC/Contents/Resources/python-runtime.tar.gz" ] || { echo "No Python runtime in $SRC"; exit 1; }
./build.sh
OUT="$(mktemp -d)"; APP="$OUT/Deal Desk.app"   # built outside this folder, only the zip is copied here
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp mac/Info.plist "$APP/Contents/Info.plist"
cp mac/DealDesk "$APP/Contents/MacOS/DealDesk"; chmod 755 "$APP/Contents/MacOS/DealDesk"
cp "$SRC/Contents/Resources/python-runtime.tar.gz" "$SRC/Contents/Resources/AppIcon.icns" "$APP/Contents/Resources/"
for f in index.html server.py xlsx.full.min.js jspdf.umd.min.js html2canvas.min.js; do cp "dist/$f" "$APP/Contents/Resources/$f"; done
cp mac/Install.txt "$OUT/Install – read me.txt"
VER="$(grep -m1 '^APP_VERSION' src/server.py | cut -d'"' -f2)"
( cd "$OUT" && zip -qry "Deal Desk $VER.zip" "Deal Desk.app" "Install – read me.txt" )
cp "$OUT/Deal Desk $VER.zip" "Deal Desk $VER.zip"; rm -rf "$OUT"
echo "Made Deal Desk $VER.zip ($(du -h "Deal Desk $VER.zip" | cut -f1))"

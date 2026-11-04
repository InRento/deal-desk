#!/bin/sh
# Build, test and install into the Desktop app. Then close the Deal Desk browser tab and click the Dock icon.
set -e
cd "$(dirname "$0")"
APP="$HOME/Desktop/Deal Desk.app/Contents/Resources"
[ -d "$APP" ] || { echo "Deal Desk.app not found on the Desktop"; exit 1; }
./run_tests.sh
for f in index.html server.py xlsx.full.min.js jspdf.umd.min.js html2canvas.min.js; do cp "dist/$f" "$APP/$f"; done
echo "Installed version $(grep -m1 '^APP_VERSION' src/server.py | cut -d'"' -f2)"

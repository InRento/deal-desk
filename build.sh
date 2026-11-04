#!/bin/sh
# Builds dist/ – exactly what goes into "Deal Desk.app/Contents/Resources":
#   index.html (page + styles + engine + app + PowerPoint library, one file), server.py and the three browser libraries.
# The app files in src/app are joined in name order inside one function scope, so later files can use anything
# declared in earlier ones (functions are visible everywhere; const/let only after the file that defines them has run).
set -e
cd "$(dirname "$0")"
mkdir -p dist
{ echo '(() => {'; for f in src/app/*.js; do echo "// ---- $f"; cat "$f"; done; echo '})();'; } > dist/app.js
if command -v node >/dev/null 2>&1; then node --check dist/app.js; fi
{
  echo '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  echo '<title>InRento Deal Desk</title>'
  echo '<style>'; cat src/styles.css; echo '</style>'
  echo '</head><body><div id="app"></div>'
  echo '<script src="/xlsx.full.min.js"></script><script src="/jspdf.umd.min.js"></script><script src="/html2canvas.min.js"></script>'
  echo '<script>'; grep -v '^//# sourceMappingURL' vendor/pptxgen.bundle.js; echo '</script>'
  echo '<script>'; cat src/engine.js; echo; cat src/trace.js; echo; cat dist/app.js; echo '</script></body></html>'
} > dist/index.html
cp src/server.py dist/server.py
cp vendor/xlsx.full.min.js vendor/jspdf.umd.min.js vendor/html2canvas.min.js dist/
echo "built dist/index.html ($(wc -c < dist/index.html) bytes)"

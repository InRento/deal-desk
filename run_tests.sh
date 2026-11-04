#!/bin/sh
# Release guard. Stops on any failure.
#  - engine guard: confirmed figures (Skýra, Ustroń, Noa, M23 vs the analysts' models) + every result of every test deal unchanged
#  - trace test: every "how it is calculated" explanation reproduces the number on screen
#  - server tests: storage, import folder, backups, origin guard, Gmail read-only, password never on disk
#  - drive tests: two servers on one shared folder (saves, stale copies, rev conflicts, versions, inbox, drive missing)
#  - with Playwright: app guard (every tab, deck and Excel export unchanged), the browser flow test and the lock test (two Macs)
cd "$(dirname "$0")"
fail=0; LOG="$(mktemp)"
run() { # run <name> <command…>: show failures and the last line, remember the result
  name="$1"; shift
  if "$@" > "$LOG" 2>&1; then tail -1 "$LOG"; else grep -v '^ok' "$LOG" | tail -25; echo "$name FAILED"; fail=1; fi
}
./build.sh || exit 1
if command -v node >/dev/null 2>&1; then run "Engine guard" node tests/engine_test.js; run "Trace test" node tests/trace_test.js
else echo "node not installed – engine guard cannot run (brew install node)"; fail=1; fi
run "Server tests" python3 tests/server_test.py
run "Drive tests" python3 -W ignore tests/drive_test.py
if command -v node >/dev/null 2>&1 && node -e "require('playwright')" >/dev/null 2>&1; then
  run "App guard" node tests/app_snapshot.js
  run "Browser test" node tests/ui_test.js
  run "Lock browser test" node tests/lock_ui_test.js
else echo "Playwright not installed – app guard and browser test skipped (npm i -D playwright && npx playwright install chromium)"; fi
rm -f "$LOG"
[ $fail = 0 ] && echo "ALL TESTS PASSED" || { echo "TESTS FAILED – do not release"; exit 1; }

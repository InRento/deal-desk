#!/bin/bash
# InRento Deal Desk launcher (Deal Desk.app/Contents/Resources/launcher.sh, run by the signed stub mac/launcher.c). The program comes from the shared Deal Desk folder on
# Google Drive: Releases/current.json names the version, Releases/<version>/ holds its files. Each file is checked
# against its checksum and kept in ~/Deal Desk/app/<version>, so publishing a release updates every Mac on its next
# start – nothing to reinstall. If a download is incomplete, the version already on this Mac runs instead.
# Deals live on the shared drive; this Mac's index, Gmail cache and log in ~/Deal Desk.
# Files are opened by this script itself (shell redirects), so macOS folder protection does not block child tools.
DATA="$HOME/Deal Desk"; PORT="${DEALDESK_PORT:-8765}"; URL="http://127.0.0.1:$PORT/"
RESTART=""; [ "$1" = "--restart" ] && RESTART=1
mkdir -p "$DATA/app" "$DATA/runtime" || exit 1
LOG="$DATA/deal-desk.log"
say() { echo "$(date) $1" >> "$LOG"; }
alert() { say "ALERT: $1"; [ -n "$DEALDESK_TEST" ] || /usr/bin/osascript -e "display alert \"Deal Desk\" message \"$1\"" >/dev/null 2>&1; }
fail() { alert "$1 Details are in deal-desk.log in the Deal Desk folder in your home folder."; exit 1; }
ping() { /usr/bin/curl -s -m 1 "${URL}api/ping"; }
json() { /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null; }
sha() { /usr/bin/shasum -a 256 "$1" 2>/dev/null | /usr/bin/cut -d' ' -f1; }
openurl() { [ -n "$DEALDESK_TEST$RESTART" ] || /usr/bin/open "$URL"; }
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
case "$BUNDLE" in *.app) LAUNCHER="$BUNDLE" ;; *) LAUNCHER="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")" ;; esac

# 1. the shared folder: ~/Deal Desk/config.json, else the one Shared Drive holding the .deal-desk marker
DRIVE="${DEALDESK_DRIVE:-}"
[ -z "$DRIVE" ] && [ -f "$DATA/config.json" ] && DRIVE="$(json "$DATA/config.json" driveRoot)"
if [ -z "$DRIVE" ]; then
  for m in "$HOME"/Library/CloudStorage/GoogleDrive-*/"Shared drives"/*/.deal-desk; do [ -f "$m" ] && DRIVE="$(dirname "$m")" && break; done
fi
if [ -z "$DRIVE" ]; then # Google Drive is there but macOS does not let Deal Desk in (permission declined)
  for g in "$HOME"/Library/CloudStorage/GoogleDrive-*; do
    [ -d "$g" ] && ! /bin/ls "$g" >/dev/null 2>&1 && fail "Deal Desk needs your permission to open files in Google Drive. Turn on Deal Desk under System Settings > Privacy & Security > Files & Folders (Google Drive), then open Deal Desk again."
  done
fi
[ -n "$DRIVE" ] && [ -f "$DRIVE/.deal-desk" ] || fail "The shared Deal Desk folder was not found. Open Google Drive, check that the “Deal desk” shared drive shows in Finder, then open Deal Desk again."
# a Mac trying a release before it is published follows Releases/preview.json ("release": "preview" in config.json)
CHANNEL=current
[ -f "$DATA/config.json" ] && [ "$(json "$DATA/config.json" release)" = "preview" ] && CHANNEL=preview
CUR="$DRIVE/Releases/$CHANNEL.json"

# 2. the program: the published version, unless it cannot be fetched intact
installed() { [ -n "$1" ] && [ -f "$DATA/app/$1/.complete" ]; }
newest_installed() { for d in $(/bin/ls -t "$DATA/app" 2>/dev/null); do installed "$d" && echo "$d" && return; done; }
fetch() { # fetch <version>: copy Releases/<version>/ to ~/Deal Desk/app/<version>, every file checked
  local v="$1" src="$DRIVE/Releases/$1" tmp="$DATA/app/.incoming-$1" i=0 name want
  rm -rf "$tmp"; mkdir -p "$tmp" || return 1
  while name="$(json "$CUR" "files.$i.name")" && [ -n "$name" ]; do
    want="$(json "$CUR" "files.$i.sha256")"
    /bin/cat < "$src/$name" > "$tmp/$name" 2>> "$LOG" || { say "could not copy $name of $v"; rm -rf "$tmp"; return 1; }
    [ "$(sha "$tmp/$name")" = "$want" ] || { say "$name of $v does not match its checksum (still syncing?)"; rm -rf "$tmp"; return 1; }
    i=$((i + 1))
  done
  [ $i -gt 0 ] || { rm -rf "$tmp"; return 1; }
  touch "$tmp/.complete"; rm -rf "$DATA/app/$v"; mv "$tmp" "$DATA/app/$v"
}
WANT="$(json "$CUR" version)"
RUN="$WANT"
if [ -z "$WANT" ]; then
  RUN="$(newest_installed)"; say "Releases/current.json not readable – running $RUN"
elif ! installed "$WANT"; then
  say "installing $WANT from the shared drive"
  if ! fetch "$WANT"; then
    RUN="$(newest_installed)"
    [ -n "$RUN" ] && alert "Deal Desk $WANT could not be fetched from Google Drive yet (still syncing?). Starting $RUN, the version on this Mac; it updates next time."
  fi
fi
installed "$RUN" || fail "Deal Desk could not be installed from the shared drive."
APPDIR="$DATA/app/$RUN"

# 3. the built-in Python, unpacked once per runtime version
RTFILE="$(json "$CUR" runtime.file)"; RTSHA="$(json "$CUR" runtime.sha256)"
PY=""
if [ -n "$RTSHA" ]; then
  RTDIR="$DATA/runtime/${RTSHA:0:12}"
  if [ ! -x "$RTDIR/python/bin/python3" ]; then
    say "unpacking the built-in Python ${RTSHA:0:12}"
    mkdir -p "$DATA/runtime/.incoming"
    /bin/cat < "$DRIVE/Releases/$RTFILE" > "$DATA/runtime/.incoming/rt.tar.gz" 2>> "$LOG"
    if [ "$(sha "$DATA/runtime/.incoming/rt.tar.gz")" = "$RTSHA" ]; then
      rm -rf "$RTDIR"; mkdir -p "$RTDIR"
      /usr/bin/tar -xzf - -C "$RTDIR" < "$DATA/runtime/.incoming/rt.tar.gz" >> "$LOG" 2>&1 || rm -rf "$RTDIR"
      /usr/bin/xattr -dr com.apple.quarantine "$RTDIR" >/dev/null 2>&1
    else say "runtime does not match its checksum"; fi
    rm -rf "$DATA/runtime/.incoming"
  fi
  [ -x "$RTDIR/python/bin/python3" ] && PY="$RTDIR/python/bin/python3"
fi
[ -z "$PY" ] && for p in "$DATA"/runtime/*/python/bin/python3; do [ -x "$p" ] && PY="$p" && break; done
[ -n "$PY" ] || fail "The built-in Python could not be fetched from the shared drive."
"$PY" -c "import sqlite3, http.server" >> "$LOG" 2>&1 || fail "The built-in Python does not run on this Mac."

# 4. start it (an older server still running is stopped first; it writes pending changes before it exits)
# (not on a restart: the server that asked for it is still answering while it shuts down)
if [ -z "$RESTART" ] && ping | /usr/bin/grep -q "\"version\": \"$RUN\""; then openurl; exit 0; fi
for pid in $(/usr/sbin/lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null); do
  if /bin/ps -o command= -p "$pid" | /usr/bin/grep -q "server.py"; then say "stopping older server $pid"; kill "$pid"; fi
done
for i in $(seq 1 40); do /usr/sbin/lsof -ti tcp:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
say "starting $RUN ($CHANNEL)"
cd "$DATA" || exit 1
DEALDESK_DATA="$DATA" DEALDESK_DRIVE="$DRIVE" DEALDESK_LAUNCHER="$LAUNCHER" DEALDESK_CHANNEL="$CHANNEL" nohup "$PY" "$APPDIR/server.py" --no-browser --idle-exit 20 --port "$PORT" >> "$LOG" 2>&1 &
for i in $(seq 1 80); do ping | /usr/bin/grep -q deal-desk && break; sleep 0.25; done
ping | /usr/bin/grep -q deal-desk || fail "Deal Desk did not start."
openurl
# keep the three newest versions (and the one running)
n=0; for d in $(/bin/ls -t "$DATA/app" 2>/dev/null); do
  installed "$d" || continue; n=$((n + 1)); [ $n -gt 3 ] && [ "$d" != "$RUN" ] && rm -rf "$DATA/app/$d"
done
# the app quits here (so the installer can replace it); the server it started keeps its Google Drive access
exit 0

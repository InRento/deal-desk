#!/bin/sh
# Releases Deal Desk through the shared Google Drive folder. Every Mac runs the version named in Releases/current.json
# (the launcher fetches and checks it at start), so a release is two steps: stage Releases/<version>/, then publish =
# switch current.json. Running apps offer "Restart to update" within a few seconds of publishing.
#   ./release.sh                     build, run the tests, stage Releases/<APP_VERSION>/ – nobody gets it yet
#   ./release.sh --publish           the same, then switch current.json to it (only after Tautvydas says "push")
#   ./release.sh --rollback 3.19.0   switch current.json back to a version staged earlier
#   ./release.sh --installer         also (re)build "Install Deal Desk.dmg" in the shared folder (needed when mac/ changes)
#   ./release.sh --preview           point Releases/preview.json at it: only Macs with "release": "preview" in
#                                    ~/Deal Desk/config.json run it – for trying a release before it is published
# Options: --drive <folder>                 the shared folder (default: found the way the app finds it)
#          --runtime <python dir|.tar.gz>   built-in Python (arm64); needed for the first release, then reused
#          --min-version <v>                oldest app still allowed to save; raise it when the deal format changes
#          --skip-tests                     only for tests/launcher_test.py
#          --no-git                          only for tests/launcher_test.py (a copy of the repo without git)
# Before anything is built it checks git (v3.25.8): no uncommitted changes, and for --publish: on main, main pushed to
# GitHub and equal to it, tag v<APP_VERSION> on this commit, a CHANGELOG entry, and a version above the published one.
# Any miss stops the release with what to do – a version whose code is not on GitHub is never published.
# The repository itself never goes to the drive (tests/deals and data/ hold real deals) – only dist/ and the runtime.
set -e
cd "$(dirname "$0")"
SKIP=""; ROLLBACK=""; PUBLISH=""; NOGIT=""
for a in "$@"; do [ "$a" = "--skip-tests" ] && SKIP=1; [ "$a" = "--rollback" ] && ROLLBACK=1; [ "$a" = "--publish" ] && PUBLISH=1; [ "$a" = "--no-git" ] && NOGIT=1; done
stop() { echo; echo "STOPPED – nothing was released: $*"; echo; exit 1; }
if [ -z "$ROLLBACK" ] && [ -z "$NOGIT" ]; then
  git rev-parse --git-dir >/dev/null 2>&1 || stop "this folder is not the git clone"
  dirty="$(git status --porcelain --untracked-files=no)"
  [ -z "$dirty" ] || stop "uncommitted changes – commit or discard them first:
$dirty"
  VER="$(sed -n 's/^APP_VERSION = "\([^"]*\)".*/\1/p' src/server.py)"
  BR="$(git rev-parse --abbrev-ref HEAD)"
  if [ -n "$PUBLISH" ]; then
    [ "$BR" = "main" ] || stop "you are on branch $BR. Publish only from main: GitHub Desktop → Current branch → main (or: git checkout main)"
    echo "Checking GitHub…"
    git fetch -q origin main --tags || stop "could not reach GitHub to check that main is pushed"
    ahead="$(git rev-list --count origin/main..HEAD)"; behind="$(git rev-list --count HEAD..origin/main)"
    [ "$ahead" = 0 ] || stop "main has $ahead commit(s) not on GitHub. Push origin in GitHub Desktop, then run this again"
    [ "$behind" = 0 ] || stop "GitHub has $behind newer commit(s) on main. Pull (git pull), then run this again"
    [ "$(git rev-list -n 1 "v$VER" 2>/dev/null)" = "$(git rev-parse HEAD)" ] || stop "tag v$VER is missing or not on this commit – the release was not prepared (ask Claude to prepare $VER)"
    grep -q "^- v$VER " docs/CHANGELOG.md || stop "docs/CHANGELOG.md has no entry for v$VER"
    git ls-remote --exit-code --tags origin "refs/tags/v$VER" >/dev/null 2>&1 || git push -q origin "v$VER" 2>/dev/null \
      || echo "Note: tag v$VER is not on GitHub yet – push it later with: git push origin v$VER"
  fi
fi
if [ -z "$ROLLBACK" ]; then
  ./build.sh
  [ -n "$SKIP" ] || ./run_tests.sh
fi
exec python3 - "$@" <<'PY'
import argparse, datetime, getpass, glob, hashlib, json, os, re, shutil, subprocess, sys, tarfile, tempfile

ap = argparse.ArgumentParser(prog="release.sh")
ap.add_argument("--publish", action="store_true")
ap.add_argument("--rollback", metavar="VERSION")
ap.add_argument("--installer", action="store_true")
ap.add_argument("--preview", action="store_true")
ap.add_argument("--drive")
ap.add_argument("--runtime")
ap.add_argument("--min-version")
ap.add_argument("--skip-tests", action="store_true")
ap.add_argument("--no-git", action="store_true")
a = ap.parse_args()

FILES = ["index.html", "server.py", "xlsx.full.min.js", "jspdf.umd.min.js", "html2canvas.min.js"]
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def sha(fp):
    h = hashlib.sha256()
    with open(fp, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read(fp):
    try:
        with open(fp, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write(fp, obj):
    tmp = fp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, fp)


root = a.drive or os.environ.get("DEALDESK_DRIVE")
if not root:
    hits = glob.glob(os.path.expanduser("~/Library/CloudStorage/GoogleDrive-*/Shared drives/*/.deal-desk"))
    root = os.path.dirname(hits[0]) if len(hits) == 1 else None
if not root or not os.path.isfile(os.path.join(root, ".deal-desk")):
    sys.exit("Shared Deal Desk folder not found – pass --drive <folder>")
rel = os.path.join(root, "Releases")
os.makedirs(os.path.join(rel, "runtime"), exist_ok=True)
cur_path = os.path.join(rel, "current.json")
cur = read(cur_path) or {}


def publish(manifest):
    c = dict(manifest, min_version=a.min_version or cur.get("min_version"), publishedAt=now, publishedBy=getpass.getuser())
    write(cur_path, c)
    print(f"Published {c['version']}: every Mac runs it on its next start; open apps offer a restart."
          + (f" Apps older than {c['min_version']} can only view deals." if c.get("min_version") else ""))


if a.rollback:
    m = read(os.path.join(rel, a.rollback, "manifest.json"))
    if not m:
        sys.exit(f"Releases/{a.rollback} was never staged")
    publish(m)
    sys.exit(0)

ver = re.search(r'^APP_VERSION = "([^"]+)"', open("dist/server.py", encoding="utf-8").read(), re.M).group(1)
vt = lambda v: tuple(int(x) for x in re.findall(r"\d+", v or "0"))
if a.publish and cur.get("version") and vt(ver) < vt(cur["version"]):
    sys.exit(f"STOPPED – {ver} is older than the published {cur['version']} (a stale src/server.py?). Use --rollback to go back on purpose.")
files = [{"name": f, "sha256": sha(os.path.join("dist", f))} for f in FILES]
dest = os.path.join(rel, ver)
old = read(os.path.join(dest, "manifest.json"))
if old and old.get("files") != files:
    sys.exit(f"Releases/{ver} already holds different files. Bump APP_VERSION in src/server.py for a new release"
             + (" (it is the published version)." if cur.get("version") == ver else "."))

if a.runtime:
    src = a.runtime
    if os.path.isdir(src):  # an unpacked runtime folder (…/python): pack it the way the launcher unpacks it
        tmp = tempfile.mkdtemp()
        tgz = os.path.join(tmp, "python-runtime.tar.gz")
        with tarfile.open(tgz, "w:gz") as t:
            t.add(src, arcname="python")
        src = tgz
    rsha = sha(src)
    rname = f"runtime/python-{rsha[:12]}.tar.gz"
    if not os.path.exists(os.path.join(rel, rname)):
        shutil.copyfile(src, os.path.join(rel, rname))
    runtime = {"file": rname, "sha256": rsha}
else:
    staged = [read(m) or {} for m in sorted(glob.glob(os.path.join(rel, "*", "manifest.json")), key=os.path.getmtime, reverse=True)]
    runtime = cur.get("runtime") or (old or {}).get("runtime") or (read(os.path.join(rel, "preview.json")) or {}).get("runtime") \
        or next((m["runtime"] for m in staged if m.get("runtime")), None)
    if not runtime:
        sys.exit("The first release needs the built-in Python: --runtime <folder with python/ or python-runtime.tar.gz>")

if not old:
    staging = dest + ".staging"
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging)
    for f in FILES:
        shutil.copyfile(os.path.join("dist", f), os.path.join(staging, f))
    os.replace(staging, dest)
manifest = {"version": ver, "files": files, "runtime": runtime, "stagedAt": (old or {}).get("stagedAt") or now, "stagedBy": getpass.getuser()}
write(os.path.join(dest, "manifest.json"), manifest)
print(f"{'Already staged' if old else 'Staged'}: Releases/{ver}")

if a.preview:
    write(os.path.join(rel, "preview.json"), dict(manifest, min_version=cur.get("min_version"), previewAt=now))
    print(f"Preview: Macs with \"release\": \"preview\" in ~/Deal Desk/config.json run {ver}; everyone else stays on {cur.get('version') or 'nothing yet'}")
if a.publish:
    publish(manifest)
elif cur.get("version") != ver and not a.preview:
    print(f"Not published – Macs still run {cur.get('version') or 'nothing yet'}. Publish with: ./release.sh --publish")

if a.installer:
    tmp = tempfile.mkdtemp()
    app = os.path.join(tmp, "Deal Desk.app", "Contents")
    os.makedirs(os.path.join(app, "MacOS"))
    os.makedirs(os.path.join(app, "Resources"))
    shutil.copyfile("mac/Info.plist", os.path.join(app, "Info.plist"))
    # the executable is a small signed program (macOS keeps the Google Drive permission only for signed code); it runs
    # Resources/launcher.sh. Ad-hoc signed here – needs the Xcode command line tools (xcode-select --install).
    subprocess.run(["cc", "-O2", "-arch", "arm64", "-o", os.path.join(app, "MacOS", "DealDesk"), "mac/launcher.c"], check=True)
    shutil.copyfile("mac/launcher.sh", os.path.join(app, "Resources", "launcher.sh"))
    os.chmod(os.path.join(app, "Resources", "launcher.sh"), 0o755)
    if os.path.exists("mac/AppIcon.icns"):
        shutil.copyfile("mac/AppIcon.icns", os.path.join(app, "Resources", "AppIcon.icns"))
    subprocess.run(["codesign", "--force", "-s", "-", os.path.join(tmp, "Deal Desk.app")], check=True, capture_output=True)
    shutil.copyfile("mac/Install.txt", os.path.join(tmp, "Install – read me.txt"))
    os.symlink("/Applications", os.path.join(tmp, "Applications"))
    out = os.path.join(tempfile.mkdtemp(), "Install Deal Desk.dmg")
    subprocess.run(["hdiutil", "create", "-quiet", "-volname", "Deal Desk", "-srcfolder", tmp, "-format", "UDZO", "-ov", out], check=True)
    shutil.copyfile(out, os.path.join(root, "Install Deal Desk.dmg.tmp"))
    os.replace(os.path.join(root, "Install Deal Desk.dmg.tmp"), os.path.join(root, "Install Deal Desk.dmg"))
    print(f"Installer: {os.path.join(root, 'Install Deal Desk.dmg')}")
PY

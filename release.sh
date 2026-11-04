#!/bin/sh
# Releases Deal Desk through the shared Google Drive folder. Every Mac runs the version named in Releases/current.json
# (the launcher fetches and checks it at start), so a release is two steps: stage Releases/<version>/, then publish =
# switch current.json. Running apps offer "Restart to update" within a few seconds of publishing.
#   ./release.sh                     build, run the tests, stage Releases/<APP_VERSION>/ – nobody gets it yet
#   ./release.sh --publish           the same, then switch current.json to it (only after Tautvydas says "push")
#   ./release.sh --rollback 3.19.0   switch current.json back to a version staged earlier
#   ./release.sh --installer         also (re)build "Install Deal Desk.dmg" in the shared folder (needed when mac/ changes)
# Options: --drive <folder>                 the shared folder (default: found the way the app finds it)
#          --runtime <python dir|.tar.gz>   built-in Python (arm64); needed for the first release, then reused
#          --min-version <v>                oldest app still allowed to save; raise it when the deal format changes
#          --skip-tests                     only for tests/launcher_test.py
# The repository itself never goes to the drive (tests/deals and data/ hold real deals) – only dist/ and the runtime.
set -e
cd "$(dirname "$0")"
SKIP=""; ROLLBACK=""
for a in "$@"; do [ "$a" = "--skip-tests" ] && SKIP=1; [ "$a" = "--rollback" ] && ROLLBACK=1; done
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
ap.add_argument("--drive")
ap.add_argument("--runtime")
ap.add_argument("--min-version")
ap.add_argument("--skip-tests", action="store_true")
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
    runtime = cur.get("runtime") or (old or {}).get("runtime")
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

if a.publish:
    publish(manifest)
elif cur.get("version") != ver:
    print(f"Not published – Macs still run {cur.get('version') or 'nothing yet'}. Publish with: ./release.sh --publish")

if a.installer:
    tmp = tempfile.mkdtemp()
    app = os.path.join(tmp, "Deal Desk.app", "Contents")
    os.makedirs(os.path.join(app, "MacOS"))
    os.makedirs(os.path.join(app, "Resources"))
    shutil.copyfile("mac/Info.plist", os.path.join(app, "Info.plist"))
    shutil.copyfile("mac/DealDesk", os.path.join(app, "MacOS", "DealDesk"))
    os.chmod(os.path.join(app, "MacOS", "DealDesk"), 0o755)
    if os.path.exists("mac/AppIcon.icns"):
        shutil.copyfile("mac/AppIcon.icns", os.path.join(app, "Resources", "AppIcon.icns"))
    shutil.copyfile("mac/Install.txt", os.path.join(tmp, "Install – read me.txt"))
    os.symlink("/Applications", os.path.join(tmp, "Applications"))
    out = os.path.join(tempfile.mkdtemp(), "Install Deal Desk.dmg")
    subprocess.run(["hdiutil", "create", "-quiet", "-volname", "Deal Desk", "-srcfolder", tmp, "-format", "UDZO", "-ov", out], check=True)
    shutil.copyfile(out, os.path.join(root, "Install Deal Desk.dmg.tmp"))
    os.replace(os.path.join(root, "Install Deal Desk.dmg.tmp"), os.path.join(root, "Install Deal Desk.dmg"))
    print(f"Installer: {os.path.join(root, 'Install Deal Desk.dmg')}")
PY

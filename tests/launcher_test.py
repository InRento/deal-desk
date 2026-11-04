#!/usr/bin/env python3
"""Install and update from the shared drive, end to end: release.sh stages and publishes into a temporary shared folder
inside a fake home (at the path Google Drive for Desktop uses), the real launcher (mac/launcher.sh) finds it, installs the
published version with its checksums and starts it; publishing a newer version makes the running app offer a restart,
the restart runs the new version; a version that arrives damaged is not run; an app older than min_version is read-only.
The built-in Python is stood in for by a link to this Python. Standard library only:  python3 tests/launcher_test.py
"""
import glob
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAUNCHER = os.path.join(ROOT, "mac", "launcher.sh")
VERSION = None


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def sha(fp):
    with open(fp, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


class LauncherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global VERSION
        cls.tmp = tempfile.mkdtemp(prefix="dealdesk-launch-")
        cls.home = os.path.join(cls.tmp, "home")
        cls.drive = os.path.join(cls.home, "Library", "CloudStorage", "GoogleDrive-test@example.com", "Shared drives", "Deal desk")
        subprocess.run([sys.executable, os.path.join(ROOT, "src", "server.py"), "--init-drive", cls.drive],
                       env=dict(os.environ, DEALDESK_DATA=os.path.join(cls.tmp, "setup")), check=True, capture_output=True)
        rt = os.path.join(cls.tmp, "rt", "python", "bin")
        os.makedirs(rt)
        os.symlink(sys.executable, os.path.join(rt, "python3"))
        cls.port = free_port()
        cls.env = dict(os.environ, HOME=cls.home, DEALDESK_TEST="1", DEALDESK_PORT=str(cls.port), DEALDESK_SYNC_SECONDS="0.5",
                       DEALDESK_FLUSH_SECONDS="0", DEALDESK_USER="test@example.com")
        cls.env.pop("DEALDESK_DRIVE", None)
        cls.env.pop("DEALDESK_DATA", None)
        cls.release("--publish", "--runtime", os.path.join(cls.tmp, "rt", "python"))
        VERSION = cls.current()["version"]

    @classmethod
    def tearDownClass(cls):
        cls.stop_server()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def release(cls, *args):
        return subprocess.run([os.path.join(ROOT, "release.sh"), "--drive", cls.drive, "--skip-tests", *args],
                              capture_output=True, text=True, check=True).stdout

    @classmethod
    def current(cls):
        with open(os.path.join(cls.drive, "Releases", "current.json")) as fh:
            return json.load(fh)

    @classmethod
    def stop_server(cls):
        out = subprocess.run(["/usr/sbin/lsof", "-ti", f"tcp:{cls.port}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout.split()
        for pid in out:
            subprocess.run(["kill", pid])
        for _ in range(40):
            if not subprocess.run(["/usr/sbin/lsof", "-ti", f"tcp:{cls.port}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout.strip():
                return
            time.sleep(0.25)

    def call(self, method, path, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())

    def running(self):
        try:
            return self.call("GET", "/api/ping")["version"]
        except OSError:
            return None

    def wait_for(self, fn, seconds=20):
        for _ in range(int(seconds / 0.25)):
            v = fn()
            if v:
                return v
            time.sleep(0.25)
        return fn()

    def launch(self, *args):
        r = subprocess.run([LAUNCHER, *args], env=self.env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr + self.log())

    def log(self):
        try:
            with open(os.path.join(self.home, "Deal Desk", "deal-desk.log")) as fh:
                return fh.read()
        except OSError:
            return ""

    def publish_variant(self, version, damage=False, min_version=None, point_to=None):
        """What release.sh stages for a newer version, made by hand (the source keeps one APP_VERSION)."""
        rel = os.path.join(self.drive, "Releases")
        if not point_to:
            shutil.copytree(os.path.join(rel, VERSION), os.path.join(rel, version))
            fp = os.path.join(rel, version, "server.py")
            with open(fp) as fh:
                text = fh.read().replace(f'APP_VERSION = "{VERSION}"', f'APP_VERSION = "{version}"')
            with open(fp, "w") as fh:
                fh.write(text)
        m = json.load(open(os.path.join(rel, VERSION, "manifest.json")))
        files = [{"name": f["name"], "sha256": sha(os.path.join(rel, point_to or version, f["name"]))} for f in m["files"]]
        if damage:  # arrives different from what was published (e.g. Drive still syncing it)
            with open(os.path.join(rel, version, "server.py"), "a") as fh:
                fh.write("\n# half-synced\n")
        with open(os.path.join(rel, "current.json"), "w") as fh:
            json.dump(dict(m, version=point_to or version, files=files, min_version=min_version), fh)

    def test_1_release_stages_and_publishes(self):
        cur = self.current()
        self.assertEqual(sorted(f["name"] for f in cur["files"]), ["html2canvas.min.js", "index.html", "jspdf.umd.min.js", "server.py", "xlsx.full.min.js"])
        self.assertTrue(os.path.isfile(os.path.join(self.drive, "Releases", cur["runtime"]["file"])))
        self.assertIn("Already staged", self.release())  # same files again: nothing changes
        self.assertFalse(glob.glob(os.path.join(self.drive, "**", "*.sqlite"), recursive=True))
        self.assertFalse(os.path.exists(os.path.join(self.drive, "Releases", VERSION, "tests")), "only dist/ goes to the drive")

    def test_2_launcher_installs_and_starts(self):
        self.launch()
        self.assertEqual(self.running(), VERSION)
        app = os.path.join(self.home, "Deal Desk", "app", VERSION)
        self.assertTrue(os.path.isfile(os.path.join(app, ".complete")))
        self.assertEqual(sha(os.path.join(app, "server.py")), sha(os.path.join(ROOT, "dist", "server.py")))
        self.assertEqual(len(glob.glob(os.path.join(self.home, "Deal Desk", "runtime", "*", "python", "bin", "python3"))), 1)
        info = self.call("GET", "/api/info")["storage"]
        self.assertEqual(info["root"], self.drive, "found the shared drive under ~/Library/CloudStorage by itself")
        self.launch()  # opening it again while it runs keeps the same server
        self.assertEqual(self.running(), VERSION)

    def test_3_publishing_a_newer_version_updates_without_reinstalling(self):
        self.publish_variant("9.9.0")
        upd = self.wait_for(lambda: self.call("GET", "/api/locks")["update"]["available"])
        self.assertEqual(upd, "9.9.0")
        self.assertTrue(self.call("GET", "/api/locks")["update"]["canRestart"])
        self.call("POST", "/api/restart", {})
        self.assertEqual(self.wait_for(lambda: self.running() == "9.9.0" and "9.9.0"), "9.9.0", self.log())
        self.assertIn("installing 9.9.0", self.log())
        self.assertIsNone(self.call("GET", "/api/locks")["update"]["available"])

    def test_4_a_damaged_download_is_not_run(self):
        self.publish_variant("9.9.1", damage=True)
        self.wait_for(lambda: self.call("GET", "/api/locks")["update"]["available"])
        self.call("POST", "/api/restart", {})
        time.sleep(1)
        self.assertEqual(self.wait_for(lambda: self.running()), "9.9.0", "the version already on this Mac keeps running")
        self.assertIn("server.py of 9.9.1 does not match its checksum", self.log())
        self.assertIn("ALERT: Deal Desk 9.9.1 could not be fetched", self.log())
        self.assertFalse(os.path.exists(os.path.join(self.home, "Deal Desk", "app", "9.9.1")))

    def test_5_too_old_for_the_shared_deals_is_read_only(self):
        self.publish_variant("9.9.0", point_to="9.9.0", min_version="9.9.5")
        req = self.wait_for(lambda: self.call("GET", "/api/locks")["update"]["required"])
        self.assertEqual(req, "9.9.5")
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.call("PUT", "/api/projects/x1", {"name": "Old app", "inputs": {}})
        self.assertEqual(e.exception.code, 423)
        self.assertIn("older than the shared deals allow (9.9.5 or newer)", json.loads(e.exception.read())["error"])

    def test_6_rollback(self):
        out = self.release("--rollback", VERSION)
        self.assertIn(f"Published {VERSION}", out)
        self.assertEqual(self.current()["version"], VERSION)
        with self.assertRaises(subprocess.CalledProcessError):
            self.release("--rollback", "0.0.1")

    def test_7_installer_disk_image(self):
        """The installer on the drive is a disk image: it keeps the launcher executable (a bare .app synced through Google
        Drive may lose that) and mounts read-only, so nothing is unpacked into the shared drive."""
        self.release("--installer")
        dmg = os.path.join(self.drive, "Install Deal Desk.dmg")
        self.assertTrue(os.path.isfile(dmg))
        mnt = os.path.join(self.tmp, "mnt")
        os.makedirs(mnt)
        subprocess.run(["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mnt, dmg], check=True, capture_output=True)
        try:
            exe = os.path.join(mnt, "Deal Desk.app", "Contents", "MacOS", "DealDesk")
            self.assertTrue(os.access(exe, os.X_OK), "the app's program is executable")
            self.assertIn("Mach-O 64-bit executable arm64", subprocess.run(["file", exe], capture_output=True, text=True).stdout,
                          "a compiled program, not a script: macOS keeps the Google Drive permission only for signed code")
            sig = subprocess.run(["codesign", "-dv", os.path.join(mnt, "Deal Desk.app")], capture_output=True, text=True).stderr
            self.assertIn("Identifier=com.inrento.dealdesk", sig)
            self.assertEqual(subprocess.run(["codesign", "--verify", "--strict", os.path.join(mnt, "Deal Desk.app")]).returncode, 0, "signature intact")
            script = os.path.join(mnt, "Deal Desk.app", "Contents", "Resources", "launcher.sh")
            self.assertTrue(os.access(script, os.X_OK))
            with open(script) as fh, open(LAUNCHER) as orig:
                self.assertEqual(fh.read(), orig.read())
            self.assertTrue(os.path.isfile(os.path.join(mnt, "Deal Desk.app", "Contents", "Info.plist")))
            self.assertTrue(os.path.isfile(os.path.join(mnt, "Install – read me.txt")))
            self.assertEqual(os.readlink(os.path.join(mnt, "Applications")), "/Applications")
        finally:
            subprocess.run(["hdiutil", "detach", mnt, "-quiet"], capture_output=True)

    def test_8_preview_channel(self):
        """A release can be tried on one Mac before it is published: only a Mac set to "preview" follows preview.json."""
        self.release("--rollback", VERSION)
        self.publish_variant("9.9.7")  # stands in for a staged release; now make it the preview, not the published one
        rel = os.path.join(self.drive, "Releases")
        os.replace(os.path.join(rel, "current.json"), os.path.join(rel, "preview.json"))
        self.release("--rollback", VERSION)
        cfg = os.path.join(self.home, "Deal Desk", "config.json")
        self.stop_server()
        self.launch()
        self.assertEqual(self.running(), VERSION, "a Mac not set to preview stays on the published version")
        with open(cfg, "w") as fh:
            json.dump({"release": "preview"}, fh)
        try:
            self.stop_server()
            self.launch()
            self.assertEqual(self.running(), "9.9.7")
            self.assertIn("starting 9.9.7 (preview)", self.log())
            self.assertIsNone(self.call("GET", "/api/locks")["update"]["available"], "the preview Mac compares with preview.json")
        finally:
            os.remove(cfg)

    def test_9_switching_a_mac_that_has_the_old_app(self):
        """Tautvydas's Mac: ~/Deal Desk already holds the pre-drive app (deals.sqlite, flat app/ files, runtime/python,
        deals_… backups). The new launcher installs next to it without touching any of that, and the one command he runs
        moves his deals (newer than the drive's copy) and his Gmail cache in."""
        import sqlite3
        home = os.path.join(self.tmp, "home-t")
        old = os.path.join(home, "Deal Desk")
        os.makedirs(os.path.join(old, "app"))
        os.makedirs(os.path.join(old, "runtime", "python", "bin"))
        os.makedirs(os.path.join(old, "backups"))
        for f in ("server.py", "index.html"):
            open(os.path.join(old, "app", f), "w").write("old 3.18 program")
        os.symlink(sys.executable, os.path.join(old, "runtime", "python", "bin", "python3"))
        open(os.path.join(old, "backups", "deals_2026-11-03_182651_daily.sqlite"), "w").close()
        subprocess.run([sys.executable, "-c", "import sys; sys.path.insert(0, 'src'); import server; server.init_db()"],
                       cwd=ROOT, env=dict(os.environ, DEALDESK_DATA=old, DEALDESK_DRIVE=""), check=True, capture_output=True)
        db = os.path.join(old, "deals.sqlite")
        os.replace(os.path.join(old, "drive-index.sqlite"), db)  # a pre-drive database has the same tables
        con = sqlite3.connect(db)
        con.execute("INSERT INTO projects (id, name, status, updated_at) VALUES ('tg-1', 'His newest deal', 'Underwriting', '2026-11-05')")
        con.execute("INSERT INTO mail_threads (thrid, handled_at) VALUES ('777', '2026-11-04T10:00:00+00:00')")
        con.execute("INSERT INTO meta (key, value) VALUES ('mail_address', 'tautvydas@inrento.com')")
        con.commit()
        con.close()
        before = sha(db)
        env = dict(self.env, HOME=home, DEALDESK_PORT=str(free_port()))
        try:
            subprocess.run(["/bin/mkdir", "-p", os.path.join(home, "Library")], check=True)
            os.symlink(os.path.join(self.home, "Library", "CloudStorage"), os.path.join(home, "Library", "CloudStorage"))
            r = subprocess.run([LAUNCHER], env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            ver = self.current()["version"]
            self.assertTrue(os.path.isfile(os.path.join(old, "app", ver, ".complete")))
            self.assertEqual(sha(db), before, "his deals.sqlite is not touched by the new app")
            self.assertTrue(os.path.exists(os.path.join(old, "backups", "deals_2026-11-03_182651_daily.sqlite")))
            # the command from the switch-over instructions, run in his Terminal
            cmd = ('PY=$(ls -d ~/"Deal Desk"/runtime/*/python/bin/python3 | head -1) && DEALDESK_DATA=~/"Deal Desk" "$PY" '
                   f'~/"Deal Desk"/app/{ver}/server.py --migrate-from ~/"Deal Desk" --replace --with-mail')
            out = subprocess.run(["/bin/bash", "-c", cmd], env=dict(env, DEALDESK_DRIVE=self.drive), capture_output=True, text=True, timeout=60)
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertIn("moved: His newest deal (tg-1)", out.stdout)
            self.assertIn("Gmail cache loaded", out.stdout)
            idx = sqlite3.connect(os.path.join(old, "drive-index.sqlite"))
            self.assertEqual(idx.execute("SELECT handled_at FROM mail_threads WHERE thrid='777'").fetchone()[0], "2026-11-04T10:00:00+00:00")
            idx.close()
            self.assertEqual(sha(db), before, "still untouched after the move")
        finally:
            for pid in subprocess.run(["/usr/sbin/lsof", "-ti", f"tcp:{env['DEALDESK_PORT']}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout.split():
                subprocess.run(["kill", pid])


if __name__ == "__main__":
    unittest.main(verbosity=2)

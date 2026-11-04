#!/usr/bin/env python3
"""Install and update from the shared drive, end to end: release.sh stages and publishes into a temporary shared folder
inside a fake home (at the path Google Drive for Desktop uses), the real launcher (mac/DealDesk) finds it, installs the
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
LAUNCHER = os.path.join(ROOT, "mac", "DealDesk")
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
            self.assertTrue(os.access(exe, os.X_OK), "launcher is executable")
            with open(exe) as fh, open(LAUNCHER) as orig:
                self.assertEqual(fh.read(), orig.read())
            self.assertTrue(os.path.isfile(os.path.join(mnt, "Deal Desk.app", "Contents", "Info.plist")))
            self.assertTrue(os.path.isfile(os.path.join(mnt, "Install – read me.txt")))
            self.assertEqual(os.readlink(os.path.join(mnt, "Applications")), "/Applications")
        finally:
            subprocess.run(["hdiutil", "detach", mnt, "-quiet"], capture_output=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Shared-folder (Google Drive) tests: two servers on one folder, standing in for two Macs.

Each server has its own data folder (its local index) and user; both use the same shared root. Sync runs only when the
test asks for it (POST /api/storage/sync or loading the project list), so every step is deterministic.
Standard library only:  python3 tests/drive_test.py
"""
import glob
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "src", "server.py")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Mac:
    def __init__(self, tmp, name, user, drive, flush="0"):
        self.data = os.path.join(tmp, name)
        os.makedirs(self.data, exist_ok=True)
        self.port = free_port()
        self.log = open(os.path.join(tmp, name + ".log"), "w")
        env = dict(os.environ, DEALDESK_DATA=self.data, DEALDESK_DRIVE=drive, DEALDESK_USER=user, DEALDESK_FAKE_KEYCHAIN="1",
                   DEALDESK_FLUSH_SECONDS=flush, DEALDESK_SYNC_SECONDS="3600")
        self.proc = subprocess.Popen([sys.executable, SERVER, "--port", str(self.port), "--no-browser"], env=env, stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(80):
            try:
                self.call("GET", "/api/ping")
                return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError(f"{name} did not start")

    def call(self, method, path, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())

    def projects(self):
        return {p["id"]: p for p in self.call("GET", "/api/projects")}

    def save(self, pid, p, base=None):
        body = dict(p)
        body.pop("id", None)
        if base is not None:
            body["_base"] = base
        return self.call("PUT", f"/api/projects/{pid}", body)

    def sync(self):
        return self.call("POST", "/api/storage/sync", {})

    def stop(self):
        self.proc.send_signal(signal.SIGTERM)
        self.proc.wait(10)
        self.log.close()


def deal(pid="t1", name="Test Tower, Riga", loan="1000000"):
    return {"name": name, "status": "Underwriting", "inputs": {"currency": "EUR", "loan": loan, "rate": "11", "term": "24", "drawdown": "2026-11-01"},
            "assets": [{"name": "Building", "market": "2000000", "inColl": True}], "todos": [{"text": "Get the appraisal", "done": False}]}


class DriveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dealdesk-drive-")
        cls.drive = os.path.join(cls.tmp, "Shared drives", "Deal desk")
        a_data = os.path.join(cls.tmp, "a")
        out = subprocess.run([sys.executable, SERVER, "--init-drive", cls.drive], env=dict(os.environ, DEALDESK_DATA=a_data, DEALDESK_USER="a@example.com"),
                             capture_output=True, text=True)
        assert out.returncode == 0, out.stderr
        cls.a = Mac(cls.tmp, "a", "a@example.com", cls.drive)
        cls.b = Mac(cls.tmp, "b", "b@example.com", cls.drive)

    @classmethod
    def tearDownClass(cls):
        cls.a.stop()
        cls.b.stop()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def folder(self, pid):
        hits = glob.glob(os.path.join(self.drive, "Deals", f"* ({pid})"))
        self.assertEqual(len(hits), 1, f"one folder for {pid}: {hits}")
        return hits[0]

    def disk(self, pid):
        with open(os.path.join(self.folder(pid), "deal.json"), encoding="utf-8") as fh:
            return json.load(fh)

    def test_01_init_drive(self):
        self.assertTrue(os.path.isfile(os.path.join(self.drive, ".deal-desk")))
        self.assertTrue(os.path.isdir(os.path.join(self.drive, "Inbox", "Imported")))
        with open(os.path.join(self.tmp, "a", "config.json")) as fh:
            self.assertEqual(json.load(fh)["driveRoot"], self.drive)
        info = self.a.call("GET", "/api/info")["storage"]
        self.assertEqual((info["root"], info["user"], info["available"]), (self.drive, "a@example.com", True))
        self.assertFalse(glob.glob(os.path.join(self.drive, "**", "*.sqlite"), recursive=True), "no database on the drive")

    def test_02_save_reaches_the_other_mac(self):
        self.a.save("t1", deal())
        self.a.sync()
        d = self.disk("t1")
        self.assertEqual((d["rev"], d["savedBy"], d["inputs"]["loan"]), (1, "a@example.com", "1000000"))
        self.assertEqual(os.path.basename(self.folder("t1")), "Test Tower, Riga (t1)")
        self.assertTrue(os.path.isfile(os.path.join(self.folder("t1"), "activity", "a@example.com.jsonl")))
        got = self.b.projects()["t1"]
        self.assertEqual(got["inputs"]["loan"], "1000000")
        self.assertEqual(got["todos"][0]["text"], "Get the appraisal")
        # and back: B edits from the copy it loaded, A sees it
        self.b.save("t1", dict(got, inputs=dict(got["inputs"], loan="1200000")), base=got["_base"])
        self.b.sync()
        self.assertEqual((self.disk("t1")["rev"], self.disk("t1")["savedBy"]), (2, "b@example.com"))
        self.assertEqual(self.a.projects()["t1"]["inputs"]["loan"], "1200000")
        acts = self.a.call("GET", "/api/info")  # activity of both users is merged into each index
        self.assertTrue(acts["storage"]["available"])

    def test_03_stale_app_copy_is_not_saved(self):
        self.a.save("t3", deal("t3", "Stale check"))
        self.a.sync()
        a_copy = self.a.projects()["t3"]
        b_copy = self.b.projects()["t3"]
        self.b.save("t3", dict(b_copy, inputs=dict(b_copy["inputs"], rate="12")), base=b_copy["_base"])
        self.b.sync()
        self.a.sync()  # B's change arrives in A's index, but A's open page still holds the old copy
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.a.save("t3", dict(a_copy, notes="typed in the old copy"), base=a_copy["_base"])
        self.assertEqual(e.exception.code, 409)
        self.assertIn("b@example.com", json.loads(e.exception.read())["error"])
        self.assertEqual(self.disk("t3")["inputs"]["rate"], "12", "B's change survives")
        conflict = glob.glob(os.path.join(self.folder("t3"), "deal.conflict-a@example.com-*.json"))
        self.assertEqual(len(conflict), 1)
        with open(conflict[0]) as fh:
            self.assertEqual(json.load(fh)["notes"], "typed in the old copy", "what A typed is kept")
        fresh = self.a.projects()["t3"]  # reloading clears the block
        self.assertEqual(fresh["inputs"]["rate"], "12")
        self.a.save("t3", dict(fresh, notes="after reload"), base=fresh["_base"])
        self.a.sync()
        self.assertEqual(self.disk("t3")["notes"], "after reload")

    def test_04_two_writes_on_the_same_rev(self):
        self.a.save("t4", deal("t4", "Race"))
        self.a.sync()
        b_copy = self.b.projects()["t4"]
        a_copy = self.a.projects()["t4"]
        self.a.save("t4", dict(a_copy, notes="from A"), base=a_copy["_base"])
        self.b.save("t4", dict(b_copy, notes="from B"), base=b_copy["_base"])
        self.a.sync()
        self.b.sync()  # B's write finds rev 2 from A on the drive: set aside, not written over it
        d = self.disk("t4")
        self.assertEqual((d["rev"], d["notes"]), (2, "from A"))
        self.assertEqual(len(glob.glob(os.path.join(self.folder("t4"), "deal.conflict-b@example.com-*.json"))), 1)
        self.assertIn("t4", self.b.call("GET", "/api/info")["storage"]["conflicts"])
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.b.save("t4", dict(b_copy, notes="from B again"), base=b_copy["_base"])
        self.assertEqual(e.exception.code, 409)
        self.assertEqual(self.b.projects()["t4"]["notes"], "from A")

    def test_05_versions(self):
        self.a.save("t5", deal("t5", "Versions"))
        v = self.a.call("POST", "/api/projects/t5/versions", {"label": "Main", "data": {"inputs": {"rate": "11"}}})
        self.assertGreater(v["id"], 10 ** 12, "version ids are unique across Macs")
        self.a.sync()
        self.assertTrue(os.path.isfile(os.path.join(self.folder("t5"), "versions", f"{v['id']}.json")))
        self.b.projects()
        vs = self.b.call("GET", "/api/projects/t5/versions")
        self.assertEqual([(x["id"], x["label"]) for x in vs], [(v["id"], "Main")])
        self.b.call("PUT", f"/api/versions/{v['id']}", {"label": "Renamed"})
        self.b.sync()
        self.a.projects()
        self.assertEqual(self.a.call("GET", "/api/projects/t5/versions")[0]["label"], "Renamed")
        self.a.call("DELETE", f"/api/versions/{v['id']}")
        self.a.sync()
        self.assertFalse(os.listdir(os.path.join(self.folder("t5"), "versions")))
        self.b.projects()
        self.assertEqual(self.b.call("GET", "/api/projects/t5/versions"), [])

    def test_06_delete_moves_the_folder_aside(self):
        self.a.save("t6", deal("t6", "To delete"))
        self.a.sync()
        self.assertIn("t6", self.b.projects())
        self.a.call("DELETE", "/api/projects/t6")
        self.a.sync()
        self.assertFalse(glob.glob(os.path.join(self.drive, "Deals", "* (t6)")))
        self.assertEqual(len(glob.glob(os.path.join(self.drive, "Deals", "_deleted", "To delete (t6) *", "deal.json"))), 1, "nothing is erased")
        self.assertNotIn("t6", self.b.projects())

    def test_07_inbox(self):
        inbox = os.path.join(self.drive, "Inbox")
        with open(os.path.join(inbox, "2026-11-04-inbox-deal.json"), "w") as fh:
            json.dump(dict(deal("t7", "From the inbox"), id="t7", _versions=[{"label": "Borrower request", "data": {}}]), fh)
        self.assertIn("t7", self.a.projects())
        self.assertFalse(os.path.exists(os.path.join(inbox, "2026-11-04-inbox-deal.json")))
        self.assertTrue(os.path.exists(os.path.join(inbox, "Imported", "2026-11-04-inbox-deal.json")))
        self.a.sync()
        self.assertEqual(self.disk("t7")["name"], "From the inbox")
        self.assertIn("t7", self.b.projects())
        self.assertEqual(len(self.b.call("GET", "/api/projects/t7/versions")), 1)

    def test_08_every_test_deal_survives_the_drive(self):
        """The whole project – every input, asset, scenario, line and decision log – comes back identical on the other Mac,
        so the engine sees exactly the same deal."""
        for f in sorted(glob.glob(os.path.join(ROOT, "tests", "deals", "*.json"))):
            pid = "rt-" + os.path.basename(f)[:-5]
            with open(f, encoding="utf-8") as fh:
                self.a.save(pid, json.load(fh))
        self.a.sync()
        a, b = self.a.projects(), self.b.projects()
        n = 0
        for pid in a:
            if pid.startswith("rt-"):
                a[pid].pop("_base")
                b[pid].pop("_base")
                self.assertEqual(a[pid], b[pid], pid)
                n += 1
        self.assertGreaterEqual(n, 15)

    def test_09_drive_missing_keeps_everything(self):
        self.a.save("t9", deal("t9", "Offline"))
        self.a.sync()
        self.assertIn("t9", self.b.projects())
        mark = os.path.join(self.drive, ".deal-desk")
        os.rename(mark, mark + ".away")
        try:
            r = self.b.sync()
            self.assertFalse(r["ok"])
            self.assertIn("not found", r["error"])
            self.assertIn("t9", self.b.projects(), "an unreachable drive does not empty the list")
            self.b.save("t9", dict(self.b.projects()["t9"], notes="offline edit"))
            self.assertEqual(self.b.call("GET", "/api/info")["storage"]["pending"], 1)
        finally:
            os.rename(mark + ".away", mark)
        self.b.sync()
        self.assertEqual(self.disk("t9")["notes"], "offline edit", "kept on the Mac and written when the drive is back")

    def test_10_pending_change_is_written_when_the_app_stops(self):
        c = Mac(self.tmp, "c", "c@example.com", self.drive, flush="3600")
        c.save("t10", deal("t10", "Written on quit"))
        self.assertFalse(glob.glob(os.path.join(self.drive, "Deals", "* (t10)")))
        c.stop()
        self.assertEqual(self.disk("t10")["savedBy"], "c@example.com")

    def test_11_no_shared_folder(self):
        n = Mac(self.tmp, "n", "n@example.com", "")
        try:
            with self.assertRaises(urllib.error.HTTPError) as e:
                n.projects()
            self.assertEqual(e.exception.code, 503)
            self.assertIn("No shared Deal Desk folder", json.loads(e.exception.read())["error"])
            with self.assertRaises(urllib.error.HTTPError) as e:
                n.save("x1", deal("x1", "Nowhere to go"))
            self.assertEqual(e.exception.code, 503)
        finally:
            n.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)

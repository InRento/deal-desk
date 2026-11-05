#!/usr/bin/env python3
"""Shared-folder (Google Drive) tests: two servers on one folder, standing in for two Macs.

Each server has its own data folder (its local index) and user; both use the same temporary shared root. Sync runs only
when the test asks for it (POST /api/storage/sync, loading the project list, taking a lock), so every step is
deterministic. Locks settle in 0.3 s here (6 s in the app, to cover Drive's sync delay).
Standard library only:  python3 tests/drive_test.py
"""
import glob
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
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
    def __init__(self, tmp, name, user, drive, flush="0", every="3600"):
        self.data = os.path.join(tmp, name)
        os.makedirs(self.data, exist_ok=True)
        self.port = free_port()
        self.log = open(os.path.join(tmp, name + ".log"), "a")
        env = dict(os.environ, DEALDESK_DATA=self.data, DEALDESK_DRIVE=drive, DEALDESK_USER=user,
                   DEALDESK_FLUSH_SECONDS=flush, DEALDESK_SYNC_SECONDS=every, DEALDESK_LOCK_SETTLE="0.3", DEALDESK_NO_OPEN="1")
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
        body = {k: v for k, v in p.items() if k not in ("id", "_lock")}  # _base stays, as the app sends it
        if base is not None:
            body["_base"] = base
        return self.call("PUT", f"/api/projects/{pid}", body)

    def lock(self, pid, force=False):
        return self.call("POST", f"/api/projects/{pid}/lock", {"force": force})

    def unlock(self, pid):
        return self.call("DELETE", f"/api/projects/{pid}/lock")

    def sync(self):
        return self.call("POST", "/api/storage/sync", {})

    def upload(self, pid, name, category, data):
        q = urllib.parse.urlencode({"name": name, "category": category})
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/projects/{pid}/documents?{q}", method="POST", data=data)
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())

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
        out = subprocess.run([sys.executable, SERVER, "--init-drive", cls.drive],
                             env=dict(os.environ, DEALDESK_DATA=os.path.join(cls.tmp, "a"), DEALDESK_USER="a@example.com"), capture_output=True, text=True)
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

    def refused(self, fn, code):
        with self.assertRaises(urllib.error.HTTPError) as e:
            fn()
        self.assertEqual(e.exception.code, code)
        return json.loads(e.exception.read())

    def handover(self, pid, frm, to):
        """frm releases the deal, to takes it and gets the latest copy."""
        frm.unlock(pid)
        r = to.lock(pid)
        self.assertTrue(r["ok"])
        return r["project"]

    # ---- storage
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
        self.assertEqual(got["_lock"]["user"], "a@example.com", "the creator holds the lock")
        p = self.handover("t1", self.a, self.b)
        self.b.save("t1", dict(p, inputs=dict(p["inputs"], loan="1200000")), base=p["_base"])
        self.b.sync()
        self.assertEqual((self.disk("t1")["rev"], self.disk("t1")["savedBy"]), (2, "b@example.com"))
        self.assertEqual(self.a.projects()["t1"]["inputs"]["loan"], "1200000")

    def test_03_stale_app_copy_is_not_saved(self):
        self.a.save("t3", deal("t3", "Stale check"))
        self.a.sync()
        a_copy = self.a.projects()["t3"]  # A's page keeps this copy open
        p = self.handover("t3", self.a, self.b)
        self.b.save("t3", dict(p, inputs=dict(p["inputs"], rate="12")), base=p["_base"])
        self.b.unlock("t3")  # writes B's change first
        self.a.lock("t3")    # A takes the deal back, but its page still holds the old copy
        e = self.refused(lambda: self.a.save("t3", dict(a_copy, notes="typed in the old copy"), base=a_copy["_base"]), 409)
        self.assertIn("b@example.com", e["error"])
        self.assertEqual(self.disk("t3")["inputs"]["rate"], "12", "B's change survives")
        conflict = glob.glob(os.path.join(self.folder("t3"), "deal.conflict-a@example.com-*.json"))
        self.assertEqual(len(conflict), 1)
        with open(conflict[0]) as fh:
            self.assertEqual(json.load(fh)["notes"], "typed in the old copy", "what A typed is kept")
        fresh = self.a.projects()["t3"]
        self.a.save("t3", dict(fresh, notes="after reload"), base=fresh["_base"])
        self.a.sync()
        self.assertEqual(self.disk("t3")["notes"], "after reload")

    def test_04_rev_check_backs_up_a_late_takeover(self):
        """B takes the lock over while A's Mac has not noticed yet: A's late save must not overwrite B's."""
        self.a.save("t4", deal("t4", "Race"))
        self.a.sync()
        self.b.projects()
        self.assertTrue(self.b.lock("t4", force=True)["ok"])
        p = self.b.projects()["t4"]
        self.b.save("t4", dict(p, notes="from B"), base=p["_base"])
        self.b.sync()
        a_copy = self.a.call("GET", "/api/projects/t4")  # A's page, still unaware of B
        self.a.save("t4", dict(a_copy, notes="from A"), base=a_copy["_base"])
        self.a.sync()  # A's write finds B's rev on the drive: set aside, then A sees B holds the lock
        d = self.disk("t4")
        self.assertEqual((d["savedBy"], d["notes"]), ("b@example.com", "from B"))
        self.assertEqual(len(glob.glob(os.path.join(self.folder("t4"), "deal.conflict-a@example.com-*.json"))), 1)
        e = self.refused(lambda: self.a.save("t4", dict(a_copy, notes="from A again"), base=a_copy["_base"]), 423)
        self.assertIn("b@example.com is editing", e["error"])

    def test_05_versions(self):
        self.a.save("t5", deal("t5", "Versions"))
        v = self.a.call("POST", "/api/projects/t5/versions", {"label": "Main", "data": {"inputs": {"rate": "11"}}})
        self.assertGreater(v["id"], 10 ** 12, "version ids are unique across Macs")
        self.a.sync()
        self.assertTrue(os.path.isfile(os.path.join(self.folder("t5"), "versions", f"{v['id']}.json")))
        self.b.projects()
        self.assertEqual([(x["id"], x["label"]) for x in self.b.call("GET", "/api/projects/t5/versions")], [(v["id"], "Main")])
        self.refused(lambda: self.b.call("PUT", f"/api/versions/{v['id']}", {"label": "Renamed"}), 423)
        self.handover("t5", self.a, self.b)
        self.b.call("PUT", f"/api/versions/{v['id']}", {"label": "Renamed"})
        self.handover("t5", self.b, self.a)
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
        self.refused(lambda: self.b.call("DELETE", "/api/projects/t6"), 423)
        self.a.call("DELETE", "/api/projects/t6")
        self.a.sync()
        self.assertFalse(glob.glob(os.path.join(self.drive, "Deals", "* (t6)")))
        self.assertEqual(len(glob.glob(os.path.join(self.drive, "Deals", "_deleted", "To delete (t6) *", "deal.json"))), 1, "nothing is erased")
        self.b.projects()  # first pass: could be a rename still syncing
        self.assertNotIn("t6", self.b.projects())

    def test_07_inbox(self):
        inbox = os.path.join(self.drive, "Inbox")
        with open(os.path.join(inbox, "2026-11-04-inbox-deal.json"), "w") as fh:
            json.dump(dict(deal("t7", "From the inbox"), id="t7", _versions=[{"label": "Borrower request", "data": {}}]), fh)
        got = self.a.projects()["t7"]
        self.assertIsNone(got["_lock"], "a deal from the inbox arrives unlocked")
        self.assertFalse(os.path.exists(os.path.join(inbox, "2026-11-04-inbox-deal.json")))
        self.assertTrue(os.path.exists(os.path.join(inbox, "Imported", "2026-11-04-inbox-deal.json")))
        self.a.sync()
        self.assertEqual(self.disk("t7")["name"], "From the inbox")
        self.assertIn("t7", self.b.projects())
        self.assertEqual(len(self.b.call("GET", "/api/projects/t7/versions")), 1)
        # a new version for a deal someone else holds waits in the inbox until the lock is released
        self.assertTrue(self.b.lock("t7")["ok"])
        self.a.sync()
        with open(os.path.join(inbox, "2026-11-04b-t7-version.json"), "w") as fh:
            json.dump({"id": "t7", "inputs": {}, "_appendVersions": True, "_versions": [{"label": "Lower loan", "data": {"inputs": {"loan": "1"}}}]}, fh)
        self.a.projects()
        self.assertTrue(os.path.exists(os.path.join(inbox, "2026-11-04b-t7-version.json")), "waits while B holds the lock")
        self.b.unlock("t7")
        self.a.projects()
        self.assertIn("Lower loan", [v["label"] for v in self.a.call("GET", "/api/projects/t7/versions")])
        self.assertFalse(os.path.exists(os.path.join(inbox, "2026-11-04b-t7-version.json")))

    def test_08_every_test_deal_survives_the_drive(self):
        """The whole project – every input, asset, scenario, line and decision log – comes back identical on the other
        Mac, so the engine sees exactly the same deal."""
        for f in sorted(glob.glob(os.path.join(ROOT, "tests", "deals", "*.json"))):
            with open(f, encoding="utf-8") as fh:
                self.a.save("rt-" + os.path.basename(f)[:-5], json.load(fh))
        self.a.sync()
        a, b = self.a.projects(), self.b.projects()
        n = 0
        for pid in a:
            if pid.startswith("rt-"):
                for x in (a[pid], b[pid]):
                    x.pop("_base")
                    x.pop("_lock")
                self.assertEqual(a[pid], b[pid], pid)
                n += 1
        self.assertGreaterEqual(n, 15)

    def test_09_drive_missing_keeps_everything(self):
        self.a.save("t9", deal("t9", "Offline"))
        self.a.sync()
        self.handover("t9", self.a, self.b)
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
            e = self.refused(n.projects, 503)
            self.assertIn("No shared Deal Desk folder", e["error"])
            self.refused(lambda: n.save("x1", deal("x1", "Nowhere to go")), 503)
        finally:
            n.stop()

    # ---- locks
    def test_12_only_the_holder_edits(self):
        self.a.save("t12", deal("t12", "Lock basics"))
        self.a.sync()
        p = self.b.projects()["t12"]
        self.assertEqual(p["_lock"], dict(p["_lock"], user="a@example.com", me=False))
        e = self.refused(lambda: self.b.save("t12", dict(p, notes="B tries")), 423)
        self.assertIn("a@example.com is editing Lock basics", e["error"])
        e = self.refused(lambda: self.b.lock("t12"), 409)
        self.assertEqual(e["lock"]["user"], "a@example.com")
        # unlocking writes what is pending first, then the deal is read-only for everyone
        self.a.save("t12", dict(self.a.projects()["t12"], notes="last words"))
        self.a.unlock("t12")
        self.assertEqual(self.disk("t12")["notes"], "last words")
        self.assertFalse(os.listdir(os.path.join(self.folder("t12"), "locks")))
        self.refused(lambda: self.a.save("t12", dict(self.a.projects()["t12"], notes="nobody holds it")), 423)
        self.assertIsNone(self.b.projects()["t12"]["_lock"])
        self.assertTrue(self.b.lock("t12")["ok"])
        self.assertTrue(self.a.projects()["t12"]["_lock"]["user"] == "b@example.com")

    def test_13_two_claims_at_once_one_wins(self):
        self.a.save("t13", deal("t13", "Simultaneous"))
        self.a.sync()
        self.a.unlock("t13")
        self.b.projects()
        results = {}

        def claim(mac, key):
            try:
                results[key] = mac.lock("t13")["ok"]
            except urllib.error.HTTPError as e:
                results[key] = False if e.code == 409 else e.code
        ts = [threading.Thread(target=claim, args=(m, k)) for m, k in ((self.a, "a"), (self.b, "b"))]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(sorted(results.values()), [False, True], results)
        files = os.listdir(os.path.join(self.folder("t13"), "locks"))
        winner = "a" if results["a"] else "b"
        self.assertEqual(files, [f"{winner}@example.com.json"], "the loser removed its claim")
        loser = self.b if winner == "a" else self.a
        self.assertEqual(loser.projects()["t13"]["_lock"]["user"], f"{winner}@example.com")

    def test_14_force_unlock_keeps_the_holders_typing(self):
        self.a.save("t14", deal("t14", "Holiday"))
        self.a.sync()
        self.b.projects()
        r = self.b.lock("t14", force=True)
        self.assertTrue(r["ok"])
        self.a.sync()  # A's Mac notices
        a_copy = self.a.call("GET", "/api/projects/t14")
        self.assertEqual(a_copy["_lock"]["user"], "b@example.com")
        e = self.refused(lambda: self.a.save("t14", dict(a_copy, notes="typed after the takeover")), 423)
        self.assertIn("is kept in deal.unsaved-a@example.com-", e["error"])
        kept = glob.glob(os.path.join(self.folder("t14"), "deal.unsaved-a@example.com-*.json"))
        with open(kept[0]) as fh:
            self.assertEqual(json.load(fh)["notes"], "typed after the takeover")
        self.b.sync()
        with open(os.path.join(self.folder("t14"), "activity", "b@example.com.jsonl")) as fh:
            self.assertIn("took over the lock from a@example.com", fh.read())

    def test_15_lock_survives_a_restart(self):
        c = Mac(self.tmp, "c2", "c@example.com", self.drive)
        c.save("t15", deal("t15", "Kept over restart"))
        c.sync()
        c.stop()
        c = Mac(self.tmp, "c2", "c@example.com", self.drive)
        try:
            p = c.projects()["t15"]
            self.assertTrue(p["_lock"]["me"])
            c.save("t15", dict(p, notes="after restart"))
        finally:
            c.stop()
        self.assertEqual(self.disk("t15")["notes"], "after restart")
        self.assertEqual(self.b.projects()["t15"]["_lock"]["user"], "c@example.com")

    def test_16_stalled_claim_is_ignored(self):
        """A claim left by an app that stopped mid-claim (never confirmed, over a minute old) does not block anyone."""
        self.a.save("t16", deal("t16", "Stalled"))
        self.a.sync()
        self.a.unlock("t16")
        locks = os.path.join(self.folder("t16"), "locks")
        with open(os.path.join(locks, "ghost@example.com.json"), "w") as fh:
            json.dump({"user": "ghost@example.com", "claimedAt": "2026-11-01T08:00:00.000+00:00", "confirmed": False}, fh)
        self.b.projects()
        self.assertIsNone(self.b.projects()["t16"]["_lock"])
        self.assertTrue(self.b.lock("t16")["ok"])

    # ---- switch-over day
    def test_17_migrate_replace(self):
        src = os.path.join(self.tmp, "pre-drive")
        os.makedirs(os.path.join(src, "documents", "m1"))
        con = sqlite3.connect(os.path.join(src, "deals.sqlite"))
        con.executescript("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT, updated_at TEXT);"
                          "INSERT INTO projects VALUES ('m1', 'Old deal', 'Underwriting', '2026-11-01');")
        con.commit()
        env = dict(os.environ, DEALDESK_DATA=os.path.join(self.tmp, "mig"), DEALDESK_DRIVE=self.drive, DEALDESK_USER="m@example.com")
        run = lambda *a: subprocess.run([sys.executable, SERVER, "--migrate-from", src, *a], env=env, capture_output=True, text=True, check=True).stdout
        self.assertIn("moved: Old deal (m1)", run())
        self.assertIn("already on the drive", run())
        self.assertEqual(self.disk("m1")["rev"], 1)
        con.execute("UPDATE projects SET status='Turned in'")
        con.commit()
        con.close()
        self.assertIn("would replace: Old deal (m1)", run("--replace", "--dry-run"))
        self.assertIn("replaced: Old deal (m1)", run("--replace"))
        self.assertEqual((self.disk("m1")["rev"], self.disk("m1")["status"]), (2, "Turned in"), "a higher rev, so every Mac reloads it")
        self.assertEqual(len(glob.glob(os.path.join(self.folder("m1"), "deal.before-replace-*.json"))), 1, "the drive's copy is kept")
        self.assertEqual(self.b.projects()["m1"]["status"], "Turned in")
        self.assertTrue(self.b.lock("m1")["ok"])
        self.assertIn("SKIPPED Old deal (m1): b@example.com holds the lock", run("--replace"))

    def test_18_background_sync(self):
        """Nobody asks for a sync here: the server's own loop writes saves and picks up other Macs' changes and locks."""
        x = Mac(self.tmp, "x", "x@example.com", self.drive, every="0.3")
        y = Mac(self.tmp, "y", "y@example.com", self.drive, every="0.3")
        try:
            x.save("t18", deal("t18", "Background"))
            for _ in range(40):
                if y.call("GET", "/api/locks")["locks"].get("t18"):
                    break
                time.sleep(0.1)
            self.assertEqual(y.call("GET", "/api/locks")["locks"]["t18"]["user"], "x@example.com")
            self.assertEqual(self.disk("t18")["name"], "Background")
        finally:
            x.stop()
            y.stop()

    # ---- documents
    def test_19_documents(self):
        self.a.save("t19", deal("t19", "With documents"))
        self.a.sync()
        self.assertEqual(self.a.call("GET", "/api/projects/t19/documents")["documents"], [])
        r = self.a.upload("t19", "Appraisal Ober-Haus.pdf", "Appraisal", b"%PDF-1.4 appraisal")
        self.assertEqual(r["path"], os.path.join("Appraisal", "Appraisal Ober-Haus.pdf"))
        self.assertEqual(self.a.upload("t19", "Appraisal Ober-Haus.pdf", "Appraisal", b"second")["path"],
                         os.path.join("Appraisal", "Appraisal Ober-Haus (2).pdf"), "a second file with the same name is kept, not overwritten")
        with open(os.path.join(self.folder("t19"), "Documents", "Appraisal", "Appraisal Ober-Haus.pdf"), "rb") as fh:
            self.assertEqual(fh.read(), b"%PDF-1.4 appraisal")
        # B sees them, and may add one although A holds the deal (files never touch deal.json)
        self.b.projects()
        self.b.upload("t19", "Balance sheet 2025.xlsx", "Teaser / business plan", b"xlsx")
        os.makedirs(os.path.join(self.folder("t19"), "Documents", "Legal"))
        with open(os.path.join(self.folder("t19"), "Documents", "Legal", "Mortgage draft.docx"), "w") as fh:
            fh.write("added in Finder")
        with open(os.path.join(self.folder("t19"), "Documents", "Legal", "~$rtgage draft.docx"), "w") as fh:
            fh.write("Word lock file")
        docs = self.a.call("GET", "/api/projects/t19/documents")["documents"]
        self.assertEqual([(d["category"], d["name"]) for d in docs],
                         [("Appraisal", "Appraisal Ober-Haus (2).pdf"), ("Appraisal", "Appraisal Ober-Haus.pdf"), ("Legal", "Mortgage draft.docx"),
                          ("Teaser, business plan", "Balance sheet 2025.xlsx")])
        self.assertEqual(self.disk("t19")["rev"], 1, "documents do not change the deal")
        r = self.b.call("POST", "/api/projects/t19/documents/open", {"path": os.path.join("Legal", "Mortgage draft.docx"), "reveal": True})
        self.assertEqual((r["ok"], r["reveal"]), (True, True))
        self.refused(lambda: self.b.call("POST", "/api/projects/t19/documents/open", {"path": "../deal.json"}), 404)
        self.refused(lambda: self.b.call("POST", "/api/projects/t19/documents/open", {"path": "/etc/hosts"}), 404)
        self.assertTrue(self.a.call("POST", "/api/projects/t19/documents/open", {"path": ""})["opened"].endswith("Documents"), "the folder itself")

    def test_20_documents_from_the_inbox(self):
        inbox = os.path.join(self.drive, "Inbox")
        os.makedirs(os.path.join(inbox, "2026-11-05-t20-riga", "Financial statements"))
        for rel, text in (("appraisal_LT.pdf", "a"), (os.path.join("Financial statements", "FS 2025.xlsx"), "b"), ("photo.jpg", "c")):
            with open(os.path.join(inbox, "2026-11-05-t20-riga", rel), "w") as fh:
                fh.write(text)
        with open(os.path.join(inbox, "2026-11-05-t20-riga.json"), "w") as fh:
            json.dump(dict(deal("t20", "Riga with documents"), id="t20", _documents=[{"file": "appraisal_LT.pdf", "kind": "Appraisal"}]), fh)
        self.a.projects()
        docs = self.a.call("GET", "/api/projects/t20/documents")["documents"]
        self.assertEqual(sorted((d["category"], d["name"]) for d in docs),
                         [("Appraisal", "appraisal_LT.pdf"), ("Financial statements", "FS 2025.xlsx"), ("Other", "photo.jpg")])
        self.assertFalse(os.path.exists(os.path.join(inbox, "2026-11-05-t20-riga")), "the draft's folder is emptied and removed")
        self.a.sync()
        self.assertEqual(self.disk("t20")["name"], "Riga with documents", "the deal is written into the folder its documents started")
        self.assertEqual(len(glob.glob(os.path.join(self.drive, "Deals", "* (t20)"))), 1)

    def test_21_folder_follows_the_deal_name(self):
        self.a.save("t21", deal("t21", "Untitled project"))
        self.a.upload("t21", "teaser.pdf", "Teaser, business plan", b"pdf")
        self.a.sync()
        self.assertEqual(os.path.basename(self.folder("t21")), "Untitled project (t21)")
        self.assertEqual(self.b.projects()["t21"]["name"], "Untitled project")
        p = self.a.projects()["t21"]
        self.a.save("t21", dict(p, name="Vilnius, Ozo 12"))
        self.a.sync()
        self.assertEqual(os.path.basename(self.folder("t21")), "Vilnius, Ozo 12 (t21)")
        self.assertTrue(os.path.isfile(os.path.join(self.folder("t21"), "Documents", "Teaser, business plan", "teaser.pdf")), "documents move with it")
        self.assertTrue(os.path.isfile(os.path.join(self.folder("t21"), "locks", "a@example.com.json")), "and the lock")
        got = self.b.projects()
        self.assertEqual(got["t21"]["name"], "Vilnius, Ozo 12", "the other Mac follows the rename without losing the deal")
        self.assertEqual(got["t21"]["_lock"]["user"], "a@example.com")
        self.assertEqual(len(self.b.call("GET", "/api/projects/t21/documents")["documents"]), 1)

    def test_22_a_deal_gone_for_one_pass_is_kept(self):
        self.a.save("t22", deal("t22", "Flicker"))
        self.a.sync()
        self.assertIn("t22", self.b.projects())
        f = self.folder("t22")
        os.rename(f, f + " moving")  # what another Mac sees mid-sync: the folder briefly not where it was
        try:
            self.assertIn("t22", self.b.projects(), "one miss is not a delete")
        finally:
            os.rename(f + " moving", f)
        self.assertIn("t22", self.b.projects())


if __name__ == "__main__":
    unittest.main(verbosity=2)

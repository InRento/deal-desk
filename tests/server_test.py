#!/usr/bin/env python3
"""Server tests: storage, versions, inbox, backups and the same-origin guard.

Runs the real server.py on a temporary data folder and a temporary shared folder.
Standard library only:  python3 tests/server_test.py
"""
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
SERVER = os.path.join(ROOT, "src", "server.py")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dealdesk-test-")
        cls.data = os.path.join(cls.tmp, "data")
        cls.drive = os.path.join(cls.tmp, "drive")  # always a temporary shared folder: never the real one on this Mac
        os.makedirs(os.path.join(cls.drive, "Inbox"))
        with open(os.path.join(cls.drive, ".deal-desk"), "w") as fh:
            fh.write("{}")
        cls.port = free_port()
        env = dict(os.environ, DEALDESK_DATA=cls.data, DEALDESK_DRIVE=cls.drive, DEALDESK_USER="me@example.com", DEALDESK_FLUSH_SECONDS="0")
        cls.log = open(os.path.join(cls.tmp, "server.log"), "w")
        cls.srv = subprocess.Popen([sys.executable, SERVER, "--port", str(cls.port), "--no-browser"], env=env, stdout=cls.log, stderr=subprocess.STDOUT)
        for _ in range(50):
            try:
                cls.call("GET", "/api/ping")
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.srv.terminate()
        cls.srv.wait(5)
        cls.log.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def call(cls, method, path, body=None, headers=None):
        req = urllib.request.Request(f"http://127.0.0.1:{cls.port}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers=dict({"Content-Type": "application/json"}, **(headers or {})))
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())

    def project(self, pid="t1", name="Test Tower, Riga", **extra):
        p = {"name": name, "status": "Underwriting", "borrower": "UAB Example", "country": "LV",
             "inputs": {"currency": "EUR", "loan": "1000000", "rate": "11", "term": "24", "drawdown": "2026-11-01"},
             "assets": [{"name": "Building", "market": "2000000", "inColl": True}], "todos": [{"text": "Get the appraisal", "done": False}]}
        p.update(extra)
        self.call("PUT", f"/api/projects/{pid}", p)
        return p

    # ---- storage
    def test_01_ping_and_save(self):
        self.assertTrue(self.call("GET", "/api/ping")["ok"])
        self.project()
        got = {p["id"]: p for p in self.call("GET", "/api/projects")}["t1"]
        self.assertEqual(got["name"], "Test Tower, Riga")
        self.assertEqual(got["inputs"]["rate"], "11")
        self.assertEqual(got["assets"][0]["market"], "2000000")
        self.assertEqual(got["todos"][0]["text"], "Get the appraisal")

    def test_01b_several_loans_are_stored(self):  # v3.17: loans, tranche loan / trigger, asset secures survive a save
        self.project(pid="t9", inputs={"currency": "EUR", "tranchesOn": True, "loansOn": True, "drawdown": "2026-11-01"},
                     loans=[{"name": "Loan 1", "fee": "8", "reserveMonths": "3"}, {"name": "Loan 2", "fee": "7", "rate": "13"}],
                     tranches=[{"date": "2026-11-01", "amount": "5000000", "loan": "1"}, {"amount": "500000", "loan": "2", "trigger": "balance", "trigAmount": "2700000"}],
                     assets=[{"name": "Flat", "market": "900000", "inColl": True, "secures": "1", "repays": "2,1"}])
        got = {p["id"]: p for p in self.call("GET", "/api/projects")}["t9"]
        self.assertTrue(got["inputs"]["loansOn"])
        self.assertEqual([(l["name"], str(l["fee"])) for l in got["loans"]], [("Loan 1", "8"), ("Loan 2", "7")])
        self.assertEqual(str(got["loans"][1]["rate"]), "13")
        self.assertEqual((got["tranches"][1]["loan"], got["tranches"][1]["trigger"], str(got["tranches"][1]["trigAmount"])), ("2", "balance", "2700000"))
        self.assertEqual((got["assets"][0]["secures"], got["assets"][0]["repays"]), ("1", "2,1"))

    def test_02_old_status_is_mapped_to_a_stage(self):
        self.project("t2", "Old deal", status="Credit committee")
        got = {p["id"]: p for p in self.call("GET", "/api/projects")}["t2"]
        self.assertEqual(got["status"], "Turned in")

    def test_03_versions(self):
        self.project()
        v = self.call("POST", "/api/projects/t1/versions", {"label": "Main", "data": {"inputs": {"rate": "11"}}})
        self.call("PUT", f"/api/versions/{v['id']}", {"label": "Renamed", "data": {"inputs": {"rate": "12"}}})
        vs = self.call("GET", "/api/projects/t1/versions")
        self.assertEqual(vs[0]["label"], "Renamed")
        self.assertEqual(vs[0]["data"]["inputs"]["rate"], "12")
        self.call("DELETE", f"/api/versions/{v['id']}")
        self.assertEqual(self.call("GET", "/api/projects/t1/versions"), [])

    def test_04_import_folder(self):
        imp = os.path.join(self.drive, "Inbox")
        def put(name, obj):
            with open(os.path.join(imp, name), "w") as fh:
                json.dump(obj, fh)
        put("a.json", {"id": "t3", "name": "Imported deal", "inputs": {"loan": "500000"}, "_documents": [{"file": "missing.pdf"}],
                   "_versions": [{"label": "Borrower request", "data": {"inputs": {"loan": "600000"}}}]})
        ids = {p["id"]: p for p in self.call("GET", "/api/projects")}
        self.assertIn("t3", ids)
        self.assertEqual(len(self.call("GET", "/api/projects/t3/versions")), 1)
        # a later file for an existing id is skipped (email material is no longer imported): the deal stays as it was
        put("b.json", {"id": "t3", "inputs": {"loan": "1"}, "_appendEmails": True, "_todos": [{"text": "Chase appraisal"}]})
        got = {p["id"]: p for p in self.call("GET", "/api/projects")}["t3"]
        self.assertEqual(got["inputs"]["loan"], "500000")
        self.assertEqual(got["todos"], [])

    def test_05_backup_and_delete(self):
        self.project("t4", "To delete")
        self.assertTrue(self.call("POST", "/api/backup", {})["file"].endswith(".sqlite"))
        # the old app's backups (deals_…) live in the same folder: daily pruning must never touch them
        old = [os.path.join(self.data, "backups", f"deals_2026-10-{d:02d}_090000_daily.sqlite") for d in range(1, 32)]
        for f in old:
            open(f, "w").close()
        subprocess.run([sys.executable, "-c", f"import sys; sys.path.insert(0, {os.path.dirname(SERVER)!r}); import server; server.daily_backup()"],
                       env=dict(os.environ, DEALDESK_DATA=self.data, DEALDESK_DRIVE=self.drive), check=True)
        self.assertTrue(all(os.path.exists(f) for f in old), "pre-drive backups are kept")
        self.call("DELETE", "/api/projects/t4")
        self.assertNotIn("t4", [p["id"] for p in self.call("GET", "/api/projects")])

    def test_06_other_websites_are_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.call("GET", "/api/projects", headers={"Origin": "https://evil.example"})
        self.assertEqual(e.exception.code, 403)

    def test_07_no_email_routes(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.call("GET", "/api/mail/settings")
        self.assertEqual(e.exception.code, 404)

if __name__ == "__main__":
    unittest.main(verbosity=2)

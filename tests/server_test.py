#!/usr/bin/env python3
"""Server tests: storage, versions, import folder, backups, same-origin guard and the read-only Gmail sync.

Runs the real server.py on a temporary data folder against a small fake Gmail (tests/fake_imap.py).
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
import email.utils
import datetime as dt
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "src", "server.py")
FAKE = os.path.join(ROOT, "tests", "fake_imap.py")
PASSWORD = "abcdefghijklmnop"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def ago(days, hour=8):
    # the server marks threads quiet for over 14 days as handled on first sync, so dates must follow the clock
    return email.utils.format_datetime(dt.datetime.now(dt.timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0) - dt.timedelta(days=days))


def raw(subject, frm, to, date, body):
    return f"From: {frm}\nTo: {to}\nSubject: {subject}\nDate: {date}\nMessage-ID: <{abs(hash(subject + date))}@x>\nContent-Type: text/plain; charset=\"utf-8\"\n\n{body}\n"


# Fictional mailbox: one deal label with two threads (one answered by me, one waiting for my reply) and an unrelated label.
FIXTURE = {
    "password": PASSWORD,
    "uidvalidity": 7,
    "mailboxes": ["INBOX", "[Gmail]", "[Gmail]/All Mail", "[Gmail]/Sent Mail", "New deals/Test Tower, Riga", "Personal"],
    "messages": [
        {"msgid": 1001, "thrid": 9001, "labels": ["New deals/Test Tower, Riga"],
         "raw": raw("Updated price list", "Broker <broker@example.com>", "me@example.com", ago(2), "Please confirm the term sheet by Friday.")},
        {"msgid": 1002, "thrid": 9002, "labels": ["New deals/Test Tower, Riga"],
         "raw": raw("Appraisal", "Owner <owner@example.com>", "me@example.com", ago(5), "The valuer sends the appraisal next week.")},
        {"msgid": 1003, "thrid": 9002, "labels": [],
         "raw": raw("Re: Appraisal", "Me <me@example.com>", "owner@example.com", ago(1), "Thanks, please send it when you have it.")},
        {"msgid": 1004, "thrid": 9003, "labels": ["Personal"],
         "raw": raw("Dinner", "Friend <friend@example.com>", "me@example.com", ago(1, 9), "Not deal related.")},
    ],
}


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dealdesk-test-")
        cls.data = os.path.join(cls.tmp, "data")
        os.makedirs(os.path.join(cls.data, "import"))
        fx = os.path.join(cls.tmp, "fixture.json")
        with open(fx, "w") as fh:
            json.dump(FIXTURE, fh)
        cls.imap_log = os.path.join(cls.tmp, "imap.log")
        cls.imap_port, cls.port = free_port(), free_port()
        cls.imap = subprocess.Popen([sys.executable, FAKE, str(cls.imap_port), fx, cls.imap_log], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        env = dict(os.environ, DEALDESK_DATA=cls.data, DEALDESK_FAKE_KEYCHAIN="1", DEALDESK_IMAP_HOST="127.0.0.1",
                   DEALDESK_IMAP_PORT=str(cls.imap_port), DEALDESK_IMAP_PLAIN="1")
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
        cls.imap.terminate()
        cls.srv.wait(5)
        cls.imap.wait(5)
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
        imp = os.path.join(self.data, "import")
        def put(name, obj):
            with open(os.path.join(imp, name), "w") as fh:
                json.dump(obj, fh)
        put("a.json", {"id": "t3", "name": "Imported deal", "inputs": {"loan": "500000"}, "_documents": [{"file": "missing.pdf"}],
                   "_versions": [{"label": "Borrower request", "data": {"inputs": {"loan": "600000"}}}]})
        ids = {p["id"]: p for p in self.call("GET", "/api/projects")}
        self.assertIn("t3", ids)
        self.assertEqual(len(self.call("GET", "/api/projects/t3/versions")), 1)
        self.assertFalse(os.path.exists(os.path.join(self.data, "documents", "t3")), "attached files are no longer stored")
        # the same file is not imported twice; a later file can append emails without touching the inputs
        put("b.json", {"id": "t3", "inputs": {"loan": "1"}, "_appendEmails": True, "_emailSummary": {"text": "Owner sends the appraisal.", "date": "2026-10-20"},
                   "_todos": [{"text": "Chase appraisal"}, {"text": "chase appraisal"}]})
        got = {p["id"]: p for p in self.call("GET", "/api/projects")}["t3"]
        self.assertEqual(got["inputs"]["loan"], "500000")
        self.assertEqual([t["text"] for t in got["todos"]], ["Chase appraisal"])
        self.assertEqual(self.call("GET", "/api/mail/project/t3")["summary"]["text"], "Owner sends the appraisal.")

    def test_05_backup_and_delete(self):
        self.project("t4", "To delete")
        self.assertTrue(self.call("POST", "/api/backup", {})["file"].endswith(".sqlite"))
        self.call("DELETE", "/api/projects/t4")
        self.assertNotIn("t4", [p["id"] for p in self.call("GET", "/api/projects")])

    def test_06_other_websites_are_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            self.call("GET", "/api/projects", headers={"Origin": "https://evil.example"})
        self.assertEqual(e.exception.code, 403)

    # ---- Gmail, read-only
    def test_07_gmail_sync(self):
        self.project()
        r = self.call("PUT", "/api/mail/settings", {"address": "me@example.com", "password": PASSWORD})
        self.assertTrue(r["ok"] and r["hasPassword"])
        self.assertTrue(self.call("POST", "/api/mail/test", {})["ok"])
        r = self.call("POST", "/api/mail/refresh", {})
        self.assertTrue(r["ok"], r)
        labels = self.call("GET", "/api/mail/labels")
        self.assertIn("New deals/Test Tower, Riga", labels["labels"])
        self.assertEqual(labels["links"].get("t1"), "New deals/Test Tower, Riga", "label matched to the project by name")
        d = self.call("GET", "/api/mail/project/t1")
        threads = {t["thrid"]: t for t in d["threads"]}
        self.assertEqual(set(threads), {"9001", "9002"}, "personal mail is not pulled in")
        self.assertEqual(threads["9002"]["status"], "waiting", "my reply from All Mail counts")
        t = self.call("GET", "/api/mail/thread/9002")
        self.assertEqual(len(t["messages"]), 2)
        self.call("POST", "/api/mail/thread/9001", {"action": "handled"})
        self.assertEqual({t["thrid"]: t for t in self.call("GET", "/api/mail/project/t1")["threads"]}["9001"]["status"], "handled")
        self.assertEqual(self.call("GET", "/api/mail/find?pid=t1&q=" + urllib.request.quote("term sheet"))["thrid"], "9001")
        # nothing may change the mailbox: EXAMINE only, BODY.PEEK only, no STORE / COPY / EXPUNGE
        with open(self.imap_log) as fh:
            log = fh.read().upper()
        for bad in (" SELECT ", " STORE ", " COPY ", " EXPUNGE", " MOVE "):
            self.assertNotIn(bad, log)
        self.assertNotIn("BODY[", log.replace("BODY.PEEK[", ""))
        self.assertIn(" EXAMINE ", log)

    def test_08_password_never_written_to_disk(self):
        self.call("PUT", "/api/mail/settings", {"address": "me@example.com", "password": PASSWORD})
        for root, _, files in os.walk(self.data):
            for f in files:
                with open(os.path.join(root, f), "rb") as fh:
                    self.assertNotIn(PASSWORD.encode(), fh.read(), f)


if __name__ == "__main__":
    unittest.main(verbosity=2)

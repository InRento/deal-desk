#!/usr/bin/env python3
"""InRento Deal Desk – local server.

Serves the app at http://127.0.0.1:8765. Deals live in the shared Deal Desk folder on Google Drive (a Shared Drive
synced by Google Drive for Desktop); the SQLite database next to the data folder is only this Mac's index of it plus
its Gmail cache. Standard library only: no pip installs needed.

    python3 server.py              start the app and open the browser
    python3 server.py --no-browser start without opening a browser
    python3 server.py --import x.json   import projects from a JSON export, then exit
    python3 server.py --port 9000  use another port
    python3 server.py --init-drive FOLDER   set up the shared folder (once per team)
    python3 server.py --migrate-from "~/Deal Desk"   move a pre-drive deals.sqlite with its documents to the shared folder
"""
import argparse
import datetime as dt
import getpass
import json
import mimetypes
import os
import random
import re
import signal
import sqlite3
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote

HERE = os.path.dirname(os.path.abspath(__file__))           # program files (index.html, xlsx)
DATA = os.environ.get("DEALDESK_DATA") or HERE               # database, documents, backups
BACKUP_DIR = os.path.join(DATA, "backups")
STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/index.html": ("index.html", "text/html; charset=utf-8"),
          "/xlsx.full.min.js": ("xlsx.full.min.js", "application/javascript"),
          "/jspdf.umd.min.js": ("jspdf.umd.min.js", "application/javascript"),
          "/html2canvas.min.js": ("html2canvas.min.js", "application/javascript")}
SCHEMA_VERSION = 2


def find_drive():
    """The shared folder when none is configured: the one Google Shared Drive folder holding the Deal Desk marker."""
    import glob
    hits = glob.glob(os.path.expanduser("~/Library/CloudStorage/GoogleDrive-*/Shared drives/*/.deal-desk"))
    return os.path.dirname(hits[0]) if len(hits) == 1 else ""


def load_config():
    """Shared folder (Google Drive) settings: env vars win over <data>/config.json, which wins over finding it."""
    cfg = {}
    try:
        with open(os.path.join(DATA, "config.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
    except (OSError, ValueError):
        pass
    root = os.environ["DEALDESK_DRIVE"] if "DEALDESK_DRIVE" in os.environ else (cfg.get("driveRoot") or find_drive())
    m = re.search(r"GoogleDrive-([^/]+@[^/]+)", root)
    user = os.environ.get("DEALDESK_USER") or cfg.get("user") or (m.group(1) if m else getpass.getuser())
    return {"driveRoot": root, "user": user}


CONFIG = load_config()
DRIVE = CONFIG["driveRoot"]
ME = CONFIG["user"]
# Only an index of the drive. A pre-drive deals.sqlite in the same folder is left untouched (source for --migrate-from).
DB_PATH = os.path.join(DATA, "drive-index.sqlite")
NO_DRIVE = ("No shared Deal Desk folder found. Open Google Drive for Desktop, check that the \u201cDeal desk\u201d shared drive "
            "shows in Finder, then reopen Deal Desk.")
APP_VERSION = "3.19.1"  # bump when the program changes; the launcher restarts an older running server

# ---------------------------------------------------------------------------
# Schema. Input columns keep exactly what was typed. NUMERIC columns store plain
# numbers as numbers (queryable) and expressions such as "17000/12" as text.
# *_pct columns are in percent units (8.5 = 8.5 %). JSON columns hold small arrays.
# ---------------------------------------------------------------------------
PROJECT_FIELDS = [
    ("name", "name", "TEXT NOT NULL"), ("status", "status", "TEXT"), ("borrower", "borrower", "TEXT"),
    ("country", "country", "TEXT"), ("projectType", "project_type", "TEXT"), ("contact", "contact", "TEXT"),
    ("notes", "notes", "TEXT"), ("createdAt", "created_at", "TEXT"), ("updatedAt", "updated_at", "TEXT"),
    ("nextAction", "next_action", "TEXT"), ("nextOwner", "next_action_owner", "TEXT"), ("nextDue", "next_action_due", "TEXT"),
    ("judgement", "judgement_json", "JSON"),  # decision log: pre-mortem, snapshot at the decision, post-mortem (v3.14)
]
# Pipeline stages (v3.5). Older statuses are mapped once on start and whenever a project is saved or imported.
STAGES = ["New deal", "Initial analysis", "Underwriting", "Turned in", "Rejected", "Funded", "Realised"]
STAGE_MAP = {"Lead": "New deal", "Underwriting": "Underwriting", "Credit committee": "Turned in", "Approved": "Turned in",
             "Funded": "Funded", "Repaid": "Realised", "Declined": "Rejected", "On hold": "Initial analysis"}


def map_stage(s):
    s = (s or "").strip()
    return s if s in STAGES else STAGE_MAP.get(s, "New deal")
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
INPUT_FIELDS = [
    ("currency", "currency", "TEXT"), ("drawdown", "drawdown_date", "TEXT"), ("horizon", "horizon_months", "NUMERIC"),
    ("openingCash", "opening_cash", "NUMERIC"),
    ("opModel", "operating_model", "TEXT"),
    ("revenueSource", "revenue_source", "TEXT"), ("revenue", "revenue_per_month", "NUMERIC"), ("revGrowth", "revenue_growth_pct", "NUMERIC"),
    ("opex", "opex_per_month", "NUMERIC"), ("opexGrowth", "opex_growth_pct", "NUMERIC"), ("cfStart", "cash_flow_start_date", "TEXT"),
    ("tax", "tax_rate_pct", "NUMERIC"), ("otherDebt", "other_debt_service_per_month", "NUMERIC"), ("otherDebtEnd", "other_debt_end_date", "TEXT"),
    ("vat", "vat_in_prices_pct", "NUMERIC"), ("commission", "channel_commission_pct", "NUMERIC"), ("cardFee", "card_fee_pct", "NUMERIC"),
    ("ancillary", "ancillary_revenue_pct", "NUMERIC"),
    ("loan", "loan_amount", "NUMERIC"), ("tranchesOn", "drawn_in_tranches", "INTEGER"), ("rate", "interest_rate_pct", "NUMERIC"),
    ("term", "term_months", "NUMERIC"),
    ("repayType", "repayment_type", "TEXT"), ("grace", "grace_months", "NUMERIC"), ("capitalise", "capitalise_interest", "TEXT"),
    ("payMonths", "interest_payment_months", "JSON"),
    ("extOn", "extension_used", "INTEGER"), ("extMonths", "extension_months", "NUMERIC"), ("extFee", "extension_fee_pct", "NUMERIC"),
    ("extRate", "extension_rate_pct", "NUMERIC"), ("defaultRate", "default_rate_pct", "NUMERIC"),
    ("sweepDefault", "default_sweep_pct", "NUMERIC"), ("sweepBasis", "sweep_basis", "TEXT"), ("sweepApplies", "sweep_applies_to", "TEXT"),
    ("saleRepay", "sale_repayment_rule", "TEXT"), ("releasePct", "release_price_pct", "NUMERIC"),
    ("opSweepPct", "cash_sweep_pct", "NUMERIC"), ("opSweepMin", "cash_sweep_min_balance", "NUMERIC"), ("opSweepMonths", "cash_sweep_months", "JSON"),
    ("arrFee", "arrangement_fee_pct", "NUMERIC"), ("feeBasis", "fee_basis", "TEXT"), ("feeTreatment", "fee_treatment", "TEXT"),
    ("commitFee", "commitment_fee_pct", "NUMERIC"), ("reserveMonths", "interest_reserve_months", "NUMERIC"),
    ("prepayFee", "prepayment_fee_pct", "NUMERIC"), ("exitFee", "exit_fee_pct", "NUMERIC"),
    ("fixedGain", "fixed_capital_gain_pct", "NUMERIC"), ("profitShare", "profit_share_pct", "NUMERIC"),
    ("deduction", "profit_deduction_pct", "NUMERIC"), ("acctFee", "accounting_fee_ratio_pct", "NUMERIC"),
    ("refinanced", "debt_refinanced", "NUMERIC"), ("purchaseSource", "purchase_source", "TEXT"), ("purchase", "purchase_price", "NUMERIC"),
    ("closingCosts", "closing_costs", "NUMERIC"), ("otherUses", "other_uses", "NUMERIC"), ("equityAuto", "equity_auto", "INTEGER"),
    ("equity", "borrower_equity", "NUMERIC"), ("projectCost", "project_cost_for_ltc", "NUMERIC"),
    ("haircut", "forced_sale_haircut_pct", "NUMERIC"), ("sellCost", "selling_costs_pct", "NUMERIC"),
    ("maxLTV", "max_ltv_pct", "NUMERIC"), ("minDSCR", "min_dscr", "NUMERIC"), ("targetCover", "target_collateral_cover", "NUMERIC"),
    ("dscrBasis", "dscr_basis", "TEXT"), ("exitCap", "exit_cap_rate_pct", "NUMERIC"), ("refiLTV", "refinance_bank_ltv_pct", "NUMERIC"),
    ("dealType", "deal_type", "TEXT"), ("showAll", "show_all_inputs", "INTEGER"), ("intTiming", "interest_timing", "TEXT"),
    ("saleOrder", "sale_proceeds_order", "TEXT"), ("ignoredChecks", "ignored_checks", "JSON"),
    ("fxRate", "fx_rate_per_eur", "NUMERIC"), ("fxDate", "fx_rate_date", "TEXT"), ("sources", "field_sources", "JSON"), ("activeVersion", "active_version_id", "TEXT"),
    ("gmailLabel", "gmail_label", "TEXT"), ("benefits", "deck_benefits", "TEXT"), ("risks", "deck_risks", "TEXT"), ("deckDesc", "deck_description", "TEXT"),
    # construction / renovation (v3.13)
    ("constrOn", "construction_on", "INTEGER"), ("worksStart", "works_start_date", "TEXT"), ("worksEnd", "works_completion_date", "TEXT"),
    ("contingency", "works_contingency_pct", "NUMERIC"), ("spendCurve", "works_spend_curve", "TEXT"), ("fundingOrder", "works_funding_order", "TEXT"),
    ("constrEquity", "works_equity", "NUMERIC"), ("collCredit", "collateral_progress_credit_pct", "NUMERIC"),
    ("costVatOn", "works_vat_on", "INTEGER"), ("costVatRate", "works_vat_pct", "NUMERIC"), ("costVatLag", "works_vat_refund_lag_months", "NUMERIC"),
    ("trancheMode", "tranche_release", "TEXT"), ("saleVatMode", "sale_price_vat_basis", "TEXT"), ("payPlan", "payment_plan", "JSON"), ("escrowOn", "payments_in_escrow", "INTEGER"), ("saleVatRate", "sale_vat_pct", "NUMERIC"),
    ("loansOn", "several_loans", "INTEGER"),  # several loans in one deal (v3.17)
] + [(f"seasonality.{i}", f"season_{m}", "NUMERIC") for i, m in enumerate(MONTHS)]
ASSET_FIELDS = [
    ("name", "name", "TEXT"), ("inColl", "in_collateral", "INTEGER"), ("market", "market_value", "NUMERIC"),
    ("valDate", "valuation_date", "TEXT"), ("source", "valuer", "TEXT"), ("haircut", "own_haircut_pct", "NUMERIC"),
    ("alloc", "allocated_loan", "NUMERIC"), ("acqPrice", "acquisition_price", "NUMERIC"), ("rent", "rent_per_month", "NUMERIC"),
    ("area", "area_m2", "NUMERIC"), ("saleDate", "planned_sale_date", "TEXT"), ("salePrice", "planned_sale_price", "NUMERIC"),
    ("sweep", "own_sweep_pct", "NUMERIC"), ("minPrice", "min_selling_price", "NUMERIC"), ("notary", "notary_costs", "NUMERIC"),
    ("notes", "notes", "TEXT"), ("status", "sale_status", "TEXT"), ("listPrice", "list_price", "NUMERIC"),
    ("deposit", "deposit", "NUMERIC"), ("depositHeld", "deposit_held", "TEXT"), ("marketDone", "market_value_completed", "NUMERIC"),
    ("contractDate", "contract_date", "TEXT"), ("payPlan", "own_payment_plan", "TEXT"),  # payment plan (v3.16)
    ("secures", "secures_loans", "TEXT"), ("repays", "repays_loans_in_order", "TEXT"),  # several loans (v3.17)
]
ADJ_FIELDS = [
    ("desc", "description", "TEXT"), ("type", "type", "TEXT"), ("date", "start_date", "TEXT"), ("recurrence", "recurrence", "TEXT"),
    ("end", "end_date", "TEXT"), ("amount", "amount", "NUMERIC"), ("notes", "notes", "TEXT"),
]
SCEN_FIELDS = [
    ("name", "name", "TEXT"), ("rev", "revenue_change_pct", "NUMERIC"), ("opex", "opex_change_pct", "NUMERIC"),
    ("rentDelay", "rent_delay_months", "NUMERIC"), ("rate", "rate_change_pp", "NUMERIC"), ("salePrice", "sale_price_change_pct", "NUMERIC"),
    ("saleDelay", "sale_delay_months", "NUMERIC"), ("value", "value_change_pct", "NUMERIC"), ("capex", "capex_change_pct", "NUMERIC"),
    ("exitDelay", "exit_delay_months", "NUMERIC"), ("deck", "in_committee_deck", "INTEGER"), ("complDelay", "completion_delay_months", "NUMERIC"),
]
TODO_FIELDS = [("text", "text", "TEXT"), ("done", "done", "INTEGER"), ("category", "category", "TEXT"), ("due", "due_date", "TEXT"),
               ("from", "requested_from", "TEXT"), ("askedOn", "asked_on", "TEXT"), ("closedOn", "closed_on", "TEXT")]
TRANCHE_FIELDS = [("date", "draw_date", "TEXT"), ("amount", "amount", "NUMERIC"), ("label", "label", "TEXT"), ("milestone", "progress_milestone_pct", "NUMERIC"),
                  ("loan", "loan_no", "TEXT"), ("fee", "own_fee_pct", "NUMERIC"), ("rate", "own_rate_pct", "NUMERIC"), ("minMonths", "min_interest_months", "NUMERIC"),
                  ("trigger", "release_trigger", "TEXT"), ("trigAmount", "release_when_balance_below", "NUMERIC"), ("trigLoan", "release_balance_of_loans", "TEXT"),
                  ("trigUnits", "release_after_units_sold", "NUMERIC")]
LOAN_FIELDS = [("name", "name", "TEXT"), ("fee", "fee_pct", "NUMERIC"), ("rate", "rate_pct", "NUMERIC"), ("gain", "capital_gain_pct", "NUMERIC"),
               ("reserveMonths", "interest_reserve_months", "NUMERIC"), ("term", "term_months", "NUMERIC")]
CONSTR_FIELDS = [("name", "name", "TEXT"), ("budget", "budget", "NUMERIC"), ("spent", "spent_to_date", "NUMERIC"), ("sched", "monthly_schedule", "JSON")]
DEBT_FIELDS = [
    ("lender", "lender", "TEXT"), ("balance", "balance", "NUMERIC"), ("rate", "rate_pct", "NUMERIC"), ("maturity", "maturity_date", "TEXT"),
    ("prepay", "prepayment_cost", "NUMERIC"), ("refinanced", "refinanced", "INTEGER"), ("service", "monthly_service", "NUMERIC"),
    ("end", "service_end_date", "TEXT"), ("notes", "notes", "TEXT"),
]
REVLINE_FIELDS = [
    ("name", "name", "TEXT"), ("kind", "kind", "TEXT"), ("units", "units", "NUMERIC"), ("price", "price", "NUMERIC"),
    ("occ", "occupancy_pct", "NUMERIC"), ("start", "start_date", "TEXT"), ("end", "end_date", "TEXT"), ("growth", "growth_pct", "NUMERIC"),
    ("occM", "occupancy_by_month_pct", "JSON"), ("priceM", "price_by_month", "JSON"),
]
COSTLINE_FIELDS = [
    ("name", "name", "TEXT"), ("kind", "kind", "TEXT"), ("amount", "amount", "NUMERIC"), ("growth", "growth_pct", "NUMERIC"),
    ("start", "start_date", "TEXT"), ("end", "end_date", "TEXT"), ("months", "months", "TEXT"), ("amountM", "amount_by_month", "JSON"),
]
CHILDREN = [("assets", ASSET_FIELDS, "assets"), ("adjustments", ADJ_FIELDS, "adjustments"), ("scenarios", SCEN_FIELDS, "scenarios"),
            ("todos", TODO_FIELDS, "todos"), ("tranches", TRANCHE_FIELDS, "tranches"), ("existing_debts", DEBT_FIELDS, "debts"),
            ("revenue_lines", REVLINE_FIELDS, "revLines"), ("cost_lines", COSTLINE_FIELDS, "costLines"), ("construction_lines", CONSTR_FIELDS, "constrLines"),
            ("loans", LOAN_FIELDS, "loans")]
METRIC_FIELDS = [  # computed by the app on every save (read-only copies for querying)
    ("loan", "loan_amount"), ("rate", "interest_rate"), ("term", "term_months"), ("ltv0", "ltv_market"), ("ltvFs0", "ltv_forced_sale"),
    ("ltc", "ltc"), ("cover0", "collateral_cover"), ("maxLtvFs", "max_ltv_forced_sale"), ("minDscr", "min_dscr"), ("minDscr12", "min_dscr_12m"),
    ("avgDscr", "avg_dscr"), ("minIcr", "min_icr"),
    ("lowCash", "lowest_cash"), ("reserveNeed", "liquidity_reserve_need"), ("negMonths", "negative_cash_months"), ("interest", "interest_earned"),
    ("fees", "fees"), ("gains", "fixed_capital_gains"), ("pshare", "profit_share"), ("profit", "lender_profit"), ("irr", "irr"),
    ("simpleYield", "simple_yield"), ("multiple", "money_multiple"), ("headroom", "value_headroom"), ("collateral", "collateral_market_value"),
    ("sizeMax", "max_loan_by_policy"), ("exitLTV", "exit_ltv"), ("paydown", "paydown_needed_at_exit"), ("flags", "flags"),
    ("drawdown", "drawdown_date"), ("repaid", "repaid_date"), ("maturity", "maturity_date"),
]


def coltype(t):
    return "TEXT" if t == "JSON" else t


def cols(fields):
    return ",\n  ".join(f"{c} {coltype(t)}" for _, c, t in fields)


def child_table(table, fields):
    return f"""CREATE TABLE IF NOT EXISTS {table} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  {cols(fields)}
);
CREATE INDEX IF NOT EXISTS ix_{table}_p ON {table}(project_id, position);"""


METRIC_COLS = ",\n  ".join(c + (" TEXT" if c.endswith("_date") else " REAL") for _, c in METRIC_FIELDS)
CHILD_SQL = "\n".join(child_table(t, f) for t, f, _ in CHILDREN)

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  {cols(PROJECT_FIELDS)},
  grid_row_driver TEXT, grid_col_driver TEXT, grid_row_values TEXT, grid_col_values TEXT
);
CREATE TABLE IF NOT EXISTS project_inputs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  {cols(INPUT_FIELDS)}
);
{CHILD_SQL}
CREATE TABLE IF NOT EXISTS metrics (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  {METRIC_COLS},
  computed_at TEXT
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL,
  metrics TEXT
);
CREATE INDEX IF NOT EXISTS ix_versions_p ON versions(project_id, created_at);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER,
  uploaded_at TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS mail_messages (
  gm_msgid TEXT PRIMARY KEY,
  thrid TEXT NOT NULL,
  date TEXT,
  from_addr TEXT, from_name TEXT, to_addrs TEXT, cc_addrs TEXT,
  subject TEXT, body TEXT, attachments TEXT,
  initial INTEGER DEFAULT 0,
  fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_mail_thr ON mail_messages(thrid, date);
CREATE TABLE IF NOT EXISTS mail_labels (
  label TEXT NOT NULL, uidvalidity INTEGER NOT NULL, uid INTEGER NOT NULL, gm_msgid TEXT NOT NULL,
  PRIMARY KEY (label, uid)
);
CREATE TABLE IF NOT EXISTS mail_allmail (
  uidvalidity INTEGER NOT NULL, uid INTEGER NOT NULL, gm_msgid TEXT NOT NULL,
  PRIMARY KEY (uidvalidity, uid)
);
CREATE TABLE IF NOT EXISTS mail_threads (
  thrid TEXT PRIMARY KEY,
  seen_at TEXT, handled_at TEXT,
  waiting_for TEXT, waiting_until TEXT, waiting_set_at TEXT,
  todo_text TEXT
);
CREATE TABLE IF NOT EXISTS mail_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  text TEXT NOT NULL,
  date TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  project_name TEXT,
  action TEXT NOT NULL,
  at TEXT NOT NULL
);
"""

VIEW_SQL = """
DROP VIEW IF EXISTS deal_register;
CREATE VIEW deal_register AS
  SELECT p.id, p.name, p.status, p.borrower, p.country, p.project_type,
         i.currency, m.drawdown_date, m.loan_amount, i.interest_rate_pct, i.term_months, i.repayment_type,
         m.collateral_market_value, m.ltv_market, m.ltv_forced_sale, m.collateral_cover, m.ltc,
         m.min_dscr, m.min_dscr_12m, m.lowest_cash, m.liquidity_reserve_need,
         m.lender_profit, m.irr, m.simple_yield, m.exit_ltv, m.flags, m.repaid_date, m.maturity_date, p.updated_at
  FROM projects p LEFT JOIN project_inputs i ON i.project_id = p.id LEFT JOIN metrics m ON m.project_id = p.id;
"""

LOCK = threading.Lock()
LAST_SEEN = [0.0]


def connect():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = DELETE")
    return con


def migrate(con):
    """Add any column the current version expects but an older database lacks."""
    want = {"project_inputs": [(c, coltype(t)) for _, c, t in INPUT_FIELDS],
            "projects": [(c, coltype(t).replace(" NOT NULL", "")) for _, c, t in PROJECT_FIELDS] +
                        [(c, "TEXT") for c in ("grid_row_driver", "grid_col_driver", "grid_row_values", "grid_col_values")],
            "versions": [("parent_id", "INTEGER"), ("updated_at", "TEXT")],
            "activity": [("user", "TEXT")],
            "metrics": [(c, "TEXT" if c.endswith("_date") else "REAL") for _, c in METRIC_FIELDS]}
    for t, f, _ in CHILDREN:
        want[t] = [(c, coltype(ty)) for _, c, ty in f]
    for table, columns in want.items():
        have = {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}
        for c, ty in columns:
            if c not in have:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {c} {ty}")


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = connect()
    with con:
        con.executescript(SCHEMA)
        migrate(con)
        if not con.execute("SELECT 1 FROM meta WHERE key='stages_v35'").fetchone():  # one-time: old statuses → pipeline stages
            for r in con.execute("SELECT id, status FROM projects").fetchall():
                con.execute("UPDATE projects SET status=? WHERE id=?", (map_stage(r["status"]), r["id"]))
            con.execute("INSERT INTO meta(key, value) VALUES ('stages_v35', ?)", (now(),))
        con.executescript(VIEW_SQL)
        con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
    con.close()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# JSON <-> rows
# ---------------------------------------------------------------------------
FX_CACHE = {}
ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"


def ecb_rates():
    """ECB euro reference rates (units of currency per 1 EUR), cached for 6 hours."""
    now = dt.datetime.now().timestamp()
    if FX_CACHE.get("t", 0) > now - 6 * 3600:
        return FX_CACHE["data"]
    text = None
    try:
        import urllib.request
        with urllib.request.urlopen(ECB_URL, timeout=8) as r:
            text = r.read().decode("utf-8", "replace")
    except Exception:
        try:  # bundled Python may lack CA certificates; macOS curl uses the system keychain
            import subprocess
            text = subprocess.run(["/usr/bin/curl", "-s", "-m", "8", ECB_URL], capture_output=True, text=True, timeout=10).stdout
        except Exception:
            text = None
    if not text or "currency=" not in text:
        return {"ok": False, "error": "Could not reach the ECB. Enter the rate by hand."}
    day = re.search(r"time=['\"](\d{4}-\d{2}-\d{2})['\"]", text)
    rates = {c: float(v) for c, v in re.findall(r"currency=['\"]([A-Z]{3})['\"]\s+rate=['\"]([\d.]+)['\"]", text)}
    data = {"ok": True, "date": day.group(1) if day else None, "rates": rates, "source": "ECB euro reference rates"}
    FX_CACHE.update(t=now, data=data)
    return data


def get_key(obj, key):
    for part in key.split("."):
        if obj is None:
            return None
        if isinstance(obj, list):
            obj = obj[int(part)] if part.isdigit() and int(part) < len(obj) else None
        elif isinstance(obj, dict):
            obj = obj.get(part)
        else:
            return None
    return obj


def to_db(v, typ):
    if typ == "JSON":
        return json.dumps(v) if isinstance(v, (list, dict)) else None
    if v is None:
        return None
    if typ == "INTEGER":
        return 1 if (v is True or v in (1, "1", "Yes", "yes", "true")) else 0
    if isinstance(v, bool):
        return int(v)
    s = str(v).strip() if not isinstance(v, (int, float)) else v
    return s  # "" is kept, so a field the user cleared stays blank (NULL = never set)


def from_db(v, typ):
    if typ == "JSON":
        try:
            return json.loads(v) if v else None
        except ValueError:
            return None
    if typ == "INTEGER":
        return bool(v) if v is not None else None
    if v is None:
        return None
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    return str(v)


def save_project(con, pid, p, from_drive=False):
    p["status"] = map_stage(p.get("status"))
    pr = [to_db(p.get(k), t) for k, _, t in PROJECT_FIELDS]
    pr[0] = pr[0] or "Untitled project"
    g = p.get("grid") or {}
    exists = con.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone()
    names = [c for _, c, _ in PROJECT_FIELDS] + ["grid_row_driver", "grid_col_driver", "grid_row_values", "grid_col_values"]
    vals = pr + [g.get("rowDriver"), g.get("colDriver"), json.dumps(g.get("rowVals") or []), json.dumps(g.get("colVals") or [])]
    if exists:
        con.execute(f"UPDATE projects SET {', '.join(n + '=?' for n in names)} WHERE id=?", vals + [pid])
    else:
        con.execute(f"INSERT INTO projects (id, {', '.join(names)}) VALUES (?{', ?' * len(names)})", [pid] + vals)
    inp = p.get("inputs") or {}
    icols = [c for _, c, _ in INPUT_FIELDS]
    con.execute(f"INSERT OR REPLACE INTO project_inputs (project_id, {', '.join(icols)}) VALUES (?{', ?' * len(icols)})",
                [pid] + [to_db(get_key(inp, k), t) for k, _, t in INPUT_FIELDS])
    for table, fields, key in CHILDREN:
        con.execute(f"DELETE FROM {table} WHERE project_id=?", (pid,))
        fc = [c for _, c, _ in fields]
        for pos, row in enumerate(p.get(key) or []):
            if not isinstance(row, dict):
                continue
            con.execute(f"INSERT INTO {table} (project_id, position, {', '.join(fc)}) VALUES (?, ?{', ?' * len(fc)})",
                        [pid, pos] + [to_db(row.get(k), t) for k, _, t in fields])
    m = p.get("metrics")
    if isinstance(m, dict):
        mc = [c for _, c in METRIC_FIELDS]
        con.execute(f"INSERT OR REPLACE INTO metrics (project_id, {', '.join(mc)}, computed_at) VALUES (?{', ?' * len(mc)}, ?)",
                    [pid] + [m.get(k) if not isinstance(m.get(k), (dict, list)) else None for k, _ in METRIC_FIELDS] + [now()])
    if from_drive:
        return
    drive_touch(pid)
    last = con.execute("SELECT action, at FROM activity WHERE project_id=? AND (user IS NULL OR user=?) ORDER BY id DESC LIMIT 1", (pid, ME)).fetchone()
    recent = last is not None and last["action"] in ("updated", "created") and \
        (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(last["at"])).total_seconds() < 600
    if not exists or not recent:
        con.execute("INSERT INTO activity (project_id, project_name, action, at, user) VALUES (?, ?, ?, ?, ?)",
                    (pid, pr[0], "updated" if exists else "created", now(), ME))


def load_project(con, row):
    pid = row["id"]
    p = {"id": pid}
    for k, c, t in PROJECT_FIELDS:
        v = from_db(row[c], t)
        p[k] = "" if v is None else v
    p["grid"] = {"rowDriver": row["grid_row_driver"] or "rev", "colDriver": row["grid_col_driver"] or "rate",
                 "rowVals": json.loads(row["grid_row_values"] or "[]") or ["-30", "-20", "-10", "0", "10"],
                 "colVals": json.loads(row["grid_col_values"] or "[]") or ["0", "1", "2", "3", "4"]}
    ir = con.execute("SELECT * FROM project_inputs WHERE project_id=?", (pid,)).fetchone()
    inp = {"seasonality": ["1"] * 12}
    if ir:
        for k, c, t in INPUT_FIELDS:
            v = from_db(ir[c], t)
            if k.startswith("seasonality."):
                inp["seasonality"][int(k.split(".")[1])] = v or "1"
            elif v is not None:
                inp[k] = v
    p["inputs"] = inp
    for table, fields, key in CHILDREN:
        rows = []
        for r in con.execute(f"SELECT * FROM {table} WHERE project_id=? ORDER BY position", (pid,)):
            d = {}
            for k, c, t in fields:
                v = from_db(r[c], t)
                if v is not None:
                    d[k] = v
            rows.append(d)
        p[key] = rows
    return p


def all_projects():
    con = connect()
    try:
        out = [load_project(con, r) for r in con.execute("SELECT * FROM projects ORDER BY updated_at DESC")]
        for p in out:  # the drive rev the app's copy starts from; a save based on an older one would undo someone's change
            p["_base"] = int(meta_get(con, f"extrev:{p['id']}") or 0)
            p["_lock"] = public_lock(SYNC["locks"].get(p["id"]))
        return out
    finally:
        con.close()


def backup(tag="manual"):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    # "index_": the old app's backups (deals_…) share this folder and must never be pruned by this one
    dest = os.path.join(BACKUP_DIR, f"index_{stamp}_{tag}.sqlite")
    src = connect()
    dst = sqlite3.connect(dest)
    with dst:
        src.backup(dst)
    dst.close()
    src.close()
    return dest


def daily_backup():
    if not os.path.exists(DB_PATH):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    today = dt.date.today().isoformat()
    if any(f.startswith(f"index_{today}") and f.endswith("_daily.sqlite") for f in os.listdir(BACKUP_DIR)):
        return
    backup("daily")
    daily = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith("index_") and f.endswith("_daily.sqlite"))
    for f in daily[:-30]:
        try:
            os.remove(os.path.join(BACKUP_DIR, f))
        except OSError:
            pass


def import_json(path, skip_existing=False):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    items = [data] if isinstance(data, dict) and "inputs" in data else (list(data.values()) if isinstance(data, dict) else data)
    con = connect()
    n = 0
    with LOCK, con:
        for p in items:
            if not isinstance(p, dict) or "inputs" not in p:
                continue
            pid = p.get("id") or ("p" + uuid.uuid4().hex[:12])
            exists = con.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone()
            if exists and p.get("_appendVersions"):  # add versions to an existing project without touching its inputs
                for v in p.get("_versions") or []:
                    con.execute("INSERT INTO versions (id, project_id, label, created_at, data, metrics, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                (new_version_id(), pid, v.get("label") or "Version", now(), json.dumps(v.get("data") or {}), json.dumps(v.get("metrics")), now()))
                drive_touch(pid)
                n += 1
                continue
            if exists and p.get("_appendEmails"):  # add email material without touching the model inputs
                append_emails(con, pid, p)
                drive_touch(pid)
                n += 1
                continue
            if skip_existing and not p.get("_replace") and exists:
                continue
            p.setdefault("createdAt", now())
            p.setdefault("updatedAt", now())
            save_project(con, pid, p)
            for v in p.get("_versions") or []:
                con.execute("INSERT INTO versions (id, project_id, label, created_at, data, metrics) VALUES (?, ?, ?, ?, ?, ?)",
                            (new_version_id(), pid, v.get("label") or "Version", now(), json.dumps(v.get("data") or {}), json.dumps(v.get("metrics"))))
            n += 1
    con.close()
    return n


def append_emails(con, pid, p):
    """_appendEmails: email summary, new open items, extra source tags (attached files are no longer stored).
    The model inputs are not touched."""
    sm = p.get("_emailSummary")
    if isinstance(sm, str):
        sm = {"text": sm}
    if isinstance(sm, dict) and (sm.get("text") or "").strip():
        con.execute("INSERT INTO mail_summaries (project_id, text, date, created_at) VALUES (?, ?, ?, ?)",
                    (pid, sm["text"].strip(), str(sm.get("date") or "")[:10] or None, now()))
    todos = [t for t in (p.get("_todos") or p.get("todos") or []) if isinstance(t, dict) and (t.get("text") or "").strip()]
    if todos:
        have = {(r["text"] or "").strip().lower() for r in con.execute("SELECT text FROM todos WHERE project_id=?", (pid,))}
        pos = con.execute("SELECT COALESCE(MAX(position), -1) FROM todos WHERE project_id=?", (pid,)).fetchone()[0]
        fc = [c for _, c, _ in TODO_FIELDS]
        for t in todos:
            if t["text"].strip().lower() in have:
                continue
            have.add(t["text"].strip().lower())  # also skips repeats within the same file
            pos += 1
            t = dict({"done": False, "category": "Open item"}, **t)
            con.execute(f"INSERT INTO todos (project_id, position, {', '.join(fc)}) VALUES (?, ?{', ?' * len(fc)})",
                        [pid, pos] + [to_db(t.get(k), ty) for k, _, ty in TODO_FIELDS])
    src = p.get("_sources") or (p.get("inputs") or {}).get("sources")
    if isinstance(src, dict) and src:
        r = con.execute("SELECT field_sources FROM project_inputs WHERE project_id=?", (pid,)).fetchone()
        cur = json.loads(r["field_sources"] or "{}") if r else {}
        cur.update(src)
        con.execute("UPDATE project_inputs SET field_sources=? WHERE project_id=?", (json.dumps(cur), pid))
    con.execute("UPDATE projects SET updated_at=? WHERE id=?", (now(), pid))


def auto_import():
    """Import each JSON file dropped in <drive>/Inbox once (projects whose id already exists are left alone).
    An imported file moves to Inbox/Imported, so every Mac sees it as done."""
    d = os.path.join(DRIVE, "Inbox")
    if not drive_available() or not os.path.isdir(d):
        return
    con = connect()
    done = {r["key"] for r in con.execute("SELECT key FROM meta WHERE key LIKE 'imported:%'")}
    con.close()
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json") or f"imported:{f}" in done:
            continue
        who = import_blocked(os.path.join(d, f))
        if who:
            print(f"{f} waits in the Inbox: {who} holds the lock", flush=True)
            continue
        try:
            n = import_json(os.path.join(d, f), skip_existing=True)
            print(f"Imported {n} project(s) from {f}", flush=True)
            item = read_json(os.path.join(d, f))
            if isinstance(item, dict) and item.get("id") and "inputs" in item:  # one deal per file: its documents can follow
                k = inbox_documents(d, f, item["id"], item)
                if k:
                    print(f"Moved {k} document(s) from {f[:-5]}/ to the deal", flush=True)
        except (OSError, ValueError) as e:
            print(f"Could not import {f}: {e}", flush=True)
            continue
        con = connect()
        with con:
            con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (f"imported:{f}", now()))
        con.close()
        done_dir = os.path.join(d, "Imported")
        os.makedirs(done_dir, exist_ok=True)
        dest = os.path.join(done_dir, f)
        if os.path.exists(dest):
            dest = os.path.join(done_dir, f"{f[:-5]} {dt.datetime.now():%Y%m%d-%H%M%S}.json")
        try:
            os.replace(os.path.join(d, f), dest)
        except OSError as e:
            print(f"Could not move {f} to Imported: {e}", flush=True)


def safe_name(name):
    name = os.path.basename(name or "file").strip().replace("\x00", "")
    name = re.sub(r"[^\w.\- ()&+,]", "_", name)[:150]
    return name or "file"


# ---------------------------------------------------------------------------
# Shared folder (Google Drive for Desktop). Each deal lives in <drive>/Deals/<name> (<id>)/ as deal.json,
# versions/<id>.json and activity/<user>.jsonl; the local SQLite database is only an index of those files plus this
# user's Gmail cache. SQLite itself never goes on the drive: Drive cannot merge it and two Macs writing corrupt it.
# Writes are temp file + rename (Drive keeps it as the same file, with its version history). Every deal.json carries
# a rev; a Mac only writes over the rev it last read, otherwise its copy is set aside as a conflict file.
# ---------------------------------------------------------------------------
DRIVE_MARK = ".deal-desk"   # marks the real root: without it (drive not mounted, wrong folder) nothing is read or removed
DEAL_SCHEMA = 1
FLUSH_AFTER = float(os.environ.get("DEALDESK_FLUSH_SECONDS", "5"))  # batches typing into one drive write
SYNC_EVERY = float(os.environ.get("DEALDESK_SYNC_SECONDS", "3"))
SYNC = {"dirty": {}, "conflicts": {}, "seen": {}, "available": False, "error": "", "lastSync": None,
        "locks": {}, "newlocks": {}, "unsaved": {}, "missing": {}}
SYNC_RUN = threading.Lock()   # one sync pass at a time
ID_OK = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def new_version_id():
    # unique across Macs and still an integer, so the app's version ids and routes stay as they are
    return int(time.time() * 1000) * 1000 + random.randrange(1000)


def drive_available():
    ok = bool(DRIVE) and os.path.isfile(os.path.join(DRIVE, DRIVE_MARK))
    SYNC["available"] = ok
    return ok


def drive_touch(pid):
    t, seq = SYNC["dirty"].get(pid, (time.time(), 0))
    SYNC["dirty"][pid] = (t, seq + 1)


def deals_dir():
    return os.path.join(DRIVE, "Deals")


def folder_for(name, pid):
    base = re.sub(r"[^\w\- ,&+.]", " ", name or "Untitled project")
    base = re.sub(r"\s+", " ", base).strip(" .")[:60] or "Untitled project"
    return f"{base} ({pid})"


def read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write_atomic(path, text):
    tmp = os.path.join(os.path.dirname(path), f".{os.path.basename(path)}.{re.sub(r'[^\w.-]', '_', ME)}.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1) + "\n"


def export_deal(con, pid):
    row = con.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if not row:
        return None
    p = load_project(con, row)
    m = con.execute("SELECT * FROM metrics WHERE project_id=?", (pid,)).fetchone()
    p["metrics"] = {k: m[c] for k, c in METRIC_FIELDS} if m else None
    p["emailSummaries"] = [{"text": r["text"], "date": r["date"], "createdAt": r["created_at"]}
                           for r in con.execute("SELECT * FROM mail_summaries WHERE project_id=? ORDER BY id", (pid,))]
    return p


def export_versions(con, pid):
    return [{"id": r["id"], "label": r["label"], "createdAt": r["created_at"], "updatedAt": r["updated_at"], "parentId": r["parent_id"],
             "data": json.loads(r["data"]), "metrics": json.loads(r["metrics"] or "null")}
            for r in con.execute("SELECT * FROM versions WHERE project_id=? ORDER BY id", (pid,))]


def drive_flush(pid):
    """Write one deal from the index to the drive, unless someone else saved it since we last read it."""
    con = connect()
    try:
        deal = export_deal(con, pid)
        versions = export_versions(con, pid) if deal else []
        folder = meta_get(con, f"folder:{pid}")
        base = int(meta_get(con, f"rev:{pid}") or 0)
        last_act = int(meta_get(con, f"act:{pid}") or 0)
        acts = con.execute("SELECT * FROM activity WHERE project_id=? AND id>? AND (user IS NULL OR user=?) ORDER BY id",
                           (pid, last_act, ME)).fetchall()
    finally:
        con.close()
    if deal is None:
        return drive_remove(pid, folder, acts)
    folder = folder or folder_for(deal.get("name"), pid)
    d = os.path.join(deals_dir(), folder)
    disk = read_json(os.path.join(d, "deal.json"))
    if disk is not None and int(disk.get("rev") or 0) != base:
        return drive_conflict(pid, d, deal, disk)
    want = folder_for(deal.get("name"), pid)
    if folder != want and os.path.isdir(d) and not os.path.exists(os.path.join(deals_dir(), want)):
        # the folder follows the deal's name (it may have been named before the name was typed); documents and lock move with it
        os.rename(d, os.path.join(deals_dir(), want))
        SYNC["seen"].pop(folder, None)
        folder, d = want, os.path.join(deals_dir(), want)
    os.makedirs(os.path.join(d, "versions"), exist_ok=True)
    if pid in SYNC["newlocks"]:
        write_claim(os.path.join(d, "locks"), SYNC["newlocks"][pid])
    keep = set()
    for v in versions:
        fn = os.path.join(d, "versions", f"{v['id']}.json")
        keep.add(f"{v['id']}.json")
        text = dumps(v)
        try:
            with open(fn, encoding="utf-8") as fh:
                if fh.read() == text:
                    continue
        except OSError:
            pass
        write_atomic(fn, text)
    # rev matched, so every version file we did not keep is one this Mac deleted
    for f in os.listdir(os.path.join(d, "versions")):
        if f.endswith(".json") and f not in keep:
            os.remove(os.path.join(d, "versions", f))
    if acts:
        os.makedirs(os.path.join(d, "activity"), exist_ok=True)
        with open(os.path.join(d, "activity", f"{ME}.jsonl"), "a", encoding="utf-8") as fh:
            for a in acts:
                fh.write(json.dumps({"action": a["action"], "at": a["at"], "name": a["project_name"], "user": a["user"] or ME}, ensure_ascii=False) + "\n")
    deal.update(id=pid, rev=base + 1, schema=DEAL_SCHEMA, savedBy=ME, savedAt=now())
    fn = os.path.join(d, "deal.json")
    write_atomic(fn, dumps(deal))
    st = os.stat(fn)
    SYNC["seen"][folder] = ((st.st_mtime_ns, st.st_size), pid)
    con = connect()
    with LOCK, con:
        meta_set(con, f"rev:{pid}", str(base + 1))
        meta_set(con, f"folder:{pid}", folder)
        if acts:
            meta_set(con, f"act:{pid}", str(acts[-1]["id"]))
    con.close()
    SYNC["newlocks"].pop(pid, None)


def drive_remove(pid, folder, acts):
    """A deleted deal's folder moves to Deals/_deleted on the drive; nothing is erased."""
    if folder and os.path.isdir(os.path.join(deals_dir(), folder)):
        gone = os.path.join(deals_dir(), "_deleted")
        os.makedirs(gone, exist_ok=True)
        dest = os.path.join(gone, f"{folder} {dt.datetime.now():%Y%m%d-%H%M%S}")
        os.replace(os.path.join(deals_dir(), folder), dest)
        os.makedirs(os.path.join(dest, "activity"), exist_ok=True)
        with open(os.path.join(dest, "activity", f"{ME}.jsonl"), "a", encoding="utf-8") as fh:
            for a in acts:
                fh.write(json.dumps({"action": a["action"], "at": a["at"], "name": a["project_name"], "user": a["user"] or ME}, ensure_ascii=False) + "\n")
        SYNC["seen"].pop(folder, None)
    SYNC["locks"].pop(pid, None)
    SYNC["newlocks"].pop(pid, None)
    con = connect()
    with LOCK, con:
        con.execute("DELETE FROM meta WHERE key IN (?, ?, ?, ?, ?)", (f"rev:{pid}", f"folder:{pid}", f"act:{pid}", f"extrev:{pid}", f"extby:{pid}"))
    con.close()


def drive_conflict(pid, d, mine, disk):
    """Someone else saved this deal since we read it: keep their version, set ours aside next to it, refuse further
    saves until the app reloads. Locks (phase 2) make this rare; it is the backstop, never a silent overwrite."""
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    fn = os.path.join(d, f"deal.conflict-{re.sub(r'[^\w.@-]', '_', ME)}-{stamp}.json")
    mine.update(id=pid, conflictWith=disk.get("rev"), savedBy=ME, savedAt=now())
    write_atomic(fn, dumps(mine))
    SYNC["conflicts"][pid] = {"file": fn, "by": disk.get("savedBy") or "someone else", "at": disk.get("savedAt"), "name": disk.get("name") or pid}
    print(f"Conflict on {pid}: {disk.get('savedBy')} saved rev {disk.get('rev')}; ours kept in {fn}", flush=True)
    load_deal(pid, os.path.basename(d), disk)


def conflict_message(pid):
    c = SYNC["conflicts"][pid]
    return (f"Not saved – {c['by']} saved {c['name']} on Google Drive at {(c['at'] or '')[11:16]} while you were editing. "
            f"Your version is kept in {os.path.basename(c['file'])} in the deal's folder. Reload the page to continue.")


def load_deal(pid, folder, data):
    """Replace one deal in the index with what is on the drive (deal.json, versions, everyone's activity)."""
    d = os.path.join(deals_dir(), folder)
    versions = []
    vd = os.path.join(d, "versions")
    for f in sorted(os.listdir(vd)) if os.path.isdir(vd) else []:
        v = read_json(os.path.join(vd, f)) if f.endswith(".json") else None
        if isinstance(v, dict) and "id" in v:
            versions.append(v)
    acts = []
    ad = os.path.join(d, "activity")
    for f in sorted(os.listdir(ad)) if os.path.isdir(ad) else []:
        if not f.endswith(".jsonl"):
            continue
        with open(os.path.join(ad, f), encoding="utf-8") as fh:
            for line in fh:
                try:
                    acts.append(json.loads(line))
                except ValueError:
                    pass  # a half-synced last line; it is complete on the next pass
    acts.sort(key=lambda a: a.get("at") or "")
    con = connect()
    with LOCK, con:
        save_project(con, pid, dict(data), from_drive=True)
        con.execute("DELETE FROM mail_summaries WHERE project_id=?", (pid,))
        for sm in data.get("emailSummaries") or []:
            con.execute("INSERT INTO mail_summaries (project_id, text, date, created_at) VALUES (?, ?, ?, ?)",
                        (pid, sm.get("text") or "", sm.get("date"), sm.get("createdAt") or now()))
        con.execute("DELETE FROM versions WHERE project_id=?", (pid,))
        for v in versions:
            con.execute("INSERT INTO versions (id, project_id, label, created_at, data, metrics, parent_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (int(v["id"]), pid, v.get("label") or "Version", v.get("createdAt") or now(), json.dumps(v.get("data") or {}),
                         json.dumps(v.get("metrics")), v.get("parentId"), v.get("updatedAt")))
        con.execute("DELETE FROM activity WHERE project_id=?", (pid,))
        for a in acts:
            con.execute("INSERT INTO activity (project_id, project_name, action, at, user) VALUES (?, ?, ?, ?, ?)",
                        (pid, a.get("name"), a.get("action") or "updated", a.get("at") or now(), a.get("user")))
        top = con.execute("SELECT COALESCE(MAX(id), 0) FROM activity WHERE project_id=?", (pid,)).fetchone()[0]
        meta_set(con, f"act:{pid}", str(top))
        meta_set(con, f"rev:{pid}", str(int(data.get("rev") or 0)))
        meta_set(con, f"extrev:{pid}", str(int(data.get("rev") or 0)))
        meta_set(con, f"schema:{pid}", str(int(data.get("schema") or 0)))
        meta_set(con, f"extby:{pid}", f"{data.get('savedBy') or ''}|{data.get('savedAt') or ''}")
        meta_set(con, f"folder:{pid}", folder)
    con.close()


def stale_save(pid, base):
    """A save from an app copy older than the last change that arrived from the drive: kept as a conflict file, not saved."""
    con = connect()
    try:
        ext = int(meta_get(con, f"extrev:{pid}") or 0)
        by, _, at = (meta_get(con, f"extby:{pid}") or "|").partition("|")
        folder = meta_get(con, f"folder:{pid}")
        name = (con.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone() or {"name": pid})["name"]
    finally:
        con.close()
    if int(base or 0) >= ext or not folder:
        return False
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    fn = os.path.join(deals_dir(), folder, f"deal.conflict-{re.sub(r'[^\w.@-]', '_', ME)}-{stamp}.json")
    SYNC["conflicts"][pid] = {"file": fn, "by": by or "someone else", "at": at, "name": name}
    return True


def drive_scan():
    """Bring deals changed on the drive into the index and drop deals whose folder is gone."""
    root = deals_dir()
    os.makedirs(root, exist_ok=True)
    for folder in os.listdir(root):
        if folder.startswith((".", "_")):
            continue
        fn = os.path.join(root, folder, "deal.json")
        try:
            st = os.stat(fn)
        except OSError:
            continue
        key = (st.st_mtime_ns, st.st_size)
        known = SYNC["seen"].get(folder)
        if known and known[0] == key:
            continue
        data = read_json(fn)
        if not isinstance(data, dict) or not ID_OK.match(str(data.get("id") or "")):
            continue
        pid = data["id"]
        if pid in SYNC["dirty"]:
            continue  # our pending write goes first; its rev check catches a change made meanwhile
        con = connect()
        mine = int(meta_get(con, f"rev:{pid}") or -1)
        con.close()
        if mine != int(data.get("rev") or 0) or not known:
            load_deal(pid, folder, data)
        SYNC["seen"][folder] = (key, pid)
    con = connect()
    gone = [r["key"][7:] for r in con.execute("SELECT key, value FROM meta WHERE key LIKE 'folder:%'")
            if not os.path.isdir(os.path.join(root, r["value"]))]
    con.close()
    SYNC["missing"] = {pid: SYNC["missing"].get(pid, 0) + 1 for pid in gone}
    for pid in gone:
        # a renamed folder can be missing for a moment while Drive syncs the rename: drop a deal only on the second miss
        if pid in SYNC["dirty"] or SYNC["missing"][pid] < 2:
            continue
        con = connect()
        with LOCK, con:
            con.execute("DELETE FROM projects WHERE id=?", (pid,))
            con.execute("DELETE FROM meta WHERE key IN (?, ?, ?, ?, ?)", (f"rev:{pid}", f"folder:{pid}", f"act:{pid}", f"extrev:{pid}", f"extby:{pid}"))
        con.close()
        print(f"{pid} was removed from the drive", flush=True)


def drive_sync(force=False):
    """Write pending deals (after FLUSH_AFTER seconds, or all with force), then read what others changed."""
    if not DRIVE:
        SYNC["error"] = NO_DRIVE
        return
    with SYNC_RUN:
        if not drive_available():
            SYNC["error"] = f"Shared folder not found: {DRIVE}. Is Google Drive running? Changes are kept on this Mac until it is back."
            return
        try:
            for pid, (t, seq) in list(SYNC["dirty"].items()):
                if not force and time.time() - t < FLUSH_AFTER:
                    continue
                if pid in SYNC["conflicts"]:
                    SYNC["dirty"].pop(pid, None)
                    continue
                drive_flush(pid)
                if SYNC["dirty"].get(pid, (0, None))[1] == seq:
                    SYNC["dirty"].pop(pid, None)
            drive_scan()
            scan_locks()
            lock_heartbeat()
            check_release()
            SYNC["error"] = ""
            SYNC["lastSync"] = now()
        except OSError as e:
            SYNC["error"] = f"Could not reach the shared folder: {e}"
            print(SYNC["error"], flush=True)


# ---- Locks. Only the person holding a deal's lock can change it; everyone else sees it read-only, and an unlocked deal
# is read-only for all. A lock is a file Deals/<deal>/locks/<user>.json. Lock files cannot be made exclusive across Macs
# (Drive syncs in seconds, not instantly), so taking a lock is claim → wait LOCK_SETTLE → confirm: the earliest claim
# wins, a loser removes its own claim. Locks do not expire: they are a deliberate checkout and survive restarts.
LOCK_SETTLE = float(os.environ.get("DEALDESK_LOCK_SETTLE", "6"))
CLAIM_TIMEOUT = 60      # an unconfirmed claim older than this belongs to an app that stopped mid-claim
HEARTBEAT = 300         # the holder refreshes lastActive this often while its app is open
MY_LOCKFILE = re.sub(r"[^\w.@-]", "_", ME) + ".json"


def lock_dir(pid):
    con = connect()
    folder = meta_get(con, f"folder:{pid}")
    con.close()
    return os.path.join(deals_dir(), folder, "locks") if folder else None


def read_claims(d):
    out = []
    for f in sorted(os.listdir(d)) if d and os.path.isdir(d) else []:
        c = read_json(os.path.join(d, f)) if f.endswith(".json") else None
        if isinstance(c, dict) and c.get("user"):
            c["_file"] = f
            out.append(c)
    return out


def lock_holder(claims):
    """The confirmed claim (earliest if Drive ever shows two); unconfirmed claims are a lock being taken, not held."""
    held = sorted((c for c in claims if c.get("confirmed")), key=lambda c: (c.get("claimedAt") or "", c["user"]))
    return held[0] if held else None


def public_lock(c):
    return {"user": c["user"], "since": c.get("confirmedAt") or c.get("claimedAt"), "lastActive": c.get("lastActive"), "me": c["user"] == ME} if c else None


def write_claim(d, claim):
    os.makedirs(d, exist_ok=True)
    write_atomic(os.path.join(d, MY_LOCKFILE), dumps({k: v for k, v in claim.items() if not k.startswith("_")}))


def precise_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def scan_locks():
    """Who holds each deal, from the lock files of every deal folder (plus deals created here, not yet on the drive)."""
    locks = {}
    con = connect()
    folders = {r["key"][7:]: r["value"] for r in con.execute("SELECT key, value FROM meta WHERE key LIKE 'folder:%'")}
    con.close()
    for pid, folder in folders.items():
        h = lock_holder(read_claims(os.path.join(deals_dir(), folder, "locks")))
        if h:
            locks[pid] = h
    for pid, c in SYNC["newlocks"].items():
        locks.setdefault(pid, c)
    SYNC["locks"] = locks


def holds(pid):
    c = SYNC["locks"].get(pid)
    return bool(c and c["user"] == ME)


def is_new(pid):
    """A deal nobody has saved yet (not in the index, no folder): whoever creates it holds its lock."""
    con = connect()
    try:
        return not con.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone() and not meta_get(con, f"folder:{pid}")
    finally:
        con.close()


def edit_refusal(pid):
    if SYNC.get("too_old"):
        return f"This Deal Desk ({APP_VERSION}) is older than the shared deals allow ({SYNC['too_old']} or newer). Restart Deal Desk to update."
    con = connect()
    schema = int(meta_get(con, f"schema:{pid}") or 0)
    con.close()
    if schema > DEAL_SCHEMA:
        return "this deal was saved by a newer Deal Desk. Restart Deal Desk to update."
    if holds(pid):
        return None
    c = SYNC["locks"].get(pid)
    con = connect()
    r = con.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
    con.close()
    name = r["name"] if r else pid
    if c:
        return f"Read-only – {c['user']} is editing {name} (locked since {(c.get('confirmedAt') or c.get('claimedAt') or '')[11:16]} UTC)."
    return f"Read-only – lock {name} to edit it."


def keep_unsaved(pid, body):
    """A refused save still holds what was typed: keep it next to the deal (one file per deal and session)."""
    con = connect()
    folder = meta_get(con, f"folder:{pid}")
    con.close()
    if not folder:
        return None
    fn = SYNC["unsaved"].get(pid) or os.path.join(deals_dir(), folder, f"deal.unsaved-{re.sub(r'[^\w.@-]', '_', ME)}-{dt.datetime.now():%Y%m%d-%H%M%S}.json")
    try:
        write_atomic(fn, dumps(dict(body, id=pid, savedBy=ME, savedAt=now())))
    except OSError:
        return None
    SYNC["unsaved"][pid] = fn
    return os.path.basename(fn)


def claim_lock(pid, force=False):
    """Take the lock: (ok, holder). force removes the current holder's claim first (logged in the deal's activity)."""
    if holds(pid):
        return True, SYNC["locks"][pid]
    d = lock_dir(pid)
    if not d:
        return False, None
    claims = read_claims(d)
    held = lock_holder(claims)
    if held and held["user"] != ME and not force:
        return False, held
    if force and held and held["user"] != ME:
        for c in claims:
            if c["_file"] != MY_LOCKFILE:
                try:
                    os.remove(os.path.join(d, c["_file"]))
                except OSError:
                    pass
        log_activity(pid, f"took over the lock from {held['user']}")
    mine = {"user": ME, "claimedAt": precise_now(), "lastActive": now(), "mac": os.uname().nodename, "confirmed": False}
    write_claim(d, mine)
    time.sleep(LOCK_SETTLE)
    rivals = []
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=CLAIM_TIMEOUT)).isoformat()
    for c in read_claims(d):
        if c["user"] == ME:
            continue
        if c.get("confirmed") or (c.get("claimedAt") or "") >= cutoff:
            rivals.append(c)
    first = min(rivals + [mine], key=lambda c: (not c.get("confirmed"), c.get("claimedAt") or "", c["user"]))
    if first is not mine:
        try:
            os.remove(os.path.join(d, MY_LOCKFILE))
        except OSError:
            pass
        return False, first
    mine.update(confirmed=True, confirmedAt=now())
    write_claim(d, mine)
    SYNC["locks"][pid] = mine
    SYNC["unsaved"].pop(pid, None)
    return True, mine


def release_lock(pid):
    if not holds(pid):
        return
    if pid in SYNC["dirty"]:
        drive_sync(force=True)  # what was typed goes to the drive before anyone else can take the deal
    SYNC["newlocks"].pop(pid, None)
    d = lock_dir(pid)
    if d:
        try:
            os.remove(os.path.join(d, MY_LOCKFILE))
        except OSError:
            pass
    SYNC["locks"].pop(pid, None)


def lock_heartbeat():
    if time.time() - LAST_SEEN[0] > HEARTBEAT:
        return  # app closed: the lock stays, but it no longer looks active
    stale = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=HEARTBEAT)).isoformat(timespec="seconds")
    for pid, c in list(SYNC["locks"].items()):
        if c["user"] == ME and pid not in SYNC["newlocks"] and (c.get("lastActive") or "") < stale:
            d = lock_dir(pid)
            if d and os.path.isfile(os.path.join(d, MY_LOCKFILE)):
                c["lastActive"] = now()
                write_claim(d, c)


def log_activity(pid, action):
    con = connect()
    with LOCK, con:
        r = con.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
        con.execute("INSERT INTO activity (project_id, project_name, action, at, user) VALUES (?, ?, ?, ?, ?)",
                    (pid, r["name"] if r else None, action, now(), ME))
    con.close()
    drive_touch(pid)


def import_blocked(path):
    """An Inbox file that changes an existing deal locked by someone else waits until the lock is released."""
    data = read_json(path)
    items = [data] if isinstance(data, dict) and "inputs" in data else (list(data.values()) if isinstance(data, dict) else data or [])
    for p in items:
        pid = isinstance(p, dict) and p.get("id")
        if pid and (p.get("_appendVersions") or p.get("_appendEmails") or p.get("_replace")):
            c = SYNC["locks"].get(pid)
            if c and c["user"] != ME:
                return c["user"]
    return None


# ---- Documents: files in Deals/<deal>/Documents/<category>/. Anyone may add them without the lock – files never touch
# deal.json, so they cannot collide with the holder's edits. Finder and Google Drive work on the same folder.
DOC_CATEGORIES = ["Teaser, business plan", "Appraisal", "Financial statements", "Legal", "Photos", "Other"]
UPLOAD_LIMIT = 500 * 1024 * 1024
DOC_SKIP = re.compile(r"^(\.|~\$|Icon\r)|\.(tmp|part)$")  # hidden files, Office lock files, unfinished copies


def docs_root(pid, create=False):
    con = connect()
    try:
        folder = meta_get(con, f"folder:{pid}")
        if not folder and create:  # a deal not written to the drive yet: its folder starts with its documents
            r = con.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
            if not r:
                return None
            folder = folder_for(r["name"], pid)
            with LOCK, con:
                meta_set(con, f"folder:{pid}", folder)
    finally:
        con.close()
    if not folder:
        return None
    root = os.path.join(deals_dir(), folder, "Documents")
    if create:
        os.makedirs(root, exist_ok=True)
    return root


def list_documents(pid):
    root = docs_root(pid)
    out = []
    for base, dirs, files in os.walk(root) if root and os.path.isdir(root) else []:
        dirs[:] = sorted(x for x in dirs if not DOC_SKIP.search(x))
        for f in sorted(files):
            if DOC_SKIP.search(f):
                continue
            fp = os.path.join(base, f)
            rel = os.path.relpath(fp, root)
            st = os.stat(fp)
            out.append({"path": rel, "name": f, "category": rel.split(os.sep)[0] if os.sep in rel else "",
                        "size": st.st_size, "modified": dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat(timespec="seconds")})
    return out


def doc_path(pid, rel):
    """The file (or the Documents folder itself for "") inside this deal's Documents – never anything outside it."""
    root = docs_root(pid, create=not rel)
    if not root:
        return None
    full = os.path.realpath(os.path.join(root, rel or ""))
    top = os.path.realpath(root)
    return full if (full == top or full.startswith(top + os.sep)) and os.path.exists(full) else None


def unique_path(path):
    stem, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(path):
        path = f"{stem} ({n}){ext}"
        n += 1
    return path


def inbox_documents(inbox, f, pid, item):
    """Documents that came with a draft (Inbox/<draft name>/) move into the deal's Documents. Category: the draft's
    _documents [{file, kind}], else the subfolder they sit in, else Other."""
    import shutil
    src = os.path.join(inbox, f[:-5])
    if not os.path.isdir(src):
        return 0
    kinds = {str(x.get("file") or "").replace("/", os.sep): x.get("kind") for x in (item.get("_documents") or []) if isinstance(x, dict)}
    root = docs_root(pid, create=True)
    n = 0
    for base, dirs, files in os.walk(src):
        for name in files:
            if DOC_SKIP.search(name):
                continue
            rel = os.path.relpath(os.path.join(base, name), src)
            kind = kinds.get(rel) or kinds.get(name) or (rel.split(os.sep)[0] if os.sep in rel else "Other")
            dest = unique_path(os.path.join(root, safe_name(re.sub(r"\s*/\s*", ", ", kind)), safe_name(name)))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.move(os.path.join(base, name), dest)
            n += 1
    left = [x for _, _, fs in os.walk(src) for x in fs if not DOC_SKIP.search(x)]
    if left:
        shutil.move(src, unique_path(os.path.join(inbox, "Imported", f[:-5])))
    else:
        shutil.rmtree(src, ignore_errors=True)
    return n


# ---- Updates. The launcher runs the version named in <drive>/Releases/current.json. A running app learns of a newer one
# here and offers a restart; an app older than min_version (or a deal saved by a newer app) is read-only, so an old
# program never writes an old format over newer data.
SERVER = [None]


def vtuple(v):
    return tuple(int(x) if x.isdigit() else 0 for x in re.findall(r"\d+", str(v or "0")))


def check_release():
    channel = "preview" if os.environ.get("DEALDESK_CHANNEL") == "preview" else "current"
    r = read_json(os.path.join(DRIVE, "Releases", f"{channel}.json")) or {}
    newest, minimum = r.get("version"), r.get("min_version")
    SYNC["update"] = newest if newest and vtuple(newest) > vtuple(APP_VERSION) else None
    SYNC["too_old"] = minimum if minimum and vtuple(APP_VERSION) < vtuple(minimum) else None


def update_status():
    return {"version": APP_VERSION, "available": SYNC.get("update"), "required": SYNC.get("too_old"),
            "canRestart": bool(os.environ.get("DEALDESK_LAUNCHER"))}


def restart_via_launcher():
    """Write what is pending, start the launcher (it installs and starts the new version), then stop this server."""
    drive_sync(force=True)
    launcher = os.environ["DEALDESK_LAUNCHER"]
    cmd = ["/usr/bin/open", "-n", launcher, "--args", "--restart"] if launcher.endswith(".app") else [launcher, "--restart"]
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    if SERVER[0]:
        threading.Timer(0.3, SERVER[0].shutdown).start()


def drive_status():
    return {"root": DRIVE, "user": ME, "available": SYNC["available"],
            "pending": len(SYNC["dirty"]), "conflicts": sorted(SYNC["conflicts"]), "error": SYNC["error"], "lastSync": SYNC["lastSync"]}


MAIL_TABLES = ("mail_messages", "mail_labels", "mail_allmail", "mail_threads")


def migrate_to_drive(src, as_user, dry=False, with_mail=False, replace=False):
    """One-time move of a pre-drive data folder (deals.sqlite, documents/, import/) into the shared folder.
    The source is only read (from a copy). Deals already on the drive are left alone, so it can be run again – unless
    replace: then they are written again from the source (switch-over day), the drive's copy kept as
    deal.before-replace-<time>.json; a deal someone holds the lock on is skipped.
    Old activity has no user and is credited to as_user. with_mail: also load this Mac's Gmail cache into its local index."""
    import shutil
    import tempfile
    if not drive_available():
        raise SystemExit(f"Shared folder not set up: {DRIVE or '(none)'} – run --init-drive first")
    tmp = tempfile.mkdtemp(prefix="dealdesk-migrate-")
    copy = os.path.join(tmp, "deals.sqlite")
    s = sqlite3.connect(f"file:{os.path.join(src, 'deals.sqlite')}?mode=ro", uri=True)
    d = sqlite3.connect(copy)
    s.backup(d)
    s.close()
    d.row_factory = sqlite3.Row
    with d:
        d.executescript(SCHEMA)
        migrate(d)
    report = []
    root = deals_dir()
    os.makedirs(root, exist_ok=True)
    for row in d.execute("SELECT id, name FROM projects ORDER BY name").fetchall():
        pid = row["id"]
        if not ID_OK.match(pid):
            report.append(f"SKIPPED {row['name']}: id {pid!r} cannot be a folder name")
            continue
        have = [f for f in os.listdir(root) if f.endswith(f"({pid})") and os.path.isfile(os.path.join(root, f, "deal.json"))]
        old = None
        if have and not replace:
            report.append(f"already on the drive: {have[0]}")
            continue
        if have:
            held = lock_holder(read_claims(os.path.join(root, have[0], "locks")))
            if held:
                report.append(f"SKIPPED {have[0]}: {held['user']} holds the lock")
                continue
            with open(os.path.join(root, have[0], "deal.json"), encoding="utf-8") as fh:
                old = fh.read()
        deal = export_deal(d, pid)
        versions = export_versions(d, pid)
        acts = d.execute("SELECT * FROM activity WHERE project_id=? ORDER BY id", (pid,)).fetchall()
        docs, names = [], set()
        for r in d.execute("SELECT * FROM documents WHERE project_id=? ORDER BY id", (pid,)):
            fp = os.path.join(src, "documents", pid, r["stored_name"])
            if os.path.isfile(fp):
                docs.append((fp, os.path.join(safe_name(re.sub(r"\s*/\s*", ", ", r["note"] or "Other")), safe_name(r["name"]))))
                names.add(r["name"])
        extra = os.path.join(src, "import", pid)  # documents that came with a draft but were never attached
        for f in sorted(os.listdir(extra)) if os.path.isdir(extra) else []:
            if f not in names and os.path.isfile(os.path.join(extra, f)) and not f.startswith("."):
                docs.append((os.path.join(extra, f), safe_name(f)))
        folder = os.path.join(root, have[0] if have else folder_for(deal.get("name"), pid))
        report.append(f"{('would replace' if dry else 'replaced') if have else ('would move' if dry else 'moved')}: {os.path.basename(folder)} – {len(versions)} versions, {len(acts)} activity, "
                      f"{len(docs)} documents{', decision log' if deal.get('judgement') else ''}")
        if dry:
            continue
        os.makedirs(os.path.join(folder, "versions"), exist_ok=True)
        if old is not None:
            write_atomic(os.path.join(folder, f"deal.before-replace-{dt.datetime.now():%Y%m%d-%H%M%S}.json"), old)
            for f in os.listdir(os.path.join(folder, "versions")):
                if f.endswith(".json") and f not in {f"{v['id']}.json" for v in versions}:
                    os.remove(os.path.join(folder, "versions", f))
        for v in versions:
            write_atomic(os.path.join(folder, "versions", f"{v['id']}.json"), dumps(v))
        if acts:
            os.makedirs(os.path.join(folder, "activity"), exist_ok=True)
            lines = [json.dumps({"action": a["action"], "at": a["at"], "name": a["project_name"], "user": a["user"] or as_user}, ensure_ascii=False) for a in acts]
            write_atomic(os.path.join(folder, "activity", f"{as_user}.jsonl"), "\n".join(lines) + "\n")
        for fp, rel in docs:
            dest = os.path.join(folder, "Documents", rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if not os.path.exists(dest):
                shutil.copy2(fp, dest)
        rev = int((json.loads(old).get("rev") if old else 0) or 0) + 1  # a higher rev, so every Mac reloads it
        deal.update(id=pid, rev=rev, schema=DEAL_SCHEMA, savedBy=as_user, savedAt=now())
        write_atomic(os.path.join(folder, "deal.json"), dumps(deal))  # last: a folder without deal.json is unfinished and is redone
    imp = os.path.join(src, "import")
    done = os.path.join(DRIVE, "Inbox", "Imported")
    os.makedirs(done, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(imp)) if os.path.isdir(imp) else []:
        if f.endswith(".json") and not os.path.exists(os.path.join(done, f)):
            n += 1
            if not dry:
                shutil.copy2(os.path.join(imp, f), os.path.join(done, f))
    report.append(f"{n} imported draft file(s) {'would be' if dry else ''} copied to Inbox/Imported")
    if with_mail and not dry:
        init_db()
        con = connect()
        with LOCK, con:
            for t in MAIL_TABLES:
                rows = d.execute(f"SELECT * FROM {t}").fetchall()
                if rows:
                    con.executemany(f"INSERT OR REPLACE INTO {t} ({', '.join(rows[0].keys())}) VALUES ({', '.join('?' * len(rows[0].keys()))})", [tuple(r) for r in rows])
            for r in d.execute("SELECT key, value FROM meta WHERE key LIKE 'mail_%'"):
                meta_set(con, r["key"], r["value"])
        con.close()
        report.append("Gmail cache loaded into this Mac's index")
    d.close()
    shutil.rmtree(tmp, ignore_errors=True)
    return report


def init_drive(root):
    """One-time setup of a shared folder: marker, Deals/, Inbox/; remembers it in <data>/config.json."""
    root = os.path.abspath(os.path.expanduser(root))
    for sub in ("Deals", os.path.join("Inbox", "Imported")):
        os.makedirs(os.path.join(root, sub), exist_ok=True)
    mark = os.path.join(root, DRIVE_MARK)
    if not os.path.exists(mark):
        write_atomic(mark, dumps({"app": "deal-desk", "createdAt": now(), "createdBy": ME}))
    os.makedirs(DATA, exist_ok=True)
    cfg = read_json(os.path.join(DATA, "config.json")) or {}
    cfg["driveRoot"] = root
    write_atomic(os.path.join(DATA, "config.json"), dumps(cfg))
    return root


# ---------------------------------------------------------------------------
# Email (read-only Gmail over IMAP). The app password lives in the macOS Keychain
# (via /usr/bin/security), never in SQLite or files. Mailboxes are opened with
# EXAMINE and bodies fetched with BODY.PEEK, so nothing is ever marked as read.
# ---------------------------------------------------------------------------
import base64
import email
import email.policy
import email.utils
import email.header
import html as htmlmod
import imaplib
import ssl
import subprocess

KC_SERVICE = "Deal Desk Gmail"
FAKE_KC = {}  # only used when DEALDESK_FAKE_KEYCHAIN is set (tests on machines without a Keychain)
MAIL_LOCK = threading.Lock()
HANDLED_AFTER_DAYS = 14   # first sync of a label: threads quiet for longer are marked handled
EXPAND_DAYS = 120         # threads active in this window are completed from All Mail (your replies)
TEXT_LIMIT = 400_000      # bytes of message text fetched per message (attachments are listed, not downloaded)


def meta_get(con, key, default=None):
    r = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def meta_set(con, key, value):
    con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, value))


def kc_available():
    return bool(os.environ.get("DEALDESK_FAKE_KEYCHAIN")) or os.path.exists("/usr/bin/security")


def kc_get(account):
    if os.environ.get("DEALDESK_FAKE_KEYCHAIN"):
        return FAKE_KC.get(account)
    if not account or not os.path.exists("/usr/bin/security"):
        return None
    r = subprocess.run(["/usr/bin/security", "find-generic-password", "-a", account, "-s", KC_SERVICE, "-w"],
                       capture_output=True, text=True, timeout=15)
    return r.stdout.rstrip("\n") if r.returncode == 0 and r.stdout.strip() else None


def kc_set(account, password):
    if os.environ.get("DEALDESK_FAKE_KEYCHAIN"):
        FAKE_KC[account] = password
        return
    r = subprocess.run(["/usr/bin/security", "add-generic-password", "-U", "-a", account, "-s", KC_SERVICE,
                        "-l", KC_SERVICE, "-w", password], capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        raise RuntimeError("Could not save the password in the Keychain: " + (r.stderr.strip() or str(r.returncode)))


def kc_delete(account):
    if os.environ.get("DEALDESK_FAKE_KEYCHAIN"):
        FAKE_KC.pop(account, None)
        return
    if os.path.exists("/usr/bin/security"):
        subprocess.run(["/usr/bin/security", "delete-generic-password", "-a", account, "-s", KC_SERVICE], capture_output=True, timeout=15)


# --- IMAP mailbox names use "modified UTF-7" (RFC 3501 5.1.3)
def mutf7_encode(s):
    out, buf = [], []

    def flush():
        if buf:
            b = base64.b64encode("".join(buf).encode("utf-16-be")).decode().rstrip("=").replace("/", ",")
            out.append("&" + b + "-")
            buf.clear()
    for ch in s:
        if 0x20 <= ord(ch) <= 0x7E:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            buf.append(ch)
    flush()
    return "".join(out)


def mutf7_decode(s):
    def dec(m):
        b = m.group(1)
        if not b:
            return "&"
        b = b.replace(",", "/")
        return base64.b64decode(b + "=" * (-len(b) % 4)).decode("utf-16-be")
    return re.sub(r"&([^-]*)-", dec, s)


def imap_quote(name):
    return '"' + mutf7_encode(name).replace("\\", "\\\\").replace('"', '\\"') + '"'


def ssl_context():
    ctx = ssl.create_default_context()
    # the bundled Python may not know where macOS keeps its root certificates
    for cafile in ("/etc/ssl/cert.pem",):
        if os.path.exists(cafile):
            try:
                ctx.load_verify_locations(cafile)
            except (ssl.SSLError, OSError):
                pass
    if ctx.cert_store_stats().get("x509_ca", 0) == 0 and os.path.exists("/usr/bin/security"):
        pem = os.path.join(DATA, "runtime", "macos-roots.pem")
        if not os.path.exists(pem):
            os.makedirs(os.path.dirname(pem), exist_ok=True)
            r = subprocess.run(["/usr/bin/security", "find-certificate", "-a", "-p",
                                "/System/Library/Keychains/SystemRootCertificates.keychain"], capture_output=True, timeout=30)
            if r.returncode == 0 and r.stdout:
                with open(pem, "wb") as fh:
                    fh.write(r.stdout)
        if os.path.exists(pem):
            ctx.load_verify_locations(pem)
    return ctx


class MailError(Exception):
    pass


def imap_connect(address):
    pw = kc_get(address)
    if not pw:
        raise MailError("No app password saved for this address. Add it in Email settings.")
    host = os.environ.get("DEALDESK_IMAP_HOST", "imap.gmail.com")
    port = int(os.environ.get("DEALDESK_IMAP_PORT", "993"))
    try:
        if os.environ.get("DEALDESK_IMAP_PLAIN"):  # tests only (local fake server)
            con = imaplib.IMAP4(host, port)
        else:
            con = imaplib.IMAP4_SSL(host, port, ssl_context=ssl_context(), timeout=30)
    except (OSError, ssl.SSLError) as e:
        raise MailError(f"Could not reach Gmail ({e}). Check the internet connection.")
    try:
        con.login(address, pw.replace(" ", ""))
    except imaplib.IMAP4.error as e:
        raise MailError("Gmail refused the login. Check the address and the app password, and that IMAP is enabled in Gmail settings. (" +
                        str(e)[:120] + ")")
    return con


LIST_RE = re.compile(rb'\((?P<flags>[^)]*)\) (?P<delim>"(?:[^"\\]|\\.)*"|NIL) (?P<name>.*)$')


def imap_list(con):
    """[(name, flags)] with names decoded from modified UTF-7."""
    typ, data = con.list()
    out = []
    pending = None
    for item in data or []:
        if isinstance(item, tuple):  # name sent as a literal
            m = LIST_RE.match(item[0].split(b"{")[0].rstrip() + b" X")
            if m:
                out.append((mutf7_decode(item[1].decode("utf-8", "replace")), m.group("flags").decode()))
            continue
        if not item:
            continue
        m = LIST_RE.match(item)
        if not m:
            continue
        raw = m.group("name").strip()
        if raw.startswith(b'"') and raw.endswith(b'"'):
            raw = raw[1:-1].replace(b'\\"', b'"').replace(b"\\\\", b"\\")
        out.append((mutf7_decode(raw.decode("utf-8", "replace")), m.group("flags").decode()))
    return out


def examine(con, mailbox):
    typ, data = con.select(imap_quote(mailbox), readonly=True)  # EXAMINE: read-only
    if typ != "OK":
        raise MailError(f"Could not open {mailbox}")
    uv = con.response("UIDVALIDITY")[1]
    return int(uv[0]) if uv and uv[0] else 0


def uid_search(con, *criteria):
    typ, data = con.uid("SEARCH", None, *criteria)
    if typ != "OK" or not data or not data[0]:
        return []
    return [int(x) for x in data[0].split()]


def uid_ranges(uids):
    uids = sorted(uids)
    out, start, prev = [], None, None
    for u in uids:
        if start is None:
            start = prev = u
        elif u == prev + 1:
            prev = u
        else:
            out.append(f"{start}:{prev}" if start != prev else str(start))
            start = prev = u
    if start is not None:
        out.append(f"{start}:{prev}" if start != prev else str(start))
    return ",".join(out)


def parse_fetch(data):
    """imaplib FETCH data → list of dicts {uid, msgid, thrid, header, text, meta}."""
    msgs, cur = [], None
    for item in data or []:
        meta = item[0] if isinstance(item, tuple) else item
        if not isinstance(meta, (bytes, bytearray)):
            continue
        if re.match(rb"^\d+ \(", meta):
            cur = {"meta": b"", "header": b"", "text": b""}
            msgs.append(cur)
        if cur is None:
            continue
        cur["meta"] += meta + b" "
        if isinstance(item, tuple):
            if b"BODY[HEADER]" in meta:
                cur["header"] = item[1]
            elif b"BODY[TEXT]" in meta:
                cur["text"] = item[1]
    for m in msgs:
        meta = m["meta"]
        for k, pat in (("uid", rb"UID (\d+)"), ("msgid", rb"X-GM-MSGID (\d+)"), ("thrid", rb"X-GM-THRID (\d+)")):
            r = re.search(pat, meta)
            m[k] = r.group(1).decode() if r else None
        if m["uid"]:
            m["uid"] = int(m["uid"])
        names = re.findall(rb'"(?:FILENAME|NAME|filename|name)" "((?:[^"\\]|\\.)*)"', meta)
        m["bsnames"] = [decode_words(n.decode("utf-8", "replace")) for n in names]
    return msgs


def decode_words(s):
    try:
        return str(email.header.make_header(email.header.decode_header(s)))
    except Exception:
        return s


def html_to_text(h):
    h = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", "", h)
    h = re.sub(r"(?i)<br\s*/?>", "\n", h)
    h = re.sub(r"(?i)</(p|div|tr|li|h\d|blockquote)>", "\n", h)
    h = re.sub(r"(?i)<blockquote[^>]*>", "\n> ", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = htmlmod.unescape(h)
    h = re.sub(r"[ \t\xa0]+\n", "\n", h)
    return re.sub(r"\n{3,}", "\n\n", h).strip()


def parse_message(header, text, bsnames):
    msg = email.message_from_bytes(header + b"\r\n" + text, policy=email.policy.default)
    body_plain, body_html, atts = None, None, []
    for part in msg.walk():
        if part.is_multipart():
            continue
        fn = part.get_filename()
        disp = (part.get("Content-Disposition") or "").lower()
        ctype = part.get_content_type()
        if fn or disp.startswith("attachment"):
            if fn:
                atts.append(decode_words(fn))
            continue
        try:
            content = part.get_content()
        except Exception:
            try:
                content = (part.get_payload(decode=True) or b"").decode("utf-8", "replace")
            except Exception:
                content = ""
        if not isinstance(content, str):
            continue
        if ctype == "text/plain" and body_plain is None:
            body_plain = content
        elif ctype == "text/html" and body_html is None:
            body_html = content
    body = body_plain if body_plain and body_plain.strip() else html_to_text(body_html or "")
    for n in bsnames:
        if n and n not in atts:
            atts.append(n)
    frm = email.utils.parseaddr(str(msg.get("From") or ""))
    try:
        d = email.utils.parsedate_to_datetime(str(msg.get("Date")))
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        date = d.astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    except Exception:
        date = now()
    addrs = lambda h: ", ".join(f"{n} <{a}>" if n else a for n, a in email.utils.getaddresses([str(x) for x in msg.get_all(h, [])]))
    return {"date": date, "from_addr": (frm[1] or "").lower(), "from_name": decode_words(frm[0] or ""), "to_addrs": addrs("To"),
            "cc_addrs": addrs("Cc"), "subject": decode_words(str(msg.get("Subject") or "")), "body": (body or "").replace("\r\n", "\n")[:200_000],
            "attachments": json.dumps(atts)}


FETCH_ITEMS = f"(UID X-GM-MSGID X-GM-THRID BODYSTRUCTURE BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.{TEXT_LIMIT}>)"


def fetch_store(con, imap, uids, initial):
    """Fetch new messages by UID (current mailbox) and store the ones not stored yet. Returns {uid: msgid}.
    Network reads happen outside the database lock; each batch of 20 is written in one short transaction."""
    got = {}
    uids = sorted(uids)
    for i in range(0, len(uids), 20):
        typ, data = imap.uid("FETCH", uid_ranges(uids[i:i + 20]), FETCH_ITEMS)
        if typ != "OK":
            continue
        rows = []
        for m in parse_fetch(data):
            if not m["uid"] or not m["msgid"]:
                continue
            got[m["uid"]] = m["msgid"]
            r = parse_message(m["header"], m["text"], m["bsnames"])
            rows.append((m["msgid"], m["thrid"], r["date"], r["from_addr"], r["from_name"], r["to_addrs"], r["cc_addrs"], r["subject"],
                         r["body"], r["attachments"], 1 if initial else 0, now()))
        with LOCK, con:
            con.executemany("""INSERT OR IGNORE INTO mail_messages (gm_msgid, thrid, date, from_addr, from_name, to_addrs, cc_addrs, subject, body, attachments, initial, fetched_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
    return got


def norm_name(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("ł", "l").replace("ø", "o")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def match_label(name, labels):
    """Best Gmail label for a project name. Compares the last part of each label (after the last "/"), ignoring
    accents, case and punctuation, so "New deals/Tarnowskie Gory" matches "Tarnowskie Góry castle complex" and the
    match survives moving the label between parent folders. Exact matches beat prefix matches; the longest wins."""
    full, short = norm_name(name), norm_name((name or "").split(",")[0])
    best, score = None, 0
    for lb in labels:
        leaf = norm_name(lb.split("/")[-1])
        if len(leaf) < 2:
            continue
        sc = 0
        if leaf in (full, short):
            sc = 1000 + len(leaf)
        elif len(leaf) >= 4 and (full.startswith(leaf + " ") or short.startswith(leaf + " ")):
            sc = 500 + len(leaf)
        elif len(short) >= 4 and leaf.startswith(short + " "):
            sc = 300 + len(short)
        if sc > score:
            best, score = lb, sc
    return best


def project_labels(con, labels=None):
    """{project id: label}. inputs.gmailLabel wins; otherwise the label that matches the project name (see match_label)."""
    names = labels if labels is not None else json.loads(meta_get(con, "mail_label_list", "[]") or "[]")
    out = {}
    for r in con.execute("SELECT p.id, p.name, i.gmail_label FROM projects p LEFT JOIN project_inputs i ON i.project_id = p.id"):
        if r["gmail_label"]:
            out[r["id"]] = r["gmail_label"]
            continue
        m = match_label(r["name"], names)
        if m:
            out[r["id"]] = m
    return out


def msg_count(con):
    return con.execute("SELECT COUNT(*) FROM mail_messages").fetchone()[0]


def mail_refresh():
    """Sync every label linked to a project. Only new messages are fetched. Read-only on the Gmail side."""
    with MAIL_LOCK:
        con = connect()
        try:
            address = meta_get(con, "mail_address")
            if not address:
                raise MailError("Add your Gmail address and app password in Email settings first.")
            imap = imap_connect(address)
            before = msg_count(con)
            stats = {"labels": 0}
            try:
                boxes = imap_list(imap)
                labels = sorted(n for n, f in boxes if "\\Noselect" not in f and not n.startswith("[Gmail]") and n != "INBOX")
                allmail = next((n for n, f in boxes if "\\All" in f), "[Gmail]/All Mail")
                with LOCK, con:
                    meta_set(con, "mail_label_list", json.dumps(labels))
                links = project_labels(con, labels)
                expand = set()
                cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=EXPAND_DAYS)).isoformat(timespec="seconds")
                for label in sorted(set(links.values())):
                    if label not in labels:
                        continue
                    stats["labels"] += 1
                    uv = examine(imap, label)
                    uids = set(uid_search(imap, "ALL"))
                    first = not con.execute("SELECT 1 FROM meta WHERE key=?", ("mail_synced:" + label,)).fetchone()
                    with LOCK, con:
                        con.execute("DELETE FROM mail_labels WHERE label=? AND uidvalidity<>?", (label, uv))
                        known = {r["uid"] for r in con.execute("SELECT uid FROM mail_labels WHERE label=?", (label,))}
                        gone = known - uids
                        if gone:
                            con.executemany("DELETE FROM mail_labels WHERE label=? AND uid=?", [(label, u) for u in gone])
                    got = fetch_store(con, imap, uids - known, first)
                    with LOCK, con:
                        con.executemany("INSERT OR REPLACE INTO mail_labels (label, uidvalidity, uid, gm_msgid) VALUES (?, ?, ?, ?)",
                                        [(label, uv, u, mid) for u, mid in got.items()])
                        if first:
                            meta_set(con, "mail_synced:" + label, now())
                    for r in con.execute("""SELECT m.thrid, MAX(m.date) d FROM mail_labels l JOIN mail_messages m ON m.gm_msgid = l.gm_msgid
                                            WHERE l.label=? GROUP BY m.thrid""", (label,)).fetchall():
                        if r["d"] and r["d"] >= cutoff:
                            expand.add((r["thrid"], first))
                # complete threads from All Mail, so your own replies (and messages outside the label) count
                if expand:
                    uv = examine(imap, allmail)
                    with LOCK, con:
                        con.execute("DELETE FROM mail_allmail WHERE uidvalidity<>?", (uv,))
                    known = {r["uid"] for r in con.execute("SELECT uid FROM mail_allmail")}
                    for thrid, first in sorted(expand):
                        new = set(uid_search(imap, "X-GM-THRID", thrid)) - known
                        if not new:
                            continue
                        got = {}
                        typ, data = imap.uid("FETCH", uid_ranges(new), "(UID X-GM-MSGID)")  # ids first; bodies only for messages not stored yet
                        for m in parse_fetch(data if typ == "OK" else []):
                            if m["uid"] and m["msgid"] and con.execute("SELECT 1 FROM mail_messages WHERE gm_msgid=?", (m["msgid"],)).fetchone():
                                got[m["uid"]] = m["msgid"]
                        got.update(fetch_store(con, imap, new - set(got), first))
                        with LOCK, con:
                            con.executemany("INSERT OR REPLACE INTO mail_allmail (uidvalidity, uid, gm_msgid) VALUES (?, ?, ?)",
                                            [(uv, u, mid) for u, mid in got.items()])
                        known |= set(got)
                # first sync: quiet threads start as handled, so old mail does not show up as "reply owed"
                with LOCK, con:
                    old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=HANDLED_AFTER_DAYS)).isoformat(timespec="seconds")
                    for r in con.execute("""SELECT thrid, MAX(date) d FROM mail_messages WHERE thrid IN
                                            (SELECT thrid FROM mail_messages GROUP BY thrid HAVING MIN(initial) = 1) GROUP BY thrid""").fetchall():
                        if r["d"] and r["d"] < old and not con.execute("SELECT 1 FROM mail_threads WHERE thrid=?", (r["thrid"],)).fetchone():
                            con.execute("INSERT INTO mail_threads (thrid, handled_at) VALUES (?, ?)", (r["thrid"], r["d"]))
                    meta_set(con, "mail_last_refresh", now())
                    meta_set(con, "mail_last_error", "")
            finally:
                try:
                    imap.logout()
                except Exception:
                    pass
            stats["new"] = msg_count(con) - before
            return stats
        except MailError as e:
            with LOCK, con:
                meta_set(con, "mail_last_error", str(e))
            raise
        finally:
            con.close()


# --- thread status
def workdays_between(a, b):
    """Working days (Mon–Fri) from date a to date b: Monday → Wednesday = 2."""
    if b <= a:
        return 0
    n, d = 0, a
    while d < b:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def local_date(iso):
    try:
        return dt.datetime.fromisoformat(iso).astimezone().date()
    except Exception:
        return dt.date.today()


def my_addresses(con):
    a = [meta_get(con, "mail_address") or ""] + [x.strip() for x in (meta_get(con, "mail_aliases") or "").split(",")]
    return {x.lower() for x in a if x}


def gmail_link(address, thrid):
    try:
        return f"https://mail.google.com/mail/?authuser={quote(address or '')}#all/{int(thrid):x}"
    except ValueError:
        return "https://mail.google.com/"


def thread_summary(con, thrid, me, address, today=None):
    msgs = con.execute("SELECT gm_msgid, date, from_addr, from_name, to_addrs, cc_addrs, subject, initial, fetched_at FROM mail_messages WHERE thrid=? ORDER BY date, gm_msgid", (thrid,)).fetchall()
    if not msgs:
        return None
    st = con.execute("SELECT * FROM mail_threads WHERE thrid=?", (thrid,)).fetchone()
    st = dict(st) if st else {}
    today = today or dt.date.today()
    last = msgs[-1]
    incoming = [m for m in msgs if m["from_addr"] not in me]
    last_in = incoming[-1] if incoming else None
    if st.get("handled_at") and (not last_in or last_in["date"] <= st["handled_at"]):
        status = "handled"
    elif st.get("waiting_set_at") and (not last_in or last_in["date"] <= st["waiting_set_at"]):
        status = "waiting"
    elif last["from_addr"] in me:
        status = "waiting"
    elif workdays_between(local_date(last["date"]), today) >= 2:
        status = "reply owed"
    else:
        status = "new"
    unseen = any(not m["initial"] and (not st.get("seen_at") or (m["fetched_at"] or "") > st["seen_at"]) for m in incoming)
    people = []
    for m in msgs:
        n = m["from_name"] or m["from_addr"]
        if m["from_addr"] in me:
            n = "me"
        if n and n not in people:
            people.append(n)
    subj = next((m["subject"] for m in msgs if m["subject"]), "(no subject)")
    explicit_wait = bool(st.get("waiting_set_at")) and status == "waiting" and (not last_in or last_in["date"] <= st["waiting_set_at"])
    return {"thrid": thrid, "subject": subj, "people": people, "count": len(msgs), "lastDate": last["date"], "lastFrom": "me" if last["from_addr"] in me else (last["from_name"] or last["from_addr"]),
            "status": status, "unseen": unseen, "waitingFor": st.get("waiting_for") if explicit_wait else ("reply from " + (people[0] if people and people[0] != "me" else "them") if status == "waiting" else None),
            "waitingUntil": st.get("waiting_until") if explicit_wait else None, "handledAt": st.get("handled_at"), "todo": st.get("todo_text"),
            "link": gmail_link(address, thrid)}


def project_threads(con, pid, links=None):
    links = links if links is not None else project_labels(con)
    label = links.get(pid)
    if not label:
        return label, []
    me, address = my_addresses(con), meta_get(con, "mail_address")
    thrids = [r["thrid"] for r in con.execute("""SELECT DISTINCT m.thrid FROM mail_labels l JOIN mail_messages m ON m.gm_msgid = l.gm_msgid WHERE l.label=?""", (label,))]
    out = [t for t in (thread_summary(con, x, me, address) for x in thrids) if t]
    out.sort(key=lambda t: t["lastDate"] or "", reverse=True)
    return label, out


def mail_overview():
    con = connect()
    try:
        links = project_labels(con)
        res = {"configured": bool(meta_get(con, "mail_address")), "lastRefresh": meta_get(con, "mail_last_refresh"),
               "lastError": meta_get(con, "mail_last_error") or "", "projects": {}, "owed": [], "waitingDue": []}
        today = dt.date.today().isoformat()
        for pid in links:
            label, ts = project_threads(con, pid, links)
            res["projects"][pid] = {"label": label, "threads": len(ts), "new": sum(1 for t in ts if t["unseen"]),
                                    "owed": sum(1 for t in ts if t["status"] == "reply owed")}
            for t in ts:
                if t["status"] == "reply owed":
                    res["owed"].append(dict(t, project=pid))
                if t["status"] == "waiting" and t["waitingUntil"] and t["waitingUntil"] <= today:
                    res["waitingDue"].append(dict(t, project=pid))
        return res
    finally:
        con.close()


def thread_messages(con, thrid):
    rows = con.execute("SELECT * FROM mail_messages WHERE thrid=? ORDER BY date, gm_msgid", (thrid,)).fetchall()
    me = my_addresses(con)
    return [{"id": r["gm_msgid"], "date": r["date"], "from": r["from_name"] or r["from_addr"], "fromAddr": r["from_addr"], "me": r["from_addr"] in me,
             "to": r["to_addrs"], "cc": r["cc_addrs"], "subject": r["subject"], "body": r["body"] or "", "attachments": json.loads(r["attachments"] or "[]")}
            for r in rows]


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "DealDesk/2.0"

    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def raw_body(self, limit=10 * 1024 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ValueError("too large")
        return self.rfile.read(n) if n else b""

    def body(self):
        return json.loads(self.raw_body() or b"{}")

    def same_origin(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        origin = self.headers.get("Origin")
        return host in ("127.0.0.1", "localhost") and (origin is None or urlparse(origin).hostname in ("127.0.0.1", "localhost"))

    def send_file(self, fp, ctype, disposition=None):
        size = os.path.getsize(fp)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        if disposition:
            self.send_header("Content-Disposition", disposition)
        self.end_headers()
        with open(fp, "rb") as fh:
            while True:
                chunk = fh.read(1 << 16)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def handle_one_request(self):
        LAST_SEEN[0] = time.time()
        return super().handle_one_request()

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/api/ping":
            return self.send_json({"ok": True, "app": "deal-desk", "version": APP_VERSION})
        if path in STATIC:
            fn, ctype = STATIC[path]
            fp = os.path.join(HERE, fn)
            if not os.path.exists(fp):
                return self.send_json({"error": f"{fn} missing"}, 404)
            return self.send_file(fp, ctype)
        if not self.same_origin():
            return self.send_json({"error": "forbidden"}, 403)
        if path == "/api/fx":
            return self.send_json(ecb_rates())
        if path.startswith("/api/mail/"):
            return self.mail_get(path, parse_qs(url.query))
        if path == "/api/projects":
            if not DRIVE:
                return self.send_json({"error": NO_DRIVE}, 503)
            drive_sync()   # first: the Inbox import needs to know who holds which deal now
            auto_import()  # picks up files dropped into the Inbox while the app is running
            SYNC["conflicts"].clear()  # the app reloads the drive's version, so editing can continue from it
            return self.send_json(all_projects())
        if path == "/api/locks":  # polled by the app: who holds what, and the latest drive rev of every deal
            con = connect()
            revs = {r["key"][7:]: int(r["value"]) for r in con.execute("SELECT key, value FROM meta WHERE key LIKE 'extrev:%'")}
            con.close()
            return self.send_json({"me": ME, "locks": {pid: public_lock(c) for pid, c in SYNC["locks"].items()}, "revs": revs, "storage": drive_status(),
                                   "update": update_status()})
        m = re.match(r"^/api/projects/([^/]+)/documents$", path)
        if m:
            root = docs_root(m.group(1))
            return self.send_json({"documents": list_documents(m.group(1)), "categories": DOC_CATEGORIES,
                                   "folder": os.path.relpath(root, DRIVE) if root else None})
        m = re.match(r"^/api/projects/([^/]+)$", path)
        if m:
            got = [p for p in all_projects() if p["id"] == m.group(1)]
            return self.send_json(got[0]) if got else self.send_json({"error": "not found"}, 404)
        if path == "/api/info":
            backups = sorted(os.listdir(BACKUP_DIR)) if os.path.isdir(BACKUP_DIR) else []
            return self.send_json({"db": DB_PATH, "size": os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0,
                                   "backups": len(backups), "lastBackup": backups[-1] if backups else None, "schema": SCHEMA_VERSION,
                                   "storage": drive_status()})
        m = re.match(r"^/api/projects/([^/]+)/(versions)$", path)
        if m:
            pid, what = m.group(1), m.group(2)
            con = connect()
            try:
                rows = [{"id": r["id"], "label": r["label"], "createdAt": r["created_at"], "data": json.loads(r["data"]),
                             "metrics": json.loads(r["metrics"] or "null"), "parentId": r["parent_id"], "updatedAt": r["updated_at"] or r["created_at"]}
                            for r in con.execute("SELECT * FROM versions WHERE project_id=? ORDER BY created_at DESC, id DESC", (pid,))]
            finally:
                con.close()
            return self.send_json(rows)
        self.send_json({"error": "not found"}, 404)

    # ---- email (read-only Gmail)
    def mail_get(self, path, q):
        con = connect()
        try:
            if path == "/api/mail/settings":
                a = meta_get(con, "mail_address") or ""
                return self.send_json({"address": a, "aliases": meta_get(con, "mail_aliases") or "", "hasPassword": bool(a and kc_get(a)),
                                       "keychain": kc_available(), "lastRefresh": meta_get(con, "mail_last_refresh"),
                                       "lastError": meta_get(con, "mail_last_error") or ""})
            if path == "/api/mail/labels":
                return self.send_json({"labels": json.loads(meta_get(con, "mail_label_list", "[]") or "[]"), "links": project_labels(con)})
            if path == "/api/mail/overview":
                con.close()
                return self.send_json(mail_overview())
            m = re.match(r"^/api/mail/project/([^/]+)$", path)
            if m:
                label, threads = project_threads(con, m.group(1))
                sm = con.execute("SELECT text, date, created_at FROM mail_summaries WHERE project_id=? ORDER BY COALESCE(date, created_at) DESC, id DESC LIMIT 1",
                                 (m.group(1),)).fetchone()
                return self.send_json({"label": label, "threads": threads, "summary": dict(sm) if sm else None,
                                       "configured": bool(meta_get(con, "mail_address")), "lastRefresh": meta_get(con, "mail_last_refresh"),
                                       "lastError": meta_get(con, "mail_last_error") or ""})
            m = re.match(r"^/api/mail/thread/(\d+)$", path)
            if m:
                t = thread_summary(con, m.group(1), my_addresses(con), meta_get(con, "mail_address"))
                return self.send_json({"thread": t, "messages": thread_messages(con, m.group(1))})
            if path == "/api/mail/find":  # source tag "Email" → thread containing the snippet
                pid, needle = (q.get("pid") or [""])[0], (q.get("q") or [""])[0].strip()
                label, threads = project_threads(con, pid)
                ids = [t["thrid"] for t in threads]
                hit = None
                if needle and ids:
                    words = re.sub(r"\s+", " ", needle.lower())
                    for r in con.execute(f"SELECT thrid, body, subject FROM mail_messages WHERE thrid IN ({','.join('?' * len(ids))}) ORDER BY date DESC", ids):
                        if words in re.sub(r"\s+", " ", ((r["subject"] or "") + " " + (r["body"] or "")).lower()):
                            hit = r["thrid"]
                            break
                return self.send_json({"thrid": hit})
            return self.send_json({"error": "not found"}, 404)
        finally:
            try:
                con.close()
            except Exception:
                pass

    def mail_post(self, path, b):
        if path == "/api/mail/refresh":
            try:
                return self.send_json(dict(ok=True, **mail_refresh()))
            except MailError as e:
                return self.send_json({"ok": False, "error": str(e)})
            except Exception as e:  # network trouble etc.
                con = connect()
                with LOCK, con:
                    meta_set(con, "mail_last_error", f"Refresh failed: {e}")
                con.close()
                return self.send_json({"ok": False, "error": f"Refresh failed: {e}"})
        if path == "/api/mail/test":
            con = connect()
            a = meta_get(con, "mail_address")
            con.close()
            try:
                imap = imap_connect(a or "")
                n = len(imap_list(imap))
                imap.logout()
                return self.send_json({"ok": True, "message": f"Connected. {n} labels and folders found."})
            except MailError as e:
                return self.send_json({"ok": False, "error": str(e)})
            except Exception as e:
                return self.send_json({"ok": False, "error": str(e)})
        m = re.match(r"^/api/mail/thread/(\d+)$", path)
        if m:
            t, act = m.group(1), b.get("action")
            con = connect()
            with LOCK, con:
                if not con.execute("SELECT 1 FROM mail_threads WHERE thrid=?", (t,)).fetchone():
                    con.execute("INSERT INTO mail_threads (thrid) VALUES (?)", (t,))
                if act == "seen":
                    con.execute("UPDATE mail_threads SET seen_at=? WHERE thrid=?", (now(), t))
                elif act == "handled":
                    con.execute("UPDATE mail_threads SET handled_at=?, waiting_set_at=NULL, waiting_for=NULL, waiting_until=NULL, seen_at=? WHERE thrid=?", (now(), now(), t))
                elif act == "reopen":
                    con.execute("UPDATE mail_threads SET handled_at=NULL, waiting_set_at=NULL, waiting_for=NULL, waiting_until=NULL WHERE thrid=?", (t,))
                elif act == "waiting":
                    con.execute("UPDATE mail_threads SET waiting_for=?, waiting_until=?, waiting_set_at=?, handled_at=NULL WHERE thrid=?",
                                (str(b.get("waitingFor") or "")[:300], str(b.get("waitingUntil") or "")[:10] or None, now(), t))
                elif act == "todo":
                    con.execute("UPDATE mail_threads SET todo_text=? WHERE thrid=?", (str(b.get("text") or "")[:500], t))
                else:
                    con.close()
                    return self.send_json({"error": "unknown action"}, 400)
            con.close()
            return self.send_json({"ok": True})
        return self.send_json({"error": "not found"}, 404)

    def do_PUT(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send_json({"error": "forbidden"}, 403)
        if path == "/api/mail/settings":
            try:
                b = self.body()
            except ValueError:
                return self.send_json({"error": "bad json"}, 400)
            con = connect()
            try:
                old = meta_get(con, "mail_address") or ""
                addr = str(b.get("address") or "").strip().lower()
                if addr and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", addr):
                    return self.send_json({"ok": False, "error": "That does not look like an email address."})
                pw = str(b.get("password") or "").strip()
                if pw:
                    if not kc_available():
                        return self.send_json({"ok": False, "error": "The macOS Keychain is not available."})
                    kc_set(addr, pw)
                elif addr != old and old and kc_get(old) and addr:
                    kc_set(addr, kc_get(old))
                if b.get("forget") and addr:
                    kc_delete(addr)
                with LOCK, con:
                    meta_set(con, "mail_address", addr)
                    meta_set(con, "mail_aliases", str(b.get("aliases") or "").strip())
                return self.send_json({"ok": True, "hasPassword": bool(addr and kc_get(addr))})
            except (RuntimeError, OSError, subprocess.SubprocessError) as e:
                return self.send_json({"ok": False, "error": str(e)})
            finally:
                con.close()
        m = re.match(r"^/api/projects/([^/]+)$", path)
        if m:
            pid = m.group(1)
            if not ID_OK.match(pid):
                return self.send_json({"error": "bad id"}, 400)
            try:
                p = self.body()
            except ValueError:
                return self.send_json({"error": "bad json"}, 400)
            if not DRIVE:
                return self.send_json({"error": "Not saved – " + NO_DRIVE}, 503)
            if is_new(pid) and pid not in SYNC["locks"]:
                c = {"user": ME, "claimedAt": precise_now(), "confirmedAt": now(), "lastActive": now(), "mac": os.uname().nodename, "confirmed": True}
                SYNC["newlocks"][pid] = SYNC["locks"][pid] = c
            refusal = edit_refusal(pid)
            if refusal:
                kept = keep_unsaved(pid, p)
                return self.send_json({"error": "Not saved – " + refusal + (f" What you typed is kept in {kept} in the deal's folder." if kept else ""),
                                       "lock": public_lock(SYNC["locks"].get(pid))}, 423)
            if pid not in SYNC["conflicts"]:
                stale_save(pid, p.get("_base"))
            p.pop("_base", None)
            if pid in SYNC["conflicts"]:
                c = SYNC["conflicts"][pid]
                try:  # the conflict copy always holds this Mac's latest state, so nothing typed is lost
                    write_atomic(c["file"], dumps(dict(p, id=pid, savedBy=ME, savedAt=now())))
                except OSError:
                    pass
                return self.send_json({"error": conflict_message(pid)}, 409)
            con = connect()
            try:
                with LOCK, con:
                    save_project(con, pid, p)
            except sqlite3.Error as e:
                return self.send_json({"error": str(e)}, 500)
            finally:
                con.close()
            return self.send_json({"ok": True, "id": pid})
        m = re.match(r"^/api/versions/(\d+)$", path)
        if m:
            try:
                b = self.body()
            except ValueError:
                return self.send_json({"error": "bad json"}, 400)
            con = connect()
            with LOCK, con:
                vid = int(m.group(1))
                owner = con.execute("SELECT project_id FROM versions WHERE id=?", (vid,)).fetchone()
                if owner and edit_refusal(owner["project_id"]):
                    con.close()
                    return self.send_json({"error": "Not saved – " + edit_refusal(owner["project_id"])}, 423)
                if owner:
                    drive_touch(owner["project_id"])
                if "data" in b:
                    con.execute("UPDATE versions SET data=?, metrics=?, updated_at=? WHERE id=?", (json.dumps(b.get("data") or {}), json.dumps(b.get("metrics")), now(), vid))
                if b.get("label"):
                    con.execute("UPDATE versions SET label=? WHERE id=?", (str(b["label"]).strip()[:120], vid))
            con.close()
            return self.send_json({"ok": True})
        self.send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send_json({"error": "forbidden"}, 403)
        m = re.match(r"^/api/projects/([^/]+)/lock$", path)
        if m:
            release_lock(m.group(1))
            return self.send_json({"ok": True})
        m = re.match(r"^/api/projects/([^/]+)$", path)
        if m:
            pid = m.group(1)
            if edit_refusal(pid):
                return self.send_json({"error": "Not deleted – " + edit_refusal(pid)}, 423)
            con = connect()
            with LOCK, con:
                row = con.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
                con.execute("DELETE FROM projects WHERE id=?", (pid,))
                con.execute("INSERT INTO activity (project_id, project_name, action, at, user) VALUES (?, ?, 'deleted', ?, ?)",
                            (pid, row["name"] if row else None, now(), ME))
            con.close()
            drive_touch(pid)  # the next sync moves its folder to Deals/_deleted
            return self.send_json({"ok": True})
        m = re.match(r"^/api/versions/(\d+)$", path)
        if m:
            con = connect()
            with LOCK, con:
                owner = con.execute("SELECT project_id FROM versions WHERE id=?", (int(m.group(1)),)).fetchone()
                if owner and edit_refusal(owner["project_id"]):
                    con.close()
                    return self.send_json({"error": "Not deleted – " + edit_refusal(owner["project_id"])}, 423)
                con.execute("DELETE FROM versions WHERE id=?", (int(m.group(1)),))
            con.close()
            if owner:
                drive_touch(owner["project_id"])
            return self.send_json({"ok": True})
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        if not self.same_origin():
            return self.send_json({"error": "forbidden"}, 403)
        if path.startswith("/api/mail/"):
            try:
                b = self.body()
            except ValueError:
                b = {}
            return self.mail_post(path, b)
        if path == "/api/backup":
            with LOCK:
                dest = backup("manual")
            return self.send_json({"ok": True, "file": os.path.relpath(dest, DATA)})
        if path == "/api/restart":
            if not os.environ.get("DEALDESK_LAUNCHER"):
                return self.send_json({"error": "Close the browser tab and open Deal Desk again to update."}, 400)
            restart_via_launcher()
            return self.send_json({"ok": True})
        if path == "/api/storage/sync":
            drive_sync(force=True)
            return self.send_json(dict(ok=not SYNC["error"], **drive_status()))
        m = re.match(r"^/api/projects/([^/]+)/documents/open$", path)
        if m:
            try:
                b = self.body()
            except ValueError:
                return self.send_json({"error": "bad json"}, 400)
            fp = doc_path(m.group(1), str(b.get("path") or ""))
            if not fp:
                return self.send_json({"error": "That file is not in this deal's Documents folder (moved or renamed?)."}, 404)
            cmd = ["/usr/bin/open"] + (["-R"] if b.get("reveal") else []) + [fp]
            if not os.environ.get("DEALDESK_NO_OPEN"):  # tests check the path without opening Finder
                subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return self.send_json({"ok": True, "opened": os.path.relpath(fp, DRIVE), "reveal": bool(b.get("reveal"))})
        m = re.match(r"^/api/projects/([^/]+)/documents$", path)
        if m:
            q = parse_qs(url.query)
            n = int(self.headers.get("Content-Length") or 0)
            if n > UPLOAD_LIMIT:
                return self.send_json({"error": f"Files over {UPLOAD_LIMIT // 2**20} MB: copy them into the deal's Documents folder in Finder."}, 413)
            root = docs_root(m.group(1), create=True)
            if not root:
                return self.send_json({"error": "save the project first"}, 409)
            cat = safe_name(re.sub(r"\s*/\s*", ", ", (q.get("category") or ["Other"])[0] or "Other"))
            dest = unique_path(os.path.join(root, cat, safe_name((q.get("name") or ["file"])[0])))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            tmp = os.path.join(os.path.dirname(dest), f".{os.path.basename(dest)}.part")  # hidden until complete
            with open(tmp, "wb") as fh:
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    fh.write(chunk)
                    left -= len(chunk)
            if left:
                os.remove(tmp)
                return self.send_json({"error": "upload interrupted"}, 400)
            os.replace(tmp, dest)
            return self.send_json({"ok": True, "path": os.path.relpath(dest, root)})
        m = re.match(r"^/api/projects/([^/]+)/lock$", path)
        if m:
            pid = m.group(1)
            try:
                b = self.body()
            except ValueError:
                b = {}
            drive_sync()
            ok, c = claim_lock(pid, force=bool(b.get("force")))
            if not ok:
                return self.send_json({"error": f"{c['user']} is editing this deal." if c else "This deal is not on the shared drive yet.",
                                       "lock": public_lock(c)}, 409)
            drive_sync()  # start editing from the latest copy on the drive
            got = [p for p in all_projects() if p["id"] == pid]
            return self.send_json({"ok": True, "lock": public_lock(c), "project": got[0] if got else None})
        m = re.match(r"^/api/projects/([^/]+)/versions$", path)
        if m:
            try:
                b = self.body()
            except ValueError:
                return self.send_json({"error": "bad json"}, 400)
            if edit_refusal(m.group(1)):
                return self.send_json({"error": "Not saved – " + edit_refusal(m.group(1))}, 423)
            con = connect()
            with LOCK, con:
                if not con.execute("SELECT 1 FROM projects WHERE id=?", (m.group(1),)).fetchone():
                    con.close()
                    return self.send_json({"error": "save the project first"}, 409)
                vid = new_version_id()
                con.execute("INSERT INTO versions (id, project_id, label, created_at, data, metrics, parent_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (vid, m.group(1), (b.get("label") or "Version").strip()[:120], now(), json.dumps(b.get("data") or {}),
                             json.dumps(b.get("metrics")), b.get("parentId"), now()))
            con.close()
            drive_touch(m.group(1))
            return self.send_json({"ok": True, "id": vid})
        self.send_json({"error": "not found"}, 404)


def main():
    ap = argparse.ArgumentParser(description="InRento Deal Desk")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--import", dest="imp", metavar="JSON")
    ap.add_argument("--idle-exit", type=float, default=0, metavar="MIN", help="stop after MIN minutes with no open app window")
    ap.add_argument("--init-drive", metavar="FOLDER", help="set up FOLDER (e.g. a Google Shared Drive) as the shared deal folder, then exit")
    ap.add_argument("--migrate-from", metavar="FOLDER", help="move the deals of a pre-drive data folder (with deals.sqlite) to the shared folder, then exit")
    ap.add_argument("--as-user", default="Tautvydas", help="with --migrate-from: who old activity is credited to")
    ap.add_argument("--dry-run", action="store_true", help="with --migrate-from: only report what would move")
    ap.add_argument("--with-mail", action="store_true", help="with --migrate-from: also load that folder's Gmail cache into this Mac's index")
    ap.add_argument("--replace", action="store_true", help="with --migrate-from: write deals already on the drive again from the source (unless locked)")
    a = ap.parse_args()
    if a.init_drive:
        print(f"Shared folder ready: {init_drive(a.init_drive)}\nSettings: {os.path.join(DATA, 'config.json')} – restart Deal Desk to use it.")
        return
    if a.migrate_from:
        print("\n".join(migrate_to_drive(os.path.expanduser(a.migrate_from), a.as_user, dry=a.dry_run, with_mail=a.with_mail, replace=a.replace)))
        return
    init_db()
    if a.imp:
        n = import_json(a.imp)
        drive_sync(force=True)
        print(f"Imported {n} project(s) into {DRIVE}" + (f" – {SYNC['error']}" if SYNC["error"] else ""))
        return
    daily_backup()
    auto_import()
    url = f"http://127.0.0.1:{a.port}/"
    try:
        srv = SERVER[0] = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    except OSError:
        print(f"Port {a.port} is busy – Deal Desk is probably already running. Opening {url}")
        if not a.no_browser:
            webbrowser.open(url)
        return
    drive_sync(force=True)
    print(f"Shared folder: {DRIVE or '(none)'} ({'found' if SYNC['available'] else 'NOT FOUND'}), user {ME}", flush=True)
    if DRIVE:

        def sync_loop():
            while True:
                time.sleep(SYNC_EVERY)
                try:
                    drive_sync()
                except Exception as e:  # keep syncing whatever one pass hit
                    SYNC["error"] = f"Sync failed: {e}"
                    print(SYNC["error"], flush=True)
        threading.Thread(target=sync_loop, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # the launcher stops an older server with kill: write pending deals first
    print(f"Deal Desk is running at {url}\nIndex: {DB_PATH}\nClose this window (or press Ctrl+C) to stop.")
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    if a.idle_exit > 0:
        LAST_SEEN[0] = time.time()

        def watchdog():
            while True:
                time.sleep(30)
                if time.time() - LAST_SEEN[0] > a.idle_exit * 60:
                    print(f"No app window for {a.idle_exit:g} minutes – stopping.", flush=True)
                    srv.shutdown()
                    return
        threading.Thread(target=watchdog, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        drive_sync(force=True)


if __name__ == "__main__":
    main()

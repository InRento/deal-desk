# InRento Deal Desk

The underwriting app for InRento loans: a deal register, a monthly cash-flow model with sensitivity, a model check, versions, read-only Gmail tracking and a committee deck (PowerPoint / PDF). It runs on the Mac as **Deal Desk.app**: a small local Python server plus one HTML page. Deals are kept in a shared folder on Google Drive (the “Deal desk” Shared Drive, synced by Google Drive for Desktop), so the whole team works on the same deals. No AI or API calls inside the app: it only reads and writes files in that folder, plus the Gmail read (IMAP, read-only) and the ECB exchange-rate lookup.

## Folders

| Folder | What is in it |
|---|---|
| `src/app/` | The app, one file per feature, joined in name order by `build.sh` (see CLAUDE.md for what lives where) |
| `src/engine.js` | The model: monthly cash flow, loan, sales, metrics, break-evens. No browser code, also runs in Node |
| `src/server.py` | Local server: deals in the shared folder (with a local SQLite index), versions, inbox, Gmail (read-only), ECB rates. Python standard library only |
| `src/styles.css` | All styling (light and dark) |
| `vendor/` | Third-party browser libraries: SheetJS (Excel), jsPDF + html2canvas (PDF), PptxGenJS (PowerPoint) |
| `tests/` | Engine regression (M23 against the original Excel), server tests with a fake Gmail, browser flow test |
| `mac/` | Copies of the app launcher (`Deal Desk.app/Contents/MacOS/DealDesk`) and `Info.plist` |
| `docs/` | Change log and the format Claude uses to draft new deals into the import folder |
| `dist/` | Build output – exactly what goes into `Deal Desk.app/Contents/Resources` (generated, do not edit) |

## Everyday commands

```sh
./build.sh          # src → dist/ (needs nothing; uses node for a syntax check when installed)
./run_tests.sh      # engine + server tests; the browser test too when Playwright is installed
./deploy.sh         # build, test, copy dist/ into ~/Desktop/Deal Desk.app – then close the Deal Desk tab and click the Dock icon
./package.sh        # "Deal Desk <version>.zip" for a colleague: the app with an empty database (Apple Silicon Macs)
```

Bump `APP_VERSION` in `src/server.py` with every release: the launcher restarts a running older server when the version differs.

## Data

Deals live in the shared folder (found automatically under `~/Library/CloudStorage/GoogleDrive-*/Shared drives/`, recognised by its `.deal-desk` marker):

```
Deal desk/
  Deals/<name> (<id>)/   deal.json (the project, with a rev number), versions/<id>.json, activity/<user>.jsonl, Documents/<category>/
  Deals/_deleted/        deleted deals, moved here – nothing is erased
  Inbox/                 drafts from Claude; imported once, then moved to Inbox/Imported/
```

Each Mac keeps only its own things in `~/Deal Desk`: `drive-index.sqlite` (an index of the shared folder plus this Mac's Gmail cache – never put SQLite on the drive), daily `backups/` of that index and `deal-desk.log`. A pre-drive `deals.sqlite` there is left untouched.

- A save reaches the drive about 5 seconds after typing starts; other people's changes are read every 3 seconds and whenever the deal list loads.
- **Locks:** only the person holding a deal's lock can edit it; everyone else sees it read-only, and an unlocked deal is read-only for all (“Lock & edit”). Locks are files in `Deals/<deal>/locks/`, taken by claim → 6-second wait → confirm (the earliest claim wins, so two people clicking at once cannot both get it). They do not expire; “Force unlock” takes a lock over (logged in the deal's activity) and whatever the old holder types after that is kept in `deal.unsaved-<user>-<time>.json` instead of the deal. A deal created in the app starts locked by its creator; a deal from the Inbox arrives unlocked, and Inbox email material for a deal someone else holds waits until it is unlocked.
- A save is never written over a newer one: if someone else saved in the meantime, this Mac's version is kept as `deal.conflict-<user>-<time>.json` in the deal's folder and the app asks for a reload.
- Without Google Drive running, edits wait on the Mac and are written when it is back.
- Set up once per team: `python3 src/server.py --init-drive "<shared drive folder>"`. Move a pre-drive data folder into it: `python3 src/server.py --migrate-from "<folder with deals.sqlite>" [--dry-run] [--with-mail]` (deals already on the drive are skipped, so it can be run again; `--replace` writes them again from the source – switch-over day – keeping the drive's copy as `deal.before-replace-<time>.json` and skipping deals someone holds; `--with-mail` also loads that folder's Gmail cache into this Mac's index).

New deals drafted by Claude go into `Inbox/` on the shared drive – format in `docs/intake.md`.

## Gmail

Read-only over IMAP: `EXAMINE` and `BODY.PEEK` only, so nothing is marked read, moved or changed. The app password is kept in the macOS Keychain (service "Deal Desk Gmail"), never in the database or a file. A project follows the label set on its Emails tab, or the label whose last part matches the project name (e.g. `New deals/N7, Vilnius`).

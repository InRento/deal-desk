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
| `tests/` | Engine regression (M23 against the original Excel), server tests with a fake Gmail, shared-folder tests (two Macs), launcher install/update test, browser tests |
| `mac/` | The app: launcher (`Deal Desk.app/Contents/MacOS/DealDesk`), `Info.plist` and the install note – `release.sh --installer` turns them into `Install Deal Desk.dmg` |
| `docs/` | Change log and the format Claude uses to draft new deals into the import folder |
| `dist/` | Build output – exactly what `release.sh` puts in `Releases/<version>/` on the shared drive (generated, do not edit) |

## Everyday commands

```sh
./build.sh          # src → dist/ (needs nothing; uses node for a syntax check when installed)
./run_tests.sh      # engine + server tests; the browser test too when Playwright is installed
./release.sh        # build, test, stage Releases/<APP_VERSION>/ on the shared drive (nobody gets it yet)
./release.sh --publish            # switch Releases/current.json to it – after Tautvydas says "push"
./release.sh --rollback 3.19.0    # switch back to an earlier staged version
./release.sh --installer          # rebuild "Install Deal Desk.dmg" on the drive (only when mac/ changes)
```

**Install and updates.** Colleagues open `Install Deal Desk.dmg` from the shared drive and drag Deal Desk to Applications – once. The app is only a launcher: at every start it reads `Releases/current.json`, copies that version into `~/Deal Desk/app/<version>/` (every file checked against its checksum; if one does not match yet – Drive still syncing – the version already on the Mac runs) and starts it. After `--publish`, open apps show "Restart to update"; unsaved work is saved first. `--min-version` makes older apps read-only when the deal format changes, and a deal saved by a newer app is read-only for older ones. The built-in Python is published once (`--runtime <folder with python/ or .tar.gz>`) and reused.

Bump `APP_VERSION` in `src/server.py` for every release: a staged version never changes (release.sh refuses different files under the same number).

**Development.** On a Mac with the shared drive, `python3 src/server.py` finds the real shared drive and works on the real deals. Point it at a test folder instead: `python3 src/server.py --init-drive /tmp/dd-test` once, then `DEALDESK_DRIVE=/tmp/dd-test DEALDESK_DATA=/tmp/dd-test-data python3 src/server.py`.

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
- **Documents** live in `Deals/<deal>/Documents/<category>/`. The Documents tab lists them (files added in Finder or Google Drive show up too), adds files by drag-and-drop or “Add files…” into a chosen category, opens a file or shows it in Finder. Adding documents needs no lock – files never touch `deal.json`. A source tag can link to a file (`file`), and “Open” on its chip opens it. The deal's folder follows its name: when the holder renames a deal, the folder (with documents and lock) is renamed too.
- A save is never written over a newer one: if someone else saved in the meantime, this Mac's version is kept as `deal.conflict-<user>-<time>.json` in the deal's folder and the app asks for a reload.
- Without Google Drive running, edits wait on the Mac and are written when it is back.
- Set up once per team: `python3 src/server.py --init-drive "<shared drive folder>"`. Move a pre-drive data folder into it: `python3 src/server.py --migrate-from "<folder with deals.sqlite>" [--dry-run] [--with-mail]` (deals already on the drive are skipped, so it can be run again; `--replace` writes them again from the source – switch-over day – keeping the drive's copy as `deal.before-replace-<time>.json` and skipping deals someone holds; `--with-mail` also loads that folder's Gmail cache into this Mac's index).

New deals drafted by Claude go into `Inbox/` on the shared drive – format in `docs/intake.md`.

## Gmail

Read-only over IMAP: `EXAMINE` and `BODY.PEEK` only, so nothing is marked read, moved or changed. The app password is kept in the macOS Keychain (service "Deal Desk Gmail"), never in the database or a file. A project follows the label set on its Emails tab, or the label whose last part matches the project name (e.g. `New deals/N7, Vilnius`).

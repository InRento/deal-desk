# InRento Deal Desk

The underwriting app for InRento loans: a deal register, a monthly cash-flow model with sensitivity, a model check, versions, read-only Gmail tracking and a committee deck (PowerPoint / PDF). It runs on the Mac as **Deal Desk.app**: a small local Python server plus one HTML page. No AI or API calls inside the app; nothing leaves the computer except the Gmail read (IMAP, read-only) and the ECB exchange-rate lookup.

## Folders

| Folder | What is in it |
|---|---|
| `src/app/` | The app, one file per feature, joined in name order by `build.sh` (see CLAUDE.md for what lives where) |
| `src/engine.js` | The model: monthly cash flow, loan, sales, metrics, break-evens. No browser code, also runs in Node |
| `src/server.py` | Local server: SQLite storage, versions, import folder, backups, Gmail (read-only), ECB rates. Python standard library only |
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

Everything lives in `~/Deal Desk` (not in this folder): `deals.sqlite`, daily `backups/`, `import/` and `deal-desk.log`. Files attached in versions before 3.10 are still in `~/Deal Desk/documents/` but are no longer shown.

New deals drafted by Claude arrive as JSON in `~/Deal Desk/import/` and are imported once when the project list loads – format in `docs/intake.md`.

## Gmail

Read-only over IMAP: `EXAMINE` and `BODY.PEEK` only, so nothing is marked read, moved or changed. The app password is kept in the macOS Keychain (service "Deal Desk Gmail"), never in the database or a file. A project follows the label set on its Emails tab, or the label whose last part matches the project name (e.g. `New deals/N7, Vilnius`).

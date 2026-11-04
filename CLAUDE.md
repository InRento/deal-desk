# Deal Desk – notes for Claude Code

Read README.md first. This file is how the code is put together and the rules for changing it.

## How the page is built
- `build.sh` joins `src/app/*.js` in name order inside one `(() => { … })()` and inlines it with `src/engine.js`, `src/styles.css` and PptxGenJS into `dist/index.html`.
- Everything shares one scope: function declarations are visible everywhere; `const`/`let` only after their file has run. Top-level statements that use a constant from a later file break at load – keep such code in the file that owns the constant, or move it into a function.
- No framework. Each tab is a function returning an HTML string (`tabInputs`, `tabSens`, …), rendered by `renderTab()`. Live numbers are placeholders `<div data-out="name">` filled by `OUT.name()` on every recalculation (`refreshOutputs()`), so typing never re-renders the tab.
- Every editable field has `data-k="<path>"` (`inputs.rate`, `assets.3.salePrice`, `scenarios.2.deck`). `onEdit` (11-editing.js) writes the value into the project, schedules the save (`scheduleSave`) and recalculates. Selects and checkboxes re-render the tab; text fields do not.
- Buttons use `data-act="…"`; the main switch is in 11-editing.js, feature-specific actions sit in their own file.
- Locks: only the person holding a deal's lock can change it; an unlocked deal is read-only for everyone. The server refuses every write without the lock (HTTP 423) – the app's read-only mode is only the visible part. Anything that changes a deal must go through `scheduleSave` (which reverts edits on a read-only deal) or a server route that checks `edit_refusal`.
- Storage: deals live in the shared Google Drive folder (`Deals/<name> (<id>)/deal.json` + `versions/` + `activity/`); the server's SQLite database is only this Mac's index of it plus the Gmail cache. There is no local-only mode. Tests always pass `DEALDESK_DRIVE` (a temporary folder) – without it the server finds the real shared drive on this Mac.
- State: `S` (01-core.js). `cur()` is the open project, `S.model` the engine result shown (EUR view when switched), `S.modelOrig` the result in the project's own currency (the model check always uses this one).
- **One definition per function.** Do not wrap or reassign an existing function (`const _x = x; x = function …`); extend the original instead. v3.11 removed 26 such wrappers.

## Where things live (src/app)
| File | Contents |
|---|---|
| 01-core | helpers, number and date formatting, defaults (`DEFAULT_INPUTS`, `blankProject`, `normalise`), state, saving, navigation, `recalc`, top bar and KPI strip |
| 02-home | Home (grouped by stage), portfolio tiles, Today view, pipeline stage card, next action, chasing open items |
| 03-project | project page, `renderTab`, input control helpers (`inp`, `sel`, `chk`, `dateIn`), Overview tab, benefits & risks box |
| 04-inputs | `INPUT_SECTIONS` (every model input: key, label, kind, help), deal types, Inputs tab layout (`IN_LAYOUT`) and results rail, drawdown schedule, existing debts, sources & uses, LTV after each tranche |
| 05-ops | Operating model tab (revenue and cost lines) |
| 06-assets | Collateral & sales and Adjustments tabs, unit sale status columns, sales schedule tool |
| 07-results | Summary and Cash flow tabs |
| 08-sensitivity | Sensitivity tab: margin for error (`marginCalc`), sale price per m², break-evens, scenarios, two-way grid |
| 09-checks | Model check (`lint`): likely mistakes with fix buttons, issue bar, field marks. Feature-specific checks (`lintEur`, `lintTranches`, `lintLateSales`, `lintAssumed`) live with their feature and are called from `lint` |
| 10-charts | SVG line/bar charts |
| 11-editing | output refresh, editing, click and key handling, undo/redo |
| 12-export | Excel, CSV and JSON export |
| 13-paste | Paste from Excel (table cells and the header-matching dialog) |
| 14-currency | PLN/EUR view (`mp()` converts the project), ECB rate, €5m crowdfunding check |
| 15-sources | source tags on drafted values (document / assumed / changed), "N assumed values to confirm" |
| 16-versions | live versions, switcher, side-by-side comparison, change notes |
| 17-email | Gmail settings, Emails tab, conversation panel |
| 18-deck | committee deck (2 slides): data (`committeeData`, `deckGrid`, `stressHeadline`), one layout drawn twice (`deckWriter`: PptxGenJS and HTML for preview/PDF); logo and fonts in 18-deck-assets |
| 20-judgement | decision log: pre-mortem, snapshot at the decision, post-mortem; Home → Decisions |
| 19-trace | "How it is calculated" panel: numbers tagged `data-tr="c:key:period"`, `"m:summaryKey"` or `"y:key:year"`; formulas come from `src/trace.js` |
| 23-locks | deal locks: lock bar, Home badges, Lock & edit / Unlock / Force unlock, read-only mode (`canEdit`, `applyReadOnly`, `readOnlyRevert` in `scheduleSave`), 5-second poll of `/api/locks` that refreshes read-only copies |
| 99-boot | first render and project load |

## Adding a model input
1. `src/server.py`: add `(key, column, type)` to `INPUT_FIELDS` (columns are created automatically on start). A field missing here is silently lost on save – also from `deal.json` on the drive, which is written from the index.
2. 01-core `DEFAULT_INPUTS`: default value (strings; percentages typed in percent, 8.5 = 8.5%).
3. 04-inputs `INPUT_SECTIONS`: `F(key, label, kind, help)` and put the key in `IN_LAYOUT` (`main` or `more`).
4. `src/engine.js` `resolve()` turns the strings into numbers; use it in `run()`. If it changes a calculation, update the matching formula in `src/trace.js` – `tests/trace_test.js` fails until they agree.
5. Add a model check in 09-checks if the value can be mistyped.

## Rules from the owner (Tautvydas)
- This is a modelling tool for InRento's credit analysts, not a consumer app. Modelling (accuracy, speed of building and stress-testing a deal) comes first; polish, onboarding and packaging come after.
- No AI or API calls inside the app. Gmail stays read-only; the password only in the Keychain.
- Construction / renovation (v3.13) is off unless `constrOn`; engine `worksPlan()` drives spend, progress-linked tranches and collateral credit. Keep results of deals without construction identical.
- Never invent numbers for a deal: only what the documents or he state; anything assumed is tagged `assumed: true`.
- Committee deck: two slides only – the deal (description, loan, LTV, price per m²) and the stress test (answer in one sentence + 4 × 4 table). Look of InRento's investment decks (Inter, navy/green, white cards), no footers. It has to be clear at a glance.
- Decision log (20-judgement): once a decision is recorded its text and numbers stay as they were; reopening is dated. Never change a recorded snapshot in code.
- Show a draft (screenshots or a sample file) before shipping visible changes, unless he says to push.

## Git
- This folder is a local git repository. `main` = what is installed on the Mac; each release is tagged `v<APP_VERSION>`.
- No remote: `tests/deals/` and `tests/expected/` hold real deals, so never push this repository to GitHub or any other hosted service.
- One branch per change (`feature/<name>`), committed as the work goes. Merge into `main` and tag only when it ships (after Tautvydas says "push"). Unshipped branches replace the old `pending/` folders.
- `dist/`, zips, `__pycache__` and databases are never committed (`.gitignore`).

## Checks before every release
```sh
./build.sh && ./run_tests.sh      # deploy.sh runs this and stops on any failure
```
- **Engine guard** (`tests/engine_test.js`): the confirmed figures of Skýra, Ustroń, Noa and M23 (reconciled once against the analysts' models) must still come out, and every result of every deal in `tests/deals/` must equal `tests/expected/engine.json`.
- **App guard** (`tests/app_snapshot.js`, needs Playwright): every tab, the committee deck and the Excel export of every test deal must equal `tests/expected/app.json` (clock fixed at 24 Oct 2026).
- A guard failure means a number moved. Fix it, or – when the change is intended – re-record with `--update` and write in docs/CHANGELOG.md which numbers changed and why. Never re-record just to make a failure go away.
- `tests/server_test.py` covers storage, inbox, backups, the origin guard and the Gmail read-only rule; `tests/drive_test.py` runs two servers on one shared folder (saves across Macs, stale copies, rev conflicts, versions, deletes, inbox, drive missing); `tests/ui_test.js` builds a fictional deal through the browser.
- `data/` (gitignored) holds a copy of Tautvydas's pre-drive `~/Deal Desk` – migration source for development. Read it only through copies; never modify or commit it.
- `tests/deals/` holds real deals: keep this folder private (package.sh never includes it).

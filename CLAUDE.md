# Deal Desk – notes for Claude Code

Read README.md first. This file is how the code is put together and the rules for changing it.

## How the page is built
- `build.sh` joins `src/app/*.js` in name order inside one `(() => { … })()` and inlines it with `src/engine.js`, `src/styles.css` and PptxGenJS into `dist/index.html`.
- Everything shares one scope: function declarations are visible everywhere; `const`/`let` only after their file has run. Top-level statements that use a constant from a later file break at load – keep such code in the file that owns the constant, or move it into a function.
- No framework. Each tab is a function returning an HTML string (`tabInputs`, `tabSens`, …), rendered by `renderTab()`. Live numbers are placeholders `<div data-out="name">` filled by `OUT.name()` on every recalculation (`refreshOutputs()`), so typing never re-renders the tab.
- Every editable field has `data-k="<path>"` (`inputs.rate`, `assets.3.salePrice`, `scenarios.2.deck`). `onEdit` (11-editing.js) writes the value into the project, schedules the save (`scheduleSave`) and recalculates. Selects and checkboxes re-render the tab; text fields do not.
- Buttons use `data-act="…"`; the main switch is in 11-editing.js, feature-specific actions sit in their own file.
- Locks: only the person holding a deal's lock can change it; an unlocked deal is read-only for everyone. The server refuses every write without the lock (HTTP 423) – the app's read-only mode is only the visible part. Anything that changes a deal must go through `scheduleSave` (which reverts edits on a read-only deal) or a server route that checks `edit_refusal`.
- Storage: deals live in the shared Google Drive folder (`Deals/<name> (<id>)/deal.json` + `versions/` + `activity/`); the server's SQLite database is only this Mac's index of it. There is no local-only mode. Tests always pass `DEALDESK_DRIVE` (a temporary folder) – without it the server finds the real shared drive on this Mac.
- State: `S` (01-core.js). `cur()` is the open project, `S.model` the engine result shown (EUR view when switched), `S.modelOrig` the result in the project's own currency (the model check always uses this one).
- **One definition per function.** Do not wrap or reassign an existing function (`const _x = x; x = function …`); extend the original instead. v3.11 removed 26 such wrappers.

## Where things live (src/app)
| File | Contents |
|---|---|
| 01-core | helpers, number and date formatting, defaults (`DEFAULT_INPUTS`, `blankProject`, `normalise`), state, saving, navigation, `recalc`, top bar and KPI strip |
| 02-home | Home (stage headings with the projects boxed below; no stage or checks column), stage counts, Today view, pipeline stage card, next action, chasing open items |
| 03-project | project page, `renderTab`, input control helpers (`inp`, `sel`, `chk`, `dateIn`), Overview tab, benefits & risks box |
| 04-inputs | `INPUT_SECTIONS` (every model input: key, label, kind, help), deal types, Inputs tab layout (`IN_LAYOUT`) and results rail, drawdown schedule, existing debts, sources & uses, LTV after each tranche |
| 05-ops | Operating model tab (revenue and cost lines) |
| 06-assets | Collateral & sales and Adjustments tabs, unit sale status columns, sales schedule tool |
| 07-results | Summary (v3.25: five sections, each a one-line answer then detail – what we lend incl. sources & uses, how well it is secured incl. weakest-month forced-sale LTV and a loan-vs-collateral chart, how it is repaid incl. a repayment-sources bar, borrower liquidity (DSCR only on income deals), what InRento earns = the arrangement fee; credit tests folded at the bottom) and Cash flow tabs (incl. the per-scenario year tables) |
| 08-sensitivity | Sensitivity tab (v3.25): 1 "How much room" – margin for error per driver with bars (`marginCalc`, `mgVal`) + collateral value break-evens + DSCR break-even on income deals; 2 scenarios as one table (`scTable`: static rows with an in-place driver editor, results per row via `OUT['sc-r-j']`, `scWhat` = what a scenario moves in words) + cash chart + all metrics folded; 3 two-driver grid preset by deal type (`OUT.grid2` from `marginCalc().grid`); opening "Choose your own two drivers" switches it to the chosen drivers (`ownGrid`, v3.26) with the cash and LTV tables under the selectors; the scenario chart has a metric picker (`SENS_METRICS`, `sensMetric`, `S.sensMetric` per Mac) |
| 09-checks | Model check (`lint`) – **model integrity only** (v3.25, Tautvydas): dates and timing, missing halves, double counting, typos, with fix buttons, issue bar, field marks. Credit opinions (LTV vs limit, DSCR, cash shortfalls, €5m, valuation age, price vs value…) are never checks – they are numbers and the engine's credit tests (`creditTests`, shown as information). Feature checks (`lintTranches` = tranche without a date, `lintLateSales`, `lintAssumed`, `lintWorks`, `lintPayPlan`, `lintLoans`) live with their feature |
| 10-charts | SVG line/bar charts |
| 11-editing | output refresh, editing, click and key handling, undo/redo |
| 12-export | Excel, CSV and JSON export |
| 13-paste | Paste from Excel (table cells and the header-matching dialog) |
| 14-currency | PLN/EUR view (`mp()` converts the project; `OUT_TABS` = tabs whose results follow the switch: Deal, Summary, Cash flow, Sensitivity), ECB rate, `ccyNote` (currency and rate line on Inputs and Deal) and `moneyUnit` (currency code next to money inputs on non-EUR deals) |
| 15-sources | source tags on drafted values (document / assumed / changed), "N assumed values to confirm"; a tag can carry a `url` (https only, e.g. a Google Drive link – "Open link" opens it in the browser) |
| 16-versions | live versions, switcher, side-by-side comparison, change notes |
| 18-deck | committee deck (2 slides): data (`committeeData`, `deckGrid`, `stressHeadline`), one layout drawn twice (`deckWriter`: PptxGenJS and HTML for preview/PDF); logo and fonts in 18-deck-assets |
| 20-judgement | decision log: pre-mortem, snapshot at the decision, post-mortem; Home → Decisions |
| 19-trace | "How it is calculated" panel: numbers tagged `data-tr="c:key:period"`, `"m:summaryKey"` or `"y:key:year"`; formulas come from `src/trace.js` |
| 23-locks | deal locks: lock bar, Home badges, Lock & edit / Unlock / Force unlock, read-only mode (`canEdit`, `applyReadOnly`, `readOnlyRevert` in `scheduleSave`), 5-second poll of `/api/locks` that refreshes read-only copies |
| 25-updates | update bar: "Deal Desk X is ready · Restart to update" or "can only view deals" (state from `/api/locks` → update), restart via `/api/restart` (the server starts the launcher and stops) |
| 26-deal | Deal tab (projects open on it; made for the CEO): the main terms as read-only text (`dealTerms`: loan, interest, fee, term, borrower equity, and on renovation deals the works period, budget and works equity; drawdown schedule with when / amount / purpose; the CEO asks for changes, the analyst makes them on Inputs), links in three boxes under it (`dealLinks`: project folder, listings, other information; `inputs.links` = [{box, url, label}], deal-level like benefits and risks, only the lock holder adds or removes, empty boxes hidden from others), results that apply to every deal type (LTV, forced-sale LTV, peak LTV, borrower cash before maturity, cash at maturity incl. bank refinancing, value can fall before the LTV limit (`ltvRoom`, at the highest-LTV month) and before a loss (engine `headroom`), InRento fee), benefits and risks as two lists under the results (`dealBR`: `inputs.benefits` / `inputs.risks` from Overview → Committee deck, one point per line), the project's Sensitivity scenarios as cards (`sensModel`, tests from `mgTests`; `dealShown` hides scenarios with the same result as the first) and one chart of borrower cash per scenario until maturity (`#ch-dl`, card colour = line colour, pointing at a card picks out its line). KPI strip hidden on this tab |
| 27-grid | every `table.grid-in` works like a spreadsheet (v3.25): cell / block selection (click, Shift+click, drag, Shift+arrows, ⌘A), arrows move, ⌘C copies TSV, ⌘V pastes a block by visible columns (adds rows) or one value into every selected cell, ⌘D / corner handle fill down, Delete clears; dropdowns, dates and checkboxes included; one save = one undo step (`gWrite`) |
| 99-boot | first render and project load |

## Adding a model input
1. `src/server.py`: add `(key, column, type)` to `INPUT_FIELDS` (columns are created automatically on start). A field missing here is silently lost on save – also from `deal.json` on the drive, which is written from the index.
2. 01-core `DEFAULT_INPUTS`: default value (strings; percentages typed in percent, 8.5 = 8.5%).
3. 04-inputs `INPUT_SECTIONS`: `F(key, label, kind, help)` and put the key in `IN_LAYOUT` (`main` or `more`).
4. `src/engine.js` `resolve()` turns the strings into numbers; use it in `run()`. If it changes a calculation, update the matching formula in `src/trace.js` – `tests/trace_test.js` fails until they agree.
5. Add a model check in 09-checks if the value can be mistyped.

## Rules from the owner (Tautvydas)
- This is a modelling tool for InRento's credit analysts, not a consumer app. Modelling (accuracy, speed of building and stress-testing a deal) comes first; polish, onboarding and packaging come after.
- No AI or API calls inside the app. No email integration and no document storage (both removed in v3.25 at Tautvydas's request): sources are typed (document, page, note) with an optional Google Drive link.
- InRento earns the fixed arrangement fee only; interest and capital gain go to the investors, whose returns are contractual. The app shows no IRR, lender profit or InRento income – only the fee (`feeOf`). The Excel export and committee deck keep their numbers.
- Model checks only for model integrity (see 09-checks); Tautvydas ignores credit warnings on purpose, so they are never warnings. DSCR only on deals with operating income (`usesDscr`).
- Construction / renovation (v3.13) is off unless `constrOn`; engine `worksPlan()` drives spend, progress-linked tranches and collateral credit. Keep results of deals without construction identical.
- Never invent numbers for a deal: only what the documents or he state; anything assumed is tagged `assumed: true`.
- Committee deck: two slides only – the deal (description, loan, LTV, price per m²) and the stress test (answer in one sentence + 4 × 4 table). Look of InRento's investment decks (Inter, navy/green, white cards), no footers. It has to be clear at a glance.
- Decision log (20-judgement): once a decision is recorded its text and numbers stay as they were; reopening is dated. Never change a recorded snapshot in code.
- Show a draft (screenshots or a sample file) before shipping visible changes, unless he says to push.

## Git
- Remote: GitHub `InRento/deal-desk` (must stay **private** – `tests/deals/` and `tests/expected/` hold real deals). `main` = what is published (`Releases/current.json` on the shared drive); each release is tagged `v<APP_VERSION>`.
- **Every code change is committed to the GitHub repo** – no change ships, and no work is left, only as loose files on a Mac or in a cloud workspace.
- One branch per change (`feature/<name>`), committed and pushed as the work goes. Merge into `main`, tag and `./release.sh --publish` only when it ships (after Tautvydas says "push"); staging (`./release.sh` without `--publish`) is fine before that. Never publish a version whose code is not on `main` on GitHub.
- Claude has no GitHub login. When it cannot run git on the Mac, it edits the files in the local clone and gives Tautvydas the branch and commit message to commit and push from GitHub Desktop.
- `dist/`, zips, `__pycache__` and databases are never committed (`.gitignore`).

## Checks before every release
```sh
./build.sh && ./run_tests.sh      # release.sh runs this and stops on any failure
```
- **Playwright is required** (`npm install && npx playwright install chromium`, package.json pins it). Until v3.25.8 a Mac without it skipped the app guard and the browser tests with one line of output – Tautvydas's Mac never ran them, so the lock test failed unnoticed from 3.25.3 to 3.25.6.
- **release.sh --publish checks git first** and stops before building when: not on main, uncommitted changes, main not equal to origin/main (unpushed or behind), tag `v<APP_VERSION>` missing or not on HEAD, no CHANGELOG entry, or APP_VERSION older than the published one (a stale server.py once reset it to 3.25.0). It pushes the tag if GitHub lacks it. `--no-git` is only for launcher_test / update_ui_test, which run release.sh on a fake drive.
- **Engine guard** (`tests/engine_test.js`): the confirmed figures of Skýra, Ustroń, Noa and M23 (reconciled once against the analysts' models) must still come out, and every result of every deal in `tests/deals/` must equal `tests/expected/engine.json`.
- **App guard** (`tests/app_snapshot.js`, needs Playwright): every tab, the committee deck and the Excel export of every test deal must equal `tests/expected/app.json` (clock fixed at 24 Oct 2026).
- A guard failure means a number moved. Fix it, or – when the change is intended – re-record with `--update` and write in docs/CHANGELOG.md which numbers changed and why. Never re-record just to make a failure go away.
- `tests/server_test.py` covers storage, inbox, backups and the origin guard; `tests/drive_test.py` runs two servers on one shared folder (saves across Macs, stale copies, rev conflicts, versions, deletes, inbox, drive missing); `tests/ui_test.js` builds a fictional deal through the browser.
- `data/` (gitignored) holds a copy of Tautvydas's pre-drive `~/Deal Desk` – migration source for development. Read it only through copies; never modify or commit it.
- `tests/deals/` holds real deals: keep this folder private (release.sh only copies dist/ to the drive).
- Never run `src/server.py` against the real shared drive while developing: set `DEALDESK_DRIVE` to a test folder (see README → Development). Tests always do.
- `tests/launcher_test.py` installs and updates through the real launcher in a fake home; `tests/update_ui_test.js` checks the update bar and restart in the browser.

# How Claude drafts a new deal

**Workflow:** Tautvydas translates the documents himself and gives Claude the translated files – usually the teaser or business plan, the appraisal and the financial statements – plus anything he states in chat (e.g. preliminary loan terms). Claude drafts the project as JSON; the app makes no AI or API calls.

**Only what is certain.** Values come from the documents or from him. Anything Claude has to assume (or an app default that matters, like term or drawdown date) is tagged `"assumed": true` so the app shows it amber and the model check lists it until he confirms. Plans without dates (e.g. a sales plan with prices but no timing) go into the notes, not the model.

## Delivery
- Write `Inbox/<yyyy-mm-dd>-<slug>.json` in the shared “Deal desk” folder on Google Drive – one project in the same shape as the app's JSON export, with a stable `id` (letters, digits, `.`, `_`, `-`). The first Deal Desk that loads its project list imports it and moves the file to `Inbox/Imported/`; `_replace: true` re-imports over an existing id.
- Documents: put the translated files next to the draft in a folder with the same name – `Inbox/<yyyy-mm-dd>-<slug>/` for `Inbox/<yyyy-mm-dd>-<slug>.json` (one project per file). On import they move into the deal's `Documents/<category>/`: the category comes from `_documents: [{"file": "appraisal_LT.pdf", "kind": "Appraisal"}]`, else from a subfolder (`Inbox/<slug>/Financial statements/FS 2025.xlsx`), else `Other`. Categories used in the app: Teaser, business plan · Appraisal · Financial statements · Legal · Photos · Other.
- Link a source tag to its file with `file` (path inside the deal's Documents): `{"doc": "Appraisal Ober-Haus", "file": "Appraisal/appraisal_LT.pdf", "loc": "p.12"}` – “Open” on the field's chip then opens that file.
- Source tags in `inputs.sources`, keyed by the field's data-k path:
  `{"inputs.loan": {"doc": "Business plan", "loc": "p.3", "note": "EUR 2.5m requested"}, "assets.0.market": {"doc": "Appraisal AB26-0430-07N", "loc": "p.12", "note": "land plot"}, "inputs.term": {"doc": "App default", "note": "not given", "assumed": true}}`.
- Also set: `inputs.dealType` (units / operating / rental / bridge / custom); `fxRate` + `fxDate` for non-EUR deals; `status` = a pipeline stage (New deal, Initial analysis, Underwriting, Turned in, Rejected, Funded, Realised); `nextAction`, `nextOwner`, `nextDue`; open items in `todos` with optional `category`, `from` (requested from) and `askedOn`.

## Adding to an existing project without touching the model
- `_appendVersions: true` + `_versions: [{label, data}]` – adds alternative structures as versions.
- Email material (`_appendEmails`, email summaries) is no longer imported (v3.25): a file like that for an existing deal is skipped.

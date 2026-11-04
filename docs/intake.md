# How Claude drafts a new deal or adds email material

**Workflow:** Tautvydas translates the documents himself and gives Claude the translated files – usually the teaser or business plan, the appraisal and the financial statements – plus anything he states in chat (e.g. preliminary loan terms). Claude drafts the project as JSON; the app makes no AI or API calls.

**Only what is certain.** Values come from the documents or from him. Anything Claude has to assume (or an app default that matters, like term or drawdown date) is tagged `"assumed": true` so the app shows it amber and the model check lists it until he confirms. Plans without dates (e.g. a sales plan with prices but no timing) go into the notes, not the model.

## Delivery
- Write `~/Deal Desk/import/<yyyy-mm-dd>-<slug>.json` – one project in the same shape as the app's JSON export, with a stable `id`. The server imports each file once when the project list loads (meta key `imported:<file>`); `_replace: true` re-imports over an existing id.
- Source documents are not stored in the app any more (since v3.10). Name them in the source tags instead.
- Source tags in `inputs.sources`, keyed by the field's data-k path:
  `{"inputs.loan": {"doc": "Business plan", "loc": "p.3", "note": "EUR 2.5m requested"}, "assets.0.market": {"doc": "Appraisal AB26-0430-07N", "loc": "p.12", "note": "land plot"}, "inputs.term": {"doc": "App default", "note": "not given", "assumed": true}}`.
  `doc: "Email"` with `loc` = a text snippet points to an email: "Open" finds the Gmail thread in the project's label containing the snippet.
- Also set: `inputs.dealType` (units / operating / rental / bridge / custom); `fxRate` + `fxDate` for non-EUR deals; `status` = a pipeline stage (New deal, Initial analysis, Underwriting, Turned in, Rejected, Funded, Realised); `nextAction`, `nextOwner`, `nextDue`; open items in `todos` with optional `category`, `from` (requested from) and `askedOn`; `inputs.gmailLabel` when the label name differs from the project name.

## Adding to an existing project without touching the model
- `_appendVersions: true` + `_versions: [{label, data}]` – adds alternative structures as versions.
- `_appendEmails: true` – summaries of email threads:
  ```json
  {"id": "n7-vilnius", "_appendEmails": true, "inputs": {},
   "_emailSummary": {"text": "…", "date": "2026-10-23"},
   "_todos": [{"text": "Final appraisal report", "category": "Document request", "from": "Borrower", "askedOn": "2026-10-16"}],
   "_sources": {"inputs.term": {"doc": "Email", "loc": "presale contracts signed", "note": "presales confirmed by broker"}}}
  ```
  The summary shows at the top of the Emails tab; open items with the same text are skipped (also within one file); `_sources` are merged into the project's source tags. `inputs` must be present (empty is fine).

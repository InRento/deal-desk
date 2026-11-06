// Model check: only model integrity – dates and timing, missing halves, double counting, typos – with fixes; issue bar and field marks.
// Credit opinions (LTV vs limit, DSCR, cash shortfalls, €5m, valuation age…) are not checks: they are shown as numbers (v3.25).
// ================= Model checks =================
const fmtP = (v) => String(+v.toFixed(4));
function lint(p, m) {
  const out = []; const add = (o) => out.push(o);
  const i = p.inputs, r = m.r, s = m.summary, rows = m.rows, t = typeOf(p);
  const n = (v) => E.num(v), bl = E.blank, loan = s.facility || 0;
  const dd = r.drawdown, mStart = E.eomonth(dd, -1) + 1, mat = s.maturity, hEnd = E.eomonth(dd, r.horizon - 1);
  const today = E.parseDate(new Date().toISOString().slice(0, 10));
  const ddf = (d) => dayf(d);
  const nm = (a, j) => a.name ? `“${a.name}”` : `row ${j + 1}`;

  // 1. percentages typed as fractions, implausible values
  for (const [k, l, th] of [['rate', 'Interest rate', 1], ['arrFee', 'Arrangement fee', 0.2], ['maxLTV', 'Maximum LTV', 1.5], ['haircut', 'Default haircut', 1], ['sweepDefault', 'Default sales sweep', 1.01], ['profitShare', 'Profit share', 1], ['fixedGain', 'Fixed capital gain', 0.1], ['sellCost', 'Selling costs', 0.1], ['releasePct', 'Release price', 2], ['refiLTV', 'Bank refinancing LTV', 1.5]]) {
    const v = n(i[k]);
    if (!bl(i[k]) && v > 0 && v < th) add({ id: 'frac:' + k, sev: 'error', title: `${l} is ${fmtP(v)}% – did you mean ${fmtP(v * 100)}%?`, why: 'Percentages are typed in percent (13.5 = 13.5%). A fraction like 0.135 is read as 0.135%.', tab: 'inputs', keys: ['inputs.' + k], fix: [{ label: `Change to ${fmtP(v * 100)}%`, run: (q) => { q.inputs[k] = fmtP(v * 100); } }] });
  }
  if (bl(i.drawdown)) add({ id: 'no-drawdown', sev: 'error', title: 'No drawdown date', why: 'The model starts on 1 Jan 2026 by default; every date in the cash flow is off.', tab: 'inputs', keys: ['inputs.drawdown'] });
  else if (dd < today - 62 && !['Funded', 'Realised', 'Repaid', 'Closed', 'Declined', 'Rejected'].includes(p.status)) add({ id: 'drawdown-past', sev: 'warn', title: `Drawdown date ${ddf(dd)} is in the past`, why: 'For a deal still being assessed, sales and interest are counted from a date that has already gone.', tab: 'inputs', keys: ['inputs.drawdown'], fix: [{ label: 'Move to the 1st of next month', run: (q) => { q.inputs.drawdown = nextMonthStart(); } }] });

  // 2. collateral and sales rows
  const lateN = p.assets.filter((pa) => !bl(pa.salePrice) && E.parseDate(pa.saleDate) > mat).length; // two or more: one item from lintLateSales
  const seen = {};
  p.assets.forEach((pa, j) => {
    const a = r.assets[j]; if (!a) return;
    const k = (f) => `assets.${j}.${f}`, filled = pa.name || !bl(pa.market) || !bl(pa.salePrice);
    if (!filled) return;
    const key = (pa.name || '').trim().toLowerCase();
    if (key) { if (seen[key] != null) add({ id: 'dup-asset:' + key, sev: 'warn', title: `${nm(pa, j)} appears twice in Collateral & sales`, why: 'Counted twice in collateral and sales.', tab: 'assets', keys: [k('name'), `assets.${seen[key]}.name`] }); else seen[key] = j; }
    if (!bl(pa.haircut) && n(pa.haircut) > 0 && n(pa.haircut) < 1) add({ id: 'frac-hc:' + j, sev: 'error', title: `Haircut on ${nm(pa, j)} is ${fmtP(n(pa.haircut))}% – did you mean ${fmtP(n(pa.haircut) * 100)}%?`, why: 'Percentages are typed in percent.', tab: 'assets', keys: [k('haircut')], fix: [{ label: `Change to ${fmtP(n(pa.haircut) * 100)}%`, run: (q) => { q.assets[j].haircut = fmtP(n(pa.haircut) * 100); } }] });
    if (!bl(pa.sweep) && n(pa.sweep) > 0 && n(pa.sweep) <= 1) add({ id: 'frac-sw:' + j, sev: 'error', title: `Sweep on ${nm(pa, j)} is ${fmtP(n(pa.sweep))}% – did you mean ${fmtP(n(pa.sweep) * 100)}%?`, why: 'Percentages are typed in percent.', tab: 'assets', keys: [k('sweep')], fix: [{ label: `Change to ${fmtP(n(pa.sweep) * 100)}%`, run: (q) => { q.assets[j].sweep = fmtP(n(pa.sweep) * 100); } }] });
    if (a.inColl && a.market == null && pa.name) add({ id: 'no-mv:' + j, sev: 'warn', title: `${nm(pa, j)} is in collateral without a market value`, why: 'It adds nothing to LTV or coverage.', tab: 'assets', keys: [k('market')] });
    if (loan > 0 && a.market > 0 && a.market < loan / 500) add({ id: 'thousands:' + j, sev: 'warn', title: `Market value of ${nm(pa, j)} is ${money(a.market)} against a ${money(loan)} loan`, why: 'Entered in thousands?', tab: 'assets', keys: [k('market')] });
    if (a.salePrice != null && a.saleDate == null) add({ id: 'price-nodate:' + j, sev: 'error', title: `${nm(pa, j)} has a sale price but no sale date`, why: 'Without a date the sale is not in the cash flow and repays nothing.', tab: 'assets', keys: [k('saleDate')] });
    if (a.saleDate != null && a.salePrice == null) add({ id: 'date-noprice:' + j, sev: 'error', title: `${nm(pa, j)} has a sale date but no sale price`, why: 'The sale is not counted.', tab: 'assets', keys: [k('salePrice')] });
    if (a.saleDate != null && a.salePrice != null) {
      if (a.saleDate > hEnd) { const per = Math.ceil((a.saleDate - dd) / 30.44) + 2; add({ id: 'sale-afterh:' + j, sev: 'error', title: `${nm(pa, j)} sells on ${ddf(a.saleDate)}, after the projection ends`, why: 'Sales after the last projected month are left out of the model completely.', tab: 'assets', keys: [k('saleDate')], fix: [{ label: `Extend projection to ${per} months`, run: (q) => { q.inputs.horizon = String(per); } }] }); }
      else if (a.saleDate > mat && lateN < 2) add({ id: 'sale-aftermat:' + j, sev: 'warn', title: `${nm(pa, j)} sells on ${ddf(a.saleDate)}, after the loan matures (${ddf(mat)})`, why: 'This sale cannot repay the loan; the full balance is due from the borrower at maturity.', tab: 'assets', keys: [k('saleDate')] });
      if (a.saleDate < mStart) add({ id: 'sale-before:' + j, sev: 'warn', title: `${nm(pa, j)} sale date ${ddf(a.saleDate)} is before the drawdown month`, why: 'Booked in month 1. If it already happened, it is not a source of repayment – enter it as equity or leave it out.', tab: 'assets', keys: [k('saleDate')] });
    }
    if (['Reserved', 'Preliminary contract'].includes(pa.status) && a.saleDate == null) add({ id: 'status-nodate:' + j, sev: 'error', title: `${nm(pa, j)} is ${pa.status.toLowerCase()} but has no sale date`, why: 'Enter the expected final deed date and the agreed price so it repays the loan.', tab: 'assets', keys: [k('saleDate')] });
    if (pa.status === 'Final deed signed' && a.saleDate != null && a.saleDate > today + 31) add({ id: 'status-future:' + j, sev: 'warn', title: `${nm(pa, j)} is marked as sold but the sale date is ${ddf(a.saleDate)}`, why: 'Status and date disagree.', tab: 'assets', keys: [k('status'), k('saleDate')] });
    if (a.deposit > 0 && a.salePrice != null && a.deposit > a.salePrice) add({ id: 'dep-big:' + j, sev: 'error', title: `Deposit on ${nm(pa, j)} is larger than its sale price`, why: 'Typo?', tab: 'assets', keys: [k('deposit')] });
  });
  // double-counted building: one row ≈ the sum of the units also listed
  const units = r.assets.filter((a) => a.inColl && a.market > 0 && a.salePrice != null);
  const uSum = units.reduce((x, a) => x + a.market, 0);
  if (units.length >= 2) r.assets.forEach((b, j) => {
    if (!b.inColl || !(b.market > 0) || b.salePrice != null) return;
    const ratio = b.market / uSum;
    if (ratio > 0.8 && ratio < 1.25) add({ id: 'double-coll:' + j, sev: 'error', title: `${nm(p.assets[j], j)} (${money(b.market)}) looks like the same property as the ${units.length} units for sale (${money(uSum)})`, why: 'Collateral counted twice: LTV comes out roughly half of the real figure.', tab: 'assets', keys: [`assets.${j}.market`, `assets.${j}.inColl`], fix: [{ label: `Take ${nm(p.assets[j], j)} out of collateral`, run: (q) => { q.assets[j].inColl = false; } }] });
  });

  // 3. adjustments
  const sales = p.assets.map((pa, j) => ({ j, name: pa.name, price: r.assets[j] ? r.assets[j].salePrice : null, list: r.assets[j] ? r.assets[j].listPrice : null }));
  p.adjustments.forEach((pa, j) => {
    const k = (f) => `adjustments.${j}.${f}`, amt = n(pa.amount), d = E.parseDate(pa.date), lab = pa.desc ? `“${pa.desc}”` : `adjustment ${j + 1}`;
    if (!amt && !pa.desc) return;
    if (d == null && amt) add({ id: 'adj-nodate:' + j, sev: 'error', title: `${lab} has no date`, why: 'Adjustments without a date are left out of the model.', tab: 'adjust', keys: [k('date')] });
    if (d != null && d > hEnd) add({ id: 'adj-afterh:' + j, sev: 'error', title: `${lab} is dated after the projection ends`, why: 'Left out of the model.', tab: 'adjust', keys: [k('date')] });
    if (d != null && pa.recurrence !== 'Monthly' && d < mStart) add({ id: 'adj-before:' + j, sev: 'warn', title: `${lab} is dated before the drawdown month`, why: 'Booked in month 1. If it already happened, it does not belong in the cash flow.', tab: 'adjust', keys: [k('date')] });
    if (pa.recurrence === 'Monthly' && d != null && !bl(pa.end) && E.parseDate(pa.end) < d) add({ id: 'adj-end:' + j, sev: 'error', title: `${lab} ends before it starts`, why: 'Counted once at most.', tab: 'adjust', keys: [k('end')] });
    if (amt < 0) add({ id: 'adj-neg:' + j, sev: 'error', title: `${lab} has a negative amount`, why: 'Amounts are always positive; the type (Income / Expense / Capex) sets the sign.', tab: 'adjust', keys: [k('amount')], fix: [{ label: 'Make it positive', run: (q) => { q.adjustments[j].amount = String(Math.abs(amt)); } }] });
    if (pa.type === 'Income' && pa.recurrence !== 'Monthly' && amt > 0) {
      const hit = sales.find((x) => (x.price && Math.abs(x.price - amt) <= x.price * 0.01) || (x.list && Math.abs(x.list - amt) <= x.list * 0.01));
      if (hit) add({ id: 'adj-dup-sale:' + j, sev: 'error', title: `Income ${lab} (${money(amt)}) is also entered as the sale of ${nm(p.assets[hit.j], hit.j)}`, why: 'The same money is counted twice: once as income in EBITDA and DSCR, once as a sale.', tab: 'adjust', keys: [k('amount'), `assets.${hit.j}.salePrice`], fix: [{ label: 'Delete this adjustment', run: (q) => { q.adjustments.splice(j, 1); } }] });
    }
  });

  // 4. refinancing, equity and tranches entered twice or inconsistently
  if (r.refiManual > 0 && r.refiTable > 0) add({ id: 'refi-double', sev: 'warn', title: 'Debt refinanced is entered both in Inputs and in the Existing debts table', why: `${money(r.refiManual)} + ${money(r.refiTable)}. The two are added together: check it is not the same debt twice.`, tab: 'inputs', keys: ['inputs.refinanced'] });
  if (!i.equityAuto && n(i.equity) > 0) {
    const early = r.assets.filter((a) => a.salePrice != null && a.saleDate != null && a.saleDate <= dd + 120);
    const tot = early.reduce((x, a) => x + a.salePrice, 0);
    const one = r.assets.find((a) => a.salePrice && Math.abs(a.salePrice - n(i.equity)) <= a.salePrice * 0.01);
    if (one || (tot > 0 && Math.abs(tot - n(i.equity)) <= tot * 0.01)) add({ id: 'equity-dup', sev: 'error', title: `Borrower equity (${money(n(i.equity))}) equals presale proceeds that are also entered as sales`, why: 'Counted twice: once as cash at drawdown, once when the sale happens. Keep only one.', tab: 'inputs', keys: ['inputs.equity'] });
  }
  if (r.tranchesOn) {
    p.tranches.forEach((tr, j) => { const d = E.parseDate(tr.date); if (d != null && d > mat) add({ id: 'tranche-late:' + j, sev: 'error', title: `Tranche ${j + 1} is drawn after maturity`, why: `${ddf(d)} vs maturity ${ddf(mat)}.`, tab: 'inputs', keys: [`tranches.${j}.date`] }); });
    if (n(i.loan) > 0 && Math.abs(n(i.loan) - r.facility) > 1) add({ id: 'tranche-sum', sev: 'info', title: `Tranches add up to ${money(r.facility)}, the loan amount field says ${money(n(i.loan))}`, why: 'With tranches on, the facility is the sum of tranches.', tab: 'inputs', keys: ['inputs.tranchesOn'], fix: [{ label: `Set loan amount to ${money(r.facility)}`, run: (q) => { q.inputs.loan = String(Math.round(r.facility)); } }] });
  }

  for (const f of [lintTranches, lintLateSales, lintAssumed, lintWorks, lintPayPlan, lintLoans]) f(p, m, add);
  const ign = new Set(i.ignoredChecks || []);
  const ord = { error: 0, warn: 1, info: 2 };
  return out.map((x) => Object.assign(x, { ignored: ign.has(x.id) })).sort((a, b) => ord[a.sev] - ord[b.sev]);
}
let LINT = { model: null, list: [] };
function issues() { // always on the original currency, whatever the results are shown in
  const p = cur(), m = S.modelOrig; if (!p || !m) return [];
  if (LINT.model !== m || LINT.ign !== JSON.stringify(p.inputs.ignoredChecks || [])) {
    const keep = S.model, keepC = CUR; S.model = m; CUR = p.inputs.currency || 'EUR';
    try { LINT = { model: m, ign: JSON.stringify(p.inputs.ignoredChecks || []), list: lint(p, m) }; } catch (e) { console.error(e); LINT = { model: m, list: [] }; } finally { S.model = keep; CUR = keepC; }
  }
  return LINT.list;
}
const activeIssues = () => issues().filter((x) => !x.ignored);
function issueCounts() { const a = activeIssues(); return { error: a.filter((x) => x.sev === 'error').length, warn: a.filter((x) => x.sev === 'warn').length, info: a.filter((x) => x.sev === 'info').length }; }
const SEV = { error: ['Likely mistake', 'bad'], warn: ['Check', 'warnp'], info: ['Note', 'info'] };
OUT.mcheck = () => {
  const keepC = CUR; CUR = cur().inputs.currency || 'EUR';
  try { return mcheckHtml(); } finally { CUR = keepC; }
};
function mcheckHtml() {
  const all = issues(), act = all.filter((x) => !x.ignored), ign = all.filter((x) => x.ignored);
  if (!all.length) return '<div class="sub">No mistakes found. The checks cover typos in percentages, double counting, dates outside the model, sources and uses, and how interest and repayment are paid.</div>';
  const row = (x) => { const k = all.indexOf(x); return `<div class="iss iss-${x.sev}"><span class="pill ${SEV[x.sev][1]}">${SEV[x.sev][0]}</span><div class="issb"><b>${esc(x.title)}</b><div class="sub">${esc(x.why)}</div>
    <div class="row" style="gap:6px;margin-top:6px">${(x.fix || []).map((f, fi) => `<button class="btn sm primary" data-act="fix-issue" data-i="${k}" data-f="${fi}">${esc(f.label)}</button>`).join('')}${x.tab && x.tab !== 'summary' ? `<button class="btn sm" data-act="goto-issue" data-i="${k}">Show me</button>` : ''}<button class="btn sm ghost" data-act="ignore-issue" data-id="${esc(x.id)}">${x.ignored ? 'Check again' : 'Ignore'}</button></div></div></div>`; };
  return (act.length ? act.map(row).join('') : '<div class="sub">Nothing left to review.</div>') + (ign.length ? `<details style="margin-top:8px"><summary class="sub">${ign.length} ignored</summary>${ign.map(row).join('')}</details>` : '');
}
function afterRefresh() {
  if (S.view !== 'project' || !S.model) return;
  markSources();
  const c = issueCounts(), body = $('#tabbody'); if (!body) return;
  let bar = $('#issuebar');
  if ((c.error || c.warn) && S.tab !== 'summary') {
    if (!bar) { bar = document.createElement('div'); bar.id = 'issuebar'; body.prepend(bar); }
    bar.className = 'issuebar ' + (c.error ? 'bad' : 'chk');
    bar.innerHTML = `<span>${c.error ? `<b>${c.error} likely mistake${c.error > 1 ? 's' : ''}</b>` : ''}${c.error && c.warn ? ' · ' : ''}${c.warn ? `${c.warn} thing${c.warn > 1 ? 's' : ''} to check` : ''} in this model</span><button class="btn sm" data-act="goto-check">Review</button>`;
  } else if (bar) bar.remove();
  document.querySelectorAll('.iss-mark-error,.iss-mark-warn,.iss-mark-info').forEach((el) => { el.classList.remove('iss-mark-error', 'iss-mark-warn', 'iss-mark-info'); el.removeAttribute('data-iss'); });
  for (const x of activeIssues()) for (const k of x.keys || []) { const el = document.querySelector(`[data-k="${CSS.escape(k)}"]`); if (el && !el.dataset.iss) { el.classList.add('iss-mark-' + x.sev); el.dataset.iss = '1'; el.title = x.title; } }
}
function editProject(fn, msg) { const p = cur(); fn(p); scheduleSave(S.curId); recalc(true); render(); if (msg) toast(msg); }
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || S.view !== 'project') return;
  const a = b.dataset.act;
  if (a === 'set-type') return setDealType(b.dataset.t);
  if (a === 'goto-check') { S.tab = 'summary'; render(); setTimeout(() => { const c = $('#mcheck'); if (c) c.scrollIntoView({ block: 'start' }); }, 0); return; }
  if (a === 'su-grossup') return editProject((p) => { p.inputs.loan = b.dataset.v; }, `Loan set to ${money(+b.dataset.v)}`);
  if (a === 'su-equity') return editProject((p) => { p.inputs.equityAuto = false; p.inputs.equity = String(Math.ceil(E.num(p.inputs.equity) + +b.dataset.v)); }, 'Borrower equity added');
  const x = issues()[+b.dataset.i];
  if (a === 'fix-issue' && x && x.fix) { const f = x.fix[+b.dataset.f]; return editProject(f.run, `${f.label} · ⌘Z to undo`); }
  if (a === 'ignore-issue') return editProject((p) => { const s = new Set(p.inputs.ignoredChecks || []); if (s.has(b.dataset.id)) s.delete(b.dataset.id); else s.add(b.dataset.id); p.inputs.ignoredChecks = [...s]; });
  if (a === 'goto-issue' && x) {
    S.tab = x.tab; if (x.tab === 'inputs') { const sid = inSecOf(((x.keys || [])[0] || '').replace(/^inputs\./, '')); if (sid) OPEN_SECS.add(sid); }
    render();
    setTimeout(() => { const el = (x.keys || []).map((k) => document.querySelector(`[data-k="${CSS.escape(k)}"]`)).find(Boolean); if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); el.classList.add('iss-flash'); setTimeout(() => el.classList.remove('iss-flash'), 1600); } }, 30);
  }
});
let typeHandled = 0;
const onTypeEvt = (e) => { const k = e.target.dataset && e.target.dataset.k; if (k !== 'inputs.dealType' && k !== 'inputs.showAll') return; if (Date.now() - typeHandled < 300) return; typeHandled = Date.now(); if (k === 'inputs.dealType') { const v = e.target.value; if (v && looksNew(cur())) Object.assign(cur().inputs, TYPE_CFG[v].defaults || {}); scheduleSave(S.curId); recalc(true); render(); } else render(); };
document.addEventListener('input', onTypeEvt); document.addEventListener('change', onTypeEvt);
function lintCount(p, m) { try { return lint(p, m).filter((x) => !x.ignored && x.sev !== 'info').length; } catch (e) { return 0; } }

// ---- construction / renovation and VAT on sale prices
function lintWorks(p, m, add) {
  const i = p.inputs, r = m.r, s = m.summary, c = r.constr;
  if (i.saleVatMode === 'incl' && !(E.pct(i.saleVatRate) > 0)) add({ id: 'salevat-zero', sev: 'warn', title: 'Sale prices are marked incl. VAT, but the VAT rate is 0%', why: 'Proceeds would include the VAT that goes to the state.', tab: 'inputs', keys: ['inputs.saleVatRate'] });
  if (!i.constrOn) return;
  if (!c) { add({ id: 'works-nolines', sev: 'warn', title: 'Construction is switched on but has no budget lines', why: 'Add the works budget on Inputs → Construction / renovation; until then nothing is modelled.', tab: 'inputs', keys: ['inputs.constrOn'] }); return; }
  const W = m.k.W, comp = s.completion;
  if (E.blank(i.worksEnd)) add({ id: 'works-noend', sev: 'warn', title: 'No completion date', why: 'The works are spread until the end of the loan term. Enter the planned completion.', tab: 'inputs', keys: ['inputs.worksEnd'] });
  if (comp > s.maturity) add({ id: 'works-aftermat', sev: 'error', title: `Completion (${datef(comp)}) is after the loan matures (${datef(s.maturity)})`, why: 'The loan must be repaid before the building is finished and can be sold.', tab: 'inputs', keys: ['inputs.worksEnd', 'inputs.term'] });
  if (c.curve === 'manual') { const bad = p.constrLines.filter((l) => { const t = (l.sched || []).reduce((a, v) => a + E.num(v), 0), rem = Math.max(0, E.num(l.budget) - E.num(l.spent)); return rem > 0 && Math.abs(t - rem) > Math.max(1, rem * 0.005); });
    if (bad.length) add({ id: 'works-sched', sev: 'warn', title: `Monthly schedule does not add up to the remaining budget on ${bad.length} line${bad.length > 1 ? 's' : ''}`, why: 'The schedule is used only for its shape and scaled to budget − spent to date.', tab: 'inputs', keys: ['inputs.spendCurve'] }); }
  if (r.progressMode) { const late = r.tranches.filter((t, k) => t.milestone != null && r.trancheAt[k] > r.term); if (late.length) add({ id: 'works-trlate', sev: 'error', title: 'A tranche milestone is only reached after maturity', why: 'That tranche would never be drawn while the loan runs.', tab: 'inputs', keys: [`tranches.${late[0].idx}.milestone`] }); }
}

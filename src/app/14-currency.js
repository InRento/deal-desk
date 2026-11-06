// ================= Currency view (original / EUR) and the €5m check =================
// Inputs always stay in the project currency. The Deal tab's results and scenarios, Summary, Cash flow, Sensitivity, the KPI bar on those tabs,
// the committee deck and the Excel export can be shown in EUR: the engine then runs on a copy of the project
// with every money field divided by the rate (percentages, dates and areas unchanged).
const OUT_TABS = ['deal', 'summary', 'cashflow', 'sens'];
const baseCcy = (p) => String((p && p.inputs.currency) || 'EUR').trim().toUpperCase();
const fxRateOf = (p) => (baseCcy(p) === 'EUR' ? 1 : E.num(p.inputs.fxRate));
S.ccyView = 'orig';
let FORCE_VIEW = false;
const fxOn = () => { const p = cur(); return !!p && S.ccyView === 'EUR' && baseCcy(p) !== 'EUR' && fxRateOf(p) > 0; };
const viewEUR = () => fxOn() && (FORCE_VIEW || OUT_TABS.includes(S.tab));
const MONEY_IN = INPUT_SECTIONS().flatMap((s) => s[2]).filter((f) => f.kind === 'money').map((f) => f.k);
const MONEY_KIDS = { constrLines: ['budget', 'spent'], assets: ['marketDone', 'market', 'alloc', 'acqPrice', 'rent', 'salePrice', 'minPrice', 'notary', 'listPrice', 'deposit'], adjustments: ['amount'], tranches: ['amount'], debts: ['balance', 'prepay', 'service'], revLines: ['price'], costLines: ['amount'] };
function convertProject(p, rate) {
  const q = clone(p), cv = (v) => (E.blank(v) ? v : String(E.num(v) / rate));
  for (const k of MONEY_IN) if (k in q.inputs) q.inputs[k] = cv(q.inputs[k]);
  q.inputs.currency = 'EUR';
  for (const [t, ks] of Object.entries(MONEY_KIDS)) for (const row of q[t] || []) for (const k of ks) { if (t === 'costLines' && row.kind === 'pctRev') continue; row[k] = cv(row[k]); }
  for (const l of q.revLines || []) if (Array.isArray(l.priceM)) l.priceM = l.priceM.map(cv);
  for (const l of q.constrLines || []) if (Array.isArray(l.sched)) l.sched = l.sched.map(cv);
  for (const l of q.costLines || []) if (Array.isArray(l.amountM) && l.kind !== 'pctRev') l.amountM = l.amountM.map(cv);
  return q;
}
let MPC = {};
function mp() { // the project the outputs are calculated from
  const p = cur(); if (!viewEUR()) return p;
  const rate = fxRateOf(p), ver = S.ver[S.curId] || 0;
  if (MPC.p !== p || MPC.ver !== ver || MPC.rate !== rate) MPC = { p, ver, rate, conv: convertProject(p, rate) };
  return MPC.conv;
}
// the model check: original currency, original model
// deck and Excel export follow the switch on every tab
function withView(fn) { return function (...a) { if (!fxOn()) return fn.apply(this, a); FORCE_VIEW = true; recalc(true); try { return fn.apply(this, a); } finally { FORCE_VIEW = false; recalc(true); } }; }

// ---- switch in the top bar
function ccySwitch() {
  const p = cur(); if (!p || baseCcy(p) === 'EUR') return '';
  const b = baseCcy(p), on = S.ccyView === 'EUR';
  return `<span class="ccyseg" role="group" aria-label="Currency of the results" title="Results on Deal, Summary, Cash flow, Sensitivity, the deck and Excel export. Inputs stay in ${esc(b)}."><button class="${on ? '' : 'on'}" data-act="ccy" data-v="orig" aria-pressed="${!on}">${esc(b)}</button><button class="${on ? 'on' : ''}" data-act="ccy" data-v="EUR" aria-pressed="${on}">EUR</button></span>`;
}
async function fetchEcb(p, quiet) {
  try {
    const r = await api('GET', '/api/fx');
    const v = r && r.ok && r.rates ? r.rates[baseCcy(p)] : null;
    if (!v) { if (!quiet) toast(r && r.ok ? `The ECB has no rate for ${baseCcy(p)} – enter it in Inputs` : (r && r.error) || 'Could not get the ECB rate'); return false; }
    p.inputs.fxRate = String(v); p.inputs.fxDate = r.date || ''; scheduleSave(S.curId);
    if (!quiet) toast(`ECB rate ${v} ${baseCcy(p)}/EUR (${r.date})`);
    return true;
  } catch (e) { if (!quiet) toast('Could not get the ECB rate – enter it in Inputs'); return false; }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b || S.view !== 'project') return;
  const p = cur();
  if (b.dataset.act === 'ccy') {
    if (b.dataset.v === 'EUR' && !(fxRateOf(p) > 0) && !(await fetchEcb(p))) { S.tab = 'inputs'; OPEN_SECS.add('1'); render(); setTimeout(() => { const el = $('[data-k="inputs.fxRate"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 30); return; }
    S.ccyView = b.dataset.v; recalc(true); render();
    if (S.ccyView === 'EUR' && !OUT_TABS.includes(S.tab)) toast('Results in EUR on Deal, Summary, Cash flow and Sensitivity. Inputs stay in ' + baseCcy(p));
  }
  if (b.dataset.act === 'fx-ecb') { if (await fetchEcb(p)) { recalc(true); renderTab(); } }
});

// which currency amounts are typed in, and the rate used for the EUR view (Inputs and Deal tabs)
const moneyUnit = () => { const p = cur(), b = baseCcy(p); return b === 'EUR' ? '' : b; };
function ccyNote(p) {
  const b = baseCcy(p), i = p.inputs, rate = fxRateOf(p); if (b === 'EUR') return '';
  const rt = rate > 0 ? `1 EUR = ${esc(fmtP(rate))} ${esc(b)}${i.fxDate ? ` (rate of ${esc(E.parseDate(i.fxDate) != null ? dayf(E.parseDate(i.fxDate)) : i.fxDate)})` : ' (no date)'}` : 'no EUR exchange rate set';
  const res = !(rate > 0) ? '' : viewEUR() ? ' · results shown in <b>EUR</b> at this rate' : S.ccyView === 'EUR' ? ` · results on this tab in ${esc(b)}; Deal, Summary, Cash flow and Sensitivity show EUR` : ` · results in ${esc(b)} – switch to EUR at the top`;
  return `<div class="ccynote"><span>Amounts are entered in <b>${esc(b)}</b> · ${rt}${res}</span>${rate > 0 ? '' : ' <button class="btn sm" data-act="fx-ecb">Get today\'s ECB rate</button>'}</div>`;
}
// the PLN / EUR switch in the top bar appears as soon as a non-EUR currency is entered
document.addEventListener('change', (e) => { // only the switch is redrawn, so a click on a tab in the same moment is not lost
  const k = e.target.dataset && e.target.dataset.k; if (S.view !== 'project' || (k !== 'inputs.currency' && k !== 'inputs.fxRate')) return;
  const old = $('.ccyseg'), html = ccySwitch();
  if (old) old.remove();
  const u = $('.undogrp'); if (u && html) u.insertAdjacentHTML('beforebegin', html);
});

// Core: helpers, formatting, defaults, state, saving, navigation, model run, top bar and KPI strip.
const E = Engine;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const STATUSES = ['New deal', 'Initial analysis', 'Underwriting', 'Turned in', 'Rejected', 'Funded', 'Realised']; // pipeline stages
const ACTIVE = ['New deal', 'Initial analysis', 'Underwriting', 'Turned in', 'Funded'];
const OLD_STATUS = { Lead: 'New deal', 'Credit committee': 'Turned in', Approved: 'Turned in', Repaid: 'Realised', Declined: 'Rejected', 'On hold': 'Initial analysis' };
const stCls = (s) => 'st-' + String(s || 'New deal').split(' ')[0];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- formatting ----------
let CUR = 'EUR';
const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sym = (c = CUR) => ({ EUR: '€', PLN: 'zł ', GBP: '£', USD: '$', RON: 'lei ', SEK: 'kr ' }[c] ?? c + ' ');
const money = (v, c) => (v == null || !isFinite(v) ? '–' : (v < 0 ? '−' : '') + sym(c) + nf0.format(Math.abs(Math.round(v))));
const plain = (v) => (v == null || !isFinite(v) ? '–' : Math.abs(v) < 0.5 ? '–' : (v < 0 ? '−' : '') + nf0.format(Math.abs(Math.round(v))));
const pctf = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%');
const xf = (v) => (v == null || !isFinite(v) ? '–' : v.toFixed(2) + '×');
const datef = (dn) => { if (dn == null) return '–'; const s = E.fmtDate(dn); const [y, m] = s.split('-'); return MON[+m - 1] + ' ' + y; };
const dayf = (dn) => (dn == null ? '–' : E.fmtDate(dn));

// ---------- defaults ----------
const DRIVERS = [
  { k: 'rev', label: 'Revenue / rent change', unit: '%', pct: true },
  { k: 'opex', label: 'Operating costs change', unit: '%', pct: true },
  { k: 'rentDelay', label: 'Revenue start delay', unit: 'mo', pct: false },
  { k: 'rate', label: 'Interest rate change', unit: 'pp', pct: true },
  { k: 'salePrice', label: 'Sale price change', unit: '%', pct: true },
  { k: 'saleDelay', label: 'Sale delay', unit: 'mo', pct: false },
  { k: 'value', label: 'Collateral value change', unit: '%', pct: true },
  { k: 'capex', label: 'Extra expenses / capex change', unit: '%', pct: true },
  { k: 'exitDelay', label: 'Late repayment (at default rate)', unit: 'mo', pct: false },
  { k: 'complDelay', label: 'Completion delay', unit: 'mo', pct: false, constr: true },
];
const driversOf = (p) => DRIVERS.filter((d) => !d.constr || (p && p.inputs.constrOn)); // completion delay only on deals with construction
const zeroSc = (name) => ({ name, rev: '0', opex: '0', rentDelay: '0', rate: '0', salePrice: '0', saleDelay: '0', value: '0', capex: '0', exitDelay: '0', complDelay: '0' });
const sc = (name, o) => Object.assign(zeroSc(name), o);
const DEFAULT_SCEN = () => [
  zeroSc('Base'), sc('Revenue -10%', { rev: '-10' }), sc('Revenue -20%, opex +10%', { rev: '-20', opex: '10' }), sc('Rate +2 pp', { rate: '2' }),
  sc('Start 3 m late, capex +20%', { rentDelay: '3', capex: '20' }), sc('Sales -15%, 6 m late', { salePrice: '-15', saleDelay: '6' }),
  sc('Value -20%', { value: '-20' }), sc('Repaid 6 m late', { exitDelay: '6' }),
  sc('Severe combined', { rev: '-20', opex: '15', rentDelay: '3', rate: '2', salePrice: '-20', saleDelay: '6', value: '-25', capex: '25', exitDelay: '6' }),
];
function nextMonthStart() { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10); }
const DEFAULT_INPUTS = () => ({
  currency: 'EUR', drawdown: nextMonthStart(), horizon: '24', openingCash: '0', opModel: 'simple',
  revenueSource: 'manual', revenue: '0', revGrowth: '0', opex: '0', opexGrowth: '0', cfStart: '', tax: '0', otherDebt: '0', otherDebtEnd: '',
  vat: '0', commission: '0', cardFee: '0', ancillary: '0',
  loan: '0', tranchesOn: false, rate: '10', term: '24', repayType: 'Bullet', grace: '0', capitalise: 'No', payMonths: Array(12).fill(true), payPlan: [], escrowOn: false,
  extOn: false, extMonths: '6', extFee: '1', extRate: '', defaultRate: '',
  sweepDefault: '100', sweepBasis: 'Gross sale price', sweepApplies: 'All asset sales', saleRepay: 'sweep', releasePct: '115',
  opSweepPct: '0', opSweepMin: '0', opSweepMonths: Array(12).fill(false),
  arrFee: '0', feeBasis: 'facility', feeTreatment: 'withheld', commitFee: '0', reserveMonths: '0', prepayFee: '0', exitFee: '0',
  fixedGain: '0', profitShare: '0', deduction: '3', acctFee: '0',
  refinanced: '0', purchaseSource: 'manual', purchase: '0', closingCosts: '0', otherUses: '0', equityAuto: true, equity: '', projectCost: '',
  haircut: '30', sellCost: '3', maxLTV: '70', minDSCR: '1.2', targetCover: '', dscrBasis: 'rolling12', exitCap: '', refiLTV: '',
  seasonality: Array(12).fill('1'),
  dealType: '', showAll: false, intTiming: 'monthly', saleOrder: 'principalFirst', ignoredChecks: [], fxRate: '', fxDate: '', sources: {},
  constrOn: false, worksStart: '', worksEnd: '', contingency: '10', spendCurve: 'even', fundingOrder: 'equityFirst', constrEquity: '0', collCredit: '50',
  costVatOn: false, costVatRate: '21', costVatLag: '2', trancheMode: 'dates', saleVatMode: 'excl', saleVatRate: '21',
});
function blankProject(name) {
  return {
    name: name || 'New project', status: 'New deal', nextAction: '', nextOwner: '', nextDue: '', borrower: '', country: 'LT', projectType: '', contact: '', notes: '', todos: [], judgement: {},
    inputs: DEFAULT_INPUTS(), assets: [blankAsset()], adjustments: [], scenarios: DEFAULT_SCEN(), tranches: [], debts: [], revLines: [], costLines: [], constrLines: [], loans: [],
    grid: { rowDriver: 'rev', colDriver: 'rate', rowVals: ['-30', '-20', '-10', '0', '10'], colVals: ['0', '1', '2', '3', '4'] },
  };
}
const blankAsset = () => ({ name: '', contractDate: '', payPlan: '', inColl: true, market: '', valDate: '', source: '', haircut: '', alloc: '', acqPrice: '', rent: '', area: '', saleDate: '', salePrice: '', sweep: '', minPrice: '', notary: '', notes: '', status: '', listPrice: '', deposit: '', depositHeld: '', marketDone: '' });
const blankAdj = () => ({ desc: '', type: 'Expense', date: '', recurrence: 'One-off', end: '', amount: '', notes: '' });
const blankTranche = () => ({ date: '', amount: '', label: '', milestone: '' });
const blankConstr = () => ({ name: '', budget: '', spent: '', sched: [] });
const blankDebt = () => ({ lender: '', balance: '', rate: '', maturity: '', prepay: '', refinanced: true, service: '', end: '', notes: '' });
const blankRev = () => ({ name: '', kind: 'nightly', units: '', price: '', occ: '', start: '', end: '', growth: '0', occM: Array(12).fill(''), priceM: Array(12).fill('') });
const blankCost = () => ({ name: '', kind: 'fixed', amount: '', growth: '0', start: '', end: '', months: '', amountM: Array(12).fill('') });
function normalise(p) {
  const b = blankProject();
  const inp = p.inputs || {};
  for (const k of Object.keys(inp)) if (inp[k] === '' && (k === 'payMonths' || k === 'opSweepMonths')) delete inp[k];
  p.inputs = Object.assign({}, b.inputs, inp);
  if (!Array.isArray(p.inputs.seasonality) || p.inputs.seasonality.length !== 12) p.inputs.seasonality = Array(12).fill('1');
  if (!Array.isArray(p.inputs.payMonths) || p.inputs.payMonths.length !== 12) p.inputs.payMonths = Array(12).fill(true);
  if (!Array.isArray(p.inputs.payPlan)) p.inputs.payPlan = [];
  if (!Array.isArray(p.inputs.opSweepMonths) || p.inputs.opSweepMonths.length !== 12) p.inputs.opSweepMonths = Array(12).fill(false);
  if (!Array.isArray(p.inputs.ignoredChecks)) p.inputs.ignoredChecks = [];
  if (!p.inputs.sources || typeof p.inputs.sources !== 'object' || Array.isArray(p.inputs.sources)) p.inputs.sources = {};
  for (const k of ['assets', 'adjustments', 'todos', 'tranches', 'debts', 'revLines', 'costLines', 'constrLines', 'loans']) if (!Array.isArray(p[k])) p[k] = [];
  for (const l of p.constrLines) if (!Array.isArray(l.sched)) l.sched = [];
  for (const l of p.revLines) { if (!Array.isArray(l.occM)) l.occM = Array(12).fill(''); if (!Array.isArray(l.priceM)) l.priceM = Array(12).fill(''); }
  for (const l of p.costLines) if (!Array.isArray(l.amountM)) l.amountM = Array(12).fill('');
  if (!Array.isArray(p.scenarios) || !p.scenarios.length) p.scenarios = DEFAULT_SCEN();
  for (const s of p.scenarios) for (const k of ['exitDelay', 'complDelay']) if (s[k] == null || s[k] === '') s[k] = '0';
  p.grid = Object.assign({}, b.grid, p.grid || {});
  for (const k of ['status', 'borrower', 'country', 'projectType', 'contact', 'notes']) if (p[k] == null) p[k] = b[k];
  if (!STATUSES.includes(p.status)) p.status = OLD_STATUS[p.status] || 'New deal'; // statuses used before the pipeline stages
  for (const k of ['nextAction', 'nextOwner', 'nextDue']) if (p[k] == null) p[k] = '';
  if (!p.judgement || typeof p.judgement !== 'object' || Array.isArray(p.judgement)) p.judgement = {};
  return p;
}
const devOf = (s) => Object.fromEntries(DRIVERS.map((d) => [d.k, d.pct ? E.pct(s[d.k]) : E.num(s[d.k])]));

// ---------- state ----------
const S = { projects: {}, view: 'home', curId: null, tab: 'overview', cfMode: 'monthly', filter: 'All', q: '', model: null, dirty: new Set(), saving: 0, saveErr: null, store: 'connecting', confirmDel: false, ver: {}, versions: null, openLine: null };
const cur = () => S.projects[S.curId];

// ---------- persistence: local SQLite via server.py ----------
const timers = {}; const chains = {};
async function api(method, path, body, raw) {
  const r = await fetch(path, { method, headers: body && !raw ? { 'Content-Type': 'application/json' } : {}, body: raw ? body : body ? JSON.stringify(body) : undefined });
  if (!r.ok) { let m = r.status; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
  return r.json();
}
async function initStore() {
  try {
    const list = await api('GET', '/api/projects');
    S.projects = {}; S.base = {}; for (const p of list) { S.base[p.id] = p._base; delete p._base; S.projects[p.id] = normalise(p); }
    S.store = 'sqlite'; S.loaded = true;
    try { S.info = await api('GET', '/api/info'); } catch {}
  } catch (e) { S.store = 'offline'; }
  render();
  mailBoot();
}
function scheduleSave(id, delay = 600) {
  undoTrack(id);
  S.dirty.add(id); S.ver[id] = (S.ver[id] || 0) + 1; renderSaveState();
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => saveNow(id), delay);
}
function metricsOf(p, res) {
  try {
    const m = (res || E.run(p)).summary, r = (res || E.run(p)).r;
    return { loan: m.facility, rate: r.rate, term: r.termBase, ltv0: m.ltv0, ltvFs0: m.ltvFs0, ltc: m.ltc, cover0: m.cover0, maxLtvFs: m.maxLtvFs, minDscr: m.minDscr, minDscr12: m.minDscr12, avgDscr: m.avgDscr, minIcr: m.minIcr,
      lowCash: m.lowCash, reserveNeed: m.reserveNeed, negMonths: m.negMonths, interest: m.interest, fees: m.fees, gains: m.gains, pshare: m.pshare, profit: m.profit, irr: m.irr, simpleYield: m.simpleYield, multiple: m.multiple,
      headroom: m.headroom, collateral: m.mkt0, sizeMax: m.sizeMax, exitLTV: m.exitLTV, paydown: m.paydown, flags: m.flags + lintCount(p, res || E.run(p)),
      drawdown: E.fmtDate(r.drawdown), repaid: m.repaidDate == null ? null : E.fmtDate(m.repaidDate), maturity: E.fmtDate(m.maturity) };
  } catch { return null; }
}
function saveNow(id) {
  const p = S.projects[id]; if (!p) return;
  p.updatedAt = new Date().toISOString();
  const body = clone(p); delete body._new; delete body.id; body.metrics = metricsOf(p); body._base = (S.base || {})[id];
  const ver = S.ver[id] || 0;
  if (S.store !== 'sqlite') { S.saveErr = 'Not saved – Deal Desk server is not running'; renderSaveState(); return; }
  S.saving++; renderSaveState();
  chains[id] = (chains[id] || Promise.resolve()).then(() => api('PUT', '/api/projects/' + encodeURIComponent(id), body)).then(() => {
    delete p._new; S.saveErr = null;
    if ((S.ver[id] || 0) === ver) S.dirty.delete(id);
  }).catch((e) => { S.saveErr = /^Not saved/.test(e.message) ? e.message : 'Save failed – is the Deal Desk window still open?'; }).finally(() => { S.saving--; renderSaveState(); })
    .then(() => vSyncActive(id)); // the open version follows every save
  return chains[id];
}
async function flush(id) { if (timers[id]) { clearTimeout(timers[id]); timers[id] = null; await saveNow(id); } else if (chains[id]) await chains[id]; }
async function deleteProject(id) {
  clearTimeout(timers[id]);
  try { await api('DELETE', '/api/projects/' + encodeURIComponent(id)); } catch { toast('Delete failed – is the server running?'); return; }
  delete S.projects[id]; S.dirty.delete(id);
  go('home'); toast('Project deleted');
}
async function backupDb() { try { const r = await api('POST', '/api/backup'); toast('Backup saved: ' + r.file); } catch { toast('Backup failed'); } }
function renderSaveState() {
  const el = $('#savestate'); if (!el) return;
  el.classList.toggle('err', !!S.saveErr || S.store === 'offline');
  el.textContent = S.saveErr ? S.saveErr : S.store === 'offline' ? 'Server not running – changes are not saved' : (S.saving || (S.curId && S.dirty.has(S.curId))) ? 'Saving…' : S.store === 'sqlite' ? 'Saved to deals.sqlite' : 'Connecting…';
}
let toastT; function toast(msg) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3000); }

// ---------- navigation ----------
function go(view, id, tab) {
  if (view !== 'project' || id !== S.curId) { closeMail(); TR.stack = []; renderTrace(); }
  if (id !== S.curId) S.cmpSel = null;
  S.view = view; S.curId = id || null; S.confirmDel = false; S.versions = null; S.openLine = null;
  if (tab) S.tab = tab;
  if (view === 'project') { undoInit(id); CUR = cur().inputs.currency || 'EUR'; recalc(true); loadSide(); }
  render(); window.scrollTo(0, 0);
}
function render() { if (S.view === 'home') renderHome(); else renderProject(); }
async function loadSide() {
  const id = S.curId; if (!id || S.store !== 'sqlite' || cur()._new) { S.versions = []; return; }
  try { const v = await api('GET', `/api/projects/${encodeURIComponent(id)}/versions`); if (S.curId === id) { S.versions = v; if (['overview', 'versions'].includes(S.tab)) renderTab(); } } catch { S.versions = []; }
  const vs = $('#vsel'); if (vs && S.view === 'project') { const l = vs.closest('.vswitch'); if (l) l.outerHTML = vSwitcher(); }
}

// ---------- model (see currency view for mp()) ----------
let recalcT;
// recalc: outputs from mp(); the model check always uses the original currency
function recalc(sync) {
  const run = () => {
    const p = cur(); if (!p) return;
    const eur = viewEUR();
    try {
      S.modelOrig = E.run(p);
      S.model = eur ? E.run(mp()) : S.modelOrig; S.modelErr = null; S.modelMode = eur;
    } catch (e) { S.modelErr = String(e); console.error(e); }
    CUR = eur ? 'EUR' : (p.inputs.currency || 'EUR');
    S.sens = null; S.be = null;
    refreshOutputs();
  };
  clearTimeout(recalcT); if (sync) run(); else recalcT = setTimeout(run, 160);
}
function sensModel() {
  if (S.sens) return S.sens;
  const p = mp(), R = E.resolve(p);
  S.sens = { scen: p.scenarios.map((s) => ({ name: s.name, res: E.run(p, devOf(s), { resolved: R }) })) };
  return S.sens;
}
function breakEvens() { if (!S.be) { try { S.be = E.breakEvens(mp()); } catch (e) { S.be = {}; console.error(e); } } return S.be; }

// ---------- top bar & KPIs ----------
const TABS = [['overview', 'Overview'], ['inputs', 'Inputs'], ['ops', 'Operating model'], ['assets', 'Collateral & sales'], ['adjust', 'Adjustments'], ['summary', 'Summary'], ['cashflow', 'Cash flow'], ['sens', 'Sensitivity'], ['versions', 'Versions']];
function topBar() {
  const p = cur();
  return `<header class="top"><div class="wrap">
    <button class="brand" data-act="home" title="All projects"><span class="mark">IR</span>Deal Desk</button>
    ${p ? `<span class="crumb">/ <b>${esc(p.name)}</b> <span class="pill ${stCls(p.status)}">${esc(p.status)}</span></span>` : ''}
    ${p ? vSwitcher() : ''}<span class="spacer"></span><span id="savestate" class="savestate" aria-live="polite"></span>
    ${p ? `${ccySwitch()}<span class="undogrp"><button class="btn sm" id="undo-btn" title="Undo (⌘Z)" aria-label="Undo" ${UNDO[S.curId] && UNDO[S.curId].undo.length ? '' : 'disabled'}>↶</button><button class="btn sm" id="redo-btn" title="Redo (⇧⌘Z)" aria-label="Redo" ${UNDO[S.curId] && UNDO[S.curId].redo.length ? '' : 'disabled'}>↷</button></span><button class="btn sm primary" data-act="deck">Committee deck</button><button class="btn sm" data-act="export-xlsx">Export Excel</button>` : `<button class="btn primary" data-act="new">New project</button>`}
  </div>
  ${p ? `<div class="bar2"><div class="kpis" id="kpis"></div>
  <nav class="tabs" role="tablist" id="tabs">${visibleTabs().map((t) => `<button class="tab" role="tab" data-tab="${t[0]}" aria-selected="${S.tab === t[0]}">${t[1]}</button>`).join('')}</nav></div>` : ''}
  </header>`;
}
function cls(v, good, bad) { if (v == null) return ''; return good(v) ? 'good' : bad(v) ? 'bad' : ''; }
function renderKpis() {
  const el = $('#kpis'); if (!el || !S.model) return;
  const s = S.model.summary, r = S.model.r;
  const k = (l, v, c = '', tr = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${c}"${tr ? ` data-tr="m:${tr}"` : ''}>${v}</div></div>`;
  el.innerHTML = k(r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), '', 'facility') + k('Rate · term', `${pctf(r.rate, 2)} · ${r.termBase}${r.extOn ? '+' + r.extMonths : ''} m`) +
    k('LTV', pctf(s.ltv0), cls(s.ltv0, (v) => v <= r.maxLTV, (v) => v > r.maxLTV), 'ltv0') +
    k('LTV forced', pctf(s.ltvFs0), cls(s.ltvFs0, (v) => v <= r.maxLTV, (v) => v > r.maxLTV), 'ltvFs0') +
    k(r.dscrBasis === 'monthly' ? 'Min DSCR' : 'Min DSCR 12m', xf(s.dscrTest), cls(s.dscrTest, (v) => v >= r.minDSCR, (v) => v < r.minDSCR), 'dscrTest') +
    k('Cash low pre-exit', money(s.lowCashPre), s.lowCashPre < 0 ? 'bad' : '', 'lowCashPre') +
    k('InRento IRR', pctf(s.irr, 2), '', 'irr') + k('Lender profit', money(s.profit), '', 'profit') +
    (() => { const c = issueCounts(), f = s.flags + c.error + c.warn; return `<button class="kpi kpibtn" data-act="goto-check" title="Model checks and credit flags"><div class="l">Checks</div><div class="v ${c.error ? 'bad' : f ? 'warn' : 'good'}">${c.error ? c.error + ' mistake' + (c.error > 1 ? 's' : '') + (f - c.error ? ' · ' + (f - c.error) + ' flag' + (f - c.error > 1 ? 's' : '') : '') : f ? f + ' to check' : 'All OK'}</div></button>`; })();
}

// ---------- dates (ISO strings, working days) ----------
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const isoAdd = (iso, days) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
function wdBetween(a, b) { // working days (Mon–Fri) from a to b: Monday → Wednesday = 2
  if (!a || !b || b <= a) return 0; let n = 0, d = a;
  while (d < b) { d = isoAdd(d, 1); const w = new Date(d + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
function wdAdd(a, n) { let d = a; while (n > 0) { d = isoAdd(d, 1); const w = new Date(d + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) n--; } return d; }
const dshort = (iso) => (iso ? new Date(String(iso).length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const dtime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

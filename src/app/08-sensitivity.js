// Sensitivity tab (v3.25): three questions, answer first, detail on request.
//   1 How much room is there?  – margin for error per driver (bars), collateral value break-evens, DSCR break-even on income deals
//   2 Your scenarios           – one row each: what changes, outcome, lowest cash, cash at maturity, peak forced-sale LTV; edit in place
//   3 Two drivers together     – grid preset by deal type (prices × delay, or revenue × costs); your own grid on request
function tabSens() {
  const p = cur();
  return `<div class="stack">
  <div class="card"><h2 style="margin-bottom:4px">How much room is there?</h2><div class="sub" style="margin-bottom:10px">Each driver moved on its own, everything else at plan.</div><div data-out="room"></div></div>
  <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><div><h2>Your scenarios</h2><div class="sub">Each reruns the whole monthly cash flow. Edit to change what a scenario moves.</div></div>
    <div class="row"><button class="btn sm" data-act="add-sc">Add scenario</button><button class="btn sm ghost" data-act="reset-sc">Reset to standard set</button></div></div>
    ${scTable(p)}
    <div class="row" style="margin:16px 0 4px;gap:10px;align-items:center"><h3 id="sens-metric-h">${esc(sensMetric().label)} by scenario</h3><select class="in" id="sens-metric" aria-label="Metric to chart" style="width:auto">${sensMetrics().map((x) => `<option value="${x.k}" ${x.k === sensMetric().k ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div><div class="legend" id="lg-sens"></div><div class="chart" id="ch-sens"></div>
    <details class="sc-all" style="margin-top:12px"><summary>All metrics by scenario</summary><div class="tblwrap" data-out="sensres" style="margin-top:8px"></div></details></div>
  <div class="card"><h2 style="margin-bottom:4px">Two drivers together</h2><div class="sub" style="margin-bottom:10px">Does the loan get repaid when both go wrong at once?</div><div data-out="grid2"></div>
    <details style="margin-top:12px"${S.ownGrid ? ' open' : ''} data-own-grid><summary>Choose your own two drivers</summary><div style="margin-top:10px">
    <div class="row" style="margin-bottom:10px;align-items:flex-end">
      <label for="g-row"><span class="sub">Rows</span><br><select class="in" id="g-row" data-k="grid.rowDriver" style="width:auto">${driversOf(p).map((d) => `<option value="${d.k}" ${d.k === p.grid.rowDriver ? 'selected' : ''}>${d.label} (${d.unit})</option>`).join('')}</select></label>
      <span class="row" style="gap:4px">${p.grid.rowVals.map((v, k) => inp(`grid.rowVals.${k}`, v, 'num', 'style="width:62px" aria-label="Row value"')).join('')}</span></div>
    <div class="row" style="margin-bottom:14px;align-items:flex-end">
      <label for="g-col"><span class="sub">Columns</span><br><select class="in" id="g-col" data-k="grid.colDriver" style="width:auto">${driversOf(p).map((d) => `<option value="${d.k}" ${d.k === p.grid.colDriver ? 'selected' : ''}>${d.label} (${d.unit})</option>`).join('')}</select></label>
      <span class="row" style="gap:4px">${p.grid.colVals.map((v, k) => inp(`grid.colVals.${k}`, v, 'num', 'style="width:62px" aria-label="Column value"')).join('')}</span></div>
    <div data-out="grid"></div></div></details></div></div>`;
}
// opening "Choose your own two drivers" switches the main grid to your drivers; closing it brings back the standard grid
document.addEventListener('toggle', (e) => {
  if (!(e.target.matches && e.target.matches('details[data-own-grid]'))) return;
  S.ownGrid = e.target.open; const o = document.querySelector('[data-out="grid2"]'); if (o) o.innerHTML = OUT.grid2();
}, true);

// the metric charted under "Your scenarios" (S.sensMetric, this Mac only – not saved with the deal)
const pctAxis = (v) => `${Math.round(v * 100)}%`;
const SENS_METRICS = [
  { k: 'cash', label: 'Borrower cash', values: (rows) => rows.map((r) => r.cash) },
  { k: 'close', label: 'Loan outstanding', values: (rows) => rows.map((r) => r.close) },
  { k: 'ltv', label: 'LTV (market value)', values: (rows) => rows.map((r) => r.ltv), fmt: (v) => pctf(v), axis: pctAxis },
  { k: 'ltvFs', label: 'Forced-sale LTV', values: (rows) => rows.map((r) => r.ltvFs), fmt: (v) => pctf(v), axis: pctAxis },
  { k: 'collMkt', label: 'Collateral value', values: (rows) => rows.map((r) => r.collMkt) },
  { k: 'sales', label: 'Sales received (cumulative)', values: (rows) => { let t = 0; return rows.map((r) => (t += (r.saleColl || 0) + (r.saleOther || 0))); } },
  { k: 'revenue', label: 'Revenue per month', values: (rows) => rows.map((r) => r.revenue) },
  { k: 'interest', label: 'Interest charged per month', values: (rows) => rows.map((r) => r.interest) },
  { k: 'ncf', label: 'Net cash flow per month', values: (rows) => rows.map((r) => r.ncf) },
  { k: 'dscr', label: 'DSCR (monthly)', values: (rows) => rows.map((r) => (r.ds > 0 ? r.dscr : null)), fmt: (v) => xf(v), axis: (v) => `${v.toFixed(1)}×`, dscr: true },
];
// only metrics this deal has: something other than zero in the plan
function sensMetrics() {
  const rows = (S.model && S.model.rows) || [];
  return SENS_METRICS.filter((x) => (x.dscr ? usesDscr(S.model) : x.k === 'cash' || x.values(rows).some((v) => v != null && Math.abs(v) > 0.5e-6)));
}
function sensMetric() { const all = sensMetrics(); return all.find((x) => x.k === S.sensMetric) || all[0] || SENS_METRICS[0]; }
document.addEventListener('change', (e) => {
  if (e.target.id !== 'sens-metric') return;
  S.sensMetric = e.target.value; const h = $('#sens-metric-h'); if (h) h.textContent = `${sensMetric().label} by scenario`; drawCharts();
});

// ---- 1. how much room
OUT.room = () => {
  let M; try { M = marginCalc(); } catch (e) { console.error(e); return '<div class="sub">Could not calculate the margin for error.</div>'; }
  const b = breakEvens(), r = S.model.r;
  const bar = (d, o, v) => { const w = o.fails ? 0 : Math.min(1, (d.unit === 'months' ? o.x / 18 : o.x / (d.dir < 0 ? 0.5 : 1)) || 0); return `<div class="rm-bar"><i class="mg-bg-${v.tone}" style="width:${(w * 100).toFixed(0)}%"></i></div>`; };
  const cell = (d, which) => { const o = d[which], v = mgVal(d, o, which); return `<td class="rm-c"><div class="rm-v"><b class="mg-${v.tone}">${esc(v.txt)}</b><span class="sub">${esc(v.abs || '')}</span></div>${bar(d, o, v)}</td>`; };
  const rows = M.drivers.map((d) => `<tr><td><b>${esc(d.label)}</b><div class="sub">plan: ${esc(d.planText)}</div></td>${cell(d, 'cash')}${cell(d, 'repay')}</tr>`).join('');
  const pc = (v, none) => (v == null ? '–' : v < 0 ? `<span class="bad-t">${none}</span>` : `−${(v * 100).toFixed(1)}%`);
  const val = [];
  if (b.valueForced100 != null) val.push(`<div><span class="l">Collateral value can fall before a forced sale no longer covers the loan</span><b>${pc(b.valueForced100, 'not covered at drawdown')}</b><span class="sub">full facility vs value after the ${pctf(r.haircut, 0)} haircut</span></div>`);
  if (b.valueMaxLTV != null) val.push(`<div><span class="l">Collateral value can fall before LTV passes the ${pctf(r.maxLTV, 0)} limit</span><b>${pc(b.valueMaxLTV, 'already above the limit')}</b><span class="sub">full facility vs market value</span></div>`);
  if (b.headroom != null) val.push(`<div><span class="l">Value can fall before a loss</span><b class="${b.headroom < 0.1 ? 'bad-t' : ''}">${pctf(b.headroom)}</b><span class="sub">until a sale of the collateral no longer repays the loan, all interest and selling costs</span></div>`);
  if (usesDscr(S.model) && b.revDscrMin) { const o = b.revDscrMin; val.push(`<div><span class="l">Revenue can fall</span><b>${o.failsAtBase ? 'fails at plan' : o.beyond ? 'more than −100%' : `−${(o.value * 100).toFixed(1)}%`}</b><span class="sub">before DSCR drops below ${r.minDSCR}×</span></div>`); }
  return `${M.drivers.length ? `<div class="mghead">${esc(mgHeadline(M))}</div>
    <div class="tblwrap" style="margin-top:10px"><table class="rm"><thead><tr><th>Driver</th><th>Before the borrower runs short of cash</th><th>Before InRento is not repaid by maturity</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note" style="margin-top:6px">Green = plenty of room, amber = some, red = little or none. Grey = the other test breaks first.${M.refi ? ' A bank refinancing at the refinance LTV counts as a source.' : ''}</div>`
    : '<div class="sub">Add planned sales or revenue to see how far they can move.</div>'}
    ${val.length ? `<div class="rm-val">${val.join('')}</div>` : ''}`;
};

// ---- 2. your scenarios: static rows (names and the driver editor keep focus while typing), results refreshed per row
function scWhat(p, j) {
  const sc = p.scenarios[j] || {};
  return driversOf(p).map((d) => { const v = E.num(sc[d.k]); if (!v) return ''; return `${d.label} ${v > 0 ? '+' : '−'}${Math.abs(v)}${d.unit === '%' ? '%' : ' ' + (d.unit === 'mo' ? 'months' : d.unit)}`; }).filter(Boolean).map((t, k) => (k ? t[0].toLowerCase() + t.slice(1) : t)).join(', ') || 'the plan as entered';
}
function scTable(p) {
  const rows = p.scenarios.map((s, j) => {
    OUT[`sc-w-${j}`] = () => esc(scWhat(cur(), j));
    OUT[`sc-r-${j}`] = () => scResult(j);
    const open = S.scOpen === j;
    return `<tr class="sc-row"><td class="sc-n"><b>${esc(s.name || 'Scenario ' + (j + 1))}</b><div class="sub" data-out="sc-w-${j}"></div></td><td data-out="sc-r-${j}" class="sc-res"></td>
      <td class="sc-a"><button class="btn sm ghost" data-act="sc-edit" data-i="${j}" aria-expanded="${open}">${open ? 'Done' : 'Edit'}</button>${j ? `<button class="xbtn" data-act="del-sc" data-i="${j}" aria-label="Remove scenario">×</button>` : ''}</td></tr>
      ${open ? `<tr class="sc-ed"><td colspan="3"><div class="sc-grid"><label><span class="sub">Name</span>${inp(`scenarios.${j}.name`, s.name, 'text')}</label>${driversOf(p).map((d) => `<label><span class="sub">${d.label} (${d.unit})</span>${inp(`scenarios.${j}.${d.k}`, s[d.k], d.pct ? 'pct' : 'num')}</label>`).join('')}</div></td></tr>` : ''}`;
  }).join('');
  return `<div class="tblwrap"><table class="sc-t"><thead><tr><th>Scenario</th><th>Outcome</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function scResult(j) {
  const x = sensModel().scen[j]; if (!x) return '';
  const s = x.res.summary, r = S.model.r, o = dealOutcome(s, r), a = dealAtMat(s, r), base = sensModel().scen[0].res.summary;
  const same = j > 0 && ['lowCashPre', 'cashAtMaturity', 'repaidDate', 'maxLtvFs'].every((k) => Math.abs((s[k] || 0) - (base[k] || 0)) < 0.5);
  return `<div class="sc-out${same ? ' sc-same' : ''}"><span class="pill sc-${o.tone}">${esc(o.txt)}</span>${same ? '<span class="sub sc-note">Same as the first scenario – it moves nothing this deal has</span>' : ''}
    <span class="sc-m"><span class="l">Lowest cash</span><b class="${s.lowCashPre < -1 ? 'bad-t' : ''}">${money(s.lowCashPre)}</b><span class="sub">${s.lowCashPreDate ? mgMonth(s.lowCashPreDate) : ''}</span></span>
    <span class="sc-m"><span class="l">Cash at maturity${a.refi ? ' (incl. refi)' : ''}</span><b class="${a.v < -1 ? 'bad-t' : ''}">${money(a.v)}</b></span>
    <span class="sc-m"><span class="l">Peak forced-sale LTV</span><b class="${s.maxLtvFs > 1 ? 'bad-t' : ''}">${s.maxLtvFs == null ? '–' : pctf(s.maxLtvFs)}</b></span>
    <span class="sc-sp">${dealSpark(x.res.rows, s.maturity, o.tone)}</span></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-act="sc-edit"]'); if (!b) return;
  const j = +b.dataset.i; S.scOpen = S.scOpen === j ? null : j; renderTab();
});

// ---- 3. two drivers together: the grid that matters for the deal type (same as the committee deck)
OUT.grid2 = () => {
  let M; try { M = marginCalc(); } catch (e) { return ''; }
  const g = S.ownGrid ? ownGrid(M) : M.grid; if (!g) return '<div class="sub">Add planned sales or revenue to see the grid.</div>';
  const txt = (o) => (o.tone === 'good' ? 'Repaid' : o.tone === 'warn' ? `Needs ${mgK(-o.low)}` : `${mgK(o.short)} short`);
  return `<div class="tblwrap"><table class="heat g2"><thead><tr><th>${esc(g.rl)} ↓ · ${esc(g.cl)} →</th>${g.cv.map((v) => `<th class="n">${g.cf(v)}</th>`).join('')}</tr></thead><tbody>
    ${g.cells.map((row, i) => `<tr><td><b>${g.rf(g.rv[i])}</b>${g.rAbs ? `<div class="sub">${g.rAbs(g.rv[i])}</div>` : ''}</td>${row.map((o, k) => `<td class="n g2-${o.tone} ${(g.isBase ? g.isBase(i, k) : !i && !k) ? 'base' : ''}">${txt(o)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${g.own ? `<div class="note" style="margin-top:6px">Your two drivers (set below). Close “Choose your own two drivers” to go back to the standard grid.${g.flat ? ` ${esc(g.flat)}` : ''}</div>` : ''}
    <div class="note" style="margin-top:6px">Repaid = repaid by maturity with no cash shortfall · Needs = the borrower must add cash before maturity, the loan is still repaid · short = still owed to InRento at maturity. Outlined = plan.</div>`;
};
// the same grid for the two drivers chosen under "Choose your own two drivers" (p.grid)
function ownGrid(M) {
  const g = cur().grid, rd = DRIVERS.find((d) => d.k === g.rowDriver) || DRIVERS[0], cd = DRIVERS.find((d) => d.k === g.colDriver) || DRIVERS[3];
  const cv = (d, v) => (d.pct ? E.pct(v) : E.num(v));
  const lbl = (d, v) => (d.pct ? (E.pct(v) * 100).toFixed(1).replace(/\.0$/, '') + (d.unit === 'pp' ? ' pp' : '%') : `${E.num(v)} months`);
  const cells = g.rowVals.map((rv) => g.colVals.map((c) => { const dev = {}; dev[rd.k] = cv(rd, rv); dev[cd.k] = (rd.k === cd.k ? dev[cd.k] : 0) + cv(cd, c); return M.outcome(M.run(dev)); }));
  const same = (a, b) => a.tone === b.tone && Math.abs((a.low || 0) - (b.low || 0)) < 1 && Math.abs(a.short - b.short) < 1;
  const rowsFlat = cells.every((row) => row.every((o, k) => same(o, cells[0][k]))), colsFlat = cells.every((row) => row.every((o) => same(o, row[0])));
  const flat = [rowsFlat && `${rd.label} doesn't change cash or repayment on this deal`, colsFlat && `${cd.label} doesn't change cash or repayment on this deal`].filter(Boolean);
  return { own: true, rl: rd.label, cl: cd.label, rv: g.rowVals, cv: g.colVals, rf: (v) => lbl(rd, v), cf: (v) => lbl(cd, v), cells,
    isBase: (i, k) => cv(rd, g.rowVals[i]) === 0 && cv(cd, g.colVals[k]) === 0,
    flat: flat.length ? `${flat.join('; ')} – see the tables below for LTV.` : '' };
}
const SENS_ROWS = [
  ['Minimum DSCR (test basis)', (s) => xf(s.dscrTest), (s, r) => (s.dscrTest == null ? '' : s.dscrTest >= r.minDSCR ? 'hg' : 'hb')],
  ['Minimum monthly DSCR', (s) => xf(s.minDscr)], ['Average monthly DSCR', (s) => xf(s.avgDscr)], ['Minimum ICR', (s) => xf(s.minIcr)],
  ['Lowest cash before exit', (s) => money(s.lowCashPre), (s) => (s.lowCashPre < 0 ? 'hb' : 'hg')], ['Liquidity reserve needed', (s) => money(s.reserveNeed)], ['Months with negative cash', (s) => s.negMonths],
  ['Cash at maturity', (s) => money(s.cashAtMaturity), (s) => (s.cashAtMaturity < 0 ? 'hb' : 'hg')], ['Loan fully repaid in', (s) => (s.repaidDate ? datef(s.repaidDate) : 'Not repaid'), (s) => (s.repaidDate ? '' : 'hb')],
  ['Repaid via sales', (s) => money(s.viaSweep)], ['LTV at drawdown (market)', (s) => pctf(s.ltv0), (s, r) => (s.ltv0 > r.maxLTV ? 'hb' : '')], ['LTV at drawdown (lending value)', (s) => pctf(s.ltvFs0), (s, r) => (s.ltvFs0 > r.maxLTV ? 'hb' : '')],
  ['Highest LTV during loan (lending value)', (s) => pctf(s.maxLtvFs), (s, r) => (s.maxLtvFs > r.maxLTV ? 'hb' : '')], ['Exit LTV', (s) => pctf(s.exitLTV)], ['Value can fall before a loss', (s) => pctf(s.headroom)],
  ['InRento interest earned', (s) => money(s.interest)], ['Total lender profit', (s) => money(s.profit)], ['InRento IRR (annualised)', (s) => pctf(s.irr, 2)], ['Checks flagged', (s) => s.flags, (s) => (s.flags ? 'hb' : 'hg')],
];
// the full table on screen leaves out returns (InRento earns its fee) and DSCR on deals without income; the Excel export keeps all rows
const sensRowsShown = () => SENS_ROWS.filter(([l]) => !/IRR|profit|interest earned/i.test(l) && (usesDscr(S.model) || !/DSCR|ICR/.test(l)));
OUT.sensres = () => { const { scen } = sensModel(); const r = S.model.r; return `<table class="heat"><thead><tr><th>Metric</th>${scen.map((s) => `<th class="n">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${sensRowsShown().concat(loanSensRows(S.model)).map(([l, f, c]) => `<tr><td>${l}</td>${scen.map((s) => `<td class="n ${c ? c(s.res.summary, r) : ''}">${f(s.res.summary)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; };
function yearTable(key) {
  const { scen } = sensModel();
  const years = [...new Set(scen.flatMap((s) => s.res.annual.map((y) => y.year)))].sort();
  return `<table><thead><tr><th>Year</th>${scen.map((s) => `<th class="n">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${years.map((yr) => `<tr><td>${yr}</td>${scen.map((s) => { const y = s.res.annual.find((a) => a.year === yr); const v = y ? y[key] : null; return `<td class="n ${v < -0.5 ? 'neg bad-t' : ''}">${v == null ? '' : plain(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}
OUT.sensyr = () => yearTable('ncf');
OUT.sensye = () => yearTable('cash');
OUT.grid = () => {
  const p = cur(), g = p.grid, r = S.model.r, R = E.resolve(p);
  const rd = DRIVERS.find((d) => d.k === g.rowDriver) || DRIVERS[0], cd = DRIVERS.find((d) => d.k === g.colDriver) || DRIVERS[3];
  const cv = (d, v) => (d.pct ? E.pct(v) : E.num(v));
  const res = g.rowVals.map((rv) => g.colVals.map((c) => { const dev = { ...E.ZERO_DEV }; dev[rd.k] = cv(rd, rv); dev[cd.k] = (rd.k === cd.k ? dev[cd.k] : 0) + cv(cd, c); return E.run(p, dev, { resolved: R }).summary; }));
  const lbl = (d, v) => (d.pct ? (E.pct(v) * 100).toFixed(1).replace(/\.0$/, '') + (d.unit === 'pp' ? ' pp' : '%') : E.num(v) + ' mo');
  const isBase = (i, j) => cv(rd, g.rowVals[i]) === 0 && cv(cd, g.colVals[j]) === 0;
  const tbl = (title, f, c) => `<div style="min-width:0"><h3 style="margin-bottom:6px">${title}</h3><div class="tblwrap"><table class="heat"><thead><tr><th>Rows ↓ · columns →</th>${g.colVals.map((v) => `<th class="n">${lbl(cd, v)}</th>`).join('')}</tr></thead><tbody>${res.map((row, i) => `<tr><td class="n">${lbl(rd, g.rowVals[i])}</td>${row.map((s, j) => `<td class="n ${c(s)} ${isBase(i, j) ? 'base' : ''}">${f(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  return `<div class="gridcols">${usesDscr(S.model) ? tbl('Minimum DSCR (test basis)', (s) => xf(s.dscrTest), (s) => (s.dscrTest == null ? '' : s.dscrTest >= r.minDSCR ? 'hg' : 'hb')) : ''}${tbl('Lowest cash before exit', (s) => plain(s.lowCashPre), (s) => (s.lowCashPre < 0 ? 'hb' : 'hg'))}${tbl('Highest LTV (lending value)', (s) => pctf(s.maxLtvFs), (s) => (s.maxLtvFs == null ? '' : s.maxLtvFs <= r.maxLTV ? 'hg' : 'hb'))}</div><div class="note" style="margin-top:6px">Rows: ${esc(rd.label)} (${rd.unit}). Columns: ${esc(cd.label)} (${cd.unit}). Outlined cell = base case.</div>`;
};

function flat(o, pre = '', out = {}) {
  if (Array.isArray(o)) { o.forEach((v, i) => flat(v, `${pre}[${i + 1}]`, out)); if (!o.length) out[pre] = '(none)'; }
  else if (o && typeof o === 'object') { for (const k of Object.keys(o)) flat(o[k], pre ? `${pre}.${k}` : k, out); }
  else out[pre] = o === true ? 'Yes' : o === false ? 'No' : o == null ? '' : String(o);
  return out;
}

// ================= Margin for error: how much can go wrong before the borrower fails =================
// Two lines for every driver:
//   cash  – the borrower runs short of cash before maturity (first missed payment or unpaid cost; lowest cash < 0)
//   repay – InRento is not fully repaid by maturity (cash at maturity, after repaying everything, < 0; a bank
//           refinancing at the "refinance bank LTV" input counts as a source when that input is set)
// Each driver is moved on its own (all else at plan) and solved by bisection on the full monthly model.
const MG = { key: null, out: null };
const mgSym = () => sym();
const mgK = (v) => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return s + mgSym() + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'm' : Math.round(a / 1e3) + 'k'); };
const mgMonth = (d) => (d == null ? '–' : datef(d));
function mgTests(r) {
  const refi = r.refiLTV > 0;
  return {
    cash: (s) => s.lowCashPre == null || s.lowCashPre >= -1,
    repay: (s) => s.cashAtMaturity == null || s.cashAtMaturity + (refi && s.refiMax != null ? Math.min(s.refiMax, s.owedAtExit || 0) : 0) >= -1,
    refi,
  };
}
function marginCalc() {
  const p = mp(), key = JSON.stringify({ ...p, grid: null }); // the custom grid's drivers don't change the margins
  if (MG.key === key && MG.out) return MG.out;
  const R = E.resolve(p);
  const run = (dev) => E.run(p, Object.assign({}, E.ZERO_DEV, dev || {}), { resolved: R });
  const base = run({}), bs = base.summary, rows = base.rows, T = mgTests(base.r);
  const sum = (k) => rows.reduce((a, x) => a + (x[k] || 0), 0);
  const sales = R.assets.filter((a) => a.salePrice != null && a.saleDate != null);
  const withArea = sales.filter((a) => a.area > 0);
  const area = withArea.reduce((a, x) => a + x.area, 0), grossA = withArea.reduce((a, x) => a + x.salePrice, 0);
  const plan = {
    sales: sales.length, salesTotal: sales.reduce((a, x) => a + x.salePrice, 0), m2: area > 0 ? grossA / area : null, area,
    firstSale: sales.length ? Math.min(...sales.map((a) => a.saleDate)) : null, lastSale: sales.length ? Math.max(...sales.map((a) => a.saleDate)) : null,
    capex: sum('capex') + sum('extraExp') + sum('works'), revenue12: rows.slice(1, 13).reduce((a, x) => a + (x.revenue || 0), 0), opex12: rows.slice(1, 13).reduce((a, x) => a + (x.opex || 0), 0),
    revenue: sum('revenue'), opex: sum('opex'),
  };
  const kind = sales.length && plan.revenue > 0 ? 'mixed' : sales.length ? 'sales' : plan.revenue > 0 ? 'ops' : 'none';
  // --- solve one driver: largest move that still passes
  const solvePct = (mk, ok, hi) => { if (!ok(run(mk(0)).summary)) return { fails: true }; if (ok(run(mk(hi)).summary)) return { x: hi, beyond: true }; let lo = 0, h = hi; for (let i = 0; i < 28; i++) { const mid = (lo + h) / 2; if (ok(run(mk(mid)).summary)) lo = mid; else h = mid; } return { x: lo }; };
  const solveMonths = (mk, ok, hi) => { if (!ok(run(mk(0)).summary)) return { fails: true }; for (let n = 1; n <= hi; n++) if (!ok(run(mk(n)).summary)) return { x: n - 1 }; return { x: hi, beyond: true }; };
  const drivers = [];
  const add = (d) => { d.cash = (d.unit === 'months' ? solveMonths : solvePct)(d.mk, T.cash, d.hi); d.repay = (d.unit === 'months' ? solveMonths : solvePct)(d.mk, T.repay, d.hi); drivers.push(d); };
  if (sales.length) {
    add({ key: 'price', label: 'Sale prices fall', unit: 'pct', dir: -1, hi: 0.9, mk: (x) => ({ salePrice: -x }),
      planText: plan.m2 ? `${money(plan.m2)}/m² average · ${money(plan.salesTotal)} in total` : `${money(plan.salesTotal)} in total`,
      abs: (x) => (plan.m2 ? `${money(plan.m2 * (1 - x))}/m²` : money(plan.salesTotal * (1 - x))) });
    add({ key: 'delay', label: 'Sales come later', unit: 'months', dir: 1, hi: 36, mk: (n) => ({ saleDelay: n }),
      planText: `${plan.sales} sale${plan.sales > 1 ? 's' : ''}, ${mgMonth(plan.firstSale)} – ${mgMonth(plan.lastSale)}`,
      abs: (n) => `first sale ${mgMonth(E.eomonth(plan.firstSale, n))}` });
  }
  if (base.r.constr) add({ key: 'compl', label: 'Completion comes later', unit: 'months', dir: 1, hi: 36, mk: (n) => ({ complDelay: n }), planText: `completion ${mgMonth(bs.completion)}`, abs: (n) => `completion ${mgMonth(E.eomonth(bs.completion, n))}` });
  if (plan.capex > 0) add({ key: 'capex', label: 'Construction / one-off costs rise', unit: 'pct', dir: 1, hi: 3, mk: (x) => ({ capex: x }),
    planText: `${money(plan.capex)} planned`, abs: (x) => `${money(plan.capex * (1 + x))} in total` });
  if (plan.revenue > 0) {
    add({ key: 'rev', label: 'Revenue falls', unit: 'pct', dir: -1, hi: 0.9, mk: (x) => ({ rev: -x }),
      planText: `${money(plan.revenue12)} in the first 12 months`, abs: (x) => `${money(plan.revenue12 * (1 - x))} a year` });
    if (plan.opex > 0) add({ key: 'opex', label: 'Operating costs rise', unit: 'pct', dir: 1, hi: 3, mk: (x) => ({ opex: x }),
      planText: `${money(plan.opex12)} in the first 12 months`, abs: (x) => `${money(plan.opex12 * (1 + x))} a year` });
    add({ key: 'start', label: 'Revenue starts later', unit: 'months', dir: 1, hi: 24, mk: (n) => ({ rentDelay: n }), planText: 'as planned', abs: (n) => `${n} month${n === 1 ? '' : 's'} without revenue` });
  }
  // --- standard scenarios by deal type + the project's own
  const scen = [['Plan', {}]];
  if (sales.length) scen.push(['Prices −10%', { salePrice: -0.1 }], ['Prices −20%', { salePrice: -0.2 }], ['Sales 6 months late', { saleDelay: 6 }], ['Sales 12 months late', { saleDelay: 12 }]);
  if (plan.revenue > 0) scen.push(['Revenue −10%', { rev: -0.1 }], ['Revenue −20%', { rev: -0.2 }]);
  if (plan.capex > 0) scen.push(['Costs +20%', { capex: 0.2 }]);
  if (base.r.constr) scen.push(['Completion 6 months late', { complDelay: 6 }]);
  if (plan.revenue > 0 && plan.opex > 0) scen.push(['Operating costs +10%', { opex: 0.1 }]);
  if (kind === 'sales') scen.push(['Bad case: prices −10%, 6 months late' + (plan.capex > 0 ? ', costs +10%' : ''), { salePrice: -0.1, saleDelay: 6, capex: plan.capex > 0 ? 0.1 : 0 }]);
  else if (kind === 'ops') scen.push(['Bad case: revenue −15%, costs +10%, 3 months late', { rev: -0.15, opex: 0.1, rentDelay: 3 }]);
  else if (kind === 'mixed') scen.push(['Bad case: prices −10%, sales 6 months late, revenue −10%', { salePrice: -0.1, saleDelay: 6, rev: -0.1 }]);
  const defaults = new Set(DEFAULT_SCEN().map((x) => x.name));
  for (const s of p.scenarios || []) { const dv = devOf(s); if (!defaults.has(s.name) && s.name && Object.values(dv).some((v) => v) && scen.length < 11) scen.push([s.name + ' (yours)', dv]); }
  const outcome = (res) => {
    const s = res.summary, cash = T.cash(s), repay = T.repay(s);
    const short = s.cashAtMaturity != null ? -(s.cashAtMaturity + (T.refi && s.refiMax != null ? Math.min(s.refiMax, s.owedAtExit || 0) : 0)) : 0;
    return { s, cash, repay, low: s.lowCashPre, lowDate: s.lowCashPreDate, short: Math.max(0, short), repaid: s.repaidDate, irr: s.irr, profit: s.profit,
      tone: !repay ? 'bad' : !cash ? 'warn' : 'good',
      verdict: !repay ? `Not repaid by maturity – ${money(Math.max(0, short))} short` : !cash ? `Borrower needs ${money(-s.lowCashPre)} extra (${mgMonth(s.lowCashPreDate)}); loan still repaid` : `Holds – repaid ${s.repaidDate ? mgMonth(s.repaidDate) : 'at maturity'}` };
  };
  const scenarios = scen.map(([name, dev]) => { const res = run(dev); return Object.assign({ name, dev, rows: res.rows }, outcome(res)); });
  // --- two-way grid: the two drivers that matter most for this deal
  let grid = null;
  if (sales.length) grid = { rl: 'Sale prices', cl: 'Sales later by', rv: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3], cv: [0, 3, 6, 9, 12], rf: (x) => (x ? `−${x * 100}%` : 'plan'), cf: (n) => (n ? `${n} months` : 'on time'), dev: (x, n) => ({ salePrice: -x, saleDelay: n }), rAbs: plan.m2 ? (x) => `${money(plan.m2 * (1 - x))}/m²` : null };
  else if (plan.revenue > 0) grid = { rl: 'Revenue', cl: plan.opex > 0 ? 'Operating costs' : 'Start date', rv: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3], cv: plan.opex > 0 ? [0, 0.1, 0.2, 0.3] : [0, 3, 6, 9], rf: (x) => (x ? `−${x * 100}%` : 'plan'), cf: plan.opex > 0 ? (x) => (x ? `+${x * 100}%` : 'plan') : (n) => (n ? `${n} months` : 'on time'), dev: plan.opex > 0 ? (x, y) => ({ rev: -x, opex: y }) : (x, n) => ({ rev: -x, rentDelay: n }) };
  if (grid) grid.cells = grid.rv.map((x) => grid.cv.map((y) => outcome(run(grid.dev(x, y)))));
  const planShort = Math.max(0, -(bs.cashAtMaturity == null ? 0 : bs.cashAtMaturity + (T.refi && bs.refiMax != null ? Math.min(bs.refiMax, bs.owedAtExit || 0) : 0)));
  for (const d of drivers) { // the margin that binds is whichever test breaks first
    const n = (o) => (o.fails ? -1 : o.x); d.bind = n(d.cash) <= n(d.repay) ? 'cash' : 'repay'; d.eff = d[d.bind];
    d.failAmt = { cash: bs.lowCashPre < 0 ? `${mgK(-bs.lowCashPre)} short by ${mgMonth(bs.lowCashPreDate)}` : '', repay: planShort > 0 ? `${mgK(planShort)} short at maturity` : '' };
  }
  const out = { base, plan, kind, drivers, scenarios, grid, run, outcome, refi: T.refi, planCash: T.cash(bs), planRepay: T.repay(bs), planShort };
  MG.key = key; MG.out = out;
  return out;
}
// plain-language result for one driver and one test
function mgVal(d, o, which) {
  if (o.fails) return { txt: 'fails at plan', abs: (d.failAmt && which && d.failAmt[which]) || '', tone: 'bad', n: 0 };
  const v = d.unit === 'months' ? `${o.beyond ? '> ' : ''}${o.x} month${o.x === 1 ? '' : 's'}` : `${o.beyond ? '> ' : ''}${d.dir < 0 ? '−' : '+'}${(o.x * 100).toFixed(o.x < 0.1 ? 1 : 0)}%`;
  const lim = d.unit === 'months' ? [3, 6] : d.dir < 0 ? [0.1, 0.2] : [0.1, 0.25];
  const tone = o.x < lim[0] ? 'bad' : o.x < lim[1] ? 'warn' : 'good';
  return { txt: v, abs: o.beyond ? '' : d.abs(o.x), tone: which && d.bind !== which ? 'muted' : tone, n: o.x };
}
function mgHeadline(M) {
  if (!M.planRepay) return `At plan the loan is not repaid by maturity: ${money(M.planShort)} short${M.planCash ? '' : `, and the borrower runs short of cash by ${mgMonth(M.base.summary.lowCashPreDate)}`}. There is no margin for error without a new exit or more collateral.`;
  if (!M.planCash) { const s = M.base.summary; return `At plan the borrower already needs ${money(-s.lowCashPre)} of extra cash (by ${mgMonth(s.lowCashPreDate)}); the loan is still repaid at maturity.`; }
  const parts = M.drivers.filter((d) => ['price', 'delay', 'capex', 'rev', 'opex'].includes(d.key)).map((d) => {
    const v = mgVal(d, d.eff); const t = v.txt.replace(/^(> )?[−+]/, '$1');
    return d.key === 'price' ? `sale prices can fall ${t}${v.abs ? ` (to ${v.abs})` : ''}` : d.key === 'delay' ? `sales can come ${t} later` : d.key === 'capex' ? `costs can rise ${t}` : d.key === 'rev' ? `revenue can fall ${t}` : `operating costs can rise ${t}`;
  });
  if (!parts.length) return 'No sale or revenue drivers in the model to test.';
  return 'Before the borrower fails (runs short of cash or cannot repay at maturity), ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' or ' + parts[parts.length - 1] : parts[0]) + ' – each on its own.';
}


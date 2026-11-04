// Sensitivity tab: margin for error, sale price per m², break-even, scenarios, two-way grid.
// ---- Sensitivity
function tabSens() {
  const p = cur();
  return `<div class="stack">
  <div class="card"><h2 style="margin-bottom:4px">Margin for error</h2><div class="sub" style="margin-bottom:10px">How far each driver can move before the borrower fails.</div><div data-out="margin"></div></div>
  <div class="card"><h2 style="margin-bottom:4px">Sale price per m²</h2><div class="sub" style="margin-bottom:10px">How far the average sale price per m² can fall before the loan is no longer covered.</div><div data-out="pricem2"></div></div>
  <div class="card"><h2 style="margin-bottom:4px">Break-even</h2><div class="sub" style="margin-bottom:10px">How far one driver can move, with everything else at base, before a test fails. DSCR uses the test basis on Inputs 6.</div><div data-out="be"></div></div>
  <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><div><h2>Scenario deviations</h2><div class="sub">Each scenario reruns the full monthly cash flow with these deviations on top of the live inputs. Percent changes in %, rate change in percentage points, delays in months.</div></div>
    <div class="row"><button class="btn sm" data-act="add-sc">Add scenario</button><button class="btn sm ghost" data-act="reset-sc">Reset to standard set</button></div></div>
    <div class="tblwrap"><table class="grid-in sens-in"><thead><tr><th>Driver</th>${p.scenarios.map((s, j) => `<th>${j === 0 ? 'Scenario 1' : `<span class="row" style="justify-content:space-between;flex-wrap:nowrap">Scenario ${j + 1}<button class="xbtn" data-act="del-sc" data-i="${j}" aria-label="Remove scenario">×</button></span>`}</th>`).join('')}</tr></thead>
    <tbody><tr><td>Name</td>${p.scenarios.map((s, j) => `<td class="name">${inp(`scenarios.${j}.name`, s.name, 'text')}</td>`).join('')}</tr>
    ${driversOf(p).map((d) => `<tr><td>${d.label} <span class="sub">(${d.unit})</span></td>${p.scenarios.map((s, j) => `<td>${inp(`scenarios.${j}.${d.k}`, s[d.k], d.pct ? 'pct' : 'num')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
  <div class="card"><h2 style="margin-bottom:8px">Results by scenario</h2><div class="tblwrap" data-out="sensres"></div></div>
  <div class="card"><h3>Borrower cash balance by scenario</h3><div class="legend" id="lg-sens"></div><div class="chart" id="ch-sens"></div></div>
  <div class="card"><h3>Borrower net cash flow by calendar year</h3><div class="tblwrap" data-out="sensyr"></div></div><div class="card"><h3>Borrower cash balance at year end</h3><div class="tblwrap" data-out="sensye"></div></div>
  <div class="card"><h2 style="margin-bottom:8px">Two-way grid</h2><div class="sub" style="margin-bottom:10px">Flex any two drivers with five values each; all other deviations are zero.</div>
    <div class="row" style="margin-bottom:10px;align-items:flex-end">
      <label for="g-row"><span class="sub">Rows</span><br><select class="in" id="g-row" data-k="grid.rowDriver" style="width:auto">${driversOf(p).map((d) => `<option value="${d.k}" ${d.k === p.grid.rowDriver ? 'selected' : ''}>${d.label} (${d.unit})</option>`).join('')}</select></label>
      <span class="row" style="gap:4px">${p.grid.rowVals.map((v, k) => inp(`grid.rowVals.${k}`, v, 'num', 'style="width:62px" aria-label="Row value"')).join('')}</span></div>
    <div class="row" style="margin-bottom:14px;align-items:flex-end">
      <label for="g-col"><span class="sub">Columns</span><br><select class="in" id="g-col" data-k="grid.colDriver" style="width:auto">${driversOf(p).map((d) => `<option value="${d.k}" ${d.k === p.grid.colDriver ? 'selected' : ''}>${d.label} (${d.unit})</option>`).join('')}</select></label>
      <span class="row" style="gap:4px">${p.grid.colVals.map((v, k) => inp(`grid.colVals.${k}`, v, 'num', 'style="width:62px" aria-label="Column value"')).join('')}</span></div>
    <div data-out="grid"></div></div></div>`;
}
OUT.be = () => {
  const b = breakEvens(), r = S.model.r;
  const fmt = (o, unit = '%', scale = 100) => (o == null ? '–' : o.failsAtBase ? '<span class="pill chk">fails at base</span>' : o.beyond ? `more than ${unit === 'pp' ? '50 pp' : '100%'}` : unit === 'pp' ? '+' + (o.value * scale).toFixed(1) + ' pp' : '−' + (o.value * scale).toFixed(1) + '%');
  const cell = (l, v, s) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="tiles">${b.revDscr1 ? cell('Revenue drop to DSCR 1.00×', fmt(b.revDscr1), 'interest and scheduled debt covered exactly') : ''}
    ${b.revDscrMin ? cell(`Revenue drop to DSCR ${r.minDSCR}×`, fmt(b.revDscrMin), 'policy threshold') : ''}
    ${cell('Revenue drop until cash runs out', fmt(b.revCash), 'before the final repayment')}
    ${b.rateDscr1 ? cell('Rate rise to DSCR 1.00×', fmt(b.rateDscr1, 'pp'), 'percentage points') : ''}
    ${b.saleExit ? cell('Sale price drop until exit uncovered', fmt(b.saleExit), 'cash at maturity turns negative') : ''}
    ${cell('Value drop to LTV 100% (lending value)', b.valueForced100 == null ? '–' : b.valueForced100 < 0 ? '<span class="pill chk">already above</span>' : '−' + (b.valueForced100 * 100).toFixed(1) + '%', 'facility = lending value')}
    ${cell(`Value drop to max LTV ${pctf(r.maxLTV, 0)}`, b.valueMaxLTV == null ? '–' : b.valueMaxLTV < 0 ? '<span class="pill chk">already above</span>' : '−' + (b.valueMaxLTV * 100).toFixed(1) + '%', 'market value')}
    ${cell('Value headroom incl. interest', pctf(b.headroom), 'facility + interest + selling costs')}</div>`;
};
const SENS_ROWS = [
  ['Minimum DSCR (test basis)', (s) => xf(s.dscrTest), (s, r) => (s.dscrTest == null ? '' : s.dscrTest >= r.minDSCR ? 'hg' : 'hb')],
  ['Minimum monthly DSCR', (s) => xf(s.minDscr)], ['Average monthly DSCR', (s) => xf(s.avgDscr)], ['Minimum ICR', (s) => xf(s.minIcr)],
  ['Lowest cash before exit', (s) => money(s.lowCashPre), (s) => (s.lowCashPre < 0 ? 'hb' : 'hg')], ['Liquidity reserve needed', (s) => money(s.reserveNeed)], ['Months with negative cash', (s) => s.negMonths],
  ['Cash at maturity', (s) => money(s.cashAtMaturity), (s) => (s.cashAtMaturity < 0 ? 'hb' : 'hg')], ['Loan fully repaid in', (s) => (s.repaidDate ? datef(s.repaidDate) : 'Not repaid'), (s) => (s.repaidDate ? '' : 'hb')],
  ['Repaid via sales', (s) => money(s.viaSweep)], ['LTV at drawdown (market)', (s) => pctf(s.ltv0), (s, r) => (s.ltv0 > r.maxLTV ? 'hb' : '')], ['LTV at drawdown (lending value)', (s) => pctf(s.ltvFs0), (s, r) => (s.ltvFs0 > r.maxLTV ? 'hb' : '')],
  ['Highest LTV during loan (lending value)', (s) => pctf(s.maxLtvFs), (s, r) => (s.maxLtvFs > r.maxLTV ? 'hb' : '')], ['Exit LTV', (s) => pctf(s.exitLTV)], ['Value headroom', (s) => pctf(s.headroom)],
  ['InRento interest earned', (s) => money(s.interest)], ['Total lender profit', (s) => money(s.profit)], ['InRento IRR (annualised)', (s) => pctf(s.irr, 2)], ['Checks flagged', (s) => s.flags, (s) => (s.flags ? 'hb' : 'hg')],
];
OUT.sensres = () => { const { scen } = sensModel(); const r = S.model.r; return `<table class="heat"><thead><tr><th>Metric</th>${scen.map((s) => `<th class="n">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${SENS_ROWS.concat(loanSensRows(S.model)).map(([l, f, c]) => `<tr><td>${l}</td>${scen.map((s) => `<td class="n ${c ? c(s.res.summary, r) : ''}">${f(s.res.summary)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; };
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
  return `<div class="gridcols">${tbl('Minimum DSCR (test basis)', (s) => xf(s.dscrTest), (s) => (s.dscrTest == null ? '' : s.dscrTest >= r.minDSCR ? 'hg' : 'hb'))}${tbl('Lowest cash before exit', (s) => plain(s.lowCashPre), (s) => (s.lowCashPre < 0 ? 'hb' : 'hg'))}${tbl('Highest LTV (lending value)', (s) => pctf(s.maxLtvFs), (s) => (s.maxLtvFs == null ? '' : s.maxLtvFs <= r.maxLTV ? 'hg' : 'hb'))}${tbl('InRento IRR', (s) => pctf(s.irr, 2), () => '')}</div><div class="note" style="margin-top:6px">Rows: ${esc(rd.label)} (${rd.unit}). Columns: ${esc(cd.label)} (${cd.unit}). Outlined cell = base case.</div>`;
};

function flat(o, pre = '', out = {}) {
  if (Array.isArray(o)) { o.forEach((v, i) => flat(v, `${pre}[${i + 1}]`, out)); if (!o.length) out[pre] = '(none)'; }
  else if (o && typeof o === 'object') { for (const k of Object.keys(o)) flat(o[k], pre ? `${pre}.${k}` : k, out); }
  else out[pre] = o === true ? 'Yes' : o === false ? 'No' : o == null ? '' : String(o);
  return out;
}

// ================= Sale price per m²: how far the average price can fall =================
// Uniform cut of every planned sale price (the "sale price" stress driver), solved by bisection on the full monthly model.
let PM2 = { model: null, out: null };
function pm2Calc() {
  if (PM2.model === S.model && PM2.out) return PM2.out;
  const p = mp(), R = E.resolve(p), r = S.model.r;
  const sales = r.assets.filter((a) => a.salePrice != null && a.saleDate != null);
  const withArea = sales.filter((a) => a.area > 0);
  const out = { n: sales.length, nArea: withArea.length };
  if (!withArea.length) { PM2 = { model: S.model, out }; return out; }
  const area = withArea.reduce((s, a) => s + a.area, 0), gross = withArea.reduce((s, a) => s + a.salePrice, 0);
  Object.assign(out, { area, gross, avg: gross / area, allGross: sales.reduce((s, a) => s + a.salePrice, 0) });
  const run = (x, delay) => E.run(p, Object.assign({}, E.ZERO_DEV, { salePrice: -x, saleDelay: delay || 0 }), { resolved: R });
  const T = (m) => Math.min(m.r.term, m.rows.length - 1);
  // 1. principal: the loan balance is cleared by sale proceeds by maturity (no balloon left for the borrower)
  const principalOk = (m) => m.rows.slice(1, T(m) + 1).reduce((s, x) => s + x.sweep, 0) >= m.summary.facility - 1;
  // 2. everything owed to the lender (principal, interest not covered by the reserve, capital gain / profit share, fees) is covered by net sale proceeds up to maturity
  const allOk = (m) => { const s = m.summary, rows = m.rows.slice(1, T(m) + 1); const net = rows.reduce((a, x) => a + x.netSale, 0); const owed = s.facility + s.interest - s.intReserve + s.gains + s.pshare + rows.reduce((a, x) => a + x.extFee + x.prepay + x.exit + x.commit, 0); return net >= owed - 1; };
  // 3. the borrower's whole cash flow (fee and reserve funding, other income and costs) has no shortfall at maturity
  const cashOk = (m) => m.summary.cashAtMaturity == null || m.summary.cashAtMaturity >= -1;
  const solve = (ok, delay) => { if (!ok(run(0, delay))) return { fails: true }; if (ok(run(0.95, delay))) return { x: 0.95, floor: true }; let lo = 0, hi = 0.95; for (let i = 0; i < 36; i++) { const mid = (lo + hi) / 2; if (ok(run(mid, delay))) lo = mid; else hi = mid; } return { x: lo }; };
  out.rows = [
    ['Loan principal repaid from sales', 'Sale proceeds swept to InRento clear the loan balance by maturity. Interest is assumed paid by the borrower.', solve(principalOk)],
    ['Principal + interest + returns covered by sales', 'Net sale proceeds (after selling costs) cover principal, interest not paid from the reserve, capital gain / profit share and fees.', solve(allOk)],
    ['Same, with every sale 6 months later', 'As above, but each sale happens 6 months after its planned date: more interest, and sales after maturity no longer count.', solve(allOk, 6)],
    ['Borrower has no cash shortfall at maturity', "All-in: the borrower's whole cash flow, including fee and reserve funding at drawdown and any other income and costs.", solve(cashOk)],
  ];
  PM2 = { model: S.model, out };
  return out;
}
OUT.pricem2 = () => {
  const o = pm2Calc();
  if (!o.n) return '<div class="sub">No planned sales (sale price and date) in Collateral &amp; sales.</div>';
  if (!o.nArea) return '<div class="sub">Add the area (m²) of the units for sale in Collateral &amp; sales to see prices per m².</div>';
  const m2 = (v) => money(v).replace(/^(−?)/, '$1') + '/m²';
  const head = `<div class="pm2top"><div><div class="l">Average planned price</div><div class="v">${m2(o.avg)}</div><div class="sub">${o.nArea} unit${o.nArea > 1 ? 's' : ''} · ${nf0.format(Math.round(o.area))} m² · ${money(o.gross)}</div></div></div>
    ${o.nArea < o.n ? `<div class="note" style="margin:6px 0">${o.n - o.nArea} sale${o.n - o.nArea > 1 ? 's' : ''} without an area (${money(o.allGross - o.gross)}) are included in the break-even but not in the per-m² average.</div>` : ''}`;
  const rows = o.rows.map(([l, why, s]) => {
    if (s.fails) return `<tr><td><b>${l}</b><div class="sub">${why}</div></td><td class="n bad-t">Fails at planned prices</td><td class="n">–</td><td class="n">–</td></tr>`;
    const be = o.avg * (1 - s.x);
    return `<tr><td><b>${l}</b><div class="sub">${why}</div></td><td class="n"><b>${s.floor ? '< ' : ''}${m2(be)}</b></td><td class="n">${s.floor ? '> ' : ''}−${(s.x * 100).toFixed(1)}%</td><td class="n">${s.floor ? '> ' : ''}−${m2(o.avg - be)}</td></tr>`;
  }).join('');
  return head + `<div class="tblwrap" style="margin-top:10px"><table><thead><tr><th>Break-even test</th><th class="n">Lowest average price</th><th class="n">Drop vs plan</th><th class="n">Per m²</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note" style="margin-top:6px">Every planned sale price is cut by the same %, as in the "Sale price" stress. Prices are as entered (net or gross, per the deal), so compare with listings on the same basis. Per-unit break-even prices are in Collateral &amp; sales.</div>`;
};

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
  const p = mp(), key = JSON.stringify(p);
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
  const out = { base, plan, kind, drivers, scenarios, grid, refi: T.refi, planCash: T.cash(bs), planRepay: T.repay(bs), planShort };
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

// ---- Sensitivity tab: the same margin card the committee sees
OUT.margin = () => {
  let M; try { M = marginCalc(); } catch (e) { console.error(e); return '<div class="sub">Could not calculate the margin for error.</div>'; }
  if (!M.drivers.length) return '<div class="sub">Add planned sales or revenue to see the margin for error.</div>';
  const row = (d) => { const c = mgVal(d, d.cash, 'cash'), r = mgVal(d, d.repay, 'repay'); return `<tr><td><b>${esc(d.label)}</b><div class="sub">plan: ${esc(d.planText)}</div></td>
    <td class="n"><b class="mg-${c.tone}">${esc(c.txt)}</b><div class="sub">${esc(c.abs || '')}</div></td><td class="n"><b class="mg-${r.tone}">${esc(r.txt)}</b><div class="sub">${esc(r.abs || '')}</div></td></tr>`; };
  return `<div class="mghead">${esc(mgHeadline(M))}</div><div class="tblwrap" style="margin-top:8px"><table><thead><tr><th>Driver (each on its own)</th><th class="n">Before the borrower runs short of cash</th><th class="n">Before InRento is not repaid by maturity</th></tr></thead><tbody>${M.drivers.map(row).join('')}</tbody></table></div>
    <div class="note" style="margin-top:6px">Grey = not the binding limit (the other test breaks first). "Runs short of cash" = lowest borrower cash before maturity falls below zero (a missed payment or an unpaid cost). "Not repaid" = after repaying everything at maturity the borrower's cash is negative${M.refi ? ' (a bank refinancing at the refinance LTV counts as a source)' : ''}. The committee deck opens with this table.</div>`;
};

const cfCols = (m) => CF_COLS.filter((g) => g[0] !== 'Construction' || m.r.constr).flatMap((g) => (g[0] === 'InRento loan' ? [g, ...loanCfGroups(m).map(([n, cs]) => [n, cs.map((c) => [c[0], `${n} – ${c[1]}`, c[2]])])] : [g])).flatMap((g) => g[1]); // construction columns only on deals with construction; several loans: each loan's columns
// ---------- export ----------
const slug = (s) => String(s || 'project').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
const stripMeta = (p) => { const c = clone(p); delete c._new; delete c.id; delete c.metrics; return c; };
function saveFile(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith('.csv') ? 'text/csv' : 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function exportCsv() {
  const m = S.model; const cols = cfCols(m);
  const lines = [['Period', ...cols.map((c) => c[1])].join(',')];
  for (const x of m.rows) lines.push([x.p, ...cols.map((c) => (c[2] === 'd' ? E.fmtDate(x[c[0]]) : cfVal(x, c[0]) == null ? '' : Math.round(cfVal(x, c[0]) * 10000) / 10000))].join(','));
  saveFile(slug(cur().name) + '_cash_flow.csv', lines.join('\n'));
}
function exportXlsx() { return withView(buildXlsx)(); }
function buildXlsx() {
  if (!window.XLSX) { toast('Excel library did not load; try CSV'); return; }
  const p = cur(), m = S.model, s = m.summary, X = window.XLSX, wb = X.utils.book_new();
  const add = (name, aoa, widths) => { const ws = X.utils.aoa_to_sheet(aoa); if (widths) ws['!cols'] = widths.map((w) => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
  const val = (f, v) => (f.kind === 'pct' ? E.pct(v) : ['money', 'num', 'int'].includes(f.kind) ? E.num(v) : f.kind === 'months' ? (v || []).map((b, k) => (b ? MON[k] : '')).filter(Boolean).join(' ') : f.kind === 'check' ? (v ? 'Yes' : 'No') : v);
  const inRows = [['Project', p.name], ['Status', p.status], ['Borrower', p.borrower], ['Country', p.country], ['Project type', p.projectType], []];
  for (const [n, t, fs] of INPUT_SECTIONS()) { inRows.push([`${n}. ${t}`]); for (const f of fs) inRows.push([f.label, val(f, p.inputs[f.k]), f.kind === 'pct' ? '%' : '']); inRows.push([]); }
  inRows.push(['7. Seasonality'], ...p.inputs.seasonality.map((v, k) => [MON[k], E.num(v, 1)]));
  if (planUsed(p)) inRows.push([], ['Payment plan (months after the contract)'], ...(p.inputs.payPlan || []).map((x) => [`${E.num(x.months)} months`, E.pct(x.pct), '%']), ['Rest at the deed', 1 - (p.inputs.payPlan || []).reduce((t, x) => t + E.pct(x.pct), 0), '%'], ['Payments held in escrow until the deed', p.inputs.escrowOn ? 'Yes' : 'No']);
  add('Inputs', inRows, [52, 18, 6]);
  if (p.tranches.length) add('Tranches', loansUsed(p) ? [['Date', 'Amount', 'Milestone', 'Loan', 'Released when', 'Drawn in'], ...p.tranches.map((t, i) => { const tp = tranchePeriod(m, i); return [t.date, E.num(t.amount), t.label, loanName(p, Math.max(1, Math.round(E.num(t.loan, 1))) - 1), t.trigger === 'balance' ? `Loan balance below ${E.num(t.trigAmount)}` : 'On its date', tp == null ? 'not released' : E.fmtDate(tp ? m.rows[tp].date : m.r.drawdown)]; })]
    : [['Date', 'Amount', 'Milestone'], ...p.tranches.map((t) => [t.date, E.num(t.amount), t.label])]);
  if (m.summary.loans) add('Loans', [['Loan', 'Fee', 'Rate', 'Interest reserve months', 'Amount', 'Never drawn', 'Collateral at drawdown', 'LTV at drawdown', 'Highest LTV', 'Fees', 'Interest', 'Capital gain', 'Repaid from sales', 'Due at maturity', 'Short at maturity', 'Repaid', 'Maturity'],
    ...m.summary.loans.map((L, j) => { const q = p.loans[j] || {}; return [L.name, E.blank(q.fee) ? E.pct(p.inputs.arrFee) : E.pct(q.fee), E.blank(q.rate) ? E.pct(p.inputs.rate) : E.pct(q.rate), E.blank(q.reserveMonths) ? E.num(p.inputs.reserveMonths) : E.num(q.reserveMonths), L.amount, L.neverDrawn, L.coll0, L.ltv0 ?? '', L.maxLtv ?? '', L.fees, L.interest, L.gains, L.viaSweep, L.atMaturity, L.short, E.fmtDate(L.repaidDate), E.fmtDate(L.maturity)]; })], [24, 8, 8, 10, 14, 12, 14, 10, 10, 12, 12, 12, 14, 14, 14, 12, 12]);
  if (p.debts.length) add('Existing debts', [['Lender', 'Balance', 'Rate', 'Maturity', 'Prepayment cost', 'Refinanced', 'Monthly service', 'Service ends', 'Notes'], ...p.debts.map((d) => [d.lender, E.num(d.balance), E.pct(d.rate), d.maturity, E.num(d.prepay), d.refinanced !== false ? 'Yes' : 'No', E.num(d.service), d.end, d.notes])]);
  if (p.revLines.length || p.costLines.length) add('Operating model', [['Revenue lines'], ['Name', 'Type', 'Units', 'Price', 'Occupancy', 'Start', 'End', 'Growth', ...MON.map((x) => 'Occ ' + x), ...MON.map((x) => 'Price ' + x)], ...p.revLines.map((l) => [l.name, l.kind, E.num(l.units), E.num(l.price), E.blank(l.occ) ? '' : E.pct(l.occ), l.start, l.end, E.pct(l.growth), ...l.occM.map((v) => (E.blank(v) ? '' : E.pct(v))), ...l.priceM.map((v) => (E.blank(v) ? '' : E.num(v)))]), [], ['Cost lines'], ['Name', 'Driver', 'Amount', 'Growth', 'Months', 'Start', 'End', ...MON], ...p.costLines.map((l) => [l.name, l.kind, l.kind === 'pctRev' ? E.pct(l.amount) : E.num(l.amount), E.pct(l.growth), l.months, l.start, l.end, ...l.amountM.map((v) => (E.blank(v) ? '' : E.num(v)))])]);
  const ac = ACOLS.filter((c) => c[0][0] !== '=' && (c[0] !== 'marketDone' || p.inputs.constrOn) && (!['contractDate', 'payPlan'].includes(c[0]) || planUsed(p)) && (c[0] !== 'secures' || loansUsed(p)));
  add('Collateral & Sales', [ac.map((c) => c[1]).concat(['Lending value', 'Release price', 'Repaid to loan', 'Profit share']), ...p.assets.map((a, i) => ac.map((c) => (c[2] === 'money' || c[2] === 'num' ? (E.blank(a[c[0]]) ? '' : E.num(a[c[0]])) : c[2] === 'pct' ? (E.blank(a[c[0]]) ? '' : E.pct(a[c[0]])) : c[2] === 'check' ? (a[c[0]] !== false ? 'Yes' : 'No') : a[c[0]])).concat([m.r.assets[i].forced, m.r.assets[i].release, m.r.assets[i].repaid, m.r.assets[i].profitShareAmt]))]);
  if (p.inputs.constrOn && p.constrLines.length) add('Construction budget', [['Budget line', 'Budget', 'Spent to date', 'Monthly schedule (from works start)'], ...p.constrLines.map((l) => [l.name, E.num(l.budget), E.num(l.spent), (l.sched || []).map((v) => E.num(v)).join(' ')])], [30, 14, 14, 40]);
  add('Adjustments', [['Description', 'Type', 'Date', 'Recurrence', 'End date', 'Amount', 'Notes'], ...p.adjustments.map((a) => [a.desc, a.type, a.date, a.recurrence, a.end, E.num(a.amount), a.notes])]);
  const sum = [['Deal summary', p.name], [], ['Facility', s.facility], ['Paid out at drawdown', s.draw0], ['Arrangement fee', s.arrFeeAmt], ['Interest reserve', s.reserveAmt], ['Net cash to borrower', s.netCash], [], ['Max loan by LTV', s.sizeLTV], ['Max loan by coverage', s.sizeCover], ['Policy maximum', s.sizeMax], ['Funding need', s.need], ['Gross-up loan', s.grossUp], [], ['Collateral market value', s.mkt0], ['Lending value', s.fs0], ['LTV (market)', s.ltv0], ['LTV (lending value)', s.ltvFs0], ['Collateral coverage', s.cover0], ['LTC', s.ltc], ['Highest LTV (market)', s.maxLtv], ['Highest LTV (lending value)', s.maxLtvFs], ['Value can fall before a loss', s.headroom], [], ['Min DSCR rolling 12m', s.minDscr12], ['Min DSCR monthly', s.minDscr], ['Average DSCR', s.avgDscr], ['Min ICR', s.minIcr], ['Lowest cash before exit', s.lowCashPre], ['Liquidity reserve need', s.reserveNeed], ['Lowest cash', s.lowCash], ['Cash at maturity', s.cashAtMaturity], [], ['Loan repaid in', E.fmtDate(s.repaidDate)], ['Maturity', E.fmtDate(s.maturity)], ['Repaid via sales', s.viaSweep], ['Repaid via cash sweep', s.viaOpSweep], ['Scheduled / balloon', s.viaSched], ['Owed at maturity', s.owedAtExit], ['Exit value', s.exitValue], ['Exit LTV', s.exitLTV], ['Pay-down to refinance', s.paydown], [], ['Interest earned', s.interest], ['Fees', s.fees], ['Capital gain / catch-up', s.gains], ['Profit share', s.pshare], ['Total lender profit', s.profit], ['InRento IRR', s.irr], ['Simple yield p.a.', s.simpleYield], ['Money multiple', s.multiple], [], ['Checks'], ...s.checks.map((c) => [c[0], c[1]])];
  add('Summary', sum, [40, 18]);
  const cols = cfCols(m);
  add('Cash Flow', [['Period', ...cols.map((c) => c[1])], ...m.rows.map((x) => [x.p, ...cols.map((c) => (c[2] === 'd' ? E.fmtDate(x[c[0]]) : cfVal(x, c[0]) ?? ''))])]);
  add('Annual Summary', [['Year', ...ANN_COLS.map((c) => c[1])], ...m.annual.map((y) => [y.year, ...ANN_COLS.map((c) => y[c[0]] ?? '')])]);
  const { scen } = sensModel();
  add('Sensitivity', [['Scenario', ...scen.map((x) => x.name)], ...driversOf(p).map((d) => [d.label + ' (' + d.unit + ')', ...p.scenarios.map((x) => (d.pct ? E.pct(x[d.k]) : E.num(x[d.k])))]), [],
    ...SENS_ROWS.map(([l]) => l).map((l, k) => [l, ...scen.map((x) => { const sm = x.res.summary; return [sm.dscrTest, sm.minDscr, sm.avgDscr, sm.minIcr, sm.lowCashPre, sm.reserveNeed, sm.negMonths, sm.cashAtMaturity, E.fmtDate(sm.repaidDate), sm.viaSweep, sm.ltv0, sm.ltvFs0, sm.maxLtvFs, sm.exitLTV, sm.headroom, sm.interest, sm.profit, sm.irr, sm.flags][k]; })]),
    ...(m.summary.loans || []).map((L, j) => [`${L.name}: repaid`, ...scen.map((x) => (x.res.summary.loans ? loanSensText(x.res.summary.loans[j]) : ''))])], [34, ...scen.map(() => 16)]);
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFile(slug(p.name) + '_model.xlsx', new Blob([out]));
}

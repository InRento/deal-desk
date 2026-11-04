// Every "how is this calculated" explanation must reproduce the engine's own number:
// for every cell of the cash flow and every summary figure of every test deal, the formula shown,
// evaluated with the numbers shown, has to give the value on screen.   node tests/trace_test.js
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js'), Trace = require('../src/trace.js');
const DIR = path.join(__dirname, 'deals');
const KEYS = Object.keys(Trace.LABEL);
const METRICS = ['facility', 'draw0', 'arrFeeAmt', 'fee0', 'reserveAmt', 'netCash', 'interest', 'intReserve', 'intCash', 'capitalised', 'viaSweep', 'viaSched', 'viaOpSweep', 'gains', 'pshare', 'profit', 'fees', 'irr', 'simpleYield',
  'mkt0', 'fs0', 'ltv0', 'ltvFs0', 'ltvDrawn0', 'ltc', 'cover0', 'maxLtv', 'maxLtvFs', 'headroom', 'breakEvenValue', 'sizeLTV', 'sizeCover', 'sizeMax', 'need', 'grossUp', 'minDscr', 'minDscr12', 'minIcr', 'avgDscr',
  'lowCashPre', 'lowCash', 'reserveNeed', 'endCash', 'cashAtMaturity', 'ebitda12', 'exitIncome', 'exitLTV', 'refiMax', 'paydown', 'multiple', 'dscrTest'];
let checked = 0, unexplained = 0; const fails = [];
const close = (a, b) => (a == null || b == null ? a == b : Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 1e-9));
const verify = (where, x, want) => {
  if (!x) { unexplained++; if (process.env.SHOW) console.log('no explanation: ' + where + ' = ' + want); return; }
  if (!x.calc) return;
  const got = x.calc(x.terms.map((t) => t.v)); checked++;
  if (!close(got, want) || !close(x.v, want)) fails.push(`${where}: explanation gives ${got}, screen shows ${want}`);
};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const p = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')), m = E.run(p);
  for (const x of m.rows) for (const k of KEYS) { if (!(k in x)) continue; const ex = Trace.cell(m, p, k, x.p); if (ex || x[k]) verify(`${f} ${k} month ${x.p}`, ex, x[k]); }
  for (const k of METRICS) { const want = m.summary[k]; if (want == null) continue; verify(`${f} ${k}`, Trace.metric(m, p, k), want); }
  if (m.r.loans) m.r.loans.forEach((L, j) => { // several loans: every per-loan cell and result
    for (const x of m.rows) for (const g of Object.keys(Trace.LOAN_F)) { const want = x.loans[j][g]; const ex = Trace.cell(m, p, `L${j}.${g}`, x.p); if (ex || want) verify(`${f} L${j}.${g} month ${x.p}`, ex, want); }
    for (const g of ['amount', 'fees', 'interest', 'gains', 'viaSweep', 'atMaturity', 'exit', 'prepay', 'ltv0', 'maxLtv']) { const want = m.summary.loans[j][g]; if (want == null) continue; verify(`${f} L${j}.${g}`, Trace.metric(m, p, `L${j}.${g}`), want); }
  });
}
fails.slice(0, 40).forEach((s) => console.log('FAIL ' + s));
console.log(`${checked} explanations checked, ${fails.length} wrong, ${unexplained} numbers without an explanation`);
console.log(fails.length ? 'TRACE TEST FAILED' : 'TRACE TEST PASSED');
process.exitCode = fails.length ? 1 : 0;

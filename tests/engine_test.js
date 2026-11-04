// Engine guard – runs before every release (run_tests.sh, deploy.sh).
//  1. Confirmed figures: deals reconciled once against the analysts' own models must keep producing those numbers.
//  2. Full snapshot: every result of every test deal (monthly rows, annual, summary, scenarios, break-evens) must equal
//     tests/expected/engine.json. A change in the calculations shows up here with the deal, field and size of the change.
//     After an intended change to the logic, re-record with:  node tests/engine_test.js --update   (and say why in the changelog)
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js');
const DIR = path.join(__dirname, 'deals'), EXP = path.join(__dirname, 'expected', 'engine.json');
const deal = (id) => JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
let fails = 0;
const say = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// scenario deviations exactly as the app builds them (01-core.js devOf)
const PCT = ['rev', 'opex', 'rate', 'salePrice', 'value', 'capex'], NUM = ['rentDelay', 'saleDelay', 'exitDelay'];
const devOf = (s) => Object.assign(Object.fromEntries(PCT.map((k) => [k, E.pct(s[k])])), Object.fromEntries(NUM.map((k) => [k, E.num(s[k])])));

// ---- 1. confirmed figures (source: the analyst's model for each deal; tolerance = rounding)
const yearSum = (m, key, yr) => m.rows.slice(1).filter((x) => E.fmtDate(x.date).startsWith(String(yr))).reduce((t, x) => t + (x[key] || 0), 0);
const year = (m, yr) => m.annual.find((y) => y.year === yr) || {};
const CONFIRMED = [
  { id: 'skyra-retreat', src: "analyst's Skýra model", checks: [
    ['interest', (m) => m.summary.interest, 964372, 1], ['arrangement fee', (m) => m.summary.arrFeeAmt, 275535, 1], ['lender profit', (m) => m.summary.profit, 1239906, 1],
    ['liquidity trough', (m) => m.summary.lowCash, -50730, 1], ['max loan', (m) => m.summary.sizeMax, 3299583, 1], ['gross-up', (m) => m.summary.grossUp, 3673797, 1],
    ['IRR', (m) => m.summary.irr, 0.1502, 0.00005]] },
  { id: 'ustron-medi-spa', src: "analyst's Ustroń model (PLN)", checks: [
    ['revenue 2026', (m) => year(m, 2026).revenue, 5693131, 1], ['NOI 2026', (m) => year(m, 2026).ebitda, 1850268, 1], ['DSCR', (m) => m.summary.minDscr12, 1.89, 0.005],
    ['catch-up', (m) => m.summary.gains, 255000, 1], ['LTV', (m) => m.summary.ltv0, 0.515, 0.0005]] },
  { id: 'noa-villas', src: "analyst's Noa model", checks: [
    ['gross revenue 2026', (m) => yearSum(m, 'gross', 2026), 1739593, 1], ['gross revenue 2027', (m) => yearSum(m, 'gross', 2027), 3769995, 1], ['fees', (m) => m.summary.fees, 490000, 1]] },
];
for (const c of CONFIRMED) {
  const m = E.run(deal(c.id));
  for (const [label, f, want, tol] of c.checks) { const got = f(m); say(Math.abs(got - want) <= tol, `${c.id} ${label}: ${got} vs ${want} (${c.src})`); }
}
// M23 against the original Excel, scenario by scenario
{
  const p = deal('m23-excel');
  const want = { Base: [-3.3425, 1.5027, -298350, 20, 112350, 0.12397], 'Rent -10%': [-3.5404, 1.3047, -314550, 25, 112350, 0.12397], 'Rent -20%, opex +10%': [-3.7383, 1.1068, -330750, 34, 112350, 0.12397],
    'Rate +2 pp': [-2.7058, 1.2164, -317610, 27, 131610, 0.14666], 'Rent 3 m late, capex +20%': [-6.3859, 1.2424, -319650, 30, 112350, 0.12397], 'Sales -15%, 6 m late': [-3.3425, 1.5027, -298350, 20, 112350, 0.12397],
    'Value -20%': [-3.3425, 1.5027, -298350, 20, 112350, 0.12397], 'Severe combined': [-5.3850, 0.6928, -370560, 37, 131610, 0.14666] };
  for (const sc of p.scenarios) {
    const r = E.run(p, devOf(sc)).summary, got = [+r.minDscr.toFixed(4), +r.avgDscr.toFixed(4), Math.round(r.lowCash), r.negMonths, Math.round(r.profit), +r.irr.toFixed(5)];
    say(JSON.stringify(got) === JSON.stringify(want[sc.name]), `m23 Excel "${sc.name}": ${got.join(' ')}`);
  }
}

// ---- 2. full snapshot
const r4 = (v) => (typeof v === 'number' ? (isFinite(v) ? Math.round(v * 1e4) / 1e4 : String(v)) : v);
const clean = (o) => (Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, clean(v)])) : r4(o));
const snap = {};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const id = f.slice(0, -5), p = deal(id), R = E.resolve(p), m = E.run(p, null, { resolved: R });
  snap[id] = clean({ summary: m.summary, annual: m.annual, rows: m.rows,
    scenarios: Object.fromEntries((p.scenarios || []).map((s) => [s.name, E.run(p, devOf(s), { resolved: R }).summary])), breakEvens: E.breakEvens(p) });
}
if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(EXP), { recursive: true }); fs.writeFileSync(EXP, JSON.stringify(snap));
  console.log(`recorded ${Object.keys(snap).length} deals in tests/expected/engine.json`);
} else {
  const exp = JSON.parse(fs.readFileSync(EXP, 'utf8'));
  for (const id of new Set([...Object.keys(exp), ...Object.keys(snap)])) {
    const diffs = [];
    const walk = (a, b, at) => {
      if (diffs.length >= 8) return;
      if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], at ? `${at}.${k}` : k); return; }
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}${typeof a === 'number' && typeof b === 'number' ? ` (${b - a > 0 ? '+' : ''}${+(b - a).toFixed(4)})` : ''}`);
    };
    walk(exp[id], snap[id], '');
    say(!diffs.length, `${id}: all results unchanged${diffs.length ? '\n       ' + diffs.join('\n       ') : ''}`);
  }
}
console.log(fails ? `ENGINE GUARD FAILED (${fails})` : 'ENGINE GUARD PASSED');
process.exitCode = fails ? 1 : 0;

// Several loans in one deal (v3.17): loans table on Inputs, per-loan results on Summary and Sensitivity, per-loan cash-flow columns, model check.
// Off unless "Split into several loans" is ticked (needs tranches). Each tranche belongs to a loan; sale proceeds repay Loan 1 first, then Loan 2;
// the borrower's cash flow stays one combined view. The engine also reads tranche fee / rate / minimum months and the units-sold trigger, and an
// asset's "repays" order – not on screen yet (add a column when a deal needs it).
const blankLoan = () => ({ name: '', fee: '', rate: '', reserveMonths: '' });
const loansUsed = (p) => !!(p && p.inputs.tranchesOn && p.inputs.loansOn && p.loans.length);
const loanName = (p, j) => (p.loans[j] && p.loans[j].name) || `Loan ${j + 1}`;
const loanOpts = (p) => p.loans.map((_, j) => [String(j + 1), `Loan ${j + 1}`]);

function loansCard() {
  const p = cur(), i = p.inputs, ph = (v) => (E.blank(v) ? '' : `placeholder="${esc(v)}"`);
  return `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Loans</h3><button class="btn sm" data-act="add-loan">Add loan</button></div>
    <div class="sub" style="margin-bottom:8px">Each tranche in the drawdown schedule belongs to one loan. Blank fields use the deal's terms above. Sale proceeds repay Loan 1 first, then Loan 2; interest is paid on each loan's own balance and the borrower's cash flow stays one combined view.</div>
    <div class="tblwrap"><table class="grid-in"><thead><tr><th>Loan</th><th style="width:34%">Name</th><th class="n">Fee %</th><th class="n">Rate %</th><th class="n">Reserve months</th><th class="n">Amount</th><th class="n" title="Loan amount ÷ market value of the assets securing it (Collateral & sales, column &quot;Secures loan&quot;)">LTV at drawdown</th><th>Repaid</th><th></th></tr></thead><tbody>
    ${p.loans.map((L, j) => `<tr><td>${j + 1}</td><td class="w-name">${inp(`loans.${j}.name`, L.name, 'text', `placeholder="Loan ${j + 1}"`)}</td><td class="w-s">${inp(`loans.${j}.fee`, L.fee, 'pct', ph(i.arrFee))}</td><td class="w-s">${inp(`loans.${j}.rate`, L.rate, 'pct', ph(i.rate))}</td><td class="w-s">${inp(`loans.${j}.reserveMonths`, L.reserveMonths, 'num', ph(i.reserveMonths))}</td><td class="calcc" data-out="ln-${j}-amt"></td><td class="calcc" data-out="ln-${j}-ltv"></td><td class="calcc" data-out="ln-${j}-rep"></td><td>${p.loans.length > 1 ? `<button class="xbtn" data-act="del-loan" data-i="${j}" aria-label="Remove loan">×</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
// one line per loan: repaid in <month>, or what is due at maturity and how much of it the borrower cannot pay
const loanOutcome = (L) => (L.short > 0.5 ? `<span class="bad-t">${money(L.short)} short</span> <span class="sub">of ${money(L.atMaturity)} due ${datef(L.maturity)}</span>`
  : L.repaidDate ? `${datef(L.repaidDate)}${L.atMaturity > 0.5 ? ` <span class="sub">${money(L.atMaturity)} at maturity</span>` : ''}` : '<span class="bad-t">Not repaid</span>');
function loanCalcs(out) {
  const m = S.model; if (!m || !m.summary.loans) return out;
  m.summary.loans.forEach((L, j) => {
    out[`ln-${j}-amt`] = `<span data-tr="m:L${j}.amount">${plain(L.amount)}</span>`;
    out[`ln-${j}-ltv`] = L.ltv0 == null ? '–' : `<span class="${L.ltv0 > m.r.maxLTV ? 'bad-t' : ''}" data-tr="m:L${j}.ltv0">${pctf(L.ltv0)}</span>`;
    out[`ln-${j}-rep`] = loanOutcome(L);
  });
  return out;
}

// ---- Summary: one row per loan and the total
OUT.loans = () => {
  const m = S.model, s = m.summary; if (!s.loans) return '';
  const td = (v, tr, c = '') => `<td class="n ${c}"${tr ? ` data-tr="m:${tr}"` : ''}>${v}</td>`;
  const lc = (v) => (v != null && v > m.r.maxLTV ? 'bad-t' : '');
  const rows = s.loans.map((L, j) => `<tr><td>${esc(L.name)}${L.neverDrawn > 0.5 ? `<div class="sub">${money(L.neverDrawn)} never drawn</div>` : ''}</td>${td(money(L.amount), `L${j}.amount`)}${td(pctf(L.ltv0), `L${j}.ltv0`, lc(L.ltv0))}${td(pctf(L.maxLtv), `L${j}.maxLtv`, lc(L.maxLtv))}${td(money(L.fees), `L${j}.fees`)}${td(money(L.interest), `L${j}.interest`)}${td(money(L.gains), `L${j}.gains`)}${td(money(L.viaSweep), `L${j}.viaSweep`)}<td>${loanOutcome(L)}</td></tr>`).join('');
  const tot = `<tr class="tot"><td>Total</td>${td(money(s.facility), 'facility')}${td(pctf(s.ltv0), 'ltv0', lc(s.ltv0))}${td(pctf(s.maxLtv), 'maxLtv', lc(s.maxLtv))}${td(money(s.arrFeeAmt), 'arrFeeAmt')}${td(money(s.interest), 'interest')}${td(money(s.gains), 'gains')}${td(money(s.viaSweep), 'viaSweep')}<td>${s.cashAtMaturity < 0 ? `<span class="bad-t">${money(-s.cashAtMaturity)} short at maturity</span>` : s.repaidDate ? datef(s.repaidDate) : '<span class="bad-t">Not repaid</span>'}</td></tr>`;
  return `<div class="tblwrap"><table><thead><tr><th>Loan</th><th class="n">Amount</th><th class="n">LTV at drawdown</th><th class="n">Highest LTV</th><th class="n">Fees</th><th class="n">Interest</th><th class="n">Capital gain</th><th class="n">Repaid from sales</th><th>Repaid</th></tr></thead><tbody>${rows}${tot}</tbody></table></div>
    <div class="note" style="margin-top:6px">LTV per loan uses only the assets securing it (Collateral &amp; sales, "Secures loan"). Short = the borrower's cash gap in the loan's maturity month.</div>`;
};
// ---- Sensitivity: when each loan is repaid under each scenario
const loanSensRows = (m) => (m.summary.loans || []).map((L, j) => [`${L.name}: repaid`, (s) => (s.loans ? loanOutcome(s.loans[j]) : ''), (s) => (s.loans && (s.loans[j].short > 0.5 || !s.loans[j].repaidDate) ? 'hb' : '')]);
const loanSensText = (L) => (L.short > 0.5 ? `${Math.round(L.short)} short` : L.repaidDate ? E.fmtDate(L.repaidDate) : 'Not repaid');

// ---- Cash flow: per-loan columns, folded under the loan totals ("Show each loan")
const LOAN_CF = [['draw', 'Drawn'], ['interest', 'Interest'], ['principal', 'Repaid'], ['close', 'Balance'], ['ltv', 'LTV', 'p']];
const loanCfGroups = (m) => (m.r.loans ? m.r.loans.map((L, j) => [L.name, LOAN_CF.map(([f, l, t]) => [`L${j}.${f}`, l, t])]) : []);
const cfVal = (x, key) => { const lk = /^L(\d+)\.(\w+)$/.exec(key); return lk ? (x.loans ? x.loans[+lk[1]][lk[2]] : null) : x[key]; };

// ---- Model check
function lintLoans(p, m, add) {
  if (!p.inputs.loansOn) return;
  if (!p.inputs.tranchesOn) { add({ id: 'loans-notr', sev: 'warn', title: 'Several loans need the drawdown schedule', why: 'Tick "Drawn in tranches" and give each tranche its loan; until then the deal is modelled as one loan.', tab: 'inputs', keys: ['inputs.tranchesOn'] }); return; }
  if (!m.r.loans) return;
  m.summary.loans.forEach((L, j) => { if (!(L.amount > 0)) add({ id: `loans-empty-${j}`, sev: 'warn', title: `${L.name} has no tranches`, why: 'Pick this loan in the "Loan" column of the drawdown schedule, or remove it.', tab: 'inputs', keys: [`loans.${j}.name`] }); });
  const i = p.inputs, off = [];
  if (i.repayType && i.repayType !== 'Bullet') off.push('amortisation (each loan is repaid at its maturity)');
  if (i.extOn) off.push('the extension option');
  if (E.num(i.opSweepPct) > 0) off.push('the cash sweep from operations');
  if (off.length) add({ id: 'loans-off', sev: 'warn', title: 'Not applied with several loans: ' + off.join(', '), why: 'With several loans each loan is a bullet loan at its own term. Model these terms as one loan, or leave them out.', tab: 'inputs', keys: ['inputs.loansOn'] });
  p.tranches.forEach((t, k) => { if (t.trigger === 'balance' && !(E.num(t.trigAmount) > 0)) add({ id: `loans-trig-${k}`, sev: 'warn', title: `Tranche ${k + 1}: balance level missing`, why: 'It is released when the loan balance falls below this amount; with no amount it is never released.', tab: 'inputs', keys: [`tranches.${k}.trigAmount`] }); });
  m.summary.loans.forEach((L, j) => { if (L.neverDrawn > 0.5) add({ id: `loans-undrawn-${j}`, sev: 'info', title: `${L.name}: ${money(L.neverDrawn)} never released in the plan`, why: 'Its release condition is not met before the loan\'s maturity. Check the trigger level or the sales plan.', tab: 'inputs', keys: [] }); });
}

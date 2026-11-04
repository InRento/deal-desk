/* How each number is calculated – the formula in words, the same formula with the numbers, and where every
   number comes from (an input, another cash-flow cell, or a sum of a column). Mirrors engine.js line by line;
   tests/trace_test.js checks that every explanation reproduces the engine's value for every cell of every test deal.
   Trace.cell(m, project, key, period) · Trace.metric(m, project, key) → { title, at, terms, expr, v, f, calc, notes }
   term = { label, v, f, ref }  f: m money · p percent · x multiple · n number · i whole number · d month
   ref  = { input: 'inputs.rate' } | { cell: [key, period] } | { col: key } | { metric: key } | { tab: 'assets' } */
const Trace = (() => {
  const E = typeof Engine !== 'undefined' ? Engine : require('./engine.js');
  const LABEL = {
    revenue: 'Revenue', opex: 'Operating expenses', extraInc: 'Extra income', extraExp: 'Extra expenses', ebitda: 'EBITDA', tax: 'Tax', cfads: 'CFADS',
    saleColl: 'Sales – collateral', saleOther: 'Sales – other', sellCosts: 'Selling costs', depositPre: 'Deposits already paid to the borrower', netSale: 'Net sale proceeds',
    draw: 'Drawn', drawFee: 'Fee paid', feeCapd: 'Fee added to the loan', open: 'Opening balance', interest: 'Interest accrued', capitalised: 'Interest capitalised', intDue: 'Interest due',
    intReserve: 'Interest paid from reserve', intCash: 'Interest paid by borrower', deferred: 'Deferred interest (balance)', sweep: 'Repaid from sales', opSweep: 'Cash sweep',
    sched: 'Scheduled principal', principal: 'Principal repaid', close: 'Closing balance', undrawn: 'Undrawn', commit: 'Commitment fee', extFee: 'Extension fee', prepay: 'Prepayment fee',
    exit: 'Exit fee', gain: 'Capital gain / catch-up', pshare: 'Profit share', resClose: 'Reserve balance', resRelease: 'Reserve released', capex: 'Capex', otherDebt: 'Other debt service',
    toInRento: 'Total paid to InRento', ncf: 'Net cash flow', cash: 'Cash balance', collMkt: 'Collateral (market)', collFs: 'Collateral (lending value)', ltv: 'LTV market',
    ltvFs: 'LTV lending value', works: 'Construction costs', worksEq: 'Equity for the works', worksVat: 'VAT on construction costs', worksVatBack: 'VAT refunded', progress: 'Works done', ds: 'Debt service', dscr: 'DSCR month', dscr12: 'DSCR 12 m', icr: 'ICR', lenderCF: 'InRento / investor cash flow', gross: 'Gross revenue', nights: 'Occupied nights', season: 'Seasonality',
  };
  const t = (label, v, f = 'm', ref = null) => ({ label, v, f, ref });
  const inp = (k) => ({ input: 'inputs.' + k });
  const c = (key, p) => ({ cell: [key, p] });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = (dn) => { const s = E.fmtDate(dn); return `${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`; };
  const zero = (title, at, note, f = 'm', val = 0) => ({ title, at, terms: [], expr: [val == null ? '–' : '0'], v: val, f, calc: () => val, notes: [note] });
  const out = (title, at, terms, expr, v, f, calc, notes = []) => ({ title, at, terms, expr, v, f, calc, notes });
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const plusExpr = (n, signs) => { const e = []; for (let i = 0; i < n; i++) { if (i) e.push(signs && signs[i] < 0 ? '−' : '+'); else if (signs && signs[0] < 0) e.push('−'); e.push(i); } return e.length ? e : ['0']; };
  const signedSum = (signs) => (v) => v.reduce((s, x, i) => s + (signs ? signs[i] : 1) * x, 0);

  // the month a dated item falls in: 0 = drawdown month (row 0 for tranches), otherwise as the engine books it
  const periodOf = (r, dn) => { if (dn <= E.eomonth(r.drawdown, 0)) return 0; let k = 1; while (E.eomonth(r.drawdown, k) < dn && k < 400) k++; return k + 1; };
  const soldIn = (r, p) => { const me = E.eomonth(r.drawdown, p - 1), ms = E.eomonth(r.drawdown, p - 2) + 1;
    return r.assets.map((a, i) => ({ a, i })).filter(({ a }) => a.saleDate != null && !(p > 1 && a.saleDate < ms) && a.saleDate <= me); };
  // payments received this month: whole sales, or instalments of a payment plan (v3.16)
  const paidIn = (r, p) => { const me = E.eomonth(r.drawdown, p - 1), ms = E.eomonth(r.drawdown, p - 2) + 1, out = [];
    r.assets.forEach((a, i) => (a.pays || []).forEach((q) => { if (!q.pre && !(p > 1 && q.date < ms) && q.date <= me) out.push({ a, i, q }); })); return out; };
  const payLabel = (q) => (q.share === 1 ? '' : ` – ${+(q.share * 100).toFixed(2)}% ${q.deed ? 'at the deed' : q.months ? `${q.months} months after the contract` : 'at the contract'}`);
  const assetName = (prj, i) => ((prj.assets[i] || {}).name || `row ${i + 1}`);
  const trancheRef = (prj, t0) => { const i = (prj.tranches || []).findIndex((x) => E.parseDate(x.date) === t0.date && E.num(x.amount) === t0.amount); return i >= 0 ? { input: `tranches.${i}.amount` } : { input: 'inputs.tranchesOn' }; };

  // ---- several loans (v3.17): per-loan cells are keyed "L<j>.<field>"; loan totals are the sum of the loans
  const LOAN_F = { draw: 'Drawn', fee: 'Fee', open: 'Opening balance', interest: 'Interest accrued', capitalised: 'Interest capitalised', sweep: 'Repaid from sales', sched: 'Repaid at maturity',
    principal: 'Principal repaid', gain: 'Capital gain', exit: 'Exit fee', prepay: 'Prepayment fee', close: 'Closing balance', coll: 'Collateral securing it', ltv: 'LTV' };
  const LOAN_SUM = { draw: 'draw', drawFee: 'fee', feeCapd: 'feeCapd', open: 'open', interest: 'interest', capitalised: 'capitalised', sweep: 'sweep', sched: 'sched', principal: 'principal', gain: 'gain', exit: 'exit', prepay: 'prepay', close: 'close' };
  const trigText = (q) => (q.t.trig === 'balance' ? `released when the ${q.t.trigLoan ? 'balance of loan ' + q.t.trigLoan.map((j) => j + 1).join(' + ') : 'total loan balance'} falls below ${Math.round(q.t.trigAmount).toLocaleString('en')}`
    : q.t.trig === 'units' ? `released once ${q.t.trigUnits} units are sold` : q.t.trig === 'works' ? `released at ${+(q.t.milestone * 100).toFixed(1)}% works done` : 'released on its date');
  function loanCell(m, prj, j, f, p) {
    const r = m.r, rows = m.rows, x = rows[p], L = r.loans[j], Ls = m.k.LS[j];
    if (!x || !L || !(f in LOAN_F)) return null;
    const lx = x.loans[j], pl = p > 0 ? rows[p - 1].loans[j] : null, v = lx[f], lc = (g, q = p) => c(`L${j}.${g}`, q);
    const title = `${L.name} – ${LOAN_F[f]}`, at = p === 0 ? `drawdown · ${mon(r.drawdown)}` : `month ${p} · ${mon(x.date)}`;
    const b = p > 0 ? lx.open + lx.capitalised : 0;
    const trs = m.k.TR.filter((q) => q.L === j);
    switch (f) {
      case 'draw': {
        const ts = trs.filter((q) => q.drawP === p);
        if (!ts.length) return zero(title, at, trs.some((q) => q.drawP == null || q.drawP > p) ? 'No tranche of this loan is released this month.' : 'All its tranches are drawn.');
        const terms = ts.map((q) => t(`${q.t.label || 'Tranche'} (${trigText(q)})`, q.t.amount, 'm', { input: `tranches.${q.t.idx}.amount` }));
        const notes = ts.filter((q) => q.t.trig === 'balance').map((q) => `Last month's ${q.t.trigLoan ? 'balance of loan ' + q.t.trigLoan.map((i) => i + 1).join(' + ') : 'total loan balance'}: ${Math.round(q.t.trigLoan ? q.t.trigLoan.reduce((a, i) => a + rows[p - 1].loans[i].close, 0) : rows[p - 1].close).toLocaleString('en')}.`);
        return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), [...notes, 'A tranche released by a balance or by units sold is tested on last month\'s figures and paid at the start of the month, so stresses move it.']);
      }
      case 'fee': {
        const ts = trs.filter((q) => (r.feeBasis === 'facility' ? p === 0 : q.drawP === p));
        if (!ts.length) return zero(title, at, r.feeBasis === 'facility' ? 'Fees are charged on every tranche at drawdown.' : 'No tranche of this loan is drawn this month.');
        const terms = ts.flatMap((q) => [t(`${q.t.label || 'Tranche'} amount`, q.t.amount, 'm', { input: `tranches.${q.t.idx}.amount` }), t('Fee', q.fee, 'p', q.t.fee != null ? { input: `tranches.${q.t.idx}.fee` } : L.fee != null ? { input: `loans.${j}.fee` } : inp('arrFee'))]);
        const expr = []; ts.forEach((_, i) => { if (i) expr.push('+'); expr.push(2 * i, '×', 2 * i + 1); });
        return out(title, at, terms, expr, v, 'm', (a) => ts.reduce((s2, _, i) => s2 + a[2 * i] * a[2 * i + 1], 0), [r.feeCap ? 'Added to the loan balance.' : 'Withheld from the payout.']);
      }
      case 'open': return p === 0 ? null : out(title, at, [t('Closing balance last month', pl.close, 'm', lc('close', p - 1)), t('Drawn', lx.draw, 'm', lc('draw')), t('Fee added to the loan', lx.feeCapd, 'm', lc('fee'))], [0, '+', 1, '+', 2], v, 'm', signedSum());
      case 'interest': {
        if (p === 0) return null;
        if (p > Ls.T) return zero(title, at, 'After the loan\'s maturity no interest is calculated.');
        const ts = lx.trs || [];
        const rateRef = (idx) => { const q = trs.find((z) => z.t.idx === idx); return q && q.t.rate != null ? { input: `tranches.${idx}.rate` } : L.rate != null ? { input: `loans.${j}.rate` } : inp('rate'); };
        const terms = ts.flatMap((q) => [t(`${q.label || 'Tranche'} balance`, q.bal, 'm', lc('open')), t('Rate', q.rt, 'p', rateRef(q.idx))]);
        const expr = []; ts.forEach((_, i) => { if (i) expr.push('+'); expr.push(2 * i, '×', 2 * i + 1, '÷ 12'); });
        if (lx.minInt) { terms.push(t('Minimum interest on the amount repaid early', lx.minInt, 'm', { input: 'tranches' })); expr.push('+', terms.length - 1); }
        if (!terms.length) return zero(title, at, 'Nothing outstanding.');
        return out(title, at, terms, expr, v, 'm', (a) => ts.reduce((s2, _, i) => s2 + a[2 * i] * a[2 * i + 1] / 12, 0) + (lx.minInt ? a[a.length - 1] : 0),
          [p <= Ls.T0 ? 'Each tranche at its own rate (blank = the loan\'s, then the deal\'s).' : 'Late repayment: the default rate applies when one is set.']);
      }
      case 'capitalised': return lx.capitalised ? out(title, at, [t('Interest accrued', lx.interest - lx.minInt, 'm', lc('interest'))], [0], v, 'm', (a) => a[0], ['Interest is added to the loan.']) : zero(title, at, 'Interest is paid, not capitalised.');
      case 'sweep': {
        if (p === 0) return null;
        if (!lx.want) return zero(title, at, x.sweptX ? 'Nothing left for this loan from this month\'s sales.' : 'No sales this month.');
        const earlier = x.loans.slice(0, j).reduce((a, q) => a + (q.want || 0), 0), plain = !r.assets.some((a) => a.repays);
        const terms = plain ? [t('Balance before repayment', p <= Ls.T ? b : 0, 'm', lc('open')), t('Loan repayment from the units sold', x.sweptX, 'm', { tab: 'assets' }), t('Taken by the loans before it', earlier, 'm', { col: 'sweep' })] : [t('Sale money for this loan in each unit\'s order', lx.want, 'm', { tab: 'assets' })];
        const expr = plain ? ['min(', 0, ', max(0,', 1, '−', 2, '))'] : [0];
        if (lx.scale < 1) { terms.push(t('Share left after paying interest due', lx.scale, 'p', c('netSale', p))); expr.push('×', terms.length - 1); }
        return out(title, at, terms, expr, v, 'm', (a) => (plain ? Math.min(a[0], Math.max(0, a[1] - a[2])) : a[0]) * (lx.scale < 1 ? a[a.length - 1] : 1), ['Sale proceeds swept go to Loan 1 first, then Loan 2 …; each loan takes at most what it owes.']);
      }
      case 'sched': return p === Ls.T && v ? out(title, at, [t('Balance before repayment', b, 'm', lc('open')), t('Repaid from sales', lx.sweep, 'm', lc('sweep'))], [0, '−', 1], v, 'm', (a) => a[0] - a[1], ['The loan\'s maturity: everything still owed is due.']) : zero(title, at, p > Ls.T ? 'After the loan\'s maturity.' : 'Bullet loan: due at its maturity, ' + mon(E.eomonth(r.drawdown, Ls.T - 1)) + '.');
      case 'principal': return p === 0 ? null : out(title, at, [t('Repaid from sales', lx.sweep, 'm', lc('sweep')), t('Repaid at maturity', lx.sched, 'm', lc('sched'))], [0, '+', 1], v, 'm', signedSum());
      case 'close': return p === 0 ? out(title, at, [t('Drawn', lx.draw, 'm', lc('draw')), t('Fee added to the loan', lx.feeCapd, 'm', lc('fee'))], [0, '+', 1], v, 'm', signedSum())
        : out(title, at, [t('Opening balance', lx.open, 'm', lc('open')), t('Interest capitalised', lx.capitalised, 'm', lc('capitalised')), t('Principal repaid', lx.principal, 'm', lc('principal'))], ['max(0,', 0, '+', 1, '−', 2, ')'], v, 'm', (a) => Math.max(0, a[0] + a[1] - a[2]));
      case 'gain': {
        if (p === 0) return null;
        if (!Ls.gain) return zero(title, at, 'No fixed capital gain.');
        return out(title, at, [t('Capital gain accrued and not yet paid', lx.poolB, 'm', { input: L.gain != null ? `loans.${j}.gain` : 'inputs.fixedGain' }), t('Principal repaid', lx.principal, 'm', lc('principal')), t('Balance before repayment', b, 'm', lc('open'))], [0, '×', 1, '÷', 2], v, 'm', (a) => (a[2] > 0.005 ? a[0] * a[1] / a[2] : 0),
          [`Accrues ${+(Ls.gain * 100).toFixed(2)}% p.a. on this loan's balance (${(p <= Ls.T ? lx.open * Ls.gain / 12 : 0).toFixed(0)} this month) and is paid in proportion to its principal repaid.`]);
      }
      case 'exit': return v ? out(title, at, [t('Loan amount', Ls.amount, 'm', { metric: `L${j}.amount` }), t('Exit fee', r.exitFee, 'p', inp('exitFee'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1], ['Charged when the loan is repaid.']) : zero(title, at, r.exitFee ? 'Not repaid this month.' : 'No exit fee.');
      case 'prepay': return v ? out(title, at, [t('Repaid from sales', lx.sweep, 'm', lc('sweep')), t('Prepayment fee', r.prepayFee, 'p', inp('prepayFee'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1]) : zero(title, at, r.prepayFee ? 'No early repayment this month.' : 'No prepayment fee.');
      case 'coll': return collateral(m, prj, 'collMkt', p, title, at, j);
      case 'ltv': return ratio(title, at, t('Closing balance', lx.close, 'm', lc('close')), t('Collateral securing it', lx.coll, 'm', lc('coll')), v, 'p', ['Only the assets ticked as securing this loan, unsold at the month end.']);
      default: return null;
    }
  }

  function cell(m, prj, key, p) {
    const r = m.r, rows = m.rows, x = rows[p], prev = rows[p - 1], k = m.k;
    if (!x) return null;
    { const lk = /^L(\d+)\.(\w+)$/.exec(key); if (lk) return r.loans ? loanCell(m, prj, +lk[1], lk[2], p) : null; }
    if (r.loans && key in LOAN_SUM && !(key === 'open' && p === 0)) { // several loans: the total is the sum of the loans
      const want = key === 'drawFee' ? !r.feeCap : key === 'feeCapd' ? r.feeCap : true;
      const ttl = LABEL[key] || key, at0 = p === 0 ? `drawdown · ${mon(r.drawdown)}` : `month ${p} · ${mon(x.date)}`;
      if (!want) return zero(ttl, at0, r.feeCap ? 'Fees are added to the loan balances.' : 'Fees are withheld from the payouts.');
      const f = LOAN_SUM[key] === 'feeCapd' ? 'fee' : LOAN_SUM[key];
      const terms = r.loans.map((L, j) => t(L.name, x.loans[j][LOAN_SUM[key] === 'feeCapd' ? 'feeCapd' : f], 'm', c(`L${j}.${f}`, p)));
      return out(ttl, at0, terms, plusExpr(terms.length), x[key], 'm', signedSum(), ['Sum of the loans.']);
    }
    const T = r.term, T0 = k.T0, TX = k.TX, me = x.date;
    const title = LABEL[key] || key, at = p === 0 ? `drawdown · ${mon(r.drawdown)}` : `month ${p} · ${mon(me)}`;
    const v = x[key];
    const bal = p > 0 ? x.open + x.capitalised : 0;
    if (p === 0) {
      if (key === 'draw') return r.tranchesOn
        ? (() => { const ts = r.tranches.filter((q, k) => (r.progressMode ? r.trancheAt[k] : periodOf(r, q.date)) === 0); const terms = ts.map((q) => t(`Tranche ${E.fmtDate(q.date)}${q.label ? ' – ' + q.label : ''}`, q.amount, 'm', trancheRef(prj, q))); return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), ['Tranches dated in the drawdown month are paid out at drawdown.']); })()
        : out(title, at, [t('Loan amount', r.facility, 'm', inp('loan'))], [0], v, 'm', (a) => a[0]);
      if (key === 'drawFee' || key === 'feeCapd') {
        const want = key === 'drawFee' ? !r.feeCap : r.feeCap;
        if (!want) return zero(title, at, r.feeCap ? 'The fee is added to the loan balance, not paid at drawdown.' : 'The fee is withheld from the drawdown, not added to the loan.');
        const base = r.feeBasis === 'facility' ? t('Facility', r.facility, 'm', { metric: 'facility' }) : t('Paid out at drawdown', r.draw0, 'm', c('draw', 0));
        return out(title, at, [base, t('Arrangement fee', r.arrFee, 'p', inp('arrFee'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1]);
      }
      if (key === 'close') return out('Loan balance after drawdown', at, [t('Paid out at drawdown', r.draw0, 'm', c('draw', 0)), t('Fee added to the loan', x.feeCapd, 'm', c('feeCapd', 0))], [0, '+', 1], v, 'm', signedSum());
      if (key === 'resClose' && r.loans) { const terms = [], expr = []; k.LS.forEach((Ls, j) => { const L = Ls.L; if (expr.length) expr.push('+'); const i0 = terms.length;
        terms.push(t(`${L.name} amount`, Ls.amount, 'm', { metric: `L${j}.amount` }), t('Rate', (L.rate != null ? L.rate : r.rate), 'p', L.rate != null ? { input: `loans.${j}.rate` } : inp('rate')), t('Reserve months', L.reserveMonths != null ? L.reserveMonths : r.reserveMonths, 'n', L.reserveMonths != null ? { input: `loans.${j}.reserveMonths` } : inp('reserveMonths')));
        expr.push(i0, '×', i0 + 1, '÷ 12 ×', i0 + 2); });
        return out('Interest reserve withheld', at, terms, expr, v, 'm', (a) => k.LS.reduce((s2, _, j) => s2 + a[3 * j] * a[3 * j + 1] / 12 * a[3 * j + 2], 0), ['Sized per loan; used for the interest of all loans.']); }
      if (key === 'resClose') return r.reserveMonths ? out('Interest reserve withheld', at, [t('Facility', r.facility, 'm', { metric: 'facility' }), t('Interest rate', r.rate, 'p', inp('rate')), t('Reserve months', r.reserveMonths, 'n', inp('reserveMonths'))], [0, '×', 1, '÷ 12 ×', 2], v, 'm', (a) => a[0] * a[1] / 12 * a[2]) : zero(title, at, 'No interest reserve.');
      if (key === 'ncf') return metric(m, prj, 'netCash');
      if (key === 'progress' && r.constr) return out('Works done at drawdown', at, [t('Spent to date', r.constr.spentToDate, 'm', { input: 'constrLines.0.spent' }), t('Total cost of the works', r.constr.total, 'm', { metric: 'worksTotal' })], [0, '÷', 1], v, 'p', (a) => a[0] / a[1]);
      if (key === 'cash') return out(title, at, [t('Borrower opening cash', r.openingCash, 'm', inp('openingCash')), t('Net cash at drawdown', x.ncf, 'm', c('ncf', 0))], [0, '+', 1], v, 'm', signedSum());
      if (key === 'lenderCF') return out(title, at, [t('Paid out at drawdown', r.draw0, 'm', c('draw', 0)), t('Fee withheld', x.drawFee, 'm', c('drawFee', 0)), t('Interest reserve withheld', x.resClose, 'm', c('resClose', 0))], ['−', 0, '+', 1, '+', 2], v, 'm', (a) => -a[0] + a[1] + a[2], ['Negative = money going out to the borrower.']);
      if (key === 'undrawn') return out(title, at, [t('Facility', r.facility, 'm', { metric: 'facility' }), t('Paid out at drawdown', r.draw0, 'm', c('draw', 0))], [0, '−', 1], v, 'm', (a) => a[0] - a[1]);
      if (key === 'collMkt' || key === 'collFs') return collateral(m, prj, key, 0, title, at);
      if (key === 'ltv' || key === 'ltvFs') return ratio(title, at, t('Loan balance after drawdown', x.close, 'm', c('close', 0)), t(LABEL[key === 'ltv' ? 'collMkt' : 'collFs'], key === 'ltv' ? x.collMkt : x.collFs, 'm', c(key === 'ltv' ? 'collMkt' : 'collFs', 0)), v, 'p');
      return v ? null : zero(title, at, v == null ? 'Not applicable at drawdown.' : 'Nothing at drawdown.', 'm', v);
    }
    const rateP = p <= T0 ? 'rate' : p <= TX ? 'extRate' : 'defaultRate';
    const rateLbl = { rate: 'Interest rate', extRate: 'Rate during extension', defaultRate: 'Default rate (late repayment)' }[rateP];
    switch (key) {
      case 'revenue': {
        if (r.opModel === 'detailed') return out(title, at, [t('Gross revenue (Operating model lines)', x.gross, 'm', { tab: 'ops' }), t('VAT in prices', r.vat, 'p', inp('vat')), t('Ancillary revenue', r.ancillary, 'p', inp('ancillary'))], [0, '÷ (1 +', 1, ') × (1 +', 2, ')'], v, 'm', (a) => a[0] / (1 + a[1]) * (1 + a[2]));
        if (r.revStart != null && me < r.revStart) return zero(title, at, `Business cash flow starts ${mon(r.revStart)}.`);
        const step = Math.floor((p - 1) / 12);
        return out(title, at, [t(prj.inputs.revenueSource === 'assets' ? 'Revenue per month (sum of asset rents)' : 'Revenue per month', r.revenue, 'm', inp('revenue')), t('Growth per year', r.revGrowth, 'p', inp('revGrowth')), t('Years of growth', step, 'i'), t(`Seasonality ${MON[+E.fmtDate(me).slice(5, 7) - 1]}`, x.season, 'n', { input: `inputs.seasonality.${+E.fmtDate(me).slice(5, 7) - 1}` })],
          [0, '× (1 +', 1, ') ^', 2, '×', 3], v, 'm', (a) => a[0] * Math.pow(1 + a[1], a[2]) * a[3], ['Growth steps up every 12 months from drawdown.']);
      }
      case 'opex': {
        if (r.opModel === 'detailed') { const ch = x.gross * (r.commission + r.cardFee); return out(title, at, [t('Commission and card fees on gross revenue', ch, 'm', inp('commission')), t('Cost lines (Operating model)', x.opex - ch, 'm', { tab: 'ops' })], [0, '+', 1], v, 'm', signedSum()); }
        if (r.cfStart != null && me < r.cfStart) return zero(title, at, `Business cash flow starts ${mon(r.cfStart)}.`);
        const step = Math.floor((p - 1) / 12);
        return out(title, at, [t('Operating expenses per month', r.opex, 'm', inp('opex')), t('Growth per year', r.opexGrowth, 'p', inp('opexGrowth')), t('Years of growth', step, 'i')], [0, '× (1 +', 1, ') ^', 2], v, 'm', (a) => a[0] * Math.pow(1 + a[1], a[2]));
      }
      case 'extraInc': case 'extraExp': case 'capex': {
        const type = { extraInc: 'Income', extraExp: 'Expense', capex: 'Capex' }[key], ms = E.eomonth(r.drawdown, p - 2) + 1;
        const items = r.adjustments.filter((a) => a.type === type && a.date <= me && (a.eff >= ms || (p === 1 && a.eff === a.date)));
        if (!items.length) return zero(title, at, `No ${type.toLowerCase()} items on the Adjustments tab in this month.`);
        const terms = items.map((a) => t(a.desc || type, a.amount, 'm', { tab: 'adjust' }));
        return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), ['Items from the Adjustments tab: one-off in their month, monthly ones from start to end date.']);
      }
      case 'ebitda': return out(title, at, [t('Revenue', x.revenue, 'm', c('revenue', p)), t('Operating expenses', x.opex, 'm', c('opex', p)), t('Extra income', x.extraInc, 'm', c('extraInc', p)), t('Extra expenses', x.extraExp, 'm', c('extraExp', p))], [0, '−', 1, '+', 2, '−', 3], v, 'm', (a) => a[0] - a[1] + a[2] - a[3]);
      case 'tax': return out(title, at, [t('EBITDA', x.ebitda, 'm', c('ebitda', p)), t('Interest accrued', x.interest, 'm', c('interest', p)), t('Tax rate', r.tax, 'p', inp('tax'))], ['max(0, (', 0, '−', 1, ') ×', 2, ')'], v, 'm', (a) => Math.max(0, (a[0] - a[1]) * a[2]), ['Simple approximation: profit after interest, never negative.']);
      case 'cfads': return out(title, at, [t('EBITDA', x.ebitda, 'm', c('ebitda', p)), t('Tax', x.tax, 'm', c('tax', p))], [0, '−', 1], v, 'm', (a) => a[0] - a[1], ['Cash flow available for debt service.']);
      case 'saleColl': case 'saleOther': {
        const items = paidIn(r, p).filter(({ a }) => (key === 'saleColl' ? a.inColl : !a.inColl));
        if (!items.length) return zero(title, at, 'No planned sales in this month (Collateral & sales).');
        const terms = items.map(({ a, i, q }) => t(`${assetName(prj, i)}${payLabel(q)}${r.saleVat ? ` (net of ${+(r.saleVat * 100).toFixed(2)}% VAT)` : ''}`, q.share === 1 ? a.salePrice : q.share * a.salePrice, 'm', { input: `assets.${i}.salePrice` }));
        return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), [...(r.saleVat ? [`Prices are entered incl. VAT: each counts as price ÷ (1 + ${+(r.saleVat * 100).toFixed(2)}%); the VAT goes to the state.`] : []), ...(p === 1 ? ['Sales dated before the drawdown month are booked in month 1.'] : [])]);
      }
      case 'sellCosts': {
        const notary = sum(soldIn(r, p).map(({ a }) => a.notary));
        return out(title, at, [t('Sales – collateral', x.saleColl, 'm', c('saleColl', p)), t('Sales – other', x.saleOther, 'm', c('saleOther', p)), t('Selling costs', r.sellCost, 'p', inp('sellCost')), t('Notary / transfer costs of the units sold', notary, 'm', { tab: 'assets' })], ['(', 0, '+', 1, ') ×', 2, '+', 3], v, 'm', (a) => (a[0] + a[1]) * a[2] + a[3]);
      }
      case 'depositPre': {
        const items = soldIn(r, p).filter(({ a }) => a.depositPre);
        if (!items.length) return zero(title, at, 'No deposits already paid to the borrower for units sold this month.');
        const terms = items.map(({ a, i }) => t(assetName(prj, i), a.depositPre, 'm', { input: `assets.${i}.deposit` }));
        return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), ['Deposits marked "already paid to borrower" do not arrive again at the deed.']);
      }
      case 'netSale': return out(title, at, [t('Sales – collateral', x.saleColl, 'm', c('saleColl', p)), t('Sales – other', x.saleOther, 'm', c('saleOther', p)), t('Selling costs', x.sellCosts, 'm', c('sellCosts', p)), t('Deposits already paid to the borrower', x.depositPre, 'm', c('depositPre', p))], [0, '+', 1, '−', 2, '−', 3], v, 'm', (a) => a[0] + a[1] - a[2] - a[3]);
      case 'draw': {
        if (p > T) return zero(title, at, 'After maturity nothing is drawn.');
        const ts = r.tranchesOn ? r.tranches.filter((q, k) => (r.progressMode ? r.trancheAt[k] : periodOf(r, q.date)) === p) : [];
        if (!ts.length) return zero(title, at, r.tranchesOn ? (r.progressMode ? 'No tranche milestone is reached in this month.' : 'No tranche dated in this month.') : 'The whole loan is paid out at drawdown.');
        const terms = ts.map((q) => t(`${q.milestone != null && r.progressMode ? `Tranche at ${+(q.milestone * 100).toFixed(1)}% works done` : `Tranche ${E.fmtDate(q.date)}`}${q.label ? ' – ' + q.label : ''}`, q.amount, 'm', { input: `tranches.${q.idx}.${q.milestone != null && r.progressMode ? 'milestone' : 'amount'}` }));
        return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), [r.progressMode ? `Released against progress: works done reach ${(x.progress * 100).toFixed(1)}% this month (${((rows[p - 1].progress || 0) * 100).toFixed(1)}% last month).` : 'Later tranches are paid at the start of their month.']);
      }
      case 'drawFee': case 'feeCapd': {
        if (r.feeBasis !== 'tranche') return zero(title, at, 'The fee is charged on the whole facility at drawdown.');
        if ((key === 'drawFee') === r.feeCap) return zero(title, at, r.feeCap ? 'The fee is added to the loan balance.' : 'The fee is paid in cash when the tranche is drawn.');
        return out(title, at, [t('Drawn', x.draw, 'm', c('draw', p)), t('Arrangement fee', r.arrFee, 'p', inp('arrFee'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1]);
      }
      case 'undrawn': return out(title, at, [t('Facility', r.facility, 'm', { metric: 'facility' }), t('Drawn so far', r.facility - x.undrawn, 'm', { col: 'draw' })], ['max(0,', 0, '−', 1, ')'], v, 'm', (a) => Math.max(0, a[0] - a[1]));
      case 'commit': return p > T ? zero(title, at, 'After maturity.') : out(title, at, [t('Undrawn', x.undrawn, 'm', c('undrawn', p)), t('Commitment fee p.a.', r.commitFee, 'p', inp('commitFee'))], [0, '×', 1, '÷ 12'], v, 'm', (a) => a[0] * a[1] / 12);
      case 'open': return out(title, at, [t('Closing balance last month', prev.close, 'm', c('close', p - 1)), t('Drawn', x.draw, 'm', c('draw', p)), t('Fee added to the loan', x.feeCapd, 'm', c('feeCapd', p))], [0, '+', 1, '+', 2], v, 'm', signedSum());
      case 'interest': {
        if (p > T) return zero(title, at, 'After maturity no interest is calculated.');
        return out(title, at, [t('Opening balance', x.open, 'm', c('open', p)), t(rateLbl, x.rateP, 'p', inp(rateP === 'rate' ? 'rate' : rateP))], [0, '×', 1, '÷ 12'], v, 'm', (a) => a[0] * a[1] / 12,
          [p <= T0 ? 'Simple monthly interest on the balance at the start of the month (tranches drawn this month included).' : p <= TX ? 'Extension period: the extension rate applies.' : 'Late repayment: the default rate applies.']);
      }
      case 'capitalised': return x.capitalised ? out(title, at, [t('Interest accrued', x.interest, 'm', c('interest', p))], [0], v, 'm', (a) => a[0], ['Rolled up into the loan during the interest-only period (Capitalise = Yes).']) : zero(title, at, r.capitalise ? 'Only during the interest-only period.' : 'Interest is not rolled up (Capitalise = No).');
      case 'intDue': return out(title, at, [t('Interest accrued', x.interest, 'm', c('interest', p)), t('Interest capitalised', x.capitalised, 'm', c('capitalised', p))], [0, '−', 1], v, 'm', (a) => a[0] - a[1]);
      case 'intReserve': case 'intCash': {
        const payable = x.intCash + x.intReserve;
        if (payable < 0.005) return zero(title, at, x.deferred > 0.005 ? 'Not a payment month: the interest is added to deferred interest and paid in the next payment month or at repayment.' : 'No interest payable this month.');
        const due = t('Interest due', x.interest - x.capitalised, 'm', c('intDue', p)), dfr = t('Deferred from earlier months', prev.deferred, 'm', c('deferred', p - 1));
        if (key === 'intReserve') return out(title, at, [due, dfr, t('Reserve at start of month', x.resOpen, 'm', c('resClose', p - 1))], ['min(', 0, '+', 1, ',', 2, ')'], v, 'm', (a) => Math.min(a[0] + a[1], a[2]), ['The interest reserve pays first, until it is used up.']);
        return out(title, at, [due, dfr, t('Paid from reserve', x.intReserve, 'm', c('intReserve', p))], [0, '+', 1, '−', 2], v, 'm', (a) => a[0] + a[1] - a[2],
          [r.intTiming === 'onSales' ? 'Interest is paid from sale proceeds in months with a sale (and at maturity).' : 'Paid in the ticked payment months, at maturity and when the loan is repaid.']);
      }
      case 'deferred': return x.intCash + x.intReserve > 0.005 || v < 0.005 ? zero(title, at, 'Nothing deferred: interest is paid this month.') : out(title, at, [t('Deferred last month', prev.deferred, 'm', c('deferred', p - 1)), t('Interest due', x.interest - x.capitalised, 'm', c('intDue', p))], [0, '+', 1], v, 'm', signedSum(), ['Not a payment month (Interest paid in these months).']);
      case 'sweep': {
        if (p > T) return zero(title, at, 'After maturity.');
        const items = paidIn(r, p);
        if (!items.length) return zero(title, at, 'No sales this month.');
        const terms = [t('Balance before repayment', bal, 'm', c('open', p)), t('Loan repayment from the units sold', x.sweptX, 'm', { tab: 'assets' })];
        const notes = items.map(({ a, i, q }) => `${assetName(prj, i)}${payLabel(q)}: ${r.saleRepay === 'release' && a.release != null ? (q.share === 1 ? 'release price' : 'towards the release price, paid off from the first instalments') : `${+(a.sweepUsed * 100).toFixed(2)}% of the ${r.sweepBasis === 'Net' ? 'net' : 'gross'} ${q.share === 1 ? 'price' : 'instalment'}`}`);
        if (r.saleOrder === 'interestFirst' && x.netSale > 0.005) {
          const cap = Math.max(0, x.netSale - Math.max(0, (x.intCash + x.intReserve) - x.resOpen));
          terms.push(t('Net proceeds left after paying interest due', cap, 'm', c('netSale', p)));
          return out(title, at, terms, ['min(', 0, ',', 1, ',', 2, ')'], v, 'm', (a) => Math.min(a[0], a[1], a[2]), [...notes, 'Interest due is paid out of the sale proceeds before principal.']);
        }
        return out(title, at, terms, ['min(', 0, ',', 1, ')'], v, 'm', (a) => Math.min(a[0], a[1]), notes);
      }
      case 'sched': {
        const rem = bal - x.sweep;
        if (p > T || rem <= 0.005) return zero(title, at, p > T ? 'After maturity.' : 'Nothing left to repay.');
        if (p === T) return out(title, at, [t('Balance before repayment', bal, 'm', c('open', p)), t('Repaid from sales', x.sweep, 'm', c('sweep', p))], [0, '−', 1], v, 'm', (a) => a[0] - a[1], ['Maturity: everything still owed is due.']);
        if (p <= r.ioMonths) return zero(title, at, r.amort === 'None' ? 'Bullet loan: principal is due at maturity.' : 'Interest-only period.');
        if (r.amort === 'Equal') return out(title, at, [t('Balance after sales', rem, 'm', c('open', p)), t('Months left incl. this one', T - p + 1, 'i')], [0, '÷', 1], v, 'm', (a) => a[0] / a[1], ['Equal principal instalments.']);
        return out(title, at, [t('Balance after sales', rem, 'm', c('open', p)), t(rateLbl, x.rateP, 'p', inp('rate')), t('Months left incl. this one', T - p + 1, 'i')], ['principal part of an annuity on', 0, 'at', 1, 'over', 2, 'months'], v, 'm', (a) => (a[1] === 0 ? a[0] / a[2] : Math.min(a[0], a[0] * (a[1] / 12) / (1 - Math.pow(1 + a[1] / 12, -a[2])) - a[0] * a[1] / 12)));
      }
      case 'opSweep': return v ? out(title, at, [t('Cash sweep from operations', r.opSweepPct, 'p', inp('opSweepPct')), t('Minimum cash the borrower keeps', r.opSweepMin, 'm', inp('opSweepMin'))], ['(cash before the sweep −', 1, ') ×', 0, ', net of catch-up and prepayment fee'], v, 'm', null, ['Paid in the ticked sweep months before maturity.']) : zero(title, at, r.opSweepPct ? 'Not a sweep month, or no cash above the minimum.' : 'No cash sweep from operations.');
      case 'principal': return out(title, at, [t('Repaid from sales', x.sweep, 'm', c('sweep', p)), t('Scheduled principal', x.sched, 'm', c('sched', p)), t('Cash sweep', x.opSweep, 'm', c('opSweep', p))], [0, '+', 1, '+', 2], v, 'm', signedSum());
      case 'close': return out(title, at, [t('Opening balance', x.open, 'm', c('open', p)), t('Interest capitalised', x.capitalised, 'm', c('capitalised', p)), t('Principal repaid', x.principal, 'm', c('principal', p))], ['max(0,', 0, '+', 1, '−', 2, ')'], v, 'm', (a) => Math.max(0, a[0] + a[1] - a[2]));
      case 'gain': {
        if (!r.gain) return zero(title, at, 'No fixed capital gain.');
        const accr = p <= T ? x.open * r.gain / 12 : 0, poolB = prev.gainPool + accr;
        return out(title, at, [t('Catch-up accrued and not yet paid', poolB, 'm', { input: 'inputs.fixedGain' }), t('Principal repaid', x.principal, 'm', c('principal', p)), t('Balance before repayment', bal, 'm', c('open', p))], [0, '×', 1, '÷', 2], v, 'm', (a) => (a[2] > 0.005 ? a[0] * a[1] / a[2] : 0),
          [`Accrues ${+(r.gain * 100).toFixed(2)}% p.a. on the balance each month (${accr.toFixed(0)} this month) and is paid in proportion to the principal repaid.`]);
      }
      case 'pshare': {
        const items = soldIn(r, p).filter(({ a }) => a.profitShareAmt);
        if (!items.length || bal <= 0.005) return zero(title, at, 'No profit share on sales this month.');
        const terms = items.map(({ a, i }) => t(assetName(prj, i), a.profitShareAmt, 'm', { input: `assets.${i}.minPrice` }));
        return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), [`Per sale: (price × (1 − ${+(r.deduction * 100).toFixed(2)}%) − notary − minimum price) × ${+(r.profitShare * 100).toFixed(2)}%.`]);
      }
      case 'prepay': return v ? out(title, at, [t('Repaid from sales', x.sweep, 'm', c('sweep', p)), t('Cash sweep', x.opSweep, 'm', c('opSweep', p)), t('Prepayment fee', r.prepayFee, 'p', inp('prepayFee'))], ['(', 0, '+', 1, ') ×', 2], v, 'm', (a) => (a[0] + a[1]) * a[2], ['Charged on principal repaid early from sales or cash sweep before maturity.']) : zero(title, at, r.prepayFee ? 'Only on early repayments before maturity.' : 'No prepayment fee.');
      case 'exit': return v ? out(title, at, [t('Facility', r.facility, 'm', { metric: 'facility' }), t('Exit fee', r.exitFee, 'p', inp('exitFee'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1], ['Charged in the month the loan is fully repaid.']) : zero(title, at, r.exitFee ? 'Only in the month the loan is repaid.' : 'No exit fee.');
      case 'extFee': return v ? out(title, at, [t('Balance at original maturity', bal, 'm', c('open', p)), t('Extension fee', r.extFee, 'p', inp('extFee'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1]) : zero(title, at, r.extOn ? 'Only at the original maturity.' : 'Extension not modelled.');
      case 'resRelease': return v ? out(title, at, [t('Reserve at start of month', x.resOpen, 'm', c('resClose', p - 1)), t('Paid from reserve', x.intReserve, 'm', c('intReserve', p))], [0, '−', 1], v, 'm', (a) => a[0] - a[1], ['What is left of the interest reserve is released when the loan is repaid or at maturity.']) : zero(title, at, 'The reserve is released only when the loan is repaid or at maturity.');
      case 'resClose': return out(title, at, [t('Reserve at start of month', x.resOpen, 'm', c('resClose', p - 1)), t('Paid from reserve', x.intReserve, 'm', c('intReserve', p)), t('Reserve released', x.resRelease, 'm', c('resRelease', p))], [0, '−', 1, '−', 2], v, 'm', (a) => a[0] - a[1] - a[2]);
      case 'otherDebt': {
        const terms = []; if (r.otherDebt && (r.otherDebtEnd == null || me <= r.otherDebtEnd)) terms.push(t('Other existing debt service per month', r.otherDebt, 'm', inp('otherDebt')));
        (r.debts || []).forEach((d, i) => { if (!d.refinanced && d.service && (d.end == null || me <= d.end)) terms.push(t(`${d.lender || 'Debt ' + (i + 1)} (stays)`, d.service, 'm', { input: `debts.${i}.service` })); });
        return terms.length ? out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum()) : zero(title, at, 'No other debt service.');
      }
      case 'toInRento': {
        const ks = ['intCash', 'principal', 'prepay', 'exit', 'gain', 'pshare', 'commit', 'extFee', 'drawFee'];
        return out(title, at, ks.map((q) => t(LABEL[q], x[q], 'm', c(q, p))), plusExpr(ks.length), v, 'm', signedSum());
      }
      case 'ncf': {
        const ks = ['cfads', 'netSale', 'resRelease', 'draw', 'toInRento', 'otherDebt', 'capex'], sg = [1, 1, 1, 1, -1, -1, -1];
        if (m.k.W) { ks.push('worksEq', 'works', 'worksVat', 'worksVatBack'); sg.push(1, -1, -1, 1); }
        return out(title, at, ks.map((q) => t(LABEL[q], x[q], 'm', c(q, p))), plusExpr(ks.length, sg), v, 'm', signedSum(sg), ['Borrower view: business cash and sale proceeds in, everything paid to InRento, other lenders and capex out.']);
      }
      case 'cash': return out(title, at, [t('Cash balance last month', prev.cash, 'm', c('cash', p - 1)), t('Net cash flow', x.ncf, 'm', c('ncf', p))], [0, '+', 1], v, 'm', signedSum());
      case 'collMkt': case 'collFs': return collateral(m, prj, key, p, title, at);
      case 'ltv': case 'ltvFs': return ratio(title, at, t('Closing balance', x.close, 'm', c('close', p)), t(LABEL[key === 'ltv' ? 'collMkt' : 'collFs'], key === 'ltv' ? x.collMkt : x.collFs, 'm', c(key === 'ltv' ? 'collMkt' : 'collFs', p)), v, 'p');
      case 'ds': return out(title, at, [t('Interest due', x.intDue, 'm', c('intDue', p)), t('Scheduled principal (final balloon excluded)', x.dscrPrincipal, 'm', c('sched', p)), t('Other debt service', x.otherDebt, 'm', c('otherDebt', p))], [0, '+', 1, '+', 2], v, 'm', signedSum());
      case 'dscr': return v == null ? zero(title, at, 'No debt service this month, or the loan is not active.', 'x', null) : ratio(title, at, t('CFADS', x.cfads, 'm', c('cfads', p)), t('Debt service', x.ds, 'm', c('ds', p)), v, 'x', ['Debt service = interest due + scheduled principal (final bullet or balloon excluded) + other debt.']);
      case 'dscr12': {
        if (v == null) return zero(title, at, 'Needs 12 months of loan life.', 'x', null);
        const w = Math.min(12, T), from = p - w + 1, win = rows.slice(from, p + 1);
        return ratio(title, at, t(`CFADS, months ${from}–${p}`, sum(win.map((q) => q.cfads)), 'm', { col: 'cfads' }), t(`Debt service, months ${from}–${p}`, sum(win.map((q) => q.ds)), 'm', { col: 'ds' }), v, 'x');
      }
      case 'icr': return v == null ? zero(title, at, 'No interest this month.', 'x', null) : ratio(title, at, t('CFADS', x.cfads, 'm', c('cfads', p)), t('Interest accrued', x.interest, 'm', c('interest', p)), v, 'x');
      case 'lenderCF': {
        const ks = ['intCash', 'principal', 'prepay', 'exit', 'gain', 'pshare', 'commit', 'extFee', 'drawFee', 'resRelease', 'draw'], sg = [1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1];
        return out(title, at, ks.map((q) => t(LABEL[q], x[q], 'm', c(q, p))), plusExpr(ks.length, sg), v, 'm', signedSum(sg), ['Money to InRento and investors this month; tranches paid out and reserve released count as outflows.']);
      }
      case 'works': {
        const W = m.k.W, c = r.constr; if (!W) return null;
        if (!v) return zero(title, at, p < c.startP ? 'Before the works start.' : 'The works are complete.');
        const share = W.spend[p] ? v / W.spend[p] : 1, lines = W.byLine[p] || [];
        const terms = c.lines.map((l, li) => lines[li] ? t(`${l.name || 'Line ' + (li + 1)}`, lines[li] * share, 'm', { input: `constrLines.${li}.budget` }) : null).filter(Boolean);
        const curve = { even: 'even per month', scurve: 'S-curve', manual: 'monthly schedule' }[c.curve];
        return out(title, at, terms, plusExpr(terms.length), v, 'm', signedSum(), [`Each line's cost to complete (budget − spent to date, + ${+(c.cont * 100).toFixed(1)}% contingency) spread ${curve} over ${W.n} months, ${E.fmtDate(E.eomonth(r.drawdown, c.startP - 1)).slice(0, 7)} to ${E.fmtDate(E.eomonth(r.drawdown, W.endP - 1)).slice(0, 7)}.`, ...(share !== 1 ? [`Cost stress applied: × ${share.toFixed(3)}.`] : [])]);
      }
      case 'worksEq': {
        const cc = r.constr; if (!cc) return null; if (!v) return zero(title, at, cc.equity ? 'The borrower equity for the works is used up, or nothing is spent this month.' : 'No borrower equity for the works.');
        const used = rows.slice(1, p).reduce((a, q) => a + (q.worksEq || 0), 0);
        if (cc.funding === 'proRata') return out(title, at, [t('Construction costs', x.works, 'm', c('works', p)), t('Equity share of the cost to complete', cc.remaining > 0 ? Math.min(1, cc.equity / cc.remaining) : 0, 'p', inp('constrEquity')), t('Equity not yet used', cc.equity - used, 'm', inp('constrEquity'))], ['min(', 0, '×', 1, ',', 2, ')'], v, 'm', (a) => Math.min(a[0] * a[1], Math.max(0, a[2])), ['Equity and loan fund the works together, in proportion.']);
        return out(title, at, [t('Construction costs', x.works, 'm', c('works', p)), t('Equity not yet used', cc.equity - used, 'm', inp('constrEquity'))], ['min(', 0, ',', 1, ')'], v, 'm', (a) => Math.min(a[0], Math.max(0, a[1])), ['Borrower equity is spent first, then the loan.']);
      }
      case 'worksVat': return !r.constr ? null : v ? out(title, at, [t('Construction costs', x.works, 'm', c('works', p)), t('VAT rate on costs', r.constr.vatRate, 'p', inp('costVatRate'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1]) : zero(title, at, r.constr.vatOn ? 'No construction costs this month.' : 'VAT on costs not modelled.');
      case 'worksVatBack': { const cc = r.constr; if (!cc) return null; if (!v) return zero(title, at, cc.vatOn ? 'Nothing to refund this month.' : 'VAT on costs not modelled.'); const q = p - cc.vatLag;
        return out(title, at, [t(`VAT paid ${cc.vatLag} months earlier (month ${q})`, v, 'm', c('worksVat', q))], [0], v, 'm', (a) => a[0], ['Refunded by the tax authority after the lag set on Inputs.']); }
      case 'progress': {
        const cc = r.constr; if (!cc) return null; const W = m.k.W;
        const cum = cc.spentToDate + rows.slice(1, p + 1).reduce((a, q) => a + (W.spend[q.p] || 0), 0);
        return out(title, at, [t('Spent to date before drawdown', cc.spentToDate, 'm', { input: 'constrLines.0.spent' }), t('Planned spend up to this month', cum - cc.spentToDate, 'm', { col: 'works' }), t('Total cost of the works', cc.total, 'm', { metric: 'worksTotal' })], ['(', 0, '+', 1, ') ÷', 2], v, 'p', (a) => Math.min(1, (a[0] + a[1]) / a[2]), ['Measured on the planned budget (cost stress does not change progress).']);
      }
      case 'season': return out(title, at, [t(`Seasonality ${MON[+E.fmtDate(me).slice(5, 7) - 1]}`, v, 'n', { input: `inputs.seasonality.${+E.fmtDate(me).slice(5, 7) - 1}` })], [0], v, 'n', (a) => a[0]);
      case 'gross': case 'nights': return out(title, at, [t(LABEL[key] + ' from the revenue lines', v, key === 'nights' ? 'n' : 'm', { tab: 'ops' })], [0], v, key === 'nights' ? 'n' : 'm', (a) => a[0], ['Units × days × occupancy (× price) for each revenue line on the Operating model tab.']);
      default: return null;
    }
  }
  function ratio(title, at, a, b, v, f, notes = []) {
    if (v == null) return { title, at, terms: [a, b], expr: [0, '÷', 1], v: null, f, calc: () => null, notes: ['Not calculated: nothing outstanding or no value.', ...notes] };
    return out(title, at, [a, b], [0, '÷', 1], v, f, (x) => x[0] / x[1], notes);
  }
  function collateral(m, prj, key, p, title, at, j = null) { // j: only the assets securing loan j
    const r = m.r, me = p === 0 ? -Infinity : m.rows[p].date, fs = key === 'collFs';
    const W = m.k.W, credit = r.constr ? r.constr.credit : 0;
    const valueAt = (a) => { if (!W || a.marketDone == null) return a.market; const base = a.market == null ? 0 : a.market; if (p >= W.endP) return a.marketDone; if (p <= 0) return a.market;
      const done = W.prog0 >= 1 ? 1 : Math.max(0, (W.progress(p) - W.prog0) / (1 - W.prog0)); return base + (a.marketDone - base) * credit * done; };
    const items = r.assets.map((a, i) => ({ a, i, mv: valueAt(a) })).filter(({ a, mv }) => a.inColl && mv != null && !(a.saleDate != null && a.saleDate <= me) && (j == null || !a.secures || a.secures.includes(j)));
    if (!items.length) return zero(title, at, 'Nothing pledged and unsold at this date.');
    const terms = items.map(({ a, i, mv }) => t(`${assetName(prj, i)}${fs ? ` (after ${+((a.haircut == null ? r.haircut : a.haircut) * 100).toFixed(1)}% haircut)` : ''}`, fs ? mv * (1 - (a.haircut == null ? r.haircut : a.haircut)) : mv, 'm', { input: `assets.${i}.${W && a.marketDone != null && p > 0 ? 'marketDone' : 'market'}` }));
    const notes = [p === 0 ? 'Everything pledged counts at drawdown.' : 'Pledged assets not sold by the end of the month.'];
    if (W && items.some(({ a }) => a.marketDone != null) && p > 0) notes.push(p >= W.endP ? 'Works complete: the value on completion applies.' : `During the works: as-is value + ${+(credit * 100).toFixed(0)}% of the uplift to the value on completion × share of the remaining works done (${(Math.max(0, (W.progress(p) - W.prog0) / (1 - W.prog0)) * 100).toFixed(1)}%).`);
    return out(title, at, terms, plusExpr(terms.length), j == null ? m.rows[p][key] : m.rows[p].loans[j].coll, 'm', signedSum(), notes);
  }

  const colSum = (m, key, label) => { const by = new Map(); for (const x of m.rows) by.set(x.year, (by.get(x.year) || 0) + (x[key] || 0));
    const terms = [...by.entries()].filter(([, v]) => Math.abs(v) > 0.005).map(([y, v]) => t(`${label}, ${y}`, v, 'm', { col: key }));
    return { terms, expr: plusExpr(terms.length) }; };
  function metric(m, prj, key) {
    const r = m.r, s = m.summary, k = m.k, rows = m.rows, v = s[key];
    const M = (label, k2) => t(label, s[k2], 'm', { metric: k2 });
    const sumOf = (title, col, label, notes) => { const q = colSum(m, col, label); return out(title, 'whole loan', q.terms, q.expr, v, 'm', signedSum(), notes || ['Sum of the cash-flow column, shown by year.']); };
    { const lk = /^L(\d+)\.(\w+)$/.exec(key); if (lk) return r.loans ? loanMetric(m, prj, +lk[1], lk[2]) : null; }
    if (key === 'arrFeeAmt' && r.loans) { const terms = k.TR.flatMap((q) => [t(`${q.t.label || 'Tranche'} amount`, q.t.amount, 'm', { input: `tranches.${q.t.idx}.amount` }), t('Fee', q.fee, 'p', q.t.fee != null ? { input: `tranches.${q.t.idx}.fee` } : r.loans[q.L].fee != null ? { input: `loans.${q.L}.fee` } : inp('arrFee'))]);
      const expr = []; k.TR.forEach((_, i) => { if (i) expr.push('+'); expr.push(2 * i, '×', 2 * i + 1); });
      return out('Arrangement fees', 'all tranches', terms, expr, v, 'm', (a) => k.TR.reduce((s2, _, i) => s2 + a[2 * i] * a[2 * i + 1], 0), ['Each tranche at its fee (blank = its loan\'s, then the deal\'s).']); }
    switch (key) {
      case 'facility': return r.tranchesOn ? (() => { const terms = r.tranches.map((q) => t(`Tranche ${E.fmtDate(q.date)}${q.label ? ' – ' + q.label : ''}`, q.amount, 'm', trancheRef(prj, q))); return out('Facility', 'all tranches', terms, plusExpr(terms.length), v, 'm', signedSum()); })() : out('Loan amount', 'Inputs', [t('Loan amount', r.facility, 'm', inp('loan'))], [0], v, 'm', (a) => a[0]);
      case 'loan': return metric(m, prj, 'facility');
      case 'draw0': return cell(m, prj, 'draw', 0);
      case 'arrFeeAmt': return out('Arrangement fee', 'whole loan', [M('Facility', 'facility'), t('Arrangement fee', r.arrFee, 'p', inp('arrFee'))], [0, '×', 1], v, 'm', (a) => a[0] * a[1]);
      case 'fee0': return cell(m, prj, r.feeCap ? 'feeCapd' : 'drawFee', 0);
      case 'reserveAmt': return cell(m, prj, 'resClose', 0);
      case 'netCash': {
        const terms = [t('Paid out at drawdown', r.draw0, 'm', c('draw', 0)), t('Fee withheld', r.feeCap ? 0 : k.fee0, 'm', c('drawFee', 0)), t('Interest reserve withheld', k.reserveAmt, 'm', c('resClose', 0)),
          t('Existing debt refinanced', r.refi, 'm', inp('refinanced')), t('Purchase price / capex at drawdown', r.purchase, 'm', inp('purchase')), t('Closing costs', r.closing, 'm', inp('closingCosts')), t('Other uses', r.otherUses, 'm', inp('otherUses')), t('Borrower equity', r.equity, 'm', inp('equity'))];
        const sg = [1, -1, -1, -1, -1, -1, -1, 1];
        return out('Net cash to the borrower at drawdown', 'drawdown', terms, plusExpr(terms.length, sg), v, 'm', signedSum(sg), ['Negative = a funding gap the borrower must cover at drawdown.']);
      }
      case 'interest': return sumOf('Interest earned (accrued)', 'interest', 'Interest accrued');
      case 'intReserve': return sumOf('Interest paid from reserve', 'intReserve', 'Paid from reserve');
      case 'intCash': return sumOf('Interest paid by the borrower', 'intCash', 'Interest paid by borrower');
      case 'capitalised': return sumOf('Interest capitalised', 'capitalised', 'Interest capitalised');
      case 'viaSweep': return sumOf('Repaid via asset sales', 'sweep', 'Repaid from sales');
      case 'viaSched': return sumOf('Repaid via scheduled principal / balloon', 'sched', 'Scheduled principal');
      case 'viaOpSweep': return sumOf('Repaid via cash sweep', 'opSweep', 'Cash sweep');
      case 'gains': return sumOf('Capital gain / catch-up', 'gain', 'Capital gain');
      case 'pshare': return sumOf('Profit share', 'pshare', 'Profit share');
      case 'profit': return sumOf('Total lender profit', 'lenderCF', 'InRento / investor cash flow', ['Sum of the lender cash flow: everything received minus everything paid out.']);
      case 'fees': {
        const terms = [M('Arrangement fee', 'arrFeeAmt'), t('Prepayment fees', sum(rows.map((x) => x.prepay || 0)), 'm', { col: 'prepay' }), t('Exit fee', sum(rows.map((x) => x.exit || 0)), 'm', { col: 'exit' }), t('Commitment fees', sum(rows.map((x) => x.commit || 0)), 'm', { col: 'commit' }), t('Extension fee', sum(rows.map((x) => x.extFee || 0)), 'm', { col: 'extFee' })];
        return out('Fees', 'whole loan', terms, plusExpr(terms.length), v, 'm', signedSum());
      }
      case 'irr': return v == null ? null : out('InRento IRR (annualised)', 'whole loan', [t('Monthly IRR of the lender cash flow', Math.pow(1 + v, 1 / 12) - 1, 'p2', { col: 'lenderCF' })], ['(1 +', 0, ') ^ 12 − 1'], v, 'p2', (a) => Math.pow(1 + a[0], 12) - 1, ['The monthly rate at which the InRento / investor cash flow column discounts to zero, compounded to a year. Includes fees.']);
      case 'simpleYield': return out('Simple yield p.a.', 'whole loan', [M('Total lender profit', 'profit'), M('Facility', 'facility'), t('Term in years', k.TX / 12, 'n', inp('term'))], [0, '÷', 1, '÷', 2], v, 'p', (a) => a[0] / a[1] / a[2]);
      case 'mkt0': return cell(m, prj, 'collMkt', 0);
      case 'fs0': return cell(m, prj, 'collFs', 0);
      case 'ltv0': return ratio('LTV at drawdown (market)', 'full facility', M('Facility', 'facility'), M('Collateral market value', 'mkt0'), v, 'p');
      case 'ltvFs0': return ratio('LTV at drawdown (lending value)', 'full facility', M('Facility', 'facility'), M('Lending value', 'fs0'), v, 'p');
      case 'ltvDrawn0': return ratio('LTV on the amount drawn at drawdown', 'drawdown', t('Loan balance after drawdown', rows[0].close, 'm', c('close', 0)), M('Collateral market value', 'mkt0'), v, 'p');
      case 'ltc': return ratio('LTC', 'drawdown', M('Facility', 'facility'), t('Project cost', r.projectCost, 'm', inp('projectCost')), v, 'p', ['Project cost = the input, or uses at drawdown when blank.']);
      case 'cover0': return ratio('Collateral coverage', 'drawdown', M('Lending value', 'fs0'), M('Facility', 'facility'), v, 'x');
      case 'maxLtv': case 'maxLtvFs': { const col = key === 'maxLtv' ? 'ltv' : 'ltvFs'; let best = null; rows.forEach((x) => { if (x[col] != null && (best == null || x[col] > rows[best][col])) best = x.p; });
        return best == null ? null : out(key === 'maxLtv' ? 'Highest LTV during the loan (market)' : 'Highest LTV during the loan (lending value)', best ? `month ${best} · ${mon(rows[best].date)}` : 'drawdown', [t(`${LABEL[col]}, ${best ? 'month ' + best : 'drawdown'}`, rows[best][col], 'p', c(col, best))], [0], v, 'p', (a) => a[0], ['The highest monthly value in the cash-flow column.']); }
      case 'headroom': return out('Value headroom', 'drawdown', [M('Facility', 'facility'), M('Interest earned', 'interest'), M('Collateral market value', 'mkt0'), t('Selling costs', r.sellCost, 'p', inp('sellCost'))], ['1 − (', 0, '+', 1, ') ÷ (', 2, '× (1 −', 3, '))'], v, 'p', (a) => 1 - (a[0] + a[1]) / (a[2] * (1 - a[3])), ['How far the market value can fall before facility, all contractual interest and selling costs exceed it.']);
      case 'breakEvenValue': return out('Break-even collateral value', 'drawdown', [M('Facility', 'facility'), M('Interest earned', 'interest'), t('Selling costs', r.sellCost, 'p', inp('sellCost'))], ['(', 0, '+', 1, ') ÷ (1 −', 2, ')'], v, 'm', (a) => (a[0] + a[1]) / (1 - a[2]));
      case 'sizeLTV': return v == null ? null : out('Maximum loan by LTV', 'policy', [t('Maximum LTV', r.maxLTV, 'p', inp('maxLTV')), M('Collateral market value', 'mkt0')], [0, '×', 1], v, 'm', (a) => a[0] * a[1]);
      case 'sizeCover': return v == null ? null : out('Maximum loan by coverage', 'policy', [M('Lending value', 'fs0'), t('Target coverage', r.targetCover, 'x', inp('targetCover'))], [0, '÷', 1], v, 'm', (a) => a[0] / a[1]);
      case 'sizeMax': { const terms = [s.sizeLTV != null ? M('Maximum by LTV', 'sizeLTV') : null, s.sizeCover != null ? M('Maximum by coverage', 'sizeCover') : null].filter(Boolean);
        return v == null ? null : out('Policy maximum loan', 'policy', terms, terms.length > 1 ? ['min(', 0, ',', 1, ')'] : [0], v, 'm', (a) => Math.min(...a)); }
      case 'need': return out('Funding need', 'drawdown', [t('Existing debt refinanced', r.refi, 'm', inp('refinanced')), t('Purchase / capex at drawdown', r.purchase, 'm', inp('purchase')), t('Closing costs', r.closing, 'm', inp('closingCosts')), t('Other uses', r.otherUses, 'm', inp('otherUses')), t('Borrower equity', r.equity, 'm', inp('equity'))], [0, '+', 1, '+', 2, '+', 3, '−', 4], v, 'm', (a) => a[0] + a[1] + a[2] + a[3] - a[4]);
      case 'grossUp': return v == null ? null : out('Loan needed incl. fee and reserve (gross-up)', 'drawdown', [M('Funding need', 'need'), t('Arrangement fee withheld', r.feeCap ? 0 : r.arrFee, 'p', inp('arrFee')), t('Interest rate', r.rate, 'p', inp('rate')), t('Reserve months', r.reserveMonths, 'n', inp('reserveMonths'))], [0, '÷ (1 −', 1, '−', 2, '÷ 12 ×', 3, ')'], v, 'm', (a) => a[0] / (1 - a[1] - a[2] / 12 * a[3]), ['So that the payout after the fee and reserve still covers the uses.']);
      case 'minDscr': case 'minDscr12': case 'minIcr': case 'lowCashPre': case 'lowCash': {
        const col = { minDscr: 'dscr', minDscr12: 'dscr12', minIcr: 'icr', lowCashPre: 'cash', lowCash: 'cash' }[key];
        const ok = (x) => x[col] != null && (key === 'lowCashPre' ? x.p < r.term : key === 'lowCash' || key === 'minDscr12' ? true : x.p > 0 && x.active);
        let best = null; rows.forEach((x) => { if (ok(x) && (best == null || x[col] < rows[best][col])) best = x.p; });
        if (best == null) return null;
        const ttl = { minDscr: 'Minimum DSCR, single month', minDscr12: 'Minimum DSCR, rolling 12 months', minIcr: 'Minimum interest cover', lowCashPre: 'Lowest borrower cash before the final repayment', lowCash: 'Lowest borrower cash incl. the final repayment' }[key];
        return out(ttl, best ? `month ${best} · ${mon(rows[best].date)}` : 'drawdown', [t(`${LABEL[col]}, ${best ? 'month ' + best : 'drawdown'}`, rows[best][col], key.startsWith('low') ? 'm' : 'x', c(col, best))], [0], v, key.startsWith('low') ? 'm' : 'x', (a) => a[0], ['The lowest monthly value in the cash-flow column.']);
      }
      case 'avgDscr': { const xs = rows.filter((x) => x.p > 0 && x.active && x.dscr != null); return out('Average monthly DSCR', 'loan life', [t('Sum of monthly DSCR', sum(xs.map((x) => x.dscr)), 'x', { col: 'dscr' }), t('Months', xs.length, 'i')], [0, '÷', 1], v, 'x', (a) => a[0] / a[1]); }
      case 'dscrTest': return metric(m, prj, r.dscrBasis === 'monthly' ? 'minDscr' : 'minDscr12');
      case 'reserveNeed': return out('Liquidity reserve needed', 'before maturity', [M('Lowest cash before the final repayment', 'lowCashPre')], ['max(0, −', 0, ')'], v, 'm', (a) => Math.max(0, -a[0]));
      case 'endCash': return cell(m, prj, 'cash', rows.length - 1);
      case 'cashAtMaturity': return cell(m, prj, 'cash', Math.min(r.term, rows.length - 1));
      case 'repaidDate': { const x = rows.find((q) => q.repaidNow); return x ? out('Loan fully repaid', `month ${x.p} · ${mon(x.date)}`, [t(`Closing balance, month ${x.p}`, x.close, 'm', c('close', x.p))], ['first month the closing balance reaches 0'], x.date, 'd', null) : null; }
      case 'maturity': return out('Contractual maturity', 'term', [t('Loan drawdown date', r.drawdown, 'd', inp('drawdown')), t('Loan term (months)', r.termBase, 'i', inp('term')), t('Extension (months)', r.extMonths, 'i', inp('extMonths'))], ['end of the month', 0, '+', 1, '+', 2, '− 1'], v, 'd', null, ['Month 1 is the drawdown month.']);
      case 'ebitda12': { const TX = Math.min(k.TX, rows.length - 1), from = Math.max(1, TX - 11); return out('Trailing 12-month EBITDA at maturity', `months ${from}–${TX}`, [t(`EBITDA, months ${from}–${TX}`, v, 'm', { col: 'ebitda' })], [0], v, 'm', (a) => a[0]); }
      case 'exitIncome': return v == null ? null : out('Income value at the exit cap rate', 'maturity', [M('Trailing 12-month EBITDA', 'ebitda12'), t('Exit cap rate', r.exitCap, 'p', inp('exitCap'))], [0, '÷', 1], v, 'm', (a) => a[0] / a[1]);
      case 'exitLTV': return ratio('Exit LTV', 'maturity', M('Owed at maturity', 'owedAtExit'), M('Exit value', 'exitValue'), v, 'p');
      case 'refiMax': return v == null ? null : out('Bank refinancing', 'maturity', [t('Bank LTV', r.refiLTV, 'p', inp('refiLTV')), M('Exit value', 'exitValue')], [0, '×', 1], v, 'm', (a) => a[0] * a[1]);
      case 'paydown': return v == null ? null : out('Pay-down needed to refinance', 'maturity', [M('Owed at maturity', 'owedAtExit'), M('Bank refinancing', 'refiMax')], ['max(0,', 0, '−', 1, ')'], v, 'm', (a) => Math.max(0, a[0] - a[1]));
      case 'worksTotal': return r.constr ? out('Total cost of the works', 'budget', [t('Spent before drawdown', r.constr.spentToDate, 'm', { input: 'constrLines.0.spent' }), M('Cost to complete incl. contingency', 'worksToComplete')], [0, '+', 1], v, 'm', (a) => a[0] + a[1]) : null;
      case 'worksToComplete': return r.constr ? sumOf('Cost to complete incl. contingency', 'works', 'Construction costs', [`Remaining budget × (1 + ${+(r.constr.cont * 100).toFixed(1)}% contingency), with any cost stress.`]) : null;
      case 'worksEquity': return r.constr ? sumOf('Borrower equity used for the works', 'worksEq', 'Equity for the works') : null;
      case 'progress0': return cell(m, prj, 'progress', 0);
      case 'lowCashWorks': { const x = rows.find((q) => q.date === s.lowCashWorksDate); return x ? out('Lowest borrower cash during the works', `month ${x.p} · ${mon(x.date)}`, [t(`Cash balance, month ${x.p}`, x.cash, 'm', c('cash', x.p))], [0], v, 'm', (a) => a[0], ['The lowest month-end cash between drawdown and completion.']) : null; }
      case 'multiple': { const inn = sum(rows.map((x) => Math.max(0, x.lenderCF))), o = sum(rows.map((x) => Math.max(0, -x.lenderCF))); return out('Money multiple', 'whole loan', [t('Received by the lender', inn, 'm', { col: 'lenderCF' }), t('Paid out by the lender', o, 'm', { col: 'lenderCF' })], [0, '÷', 1], v, 'x', (a) => a[0] / a[1]); }
      default: return null;
    }
  }
  function loanMetric(m, prj, j, f) { // results per loan (Summary)
    const s = m.summary.loans && m.summary.loans[j], rows = m.rows; if (!s) return null;
    const title = `${s.name} – `, col = { fees: 'fee', interest: 'interest', gains: 'gain', viaSweep: 'sweep', atMaturity: 'sched', exit: 'exit', prepay: 'prepay' }[f];
    if (col) { const terms = []; const by = new Map(); rows.forEach((x) => by.set(x.year, (by.get(x.year) || 0) + (x.loans[j][col] || 0)));
      for (const [y, v2] of by) if (Math.abs(v2) > 0.005) terms.push(t(`${LOAN_F[col]}, ${y}`, v2, 'm', { col: `L${j}.${col}` }));
      return out(title + LOAN_F[col], 'whole loan', terms, plusExpr(terms.length), s[f], 'm', signedSum(), ['Sum of the loan\'s cash-flow column, shown by year.']); }
    if (f === 'amount') { const trs = m.k.TR.filter((q) => q.L === j), terms = trs.map((q) => t(q.t.label || 'Tranche', q.t.amount, 'm', { input: `tranches.${q.t.idx}.amount` })); return out(title + 'amount', 'its tranches', terms, plusExpr(terms.length), s.amount, 'm', signedSum()); }
    if (f === 'ltv0') return ratio(title + 'LTV at drawdown', 'full loan amount', t('Loan amount', s.amount, 'm', { metric: `L${j}.amount` }), t('Collateral securing it', s.coll0, 'm', c(`L${j}.coll`, 0)), s.ltv0, 'p');
    if (f === 'maxLtv') { let best = null; rows.forEach((x) => { const l = x.loans[j].ltv; if (l != null && (best == null || l > rows[best].loans[j].ltv)) best = x.p; });
      return best == null ? null : out(title + 'highest LTV', best ? `month ${best} · ${mon(rows[best].date)}` : 'drawdown', [t('LTV', rows[best].loans[j].ltv, 'p', c(`L${j}.ltv`, best))], [0], s.maxLtv, 'p', (a) => a[0], ['The highest monthly value of the loan\'s LTV.']); }
    if (f === 'short') { const Tj = Math.min(m.k.LS[j].T, rows.length - 1);
      return out(title + 'short at maturity', `month ${Tj} · ${mon(rows[Tj].date)}`, [t('Due at its maturity', rows[Tj].loans[j].sched, 'm', c(`L${j}.sched`, Tj)), t('Borrower cash after paying it (if negative)', Math.min(0, rows[Tj].cash), 'm', c('cash', Tj))], ['min(', 0, ', −', 1, ', less what loans later in the order take)'], s.short, 'm', null,
        ['The borrower\'s cash gap in the maturity month is put on the loans maturing that month, last in the repayment order first.']); }
    return null;
  }
  return { cell, metric, LABEL, LOAN_F };
})();
if (typeof module !== 'undefined') module.exports = Trace;

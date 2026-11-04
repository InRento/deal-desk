/* InRento deal model engine v2.
   Simple mode = exact port of M23_calculation_with_sensitivity.xlsx (Cash Flow sheet).
   v2 adds: drawdown tranches, fee on facility/tranche (withheld or capitalised), commitment fee,
   seasonal interest payment months (deferred interest), extension option, default interest on late exit,
   catch-up accrued per euro-month, release-price sales, cash sweep from operations, existing-debt table,
   detailed operating model (revenue and cost lines), loan sizing, exit/refinancing test and break-evens. */
const Engine = (() => {
  const DAY = 86400000;
  const ymd = (dn) => { const d = new Date(dn * DAY); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
  const mk = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY);
  const parseDate = (s) => {
    if (s == null || s === '') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    return m ? mk(+m[1], +m[2], +m[3]) : null;
  };
  const fmtDate = (dn) => { if (dn == null) return ''; const [y, m, d] = ymd(dn); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  const eomonth = (dn, k) => { const [y, m] = ymd(dn); return mk(y, m + k + 1, 0); };
  const edate = (dn, k) => { const [y, m, d] = ymd(dn); const last = ymd(mk(y, m + k + 1, 0))[2]; return mk(y, m + k, Math.min(d, last)); };
  const monthOf = (dn) => ymd(dn)[1];
  const yearOf = (dn) => ymd(dn)[0];
  const daysIn = (dn) => ymd(eomonth(dn, 0))[2];
  // model month of a date: 0 = the drawdown month's start (drawdown), k = k-th month-end after it
  const periodAt = (dd, dn) => { if (dn <= eomonth(dd, 0)) return 0; let k = 1; while (eomonth(dd, k) < dn && k < 400) k++; return k + 1; };

  function num(v, dflt = 0) {
    if (v == null) return dflt;
    if (typeof v === 'number') return isFinite(v) ? v : dflt;
    if (typeof v === 'boolean') return v ? 1 : 0;
    let s = String(v).trim().replace(/^=/, '').replace(/\s/g, '').replace(/,/g, '.');
    if (s === '') return dflt;
    if (!/^[0-9.+\-*/()%eE]+$/.test(s)) return dflt;
    s = s.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
    try { const r = Function('"use strict";return (' + s + ')')(); return typeof r === 'number' && isFinite(r) ? r : dflt; } catch { return dflt; }
  }
  const blank = (v) => v == null || String(v).trim() === '';
  const optNum = (v) => (blank(v) ? null : num(v, null));
  // payment plan of a sale: [{share, months}] paid that many months after the contract; whatever is left is paid at the deed.
  // Deal plan: rows {pct, months}. A unit's own plan is text: "10@0, 20@6" (10% at contract, 20% six months later), "deed" = all at the deed; blank = the deal plan.
  const planRows = (rows) => (Array.isArray(rows) ? rows : []).map((x) => ({ share: num(x && x.pct) / 100, months: Math.max(0, Math.round(num(x && x.months))) })).filter((x) => x.share > 0);
  const planText = (t) => { if (blank(t)) return null; if (/^\s*(deed|0%?)\s*$/i.test(String(t))) return [];
    return String(t).split(/[,;]+/).map((tok) => { const m = /^\s*([\d.]+)\s*%?\s*(?:@\s*\+?\s*(\d+)\s*(?:m|mo|months?)?)?\s*$/i.exec(tok); return m ? { share: +m[1] / 100, months: m[2] ? +m[2] : 0 } : null; }).filter((x) => x && x.share > 0); };
  const pct = (v, d = 0) => (blank(v) ? d : num(String(v).replace(/%/g, ''), d * 100) / 100);
  const optPct = (v) => (blank(v) ? null : pct(v));
  const months12 = (arr, dflt) => Array.from({ length: 12 }, (_, k) => (Array.isArray(arr) && arr[k] != null ? !!arr[k] : dflt));
  // "5-10", "12", "11,12,1-3" -> 12 booleans; blank = all months
  function monthMask(s) {
    if (blank(s)) return Array(12).fill(true);
    const out = Array(12).fill(false);
    for (const part of String(s).split(/[,;\s]+/)) {
      const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part.trim()); if (!m) continue;
      let a = +m[1], b = m[2] ? +m[2] : a; if (a < 1 || a > 12 || b < 1 || b > 12) continue;
      for (let k = a; ; k = (k % 12) + 1) { out[k - 1] = true; if (k === b) break; }
    }
    return out;
  }

  const REPAY = ['Bullet', 'Interest-only grace then equal principal', 'Interest-only grace then annuity', 'Annuity from start', 'Equal principal from start'];
  const ppmt1 = (r, n, pv) => { const pmt = pv * r / (1 - Math.pow(1 + r, -n)); return pmt - pv * r; };

  function irrMonthly(cfs) {
    const npv = (r) => cfs.reduce((a, c, i) => a + c / Math.pow(1 + r, i), 0);
    if (!cfs.some((c) => c > 0) || !cfs.some((c) => c < 0)) return null;
    let lo = -0.99, hi = 1.0, flo = npv(lo), fhi = npv(hi);
    let tries = 0; while (flo * fhi > 0 && tries < 20) { hi *= 2; fhi = npv(hi); tries++; }
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, f = npv(mid); if (Math.abs(f) < 1e-9) return mid; if (flo * f < 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; } }
    return (lo + hi) / 2;
  }

  // ---------- inputs ----------
  function resolve(p) {
    const i = p.inputs || {};
    const assets = p.assets || [];
    const assetSum = (k) => assets.reduce((s, a) => s + num(a[k]), 0);
    const drawdown = parseDate(i.drawdown) ?? mk(2026, 1, 1);
    const tranchesOn = !!i.tranchesOn && Array.isArray(p.tranches) && p.tranches.some((t) => !blank(t.amount));
    // several loans in one deal (v3.17): off unless switched on with tranches; each tranche belongs to a loan (1, 2, …) and may carry its own fee, rate,
    // minimum interest period and release trigger. Off = exactly the single-loan model.
    const loansOn = !!(tranchesOn && i.loansOn && Array.isArray(p.loans) && p.loans.length);
    const nLoans = loansOn ? p.loans.length : 0;
    const loanNos = (v) => { if (blank(v)) return null; const out = []; for (const tok of String(v).split(/[^0-9]+/)) { const n = parseInt(tok, 10); if (n >= 1 && n <= nLoans && !out.includes(n - 1)) out.push(n - 1); } return out.length ? out : null; };
    const TRIG = ['date', 'works', 'balance', 'units'];
    const tranches = tranchesOn ? p.tranches.map((t, idx) => ({ t, idx })).filter(({ t }) => !blank(t.amount)).map(({ t, idx }) => ({ date: parseDate(t.date) ?? drawdown, amount: num(t.amount), label: t.label || '', milestone: optPct(t.milestone), idx,
      ...(loansOn ? { loan: Math.min(nLoans, Math.max(1, Math.round(num(t.loan, 1)))) - 1, fee: optPct(t.fee), rate: optPct(t.rate), minMonths: Math.max(0, Math.round(num(t.minMonths))),
        trig: TRIG.includes(t.trigger) ? t.trigger : (i.trancheMode === 'progress' && optPct(t.milestone) != null ? 'works' : 'date'), dateSet: !blank(t.date),
        trigAmount: num(t.trigAmount), trigLoan: loanNos(t.trigLoan), trigUnits: Math.max(0, Math.round(num(t.trigUnits))) } : {}) })).sort((a, b) => a.date - b.date) : null;
    const facility = tranchesOn ? tranches.reduce((s, t) => s + t.amount, 0) : num(i.loan);
    const periodOf = (dn) => { if (dn <= eomonth(drawdown, 0)) return 0; let k = 1; while (eomonth(drawdown, k) < dn && k < 400) k++; return k + 1; };
    // construction / renovation (off unless switched on with at least one budget line)
    const cLines = (p.constrLines || []).filter((l) => !blank(l.budget) || !blank(l.spent));
    const constr = i.constrOn && cLines.length ? {
      start: parseDate(i.worksStart) ?? drawdown, end: parseDate(i.worksEnd) ?? eomonth(drawdown, Math.max(1, Math.round(num(i.term, 12))) - 1),
      cont: pct(i.contingency), curve: ['scurve', 'manual'].includes(i.spendCurve) ? i.spendCurve : 'even', funding: i.fundingOrder === 'proRata' ? 'proRata' : 'equityFirst',
      equity: num(i.constrEquity), credit: blank(i.collCredit) ? 0.5 : pct(i.collCredit),
      vatOn: !!i.costVatOn, vatRate: pct(i.costVatRate), vatLag: Math.max(0, Math.round(num(i.costVatLag))),
      lines: cLines.map((l) => ({ name: l.name || '', budget: num(l.budget), spent: num(l.spent), sched: Array.isArray(l.sched) ? l.sched.map((v) => num(v)) : [] })),
    } : null;
    if (constr) {
      constr.spentToDate = constr.lines.reduce((s, l) => s + l.spent, 0);
      constr.remaining = constr.lines.reduce((s, l) => s + Math.max(0, l.budget - l.spent), 0) * (1 + constr.cont);
      constr.total = constr.spentToDate + constr.remaining;
      constr.startP = Math.max(1, periodOf(constr.start)); constr.endP = Math.max(constr.startP, periodOf(constr.end));
    }
    const progressMode = !!(constr && tranchesOn && i.trancheMode === 'progress');
    const draws = {}; let draw0 = facility;
    if (tranchesOn) { draw0 = 0; for (const t of tranches) { if (loansOn && (t.trig === 'balance' || t.trig === 'units')) continue; const pp = (loansOn ? t.trig === 'works' && constr && t.milestone != null : progressMode && t.milestone != null) ? (t.milestone <= (constr.total > 0 ? constr.spentToDate / constr.total : 0) + 1e-9 ? 0 : -1) : periodOf(t.date); if (pp === 0) draw0 += t.amount; else if (pp > 0) draws[pp] = (draws[pp] || 0) + t.amount; } }
    const revenue = i.revenueSource === 'assets' ? assetSum('rent') : num(i.revenue);
    const purchase = i.purchaseSource === 'assets' ? assetSum('acqPrice') : num(i.purchase);
    const debts = (p.debts || []).map((d) => ({ lender: d.lender || '', balance: num(d.balance), rate: optPct(d.rate), maturity: parseDate(d.maturity), prepay: num(d.prepay), refinanced: d.refinanced !== false && d.refinanced !== 'No', service: num(d.service), end: parseDate(d.end) }));
    const refiTable = debts.filter((d) => d.refinanced).reduce((s, d) => s + d.balance + d.prepay, 0);
    const refi = num(i.refinanced) + refiTable, closing = num(i.closingCosts), otherUses = num(i.otherUses);
    const equity = i.equityAuto ? Math.max(0, refi + purchase + closing + otherUses - draw0) : num(i.equity);
    const dealTerm = Math.max(1, Math.min(240, Math.round(num(i.term, 1))));
    const loans = loansOn ? p.loans.map((l, j) => {
      const trs = tranches.filter((t) => t.loan === j);
      return { name: l.name || `Loan ${j + 1}`, fee: optPct(l.fee), rate: optPct(l.rate), gain: optPct(l.gain), reserveMonths: blank(l.reserveMonths) ? null : num(l.reserveMonths),
        term: blank(l.term) ? dealTerm : Math.max(1, Math.min(240, Math.round(num(l.term, 1)))), amount: trs.reduce((s2, t) => s2 + t.amount, 0) };
    }) : null;
    const termBase = loansOn ? Math.max(...loans.map((l) => l.term)) : dealTerm;
    const extOn = !loansOn && !!i.extOn && num(i.extMonths) > 0;
    const extMonths = extOn ? Math.round(num(i.extMonths)) : 0;
    const term = Math.min(240, termBase + extMonths);
    const horizonIn = Math.max(1, Math.min(240, Math.round(num(i.horizon, term))));
    const repay = !loansOn && REPAY.includes(i.repayType) ? i.repayType : 'Bullet'; // several loans: each is a bullet loan at its own maturity
    const amort = repay === 'Bullet' ? 'None' : (repay === 'Interest-only grace then equal principal' || repay === 'Equal principal from start') ? 'Equal' : 'Annuity';
    const grace = Math.round(num(i.grace));
    const ioOf = (T) => (repay === 'Bullet' ? T : (repay === 'Annuity from start' || repay === 'Equal principal from start') ? 0 : Math.max(0, Math.min(grace, T - 1)));
    const rate = pct(i.rate);
    const r = {
      name: p.name || '', currency: i.currency || 'EUR', drawdown,
      horizon: Math.min(240, Math.max(horizonIn, term)), horizonIn,
      openingCash: num(i.openingCash),
      opModel: i.opModel === 'detailed' ? 'detailed' : 'simple',
      revenue, revGrowth: pct(i.revGrowth), opex: num(i.opex), opexGrowth: pct(i.opexGrowth),
      cfStart: parseDate(i.cfStart), tax: pct(i.tax), otherDebt: num(i.otherDebt), otherDebtEnd: parseDate(i.otherDebtEnd),
      vat: pct(i.vat), commission: pct(i.commission), cardFee: pct(i.cardFee), ancillary: pct(i.ancillary),
      revLines: (p.revLines || []).map((l) => ({
        name: l.name || '', kind: ['nightly', 'monthly', 'fixed'].includes(l.kind) ? l.kind : 'nightly', units: num(l.units), price: num(l.price), occ: blank(l.occ) ? null : pct(l.occ),
        start: parseDate(l.start), end: parseDate(l.end), growth: pct(l.growth),
        occM: Array.from({ length: 12 }, (_, k) => (Array.isArray(l.occM) && !blank(l.occM[k]) ? pct(l.occM[k]) : null)),
        priceM: Array.from({ length: 12 }, (_, k) => (Array.isArray(l.priceM) && !blank(l.priceM[k]) ? num(l.priceM[k]) : null)),
      })),
      costLines: (p.costLines || []).map((l) => ({
        name: l.name || '', kind: ['fixed', 'pctRev', 'perNight', 'perUnit'].includes(l.kind) ? l.kind : 'fixed', amount: l.kind === 'pctRev' ? pct(l.amount) : num(l.amount),
        growth: pct(l.growth), start: parseDate(l.start), end: parseDate(l.end), mask: monthMask(l.months),
        amountM: Array.from({ length: 12 }, (_, k) => (Array.isArray(l.amountM) && !blank(l.amountM[k]) ? num(l.amountM[k]) : null)),
      })),
      loan: facility, facility, draw0, draws, tranchesOn, tranches, constr, progressMode,
      ...(loansOn ? { loans, defaultRateSet: !blank(i.defaultRate) } : {}),
      saleVat: i.saleVatMode === 'incl' ? pct(i.saleVatRate) : 0, rate, termBase, term, extOn, extMonths, repay, amort, grace, ioOf, ioMonths: ioOf(term), capitalise: i.capitalise === 'Yes',
      extFee: pct(i.extFee), extRate: blank(i.extRate) ? rate : pct(i.extRate), defaultRate: blank(i.defaultRate) ? rate : pct(i.defaultRate),
      feeBasis: i.feeBasis === 'tranche' ? 'tranche' : 'facility', feeCap: i.feeTreatment === 'capitalised', commitFee: pct(i.commitFee),
      payMonths: months12(i.payMonths, true),
      sweepDefault: pct(i.sweepDefault), sweepBasis: i.sweepBasis === 'Net sale proceeds' ? 'Net' : 'Gross', sweepAll: i.sweepApplies !== 'Collateral sales only',
      saleRepay: i.saleRepay === 'release' ? 'release' : 'sweep', releasePct: pct(i.releasePct, 1), payPlan: planRows(i.payPlan), escrow: i.escrowOn === true || i.escrowOn === 'Yes',
      intTiming: i.intTiming === 'onSales' ? 'onSales' : 'monthly', saleOrder: i.saleOrder === 'interestFirst' ? 'interestFirst' : 'principalFirst',
      opSweepPct: pct(i.opSweepPct), opSweepMin: num(i.opSweepMin), opSweepMonths: months12(i.opSweepMonths, false),
      arrFee: pct(i.arrFee), reserveMonths: num(i.reserveMonths), prepayFee: pct(i.prepayFee), exitFee: pct(i.exitFee),
      gain: pct(i.fixedGain), profitShare: pct(i.profitShare), deduction: pct(i.deduction), acctFee: pct(i.acctFee),
      refi, refiManual: num(i.refinanced), refiTable, purchase, closing, otherUses, equity, debts,
      projectCost: blank(i.projectCost) ? refi + purchase + closing + otherUses : num(i.projectCost),
      haircut: pct(i.haircut), sellCost: pct(i.sellCost), maxLTV: pct(i.maxLTV, 0.7), minDSCR: num(i.minDSCR, 1.2),
      targetCover: num(i.targetCover, 0), dscrBasis: i.dscrBasis === 'monthly' ? 'monthly' : 'rolling12',
      exitCap: pct(i.exitCap), refiLTV: pct(i.refiLTV),
      seas: Array.from({ length: 12 }, (_, k) => num((i.seasonality || [])[k], 1)),
      assets: assets.map((a) => ({
        name: a.name || '', inColl: a.inColl !== false && a.inColl !== 'No',
        market: optNum(a.market), marketDone: constr ? optNum(a.marketDone) : null, haircut: optPct(a.haircut), saleDate: parseDate(a.saleDate),
        salePriceGross: optNum(a.salePrice), salePrice: optNum(a.salePrice) == null ? null : optNum(a.salePrice) / (1 + (i.saleVatMode === 'incl' ? pct(i.saleVatRate) : 0)), // prices incl. VAT: only the net amount is proceeds
        sweep: optPct(a.sweep), minPrice: optNum(a.minPrice) == null ? null : optNum(a.minPrice) / (1 + (i.saleVatMode === 'incl' ? pct(i.saleVatRate) : 0)), notary: num(a.notary), alloc: optNum(a.alloc), area: optNum(a.area),
        listPrice: optNum(a.listPrice), status: a.status || '', deposit: num(a.deposit), depositPre: a.depositHeld === 'Borrower' ? num(a.deposit) : 0,
        contractDate: parseDate(a.contractDate), ownPlan: planText(a.payPlan),
        ...(loansOn ? { secures: loanNos(a.secures), repays: loanNos(a.repays) } : {}), // blank = every loan; repays in the order written
      })),
      adjustments: (p.adjustments || []).filter((a) => parseDate(a.date) != null).map((a) => {
        const date = parseDate(a.date), monthly = a.recurrence === 'Monthly';
        return { desc: a.desc || '', type: a.type === 'Income' ? 'Income' : a.type === 'Capex' ? 'Capex' : 'Expense', date, eff: monthly ? (parseDate(a.end) ?? mk(2100, 12, 31)) : date, amount: num(a.amount), raw: num(a.amount) };
      }),
    };
    return r;
  }

  const ZERO_DEV = { rev: 0, opex: 0, rentDelay: 0, rate: 0, salePrice: 0, saleDelay: 0, value: 0, capex: 0, exitDelay: 0, complDelay: 0 };

  // ---------- construction: monthly spend, progress and completion ----------
  // Cumulative share of a line's remaining cost spent by fraction t of the works period (0..1).
  const curveF = (c, l) => {
    if (c.curve === 'scurve') return (t) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2;
    if (c.curve === 'manual') {
      const n = c.endP - c.startP + 1, v = Array.from({ length: n }, (_, k) => Math.max(0, l.sched[k] || 0)), tot = v.reduce((a, b) => a + b, 0); // months beyond the planned completion are ignored
      if (!(tot > 0)) return (t) => Math.min(1, Math.max(0, t));
      const cum = [0]; v.forEach((x) => cum.push(cum[cum.length - 1] + x / tot));
      return (t) => { const u = Math.min(1, Math.max(0, t)) * n, k = Math.floor(u); return k >= n ? 1 : cum[k] + (cum[k + 1] - cum[k]) * (u - k); };
    }
    return (t) => Math.min(1, Math.max(0, t));
  };
  function worksPlan(c, delay) { // spend by period (before cost stress), progress by period, completion period
    const endP = c.endP + delay, n = endP - c.startP + 1, spend = {}, byLine = {};
    c.lines.forEach((l, li) => {
      const rem = Math.max(0, l.budget - l.spent) * (1 + c.cont), F = curveF(c, l);
      for (let k = 1; k <= n; k++) { const amt = rem * (F(k / n) - F((k - 1) / n)); if (amt) { const pp = c.startP + k - 1; spend[pp] = (spend[pp] || 0) + amt; (byLine[pp] = byLine[pp] || [])[li] = amt; } }
    });
    const prog0 = c.total > 0 ? c.spentToDate / c.total : 1;
    const progress = (pp) => { if (c.total <= 0) return 1; let cum = c.spentToDate; for (const q in spend) if (+q <= pp) cum += spend[q]; return Math.min(1, cum / c.total); };
    return { spend, byLine, endP, n, prog0, progress };
  }

  // ---------- operating model (detailed mode) ----------
  function opMonth(r, p, me, revF, opexF, delay) {
    const m = monthOf(me) - 1, step = Math.floor((p - 1) / 12), days = daysIn(me);
    let gross = 0, nights = 0, units = 0;
    for (const l of r.revLines) {
      const start = delay ? edate(l.start ?? r.drawdown, delay) : l.start;
      if ((start != null && me < start) || (l.end != null && me > eomonth(l.end, 0))) continue;
      const g = Math.pow(1 + l.growth, step);
      const price = (l.priceM[m] != null ? l.priceM[m] : l.price) * g;
      const occ = l.occM[m] != null ? l.occM[m] : (l.occ != null ? l.occ : 1);
      if (l.kind === 'nightly') { const n = l.units * days * occ; nights += n; units += l.units; gross += n * price; }
      else if (l.kind === 'monthly') { units += l.units; gross += l.units * price * occ; }
      else gross += price;
    }
    gross *= revF; nights *= 1; // revenue stress scales price, not nights
    const revenue = gross / (1 + r.vat) * (1 + r.ancillary);
    let costs = gross * (r.commission + r.cardFee);
    for (const l of r.costLines) {
      if ((l.start != null && me < l.start) || (l.end != null && me > eomonth(l.end, 0)) || !l.mask[m]) continue;
      const amt = (l.amountM[m] != null ? l.amountM[m] : l.amount);
      const g = Math.pow(1 + l.growth, step);
      if (l.kind === 'fixed') costs += amt * g;
      else if (l.kind === 'pctRev') costs += amt * revenue;
      else if (l.kind === 'perNight') costs += amt * g * nights;
      else costs += amt * g * units;
    }
    return { revenue, opex: costs * opexF, gross, nights };
  }

  // ---------- the monthly engine ----------
  function run(project, dev = ZERO_DEV, opts = {}) {
    const R0 = opts.resolved || resolve(project);
    const d = { ...ZERO_DEV, ...dev };
    const r = { ...R0 };
    const rateAdd = num(d.rate);
    r.rate = R0.rate + rateAdd; r.extRate = R0.extRate + rateAdd; r.defaultRate = R0.defaultRate + rateAdd;
    const delay = Math.round(num(d.rentDelay)), sDelay = Math.round(num(d.saleDelay)), exitDelay = Math.max(0, Math.round(num(d.exitDelay)));
    const cDelay = R0.constr ? Math.max(0, Math.round(num(d.complDelay))) : 0;
    const W = R0.constr ? worksPlan(R0.constr, cDelay) : null;
    const complDate = R0.constr ? R0.constr.end : null; // things planned on or after completion move with a completion delay
    const T0 = R0.termBase, TX = R0.term; // contractual (with extension if used)
    r.term = Math.min(240, TX + exitDelay); r.ioMonths = R0.ioOf(r.term); r.horizon = Math.min(240, Math.max(R0.horizon, r.term));
    const afterCompl = (dn) => (cDelay && dn != null && dn >= complDate ? edate(dn, cDelay) : dn);
    r.revStart = delay ? edate(afterCompl(R0.cfStart) ?? R0.drawdown, delay) : afterCompl(R0.cfStart);
    r.cfStart = afterCompl(R0.cfStart);
    const shiftS = (dn) => (dn == null ? null : sDelay ? edate(afterCompl(dn), sDelay) : afterCompl(dn));
    r.assets = R0.assets.map((a) => ({ ...a, saleDate: shiftS(a.saleDate), contractDate: a.contractDate != null && a.contractDate < eomonth(R0.drawdown, -1) + 1 ? a.contractDate : shiftS(a.contractDate), salePrice: a.salePrice == null ? null : a.salePrice * (1 + num(d.salePrice)) }));
    if (R0.progressMode) { // tranches with a milestone are drawn in the month the works reach it
      r.draws = {}; r.trancheAt = [];
      for (const t of R0.tranches) {
        let pp;
        if (t.milestone == null) pp = (() => { if (t.date <= eomonth(R0.drawdown, 0)) return 0; let k = 1; while (eomonth(R0.drawdown, k) < t.date && k < 400) k++; return k + 1; })();
        else if (t.milestone <= W.prog0 + 1e-9) pp = 0;
        else { pp = W.endP; for (let q = 1; q <= W.endP; q++) if (W.progress(q) >= t.milestone - 1e-9) { pp = q; break; } }
        r.trancheAt.push(pp); if (pp > 0) r.draws[pp] = (r.draws[pp] || 0) + t.amount;
      }
    }
    // several loans: state per loan (LS) and per tranche (TR). A tranche released by date or works has a fixed month; one released when a balance
    // falls below an amount or when N units are sold is tested every month on last month's figures, so stresses move it.
    const LS = R0.loans ? R0.loans.map((L) => ({ L, T0: L.term, T: Math.min(240, L.term + exitDelay), amount: L.amount, gain: L.gain != null ? L.gain : R0.gain, pool: 0 })) : null;
    const TR = LS ? R0.tranches.map((t) => {
      const L = R0.loans[t.loan], dP = periodAt(R0.drawdown, t.date);
      let fixedP = dP;
      if (t.trig === 'works' && W && t.milestone != null) { if (t.milestone <= W.prog0 + 1e-9) fixedP = 0; else { fixedP = W.endP; for (let q = 1; q <= W.endP; q++) if (W.progress(q) >= t.milestone - 1e-9) { fixedP = q; break; } } }
      return { t, L: t.loan, fee: t.fee != null ? t.fee : L.fee != null ? L.fee : R0.arrFee, rate: t.rate != null ? t.rate : L.rate != null ? L.rate : R0.rate,
        fixedP: t.trig === 'balance' || t.trig === 'units' ? null : fixedP, earliest: t.dateSet ? Math.max(1, dP) : 1, bal: 0, drawP: null, rt: 0 };
    }) : null;
    const valF = 1 + num(d.value), capexF = 1 + num(d.capex), revF = 1 + num(d.rev), opexF = 1 + num(d.opex);
    // when a sale's money arrives: instalments by the payment plan (from the contract date), the rest at the deed (= sale date).
    // Without a plan or contract date, or with payments held in escrow until the deed, everything arrives at the deed – as before v3.16.
    // Instalments dated before the drawdown month are already with the borrower (pre: true) and do not arrive again.
    const ms0 = eomonth(R0.drawdown, -1) + 1;
    function paysOf(a) {
      if (a.salePrice == null || a.saleDate == null) return [];
      const steps = a.ownPlan != null ? a.ownPlan : r.payPlan;
      const out = []; let used = 0;
      if (steps.length && a.contractDate != null && !r.escrow) for (const st of steps) {
        const dn = edate(a.contractDate, st.months), sh = Math.min(st.share, 1 - used); if (sh <= 0 || dn >= a.saleDate) continue;
        out.push({ date: dn, share: sh, months: st.months, deed: false, pre: dn < ms0 }); used += sh;
      }
      out.push({ date: a.saleDate, share: 1 - used, deed: true, pre: false });
      if (out.length === 1) { out[0].share = 1; out[0].repaid = a.repaid; return out; }
      if (r.saleRepay === 'release' && a.release != null) { let left = a.repaid; // the release price is paid off from the first instalments
        for (const q of out) { const net = q.share * a.salePrice * (1 - r.sellCost) - (q.deed ? a.notary : 0); q.repaid = q.pre ? 0 : Math.max(0, Math.min(left, net)); left -= q.repaid; } }
      else for (const q of out) q.repaid = q.pre ? 0 : q.share * a.repaid;
      return out;
    }

    for (const a of r.assets) {
      a.forced = a.market == null ? null : a.market * (1 - (a.haircut == null ? r.haircut : a.haircut));
      a.release = a.alloc != null ? a.alloc * r.releasePct : null;
      if (a.salePrice != null) {
        a.sweepUsed = a.sweep != null ? a.sweep : ((r.sweepAll || a.inColl) ? r.sweepDefault : 0);
        a.repaid = (r.saleRepay === 'release' && a.release != null) ? Math.min(a.release, a.salePrice * (1 - r.sellCost) - a.notary) : a.sweepUsed * a.salePrice * (r.sweepBasis === 'Net' ? 1 - r.sellCost : 1);
        a.repaid = Math.max(0, a.repaid);
        a.profitBase = a.minPrice != null ? Math.max(0, a.salePrice * (1 - r.deduction) - a.notary - a.minPrice) : null;
        a.profitShareAmt = a.profitBase != null ? a.profitBase * r.profitShare : 0;
      } else { a.sweepUsed = null; a.repaid = 0; a.profitBase = null; a.profitShareAmt = 0; }
      a.pays = paysOf(a);
    }

    const fac = r.facility;
    const fee0 = TR ? TR.reduce((a, q) => a + (r.feeBasis === 'facility' || q.fixedP === 0 ? q.t.amount * q.fee : 0), 0) : r.feeBasis === 'facility' ? fac * r.arrFee : r.draw0 * r.arrFee;
    const arrFeeAmt = TR ? TR.reduce((a, q) => a + q.t.amount * q.fee, 0) : r.feeBasis === 'facility' ? fac * r.arrFee : fac * r.arrFee; // total over the loan
    const reserveAmt = LS ? LS.reduce((a, q) => a + q.amount * ((q.L.rate != null ? q.L.rate : R0.rate) + rateAdd) / 12 * (q.L.reserveMonths != null ? q.L.reserveMonths : r.reserveMonths), 0) : fac * r.rate / 12 * r.reserveMonths;
    const netCash = r.draw0 - (r.feeCap ? 0 : fee0) - reserveAmt - r.refi - r.purchase - r.closing - r.otherUses + r.equity;
    const H = r.horizon, T = r.term;

    // collateral value of an asset in period pp: as-is, plus a share (credit %) of the uplift to its completed value as the works progress; completed value from completion
    const valueAt = (a, pp) => {
      if (!W || a.marketDone == null) return a.market;
      const base = a.market == null ? 0 : a.market;
      if (pp >= W.endP) return a.marketDone;
      if (pp <= 0) return a.market;
      const done = W.prog0 >= 1 ? 1 : Math.max(0, (W.progress(pp) - W.prog0) / (1 - W.prog0));
      return base + (a.marketDone - base) * r.constr.credit * done;
    };
    const collAt = (dn, key, pp = 0, j = null) => { // j: only the assets securing loan j (several loans)
      let tot = 0;
      for (const a of r.assets) {
        if (!a.inColl) continue; if (a.saleDate != null && a.saleDate <= dn) continue; if (j != null && a.secures && !a.secures.includes(j)) continue;
        const mv = valueAt(a, pp); if (mv == null) continue;
        tot += key === 'market' ? mv : mv * (1 - (a.haircut == null ? r.haircut : a.haircut));
      }
      return tot * valF;
    };
    const otherDebtAt = (me) => {
      let s = (r.otherDebtEnd == null || me <= r.otherDebtEnd) ? r.otherDebt : 0;
      for (const db of r.debts) if (!db.refinanced && db.service && (db.end == null || me <= db.end)) s += db.service;
      return s;
    };

    const rows = [];
    const open0 = r.draw0 + (r.feeCap ? fee0 : 0);
    const row0 = {
      p: 0, date: r.drawdown, year: yearOf(r.drawdown), inH: 1, active: 0, season: null,
      revenue: 0, opex: 0, extraInc: 0, extraExp: 0, ebitda: 0, tax: 0, cfads: 0,
      saleColl: 0, saleOther: 0, sellCosts: 0, depositPre: 0, netSale: 0, draw: r.draw0, drawFee: r.feeCap ? 0 : fee0, feeCapd: r.feeCap ? fee0 : 0, undrawn: fac - r.draw0, commit: 0,
      open: 0, interest: 0, capitalised: 0, intDue: 0, deferred: 0, intReserve: 0, intCash: 0, sweptX: 0, sweep: 0, sched: 0, opSweep: 0, principal: 0, close: open0,
      prepay: 0, exit: 0, extFee: 0, resOpen: 0, resRelease: 0, resClose: reserveAmt, otherDebt: 0, toInRento: 0,
      ncf: netCash, cash: r.openingCash + netCash,
      collMkt: collAt(-Infinity, 'market'), collFs: collAt(-Infinity, 'forced'), // sales are booked from month 1, so everything is still pledged at drawdown
      dscrPrincipal: 0, dscr: null, dscr12: null, icr: null, lenderCF: -r.draw0 + (r.feeCap ? 0 : fee0) + reserveAmt, repaidNow: 0, gain: 0, pshare: 0, gainPool: 0,
    };
    if (W) { row0.works = 0; row0.worksEq = 0; row0.worksVat = 0; row0.worksVatBack = 0; row0.progress = W.prog0; }
    if (LS) { // drawdown: tranches dated in the drawdown month (or whose works share is already reached), fees per tranche
      row0.loans = LS.map(() => ({ open: 0, draw: 0, fee: 0, feeCapd: 0, interest: 0, minInt: 0, capitalised: 0, sweep: 0, sched: 0, principal: 0, gain: 0, exit: 0, prepay: 0, close: 0, repaid: false }));
      for (const q of TR) {
        const lx = row0.loans[q.L], f = r.feeBasis === 'facility' || q.fixedP === 0 ? q.t.amount * q.fee : 0;
        if (q.fixedP === 0) { q.drawP = 0; q.bal += q.t.amount; lx.draw += q.t.amount; }
        lx.fee += f; if (r.feeCap) { q.bal += f; lx.feeCapd += f; }
      }
      row0.loans.forEach((lx, j) => { lx.close = TR.reduce((a, q) => a + (q.L === j ? q.bal : 0), 0); lx.coll = collAt(-Infinity, 'market', 0, j); lx.ltv = lx.close > 0.005 && lx.coll > 0 ? lx.close / lx.coll : null; });
    }
    row0.ltv = row0.close > 0.005 && row0.collMkt > 0 ? row0.close / row0.collMkt : null;
    row0.ltvFs = row0.close > 0.005 && row0.collFs > 0 ? row0.close / row0.collFs : null;
    rows.push(row0);
    let cumDrawn = r.draw0, pool = 0, deferred = 0, eqUsed = 0;

    for (let p = 1; p <= H; p++) {
      const prev = rows[p - 1];
      const me = eomonth(r.drawdown, p - 1), ms = eomonth(r.drawdown, p - 2) + 1, mIdx = monthOf(me) - 1;
      const x = { p, date: me, year: yearOf(me), inH: 1 };
      const step = Math.floor((p - 1) / 12);
      if (r.opModel === 'detailed') {
        const o = opMonth(r, p, me, revF, opexF, delay);
        x.season = null; x.revenue = o.revenue; x.opex = o.opex; x.nights = o.nights; x.gross = o.gross;
      } else {
        x.season = r.seas[mIdx];
        x.revenue = (r.revStart == null || me >= r.revStart) ? r.revenue * revF * Math.pow(1 + r.revGrowth, step) * x.season : 0;
        x.opex = (r.cfStart == null || me >= r.cfStart) ? r.opex * opexF * Math.pow(1 + r.opexGrowth, step) : 0;
      }
      let inc = 0, exp = 0, cpx = 0;
      for (const a of r.adjustments) if (a.date <= me && (a.eff >= ms || (p === 1 && a.eff === a.date))) { if (a.type === 'Income') inc += a.amount; else if (a.type === 'Capex') cpx += a.amount; else exp += a.amount; }
      x.extraInc = inc; x.extraExp = exp * capexF; x.capex = cpx * capexF;
      if (W) { // construction: spend (cost stress applies), borrower equity for the works, VAT on costs and its refund
        x.works = (W.spend[p] || 0) * capexF; x.progress = W.progress(p);
        const c = r.constr, sh = c.remaining > 0 ? Math.min(1, c.equity / c.remaining) : 0;
        x.worksEq = c.funding === 'proRata' ? Math.min(x.works * sh, Math.max(0, c.equity - eqUsed)) : Math.min(x.works, Math.max(0, c.equity - eqUsed)); eqUsed += x.worksEq;
        x.worksVat = c.vatOn ? x.works * c.vatRate : 0;
        x.worksVatBack = c.vatOn && p - c.vatLag >= 1 ? ((W.spend[p - c.vatLag] || 0) * capexF * c.vatRate) : 0;
      }
      x.ebitda = x.revenue - x.opex + x.extraInc - x.extraExp;
      let sc = 0, so = 0, notary = 0, swept = 0, ps = 0, dep = 0; const swList = []; // swList: [asset, amount swept] for several loans
      for (const a of r.assets) {
        if (!a.pays.length) { if (a.saleDate == null || (p > 1 && a.saleDate < ms) || a.saleDate > me) continue; notary += a.notary; ps += a.profitShareAmt; dep += a.depositPre; continue; } // dated, no price
        for (const q of a.pays) {
          if (q.pre || (p > 1 && q.date < ms) || q.date > me) continue; // dated before the drawdown month: booked in month 1
          const amt = q.share === 1 ? a.salePrice : q.share * a.salePrice; if (a.inColl) sc += amt; else so += amt;
          swept += q.repaid; if (LS && q.repaid) swList.push([a, q.repaid]); if (q.deed) { notary += a.notary; ps += a.profitShareAmt; dep += a.depositPre; }
        }
      }
      x.saleColl = sc; x.saleOther = so; x.sellCosts = (sc + so) * r.sellCost + notary; x.depositPre = dep; x.netSale = sc + so - x.sellCosts - dep; // deposits already paid to the borrower before drawdown do not arrive again
      // tranche draws (start of month)
      let LX = null; // several loans: this month's figures per loan
      if (!LS) {
        x.draw = p <= T ? (r.draws[p] || 0) : 0; cumDrawn += x.draw;
        const feeT = r.feeBasis === 'tranche' ? x.draw * r.arrFee : 0;
        x.drawFee = r.feeCap ? 0 : feeT; x.feeCapd = r.feeCap ? feeT : 0;
      } else {
        LX = LS.map(() => ({ open: 0, draw: 0, fee: 0, feeCapd: 0, interest: 0, minInt: 0, capitalised: 0, sweep: 0, sched: 0, principal: 0, gain: 0, exit: 0, prepay: 0, close: 0, repaid: false }));
        const soldBy = eomonth(r.drawdown, p - 2); // triggers look at last month: units with the deed signed by its end, balances at its close
        const sold = r.assets.filter((a) => a.salePrice != null && a.saleDate != null && a.saleDate <= soldBy).length;
        const balOf = (js) => (js == null ? prev.close : js.reduce((t, j) => t + prev.loans[j].close, 0));
        x.draw = 0; x.drawFee = 0; x.feeCapd = 0;
        for (const q of TR) {
          if (q.drawP != null || p > LS[q.L].T) continue;
          const go = q.t.trig === 'balance' ? p >= q.earliest && balOf(q.t.trigLoan) < q.t.trigAmount - 0.005
            : q.t.trig === 'units' ? p >= q.earliest && sold >= q.t.trigUnits : q.fixedP === p;
          if (!go) continue;
          const lx = LX[q.L]; q.drawP = p; q.bal += q.t.amount; x.draw += q.t.amount; lx.draw += q.t.amount;
          if (r.feeBasis === 'tranche') { const f = q.t.amount * q.fee; lx.fee += f; if (r.feeCap) { q.bal += f; lx.feeCapd += f; x.feeCapd += f; } else x.drawFee += f; }
        }
        cumDrawn += x.draw;
      }
      x.undrawn = Math.max(0, fac - cumDrawn);
      x.commit = p <= T ? x.undrawn * r.commitFee / 12 : 0;
      // loan
      let rateP = 0;
      if (!LS) {
        x.open = prev.close + x.draw + x.feeCapd;
        rateP = p <= T0 ? r.rate : p <= TX ? r.extRate : r.defaultRate;
        x.rateP = rateP;
        x.interest = p <= T ? x.open * rateP / 12 : 0;
        x.capitalised = (r.capitalise && p <= r.ioMonths && p <= T) ? x.interest : 0;
      } else { // interest per tranche at its own rate (after the loan's maturity, under a late-exit stress: the default rate when one is set)
        for (const q of TR) {
          const Ls = LS[q.L], lx = LX[q.L]; lx.open += q.bal;
          q.rt = (p <= Ls.T0 ? q.rate : R0.defaultRateSet ? R0.defaultRate : q.rate) + rateAdd;
          const it = p <= Ls.T ? q.bal * q.rt / 12 : 0; lx.interest += it;
          if (q.bal > 0.005) (lx.trs = lx.trs || []).push({ idx: q.t.idx, label: q.t.label, bal: q.bal, rt: q.rt }); // for the explanation
          if (r.capitalise && p <= Ls.T) { q.bal += it; lx.capitalised += it; }
        }
        LS.forEach((Ls, j) => { if (p <= Ls.T) Ls.pool += LX[j].open * Ls.gain / 12; });
        x.open = LX.reduce((t, lx) => t + lx.open, 0); x.interest = LX.reduce((t, lx) => t + lx.interest, 0); x.capitalised = LX.reduce((t, lx) => t + lx.capitalised, 0);
      }
      x.intDue = x.interest - x.capitalised;
      x.resOpen = prev.resClose;
      x.sweptX = swept;
      const bal = x.open + x.capitalised;
      let sweepCap = Infinity; // payment order: interest due comes out of the sale proceeds before principal
      if (r.saleOrder === 'interestFirst' && x.netSale > 0.005) {
        const payGuess = r.intTiming === 'onSales' || r.payMonths[mIdx] || p >= T;
        const intGuess = payGuess ? x.intDue + deferred : 0;
        sweepCap = Math.max(0, x.netSale - Math.max(0, intGuess - x.resOpen));
      }
      let princ, gainNow, close, repaid, anyClosed = false;
      if (!LS) {
        x.sweep = p <= T ? Math.min(bal, swept, sweepCap) : 0;
        const rem = bal - x.sweep;
        let z = 0;
        if (!(p > T || rem <= 0.005)) {
          if (p === T) z = rem;
          else if (p <= r.ioMonths) z = 0;
          else if (r.amort === 'Equal') z = rem / (T - p + 1);
          else if (r.amort === 'Annuity') z = rateP === 0 ? rem / (T - p + 1) : Math.min(rem, ppmt1(rateP / 12, T - p + 1, rem));
        }
        x.sched = z;
        if (p <= T) pool += x.open * r.gain / 12;
        princ = x.sweep + x.sched;
        gainNow = bal > 0.005 ? pool * princ / bal : 0; pool -= gainNow;
        close = Math.max(0, bal - princ);
        repaid = close <= 0.005 && bal > 0.005;
      } else {
        // sale proceeds swept go to the loans in each unit's order (blank = Loan 1, 2, …), each loan taking at most its balance;
        // what no listed loan can take stays with the borrower. Interest-first caps the month's total, scaled across loans.
        const all = LS.map((_, j) => j), want = LS.map(() => 0), left = LS.map((Ls, j) => (p <= Ls.T ? LX[j].open + LX[j].capitalised : 0));
        for (const [a, amt0] of swList) { let amt = amt0; for (const j of a.repays || all) { const tk = Math.min(amt, left[j]); want[j] += tk; left[j] -= tk; amt -= tk; if (amt <= 0) break; } }
        const wantT = want.reduce((t, v) => t + v, 0), sc = wantT > sweepCap ? sweepCap / wantT : 1;
        LS.forEach((Ls, j) => {
          const lx = LX[j], b = lx.open + lx.capitalised;
          lx.want = want[j]; lx.scale = sc; lx.sweep = want[j] * sc;
          lx.sched = p === Ls.T && b - lx.sweep > 0.005 ? b - lx.sweep : 0; // bullet at the loan's own maturity
          lx.principal = lx.sweep + lx.sched;
          lx.poolB = Ls.pool; lx.gain = b > 0.005 ? Ls.pool * lx.principal / b : 0; Ls.pool -= lx.gain;
          lx.close = Math.max(0, b - lx.principal); lx.repaid = lx.close <= 0.005 && b > 0.005;
          lx.prepay = p < Ls.T ? lx.sweep * r.prepayFee : 0;
          if (lx.repaid) { lx.exit = r.exitFee * Ls.amount; anyClosed = true; }
          if (lx.principal > 0) for (const q of TR) { // repaid pro rata across the loan's tranches; a tranche repaid inside its minimum interest period pays the missing months
            if (q.L !== j || q.bal <= 0) continue;
            const rp = lx.repaid ? q.bal : lx.principal * q.bal / b; q.bal -= rp;
            const run = p - Math.max(q.drawP, 1) + 1;
            if (q.t.minMonths > run) lx.minInt += rp * q.rt / 12 * (q.t.minMonths - run);
          }
          lx.interest += lx.minInt;
        });
        x.minInt = LX.reduce((t, lx) => t + lx.minInt, 0); x.interest += x.minInt; x.intDue += x.minInt;
        x.sweep = LX.reduce((t, lx) => t + lx.sweep, 0); x.sched = LX.reduce((t, lx) => t + lx.sched, 0);
        princ = x.sweep + x.sched; gainNow = LX.reduce((t, lx) => t + lx.gain, 0); pool = LS.reduce((t, Ls) => t + Ls.pool, 0);
        close = LX.reduce((t, lx) => t + lx.close, 0);
        repaid = close <= 0.005 && bal > 0.005;
      }
      // interest payment (seasonal deferral)
      const payNow = (r.intTiming === 'onSales' ? x.netSale > 0.005 : r.payMonths[mIdx]) || p >= T || repaid || anyClosed;
      let cashInt = payNow ? x.intDue + deferred : 0; deferred = payNow ? 0 : deferred + x.intDue;
      x.extFee = (r.extOn && p === T0 && T > T0 && bal > 0.005) ? r.extFee * bal : 0;
      x.prepay = LX ? LX.reduce((t, lx) => t + lx.prepay, 0) : p < T ? x.sweep * r.prepayFee : 0;
      x.exit = LX ? LX.reduce((t, lx) => t + lx.exit, 0) : repaid ? r.exitFee * fac : 0;
      x.tax = Math.max(0, (x.ebitda - x.interest) * r.tax);
      x.cfads = x.ebitda - x.tax;
      x.otherDebt = otherDebtAt(me);
      x.pshare = bal > 0.005 ? ps : 0;
      // provisional reserve use and cash
      let intReserve = Math.min(cashInt, x.resOpen);
      let resRelease = (repaid || p === T) ? x.resOpen - intReserve : 0;
      let toIR = (cashInt - intReserve) + princ + x.prepay + x.exit + gainNow + x.pshare + x.commit + x.extFee + x.drawFee;
      let ncf = x.cfads + x.netSale + resRelease + x.draw - toIR - x.otherDebt - x.capex;
      if (W) ncf += x.worksEq - x.works - x.worksVat + x.worksVatBack;
      // cash sweep from operations
      x.opSweep = 0;
      if (!LS && r.opSweepPct > 0 && r.opSweepMonths[mIdx] && p < T && close > 0.005) { // not with several loans (model check says so)
        const avail = Math.max(0, prev.cash + ncf - r.opSweepMin) * r.opSweepPct;
        if (avail > 0) {
          const per = 1 + pool / close + r.prepayFee;
          const sw = Math.min(close, avail / per), g = pool * sw / close;
          x.opSweep = sw; pool -= g; gainNow += g; princ += sw; close = Math.max(0, close - sw);
          x.prepay += sw * r.prepayFee;
          toIR += sw + g + sw * r.prepayFee; ncf -= sw + g + sw * r.prepayFee;
          if (close <= 0.005) { // loan cleared: pay deferred interest, release reserve, exit fee
            repaid = true; const extra = deferred; deferred = 0; cashInt += extra;
            const addRes = Math.min(extra, x.resOpen - intReserve); intReserve += addRes;
            const rel = x.resOpen - intReserve; x.exit = r.exitFee * fac;
            toIR += extra - addRes + x.exit; ncf += -(extra - addRes) - x.exit + rel - resRelease; resRelease = rel;
          }
        }
      }
      x.gain = gainNow; x.principal = princ; x.close = close; x.repaidNow = repaid ? 1 : 0;
      x.intReserve = intReserve; x.intCash = cashInt - intReserve; x.deferred = deferred;
      x.resRelease = resRelease; x.resClose = x.resOpen - intReserve - resRelease;
      x.toInRento = toIR; x.ncf = ncf; x.cash = prev.cash + ncf; x.gainPool = pool;
      x.collMkt = collAt(me, 'market', p); x.collFs = collAt(me, 'forced', p);
      x.ltv = x.close > 0.005 && x.collMkt > 0 ? x.close / x.collMkt : null;
      x.ltvFs = x.close > 0.005 && x.collFs > 0 ? x.close / x.collFs : null;
      if (LX) { LX.forEach((lx, j) => { lx.coll = collAt(me, 'market', p, j); lx.ltv = lx.close > 0.005 && lx.coll > 0 ? lx.close / lx.coll : null; }); x.loans = LX; }
      x.active = (p <= T && x.open > 0.005) ? 1 : 0;
      x.dscrPrincipal = (p === T && r.amort === 'None') ? 0 : x.sched;
      x.ds = x.intDue + x.dscrPrincipal + x.otherDebt;
      x.dscr = x.active && x.ds > 0 ? x.cfads / x.ds : null;
      x.icr = x.active && x.interest > 0 ? x.cfads / x.interest : null;
      x.lenderCF = x.intCash + x.principal + x.prepay + x.exit + x.gain + x.pshare + x.commit + x.extFee + x.drawFee - x.resRelease - x.draw;
      rows.push(x);
    }
    // rolling 12-month DSCR over the loan life
    const w = Math.min(12, T);
    for (let p = w; p <= Math.min(T, H); p++) {
      let cf = 0, ds = 0, act = false;
      for (let k = p - w + 1; k <= p; k++) { cf += rows[k].cfads; ds += rows[k].ds; act = act || rows[k].active; }
      rows[p].dscr12 = act && ds > 0 ? cf / ds : null;
    }
    const k = { arrFeeAmt, fee0, reserveAmt, netCash, T0, TX, exitDelay, W, ...(LS ? { LS, TR } : {}) };
    return { r, rows, k, summary: summarise(r, rows, k), annual: annualise(rows) };
  }

  function summarise(r, rows, k) {
    const T = r.term;
    const act = rows.filter((x) => x.p > 0 && x.active);
    const dscrs = act.map((x) => x.dscr).filter((v) => v != null);
    const icrs = act.map((x) => x.icr).filter((v) => v != null);
    const d12 = rows.map((x) => x.dscr12).filter((v) => v != null);
    const sum = (f) => rows.reduce((s, x) => s + (f(x) || 0), 0);
    let low = rows[0]; for (const x of rows) if (x.cash < low.cash) low = x;
    let lowPre = rows[0]; for (const x of rows) if (x.p < T && x.cash < lowPre.cash) lowPre = x;
    const repaidRow = rows.find((x) => x.repaidNow);
    const ltvs = rows.map((x) => x.ltv).filter((v) => v != null), ltvFs = rows.map((x) => x.ltvFs).filter((v) => v != null);
    const irrM = irrMonthly(rows.map((x) => x.lenderCF));
    const interest = sum((x) => x.interest);
    const fees = k.arrFeeAmt + sum((x) => x.prepay) + sum((x) => x.exit) + sum((x) => x.commit) + sum((x) => x.extFee);
    const gains = sum((x) => x.gain), pshare = sum((x) => x.pshare);
    const outflow = rows.reduce((s, x) => s + (x.lenderCF < 0 ? -x.lenderCF : 0), 0);
    const inflows = rows.reduce((s, x) => s + (x.lenderCF > 0 ? x.lenderCF : 0), 0);
    const mkt0 = rows[0].collMkt, fs0 = rows[0].collFs;
    const matRow = rows[Math.min(T, rows.length - 1)];
    const fac = r.facility;
    // exit / refinancing at contractual maturity (before the final repayment)
    const TX = Math.min(k.TX, rows.length - 1), mx = rows[TX];
    const owed = mx ? (mx.open + mx.capitalised - (mx.sweep || 0) - (mx.p < k.TX ? mx.sched : 0)) : 0;
    const owedAll = mx && owed > 0.005 ? owed + (mx.p === k.TX ? (mx.gain || 0) : mx.gainPool) : 0;
    let ebitda12 = 0; for (let p = Math.max(1, TX - 11); p <= TX; p++) ebitda12 += rows[p] ? rows[p].ebitda : 0;
    const exitIncome = r.exitCap > 0 && ebitda12 > 0 ? ebitda12 / r.exitCap : null;
    const collAtExit = mx ? mx.collMkt + (mx.close <= 0.005 && mx.p === k.TX ? 0 : 0) : 0;
    const collEx = rows[Math.max(0, TX - 1)] ? rows[Math.max(0, TX - 1)].collMkt : 0;
    const exitValue = exitIncome != null ? (collEx > 0 ? Math.min(exitIncome, collEx) : exitIncome) : (collEx > 0 ? collEx : null);
    const sizeLTV = r.maxLTV > 0 && mkt0 > 0 ? r.maxLTV * mkt0 : null;
    const sizeCover = r.targetCover > 0 && fs0 > 0 ? fs0 / r.targetCover : null;
    const sizeMax = [sizeLTV, sizeCover].filter((v) => v != null).reduce((a, b) => Math.min(a, b), Infinity);
    const need = r.refi + r.purchase + r.closing + r.otherUses - r.equity;
    const denom = 1 - (r.feeCap ? 0 : r.arrFee) - r.rate / 12 * r.reserveMonths;
    const s = {
      loan: fac, facility: fac, draw0: r.draw0, tranches: r.tranchesOn ? r.tranches.length : 1,
      arrFeeAmt: k.arrFeeAmt, fee0: k.fee0, reserveAmt: k.reserveAmt, refi: r.refi, purchase: r.purchase, closing: r.closing, otherUses: r.otherUses, equity: r.equity, netCash: k.netCash,
      revenue: r.revenue, mkt0, fs0,
      ltv0: mkt0 > 0 ? fac / mkt0 : null, ltvFs0: fs0 > 0 ? fac / fs0 : null, ltvDrawn0: mkt0 > 0 ? rows[0].close / mkt0 : null,
      ltc: r.projectCost > 0 ? fac / r.projectCost : null, cover0: fac > 0 && fs0 > 0 ? fs0 / fac : null,
      maxLtv: ltvs.length ? Math.max(...ltvs) : null, maxLtvFs: ltvFs.length ? Math.max(...ltvFs) : null,
      minDscr: dscrs.length ? Math.min(...dscrs) : null, avgDscr: dscrs.length ? dscrs.reduce((a, b) => a + b, 0) / dscrs.length : null,
      minDscr12: d12.length ? Math.min(...d12) : null,
      dscrBreaches: dscrs.filter((v) => v < r.minDSCR).length, minIcr: icrs.length ? Math.min(...icrs) : null,
      lowCash: low.cash, lowCashDate: low.date, lowCashPre: lowPre.cash, lowCashPreDate: lowPre.date,
      reserveNeed: Math.max(0, -lowPre.cash),
      negMonths: rows.filter((x) => x.cash < 0).length, endCash: rows[rows.length - 1].cash,
      repaidDate: repaidRow ? repaidRow.date : null, maturity: eomonth(r.drawdown, k.TX - 1), maturityBase: eomonth(r.drawdown, k.T0 - 1),
      viaSweep: sum((x) => x.sweep), viaSched: sum((x) => x.sched), viaOpSweep: sum((x) => x.opSweep), capitalised: sum((x) => x.capitalised),
      interest, intReserve: sum((x) => x.intReserve), intCash: sum((x) => x.intCash), commit: sum((x) => x.commit), extFee: sum((x) => x.extFee),
      fees, gains, pshare, pshareInRento: pshare * r.acctFee, pshareInvestors: pshare * (1 - r.acctFee),
      profit: sum((x) => x.lenderCF), irr: irrM == null ? null : Math.pow(1 + irrM, 12) - 1,
      multiple: outflow > 0 ? inflows / outflow : null,
      simpleYield: fac > 0 ? sum((x) => x.lenderCF) / fac / (k.TX / 12) : null,
      cashAtMaturity: matRow ? matRow.cash : null,
      headroom: mkt0 > 0 ? 1 - (fac + interest) / (mkt0 * (1 - r.sellCost)) : null,
      breakEvenValue: (1 - r.sellCost) > 0 ? (fac + interest) / (1 - r.sellCost) : null,
      sizeLTV, sizeCover, sizeMax: isFinite(sizeMax) ? sizeMax : null, need, grossUp: denom > 0 ? need / denom : null,
      ebitda12, exitIncome, exitValue, owedAtExit: owedAll, exitLTV: exitValue > 0 && owedAll > 0 ? owedAll / exitValue : null,
      refiMax: r.refiLTV > 0 && exitValue > 0 ? r.refiLTV * exitValue : null,
    };
    s.paydown = s.refiMax != null ? Math.max(0, owedAll - s.refiMax) : null;
    if (k.W) {
      const c = r.constr, W = k.W, during = rows.filter((x) => x.p >= 1 && x.p <= W.endP);
      s.worksTotal = c.spentToDate + sum((x) => x.works); s.worksToComplete = sum((x) => x.works); s.worksSpent = c.spentToDate; s.progress0 = W.prog0;
      s.completion = eomonth(r.drawdown, W.endP - 1); s.worksEquity = sum((x) => x.worksEq);
      let lw = null; for (const x of during) if (lw == null || x.cash < lw.cash) lw = x;
      s.lowCashWorks = lw ? lw.cash : null; s.lowCashWorksDate = lw ? lw.date : null;
    }
    if (k.LS) { // several loans: results per loan. Short at maturity = the borrower's cash gap in the loan's maturity month, put on the loans
      // maturing that month from the last in repayment order up to what each still owed (the bullet).
      s.loans = k.LS.map((Ls, j) => {
        const lr = rows.map((x) => x.loans[j]), Tj = Math.min(Ls.T, rows.length - 1), trs = k.TR.filter((q) => q.L === j);
        const repRow = rows.find((x) => x.loans[j].repaid), ltvs = lr.map((x) => x.ltv).filter((v) => v != null);
        const lsum = (f) => lr.reduce((t, x) => t + (x[f] || 0), 0);
        return { name: Ls.L.name, amount: Ls.amount, drawn: trs.reduce((t, q) => t + (q.drawP != null ? q.t.amount : 0), 0), neverDrawn: trs.reduce((t, q) => t + (q.drawP == null ? q.t.amount : 0), 0),
          tranches: trs.map((q) => ({ label: q.t.label, amount: q.t.amount, fee: q.fee, rate: q.rate, drawDate: q.drawP == null ? null : q.drawP === 0 ? r.drawdown : rows[q.drawP].date, drawP: q.drawP })),
          fees: lsum('fee'), interest: lsum('interest'), minInt: lsum('minInt'), gains: lsum('gain'), exit: lsum('exit'), prepay: lsum('prepay'),
          viaSweep: lsum('sweep'), atMaturity: lsum('sched'), peak: Math.max(...lr.map((x) => x.close)), short: 0,
          repaidDate: repRow ? repRow.date : null, maturity: eomonth(r.drawdown, Ls.T0 - 1), owedAtMaturity: rows[Tj] ? rows[Tj].loans[j].open + rows[Tj].loans[j].capitalised - rows[Tj].loans[j].sweep : 0,
          coll0: lr[0].coll, ltv0: lr[0].coll > 0 ? Ls.amount / lr[0].coll : null, maxLtv: ltvs.length ? Math.max(...ltvs) : null };
      });
      const byT = new Map(); k.LS.forEach((Ls, j) => { const Tj = Math.min(Ls.T, rows.length - 1); if (!byT.has(Tj)) byT.set(Tj, []); byT.get(Tj).push(j); });
      for (const [Tj, js] of byT) { let gap = Math.max(0, -rows[Tj].cash); for (const j of js.slice().reverse()) { const sh = Math.min(gap, rows[Tj].loans[j].sched); s.loans[j].short = sh; gap -= sh; } }
    }
    s.dscrTest = r.dscrBasis === 'monthly' ? s.minDscr : s.minDscr12;
    const ok = (b) => (b ? 'OK' : 'CHECK');
    s.checks = [
      ['Loan repaid by maturity', ok(rows[Math.min(T, rows.length - 1)].close <= 0.01), 'Balance at maturity is zero'],
      ['LTV at drawdown within limit', ok(s.ltv0 == null || s.ltv0 <= r.maxLTV), `Full facility vs market value. Limit ${(r.maxLTV * 100).toFixed(0)}%`],
      ['Forced-sale LTV at drawdown within limit', ok(s.ltvFs0 == null || s.ltvFs0 <= r.maxLTV), 'Full facility vs value after haircut'],
      ['Facility within sizing limit', ok(s.sizeMax == null || fac <= s.sizeMax + 1), 'Lower of LTV limit and target collateral coverage'],
      [`Minimum DSCR at or above threshold (${r.dscrBasis === 'monthly' ? 'monthly' : 'rolling 12 months'})`, ok(s.dscrTest == null || s.dscrTest >= r.minDSCR), `Threshold ${r.minDSCR.toFixed(2)}×`],
      ['No negative cash before maturity', ok(s.lowCashPre >= 0), 'Shortfall before the final repayment needs a liquidity reserve'],
      ['Net proceeds not negative', ok(k.netCash >= 0), 'If negative, borrower must fund the gap at drawdown'],
      ['Exit covered: no negative cash at maturity', ok(s.cashAtMaturity == null || s.cashAtMaturity >= 0), 'If CHECK, add a planned sale, refinancing or cash sweep'],
      ['Refinancing at exit within bank LTV', ok(s.refiMax == null || s.paydown <= 1), 'Exit value × bank LTV vs amount owed at maturity'],
      ['Grace period shorter than term', ok(r.amort === 'None' || r.ioMonths < r.term), ''],
      ['Interest reserve covers its months', ok(r.reserveMonths === 0 || s.intReserve > 0), ''],
      ['No sales or one-off items dated before the drawdown month', ok(!r.assets.some((a) => a.saleDate != null && a.saleDate < eomonth(r.drawdown, -1) + 1) && !r.adjustments.some((a) => a.eff === a.date && a.date < eomonth(r.drawdown, -1) + 1)), 'Earlier dates are booked in month 1 (the drawdown month)'],
      ['Adjustment amounts positive', ok(r.adjustments.every((a) => a.raw >= 0)), 'Type sets the sign'],
    ];
    s.flags = s.checks.filter((c) => c[1] === 'CHECK').length;
    return s;
  }

  function annualise(rows) {
    const by = new Map();
    for (const x of rows) {
      if (!by.has(x.year)) by.set(x.year, { year: x.year, revenue: 0, opex: 0, extraInc: 0, extraExp: 0, capex: 0, ebitda: 0, tax: 0, cfads: 0, netSale: 0, draw: 0, interest: 0, intCash: 0, principal: 0, fees: 0, gain: 0, pshare: 0, otherDebt: 0, ncf: 0, cash: 0, close: 0, minDscr: null, maxLtv: null, cf: 0, ds: 0 });
      const y = by.get(x.year);
      for (const k of ['revenue', 'opex', 'extraInc', 'extraExp', 'capex', 'ebitda', 'tax', 'cfads', 'netSale', 'draw', 'interest', 'intCash', 'principal', 'gain', 'pshare', 'otherDebt', 'ncf']) y[k] += x[k] || 0;
      y.fees += (x.prepay || 0) + (x.exit || 0) + (x.commit || 0) + (x.extFee || 0) + (x.drawFee || 0);
      y.cash = x.cash; y.close = x.close;
      if (x.active) { y.cf += x.cfads; y.ds += x.ds || 0; }
      if (x.dscr != null && x.active) y.minDscr = y.minDscr == null ? x.dscr : Math.min(y.minDscr, x.dscr);
      if (x.ltv != null) y.maxLtv = y.maxLtv == null ? x.ltv : Math.max(y.maxLtv, x.ltv);
    }
    for (const y of by.values()) y.dscrYear = y.ds > 0 ? y.cf / y.ds : null;
    return [...by.values()];
  }

  // ---------- break-evens (bisection on one stress driver) ----------
  function bisect(f, lo, hi, it = 30) { // f(lo) true (passes), find max x in [lo,hi] where f true
    if (!f(lo)) return { value: lo, failsAtBase: true };
    if (f(hi)) return { value: hi, beyond: true };
    for (let i = 0; i < it; i++) { const mid = (lo + hi) / 2; if (f(mid)) lo = mid; else hi = mid; }
    return { value: lo };
  }
  function breakEvens(project) {
    const R = resolve(project);
    const runS = (dev) => run(project, dev, { resolved: R }).summary;
    const base = runS({});
    const d12 = (s) => (s.dscrTest == null ? Infinity : s.dscrTest);
    const out = {};
    if (base.dscrTest != null) {
      out.revDscr1 = bisect((x) => d12(runS({ rev: -x })) >= 1, 0, 1);
      out.revDscrMin = bisect((x) => d12(runS({ rev: -x })) >= R.minDSCR, 0, 1);
      out.rateDscr1 = bisect((x) => d12(runS({ rate: x })) >= 1, 0, 0.5);
    }
    out.revCash = bisect((x) => runS({ rev: -x }).lowCashPre >= 0, 0, 1);
    if (R.assets.some((a) => a.salePrice != null)) out.saleExit = bisect((x) => runS({ salePrice: -x }).cashAtMaturity >= 0, 0, 1);
    out.valueForced100 = base.fs0 > 0 ? 1 - base.facility / base.fs0 : null;
    out.valueMaxLTV = base.mkt0 > 0 && R.maxLTV > 0 ? 1 - base.facility / (R.maxLTV * base.mkt0) : null;
    out.headroom = base.headroom;
    return out;
  }

  return { run, resolve, breakEvens, opMonth, num, pct, blank, parseDate, fmtDate, eomonth, edate, monthMask, REPAY, ZERO_DEV, irrMonthly };
})();
if (typeof module !== 'undefined') module.exports = Engine;

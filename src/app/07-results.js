// Summary and Cash flow tabs.
// ---- Summary (v3.25): one story, top to bottom – what we lend, how well it is secured, how it is repaid, the borrower's
// liquidity and what InRento earns. Each section opens with a one-line answer; rows that do not apply to the deal are left out.
function tabSummary() {
  const m = S.model, constr = m && m.r.constr;
  const sec = (n, t, out, extra = '') => `<section class="card sm-sec"><div class="sm-h"><span class="sm-n">${n}</span><h2>${t}</h2></div><div class="sm-ans" data-out="${out}-a"></div><div class="sm-body" data-out="${out}"></div>${extra}</section>`;
  return `<div class="card" id="mcheck" style="margin-bottom:16px"><h3>Model check</h3><div class="sub" style="margin:-4px 0 10px">Mistakes in how the model is built: dates, missing values, double counting, typos. Fix buttons can be undone with ⌘Z.</div><div data-out="mcheck"></div></div>${m && m.summary.loans ? '<div class="card" style="margin-bottom:16px"><h3>Loans</h3><div data-out="loans"></div></div>' : ''}
  <div class="stack">
    ${sec(1, 'What we lend', 'sm1', `<div class="sm-sub"><div class="suh">Sources and uses at drawdown</div><div data-out="su"></div></div>${constr ? '<div class="sm-sub"><div class="suh">Construction</div><div data-out="works"></div></div>' : ''}`)}
    ${sec(2, 'How well it is secured', 'sm2', '<div class="legend" id="lg-sec" style="margin-top:12px"></div><div class="chart" id="ch-sec"></div>')}
    ${sec(3, 'How it is repaid', 'sm3')}
    ${sec(4, 'Borrower liquidity', 'sm4', `${m && usesDscr(m) ? '<div class="sm-sub"><div class="suh">Debt service</div><div data-out="ds"></div></div>' : ''}<div class="legend" id="lg-cash" style="margin-top:12px"></div><div class="chart" id="ch-cash"></div>`)}
    ${sec(5, 'What InRento earns', 'sm5')}
    <details class="card sm-tests"><summary><b>Credit tests</b> <span class="sub">– information, not warnings</span></summary><div data-out="flags" style="margin-top:10px"></div></details>
  </div>`;
}
// the month a ratio peaks (ignores the months after the loan is repaid)
function peakOf(m, key) { let best = null; for (const x of m.rows) if (x[key] != null && x.close > 0.005 && (!best || x[key] > best[key])) best = x; return best; }
const smAns = (t) => `<p>${t}</p>`;
OUT['sm1-a'] = () => { const s = S.model.summary, r = S.model.r; const pp = (v) => `${+(v * 100).toFixed(2)}%`;
  return smAns(`<b>${money(s.facility)}</b> for ${r.termBase} months at ${pp(r.rate)}${r.gain ? ` + ${pp(r.gain)} capital gain` : ''} p.a., ${esc(String(r.repay || 'bullet').toLowerCase())}${r.tranchesOn ? `; ${money(s.draw0)} paid out at drawdown, the rest in ${s.tranches - 1} more tranche${s.tranches > 2 ? 's' : ''}` : ''}.`); };
OUT.sm1 = () => { const s = S.model.summary, r = S.model.r;
  return `<div class="sm-kv">${kv(r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), { tr: 'facility' })}${r.tranchesOn ? kv('Paid out at drawdown', money(s.draw0)) : ''}${kv('Interest rate', pctf(r.rate, 2))}${r.gain ? kv('Capital gain', pctf(r.gain, 2) + ' p.a.') : ''}${kv('Term', r.termBase + ' months' + (r.extOn ? ` + ${r.extMonths} extension` : ''))}${kv('Repayment', esc(r.repay || ''))}${kv('Drawdown', datef(r.drawdown))}${kv('Maturity', datef(s.maturity), { tr: 'maturity' })}${s.reserveAmt ? kv('Interest reserve withheld', money(s.reserveAmt)) : ''}</div>`; };
OUT['sm2-a'] = () => { const s = S.model.summary, r = S.model.r, m = S.model, pk = peakOf(m, 'ltvFs');
  if (!(s.mkt0 > 0)) return smAns('No collateral value entered yet.');
  const drawn = r.tranchesOn && s.draw0 < s.facility - 1 ? ` (${pctf(s.draw0 / s.mkt0)} on the amount drawn at drawdown)` : '';
  return smAns(`LTV <b>${pctf(s.ltv0)}</b> at drawdown on the full facility${drawn}. Forced-sale LTV <b class="${pk && pk.ltvFs > 1 ? 'bad-t' : ''}">${pk ? pctf(pk.ltvFs) : pctf(s.ltvFs0)}</b> at its weakest${pk ? `, in ${datef(pk.date)}` : ''}${pk && pk.ltvFs > 1 ? ' – a forced sale then would not cover the loan' : ''}.`); };
OUT.sm2 = () => { const s = S.model.summary, r = S.model.r, m = S.model, lc = (v) => (v != null && v > r.maxLTV ? 'bad-t' : ''), pk = peakOf(m, 'ltv'), pf = peakOf(m, 'ltvFs');
  return `<div class="sm-kv">${kv('Collateral market value', money(s.mkt0), { tr: 'mkt0' })}${kv(`Forced-sale value (after haircuts)`, money(s.fs0), { tr: 'fs0' })}
    ${kv('LTV at drawdown (full facility)', pctf(s.ltv0), { tr: 'ltv0', c: lc(s.ltv0) })}${kv('Forced-sale LTV at drawdown', pctf(s.ltvFs0), { tr: 'ltvFs0', c: s.ltvFs0 > 1 ? 'bad-t' : '' })}
    ${kv('Highest LTV during the loan', pk ? `${pctf(pk.ltv)} <span class="sub">${datef(pk.date)}</span>` : '–', { c: lc(pk && pk.ltv) })}${kv('Highest forced-sale LTV', pf ? `${pctf(pf.ltvFs)} <span class="sub">${datef(pf.date)}</span>` : '–', { c: pf && pf.ltvFs > 1 ? 'bad-t' : '' })}
    ${pk && r.maxLTV > 0 ? kv(`Value can fall before the LTV limit (${mgMonth(pk.date)})`, pctf(ltvRoom(pk.ltv, r.maxLTV)), { c: ltvRoom(pk.ltv, r.maxLTV) < 0.1 ? 'bad-t' : '' }) : ''}${kv('Value can fall before a loss', pctf(s.headroom), { tr: 'headroom', c: s.headroom != null && s.headroom < 0.1 ? 'bad-t' : '' })}${kv(`Policy maximum loan (${pctf(r.maxLTV, 0)} LTV${r.targetCover ? ' / coverage' : ''})`, money(s.sizeMax), { tr: 'sizeMax' })}
    ${s.sizeMax != null ? kv('Facility vs policy maximum', s.facility > s.sizeMax + 1 ? `over by ${money(s.facility - s.sizeMax)}` : `within, ${money(s.sizeMax - s.facility)} to spare`, { c: s.facility > s.sizeMax + 1 ? 'bad-t' : '' }) : ''}</div>`; };
OUT['sm3-a'] = () => { const s = S.model.summary, r = S.model.r, a = dealAtMat(s, r), T = mgTests(r), ok = T.repay(s);
  const src = [['unit sales', s.viaSweep], ['cash sweep from operations', s.viaOpSweep], [a.refi ? 'a bank refinancing at maturity' : 'the borrower at maturity', s.viaSched]].filter((x) => x[1] > 1).sort((x, y) => y[1] - x[1]);
  const from = src.length ? ` mainly from ${src[0][0]}` : '';
  if (!ok) return smAns(`<b class="bad-t">Not repaid by maturity</b> (${datef(s.maturity)}): <b class="bad-t">${money(Math.max(0, -a.v))}</b> still owed${a.refi ? ' after the bank refinancing' : ''}.`);
  return smAns(`Repaid <b>${s.repaidDate ? datef(s.repaidDate) : 'at maturity'}</b>${from}; maturity ${datef(s.maturity)}. The borrower keeps <b>${money(a.v)}</b> at maturity.`); };
OUT.sm3 = () => { const s = S.model.summary, r = S.model.r, a = dealAtMat(s, r);
  const parts = [['Unit sales', s.viaSweep, 'var(--s1)'], ['Cash sweep from operations', s.viaOpSweep, 'var(--s3)'], [a.refi ? 'Final payment at maturity (bank refinancing)' : 'Borrower at maturity / scheduled', s.viaSched, 'var(--s2)']].filter((x) => x[1] > 1);
  const tot = parts.reduce((t, x) => t + x[1], 0);
  const bar = tot > 0 ? `<div class="sm-bar">${parts.map((x) => `<i style="width:${(x[1] / tot * 100).toFixed(1)}%;background:${x[2]}" title="${esc(x[0])} ${money(x[1])}"></i>`).join('')}</div><div class="legend">${parts.map((x) => `<span><i class="sw" style="background:${x[2]}"></i>${esc(x[0])} ${money(x[1])} · ${Math.round(x[1] / tot * 100)}%</span>`).join('')}</div>` : '';
  return `${bar}<div class="sm-kv">${kv('Loan fully repaid', s.repaidDate ? datef(s.repaidDate) : '<span class="bad-t">not repaid</span>', { tr: 'repaidDate' })}${kv('Maturity', datef(s.maturity), { tr: 'maturity' })}
    ${s.capitalised > 1 ? kv('Interest capitalised', money(s.capitalised), { tr: 'capitalised' }) : ''}${s.owedAtExit > 1 ? kv('Owed at maturity (before the final payment)', money(s.owedAtExit)) : ''}
    ${r.refiLTV ? kv(`Bank refinancing at ${pctf(r.refiLTV, 0)} LTV`, money(s.refiMax), { tr: 'refiMax' }) + kv('Pay-down needed to refinance', s.paydown == null ? '–' : money(s.paydown), { tr: 'paydown', c: s.paydown > 1 ? 'bad-t' : '' }) : ''}
    ${r.exitCap && usesDscr(S.model) ? kv('Exit value (lower of income value and collateral)', money(s.exitValue)) + kv('Exit LTV', pctf(s.exitLTV), { tr: 'exitLTV' }) : ''}
    ${kv(a.refi ? 'Cash at maturity (incl. refinancing)' : 'Cash at maturity after repayment', money(a.v), { tr: a.refi ? '' : 'cashAtMaturity', c: a.v < -1 ? 'bad-t' : '' })}</div>`; };
OUT['sm4-a'] = () => { const s = S.model.summary, m = S.model, neg = m.rows.filter((x) => x.p > 0 && x.date < s.maturity && x.cash < -1).length;
  return s.lowCashPre < -1 ? smAns(`The borrower runs <b class="bad-t">${money(-s.lowCashPre)}</b> short before maturity, lowest in ${datef(s.lowCashPreDate)}; ${neg} month${neg === 1 ? '' : 's'} below zero.`)
    : smAns(`Borrower cash never goes negative before maturity; lowest <b>${money(s.lowCashPre)}</b>${s.lowCashPreDate ? ` in ${datef(s.lowCashPreDate)}` : ''}.`); };
OUT.sm4 = () => { const s = S.model.summary, m = S.model, neg = m.rows.filter((x) => x.p > 0 && x.date < s.maturity && x.cash < -1).length;
  return `<div class="sm-kv">${kv('Lowest cash before maturity', money(s.lowCashPre), { tr: 'lowCashPre', c: s.lowCashPre < -1 ? 'bad-t' : '' })}${kv('Months below zero before maturity', String(neg), { c: neg ? 'bad-t' : '' })}${kv('Cash needed to avoid a shortfall', money(s.reserveNeed), { tr: 'reserveNeed', c: s.reserveNeed > 1 ? 'bad-t' : '' })}${s.intReserve > 1 ? kv('Interest paid from the reserve', money(s.intReserve), { tr: 'intReserve' }) : ''}</div>`; };
OUT['sm5-a'] = () => { const s = S.model.summary; return smAns(`<b>${money(feeOf(s))}</b> arrangement fee${s.facility > 0 ? ` (${pctf(feeOf(s) / s.facility, 1)} of the facility)` : ''}. Interest and capital gain go to the investors.`); };
OUT.sm5 = () => { const s = S.model.summary, r = S.model.r, later = feeOf(s) - (s.fee0 || 0);
  return `<div class="sm-kv">${kv('Arrangement fee', money(feeOf(s)), { tr: 'arrFeeAmt' })}${later > 1 ? kv('of which at drawdown', money(s.fee0), { ind: 1 }) + kv('of which on later tranches', money(later), { ind: 1 }) : ''}${kv('Fee is', r.feeCap ? 'capitalised (added to the loan)' : 'withheld from the payout')}</div>`; };
const kv = (k, v, o = {}) => `<div class="kv ${o.tot ? 'tot' : ''}"><span class="k ${o.ind ? 'ind' : ''}">${k}</span><span class="v ${o.c || ''}"${o.tr ? ` data-tr="m:${o.tr}"` : ''}>${v}</span></div>`; // tr: summary key explained by Trace
const note = (t) => `<div class="note" style="margin-top:6px">${t}</div>`;
OUT.works = () => { const s = S.model.summary, c = S.model.r.constr; if (!c) return ''; return kv('Total cost of the works', money(s.worksTotal), { tr: 'worksTotal' }) + kv('Spent before drawdown', money(s.worksSpent), { ind: 1 }) + kv('Cost to complete incl. contingency', money(s.worksToComplete), { ind: 1, tr: 'worksToComplete' }) + kv('Works done at drawdown', pctf(s.progress0), { tr: 'progress0' }) + kv('Completion', datef(s.completion)) + kv('Borrower equity used for the works', money(s.worksEquity), { tr: 'worksEquity' }) + kv('Lowest borrower cash during the works', money(s.lowCashWorks), { c: s.lowCashWorks < 0 ? 'bad-t' : '', tr: 'lowCashWorks' }) + note(`Spend: ${{ even: 'even per month', scurve: 'S-curve', manual: 'monthly schedule' }[c.curve]}. Collateral credit for progress ${pctf(c.credit, 0)}. ${S.model.r.progressMode ? 'Tranches released against progress.' : 'Tranches on their dates.'}`); };
OUT.ds = () => { const s = S.model.summary, r = S.model.r; const b = (v) => (v != null && v < r.minDSCR ? 'bad-t' : ''); return kv('Minimum DSCR, rolling 12 months', xf(s.minDscr12), { tr: 'minDscr12', c: r.dscrBasis === 'rolling12' ? b(s.minDscr12) : '' }) + kv('Minimum DSCR, single month', xf(s.minDscr), { tr: 'minDscr', c: r.dscrBasis === 'monthly' ? b(s.minDscr) : '' }) + kv('Average monthly DSCR', xf(s.avgDscr), { tr: 'avgDscr' }) + kv(`Months with DSCR below ${r.minDSCR}×`, s.dscrBreaches) + kv('Minimum interest cover (ICR)', xf(s.minIcr), { tr: 'minIcr' }) + kv('Lowest cash before exit', money(s.lowCashPre), { tr: 'lowCashPre', c: s.lowCashPre < 0 ? 'bad-t' : '' }) + kv('Liquidity reserve needed', money(s.reserveNeed), { tr: 'reserveNeed', tot: 1, c: s.reserveNeed > 0 ? 'bad-t' : '' }) + kv('Lowest cash incl. final repayment', money(s.lowCash), { tr: 'lowCash', c: s.lowCash < 0 ? 'bad-t' : '' }) + kv('Cash at end of horizon', money(s.endCash), { tr: 'endCash' }) + note('DSCR = CFADS / (cash interest due + scheduled principal + other debt). Final bullet or balloon excluded. The test uses the basis set on Inputs 6.'); };

// ---- Cash flow
const CF_COLS = [
  ['Timing', [['date', 'Month end', 'd']]],
  ['Business', [['revenue', 'Revenue'], ['opex', 'Operating expenses'], ['extraInc', 'Extra income'], ['extraExp', 'Extra expenses'], ['ebitda', 'EBITDA'], ['tax', 'Tax'], ['cfads', 'CFADS']]],
  ['Asset sales', [['saleColl', 'Sales – collateral'], ['saleOther', 'Sales – other'], ['sellCosts', 'Selling costs'], ['netSale', 'Net sale proceeds']]],
  ['InRento loan', [['draw', 'Drawn'], ['drawFee', 'Fee paid'], ['open', 'Opening balance'], ['interest', 'Interest accrued'], ['capitalised', 'Interest capitalised'], ['intReserve', 'Paid from reserve'], ['intCash', 'Interest paid by borrower'], ['deferred', 'Deferred interest (balance)'], ['sweep', 'Repaid from sales'], ['opSweep', 'Cash sweep'], ['sched', 'Scheduled principal'], ['close', 'Closing balance'], ['undrawn', 'Undrawn'], ['commit', 'Commitment fee'], ['extFee', 'Extension fee'], ['prepay', 'Prepayment fee'], ['exit', 'Exit fee'], ['gain', 'Capital gain / catch-up'], ['pshare', 'Profit share']]],
  ['Reserve', [['resClose', 'Reserve balance'], ['resRelease', 'Reserve released']]],
  ['Borrower cash', [['capex', 'Capex (not in DSCR)'], ['otherDebt', 'Other debt service'], ['toInRento', 'Total paid to InRento'], ['ncf', 'Net cash flow'], ['cash', 'Cash balance']]],
  ['Construction', [['works', 'Construction costs'], ['worksEq', 'Equity for the works'], ['worksVat', 'VAT on costs'], ['worksVatBack', 'VAT refunded'], ['progress', 'Works done', 'p']]],
  ['Credit metrics', [['collMkt', 'Collateral (market)'], ['ltv', 'LTV market', 'p'], ['ltvFs', 'LTV lending value', 'p'], ['dscr', 'DSCR month', 'x'], ['dscr12', 'DSCR 12 m', 'x'], ['icr', 'ICR', 'x']]],
  ['Lender', [['lenderCF', 'InRento / investor cash flow']]],
];
const ANN_COLS = [['revenue', 'Revenue'], ['opex', 'Operating expenses'], ['extraInc', 'Extra income'], ['extraExp', 'Extra expenses'], ['ebitda', 'EBITDA'], ['tax', 'Tax'], ['cfads', 'CFADS'], ['netSale', 'Net sale proceeds'], ['capex', 'Capex'], ['draw', 'Loan drawn'], ['interest', 'Interest accrued'], ['intCash', 'Interest paid'], ['principal', 'Principal repaid'], ['fees', 'Fees'], ['gain', 'Capital gain / catch-up'], ['pshare', 'Profit share'], ['otherDebt', 'Other debt service'], ['ncf', 'Borrower net cash flow'], ['cash', 'Year-end cash'], ['close', 'Year-end loan balance'], ['dscrYear', 'DSCR (year)', 'x'], ['minDscr', 'Min monthly DSCR', 'x'], ['maxLtv', 'Max LTV', 'p']];
function tabCashflow() {
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div><h2>Cash flow</h2><div class="sub">Row 0 = the drawdown itself; month 1 is the drawdown month, so sales, income and costs dated in it (including on the drawdown date) appear in month 1. Interest = opening balance × rate / 12. Sales and adjustments at month end. Empty columns are hidden.</div></div>
    <div class="row"><div class="seg" role="group" aria-label="Period"><button data-cf="monthly" aria-pressed="${S.cfMode === 'monthly'}">Monthly</button><button data-cf="annual" aria-pressed="${S.cfMode === 'annual'}">Annual</button></div>${S.model && S.model.r.loans && S.cfMode !== 'annual' ? `<button class="btn" data-act="cf-loans" aria-pressed="${!!S.cfLoans}">${S.cfLoans ? 'Hide each loan' : 'Show each loan'}</button>` : ''}<button class="btn" data-act="export-csv">Download CSV</button></div></div>
    <div class="tblwrap cf" data-out="cftable"></div>
    <div class="card" style="margin-top:16px"><h3>Monthly borrower net cash flow</h3><div class="chart" id="ch-ncf"></div></div>
    <div class="card" style="margin-top:16px"><h3>Borrower net cash flow by calendar year, per scenario</h3><div class="tblwrap" data-out="sensyr"></div></div>
    <div class="card" style="margin-top:16px"><h3>Borrower cash balance at year end, per scenario</h3><div class="tblwrap" data-out="sensye"></div></div>`;
}
function fmtCell(v, t) {
  if (t === 'd') return datef(v);
  if (v == null || (typeof v === 'number' && !isFinite(v))) return '';
  if (t === 'p') return pctf(v); if (t === 'x') return v.toFixed(2);
  return plain(v);
}
OUT.cftable = () => {
  const m = S.model;
  if (S.cfMode === 'annual') {
    return `<table><thead><tr><th>Year</th>${ANN_COLS.map((c) => `<th class="n">${c[1]}</th>`).join('')}</tr></thead><tbody>${m.annual.map((y) => `<tr><td>${y.year}</td>${ANN_COLS.map((c) => { const v = y[c[0]], tr = !['dscrYear', 'minDscr', 'maxLtv'].includes(c[0]) && fmtCell(v, c[2]) !== '' ? ` data-tr="y:${c[0]}:${y.year}"` : ''; return `<td class="n ${typeof v === 'number' && v < -0.5 && c[2] == null ? 'neg' : ''}"${tr}>${fmtCell(v, c[2])}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  }
  const keep = (c) => (c[2] && (c[0] !== 'progress' || m.r.constr)) || ['revenue', 'ebitda', 'cfads', 'open', 'interest', 'close', 'cash', 'ncf', 'lenderCF', 'collMkt'].includes(c[0]) || /^L\d+\./.test(c[0]) || m.rows.some((x) => Math.abs(x[c[0]] || 0) > 0.5);
  const lg = S.cfLoans ? loanCfGroups(m) : []; // several loans: each loan's columns right after the loan totals
  const groups = CF_COLS.flatMap((g) => (g[0] === 'InRento loan' ? [g, ...lg] : [g])).map(([g, cs]) => [g, cs.filter(keep)]).filter(([, cs]) => cs.length);
  const cols = groups.flatMap((g) => g[1]);
  const grp = `<tr class="grp"><th></th>${groups.map((g) => `<th colspan="${g[1].length}">${g[0]}</th>`).join('')}</tr>`;
  const head = `<tr><th>Period</th>${cols.map((c) => `<th class="n">${c[1]}</th>`).join('')}</tr>`;
  const T = m.r.term, TB = m.r.termBase;
  const body = m.rows.map((x) => `<tr class="${x.p === 0 ? 'r0' : x.p === T ? 'mat' : x.p === TB && TB !== T ? 'mat0' : ''}"><td class="n">${x.p}</td>${cols.map((c) => { const v = cfVal(x, c[0]), tr = c[2] !== 'd' && v != null ? ` data-tr="c:${c[0]}:${x.p}"` : ''; return `<td class="n ${typeof v === 'number' && v < -0.5 && !c[2] ? 'neg' : ''}"${tr}>${x.p === 0 && c[0] === 'date' ? `<span title="Drawdown date. Month 1 covers the rest of this month">Drawdown ${+String(E.fmtDate(v)).slice(8)} ${datef(v)}</span>` : fmtCell(v, c[2])}</td>`; }).join('')}</tr>`).join('');
  return `<table><thead>${grp}${head}</thead><tbody>${body}</tbody></table>`;
};

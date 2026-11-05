// Deal tab – the page a project opens on, made for the CEO: the proposed structure on the left (the same fields as Inputs,
// so a change here is a change there), results that apply to every deal type on the right, and the hand-built scenarios
// from Sensitivity as simple cards underneath. No new calculations: everything comes from the engine run and sensModel().
{ TABS.splice(0, 0, ['deal', 'Deal']); }
const DEAL_FIELDS = ['loan', 'rate', 'fixedGain', 'profitShare', 'arrFee', 'term', 'drawdown', 'repayType', 'reserveMonths', 'equity', 'saleRepay', 'sweepDefault', 'releasePct', 'haircut'];
function tabDeal() {
  const p = cur(), i = p.inputs;
  const FD = {}; for (const [, , fs] of INPUT_SECTIONS()) for (const f of fs) FD[f.k] = f;
  const sales = p.assets.some((a) => !E.blank(a.salePrice));
  const show = { loan: !i.tranchesOn, profitShare: !isDefault('profitShare', i.profitShare), saleRepay: sales, sweepDefault: sales && i.saleRepay !== 'release', releasePct: sales && i.saleRepay === 'release' };
  const fields = DEAL_FIELDS.filter((k) => FD[k] && show[k] !== false).map((k) => fieldHTML(FD[k], i, 'inputs.')).join('');
  const tr = i.tranchesOn ? `<div class="dl-sub"><div class="dl-h">Drawdown schedule</div><div class="tblwrap"><table class="grid-in"><thead><tr><th>Date</th><th class="n">Amount</th><th>Condition</th></tr></thead><tbody>
    ${p.tranches.map((t, k) => `<tr><td>${dateIn(`tranches.${k}.date`, t.date)}</td><td>${inp(`tranches.${k}.amount`, t.amount, 'money')}</td><td class="sub">${esc(t.label || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">No tranches yet.</td></tr>'}
    </tbody><tfoot><tr><td>Facility</td><td class="n" data-out="dl-trtot"></td><td></td></tr></tfoot></table></div></div>` : '';
  const desc = String(i.deckDesc || '').trim();
  return `<div class="dl-head"><div class="dl-sum">${desc ? esc(desc) : '<span class="sub">No description yet – add it on Overview → Committee deck.</span>'}</div>
      <div class="sub">${esc([p.borrower, p.projectType, typeLabel(typeOf(p))].filter(Boolean).join(' · '))}</div></div>
    <div class="dl-cols">
      <section class="card"><h2>Proposed structure</h2><div class="sub" style="margin-bottom:10px">Change any field – the results and scenarios update at once. Same fields as on Inputs.</div>
        ${ccyNote(p)}<div class="form dl-form">${fields}</div>${tr}</section>
      <section class="card"><h2>Results${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><div data-out="dealres"></div></section>
    </div>
    <section class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between;align-items:baseline"><h2>Scenarios${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><span class="sub">Built on Sensitivity · each reruns the whole monthly cash flow</span></div><div data-out="dealsc"></div></section>`;
}
// the drawdown table is typed in the project currency, so its total is too
OUT['dl-trtot'] = () => money((S.modelOrig || S.model).r.facility, baseCcy(cur()));
// cash left at maturity after repaying InRento; a bank refinancing (refinance LTV set) counts as a source, as in mgTests
function dealAtMat(s, r) { const T = mgTests(r), refi = T.refi && s.refiMax != null ? Math.min(s.refiMax, s.owedAtExit || 0) : 0; return { v: s.cashAtMaturity + refi, refi }; }
// outcome of one engine run in plain words – the same tests as the margin for error (mgTests)
function dealOutcome(s, r) {
  const T = mgTests(r), cash = T.cash(s), repay = T.repay(s);
  const short = Math.max(0, -(s.cashAtMaturity + (T.refi && s.refiMax != null ? Math.min(s.refiMax, s.owedAtExit || 0) : 0)));
  return !repay ? { tone: 'bad', txt: `Not repaid by maturity – ${money(short)} short` }
    : !cash ? { tone: 'warn', txt: `Repaid, but the borrower needs ${money(-s.lowCashPre)} extra by ${mgMonth(s.lowCashPreDate)}` }
    : { tone: 'good', txt: `Repaid ${s.repaidDate ? mgMonth(s.repaidDate) : 'at maturity'}, no cash shortfall` };
}
OUT.dealres = () => {
  const m = S.model, s = m.summary, r = m.r;
  const negPre = m.rows.filter((x) => x.p > 0 && x.date <= s.maturity && x.cash < -1).length;
  const lim = r.maxLTV, ltvT = (v) => (v == null ? '' : v > lim ? 'bad' : 'good');
  const it = (l, v, sub, tone = '', tr = '') => `<div class="dl-it"><div class="l">${l}</div><div class="v ${tone}"${tr ? ` data-tr="m:${tr}"` : ''}>${v}</div><div class="s">${sub}</div></div>`;
  const pp = (v) => `${+(v * 100).toFixed(2)}%`;
  return '<div class="dl-grid">' +
    it(r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), `${r.termBase} months · ${pp(r.rate)}${r.gain ? ` + ${pp(r.gain)}` : ''} p.a.${r.tranchesOn ? ` · ${money(s.draw0)} at drawdown` : ''}`, '', 'facility') +
    (s.netCash < -1 ? it('Funding gap at drawdown', money(-s.netCash), 'uses at drawdown are not covered by the loan and equity', 'bad', 'netCash') : '') +
    it('LTV at drawdown', s.mkt0 > 0 ? pctf(s.ltv0) : '–', s.mkt0 > 0 ? `full facility · ${r.tranchesOn ? `on the amount drawn ${pctf(s.draw0 / s.mkt0)} · ` : ''}max ${pctf(lim, 0)}` : 'no collateral value entered', ltvT(s.ltv0), 'ltv0') +
    it('Forced-sale LTV at drawdown', s.fs0 > 0 ? pctf(s.ltvFs0) : '–', `after the forced-sale haircut · collateral ${money(s.fs0)}`, ltvT(s.ltvFs0), 'ltvFs0') +
    it('Highest LTV during the loan', s.maxLtv == null ? '–' : pctf(s.maxLtv), s.maxLtvFs == null ? '' : `forced sale ${pctf(s.maxLtvFs)}`, ltvT(s.maxLtv), 'maxLtv') +
    it('Borrower cash before maturity', s.lowCashPre < -1 ? money(s.lowCashPre) : 'Never negative', s.lowCashPre < -1 ? `lowest in ${mgMonth(s.lowCashPreDate)} · ${negPre} month${negPre === 1 ? '' : 's'} below zero` : `lowest ${money(s.lowCashPre)}${s.lowCashPreDate ? ` in ${mgMonth(s.lowCashPreDate)}` : ''}`, s.lowCashPre < -1 ? 'bad' : 'good', 'lowCashPre') +
    (() => { const a = dealAtMat(s, r); return it('Cash at maturity', money(a.v), `after repaying InRento in full${a.refi ? ` · incl. bank refinancing ${money(a.refi)}` : ''} · maturity ${mgMonth(s.maturity)}`, a.v < -1 ? 'bad' : 'good', a.refi ? '' : 'cashAtMaturity'); })() +
    it('Collateral buffer', s.headroom == null ? '–' : pctf(s.headroom), 'how far collateral value can fall before it no longer covers loan + interest + selling costs', s.headroom == null ? '' : s.headroom < 0.1 ? 'bad' : s.headroom < 0.2 ? 'warn' : 'good', 'headroom') +
    it('InRento profit', money(s.profit), `IRR ${pctf(s.irr, 1)}`, '', 'profit') + '</div>';
};
// borrower cash month by month until maturity (the final repayment itself is the 'cash at maturity' number)
function dealSpark(rows, mat, tone) {
  const v = rows.filter((x) => x.date < mat).map((x) => x.cash), n = v.length; if (n < 2) return '';
  const lo = Math.min(0, ...v), hi = Math.max(0, ...v), H = 44, W = 240, y = (c) => (hi === lo ? H / 2 : 2 + (H - 4) * (hi - c) / (hi - lo)), x = (k) => (W * k) / (n - 1);
  return `<svg class="dl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="z"/><polyline class="${tone}" points="${v.map((c, k) => `${x(k).toFixed(1)},${y(c).toFixed(1)}`).join(' ')}"/></svg>`;
}
OUT.dealsc = () => {
  const p = cur(), { scen } = sensModel(), r = S.model.r; if (!scen.length) return '';
  const sig = (s) => JSON.stringify([s.lowCashPre, s.cashAtMaturity, s.repaidDate, s.maxLtv, s.profit].map((v) => (v == null ? null : +(+v).toFixed(2))));
  const base = sig(scen[0].res.summary), shown = scen.filter((x, k) => k === 0 || sig(x.res.summary) !== base), same = scen.length - shown.length;
  const what = (j) => { const sc = p.scenarios[j] || {}; return driversOf(p).map((d) => { const v = E.num(sc[d.k]); if (!v) return ''; return `${d.label} ${v > 0 ? '+' : '−'}${Math.abs(v)}${d.unit === '%' ? '%' : ' ' + (d.unit === 'mo' ? 'months' : d.unit)}`; }).filter(Boolean).join(' · ') || 'the plan as entered'; };
  const card = (x) => { const s = x.res.summary, o = dealOutcome(s, r), j = scen.indexOf(x);
    return `<div class="dl-sc ${o.tone}"><div class="dl-sch"><b>${esc(x.name)}</b><span class="dl-dot ${o.tone}"></span></div><div class="sub dl-what">${esc(what(j))}</div>
      <div class="dl-sco ${o.tone}">${esc(o.txt)}</div>${dealSpark(x.res.rows, s.maturity, o.tone)}<div class="dl-spl"><span>Borrower cash until maturity · grey line = zero</span></div>
      <div class="dl-scn"><div><span class="l">Lowest cash</span><span class="${s.lowCashPre < -1 ? 'bad' : ''}">${money(s.lowCashPre)}</span></div>${(() => { const a = dealAtMat(s, r); return `<div><span class="l">Cash at maturity${a.refi ? ' (incl. refi)' : ''}</span><span class="${a.v < -1 ? 'bad' : ''}">${money(a.v)}</span></div>`; })()}<div><span class="l">Highest LTV</span><span class="${s.maxLtv > r.maxLTV ? 'bad' : ''}">${s.maxLtv == null ? '–' : pctf(s.maxLtv)}</span></div></div></div>`; };
  return `<div class="dl-scs">${shown.map(card).join('')}</div>${same ? `<div class="sub" style="margin-top:8px">${same} scenario${same > 1 ? 's' : ''} not shown – same result as ${esc(scen[0].name)} on this deal (they move drivers the deal does not have).</div>` : ''}`;
};

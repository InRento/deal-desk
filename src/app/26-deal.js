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
      <div class="stack"><section class="card"><h2>Results${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><div data-out="dealres"></div></section>${dealBR(p)}</div>
    </div>
    <section class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between;align-items:baseline"><h2>Scenarios${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><span class="sub">Built on Sensitivity · each reruns the whole monthly cash flow</span></div><div data-out="dealsc"></div></section>`;
}
// the drawdown table is typed in the project currency, so its total is too
OUT['dl-trtot'] = () => money((S.modelOrig || S.model).r.facility, baseCcy(cur()));
// main benefits and risks: the committee-deck text from Overview, one point per line
const brItems = (t) => String(t || '').split(/\n+/).map((x) => x.replace(/^\s*(?:[-–•*·]|\d+[.)])\s*/, '').trim()).filter(Boolean);
function dealBR(p) {
  const list = (t, cls) => { const l = brItems(t); return l.length ? `<ul class="dl-br ${cls}">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="sub">Not written yet.</div>'; };
  return `<section class="card"><div class="row" style="justify-content:space-between;align-items:baseline"><h2>Benefits and risks</h2><button class="btn sm ghost" data-tab="overview" title="Written on Overview → Committee deck, one point per line">Edit</button></div>
    <div class="dl-brcols"><div><div class="dl-h good-t">Main benefits</div>${list(p.inputs.benefits, 'good')}</div><div><div class="dl-h bad-t">Main risks</div>${list(p.inputs.risks, 'bad')}</div></div></section>`;
}
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
  const negPre = m.rows.filter((x) => x.p > 0 && x.date < s.maturity && x.cash < -1).length;
  const lim = r.maxLTV, ltvT = (v) => (v == null ? '' : v > lim ? 'bad' : 'good');
  const it = (l, v, sub, tone = '', tr = '') => `<div class="dl-it"><div class="l">${l}</div><div class="v ${tone}"${tr ? ` data-tr="m:${tr}"` : ''}>${v}</div><div class="s">${sub}</div></div>`;
  const pk = peakOf(m, 'ltv'), a = dealAtMat(s, r), fee = feeOf(s);
  return '<div class="dl-grid">' +
    it(r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), r.tranchesOn && s.draw0 < s.facility - 1 ? `${mgK(s.draw0)} at drawdown` : '', '', 'facility') +
    (s.netCash < -1 ? it('Funding gap at drawdown', money(-s.netCash), 'not covered by loan and equity', 'bad', 'netCash') : '') +
    it('LTV at drawdown', s.mkt0 > 0 ? pctf(s.ltv0) : '–', s.mkt0 > 0 ? [r.tranchesOn && s.draw0 < s.facility - 1 ? `${pctf(s.draw0 / s.mkt0)} on the amount drawn` : '', `limit ${pctf(lim, 0)}`].filter(Boolean).join(' · ') : 'no collateral value yet', ltvT(s.ltv0), 'ltv0') +
    it('Forced-sale LTV at drawdown', s.fs0 > 0 ? pctf(s.ltvFs0) : '–', s.fs0 > 0 ? `after a ${pctf(r.haircut, 0)} haircut` : '', ltvT(s.ltvFs0), 'ltvFs0') +
    it('Highest LTV', pk ? pctf(pk.ltv) : '–', pk ? `${mgMonth(pk.date)} · forced sale ${pctf(pk.ltvFs)}` : '', ltvT(pk && pk.ltv), 'maxLtv') +
    it('Borrower cash before maturity', s.lowCashPre < -1 ? money(s.lowCashPre) : 'Never negative', s.lowCashPre < -1 ? `${mgMonth(s.lowCashPreDate)} · ${negPre} month${negPre === 1 ? '' : 's'} below zero` : s.lowCashPreDate ? `lowest ${mgK(s.lowCashPre)} · ${mgMonth(s.lowCashPreDate)}` : '', s.lowCashPre < -1 ? 'bad' : 'good', 'lowCashPre') +
    it('Cash at maturity', money(a.v), `${mgMonth(s.maturity)}${a.refi ? ' · incl. bank refinancing' : ''}`, a.v < -1 ? 'bad' : 'good', a.refi ? '' : 'cashAtMaturity') +
    it('Collateral buffer', s.headroom == null ? '–' : pctf(s.headroom), 'incl. interest and selling costs', s.headroom == null ? '' : s.headroom < 0.1 ? 'bad' : s.headroom < 0.2 ? 'warn' : 'good', 'headroom') +
    it('InRento fee', money(fee), s.facility > 0 ? `${pctf(fee / s.facility, 1)} of the facility` : '', '', 'arrFeeAmt') + '</div>';
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
  const card = (x) => { const s = x.res.summary, o = dealOutcome(s, r), j = scen.indexOf(x);
    return `<div class="dl-sc ${o.tone}"><div class="dl-sch"><b>${esc(x.name)}</b><span class="dl-dot ${o.tone}"></span></div><div class="sub dl-what">${esc(scWhat(p, j))}</div>
      <div class="dl-sco ${o.tone}">${esc(o.txt)}</div>${dealSpark(x.res.rows, s.maturity, o.tone)}<div class="dl-spl"><span>Borrower cash until maturity · grey line = zero</span></div>
      <div class="dl-scn"><div><span class="l">Lowest cash</span><span class="${s.lowCashPre < -1 ? 'bad' : ''}">${money(s.lowCashPre)}</span></div>${(() => { const a = dealAtMat(s, r); return `<div><span class="l">Cash at maturity${a.refi ? ' (incl. refi)' : ''}</span><span class="${a.v < -1 ? 'bad' : ''}">${money(a.v)}</span></div>`; })()}<div><span class="l">Highest LTV</span><span class="${s.maxLtv > r.maxLTV ? 'bad' : ''}">${s.maxLtv == null ? '–' : pctf(s.maxLtv)}</span></div></div></div>`; };
  return `<div class="dl-scs">${shown.map(card).join('')}</div>${same ? `<div class="sub" style="margin-top:8px">${same} scenario${same > 1 ? 's' : ''} not shown – same result as ${esc(scen[0].name)} on this deal (they move drivers the deal does not have).</div>` : ''}`;
};

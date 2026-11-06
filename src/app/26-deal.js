// Deal tab – the page a project opens on, made for the CEO: the proposed structure on the left (read only – the CEO
// asks for changes and the analyst makes them on Inputs), results that apply to every deal type on the right, and the hand-built scenarios
// from Sensitivity as simple cards underneath. No new calculations: everything comes from the engine run and sensModel().
{ TABS.splice(0, 0, ['deal', 'Deal']); }
const DEAL_FIELDS = ['loan', 'rate', 'fixedGain', 'profitShare', 'arrFee', 'term', 'drawdown', 'repayType', 'reserveMonths', 'equity', 'saleRepay', 'sweepDefault', 'releasePct', 'haircut'];
// shorter labels than on Inputs, for a reader who does not build the model
const DEAL_LBL = { loan: 'Loan amount', rate: 'Interest rate (a year)', fixedGain: 'Capital gain to investors (a year)', profitShare: 'Profit share to investors', arrFee: 'Arrangement fee', term: 'Term', drawdown: 'Drawdown', repayType: 'Repayment', reserveMonths: 'Interest reserve', equity: 'Borrower equity at drawdown', saleRepay: 'Sales repay the loan by', sweepDefault: 'Share of each sale paid to the loan', releasePct: 'Release price (of allocated loan)', haircut: 'Forced-sale haircut' };
const DEAL_OPT = ['fixedGain', 'profitShare', 'reserveMonths', 'equity'];
function tabDeal() {
  const p = cur(), i = p.inputs;
  const FD = {}; for (const [, , fs] of INPUT_SECTIONS()) for (const f of fs) FD[f.k] = f;
  const sales = p.assets.some((a) => !E.blank(a.salePrice));
  const show = { loan: !i.tranchesOn, profitShare: !isDefault('profitShare', i.profitShare), saleRepay: sales, sweepDefault: sales && i.saleRepay !== 'release', releasePct: sales && i.saleRepay === 'release' };
  const nil = (k) => E.blank(i[k]) || (DEAL_OPT.includes(k) && !E.num(i[k])); // optional terms left out when not used
  const b = baseCcy(p), fields = DEAL_FIELDS.filter((k) => FD[k] && show[k] !== false && !(FD[k].hideIf && FD[k].hideIf(i)) && !nil(k)).map((k) => `<div class="dl-kv"><span>${esc(DEAL_LBL[k] || FD[k].label)}</span><b>${esc(dealVal(FD[k], i[k], b))}</b></div>`).join('');
  const dd = (v) => { const d = E.parseDate(v); return d == null ? 'no date' : datef(d); };
  const tr = i.tranchesOn ? `<div class="dl-sub"><div class="dl-h">Drawdown schedule</div><div class="tblwrap"><table><thead><tr><th>Date</th><th class="n">Amount</th><th>Condition</th></tr></thead><tbody>
    ${p.tranches.map((t) => `<tr><td>${esc(dd(t.date))}</td><td class="n">${money(E.num(t.amount), b)}</td><td class="sub">${esc(t.label || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">No tranches yet.</td></tr>'}
    </tbody><tfoot><tr><td>Facility</td><td class="n" data-out="dl-trtot"></td><td></td></tr></tfoot></table></div></div>` : '';
  const desc = String(i.deckDesc || '').trim();
  return `<div class="dl-head"><div class="dl-sum">${desc ? esc(desc) : '<span class="sub">No description yet – add it on Overview → Committee deck.</span>'}</div>
      <div class="sub">${esc([p.borrower, p.projectType, typeLabel(typeOf(p))].filter(Boolean).join(', '))}</div></div>
    <div class="dl-cols">
      <section class="card"><h2>Proposed structure${b !== 'EUR' ? ` <span class="sub">in ${esc(b)}</span>` : ''}</h2><div class="dl-kvs">${fields}</div>${tr}</section>
      <div class="stack"><section class="card"><h2>Results${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><div data-out="dealres"></div></section>${dealBR(p)}</div>
    </div>
    <section class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between;align-items:baseline"><h2>Scenarios${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><span class="sub">Built on Sensitivity. Each one reruns the full monthly cash flow.</span></div><div data-out="dealsc"></div>
      <div class="dl-chart"><div class="dl-h">Borrower's cash, month by month, until maturity</div><div class="sub" style="margin-bottom:8px">One line per scenario, in the card's colour. Point at a card to pick out its line.</div><div class="chart" id="ch-dl"></div></div></section>`;
}
// one input as plain text, in the project currency
function dealVal(f, v, ccy) {
  if (E.blank(v)) return '–';
  if (f.kind === 'money') return money(E.num(v), ccy);
  if (f.kind === 'pct') return `${fmtP(E.num(v))}%`;
  if (f.kind === 'date') { const d = E.parseDate(v); return d == null ? String(v) : datef(d); }
  if (f.kind === 'select') { const o = (f.opts || []).find((x) => String(x[0]) === String(v)); return o ? o[1] : String(v); }
  if (f.unit === 'mo') return `${fmtP(E.num(v))} months`;
  return String(v);
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
  const pk = peakOf(m, 'ltv'), a = dealAtMat(s, r), fee = feeOf(s), pp = (v) => `${+(v * 100).toFixed(2)}%`;
  const part = r.tranchesOn && s.draw0 < s.facility - 1;
  return '<div class="dl-grid">' +
    it(r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), `${r.termBase} months at ${pp(r.rate)}${r.gain ? ` + ${pp(r.gain)}` : ''} a year${part ? `, ${mgK(s.draw0)} drawn at the start` : ''}`, '', 'facility') +
    (s.netCash < -1 ? it('Funding gap at drawdown', money(-s.netCash), 'not covered by loan and equity', 'bad', 'netCash') : '') +
    it('LTV at drawdown', s.mkt0 > 0 ? pctf(s.ltv0) : '–', s.mkt0 > 0 ? `${part ? `${pctf(s.draw0 / s.mkt0)} on the amount drawn, ` : ''}limit ${pctf(lim, 0)}` : 'no collateral value yet', ltvT(s.ltv0), 'ltv0') +
    it('Forced-sale LTV at drawdown', s.fs0 > 0 ? pctf(s.ltvFs0) : '–', s.fs0 > 0 ? `after a ${pctf(r.haircut, 0)} haircut` : '', ltvT(s.ltvFs0), 'ltvFs0') +
    it('Highest LTV', pk ? pctf(pk.ltv) : '–', pk ? `in ${mgMonth(pk.date)}, forced sale ${pctf(pk.ltvFs)}` : '', ltvT(pk && pk.ltv), 'maxLtv') +
    it('Borrower cash before maturity', s.lowCashPre < -1 ? money(s.lowCashPre) : 'Never negative', s.lowCashPre < -1 ? `lowest in ${mgMonth(s.lowCashPreDate)}, ${negPre} month${negPre === 1 ? '' : 's'} below zero` : s.lowCashPreDate ? `lowest ${Math.abs(s.lowCashPre) < 1000 ? money(s.lowCashPre) : mgK(s.lowCashPre)} in ${mgMonth(s.lowCashPreDate)}` : '', s.lowCashPre < -1 ? 'bad' : 'good', 'lowCashPre') +
    it('Cash at maturity', money(a.v), `maturity ${mgMonth(s.maturity)}${a.refi ? ', incl. bank refinancing' : ''}`, a.v < -1 ? 'bad' : 'good', a.refi ? '' : 'cashAtMaturity') +
    it('Collateral buffer', s.headroom == null ? '–' : pctf(s.headroom), 'incl. interest and selling costs', s.headroom == null ? '' : s.headroom < 0.1 ? 'bad' : s.headroom < 0.2 ? 'warn' : 'good', 'headroom') +
    (usesDscr(m) ? it(r.dscrBasis === 'monthly' ? 'Lowest DSCR' : 'Lowest DSCR, 12 months', s.dscrTest == null ? '–' : xf(s.dscrTest), s.dscrTest == null ? 'no loan payments before maturity' : `target ${xf(r.minDSCR)}`, s.dscrTest == null ? '' : s.dscrTest < r.minDSCR ? 'bad' : 'good', 'dscrTest') : '') +
    it('InRento fee', money(fee), s.facility > 0 ? `${pctf(fee / s.facility, 1)} of the facility` : '', '', 'arrFeeAmt') + '</div>';
};
// borrower cash month by month until maturity (the final repayment itself is the 'cash at maturity' number)
function dealSpark(rows, mat, tone) {
  const v = rows.filter((x) => x.date < mat).map((x) => x.cash), n = v.length; if (n < 2) return '';
  const lo = Math.min(0, ...v), hi = Math.max(0, ...v), H = 44, W = 240, y = (c) => (hi === lo ? H / 2 : 2 + (H - 4) * (hi - c) / (hi - lo)), x = (k) => (W * k) / (n - 1);
  return `<svg class="dl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="z"/><polyline class="${tone}" points="${v.map((c, k) => `${x(k).toFixed(1)},${y(c).toFixed(1)}`).join(' ')}"/></svg>`;
}
// scenarios worth showing: the base case plus every scenario whose result differs from it (cards and chart use the same list and colours)
function dealShown(scen) {
  const sig = (s) => JSON.stringify([s.lowCashPre, s.cashAtMaturity, s.repaidDate, s.maxLtv, s.profit].map((v) => (v == null ? null : +(+v).toFixed(2))));
  const base = scen.length ? sig(scen[0].res.summary) : '';
  return scen.filter((x, k) => k === 0 || sig(x.res.summary) !== base);
}
OUT.dealsc = () => {
  const p = cur(), { scen } = sensModel(), r = S.model.r; if (!scen.length) return '';
  const shown = dealShown(scen), same = scen.length - shown.length;
  const card = (x, k) => { const s = x.res.summary, o = dealOutcome(s, r), j = scen.indexOf(x);
    return `<div class="dl-sc ${o.tone}" data-dl="${k}"><div class="dl-sch"><b><i class="dl-sw" style="background:${SCOL[k]}"></i>${esc(x.name)}</b><span class="dl-dot ${o.tone}"></span></div><div class="sub dl-what">${esc(scWhat(p, j))}</div>
      <div class="dl-sco ${o.tone}">${esc(o.txt)}</div>
      <div class="dl-scn"><div><span class="l">Borrower's lowest cash</span><span class="${s.lowCashPre < -1 ? 'bad' : ''}">${money(s.lowCashPre)}</span></div>${(() => { const a = dealAtMat(s, r); return `<div><span class="l">Cash at maturity${a.refi ? ' (incl. refi)' : ''}</span><span class="${a.v < -1 ? 'bad' : ''}">${money(a.v)}</span></div>`; })()}<div><span class="l">Highest LTV</span><span class="${s.maxLtv > r.maxLTV ? 'bad' : ''}">${s.maxLtv == null ? '–' : pctf(s.maxLtv)}</span></div></div></div>`; };
  return `<div class="dl-scs">${shown.map((x, k) => card(x, k)).join('')}</div>${same ? `<div class="sub" style="margin-top:8px">${same} scenario${same > 1 ? 's' : ''} not shown – same result as ${esc(scen[0].name)} on this deal (they move drivers the deal does not have).</div>` : ''}`;
};
// pointing at a scenario card picks out its line in the chart below
document.addEventListener('mouseover', (e) => {
  const ch = $('#ch-dl'); if (!ch) return;
  const c = e.target.closest ? e.target.closest('.dl-sc[data-dl]') : null, k = c ? c.dataset.dl : null;
  if (ch.dataset.on === (k == null ? '' : k)) return; ch.dataset.on = k == null ? '' : k;
  ch.classList.toggle('hl', k != null);
  ch.querySelectorAll('path[data-s]').forEach((x) => x.classList.toggle('on', x.dataset.s === k));
  document.querySelectorAll('.dl-sc[data-dl]').forEach((x) => x.classList.toggle('on', x === c));
});

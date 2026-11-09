// Deal tab – the page a project opens on, made for the CEO: the main terms on the left (read only, `dealTerms` – the CEO
// asks for changes and the analyst makes them on Inputs), results that apply to every deal type on the right, and the hand-built scenarios
// from Sensitivity as simple cards underneath. No new calculations: everything comes from the engine run and sensModel().
{ TABS.splice(0, 0, ['deal', 'Deal']); }
function tabDeal() {
  const p = cur(), i = p.inputs;
  const eur = viewEUR(), b = eur ? 'EUR' : baseCcy(p), fx = eur ? fxRateOf(p) : 1, amt = (v) => money(E.num(v) / fx, b); // follows the PLN / EUR switch like the results
  const fields = dealTerms(p, S.model, b).map(([l, v]) => `<div class="dl-kv"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('');
  const prog = i.constrOn && i.trancheMode === 'progress';
  const dd = (t) => { if (prog && !E.blank(t.milestone)) return `at ${fmtP(E.num(t.milestone))}% of the works`; if (t.trigger === 'balance') return `when the loan is below ${amt(t.trigAmount)}`; const d = E.parseDate(t.date); return d == null ? 'no date' : datef(d); };
  const tr = i.tranchesOn ? `<div class="dl-sub"><div class="dl-h">Drawdown schedule</div><div class="tblwrap"><table><thead><tr><th>When</th><th class="n">Amount</th><th>Purpose</th></tr></thead><tbody>
    ${p.tranches.map((t) => `<tr><td>${esc(dd(t))}</td><td class="n">${amt(t.amount)}</td><td class="sub">${esc(t.label || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">No tranches yet.</td></tr>'}
    </tbody><tfoot><tr><td>Facility</td><td class="n" data-out="dl-trtot"></td><td></td></tr></tfoot></table></div></div>` : '';
  const desc = String(i.deckDesc || '').trim();
  return `<div class="dl-head"><div class="dl-sum">${desc ? esc(desc) : '<span class="sub">No description yet – add it on Overview → Committee deck.</span>'}</div>
      <div class="sub">${esc([p.borrower, p.projectType, typeLabel(typeOf(p))].filter(Boolean).join(', '))}</div></div>
    <div class="dl-cols">
      <div class="stack"><section class="card"><h2>Proposed structure${b !== 'EUR' || eur ? ` <span class="sub">in ${esc(b)}</span>` : ''}</h2><div class="dl-kvs">${fields}</div>${tr}</section>${dealLinks(p)}</div>
      <div class="stack"><section class="card"><h2>Results${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><div data-out="dealres"></div></section>${dealBR(p)}</div>
    </div>
    <section class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between;align-items:baseline"><h2>Scenarios${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><span class="sub">Built on Sensitivity. Each one reruns the full monthly cash flow.</span></div><div data-out="dealsc"></div>
      <div class="dl-chart"><div class="dl-h">Borrower's cash, month by month, until maturity</div><div class="sub" style="margin-bottom:8px">One line per scenario, in the card's colour. Point at a card to pick out its line.</div><div class="chart" id="ch-dl"></div></div></section>`;
}
// the terms the CEO asks about, in the project currency: size, price, fee, term, equity and – on renovation deals – the works
function dealTerms(p, m, ccy) {
  const i = p.inputs, n = (k) => E.num(i[k]), pc = (v) => `${fmtP(v)}%`, out = [];
  if (!m) return out;
  const r = m.r, s = m.summary, rows = m.rows, mo = (d) => (d == null ? '' : datef(d));
  out.push([i.tranchesOn ? 'Facility' : 'Loan amount', money(s.facility, ccy)]);
  out.push(['Interest (a year)', n('fixedGain') ? `${pc(n('rate'))} + ${pc(n('fixedGain'))} capital gain` : pc(n('rate'))]);
  if (n('profitShare') && !isDefault('profitShare', i.profitShare)) out.push(['Profit share to investors', pc(n('profitShare'))]);
  out.push(['Arrangement fee', pc(n('arrFee'))]);
  out.push(['Term', `${r.termBase} months, ${mo(rows[0] && rows[0].date)} to ${mo(s.maturity)}`]);
  out.push(['Borrower equity', s.equity > 0 ? money(s.equity, ccy) : 'None']);
  const c = i.constrOn && r.constr;
  if (c) {
    const a = rows[c.startP], z = rows[c.endP], k = c.endP - c.startP + 1;
    out.push(['Renovation', a && z ? `${k} month${k === 1 ? '' : 's'}, ${mo(a.date)} to ${mo(z.date)}` : '–']);
    out.push(['Works budget', money(c.total, ccy)]);
    if (c.equity > 0) out.push(['Borrower equity for the works', money(c.equity, ccy)]);
  }
  return out;
}
// links: project folder, listings, other information – they belong to the deal (not a version); only the lock holder edits,
// and boxes without links are hidden from everyone else
const LINK_BOXES = [['folder', 'Project folder', 'e.g. the Google Drive folder'], ['listings', 'Listings', 'e.g. Otodom, Aruodas'], ['other', 'Other information', 'e.g. adverse media, registry extracts']];
const linkUrl = (u) => { let s = String(u || '').trim(); if (!s) return ''; if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s; return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s) ? s : ''; };
const linkSite = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
function dealLinks(p) {
  const ed = canEdit(p.id), L = p.inputs.links || [];
  const boxes = LINK_BOXES.map(([k, t, ph]) => {
    const items = L.map((l, j) => [l, j]).filter(([l]) => l.box === k);
    if (!items.length && !ed) return '';
    const open = ed && S.dlAdd === k;
    return `<div class="dl-lb"><div class="dl-lbh"><span class="dl-h">${esc(t)}</span>${ed && !open ? `<button class="btn sm ghost" data-act="dl-add" data-box="${k}">+ Add link</button>` : ''}</div>
      ${items.length ? `<ul class="dl-links">${items.map(([l, j]) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}"><span class="dl-lt">${esc(l.label || linkSite(l.url))}</span>${l.label ? `<span class="dl-ls">${esc(linkSite(l.url))}</span>` : ''}</a>${ed ? `<button class="xbtn" data-act="dl-del" data-i="${j}" aria-label="Remove link">×</button>` : ''}</li>`).join('')}</ul>` : open ? '' : '<div class="sub">No links yet.</div>'}
      ${open ? `<div class="dl-lform"><input class="in" id="dl-url" placeholder="Paste the link (${esc(ph)})" autocomplete="off"><input class="in" id="dl-lbl" placeholder="Label (optional)" autocomplete="off"><div class="row" style="gap:6px"><button class="btn sm primary" data-act="dl-save" data-box="${k}">Add</button><button class="btn sm ghost" data-act="dl-cancel">Cancel</button></div></div>` : ''}</div>`;
  }).join('');
  return boxes ? `<section class="card"><h2>Links</h2><div class="dl-lbs">${boxes}</div></section>` : '';
}
function dealLinkSave(box) {
  const p = cur(), u = linkUrl($('#dl-url') && $('#dl-url').value), lbl = String(($('#dl-lbl') && $('#dl-lbl').value) || '').trim();
  if (!u) { toast('That does not look like a web link'); const x = $('#dl-url'); if (x) x.focus(); return; }
  p.inputs.links = (p.inputs.links || []).concat([{ box, url: u, label: lbl }]); S.dlAdd = null;
  scheduleSave(p.id); renderTab();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-act^="dl-"]'); if (!b || S.view !== 'project') return;
  const a = b.dataset.act, p = cur(); if (!p) return;
  if (a === 'dl-add') { S.dlAdd = b.dataset.box; renderTab(); const x = $('#dl-url'); if (x) x.focus(); }
  else if (a === 'dl-cancel') { S.dlAdd = null; renderTab(); }
  else if (a === 'dl-save') dealLinkSave(b.dataset.box);
  else if (a === 'dl-del') { p.inputs.links = (p.inputs.links || []).filter((_, j) => j !== +b.dataset.i); scheduleSave(p.id); renderTab(); }
});
document.addEventListener('keydown', (e) => {
  if (!e.target || (e.target.id !== 'dl-url' && e.target.id !== 'dl-lbl')) return;
  if (e.key === 'Enter') { e.preventDefault(); dealLinkSave(S.dlAdd); }
  else if (e.key === 'Escape') { S.dlAdd = null; renderTab(); }
});
// drawdown table total, in the currency shown
OUT['dl-trtot'] = () => money(S.model.r.facility);
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
      <div class="dl-sco ${o.tone}">${esc(o.txt)}</div></div>`; };
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

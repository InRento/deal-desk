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
    <section class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between;align-items:baseline"><h2>Scenarios${viewEUR() ? ' <span class="sub">in EUR</span>' : ''}</h2><span class="sub">Built on Sensitivity. Each one reruns the full monthly cash flow.</span></div>${dealScNote()}<div data-out="dealsc"></div>
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
// how far collateral value can fall from the weakest month (highest LTV) before LTV reaches the limit; negative = already above it
const ltvRoom = (ltv, lim) => 1 - ltv / lim;
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
// the results of one engine run as [key, label, value html, tone, trace key]; plain numbers, no notes under them (Tautvydas, 9 Nov)
function dealResRows(m) {
  const s = m.summary, r = m.r, out = [];
  const lim = r.maxLTV, ltvT = (v) => (v == null ? '' : v > lim ? 'bad' : 'good'), roomT = (v) => (v < 0.1 ? 'bad' : v < 0.2 ? 'warn' : 'good');
  const it = (k, l, v, tone = '', tr = '') => out.push([k, l, v, tone, tr]);
  const pk = peakOf(m, 'ltv'), a = dealAtMat(s, r), fee = feeOf(s);
  it('loan', r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), '', 'facility');
  if (s.netCash < -1) it('gap', 'Funding gap at drawdown', money(-s.netCash), 'bad', 'netCash');
  it('ltv0', 'LTV at drawdown', s.mkt0 > 0 ? pctf(s.ltv0) : '–', ltvT(s.ltv0), 'ltv0');
  it('ltvFs0', 'Forced-sale LTV at drawdown', s.fs0 > 0 ? pctf(s.ltvFs0) : '–', ltvT(s.ltvFs0), 'ltvFs0');
  it('maxLtv', 'Highest LTV', pk ? pctf(pk.ltv) : '–', ltvT(pk && pk.ltv), 'maxLtv');
  it('low', 'Lowest borrower cash before maturity', money(s.lowCashPre), s.lowCashPre < -1 ? 'bad' : 'good', 'lowCashPre');
  it('mat', a.refi ? 'Cash at maturity, incl. bank refinancing' : 'Cash at maturity', money(a.v), a.v < -1 ? 'bad' : 'good', a.refi ? '' : 'cashAtMaturity');
  if (pk && lim > 0) { const v = ltvRoom(pk.ltv, lim); it('room', 'Value can fall before the LTV limit', pctf(v), roomT(v)); }
  it('loss', 'Value can fall before a loss', s.headroom == null ? '–' : pctf(s.headroom), s.headroom == null ? '' : roomT(s.headroom), 'headroom');
  if (usesDscr(m) && s.dscrTest != null) it('dscr', r.dscrBasis === 'monthly' ? 'Lowest DSCR' : 'Lowest DSCR, 12 months', xf(s.dscrTest), s.dscrTest < r.minDSCR ? 'bad' : 'good', 'dscrTest');
  it('fee', 'InRento fee', `${money(fee)}${s.facility > 0 ? ` <span class="dl-pc">${pctf(fee / s.facility, 1)}</span>` : ''}`, '', 'arrFeeAmt');
  return out;
}
OUT.dealres = () => {
  const c = dealCmp(); if (c) return dealCmpTable(c);
  return '<div class="dl-grid">' + dealResRows(S.model).map(([, l, v, tone, tr]) => `<div class="dl-it"><div class="l">${l}</div><div class="v ${tone}"${tr ? ` data-tr="m:${tr}"` : ''}>${v}</div></div>`).join('') + '</div>';
};
// ---- borrower's plan vs our view (v3.27): two versions picked on the Versions tab (inputs.dealPlan / inputs.dealView, deal-level)
// shown side by side in Results, so the CEO sees what the borrower claims and what we believe on one screen
function dealCmp() {
  const i = cur().inputs, a = vById(+i.dealPlan), b = vById(+i.dealView);
  return a && b && a.id !== b.id ? { plan: a, view: b } : null;
}
const DCMP = {};
function dealRunOf(v) { // engine run of one version, in the currency shown
  const live = v.id === vActiveId(), eur = viewEUR();
  const key = `${v.id}:${live ? 'live' + (S.ver[S.curId] || 0) : v.updatedAt || v.createdAt}:${eur}`;
  if (DCMP[v.id] && DCMP[v.id].key === key) return DCMP[v.id].m;
  let p = normalise(clone(vDataOf(v))); if (eur && fxRateOf(p) > 0) p = convertProject(p, fxRateOf(p));
  let m = null; try { m = E.run(p); } catch (e) { console.error(e); }
  DCMP[v.id] = { key, m }; return m;
}
function dealCmpTable(c) {
  const mp2 = [c.plan, c.view].map(dealRunOf);
  if (mp2.some((m) => !m)) return '<div class="sub">One of the compared versions could not be calculated – open it to check its inputs.</div>';
  const rows = mp2.map(dealResRows), keys = [...new Set(rows.flatMap((r) => r.map((x) => x[0])))];
  const cell = (r, k) => { const x = r.find((y) => y[0] === k); return x ? `<td class="n v ${x[3]}">${x[2]}</td>` : '<td class="n sub">–</td>'; };
  const lbl = (k) => (rows[1].find((y) => y[0] === k) || rows[0].find((y) => y[0] === k))[1];
  const head = (t, v) => { const sub = [v.label.trim().toLowerCase() === t.toLowerCase() ? '' : esc(v.label), v.id === vActiveId() ? 'open' : ''].filter(Boolean).join(' · ');
    return `<th class="n">${t}${sub ? `<div class="sub">${sub}</div>` : ''}</th>`; };
  return `<div class="tblwrap"><table class="dl-cmp"><thead><tr><th></th>${head("Borrower's plan", c.plan)}${head('Our view', c.view)}</tr></thead>
    <tbody>${keys.map((k) => `<tr><td>${esc(lbl(k))}</td>${cell(rows[0], k)}${cell(rows[1], k)}</tr>`).join('')}</tbody></table></div>`;
}
function dealScNote() {
  const c = dealCmp(); if (!c) return '';
  const open = vById(vActiveId());
  return `<div class="sub" style="margin:2px 0 8px">Scenarios run on the open version${open ? `, “${esc(open.label)}”` : ''}.${c.view.id !== vActiveId() ? ` Open “${esc(c.view.label)}” to stress our view.` : ''}</div>`;
}
// Versions tab: which two versions the Deal tab compares (only the lock holder changes it)
function dealCmpPicker(p, vs) {
  const ed = canEdit(p.id), opt = (k) => `<option value="">–</option>${vs.map((v) => `<option value="${v.id}" ${String(v.id) === String(p.inputs[k] || '') ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}`;
  return `<div class="row dl-pick" style="gap:12px;margin-bottom:12px;align-items:flex-end"><div><div class="dl-h">On the Deal tab</div><div class="sub">Show two versions side by side in Results.</div></div>
    <label><span class="sub">Borrower's plan</span><br><select class="in" id="dl-plan" style="width:auto" ${ed ? '' : 'disabled'}>${opt('dealPlan')}</select></label>
    <label><span class="sub">Our view</span><br><select class="in" id="dl-view" style="width:auto" ${ed ? '' : 'disabled'}>${opt('dealView')}</select></label></div>`;
}
document.addEventListener('change', (e) => {
  const id = e.target && e.target.id; if (id !== 'dl-plan' && id !== 'dl-view') return;
  const p = cur(); if (!p) return;
  p.inputs[id === 'dl-plan' ? 'dealPlan' : 'dealView'] = e.target.value; scheduleSave(p.id);
  if (p.inputs.dealPlan && p.inputs.dealPlan === p.inputs.dealView) toast('Pick two different versions to compare');
});
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
// security in a scenario (v3.27): LTV and forced-sale LTV at drawdown, so a value cut shows even when repayment is unchanged.
// amber = LTV above the deal's limit, red = a forced sale no longer covers the loan (forced-sale LTV above 100%)
function dealScLtv(s, r) {
  if (!(s.mkt0 > 0)) return { tone: 'good', html: '' };
  const lim = r.maxLTV, t = (v) => (v == null ? '' : v > 1 ? 'bad' : v > lim ? 'warn' : 'good'), tone = worseTone(t(s.ltv0) || 'good', t(s.ltvFs0) || 'good');
  return { tone, html: `<div class="dl-scl">LTV <b class="${t(s.ltv0)}">${pctf(s.ltv0)}</b> · forced-sale <b class="${t(s.ltvFs0)}">${s.fs0 > 0 ? pctf(s.ltvFs0) : '–'}</b></div>` };
}
const worseTone = (a, b) => (['bad', 'warn', 'good'].find((x) => x === a || x === b) || a);
OUT.dealsc = () => {
  const p = cur(), { scen } = sensModel(), r = S.model.r; if (!scen.length) return '';
  const shown = dealShown(scen), same = scen.length - shown.length;
  const card = (x, k) => { const s = x.res.summary, o = dealOutcome(s, r), j = scen.indexOf(x), l = dealScLtv(s, r), tone = worseTone(o.tone, l.tone);
    return `<div class="dl-sc ${tone}" data-dl="${k}"><div class="dl-sch"><b><i class="dl-sw" style="background:${SCOL[k]}"></i>${esc(x.name)}</b><span class="dl-dot ${tone}"></span></div><div class="sub dl-what">${esc(scWhat(p, j))}</div>
      <div class="dl-sco ${o.tone}">${esc(o.txt)}</div>${l.html}</div>`; };
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

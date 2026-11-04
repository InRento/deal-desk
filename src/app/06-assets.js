// Collateral & sales and Adjustments tabs, unit sale status columns, sales schedule tool.
// ---- Assets
const ACOLS = [
  ['name', 'Asset / item', 'text', 'w-name'], ['inColl', 'In collateral', 'check'], ['secures', 'Secures loan (blank = all)', 'text', 'w-s'], ['market', 'Market value', 'money'], ['marketDone', 'Value on completion', 'money'], ['valDate', 'Valuation date', 'date'], ['source', 'Valuer / basis', 'text'],
  ['haircut', 'Own haircut % (blank = default)', 'pct', 'w-s'], ['=forced', 'Lending value (after haircut)'], ['alloc', 'Allocated loan', 'money'], ['=allocLtv', 'LTV on allocation'], ['=release', 'Release price'], ['=releaseM2', 'Release price per m²'],
  ['acqPrice', 'Acquisition price', 'money'], ['rent', 'Rent / month', 'money'], ['area', 'Area m²', 'num', 'w-s'], ['=perM2', 'Value per m²'],
  ['contractDate', 'Contract date', 'date'], ['saleDate', 'Planned sale date', 'date'], ['salePrice', 'Planned sale price (gross)', 'money'], ['payPlan', 'Own payment plan', 'text', 'w-plan'], ['=pays', 'Payments'], ['=saleChk', 'Sale vs release'], ['sweep', 'Own sweep % (blank = default)', 'pct', 'w-s'], ['minPrice', 'Minimum selling price', 'money'], ['notary', 'Notary / transaction costs', 'money'],
  ['=repaid', 'Repaid to loan'], ['=pshare', 'Profit share'], ['notes', 'Notes', 'text', 'w-name'],
];
function cellIn(path, kind, val) {
  if (kind === 'status') return sel(path, val || '', SALE_STATUS);
  if (kind === 'held') return sel(path, val || '', DEP_HELD);
  if (kind === 'check') return chk(path, val !== false && val !== 'No', 'In collateral');
  if (kind === 'date') return dateIn(path, val);
  return inp(path, val, kind);
}
function tabAssets() {
  const p = cur(), AC = acols();
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div><h2>Collateral &amp; asset sales</h2><div class="sub" title="Lending value = market value × (1 − haircut), e.g. 70% for buildings without operations, 50% for plots. Release price = allocated loan × release % (Inputs 3c). Right-click a cell to note its source.">One row per asset · lending value = market value × (1 − haircut)</div></div>
    <span class="row" style="gap:6px"><button class="btn" data-act="sched-sales" title="Re-date many sales at once">Schedule sales</button><button class="btn" data-act="paste-table" data-t="assets" title="Paste rows copied from Excel">Paste from Excel</button><button class="btn primary" data-act="add-asset">Add asset</button></span></div>
    <div class="tblwrap"><table class="grid-in"><thead><tr>${AC.map((c) => `<th class="${c[0][0] === '=' || /money|num|pct/.test(c[2]) ? 'n' : ''}">${esc(c[1])}</th>`).join('')}<th></th></tr></thead>
    <tbody>${p.assets.map((a, i) => `<tr>${AC.map((c) => c[0][0] === '=' ? `<td class="calcc" data-out="a-${i}-${c[0].slice(1)}"></td>` : `<td class="${c[3] || ''} ${c[2] === 'check' ? 'c' : ''}">${cellIn(`assets.${i}.${c[0]}`, c[2], a[c[0]])}</td>`).join('')}<td><button class="xbtn" data-act="del-asset" data-i="${i}" aria-label="Remove asset">×</button></td></tr>`).join('') || `<tr><td colspan="${AC.length + 1}" class="sub">No assets yet. Add the properties that secure the loan and any planned sales.</td></tr>`}</tbody>
    <tfoot><tr>${AC.map((c) => `<td data-out="at-${c[0].replace('=', '')}"></td>`).join('')}<td></td></tr></tfoot></table></div>`;
}
function assetCalcs() {
  const r = S.model.r; const out = {};
  r.assets.forEach((a, i) => {
    const area = a.area || 0;
    out[`a-${i}-forced`] = a.forced == null ? '' : plain(a.forced);
    out[`a-${i}-allocLtv`] = a.alloc != null && a.market ? pctf(a.alloc / a.market) : '';
    out[`a-${i}-release`] = a.release != null ? plain(a.release) : '';
    out[`a-${i}-releaseM2`] = a.release != null && area ? plain(a.release / area) : '';
    out[`a-${i}-perM2`] = a.market && area ? plain(a.market / area) : '';
    out[`a-${i}-saleChk`] = a.salePrice != null && a.release != null ? (a.salePrice * (1 - r.sellCost) - a.notary >= a.release ? '<span class="pill ok">covers</span>' : '<span class="pill chk">below</span>') : '';
    out[`a-${i}-repaid`] = a.salePrice != null ? plain(a.repaid) : '';
    out[`a-${i}-pshare`] = a.profitBase != null ? plain(a.profitShareAmt) : '';
  });
  const sum = (f) => r.assets.reduce((s, a, i) => s + (f(a, cur().assets[i] || {}) || 0), 0);
  Object.assign(out, { 'at-name': 'Total', 'at-market': plain(sum((a) => a.market)), 'at-forced': plain(sum((a) => a.forced)), 'at-alloc': plain(sum((a) => a.alloc)), 'at-release': plain(sum((a) => a.release)),
    'at-acqPrice': plain(sum((a, s) => E.num(s.acqPrice))), 'at-rent': plain(sum((a, s) => E.num(s.rent))), 'at-area': plain(sum((a) => a.area)), 'at-salePrice': plain(sum((a) => a.salePrice)),
    'at-repaid': plain(sum((a) => a.repaid)), 'at-pshare': plain(sum((a) => a.profitShareAmt)), 'at-notary': plain(sum((a) => a.notary)) });
  unitCalcs(out); payCalcs(out);
  return out;
}

// ---- Adjustments
function tabAdjust() {
  const p = cur();
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px"><div><h2>Adjustments</h2><div class="sub">Staged capex, renovation, one-off receipts or maintenance. Amount is always positive; the type sets the sign. Capex is paid from cash (e.g. works funded by a tranche) but kept out of EBITDA and DSCR; Expense reduces EBITDA. One-off falls in the month of the date; monthly repeats until the end date (blank = whole horizon).</div></div>
  <span class="row" style="gap:6px"><button class="btn" data-act="paste-table" data-t="adjustments" title="Paste rows copied from Excel">Paste from Excel</button><button class="btn primary" data-act="add-adj">Add item</button></span></div>
  <div class="tblwrap"><table class="grid-in"><thead><tr><th>Description</th><th>Type</th><th>Date / start</th><th>Recurrence</th><th>End date (monthly)</th><th class="n">Amount per occurrence</th><th class="n">Total in horizon</th><th>Notes</th><th></th></tr></thead>
  <tbody>${p.adjustments.map((a, i) => `<tr>
    <td class="w-name">${inp(`adjustments.${i}.desc`, a.desc, 'text')}</td>
    <td>${sel(`adjustments.${i}.type`, a.type, [['Expense', 'Expense'], ['Income', 'Income'], ['Capex', 'Capex (not in DSCR)']])}</td>
    <td>${dateIn(`adjustments.${i}.date`, a.date)}</td>
    <td>${sel(`adjustments.${i}.recurrence`, a.recurrence, [['One-off', 'One-off'], ['Monthly', 'Monthly']])}</td>
    <td>${dateIn(`adjustments.${i}.end`, a.end)}</td><td>${inp(`adjustments.${i}.amount`, a.amount, 'money')}</td>
    <td class="calcc" data-out="j-${i}-tot"></td><td class="w-name">${inp(`adjustments.${i}.notes`, a.notes, 'text')}</td>
    <td><button class="xbtn" data-act="del-adj" data-i="${i}" aria-label="Remove item">×</button></td></tr>`).join('') || `<tr><td colspan="9" class="sub">No adjustments.</td></tr>`}</tbody>
  <tfoot><tr><td>Total</td><td colspan="5"></td><td data-out="j-total"></td><td colspan="2"></td></tr></tfoot></table></div>`;
}
function adjCalcs() {
  const out = {}; const rows = S.model.rows.slice(1); let tot = 0;
  cur().adjustments.forEach((a, i) => {
    const d = E.parseDate(a.date); if (d == null) { out[`j-${i}-tot`] = ''; return; }
    const eff = a.recurrence === 'Monthly' ? (E.parseDate(a.end) ?? 1e9) : d; const amt = E.num(a.amount);
    let n = 0; for (const x of rows) { const ms = E.eomonth(x.date, -1) + 1; if (d <= x.date && eff >= ms) n++; }
    const v = n * amt * (a.type === 'Income' ? 1 : -1); tot += v;
    out[`j-${i}-tot`] = `${plain(v)} <span class="sub">(${n}×)</span>`;
  });
  out['j-total'] = plain(tot);
  return out;
}

// ---- Collateral table: unit status columns
ACOLS.splice(ACOLS.findIndex((c) => c[0] === 'sweep'), 0, ['status', 'Sale status', 'status'], ['listPrice', 'List price', 'money'], ['=vsList', 'Price vs list'], ['deposit', 'Deposit paid', 'money'], ['depositHeld', 'Deposit held', 'held'], ['=beM2', 'Break-even price per m²']);
const SALE_STATUS = [['', '–'], ['Available', 'Available'], ['Reserved', 'Reserved'], ['Preliminary contract', 'Preliminary contract'], ['Final deed signed', 'Final deed signed'], ['Not for sale', 'Not for sale']];
const DEP_HELD = [['', '–'], ['Escrow', 'Escrow / trust account'], ['Pledged', 'Pledged account (ours)'], ['Borrower', 'Already paid to borrower']];
function unitCalcs(out) { // sale status columns
  const r = S.model.r;
  const be = S.tab === 'assets' && r.assets.some((a) => a.salePrice != null) && acols().some((c) => c[0] === '=beM2') ? breakEvens() : {};
  r.assets.forEach((a, i) => {
    out[`a-${i}-vsList`] = a.salePrice != null && a.listPrice ? `<span class="${a.salePrice < a.listPrice * 0.9 ? 'bad-t' : ''}">${((a.salePrice / a.listPrice - 1) * 100).toFixed(1)}%</span>` : '';
    out[`a-${i}-beM2`] = a.salePrice != null && a.area && be.saleExit != null ? plain(a.salePrice * (1 - be.saleExit) / a.area) : '';
  });
  out['at-deposit'] = plain(r.assets.reduce((s, a) => s + a.deposit, 0)); out['at-listPrice'] = plain(r.assets.reduce((s, a) => s + (a.listPrice || 0), 0));
}

// ================= Sales schedule tool: re-date many sales at once =================
// Modes: spread evenly between two dates, fixed pace (units per month), shift by N months, fit the current schedule into a window.
// Applies to: all sales, only sales after maturity, or only units not yet sold/reserved. Undoable (⌘Z).
const iso = (dn) => E.fmtDate(dn);
const SS = { mode: 'fit', apply: 'all', order: 'date', start: '', end: '', pace: '2', shift: '1' };
function ssTargets(p) {
  const m = S.modelOrig || S.model, mat = m ? m.summary.maturity : null;
  return p.assets.map((a, i) => ({ i, a, d: E.parseDate(a.saleDate), price: E.num(a.salePrice) })).filter((x) => !E.blank(x.a.salePrice))
    .filter((x) => SS.apply === 'all' ? true : SS.apply === 'late' ? (x.d == null || (mat != null && x.d > mat)) : !['Final deed signed', 'Preliminary contract', 'Reserved', 'Not for sale'].includes(x.a.status));
}
function ssDefaults() {
  const p = cur(), m = S.modelOrig || S.model; if (!m) return;
  const dd = m.r.drawdown, mat = m.summary.maturity;
  const ds = p.assets.map((a) => E.parseDate(a.saleDate)).filter((d) => d != null);
  SS.start = iso(ds.length ? Math.min(...ds) : E.eomonth(dd, 0));
  SS.end = iso(E.eomonth(mat, -1)); // the month before maturity
}
function ssPlan() { // returns [{i, from, to}]
  const p = cur(), t = ssTargets(p); if (!t.length) return [];
  const start = E.parseDate(SS.start), end = E.parseDate(SS.end);
  const ord = t.slice();
  if (SS.order === 'date') ord.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || a.i - b.i);
  else if (SS.order === 'priceAsc') ord.sort((a, b) => a.price - b.price);
  else if (SS.order === 'priceDesc') ord.sort((a, b) => b.price - a.price);
  const monthsBetween = (a, b) => { const A = new Date(a * 864e5), B = new Date(b * 864e5); return (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + B.getUTCMonth() - A.getUTCMonth(); };
  const out = [];
  if (SS.mode === 'shift') { const n = Math.round(E.num(SS.shift)); for (const x of ord) if (x.d != null) out.push({ i: x.i, from: x.d, to: E.eomonth(x.d, n) }); return out; }
  if (start == null) return [];
  if (SS.mode === 'pace') { const k = Math.max(1, Math.round(E.num(SS.pace, 1))); ord.forEach((x, j) => out.push({ i: x.i, from: x.d, to: E.eomonth(start, Math.floor(j / k)) })); return out; }
  if (end == null || end < start) return [];
  const M = monthsBetween(start, end) + 1;
  if (SS.mode === 'spread') { ord.forEach((x, j) => out.push({ i: x.i, from: x.d, to: E.eomonth(start, Math.min(M - 1, Math.floor(j * M / ord.length))) })); return out; }
  // fit: keep the shape of the current schedule, rescaled into [start, end]
  const dated = ord.filter((x) => x.d != null); if (!dated.length) return [];
  const lo = Math.min(...dated.map((x) => x.d)), hi = Math.max(...dated.map((x) => x.d)), span = monthsBetween(lo, hi);
  for (const x of ord) { const pos = x.d == null ? M - 1 : span ? Math.round(monthsBetween(lo, x.d) * (M - 1) / span) : 0; out.push({ i: x.i, from: x.d, to: E.eomonth(start, pos) }); }
  return out;
}
function ssApply(plan) { // a contract date not yet reached moves with its sale, keeping the gap; signed contracts stay
  const p = cur(), today = E.parseDate(new Date().toISOString().slice(0, 10));
  const mb = (a, b) => { const A = new Date(a * 864e5), B = new Date(b * 864e5); return (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + B.getUTCMonth() - A.getUTCMonth(); };
  for (const c of plan) { const a = p.assets[c.i], cd = E.parseDate(a.contractDate);
    if (cd != null && c.from != null && cd > today) a.contractDate = iso(E.edate(cd, mb(c.from, c.to)));
    a.saleDate = iso(c.to); }
}
function ssRender() {
  const box = $('#ssbody'); if (!box) return;
  const p = cur(), plan = ssPlan(), changed = plan.filter((c) => c.from !== c.to), m = S.modelOrig || S.model, mat = m.summary.maturity;
  const late = plan.filter((c) => c.to > mat).length;
  const f = (k, lab, html) => `<label class="f"><span class="lbl">${lab}</span><span class="ctl">${html}</span></label>`;
  const opt = (k, v, l) => `<option value="${v}" ${SS[k] === v ? 'selected' : ''}>${l}</option>`;
  box.innerHTML = `<div class="form">
    ${f('mode', 'Method', `<select class="in" data-ss="mode">${opt('mode', 'fit', 'Fit the current schedule into a window')}${opt('mode', 'spread', 'Spread evenly between two dates')}${opt('mode', 'pace', 'Fixed pace: units per month')}${opt('mode', 'shift', 'Shift by a number of months')}</select>`)}
    ${f('apply', 'Apply to', `<select class="in" data-ss="apply">${opt('apply', 'all', 'All sales')}${opt('apply', 'late', 'Only sales after maturity')}${opt('apply', 'open', 'Only units not yet sold or reserved')}</select>`)}
    ${SS.mode === 'shift' ? f('shift', 'Months (negative = earlier)', `<input class="in" data-ss="shift" value="${esc(SS.shift)}" inputmode="numeric">`) : f('start', SS.mode === 'pace' ? 'First sale month' : 'From', `<input class="in" type="date" data-ss="start" value="${esc(SS.start)}">`)}
    ${SS.mode === 'fit' || SS.mode === 'spread' ? f('end', 'To', `<input class="in" type="date" data-ss="end" value="${esc(SS.end)}"><span class="sub" style="margin-left:6px">maturity ${dayf(mat)}</span>`) : ''}
    ${SS.mode === 'pace' ? f('pace', 'Units per month', `<input class="in" data-ss="pace" value="${esc(SS.pace)}" inputmode="numeric">`) : ''}
    ${SS.mode !== 'shift' && SS.mode !== 'fit' ? f('order', 'Order', `<select class="in" data-ss="order">${opt('order', 'date', 'Current sale dates')}${opt('order', 'list', 'As listed')}${opt('order', 'priceAsc', 'Cheapest first')}${opt('order', 'priceDesc', 'Most expensive first')}</select>`) : ''}
  </div>
  <div class="sub" style="margin:10px 0 6px">${plan.length} sale${plan.length === 1 ? '' : 's'} selected · ${changed.length} date${changed.length === 1 ? '' : 's'} change${late ? ` · <span class="bad-t">${late} still after maturity</span>` : ''}</div>
  <div class="tblwrap" style="max-height:40vh"><table><thead><tr><th>Unit</th><th>Now</th><th>New</th></tr></thead><tbody>${plan.map((c) => `<tr class="${c.from !== c.to ? '' : 'dim'}"><td>${esc(p.assets[c.i].name || 'Row ' + (c.i + 1))}</td><td class="num">${c.from != null ? dayf(c.from) : '–'}</td><td class="num ${c.to > mat ? 'bad-t' : c.from !== c.to ? 'chg' : ''}">${dayf(c.to)}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">No sales match.</td></tr>'}</tbody></table></div>
  <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" data-ssb="cancel">Cancel</button><button class="btn primary" data-ssb="apply" ${changed.length ? '' : 'disabled'}>Change ${changed.length} date${changed.length === 1 ? '' : 's'}</button></div>`;
}
function ssOpen(preset) {
  ssDefaults(); Object.assign(SS, preset || {});
  let ov = $('#ssov'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'ssov'; ov.className = 'deckov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Schedule sales');
  ov.innerHTML = `<div class="card ssbox"><div class="row" style="justify-content:space-between"><h2>Schedule sales</h2><button class="btn sm ghost" data-ssb="cancel" aria-label="Close">✕</button></div><div class="sub" style="margin:4px 0 12px">Re-date many sales at once. Sales are booked at month end. ⌘Z undoes the change.</div><div id="ssbody"></div></div>`;
  document.body.appendChild(ov); ssRender();
}
document.addEventListener('change', (e) => { const k = e.target.dataset && e.target.dataset.ss; if (!k) return; SS[k] = e.target.value; if (k === 'mode' || k === 'apply') { const keep = { mode: SS.mode, apply: SS.apply, order: SS.order, pace: SS.pace, shift: SS.shift }; ssDefaults(); Object.assign(SS, keep); } ssRender(); });
document.addEventListener('input', (e) => { const k = e.target.dataset && e.target.dataset.ss; if (!k || e.target.tagName === 'SELECT' || e.target.type === 'date') return; SS[k] = e.target.value; clearTimeout(ssRender.t); ssRender.t = setTimeout(() => { const el = document.activeElement, pos = el && el.selectionStart; ssRender(); const n = $(`[data-ss="${k}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (err) {} } }, 250); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ssb],[data-act="sched-sales"]'); if (!b) return;
  if (b.dataset.act === 'sched-sales') return ssOpen();
  if (b.dataset.ssb === 'cancel') return $('#ssov').remove();
  if (b.dataset.ssb === 'apply') { const plan = ssPlan().filter((c) => c.from !== c.to); $('#ssov').remove(); editProject((p) => ssApply(plan), `${plan.length} sale date${plan.length === 1 ? '' : 's'} changed · ⌘Z to undo`); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#ssov')) $('#ssov').remove(); });

// Model check: one item with a fix when several sales fall after maturity
function lintLateSales(p, m, add) { // several sales after maturity, with a one-click fit
  const mat = m.summary.maturity;
  const late = p.assets.map((a, i) => ({ i, d: E.parseDate(a.saleDate) })).filter((x) => !E.blank(p.assets[x.i].salePrice) && x.d != null && x.d > mat);
  if (late.length >= 2) {
    const startD = Math.min(...p.assets.map((a) => E.parseDate(a.saleDate)).filter((d) => d != null)), endD = E.eomonth(mat, -1);
    add({ id: 'sales-late', sev: 'warn', title: `${late.length} sales fall after maturity (${dayf(mat)})`, why: 'They cannot repay the loan in time. Fit the whole sales schedule into the term (keeps the order and spacing), or extend the term.', tab: 'assets', keys: late.map((x) => `assets.${x.i}.saleDate`),
      fix: [{ label: `Fit all sales into ${dayf(startD).slice(0, 7)} – ${dayf(endD).slice(0, 7)}`, run: (q) => { const keep = Object.assign({}, SS); Object.assign(SS, { mode: 'fit', apply: 'all', start: iso(startD), end: iso(endD) }); const plan = ssPlan(); Object.assign(SS, keep); for (const c of plan) q.assets[c.i].saleDate = iso(c.to); } }] });
  }
}

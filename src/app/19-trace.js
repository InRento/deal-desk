// ================= How is this calculated? =================
// Click any number with a dotted underline (cash flow, Summary, KPI strip, Inputs rail): a panel on the right shows
// the formula in words, the same formula with the numbers, and where each number comes from. Click a number in the
// panel to follow it further back; "Back" returns. Inputs open on the Inputs tab. Formulas come from src/trace.js.
const TR = { stack: [], w: 460 };
const trFmt = (v, f) => (v == null ? '–' : f === 'p2' ? pctf(v, 2) : f === 'p' ? pctf(v, Math.abs(v) < 0.1 ? 2 : 1) : f === 'x' ? xf(v) : f === 'd' ? datef(v) : f === 'i' ? String(Math.round(v)) : f === 'n' ? String(+(+v).toFixed(4)) : money(v));
function trResolve(spec) { // 'c:key:period' | 'm:key' | 'y:key:year'
  const m = S.model, p = cur(); if (!m || !p) return null;
  const [kind, key, n] = spec.split(':');
  if (kind === 'c') return Trace.cell(m, p, key, +n);
  if (kind === 'm') return Trace.metric(m, p, key);
  if (kind === 'y') return trYear(m, key, +n);
  return null;
}
// a year of the annual table = the months of that year (flows) or its last month (balances)
function trYear(m, key, year) {
  const rows = m.rows.filter((x) => x.year === year); if (!rows.length) return null;
  const at = String(year), last = rows[rows.length - 1];
  const stock = { cash: 'cash', close: 'close' }[key];
  if (stock) return { title: `${Trace.LABEL[stock]} at year end`, at, terms: [{ label: `${Trace.LABEL[stock]}, month ${last.p}`, v: last[stock], f: 'm', ref: { cell: [stock, last.p] } }], expr: [0], v: last[stock], f: 'm', calc: (a) => a[0], notes: ['The value at the end of the last month of the year.'] };
  const parts = key === 'fees' ? ['prepay', 'exit', 'commit', 'extFee', 'drawFee'] : [key];
  const terms = [];
  for (const k of parts) for (const x of rows) if (Math.abs(x[k] || 0) > 0.005) terms.push({ label: `${Trace.LABEL[k] || k}, ${x.p ? 'month ' + x.p + ' · ' + datef(x.date) : 'drawdown'}`, v: x[k], f: 'm', ref: { cell: [k, x.p] } });
  if (!terms.length) return { title: Trace.LABEL[key] || key, at, terms: [], expr: ['0'], v: 0, f: 'm', calc: () => 0, notes: ['Nothing in this year.'] };
  const expr = []; terms.forEach((t, i) => { if (i) expr.push('+'); expr.push(i); });
  return { title: key === 'fees' ? 'Fees' : Trace.LABEL[key] || key, at, terms, expr, v: terms.reduce((s, t) => s + t.v, 0), f: 'm', calc: (a) => a.reduce((s, x) => s + x, 0), notes: [key === 'fees' ? 'Fee paid on tranches, prepayment, exit, commitment and extension fees of the months in this year.' : 'Sum of the months in this year.'] };
}
const trRefSpec = (ref) => (!ref ? null : ref.cell ? `c:${ref.cell[0]}:${ref.cell[1]}` : ref.metric ? `m:${ref.metric}` : null);
function trSource(t) {
  const r = t.ref; if (!r) return '<span class="sub">–</span>';
  if (r.cell) return `<button class="trlink" data-trgo="${trRefSpec(r)}" title="Explain this number">${r.cell[1] ? 'm' + r.cell[1] : 'drawdown'} ›</button>`;
  if (r.metric) return `<button class="trlink" data-trgo="m:${r.metric}">explain ›</button>`;
  if (r.input) return `<button class="trlink" data-trin="${esc(r.input)}" title="Open the input">${{ assets: 'unit', tranches: 'tranche', debts: 'debt' }[r.input.split('.')[0]] || 'input'} ›</button>`;
  if (r.col) return `<button class="trlink" data-trtab="cashflow" title="Cash flow tab">cash flow ›</button>`;
  if (r.tab) return `<button class="trlink" data-trtab="${r.tab}" title="${{ ops: 'Operating model', assets: 'Collateral & sales', adjust: 'Adjustments' }[r.tab] || ''}">${{ ops: 'lines', assets: 'units', adjust: 'items' }[r.tab] || 'tab'} ›</button>`;
  return '';
}
function renderTrace() {
  let el = $('#trpanel');
  const spec = TR.stack[TR.stack.length - 1];
  if (!spec || S.view !== 'project') { if (el) el.remove(); document.querySelectorAll('.tron').forEach((x) => x.classList.remove('tron')); document.body.classList.remove('withdocs'); document.body.style.paddingRight = ''; return; }
  if (!el) { el = document.createElement('aside'); el.id = 'trpanel'; el.setAttribute('aria-label', 'How this number is calculated'); document.body.appendChild(el); }
  document.body.classList.add('withdocs'); document.body.style.paddingRight = TR.w + 'px'; el.style.width = TR.w + 'px';
  document.querySelectorAll('.tron').forEach((x) => x.classList.remove('tron'));
  document.querySelectorAll(`[data-tr="${CSS.escape(spec)}"]`).forEach((x) => x.classList.add('tron'));
  const x = trResolve(spec);
  const head = `<div class="dpgrip" title="Drag to resize"></div><div class="dphead">${TR.stack.length > 1 ? '<button class="btn sm" data-trback="1">‹ Back</button>' : ''}<b class="trtitle">How it is calculated</b><span class="spacer"></span><button class="btn sm ghost" data-trclose="1" aria-label="Close">✕</button></div>`;
  if (!x) { el.innerHTML = head + '<div class="trbody"><div class="sub">No explanation for this number yet.</div></div>'; return; }
  const tok = (useVal) => x.expr.map((e) => (typeof e === 'number' ? (useVal ? `<span class="trnum">${trFmt(x.terms[e].v, x.terms[e].f)}</span>` : `<span class="trterm">${esc(x.terms[e].label)}</span>`) : `<span class="trop">${esc(e)}</span>`)).join(' ');
  const pureSum = x.terms.length > 5 && x.expr.every((e) => typeof e === 'number' || e === '+');
  const showNums = !pureSum && x.terms.length > 0 && x.expr.some((e) => typeof e === 'number');
  el.innerHTML = head + `<div class="trbody">
    <div class="trhd"><div class="trname">${esc(x.title)}</div><div class="sub">${esc(x.at || '')}</div><div class="trval">${trFmt(x.v, x.f)}</div></div>
    <div class="trf"><div class="trflbl">Formula</div><div class="trexpr">${pureSum ? `Sum of the ${x.terms.length} items below` : tok(false)}</div>${showNums ? `<div class="trexpr nums">${tok(true)} <span class="trop">=</span> <b>${trFmt(x.v, x.f)}</b></div>` : ''}</div>
    ${x.terms.length ? `<table class="trtbl"><tbody>${x.terms.map((t) => `<tr><td>${esc(t.label)}</td><td class="n">${trRefSpec(t.ref) ? `<button class="trnumlink" data-trgo="${trRefSpec(t.ref)}">${trFmt(t.v, t.f)}</button>` : trFmt(t.v, t.f)}</td><td class="trsrc">${trSource(t)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${(x.notes || []).filter(Boolean).map((n) => `<div class="note">${esc(n)}</div>`).join('')}
    ${TR.stack.length > 1 ? `<div class="trpath sub">Path: ${TR.stack.map((s) => { const q = trResolve(s); return q ? esc(q.title) : ''; }).join(' › ')}</div>` : ''}</div>`;
}
function traceOpen(spec, push) { if (push) TR.stack.push(spec); else TR.stack = [spec]; renderTrace(); }
document.addEventListener('click', (e) => {
  const g = e.target.closest && e.target.closest('[data-trgo],[data-trback],[data-trclose],[data-trin],[data-trtab]');
  if (g) {
    e.preventDefault();
    if (g.dataset.trgo) return traceOpen(g.dataset.trgo, true);
    if (g.dataset.trback) { TR.stack.pop(); return renderTrace(); }
    if (g.dataset.trclose) { TR.stack = []; return renderTrace(); }
    if (g.dataset.trtab) { S.tab = g.dataset.trtab; renderTab(); return renderTrace(); }
    if (g.dataset.trin) { // jump to the input; the panel stays open
      const k = g.dataset.trin, tab = /^(assets)\./.test(k) ? 'assets' : 'inputs';
      if (tab === 'inputs') { const sid = inSecOf(k.replace(/^inputs\./, '')); if (sid) OPEN_SECS.add(sid); }
      S.tab = tab; renderTab(); renderTrace();
      setTimeout(() => { const el = document.querySelector(`[data-k="${CSS.escape(k)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); el.classList.add('iss-flash'); setTimeout(() => el.classList.remove('iss-flash'), 1600); } }, 30);
      return;
    }
  }
  const n = e.target.closest && e.target.closest('[data-tr]');
  if (n && S.view === 'project') { e.preventDefault(); traceOpen(n.dataset.tr, false); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && TR.stack.length && !$('#deckov') && !$('#pasteov')) { TR.stack = []; renderTrace(); } });
document.addEventListener('mousedown', (e) => {
  if (!e.target.classList || !e.target.classList.contains('dpgrip') || !e.target.closest('#trpanel')) return;
  e.preventDefault(); const el = $('#trpanel');
  const mv = (ev) => { TR.w = Math.max(360, Math.min(window.innerWidth - 420, window.innerWidth - ev.clientX)); el.style.width = TR.w + 'px'; document.body.style.paddingRight = TR.w + 'px'; };
  const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
});

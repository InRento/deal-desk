// ================= Tables like a spreadsheet (every table.grid-in) =================
// Select a cell or a block (click, Shift+click, drag, Shift+arrows, ⌘A), copy it (⌘C, tab-separated for Excel / Sheets),
// paste a block from Excel (⌘V) or one value into every selected cell, fill down (⌘D or the handle at the corner),
// clear (Delete). Dropdowns, dates and checkboxes take part. A whole paste / fill / clear is one undo step.
// The cells are the [data-k] controls in the table's own rows; values are written with setPath and saved once.
const G = { tbl: null, a: null, b: null, drag: false, fill: null, ti: -1 };
const gTables = () => [...document.querySelectorAll('#tabbody table.grid-in')];
const gRows = (tbl) => [...tbl.tBodies].flatMap((tb) => [...tb.rows]).filter((tr) => !tr.classList.contains('prof'));
const gCtl = (td) => (td ? td.querySelector(':scope > [data-k], :scope > * > [data-k]') : null);
function gCell(tbl, r, c) { const tr = gRows(tbl)[r]; return tr ? tr.cells[c] || null : null; }
function gPos(td) { const tbl = td.closest('table.grid-in'), tr = td.parentElement; return { tbl, r: gRows(tbl).indexOf(tr), c: td.cellIndex }; }
const gRange = () => (G.a && G.b ? { r0: Math.min(G.a.r, G.b.r), r1: Math.max(G.a.r, G.b.r), c0: Math.min(G.a.c, G.b.c), c1: Math.max(G.a.c, G.b.c) } : null);
const gMulti = () => { const R = gRange(); return !!R && (R.r1 > R.r0 || R.c1 > R.c0); };
function gPaint() {
  document.querySelectorAll('td.gs, td.ga').forEach((td) => td.classList.remove('gs', 'ga'));
  $('#ghandle')?.remove();
  if (!G.tbl || !document.body.contains(G.tbl) || !gRange()) return;
  const R = gRange(); let last = null;
  for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) { const td = gCell(G.tbl, r, c); if (td) { td.classList.add('gs'); last = td; } }
  const at = gCell(G.tbl, G.a.r, G.a.c); if (at) at.classList.add('ga');
  if (gMulti() || G.fill) {
    const end = gCell(G.tbl, R.r1, R.c1) || last; if (!end) return;
    const box = end.getBoundingClientRect(), h = document.createElement('div');
    h.id = 'ghandle'; h.title = 'Drag down to fill'; h.style.left = (box.right + window.scrollX - 4) + 'px'; h.style.top = (box.bottom + window.scrollY - 4) + 'px';
    document.body.appendChild(h);
  }
}
function gSet(tbl, a, b) { G.tbl = tbl; G.a = a; G.b = b || a; G.ti = gTables().indexOf(tbl); gPaint(); }
function gClear() { G.tbl = null; G.a = G.b = null; G.fill = null; gPaint(); }
// after a re-render the table is a new element: find it again by position and paint the same block
function gRestore() { if (G.ti < 0 || !G.a) return; const t = gTables()[G.ti]; if (!t) return gClear(); G.tbl = t; gPaint(); gAnchorFocus(); }
// keyboard and clipboard go to the anchor cell's control (also after a click on the cell's padding or a re-render)
function gAnchorFocus() { const el = G.a && gCtl(gCell(G.tbl, G.a.r, G.a.c)); if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }

// ---- reading and writing one cell
function gText(td) {
  const el = gCtl(td); if (!el) return (td.innerText || '').trim();
  if (el.type === 'checkbox') return el.checked ? 'TRUE' : 'FALSE';
  if (el.tagName === 'SELECT') return el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : '';
  return el.value;
}
function gKind(el, path) {
  const m = /^(\w+)\.\d+\.(\w+)$/.exec(path), T = m && PASTE_TABLES[m[1]], f = T && T.fields.find((x) => x[0] === m[2]);
  if (f) return f[2];
  if (!el) return 'text';
  if (el.type === 'checkbox') return 'check';
  if (el.type === 'date') return 'date';
  return el.dataset.kind || 'text';
}
function gValue(el, path, raw, frac) {
  const kind = gKind(el, path);
  if (el && el.tagName === 'SELECT') { // a dropdown: the parsed value, else the option whose text or value matches
    const opts = [...el.options], s = String(raw ?? '').trim().toLowerCase(), v = pValue(kind, raw);
    const hit = opts.find((o) => o.value === v) || opts.find((o) => o.text.trim().toLowerCase() === s || o.value.toLowerCase() === s) || opts.find((o) => s && o.text.toLowerCase().startsWith(s));
    return hit ? hit.value : undefined;
  }
  if (kind === 'check') return pBool(raw, false);
  if (['money', 'num', 'int', 'pct', 'date'].includes(kind)) return pValue(kind === 'int' ? 'num' : kind, raw, { fraction: frac });
  return pValue(kind, raw);
}
// write {path: value}; one save = one undo step; source tags on changed fields become "changed by you"
function gWrite(changes, msg) {
  const p = cur(); if (!p) return;
  if (!canEdit(S.curId)) return toast('Lock the deal to change it');
  let n = 0;
  for (const [k, v] of changes) {
    if (v === undefined) continue;
    if (getPath(p, k) === v) continue;
    setPath(p, k, v); n++;
    const s = p.inputs.sources && p.inputs.sources[k]; if (s && !s.edited) s.edited = true;
  }
  if (!n) return toast('Nothing changed');
  undoKey = null; scheduleSave(S.curId); recalc(true); renderTab(); gRestore();
  if (msg) toast(msg.replace('{n}', n));
}
// the path of a cell, also for rows that do not exist yet (pasting below the last row adds rows)
function gPathAt(tbl, r, c) {
  const td = gCell(tbl, r, c), el = gCtl(td); if (el) return { el, path: el.dataset.k };
  if (td) return null;
  let colPath = null; for (const tr of gRows(tbl)) { const x = gCtl(tr.cells[c]); if (x) colPath = x.dataset.k; }
  const m = colPath && /^(assets|adjustments|tranches|debts|revLines|costLines)\.(\d+)\.(\w+)$/.exec(colPath); if (!m) return null;
  const list = cur()[m[1]], rows = gRows(tbl).filter((tr) => [...tr.cells].some((x) => gCtl(x)));
  return { el: null, path: `${m[1]}.${list.length + (r - rows.length)}.${m[3]}`, add: m[1] };
}

// ---- actions
function gCopyText() {
  const R = gRange(); const lines = [];
  for (let r = R.r0; r <= R.r1; r++) { const row = []; for (let c = R.c0; c <= R.c1; c++) { const td = gCell(G.tbl, r, c); row.push(td ? gText(td).replace(/[\t\n]/g, ' ') : ''); } lines.push(row.join('\t')); }
  return lines.join('\n');
}
function gPaste(text) {
  const R = gRange(), grid = parseTSV(text); if (!grid.length) return;
  const single = grid.length === 1 && grid[0].length === 1;
  const h = single ? R.r1 - R.r0 + 1 : grid.length, w = single ? R.c1 - R.c0 + 1 : Math.max(...grid.map((x) => x.length));
  const kinds = []; for (let j = 0; j < w; j++) { const t = gPathAt(G.tbl, R.r0, R.c0 + j); kinds.push(t ? gKind(t.el, t.path) : 'text'); }
  const frac = single ? kinds.map(() => false) : fractionColumns(grid, kinds);
  const p = cur(), changes = [], added = new Set();
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const raw = single ? grid[0][0] : (grid[i] || [])[j]; if (raw === undefined) continue;
    const t = gPathAt(G.tbl, R.r0 + i, R.c0 + j); if (!t || (t.el && t.el.disabled)) continue;
    if (t.add) { const idx = +t.path.split('.')[1]; while (p[t.add].length <= idx) { p[t.add].push(PASTE_TABLES[t.add].blank()); added.add(t.add); } }
    changes.push([t.path, gValue(t.el, t.path, raw, frac[j])]);
  }
  G.b = { r: R.r0 + h - 1, c: R.c0 + w - 1 };
  gWrite(changes, single ? 'Filled {n} cells' : `Pasted ${h} row${h > 1 ? 's' : ''} × ${w} column${w > 1 ? 's' : ''}${added.size ? ' (rows added)' : ''}`);
}
function gFillDown(R, to) { // R = source block; to = last row to fill (repeats the source rows, like Excel)
  const changes = [], src = R.r1 - R.r0 + 1;
  for (let c = R.c0; c <= R.c1; c++) for (let r = R.r1 + 1; r <= to; r++) {
    const from = gCtl(gCell(G.tbl, R.r0 + ((r - R.r1 - 1) % src), c)), t = gCtl(gCell(G.tbl, r, c)); if (!from || !t || t.disabled) continue;
    changes.push([t.dataset.k, from.type === 'checkbox' ? from.checked : from.value]);
  }
  G.b = { r: to, c: R.c1 };
  gWrite(changes, 'Filled {n} cells');
}
function gClearCells() {
  const R = gRange(), changes = [];
  for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
    const el = gCtl(gCell(G.tbl, r, c)); if (!el || el.disabled) continue;
    if (el.type === 'checkbox') changes.push([el.dataset.k, false]);
    else if (el.tagName === 'SELECT') { const blank = [...el.options].find((o) => o.value === ''); if (blank) changes.push([el.dataset.k, '']); }
    else changes.push([el.dataset.k, '']);
  }
  gWrite(changes, 'Cleared {n} cells');
}
function gFocus(r, c) { const el = gCtl(gCell(G.tbl, r, c)); if (el) { el.focus(); if (el.select && el.type !== 'date' && el.type !== 'checkbox') el.select(); } }

// ---- mouse: click selects, Shift+click / drag selects a block, the corner handle fills down
document.addEventListener('mousedown', (e) => {
  if (S.view !== 'project') return;
  if (e.target.id === 'ghandle') { e.preventDefault(); G.fill = { R: gRange(), to: gRange().r1 }; document.body.classList.add('gdrag'); return; }
  const td = e.target.closest && e.target.closest('table.grid-in td'); if (!td || e.target.closest('button')) { if (!e.target.closest('#ghandle')) gClear(); return; }
  if (td.closest('table.grid-in') !== td.closest('table')) return; // a nested table inside a row
  const P = gPos(td); if (P.r < 0) return;
  if (e.shiftKey && G.tbl === P.tbl && G.a) { e.preventDefault(); G.b = { r: P.r, c: P.c }; gPaint(); return; }
  gSet(P.tbl, { r: P.r, c: P.c }); G.drag = true;
  if (!e.target.closest('[data-k]')) { e.preventDefault(); gAnchorFocus(); } // clicked beside the field: still select the cell
});
document.addEventListener('mouseover', (e) => {
  if (!G.drag && !G.fill) return;
  const td = e.target.closest && e.target.closest('table.grid-in td'); if (!td || td.closest('table.grid-in') !== G.tbl) return;
  const P = gPos(td); if (P.r < 0) return;
  if (G.fill) { G.fill.to = Math.max(G.fill.R.r1, P.r); G.b = { r: G.fill.to, c: G.fill.R.c1 }; gPaint(); return; }
  if (P.r !== G.b.r || P.c !== G.b.c) {
    G.b = { r: P.r, c: P.c }; document.body.classList.add('gdrag');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.getSelection()?.removeAllRanges(); gPaint();
  }
});
document.addEventListener('mouseup', () => {
  if (G.fill) { const f = G.fill; G.fill = null; document.body.classList.remove('gdrag'); if (f.to > f.R.r1) return gFillDown(f.R, f.to); return gPaint(); }
  if (G.drag) { G.drag = false; document.body.classList.remove('gdrag'); if (gMulti()) { const at = gCtl(gCell(G.tbl, G.a.r, G.a.c)); if (at) at.focus({ preventScroll: true }); } }
});
document.addEventListener('focusin', (e) => { // Tab or a click into a cell starts a new selection there
  const el = e.target; if (!el.dataset || !el.dataset.k || G.drag) return;
  const td = el.closest('table.grid-in td'); if (!td) return;
  const P = gPos(td); if (P.r < 0) return;
  if (G.tbl === P.tbl && gMulti() && G.a.r === P.r && G.a.c === P.c) return; // focus put back on the anchor of a block
  gSet(P.tbl, { r: P.r, c: P.c });
});

// the event comes from a cell of the selected table's own rows (not a nested month row) – else it is not ours
function gOwn(el) {
  if (!G.tbl || !G.a || !document.body.contains(G.tbl)) return false;
  if (el === document.body && gMulti()) return true; // a block selected by dragging, focus nowhere
  if (!el || !el.closest) return false;
  const td = el.closest('td'); if (!td || td.closest('table.grid-in') !== G.tbl) return false;
  return gPos(td).r >= 0;
}
// ---- keyboard
document.addEventListener('keydown', (e) => {
  if (S.view !== 'project') return;
  const el = e.target; if (!gOwn(el)) return;
  const mod = e.metaKey || e.ctrlKey, R = gRange(), rows = gRows(G.tbl).length;
  const caretEdge = (dir) => { try { const n = el.value.length; return el.selectionStart === el.selectionEnd && (dir < 0 ? el.selectionStart === 0 : el.selectionEnd === n); } catch { return true; } };
  const isText = el.tagName === 'INPUT' && !['checkbox', 'date'].includes(el.type);
  if (e.shiftKey && !mod && e.key.startsWith('Arrow')) { // extend the block
    if (!gMulti() && isText && ['ArrowLeft', 'ArrowRight'].includes(e.key) && !caretEdge(e.key === 'ArrowLeft' ? -1 : 1)) return; // selecting text inside the cell
    e.preventDefault();
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    G.b = { r: Math.max(0, Math.min(rows - 1, G.b.r + d[0])), c: Math.max(0, G.b.c + d[1]) }; gPaint(); return;
  }
  if (!e.shiftKey && !mod && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && el.tagName !== 'SELECT') { // move like a spreadsheet
    const r = G.a.r + (e.key === 'ArrowUp' ? -1 : 1); if (r < 0 || r >= rows || !gCtl(gCell(G.tbl, r, G.a.c))) return;
    e.preventDefault(); gSet(G.tbl, { r, c: G.a.c }); gFocus(r, G.a.c); return;
  }
  if (!e.shiftKey && !mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (!isText || caretEdge(e.key === 'ArrowLeft' ? -1 : 1)) && el.tagName !== 'SELECT' && el.type !== 'date') {
    const dc = e.key === 'ArrowLeft' ? -1 : 1; let c = G.a.c + dc; const tr = gRows(G.tbl)[G.a.r];
    while (tr && c >= 0 && c < tr.cells.length && !gCtl(tr.cells[c])) c += dc;
    if (!tr || c < 0 || c >= tr.cells.length) return;
    e.preventDefault(); gSet(G.tbl, { r: G.a.r, c }); gFocus(G.a.r, c); return;
  }
  if (e.key === 'Escape' && gMulti()) { e.preventDefault(); gSet(G.tbl, G.a); return; }
  if (mod && e.key.toLowerCase() === 'a' && !e.shiftKey) { // second ⌘A (or ⌘A in an empty / fully selected cell) selects the table
    const all = !isText || !el.value || (el.selectionStart === 0 && el.selectionEnd === el.value.length) || gMulti();
    if (all) { e.preventDefault(); const tr0 = gRows(G.tbl); gSet(G.tbl, { r: 0, c: 0 }, { r: tr0.length - 1, c: Math.max(...tr0.map((t) => t.cells.length)) - 1 }); }
    return;
  }
  if (mod && e.key.toLowerCase() === 'd') { // fill down (one cell: copy the cell above)
    e.preventDefault();
    if (gMulti()) return gFillDown({ r0: R.r0, r1: R.r0, c0: R.c0, c1: R.c1 }, R.r1);
    if (G.a.r > 0) { const prev = { r0: G.a.r - 1, r1: G.a.r - 1, c0: G.a.c, c1: G.a.c }; return gFillDown(prev, G.a.r); }
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && gMulti()) { e.preventDefault(); gClearCells(); }
});
// ⌘C on a block (or on a cell with nothing selected inside it) copies the cells, tab-separated
document.addEventListener('copy', (e) => {
  const el = document.activeElement; if (!gOwn(el)) return;
  let partial = false; try { partial = el.selectionStart !== el.selectionEnd; } catch { partial = false; }
  if (!gMulti() && partial) return; // copying part of the text in a cell
  e.preventDefault(); e.clipboardData.setData('text/plain', gCopyText());
  toast(gMulti() ? 'Copied the selected cells' : 'Copied');
}, true);
// ⌘V: a block from Excel lands at the selected cell (by the visible columns); one value fills every selected cell
document.addEventListener('paste', (e) => {
  const el = e.target; if (!gOwn(el)) return;
  const text = e.clipboardData && e.clipboardData.getData('text/plain'); if (text == null) return;
  const block = /[\t\n]/.test(text.replace(/\n$/, ''));
  if (!block && !gMulti()) return; // one value into one cell: the normal paste
  e.preventDefault(); e.stopPropagation(); gPaste(text);
}, true);
window.addEventListener('resize', () => gPaint());

// Output refresh, editing, clicks and keyboard; undo / redo.
// ---------- outputs refresh ----------
let calcCache = null;
function outFor(key) {
  if (!calcCache) calcCache = { ...assetCalcs(), ...adjCalcs(), ...opsLineCalcs(), ...loanCalcs(trancheCalcs()) };
  if (key in calcCache) return calcCache[key];
  return OUT[key] ? OUT[key]() : '';
}
function refreshOutputs() {
  calcCache = null;
  renderKpis();
  if (S.view !== 'project' || !S.model) return;
  document.querySelectorAll('[data-hint]').forEach((h) => {
    const el = document.getElementById(h.dataset.hint); if (!el || el.disabled) { h.textContent = ''; return; }
    const raw = el.value; const kind = el.dataset.kind;
    if (!raw || /^-?\d+(\.\d+)?%?$/.test(raw.trim())) { h.textContent = ''; return; }
    const v = kind === 'pct' ? E.pct(raw, NaN) : E.num(raw, NaN);
    h.textContent = isNaN(v) ? 'not a number' : '= ' + (kind === 'pct' ? pctf(v, 3) : nf2.format(v));
  });
  document.querySelectorAll('[data-out]').forEach((o) => { o.innerHTML = outFor(o.dataset.out); });
  document.querySelectorAll('input.in:disabled[data-k]').forEach((el) => {
    const k = el.dataset.k.split('.').pop(); const r = S.model.r;
    const v = { revenue: r.revenue, purchase: r.purchase, equity: r.equity }[k]; if (v != null) el.value = nf2.format(v);
  });
  const tb = $('#tabs'); if (tb) tb.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  drawCharts();
  afterRefresh();
  if (TR.stack.length) renderTrace(); // the explanation follows the inputs
}

// ---------- editing ----------
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; } o[ks[ks.length - 1]] = val; }
const META = ['notes', 'name', 'borrower', 'country', 'projectType', 'contact', 'status', 'nextAction', 'nextOwner', 'nextDue'];
function onEdit(e) {
  const el = e.target; if (!el.dataset || !el.dataset.k || S.view !== 'project') return;
  const p = cur(); const k = el.dataset.k;
  const val = el.type === 'checkbox' ? el.checked : el.value;
  if (e.type === 'change' && getPath(p, k) === val) return;
  setPath(p, k, val);
  if (k === 'inputs.loansOn' && val && !p.loans.length) p.loans.push(blankLoan(), blankLoan()); // switching on starts with two loans
  undoKey = k; scheduleSave(S.curId); undoKey = null;
  if (k === 'name' || k === 'status') { const c = $('.crumb'); if (c) c.innerHTML = `/ <b>${esc(p.name)}</b> <span class="pill ${stCls(p.status)}">${esc(p.status)}</span>`; document.title = p.name + ' · Deal Desk'; }
  if (/^todos\.\d+\.done$/.test(k)) el.closest('.todo')?.classList.toggle('done', el.checked);
  if (/^judgement\./.test(k)) { if (el.tagName === 'SELECT') renderTab(); return; } // decision log: no model change
  if (META.includes(k) || /^todos/.test(k)) return;
  if (k === 'inputs.currency') CUR = val || 'EUR';
  const structural = (el.tagName === 'SELECT' || el.type === 'checkbox') && /^(inputs|revLines|costLines|tranches)\./.test(k) && !/Months\.\d+$/.test(k) && !/^debts\.\d+\.refinanced$/.test(k);
  if (structural) { recalc(true); renderTab(); return; }
  recalc(false);
}
document.addEventListener('input', onEdit);
document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'date') onEdit(e); });
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'newtodo' && e.key === 'Enter' && e.target.value.trim()) {
    cur().todos.push({ text: e.target.value.trim(), done: false, category: 'Open item', due: '' }); scheduleSave(S.curId); renderTab(); setTimeout(() => $('#newtodo')?.focus(), 0);
  }
  if (e.key === 'Enter' && e.target.closest && e.target.closest('tr[data-open]')) go('project', e.target.closest('tr[data-open]').dataset.open, 'overview');
});
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-tab],[data-open],[data-filter],[data-cf]'); if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.confirmDel = false; renderTab(); return; }
  if (t.dataset.open) return go('project', t.dataset.open, 'overview');
  if (t.dataset.filter) { S.filter = t.dataset.filter; return renderHome(); }
  if (t.dataset.cf) { S.cfMode = t.dataset.cf; return renderTab(); }
  const p = cur(), a = t.dataset.act, i = t.dataset.i != null && /^\d+$/.test(t.dataset.i) ? +t.dataset.i : t.dataset.i;
  const edit = (fn) => { fn(); scheduleSave(S.curId); recalc(true); renderTab(); };
  if (/^jd-/.test(a || '') && jdAction(a)) return;
  switch (a) {
    case 'home': return go('home');
    case 'new': return newProject();
    case 'dup': return newProject(S.curId);
    case 'del': S.confirmDel = true; return renderTab();
    case 'del-no': S.confirmDel = false; return renderTab();
    case 'del-yes': return deleteProject(S.curId);
    case 'add-asset': return edit(() => p.assets.push(blankAsset()));
    case 'del-asset': return edit(() => p.assets.splice(i, 1));
    case 'add-adj': return edit(() => p.adjustments.push(blankAdj()));
    case 'del-adj': return edit(() => p.adjustments.splice(i, 1));
    case 'add-tranche': return edit(() => p.tranches.push(Object.assign(blankTranche(), p.tranches.length ? {} : { date: p.inputs.drawdown, amount: p.inputs.loan || '' })));
    case 'del-tranche': return edit(() => p.tranches.splice(i, 1));
    case 'add-loan': return edit(() => p.loans.push(blankLoan()));
    case 'del-loan': return edit(() => { p.loans.splice(i, 1); for (const t of p.tranches) { const n = E.num(t.loan, 1); if (n > i + 1) t.loan = String(n - 1); else if (n === i + 1) t.loan = ''; } }); // tranches of a removed loan go to Loan 1
    case 'cf-loans': S.cfLoans = !S.cfLoans; return renderTab();
    case 'add-debt': return edit(() => p.debts.push(blankDebt()));
    case 'del-debt': return edit(() => p.debts.splice(i, 1));
    case 'add-pay': return edit(() => p.inputs.payPlan.push({ pct: '', months: '' }));
    case 'del-pay': return edit(() => p.inputs.payPlan.splice(i, 1));
    case 'add-constr': return edit(() => p.constrLines.push(blankConstr()));
    case 'del-constr': return edit(() => p.constrLines.splice(i, 1));
    case 'add-rev': return edit(() => { p.revLines.push(blankRev()); if (p.inputs.opModel !== 'detailed') p.inputs.opModel = 'detailed'; });
    case 'del-rev': S.openLine = null; return edit(() => p.revLines.splice(i, 1));
    case 'add-cost': return edit(() => { p.costLines.push(blankCost()); if (p.inputs.opModel !== 'detailed') p.inputs.opModel = 'detailed'; });
    case 'del-cost': S.openLine = null; return edit(() => p.costLines.splice(i, 1));
    case 'toggle-line': S.openLine = S.openLine === i ? null : i; return renderTab();
    case 'del-todo': p.todos.splice(i, 1); scheduleSave(S.curId); return renderTab();
    case 'add-sc': return edit(() => p.scenarios.push(zeroSc('Scenario ' + (p.scenarios.length + 1))));
    case 'del-sc': return edit(() => p.scenarios.splice(i, 1));
    case 'reset-sc': return edit(() => (p.scenarios = DEFAULT_SCEN()));
    case 'deck': return openDeck();
    case 'export-xlsx': return exportXlsx();
    case 'export-csv': return exportCsv();
    case 'export-json': return saveFile(slug(p.name) + '.json', JSON.stringify(stripMeta(p), null, 1));
    case 'backup-db': return backupDb();
    case 'backup': return saveFile('deal-desk-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(Object.fromEntries(Object.entries(S.projects).map(([k, v]) => [k, stripMeta(v)])), null, 1));
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; const pos = e.target.selectionStart; renderHome(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); } });
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'importf' || !e.target.files[0]) return;
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const list = data.inputs ? [data] : Object.values(data);
    let n = 0; for (const raw of list) { if (!raw || !raw.inputs) continue; const id = uid(); const p = normalise(clone(raw)); delete p.id; p._new = true; p.createdAt = p.createdAt || new Date().toISOString(); S.projects[id] = p; saveNow(id); n++; }
    toast(n ? `Imported ${n} project${n > 1 ? 's' : ''}` : 'No projects found in that file'); renderHome();
  } catch { toast('That file is not a Deal Desk JSON export'); }
});
let rsT; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(drawCharts, 150); });
window.addEventListener('beforeunload', (e) => { if (S.dirty.size) { e.preventDefault(); e.returnValue = ''; } });

// ================= Undo / redo (⌘Z, ⇧⌘Z) =================
// Every change goes through scheduleSave(); before it, we compare the project with the last known state and push that state.
// Typing in one field is merged into one step (same field, less than 1.5 s between keystrokes).
const UNDO = {}; let undoKey = null, undoBusy = false;
const UNDO_MAX = 200;
const snapOf = (p) => { const c = Object.assign({}, p); delete c.updatedAt; delete c.metrics; delete c._new; delete c.id; delete c.createdAt; return JSON.stringify(c); };
function undoInit(id) { const p = S.projects[id]; if (!p || UNDO[id]) return; UNDO[id] = { base: snapOf(p), undo: [], redo: [], t: 0, key: null }; }
function undoTrack(id) {
  const u = UNDO[id], p = S.projects[id]; if (!u || !p || undoBusy) return;
  const now = snapOf(p); if (now === u.base) return;
  const t = Date.now();
  if (undoKey && undoKey === u.key && t - u.t < 1500) { u.base = now; u.t = t; return; } // same field, still typing
  u.undo.push(u.base); if (u.undo.length > UNDO_MAX) u.undo.shift();
  u.redo = []; u.base = now; u.t = t; u.key = undoKey;
  undoButtons();
}
function undoStep(dir) {
  const id = S.curId, u = UNDO[id]; if (!u || S.view !== 'project') return;
  const from = dir < 0 ? u.undo : u.redo, to = dir < 0 ? u.redo : u.undo;
  if (!from.length) { toast(dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); return; }
  const p = S.projects[id];
  to.push(snapOf(p)); const snap = from.pop();
  const keep = { id: p.id, _new: p._new, createdAt: p.createdAt, updatedAt: p.updatedAt, metrics: p.metrics };
  const np = JSON.parse(snap); for (const k of Object.keys(keep)) if (keep[k] !== undefined) np[k] = keep[k];
  S.projects[id] = np; u.base = snap; u.key = null; u.t = 0;
  undoBusy = true; try { scheduleSave(id); } finally { undoBusy = false; }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  CUR = np.inputs.currency || 'EUR'; S.openLine = null; recalc(true);
  const y = window.scrollY; render(); window.scrollTo(0, y);
  toast(`${dir < 0 ? 'Undone' : 'Redone'}${from.length ? ` · ${from.length} more step${from.length > 1 ? 's' : ''} ${dir < 0 ? 'to undo' : 'to redo'}` : ''}`);
}
function undoButtons() {
  const u = UNDO[S.curId], a = $('#undo-btn'), b = $('#redo-btn');
  if (a) a.disabled = !u || !u.undo.length; if (b) b.disabled = !u || !u.redo.length;
}
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || S.view !== 'project') return;
  const k = e.key.toLowerCase(); if (k !== 'z' && k !== 'y') return;
  if ($('#pasteov') || $('#deckov')) return; // dialogs keep their own undo
  const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !(t.dataset && t.dataset.k);
  if (typing) return; // search box, new to-do, version label: normal text undo
  e.preventDefault();
  undoStep(k === 'y' || e.shiftKey ? 1 : -1);
});
document.addEventListener('click', (e) => { const b = e.target.closest('#undo-btn,#redo-btn'); if (b) undoStep(b.id === 'undo-btn' ? -1 : 1); });

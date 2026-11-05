// ================= Versions v2: switcher, live editable versions, side-by-side comparison, automatic change notes =================
// The project row is the working copy of the open version (inputs.activeVersion). Every save also updates that version,
// so versions are live alternatives. Switching saves the open one first; a project without an open version gets a "Main" version
// on the first switch or "New version".
const vAll = () => S.versions || [];
const vActiveId = () => { const p = cur(); const a = p && p.inputs.activeVersion; return a ? +a : null; };
const vById = (id) => vAll().find((v) => v.id === id);
const vData = (p) => { const d = stripMeta(p); return d; };
S.cmpSel = null;

async function vSyncActive(id) {
  const p = S.projects[id]; if (!p || id !== S.curId) return;
  const aid = p.inputs.activeVersion ? +p.inputs.activeVersion : null; if (!aid) return;
  const data = vData(p);
  try { await api('PUT', `/api/versions/${aid}`, { data, metrics: metricsOf(p) }); const v = vById(aid); if (v) { v.data = data; v.updatedAt = new Date().toISOString(); } } catch (e) { /* the project itself is saved; the version catches up on the next save */ }
}

async function vEnsureSaved() { // make sure the current inputs live in a version; returns its id
  const id = S.curId, p = cur(); await flush(id);
  const aid = vActiveId();
  if (aid && vById(aid)) { await api('PUT', `/api/versions/${aid}`, { data: vData(p), metrics: metricsOf(p, S.modelOrig || S.model) }); return aid; }
  p.inputs.activeVersion = '';
  const r = await api('POST', `/api/projects/${encodeURIComponent(id)}/versions`, { label: 'Main', data: vData(p), metrics: metricsOf(p, S.modelOrig || S.model) });
  return r.id;
}
async function vSwitch(vid) {
  const id = S.curId, p = cur();
  if (vid === vActiveId()) return;
  try { await vEnsureSaved(); } catch (e) { toast('Could not save the current version: ' + e.message); return; }
  await loadSide();
  const v = vById(vid); if (!v) { toast('Version not found'); return; }
  const data = normalise(clone(v.data)); data.createdAt = p.createdAt; delete data.id; data.inputs.activeVersion = String(vid);
  const keep = DEAL_LEVEL(p); // stage, next action, open items, decision log, deck description, benefits and risks belong to the deal, not the version
  Object.assign(data, { status: keep.status, nextAction: keep.nextAction, nextOwner: keep.nextOwner, nextDue: keep.nextDue, todos: keep.todos, judgement: keep.judgement });
  Object.assign(data.inputs, { benefits: keep.benefits, risks: keep.risks, deckDesc: keep.deckDesc });
  S.projects[id] = data; delete UNDO[id]; undoInit(id);
  scheduleSave(id, 10); recalc(true); render();
  toast(`Now on “${v.label}”. Edits are saved into this version.`);
}
async function vCreate(label) {
  const id = S.curId; let parent;
  try { parent = await vEnsureSaved(); } catch (e) { toast('Could not save the current version: ' + e.message); return; }
  const p = cur();
  try {
    const r = await api('POST', `/api/projects/${encodeURIComponent(id)}/versions`, { label, data: vData(p), metrics: metricsOf(p, S.modelOrig || S.model), parentId: parent });
    p.inputs.activeVersion = String(r.id); delete UNDO[id]; undoInit(id); scheduleSave(id, 10);
    await loadSide(); render();
    const par = vById(parent); toast(`Created “${label}”${par ? ` from “${par.label}”` : ''}. You are now editing it.`);
  } catch (e) { toast('Could not create the version: ' + e.message); }
}
function vNewDialog() {
  let ov = $('#vnewov'); if (ov) ov.remove();
  const a = vById(vActiveId());
  ov = document.createElement('div'); ov.id = 'vnewov'; ov.className = 'deckov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'New version');
  ov.innerHTML = `<div class="card vnewbox"><h2>New version</h2><div class="sub" style="margin:4px 0 12px">A copy of ${a ? `“${esc(a.label)}”` : 'the current inputs'}. You'll be editing the new version; the original stays as it is${a ? '' : ' (saved as “Main”)'}.</div>
    <input id="vnewname" class="in" placeholder="e.g. 70% LTV + 30 months" style="width:100%" aria-label="Version name">
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" data-vn="cancel">Cancel</button><button class="btn primary" data-vn="ok">Create</button></div></div>`;
  document.body.appendChild(ov); $('#vnewname').focus();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vn]'); if (!b) return;
  const name = ($('#vnewname') || {}).value; $('#vnewov').remove();
  if (b.dataset.vn === 'ok') vCreate((name || '').trim() || `Version ${vAll().length + 1}`);
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'vnewname' && e.key === 'Enter') { const n = e.target.value.trim(); $('#vnewov').remove(); vCreate(n || `Version ${vAll().length + 1}`); }
  if (e.key === 'Escape' && $('#vnewov')) $('#vnewov').remove();
});

// ---- switcher in the top bar (replaces "Save version")
function vSwitcher() {
  const p = cur(); if (!p) return '';
  const vs = vAll().slice().sort((a, b) => a.id - b.id), aid = vActiveId();
  const opts = (aid && vById(aid) ? '' : `<option value="" selected>${vs.length ? 'Working copy (not a version yet)' : 'Main'}</option>`) +
    vs.map((v) => `<option value="${v.id}" ${v.id === aid ? 'selected' : ''}>${esc(v.label)}</option>`).join('') + '<option value="__new">＋ New version from this…</option>';
  return `<label class="vswitch" title="Switch between versions of this deal"><span class="sub">Version</span><select id="vsel" class="in" aria-label="Version">${opts}</select></label>`;
}
document.addEventListener('change', (e) => {
  if (e.target.id !== 'vsel') return;
  const v = e.target.value;
  if (v === '__new') { e.target.value = vActiveId() || ''; return vNewDialog(); }
  if (v) vSwitch(+v);
});
// "Save version" (any button with that action) opens the dialog; old Restore = switch
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="save-version"],[data-act="restore-version"],[data-act="open-version"],[data-act="del-version2"]'); if (!b || S.view !== 'project') return;
  e.stopImmediatePropagation(); e.preventDefault();
  const a = b.dataset.act, id = +b.dataset.i;
  if (a === 'save-version') return vNewDialog();
  if (a === 'restore-version' || a === 'open-version') return vSwitch(id);
  if (a === 'del-version2') { if (id === vActiveId()) return toast('Switch to another version before deleting this one'); return api('DELETE', '/api/versions/' + id).then(async () => { if (S.cmpSel) S.cmpSel.delete(id); await loadSide(); renderTab(); toast('Version deleted'); }); }
}, true);

// ---- automatic change notes: what differs from the version it was created from
const V_SKIP = /^(updatedAt|createdAt|metrics|id|_new|_meta|notes|todos|name|status|borrower|country|projectType|contact|grid|inputs\.(sources|ignoredChecks|activeVersion|showAll|dealType))/;
const V_TABLES = { tranches: 'Drawdown schedule', assets: 'Collateral & sales', adjustments: 'Adjustments', debts: 'Existing debts', constrLines: 'Construction budget', revLines: 'Revenue lines', costLines: 'Cost lines', scenarios: 'Stress scenarios' };
function vLabels() { const L = {}; for (const [, , fs] of INPUT_SECTIONS()) for (const f of fs) L['inputs.' + f.k] = f.label; return L; }
const vFmt = (s) => { const n = Number(s); return s !== '' && s != null && isFinite(n) && /^-?[\d.]+$/.test(String(s)) ? nf0.format(Math.round(n * 100) / 100) : (s === '' || s == null ? '–' : String(s)); };
function vDiff(a, b) { // list of short human-readable changes from a to b
  const A = normalise(clone(a)), B = normalise(clone(b)), L = vLabels(), out = [];
  const fa = flat(A), fb = flat(B);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => !V_SKIP.test(k) && (fa[k] ?? '') !== (fb[k] ?? ''));
  const tables = {};
  for (const k of keys) {
    const t = k.split(/[.[]/)[0];
    if (V_TABLES[t]) { (tables[t] = tables[t] || new Set()).add((k.match(/^\w+\[(\d+)\]/) || [, '?'])[1]); continue; }
    const base = k.replace(/\[\d+\]$/, '');
    if (L[base]) out.push(k.match(/\[\d+\]$/) ? `${L[base]} changed` : `${L[base]}: ${vFmt(fa[k])} → ${vFmt(fb[k])}`);
  }
  const sum = (o, t, f) => (o[t] || []).reduce((s, r) => s + E.num(r[f]), 0);
  for (const [t, rows] of Object.entries(tables)) {
    const na = (A[t] || []).length, nb = (B[t] || []).length;
    let s = `${V_TABLES[t]}: ${rows.size} row${rows.size > 1 ? 's' : ''} changed${na !== nb ? ` (${na} → ${nb} rows)` : ''}`;
    if (t === 'tranches' && sum(A, t, 'amount') !== sum(B, t, 'amount')) s = `${V_TABLES[t]}: total ${nf0.format(sum(A, t, 'amount'))} → ${nf0.format(sum(B, t, 'amount'))}${na !== nb ? ` (${na} → ${nb} tranches)` : ''}`;
    if (t === 'assets' && sum(A, t, 'salePrice') !== sum(B, t, 'salePrice')) s += `; sale prices ${nf0.format(sum(A, t, 'salePrice'))} → ${nf0.format(sum(B, t, 'salePrice'))}`;
    if (t === 'adjustments' && sum(A, t, 'amount') !== sum(B, t, 'amount')) s += `; amounts ${nf0.format(sum(A, t, 'amount'))} → ${nf0.format(sum(B, t, 'amount'))}`;
    out.push(s);
  }
  return out;
}
const vDataOf = (v) => (v.id === vActiveId() ? vData(cur()) : v.data);

// ---- metrics for one version (used by the side-by-side table and the deck slide)
const V_CACHE = {};
function vMetrics(v) {
  const live = v.id === vActiveId();
  const key = v.id + ':' + (live ? 'live' + (S.ver[S.curId] || 0) : v.updatedAt || v.createdAt);
  if (V_CACHE[key]) return V_CACHE[key];
  const p = live ? cur() : normalise(clone(v.data));
  let m; try { m = E.run(p); } catch (e) { return (V_CACHE[key] = { err: String(e) }); }
  const s = m.summary, r = m.r;
  // break-even average price per m² (principal + interest + returns covered by sales), as on the Sensitivity tab
  const R = E.resolve(p), sales = r.assets.filter((a) => a.salePrice != null && a.saleDate != null && a.area > 0);
  let avg = null, be = null, drop = null;
  if (sales.length) {
    avg = sales.reduce((x, a) => x + a.salePrice, 0) / sales.reduce((x, a) => x + a.area, 0);
    const ok = (x) => { const mm = E.run(p, Object.assign({}, E.ZERO_DEV, { salePrice: -x }), { resolved: R }); const ss = mm.summary, T = Math.min(mm.r.term, mm.rows.length - 1), rows = mm.rows.slice(1, T + 1); const net = rows.reduce((a, x) => a + x.netSale, 0); const owed = ss.facility + ss.interest - ss.intReserve + ss.gains + ss.pshare + rows.reduce((a, x) => a + x.extFee + x.prepay + x.exit + x.commit, 0); return net >= owed - 1; };
    if (ok(0)) { let lo = 0, hi = 0.95; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; } drop = lo; be = avg * (1 - lo); } else drop = -1;
  }
  let lint0 = []; try { lint0 = lint(p, m).filter((x) => !x.ignored); } catch (e) {}
  return (V_CACHE[key] = { facility: s.facility, rate: r.rate, term: r.termBase, ltv0: s.ltv0, ltvFs0: s.ltvFs0, maxLtv: s.maxLtv, avg, be, drop, lowCash: s.lowCashPre, repaid: s.repaidDate, irr: s.irr, profit: s.profit, mistakes: lint0.filter((x) => x.sev === 'error').length, flags: s.flags + lint0.filter((x) => x.sev === 'warn').length, cur: p.inputs.currency || 'EUR' });
}
const V_ROWS = [
  ['Facility', 'facility', (v) => money(v), 0], ['Rate', 'rate', (v) => pctf(v, 2), 0], ['Term', 'term', (v) => v + ' m', 0],
  ['LTV at drawdown (market)', 'ltv0', (v) => pctf(v), -1], ['LTV at drawdown (lending value)', 'ltvFs0', (v) => pctf(v), -1], ['Highest LTV during the loan', 'maxLtv', (v) => pctf(v), -1],
  ['Average planned price per m²', 'avg', (v) => (v == null ? '–' : money(v)), 0], ['Break-even price per m²', 'be', (v) => (v == null ? '–' : money(v)), -1], ['Price can fall', 'drop', (v) => (v == null ? '–' : v < 0 ? 'fails at plan' : '−' + (v * 100).toFixed(1) + '%'), 1],
  ['Lowest borrower cash before exit', 'lowCash', (v) => money(v), 1], ['Loan repaid', 'repaid', (v) => (v == null ? 'not repaid' : datef(v)), -1],
  ['InRento IRR', 'irr', (v) => pctf(v, 1), 1], ['Lender profit', 'profit', (v) => money(v), 1], ['Likely mistakes', 'mistakes', (v) => String(v), -1], ['Flags to check', 'flags', (v) => String(v), -1],
];
function vSelected() {
  const vs = vAll(); if (!vs.length) return [];
  if (!S.cmpSel) { const a = vById(vActiveId()); S.cmpSel = new Set(a ? [a.id, ...(a.parentId && vById(a.parentId) ? [a.parentId] : [])] : vs.slice(0, 2).map((v) => v.id)); }
  return vs.filter((v) => S.cmpSel.has(v.id)).sort((a, b) => a.id - b.id);
}
function vCompareTable(sel, deck) {
  const ms = sel.map(vMetrics);
  const best = (k, dir) => { if (!dir) return null; const vals = ms.map((m) => m[k]).filter((x) => x != null && isFinite(x)); if (vals.length < 2) return null; return dir > 0 ? Math.max(...vals) : Math.min(...vals); };
  const rows = V_ROWS.map(([l, k, f, dir]) => { const b = best(k, dir); const allSame = ms.every((m) => m[k] === ms[0][k]);
    return `<tr><td>${l}</td>${ms.map((m) => `<td class="n ${b != null && !allSame && m[k] === b ? (deck ? 'dk-best' : 'vbest') : ''}">${m.err ? '–' : f(m[k])}</td>`).join('')}</tr>`; }).join('');
  const head = `<tr class="${deck ? 'th' : ''}"><${deck ? 'td' : 'th'}>${deck ? 'Structure' : 'Metric'}</${deck ? 'td' : 'th'}>${sel.map((v) => `<${deck ? 'td' : 'th'} class="n">${esc(v.label)}${!deck && v.id === vActiveId() ? ' <span class="pill info">open</span>' : ''}</${deck ? 'td' : 'th'}>`).join('')}</tr>`;
  return deck ? `<table class="dk-t dk-compact">${head}${rows}</table>` : `<div class="tblwrap"><table class="vcmp"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
function vInputDiffs(sel) {
  const fl = sel.map((v) => flat(normalise(clone(vDataOf(v))))), L = vLabels();
  const keys = [...new Set(fl.flatMap((f) => Object.keys(f)))].filter((k) => !V_SKIP.test(k) && fl.some((f) => (f[k] ?? '') !== (fl[0][k] ?? '')));
  if (!keys.length) return '<div class="sub">The selected versions have identical inputs.</div>';
  const nice = (k) => { const base = k.replace(/\[\d+\]$/, ''); if (L[base]) return L[base] + (k.match(/\[(\d+)\]$/) ? ' – ' + MON[+k.match(/\[(\d+)\]$/)[1] - 1] : ''); const m = /^(\w+)\[(\d+)\]\.(\w+)/.exec(k); if (m && V_TABLES[m[1]]) return `${V_TABLES[m[1]]} › row ${m[2]} › ${m[3]}`; return k; };
  return `<div class="tblwrap" style="max-height:50vh"><table><thead><tr><th>Input</th>${sel.map((v) => `<th>${esc(v.label)}</th>`).join('')}</tr></thead><tbody>${keys.slice(0, 250).map((k) => `<tr><td class="sub">${esc(nice(k))}</td>${fl.map((f) => `<td class="num">${esc(vFmt(f[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${keys.length > 250 ? `<div class="sub">${keys.length - 250} more…</div>` : ''}`;
}
function tabVersions() {
  const vs = vAll(); if (S.versions == null) return '<div class="empty">Loading versions…</div>';
  const aid = vActiveId(), sel = vSelected();
  const list = vs.length ? vs.slice().sort((a, b) => a.id - b.id).map((v) => {
    const par = v.parentId ? vById(v.parentId) : null;
    let note = ''; if (par) { try { const d = vDiff(vDataOf(par), vDataOf(v)); note = d.length ? d.slice(0, 4).map(esc).join(' · ') + (d.length > 4 ? ` · +${d.length - 4} more` : '') : 'no changes yet'; } catch (e) { note = ''; } }
    return `<tr class="${v.id === aid ? 'sel' : ''}"><td><input type="checkbox" class="vpick" data-i="${v.id}" ${S.cmpSel && S.cmpSel.has(v.id) ? 'checked' : ''} aria-label="Compare ${esc(v.label)}"></td>
      <td><div class="row" style="gap:6px;flex-wrap:nowrap"><input class="in vlabel" data-i="${v.id}" value="${esc(v.label)}" aria-label="Version name">${v.id === aid ? '<span class="pill info">open</span>' : ''}</div></td>
      <td class="sub">${par ? 'from “' + esc(par.label) + '”' : ''}${note ? `<div class="vnote">${note}</div>` : ''}</td>
      <td class="sub">${new Date(v.updatedAt || v.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
      <td><div class="row" style="flex-wrap:nowrap;gap:4px">${v.id === aid ? '' : `<button class="btn sm" data-act="open-version" data-i="${v.id}">Open</button><button class="xbtn" data-act="del-version2" data-i="${v.id}" aria-label="Delete ${esc(v.label)}">×</button>`}</div></td></tr>`;
  }).join('') : '';
  return `<div class="stack"><div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><div><h2>Versions</h2><div class="sub">Each version is a complete set of inputs you can switch to and keep editing. The open version saves as you work. Tick up to 4 to compare.</div></div><button class="btn primary" data-act="save-version">＋ New version from the open one</button></div>
    ${vs.length ? `<div class="tblwrap"><table class="vlist"><thead><tr><th></th><th>Version</th><th>Changes</th><th>Updated</th><th></th></tr></thead><tbody>${list}</tbody></table></div>` : '<div class="sub">No versions yet. "New version" saves the current inputs as “Main” and opens a copy to change.</div>'}</div>
    ${sel.length >= 2 ? `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Side by side</h2></div>${vCompareTable(sel)}<div class="note" style="margin-top:6px">Best value per row in green. Break-even: average sale price per m² at which sales still cover principal, interest and returns (as on the Sensitivity tab).</div></div>
    <div class="card"><h3>Inputs that differ</h3>${vInputDiffs(sel)}</div>` : vs.length ? '<div class="card"><div class="sub">Tick two or more versions to compare them side by side.</div></div>' : ''}</div>`;
}
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains('vpick')) { const id = +t.dataset.i; vSelected(); if (t.checked) { if (S.cmpSel.size >= 4) { t.checked = false; return toast('Compare up to 4 versions'); } S.cmpSel.add(id); } else S.cmpSel.delete(id); renderTab(); }
  if (t.classList && t.classList.contains('vlabel')) { const id = +t.dataset.i, label = t.value.trim(); if (!label) return; try { await api('PUT', `/api/versions/${id}`, { label }); const v = vById(id); if (v) v.label = label; const s = $('#vsel'); if (s) { const l = s.closest('.vswitch'); if (l) l.outerHTML = vSwitcher(); } toast('Renamed'); } catch (err) { toast('Could not rename'); } }
});
// committee deck: optional comparison slide before the last slide

// ================= Source tags: where each drafted value came from =================
// inputs.sources = { "<data-k path>": { doc: "file name or kind", loc: "p.12" or "section text", note: "…", file: "Appraisal/x.pdf" (in the deal's Documents), assumed: true|false, edited: true } }
const srcOf = (k) => { const p = cur(); return p && p.inputs.sources && p.inputs.sources[k]; };
function markSources() {
  const p = cur(); if (!p || !p.inputs.sources) return;
  document.querySelectorAll('[data-k]').forEach((el) => { el.classList.remove('src-doc', 'src-assumed', 'src-edited'); });
  for (const [k, s] of Object.entries(p.inputs.sources)) {
    const el = document.querySelector(`[data-k="${CSS.escape(k)}"]`); if (!el) continue;
    el.classList.add(s.edited ? 'src-edited' : s.assumed ? 'src-assumed' : 'src-doc');
  }
}
let chipFor = null;
function showChip(el) {
  const k = el.dataset.k, s = srcOf(k); let chip = $('#srcchip');
  if (!s) { if (chip) chip.remove(); chipFor = null; return; }
  if (!chip) { chip = document.createElement('div'); chip.id = 'srcchip'; document.body.appendChild(chip); }
  chipFor = k;
  chip.className = 'srcchip ' + (s.edited ? 'ed' : s.assumed ? 'as' : 'dc');
  chip.innerHTML = `<b>${s.edited ? 'Changed by you' : s.assumed ? 'Assumed' : 'From document'}</b> <span>${esc([s.doc, s.loc].filter(Boolean).join(' · '))}${s.note ? ' – ' + esc(s.note) : ''}</span>
    ${isMailSrc(s) || s.file ? `<button class="btn sm" data-src="open">Open</button>` : ''}${s.assumed && !s.edited ? `<button class="btn sm primary" data-src="confirm">Confirm</button>` : ''}<button class="btn sm ghost" data-src="edit">Edit source</button>`;
  const r = el.getBoundingClientRect();
  chip.style.left = Math.max(8, Math.min(window.innerWidth - 380, r.left + window.scrollX)) + 'px'; chip.style.top = (r.bottom + window.scrollY + 4) + 'px';
}
document.addEventListener('focusin', (e) => { const el = e.target; if (el.dataset && el.dataset.k) showChip(el); else if (!e.target.closest('#srcchip')) { const c = $('#srcchip'); if (c) c.remove(); } });
document.addEventListener('mousedown', (e) => {
  const b = e.target.closest('[data-src]'); if (!b) return; e.preventDefault();
  const s = srcOf(chipFor); if (!s) return;
  if (b.dataset.src === 'edit') { const el = document.querySelector(`[data-k="${CSS.escape(chipFor)}"]`); if (el) srcEdit(el); return; }
  if (b.dataset.src === 'open' && s.file) return openDoc(s.file, false);
  if (b.dataset.src === 'open' && isMailSrc(s)) return openMailSnippet(s.loc || s.note || '');
  if (b.dataset.src === 'confirm') { s.assumed = false; s.confirmed = true; scheduleSave(S.curId); markSources(); const el = document.querySelector(`[data-k="${CSS.escape(chipFor)}"]`); if (el) showChip(el); recalc(true); }
});
document.addEventListener('input', (e) => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; const s = srcOf(k); if (s && !s.edited) { s.edited = true; markSources(); } });
// keep tags on the right rows when a row is deleted
const DEL_MAP = { 'del-asset': 'assets', 'del-adj': 'adjustments', 'del-tranche': 'tranches', 'del-debt': 'debts', 'del-rev': 'revLines', 'del-cost': 'costLines', 'del-constr': 'constrLines' };
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !DEL_MAP[b.dataset.act]) return;
  const p = cur(); if (!p || !p.inputs.sources) return; const t = DEL_MAP[b.dataset.act], i = +b.dataset.i, out = {};
  for (const [k, s] of Object.entries(p.inputs.sources)) { const m = new RegExp(`^${t}\\.(\\d+)\\.(.+)$`).exec(k); if (!m) { out[k] = s; continue; } const j = +m[1]; if (j === i) continue; out[j > i ? `${t}.${j - 1}.${m[2]}` : k] = s; }
  p.inputs.sources = out;
}, true);
// the model check lists assumptions still to confirm
function lintAssumed(p, m, add) { // values Claude filled in without a source
  const src = p.inputs.sources || {};
  const pend = Object.entries(src).filter(([, s]) => s.assumed && !s.edited);
  if (pend.length) { add({ id: 'assumed', sev: 'warn', title: `${pend.length} assumed value${pend.length > 1 ? 's' : ''} to confirm`, why: `Filled in by Claude without a source: ${pend.slice(0, 4).map(([k, s]) => s.note || k).join('; ')}${pend.length > 4 ? '…' : ''}. Click a field with an amber edge to see the assumption and confirm it.`, tab: (pend[0][0].split('.')[0] === 'inputs' ? 'inputs' : { assets: 'assets', adjustments: 'adjust', tranches: 'inputs', debts: 'inputs', revLines: 'ops', costLines: 'ops' }[pend[0][0].split('.')[0]] || 'inputs'), keys: pend.map(([k]) => k), fix: [{ label: `Confirm all ${pend.length}`, run: (q) => { for (const v of Object.values(q.inputs.sources || {})) if (v.assumed && !v.edited) { v.assumed = false; v.confirmed = true; } } }] }); }
}

// ---- add or edit a source by hand: right-click any input (or "Edit source" on its chip)
const SRC_DOCS = ['Business plan', 'Appraisal', 'Financial statements', 'Term sheet', 'Email', 'Borrower (call / meeting)'];
const srcRowOf = (k) => /^(assets|adjustments|tranches|debts|revLines|costLines|constrLines)\.(\d+)\.(\w+)$/.exec(k);
function srcLabel(el) {
  const k = el.dataset.k, row = srcRowOf(k);
  if (row) { const td = el.closest('td'), tbl = el.closest('table'); if (td && tbl) { const th = tbl.querySelectorAll('thead th')[td.cellIndex]; const name = el.closest('tr').querySelector('[data-k$=".name"],[data-k$=".desc"]');
    return `${th ? th.textContent.trim() : row[3]}${name && name !== el && name.value ? ' – ' + name.value : ''}`; } }
  const l = el.closest('label'); const t = l && l.querySelector('.lbl'); return (t && t.textContent.trim()) || el.getAttribute('aria-label') || k;
}
function srcEdit(el) {
  const p = cur(), k = el.dataset.k; if (!p) return;
  p.inputs.sources = p.inputs.sources || {};
  const s = p.inputs.sources[k] || {}, row = srcRowOf(k);
  const sameCol = row ? [...document.querySelectorAll(`[data-k^="${row[1]}."][data-k$=".${row[3]}"]`)].filter((x) => srcRowOf(x.dataset.k) && srcRowOf(x.dataset.k)[3] === row[3]) : [];
  const docs = [...new Set([...Object.values(p.inputs.sources).map((x) => x.doc).filter(Boolean), ...SRC_DOCS])];
  const files = (DS.list[S.curId] || {}).documents;
  if (!files) loadDocs(S.curId).then(() => { const f = $('#se-file'); if (f && $('#srcedit')) f.outerHTML = fileSel(); });
  const fileSel = () => `<select class="in" id="se-file"><option value="">${(DS.list[S.curId] || {}).documents ? 'None' : 'Loading…'}</option>${((DS.list[S.curId] || {}).documents || []).map((d) => `<option value="${esc(d.path)}" ${d.path === s.file ? 'selected' : ''}>${esc(d.path.split('/').join(' › '))}</option>`).join('')}</select>`;
  $('#srcchip')?.remove(); $('#srcedit')?.remove();
  const box = document.createElement('div'); box.id = 'srcedit'; box.className = 'srcedit'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Source of this value');
  box.innerHTML = `<div class="sehead"><b>Source</b><span class="sub">${esc(srcLabel(el))}</span></div>
    <label><span class="lbl">Document</span><input class="in" id="se-doc" list="se-docs" value="${esc(s.doc || '')}" placeholder="e.g. Appraisal Newsec LT-26-09"><datalist id="se-docs">${docs.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></label>
    <label><span class="lbl">File in the deal's Documents</span>${fileSel()}</label>
    <label><span class="lbl">Page / location</span><input class="in" id="se-loc" value="${esc(s.loc || '')}" placeholder="e.g. p.12 or sheet Założenia B8"></label>
    <label><span class="lbl">Note</span><input class="in" id="se-note" value="${esc(s.note || '')}" placeholder="optional"></label>
    <label class="sechk"><input type="checkbox" id="se-as" ${s.assumed ? 'checked' : ''}> Assumed – still to confirm</label>
    ${sameCol.length > 1 ? `<label class="sechk"><input type="checkbox" id="se-all"> Same source for all ${sameCol.length} rows in this column</label>` : ''}
    <div class="row" style="gap:6px;margin-top:4px"><button class="btn sm primary" id="se-save">Save</button>${p.inputs.sources[k] ? '<button class="btn sm ghost" id="se-del">Remove source</button>' : ''}<span class="spacer"></span><button class="btn sm ghost" id="se-x">Cancel</button></div>`;
  document.body.appendChild(box);
  const r = el.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(window.innerWidth - 400, r.left + window.scrollX)) + 'px';
  box.style.top = (r.bottom + window.scrollY + 6 + 300 > window.scrollY + window.innerHeight ? Math.max(window.scrollY + 8, r.top + window.scrollY - 306) : r.bottom + window.scrollY + 6) + 'px';
  const close = () => { box.remove(); el.focus({ preventScroll: true }); };
  const done = () => { scheduleSave(S.curId); markSources(); recalc(true); close(); };
  $('#se-doc').focus();
  $('#se-x').onclick = close;
  if ($('#se-del')) $('#se-del').onclick = () => { delete p.inputs.sources[k]; done(); toast('Source removed'); };
  $('#se-save').onclick = () => {
    const file = $('#se-file') ? $('#se-file').value : '';
    const doc = $('#se-doc').value.trim() || (file ? file.split('/').pop().replace(/\.[^.]+$/, '') : ''), loc = $('#se-loc').value.trim(), note = $('#se-note').value.trim(), assumed = $('#se-as').checked;
    if (!doc && !note) { toast('Name the document (or write a note)'); return $('#se-doc').focus(); }
    const tag = Object.assign({ doc, manual: true }, file ? { file } : {}, loc ? { loc } : {}, note ? { note } : {}, assumed ? { assumed: true } : {});
    const keys = $('#se-all') && $('#se-all').checked ? sameCol.map((x) => x.dataset.k) : [k];
    for (const key of keys) p.inputs.sources[key] = Object.assign({}, tag);
    done(); toast(keys.length > 1 ? `Source set on ${keys.length} fields` : 'Source saved');
  };
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); $('#se-save').click(); } });
}
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest && e.target.closest('[data-k]');
  if (!el || S.view !== 'project' || !/^(inputs|assets|adjustments|tranches|debts|revLines|costLines|constrLines)\./.test(el.dataset.k) || el.closest('#trpanel,#deckov')) return;
  e.preventDefault(); srcEdit(el);
});
document.addEventListener('mousedown', (e) => { const b = $('#srcedit'); if (b && !b.contains(e.target)) b.remove(); });

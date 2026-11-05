// Documents tab: the files in the deal's folder on the shared drive (Deals/<deal>/Documents/<category>/). Adding files
// needs no lock – they never touch the deal itself. Files put there in Finder or Google Drive show up too.
const DS = { list: {}, cats: ['Teaser, business plan', 'Appraisal', 'Financial statements', 'Legal', 'Photos', 'Other'], cat: 'Other', busy: 0 };
{ const vi = TABS.findIndex((t) => t[0] === 'versions'); TABS.splice(vi < 0 ? TABS.length : vi, 0, ['docs', 'Documents']); }

const fsize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
async function loadDocs(id) {
  try { const r = await api('GET', `/api/projects/${encodeURIComponent(id)}/documents`); DS.list[id] = r; if (r.categories) DS.cats = r.categories; }
  catch (e) { DS.list[id] = { documents: [], error: e.message }; }
  return DS.list[id];
}
function tabDocs() {
  const id = S.curId, d = DS.list[id];
  if (!d) { loadDocs(id).then(() => S.tab === 'docs' && S.curId === id && renderTab()); return '<div class="card"><div class="sub">Loading documents…</div></div>'; }
  const docs = d.documents || [];
  const cats = [...new Set([...DS.cats, ...docs.map((x) => x.category).filter(Boolean)])];
  const groups = [...new Set(docs.map((x) => x.category))].sort((a, b) => (cats.indexOf(a) + 1 || 99) - (cats.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const row = (x) => `<tr><td><button class="doclink" data-act="doc-open" data-path="${esc(x.path)}" title="Open ${esc(x.name)}">${esc(x.name)}</button></td>
    <td class="n sub">${fsize(x.size)}</td><td class="sub">${esc(dshort(x.modified))}</td>
    <td class="n"><button class="btn sm ghost" data-act="doc-reveal" data-path="${esc(x.path)}">Show in Finder</button></td></tr>`;
  const list = docs.length ? `<div class="tblwrap"><table class="docs">${groups.map((g) => `<tbody><tr class="grp"><th colspan="4">${esc(g || 'Not in a category')} <span class="sub">${docs.filter((x) => x.category === g).length}</span></th></tr>${docs.filter((x) => x.category === g).map(row).join('')}</tbody>`).join('')}</table></div>`
    : `<div class="docempty sub">No documents yet. Drop files here or click “Add files”.</div>`;
  return `<div class="card" id="docdrop">
    <div class="dochead"><div><h3>Documents</h3><div class="sub">${d.folder ? `Shared drive › ${esc(d.folder.split('/').join(' › '))} – files added in Finder or Google Drive show here too` : 'The deal’s folder is created with its first document'}</div></div>
      <span class="spacer"></span>
      <label class="docadd"><span class="sub">Add as</span><select class="in" id="doccat" aria-label="Category for new files">${cats.map((c) => `<option ${c === DS.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <button class="btn sm primary" data-act="doc-add" ${DS.busy ? 'disabled' : ''}>${DS.busy ? `Adding ${DS.busy}…` : 'Add files…'}</button>
      <button class="btn sm" data-act="doc-folder">Show in Finder</button>
      <button class="btn sm ghost" data-act="doc-refresh" title="Read the folder again" aria-label="Refresh">↻</button>
      <input type="file" id="docfile" multiple hidden></div>
    ${d.error ? `<div class="banner">${esc(d.error)}</div>` : ''}${list}</div>`;
}
async function uploadDocs(files) {
  const id = S.curId, cat = DS.cat; if (!files.length) return;
  DS.busy = files.length; renderTab();
  let ok = 0;
  for (const f of files) {
    try { await api('POST', `/api/projects/${encodeURIComponent(id)}/documents?name=${encodeURIComponent(f.name)}&category=${encodeURIComponent(cat)}`, f, true); ok++; }
    catch (e) { toast(`${f.name}: ${e.message}`); }
    DS.busy = files.length - ok;
  }
  DS.busy = 0; await loadDocs(id);
  if (ok) toast(`Added ${ok} file${ok > 1 ? 's' : ''} to ${cat}`);
  if (S.tab === 'docs' && S.curId === id) renderTab();
}
async function openDoc(path, reveal) {
  try { await api('POST', `/api/projects/${encodeURIComponent(S.curId)}/documents/open`, { path, reveal: !!reveal }); }
  catch (e) { toast(e.message); }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || !/^doc-/.test(b.dataset.act)) return;
  const a = b.dataset.act;
  if (a === 'doc-open') openDoc(b.dataset.path, false);
  else if (a === 'doc-reveal') openDoc(b.dataset.path, true);
  else if (a === 'doc-folder') openDoc('', false);
  else if (a === 'doc-add') $('#docfile').click();
  else if (a === 'doc-refresh') { delete DS.list[S.curId]; renderTab(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'doccat') DS.cat = e.target.value;
  if (e.target.id === 'docfile') { uploadDocs([...e.target.files]); e.target.value = ''; }
});
document.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('#docdrop'); if (!z) return; e.preventDefault(); z.classList.add('over'); });
document.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('#docdrop'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
document.addEventListener('drop', (e) => { const z = e.target.closest && e.target.closest('#docdrop'); if (!z) return; e.preventDefault(); z.classList.remove('over'); uploadDocs([...e.dataTransfer.files]); });

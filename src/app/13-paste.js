// ================= Paste from Excel =================
// Table definitions: editable columns in display order, with kinds and header aliases (EN / LT / PL).
const PASTE_TABLES = {
  assets: { label: 'Collateral & sales', blank: () => blankAsset(), fields: [
    ['name', 'Asset / item', 'text', ['asset', 'name', 'item', 'property', 'object', 'premises', 'unit', 'turt', 'objekt', 'pavadinim', 'butas', 'patalp', 'nazwa', 'lokal', 'nieruchom']],
    ['inColl', 'In collateral', 'check', ['collateral', 'pledged', 'mortgage', 'užstat', 'įkeist', 'hipotek', 'zabezpiecz']],
    ['market', 'Market value', 'money', ['market value', 'market', 'value', 'appraised', 'rinkos vert', 'vertė', 'wartość rynk', 'wartość', 'wycena']],
    ['valDate', 'Valuation date', 'date', ['valuation date', 'value date', 'appraisal date', 'vertinimo data', 'data wyceny']],
    ['source', 'Valuer / basis', 'text', ['valuer', 'source', 'basis', 'appraiser', 'vertintoj', 'rzeczoznaw']],
    ['haircut', 'Own haircut %', 'pct', ['haircut', 'discount', 'nuolaid', 'dyskont']],
    ['alloc', 'Allocated loan', 'money', ['allocated', 'allocation', 'loan amount', 'loan', 'paskol', 'kredyt']],
    ['acqPrice', 'Acquisition price', 'money', ['acquisition', 'purchase price', 'purchase', 'įsigij', 'pirkimo', 'zakup', 'nabyc']],
    ['rent', 'Rent / month', 'money', ['rent', 'nuom', 'czynsz', 'najem']],
    ['area', 'Area m²', 'num', ['area', 'm2', 'm²', 'sq', 'plotas', 'powierzch']],
    ['contractDate', 'Contract date', 'date', ['contract date', 'preliminary', 'sutarties data', 'preliminari', 'umowa', 'umowy']],
    ['saleDate', 'Planned sale date', 'date', ['sale date', 'selling date', 'pardavimo data', 'data sprzeda']],
    ['salePrice', 'Planned sale price', 'money', ['sale price', 'selling price', 'sales price', 'pardavimo kain', 'cena sprzeda', 'price', 'kaina', 'cena']],
    ['status', 'Sale status', 'salestatus', ['status', 'būsena', 'statusas']],
    ['listPrice', 'List price', 'money', ['list price', 'price list', 'asking', 'kainoraš', 'cennik', 'cena ofert']],
    ['deposit', 'Deposit paid', 'money', ['deposit', 'avans', 'zadatek', 'zaliczk', 'rankpinig']],
    ['depositHeld', 'Deposit held', 'held', ['held', 'escrow', 'account', 'sąskait', 'rachun']],
    ['sweep', 'Own sweep %', 'pct', ['sweep']],
    ['minPrice', 'Minimum selling price', 'money', ['minimum', 'min price', 'floor', 'minimal']],
    ['notary', 'Notary / transaction costs', 'money', ['notary', 'transaction', 'notar']],
    ['notes', 'Notes', 'text', ['note', 'comment', 'remark', 'pastab', 'komentar', 'uwag']],
  ] },
  adjustments: { label: 'Adjustments', blank: () => blankAdj(), fields: [
    ['desc', 'Description', 'text', ['description', 'item', 'name', 'aprašym', 'pavadinim', 'opis', 'pozycja']],
    ['type', 'Type', 'adjtype', ['type', 'tipas', 'rodzaj', 'typ']],
    ['date', 'Date / start', 'date', ['start', 'date', 'data', 'pradž']],
    ['recurrence', 'Recurrence', 'recur', ['recurrence', 'frequency', 'periodic', 'dažn', 'częstotl']],
    ['end', 'End date', 'date', ['end', 'until', 'pabaig', 'koniec']],
    ['amount', 'Amount', 'money', ['amount', 'sum', 'value', 'suma', 'kwota', 'cost', 'kaina']],
    ['notes', 'Notes', 'text', ['note', 'comment', 'pastab', 'uwag']],
  ] },
  tranches: { label: 'Drawdown schedule', blank: () => blankTranche(), fields: [
    ['date', 'Date', 'date', ['date', 'data', 'month']], ['amount', 'Amount', 'money', ['amount', 'tranche', 'draw', 'suma', 'kwota']], ['label', 'Milestone / condition', 'text', ['milestone', 'condition', 'label', 'stage', 'etap', 'sąlyg', 'warunek', 'note']],
  ] },
  debts: { label: 'Existing debts', blank: () => blankDebt(), fields: [
    ['lender', 'Lender', 'text', ['lender', 'creditor', 'bank', 'kreditor', 'paskolos davėj', 'skolintoj', 'wierzyciel', 'name']],
    ['balance', 'Balance', 'money', ['balance', 'outstanding', 'amount', 'likut', 'saldo', 'kwota']],
    ['rate', 'Rate %', 'pct', ['rate', 'interest', 'palūkan', 'norma', 'oprocent', 'stopa']],
    ['maturity', 'Maturity', 'date', ['maturity', 'due', 'term', 'terminas', 'termin', 'zapadalno']],
    ['prepay', 'Prepayment cost', 'money', ['prepayment', 'early', 'penalty', 'išankst', 'wcześniej']],
    ['refinanced', 'Refinanced', 'check', ['refinanc', 'repaid', 'refinansuoj', 'refinans']],
    ['service', 'Monthly service', 'money', ['monthly', 'service', 'instal', 'payment', 'įmok', 'rata']],
    ['end', 'Service ends', 'date', ['service end', 'ends', 'end date', 'pabaig', 'koniec']],
    ['notes', 'Notes', 'text', ['note', 'comment', 'collateral', 'pastab', 'uwag']],
  ] },
  revLines: { label: 'Revenue lines', blank: () => blankRev(), fields: [
    ['name', 'Name', 'text', ['name', 'line', 'item', 'unit type', 'pavadinim', 'nazwa']], ['kind', 'Type', 'revkind', ['type', 'kind', 'tipas', 'typ']],
    ['units', 'Units', 'num', ['units', 'rooms', 'keys', 'villas', 'count', 'number', 'vnt', 'kamb', 'pokoj', 'liczba']], ['price', 'Price', 'money', ['price', 'adr', 'rate', 'rent', 'kaina', 'cena']],
    ['occ', 'Occupancy %', 'pct', ['occupancy', 'occ', 'užimtum', 'obłożen']], ['start', 'Start', 'date', ['start', 'from', 'pradž', 'od']], ['end', 'End', 'date', ['end', 'until', 'pabaig', 'do']], ['growth', 'Growth % p.a.', 'pct', ['growth', 'indexation', 'augim', 'wzrost']],
  ] },
  costLines: { label: 'Cost lines', blank: () => blankCost(), fields: [
    ['name', 'Name', 'text', ['name', 'cost', 'item', 'expense', 'pavadinim', 'kaštai', 'koszt', 'nazwa']], ['kind', 'Driver', 'costkind', ['driver', 'type', 'basis', 'tipas', 'typ']],
    ['amount', 'Amount', 'money', ['amount', 'value', 'per month', 'monthly', 'suma', 'kwota']], ['growth', 'Growth % p.a.', 'pct', ['growth', 'indexation', 'augim', 'wzrost']],
    ['months', 'Months', 'text', ['months', 'mėnes', 'miesiąc']], ['start', 'Start', 'date', ['start', 'from', 'pradž']], ['end', 'End', 'date', ['end', 'until', 'pabaig']],
  ] },
  todos: { label: 'Open items', blank: () => ({ text: '', done: false, category: 'Open item', due: '' }), fields: [
    ['text', 'Item', 'text', ['item', 'condition', 'text', 'description', 'task', 'sąlyg', 'warunek', 'zadanie']], ['category', 'Category', 'todocat', ['category', 'type', 'kategor', 'tipas']], ['due', 'Due date', 'date', ['due', 'deadline', 'date', 'terminas', 'termin']], ['done', 'Done', 'check', ['done', 'status', 'completed', 'atlikt', 'wykonan']],
  ] },
};

// ---- value parsing ----
function pNum(raw) {
  let s = String(raw ?? '').replace(/[  \s]/g, '').replace(/(€|eur|pln|zł|zl|usd|\$|£|lei|ron|sek|kr)/gi, '');
  if (s === '' || s === '-' || s === '–') return { v: '', pctSign: false };
  const pctSign = /%$/.test(s); s = s.replace(/%$/, '');
  let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-?[\d.,]+$/.test(s)) {
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) { if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }
    else if (hasC) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (hasD && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s); if (!isFinite(n)) return { v: String(raw).trim(), pctSign };
    return { v: String(Math.round((neg ? -n : n) * 1e8) / 1e8), pctSign };
  }
  return { v: String(raw).trim(), pctSign }; // formulas like 17000/12 are kept as typed
}
function pDate(raw) {
  const s = String(raw ?? '').trim(); if (!s) return '';
  let m;
  const ok = (y, mo, d) => (y > 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
  if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s))) return ok(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/.exec(s))) return ok(+m[3], +m[2], +m[1]); // day first (EU)
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); return d.toISOString().slice(0, 10); } // Excel serial
  const mo = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  if ((m = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-]+(\d{4})$/i.exec(s)) && mo[m[2].toLowerCase()]) return ok(+m[3], mo[m[2].toLowerCase()], +m[1]);
  if ((m = /^([a-z]{3})[a-z]*[\s-]+(\d{4})$/i.exec(s)) && mo[m[1].toLowerCase()]) return ok(+m[2], mo[m[1].toLowerCase()], 1);
  return '';
}
const pBool = (raw, dflt) => { const s = String(raw ?? '').trim().toLowerCase(); if (!s) return dflt; if (/^(y|yes|true|1|x|✓|✔|taip|tak|ja|ok)$/.test(s)) return true; if (/^(n|no|false|0|ne|nie|-)$/.test(s)) return false; return dflt; };
function pValue(kind, raw, opts = {}) {
  const s = String(raw ?? '').trim();
  switch (kind) {
    case 'date': return pDate(s);
    case 'check': return pBool(s, opts.dflt ?? true);
    case 'money': case 'num': return pNum(s).v;
    case 'pct': { const r = pNum(s); if (r.v === '' || isNaN(+r.v)) return r.v; return opts.fraction && !r.pctSign ? String(Math.round(+r.v * 100 * 1e6) / 1e6) : r.v; }
    case 'adjtype': return /income|revenue|pajam|przych|receipt/i.test(s) ? 'Income' : /capex|invest|construct|works|statyb|budow/i.test(s) ? 'Capex' : 'Expense';
    case 'recur': return /month|mėn|mies|recurr|monthly/i.test(s) ? 'Monthly' : 'One-off';
    case 'revkind': return /night|nakv|noc|adr/i.test(s) ? 'nightly' : /month|rent|nuom|czynsz/i.test(s) ? 'monthly' : /fix/i.test(s) ? 'fixed' : 'nightly';
    case 'costkind': return /%|pct|percent|revenue|pajam|przych/i.test(s) ? 'pctRev' : /night|nakv|noc/i.test(s) ? 'perNight' : /unit|villa|room|vnt|pokój/i.test(s) ? 'perUnit' : 'fixed';
    case 'salestatus': return /deed|signed|sold|parduot|sprzedan|akt not/i.test(s) ? 'Final deed signed' : /prelim|przedwst|preliminar|preliminari/i.test(s) ? 'Preliminary contract' : /reserv|rezerw/i.test(s) ? 'Reserved' : /not for|nepar|nie na/i.test(s) ? 'Not for sale' : s ? 'Available' : '';
    case 'held': return /escrow|trust|powierni|notar/i.test(s) ? 'Escrow' : /pledg|įkeist|zastaw|ours|inrento/i.test(s) ? 'Pledged' : /borrow|paid|developer|deweloper|vystyt/i.test(s) ? 'Borrower' : '';
    case 'todocat': return /precedent|cp\b|sąlyg|warunek/i.test(s) ? 'Condition precedent' : /covenant|kovenant/i.test(s) ? 'Covenant' : /document|dokument/i.test(s) ? 'Document request' : 'Open item';
    default: return s;
  }
}
// Excel clipboard: tab-separated, rows by newline, quoted cells may hold newlines
function parseTSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const t = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') { q = true; continue; }
    if (c === '\t') { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((x) => !String(x).trim())) rows.pop();
  return rows;
}
// a percent column copied as fractions (0.3) is converted to percent units (30)
function fractionColumns(rows, kinds) {
  return kinds.map((k, j) => k === 'pct' && rows.some((r) => String(r[j] ?? '').trim()) && rows.every((r) => { const p = pNum(r[j]); return p.v === '' || (!p.pctSign && !isNaN(+p.v) && Math.abs(+p.v) <= 1); }));
}

// ---- 1. paste a block straight into a table cell ----
document.addEventListener('paste', (e) => {
  const el = e.target; if (!el || !el.dataset || !el.dataset.k || S.view !== 'project') return;
  const text = e.clipboardData && e.clipboardData.getData('text/plain'); if (!text || !/[\t\n]/.test(text.replace(/\n$/, ''))) return; // single value: normal paste
  const k = el.dataset.k, p = cur();
  let m = /^(revLines|costLines)\.(\d+)\.(occM|priceM|amountM)\.(\d+)$/.exec(k) || /^inputs\.(seasonality)\.(\d+)$/.exec(k);
  const grid = parseTSV(text);
  if (m) { // 12-month row: fill across (a pasted column fills across too)
    const vals = grid.length === 1 ? grid[0] : grid.map((r) => r[0]);
    const arr = m[1] === 'seasonality' ? p.inputs.seasonality : p[m[1]][+m[2]][m[3]]; const start = +(m[4] ?? m[2]);
    const kind = m[3] === 'occM' ? 'pct' : 'num'; const frac = kind === 'pct' && fractionColumns(vals.map((v) => [v]), ['pct'])[0];
    let n = 0; for (let j = 0; j < vals.length && start + j < 12; j++) { arr[start + j] = pValue(kind, vals[j], { fraction: frac }); n++; }
    e.preventDefault(); scheduleSave(S.curId); recalc(true); renderTab(); toast(`Pasted ${n} month${n > 1 ? 's' : ''}`); return;
  }
  m = /^(assets|adjustments|tranches|debts|revLines|costLines)\.(\d+)\.(\w+)$/.exec(k); if (!m) return;
  const T = PASTE_TABLES[m[1]], list = p[m[1]], r0 = +m[2], c0 = T.fields.findIndex((f) => f[0] === m[3]); if (c0 < 0) return;
  e.preventDefault();
  const width = Math.min(Math.max(...grid.map((r) => r.length)), T.fields.length - c0);
  const kinds = T.fields.slice(c0, c0 + width).map((f) => f[2]); const frac = fractionColumns(grid, kinds);
  grid.forEach((row, i) => {
    while (list.length <= r0 + i) list.push(T.blank());
    for (let j = 0; j < width; j++) { const f = T.fields[c0 + j]; if (row[j] === undefined) continue; list[r0 + i][f[0]] = pValue(f[2], row[j], { fraction: frac[j], dflt: list[r0 + i][f[0]] }); }
  });
  scheduleSave(S.curId); recalc(true); renderTab();
  toast(`Pasted ${grid.length} row${grid.length > 1 ? 's' : ''} × ${width} column${width > 1 ? 's' : ''} into ${T.label}`);
});

// ---- 2. "Paste from Excel" dialog with header matching ----
const PS = { t: null, rows: [], header: false, map: [], mode: 'add' };
function guessMap(head, fields) {
  const used = new Set();
  const scored = head.map((h, j) => { const H = String(h).toLowerCase().trim(); let best = null, bs = 0; for (const f of fields) for (const a of f[3]) if (H && H.includes(a) && a.length > bs) { bs = a.length; best = f[0]; } return { j, best, bs }; }).sort((a, b) => b.bs - a.bs);
  const map = head.map(() => '');
  for (const s of scored) if (s.best && !used.has(s.best)) { map[s.j] = s.best; used.add(s.best); }
  return map;
}
function openPaste(t) {
  PS.t = t; PS.rows = []; PS.header = false; PS.map = []; PS.mode = 'add';
  let ov = $('#pasteov'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'pasteov'; ov.className = 'deckov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Paste from Excel');
  ov.innerHTML = `<div class="pastebox card"><div class="row" style="justify-content:space-between"><h2>Paste from Excel – ${esc(PASTE_TABLES[t].label)}</h2><button class="btn" data-pact="close">Close</button></div>
    <div class="sub" style="margin:4px 0 10px">Select the cells in Excel (include the header row if you have one), copy, click in the box and paste (⌘V). Columns are matched by their headers; check the matching below before importing.</div>
    <textarea id="pastearea" class="in" rows="5" placeholder="Paste here" style="font-family:var(--f-num);font-size:12px;width:100%"></textarea>
    <div id="pastemap" style="margin-top:12px"></div></div>`;
  document.body.appendChild(ov); document.body.style.overflow = 'hidden';
  $('#pastearea').focus();
  $('#pastearea').addEventListener('input', (e) => { const rows = parseTSV(e.target.value); PS.rows = rows; if (!rows.length) { renderPasteMap(); return; }
    const F = PASTE_TABLES[t].fields; const g = guessMap(rows[0], F); const hits = g.filter(Boolean).length;
    const numericFirst = rows[0].filter((c) => pNum(c).v !== '' && !isNaN(+pNum(c).v)).length;
    const dataLike = rows[0].some((c) => pDate(c) || (String(c).trim() && pNum(c).v !== '' && !isNaN(+pNum(c).v)));
    PS.header = hits > 0 && !dataLike && hits >= numericFirst; PS.map = PS.header ? g : rows[0].map((_, j) => (F[j] ? F[j][0] : ''));
    renderPasteMap(); });
}
function pasteBody() { return PS.header ? PS.rows.slice(1) : PS.rows; }
function renderPasteMap() {
  const box = $('#pastemap'); if (!box) return;
  const T = PASTE_TABLES[PS.t];
  if (!PS.rows.length) { box.innerHTML = ''; return; }
  const ncol = Math.max(...PS.rows.map((r) => r.length));
  while (PS.map.length < ncol) PS.map.push('');
  const body = pasteBody();
  const kinds = PS.map.map((k) => (T.fields.find((f) => f[0] === k) || [])[2] || 'text'); const frac = fractionColumns(body, kinds);
  const opts = (sel) => `<option value="">– ignore –</option>${T.fields.map((f) => `<option value="${f[0]}" ${f[0] === sel ? 'selected' : ''}>${esc(f[1])}</option>`).join('')}`;
  const show = (j, raw) => { const k = PS.map[j]; if (!k) return `<span class="dk-muted" style="color:var(--ink-3)">${esc(raw)}</span>`; const v = pValue(kinds[j], raw, { fraction: frac[j] }); return v === true ? 'Yes' : v === false ? 'No' : (v === '' && String(raw).trim() ? `<span class="bad-t" title="Could not read this value">${esc(raw)} ?</span>` : esc(v)); };
  const n = body.length, dupe = PS.map.filter(Boolean).length !== new Set(PS.map.filter(Boolean)).size;
  box.innerHTML = `<div class="row" style="gap:16px;margin-bottom:8px"><label class="row" style="gap:6px"><input type="checkbox" id="pshead" ${PS.header ? 'checked' : ''}> First row is a header</label>
      <label class="row" style="gap:6px"><input type="radio" name="pmode" value="add" ${PS.mode === 'add' ? 'checked' : ''}> Add to existing rows</label>
      <label class="row" style="gap:6px"><input type="radio" name="pmode" value="replace" ${PS.mode === 'replace' ? 'checked' : ''}> Replace all ${cur()[PS.t].length} rows</label></div>
    <div class="tblwrap" style="max-height:46vh"><table><thead><tr>${PS.map.map((k, j) => `<th style="min-width:120px"><select class="in pmap" data-j="${j}" aria-label="Column ${j + 1}">${opts(k)}</select>${PS.header ? `<div class="sub" style="font-weight:400;text-transform:none;letter-spacing:0;margin-top:3px">${esc(PS.rows[0][j] ?? '')}</div>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${body.slice(0, 12).map((r) => `<tr>${PS.map.map((_, j) => `<td>${show(j, r[j] ?? '')}</td>`).join('')}</tr>`).join('')}${n > 12 ? `<tr><td colspan="${ncol}" class="sub">… ${n - 12} more row${n - 12 > 1 ? 's' : ''}</td></tr>` : ''}</tbody></table></div>
    ${dupe ? '<div class="banner" style="margin-top:8px">Two columns go to the same field; the right-hand one wins.</div>' : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><span class="sub">Values shown as they will be stored. Percent columns copied as fractions (0.3) are converted to 30.</span><button class="btn primary" data-pact="import" ${n && PS.map.some(Boolean) ? '' : 'disabled'}>${PS.mode === 'replace' ? 'Replace with' : 'Add'} ${n} row${n === 1 ? '' : 's'}</button></div>`;
}
function doPasteImport() {
  const T = PASTE_TABLES[PS.t], p = cur(), body = pasteBody();
  const kinds = PS.map.map((k) => (T.fields.find((f) => f[0] === k) || [])[2] || 'text'); const frac = fractionColumns(body, kinds);
  const rows = body.filter((r) => r.some((c) => String(c).trim())).map((r) => { const o = T.blank(); PS.map.forEach((k, j) => { if (k && r[j] !== undefined) o[k] = pValue(kinds[j], r[j], { fraction: frac[j], dflt: o[k] }); }); return o; });
  if (PS.mode === 'replace') p[PS.t] = rows;
  else { const list = p[PS.t]; const empty = (o) => T.fields.every((f) => f[2] === 'check' || !String(o[f[0]] ?? '').trim()); while (list.length && empty(list[list.length - 1])) list.pop(); list.push(...rows); }
  closePaste(); scheduleSave(S.curId); recalc(true); renderTab(); toast(`${PS.mode === 'replace' ? 'Replaced with' : 'Added'} ${rows.length} row${rows.length === 1 ? '' : 's'} – ${T.label}`);
}
function closePaste() { const ov = $('#pasteov'); if (ov) ov.remove(); document.body.style.overflow = ''; }
document.addEventListener('change', (e) => {
  if (!$('#pasteov') || !e.target.closest('#pasteov')) return;
  if (e.target.id === 'pshead') { PS.header = e.target.checked; if (PS.header) { const g = guessMap(PS.rows[0], PASTE_TABLES[PS.t].fields); if (g.some(Boolean)) PS.map = g; } renderPasteMap(); }
  else if (e.target.classList.contains('pmap')) { PS.map[+e.target.dataset.j] = e.target.value; renderPasteMap(); }
  else if (e.target.name === 'pmode') { PS.mode = e.target.value; renderPasteMap(); }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pact],[data-act="paste-table"]'); if (!b) return;
  if (b.dataset.act === 'paste-table') return openPaste(b.dataset.t);
  if (b.dataset.pact === 'close') return closePaste();
  if (b.dataset.pact === 'import') return doPasteImport();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#pasteov')) closePaste(); });

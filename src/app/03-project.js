// Project page: tab switching, generic input controls, Overview tab, committee deck box (description, benefits, risks).
// ---------- PROJECT ----------
function renderProject() {
  const p = cur(); if (!p) return go('home');
  document.title = p.name + ' · Deal Desk';
  document.getElementById('app').innerHTML = topBar() + `<div class="wrap"><div id="lockbar"></div></div><main class="wrap" id="tabbody"></main>`;
  renderKpis(); renderSaveState(); renderTab(); renderLockBar();
}
function renderTab() {
  const el = $('#tabbody'); if (!el) return;
  if (S.view === 'project' && cur() && !!S.modelMode !== viewEUR()) recalc(true); // results follow the currency switch
  const f = { deal: tabDeal, overview: tabOverview, inputs: tabInputs, ops: tabOps, assets: tabAssets, adjust: tabAdjust, summary: tabSummary, cashflow: tabCashflow, sens: tabSens, versions: tabVersions }[S.tab] || tabOverview;
  const y = window.scrollY;
  el.innerHTML = (S.modelErr ? `<div class="banner">The model could not be calculated: ${esc(S.modelErr)}</div>` : '') + f();
  refreshOutputs(); applyReadOnly();
  window.scrollTo(0, y);
}
const OUT = {};

// generic controls
const inp = (path, val, kind = 'num', extra = '') => `<input class="in" id="${idOf(path)}" data-k="${path}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} autocomplete="off" value="${esc(val)}" ${extra}>`;
const dateIn = (path, val) => `<input class="in" type="date" id="${idOf(path)}" data-k="${path}" value="${esc(val)}">`;
const sel = (path, val, opts, extra = '') => `<select class="in" id="${idOf(path)}" data-k="${path}" ${extra}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const chk = (path, val, label = '') => `<input type="checkbox" id="${idOf(path)}" data-k="${path}" ${val ? 'checked' : ''} ${label ? `aria-label="${esc(label)}"` : ''}>`;
const idOf = (path) => 'k-' + path.replace(/\./g, '-');
const monthChips = (path, arr, label) => `<div class="mchips" role="group" aria-label="${esc(label)}">${MON.map((m, k) => `<label class="mchip"><input type="checkbox" id="${idOf(path + '.' + k)}" data-k="${path}.${k}" ${arr[k] ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div>`;

// ---- Overview
const TODO_CATS = ['Open item', 'Condition precedent', 'Covenant', 'Document request'];
function tabOverview() {
  const p = cur();
  const meta = (k, label, type = 'text', opts) => `<label class="f meta" for="m-${k}"><span class="lbl">${label}</span><span class="ctl">${opts ? `<select class="in" id="m-${k}" data-k="${k}">${opts.map((o) => `<option ${o === p[k] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input class="in" id="m-${k}" data-k="${k}" type="${type}" value="${esc(p[k])}">`}</span></label>`;
  const open = p.todos.filter((t) => !t.done).length;
  return `${pipelineCard(p)}${judgementCard(p)}${brCard(p)}${typePicker()}<div class="cols2"><div class="stack">
    <div class="card"><h3>Deal</h3><div class="form">
      ${meta('name', 'Project name')}${meta('borrower', 'Borrower')}${meta('country', 'Country')}${meta('projectType', 'Project type')}<div class="f meta"><span class="lbl">Deal type</span><span class="ctl">${typeSelect(p)}</span></div>${meta('contact', 'Contact / broker')}
    </div>
    <label style="display:block;margin-top:10px"><span class="sub">Notes</span><textarea class="in" id="m-notes" data-k="notes" rows="6" style="margin-top:4px;resize:vertical">${esc(p.notes)}</textarea></label>
    </div>
    <div class="card"><h3>Snapshot</h3><div data-out="tiles"></div></div>
  </div><div class="stack">
    <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0">Open items, conditions and covenants</h3><span class="row" style="gap:8px"><span class="sub">${open} open</span><button class="btn sm" data-act="paste-table" data-t="todos" title="Paste a list copied from Excel or a document">Paste list</button></span></div>
      <div id="todos">${p.todos.map((t, i) => `<div class="todo ${t.done ? 'done' : ''}">${chk(`todos.${i}.done`, t.done, 'Done')}
        <input type="text" id="tt-${i}" data-k="todos.${i}.text" value="${esc(t.text)}" aria-label="Item">
        <select class="tsel" id="tc-${i}" data-k="todos.${i}.category" aria-label="Category">${TODO_CATS.map((c) => `<option ${c === (t.category || 'Open item') ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <span class="tlbl">due</span><input type="date" class="tdate" id="td-${i}" data-k="todos.${i}.due" value="${esc(t.due || '')}" aria-label="Due date">
        <button class="xbtn" data-act="del-todo" data-i="${i}" aria-label="Remove item">×</button>
        <span class="tmeta"><span class="tlbl">from</span><input type="text" class="tfrom" id="tf-${i}" data-k="todos.${i}.from" value="${esc(t.from || '')}" placeholder="who has to deliver" aria-label="Requested from">
        <span class="tlbl">asked</span><input type="date" class="tdate" id="ta-${i}" data-k="todos.${i}.askedOn" value="${esc(t.askedOn || '')}" aria-label="Asked on">${chasePill(t)}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><input class="search" id="newtodo" placeholder="Add an item and press Enter" style="max-width:none" aria-label="New item"></div>
    </div>
    <div class="card"><h3>Credit tests</h3><div class="sub" style="margin-bottom:6px">Information, not warnings.</div><div data-out="flags"></div></div>
    <div class="card"><h3>Project file</h3>
      <div class="kv"><span class="k">Created</span><span class="v">${p.createdAt ? new Date(p.createdAt).toLocaleString('en-GB') : '–'}</span></div>
      <div class="kv"><span class="k">Last change</span><span class="v">${p.updatedAt ? new Date(p.updatedAt).toLocaleString('en-GB') : '–'}</span></div>
      <div class="kv"><span class="k">Saved versions</span><span class="v">${S.versions ? S.versions.length : '–'}</span></div>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="dup">Duplicate</button><button class="btn" data-act="export-json">Export JSON</button>
      ${S.confirmDel ? `<span class="confirm">Delete this project for good? <button class="btn sm danger" data-act="del-yes">Delete</button><button class="btn sm" data-act="del-no">Keep</button></span>` : `<button class="btn danger" data-act="del">Delete</button>`}</div>
    </div>
  </div></div>`;
}
// the engine's credit tests (pass / check), shown as information; DSCR only where there is operating income
const creditTests = (m) => m.summary.checks.filter((c) => usesDscr(m) || !/DSCR/.test(c[0]));
OUT.tiles = () => {
  const s = S.model.summary, r = S.model.r;
  const t = (l, v, sub = '', c = '') => `<div class="tile"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${sub}</div></div>`;
  return `<div class="tiles">${t(r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), r.tranchesOn ? `${s.tranches} tranches · ${money(s.draw0)} at drawdown` : r.repay)}
  ${t('Collateral (market)', money(s.mkt0), `forced ${money(s.fs0)}`)}
  ${t('LTV / forced', pctf(s.ltv0), `forced ${pctf(s.ltvFs0)} · max ${pctf(r.maxLTV, 0)}`, s.ltv0 > r.maxLTV ? 'bad' : '')}
  ${t('Max loan by policy', money(s.sizeMax), s.sizeMax != null ? (s.facility <= s.sizeMax + 1 ? 'facility fits' : `over by ${money(s.facility - s.sizeMax)}`) : 'set LTV / coverage', s.sizeMax != null && s.facility > s.sizeMax + 1 ? 'bad' : '')}
  ${usesDscr(S.model) ? t(r.dscrBasis === 'monthly' ? 'Min DSCR (monthly)' : 'Min DSCR (12 m)', xf(s.dscrTest), `monthly min ${xf(s.minDscr)} · target ${r.minDSCR}×`, s.dscrTest != null && s.dscrTest < r.minDSCR ? 'bad' : '') : ''}
  ${t('Liquidity reserve need', money(s.reserveNeed), `lowest cash before exit ${datef(s.lowCashPreDate)}`, s.reserveNeed > 0 ? 'bad' : '')}
  ${t('Exit', s.exitLTV != null ? 'LTV ' + pctf(s.exitLTV) : datef(s.maturity), s.paydown ? `pay down ${money(s.paydown)} to refinance` : `repaid ${datef(s.repaidDate)}`, s.paydown > 1 ? 'bad' : '')}
  ${t('InRento fee', money(feeOf(s)), s.facility > 0 ? `${pctf(feeOf(s) / s.facility, 1)} of the facility` : '')}</div>`;
};
OUT.flags = () => `<div class="flaglist">${creditTests(S.model).map((c) => `<div class="flag"><span class="pill ${c[1] === 'OK' ? 'ok' : 'chk'}">${c[1]}</span><span>${esc(c[0])}${c[2] && c[1] !== 'OK' ? `<div class="sub">${esc(c[2])}</div>` : ''}</span></div>`).join('')}</div>`;

function brCard(p) {
  const ta = (k, label, ph, rows) => `<label class="brf"><span class="lbl">${label}</span><textarea class="in" id="m-${k}" data-k="inputs.${k}" rows="${rows}" placeholder="${ph}">${esc(p.inputs[k] || '')}</textarea></label>`;
  return `<div class="card brcard"><div class="row" style="justify-content:space-between;align-items:baseline"><h3 style="margin:0">Committee deck</h3></div>
    <div style="margin-top:10px">${ta('deckDesc', 'Project description (2–3 sentences)', 'e.g. Renovation of a 1930s office building in Mokotów into 24 apartments. The borrower bought the building in 2024 and has the building permit.', 3)}</div>
    <div class="brgrid">${ta('benefits', 'Main benefits', 'e.g. Central location close to the Old Town', 4)}${ta('risks', 'Main risks', 'e.g. Sponsor has no track record', 4)}</div></div>`;
}

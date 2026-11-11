// Home: projects grouped by stage, stage counts, Today view; pipeline stage, next action and open-item chasing.
const NO_ACTION_NEEDED = ['Rejected', 'Funded', 'Realised'];
const CHASE_DAYS = 5;
const chaseDue = (t) => !t.done && t.askedOn && wdBetween(t.askedOn, todayIso()) >= CHASE_DAYS;
function chasePill(t) { if (!t || t.done || !t.askedOn) return ''; const n = wdBetween(t.askedOn, todayIso()); return n >= CHASE_DAYS ? `<span class="pill chase" title="Asked ${n} working days ago and still open">chase</span>` : `<span class="sub tago">${n} wd</span>`; }
function nextState(p) { // 'ok' | 'missing' | 'overdue' | 'today' | 'none' (not needed)
  if (NO_ACTION_NEEDED.includes(p.status)) return 'none';
  if (!String(p.nextAction || '').trim()) return 'missing';
  if (p.nextDue && p.nextDue < todayIso()) return 'overdue';
  if (p.nextDue && p.nextDue === todayIso()) return 'today';
  return 'ok';
}

// ---- old statuses → stages; deal-level fields survive a version switch
const DEAL_LEVEL = (p) => ({ status: p.status, nextAction: p.nextAction, nextOwner: p.nextOwner, nextDue: p.nextDue, todos: clone(p.todos || []), judgement: clone(p.judgement || {}), benefits: p.inputs.benefits, risks: p.inputs.risks, deckDesc: p.inputs.deckDesc, links: clone(p.inputs.links || []), dealPlan: p.inputs.dealPlan || '', dealView: p.inputs.dealView || '' });

// ---- closing an open item stamps the date
document.addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.k, m = k && /^todos\.(\d+)\.done$/.exec(k); if (!m || !cur()) return;
  const t = cur().todos[+m[1]]; if (t) { t.closedOn = e.target.checked ? todayIso() : ''; scheduleSave(S.curId); }
});
document.addEventListener('change', (e) => { // new "asked on" → refresh the chase marker
  const k = e.target.dataset && e.target.dataset.k; if (k && /^todos\.\d+\.askedOn$/.test(k)) setTimeout(() => S.tab === 'overview' && renderTab(), 0);
});

// ---- Overview: stage buttons + next action
function pipelineCard(p) {
  const st = nextState(p);
  return `<div class="card pipecard"><div class="row" style="justify-content:space-between;align-items:baseline"><h3 style="margin:0">Pipeline</h3>${st === 'missing' || st === 'overdue' ? `<span class="pill bad">${st === 'missing' ? 'No next action' : 'Next action overdue'}</span>` : ''}</div>
    <div class="stages" role="group" aria-label="Stage">${STATUSES.map((s) => `<button class="stg ${stCls(s)}" data-act="set-stage" data-v="${esc(s)}" aria-pressed="${p.status === s}">${esc(s)}</button>`).join('')}</div>
    <div class="nextact ${st === 'missing' || st === 'overdue' ? 'warn' : ''}">
      <label class="nf"><span class="lbl">Next action</span><span class="ctl"><input class="in" id="m-nextAction" data-k="nextAction" value="${esc(p.nextAction)}" placeholder="${NO_ACTION_NEEDED.includes(p.status) ? 'Optional at this stage' : 'What happens next?'}"></span></label>
      <label class="nf"><span class="lbl">Who</span><span class="ctl"><input class="in" id="m-nextOwner" data-k="nextOwner" value="${esc(p.nextOwner)}" placeholder="Me / borrower / broker"></span></label>
      <label class="nf"><span class="lbl">Due</span><span class="ctl"><input class="in" type="date" id="m-nextDue" data-k="nextDue" value="${esc(p.nextDue)}"></span></label>
    </div></div>`;
}
function setStage(id, s) {
  const p = S.projects[id]; if (!p || p.status === s) return;
  p.status = s; scheduleSave(id, 10);
  if (S.view === 'project') { const c = $('.crumb'); if (c) c.innerHTML = `/ <b>${esc(p.name)}</b> <span class="pill ${stCls(p.status)}">${esc(p.status)}</span>`; renderTab(); }
  else renderHome();
  toast(`${p.name}: ${s}`);
}
document.addEventListener('input', (e) => { // next action edits update the warning without a full render
  const k = e.target.dataset && e.target.dataset.k; if (!['nextAction', 'nextDue'].includes(k) || S.view !== 'project') return;
  const st = nextState(cur()), box = $('.nextact'); if (box) box.classList.toggle('warn', st === 'missing' || st === 'overdue');
});

// ---- Home: grouped by stage, next action; Today view
S.homeView = 'pipeline';
function nextCell(p) {
  const st = nextState(p);
  if (st === 'none' && !p.nextAction) return '<span class="sub">–</span>';
  if (st === 'missing') return '<span class="nxt bad-t">No next action</span>';
  return `<span class="nxt ${st === 'overdue' ? 'bad-t' : ''}">${esc(p.nextAction)}</span><div class="sub">${esc([p.nextOwner, p.nextDue ? (st === 'overdue' ? 'overdue · ' : st === 'today' ? 'today · ' : '') + dshort(p.nextDue) : 'no date'].filter(Boolean).join(' · '))}</div>`;
}
function renderHome() {
  document.title = 'InRento Deal Desk';
  const all = homeRows(), total = all.length;
  const q = (S.q || '').toLowerCase();
  const list = all.filter(({ p }) => !q || (p.name + ' ' + p.borrower + ' ' + p.country + ' ' + p.projectType + ' ' + (p.nextAction || '')).toLowerCase().includes(q));
  const row = ({ id, p, m: r, r: rr, cur: c }) => `<tr data-open="${id}" tabindex="0" class="${['missing', 'overdue'].includes(nextState(p)) ? 'needs' : ''}">
    <td><b>${esc(p.name)}</b> ${lockBadge(id)}</td>
    <td class="nxtc">${nextCell(p)}</td>
    <td class="n">${r ? money(r.facility, c) : '–'}</td><td class="n">${r ? pctf(rr.rate, 2) : '–'}</td><td class="n">${r ? pctf(r.ltv0) : '–'}</td>
    <td class="sub">${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</td><td class="go" aria-hidden="true">›</td></tr>`;
  const groups = STATUSES.map((s) => [s, list.filter((x) => x.p.status === s).sort((a, b) => String(a.p.nextDue || '9999').localeCompare(String(b.p.nextDue || '9999')) || String(b.p.updatedAt || '').localeCompare(String(a.p.updatedAt || '')))])
    .filter(([s, l]) => l.length);
  const head = `<thead><tr><th>Project</th><th>Next action</th><th class="n">Loan</th><th class="n">Rate</th><th class="n">LTV</th><th>Updated</th><th></th></tr></thead>`;
  const table = `<div class="tblwrap pipewrap"><table class="reg pipe">${head}${groups.map(([s, l]) => `<tbody><tr class="grp"><th colspan="7"><span class="grph ${stCls(s)}">${esc(s)}</span> <span class="sub">${l.length}</span></th></tr>${l.map(row).join('') || '<tr class="empty-row"><td colspan="7" class="sub">None</td></tr>'}</tbody>`).join('')}</table></div>`;
  const toggle = `<div class="seg" role="tablist"><button class="segb" data-act="home-view" data-v="pipeline" aria-pressed="${S.homeView === 'pipeline'}">Pipeline</button><button class="segb" data-act="home-view" data-v="today" aria-pressed="${S.homeView === 'today'}">Today${todayCount() ? ` <span class="cnt">${todayCount()}</span>` : ''}</button><button class="segb" data-act="home-view" data-v="decisions" aria-pressed="${S.homeView === 'decisions'}">Decisions</button></div>`;
  const body = S.store === 'offline' ? (S.storeErr ? `<div class="card empty"><h2>Shared folder not found</h2><div>${esc(S.storeErr)}</div></div>` : `<div class="card empty"><h2>Deal Desk server is not running</h2><div>Click the Deal Desk icon in the Dock, then reload this page.</div></div>`)
    : !total ? (S.store === 'connecting' ? `<div class="empty">Loading your projects…</div>` : `<div class="card empty"><h2>No projects yet</h2><div>Create a project, fill in the inputs, and the model, cash flow and sensitivity build themselves.</div><button class="btn primary" data-act="new">New project</button></div>`)
    : S.homeView === 'today' ? `<div class="filters">${toggle}</div>${todayView()}`
    : S.homeView === 'decisions' ? `<div class="filters">${toggle}</div>${decisionsView()}`
    : `${stageCounts(all)}<div class="filters">${toggle}<input class="search" id="q" type="search" placeholder="Search name, borrower, next action" aria-label="Search projects" value="${esc(S.q)}"></div>${table}`;
  document.getElementById('app').innerHTML = topBar() + `<main class="wrap">
    <div class="home-head"><div class="t"><h1>Projects</h1><div class="sub">${S.info && S.info.storage ? `Shared folder: ${esc(S.info.storage.root.split('/').slice(-2).join(' / '))} on Google Drive · you are ${esc(S.info.storage.user)}${S.info.storage.error ? ` · <span class="bad-t">${esc(S.info.storage.error)}</span>` : ''}` : ''}</div></div>
    <div class="row"><button class="btn" data-act="backup-db" title="Copy deals.sqlite into the backups folder">Back up database</button><button class="btn" data-act="backup">Export all (JSON)</button><label class="btn" for="importf">Import</label><input id="importf" type="file" accept=".json,application/json" hidden></div></div>
    ${body}</main>`;
  renderSaveState();
}

// ---- Today: one list across all deals
function todayItems() {
  const t = todayIso(), dow = new Date(t + 'T12:00:00Z').getUTCDay(), weekEnd = isoAdd(t, (7 - dow) % 7);
  const out = { actions: [], missing: [], chases: [], cps: [] };
  for (const [id, p] of Object.entries(S.projects)) {
    const st = nextState(p);
    if (st === 'overdue' || st === 'today') out.actions.push({ id, p, due: p.nextDue });
    if (st === 'missing') out.missing.push({ id, p });
    (p.todos || []).forEach((td, i) => {
      if (chaseDue(td)) out.chases.push({ id, p, td, i, n: wdBetween(td.askedOn, t) });
      if (!td.done && ['Condition precedent', 'Covenant'].includes(td.category) && td.due && td.due <= weekEnd) out.cps.push({ id, p, td, i });
    });
  }
  out.actions.sort((a, b) => a.due.localeCompare(b.due)); out.cps.sort((a, b) => a.td.due.localeCompare(b.td.due));
  return out;
}
function todayCount() { const o = todayItems(); return o.actions.length + o.chases.length + o.cps.length; }
function todayView() {
  const o = todayItems(), t = todayIso();
  const sec = (title, sub, items, fn) => `<section class="card tday"><div class="row" style="justify-content:space-between"><h2>${title} <span class="sub">${items.length}</span></h2><span class="sub">${sub}</span></div>${items.length ? `<div class="tlist">${items.map(fn).join('')}</div>` : '<div class="sub">Nothing here.</div>'}</section>`;
  const deal = (x) => `<button class="tdeal" data-open="${x.id}">${esc(x.p.name)}</button>`;
  return `<div class="today">
    ${sec('Next actions due', 'overdue or due today', o.actions, (x) => `<div class="titem">${deal(x)}<span class="tw">${esc(x.p.nextAction)}${x.p.nextOwner ? ` <span class="sub">· ${esc(x.p.nextOwner)}</span>` : ''}</span><span class="${x.due < t ? 'bad-t' : 'warn-t'}">${x.due < t ? 'overdue · ' : 'today · '}${dshort(x.due)}</span></div>`)}
    ${sec('Chase', `open items asked ${CHASE_DAYS}+ working days ago`, o.chases, (x) => `<div class="titem">${deal(x)}<span class="tw">${esc(x.td.text)}${x.td.from ? ` <span class="sub">· from ${esc(x.td.from)}</span>` : ''}</span><span class="warn-t">asked ${dshort(x.td.askedOn)} · ${x.n} wd</span></div>`)}
    ${sec('Conditions and covenants this week', 'due by Sunday, including overdue', o.cps, (x) => `<div class="titem">${deal(x)}<span class="tw"><span class="pill">${x.td.category === 'Covenant' ? 'Covenant' : 'CP'}</span> ${esc(x.td.text)}</span><span class="${x.td.due < t ? 'bad-t' : ''}">${dshort(x.td.due)}</span></div>`)}
    ${o.missing.length ? sec('Deals without a next action', 'every active deal should have one', o.missing, (x) => `<div class="titem">${deal(x)}<span class="tw sub">${esc(x.p.status)}</span><span></span></div>`) : ''}
  </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'set-stage') return setStage(S.curId, b.dataset.v);
  if (a === 'home-view') { S.homeView = b.dataset.v; return renderHome(); }
}, true);

// ---------- HOME ----------
function homeRows() {
  return Object.entries(S.projects).map(([id, p]) => {
    let res = null; try { res = E.run(p); } catch {}
    return { id, p, m: res ? res.summary : null, r: res ? res.r : null, cur: p.inputs.currency || 'EUR' };
  });
}
function stageCounts(all) { // number of projects in each stage, above the list
  return `<section class="stagecounts" aria-label="Projects by stage">${STATUSES.map((s) => { const n = all.filter((x) => x.p.status === s).length; return `<div class="sc ${n ? '' : 'zero'}"><span class="pill ${stCls(s)}">${esc(s)}</span><b>${n}</b></div>`; }).join('')}</section>`;
}
function newProject(fromId) {
  const id = uid();
  const p = fromId ? normalise(clone(S.projects[fromId])) : blankProject();
  if (fromId) { p.name = p.name + ' (copy)'; p.status = 'New deal'; }
  p.createdAt = new Date().toISOString(); p._new = true; delete p.id;
  S.projects[id] = p; saveNow(id);
  go('project', id, 'overview');
  if (!fromId) setTimeout(() => { const n = $('#m-name'); if (n) { n.focus(); n.select(); } }, 30);
}

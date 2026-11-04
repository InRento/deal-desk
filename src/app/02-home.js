// Home: projects grouped by stage, portfolio tiles, Today view; pipeline stage, next action and open-item chasing.
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
const DEAL_LEVEL = (p) => ({ status: p.status, nextAction: p.nextAction, nextOwner: p.nextOwner, nextDue: p.nextDue, todos: clone(p.todos || []), judgement: clone(p.judgement || {}), gmailLabel: p.inputs.gmailLabel, benefits: p.inputs.benefits, risks: p.inputs.risks, deckDesc: p.inputs.deckDesc });

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

// ---- Home: grouped by stage, next action, email badge; Today view
S.homeView = 'pipeline';
function mailBadge(id) {
  const o = MS.ov && MS.ov.projects && MS.ov.projects[id]; if (!o) return '';
  if (!o.new && !o.owed) return `<span class="mbadge quiet" title="Linked to ${esc(o.label)}">✉</span>`;
  return `<span class="mbadge ${o.owed ? 'owed' : ''}" title="${esc(o.label)}">✉ ${o.new} new · ${o.owed} reply owed</span>`;
}
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
    <td><b>${esc(p.name)}</b> ${mailBadge(id)}<div class="sub">${esc([p.borrower, p.projectType].filter(Boolean).join(' · '))}</div></td>
    <td><select class="stsel ${stCls(p.status)}" data-act="stage-sel" data-id="${id}" aria-label="Stage of ${esc(p.name)}">${STATUSES.map((s) => `<option ${s === p.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td>
    <td class="nxtc">${nextCell(p)}</td>
    <td class="n">${r ? money(r.facility, c) : '–'}</td><td class="n">${r ? pctf(rr.rate, 2) : '–'}</td><td class="n">${r ? pctf(r.ltv0) : '–'}</td>
    <td class="n">${r ? pctf(r.irr, 2) : '–'}</td>
    <td>${r ? (r.flags ? `<span class="pill chk">${r.flags} to check</span>` : '<span class="pill ok">OK</span>') : ''}</td>
    <td class="sub">${p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</td></tr>`;
  const groups = STATUSES.map((s) => [s, list.filter((x) => x.p.status === s).sort((a, b) => String(a.p.nextDue || '9999').localeCompare(String(b.p.nextDue || '9999')) || String(b.p.updatedAt || '').localeCompare(String(a.p.updatedAt || '')))])
    .filter(([s, l]) => l.length);
  const head = `<thead><tr><th>Project</th><th>Stage</th><th>Next action</th><th class="n">Loan</th><th class="n">Rate</th><th class="n">LTV</th><th class="n">IRR</th><th>Checks</th><th>Updated</th></tr></thead>`;
  const table = `<div class="tblwrap"><table class="reg pipe">${head}${groups.map(([s, l]) => `<tbody><tr class="grp"><th colspan="9"><span class="pill ${stCls(s)}">${esc(s)}</span> <span class="sub">${l.length}</span></th></tr>${l.map(row).join('') || '<tr class="empty-row"><td colspan="9" class="sub">None</td></tr>'}</tbody>`).join('')}</table></div>`;
  const toggle = `<div class="seg" role="tablist"><button class="segb" data-act="home-view" data-v="pipeline" aria-pressed="${S.homeView === 'pipeline'}">Pipeline</button><button class="segb" data-act="home-view" data-v="today" aria-pressed="${S.homeView === 'today'}">Today${todayCount() ? ` <span class="cnt">${todayCount()}</span>` : ''}</button><button class="segb" data-act="home-view" data-v="decisions" aria-pressed="${S.homeView === 'decisions'}">Decisions</button></div>`;
  const mailBar = `<span class="mailbar">${MS.settings && MS.settings.address ? `<span class="sub">${MS.busy ? 'Checking Gmail…' : MS.ov && MS.ov.lastRefresh ? 'Gmail checked ' + dtime(MS.ov.lastRefresh) : 'Gmail not checked yet'}</span>${MS.ov && MS.ov.lastError ? ` <span class="bad-t" title="${esc(MS.ov.lastError)}">· error</span>` : ''} <button class="btn sm" data-act="mail-refresh" title="Check Gmail now" ${MS.busy ? 'disabled' : ''}>↻</button>` : ''}<button class="btn sm ghost" data-act="mail-settings">✉ Email settings</button></span>`;
  const body = S.store === 'offline' ? `<div class="card empty"><h2>Deal Desk server is not running</h2><div>Click the Deal Desk icon in the Dock, then reload this page.</div></div>`
    : !total ? (S.store === 'connecting' ? `<div class="empty">Loading your projects…</div>` : `<div class="card empty"><h2>No projects yet</h2><div>Create a project, fill in the inputs, and the model, cash flow and sensitivity build themselves.</div><button class="btn primary" data-act="new">New project</button></div>`)
    : S.homeView === 'today' ? `<div class="filters">${toggle}${mailBar}</div>${todayView()}`
    : S.homeView === 'decisions' ? `<div class="filters">${toggle}</div>${decisionsView()}`
    : `${portfolio(all)}<div class="filters">${toggle}<input class="search" id="q" type="search" placeholder="Search name, borrower, next action" aria-label="Search projects" value="${esc(S.q)}">${mailBar}</div>${table}`;
  document.getElementById('app').innerHTML = topBar() + `<main class="wrap">
    <div class="home-head"><div class="t"><h1>Projects</h1><div class="sub">${S.info ? `Stored in ${esc(S.info.db)} · ${(S.info.size / 1024).toFixed(0)} KB · ${S.info.backups} backup${S.info.backups === 1 ? '' : 's'}` : ''}</div></div>
    <div class="row"><button class="btn" data-act="backup-db" title="Copy deals.sqlite into the backups folder">Back up database</button><button class="btn" data-act="backup">Export all (JSON)</button><label class="btn" for="importf">Import</label><input id="importf" type="file" accept=".json,application/json" hidden></div></div>
    ${body}</main>`;
  renderSaveState();
}

// ---- Today: one list across all deals
function todayItems() {
  const t = todayIso(), dow = new Date(t + 'T12:00:00Z').getUTCDay(), weekEnd = isoAdd(t, (7 - dow) % 7);
  const out = { actions: [], missing: [], chases: [], owed: [], cps: [] };
  for (const [id, p] of Object.entries(S.projects)) {
    const st = nextState(p);
    if (st === 'overdue' || st === 'today') out.actions.push({ id, p, due: p.nextDue });
    if (st === 'missing') out.missing.push({ id, p });
    (p.todos || []).forEach((td, i) => {
      if (chaseDue(td)) out.chases.push({ id, p, td, i, n: wdBetween(td.askedOn, t) });
      if (!td.done && ['Condition precedent', 'Covenant'].includes(td.category) && td.due && td.due <= weekEnd) out.cps.push({ id, p, td, i });
    });
  }
  if (MS.ov) {
    for (const th of MS.ov.owed || []) if (S.projects[th.project]) out.owed.push({ id: th.project, p: S.projects[th.project], th });
    for (const th of MS.ov.waitingDue || []) if (S.projects[th.project]) out.chases.push({ id: th.project, p: S.projects[th.project], th });
  }
  out.actions.sort((a, b) => a.due.localeCompare(b.due)); out.cps.sort((a, b) => a.td.due.localeCompare(b.td.due));
  return out;
}
function todayCount() { const o = todayItems(); return o.actions.length + o.chases.length + o.owed.length + o.cps.length; }
function todayView() {
  const o = todayItems(), t = todayIso();
  const sec = (title, sub, items, fn) => `<section class="card tday"><div class="row" style="justify-content:space-between"><h2>${title} <span class="sub">${items.length}</span></h2><span class="sub">${sub}</span></div>${items.length ? `<div class="tlist">${items.map(fn).join('')}</div>` : '<div class="sub">Nothing here.</div>'}</section>`;
  const deal = (x) => `<button class="tdeal" data-open="${x.id}">${esc(x.p.name)}</button>`;
  return `<div class="today">
    ${sec('Next actions due', 'overdue or due today', o.actions, (x) => `<div class="titem">${deal(x)}<span class="tw">${esc(x.p.nextAction)}${x.p.nextOwner ? ` <span class="sub">· ${esc(x.p.nextOwner)}</span>` : ''}</span><span class="${x.due < t ? 'bad-t' : 'warn-t'}">${x.due < t ? 'overdue · ' : 'today · '}${dshort(x.due)}</span></div>`)}
    ${sec('Replies owed', 'last email is from them, older than 2 working days', o.owed, (x) => `<div class="titem">${deal(x)}<button class="tw linkish" data-act="mail-open-from-today" data-id="${x.id}" data-t="${x.th.thrid}">${esc(x.th.subject)} <span class="sub">· ${esc(x.th.lastFrom)}</span></button><span class="sub">${dshort(x.th.lastDate)}</span></div>`)}
    ${sec('Chase', `open items asked ${CHASE_DAYS}+ working days ago, and email follow-ups due`, o.chases, (x) => x.td ? `<div class="titem">${deal(x)}<span class="tw">${esc(x.td.text)}${x.td.from ? ` <span class="sub">· from ${esc(x.td.from)}</span>` : ''}</span><span class="warn-t">asked ${dshort(x.td.askedOn)} · ${x.n} wd</span></div>`
      : `<div class="titem">${deal(x)}<button class="tw linkish" data-act="mail-open-from-today" data-id="${x.id}" data-t="${x.th.thrid}">Waiting for ${esc(x.th.waitingFor || 'reply')} <span class="sub">· ${esc(x.th.subject)}</span></button><span class="warn-t">follow up ${dshort(x.th.waitingUntil)}</span></div>`)}
    ${sec('Conditions and covenants this week', 'due by Sunday, including overdue', o.cps, (x) => `<div class="titem">${deal(x)}<span class="tw"><span class="pill">${x.td.category === 'Covenant' ? 'Covenant' : 'CP'}</span> ${esc(x.td.text)}</span><span class="${x.td.due < t ? 'bad-t' : ''}">${dshort(x.td.due)}</span></div>`)}
    ${o.missing.length ? sec('Deals without a next action', 'every active deal should have one', o.missing, (x) => `<div class="titem">${deal(x)}<span class="tw sub">${esc(x.p.status)}</span><span></span></div>`) : ''}
  </div>`;
}

document.addEventListener('change', (e) => {
  const s = e.target.closest && e.target.closest('[data-act="stage-sel"]'); if (s) setStage(s.dataset.id, s.value);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'stage-sel') { e.stopPropagation(); return; }
  if (a === 'set-stage') return setStage(S.curId, b.dataset.v);
  if (a === 'home-view') { S.homeView = b.dataset.v; return renderHome(); }
  if (a === 'mail-refresh') return mailRefresh(true);
  if (a === 'mail-settings') return mailSettings();
  if (a === 'mail-open-from-today') { go('project', b.dataset.id, 'emails'); return openThread(b.dataset.t); }
}, true);

// ---------- HOME ----------
function homeRows() {
  return Object.entries(S.projects).map(([id, p]) => {
    let res = null; try { res = E.run(p); } catch {}
    return { id, p, m: res ? res.summary : null, r: res ? res.r : null, cur: p.inputs.currency || 'EUR' };
  });
}
function portfolio(all) {
  const act = all.filter((x) => x.m && ACTIVE.includes(x.p.status));
  if (!act.length) return '';
  const byCur = {};
  for (const x of act) { const c = x.cur; (byCur[c] = byCur[c] || { n: 0, loan: 0, w: 0, wl: 0, wr: 0 }); const b = byCur[c]; b.n++; b.loan += x.m.facility; if (x.m.ltv0 != null) { b.w += x.m.facility; b.wl += x.m.ltv0 * x.m.facility; } b.wr += x.r.rate * x.m.facility; }
  const byStatus = ACTIVE.map((s) => { const l = act.filter((x) => x.p.status === s); return { s, n: l.length, byC: l.reduce((o, x) => ((o[x.cur] = (o[x.cur] || 0) + x.m.facility), o), {}) }; }).filter((x) => x.n);
  const maxStatus = Math.max(1, ...byStatus.map((b) => Object.values(b.byC).reduce((a, v) => a + v, 0)));
  const today = E.parseDate(new Date().toISOString().slice(0, 10)); const in12 = E.edate(today, 12);
  const mat = all.filter((x) => x.m && ['Turned in', 'Funded'].includes(x.p.status) && x.m.maturity <= in12).sort((a, b) => a.m.maturity - b.m.maturity);
  const flagged = act.filter((x) => x.m.flags > 0).length;
  const countries = {}; for (const x of act) countries[x.p.country || 'not set'] = (countries[x.p.country || 'not set'] || 0) + 1;
  const curRows = Object.entries(byCur).map(([c, b]) => `<div class="tile"><div class="l">Active volume · ${esc(c)}</div><div class="v" title="${money(b.loan, c)}">${sym(c)}${compact(b.loan)}</div><div class="s">${b.n} deal${b.n > 1 ? 's' : ''} · w. rate ${pctf(b.wr / b.loan, 2)} · w. LTV ${b.w ? pctf(b.wl / b.w) : '–'}</div></div>`).join('');
  return `<section class="card" style="margin-bottom:16px" aria-label="Portfolio overview"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2>Portfolio</h2><span class="sub">New deal to Funded · full facilities</span></div>
    <div class="tiles">${curRows}
      <div class="tile"><div class="l">Deals with flags</div><div class="v ${flagged ? 'bad' : 'good'}">${flagged} / ${act.length}</div><div class="s">checks to resolve</div></div>
      <div class="tile"><div class="l">Countries</div><div class="v" style="font-size:15px">${Object.entries(countries).map(([c, n]) => `${esc(c)} ${n}`).join(' · ')}</div><div class="s">active deals</div></div></div>
    <div class="cols" style="margin-top:14px"><div><h3 style="margin-bottom:8px">Pipeline by status</h3>${byStatus.map((b) => { const tot = Object.values(b.byC).reduce((a, v) => a + v, 0); return `<div class="pbar"><span class="pl">${esc(b.s)} <span class="sub">${b.n}</span></span><span class="pt"><i style="width:${(tot / maxStatus * 100).toFixed(1)}%"></i></span><span class="pv">${Object.entries(b.byC).map(([c, v]) => sym(c) + compact(v)).join(' + ')}</span></div>`; }).join('')}</div>
    <div><h3 style="margin-bottom:8px">Maturities in the next 12 months <span class="sub">· turned in and funded</span></h3>${mat.length ? `<div class="tblwrap"><table><tbody>${mat.map((x) => `<tr data-open="${x.id}" tabindex="0" class="click"><td>${esc(x.p.name)}</td><td class="n">${datef(x.m.maturity)}</td><td class="n">${money(x.m.facility, x.cur)}</td><td>${x.m.cashAtMaturity < 0 ? '<span class="pill chk">exit not covered</span>' : '<span class="pill ok">covered</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sub">None.</div>'}</div></div></section>`;
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

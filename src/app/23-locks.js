// Deal locks: only the person holding a deal's lock edits it; everyone else – and everyone, while nobody holds it – sees
// it read-only. The server refuses every other write; this file shows who holds what, takes and releases locks, and keeps
// read-only copies fresh while someone else edits.
S.locks = {}; S.server = {}; S.lockBusy = null; S.forceAsk = null; S.me = '';

// "12:55" for today, "3 Nov, 12:55" before
const lockTime = (iso) => { if (!iso) return ''; const d = new Date(iso), t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${t}`; };
const personName = (u) => { const s = String(u || '').split('@')[0]; return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Someone'; };
const LOCK_ICON = '<svg class="lki" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none"/></svg>';
const PEN_ICON = '<svg class="lki" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3.5L10.5 3l2.5 2.5L6.5 12z"/></svg>';

// a deal never saved yet belongs to whoever is creating it (the server locks it to them on the first save)
function canEdit(id) { const l = S.locks[id]; return !!(l && l.me) || !S.server[id]; }

function lockBar() {
  const id = S.curId, l = S.locks[id];
  if (S.lockBusy === id) return `<div class="lockbar">${LOCK_ICON}<b>Locking…</b> <span class="sub">checking that nobody took it at the same moment</span></div>`;
  if (canEdit(id)) return `<div class="lockbar mine">${PEN_ICON}<b>You're editing</b> <span class="sub">${l && l.since ? `locked since ${lockTime(l.since)} · ` : ''}others see this deal read-only</span> <span class="spacer"></span> <button class="btn sm" data-act="unlock">Unlock</button></div>`;
  if (!l) return `<div class="lockbar free">${LOCK_ICON}<b>Read-only</b> <span class="sub">nobody is editing this deal</span> <span class="spacer"></span> <button class="btn sm primary" data-act="lock">Lock &amp; edit</button></div>`;
  const who = esc(personName(l.user));
  if (S.forceAsk === id) return `<div class="lockbar other">${LOCK_ICON}<b>Take over from ${who}?</b> <span class="sub">Anything ${who} types after this is not saved to the deal; it is kept in a file in the deal's folder.</span> <span class="spacer"></span> <button class="btn sm" data-act="force-cancel">Cancel</button> <button class="btn sm takeover" data-act="force-go">Take over</button></div>`;
  return `<div class="lockbar other">${LOCK_ICON}<b>Locked by ${who}</b> <span class="sub">since ${lockTime(l.since)}${l.lastActive ? ` · last active ${lockTime(l.lastActive)}` : ''} · read-only for you</span> <span class="spacer"></span> <button class="btn sm ghost" data-act="force-ask" title="Use when ${who} is away and forgot to unlock">Force unlock</button></div>`;
}
function lockBadge(id) {
  const l = S.locks[id];
  if (!l) return '';
  return l.me ? `<span class="lockpill mine" title="You are editing this deal">${PEN_ICON}You</span>`
    : `<span class="lockpill" title="Locked by ${esc(l.user)} since ${esc(lockTime(l.since))}">${LOCK_ICON}${esc(personName(l.user))}</span>`;
}
function renderLockBar() {
  const el = $('#lockbar'); if (!el || S.view !== 'project') return;
  el.innerHTML = lockBar(); applyReadOnly();
}
function applyReadOnly() {
  const ro = S.view === 'project' && !!S.curId && !canEdit(S.curId);
  document.body.classList.toggle('ro', ro);
  if (!ro) return;
  document.querySelectorAll('#tabbody [data-k], #tabbody #newtodo, #undo-btn, #redo-btn').forEach((el) => { el.disabled = true; });
}
// last resort for an edit made on a read-only deal (a button that slipped through): put the saved copy back
function readOnlyRevert(id) {
  if (S.server[id]) S.projects[id] = normalise(clone(S.server[id]));
  const l = S.locks[id];
  toast(l ? `Read-only – ${personName(l.user)} is editing this deal` : 'Read-only – click “Lock & edit” first');
  if (S.view === 'project') recalc(true);
  render();
}
function adoptProject(p) {
  const id = p.id;
  S.base[id] = p._base; S.locks[id] = p._lock || null; delete p._base; delete p._lock;
  S.projects[id] = normalise(p); S.server[id] = clone(S.projects[id]);
  delete UNDO[id]; undoInit(id);
}

async function takeLock(id, force) {
  S.lockBusy = id; S.forceAsk = null; renderLockBar();
  try {
    const r = await api('POST', `/api/projects/${encodeURIComponent(id)}/lock`, { force: !!force });
    if (r.project) adoptProject(r.project);
    S.locks[id] = r.lock;
    toast(force ? 'You took over the lock' : 'Locked – you can edit');
  } catch (e) { toast(e.message); await pollLocks(); }
  S.lockBusy = null;
  if (S.curId === id) recalc(true);
  render();
}
async function releaseLock(id) {
  clearTimeout(timers[id]);
  if (S.dirty.has(id)) await saveNow(id); // what was typed goes to the drive before anyone else can take the deal
  try { await api('DELETE', `/api/projects/${encodeURIComponent(id)}/lock`); S.locks[id] = null; toast('Unlocked – the deal is read-only for everyone until someone locks it'); }
  catch (e) { toast(e.message); }
  render();
}

let polling = false;
async function pollLocks() {
  if (S.store !== 'sqlite' || polling) return;
  polling = true;
  try {
    const r = await api('GET', '/api/locks');
    S.me = r.me;
    const before = JSON.stringify(S.locks), fresh = [];
    for (const id of Object.keys(S.projects)) if (S.server[id]) S.locks[id] = r.locks[id] || null;
    for (const [id, rev] of Object.entries(r.revs || {})) {
      if (S.projects[id] ? (!canEdit(id) && rev > (S.base[id] || 0)) : true) {
        try { adoptProject(await api('GET', '/api/projects/' + encodeURIComponent(id))); fresh.push(id); } catch {}
      }
    }
    if (JSON.stringify(S.locks) === before && !fresh.length) return;
    if (S.view === 'home') {
      const typing = document.activeElement && document.activeElement.matches('#app input, #app textarea');
      if (!typing) renderHome();
    } else if (fresh.includes(S.curId)) { recalc(true); render(); }
    else { renderLockBar(); if (!canEdit(S.curId)) renderTab(); }
  } catch {} finally { polling = false; }
}
setInterval(pollLocks, 5000);

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = S.curId;
  if (a === 'lock') takeLock(id, false);
  else if (a === 'force-go') takeLock(id, true);
  else if (a === 'unlock') releaseLock(id);
  else if (a === 'force-ask') { S.forceAsk = id; renderLockBar(); }
  else if (a === 'force-cancel') { S.forceAsk = null; renderLockBar(); }
});

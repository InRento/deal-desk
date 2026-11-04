// Updates: the launcher runs the version published on the shared drive. When a newer one is published, a bar offers a
// restart (pending saves are written first); an app too old for the shared deals can only view them until it restarts.
// The state arrives with the lock poll (/api/locks → update).
S.update = null; S.updBusy = false;

function updateBar(u) {
  if (u) S.update = u;
  let el = $('#updbar');
  const show = S.update && (S.update.available || S.update.required);
  if (!show) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'updbar'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  const v = S.update.available, req = S.update.required;
  el.className = 'updbar' + (req ? ' req' : '');
  el.innerHTML = S.updBusy ? '<b>Restarting Deal Desk…</b> <span class="sub">this page reloads by itself</span>'
    : `<b>${req ? `This Deal Desk (${esc(S.update.version)}) can only view deals` : `Deal Desk ${esc(v)} is ready`}</b> <span class="sub">${req ? `the shared deals need ${esc(req)} or newer` : 'your work is saved before it restarts'}</span>
      ${S.update.canRestart ? `<button class="btn sm ${req ? 'takeover' : 'primary'}" data-act="upd-restart">Restart to update</button>` : '<span class="sub">– close this tab and open Deal Desk again</span>'}`;
}
async function restartForUpdate() {
  S.updBusy = true; updateBar();
  for (const id of [...S.dirty]) { clearTimeout(timers[id]); await saveNow(id); }
  try { await api('POST', '/api/restart', {}); } catch (e) { S.updBusy = false; updateBar(); return toast(e.message); }
  // reload once a server answers again: the new version, or the old one if the download was not complete yet
  let wasDown = false;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await (await fetch('/api/ping', { cache: 'no-store' })).json();
      if (r.version !== S.update.version || wasDown) return location.reload();
    } catch { wasDown = true; }
  }
  S.updBusy = false; updateBar(); toast('Deal Desk did not come back – open it again from the Dock');
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-act="upd-restart"]')) restartForUpdate(); });

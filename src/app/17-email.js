// ================= Email =================
const MS = { settings: null, ov: null, proj: {}, busy: false, labels: null, panel: null, w: 560 };
const mailApi = (m, p, b) => api(m, '/api/mail/' + p, b);
async function mailLoadOverview() { try { MS.ov = await mailApi('GET', 'overview'); } catch { MS.ov = null; } }
async function mailBoot() {
  try { MS.settings = await mailApi('GET', 'settings'); } catch { return; }
  await mailLoadOverview(); if (S.view === 'home') renderHome();
  if (MS.settings.address && MS.settings.hasPassword) mailRefresh(false);
}
async function mailRefresh(manual) {
  if (MS.busy) return; MS.busy = true; rerenderMail();
  let r = null; try { r = await mailApi('POST', 'refresh', {}); } catch (e) { r = { ok: false, error: e.message }; }
  MS.busy = false; await mailLoadOverview(); MS.proj = {};
  if (!r.ok && manual) toast(r.error || 'Could not check Gmail');
  else if (manual) toast(r.new ? `${r.new} new email${r.new > 1 ? 's' : ''}` : 'No new email');
  if (S.view === 'project' && S.tab === 'emails') await loadProjectMail(S.curId);
  rerenderMail();
}
function rerenderMail() { if (S.view === 'home') renderHome(); else if (S.tab === 'emails') renderTab(); }
setInterval(() => { if (MS.settings && MS.settings.hasPassword && !document.hidden) mailRefresh(false); }, 15 * 60 * 1000);

// ---- settings
async function mailSettings() {
  try { MS.settings = await mailApi('GET', 'settings'); } catch {}
  const s = MS.settings || {};
  let ov = $('#mailset'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'mailset'; ov.className = 'deckov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Email settings');
  ov.innerHTML = `<div class="card msetbox"><div class="row" style="justify-content:space-between"><h2>Email settings</h2><button class="btn sm ghost" data-ms="close" aria-label="Close">✕</button></div>
    <div class="sub" style="margin:4px 0 12px">Deal Desk reads Gmail over IMAP, read-only: it never sends, deletes or marks mail as read. The app password is kept in the macOS Keychain (item “Deal Desk Gmail”), not in the database.</div>
    <div class="form">
      <label class="f"><span class="lbl">Gmail address</span><span class="ctl"><input class="in" id="ms-addr" value="${esc(s.address || '')}" placeholder="name@inrento.com" autocomplete="off"></span></label>
      <label class="f"><span class="lbl">App password</span><span class="ctl"><input class="in" id="ms-pw" type="password" autocomplete="new-password" placeholder="${s.hasPassword ? 'Saved in Keychain – leave empty to keep' : '16 letters from Google'}"></span></label>
      <label class="f"><span class="lbl">Other addresses that are you</span><span class="ctl"><input class="in" id="ms-alias" value="${esc(s.aliases || '')}" placeholder="aliases, comma separated (optional)"></span></label>
    </div>
    <details style="margin-top:10px"><summary class="sub">How to get an app password</summary><ol class="sub" style="margin:6px 0 0 18px;line-height:1.6">
      <li>Google Account → Security → turn on 2-Step Verification (required).</li><li>Google Account → Security → App passwords (or search “App passwords”) → create one named “Deal Desk” → copy the 16 letters here.</li>
      <li>Gmail → Settings → See all settings → Forwarding and POP/IMAP → IMAP access: Enable.</li><li>On a company Google Workspace account the administrator must allow app passwords and IMAP.</li>
      <li>In Gmail, give each deal a label named like the project, in any folder (e.g. New deals/Riverside, Riga – accents and the part after a comma don't matter), or pick any label on the project's Emails tab.</li></ol></details>
    <div id="ms-msg" class="sub" style="margin-top:10px">${s.lastError ? `<span class="bad-t">${esc(s.lastError)}</span>` : s.lastRefresh ? 'Last checked ' + dtime(s.lastRefresh) : ''}</div>
    <div class="row" style="justify-content:space-between;margin-top:12px"><span>${s.hasPassword ? '<button class="btn sm ghost" data-ms="forget">Remove saved password</button>' : ''}</span><span class="row" style="gap:8px"><button class="btn" data-ms="test">Save and test</button><button class="btn primary" data-ms="save">Save</button></span></div></div>`;
  document.body.appendChild(ov); $('#ms-addr').focus();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ms]'); if (!b) return;
  const act = b.dataset.ms, msg = $('#ms-msg');
  if (act === 'close') return $('#mailset').remove();
  const body = { address: $('#ms-addr').value.trim(), password: $('#ms-pw').value, aliases: $('#ms-alias').value.trim(), forget: act === 'forget' };
  b.disabled = true; msg.innerHTML = 'Saving…';
  let r; try { r = await mailApi('PUT', 'settings', body); } catch (err) { r = { ok: false, error: err.message }; }
  if (!r.ok) { b.disabled = false; msg.innerHTML = `<span class="bad-t">${esc(r.error)}</span>`; return; }
  MS.settings = await mailApi('GET', 'settings');
  if (act === 'forget') { $('#mailset').remove(); toast('Password removed from the Keychain'); return rerenderMail(); }
  if (act === 'test') {
    msg.innerHTML = 'Connecting to Gmail…';
    const t = await mailApi('POST', 'test', {}).catch((err) => ({ ok: false, error: err.message }));
    b.disabled = false;
    msg.innerHTML = t.ok ? `<span class="good-t">${esc(t.message)}</span>` : `<span class="bad-t">${esc(t.error)}</span>`;
    if (t.ok) mailRefresh(false);
    return;
  }
  $('#mailset').remove(); toast('Email settings saved'); if (MS.settings.hasPassword) mailRefresh(false); else rerenderMail();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = $('#mailset') || $('#mwait'); if (m) m.remove(); } });

// ---- Emails tab
const ei = TABS.findIndex((t) => t[0] === 'versions'); TABS.splice(ei < 0 ? TABS.length : ei, 0, ['emails', 'Emails']);
async function loadProjectMail(id) {
  try { MS.proj[id] = await mailApi('GET', 'project/' + encodeURIComponent(id)); } catch (e) { MS.proj[id] = { error: e.message, threads: [] }; }
  try { MS.labels = await mailApi('GET', 'labels'); } catch {} // reloaded every time: the list fills after the first Gmail check
}
const ST_CLS = { new: 'mnew', 'reply owed': 'mowed', waiting: 'mwait', handled: 'mdone' };
function tabEmails() {
  const id = S.curId, p = cur(), d = MS.proj[id];
  if (!d) { loadProjectMail(id).then(() => S.tab === 'emails' && S.curId === id && renderTab()); return '<div class="card"><div class="sub">Loading emails…</div></div>'; }
  const s = MS.settings || {}, labels = (MS.labels && MS.labels.labels) || [];
  const auto = !p.inputs.gmailLabel && d.label;
  const setup = !s.address || !s.hasPassword ? `<div class="banner">Gmail is not connected yet. <button class="btn sm primary" data-act="mail-settings">Connect Gmail</button></div>` : '';
  const labelSel = `<select class="in" id="mlabel" aria-label="Gmail label" style="max-width:340px"><option value="">${d.label && auto ? 'Automatic: ' + esc(d.label) : labels.length ? 'Automatic: no label matches the name' : 'Automatic (labels load after the first Gmail check)'}</option>${labels.map((l) => `<option ${l === p.inputs.gmailLabel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const head = `<div class="card"><div class="row mhead"><span class="lbl">Gmail label</span>${labelSel}
      <span class="sub">${d.label ? (auto ? 'matched by name' : '') : labels.length ? 'no label matches – pick one from the list' : ''}</span><span class="spacer"></span>
      <span class="sub">${MS.busy ? 'Checking Gmail…' : d.lastRefresh ? 'Checked ' + dtime(d.lastRefresh) : ''}</span><button class="btn sm" data-act="mail-refresh" ${MS.busy || !s.hasPassword ? 'disabled' : ''} title="Check Gmail now">↻</button><button class="btn sm ghost" data-act="mail-settings">Settings</button></div>
      ${d.lastError ? `<div class="bad-t" style="margin-top:6px">${esc(d.lastError)}</div>` : ''}</div>`;
  const sum = d.summary ? `<div class="card msum"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Summary from Claude</h3><span class="sub">${esc(d.summary.date ? dshort(d.summary.date) + ' ' + d.summary.date.slice(0, 4) : dshort(d.summary.created_at))}</span></div><div class="msumt">${esc(d.summary.text)}</div></div>` : '';
  const th = d.threads || [];
  const rows = th.map((t) => `<tr class="mrow ${t.unseen ? 'unseen' : ''} ${MS.panel === t.thrid ? 'sel' : ''}" data-thread="${t.thrid}" tabindex="0">
      <td><span class="pill ${ST_CLS[t.status] || ''}">${esc(t.status)}</span>${t.unseen ? ' <span class="dot" title="New since you last opened it"></span>' : ''}</td>
      <td><b class="msubj">${esc(t.subject)}</b><div class="sub">${esc(t.people.join(', '))}${t.count > 1 ? ' · ' + t.count : ''}${t.status === 'waiting' && t.waitingFor ? ` · waiting for ${esc(t.waitingFor)}${t.waitingUntil ? ' until ' + dshort(t.waitingUntil) : ''}` : ''}${t.todo ? ' · open item' : ''}</div></td>
      <td class="n sub">${dshort(t.lastDate)}</td>
      <td class="macts"><a class="btn sm ghost" href="${esc(t.link)}" target="_blank" rel="noopener" title="Open the thread in Gmail">Gmail ↗</a><button class="btn sm ghost" data-mact="todo" data-t="${t.thrid}" title="Add an open item for this thread">→ Open item</button><button class="btn sm ghost" data-mact="wait" data-t="${t.thrid}">Waiting for…</button>${t.status === 'handled' ? `<button class="btn sm ghost" data-mact="reopen" data-t="${t.thrid}">Reopen</button>` : `<button class="btn sm" data-mact="handled" data-t="${t.thrid}">Mark handled</button>`}</td></tr>`).join('');
  const counts = ['reply owed', 'new', 'waiting', 'handled'].map((k) => [k, th.filter((t) => t.status === k).length]).filter((x) => x[1]);
  return setup + head + sum + `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0">Threads <span class="sub">${th.length}</span></h3><span class="sub">${counts.map(([k, n]) => `${n} ${k}`).join(' · ')}</span></div>
    ${th.length ? `<div class="tblwrap"><table class="mtbl"><tbody>${rows}</tbody></table></div>` : `<div class="sub">${d.label ? 'No email in this label yet.' : 'No Gmail label linked to this project.'}</div>`}</div>`;
}
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'mlabel') return;
  const p = cur(); p.inputs.gmailLabel = e.target.value; scheduleSave(S.curId, 10);
  await new Promise((r) => setTimeout(r, 400)); await saveNow(S.curId);
  delete MS.proj[S.curId]; renderTab(); mailRefresh(false);
});

// thread actions
async function threadAct(thrid, body) { await mailApi('POST', 'thread/' + thrid, body); await Promise.all([loadProjectMail(S.curId), mailLoadOverview()]); renderTab(); if (MS.panel === thrid) renderMailPanel(); }
function threadOf(thrid) { const d = MS.proj[S.curId]; return d && (d.threads || []).find((t) => t.thrid === thrid); }
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mact]');
  if (b) {
    e.stopPropagation(); const t = b.dataset.t, th = threadOf(t) || (MS.pdata && MS.pdata.thread);
    if (b.dataset.mact === 'handled') return threadAct(t, { action: 'handled' });
    if (b.dataset.mact === 'reopen') return threadAct(t, { action: 'reopen' });
    if (b.dataset.mact === 'wait') return waitDialog(t, th);
    if (b.dataset.mact === 'todo') {
      const other = th ? th.people.find((x) => x !== 'me') || '' : '';
      const text = th ? (th.status === 'reply owed' ? `Reply to ${th.lastFrom}: ${th.subject}` : th.subject) : 'Email thread';
      editProject((q) => { q.todos.push({ text, done: false, category: 'Open item', due: '', from: th && th.status === 'reply owed' ? 'me' : other, askedOn: todayIso() }); }, 'Open item added on Overview · ⌘Z to undo');
      return threadAct(t, { action: 'todo', text });
    }
    return;
  }
  const row = e.target.closest('tr[data-thread]'); if (row && !e.target.closest('a,button')) openThread(row.dataset.thread);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-thread]')) openThread(e.target.dataset.thread); });
function waitDialog(thrid, th) {
  let ov = $('#mwait'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'mwait'; ov.className = 'deckov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Waiting for');
  ov.innerHTML = `<div class="card msetbox"><h2>Waiting for…</h2><div class="sub" style="margin:4px 0 10px">${esc(th ? th.subject : '')}</div><div class="form">
    <label class="f"><span class="lbl">What are you waiting for?</span><span class="ctl"><input class="in" id="mw-what" value="${esc(th && th.waitingFor && !/^reply from/.test(th.waitingFor) ? th.waitingFor : '')}" placeholder="e.g. signed term sheet from Jonas"></span></label>
    <label class="f"><span class="lbl">Follow up on</span><span class="ctl"><input class="in" type="date" id="mw-date" value="${esc((th && th.waitingUntil) || wdAdd(todayIso(), CHASE_DAYS))}"></span></label></div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" data-mw="cancel">Cancel</button><button class="btn primary" data-mw="ok">Save</button></div></div>`;
  document.body.appendChild(ov); $('#mw-what').focus();
  ov.addEventListener('click', async (e) => { const b = e.target.closest('[data-mw]'); if (!b) return; const what = $('#mw-what').value.trim(), until = $('#mw-date').value; ov.remove(); if (b.dataset.mw === 'ok') { await threadAct(thrid, { action: 'waiting', waitingFor: what || 'reply', waitingUntil: until }); toast('The follow-up date appears in Today when it is due'); } });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Enter') ov.querySelector('[data-mw="ok"]').click(); });
}

// ---- conversation panel (right side, like the documents panel)
function closeMail() { MS.panel = null; MS.pdata = null; const el = $('#mailpanel'); if (el) el.remove(); document.body.classList.remove('withdocs'); document.body.style.paddingRight = ''; }
async function openThread(thrid, snippet) {
  MS.panel = thrid; MS.snip = snippet || null; MS.pdata = null; renderMailPanel();
  try { MS.pdata = await mailApi('GET', 'thread/' + thrid); } catch (e) { MS.pdata = { error: e.message, messages: [] }; }
  if (MS.panel !== thrid) return;
  renderMailPanel();
  await mailApi('POST', 'thread/' + thrid, { action: 'seen' }).catch(() => {});
  await Promise.all([S.curId ? loadProjectMail(S.curId) : null, mailLoadOverview()]);
  if (S.view === 'project' && S.tab === 'emails') renderTab();
}
function splitBody(text) { // → {main, quoted, sig}
  const L = String(text || '').replace(/\r/g, '').split('\n');
  let q = L.length;
  for (let i = 0; i < L.length; i++) {
    const l = L[i].trim(), two = (l + ' ' + (L[i + 1] || '').trim());
    if (/^>/.test(l) && L.slice(i).filter((x) => x.trim()).every((x) => /^>/.test(x.trim()) || /wrote:|napisał|rašė/.test(x))) { q = i; break; }
    if (/^(On|Am|Le|El)\b.{4,200}(wrote|schrieb|a écrit|escribió):\s*$/i.test(l) || /^(On|Am)\b.{4,200}(wrote|schrieb):\s*$/i.test(two) && /^(On|Am)\b/.test(l)) { q = i; break; }
    if (/(napisał\(a\)|napisał|napisała|rašė|написал)\s*:?\s*$/i.test(l) || /^-{2,}\s*(Original Message|Forwarded message|Pradinis laiškas|Wiadomość oryginalna)/i.test(l)) { q = i; break; }
    if (/^(From|Nuo|Od):\s/.test(l) && /^(Sent|Date|Išsiųsta|Data|Wysłano):\s/.test((L[i + 1] || '').trim())) { q = i; break; }
  }
  const main = L.slice(0, q), quoted = L.slice(q).join('\n').trim();
  let s = main.length;
  for (let i = Math.max(0, main.length - 18); i < main.length; i++) {
    const l = main[i].trim();
    if (l === '--' || l === '-- ' || /^(Best regards|Kind regards|Regards|Best|Thanks|Thank you|Cheers|Pagarbiai|Su pagarba|Linkėjimai|Z poważaniem|Pozdrawiam|Mit freundlichen Grüßen|Sent from my)\b[,.!]?\s*$/i.test(l)) { s = i; break; }
  }
  return { main: main.slice(0, s).join('\n').trim(), sig: main.slice(s).join('\n').trim(), quoted };
}
function hl(html) { // highlight the snippet a source tag points to
  if (!MS.snip) return html; const n = esc(MS.snip).trim(); if (n.length < 3) return html;
  const i = html.toLowerCase().indexOf(n.toLowerCase()); return i < 0 ? html : html.slice(0, i) + '<mark class="dpm cur">' + html.slice(i, i + n.length) + '</mark>' + html.slice(i + n.length);
}
function renderMailPanel() {
  let el = $('#mailpanel');
  if (!MS.panel || S.view !== 'project') { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('aside'); el.id = 'mailpanel'; el.setAttribute('aria-label', 'Email conversation'); document.body.appendChild(el); }
  const w = MS.w; document.body.classList.add('withdocs'); document.body.style.paddingRight = w + 'px'; el.style.width = w + 'px';
  const d = MS.pdata, t = (d && d.thread) || threadOf(MS.panel);
  const msgs = (d && d.messages) || [];
  el.innerHTML = `<div class="dpgrip" title="Drag to resize"></div><div class="dphead"><b class="mptitle">${esc(t ? t.subject : 'Loading…')}</b><button class="btn sm ghost" data-mp="close" aria-label="Close conversation">✕</button></div>
    ${t ? `<div class="dpmeta"><span class="pill ${ST_CLS[t.status] || ''}">${esc(t.status)}</span><span class="sub">${t.count} message${t.count > 1 ? 's' : ''}</span><span class="spacer"></span>
      <a class="btn sm ghost" href="${esc(t.link)}" target="_blank" rel="noopener">Open in Gmail ↗</a><button class="btn sm ghost" data-mact="todo" data-t="${t.thrid}">→ Open item</button><button class="btn sm ghost" data-mact="wait" data-t="${t.thrid}">Waiting for…</button>${t.status === 'handled' ? `<button class="btn sm ghost" data-mact="reopen" data-t="${t.thrid}">Reopen</button>` : `<button class="btn sm" data-mact="handled" data-t="${t.thrid}">Mark handled</button>`}</div>` : ''}
    <div class="dpbody"><div class="mpmsgs">${d && d.error ? `<div class="bad-t" style="padding:16px">${esc(d.error)}</div>` : !d ? '<div class="sub" style="padding:16px">Loading…</div>' : msgs.map((m) => { const b = splitBody(m.body); return `<article class="mpmsg ${m.me ? 'me' : ''}">
      <div class="mpfrom"><b>${esc(m.me ? 'Me' : m.from)}</b> <span class="sub">${esc(m.fromAddr)}</span><span class="spacer"></span><span class="sub">${dtime(m.date)}</span></div>
      <div class="sub mpto">To ${esc(m.to)}${m.cc ? ' · Cc ' + esc(m.cc) : ''}</div>
      ${m.attachments.length ? `<div class="mpatt">${m.attachments.map((a) => `<span class="pill" title="Attachment – open it in Gmail">📎 ${esc(a)}</span>`).join('')}</div>` : ''}
      <div class="mpbody">${hl(esc(b.main)) || '<span class="sub">(no text)</span>'}</div>
      ${b.sig ? `<details class="mpfold"><summary>Signature</summary><div class="mpbody sub">${esc(b.sig)}</div></details>` : ''}
      ${b.quoted ? `<details class="mpfold"><summary>Quoted history</summary><div class="mpbody sub">${hl(esc(b.quoted))}</div></details>` : ''}</article>`; }).join('')}</div></div>`;
  const cm = el.querySelector('mark.cur'); if (cm) { const f = cm.closest('details'); if (f) f.open = true; cm.scrollIntoView({ block: 'center' }); } else if (d) { const box = el.querySelector('.mpmsgs'); const last = box && box.lastElementChild; if (last) last.scrollIntoView({ block: 'start' }); }
  const grip = el.querySelector('.dpgrip');
  grip.onmousedown = (e) => { e.preventDefault(); const mv = (ev) => { const nw = Math.max(380, Math.min(window.innerWidth - 420, window.innerWidth - ev.clientX)); MS.w = nw; el.style.width = nw + 'px'; document.body.style.paddingRight = nw + 'px'; }; const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); };
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-mp="close"]')) closeMail(); });

// ---- source tags pointing at an email
const isMailSrc = (s) => !!s && /^e-?mail$/i.test(String(s.doc || '').trim());
async function openMailSnippet(snippet) {
  const r = await mailApi('GET', `find?pid=${encodeURIComponent(S.curId)}&q=${encodeURIComponent(snippet)}`).catch(() => ({}));
  if (r && r.thrid) return openThread(r.thrid, snippet);
  toast('No email in this project’s label contains that text' + (MS.settings && MS.settings.hasPassword ? '' : ' (Gmail is not connected)'));
}

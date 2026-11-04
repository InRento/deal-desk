// ================= Decision log: pre-mortem at the decision, post-mortem at the end =================
// p.judgement (deal-level, survives version switches, column judgement_json):
//   decision 'Proceed' | 'Reject', why, preMortem ("it went wrong – what happened?"), watch (early warning signs), confidence (% repaid in full and on time)
//   recordedOn + snapshot (the numbers when the decision was made – they do not move when the model is edited later), editedAfter (dates the pre-mortem was reopened)
//   outcome, outcomeOn, happened, sawIt (did the pre-mortem name it), lesson
// Home → Decisions lists every recorded decision with the outcome, so judgement can be checked against what actually happened.
const JD_OUT = { Proceed: ['Repaid as planned', 'Repaid late', 'Extended / restructured', 'Enforcement – fully recovered', 'Loss'], Reject: ['Not funded', 'Funded elsewhere – performed', 'Funded elsewhere – went wrong', 'Unknown'] };
const JD_SAW = ['Yes – the main risk was named', 'Partly', 'No – something I did not consider'];
const jdToday = () => new Date().toISOString().slice(0, 10);
const jdDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const jdOf = (p) => (p.judgement && typeof p.judgement === 'object' ? p.judgement : (p.judgement = {}));
const jdGood = (o) => /^(Repaid as planned|Not funded|Funded elsewhere – went wrong)$/.test(o || ''); // the decision turned out right
function jdSnapshot(p) {
  const m = S.modelOrig || S.model, s = m.summary; let ii = null, st = null;
  try { ii = investorIrr(m); } catch (e) { /* no cash flows */ }
  try { const G = deckGrid(); if (G) st = stressHeadline(G).head; } catch (e) { /* no grid */ }
  return { cur: CUR, stage: p.status, facility: s.facility, ltv: s.ltv0, ltvFirst: m.r.tranchesOn && s.mkt0 > 0 ? m.r.tranches[0].amount / s.mkt0 : null, investorIrr: ii, inrentoIrr: s.irr,
    lowCash: s.lowCashPre, repaid: s.repaidDate ? E.fmtDate(s.repaidDate) : null, maturity: E.fmtDate(s.maturity), stress: st, flags: issueCounts().error || 0,
    version: (vActiveId() && (vById(vActiveId()) || {}).label) || '' };
}
function jdSnapLine(n) {
  const c = n.cur || 'EUR', mo = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '–');
  return [`loan ${money(n.facility, c)}`, n.ltv != null ? `LTV ${pctf(n.ltv)}${n.ltvFirst != null ? ` (first tranche ${pctf(n.ltvFirst)})` : ''}` : '', n.investorIrr != null ? `investor IRR ${pctf(n.investorIrr, 1)}` : '',
    n.repaid ? `repaid ${mo(n.repaid)}, maturity ${mo(n.maturity)}` : `not repaid by maturity ${mo(n.maturity)}`, n.flags ? `${n.flags} likely mistake${n.flags > 1 ? 's' : ''} open` : ''].filter(Boolean).join(' · ');
}
function judgementCard(p) {
  const j = jdOf(p), locked = !!j.recordedOn && !j.unlocked, rej = j.decision === 'Reject';
  const ta = (k, label, ph, rows = 3) => locked
    ? `<div class="jdf"><span class="lbl">${label}</span><div class="jdtxt">${j[k] ? esc(j[k]) : '<span class="sub">–</span>'}</div></div>`
    : `<label class="jdf"><span class="lbl">${label}</span><textarea class="in" id="jd-${k}" data-k="judgement.${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(j[k] || '')}</textarea></label>`;
  const opt = (k, list, label) => `<label class="jdf"><span class="lbl">${label}</span><select class="in" id="jd-${k}" data-k="judgement.${k}"><option value=""></option>${list.map((o) => `<option ${o === j[k] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  const pre = `<div class="jdhead"><h3 style="margin:0">Pre-mortem</h3><span class="sub">${j.recordedOn ? `Decision recorded ${jdDate(j.recordedOn)}${(j.editedAfter || []).length ? ` · reopened ${j.editedAfter.map(jdDate).join(', ')}` : ''}` : 'Recording keeps today\'s numbers'}</span></div>
    <div class="jdrow">
      ${locked ? `<div class="jdf"><span class="lbl">Decision</span><div class="jdtxt"><span class="pill ${rej ? 'bad' : 'ok'}">${esc(j.decision || '–')}</span></div></div>` : opt('decision', ['Proceed', 'Reject'], 'Decision')}
      ${locked ? `<div class="jdf"><span class="lbl">Confidence it is repaid in full and on time</span><div class="jdtxt">${j.confidence !== '' && j.confidence != null ? esc(j.confidence) + '%' : '<span class="sub">–</span>'}</div></div>`
        : `<label class="jdf"><span class="lbl">Confidence it is repaid in full and on time</span><span class="row" style="gap:6px;flex-wrap:nowrap"><input class="in" id="jd-confidence" data-k="judgement.confidence" inputmode="numeric" style="width:90px" value="${esc(j.confidence ?? '')}" placeholder="e.g. 80"><span class="sub">%</span></span></label>`}
    </div>
    ${ta('why', rej ? 'Why I reject it' : 'Why I proceed', rej ? 'e.g. LTV too high for a sponsor without a track record; sales plan needs 30% above the comparables' : 'e.g. Sales already 40% pre-sold, LTV under 60% at every tranche, sponsor delivered two similar projects')}
    ${ta('preMortem', rej ? 'If rejecting turns out to be a mistake, what will the reason be?' : 'It is two years later and this loan went wrong. What most likely happened?', rej ? 'e.g. The sponsor sells out within six months at plan prices and another lender earns the fee' : 'e.g. Fit-out runs 6 months late, sales slip past maturity, the borrower has no cash to cover the interest')}
    ${rej ? '' : ta('watch', 'Early warning signs to watch', 'e.g. Fewer than 6 preliminary contracts by March 2027; contractor invoices not paid on time', 2)}
    ${j.snapshot ? `<div class="jdsnap"><span class="lbl">${j.snapshotOn ? `Numbers recorded ${jdDate(j.snapshotOn)}` : 'Numbers at the decision'}${j.snapshot.version ? ` (${esc(j.snapshot.version)})` : ''}</span><div>${esc(jdSnapLine(j.snapshot))}</div>${j.snapshot.stress ? `<div class="sub">Stress test: ${esc(j.snapshot.stress)}</div>` : ''}</div>` : ''}
    <div class="row" style="gap:8px;margin-top:10px">${locked ? '<button class="btn sm" data-act="jd-reopen">Reopen pre-mortem</button>' : `<button class="btn sm primary" data-act="jd-record">${j.recordedOn ? 'Record again (new numbers)' : 'Record decision'}</button>${j.recordedOn ? '<button class="btn sm ghost" data-act="jd-relock">Keep the recorded numbers</button>' : ''}`}</div>`;
  const post = !j.recordedOn ? '' : `<div class="jdpost"><div class="jdhead"><h3 style="margin:0">Post-mortem</h3><span class="sub">${rej ? 'What happened to the deal after you said no' : 'Fill in when the loan is repaid, extended or goes wrong'}</span></div>
    <div class="jdrow">${opt('outcome', JD_OUT[j.decision] || JD_OUT.Proceed, 'Outcome')}<label class="jdf"><span class="lbl">Date</span><input class="in" type="date" id="jd-outcomeOn" data-k="judgement.outcomeOn" value="${esc(j.outcomeOn || '')}" style="width:170px"></label>${opt('sawIt', JD_SAW, 'Did the pre-mortem see it coming?')}</div>
    <label class="jdf"><span class="lbl">${rej ? 'What happened' : 'What happened compared with the plan'}</span><textarea class="in" id="jd-happened" data-k="judgement.happened" rows="3" placeholder="${rej ? 'e.g. Funded by a bank in 2027, sold out on schedule' : 'e.g. Repaid 4 months after the plan; 5 of 28 units sold below the price list'}">${esc(j.happened || '')}</textarea></label>
    <label class="jdf"><span class="lbl">What I missed / what I would do differently</span><textarea class="in" id="jd-lesson" data-k="judgement.lesson" rows="3" placeholder="e.g. Contractor capacity was not checked; ask for the contractor's other running projects">${esc(j.lesson || '')}</textarea></label></div>`;
  return `<div class="card jdcard" id="jdcard">${pre}${post}</div>`;
}
function jdAction(a) {
  const p = cur(), j = jdOf(p);
  if (a === 'jd-record') {
    if (!j.decision) return toast('Choose Proceed or Reject first');
    if (!String(j.why || '').trim() || !String(j.preMortem || '').trim()) return toast('Write why, and the pre-mortem, before recording the decision');
    j.snapshot = jdSnapshot(p); j.recordedOn = j.recordedOn || jdToday(); j.unlocked = false;
    if (j.reopened) { j.snapshotOn = jdToday(); delete j.reopened; }
    toast(`Decision recorded with today's numbers`);
  } else if (a === 'jd-reopen') { j.unlocked = true; j.reopened = true; j.editedAfter = [...new Set([...(j.editedAfter || []), jdToday()])]; }
  else if (a === 'jd-relock') { j.unlocked = false; delete j.reopened; }
  else return false;
  scheduleSave(S.curId); renderTab(); return true;
}
// ---- Home → Decisions
function decisionsView() {
  const rows = Object.values(S.projects).filter((p) => p.judgement && p.judgement.recordedOn).sort((a, b) => String(b.judgement.recordedOn).localeCompare(String(a.judgement.recordedOn)));
  if (!rows.length) return '<div class="card empty"><h2>No decisions recorded yet</h2><div>On a deal\'s Overview tab, write why you proceed (or reject) and the pre-mortem, then click Record decision.</div></div>';
  const pro = rows.filter((p) => p.judgement.decision === 'Proceed'), rej = rows.filter((p) => p.judgement.decision === 'Reject');
  const done = pro.filter((p) => p.judgement.outcome), ok = done.filter((p) => jdGood(p.judgement.outcome));
  const conf = done.filter((p) => +p.judgement.confidence > 0), avg = conf.length ? conf.reduce((t, p) => t + +p.judgement.confidence, 0) / conf.length : null;
  const saw = rows.filter((p) => p.judgement.sawIt && p.judgement.outcome && !jdGood(p.judgement.outcome));
  const tile = (l, v, sub) => `<div class="tile"><div class="l">${l}</div><div class="v">${v}</div><div class="sub">${sub}</div></div>`;
  const tiles = `<div class="tiles">${tile('Decisions', rows.length, `${pro.length} proceed · ${rej.length} reject`)}
    ${tile('Outcome known', `${done.length} of ${pro.length}`, 'loans you proceeded with')}
    ${tile('Repaid as planned', done.length ? pctf(ok.length / done.length, 0) : '–', avg != null ? `your average confidence was ${Math.round(avg)}%` : 'add confidence when you decide')}
    ${tile('Pre-mortem saw it', saw.length ? `${saw.filter((p) => /^Yes/.test(p.judgement.sawIt)).length} of ${saw.length}` : '–', 'deals that went wrong')}</div>`;
  const first = (t) => { const x = String(t || '').trim().split(/\n|(?<=\.)\s/)[0]; return x.length > 110 ? x.slice(0, 108) + '…' : x; };
  const tr = (p) => { const j = p.judgement, o = j.outcome;
    return `<tr data-open="${p.id}" tabindex="0"><td><b>${esc(p.name)}</b><div class="sub">${esc(p.status)}</div></td>
      <td><span class="pill ${j.decision === 'Reject' ? 'bad' : 'ok'}">${esc(j.decision)}</span><div class="sub">${jdDate(j.recordedOn)}</div></td>
      <td class="n">${j.confidence !== '' && j.confidence != null ? esc(j.confidence) + '%' : '–'}</td>
      <td class="jdcell">${esc(first(j.why))}</td><td class="jdcell">${esc(first(j.preMortem))}</td>
      <td>${o ? `<span class="pill ${jdGood(o) ? 'ok' : /late|Extended|recovered|Unknown|performed/.test(o) ? 'warnp' : 'bad'}">${esc(o)}</span>${j.outcomeOn ? `<div class="sub">${jdDate(j.outcomeOn)}</div>` : ''}` : '<span class="sub">open</span>'}</td>
      <td class="sub">${esc(j.sawIt ? j.sawIt.split(' – ')[0] : '')}</td></tr>`; };
  return `${tiles}<div class="tblwrap"><table class="reg pipe jdtbl"><thead><tr><th>Project</th><th>Decision</th><th class="n">Confidence</th><th>Why</th><th>Pre-mortem: what goes wrong</th><th>Outcome</th><th>Saw it</th></tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`;
}

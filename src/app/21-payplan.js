// ================= Payment plan: buyers pay in instalments (v3.16) =================
// Deal plan inputs.payPlan = [{pct, months}] – % of the price paid that many months after the contract; the rest at the deed (= planned sale date).
// A unit's own plan (assets.i.payPlan) overrides it: "10@0, 20@6" or "deed". inputs.escrowOn: payments before the deed are held until the deed.
// The engine (paysOf in run) turns this into a.pays = [{date, share, deed, pre, repaid}]; every instalment goes through the sale sweep in its month.
const planUsed = (p) => (p.inputs.payPlan || []).some((x) => E.num(x && x.pct) > 0) || p.assets.some((a) => !E.blank(a.payPlan) || !E.blank(a.contractDate));
function payPlanCard() {
  const p = cur(), i = p.inputs, rows = i.payPlan || [], rest = 100 - rows.reduce((s, x) => s + E.num(x.pct), 0);
  const on = rows.length > 0;
  return `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Payment plan</h3><button class="btn sm" data-act="add-pay">${on ? 'Add instalment' : 'Buyers pay in instalments'}</button></div>
    ${on ? `<div class="sub" style="margin-bottom:8px">When buyers pay, counted from each unit's contract date (Collateral &amp; sales). Each instalment goes through the sale sweep in its month; the rest is paid at the deed (planned sale date). A unit's own plan overrides this one.</div>
    <div class="tblwrap"><table class="grid-in" style="max-width:520px"><thead><tr><th class="n">% of the price</th><th class="n">Months after the contract</th><th></th></tr></thead><tbody>
    ${rows.map((x, k) => `<tr><td>${inp(`inputs.payPlan.${k}.pct`, x.pct, 'pct')}</td><td>${inp(`inputs.payPlan.${k}.months`, x.months, 'num')}</td><td><button class="xbtn" data-act="del-pay" data-i="${k}" aria-label="Remove instalment">×</button></td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="3" data-out="pp-rest">${rest >= 0 ? `Rest at the deed: ${+rest.toFixed(2)}%` : ''}</td></tr></tfoot></table></div>
    <label class="row" style="gap:6px;margin-top:10px">${chk('inputs.escrowOn', i.escrowOn === true, 'Payments held in escrow')}<span>Payments before the deed are held in escrow until the deed</span></label>`
    : `<div class="sub">Buyers pay the full price at the deed (planned sale date). Add instalments if they pay part at the contract and later.</div>`}</div>`;
}
const payMon = (d) => new Date(d * 864e5).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
function payCalcs(out) {
  const m = S.model, p = cur(); if (!m) return out;
  m.r.assets.forEach((a, i) => { out[`a-${i}-pays`] = (a.pays || []).length > 1 ? a.pays.map((q) => `${+(q.share * 100).toFixed(1)}% ${payMon(q.date)}${q.pre ? ' (paid)' : ''}`).join(' · ') : ''; });
  const rows = p.inputs.payPlan || [], rest = 100 - rows.reduce((s, x) => s + E.num(x.pct), 0);
  out['pp-rest'] = rest >= -1e-9 ? `Rest at the deed: ${+rest.toFixed(2)}%` : `<span class="bad-t">The instalments add up to ${+(100 - rest).toFixed(2)}% – more than the price</span>`;
  return out;
}
function lintPayPlan(p, m, add) {
  const rows = p.inputs.payPlan || [], tot = rows.reduce((s, x) => s + E.num(x.pct), 0);
  if (tot > 100 + 1e-9) add({ id: 'payplan-over', sev: 'error', title: `Payment plan adds up to ${+tot.toFixed(2)}%`, why: 'Instalments beyond 100% of the price are ignored; nothing is left for the deed.', tab: 'inputs', keys: rows.map((x, k) => `inputs.payPlan.${k}.pct`) });
  p.assets.forEach((a, j) => { const t = String(a.payPlan || '').trim(); if (!t) return;
    const ok = /^(deed|0%?)$/i.test(t) || t.split(/[,;]+/).every((tok) => /^\s*[\d.]+\s*%?\s*(@\s*\+?\s*\d+\s*(m|mo|months?)?)?\s*$/i.test(tok));
    if (!ok) add({ id: 'payplan-text:' + j, sev: 'error', title: `${a.name || 'Row ' + (j + 1)}: own payment plan not understood`, why: 'Write it as % @ months after the contract, e.g. "10@0, 20@6" (the rest at the deed), or "deed" for everything at the deed.', tab: 'assets', keys: [`assets.${j}.payPlan`] }); });
  if (!rows.some((x) => E.num(x.pct) > 0) && !p.assets.some((a) => !E.blank(a.payPlan))) return;
  const noDate = p.assets.map((a, j) => ({ a, j })).filter(({ a }) => !E.blank(a.salePrice) && E.blank(a.contractDate) && !/^\s*deed\s*$/i.test(a.payPlan || ''));
  if (noDate.length) add({ id: 'payplan-nocontract', sev: 'info', title: `${noDate.length} unit${noDate.length > 1 ? 's have' : ' has'} no contract date – paid in full at the deed`, why: 'The payment plan counts from the contract date on Collateral & sales.', tab: 'assets', keys: noDate.map(({ j }) => `assets.${j}.contractDate`) });
  const dbl = m.r.assets.map((a, j) => ({ a, j })).filter(({ a }) => a.depositPre && (a.pays || []).some((q) => q.pre));
  if (dbl.length) add({ id: 'payplan-deposit', sev: 'warn', title: `${dbl.length} unit${dbl.length > 1 ? 's' : ''}: deposit counted twice?`, why: 'Instalments before the drawdown are already treated as paid, and "Deposit held: already paid to borrower" is deducted again at the deed. Use one or the other.', tab: 'assets', keys: dbl.map(({ j }) => `assets.${j}.deposit`) });
}

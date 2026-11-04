// Operating model tab: revenue and cost lines for operating businesses.
// ---- Operating model
const RKIND = [['nightly', 'Units × nights × price × occupancy'], ['monthly', 'Units × monthly rent × occupancy'], ['fixed', 'Fixed amount per month']];
const CKIND = [['fixed', 'Fixed per month'], ['pctRev', '% of net revenue'], ['perNight', 'Per occupied night'], ['perUnit', 'Per unit per month']];
function tabOps() {
  const p = cur(), i = p.inputs;
  const detailed = i.opModel === 'detailed';
  const head = `<div class="card"><div class="row" style="justify-content:space-between;gap:12px"><div><h2>Operating model</h2><div class="sub">Build revenue from units, prices and occupancy (hotels, resorts, rentals) and costs by driver. Monthly profiles repeat every year; growth steps up every 12 months from drawdown.</div></div>
    <label class="row" for="${idOf('inputs.opModel')}"><span class="sub">Model</span>${sel('inputs.opModel', i.opModel, [['simple', 'Simple (Inputs tab)'], ['detailed', 'Detailed (this tab)']], 'style="width:auto"')}</label></div>
    ${detailed ? '' : '<div class="banner" style="margin:12px 0 0">This project uses the simple model. Switch to Detailed to use the lines below.</div>'}</div>`;
  const ded = `<div class="card"><h3>Revenue deductions</h3><div class="form">${[F('vat', 'VAT included in prices', 'pct', 'Net revenue = gross / (1 + VAT)'), F('commission', 'Channel commission (% of gross)', 'pct', 'e.g. 50% via Booking.com × 15% = 7.5%'), F('cardFee', 'Card / payment fees (% of gross)', 'pct'), F('ancillary', 'Ancillary revenue (% of net room revenue)', 'pct', 'Food, spa, conferences')].map((f) => fieldHTML(f, i, 'inputs.')).join('')}</div></div>`;
  const rev = `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Revenue lines</h3><span class="row" style="gap:6px"><button class="btn sm" data-act="paste-table" data-t="revLines" title="Paste rows copied from Excel">Paste from Excel</button><button class="btn sm" data-act="add-rev">Add revenue line</button></span></div>
    <div class="tblwrap"><table class="grid-in"><thead><tr><th>Name</th><th>Type</th><th class="n">Units</th><th class="n">Price</th><th class="n">Occupancy %</th><th>Start</th><th>End</th><th class="n">Growth % p.a.</th><th>Monthly profile</th><th class="n">Year 1 gross</th><th></th></tr></thead><tbody>
    ${p.revLines.map((l, k) => `<tr><td class="w-name">${inp(`revLines.${k}.name`, l.name, 'text')}</td><td>${sel(`revLines.${k}.kind`, l.kind, RKIND)}</td><td class="w-s">${inp(`revLines.${k}.units`, l.units)}</td><td>${inp(`revLines.${k}.price`, l.price, 'money')}</td><td class="w-s">${inp(`revLines.${k}.occ`, l.occ, 'pct', 'placeholder="100"')}</td><td>${dateIn(`revLines.${k}.start`, l.start)}</td><td>${dateIn(`revLines.${k}.end`, l.end)}</td><td class="w-s">${inp(`revLines.${k}.growth`, l.growth, 'pct')}</td>
      <td><button class="btn sm" data-act="toggle-line" data-i="r${k}" aria-expanded="${S.openLine === 'r' + k}">${S.openLine === 'r' + k ? 'Hide' : 'Edit'} profile${(l.occM || []).some((v) => v !== '' && v != null) || (l.priceM || []).some((v) => v !== '' && v != null) ? ' ●' : ''}</button></td><td class="calcc" data-out="rl-${k}"></td><td><button class="xbtn" data-act="del-rev" data-i="${k}" aria-label="Remove line">×</button></td></tr>
      ${S.openLine === 'r' + k ? `<tr class="prof"><td colspan="11"><div class="sub" style="margin-bottom:6px">Leave a month blank to use the line's price and occupancy. Occupancy 0 = closed that month.</div><div class="tblwrap"><table><thead><tr><th></th>${MON.map((m) => `<th class="n">${m}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Occupancy %</td>${MON.map((m, j) => `<td>${inp(`revLines.${k}.occM.${j}`, (l.occM || [])[j] ?? '', 'pct', 'style="min-width:58px"')}</td>`).join('')}</tr>
        <tr><td>Price</td>${MON.map((m, j) => `<td>${inp(`revLines.${k}.priceM.${j}`, (l.priceM || [])[j] ?? '', 'money', 'style="min-width:64px"')}</td>`).join('')}</tr></tbody></table></div></td></tr>` : ''}`).join('') || '<tr><td colspan="11" class="sub">No revenue lines. Example: “Standard villa”, units × nights × price × occupancy, 20 units, 450 per night.</td></tr>'}
    </tbody></table></div></div>`;
  const cost = `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Cost lines</h3><span class="row" style="gap:6px"><button class="btn sm" data-act="paste-table" data-t="costLines" title="Paste rows copied from Excel">Paste from Excel</button><button class="btn sm" data-act="add-cost">Add cost line</button></span></div>
    <div class="tblwrap"><table class="grid-in"><thead><tr><th>Name</th><th>Driver</th><th class="n">Amount</th><th class="n">Growth % p.a.</th><th>Months</th><th>Start</th><th>End</th><th>Monthly amounts</th><th class="n">Year 1</th><th></th></tr></thead><tbody>
    ${p.costLines.map((l, k) => `<tr><td class="w-name">${inp(`costLines.${k}.name`, l.name, 'text')}</td><td>${sel(`costLines.${k}.kind`, l.kind, CKIND)}</td><td>${inp(`costLines.${k}.amount`, l.amount, l.kind === 'pctRev' ? 'pct' : 'money')}</td><td class="w-s">${inp(`costLines.${k}.growth`, l.growth, 'pct')}</td><td class="w-s">${inp(`costLines.${k}.months`, l.months, 'text', 'placeholder="all" title="e.g. 12, 5-10 or 11,12,1-3"')}</td><td>${dateIn(`costLines.${k}.start`, l.start)}</td><td>${dateIn(`costLines.${k}.end`, l.end)}</td>
      <td><button class="btn sm" data-act="toggle-line" data-i="c${k}" aria-expanded="${S.openLine === 'c' + k}">${S.openLine === 'c' + k ? 'Hide' : 'Edit'}${(l.amountM || []).some((v) => v !== '' && v != null) ? ' ●' : ''}</button></td><td class="calcc" data-out="cl-${k}"></td><td><button class="xbtn" data-act="del-cost" data-i="${k}" aria-label="Remove line">×</button></td></tr>
      ${S.openLine === 'c' + k ? `<tr class="prof"><td colspan="10"><div class="sub" style="margin-bottom:6px">Amount by calendar month; blank = the line amount.</div><div class="tblwrap"><table><thead><tr>${MON.map((m) => `<th class="n">${m}</th>`).join('')}</tr></thead><tbody><tr>${MON.map((m, j) => `<td>${inp(`costLines.${k}.amountM.${j}`, (l.amountM || [])[j] ?? '', 'money', 'style="min-width:70px"')}</td>`).join('')}</tr></tbody></table></div></td></tr>` : ''}`).join('') || '<tr><td colspan="10" class="sub">No cost lines. Examples: salaries (fixed), cleaning (per occupied night), maintenance (per unit), management fee (% of revenue).</td></tr>'}
    </tbody></table></div></div>`;
  return `<div class="stack">${head}${ded}${rev}${cost}<div class="card"><h3>First 24 months</h3><div class="tblwrap" data-out="opsprev"></div></div></div>`;
}
function opsLineCalcs() {
  const out = {}; const p = cur(); const R = S.model.r;
  if (R.opModel !== 'detailed') { p.revLines.forEach((l, k) => (out[`rl-${k}`] = '')); p.costLines.forEach((l, k) => (out[`cl-${k}`] = '')); return out; }
  // year-1 contribution per line: rerun op month with only that line
  const rows = S.model.rows.slice(1, 13);
  p.revLines.forEach((l, k) => { const solo = { ...R, revLines: [R.revLines[k]], costLines: [], commission: 0, cardFee: 0 }; let g = 0; rows.forEach((x) => { g += opMonthFor(solo, x).gross; }); out[`rl-${k}`] = plain(g); });
  p.costLines.forEach((l, k) => { const solo = { ...R, costLines: [R.costLines[k]], commission: 0, cardFee: 0 }; let c = 0; rows.forEach((x) => { c += opMonthFor(solo, x).opex; }); out[`cl-${k}`] = plain(c); });
  return out;
}
const opMonthFor = (R, x) => E.opMonth(R, x.p, x.date, 1, 1, 0);
OUT.opsprev = () => {
  const rows = S.model.rows.slice(1, 25);
  const line = (l, f, c = '') => `<tr><td>${l}</td>${rows.map((x) => `<td class="n ${c}">${f(x)}</td>`).join('')}</tr>`;
  return `<table><thead><tr><th></th>${rows.map((x) => `<th class="n">${datef(x.date).replace(/^(\w{3}) (\d{2})(\d{2})$/, "$1 '$3")}</th>`).join('')}</tr></thead><tbody>
    ${S.model.r.opModel === 'detailed' ? line('Gross revenue', (x) => plain(x.gross)) + line('Occupied nights', (x) => plain(x.nights)) : ''}
    ${line('Net revenue', (x) => plain(x.revenue))}${line('Operating costs', (x) => plain(-x.opex))}${line('Adjustments', (x) => plain(x.extraInc - x.extraExp))}${line('EBITDA', (x) => `<b>${plain(x.ebitda)}</b>`)}</tbody></table>`;
};

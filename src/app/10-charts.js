// ---------- charts ----------
function lineChart(el, { x, series, fmt = money, zero = true, height = 260, bars = false }) {
  if (!el) return;
  const W = Math.max(300, el.clientWidth || 600), H = height, ml = 64, mr = 12, mt = 10, mb = 26;
  const all = series.flatMap((s) => s.values).filter((v) => v != null && isFinite(v));
  if (!all.length) { el.innerHTML = '<div class="sub">Nothing to chart yet.</div>'; return; }
  let lo = Math.min(...all, zero ? 0 : Infinity), hi = Math.max(...all, zero ? 0 : -Infinity);
  if (lo === hi) { hi += 1; lo -= 1; }
  const step = niceStep((hi - lo) / 5); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const n = x.length, pw = W - ml - mr, ph = H - mt - mb;
  const sx = (i) => ml + (n === 1 ? pw / 2 : (i * pw) / (n - 1)), sy = (v) => mt + ph - ((v - lo) / (hi - lo)) * ph;
  let g = '';
  for (let v = lo; v <= hi + step / 2; v += step) g += `<line class="${Math.abs(v) < step / 1e6 ? 'zero' : 'grid'}" x1="${ml}" x2="${W - mr}" y1="${sy(v)}" y2="${sy(v)}"/><text class="ax" x="${ml - 6}" y="${sy(v) + 3.5}" text-anchor="end">${compact(v)}</text>`;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 70))));
  for (let i = 0; i < n; i += every) g += `<text class="ax" x="${sx(i)}" y="${H - 8}" text-anchor="middle">${esc(x[i].label)}</text>`;
  let marks = '';
  if (bars) {
    const bw = Math.max(1, (pw / n) * 0.7); const s = series[0];
    s.values.forEach((v, i) => { if (v == null) return; const y0 = sy(0), y1 = sy(v); marks += `<rect x="${sx(i) - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(0.5, Math.abs(y1 - y0))}" rx="${Math.min(2, bw / 3)}" fill="${v < 0 ? 'var(--bad)' : s.color}"/>`; });
  } else {
    for (const s of series) {
      let d = '', pen = false;
      s.values.forEach((v, i) => { if (v == null || !isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(v).toFixed(1); pen = true; });
      marks += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
    }
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join(', '))}">${g}${marks}<line class="xh" x1="0" x2="0" y1="${mt}" y2="${mt + ph}" visibility="hidden"/><g class="dots"></g><rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="transparent"/></svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = svg.querySelector('.xh'), dots = svg.querySelector('.dots');
  svg.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect(); const px = ((ev.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - ml) / pw) * (n - 1))));
    xh.setAttribute('x1', sx(i)); xh.setAttribute('x2', sx(i)); xh.setAttribute('visibility', 'visible');
    dots.innerHTML = bars ? '' : series.map((s) => (s.values[i] == null ? '' : `<circle cx="${sx(i)}" cy="${sy(s.values[i])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`)).join('');
    tip.innerHTML = `<div class="d">${esc(x[i].tip || x[i].label)}</div>${series.map((s) => `<div class="r"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><span>${s.values[i] == null ? '–' : fmt(s.values[i])}</span></div>`).join('')}`;
    tip.hidden = false;
    const left = (sx(i) / W) * rect.width; tip.style.left = Math.min(rect.width - tip.offsetWidth - 4, Math.max(0, left + 12)) + 'px'; tip.style.top = '8px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; });
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function compact(v) { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(a % 1e6 ? 1 : 0) + 'm' : a >= 1e3 ? (a / 1e3).toFixed(a % 1e3 ? 1 : 0) + 'k' : String(Math.round(a * 100) / 100); return (v < 0 ? '−' : '') + s; }
const SCOL = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
function drawCharts() {
  const m = S.model; if (!m) return;
  const xs = m.rows.map((r) => ({ label: r.p === 0 ? 'Draw' : datef(r.date).replace(/^(\w{3}) (\d{2})(\d{2})$/, "$1 '$3"), tip: r.p === 0 ? 'Drawdown ' + dayf(r.date) : `Month ${r.p} · ${datef(r.date)}` }));
  const main = $('#ch-main');
  if (main) {
    const ser = [{ name: 'Borrower cash balance', color: 'var(--s1)', values: m.rows.map((r) => r.cash) }, { name: 'InRento loan balance', color: 'var(--s2)', values: m.rows.map((r) => r.close) }, { name: 'Collateral value (market)', color: 'var(--s3)', values: m.rows.map((r) => r.collMkt), dash: 1, w: 1.5 }];
    $('#lg-main').innerHTML = ser.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.name}</span>`).join('');
    lineChart(main, { x: xs, series: ser });
  }
  const ncf = $('#ch-ncf');
  if (ncf) lineChart(ncf, { x: xs, series: [{ name: 'Net cash flow', color: 'var(--s1)', values: m.rows.map((r) => r.ncf) }], bars: true, height: 220 });
  const se = $('#ch-sens');
  if (se) {
    const { scen } = sensModel();
    const n = Math.max(...scen.map((s) => s.res.rows.length));
    const sx = Array.from({ length: n }, (_, i) => xs[i] || { label: String(i), tip: 'Month ' + i });
    const ser = scen.slice(0, 8).map((s, k) => ({ name: s.name, color: SCOL[k], values: s.res.rows.map((r) => r.cash), w: k === 0 ? 2.5 : 1.75 }));
    $('#lg-sens').innerHTML = ser.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') + (scen.length > 8 ? '<span class="sub">First 8 scenarios charted</span>' : '');
    lineChart(se, { x: sx, series: ser, height: 300 });
  }
}

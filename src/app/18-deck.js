// ================= Committee deck: preview, then PowerPoint or PDF =================
// Two slides for the credit committee: 1 the deal (description, loan amount, LTV, price per m²) · 2 stress test (two-way table from Sensitivity).
// Look taken from InRento's investment decks: Inter, navy 141529, green 2DA372 / E6F4EF, light grey background, white cards.
// Built in the browser with PptxGenJS (inlined), fully editable in PowerPoint.

// ---- data for the deck
function investorIrr(m) {
  const r = m.r, s = m.summary;
  const cf = m.rows.map((x, i) => x.lenderCF - (i === 0 ? (r.feeCap ? 0 : s.fee0) : (x.drawFee || 0)) - (x.prepay || 0) - (x.exit || 0) - (x.commit || 0) - (x.extFee || 0) - (x.pshare || 0) * (r.acctFee || 0));
  const im = E.irrMonthly(cf); return im == null ? null : Math.pow(1 + im, 12) - 1;
}
// the Sensitivity two-way grid in deck form (also used for the decision snapshot)
function deckGrid() {
  let grid = null; try { const g = marginCalc().grid; if (g) grid = { rl: g.rl, cl: g.cl, rv: g.rv, cv: g.cv, rf: g.rf, cf: g.cf, rAbs: g.rAbs || null,
    cells: g.cells.map((row) => row.map((o) => ({ tone: o.tone, txt: o.tone === 'good' ? 'Repaid' : o.tone === 'warn' ? `Needs ${mgK(-o.low)}` : `${mgK(o.short)} short` }))) }; } catch (e) { console.error(e); }
  return grid;
}
// the stress test in one sentence: how far each driver can go on its own with the loan still repaid without extra cash (full 5% grid)
function stressHeadline(G) {
  const sales = G.rl === 'Sale prices', opex = G.cl === 'Operating costs';
  const pc = (v) => `${Math.round(v * 100)}%`, mo = (n) => `${n} month${n === 1 ? '' : 's'}`;
  const colV = (v) => (opex ? pc(v) : mo(v));
  const rowWhat = sales ? 'sale prices fall' : 'revenue falls', colWhat = sales ? 'sales are' : opex ? 'operating costs rise' : 'revenue starts', colTail = sales || !opex ? ' late' : '';
  // headline from the full Sensitivity grid (5% steps): how far each driver can go on its own with the loan still repaid without extra cash
  const plan = G.cells[0][0], far = (n, ok) => { let k = 0; while (k + 1 < n && ok(k + 1)) k++; return k; };
  const ri = far(G.rv.length, (k) => G.cells[k][0].tone === 'good'), ci = far(G.cv.length, (k) => G.cells[0][k].tone === 'good');
  let head, tone;
  if (plan.tone === 'bad') { head = `Even on plan, ${plan.txt.replace(' short', '')} is still owed to InRento at maturity`; tone = 'bad'; }
  else if (plan.tone === 'warn') { head = `Even on plan, the borrower must add ${plan.txt.replace('Needs ', '')} for the loan to be repaid`; tone = 'warn'; }
  else { tone = 'good';
    const a = ri ? `Repaid if ${rowWhat} up to ${pc(G.rv[ri])}` : `Not repaid if ${rowWhat} ${pc(G.rv[1])}`;
    const b = ci ? `${ri ? 'or if' : 'repaid if'} ${colWhat} up to ${colV(G.cv[ci])}${colTail}` : `not repaid if ${colWhat} ${colV(G.cv[1])}${colTail}`;
    head = `${a}${ci && ri ? ' ' : '; '}${b}`; }
  return { head, tone };
}
function committeeData() {
  const p = mp(), R = E.resolve(p), m = E.run(p, null, { resolved: R }), s = m.summary, r = m.r, i = cur().inputs;
  const first = r.tranchesOn ? r.tranches[0].amount : s.facility, nT = r.tranchesOn ? r.tranches.length : 1;
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0), m2 = (v) => `${money(v)}/m²`;
  const withArea = R.assets.filter((a) => a.area > 0), area = sum(withArea, (a) => a.area);
  const apprM2 = withArea.some((a) => a.market > 0) ? sum(withArea.filter((a) => a.market > 0), (a) => a.market) / sum(withArea.filter((a) => a.market > 0), (a) => a.area) : null;
  const sales = withArea.filter((a) => a.salePrice != null);
  let price;
  if (sales.length) { const avg = sum(sales, (a) => a.salePrice) / sum(sales, (a) => a.area);
    price = ['Average sale price', m2(avg), [`${sales.length} unit${sales.length > 1 ? 's' : ''}, ${nf0.format(Math.round(sum(sales, (a) => a.area)))} m²${r.saleVat ? ', excl. VAT' : ''}`, apprM2 ? `appraisal ${m2(apprM2)}` : ''].filter(Boolean).join(' · ')]; }
  else if (area > 0 && m.rows.some((x) => x.revenue > 0)) { const rev12 = sum(m.rows.slice(1, 13), (x) => x.revenue || 0);
    price = ['Revenue per m² a month', `${money(rev12 / 12 / area)}/m²`, [`first 12 months, ${nf0.format(Math.round(area))} m²`, apprM2 ? `appraisal ${m2(apprM2)}` : ''].filter(Boolean).join(' · ')]; }
  else price = ['Price per m²', '–', 'enter unit areas on Collateral & sales'];
  const grid = deckGrid();
  const pp = (v) => `${+(v * 100).toFixed(2)}%`, rate = `${pp(r.rate)}${r.gain ? ` + ${pp(r.gain)}` : ''} p.a.`;
  return { name: cur().name, sub: cur().projectType || '', desc: String(i.deckDesc || '').trim(), maturity: mgMonth(s.maturity),
    facts: [
      ['Loan amount', money(s.facility), `${r.termBase} months · ${rate}${nT > 1 ? ` · ${nT} tranches` : ''}`],
      ['LTV', s.mkt0 > 0 ? pctf(s.ltv0) : '–', s.mkt0 > 0 ? `${nT > 1 ? `first tranche ${pctf(first / s.mkt0)} · ` : ''}collateral ${mgK(s.mkt0)}` : 'no collateral value entered'],
      price,
    ], grid };
}

// ---- one layout, two renderers: PptxGenJS (download) and absolutely positioned HTML (preview, PDF)
// Coordinates in inches on a 13.333 × 7.5 in slide; HTML uses 96 px per inch (1280 × 720) and 4/3 px per point.
// Text option `semi: true` = Inter SemiBold (a font of its own in PowerPoint, weight 600 in HTML).
const PX = 96, PT = 4 / 3, DK = { ink: '141529', ink2: '666666', line: 'CCCCCC', bg: 'F8F8F9', green: '2DA372', greenSoft: 'E6F4EF' };
function deckWriter(D) {
  const pres = new window.PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; pres.theme = { headFontFace: 'Inter SemiBold', bodyFontFace: 'Inter' };
  pres.title = `${D.name} – credit committee`; pres.company = 'InRento'; pres.author = 'Deal Desk';
  const html = [];
  const ppt = (o) => { const c = JSON.parse(JSON.stringify(o)); if (c.semi) c.fontFace = 'Inter SemiBold'; else if (!c.fontFace) c.fontFace = 'Inter'; delete c.semi; return c; };
  const css = (o) => `font-family:InterDeck,Inter,-apple-system,'Segoe UI',Arial,sans-serif;color:#${o.color || DK.ink};font-size:${(o.fontSize || 16) * PT}px;font-weight:${o.semi ? 600 : 400};`;
  const box = (o) => `position:absolute;left:${o.x * PX}px;top:${o.y * PX}px;width:${o.w * PX}px;height:${o.h * PX}px;`;
  const runsHtml = (text, o) => { // runs → paragraphs
    if (!Array.isArray(text)) return `<div>${esc(text)}</div>`;
    const paras = []; let cur = [];
    text.forEach((r) => { cur.push(r); if (r.options && r.options.breakLine) { paras.push(cur); cur = []; } }); if (cur.length) paras.push(cur);
    return paras.map((p) => `<div style="margin-bottom:${Math.max(...p.map((r) => (r.options && r.options.paraSpaceAfter) || 0)) * PT}px">${p.map((r) => `<span style="${css(Object.assign({}, o, r.options || {}))}">${esc(r.text)}</span>`).join('')}</div>`).join('');
  };
  const W = {
    slide(title) {
      const s = pres.addSlide(); s.background = { color: DK.bg };
      const items = []; html.push(items);
      const w = {
        text(text, o) { o = Object.assign({ isTextBox: true, margin: 0, fontSize: 16, color: DK.ink, valign: 'top' }, o); s.addText(JSON.parse(JSON.stringify(text)), ppt(o));
          items.push(`<div style="${box(o)}${css(o)}display:flex;flex-direction:column;justify-content:${o.valign === 'middle' ? 'center' : 'flex-start'};text-align:${o.align || 'left'};line-height:${o.lineSpacingMultiple || 1.2};overflow:hidden">${runsHtml(text, o)}</div>`); },
        shape(kind, o) { s.addShape({ rect: pres.shapes.RECTANGLE, round: pres.shapes.ROUNDED_RECTANGLE }[kind], JSON.parse(JSON.stringify(o)));
          const bd = o.line && o.line.type !== 'none' ? `border:${(o.line.width || 1) * PT}px solid #${o.line.color};box-sizing:border-box;` : '';
          items.push(`<div style="${box(o)}background:#${o.fill.color};${bd}border-radius:${kind === 'round' ? (o.rectRadius || 0.1) * PX + 'px' : '0'}"></div>`); },
        image(o) { s.addImage({ data: o.data, x: o.x, y: o.y, w: o.w, h: o.h, altText: o.alt || '' }); items.push(`<img alt="${esc(o.alt || '')}" style="${box(o)}" src="${o.data}">`); },
        table(rows, o) { s.addTable(JSON.parse(JSON.stringify(rows)).map((r) => r.map((c) => (c.options ? Object.assign(c, { options: ppt(c.options) }) : c))), ppt(o)); // PptxGenJS rewrites what it is given
          const rh = (i) => (Array.isArray(o.rowH) ? o.rowH[i] : o.rowH), mg = o.margin || [0, 0, 0, 0];
          const bd = (b) => (!b ? '' : ['top', 'right', 'bottom', 'left'].map((side, k) => (b[k] && b[k].type !== 'none' && b[k].pt ? `border-${side}:${b[k].pt * PT}px solid #${b[k].color};` : '')).join(''));
          items.push(`<table style="position:absolute;left:${o.x * PX}px;top:${o.y * PX}px;width:${o.w * PX}px;border-collapse:collapse;table-layout:fixed"><colgroup>${o.colW.map((x) => `<col style="width:${x * PX}px">`).join('')}</colgroup>${rows.map((r, i) => `<tr style="height:${rh(i) * PX}px">${r.map((c) => { const co = Object.assign({ fontSize: o.fontSize || 16, color: DK.ink }, c.options || {});
            return `<td${co.colspan ? ` colspan="${co.colspan}"` : ''} style="${css(co)}padding:${mg.map((v) => v * PX + 'px').join(' ')};text-align:${co.align || 'left'};vertical-align:${o.valign === 'middle' ? 'middle' : 'top'};${co.fill ? `background:#${co.fill.color};` : ''}${bd(co.border || o.border)}line-height:1.2">${runsHtml(c.text, co)}</td>`; }).join('')}</tr>`).join('')}</table>`); },
      };
      // every slide: title top left, InRento logo top right
      const M = 0.75, lh = 0.3, lw = lh * DECK_LOGO_RATIO;
      w.text(title, { x: M, y: 0.55, w: 13.333 - 2 * M - lw - 0.4, h: 0.75, fontSize: 36, semi: true, objectName: 'Title' });
      w.image({ data: DECK_LOGO, x: 13.333 - M - lw, y: 0.72, w: lw, h: lh, alt: 'InRento' });
      return w;
    },
    pres,
    htmlSlides: () => html.map((items) => `<div class="cdslide" style="position:relative;width:1280px;height:720px;background:#${DK.bg};overflow:hidden">${items.join('')}</div>`),
  };
  return W;
}
function composeCommittee(D) {
  const C = { good: '1E7A55', goodSoft: DK.greenSoft, warn: '9A5800', warnSoft: 'FBEED8', bad: 'B0281C', badSoft: 'FBE6E3' };
  const TONE = { good: [C.good, C.goodSoft], warn: [C.warn, C.warnSoft], bad: [C.bad, C.badSoft] };
  const W = deckWriter(D), M = 0.75, CW = 13.333 - 2 * M;
  // 1 the deal
  { const s = W.slide(D.name);
    if (D.sub) s.text(D.sub, { x: M, y: 1.3, w: CW, h: 0.4, fontSize: 18, color: DK.ink2 });
    s.text(D.desc || 'Add a short project description on the Overview tab (Committee deck box).', { x: M, y: 1.95, w: 10.2, h: 2.15, fontSize: 18, color: D.desc ? DK.ink : DK.ink2, lineSpacingMultiple: 1.35, fit: 'shrink', objectName: 'Description' });
    const gap = 0.3, cw = (CW - 2 * gap) / 3, y = 4.45, ch = 2.35;
    D.facts.forEach(([l, v, sub], k) => { const x = M + k * (cw + gap);
      s.shape('round', { x, y, w: cw, h: ch, fill: { color: 'FFFFFF' }, line: { color: DK.line, width: 0.75 }, rectRadius: 0.12, objectName: l + ' card' });
      s.text(l, { x: x + 0.3, y: y + 0.28, w: cw - 0.6, h: 0.35, fontSize: 16, color: DK.ink2 });
      s.text(v, { x: x + 0.3, y: y + 0.66, w: cw - 0.6, h: 0.55, fontSize: 28, semi: true, fit: 'shrink' });
      s.shape('round', { x: x + 0.15, y: y + 1.4, w: cw - 0.3, h: 0.8, fill: { color: DK.greenSoft }, line: { type: 'none' }, rectRadius: 0.08 });
      s.text(sub, { x: x + 0.3, y: y + 1.4, w: cw - 0.6, h: 0.8, fontSize: 16, valign: 'middle', fit: 'shrink' }); }); }
  // 2 stress test: the answer in one sentence, then a 4 × 4 table (every 10% of price/revenue, four delays) – nothing to decode
  { const G = D.grid, s = W.slide('Stress test');
    if (!G) s.text('Nothing to stress yet: enter sale prices and dates, or revenue, and the table appears here.', { x: M, y: 1.6, w: CW, h: 0.5, fontSize: 18, color: DK.ink2 });
    else {
      const sales = G.rl === 'Sale prices', opex = G.cl === 'Operating costs';
      const pc = (v) => `${Math.round(v * 100)}%`, mo = (n) => `${n} month${n === 1 ? '' : 's'}`;
      const colV = (v) => (opex ? pc(v) : mo(v));
      const { head, tone } = stressHeadline(G);
      const [htc] = TONE[tone];
      s.shape('rect', { x: M, y: 1.38, w: 0.08, h: 0.5, fill: { color: htc }, line: { type: 'none' } });
      s.text(head, { x: M + 0.28, y: 1.32, w: CW - 0.28, h: 0.62, fontSize: 22, semi: true, valign: 'middle', fit: 'shrink', objectName: 'Answer' });
      // 4 × 4: rows 0/−10/−20/−30%, columns the plan and three steps
      const pickR = [0, 0.1, 0.2, 0.3].map((v) => G.rv.findIndex((x) => Math.abs(x - v) < 1e-9)).filter((k) => k >= 0);
      const want = G.cv.length > 4 ? [0, 3, 6, 12] : G.cv; const pickC = want.map((v) => G.cv.indexOf(v)).filter((k) => k >= 0);
      const wb = { pt: 4, color: DK.bg }, nb = { type: 'none' };
      const hdr = (t, o) => ({ text: t, options: Object.assign({ color: DK.ink2, align: 'center', border: [nb, nb, nb, nb] }, o) });
      const rows = [
        [hdr(''), hdr(sales ? 'Sales delayed by' : opex ? 'Operating costs higher by' : 'Revenue starts later by', { colspan: pickC.length, semi: true, color: DK.ink })],
        [hdr(sales ? 'Sale prices' : 'Revenue', { align: 'left', semi: true, color: DK.ink }), ...pickC.map((k) => hdr(G.cv[k] ? colV(G.cv[k]) : opex ? 'as planned' : 'on time'))],
      ];
      pickR.forEach((ri2) => rows.push([{ text: [{ text: G.rv[ri2] ? `−${pc(G.rv[ri2])}` : 'As planned', options: { semi: true, breakLine: !!G.rAbs } }, ...(G.rAbs ? [{ text: G.rAbs(G.rv[ri2]), options: { color: DK.ink2 } }] : [])], options: { border: [nb, nb, { pt: 0.75, color: DK.line }, nb] } },
        ...pickC.map((k) => { const c = G.cells[ri2][k], [tc, ts] = TONE[c.tone]; return { text: c.txt, options: { color: tc, semi: true, fontSize: 20, fill: { color: ts }, align: 'center', border: [wb, wb, wb, wb] } }; })]));
      const lc = 2.9, cw = (CW - lc) / pickC.length, y = 2.3, rh = 0.88;
      s.table(rows, { x: M, y, w: CW, colW: [lc, ...pickC.map(() => cw)], rowH: [0.42, 0.45, ...pickR.map(() => rh)], fontSize: 16, valign: 'middle', margin: [0.03, 0.12, 0.03, 0.12], objectName: 'Stress test table' });
      s.text(`"Short" = still owed to InRento at maturity (${D.maturity}). "Needs" = the borrower must add this cash, then the loan is repaid. Each cell reruns the full monthly cash flow.`,
        { x: M, y: y + 0.87 + rh * pickR.length + 0.25, w: CW, h: 0.55, fontSize: 14, color: DK.ink2 }); } }
  return W;
}

// ---- the button: preview first, then download
function openCommittee() {
  if (!S.model) return;
  if (!window.PptxGenJS) return toast('PowerPoint library did not load');
  let D, W; try { D = committeeData(); W = composeCommittee(D); } catch (e) { console.error(e); toast('Could not prepare the deck: ' + e.message); return; }
  const slides = W.htmlSlides();
  const warn = [];
  if (!D.desc) warn.push('Project description is empty – Overview tab');
  if (!D.grid) warn.push('No stress test – no sales or revenue in the model');
  if (!$('#deckfonts')) { const st = document.createElement('style'); st.id = 'deckfonts'; st.textContent = `@font-face{font-family:InterDeck;font-weight:400;src:url(${DECK_FONTS.regular}) format('woff2')}@font-face{font-family:InterDeck;font-weight:600;src:url(${DECK_FONTS.semibold}) format('woff2')}`; document.head.appendChild(st); }
  const c = issueCounts(); if (c.error) warn.push(`${c.error} likely mistake${c.error > 1 ? 's' : ''} in the model check`);
  let ov = $('#deckov'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'deckov'; ov.className = 'deckov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Committee deck preview');
  ov.innerHTML = `<div class="deckbar"><b>Committee deck</b><span class="sub">${slides.length} slides · built from the current inputs</span>${warn.map((w) => `<span class="pill chk">${esc(w)}</span>`).join('')}<span class="spacer"></span>
    <button class="btn" id="deckpdf">Download PDF</button><button class="btn primary" id="cdpptx">Download PowerPoint</button><button class="btn ghost" id="deckclose" aria-label="Close">✕</button></div>
    <div class="deckscroll" id="deckscroll">${slides.map((h) => `<div class="deckframe">${h}</div>`).join('')}</div>`;
  document.body.appendChild(ov); document.body.style.overflow = 'hidden';
  const fit = () => { const w = Math.min(ov.clientWidth - 48, 1280); ov.querySelectorAll('.deckframe').forEach((f) => { const k = w / 1280; f.style.width = w + 'px'; f.style.height = 720 * k + 'px'; f.firstElementChild.style.transform = `scale(${k})`; f.firstElementChild.style.transformOrigin = '0 0'; }); };
  fit(); window.addEventListener('resize', fit);
  const close = () => { ov.remove(); document.body.style.overflow = ''; window.removeEventListener('resize', fit); };
  $('#deckclose').onclick = close;
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#deckpdf').onclick = () => deckPdf(slides);
  $('#cdpptx').onclick = async () => { const b = $('#cdpptx'); b.disabled = true; b.textContent = 'Building…';
    try { await W.pres.writeFile({ fileName: `${slug(D.name)}_credit_committee_${new Date().toISOString().slice(0, 10)}.pptx` }); toast('PowerPoint saved to your Downloads folder'); }
    catch (err) { console.error(err); toast('Could not build the PowerPoint: ' + err.message); }
    b.disabled = false; b.textContent = 'Download PowerPoint'; };
  $('#cdpptx').focus();
}
const openDeck = withView(openCommittee);
async function deckPdf(slides) {
  if (!window.jspdf || !window.html2canvas) { toast('PDF library did not load'); return; }
  const btn = $('#deckpdf'); btn.disabled = true; btn.textContent = 'Building PDF…';
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const host = document.createElement('div'); host.style.cssText = `position:fixed;left:-20000px;top:0;width:${1280}px`; document.body.appendChild(host);
    const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720], hotfixes: ['px_scaling'], compress: true });
    for (let i = 0; i < slides.length; i++) {
      const box = document.createElement('div'); box.innerHTML = slides[i]; host.appendChild(box);
      const canvas = await window.html2canvas(box.firstElementChild, { scale: 2, backgroundColor: '#' + DK.bg, logging: false, width: 1280, height: 720, windowWidth: 1280 });
      if (i) pdf.addPage([1280, 720], 'landscape');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 1280, 720);
      box.remove(); btn.textContent = `Building PDF… ${i + 1}/${slides.length}`;
    }
    host.remove();
    const p = cur(); const d = new Date().toISOString().slice(0, 10);
    saveFile(`${slug(p.name)}_credit_committee_${d}.pdf`, pdf.output('blob'));
    toast('Deck saved to your Downloads folder');
  } catch (e) { console.error(e); toast('Could not build the PDF: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Download PDF';
}

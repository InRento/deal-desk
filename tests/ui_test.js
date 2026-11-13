// UI flow test: builds a fictional deal through the browser, the way a user would, and checks the results.
// Needs Playwright (npm i -D playwright, or set NODE_PATH to a global install) and a built dist/ (./build.sh).
//   node tests/ui_test.js            (starts dist/server.py on a temporary data folder)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');

const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (got: ${got})`}`); if (!ok) failures++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dealdesk-ui-')), port = await freePort();
  // always a temporary shared folder: never the real one on this Mac
  const drive = path.join(tmp, 'drive'); fs.mkdirSync(drive); fs.writeFileSync(path.join(drive, '.deal-desk'), '{}');
  const srv = spawn('python3', [process.env.DIST ? path.join(process.env.DIST, 'server.py') : path.join(ROOT, 'dist', 'server.py'), '--port', String(port), '--no-browser'], { env: Object.assign({}, process.env, { DEALDESK_DATA: tmp, DEALDESK_DRIVE: drive, DEALDESK_USER: 'test@example.com', DEALDESK_FLUSH_SECONDS: '0', DEALDESK_NO_OPEN: '1' }), stdio: 'ignore' });
  await sleep(1500);
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage(); const errors = []; pg.on('pageerror', (e) => errors.push(String(e)));
  const text = async (sel) => ((await pg.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
  const fill = async (k, v) => { await pg.fill(`[data-k="${k}"]`, v); await sleep(250); };
  const tab = async (t) => { await pg.click(`.tab[data-tab="${t}"]`); await sleep(350); };
  const download = async (sel) => { const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 120000 }), pg.click(sel)]); return d.suggestedFilename(); };
  try {
    await pg.goto(`http://127.0.0.1:${port}/`); await sleep(1200);
    // 1 new project
    await pg.click('[data-act="new"]'); await sleep(600);
    await pg.fill('#m-name', 'Test Tower, Riga'); await sleep(200);
    await pg.click('[data-act="set-type"][data-t="units"]'); await sleep(400);
    check((await text('.crumb')).includes('Test Tower, Riga'), 'project created and named');
    // 2 inputs, live results rail, Enter moves on
    await tab('inputs');
    await fill('inputs.loan', '1000000'); await fill('inputs.rate', '11'); await fill('inputs.term', '24'); await fill('inputs.arrFee', '8');
    await pg.focus('[data-k="inputs.rate"]'); await pg.keyboard.press('Enter');
    check(await pg.evaluate(() => document.activeElement.dataset.k) === 'inputs.term', 'Enter moves to the next field', await pg.evaluate(() => document.activeElement.dataset.k));
    check((await text('[data-out="iqrail"]')).includes('€1,000,000'), 'results rail shows the loan', await text('[data-out="iqrail"]'));
    // 3 collateral with one sale
    await tab('assets');
    await pg.fill('[data-k="assets.0.name"]', 'Building'); await fill('assets.0.market', '2000000');
    await fill('assets.0.salePrice', '2400000'); await pg.fill('[data-k="assets.0.saleDate"]', '2027-12-15'); await pg.dispatchEvent('[data-k="assets.0.saleDate"]', 'change'); await sleep(400);
    check((await text('#kpis')).includes('50.0%'), 'LTV 50% in the KPI strip', await text('#kpis'));
    // 3b Deal tab: the structure as text (read only) and results
    await tab('deal');
    check(!(await pg.$('.dl-kvs [data-k]')) && (await text('.dl-kvs')).includes('11%'), 'Deal tab shows the structure as text', await text('.dl-kvs'));
    check((await text('[data-out="dealres"]')).includes('50.0%'), 'Deal tab shows the LTV', await text('[data-out="dealres"]'));
    check((await text('[data-out="dealsc"]')).includes('Base'), 'Deal tab shows the scenarios', await text('[data-out="dealsc"]'));
    // 3c Sensitivity: the two-driver grid follows the drivers chosen under "Choose your own two drivers"
    await tab('sens'); await sleep(600);
    await pg.selectOption('#sens-metric', 'ltv'); await sleep(500);
    check((await text('#sens-metric-h')) === 'LTV (market value) by scenario' && (await pg.$$eval('#ch-sens text.ax', (t) => t.some((x) => x.textContent.endsWith('%')))), 'scenario chart switches to LTV', await text('#sens-metric-h'));
    check((await text('[data-out="grid2"]')).includes('Sale prices'), 'two-driver grid preset by deal type', await text('[data-out="grid2"]'));
    await pg.click('details[data-own-grid] summary'); await sleep(600);
    await pg.selectOption('#g-row', 'salePrice'); await sleep(900);
    check((await text('[data-out="grid2"]')).includes('Sale price change'), 'own drivers drive the two-driver grid', await text('[data-out="grid2"]'));
    await pg.click('details[data-own-grid] summary'); await sleep(600);
    check((await text('[data-out="grid2"]')).includes('Sale prices ↓'), 'closing it brings back the preset grid', await text('[data-out="grid2"]'));
    await tab('deal');
    await pg.click('[data-act="dl-add"][data-box="listings"]'); await pg.fill('#dl-url', 'otodom.pl/pl/oferta/test'); await pg.fill('#dl-lbl', 'Unit 4'); await pg.click('[data-act="dl-save"]'); await sleep(400);
    await tab('inputs'); await tab('deal');
    check((await text('.dl-links')).includes('Unit 4') && (await pg.$eval('.dl-links a', (a) => a.href)) === 'https://otodom.pl/pl/oferta/test', 'a link added on the Deal tab is kept (https:// added)', await text('.dl-lbs'));
    // 3c tables work like a spreadsheet: select a block, fill down (⌘D), one value pasted into every selected cell, undo in one step
    await tab('assets'); await pg.click('[data-act="add-asset"]'); await sleep(300); await pg.click('[data-act="add-asset"]'); await sleep(400);
    const cell = async (k) => (await (await pg.$(`[data-k="${k}"]`)).evaluateHandle((e) => e.closest('td'))).asElement();
    await (await cell('assets.0.market')).click({ position: { x: 2, y: 2 } }); await (await cell('assets.2.market')).click({ position: { x: 2, y: 2 }, modifiers: ['Shift'] }); await sleep(150);
    check((await pg.$$('td.gs')).length === 3, 'Shift+click selects a block of cells', String((await pg.$$('td.gs')).length));
    await pg.keyboard.press('ControlOrMeta+D'); await sleep(500);
    check((await pg.$$eval('[data-k$=".market"]', (x) => x.map((e) => e.value))).slice(0, 3).join() === '2000000,2000000,2000000', 'fill down copies the top cell', (await pg.$$eval('[data-k$=".market"]', (x) => x.map((e) => e.value))).join());
    await pg.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '1 500 000'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await sleep(500);
    check((await pg.$$eval('[data-k$=".market"]', (x) => x.map((e) => e.value))).slice(0, 3).join() === '1500000,1500000,1500000', 'one pasted value fills every selected cell', (await pg.$$eval('[data-k$=".market"]', (x) => x.map((e) => e.value))).join());
    await pg.keyboard.press('ControlOrMeta+Z'); await sleep(500); await pg.keyboard.press('ControlOrMeta+Z'); await sleep(500);
    check((await pg.$$eval('[data-k$=".market"]', (x) => x.map((e) => e.value))).join() === '2000000,,', 'undo takes back the paste and the fill, one step each', (await pg.$$eval('[data-k$=".market"]', (x) => x.map((e) => e.value))).join());
    await pg.click('[data-act="del-asset"][data-i="2"]'); await sleep(300); await pg.click('[data-act="del-asset"][data-i="1"]'); await sleep(300);
    // 4 undo / redo
    await tab('inputs'); await fill('inputs.rate', '12'); await pg.click('body'); await sleep(1700);
    await pg.keyboard.press('Meta+z'); await sleep(400); if ((await pg.inputValue('[data-k="inputs.rate"]')) === '12') { await pg.keyboard.press('Control+z'); await sleep(400); }
    check(await pg.inputValue('[data-k="inputs.rate"]') === '11', 'undo restores the rate', await pg.inputValue('[data-k="inputs.rate"]'));
    // 5 model check catches a fraction and fixes it
    await fill('inputs.arrFee', '0.08'); await sleep(300);
    await pg.click('[data-act="goto-check"]'); await sleep(400);
    check((await text('#mcheck')).includes('did you mean 8%'), 'model check spots 0.08%', await text('#mcheck'));
    await pg.click('#mcheck [data-act="fix-issue"]'); await sleep(400);
    await tab('inputs'); check(await pg.inputValue('[data-k="inputs.arrFee"]') === '8', 'fix button sets 8%', await pg.inputValue('[data-k="inputs.arrFee"]'));
    // 6 decision log, and versions keep deal-level fields
    await tab('overview'); await pg.selectOption('#jd-decision', 'Proceed'); await sleep(300);
    await pg.fill('#jd-why', 'Low LTV, sponsor equity in first'); await pg.fill('#jd-preMortem', 'Sales start late'); await pg.fill('#jd-confidence', '80');
    await pg.click('[data-act="jd-record"]'); await sleep(400);
    check((await text('#jdcard')).includes('Numbers at the decision') && (await text('#jdcard')).includes('loan €1,000,000'), 'recording the decision keeps the numbers', await text('#jdcard'));
    await pg.fill('#m-nextAction', 'Send term sheet'); await sleep(900);
    await pg.selectOption('#vsel', '__new'); await sleep(400);
    await pg.fill('#vnewname', 'Higher rate'); await pg.click('[data-vn="ok"]'); await sleep(1500);
    await tab('inputs'); await fill('inputs.rate', '13'); await sleep(1200);
    const opts = await pg.$$eval('#vsel option', (o) => o.map((x) => [x.value, x.textContent]));
    const main = opts.find((o) => /Main/.test(o[1]));
    await pg.selectOption('#vsel', main[0]); await sleep(1800);
    await tab('inputs');
    check(await pg.inputValue('[data-k="inputs.rate"]') === '11', 'switching back to Main restores its rate', await pg.inputValue('[data-k="inputs.rate"]'));
    await tab('overview'); check(await pg.inputValue('#m-nextAction') === 'Send term sheet', 'next action survives a version switch', await pg.inputValue('#m-nextAction'));
    check((await text('#jdcard')).includes('Low LTV, sponsor equity in first'), 'decision log survives a version switch', await text('#jdcard'));
    // 6b Deal tab: borrower's plan vs our view, picked on Versions; the choice belongs to the deal and survives a version switch
    await tab('versions'); const hr = opts.find((o) => /Higher rate/.test(o[1]));
    await pg.selectOption('#dl-plan', main[0]); await sleep(300); await pg.selectOption('#dl-view', hr[0]); await sleep(900);
    await pg.selectOption('#vsel', hr[0]); await sleep(1800); await tab('deal');
    { const t = await text('[data-out="dealres"]'); check(t.includes("Borrower's plan") && t.includes('Our view') && t.includes('Higher rate'), 'Deal tab shows the plan and our view side by side', t); }
    await pg.selectOption('#vsel', main[0]); await sleep(1800); await tab('overview');
    await pg.fill('#m-deckDesc', 'Test building in Riga.'); await sleep(900);
    // 7 committee deck: the deal and the stress test
    await pg.click('[data-act="deck"]'); await pg.waitForSelector('.deckframe');
    check((await pg.$$('.deckframe')).length === 2, 'committee deck has 2 slides', (await pg.$$('.deckframe')).length);
    check((await text('.deckframe')).includes('Test building in Riga.'), 'deck shows the project description', await text('.deckframe'));
    check(/\.pptx$/.test(await download('#cdpptx')), 'PowerPoint downloads');
    check(/\.pdf$/.test(await download('#deckpdf')), 'PDF downloads');
    await pg.click('#deckclose');
    // 7b source added by hand (right-click)
    await tab('inputs'); await pg.click('[data-k="inputs.rate"]', { button: 'right' }); await pg.fill('#se-doc', 'Term sheet'); await pg.fill('#se-loc', 'p.2'); await pg.click('#se-save'); await sleep(300);
    check(await pg.$eval('[data-k="inputs.rate"]', (e) => e.classList.contains('src-doc')), 'a source added by hand marks the field');
    await pg.click('[data-k="inputs.term"]', { button: 'right' }); await pg.fill('#se-doc', 'Term sheet'); await pg.fill('#se-url', 'drive.google.com/x'); await pg.click('#se-save'); await sleep(200);
    check(!!(await pg.$('#srcedit')), 'a link without https:// is refused');
    await pg.fill('#se-url', 'https://drive.google.com/drive/folders/test'); await pg.click('#se-save'); await sleep(300);
    await pg.click('body'); await pg.focus('[data-k="inputs.term"]'); await sleep(200);
    await ctx.route('https://drive.google.com/**', (r) => r.fulfill({ body: 'drive' })); // no internet needed
    const [popup] = await Promise.all([pg.waitForEvent('popup', { timeout: 5000 }), pg.dispatchEvent('#srcchip [data-src="link"]', 'mousedown')]);
    await popup.waitForURL(/drive\.google\.com/, { timeout: 5000 }).catch(() => {});
    check(popup.url().startsWith('https://drive.google.com/drive/folders/test'), 'Open link opens the Drive link', popup.url()); await popup.close();
    // 8 Excel
    check(/_model\.xlsx$/.test(await download('[data-act="export-xlsx"]')), 'Excel export downloads');
    // 9 currency view
    await tab('inputs'); await pg.fill('[data-k="inputs.currency"]', 'PLN'); await sleep(300); await pg.click('body'); await sleep(300);
    await tab('overview'); await tab('inputs'); await fill('inputs.fxRate', '4'); await sleep(300);
    await tab('summary'); await pg.click('[data-act="ccy"][data-v="EUR"]'); await sleep(500);
    check((await text('#kpis')).includes('€250,000'), 'EUR view converts PLN 1,000,000 at 4', await text('#kpis'));
    await tab('deal');
    check((await text('[data-out="dealres"]')).includes('€250,000'), 'Deal tab results follow the EUR view', await text('[data-out="dealres"]'));
    check((await text('.dl-kvs')).includes('€250,000'), 'Deal tab structure follows the EUR view', await text('.dl-kvs'));
    await pg.click('[data-act="ccy"][data-v="orig"]'); await sleep(300);
    // 9b payment plan: 10% at the contract, the rest at the deed
    await tab('inputs'); await pg.click('[data-act="add-pay"]'); await sleep(300);
    await fill('inputs.payPlan.0.pct', '10'); await fill('inputs.payPlan.0.months', '0'); await sleep(300);
    await tab('assets'); await pg.fill('[data-k="assets.0.contractDate"]', '2027-03-01'); await pg.dispatchEvent('[data-k="assets.0.contractDate"]', 'change'); await sleep(500);
    check((await text('[data-out="a-0-pays"]')).includes('10% Mar 27'), 'payment plan splits the sale into instalments', await text('[data-out="a-0-pays"]'));
    // 10 no email tab any more
    check(!(await pg.$('.tab[data-tab="emails"]')), 'no Emails tab');
    // 11 saved to the shared folder
    await sleep(1500); await pg.reload(); await sleep(1200);
    check((await text('#app')).includes('Test Tower, Riga'), 'project is still there after a reload');
    check(fs.readdirSync(path.join(drive, 'Deals')).some((f) => f.startsWith('Test Tower, Riga (') && fs.existsSync(path.join(drive, 'Deals', f, 'deal.json'))), 'project written to the shared folder', JSON.stringify(fs.readdirSync(path.join(drive, 'Deals'))));
    // 11b Home lists Turned in first (what waits for the CEO), then the pipeline in order
    await pg.evaluate(() => fetch('/api/projects/ui-second', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Second deal', status: 'New deal', inputs: {} }) }));
    await pg.click('tr[data-open] b'); await sleep(600); await tab('overview'); await pg.click('[data-act="set-stage"][data-v="Turned in"]'); await sleep(1500);
    await pg.reload(); await sleep(1500);
    { const g = await pg.$$eval('.grph', (x) => x.map((e) => e.textContent.trim())); check(g[0] === 'Turned in' && g.includes('New deal'), 'Home shows Turned in first', g.join(', ')); }
    // 12 no Documents tab any more: sources carry a Drive link instead
    await pg.click('tr[data-open] b'); await sleep(600); // the reload above lands on Home
    check(!(await pg.$('.tab[data-tab="docs"]')), 'no Documents tab');
  } catch (e) { console.log('FAIL', e.message); failures++; }
  check(!errors.length, 'no page errors', errors.join(' | '));
  await browser.close(); srv.kill(); await new Promise((r) => srv.exitCode !== null ? r() : srv.on('exit', r)); fs.rmSync(tmp, { recursive: true, force: true }); // the server writes pending deals on exit
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED'); process.exitCode = failures ? 1 : 0;
})();

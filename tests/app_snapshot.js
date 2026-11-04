// App guard – what the analyst sees: every tab of every test deal, the committee deck and the Excel export,
// compared with tests/expected/app.json. Catches changes the engine guard cannot see (margin for error, investor IRR,
// model check, deck, export). The browser clock is fixed so "today" never changes the result.
//   node tests/app_snapshot.js            compare        node tests/app_snapshot.js --update   re-record after an intended change
// Needs Playwright and a built dist/.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http');

const ROOT = path.join(__dirname, '..'), DEALS = path.join(__dirname, 'deals'), EXP = path.join(__dirname, 'expected', 'app.json');
const TODAY = '2026-10-24T09:00:00Z';
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const put = (port, id, body) => new Promise((res, rej) => { const d = JSON.stringify(body); const q = http.request({ host: '127.0.0.1', port, path: `/api/projects/${id}`, method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, (r) => { r.resume(); r.on('end', res); }); q.on('error', rej); q.end(d); });
// timestamps of saving (not of the model) are left out
const tidy = (t) => t.replace(/Saved to deals\.sqlite|Saving…|Connecting…/g, '').replace(/(Created|Last change)\n[^\n]*/g, '$1');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dealdesk-snap-')), port = await freePort();
  const srv = spawn('python3', [path.join(ROOT, 'dist', 'server.py'), '--port', String(port), '--no-browser'], { env: Object.assign({}, process.env, { DEALDESK_DATA: tmp }), stdio: 'ignore' });
  await sleep(1500);
  const ids = fs.readdirSync(DEALS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  for (const id of ids) { const p = JSON.parse(fs.readFileSync(path.join(DEALS, id + '.json'), 'utf8')); p.name = p.name || id; await put(port, id, p); }
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Vilnius', locale: 'en-GB' });
  const pg = await ctx.newPage(); await pg.clock.setFixedTime(new Date(TODAY));
  const errors = []; pg.on('pageerror', (e) => errors.push(String(e)));
  const XLSX = require(path.join(ROOT, 'vendor', 'xlsx.full.min.js'));
  const S = {};
  await pg.goto(`http://127.0.0.1:${port}/`); await pg.waitForSelector('table.pipe'); await sleep(800);
  for (const id of ids) {
    await pg.click('[data-act="home"]').catch(() => {}); await sleep(200);
    await pg.click(`tr[data-open="${id}"] b`); await sleep(500);
    for (const t of await pg.$$eval('.tab', (x) => x.map((b) => b.dataset.tab))) {
      if (t === 'emails' || t === 'versions') continue; // no Gmail and no versions in the test database
      await pg.click(`.tab[data-tab="${t}"]`); await sleep(t === 'sens' ? 900 : 300);
      S[`${id} / ${t}`] = tidy(await pg.evaluate(() => document.querySelector('#tabbody').innerText));
    }
    S[`${id} / KPIs`] = await pg.evaluate(() => document.querySelector('#kpis').innerText);
    await pg.click('[data-act="deck"]'); await pg.waitForSelector('.deckframe'); await sleep(300);
    S[`${id} / committee deck`] = await pg.evaluate(() => [...document.querySelectorAll('.deckframe')].map((f) => f.innerText).join('\n---\n'));
    await pg.click('#deckclose');
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('[data-act="export-xlsx"]')]);
    const wb = XLSX.read(fs.readFileSync(await dl.path()), { type: 'buffer' });
    S[`${id} / Excel export`] = wb.SheetNames.map((n) => `## ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n');
  }
  S.errors = errors.join('\n');
  await browser.close(); srv.kill(); fs.rmSync(tmp, { recursive: true, force: true });

  if (process.argv.includes('--update')) { fs.mkdirSync(path.dirname(EXP), { recursive: true }); fs.writeFileSync(EXP, JSON.stringify(S, null, 1)); console.log(`recorded ${Object.keys(S).length} views in tests/expected/app.json`); return; }
  const exp = JSON.parse(fs.readFileSync(EXP, 'utf8')); let fails = 0;
  for (const k of new Set([...Object.keys(exp), ...Object.keys(S)])) {
    if (exp[k] === S[k]) continue;
    fails++; const a = String(exp[k] ?? '(missing)').split('\n'), b = String(S[k] ?? '(missing)').split('\n'), out = [];
    for (let i = 0; i < Math.max(a.length, b.length) && out.length < 6; i++) if (a[i] !== b[i]) out.push(`   line ${i + 1}: ${JSON.stringify(a[i] ?? '')} → ${JSON.stringify(b[i] ?? '')}`);
    console.log(`FAIL ${k} changed\n${out.join('\n')}`);
  }
  console.log(fails ? `APP GUARD FAILED (${fails} views changed)` : `APP GUARD PASSED (${Object.keys(S).length} views unchanged)`);
  process.exitCode = fails ? 1 : 0;
})();

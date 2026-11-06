// Deal locks in the browser: two servers on one temporary shared folder stand in for two Macs (Tautvydas and Lukas),
// with fictional deals only. Checks the lock bar in every state, read-only fields, Home badges, live refresh of a deal
// someone else is editing, and force unlock.
//   node tests/lock_ui_test.js              (needs Playwright, like the app guard)
//   SHOTS=<folder> node tests/lock_ui_test.js   also saves screenshots of each state
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http');
const ROOT = path.join(__dirname, '..'), SHOTS = process.env.SHOTS;
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (port, method, p, body) => new Promise((res, rej) => {
  const d = body ? JSON.stringify(body) : '';
  const q = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, (r) => { let t = ''; r.on('data', (c) => (t += c)); r.on('end', () => res({ code: r.statusCode, body: t ? JSON.parse(t) : null })); });
  q.on('error', rej); q.end(d);
});
let failures = 0;
const check = (ok, what, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (got: ${got})`}`); if (!ok) failures++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dealdesk-locks-'));
  // always a temporary shared folder: never the real one on this Mac
  const drive = path.join(tmp, 'drive'); fs.mkdirSync(path.join(drive, 'Inbox'), { recursive: true }); fs.writeFileSync(path.join(drive, '.deal-desk'), '{}');
  const start = async (name, user) => {
    const port = await freePort();
    const srv = spawn('python3', [path.join(ROOT, 'dist', 'server.py'), '--port', String(port), '--no-browser'], {
      env: Object.assign({}, process.env, { DEALDESK_DATA: path.join(tmp, name), DEALDESK_DRIVE: drive, DEALDESK_USER: user, DEALDESK_FLUSH_SECONDS: '0', DEALDESK_SYNC_SECONDS: '1', DEALDESK_LOCK_SETTLE: '0.5' }), stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await call(port, 'GET', '/api/ping'); break; } catch { await sleep(100); } }
    return { port, srv };
  };
  const T = await start('tautvydas', 'tautvydas@inrento.com'), L = await start('lukas', 'lukas@inrento.com');
  const deal = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'deals', f + '.json'), 'utf8'));
  // Tautvydas creates three deals (each locked to him), then releases one; Lukas creates one of his own
  for (const id of ['test-newbuild', 'test-renovation', 'test-two-loans']) await call(T.port, 'PUT', `/api/projects/${id}`, Object.assign(deal(id), { status: 'Underwriting' }));
  await call(T.port, 'POST', '/api/storage/sync', {});
  await call(T.port, 'DELETE', '/api/projects/test-renovation/lock');
  await call(L.port, 'PUT', '/api/projects/test-instalments', Object.assign(deal('test-instalments'), { status: 'Initial analysis' }));
  await call(L.port, 'POST', '/api/storage/sync', {}); await call(T.port, 'POST', '/api/storage/sync', {});

  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = async (port) => { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Vilnius', locale: 'en-GB' }); const pg = await ctx.newPage(); pg.errors = []; pg.on('pageerror', (e) => pg.errors.push(String(e))); await pg.goto(`http://127.0.0.1:${port}/`); await sleep(1200); return pg; };
  const shot = async (pg, name, clip) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + '.png'), clip }); } };
  const bar = async (pg) => ((await pg.textContent('#lockbar')) || '').replace(/\s+/g, ' ').trim();
  const open = async (pg, id) => { await pg.click('[data-act="home"]').catch(() => {}); await sleep(250); await pg.click(`tr[data-open="${id}"] b`); await sleep(600); await pg.click('[data-tab="inputs"]').catch(() => {}); await sleep(300); }; // the Deal tab is read only, so the fields are on Inputs
  const top = { x: 0, y: 0, width: 1440, height: 560 };
  try {
    const lukas = await page(L.port), tautvydas = await page(T.port);
    // Home: who holds what
    const home = (await lukas.textContent('table.pipe')).replace(/\s+/g, ' ');
    check(/Test new build, Kaunas\s*Tautvydas/.test(home), 'Home shows Tautvydas holds Test new build', home.slice(0, 200));
    check(/Test instalments, Vilnius\s*You/.test(home), 'Home shows Lukas holds his own deal');
    check(!(await lukas.$('table.pipe select')), 'Home has no stage column – the stage is changed on the deal (Overview)');
    await shot(lukas, '1-home-badges', await lukas.$eval('table.pipe', (t) => { const r = t.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + window.scrollY - 70), width: 1440, height: r.height + 80 }; }));
    // a deal Tautvydas holds: read-only for Lukas
    await open(lukas, 'test-newbuild'); await lukas.click('.tab[data-tab="inputs"]'); await sleep(400);
    check((await bar(lukas)).startsWith('Locked by Tautvydas since'), 'lock bar: locked by Tautvydas', await bar(lukas));
    check(await lukas.$eval('[data-k="inputs.rate"]', (el) => el.disabled), 'inputs are read-only');
    check(await lukas.$eval('#undo-btn', (el) => el.disabled), 'undo is off');
    await shot(lukas, '2-locked-by-someone-else', top);
    await lukas.click('[data-act="force-ask"]'); await sleep(200);
    check((await bar(lukas)).startsWith('Take over from Tautvydas?'), 'force unlock asks first', await bar(lukas));
    await shot(lukas, '3-force-unlock-confirm', { x: 0, y: 0, width: 1440, height: 260 });
    await lukas.click('[data-act="force-cancel"]'); await sleep(200);
    // Tautvydas edits; Lukas's read-only copy follows without a reload
    await open(tautvydas, 'test-newbuild'); await tautvydas.click('.tab[data-tab="inputs"]'); await sleep(400);
    check((await bar(tautvydas)).startsWith("You're editing"), "lock bar for the holder: You're editing", await bar(tautvydas));
    await shot(tautvydas, '4-you-are-editing', top);
    await tautvydas.fill('[data-k="inputs.rate"]', '12.5'); await sleep(1500);
    await sleep(6500);
    check(await lukas.$eval('[data-k="inputs.rate"]', (el) => el.value) === '12.5', "Lukas sees Tautvydas's change without reloading", await lukas.$eval('[data-k="inputs.rate"]', (el) => el.value));
    // a deal nobody holds: read-only for everyone until someone locks it
    await open(lukas, 'test-renovation');
    check((await bar(lukas)).startsWith('Read-only nobody is editing this deal'), 'lock bar: nobody is editing', await bar(lukas));
    check(await lukas.$eval('#tabbody [data-k]', (el) => el.disabled), 'an unlocked deal is read-only too');
    await shot(lukas, '5-nobody-editing', { x: 0, y: 0, width: 1440, height: 260 });
    await lukas.click('[data-act="lock"]'); await sleep(2500);
    check((await bar(lukas)).startsWith("You're editing"), 'Lock & edit gives the lock', await bar(lukas));
    check(!(await lukas.$eval('#tabbody [data-k]', (el) => el.disabled)), 'fields are editable after locking');
    // force unlock: Lukas takes Test new build over; Tautvydas's page turns read-only
    await open(lukas, 'test-newbuild'); await lukas.click('[data-act="force-ask"]'); await sleep(200); await lukas.click('[data-act="force-go"]'); await sleep(2500);
    check((await bar(lukas)).startsWith("You're editing"), 'force unlock gives Lukas the lock', await bar(lukas));
    await sleep(6500);
    check((await bar(tautvydas)).startsWith('Locked by Lukas'), "Tautvydas's page shows Lukas took over", await bar(tautvydas));
    check(await tautvydas.$eval('[data-k="inputs.rate"]', (el) => el.disabled), "Tautvydas's fields turn read-only");
    await shot(tautvydas, '6-after-takeover', { x: 0, y: 0, width: 1440, height: 260 });
    // unlock writes the deal and frees it for everyone
    await lukas.click('[data-act="unlock"]'); await sleep(1500);
    check((await bar(lukas)).startsWith('Read-only'), 'Unlock makes it read-only again', await bar(lukas));
    const r = await call(T.port, 'GET', '/api/projects/test-newbuild');
    check(r.body._lock === null, 'the drive shows nobody holds it after unlock', JSON.stringify(r.body._lock));
    check(!lukas.errors.length && !tautvydas.errors.length, 'no page errors', lukas.errors.concat(tautvydas.errors).join(' | '));
  } catch (e) { console.log('FAIL', e.message); failures++; }
  await browser.close();
  for (const s of [T, L]) { s.srv.kill(); await new Promise((r) => (s.srv.exitCode !== null ? r() : s.srv.on('exit', r))); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED'); process.exitCode = failures ? 1 : 0;
})();

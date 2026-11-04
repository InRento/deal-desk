// Update in the browser: the real launcher installs the published version from a temporary shared folder (fake home,
// Google Drive's path); publishing a newer version shows "Restart to update"; the button restarts into it and the page
// reloads on the new version; an app too old for the shared deals shows that it can only view them.
//   node tests/update_ui_test.js            (needs Playwright, like the app guard)
//   SHOTS=<folder> node tests/update_ui_test.js   also saves screenshots
const { chromium } = require('playwright');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), SHOTS = process.env.SHOTS;
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (fp) => crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
let failures = 0;
const check = (ok, what, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (got: ${got})`}`); if (!ok) failures++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dealdesk-upd-')), home = path.join(tmp, 'home'), port = await freePort();
  // always a temporary shared folder: never the real one on this Mac
  const drive = path.join(home, 'Library', 'CloudStorage', 'GoogleDrive-test@example.com', 'Shared drives', 'Deal desk');
  execFileSync('python3', [path.join(ROOT, 'src', 'server.py'), '--init-drive', drive], { env: Object.assign({}, process.env, { DEALDESK_DATA: path.join(tmp, 'setup') }) });
  const rt = path.join(tmp, 'rt', 'python', 'bin'); fs.mkdirSync(rt, { recursive: true });
  fs.symlinkSync(execFileSync('python3', ['-c', 'import sys; print(sys.executable)']).toString().trim(), path.join(rt, 'python3'));
  execFileSync(path.join(ROOT, 'release.sh'), ['--drive', drive, '--skip-tests', '--publish', '--runtime', path.join(tmp, 'rt', 'python')], { stdio: 'ignore' });
  const env = Object.assign({}, process.env, { HOME: home, DEALDESK_TEST: '1', DEALDESK_PORT: String(port), DEALDESK_SYNC_SECONDS: '0.5', DEALDESK_FLUSH_SECONDS: '0', DEALDESK_USER: 'test@example.com' });
  delete env.DEALDESK_DRIVE; delete env.DEALDESK_DATA;
  const rel = path.join(drive, 'Releases'), cur = () => JSON.parse(fs.readFileSync(path.join(rel, 'current.json'), 'utf8'));
  const base = cur().version;
  const publish = (v, extra = {}) => { // what release.sh stages for a newer version, made by hand (the source keeps one APP_VERSION)
    if (!fs.existsSync(path.join(rel, v))) {
      fs.cpSync(path.join(rel, base), path.join(rel, v), { recursive: true });
      const fp = path.join(rel, v, 'server.py'); fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').replace(`APP_VERSION = "${base}"`, `APP_VERSION = "${v}"`));
    }
    const m = JSON.parse(fs.readFileSync(path.join(rel, base, 'manifest.json'), 'utf8'));
    fs.writeFileSync(path.join(rel, 'current.json'), JSON.stringify(Object.assign(m, { version: v, files: m.files.map((f) => ({ name: f.name, sha256: sha(path.join(rel, v, f.name)) })) }, extra)));
  };
  const r = spawnSync(path.join(ROOT, 'mac', 'launcher.sh'), [], { env, encoding: 'utf8', timeout: 60000 });
  check(r.status === 0, 'launcher installs and starts the published version', r.stderr);
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })).newPage();
    const errors = []; pg.on('pageerror', (e) => errors.push(String(e)));
    await pg.goto(`http://127.0.0.1:${port}/`); await sleep(1500);
    check(!(await pg.$('#updbar')), 'no update bar while the published version runs');
    publish('9.9.0');
    await pg.waitForSelector('#updbar', { timeout: 15000 });
    const bar = (await pg.innerText('#updbar')).replace(/\s+/g, ' ');
    check(bar.startsWith('Deal Desk 9.9.0 is ready'), 'bar: new version ready', bar);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, '9-update-ready.png'), clip: { x: 640, y: 780, width: 800, height: 120 } }); }
    await pg.click('[data-act="upd-restart"]');
    await pg.waitForLoadState('load'); await sleep(500);
    for (let i = 0; i < 60 && !(await pg.evaluate(() => fetch('/api/ping').then((x) => x.json()).then((x) => x.version).catch(() => ''))).startsWith('9.9.0'); i++) await sleep(500);
    await pg.waitForFunction(() => !document.querySelector('#updbar') && document.querySelector('#app').innerText.length > 0, null, { timeout: 15000 }).catch(() => {});
    check((await pg.evaluate(() => fetch('/api/ping').then((x) => x.json()))).version === '9.9.0', 'Restart to update runs 9.9.0');
    check(!(await pg.$('#updbar')), 'the page reloaded on the new version (no bar)');
    publish('9.9.0', { min_version: '9.9.5' });
    await pg.waitForSelector('#updbar.req', { timeout: 15000 });
    const req = (await pg.innerText('#updbar')).replace(/\s+/g, ' ');
    check(req.startsWith('This Deal Desk (9.9.0) can only view deals'), 'bar: too old for the shared deals', req);
    if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, '10-update-required.png'), clip: { x: 640, y: 780, width: 800, height: 120 } });
    check(!errors.length, 'no page errors', errors.join(' | '));
  } catch (e) { console.log('FAIL', e.message); failures++; }
  await browser.close();
  for (const pid of spawnSync('/usr/sbin/lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.split(/\s+/).filter(Boolean)) process.kill(+pid);
  await sleep(1000);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED'); process.exitCode = failures ? 1 : 0;
})();

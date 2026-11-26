'use strict';
// Smoke test: muat halaman melalui api/_server.js, laporkan ralat konsol, ralat JS, permintaan gagal dan pelanggaran CSP.
// Jalankan dari root: node tests/frontend/smoke.js
const path = require('node:path');
const server = require('../../api/_server.js');
require('../helpers/banjir-fixture.js').pasangSemuaCache(); // cuaca, banjir dan IPU deterministik, tidak bergantung pada cache tempatan
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);

const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'smoke-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const problems = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type()))
        problems.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push('http ' + r.status() + ' ' + r.url());
    });
    page.on('requestfailed', (r) =>
      problems.push(`requestfailed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`),
    );
    const resp = await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2500);
    const headers = resp.headers();
    for (const h of [
      'content-security-policy',
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
      'permissions-policy',
      'cross-origin-opener-policy',
    ])
      if (!headers[h]) problems.push('header tiada: ' + h);
    if (headers['access-control-allow-origin'])
      problems.push('CORS terlalu terbuka: ' + headers['access-control-allow-origin']);
    const mapOk = await page.evaluate(() => !!document.querySelector('.maplibregl-canvas'));
    if (!mapOk) problems.push('peta tidak dimuatkan');
  } finally {
    await browser.close();
    server.close();
  }
  console.log(problems.length ? problems.join('\n') : 'OK: tiada masalah');
  process.exitCode = problems.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

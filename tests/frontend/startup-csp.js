'use strict';
// Mulakan pelayan sebagai proses sebenar (npm start): /api/cuaca mesti 200 selepas permulaan,
// halaman dimuat tanpa sebarang pelanggaran CSP dan tanpa kebergantungan unpkg.
// Jalankan dari root: node tests/frontend/startup-csp.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portBebas() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
async function mula(env) {
  const port = await portBebas();
  const child = spawn(process.execPath, ['api/_server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      CUACA_AUTO: '0',
      BANJIR_AUTO: '0',
      IPU_AUTO: '0',
      MUSE_AUTO: '0',
      AMARAN_DG_AUTO: '0',
      ...env,
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return { child, base };
    } catch {
      /* belum sedia */
    }
    await sleep(200);
  }
  child.kill();
  throw new Error('pelayan tidak bermula');
}

(async () => {
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  const fx = pasangSemuaCache();
  const fixture = fx.cuaca;
  const { child, base } = await mula({
    CUACA_CACHE_FILE: fixture,
    BANJIR_CACHE_FILE: fx.banjir,
    IPU_CACHE_FILE: fx.ipu,
    MUSE_CACHE_FILE: fx.muse,
    AMARAN_DG_CACHE_FILE: fx.amaranDG,
  });
  let browser;
  try {
    const c = await fetch(base + '/api/cuaca');
    ok('/api/cuaca 200 selepas permulaan', c.status === 200, c.status);
    const bj = await fetch(base + '/api/banjir');
    ok('/api/banjir 200 selepas permulaan', bj.status === 200, bj.status);
    const ip = await fetch(base + '/api/kualiti-udara');
    ok('/api/kualiti-udara 200 selepas permulaan', ip.status === 200, ip.status);
    const ms = await fetch(base + '/api/muse');
    ok('/api/muse 200 selepas permulaan', ms.status === 200, ms.status);
    const am = await fetch(base + '/api/met-malaysia');
    ok('/api/met-malaysia 200 selepas permulaan', am.status === 200, am.status);
    const idx = await fetch(base + '/');
    const csp = idx.headers.get('content-security-policy') || '';
    ok('CSP pengepala tiada unpkg', !/unpkg/.test(csp), csp);
    const html = await idx.text();
    ok('index.html tiada unpkg', !/unpkg/.test(html));
    ok('CSP pengepala tiada windy dan tiada frame-src', !/windy|frame-src/i.test(csp), csp);
    const metaCsp =
      (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
    ok('meta CSP tiada windy dan tiada frame-src', !/windy|frame-src/i.test(metaCsp), metaCsp);
    const direktif = (teks, nama) =>
      (teks.split(';').find((d) => d.trim().startsWith(nama + ' ')) || '').trim();
    for (const h of ['https://tilecache.rainviewer.com', 'https://gibs.earthdata.nasa.gov'])
      for (const d of ['img-src', 'connect-src'])
        ok(`CSP ${d} ada ${h}`, direktif(csp, d).split(/\s+/).includes(h), direktif(csp, d));
    ok(
      'meta CSP sama dengan pengepala (tanpa frame-ancestors)',
      html.includes(csp.replace("; frame-ancestors 'none'", '')),
    );
    for (const p of [
      '/src/vendor/maplibre-gl/maplibre-gl.js',
      '/src/vendor/maplibre-gl/maplibre-gl.css',
    ])
      ok('vendor ' + p, (await fetch(base + p)).status === 200);
    const js = await (await fetch(base + '/src/vendor/maplibre-gl/maplibre-gl.js')).text();
    ok('maplibre tanpa sourceMappingURL', !/sourceMappingURL/.test(js));

    browser = await puppeteer.launch({
      executablePath: EDGE,
      headless: 'new',
      userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'start-')),
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const masalah = [];
    const hosts = new Set();
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type())) masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.__csp.push(e.violatedDirective + ' ' + e.blockedURI),
      );
    });
    const r404 = [];
    page.on('response', (r) => {
      if (r.status() >= 400) r404.push(r.status() + ' ' + r.url());
    });
    await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2500);
    ok(
      'peta dimuat (maplibre tempatan)',
      await page.evaluate(() => !!document.querySelector('.maplibregl-canvas')),
    );
    ok(
      'kad cuaca dimuat daripada /api/cuaca',
      (await page.$$('#weatherGrid .weather-card')).length > 0,
    );
    ok(
      'tiada pelanggaran CSP',
      (await page.evaluate(() => window.__csp)).length === 0,
      await page.evaluate(() => window.__csp),
    );
    ok('tiada permintaan ke unpkg', ![...hosts].some((h) => /unpkg/.test(h)), [...hosts]);
    ok('tiada respons >= 400', r404.length === 0, r404);
    ok('tiada ralat/amaran konsol', masalah.length === 0, masalah);
  } finally {
    if (browser) await browser.close();
    child.kill();
  }
  // Tiada cache dan penjadual dimatikan: 503 jelas (bukan 404)
  const kosong = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kosong-')), 'tiada.json');
  const s2 = await mula({ CUACA_CACHE_FILE: kosong });
  try {
    const r = await fetch(s2.base + '/api/cuaca');
    const b = await r.json();
    ok(
      'tiada cache -> 503 dengan sedangDikemaskini',
      r.status === 503 && b.sedangDikemaskini === false,
      [r.status, b],
    );
  } finally {
    s2.child.kill();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: permulaan + CSP lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

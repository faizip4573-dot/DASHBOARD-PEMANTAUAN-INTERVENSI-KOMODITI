'use strict';
// Kad cuaca + amaran Pemantauan: nilai sebenar daripada /api/cuaca (distub), keadaan lapuk/ralat/file://, tiada dummy.
// Jalankan dari root: node tests/frontend/cuaca.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { buatFixture } = require('../helpers/cuaca-fixture.js');
const { pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cuaca-ui-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka(
    handler,
    { url = base + '/', tunggu = 'tile', jangkaRalatRangkaian = false } = {},
  ) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (!['error', 'warning'].includes(m.type())) return;
      if (jangkaRalatRangkaian && /Failed to load resource/.test(m.text())) return;
      masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    if (handler) await stubApi(page, { cuaca: handler });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    if (tunggu === 'tile')
      await page.waitForFunction(
        () => document.querySelectorAll('#weatherGrid .weather-card').length > 0,
        {
          timeout: 15000,
        },
      );
    else await sleep(1800);
    return { page, masalah };
  }
  const teks = (page, sel) => page.$eval(sel, (e) => e.innerText);

  try {
    // (i) data segar
    {
      const fx = buatFixture();
      const { page, masalah } = await buka(() => ({ body: fx }));
      const kad = await teks(page, '#weatherGrid');
      ok('(i) nilai MET: suhu min-maks', kad.includes('23–31°C'), kad);
      ok(
        '(i) nilai Open-Meteo: angin dan kelembapan',
        /10 km\/j/.test(kad) && kad.includes('85%'),
        kad,
      );
      ok(
        '(i) keadaan BM daripada MET',
        kad.includes('Hujan terpencil') || kad.includes('Tiada hujan'),
      );
      ok('(i) lencana risiko Tinggi untuk Kelantan', /Kelantan[\s\S]*Tinggi/.test(kad), kad);
      ok('(i) tiada lencana sumber pada pengepala', !(await page.$('#weatherTag')));
      ok('(i) dikemas kini', (await teks(page, '#weatherNote')).includes('Dikemas kini'));
      ok(
        '(i) atribusi Open-Meteo',
        (await teks(page, '#weatherAttrib')).includes('Open-Meteo.com (CC BY 4.0)'),
      );
      ok('(i) tiada banner lapuk', await page.$eval('#weatherStatus', (e) => e.hidden));
      const panelCuaca = await page.$$eval('.bottom-grid', (e) =>
        e.map((x) => x.innerText).join('\n'),
      );
      for (const x of [
        'Maklumat simulasi',
        'MET · Demo',
        'CONTOH',
        'Simulasi ·',
        'Bukan amaran sebenar',
      ])
        ok('(i) tiada teks "' + x + '" pada tiga kad cuaca', !panelCuaca.includes(x), x);
      ok(
        '(i) tiada DATA DUMMY pada tiga kad cuaca',
        !/DATA DUMMY/.test(panelCuaca),
        panelCuaca.slice(0, 80),
      );
      ok('(i) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      // amaran aktif
      const am = await teks(page, '#metAlertBody');
      ok(
        '(iii-b) amaran sebenar dipaparkan',
        am.includes('AMARAN RIBUT PETIR') && am.includes('MET Malaysia'),
        am,
      );
      ok('(iii-b) tiada lencana CONTOH', !(await teks(page, '.alert-head')).includes('CONTOH'));
      // Intervensi: risiko cuaca tinggi sebagai isyarat gangguan
      const dis = await page.evaluate(() => ({
        kelantan: IV_TEST.disruptionLevel('kelantan'),
        pahang: IV_TEST.disruptionLevel('pahang'),
        terengganu: IV_TEST.disruptionLevel('terengganu'),
      }));
      ok(
        '(v) Kelantan: cuaca tinggi -> Waspada (Open-Meteo/MET)',
        dis.kelantan &&
          dis.kelantan.level === 'Waspada' &&
          /Open-Meteo\/MET/.test(dis.kelantan.source),
        dis,
      );
      ok('(v) Terengganu (tiada senario hujan lebat) tidak ditanda', !dis.terengganu, dis);
      await page.close();
    }
    // amaran: tiada aktif / tiada dataset / gagal
    {
      let r = await buka(() => ({ body: buatFixture({ amaran: false }) }));
      const a1 = await teks(r.page, '#metAlertBody');
      ok(
        '(iii-b) tiada amaran dalam 7 hari',
        a1.includes('Tiada amaran rasmi dalam 7 hari lepas') && a1.includes('MET Malaysia'),
        a1,
      );
      await r.page.close();
      r = await buka(() => ({
        body: buatFixture({ amaran: false, metAmaranStatus: 'tiada_dataset' }),
      }));
      ok(
        '(iii-b) tiada dataset',
        (await teks(r.page, '#metAlertBody')).includes(
          'Amaran rasmi belum tersedia melalui API MET',
        ),
      );
      await r.page.close();
      r = await buka(() => ({ body: buatFixture({ amaran: false, metAmaranStatus: 'gagal' }) }));
      const a3 = await teks(r.page, '#metAlertBody');
      ok(
        '(iii-b) amaran gagal -> ralat + Cuba semula',
        a3.includes('tidak dapat dimuatkan') && a3.includes('Cuba semula'),
        a3,
      );
      await r.page.close();
    }
    // (ii) lapuk
    {
      const { page, masalah } = await buka(() => ({ body: buatFixture({ umurJam: 40 }) }));
      const b = await teks(page, '#weatherStatus');
      ok('(ii) banner Data lapuk', b.includes('Data lapuk'), b);
      ok('(ii) grid masih dipaparkan', (await page.$$('#weatherGrid .weather-card')).length > 0);
      ok('(ii) tiada ralat konsol', masalah.length === 0, masalah);
      await page.close();
    }
    // (iii) 503 -> ralat -> Cuba semula pulih
    {
      let mod = { status: 503 };
      const { page, masalah } = await buka(
        () => (mod.status === 503 ? mod : { body: buatFixture() }),
        {
          tunggu: 'statik',
          jangkaRalatRangkaian: true,
        },
      );
      const b = await teks(page, '#weatherStatus');
      ok(
        '(iii) banner ralat + Cuba semula',
        b.includes('tidak dapat dimuatkan') && b.includes('Cuba semula'),
        b,
      );
      ok(
        '(iii) tiada nombor dummy semasa ralat',
        (await page.$$('#weatherGrid .weather-card')).length === 0,
      );
      mod = { ok: true };
      await page.click('#weatherStatus [data-act="cuaca-retry"]');
      await page.waitForFunction(
        () => document.querySelectorAll('#weatherGrid .weather-card').length > 0,
        { timeout: 10000 },
      );
      ok('(iii) pulih selepas Cuba semula', true);
      ok(
        '(iii) tiada pageerror',
        masalah.every((m) => !m.startsWith('pageerror')),
        masalah,
      );
      await page.close();
    }
    // (iii-c) abort rangkaian
    {
      const { page, masalah } = await buka(() => 'abort', {
        tunggu: 'statik',
        jangkaRalatRangkaian: true,
      });
      ok(
        '(iii-c) ralat rangkaian -> banner',
        (await teks(page, '#weatherStatus')).includes('Cuba semula'),
      );
      ok(
        '(iii-c) tiada pageerror',
        masalah.every((m) => !m.startsWith('pageerror')),
        masalah,
      );
      await page.close();
    }
    // (iv) file://
    {
      const url = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');
      const { page, masalah } = await buka(null, {
        url,
        tunggu: 'statik',
        jangkaRalatRangkaian: true,
      });
      const b = await teks(page, '#weatherStatus');
      ok('(iv) file:// -> memerlukan pelayan', b.includes('memerlukan pelayan (npm start)'), b);
      const grid = await teks(page, '#weatherGrid');
      ok('(iv) tiada nombor dummy (29°C)', !grid.includes('29°C') && grid.trim() === '', grid);
      ok(
        '(iv) tiada pageerror',
        masalah.every((m) => !m.startsWith('pageerror')),
        masalah.filter((m) => m.startsWith('pageerror')),
      );
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian UI cuaca lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

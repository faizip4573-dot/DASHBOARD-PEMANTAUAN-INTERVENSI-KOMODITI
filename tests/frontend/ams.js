'use strict';
// AI Multi-Scenario Monitoring: senario dijana daripada data cuaca sebenar (/api/cuaca distub, deterministik).
// Jalankan dari root: node tests/frontend/ams.js
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
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ams-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka(handler, { url = base + '/', rangkaian = false } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (!['error', 'warning'].includes(m.type())) return;
      if (rangkaian && /Failed to load resource/.test(m.text())) return;
      masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    if (handler) await stubApi(page, { cuaca: handler });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await sleep(2000);
    return { page, masalah };
  }
  const teks = (page, sel) => page.$eval(sel, (e) => e.innerText);

  try {
    // (i) + (ii) senario daripada fixture
    {
      const fx = buatFixture();
      const { page, masalah } = await buka(() => ({ body: fx }));
      const kad = await page.$$eval('#amsList .ams-card', (e) =>
        e.map((x) => x.querySelector('.ams-card-title').textContent),
      );
      ok(
        '(i) bilangan kad = senario fixture',
        kad.length === fx.senario.length && kad.length === 3,
        kad,
      );
      ok(
        '(i) ID S01.. dan nama betul',
        kad.join('|') === fx.senario.map((s) => `${s.scenarioId} · ${s.scenarioName}`).join('|'),
        kad,
      );
      const kpi = await page.$$eval('#amsKpis .ams-kpi-v', (e) =>
        e.map((x) => Number(x.textContent)),
      );
      const st = await page.evaluate(() => DASHBOARD_TEST.scenarioStats());
      const semua = fx.senario.flatMap((s) => s.affectedPOIds);
      const unik = new Set(semua).size;
      const bertindih = [...new Set(semua)].filter(
        (id) => semua.filter((x) => x === id).length >= 2,
      ).length;
      ok('(i) KPI = fixture', kpi.join() === [fx.senario.length, unik, bertindih].join(), [
        kpi,
        unik,
        bertindih,
      ]);
      ok(
        '(i) KPI = scenarioStats()',
        kpi.join() === [st.scenarios, st.uniquePO, st.overlapPO].join(),
        [kpi, st],
      );
      ok('(i) tiada lencana DATA SEBENAR', !(await page.$('#amsBadge')));
      const panel = await teks(page, '#amsPanel');
      const tanpaHarga = panel.replace(/Data harga tidak tersedia \(dummy\)/g, '');
      ok('(i) panel tiada "dummy"', !/dummy/i.test(tanpaHarga), panel.slice(0, 200));
      ok(
        '(i) tiada banjir',
        !/amaran banjir/i.test(panel) && !fx.senario.some((s) => s.warningType === 'amaran_banjir'),
      );
      ok(
        '(i) nota banjir JPS',
        (await teks(page, '#amsFloodNote')).includes(
          'Risiko banjir: data sebenar JPS Malaysia / JPS Selangor',
        ) && !/belum disambungkan/.test(await teks(page, '#amsFloodNote')),
      );
      ok(
        '(i) nota senario',
        (await teks(page, '#amsNote')).includes('Dijana daripada data sebenar cuaca dan banjir'),
      );
      const fl = await page.evaluate(() => ({
        dis: document.getElementById('floodToggle').disabled,
        dot: document.querySelectorAll('.flood-dot').length,
        dum: typeof DATA.banjir + typeof DATA.cuaca,
      }));
      ok(
        '(i) #floodToggle aktif, tiada .flood-dot, DATA.cuaca/banjir dibuang',
        !fl.dis && fl.dot === 0 && fl.dum === 'undefinedundefined',
        fl,
      );

      // (ii) butiran -> PO -> laci -> kembali -> Escape
      await page.click('#amsList .ams-card');
      await sleep(500);
      ok('(ii) butiran terpapar', await page.$eval('#amsDetail', (e) => !e.hidden));
      ok(
        '(ii) chip bukan dummy',
        !(await teks(page, '#amsDetail')).includes('dummy') ||
          /harga/.test(await teks(page, '#amsDetail')),
      );
      await page.click('#amsDetail .ams-po-row');
      await sleep(400);
      ok('(ii) laci PO', !!(await page.$('#amsPoDrawer')));
      await page.keyboard.press('Escape');
      await page.focus('#amsDetail .ams-po-row').catch(() => {});
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.click('#amsDetail .ams-back').catch(() => {});
      await sleep(400);
      ok('(ii) kembali ke senarai', await page.$eval('#amsDetail', (e) => e.hidden));
      ok('(vii) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
    }
    // (iii) tiada senario
    {
      const { page } = await buka(() => ({ body: buatFixture({ tanpaSenario: true }) }));
      ok(
        '(iii) empty',
        (await teks(page, '#amsState')).includes('Tiada senario cuaca berisiko dikesan hari ini'),
      );
      await page.close();
    }
    // (iv) lapuk
    {
      const { page } = await buka(() => ({ body: buatFixture({ umurJam: 40 }) }));
      ok('(iv) banner lapuk', (await teks(page, '#amsState')).includes('Data cuaca lapuk'));
      ok('(iv) senario masih dipaparkan', (await page.$$('#amsList .ams-card')).length === 3);
      await page.close();
    }
    // (v) 503 -> Cuba semula
    {
      let pulih = false;
      const { page } = await buka(() => (pulih ? { body: buatFixture() } : { status: 503 }), {
        rangkaian: true,
      });
      const s = await teks(page, '#amsState');
      ok(
        '(v) ralat + Cuba semula',
        s.includes('tidak dapat dijana') && s.includes('Cuba semula'),
        s,
      );
      ok('(v) tiada lencana TIADA DATA', !(await page.$('#amsBadge')));
      pulih = true;
      await page.click('#amsState [data-act="cuaca-retry"]');
      await page.waitForFunction(
        () => document.querySelectorAll('#amsList .ams-card').length === 3,
        { timeout: 10000 },
      );
      ok('(v) pulih', true);
      await page.close();
    }
    // (vi) file://
    {
      const url = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');
      const { page } = await buka(null, { url, rangkaian: true });
      ok(
        '(vi) file:// mesej',
        (await teks(page, '#amsState')).includes('memerlukan pelayan (npm start)'),
      );
      ok('(vi) tiada senario', (await page.$$('#amsList .ams-card')).length === 0);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian AMS lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

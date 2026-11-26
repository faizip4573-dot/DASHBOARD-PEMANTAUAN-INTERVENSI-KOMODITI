'use strict';
// Bar penapis tab Intervensi: penjajaran, tiada limpahan, lencana penapis aktif, ID asal.
// Jalankan dari root: node tests/frontend/filter-bar.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['ivFKomoditi', 'ivFVarieti', 'ivFNegeri', 'ivFPO', 'ivFDaerah', 'ivFRisiko'];

(async () => {
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'filter-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  try {
    for (const tema of ['gelap', 'cerah']) {
      for (const w of [1440, 1024, 390]) {
        const page = await browser.newPage();
        const masalah = [];
        page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
        page.on('console', (m) => {
          if (['error', 'warning'].includes(m.type()))
            masalah.push(`console.${m.type()}: ${m.text()}`);
        });
        await page.evaluateOnNewDocument((t) => {
          try {
            localStorage.setItem('fama_tema', t);
          } catch {
            /* abaikan */
          }
        }, tema);
        await page.setViewport({ width: w, height: 900 });
        await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
        await page.click('#ivTabIv');
        await sleep(1200);
        const tag = `[${tema} ${w}] `;
        if (w <= 539) {
          await page.click('#ivFilterToggle');
          await sleep(300);
        }
        const ada = await page.evaluate(
          (ids) =>
            ids
              .concat(['ivReset', 'ivResetBadge', 'ivFilters'])
              .map((i) => !!document.getElementById(i)),
          IDS,
        );
        ok(tag + 'semua ID asal wujud', ada.every(Boolean), ada);
        const kotak = await page.evaluate(
          (ids) =>
            ids.concat(['ivReset']).map((i) => {
              const r = document.getElementById(i).getBoundingClientRect();
              return {
                i,
                top: Math.round(r.top * 10) / 10,
                h: Math.round(r.height * 10) / 10,
                w: r.width,
              };
            }),
          IDS,
        );
        if (w === 1440) {
          const t0 = kotak[0].top;
          const h0 = kotak[0].h;
          ok(
            tag + 'top sama (±1px)',
            kotak.every((k) => Math.abs(k.top - t0) <= 1),
            kotak,
          );
          ok(
            tag + 'tinggi sama (±1px)',
            kotak.every((k) => Math.abs(k.h - h0) <= 1),
            kotak,
          );
          ok(tag + 'tinggi >= 40', h0 >= 40, h0);
        }
        const lim = await page.evaluate(() => {
          const f = document.getElementById('ivFilters');
          return {
            doc: document.documentElement.scrollWidth <= window.innerWidth,
            bar: f.scrollWidth <= f.clientWidth + 1,
          };
        });
        ok(tag + 'tiada limpahan halaman', lim.doc, lim);
        ok(tag + 'bar tidak melimpah', lim.bar, lim);
        const tempoh = await page.evaluate(() => ({
          sel: !!document.getElementById('ivFTempoh'),
          teks: /Tempoh Analisis/.test(document.getElementById('ivFilters').textContent),
        }));
        ok(tag + 'penapis Tarikh / Tempoh Analisis dibuang', !tempoh.sel && !tempoh.teks, tempoh);
        ok(tag + 'tiada <small> bantuan', !(await page.$('#ivFilters small')));
        const lbl = await page.$eval('#ivFilters label', (e) => {
          const s = getComputedStyle(e);
          return { size: s.fontSize, weight: s.fontWeight };
        });
        ok(tag + 'label 12px semibold', lbl.size === '12px' && Number(lbl.weight) >= 600, lbl);

        if (w === 1440 || w === 390) {
          // lencana penapis aktif + reset
          const idle0 = await page.$eval('#ivReset', (e) => e.dataset.idle);
          ok(tag + 'idle bila tiada penapis', idle0 === 'true', idle0);
          ok(tag + 'badge tersembunyi awal', await page.$eval('#ivResetBadge', (e) => e.hidden));
          const val = await page.$eval('#ivFKomoditi', (e) => e.options[1] && e.options[1].value);
          await page.select('#ivFKomoditi', val);
          await sleep(500);
          const b1 = await page.$eval('#ivResetBadge', (e) => ({ h: e.hidden, t: e.textContent }));
          ok(tag + 'badge "1" selepas pilih', !b1.h && b1.t === '1', b1);
          ok(
            tag + 'butang aktif (bukan idle)',
            (await page.$eval('#ivReset', (e) => e.dataset.idle)) === 'false',
          );
          await page.click('#ivReset');
          await sleep(500);
          const b2 = await page.evaluate(() => ({
            h: document.getElementById('ivResetBadge').hidden,
            v: document.getElementById('ivFKomoditi').value,
          }));
          ok(tag + 'reset: badge hilang + nilai lalai', b2.h && b2.v === 'all', b2);
        }
        if (tema === 'gelap' || w === 1440) {
          // tangkapan skrin klip (hanya elemen bar penapis)
          const el = await page.$('#ivFilters');
          const dir = process.env.CUACA_SHOT_DIR;
          if (dir && el) {
            fs.mkdirSync(dir, { recursive: true });
            await el.screenshot({ path: path.join(dir, `filter-${tema}-${w}.png`) });
          }
        }
        ok(tag + 'tiada ralat konsol', masalah.length === 0, masalah);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian bar penapis lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

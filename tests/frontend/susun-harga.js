'use strict';
// Susun atur tab Pemantauan: empat panel harga sebaris di bawah peta, ruang kosong di kanan peta.
// Jalankan dari root: node tests/frontend/susun-harga.js
// SUSUN_SHOTS=<folder> menyimpan tangkapan skrin bahagian (dipotong, maks 1600x1600).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
require('../helpers/banjir-fixture.js').pasangSemuaCache();
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);

const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = process.env.SUSUN_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gagal = [];
const ok = (nama, cond, info) => {
  if (!cond)
    gagal.push(nama + (info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 400) : ''));
};
const ID = ['lowestPrices', 'highestPrices', 'compareBody', 'priceChart'];

function ukur() {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };
  const panel = (id) => box(document.getElementById(id).closest('.panel'));
  const kosong = document.getElementById('petaKananKosong');
  return {
    panel: ['lowestPrices', 'highestPrices', 'compareBody', 'priceChart'].map(panel),
    peta: box(document.querySelector('.map-panel')),
    kosong: kosong && getComputedStyle(kosong).display !== 'none' ? box(kosong) : null,
    lebar: document.documentElement.clientWidth,
    skrol: document.documentElement.scrollWidth,
    baris: document.querySelectorAll('#lowestPrices .price-row').length,
    tinggiBaris: [...document.querySelectorAll('#lowestPrices .price-row')].map(
      (e) => e.getBoundingClientRect().height,
    ),
    mapCanvas: (() => {
      const c = document.querySelector('#map canvas');
      return c ? [c.clientWidth, c.clientHeight, document.getElementById('map').clientWidth] : null;
    })(),
  };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'susun-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const konsol = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => konsol.push('pageerror: ' + e.message));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2000);
    // Chart memerlukan komoditi dipilih supaya ada kandungan sebenar.
    await page.evaluate(() => {
      const s = document.getElementById('filterCommodity');
      if (s.options.length > 1) {
        s.value = s.options[1].value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await sleep(800);

    for (const tema of ['gelap', 'cerah']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
      for (const [w, h] of [
        [1440, 900],
        [1280, 800],
        [1024, 800],
        [390, 800],
      ]) {
        await page.setViewport({ width: w, height: h });
        await sleep(600);
        const m = await page.evaluate(ukur);
        const T = `${tema} ${w}`;
        ok(`${T} tiada limpahan mendatar`, m.skrol <= m.lebar, [m.skrol, m.lebar]);
        ok(`${T} empat panel ada`, m.panel.every((p) => p.w > 0 && p.h > 0), m.panel);
        const [a, b, c, d] = m.panel;
        ok(`${T} semua panel di bawah peta`, m.panel.every((p) => p.y >= m.peta.b - 1), [
          m.peta.b,
          m.panel.map((p) => p.y),
        ]);
        if (w >= 1400) {
          ok(`${T} sebaris (top ±2)`, m.panel.every((p) => Math.abs(p.y - a.y) <= 2), m.panel);
          ok(`${T} tinggi sama (±2)`, m.panel.every((p) => Math.abs(p.h - a.h) <= 2), m.panel);
          ok(`${T} turutan kiri ke kanan`, a.x < b.x && b.x < c.x && c.x < d.x, m.panel);
          ok(`${T} tinggi 380-440`, a.h >= 380 && a.h <= 440, a.h);
          ok(`${T} ruang kosong ada di kanan peta`, !!m.kosong && m.kosong.x >= m.peta.r - 1, [
            m.kosong,
            m.peta,
          ]);
          ok(`${T} tinggi ruang kosong = peta`, !!m.kosong && Math.abs(m.kosong.h - m.peta.h) <= 2, [
            m.kosong,
            m.peta.h,
          ]);
          ok(`${T} peta tidak melebar ke ruang kosong`, m.peta.r < m.lebar - 300, m.peta);
          ok(`${T} baris senarai padat`, m.tinggiBaris.every((x) => x >= 44 && x <= 60), m.tinggiBaris);
        } else if (w >= 768) {
          ok(`${T} 2 sebaris`, Math.abs(a.y - b.y) <= 2 && Math.abs(c.y - d.y) <= 2, m.panel);
          ok(`${T} baris kedua di bawah`, c.y > a.b - 1, m.panel);
          ok(`${T} turutan`, a.x < b.x && c.x < d.x, m.panel);
          ok(
            `${T} lajur kanan peta turun ke bawah peta (EWS), bukan di kanan`,
            !!m.kosong && m.kosong.y >= m.peta.b - 1 && m.kosong.b <= a.y + 1,
            [m.kosong, m.peta.b, a.y],
          );
          ok(`${T} peta lebar penuh`, m.peta.w > m.lebar * 0.85, m.peta.w);
        } else {
          ok(`${T} bertindan`, a.b <= b.y + 1 && b.b <= c.y + 1 && c.b <= d.y + 1, m.panel);
          ok(`${T} lebar penuh`, m.panel.every((p) => p.w > m.lebar * 0.85), m.panel);
        }
        if (m.mapCanvas)
          ok(`${T} kanvas peta sepadan bekas`, Math.abs(m.mapCanvas[0] - m.mapCanvas[2]) <= 2, m.mapCanvas);
        if (SHOTS && (w === 1440 || w === 1024)) {
          fs.mkdirSync(SHOTS, { recursive: true });
          const klip = await page.evaluate(() => {
            const a = document.querySelector('.main-grid').getBoundingClientRect();
            const b = document.querySelector('.susun-harga').getBoundingClientRect();
            return {
              x: Math.max(0, Math.floor(a.left)),
              y: Math.floor(a.top + scrollY),
              width: Math.min(1600, Math.ceil(a.width)),
              height: Math.min(1600, Math.ceil(b.bottom - a.top)),
            };
          });
          await page.screenshot({
            path: path.join(SHOTS, `susun-${tema}-${w}.png`),
            clip: klip,
            captureBeyondViewport: true,
          });
        }
      }
    }

    // Kawalan masih berfungsi
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(400);
    const fungsi = await page.evaluate(async () => {
      const lo = document.getElementById('lowStage');
      const hi = document.getElementById('highStage');
      lo.value = 'Borong';
      lo.dispatchEvent(new Event('change', { bubbles: true }));
      hi.value = 'Runcit';
      hi.dispatchEvent(new Event('change', { bubbles: true }));
      // Fixture harga: "Bermasalah sahaja" menyisakan kurang 5 baris Runcit; guna semua komoditi.
      const mod = document.getElementById('filterIssue');
      mod.value = 'false';
      mod.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return {
        low: document.querySelectorAll('#lowestPrices .price-row').length,
        high: document.querySelectorAll('#highestPrices .price-row').length,
        cmp: document.querySelectorAll('#compareBody tr').length,
        chart: document.getElementById('priceChart').children.length,
      };
    });
    ok('senarai terendah 5 baris', fungsi.low === 5, fungsi);
    ok('senarai tertinggi 5 baris', fungsi.high === 5, fungsi);
    ok('jadual banding ada baris', fungsi.cmp > 0, fungsi);
    ok('carta dirender', fungsi.chart > 0, fungsi);
    ok('tiada ralat halaman', konsol.length === 0, konsol);
  } finally {
    await browser.close();
    server.close();
  }
  if (gagal.length) {
    console.error('GAGAL (' + gagal.length + '):\n- ' + gagal.join('\n- '));
    process.exit(1);
  }
  console.log('susun-harga: semua semakan lulus');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

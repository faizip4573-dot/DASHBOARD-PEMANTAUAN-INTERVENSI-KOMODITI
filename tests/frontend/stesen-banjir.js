'use strict';
// Kad 'Stesen Banjir JPS' (Pemantauan): kiraan ikut tahap, susunan, klik baris -> peta + pop-up, keadaan kosong,
// ralat/lapuk/file://, susun atur 4 kad sebaris (1440/1024/390), overflow dan kontras. API distub.
// Jalankan dari root: node tests/frontend/stesen-banjir.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { buatFixture } = require('../helpers/cuaca-fixture.js');
const { buatFixtureBanjir, pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const min = (n) => new Date(Date.now() - n * 6e4).toISOString();

// Fixture dengan stesen pelbagai tahap: [tahap, trend, minit lepas, nama]
const RANCANGAN = [
  ['Waspada', 'Tetap', 10, 'UJI Waspada Tetap'],
  ['Amaran', 'Surut', 20, 'UJI Amaran Surut'],
  ['Waspada', 'Naik', 30, 'UJI Waspada Naik'],
  ['Bahaya', 'Surut', 40, 'UJI Bahaya Surut'],
  ['Amaran', 'Naik', 50, 'UJI Amaran Naik'],
  ['Bahaya', 'Naik', 60, 'UJI Bahaya Naik'],
];
const JANGKAAN = [
  'UJI Bahaya Naik',
  'UJI Bahaya Surut',
  'UJI Amaran Naik',
  'UJI Amaran Surut',
  'UJI Waspada Naik',
  'UJI Waspada Tetap',
];
function fixtureBercampur() {
  const d = buatFixtureBanjir();
  d.stesen.forEach((s) => {
    if (s.parasAir != null) s.statusRasmi = 'Normal';
  });
  const sah = d.stesen.filter((s) => s.parasAir != null && Number.isFinite(s.lat));
  RANCANGAN.forEach(([tahap, trend, minit, nama], i) => {
    Object.assign(sah[i], { statusRasmi: tahap, trend, masaBacaan: min(minit), nama });
    sah[i].parasAir = 3 + i / 10;
  });
  d.po[0].risikoBanjir = 'Tinggi';
  d._sah = sah.length;
  return d;
}

(async () => {
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'stesen-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  const requestIPU = [];
  async function buka(banjir, { url = base + '/', rangkaian = false, lebar = 1440 } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: 900 });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (!['error', 'warning'].includes(m.type())) return;
      if (rangkaian && /Failed to load resource/.test(m.text())) return;
      masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('request', (r) => {
      if (/kualiti-udara/.test(r.url())) requestIPU.push(r.url());
    });
    await stubApi(page, { cuaca: buatFixture(), banjir });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await sleep(2200);
    return { page, masalah };
  }
  const teks = (page, sel) => page.$eval(sel, (e) => e.innerText);
  const baris = (page) =>
    page.$$eval('#floodList .bj-row', (e) =>
      e.map((x) => ({
        nama: x.querySelector('.bj-nama').textContent,
        tahap: x.dataset.tahap,
        teks: x.innerText,
      })),
    );

  try {
    // (i) kiraan, susunan, kandungan baris, nota PO, atribusi
    {
      const fx = fixtureBercampur();
      const { page, masalah } = await buka(fx);
      const b = await baris(page);
      ok(
        '(i) susunan Bahaya > Amaran > Waspada, naik dahulu',
        JSON.stringify(b.map((x) => x.nama)) === JSON.stringify(JANGKAAN),
        b.map((x) => x.nama),
      );
      const ring = await page.$$eval('#floodSummary .bj-chip', (e) =>
        Object.fromEntries(
          e.map((x) => [x.dataset.tahap, Number(x.querySelector('b').textContent)]),
        ),
      );
      ok(
        '(i) kiraan ikut tahap',
        ring.Bahaya === 2 && ring.Amaran === 2 && ring.Waspada === 2 && ring.Normal === fx._sah - 6,
        ring,
      );
      ok(
        '(i) tiada lencana JPS · Sebenar',
        !(await page.$('#floodTag')) && !/JPS · Sebenar/.test(await teks(page, '#floodPanel')),
      );
      ok('(i) Dikemas kini', (await teks(page, '#floodNote')).includes('Dikemas kini'));
      ok(
        '(i) baris: paras, trend BM, masa MYT, tahap',
        /\d\.\d\d m/.test(b[0].teks) &&
          /naik/.test(b[0].teks) &&
          /turun/.test(b[1].teks) &&
          /tiada perubahan/.test(b[5].teks) &&
          /MYT/.test(b[0].teks) &&
          /Bahaya/.test(b[0].teks),
        [b[0].teks, b[1].teks, b[5].teks],
      );
      const po = await teks(page, '#floodPoNote');
      ok('(i) nota PO berisiko Tinggi', po.includes('Tinggi') && po.includes(fx.po[0].nama), po);
      ok(
        '(i) atribusi',
        (await teks(page, '#floodAttrib')).includes(
          'Sumber: JPS Malaysia (Public Info Banjir) · JPS Selangor',
        ),
      );
      ok(
        '(i) tiada kad IPU',
        !(await page.$('#ipuPanel')) && !/Kualiti Udara/.test(await page.content()),
      );
      ok('(i) /api/kualiti-udara tidak dimuat', requestIPU.length === 0, requestIPU);
      ok('(i) tiada ralat konsol/CSP', masalah.length === 0, masalah);

      // klik baris: peta terbang + pop-up
      const sasaran = fx.stesen.find((s) => s.nama === 'UJI Bahaya Naik');
      await page.click('#floodList .bj-row');
      await sleep(2500);
      const hasil = await page.evaluate(() => {
        const c = map.getCenter();
        return {
          lng: c.lng,
          lat: c.lat,
          popup: (document.querySelector('.banjir-popup') || {}).innerText || '',
        };
      });
      ok(
        'klik baris: peta dipusatkan pada stesen',
        Math.abs(hasil.lng - sasaran.lon) < 0.05 && Math.abs(hasil.lat - sasaran.lat) < 0.05,
        [hasil, sasaran.lon, sasaran.lat],
      );
      ok('klik baris: pop-up stesen dibuka', hasil.popup.includes('UJI Bahaya Naik'), hasil.popup);
      // lapisan dimatikan -> klik hidupkan semula
      await page.click('#floodToggle');
      ok(
        'lapisan dimatikan',
        (await page.$eval('#floodToggle', (e) => e.getAttribute('aria-pressed'))) === 'false',
      );
      await page.click('#floodList .bj-row:nth-child(2)');
      await sleep(1500);
      ok(
        'klik baris menghidupkan lapisan banjir',
        (await page.$eval('#floodToggle', (e) => e.getAttribute('aria-pressed'))) === 'true',
      );
      await page.close();
    }
    // (ii) kosong
    {
      const fx = buatFixtureBanjir();
      const { page } = await buka(fx);
      const sah = fx.stesen.filter((s) => s.statusRasmi && s.parasAir != null).length;
      const t = await teks(page, '#floodList');
      ok(
        '(ii) keadaan kosong',
        t.includes('Tiada stesen pada tahap Waspada, Amaran atau Bahaya sekarang') &&
          t.includes(sah + ' stesen sah'),
        [t, sah],
      );
      ok('(ii) tiada baris', (await page.$$('#floodList .bj-row')).length === 0);
      await page.close();
    }
    // (iii) 503 -> ralat + Cuba semula pulih
    {
      let n = 0;
      const fx = fixtureBercampur();
      const { page } = await buka(() => (n++ === 0 ? { status: 500 } : fx), { rangkaian: true });
      const b = await teks(page, '#floodStatus');
      ok('(iii) ralat + Cuba semula', /tidak dapat dimuatkan/.test(b) && /Cuba semula/.test(b), b);
      ok('(iii) tiada baris', (await page.$$('#floodList .bj-row')).length === 0);
      await page.click('#floodStatus [data-act="banjir-retry"]');
      await sleep(1500);
      ok('(iii) pulih', (await page.$$('#floodList .bj-row')).length === 6);
      await page.close();
    }
    // (iv) lapuk
    {
      const { page } = await buka(() => {
        const d = fixtureBercampur();
        d.fetchedAt = new Date(Date.now() - 5 * 36e5).toISOString();
        return d;
      });
      const b = await teks(page, '#floodStatus');
      ok('(iv) banner lapuk', /Data lapuk/.test(b), b);
      ok('(iv) tiada baris lapuk', (await page.$$('#floodList .bj-row')).length === 0);
      await page.close();
    }
    // (iv-b) satu sumber gagal: tiada banner, data kekal, nota senyap pada pengaki
    {
      const fx = fixtureBercampur();
      fx.sumber.jpsSelangor = { status: 'gagal', mesej: 'ujian', diambil: fx.fetchedAt };
      const { page } = await buka(fx);
      ok('(iv-b) tiada banner separa gagal', await page.$eval('#floodStatus', (e) => e.hidden));
      ok('(iv-b) data kekal', (await page.$$('#floodList .bj-row')).length === 6);
      const f = await teks(page, '#floodAttrib');
      ok('(iv-b) nota pengaki', f.includes('JPS Selangor: data terakhir'), f);
      ok(
        '(iv-b) tiada teks banner lama',
        !/Sumber tidak dapat dikemas kini/.test(await teks(page, '#floodPanel')),
      );
      await page.close();
    }
    // (v) file://
    {
      const { page } = await buka(undefined, {
        url: 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/'),
        rangkaian: true,
      });
      ok(
        '(v) file:// memerlukan pelayan',
        (await teks(page, '#floodStatus')).includes('memerlukan pelayan (npm start)'),
      );
      await page.close();
    }
    // (vi) susun atur
    for (const [lebar, mod] of [
      [1440, 4],
      [1280, 2],
      [1024, 2],
      [390, 1],
    ]) {
      const { page } = await buka(fixtureBercampur(), { lebar });
      const m = await page.evaluate(() => {
        const k = [...document.querySelectorAll('.bottom-grid > .panel')].map((e) => {
          const r = e.getBoundingClientRect();
          return { t: Math.round(r.top + scrollY), l: r.left, h: r.height, w: r.width, r: r.right };
        });
        return {
          k,
          sw: document.documentElement.scrollWidth,
          iw: innerWidth,
          luar: [...document.querySelectorAll('.bottom-grid *')].filter((e) => {
            const g = e.closest('.panel');
            if (!g) return false;
            const a = e.getBoundingClientRect();
            const p = g.getBoundingClientRect();
            return a.width > 0 && !e.closest('[hidden]') && a.right > p.right + 1;
          }).length,
        };
      });
      ok(`(vi) ${lebar}: 4 kad`, m.k.length === 4, m.k.length);
      const tops = new Set(m.k.map((x) => x.t));
      const sebaris = m.k.filter((x) => Math.abs(x.t - m.k[0].t) <= 2).length;
      ok(`(vi) ${lebar}: ${mod} kad sebaris`, sebaris === mod, m.k);
      if (mod === 4) {
        ok(
          '(vi) 1440: tinggi sama (±2px)',
          m.k.every((x) => Math.abs(x.h - m.k[0].h) <= 2),
          m.k,
        );
        ok(
          '(vi) 1440: sebelah-menyebelah',
          m.k.every((x, i) => i === 0 || x.l >= m.k[i - 1].r - 1),
          m.k,
        );
      }
      if (mod === 2)
        ok(
          `(vi) ${lebar}: tinggi sama`,
          m.k.every((x) => Math.abs(x.h - m.k[0].h) <= 2),
          m.k,
        );
      if (mod === 1)
        ok(
          '(vi) 390: bertindan',
          tops.size === 4 && m.k.every((x) => Math.abs(x.w - m.k[0].w) <= 2),
          m.k,
        );
      ok(`(vi) ${lebar}: tiada overflow mendatar`, m.sw <= m.iw, [m.sw, m.iw]);
      ok(`(vi) ${lebar}: kandungan dalam sempadan kad`, m.luar === 0, m.luar);
      await page.close();
    }
    // (vii) kontras teks kedua-dua tema
    for (const tema of ['gelap', 'cerah']) {
      const { page } = await buka(fixtureBercampur());
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
      await sleep(300);
      const rendah = await page.evaluate(() => {
        const rgb = (s) =>
          s
            .match(/[\d.]+/g)
            .slice(0, 4)
            .map(Number);
        const lum = ([r, g, b]) => {
          const f = (v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const latar = (e) => {
          for (let x = e; x; x = x.parentElement) {
            const c = rgb(getComputedStyle(x).backgroundColor);
            if (c.length < 4 || c[3] > 0.9) {
              if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) return c;
            }
            if (c.length === 4 && c[3] === 0) continue;
          }
          return rgb(getComputedStyle(document.body).backgroundColor);
        };
        const buruk = [];
        document
          .querySelectorAll(
            '#floodPanel .bj-nama, #floodPanel .bj-lok, #floodPanel .bj-paras, #floodPanel .bj-trend, #floodPanel .bj-masa, #floodPanel .bj-chip, #floodPanel .bj-ponote, #floodPanel .weather-attrib, #floodNote, .bottom-grid .weather-sub, .bottom-grid .alert-item p',
          )
          .forEach((e) => {
            if (!e.offsetParent) return;
            const a = lum(rgb(getComputedStyle(e).color));
            const b = lum(latar(e));
            const n = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            if (n < 4.5) buruk.push([e.className || e.id, n.toFixed(2)]);
          });
        return buruk;
      });
      ok(`(vii) kontras >= 4.5 tema ${tema}`, rendah.length === 0, rendah.slice(0, 6));
      await page.close();
    }
  } catch (e) {
    gagal.push('pengecualian: ' + (e && e.stack ? e.stack : e));
  }
  await browser.close();
  server.close();
  if (gagal.length) {
    console.error('GAGAL:\n - ' + gagal.join('\n - '));
    process.exit(1);
  }
  console.log(
    'OK: kad Stesen Banjir JPS (kiraan, susunan, klik peta, kosong, ralat, susun atur, kontras)',
  );
})();

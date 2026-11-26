'use strict';
// Label PO pada peta Pemantauan (paparan kebangsaan): 15 label nama penuh, tiada bertindih, tidak menutup titik PO,
// di atas penanda amaran/sentimen, pop-up kekal di atas label. Diuji gelap + cerah pada 1440 dan 1024.
// LABEL_SHOTS=<folder> menyimpan tangkapan skrin peta. Jalankan: node --no-warnings tests/frontend/label-po.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { buatFixture } = require('../helpers/cuaca-fixture.js');
const { buatFixtureBanjir, pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const { buatFixtureMuse, pasangCacheMuse, julat } = require('../helpers/muse-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.LABEL_SHOTS || '';
const hariIni = (n) => new Date(Date.now() + 8 * 36e5 - n * 864e5).toISOString().slice(0, 10);
const jam = (ms) => new Date(Date.now() + ms * 36e5).toISOString();
const NAMA = [
  'Kangar',
  'Alor Setar',
  'Perai',
  'Simpang Pulai',
  'Selayang',
  'Dengkil',
  'Seremban',
  'Ayer Keroh',
  'Johor Baharu',
  'Simpang Renggam',
  'Kota Baharu',
  'Kuala Terengganu',
  'Kuantan',
  'Kota Kinabalu',
  'Samarahan',
].sort();
const met = (tajuk, teks, negeri) => ({
  jenis: 'x',
  tajuk,
  teks,
  negeri,
  dikeluarkan: jam(-1),
  sah_dari: jam(-1),
  sah_hingga: jam(8),
  aktif: true,
});
function fixtureCuaca() {
  const c = buatFixture();
  c.amaran = [
    met('AMARAN HUJAN LEBAT', 'Hujan lebat di beberapa negeri.', [
      'Johor',
      'Melaka',
      'Selangor',
      'Perak',
      'Kedah',
      'Pulau Pinang',
      'Pahang',
    ]),
  ];
  return c;
}

(async () => {
  pasangSemuaCache();
  pasangCacheMuse(buatFixtureMuse({ hari: julat(hariIni(7), hariIni(0)) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const nyata = await (await fetch(base + '/api/muse')).json();
  const stub = JSON.parse(JSON.stringify(nyata));
  const asas = nyata.rekod[nyata.rekod.length - 1];
  stub.rekod = [
    ['tembikai', 'Tembikai', 'Merah', [{ negeri: 'Melaka', daerah: null }]],
    ['terung', 'Terung', 'Kuning', [{ negeri: 'Johor', daerah: 'Kulai' }]],
  ].map(([id, label, band, lokasi], i) => ({
    ...asas,
    id: 9100 + i,
    kunci: `${nyata.latestDate}|${id}`,
    tarikh: nyata.latestDate,
    komoditiId: id,
    komoditiLabel: label,
    nota: `${label}: nota ujian; lokasi disebut.`,
    band,
    risikoSemasa: 70,
    risikoSebelum: 60,
    indeksSentimen: -20,
    bilSampel: 20,
    lokasi: lokasi.map((l) => ({ ...l, jenis: 'disebut', poId: null })),
  }));
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'label-po-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka(tema, lebar) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: 1300 });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument((t) => {
      try {
        localStorage.setItem('fama_tema', t);
      } catch {
        /* abaikan */
      }
    }, tema);
    await stubApi(page, {
      cuaca: fixtureCuaca(),
      banjir: buatFixtureBanjir(),
      metmy: {
        versi: 1,
        fetchedAt: new Date().toISOString(),
        sumber: { status: 'ok' },
        amaran: [],
      },
      muse: stub,
    });
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
      () =>
        window.DASHBOARD_TEST &&
        DASHBOARD_TEST.peta().gayaDimuat &&
        window.famaAmaranRasmi &&
        famaAmaranRasmi().senarai.length === 1 &&
        window.FamaAmaranPeta &&
        FamaAmaranPeta.ujian().kumpulan.length >= 1 &&
        DASHBOARD_TEST.ewsState().muse === 'ready' &&
        document.querySelectorAll('.sent-marker').length > 0 &&
        document.querySelectorAll('.po-marker .po-label').length === 15,
      { timeout: 30000 },
    );
    await page.evaluate(() =>
      document.getElementById('map').scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    await sleep(1500);
    return { page, masalah };
  }
  const ukur = (page) =>
    page.evaluate(() => {
      const kotak = (e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left, y: r.top, r: r.right, b: r.bottom };
      };
      return [...document.querySelectorAll('#map .po-marker')].map((m) => {
        const l = m.querySelector('.po-label');
        const c = kotak(m.querySelector('.core'));
        const lb = kotak(l);
        const cx = (lb.x + lb.r) / 2;
        const cy = (lb.y + lb.b) / 2;
        // label tidak menerima tetikus (kekalkan hover PO); dihidupkan sekejap untuk menguji susunan tindan
        l.style.pointerEvents = 'auto';
        const e = document.elementFromPoint(cx, cy);
        l.style.pointerEvents = '';
        return {
          nama: l.textContent,
          lb,
          core: c,
          atas: e === l,
          kena: e && (e.className || e.tagName),
          z: getComputedStyle(l).zIndex,
          bg: getComputedStyle(l).backgroundColor,
        };
      });
    });
  const silang = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

  try {
    for (const lebar of [1440, 1024]) {
      for (const tema of ['gelap', 'cerah']) {
        const T = `[${tema} ${lebar}] `;
        const { page, masalah } = await buka(tema, lebar);
        const L = await ukur(page);
        ok(
          `${T}15 label nama penuh PO`,
          JSON.stringify(L.map((x) => x.nama).sort()) === JSON.stringify(NAMA),
          L.map((x) => x.nama),
        );
        const bertindih = [];
        for (let i = 0; i < L.length; i++)
          for (let j = i + 1; j < L.length; j++)
            if (silang(L[i].lb, L[j].lb)) bertindih.push([L[i].nama, L[j].nama]);
        ok(`${T}label tidak bertindih sesama sendiri`, bertindih.length === 0, bertindih);
        const tutup = [];
        L.forEach((a) =>
          L.forEach((b) => {
            if (silang(a.lb, b.core)) tutup.push([a.nama, 'menutup titik', b.nama]);
          }),
        );
        ok(`${T}label tidak menutup titik PO`, tutup.length === 0, tutup);
        ok(
          `${T}elementFromPoint di tengah label ialah label`,
          L.every((x) => x.atas),
          L.filter((x) => !x.atas).map((x) => [x.nama, x.kena]),
        );
        ok(
          `${T}label berlatar pekat`,
          L.every((x) => /^rgb\(/.test(x.bg) && Number(x.z) >= 5),
          L[0],
        );
        // pop-up klik di atas label
        await page.evaluate(() => {
          const l = document.querySelector('#map .po-marker .po-label');
          const r = l.getBoundingClientRect();
          const m = map.getContainer().getBoundingClientRect();
          new maplibregl.Popup({ closeOnClick: false, maxWidth: '260px' })
            .setLngLat(map.unproject([r.left + r.width / 2 - m.left, r.top - m.top]))
            .setHTML('<div class="ujian-popup" style="width:240px;height:120px">Pop-up ujian</div>')
            .addTo(map);
        });
        await sleep(300);
        const pop = await page.evaluate(() => {
          const pp = document.querySelector('.maplibregl-popup:not(.po-hover-popup)');
          const r = pp.getBoundingClientRect();
          const salah = [];
          for (const fx of [0.15, 0.5, 0.85])
            for (const fy of [0.2, 0.5, 0.8]) {
              const e = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
              if (!e || !pp.contains(e)) salah.push(e && e.className);
            }
          return salah;
        });
        ok(`${T}pop-up kekal di atas label`, pop.length === 0, pop);
        ok(`${T}tiada ralat halaman`, masalah.length === 0, masalah);
        if (SHOTS) {
          fs.mkdirSync(SHOTS, { recursive: true });
          await page.evaluate(() =>
            document.querySelectorAll('.maplibregl-popup').forEach((e) => e.remove()),
          );
          await sleep(200);
          const b = await (await page.$('#map')).boundingBox();
          const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
          await page.screenshot({
            path: path.join(SHOTS, `label-po-${tema}-${lebar}.png`),
            clip: {
              x: Math.max(0, b.x) + sc.x,
              y: Math.max(0, b.y) + sc.y,
              width: Math.min(b.width, 1500),
              height: Math.min(b.height, 800),
            },
          });
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: 15 label PO nama penuh, boleh dibaca, tidak bertindih');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

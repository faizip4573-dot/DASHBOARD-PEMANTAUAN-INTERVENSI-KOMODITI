'use strict';
// Lapisan cuaca pada peta utama (10 lapisan Malay, garis masa, mod ramalan/imbasan, zarah, pemeriksa titik, tukar peta asas,
// reka letak 390/800/820/1440, keadaan ralat, tiada iframe radar luar). Grid ialah fixture sintetik melalui pelayan sebenar;
// radar/satelit/siklon distub; tile = PNG 1x1. Tangkapan skrin: CUACA_SHOTS=<folder> (+ CUACA_ASLI=1 = data dan tile sebenar).
// Jalankan dari root: node tests/frontend/lapisan-cuaca.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { buatFixture } = require('../helpers/cuaca-fixture.js');
const { buatFixtureBanjir, pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const { buatGrid, medan } = require('../helpers/grid-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
const FI = require('../../src/js/lapisan-cuaca/interp.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.CUACA_SHOTS || '';
const ASLI = !!process.env.CUACA_ASLI;
const RAIN = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'rainviewer-maps.json'), 'utf8'),
);
const ATR_OM = 'Data cuaca: Open-Meteo.com (CC BY 4.0)';
const MENU = [
  'Radar cuaca',
  'Satelit',
  'Angin',
  'Hujan, petir',
  'Suhu',
  'Penjejak siklon',
  'Awan',
  'Ombak',
  'Kumpulan hujan',
  'Ribut petir',
];
// Masa rujukan: 17 Nov 2026 10:30 UTC => time0 = 10 (grid bermula 00:00Z, 96 jam)
const T0 = Date.UTC(2026, 10, 17, 10, 30);
const GRID_MULA = new Date(Date.UTC(2026, 10, 17));

const radarStub = () => ({
  versi: 1,
  atribusi: 'RainViewer',
  host: RAIN.host,
  fetchedAt: new Date().toISOString(),
  frames: RAIN.radar.past.map((f) => ({ time: f.time, path: f.path })),
});
// Satelit: 6 bingkai 20 min, sebahagian sejajar dengan bingkai radar fixture (T + 5 min + 20 min * j)
const satStub = () => {
  const t0 = RAIN.radar.past[0].time * 1000 + 300000;
  return {
    versi: 1,
    atribusi: 'NASA GIBS / JMA Himawari',
    lapisan: 'Himawari_AHI_Band13_Clean_Infrared',
    matriks: 'GoogleMapsCompatible_Level6',
    maxzoom: 6,
    fetchedAt: new Date().toISOString(),
    frames: [0, 1, 2, 3, 4, 5].map(
      (j) => new Date(t0 + j * 1200000).toISOString().slice(0, 19) + 'Z',
    ),
  };
};
const siklonKosong = () => ({
  versi: 1,
  fetchedAt: new Date().toISOString(),
  atribusi: 'GDACS',
  sumber: { status: 'ok', mesej: '' },
  siklon: [],
});
const siklonAda = () => ({
  ...siklonKosong(),
  siklon: [
    {
      id: '9001',
      nama: 'UJIAN-26',
      aras: 'Orange',
      kategori: 'Ribut Tropika',
      anginKmj: 93,
      teks: 'Tropical Storm (maximum wind speed of 93 km/h)',
      dari: '2026-11-16T18:00:00',
      hingga: '2026-11-17T06:00:00',
      negara: 'Filipina',
      pos: [112, 12],
      jejakLalu: [
        [
          [114, 13],
          [112, 12],
        ],
      ],
      jejakRamalan: [
        [
          [112, 12],
          [110, 11],
        ],
      ],
      pautan: 'https://www.gdacs.org/report.aspx?eventid=9001&episodeid=1&eventtype=TC',
    },
  ],
});

(async () => {
  const dirGrid = fs.mkdtempSync(path.join(os.tmpdir(), 'cuaca-grid-'));
  if (!ASLI) {
    process.env.GRID_CACHE_DIR = dirGrid;
    buatGrid({ dir: dirGrid, mula: GRID_MULA });
  }
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cuaca-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  const hampir = (a, b, t) => typeof a === 'number' && Math.abs(a - b) <= t;

  async function buka({
    lebar = 1440,
    tinggi = 1100,
    tema = null,
    stub = {},
    kurangGerak = false,
    tapisKonsol = null,
    sekarang = T0,
  } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: tinggi });
    if (kurangGerak)
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const masalah = [];
    const permintaan = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (/AbortError/.test(m.text())) return;
      if (tapisKonsol && tapisKonsol.test(m.text())) return;
      if (['error', 'warning'].includes(m.type())) masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('request', (r) => permintaan.push(r.url()));
    await page.evaluateOnNewDocument((t) => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.__csp.push(e.violatedDirective + ' ' + e.blockedURI),
      );
      if (t) {
        try {
          localStorage.setItem('fama_tema', t);
        } catch {
          /* abaikan */
        }
      }
    }, tema);
    const s = {
      cuaca: buatFixture(),
      banjir: buatFixtureBanjir({ tahap: 'amaran' }),
      metmy: { versi: 1, fetchedAt: null, sumber: { status: 'belum_tersedia' }, amaran: [] },
      tileAsli: ASLI,
      ...(ASLI ? {} : { radar: radarStub(), satelit: satStub(), siklon: siklonKosong() }),
      ...stub,
    };
    await stubApi(page, s);
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
      () =>
        window.DASHBOARD_TEST &&
        DASHBOARD_TEST.cuaca &&
        DASHBOARD_TEST.peta().lapisan.banjir &&
        document.querySelector('#cuacaMenu'),
      { timeout: 30000 },
    );
    if (sekarang) await page.evaluate((t) => DASHBOARD_TEST.cuaca.tetapSekarang(t), sekarang);
    return { page, masalah, permintaan };
  }
  const aktif = (page) => page.evaluate(() => DASHBOARD_TEST.cuaca.aktif());
  const togol = (page, id) => page.evaluate((i) => DASHBOARD_TEST.cuaca.togol(i), id);
  const tunggu = (page, fn, ...a) => page.waitForFunction(fn, { timeout: 20000 }, ...a);
  const idLapisan = async (page) =>
    (await page.evaluate(() => DASHBOARD_TEST.cuaca.lapisanPeta())).map((l) => l.id).sort();
  const kanvas = (page) =>
    page.evaluate(() => {
      const k = DASHBOARD_TEST.cuaca.kanvas();
      return k && { w: k.w, h: k.h, hash: k.hash, legap: k.legap, warnaBeza: k.warnaBeza };
    });
  const kotak = (page, sel) =>
    page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        r: r.right,
        b: r.bottom,
        display: getComputedStyle(e).display,
      };
    }, sel);
  const bertindih = (a, b) => a && b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  async function tukar(page, kunci) {
    await page.click(`#petaKawalan [data-asas="${kunci}"]`);
    await page.waitForFunction(
      (k) => DASHBOARD_TEST.peta().asas === k && DASHBOARD_TEST.peta().gayaDimuat,
      { timeout: 20000 },
      kunci,
    );
    await page.waitForFunction(
      () => DASHBOARD_TEST.peta().lapisan.banjir && DASHBOARD_TEST.peta().lapisan.amaran,
      { timeout: 20000 },
    );
  }
  async function foto(page, nama) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await sleep(ASLI ? 6000 : 1500);
    await page.evaluate(() =>
      document
        .querySelector('.map-svg-frame')
        .scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await sleep(800);
    const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const b = await (await page.$('.map-svg-frame')).boundingBox();
    await page.screenshot({
      path: path.join(SHOTS, nama + '.png'),
      clip: {
        x: Math.max(0, b.x) + sc.x,
        y: Math.max(0, b.y) + sc.y,
        width: Math.min(b.width, 1500),
        height: Math.max(1, Math.min(b.height, 800, page.viewport().height - Math.max(0, b.y))),
      },
    });
  }

  try {
    // ===== Mod tangkapan skrin sahaja: paparan Angin, Suhu, Radar, Ombak pada 1440 dan 390, gelap dan cerah =====
    if (SHOTS) {
      for (const [lebar, tinggi] of [
        [1440, 1100],
        [390, 900],
      ])
        for (const tema of ['gelap', 'cerah']) {
          const { page } = await buka({ lebar, tinggi, tema, sekarang: ASLI ? null : T0 });
          if (lebar === 390) await page.click('#petaMenuBtn');
          for (const [nama, ids] of [
            ['angin', ['angin']],
            ['suhu', ['suhu']],
            ['radar', ['radar']],
            ['ombak', ['ombak']],
          ]) {
            await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapSekarang(null));
            for (const id of ids) {
              if (
                lebar === 390 &&
                !(await page.$eval('#petaKawalan', (e) => e.classList.contains('terbuka')))
              )
                await page.click('#petaMenuBtn');
              await togol(page, id);
            }
            await foto(page, `${lebar}-${tema}-${nama}`);
            for (const id of ids) await togol(page, id);
          }
          await page.close();
        }
      // Panel Lapisan Cuaca: dibesarkan dan dikecilkan (1440, klip sekitar menu)
      for (const tema of ['gelap', 'cerah']) {
        const { page } = await buka({ tema });
        await togol(page, 'angin');
        for (const keadaan of ['besar', 'kecil']) {
          if (keadaan === 'kecil') await page.click('#cuacaKecil');
          await sleep(1500);
          await page.evaluate(() =>
            document
              .querySelector('#cuacaMenu')
              .scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          const b = await (await page.$('#petaMenu')).boundingBox();
          const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
          await page.screenshot({
            path: path.join(SHOTS, `panel-${tema}-${keadaan}.png`),
            clip: {
              x: Math.max(0, b.x - 20) + sc.x,
              y: Math.max(0, b.y - 20) + sc.y,
              width: b.width + 40,
              height: 420,
            },
          });
        }
        await page.click('#cuacaKecil');
        await page.close();
      }
      return;
    }

    // ===== (i) keadaan awal =====
    const A = await buka();
    const { page, masalah, permintaan } = A;
    ok(
      '(i) menu 10 lapisan Malay ikut susunan',
      JSON.stringify(
        (await page.evaluate(() => DASHBOARD_TEST.cuaca.senaraiMenu())).map((m) => m.label),
      ) === JSON.stringify(MENU),
    );
    ok(
      '(i) tiada yang ditekan',
      (await page.evaluate(() => DASHBOARD_TEST.cuaca.senaraiMenu())).every(
        (m) => !m.ditekan && !m.dilumpuhkan,
      ),
    );
    ok(
      '(i) tiada permintaan grid/radar/satelit/siklon semasa mula',
      !permintaan.some((u) => /\/api\/(grid|radar|satelit|siklon)/.test(u)),
      permintaan.filter((u) => /\/api\/(grid|radar|satelit|siklon)/.test(u)),
    );
    ok('(i) tiada iframe', (await page.$$('iframe')).length === 0);
    ok(
      '(i) garis masa tersembunyi, mod null',
      !(await page.evaluate(() => DASHBOARD_TEST.cuaca.bawahTampak())) &&
        (await aktif(page)).mod === null,
    );
    const ahli = await page.$$eval('#cuacaMenu button', (b) =>
      b.map((x) => ({
        id: x.dataset.lapisan,
        tambah: !!x.querySelector('.cuaca-tambah'),
        p: x.getAttribute('aria-pressed'),
      })),
    );
    ok(
      '(i) glif + hanya pada Radar, Satelit, Siklon',
      JSON.stringify(ahli.filter((x) => x.tambah).map((x) => x.id)) ===
        JSON.stringify(['radar', 'satelit', 'siklon']),
      ahli,
    );

    // ===== (ii) setiap lapisan: legenda, ID lapisan peta, satu lapisan utama sahaja =====
    const JANGKA = {
      angin: { tajuk: 'Angin', unit: 'km/j', atr: ATR_OM, lapisan: ['cuaca-fill', 'cuaca-garis'] },
      hujan: { tajuk: 'Hujan, petir', unit: 'mm/j', atr: ATR_OM, lapisan: ['cuaca-fill'] },
      suhu: { tajuk: 'Suhu', unit: '°C', atr: ATR_OM, lapisan: ['cuaca-fill'] },
      awan: { tajuk: 'Awan', unit: '%', atr: ATR_OM, lapisan: ['cuaca-fill'] },
      ombak: { tajuk: 'Ombak', unit: 'm', atr: ATR_OM, lapisan: ['cuaca-fill', 'cuaca-garis'] },
      kumpulan: { tajuk: 'Kumpulan hujan', unit: 'mm', atr: ATR_OM, lapisan: ['cuaca-fill'] },
      ribut: {
        tajuk: 'Kebarangkalian ribut petir (anggaran)',
        unit: 'kelas',
        atr: ATR_OM,
        lapisan: ['cuaca-fill'],
      },
    };
    for (const id of Object.keys(JANGKA)) {
      const j = JANGKA[id];
      await togol(page, id);
      const a = await aktif(page);
      ok(`(ii) ${id}: lapisan utama aktif`, a.utama === id, a);
      const menu = await page.evaluate(() => DASHBOARD_TEST.cuaca.senaraiMenu());
      const utamaTekan = menu.filter(
        (m) =>
          ['angin', 'hujan', 'suhu', 'awan', 'ombak', 'kumpulan', 'ribut'].includes(m.id) &&
          m.ditekan,
      );
      ok(
        `(ii) ${id}: hanya satu lapisan utama ditekan`,
        utamaTekan.length === 1 && utamaTekan[0].id === id,
        utamaTekan,
      );
      const l = await page.evaluate((i) => DASHBOARD_TEST.cuaca.legenda(i), id);
      ok(
        `(ii) ${id}: legenda`,
        l && l.tajuk === j.tajuk && l.unit === j.unit && l.atribusi === j.atr,
        l,
      );
      const dom = await page.evaluate((i) => {
        const e = document.querySelector(`#cuacaLegenda [data-lapisan="${i}"]`);
        return e && e.innerText;
      }, id);
      ok(
        `(ii) ${id}: legenda tampak dengan tajuk, unit dan atribusi`,
        dom && dom.includes(j.tajuk) && dom.includes(j.atr),
        dom,
      );
      ok(
        `(ii) ${id}: ID lapisan peta`,
        JSON.stringify(await idLapisan(page)) === JSON.stringify(j.lapisan.slice().sort()),
        await idLapisan(page),
      );
      const k = await kanvas(page);
      ok(`(ii) ${id}: kanvas ada piksel`, k && k.legap > 0, k);
    }
    ok(
      '(ii) ribut: legenda ada 4 kelas',
      (await page.$$eval(
        '#cuacaLegenda [data-lapisan="ribut"] .cuaca-leg-kelas-item',
        (e) => e.length,
      )) === 4,
    );
    await togol(page, 'ribut'); // nyahaktif
    ok(
      '(ii) togol lapisan utama kali kedua: nyahaktif, lapisan peta dibuang, legenda tersembunyi',
      (await aktif(page)).utama === null &&
        (await idLapisan(page)).length === 0 &&
        (await page.$eval('#cuacaLegenda', (e) => e.hidden)),
    );
    // ombak: dilumpuhkan jika sumber gagal diuji dalam (x). Tindihan: radar, satelit, siklon
    const TIND = {
      radar: {
        tajuk: 'Radar cuaca',
        atr: 'RainViewer',
        lapisan: Array.from({ length: 13 }, (_, i) => 'cuaca-radar-' + i),
      },
      satelit: {
        tajuk: 'Satelit inframerah',
        atr: 'NASA GIBS / JMA Himawari',
        lapisan: Array.from({ length: 6 }, (_, i) => 'cuaca-sat-' + i),
      },
      siklon: {
        tajuk: 'Penjejak siklon',
        atr: 'GDACS',
        lapisan: ['cuaca-siklon-garis', 'cuaca-siklon-ramal', 'cuaca-siklon-titik'],
      },
    };
    await togol(page, 'suhu');
    for (const id of Object.keys(TIND)) {
      await togol(page, id);
      const l = await page.evaluate((i) => DASHBOARD_TEST.cuaca.legenda(i), id);
      ok(
        `(ii) ${id}: legenda tindihan`,
        l && l.tajuk === TIND[id].tajuk && l.atribusi === TIND[id].atr,
        l,
      );
      const a = await aktif(page);
      ok(
        `(ii) ${id}: tindihan bebas daripada lapisan utama`,
        a.utama === 'suhu' && a.tindih.includes(id),
        a,
      );
    }
    const semuaId = await idLapisan(page);
    const jangkaSemua = [
      'cuaca-fill',
      ...TIND.radar.lapisan,
      ...TIND.satelit.lapisan,
      ...TIND.siklon.lapisan,
    ].sort();
    ok(
      '(ii) semua tindihan + utama: ID lapisan lengkap',
      JSON.stringify(semuaId) === JSON.stringify(jangkaSemua),
      semuaId,
    );
    ok(
      '(ii) legenda siklon: Tiada siklon tropika aktif di rantau ini',
      (await page.$eval('#cuacaLegenda [data-lapisan="siklon"]', (e) => e.innerText)).includes(
        'Tiada siklon tropika aktif di rantau ini',
      ),
    );
    for (const id of Object.keys(TIND)) await togol(page, id);
    ok(
      '(ii) tindihan dimatikan: hanya lapisan utama tinggal',
      JSON.stringify(await idLapisan(page)) === JSON.stringify(['cuaca-fill']),
    );
    await togol(page, 'suhu');

    // ===== (iii) garis masa =====
    await togol(page, 'suhu');
    ok('(iii) time0 = 10 (10:30 UTC)', (await aktif(page)).indeksMasa0 === 10, await aktif(page));
    ok(
      '(iii) peluncur: 73 hentian (maks 72)',
      (await page.$eval('#cuacaSlider', (e) => e.max)) === '72',
    );
    const h0 = (await kanvas(page)).hash;
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(7));
    const h7 = (await kanvas(page)).hash;
    ok('(iii) tetapJam(7): jam dan kanvas berubah', (await aktif(page)).jam === 7 && h7 !== h0, [
      h0,
      h7,
    ]);
    await page.$eval('#cuacaSlider', (e) => {
      e.value = '15';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const h15 = (await kanvas(page)).hash;
    ok(
      '(iii) peluncur sebenar: jam 15 dan kanvas berubah',
      (await aktif(page)).jam === 15 && h15 !== h7,
    );
    ok(
      '(iii) label masa MYT',
      /\d{2}:\d{2}/.test(await page.$eval('#cuacaMasa', (e) => e.textContent)),
    );
    // Angin: kanvas berubah mengikut jam
    await togol(page, 'angin');
    const a0 = (await kanvas(page)).hash;
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(5));
    ok('(iii) angin: kanvas berubah mengikut jam', (await kanvas(page)).hash !== a0);
    // Kumpulan hujan: pemilih W
    await togol(page, 'kumpulan');
    ok('(iii) kumpulan: W lalai 24', (await aktif(page)).W === 24);
    const kh24 = (await kanvas(page)).hash;
    await page.click('#cuacaLegenda [data-w="72"]');
    const k72 = await page.evaluate(() => ({
      a: DASHBOARD_TEST.cuaca.aktif(),
      max: document.getElementById('cuacaSlider').max,
      kh: DASHBOARD_TEST.cuaca.kanvas().hash,
    }));
    ok(
      '(iii) kumpulan W=72: kanvas berubah, peluncur 14 hentian (maks 13) pada time0=10',
      k72.a.W === 72 && k72.max === '13' && k72.kh !== kh24,
      k72,
    );
    await page.click('#cuacaLegenda [data-w="3"]');
    ok(
      '(iii) kumpulan W=3: peluncur maks 72',
      (await page.$eval('#cuacaSlider', (e) => e.max)) === '72',
    );
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapW(72));
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(13));
    await page.click('#cuacaLegenda [data-w="3"]');
    // jam dikekang apabila W berkurang tidak diperlukan; sebaliknya W bertambah mengekang jam
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(60));
    await page.click('#cuacaLegenda [data-w="72"]');
    ok(
      '(iii) kumpulan: menukar W ke 72 mengekang jam kepada 13',
      (await aktif(page)).jam === 13,
      await aktif(page),
    );
    // time0 = 23: W=72 satu masa tetap
    await page.evaluate(
      (t) => DASHBOARD_TEST.cuaca.tetapSekarang(t),
      Date.UTC(2026, 10, 17, 23, 30),
    );
    const t23 = await page.evaluate(() => ({
      a: DASHBOARD_TEST.cuaca.aktif(),
      max: document.getElementById('cuacaSlider').max,
      teks: document.getElementById('cuacaLegenda').innerText,
    }));
    ok(
      '(iii) time0=23, W=72: satu hentian dan "Satu masa tetap"',
      t23.a.indeksMasa0 === 23 && t23.max === '0' && /Satu masa tetap/.test(t23.teks),
      t23,
    );
    await page.evaluate((t) => DASHBOARD_TEST.cuaca.tetapSekarang(t), T0);
    // ribut: <= 5 warna berbeza
    await togol(page, 'ribut');
    const kr = await kanvas(page);
    ok(
      '(iii) ribut: kanvas guna <= 5 warna (kelas 1-4)',
      kr.warnaBeza >= 1 && kr.warnaBeza <= 4,
      kr,
    );
    // hujan: penanda petir (kod 95-99 wujud dalam fixture) maksimum 60
    await togol(page, 'hujan');
    let petir = 0;
    for (let k = 0; k < 40 && petir === 0; k++) {
      await page.evaluate((j) => DASHBOARD_TEST.cuaca.tetapJam(j), k);
      petir = await page.evaluate(() => DASHBOARD_TEST.cuaca.petir());
    }
    ok('(iii) hujan: ada penanda petir (1-60) bila kod 95-99', petir >= 1 && petir <= 60, petir);
    await togol(page, 'hujan');

    // ===== (iii-b) peralihan mod =====
    const mod = async () => (await aktif(page)).mod;
    const pasti = async (nama, jangka) => {
      const m = await mod();
      ok('(iii-b) ' + nama, m === jangka, { jangka, sebenar: m });
    };
    await pasti('semua mati -> null', null);
    ok(
      '(iii-b) semua mati: garis masa tersembunyi',
      !(await page.evaluate(() => DASHBOARD_TEST.cuaca.bawahTampak())),
    );
    await togol(page, 'siklon');
    await pasti('siklon sahaja -> null', null);
    ok(
      '(iii-b) siklon sahaja: garis masa tersembunyi',
      !(await page.evaluate(() => DASHBOARD_TEST.cuaca.bawahTampak())),
    );
    await togol(page, 'siklon');
    await togol(page, 'radar');
    await pasti('radar sahaja -> imbasan', 'imbasan');
    ok(
      '(iii-b) radar sahaja: garis masa tampak, peluncur 13 bingkai',
      (await page.evaluate(() => DASHBOARD_TEST.cuaca.bawahTampak())) &&
        (await page.$eval('#cuacaSlider', (e) => e.max)) === '12',
    );
    ok(
      '(iii-b) suis Ramalan|Imbasan tersembunyi tanpa lapisan utama',
      await page.$eval('#cuacaMod', (e) => e.hidden),
    );
    await togol(page, 'angin');
    await pasti('+ angin -> ramalan', 'ramalan');
    ok(
      '(iii-b) suis Ramalan|Imbasan kelihatan dengan lapisan utama + radar',
      !(await page.$eval('#cuacaMod', (e) => e.hidden)),
    );
    await togol(page, 'radar');
    await pasti('radar mati -> ramalan', 'ramalan');
    ok(
      '(iii-b) suis tersembunyi tanpa tindihan bingkai',
      await page.$eval('#cuacaMod', (e) => e.hidden),
    );
    await togol(page, 'radar');
    await pasti('radar hidup semula -> ramalan kekal', 'ramalan');
    await togol(page, 'angin');
    await pasti('angin mati, radar hidup -> imbasan', 'imbasan');
    await togol(page, 'angin');
    await pasti('angin hidup semula -> ramalan', 'ramalan');
    await page.click('#cuacaMod [data-mod="imbasan"]');
    await pasti('pengguna pilih Imbasan', 'imbasan');
    await togol(page, 'radar');
    await pasti('radar mati selepas Imbasan -> ramalan', 'ramalan');
    await togol(page, 'angin');
    await pasti('semua mati -> null (semula)', null);
    // Radar + Satelit tanpa lapisan utama: peluncur ikut radar; satelit = bingkai terbesar dengan masa <= masa radar
    await togol(page, 'radar');
    await togol(page, 'satelit');
    ok(
      '(iii-b) radar + satelit: peluncur = bilangan bingkai radar (13)',
      (await page.$eval('#cuacaSlider', (e) => e.max)) === '12',
    );
    await page.$eval('#cuacaSlider', (e) => {
      e.value = '6';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const bt = await page.evaluate(() => DASHBOARD_TEST.cuaca.bingkaiTampak());
    ok(
      '(iii-b) radar bingkai 6 -> satelit bingkai 2 (masa <= masa radar)',
      bt.radar === 6 && bt.sat === 2,
      bt,
    );
    await page.$eval('#cuacaSlider', (e) => {
      e.value = '0';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const bt0 = await page.evaluate(() => DASHBOARD_TEST.cuaca.bingkaiTampak());
    ok(
      '(iii-b) radar bingkai 0 (sebelum bingkai satelit pertama) -> satelit bingkai terawal',
      bt0.radar === 0 && bt0.sat === 0,
      bt0,
    );
    await togol(page, 'radar');
    const bsat = await aktif(page);
    ok(
      '(iii-b) radar mati: satelit memandu peluncur (6 bingkai)',
      bsat.mod === 'imbasan' && (await page.$eval('#cuacaSlider', (e) => e.max)) === '5',
      bsat,
    );
    await togol(page, 'satelit');

    // ===== (iii-c) imbasan tidak mengubah jam ramalan =====
    await togol(page, 'suhu');
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(9));
    await togol(page, 'radar');
    await page.click('#cuacaMod [data-mod="imbasan"]');
    const sebelum = { h: (await kanvas(page)).hash, a: await aktif(page) };
    await page.evaluate(() => DASHBOARD_TEST.cuaca.mainkan());
    await sleep(1500);
    await page.evaluate(() => DASHBOARD_TEST.cuaca.jeda());
    const selepas = { h: (await kanvas(page)).hash, a: await aktif(page) };
    ok(
      '(iii-c) main radar dalam Imbasan: kanvas dan jam ramalan tidak berubah',
      selepas.h === sebelum.h && selepas.a.jam === 9 && selepas.a.mod === 'imbasan',
      { sebelum, selepas },
    );
    ok('(iii-c) bingkai radar maju semasa main', selepas.a.bingkai !== sebelum.a.bingkai, [
      sebelum.a.bingkai,
      selepas.a.bingkai,
    ]);
    await page.click('#cuacaMod [data-mod="ramalan"]');
    ok(
      '(iii-c) kembali ke Ramalan: peluncur = jam ramalan lama',
      (await page.$eval('#cuacaSlider', (e) => e.value)) === '9' && (await aktif(page)).jam === 9,
    );
    await togol(page, 'radar');
    await togol(page, 'suhu');

    // ===== (iv) main/jeda radar dan bingkai tanpa permintaan tile baharu =====
    await togol(page, 'radar');
    await sleep(1200);
    const tileSebelum = page.tileUrls.length;
    const b0 = (await page.evaluate(() => DASHBOARD_TEST.cuaca.bingkaiTampak())).radar;
    await page.click('#cuacaMain');
    ok(
      '(iv) butang Main menjadi Jeda',
      (await page.$eval('#cuacaMain', (e) => e.getAttribute('aria-label'))) === 'Jeda' &&
        (await aktif(page)).bermain,
    );
    await sleep(1600);
    const b1 = (await page.evaluate(() => DASHBOARD_TEST.cuaca.bingkaiTampak())).radar;
    ok('(iv) bingkai radar maju semasa main', b1 !== b0, [b0, b1]);
    await page.click('#cuacaMain');
    const b2 = (await page.evaluate(() => DASHBOARD_TEST.cuaca.bingkaiTampak())).radar;
    await sleep(1000);
    const b3 = (await page.evaluate(() => DASHBOARD_TEST.cuaca.bingkaiTampak())).radar;
    ok('(iv) jeda: bingkai berhenti', b2 === b3 && !(await aktif(page)).bermain, [b2, b3]);
    ok('(iv) tukar bingkai tidak meminta tile baharu', page.tileUrls.length === tileSebelum, [
      tileSebelum,
      page.tileUrls.length,
    ]);
    ok(
      '(iv) tile radar dan satelit hanya dari hos dibenarkan',
      page.tileUrls.every((u) =>
        /^https:\/\/(tilecache\.rainviewer\.com|gibs\.earthdata\.nasa\.gov|server\.arcgisonline\.com|tile\.openstreetmap\.org|[abc]\.tile\.opentopomap\.org)\//.test(
          u,
        ),
      ),
    );
    ok(
      '(iv) URL tile radar dari bingkai fixture',
      page.tileUrls.some((u) => u.startsWith(RAIN.host + RAIN.radar.past[12].path + '/256/')),
      page.tileUrls.slice(0, 3),
    );
    // slider diseret menghentikan main
    await page.evaluate(() => DASHBOARD_TEST.cuaca.mainkan());
    await page.$eval('#cuacaSlider', (e) => {
      e.value = '3';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    ok('(iv) menyeret peluncur menjeda main', !(await aktif(page)).bermain);
    await togol(page, 'radar');

    // ===== (v) zarah angin =====
    await togol(page, 'angin');
    const z0 = await page.evaluate(() => DASHBOARD_TEST.cuaca.zarah());
    await sleep(900);
    const z1 = await page.evaluate(() => DASHBOARD_TEST.cuaca.zarah());
    ok(
      '(v) angin: mod zarah, bilangan >= 600, denyutan bertambah',
      z1.mod === 'zarah' && z1.bilangan >= 600 && z1.denyutan > z0.denyutan,
      { z0, z1 },
    );
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(600);
    const zh0 = (await page.evaluate(() => DASHBOARD_TEST.cuaca.zarah())).denyutan;
    await sleep(900);
    const zh1 = (await page.evaluate(() => DASHBOARD_TEST.cuaca.zarah())).denyutan;
    ok('(v) halaman tersembunyi: animasi zarah berhenti', zh0 === zh1, [zh0, zh1]);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(700);
    ok(
      '(v) halaman kelihatan semula: zarah bergerak',
      (await page.evaluate(() => DASHBOARD_TEST.cuaca.zarah())).denyutan > zh1,
    );
    await togol(page, 'ombak');
    const zo = await page.evaluate(() => DASHBOARD_TEST.cuaca.zarah());
    ok('(v) ombak: anak panah arah', zo.mod === 'panah', zo);
    await togol(page, 'ombak');
    ok(
      '(v) selepas nyahaktif tiada garis',
      (await page.evaluate(() => DASHBOARD_TEST.cuaca.zarah())).mod === null,
    );

    // ===== (vi) pemeriksa titik =====
    await togol(page, 'suhu');
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(3));
    await page.evaluate(() =>
      document
        .querySelector('.map-svg-frame')
        .scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await sleep(300);
    const sasaran = await page.evaluate(() => {
      const ll = { lat: 4.2, lon: 108.3 };
      const p = map.project([ll.lon, ll.lat]);
      const r = map.getContainer().getBoundingClientRect();
      const x = Math.round(r.left + p.x);
      const y = Math.round(r.top + p.y);
      const u = map.unproject([x - r.left, y - r.top]);
      return { x, y, lat: u.lat, lon: u.lng };
    });
    await page.mouse.click(sasaran.x, sasaran.y);
    await page.waitForSelector('.cuaca-popup [data-nama="temperature_2m"]', { timeout: 10000 });
    const pop = await page.evaluate(() => ({
      suhu: Number(
        document.querySelector('.cuaca-popup [data-nama="temperature_2m"]').dataset.nilai,
      ),
      teks: document.querySelector('.cuaca-popup').innerText,
      href: (document.querySelector('.cuaca-popup .gmaps-link') || {}).href,
      nama: [...document.querySelectorAll('.cuaca-popup [data-nama]')].map((e) => e.dataset.nama),
    }));
    const gx = (sasaran.lon - 99.5) / 0.5;
    const gy = (sasaran.lat - 0.5) / 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const sudut = [
      [x0, y0],
      [x0 + 1, y0],
      [x0, y0 + 1],
      [x0 + 1, y0 + 1],
    ].map(([c, r]) => medan('temperature_2m', 13, c, r));
    const jangkaSuhu = FI.bilinear(sudut, 2, 2, gx - x0, gy - y0);
    ok('(vi) pop-up Suhu = bilinear fixture (+/- 0.1)', hampir(pop.suhu, jangkaSuhu, 0.1), {
      paparan: pop.suhu,
      jangka: jangkaSuhu,
    });
    ok(
      '(vi) pop-up senaraikan angin, awan, hujan, keadaan, CAPE, ombak',
      [
        'wind_speed_10m',
        'cloud_cover',
        'precipitation',
        'weather_code',
        'cape',
        'wave_height',
      ].every((n) => pop.nama.includes(n)),
      pop.nama,
    );
    ok(
      '(vi) pautan Google Maps ikut koordinat klik',
      !!pop.href &&
        pop.href.startsWith('https://www.google.com/maps/search/?api=1&query=') &&
        (() => {
          const [la, lo] = decodeURIComponent(pop.href.split('query=')[1]).split(',').map(Number);
          return hampir(la, sasaran.lat, 0.01) && hampir(lo, sasaran.lon, 0.01);
        })(),
      pop.href,
    );
    ok(
      '(vi) pop-up: nilai ini ialah jam ke-3 (masa dipaparkan)',
      /\d{2}:\d{2}/.test(pop.teks),
      pop.teks,
    );
    // klik stesen banjir: pop-up sedia ada, bukan pemeriksa
    await page.evaluate(() =>
      document.querySelectorAll('.maplibregl-popup').forEach((p) => p.remove()),
    );
    // Penanda DOM (petak PO tambahan, titik tengah daerah) boleh menutup stesen fixture; sembunyikan sementara
    await page.evaluate(() => window.FamaPOT && FamaPOT.tetap(false));
    await sleep(400);
    const stesen = await page.evaluate(() => {
      const f = map.queryRenderedFeatures({ layers: ['banjir-stesen'] })[0];
      if (!f) return null;
      const p = map.project(f.geometry.coordinates);
      const r = map.getContainer().getBoundingClientRect();
      return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
    });
    ok('(vi) ada stesen banjir tampak untuk diuji', !!stesen);
    if (stesen) {
      await page.mouse.click(stesen.x, stesen.y);
      await sleep(900);
      const p = await page.evaluate(() => ({
        semua: document.querySelectorAll('.maplibregl-popup').length,
        cuaca: document.querySelectorAll('.cuaca-popup').length,
      }));
      ok(
        '(vi) klik stesen banjir: pop-up stesen dibuka, pemeriksa cuaca tidak',
        p.semua >= 1 && p.cuaca === 0,
        p,
      );
      await page.evaluate(() => window.FamaPOT && FamaPOT.tetap(true));
    }
    // klik penanda PO (elemen DOM): tiada pemeriksa
    await page.evaluate(() =>
      document.querySelectorAll('.maplibregl-popup').forEach((p) => p.remove()),
    );
    const po = await page.evaluate(() => {
      const mk = [...document.querySelectorAll('.po-marker')].find((e) => {
        const r = e.getBoundingClientRect();
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return t && (t === e || e.contains(t)) && r.top > 0 && r.bottom < innerHeight;
      });
      if (!mk) return null;
      const r = mk.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    ok('(vi) ada penanda PO tampak untuk diuji', !!po);
    if (po) {
      await page.mouse.click(po.x, po.y);
      await sleep(900);
      ok(
        '(vi) klik penanda PO: tiada pemeriksa cuaca',
        (await page.$$('.cuaca-popup')).length === 0,
      );
    }
    // luar bbox
    await page.evaluate(() => DASHBOARD_TEST.cuaca.klikTitik(20, 80));
    ok(
      '(vi) luar liputan: mesej',
      (await page.$eval('.cuaca-popup', (e) => e.innerText)).includes('Di luar liputan data cuaca'),
    );
    await page.evaluate(() =>
      document.querySelectorAll('.maplibregl-popup').forEach((p) => p.remove()),
    );

    // ===== (vii) peta asas bertukar: lapisan cuaca kekal =====
    await togol(page, 'angin');
    await togol(page, 'radar');
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(5));
    const pra = { a: await aktif(page), id: await idLapisan(page), h: (await kanvas(page)).hash };
    for (const k of ['satelit', 'terrain', 'lalai']) {
      await tukar(page, k);
      await tunggu(page, (n) => DASHBOARD_TEST.cuaca.lapisanPeta().length === n, pra.id.length);
      const sel = { a: await aktif(page), id: await idLapisan(page), h: (await kanvas(page)).hash };
      ok(
        `(vii) tukar ke ${k}: keadaan, lapisan dan kanvas sama`,
        JSON.stringify(sel.a) === JSON.stringify(pra.a) &&
          JSON.stringify(sel.id) === JSON.stringify(pra.id) &&
          sel.h === pra.h,
        { pra, sel },
      );
    }
    await page.evaluate(() => DASHBOARD_TEST.cuaca.tetapJam(8));
    ok(
      '(vii) selepas tukar, jam boleh diubah dan kanvas dikemas kini',
      (await aktif(page)).jam === 8 && (await kanvas(page)).hash !== pra.h,
    );
    await togol(page, 'radar');
    await togol(page, 'angin');

    // ===== (viii) Windy tiada =====
    const hdr = await (await fetch(base + '/')).headers.get('content-security-policy');
    const meta = await page.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    );
    ok(
      '(viii) CSP tiada frame-src dan tiada windy (pengepala dan meta)',
      !/frame-src|windy/i.test(hdr + meta),
      hdr,
    );
    const dirk = (t, n) =>
      (t.split(';').find((d) => d.trim().startsWith(n + ' ')) || '').split(/\s+/);
    ok(
      '(viii) img-src dan connect-src ada hos tile RainViewer dan GIBS',
      ['img-src', 'connect-src'].every((n) =>
        ['https://tilecache.rainviewer.com', 'https://gibs.earthdata.nasa.gov'].every((h) =>
          dirk(hdr, n).includes(h),
        ),
      ),
      hdr,
    );
    ok(
      '(viii) tiada iframe, tiada #petaRadar, tiada permintaan windy',
      (await page.$$('iframe')).length === 0 &&
        !(await page.$('#petaRadar')) &&
        !permintaan.some((u) => /windy/i.test(u)),
    );

    // ===== (xi) tiada ralat konsol/CSP (halaman utama) =====
    ok(
      '(xi) tiada pelanggaran CSP',
      (await page.evaluate(() => window.__csp)).length === 0,
      await page.evaluate(() => window.__csp),
    );
    ok('(xi) tiada ralat/amaran konsol', masalah.length === 0, masalah);
    await page.close();

    // ===== (a) tinggi bingkai dan reka letak pada 390 / 800 / 820 / 1440 =====
    for (const [lebar, tinggiBingkai] of [
      [390, 480],
      [800, 500],
      [820, 540],
      [1440, 540],
    ]) {
      const m = await buka({ lebar, tinggi: lebar === 390 ? 900 : 1100 });
      if (lebar <= 640) {
        await m.page.click('#petaMenuBtn');
        await m.page.click('#cuacaMenu [data-lapisan="angin"]');
        await m.page.click('#petaMenuBtn');
        await m.page.click('#cuacaMenu [data-lapisan="radar"]');
      } else {
        await togol(m.page, 'angin');
        await togol(m.page, 'radar');
      }
      await page_cuaca_sedia(m.page);
      if (lebar <= 640) {
        ok(
          '(a) 390: selepas memilih lapisan, menu tertutup',
          (await kotak(m.page, '#petaMenu')).display === 'none',
        );
        ok('(a) 390: butang Lapisan ada', (await kotak(m.page, '#petaMenuBtn')).display !== 'none');
      }
      await m.page.evaluate(() =>
        document
          .querySelector('.map-svg-frame')
          .scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await sleep(300);
      const f = await kotak(m.page, '.map-svg-frame');
      const p = await kotak(m.page, '#cuacaPapan');
      const leg = await kotak(m.page, '#cuacaLegenda');
      const bw = await kotak(m.page, '#cuacaBawah');
      const mn = await kotak(m.page, '#petaMenu');
      const dalam = (a) => a.x >= f.x - 1 && a.r <= f.r + 1 && a.y >= f.y - 1 && a.b <= f.b + 1;
      ok(`(a) ${lebar}: tinggi bingkai ${tinggiBingkai}`, Math.round(f.h) === tinggiBingkai, f.h);
      ok(
        `(a) ${lebar}: papan, legenda dan garis masa dalam bingkai`,
        dalam(p) && dalam(leg) && dalam(bw),
        { f, p, leg, bw },
      );
      ok(`(a) ${lebar}: legenda dan garis masa tidak bertindih`, !bertindih(leg, bw), { leg, bw });
      if (mn.display !== 'none')
        ok(`(a) ${lebar}: papan tidak bertindih dengan menu`, !bertindih(p, mn), { p, mn });
      if (lebar <= 640) ok('(a) 390: garis masa <= 64 px tinggi', bw.h <= 64, bw.h);
      ok(
        `(a) ${lebar}: tiada limpahan mendatar`,
        await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      );
      ok(`(a) ${lebar}: tiada ralat konsol`, m.masalah.length === 0, m.masalah);
      await m.page.close();
    }

    // ===== (ix) mudah alih 390: menu tersembunyi sehingga butang Lapisan ditekan =====
    {
      const m = await buka({ lebar: 390, tinggi: 900 });
      ok(
        '(ix) #cuacaMenu tersembunyi sebelum Lapisan ditekan',
        (await kotak(m.page, '#cuacaMenu')).display === 'none' ||
          (await kotak(m.page, '#petaMenu')).display === 'none',
      );
      await m.page.click('#petaMenuBtn');
      ok(
        '(ix) #cuacaMenu tampak selepas Lapisan ditekan',
        (await kotak(m.page, '#cuacaMenu')).w > 100,
      );
      await m.page.click('#cuacaMenu [data-lapisan="suhu"]');
      await tunggu(m.page, () => DASHBOARD_TEST.cuaca.aktif().utama === 'suhu');
      ok(
        '(ix) lapisan boleh diaktifkan dari menu mudah alih',
        (await aktif(m.page)).utama === 'suhu',
      );
      ok(
        '(ix) menu tertutup selepas memilih',
        (await kotak(m.page, '#petaMenu')).display === 'none',
      );
      await foto(m.page, '390-suhu');
      ok('(ix) tiada ralat konsol', m.masalah.length === 0, m.masalah);
      await m.page.close();
    }

    // ===== (kecil) butang kecilkan panel Lapisan Cuaca =====
    for (const tema of ['gelap', 'cerah']) {
      const m = await buka({ tema });
      const p = m.page;
      const T = `(kecil ${tema})`;
      const adaBtn = await p.$('#cuacaMenu #cuacaKecil');
      ok(`${T} butang wujud`, !!adaBtn);
      const sifat = () =>
        p.evaluate(() => {
          const b = document.querySelector('#cuacaKecil');
          const bt = document.querySelector('#cuacaMenu [data-lapisan="angin"]');
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          return {
            exp: b.getAttribute('aria-expanded'),
            lbl: b.getAttribute('aria-label'),
            ctl: b.getAttribute('aria-controls'),
            ctlAda: !!document.getElementById(b.getAttribute('aria-controls')),
            item: getComputedStyle(bt).visibility,
            kepalaV: r('.cuaca-menu-kepala').height > 0,
            tinggi: r('#cuacaMenu').height,
            cip: document.querySelector('#cuacaMenuCip').hidden
              ? ''
              : document.querySelector('#cuacaMenuCip').textContent,
            kepala: document.querySelector('.cuaca-menu-tajuk').textContent,
          };
        });
      const a = await sifat();
      ok(`${T} awal: terbuka`, a.exp === 'true' && a.lbl === 'Kecilkan panel lapisan', a);
      ok(`${T} aria-controls menuding elemen sedia ada`, a.ctl === 'cuacaSenarai' && a.ctlAda, a);
      ok(`${T} awal: item tampak, panel tinggi`, a.item === 'visible' && a.tinggi > 150, a);
      await togol(p, 'angin');
      await p.focus('#cuacaKecil');
      await p.keyboard.press('Enter');
      await sleep(500);
      const k = await sifat();
      ok(
        `${T} kecil: aria-expanded false, label Besarkan`,
        k.exp === 'false' && k.lbl === 'Besarkan panel lapisan',
        k,
      );
      ok(
        `${T} kecil: item tersembunyi, kepala tampak, tinggi kecil`,
        k.item === 'hidden' && k.kepalaV && k.tinggi < 50,
        k,
      );
      ok(`${T} kecil: cip lapisan aktif`, k.cip === 'Angin', k);
      ok(
        `${T} kecil: legenda masih berfungsi`,
        (await aktif(p)).utama === 'angin' && (await kotak(p, '#cuacaLegenda')).w > 50,
      );
      ok(
        `${T} kecil: fokus ring tampak pada butang`,
        await p.evaluate(() => {
          const b = document.querySelector('#cuacaKecil');
          return b.matches(':focus-visible') && getComputedStyle(b).outlineStyle !== 'none';
        }),
      );
      ok(
        `${T} tersimpan dalam localStorage`,
        (await p.evaluate(() => localStorage.getItem('fama_lapisan_kecil'))) === '1',
      );
      await p.reload({ waitUntil: 'load' });
      await p.waitForFunction(
        () =>
          window.DASHBOARD_TEST &&
          DASHBOARD_TEST.cuaca &&
          DASHBOARD_TEST.peta().lapisan.banjir &&
          document.querySelector('#cuacaMenu'),
        { timeout: 30000 },
      );
      await p.evaluate((t) => DASHBOARD_TEST.cuaca.tetapSekarang(t), T0);
      const r = await sifat();
      ok(
        `${T} selepas muat semula kekal kecil`,
        r.exp === 'false' && r.item === 'hidden' && r.tinggi < 50,
        r,
      );
      await p.click('.cuaca-menu-kepala .cuaca-menu-tajuk');
      await sleep(500);
      const e = await sifat();
      ok(
        `${T} klik pengepala membesarkan`,
        e.exp === 'true' && e.item === 'visible' && e.tinggi > 150,
        e,
      );
      await p.click('#cuacaKecil');
      await sleep(500);
      ok(`${T} klik butang mengecilkan semula`, (await sifat()).exp === 'false');
      await p.click('#cuacaKecil');
      await sleep(500);
      ok(
        `${T} besar: localStorage 0`,
        (await p.evaluate(() => localStorage.getItem('fama_lapisan_kecil'))) === '0',
      );
      await p.click('#cuacaMenu [data-lapisan="suhu"]');
      await tunggu(p, () => DASHBOARD_TEST.cuaca.aktif().utama === 'suhu');
      ok(`${T} pilih lapisan selepas kembang berfungsi`, (await aktif(p)).utama === 'suhu');
      ok(`${T} tiada ralat konsol`, m.masalah.length === 0, m.masalah);
      ok(`${T} tiada pelanggaran CSP`, (await p.evaluate(() => window.__csp)).length === 0);
      await p.close();
    }

    // ===== (x) keadaan ralat =====
    {
      const m = await buka({
        stub: { gridMeta: { status: 503 } },
        tapisKonsol: /Failed to load resource/,
      });
      await togol(m.page, 'suhu');
      ok(
        '(x) meta 503: butang tidak ditekan, lapisan tidak aktif',
        (await aktif(m.page)).utama === null &&
          !(await m.page.evaluate(() => DASHBOARD_TEST.cuaca.senaraiMenu())).find(
            (x) => x.id === 'suhu',
          ).ditekan,
      );
      ok(
        '(x) meta 503: mesej Malay dalam legenda',
        (await m.page.$eval('#cuacaLegenda', (e) => e.innerText)).includes(
          'Data cuaca belum tersedia. Cuba lagi sebentar.',
        ),
      );
      ok('(x) meta 503: tiada ralat konsol aplikasi', m.masalah.length === 0, m.masalah);
      await m.page.close();
    }
    {
      const m = await buka({ stub: { radar: { ...radarStub(), frames: [] } } });
      await togol(m.page, 'radar');
      const r = (await m.page.evaluate(() => DASHBOARD_TEST.cuaca.senaraiMenu())).find(
        (x) => x.id === 'radar',
      );
      ok('(x) radar frames [] : butang dilumpuhkan, tidak ditekan', r.dilumpuhkan && !r.ditekan, r);
      ok(
        '(x) radar frames [] : mesej Malay',
        (await m.page.$eval('#cuacaMenu [data-lapisan="radar"]', (e) => e.title)) ===
          'Radar tidak tersedia untuk Malaysia daripada sumber ini' &&
          (await m.page.$eval('#cuacaLegenda', (e) => e.innerText)).includes(
            'Radar tidak tersedia untuk Malaysia daripada sumber ini',
          ),
      );
      ok(
        '(x) radar kosong: garis masa tersembunyi',
        !(await m.page.evaluate(() => DASHBOARD_TEST.cuaca.bawahTampak())),
      );
      ok('(x) tiada ralat konsol', m.masalah.length === 0, m.masalah);
      await m.page.close();
    }
    {
      const m = await buka({ stub: { satelit: { ...satStub(), frames: [] } } });
      await togol(m.page, 'satelit');
      const r = (await m.page.evaluate(() => DASHBOARD_TEST.cuaca.senaraiMenu())).find(
        (x) => x.id === 'satelit',
      );
      ok(
        '(x) satelit kosong: dilumpuhkan dengan mesej Malay',
        r.dilumpuhkan &&
          (await m.page.$eval('#cuacaLegenda', (e) => e.innerText)).includes(
            'Satelit tidak tersedia buat masa ini',
          ),
        r,
      );
      await m.page.close();
    }
    {
      const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cuaca-grid-ombak-'));
      buatGrid({ dir: dir3, mula: GRID_MULA, ombak: 'gagal' });
      process.env.GRID_CACHE_DIR = dir3;
      const m = await buka();
      await togol(m.page, 'ombak');
      const o = (await m.page.evaluate(() => DASHBOARD_TEST.cuaca.senaraiMenu())).find(
        (x) => x.id === 'ombak',
      );
      ok(
        '(x) sumber ombak gagal: Ombak dilumpuhkan, tidak aktif',
        o.dilumpuhkan && !o.ditekan && (await aktif(m.page)).utama === null,
        o,
      );
      ok(
        '(x) ombak: mesej Data ombak tidak tersedia',
        (await m.page.$eval('#cuacaMenu [data-lapisan="ombak"]', (e) => e.title)) ===
          'Data ombak tidak tersedia',
      );
      await m.page.close();
      // fixture 30 jam: pilihan W yang tidak cukup dilumpuhkan
      const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'cuaca-grid-30-'));
      buatGrid({ dir: dir4, mula: GRID_MULA, bilJam: 30 });
      process.env.GRID_CACHE_DIR = dir4;
      const n = await buka();
      await togol(n.page, 'kumpulan');
      const w = await n.page.$$eval('#cuacaLegenda [data-w]', (b) =>
        b.map((x) => ({ w: x.dataset.w, d: x.disabled, t: x.title })),
      );
      ok(
        '(x) 30 jam, time0=10: W 24/48/72 dilumpuhkan "Data tidak mencukupi"; 3 dan 12 aktif',
        w
          .filter((x) => x.d)
          .map((x) => x.w)
          .join() === '24,48,72' &&
          w.filter((x) => x.d).every((x) => x.t === 'Data tidak mencukupi'),
        w,
      );
      ok(
        '(x) 30 jam: W jatuh ke pilihan terbesar yang ada (12)',
        (await aktif(n.page)).W === 12,
        await aktif(n.page),
      );
      ok(
        '(x) 30 jam: peluncur maks = min(72, 30-1-10-12) = 7',
        (await n.page.$eval('#cuacaSlider', (e) => e.max)) === '7',
      );
      await n.page.close();
      process.env.GRID_CACHE_DIR = dirGrid;
    }
    {
      const m = await buka({
        stub: { gridTitik: { status: 503 } },
        tapisKonsol: /Failed to load resource/,
      });
      await togol(m.page, 'suhu');
      await m.page.evaluate(() => DASHBOARD_TEST.cuaca.klikTitik(4, 105));
      await m.page.waitForSelector('.cuaca-popup');
      ok(
        '(x) titik 503: mesej dalam pop-up, tiada ralat konsol aplikasi',
        (await m.page.$eval('.cuaca-popup', (e) => e.innerText)).includes(
          'Nilai tidak dapat diambil. Cuba lagi.',
        ) && m.masalah.length === 0,
        m.masalah,
      );
      await m.page.close();
    }
    // ===== (v-b) gerakan dikurangkan: anak panah statik =====
    {
      const m = await buka({ kurangGerak: true });
      await togol(m.page, 'angin');
      await sleep(500);
      const z = await m.page.evaluate(() => DASHBOARD_TEST.cuaca.zarah());
      ok('(v-b) prefers-reduced-motion: anak panah statik, bukan zarah', z.mod === 'panah', z);
      ok('(v-b) tiada ralat konsol', m.masalah.length === 0, m.masalah);
      await m.page.close();
    }
    // ===== siklon dengan data: pop-up =====
    {
      const m = await buka({ stub: { siklon: siklonAda() } });
      await togol(m.page, 'siklon');
      const lg = await m.page.$eval('#cuacaLegenda [data-lapisan="siklon"]', (e) => e.innerText);
      ok(
        '(siklon) legenda tidak lagi menyatakan tiada siklon bila ada data',
        !lg.includes('Tiada siklon tropika aktif'),
        lg,
      );
      await m.page.evaluate(() => map.jumpTo({ center: [112, 12], zoom: 5 }));
      await sleep(1200);
      const t = await m.page.evaluate(() => {
        const p = map.project([112, 12]);
        const r = map.getContainer().getBoundingClientRect();
        return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
      });
      await m.page.evaluate(() =>
        document
          .querySelector('.map-svg-frame')
          .scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await sleep(300);
      const t2 = await m.page.evaluate(() => {
        const p = map.project([112, 12]);
        const r = map.getContainer().getBoundingClientRect();
        return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
      });
      await m.page.mouse.click(t2.x, t2.y);
      await m.page.waitForSelector('.cuaca-popup', { timeout: 8000 });
      const pt = await m.page.$eval('.cuaca-popup', (e) => ({
        teks: e.innerText,
        pautan: (e.querySelector('a') || {}).href,
      }));
      ok(
        '(siklon) pop-up: nama, kategori, angin dan pautan GDACS',
        pt.teks.includes('UJIAN-26') &&
          pt.teks.includes('Ribut Tropika') &&
          pt.teks.includes('93 km/j') &&
          /^https:\/\/www\.gdacs\.org\//.test(pt.pautan || ''),
        pt,
      );
      void t;
      ok('(siklon) tiada ralat konsol', m.masalah.length === 0, m.masalah);
      await m.page.close();
    }
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dirGrid, { recursive: true, force: true });
  }
  if (SHOTS) {
    console.log('Tangkapan skrin ditulis ke ' + SHOTS);
    return;
  }
  console.log(
    gagal.length
      ? 'GAGAL:\n' + gagal.join('\n')
      : 'OK: lapisan cuaca (10 lapisan, garis masa, mod, zarah, pemeriksa, reka letak, ralat) lulus',
  );
  process.exitCode = gagal.length ? 1 : 0;

  async function page_cuaca_sedia(p) {
    await p.waitForFunction(
      () =>
        DASHBOARD_TEST.cuaca.aktif().utama === 'angin' &&
        DASHBOARD_TEST.cuaca.aktif().tindih.includes('radar'),
      { timeout: 20000 },
    );
    await sleep(400);
  }
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

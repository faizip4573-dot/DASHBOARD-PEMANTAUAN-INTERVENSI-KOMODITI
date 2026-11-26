'use strict';
// Pop-up peta Pemantauan mesti sentiasa di atas penanda (PO, sentimen), label dan panel terapung.
// Diuji (gelap + cerah): pop-up Amaran Rasmi (laut), sentimen dan PO diletakkan di atas rangkaian penanda PO + sentimen
// tiruan; document.elementFromPoint pada banyak titik dalam kotak pop-up mesti terkena elemen DALAM pop-up;
// pop-up kekal dalam kotak peta; pop-up laut: paling banyak 3 kawasan laut + '+N kawasan laut lain' + 'Tunjuk semua';
// ringkasan negeri '+N negeri'; satu baris nota kaki; latar pop-up pekat.
// POPUP_SHOTS=<folder> menyimpan tangkapan skrin (popup-laut-<tema>-1440.png). Jalankan: node --no-warnings tests/frontend/popup-zindex.js
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
const SHOTS = process.env.POPUP_SHOTS || '';
const hariIni = (n) => new Date(Date.now() + 8 * 36e5 - n * 864e5).toISOString().slice(0, 10);
const jam = (ms) => new Date(Date.now() + ms * 36e5).toISOString();
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
    met(
      'AMARAN LAUT BERGELORA KATEGORI KEDUA',
      'Laut bergelora dijangka di kawasan perairan Pahang • Terengganu • Kelantan • Layang-Layang • Tioman • Samui • Phuket • Reef North • Reef South sehingga Isnin.',
      ['Pahang', 'Terengganu'],
    ),
    met(
      'AMARAN HUJAN LEBAT',
      'Hujan lebat di beberapa negeri.',
      ['Johor', 'Pahang', 'Terengganu', 'Kelantan', 'Selangor', 'Perak', 'Kedah'],
    ),
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
    ['tembikai', 'Tembikai', 'Merah', [{ negeri: 'Johor', daerah: 'Kulai' }]],
    ['terung', 'Terung', 'Kuning', [{ negeri: 'Kelantan', daerah: null }]],
  ].map(([id, label, band, lokasi], i) => ({
    ...asas,
    id: 9000 + i,
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
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'popup-z-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka(tema) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1300 });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (/AbortError/.test(m.text())) return;
      if (['error', 'warning'].includes(m.type())) masalah.push(`console.${m.type()}: ${m.text()}`);
    });
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
        famaAmaranRasmi().senarai.length === 2 &&
        window.FamaAmaranPeta &&
        FamaAmaranPeta.ujian().kumpulan.length >= 2 &&
        DASHBOARD_TEST.ewsState().muse === 'ready' &&
        document.querySelectorAll('.sent-marker').length > 0 &&
        document.querySelectorAll('.po-marker').length > 0,
      { timeout: 30000 },
    );
    await page.evaluate(() =>
      document.getElementById('map').scrollIntoView({ block: 'start', behavior: 'instant' }),
    );
    return { page, masalah };
  }
  // letakkan penanda PO + sentimen tiruan merentasi kotak pop-up supaya setiap titik ada penanda di bawah
  const tabur = (page) =>
    page.evaluate(() => {
      const pp = document.querySelector('.maplibregl-popup:not(.po-hover-popup)') || document.querySelector('.maplibregl-popup');
      const r = pp.getBoundingClientRect();
      const m = map.getContainer().getBoundingClientRect();
      for (let x = r.left - 20; x < r.right + 20; x += 24)
        for (let y = r.top - 20; y < r.bottom + 20; y += 24) {
          const e = document.createElement('div');
          e.className = (Math.round(x + y) % 2 ? 'po-marker status-merah' : 'sent-marker band-merah') + ' ujian-tabur';
          e.style.width = '26px';
          e.style.height = '26px';
          new maplibregl.Marker({ element: e })
            .setLngLat(map.unproject([x - m.left, y - m.top]))
            .addTo(map);
        }
    });
  // semua titik sampel dalam kotak pop-up mesti terkena elemen dalam pop-up
  const sentuh = (page) =>
    page.evaluate(() => {
      const pp = [...document.querySelectorAll('.maplibregl-popup')].pop();
      const r = pp.getBoundingClientRect();
      const m = map.getContainer().getBoundingClientRect();
      const kena = [];
      let jumlah = 0;
      for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9])
        for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          const e = document.elementFromPoint(x, y);
          jumlah++;
          if (!e || !pp.contains(e)) kena.push([Math.round(x), Math.round(y), e && e.className]);
        }
      const bg = getComputedStyle(pp.querySelector('.maplibregl-popup-content')).backgroundColor;
      return {
        jumlah,
        luar: kena,
        dalamPeta: r.left >= m.left - 1 && r.right <= m.right + 1 && r.top >= m.top - 1 && r.bottom <= m.bottom + 1,
        rect: [r.left, r.top, r.right, r.bottom].map(Math.round),
        peta: [m.left, m.top, m.right, m.bottom].map(Math.round),
        z: getComputedStyle(pp).zIndex,
        lebar: Math.round(r.width),
        tinggi: Math.round(r.height),
        bg,
      };
    });
  const bersih = (page) =>
    page.evaluate(() => {
      document.querySelectorAll('.ujian-tabur').forEach((e) => e.remove());
      document.querySelectorAll('.maplibregl-popup').forEach((e) => e.remove());
    });
  const sahSentuh = (T, nama, s) => {
    ok(`${T}${nama}: semua titik dalam pop-up terkena elemen pop-up`, s.luar.length === 0, s);
    ok(`${T}${nama}: z-index pop-up >= 10 dan latar pekat`, Number(s.z) >= 10 && /^rgb\(/.test(s.bg), s);
    ok(`${T}${nama}: pop-up dalam kotak peta`, s.dalamPeta, s);
  };

  try {
    for (const tema of ['gelap', 'cerah']) {
      const T = `[${tema}] `;
      const { page, masalah } = await buka(tema);
      // ---- Amaran Rasmi (laut) ----
      await page.evaluate(() => {
        const gr = FamaAmaranPeta.ujian().kumpulan.find((x) => x.jenis === 'laut');
        map.jumpTo({ center: [gr.lng, gr.lat], zoom: 6 });
        FamaAmaranPeta.bukaPopup(gr.kunci);
      });
      await sleep(600);
      await tabur(page);
      const pl = await page.evaluate(() => {
        const pp = document.querySelector('.maplibregl-popup .amaran-popup');
        const sen = pp.querySelector('.amaran-popup-laut-senarai');
        const btn = pp.querySelector('[data-act="amaran-peta-laut-semua"]');
        const nama = (t) => t.replace(/^Kawasan laut lain:\s*/, '').split(/,\s*/).filter(Boolean);
        const sebelum = nama(sen.textContent).length;
        const baki = pp.querySelector('.amaran-popup-baki');
        return {
          sebelum,
          baki: baki && baki.textContent.trim(),
          btn: btn && btn.textContent,
          nota: [...pp.querySelectorAll('.amaran-popup-nota')].map((e) => e.textContent),
          notaDiLuarSumber: !pp.querySelector('.banjir-popup-sumber'),
          aksi: [...pp.querySelectorAll('.amaran-popup-aksi')].map((a) =>
            [...a.children].map((c) => c.textContent),
          ),
          mukaTop: pp.getBoundingClientRect().width,
        };
      });
      ok(`${T}laut: paling banyak 3 kawasan laut`, pl.sebelum > 0 && pl.sebelum <= 3, pl);
      ok(`${T}laut: '+N kawasan laut lain' dan 'Tunjuk semua'`, /^\+\d+ kawasan laut lain$/.test(pl.baki || '') && pl.btn === 'Tunjuk semua', pl);
      ok(`${T}laut: satu nota kaki (tidak dipetakan + anggaran)`, pl.nota.length === 1 && /Tidak dipetakan: Reef North, Reef South/.test(pl.nota[0]) && /Kedudukan kawasan laut ialah anggaran/.test(pl.nota[0]) && pl.notaDiLuarSumber, pl);
      ok(`${T}laut: 'Lihat lagi' + 'Buka di Google Maps' satu baris`, pl.aksi.length === 1 && pl.aksi[0].join('|') === 'Lihat lagi|Buka di Google Maps', pl.aksi);
      sahSentuh(T, 'laut', await sentuh(page));
      const s1 = await sentuh(page);
      ok(`${T}laut: lebar <= 320px`, s1.lebar <= 322, s1.lebar);
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.evaluate(() => document.querySelectorAll('.ujian-tabur').forEach((e) => (e.style.display = '')));
        const b = await (await page.$('.map-svg-frame')).boundingBox();
        const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        await page.screenshot({
          path: path.join(SHOTS, `popup-laut-${tema}-1440.png`),
          clip: { x: Math.max(0, b.x) + sc.x, y: Math.max(0, b.y) + sc.y, width: Math.min(b.width, 1500), height: Math.min(b.height, 800) },
        });
      }
      await page.click('[data-act="amaran-peta-laut-semua"]');
      const ex = await page.evaluate(() => {
        const pp = document.querySelector('.maplibregl-popup .amaran-popup');
        const sen = pp.querySelector('.amaran-popup-laut-senarai').textContent;
        return {
          n: sen.replace(/^Kawasan laut lain:\s*/, '').split(/,\s*/).filter(Boolean).length,
          btn: pp.querySelector('[data-act="amaran-peta-laut-semua"]').textContent,
          bakiTersembunyi: pp.querySelector('.amaran-popup-baki').hidden,
        };
      });
      ok(`${T}laut: 'Tunjuk semua' mengembangkan senarai penuh`, ex.n > 3 && ex.btn === 'Tunjuk ringkas' && ex.bakiTersembunyi, ex);
      sahSentuh(T, 'laut (dikembangkan)', await sentuh(page));
      await bersih(page);

      // ---- Amaran Rasmi (7 negeri) ----
      await page.evaluate(() => {
        const L = famaAmaranRasmi().senarai;
        const i = L.findIndex((a) => /HUJAN LEBAT/.test(a.tajuk));
        const gr = FamaAmaranPeta.ujian().kumpulan.find((x) => x.idx.includes(i) && x.jenis === 'negeri');
        map.jumpTo({ center: [gr.lng, gr.lat], zoom: 6 });
        FamaAmaranPeta.bukaPopup(gr.kunci);
      });
      await sleep(600);
      await tabur(page);
      const ng = await page.evaluate(
        () => document.querySelector('.maplibregl-popup .amaran-popup-item[data-amaran] .alert-lok').textContent,
      );
      ok(`${T}negeri: ringkasan 'Johor, Pahang, Terengganu +4 negeri'`, ng === 'Johor, Pahang, Terengganu +4 negeri', ng);
      sahSentuh(T, 'amaran negeri', await sentuh(page));
      await bersih(page);

      // ---- Sentimen ----
      await page.evaluate(() => FamaSentimenPeta.terbangKe('tembikai'));
      await sleep(1500);
      ok(`${T}sentimen: pop-up terbuka`, await page.evaluate(() => !!document.querySelector('.maplibregl-popup .sent-popup')));
      await tabur(page);
      sahSentuh(T, 'sentimen', await sentuh(page));
      await bersih(page);

      // ---- PO (hover) ----
      await page.evaluate(() => {
        map.jumpTo({ center: [101.5, 4], zoom: 6 });
        const m = map.getContainer().getBoundingClientRect();
        const cx = m.left + m.width / 2;
        const cy = m.top + m.height / 2;
        const jarak = (e) => {
          const r = e.getBoundingClientRect();
          return Math.hypot(r.left - cx, r.top - cy);
        };
        const el = [...document.querySelectorAll('.po-marker:not(.ujian-tabur)')].sort(
          (a, b) => jarak(a) - jarak(b),
        )[0];
        el.dispatchEvent(new Event('mouseenter'));
      });
      await sleep(600);
      ok(`${T}PO: pop-up terbuka`, await page.evaluate(() => !!document.querySelector('.po-hover-popup')));
      await tabur(page);
      sahSentuh(T, 'PO', await sentuh(page));
      await bersih(page);
      ok(`${T}tiada ralat konsol`, masalah.length === 0, masalah);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: pop-up peta sentiasa di atas penanda dan dalam kotak peta');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

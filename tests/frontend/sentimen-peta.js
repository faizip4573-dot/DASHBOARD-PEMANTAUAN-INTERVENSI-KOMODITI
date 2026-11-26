'use strict';
// Lapisan Sentimen pada peta Pemantauan (src/js/lapisan-sentimen.js): item sentimen AI Muse bertanda lokasi ditanda pada peta.
// /api/muse distub dengan 6 item: daerah (Kulai/Johor), hanya negeri (Kelantan), dua lokasi (Kuala Selangor + Muar),
// dua item di daerah sama (Kulai), tanpa lokasi, nama tidak dapat dipadankan.
// Diuji: bilangan penanda, kumpulan + lencana, warna ikut band, kandungan pop-up, senarai -> peta (flyTo + pop-up),
// peta -> senarai (sorot), suis + simpanan, kekal selepas tukar peta asas, susunan di bawah penanda PO, legenda, tiada ralat konsol/CSP.
// SENT_SHOTS=<folder> menyimpan tangkapan skrin peta (sentimen-peta-<tema>-1440.png).
// SENT_ASLI=1 menggunakan data Muse sebenar (cache tempatan) dan hanya mencetak kiraan.
// Jalankan dari root: node --no-warnings tests/frontend/sentimen-peta.js
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
const SHOTS = process.env.SENT_SHOTS || '';
const ASLI = !!process.env.SENT_ASLI;
const hariIni = (n) => new Date(Date.now() + 8 * 36e5 - n * 864e5).toISOString().slice(0, 10);

// [id, label, band, risikoSemasa, risikoSebelum, indeks, lokasi]
const ITEM = [
  ['tembikai', 'Tembikai', 'Merah', 80, 60, -62, [{ negeri: 'Johor', daerah: 'Kulai' }]],
  ['terung', 'Terung', 'Kuning', 45, 45, 5, [{ negeri: 'Kelantan', daerah: null }]],
  [
    'telur',
    'Telur',
    'Hijau',
    10,
    20,
    30,
    [
      { negeri: 'Selangor', daerah: 'Kuala Selangor' },
      { negeri: 'Johor', daerah: 'Muar' },
    ],
  ],
  ['timun', 'Timun', 'Merah', 75, 70, -15, [{ negeri: 'Johor', daerah: 'Kulai' }]],
  ['kangkung', 'Kangkung', 'Hijau', 8, 8, 0, []],
  ['tomato', 'Tomato', 'Kuning', 40, 30, -20, [{ negeri: 'Johor', daerah: 'Tempat Rekaan' }]],
];

(async () => {
  pasangSemuaCache();
  if (!ASLI) pasangCacheMuse(buatFixtureMuse({ hari: julat(hariIni(7), hariIni(0)) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const nyata = await (await fetch(base + '/api/muse')).json();
  const stub = JSON.parse(JSON.stringify(nyata));
  const asas = nyata.rekod[nyata.rekod.length - 1];
  stub.rekod = ITEM.map(([id, label, band, sem, seb, idx, lokasi], i) => ({
    ...asas,
    id: 9000 + i,
    kunci: `${nyata.latestDate}|${id}`,
    tarikh: nyata.latestDate,
    komoditiId: id,
    komoditiLabel: label,
    nota: `${label}: nota ujian ${i}; lokasi disebut. Harga naik.`,
    band,
    risikoSemasa: sem,
    risikoSebelum: seb,
    indeksSentimen: idx,
    bilSampel: 20 + i,
    lokasi: lokasi.map((l) => ({ ...l, jenis: 'disebut', poId: null })),
  }));
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sent-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka({ tema = null, simpan = null, lebar = 1440, muse = stub } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: 1300 });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (/AbortError/.test(m.text())) return;
      if (['error', 'warning'].includes(m.type())) masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    await page.evaluateOnNewDocument(
      (t, s) => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) =>
          window.__csp.push(e.violatedDirective + ' ' + e.blockedURI),
        );
        try {
          if (!sessionStorage.getItem('__s')) {
            if (t) localStorage.setItem('fama_tema', t);
            if (s !== null) localStorage.setItem('fama_lapisan_sentimen', s);
          }
          sessionStorage.setItem('__s', '1');
        } catch {
          /* abaikan */
        }
      },
      tema,
      simpan,
    );
    await stubApi(page, {
      cuaca: buatFixture(),
      banjir: buatFixtureBanjir(),
      metmy: {
        versi: 1,
        fetchedAt: new Date().toISOString(),
        sumber: { status: 'ok' },
        amaran: [],
      },
      ...(ASLI ? {} : { muse }),
    });
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    await sedia(page);
    return { page, masalah };
  }
  const sedia = (page) =>
    page.waitForFunction(
      () =>
        window.DASHBOARD_TEST &&
        DASHBOARD_TEST.peta().gayaDimuat &&
        FamaDaerah.sedia() &&
        DASHBOARD_TEST.ewsState().muse === 'ready' &&
        FamaSentimenPeta.ujian().bilDipeta + FamaSentimenPeta.ujian().bilTakPeta >= 0 &&
        document.getElementById('petaSentimenBtn') &&
        (document.querySelectorAll('.sent-marker').length > 0 ||
          FamaSentimenPeta.ujian().bilDipeta === 0),
      { timeout: 30000 },
    );
  const U = (page) => page.evaluate(() => FamaSentimenPeta.ujian());
  async function foto(page, nama) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() =>
      document
        .querySelector('.map-svg-frame')
        .scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await sleep(900);
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
    if (ASLI) {
      const { page, masalah } = await buka();
      const u = await U(page);
      const items = await page.evaluate(() =>
        ewsMuseItems(museEwsState.data).map((r) => [
          r.komoditiLabel,
          r.band,
          JSON.stringify(r.lokasi),
        ]),
      );
      console.log(
        'ASLI: item minggu semasa',
        items.length,
        '| dipetakan',
        u.bilDipeta,
        '| tidak dipetakan',
        u.bilTakPeta,
        '| penanda',
        u.penanda.length,
      );
      console.log(JSON.stringify(items));
      console.log(JSON.stringify(u.penanda.map((p) => [p.nama, p.band, p.komoditi.join('+')])));
      console.log('masalah', masalah);
      await foto(page, 'asli');
      await browser.close();
      server.close();
      return;
    }

    // (1) penanda, kumpulan, kiraan
    const { page, masalah } = await buka();
    const u = await U(page);
    ok('(1) 4 item dipetakan', u.bilDipeta === 4, u.bilDipeta);
    ok('(1) 1 item tidak dipetakan', u.bilTakPeta === 1, u.bilTakPeta);
    ok('(1) 4 penanda (Kulai, Kelantan, Kuala Selangor, Muar)', u.penanda.length === 4, u.penanda);
    const dom = await page.$$eval('#map .sent-marker', (m) =>
      m.map((e) => ({ band: e.dataset.band, bil: Number(e.dataset.bil), kunci: e.dataset.kunci })),
    );
    ok('(1) 4 penanda DOM', dom.length === 4, dom);
    const kulai = u.penanda.find((p) => /Kulai/.test(p.nama));
    ok(
      '(1) Kulai: dua item dikumpulkan',
      kulai && kulai.komoditi.sort().join() === 'timun,tembikai'.split(',').sort().join(),
      kulai,
    );
    ok(
      '(1) lencana kiraan hanya pada kumpulan >1',
      (
        await page.$$eval('#map .sent-marker', (m) =>
          m.map((e) => [
            e.dataset.bil,
            e.querySelector('.sent-n') ? e.querySelector('.sent-n').textContent : null,
          ]),
        )
      ).every(([b, n]) => (Number(b) > 1 ? n === b : n === null)),
    );
    const kel = u.penanda.find((p) => p.jenis === 'negeri');
    ok('(1) negeri sahaja -> titik tengah negeri Kelantan', kel && /Kelantan/.test(kel.nama), kel);
    const pusatKelantan = await page.evaluate(() => {
      const f = FamaDaerah.semuaFitur().filter((x) => x.properties.negeri === 'Kelantan');
      return {
        lng: f.reduce((a, x) => a + x.properties.lon, 0) / f.length,
        lat: f.reduce((a, x) => a + x.properties.lat, 0) / f.length,
      };
    });
    ok(
      '(1) koordinat negeri = purata daerah negeri',
      kel &&
        Math.abs(kel.lng - pusatKelantan.lng) < 1e-6 &&
        Math.abs(kel.lat - pusatKelantan.lat) < 1e-6,
      { kel, pusatKelantan },
    );
    const klTitik = await page.evaluate(() => FamaDaerah.fitur('Johor', 'Kulai').properties);
    ok(
      '(1) koordinat Kulai = titik tengah daerah',
      kulai && Math.abs(kulai.lng - klTitik.lon) < 1e-6 && Math.abs(kulai.lat - klTitik.lat) < 1e-6,
    );
    ok(
      '(1) telur: dua penanda (Kuala Selangor, Muar)',
      u.penanda.filter((p) => p.komoditi.includes('telur')).length === 2,
    );
    ok(
      '(1) Kangkung dan Tomato tiada di peta',
      !u.penanda.some((p) => p.komoditi.includes('kangkung') || p.komoditi.includes('tomato')),
    );
    // posisi penanda sepadan lng/lat (dasar bubble = titik)
    const ralatPos = await page.evaluate(() => {
      const hasil = [];
      FamaSentimenPeta.ujian().penanda.forEach((p) => {
        const e = document.querySelector(`.sent-marker[data-kunci="${p.kunci}"]`);
        const pt = map.project([p.lng, p.lat]);
        const mb = map.getCanvas().getBoundingClientRect();
        const r = e.getBoundingClientRect();
        hasil.push(Math.hypot(r.left + r.width / 2 - (mb.left + pt.x), r.bottom - (mb.top + pt.y)));
      });
      return Math.max(...hasil);
    });
    ok('(1) penanda berlabuh pada titik (<3px)', ralatPos < 3, ralatPos);

    // (2) warna ikut band
    const warna = await page.evaluate(() => {
      const w = (v) => {
        const p = document.createElement('i');
        p.style.color = `var(${v})`;
        document.body.append(p);
        const c = getComputedStyle(p).color;
        p.remove();
        return c;
      };
      const pal = { merah: w('--red'), kuning: w('--yellow'), hijau: w('--green') };
      return [...document.querySelectorAll('#map .sent-marker')].map((e) => ({
        band: e.dataset.band,
        bg: getComputedStyle(e.querySelector('.sent-bubble')).backgroundColor,
        pal: pal[e.dataset.band],
      }));
    });
    ok(
      '(2) warna penanda = palet band',
      warna.every((x) => x.bg === x.pal),
      warna,
    );
    ok(
      '(2) Kulai merah (terburuk), Kelantan kuning, Kuala Selangor/Muar hijau',
      kulai.band === 'Merah' &&
        kel.band === 'Kuning' &&
        u.penanda.filter((p) => p.komoditi.includes('telur')).every((p) => p.band === 'Hijau'),
    );
    ok(
      '(2) Merah berdenyut (animasi) tanpa kurang-gerak',
      await page.$eval(
        '#map .sent-marker.band-merah',
        (e) => getComputedStyle(e, '::before').animationName !== 'none',
      ),
    );

    // (3) susunan: sentimen di bawah penanda PO, di atas kanvas peta
    const z = await page.evaluate(() => ({
      sent: getComputedStyle(document.querySelector('.sent-marker')).zIndex,
      po: getComputedStyle(document.querySelector('.po-marker')).zIndex,
      induk:
        document.querySelector('.sent-marker').parentElement ===
        document.querySelector('.po-marker').parentElement,
      atasKanvas: !!(
        document
          .querySelector('.maplibregl-canvas')
          .compareDocumentPosition(document.querySelector('.sent-marker')) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ),
    }));
    ok('(3) z-index sentimen < PO', Number(z.sent) < Number(z.po) && z.induk && z.atasKanvas, z);
    // PO menutup sentimen bila bertindih
    const tindih = await page.evaluate(() => {
      const po = document.querySelector('.po-marker');
      const s = document.querySelector('.sent-marker');
      const sr = s.getBoundingClientRect();
      const lama = po.parentElement.style.transform;
      const lng = map.unproject([0, 0]);
      void lng;
      po.style.position = 'absolute';
      po.style.left = sr.left - po.parentElement.getBoundingClientRect().left + 'px';
      po.style.top = sr.top - po.parentElement.getBoundingClientRect().top + 'px';
      po.style.transform = 'none';
      const e = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
      return {
        teratas:
          e && (e.closest('.po-marker') ? 'po' : e.closest('.sent-marker') ? 'sent' : e.className),
        lama,
      };
    });
    ok('(3) PO di atas sentimen bila bertindih', tindih.teratas === 'po', tindih);
    await page.evaluate(() => DASHBOARD_TEST.renderAll());
    await sleep(300);

    // (4) legenda + suis
    ok(
      '(4) butang "Sentimen (4)" bersebelahan Sempadan Daerah',
      (await page.$eval('#petaSentimenBtn', (b) => b.textContent)) === 'Sentimen (4)' &&
        (await page.$eval('#petaSentimenBtn', (b) => b.previousElementSibling.id)) ===
          'petaDaerahBtn',
    );
    ok(
      '(4) ditekan lalai',
      (await page.$eval('#petaSentimenBtn', (b) => b.getAttribute('aria-pressed'))) === 'true',
    );
    ok(
      '(4) legenda nampak',
      await page.$eval('#legendSentimen', (e) => !e.hidden && e.getBoundingClientRect().height > 0),
    );
    ok(
      '(4) tooltip menyebut item tidak dipetakan',
      /4 item dipetakan, 1 item tidak dipetakan/.test(
        await page.$eval('#petaSentimenBtn', (b) => b.title),
      ),
    );

    // (5) senarai -> peta: pin hanya pada item berlokasi dipetakan
    const pin = await page.$$eval('#ewsMuseBody .ews-sent-row', (r) =>
      r.map((e) => [e.dataset.kid, !!e.querySelector('.ews-sent-pin')]),
    );
    ok(
      '(5) pin pada tembikai/terung/telur/timun sahaja',
      pin
        .filter(([, p]) => p)
        .map(([k]) => k)
        .sort()
        .join() === 'telur,terung,tembikai,timun'.split(',').sort().join() && pin.length === 6,
      pin,
    );
    await page.click('#ewsTabSentimen');
    await page.evaluate(() => map.jumpTo({ center: [102.5, 4.2], zoom: 5.2 }));
    await sleep(300);
    await page.click('#ewsMuseBody .ews-sent-pin[data-kid="tembikai"]');
    await page.waitForSelector('.sent-popup', { timeout: 8000 });
    await page.waitForFunction(() => !map.isMoving(), { timeout: 8000 });
    const fly = await page.evaluate(() => {
      const k = FamaSentimenPeta.ujian().penanda.find((p) => /Kulai/.test(p.nama));
      const pt = map.project([k.lng, k.lat]);
      const c = map.getContainer();
      return {
        d: Math.abs(pt.x - c.clientWidth / 2) + Math.abs(pt.y - c.clientHeight * 0.8),
        z: map.getZoom(),
      };
    });
    ok('(5) flyTo ke Kulai', fly.d < 40 && fly.z >= 9 - 0.01, fly);
    const pop = await page.$eval('.sent-popup', (e) => ({
      teks: e.textContent,
      gm: e.querySelector('a.gmaps-link') && e.querySelector('a.gmaps-link').href,
      bil: e.querySelectorAll('.sent-item').length,
    }));
    ok('(5) pop-up 2 item (Kulai)', pop.bil === 2, pop);
    for (const [nama, re] of [
      ['komoditi Tembikai', /Tembikai/],
      ['komoditi Timun', /Timun/],
      ['band Merah', /Merah/],
      ['risiko semasa+perubahan', /risiko 80 ↑ \+20/],
      ['indeks + label', /Indeks sentimen\s*−62 \(sangat negatif\)/],
      ['sampel', /Sampel\s*20/],
      ['tarikh', /Tarikh\s*\d+ \w+ \d{4}/],
      ['lokasi disebut', /Lokasi disebut dalam nota: Kulai, Johor/],
      ['ringkasan', /Tembikai: nota ujian/],
      ['Lihat lagi', /Lihat lagi/],
      ['sumber', /Sumber: AI Muse · db-curated/],
      ['Google Maps', /Buka di Google Maps/],
    ])
      ok('(5) pop-up ' + nama, re.test(pop.teks), pop.teks);
    ok(
      '(5) pop-up sepenuhnya dalam kanvas peta',
      await page.evaluate(() => {
        const p = document
          .querySelector('.sent-popup-wrap .maplibregl-popup-content')
          .getBoundingClientRect();
        const m = map.getContainer().getBoundingClientRect();
        return (
          p.top >= m.top - 1 &&
          p.bottom <= m.bottom + 1 &&
          p.left >= m.left - 1 &&
          p.right <= m.right + 1
        );
      }),
    );
    ok('(5) pautan GMaps ke koordinat', pop.gm && /query=1\.\d+%2C103\.\d+/.test(pop.gm), pop.gm);
    ok(
      '(5) item disorot dalam senarai',
      await page.$eval('#ewsMuseBody [data-kid="tembikai"]', (e) =>
        e.classList.contains('ews-sent-sorot'),
      ),
    );

    // (6) "Lihat lagi": tukar ke tab Sentimen, sorot item
    await page.click('#ewsTabAmaran');
    await page.click('.sent-popup .sent-item[data-kid="timun"] .sent-lagi');
    const lagi = await page.evaluate(() => ({
      tab: DASHBOARD_TEST.ewsState().tab,
      sorot: [...document.querySelectorAll('.ews-sent-sorot')].map((e) => e.dataset.kid),
      nampak: (() => {
        const r = document.querySelector('.ews-sent-sorot').getBoundingClientRect();
        return r.height > 0;
      })(),
    }));
    ok(
      '(6) Lihat lagi -> tab Sentimen + sorot timun',
      lagi.tab === 'sentimen' && lagi.sorot.join() === 'timun' && lagi.nampak,
      lagi,
    );

    // (7) peta -> senarai: klik penanda Kuala Selangor menyorot telur; tutup pop-up buang sorotan
    await page.evaluate(() => map.jumpTo({ center: [101.4, 3.4], zoom: 8 }));
    await sleep(500);
    await page.evaluate(() => {
      const k = FamaSentimenPeta.ujian().penanda.find((p) => /Kuala Selangor/.test(p.nama));
      document.querySelector(`.sent-marker[data-kunci="${k.kunci}"]`).click();
    });
    await page.waitForSelector('.sent-popup', { timeout: 5000 });
    ok(
      '(7) klik penanda -> telur disorot',
      (await page.$$eval('.ews-sent-sorot', (e) => e.map((x) => x.dataset.kid).join())) === 'telur',
    );
    ok(
      '(7) pop-up Telur dengan lokasi Kuala Selangor',
      /Kuala Selangor, Selangor/.test(await page.$eval('.sent-popup', (e) => e.textContent)),
    );
    await page.evaluate(() => {
      const b = document.querySelector('.sent-popup-wrap .maplibregl-popup-close-button');
      b.scrollIntoView({ block: 'center' });
      b.click();
    });
    await sleep(200);
    ok(
      '(7) tutup pop-up buang sorotan',
      (await page.$$('.ews-sent-sorot')).length === 0,
      await page.evaluate(() => [
        document.querySelectorAll('.sent-popup').length,
        FamaSentimenPeta.ujian().popup,
      ]),
    );
    // negeri sahaja: pop-up menyatakan anggaran
    await page.click('#ewsMuseBody .ews-sent-pin[data-kid="terung"]');
    await page.waitForSelector('.sent-popup', { timeout: 5000 });
    ok(
      '(7) negeri sahaja: pop-up Kelantan (negeri), anggaran',
      /Kelantan \(negeri\)/.test(await page.$eval('.sent-popup', (e) => e.textContent)) &&
        /anggaran/.test(await page.$eval('.sent-popup', (e) => e.textContent)),
    );
    // klik penanda tidak membuka pop-up daerah
    ok('(7) tiada pop-up daerah serentak', (await page.$$('.daerah-popup')).length === 0);

    // (8) tukar peta asas: penanda kekal
    for (const k of ['satelit', 'jalan', 'lalai']) {
      await page.click(`#petaKawalan [data-asas="${k}"]`);
      await page.waitForFunction(
        (x) => DASHBOARD_TEST.peta().asas === x && DASHBOARD_TEST.peta().gayaDimuat,
        { timeout: 20000 },
        k,
      );
      await sedia(page);
      ok(
        `(8) ${k}: 4 penanda kekal`,
        (await page.$$eval('#map .sent-marker', (m) => m.filter((e) => !e.hidden).length)) === 4,
      );
    }

    await page.click('#ewsTabSentimen');
    // (9) suis: sembunyi, simpan, muat semula
    await page.click('#petaSentimenBtn');
    ok(
      '(9) off: penanda tersembunyi',
      (await page.$$eval(
        '#map .sent-marker',
        (m) => m.filter((e) => e.getBoundingClientRect().width > 0).length,
      )) === 0,
    );
    ok('(9) off: pop-up ditutup', (await page.$$('.sent-popup')).length === 0);
    ok('(9) off: legenda disembunyi', await page.$eval('#legendSentimen', (e) => e.hidden));
    ok(
      '(9) off: aria-pressed false, teks kekal Sentimen (4)',
      (await page.$eval(
        '#petaSentimenBtn',
        (b) => b.getAttribute('aria-pressed') + b.textContent,
      )) === 'falseSentimen (4)',
    );
    ok(
      '(9) localStorage 0',
      (await page.evaluate(() => localStorage.getItem('fama_lapisan_sentimen'))) === '0',
    );
    await page.reload({ waitUntil: 'load' });
    await sedia(page);
    ok(
      '(9) selepas muat semula kekal off',
      (await page.$eval('#petaSentimenBtn', (b) => b.getAttribute('aria-pressed'))) === 'false' &&
        (await page.$$eval(
          '#map .sent-marker',
          (m) => m.filter((e) => e.getBoundingClientRect().width > 0).length,
        )) === 0,
    );
    // pin dari senarai menghidupkan semula lapisan
    await page.click('#ewsTabSentimen');
    await page.click('#ewsMuseBody .ews-sent-pin[data-kid="telur"]');
    await page.waitForSelector('.sent-popup', { timeout: 5000 });
    ok(
      '(9) pin senarai menghidupkan semula lapisan',
      (await page.$eval('#petaSentimenBtn', (b) => b.getAttribute('aria-pressed'))) === 'true' &&
        (await page.evaluate(() => localStorage.getItem('fama_lapisan_sentimen'))) === '1',
    );
    ok(
      '(10) tiada ralat konsol / CSP',
      masalah.length === 0 && (await page.evaluate(() => window.__csp)).length === 0,
      {
        masalah,
        csp: await page.evaluate(() => window.__csp),
      },
    );
    await page.close();

    // (11) senarai tanpa lokasi: (0), tooltip, tiada pin, tiada penanda
    {
      const tanpa = JSON.parse(JSON.stringify(stub));
      tanpa.rekod.forEach((r) => (r.lokasi = []));
      const { page: p2, masalah: m2 } = await buka({ muse: tanpa });
      const b = await p2.$eval('#petaSentimenBtn', (e) => [e.textContent, e.title]);
      ok(
        '(11) Sentimen (0) + tooltip',
        b[0] === 'Sentimen (0)' && b[1] === 'Tiada sentimen berlokasi minggu ini',
        b,
      );
      ok(
        '(11) tiada penanda dan tiada pin',
        (await p2.$$('#map .sent-marker, .ews-sent-pin')).length === 0,
      );
      ok('(11) senarai kekal 6 item', (await p2.$$('#ewsMuseBody .ews-sent-row')).length === 6);
      ok('(11) tiada ralat', m2.length === 0, m2);
      await p2.close();
    }

    // (12) suis tersimpan 0 -> lalai off pada muatan pertama; tangkapan skrin
    for (const tema of ['gelap', 'cerah']) {
      const { page: p3, masalah: m3 } = await buka({ tema, simpan: '1' });
      await p3.evaluate(() => map.jumpTo({ center: [102.0, 3.6], zoom: 6.2 }));
      await sleep(900);
      await foto(p3, `sentimen-peta-${tema}-1440`);
      await p3.evaluate(() => FamaSentimenPeta.terbangKe('tembikai'));
      await sleep(1600);
      await foto(p3, `sentimen-peta-popup-${tema}-1440`);
      ok(`(12) ${tema}: tiada ralat`, m3.length === 0, m3);
      await p3.close();
    }
  } catch (e) {
    gagal.push('ralat ujian: ' + (e && e.stack ? e.stack : e));
  }
  await browser.close();
  server.close();
  if (gagal.length) {
    console.error('GAGAL sentimen-peta:\n - ' + gagal.join('\n - '));
    process.exit(1);
  }
  console.log('OK sentimen-peta');
  process.exit(0);
})();

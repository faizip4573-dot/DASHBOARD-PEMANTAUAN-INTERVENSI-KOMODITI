'use strict';
// Lapisan Sempadan Daerah (malaysia_district.geojson): sumber dimuat, lapisan wujud dan nampak secara lalai, suis + simpanan,
// kekal selepas tukar peta asas, klik poligon buka pop-up, susunan lapisan (di bawah amaran/banjir, di atas lapisan cuaca),
// peta Intervensi guna poligon sebenar bagi daerah PO. Tile distub (PNG 1x1).
// Tangkapan skrin: DAERAH_SHOTS=<folder> (+ DAERAH_ASLI=1 untuk tile sebenar).
// Jalankan dari root: node tests/frontend/daerah.js
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
const SHOTS = process.env.DAERAH_SHOTS || '';
const ASLI = !!process.env.DAERAH_ASLI;
const RAIN = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'rainviewer-maps.json'), 'utf8'),
);
const radarStub = () => ({
  versi: 1,
  atribusi: 'RainViewer',
  host: RAIN.host,
  fetchedAt: new Date().toISOString(),
  frames: RAIN.radar.past.map((f) => ({ time: f.time, path: f.path })),
});

(async () => {
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'daerah-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka({ tema = null, simpan = null } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1300 });
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
          if (t && !sessionStorage.getItem('__d')) localStorage.setItem('fama_tema', t);
          if (s !== null && !sessionStorage.getItem('__d'))
            localStorage.setItem('fama_lapisan_daerah_nasional', s);
          sessionStorage.setItem('__d', '1');
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
      radar: radarStub(),
      tileAsli: ASLI,
    });
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    await sedia(page);
    return { page, masalah };
  }
  const sedia = (page) =>
    page.waitForFunction(
      () =>
        window.DASHBOARD_TEST &&
        DASHBOARD_TEST.peta().lapisan.banjir &&
        FamaDaerah.ujian().dipasang &&
        DASHBOARD_TEST.peta().gayaDimuat,
      { timeout: 30000 },
    );
  // Susunan lapisan peta Pemantauan melalui getStyle (peta ialah `let map` global skrip klasik)
  const susunan = (page) => page.evaluate(() => map.getStyle().layers.map((l) => l.id));
  const vis = (page, id) =>
    page.evaluate((i) => (map.getLayer(i) ? map.getLayoutProperty(i, 'visibility') : null), id);
  async function foto(page, nama, sel = '.map-svg-frame') {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await sleep(ASLI ? 5000 : 800);
    await page.evaluate(
      (s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }),
      sel,
    );
    await sleep(600);
    const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const b = await (await page.$(sel)).boundingBox();
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
  async function tukar(page, kunci) {
    await page.click(`#petaKawalan [data-asas="${kunci}"]`);
    await page.waitForFunction(
      (k) => DASHBOARD_TEST.peta().asas === k && DASHBOARD_TEST.peta().gayaDimuat,
      { timeout: 20000 },
      kunci,
    );
    await sedia(page);
  }
  try {
    // (i) lalai: sumber dimuat, lapisan wujud dan nampak, butang ditekan
    const { page, masalah } = await buka();
    if (process.env.DAERAH_DEBUG) page.on('console', (m) => console.log('[konsol]', m.text()));
    const u = await page.evaluate(() => FamaDaerah.ujian());
    ok('(i) 159 daerah dimuat', u.bilFitur === 159, u);
    ok(
      '(i) sumber dan lapisan dipasang, suis nasional mati, bukan drill-down',
      u.dipasang && !u.tunjuk && !u.drill && !u.kelihatan,
      u,
    );
    for (const id of ['daerah-isi', 'daerah-denyut', 'daerah-garis', 'daerah-label'])
      ok(`(i) paparan Malaysia: ${id} tersembunyi`, (await vis(page, id)) === 'none');
    ok(
      '(i) butang Sempadan Daerah tidak ditekan + tooltip baharu',
      (await page.$eval('#petaDaerahBtn', (b) => b.getAttribute('aria-pressed'))) === 'false' &&
        (await page.$eval('#petaDaerahBtn', (b) => b.title)) ===
          'Papar sempadan daerah dalam paparan Malaysia (sentiasa dipaparkan selepas klik PO)',
    );
    ok(
      '(i) kunci lama fama_lapisan_daerah tidak dibaca',
      await page.evaluate(() => {
        localStorage.setItem('fama_lapisan_daerah', '1');
        return localStorage.getItem('fama_lapisan_daerah_nasional') === null;
      }),
    );
    // suis ON: tunjuk di paparan Malaysia, simpan di kunci baharu
    await page.evaluate(() => document.getElementById('petaDaerahBtn').click());
    for (const id of ['daerah-isi', 'daerah-garis', 'daerah-label'])
      ok(`(i) suis ON: ${id} nampak di paparan Malaysia`, (await vis(page, id)) === 'visible');
    ok(
      '(i) suis ON: simpan fama_lapisan_daerah_nasional=1',
      (await page.evaluate(() => localStorage.getItem('fama_lapisan_daerah_nasional'))) === '1',
    );
    ok(
      '(i) suis ON: butang ditekan',
      (await page.$eval('#petaDaerahBtn', (b) => b.getAttribute('aria-pressed'))) === 'true',
    );
    ok(
      '(i) label daerah minzoom 8',
      (await page.evaluate(() => map.getLayer('daerah-label').minzoom)) === 8,
    );
    // (ii) susunan: asas < daerah < amaran < banjir
    let s = await susunan(page);
    const pos = (id) => s.indexOf(id);
    ok(
      '(ii) susunan asas < daerah-isi < garis < label < amaran < banjir',
      pos('daerah-isi') > 0 &&
        pos('daerah-isi') < pos('daerah-garis') &&
        pos('daerah-garis') < pos('daerah-label') &&
        pos('daerah-label') < pos('amaran-cuaca-halo') &&
        pos('amaran-cuaca-halo') < pos('amaran-cuaca') &&
        pos('amaran-cuaca') < pos('banjir-stesen'),
      s,
    );
    ok(
      '(ii) penanda PO (DOM) kekal di atas kanvas',
      await page.evaluate(
        () =>
          document.querySelectorAll('#map .maplibregl-marker').length >= 15 &&
          DASHBOARD_TEST.peta().markerPO === 15,
      ),
    );
    // (iii) lapisan cuaca dipasang di bawah sempadan daerah
    await page.evaluate(() => {
      document.querySelector('#cuacaMenu [data-lapisan="radar"]').click();
    });
    await page.waitForFunction(() => DASHBOARD_TEST.cuaca.lapisanPeta().length > 0 || false, {
      timeout: 20000,
    });
    s = await susunan(page);
    const cuacaIds = await page.evaluate(() => DASHBOARD_TEST.cuaca.lapisanPeta().map((l) => l.id));
    ok('(iii) ada lapisan cuaca', cuacaIds.length > 0, cuacaIds);
    ok(
      '(iii) lapisan cuaca di bawah daerah-isi',
      cuacaIds.every((id) => s.indexOf(id) > 0 && s.indexOf(id) < s.indexOf('daerah-isi')),
      { cuacaIds, s },
    );
    await page.evaluate(() => {
      document.querySelector('#cuacaMenu [data-lapisan="radar"]').click();
    });
    await sleep(500);
    // (iv) klik poligon: pop-up dengan nama daerah, negeri, pautan Google Maps
    await page.evaluate(() => {
      map.jumpTo({ center: [101.52, 3.0], zoom: 9 });
    });
    await page.waitForFunction(() => map.loaded() && map.isStyleLoaded(), { timeout: 15000 });
    await sleep(500);
    const titik = await page.evaluate(() => {
      const q = FamaDaerah.fitur('Selangor', 'Kuala Langat').properties;
      const p = map.project([q.lon, q.lat]);
      const r = map.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    });
    await page.mouse.move(titik.x, titik.y);
    await sleep(500);
    ok(
      '(iv) hover: feature-state menyorot',
      await page.evaluate(
        () => map.getFeatureState({ source: 'daerah-sempadan', id: 'Kuala Langat' }).hover === true,
      ),
    );
    await page.mouse.click(titik.x, titik.y);
    await page.waitForSelector('.daerah-popup', { timeout: 8000 });
    if (process.env.DAERAH_SHOT)
      await (await page.$('.daerah-popup-gelap')).screenshot({ path: process.env.DAERAH_SHOT });
    const pop = await page.$eval('.daerah-popup', (e) => ({
      teks: e.textContent,
      gm: e.querySelector('a.gmaps-link') ? e.querySelector('a.gmaps-link').href : null,
    }));
    ok('(iv) pop-up nama daerah', /Daerah Kuala Langat/.test(pop.teks), pop.teks);
    ok('(iv) pop-up negeri', /Daerah Kuala Langat\s*Selangor/.test(pop.teks), pop.teks);
    ok(
      '(iv) pop-up senarai amaran harga',
      /Amaran harga|Tiada amaran harga|Tiada data harga/.test(pop.teks),
      pop.teks,
    );
    ok('(iv) pop-up PO penyelia', /PO penyelia \(FIS 2\.1\)/.test(pop.teks), pop.teks);
    ok(
      '(iv) pautan Google Maps ke titik tengah',
      !!pop.gm && /google\.com\/maps\/search\/\?api=1&query=\d/.test(pop.gm),
      pop.gm,
    );
    await foto(page, '1440-gelap-lalai-zum9');
    await page.evaluate(() => {
      map.fitBounds(FAMA_MAP_CONFIG.bounds, { padding: 20, duration: 0 });
    });
    // (v) togol sembunyi, simpan, muat semula
    await page.click('#petaMenuBtn').catch(() => {});
    await page.evaluate(() => document.getElementById('petaDaerahBtn').click());
    ok('(v) sembunyi: isi tersembunyi', (await vis(page, 'daerah-isi')) === 'none');
    ok('(v) sembunyi: label tersembunyi', (await vis(page, 'daerah-label')) === 'none');
    ok(
      '(v) simpan fama_lapisan_daerah_nasional=0',
      (await page.evaluate(() => localStorage.getItem('fama_lapisan_daerah_nasional'))) === '0',
    );
    ok('(v) pop-up ditutup bila disembunyi', (await page.$('.daerah-popup')) === null);
    await page.reload({ waitUntil: 'load' });
    await sedia(page);
    ok('(v) selepas muat semula kekal tersembunyi', (await vis(page, 'daerah-isi')) === 'none');
    ok(
      '(v) butang tidak ditekan',
      (await page.$eval('#petaDaerahBtn', (b) => b.getAttribute('aria-pressed'))) === 'false',
    );
    await page.evaluate(() => document.getElementById('petaDaerahBtn').click());
    ok('(v) tunjuk semula', (await vis(page, 'daerah-isi')) === 'visible');
    ok(
      '(v) simpan =1',
      (await page.evaluate(() => localStorage.getItem('fama_lapisan_daerah_nasional'))) === '1',
    );
    // suis ON + drill-down + kembali: kekal nampak; suis mati: drill-down paksa nampak (diuji di (x)/(xi))
    // (vi) kekal selepas tukar peta asas; susunan dan warna ikut asas/tema
    const garisGelap = await page.evaluate(() =>
      JSON.stringify(map.getPaintProperty('daerah-garis', 'line-color').at(-1)),
    );
    for (const k of ['satelit', 'terrain', 'jalan', 'lalai']) {
      await tukar(page, k);
      s = await susunan(page);
      ok(
        `(vi) ${k}: lapisan daerah kekal dan nampak`,
        (await vis(page, 'daerah-isi')) === 'visible',
      );
      ok(
        `(vi) ${k}: susunan daerah < amaran < banjir`,
        s.indexOf('daerah-label') > 0 &&
          s.indexOf('daerah-label') < s.indexOf('amaran-cuaca-halo') &&
          s.indexOf('amaran-cuaca') < s.indexOf('banjir-stesen'),
        s,
      );
      if (k === 'satelit') {
        ok(
          '(vi) satelit: garis putih',
          (await page.evaluate(() => map.getPaintProperty('daerah-garis', 'line-color').at(-1))) ===
            '#ffffff',
        );
        await foto(page, '1440-gelap-satelit');
      }
    }
    ok(
      '(vi) kembali lalai: warna garis asal',
      (await page.evaluate(() =>
        JSON.stringify(map.getPaintProperty('daerah-garis', 'line-color').at(-1)),
      )) === garisGelap,
    );
    // (vii) tukar tema menukar warna garis
    await page.click('.tema-toggle button[data-tema="cerah"]');
    await sleep(300);
    const garisCerah = await page.evaluate(() =>
      JSON.stringify(map.getPaintProperty('daerah-garis', 'line-color').at(-1)),
    );
    ok('(vii) warna garis berubah mengikut tema', garisCerah !== garisGelap, {
      garisGelap,
      garisCerah,
    });
    await foto(page, '1440-cerah-lalai');
    await page.evaluate(() => map.jumpTo({ center: [101.52, 3.3], zoom: 9 }));
    await foto(page, '1440-cerah-lalai-zum9');
    ok('(vii) tiada pelanggaran CSP', (await page.evaluate(() => window.__csp)).length === 0);
    ok('(vii) tiada ralat konsol Pemantauan', masalah.length === 0, masalah);
    await page.close();

    // (x) warna kawasan daerah = status titik amaran (Kota Baharu: PO kelantan)
    const st = await buka({ tema: 'gelap', simpan: '0' });
    const sp = st.page;
    ok(
      '(x) legenda nyatakan warna kawasan daerah',
      await sp.evaluate(() =>
        /Warna kawasan daerah = status harga/.test(
          document.querySelector('.map-legend').textContent,
        ),
      ),
    );
    const nasional = await sp.evaluate(() => FamaDaerah.statusDaerah());
    ok(
      '(x) paparan nasional: semua daerah PO berwarna',
      Object.keys(nasional).length >= 40,
      Object.keys(nasional).length,
    );
    ok('(x) paparan nasional lalai: isi tersembunyi', (await vis(sp, 'daerah-isi')) === 'none');
    await foto(sp, '1440-gelap-nasional-lalai');
    await sp.evaluate(() => DASHBOARD_TEST.selectPO('kelantan'));
    await sp.waitForFunction(() => document.querySelectorAll('.district-marker').length === 5, {
      timeout: 10000,
    });
    // Hover penanda daerah: pop-up gaya PO (nama, status, Google Maps, senarai amaran harga)
    await sp.hover('.district-marker');
    await sp.waitForSelector('.po-hover-popup .daerah-hover', { timeout: 5000 });
    const hv = await sp.$eval('.po-hover-popup .daerah-hover', (e) => e.innerText);
    ok(
      '(x) hover penanda daerah: pop-up nama, Google Maps dan amaran harga',
      /^Daerah /.test(hv) &&
        /Buka di Google Maps/.test(hv) &&
        /Amaran harga|Tiada amaran harga|Tiada data harga/.test(hv),
      hv,
    );
    if (process.env.DAERAH_SHOT)
      await (await sp.$('.po-hover-popup')).screenshot({ path: process.env.DAERAH_SHOT });
    await sp.mouse.move(5, 5);
    await sleep(600);
    for (const id of ['daerah-isi', 'daerah-garis', 'daerah-label'])
      ok(`(x) drill-down Kota Baharu: ${id} nampak`, (await vis(sp, id)) === 'visible');
    // lapisan baru dipaparkan: tunggu bingkai render menerapkan status (Kuala Krai di luar PO = neutral)
    await sp.waitForFunction(
      () => !map.getFeatureState({ source: 'daerah-sempadan', id: 'Kuala Krai' }).status,
      { timeout: 10000 },
    );
    ok(
      '(x) drill-down: isi daerah tanpa status tiada isian, garis lebih senyap',
      await sp.evaluate(() => {
        const o = map.getPaintProperty('daerah-isi', 'fill-opacity');
        const g = JSON.stringify(map.getPaintProperty('daerah-garis', 'line-opacity'));
        return o[o.length - 1] === 0 && /0\.45/.test(g);
      }),
    );
    const markerStatus = () =>
      sp.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('.district-marker')].map((e) => [
            e.dataset.daerah,
            /status-(\w+)/.exec(e.className)[1],
          ]),
        ),
      );
    const stateStatus = () =>
      sp.evaluate(() => {
        const o = {};
        for (const n of [
          'Kota Bharu',
          'Pasir Mas',
          'Bachok',
          'Pasir Puteh',
          'Tumpat',
          'Tanah Merah',
          'Kuala Krai',
        ])
          o[n] = map.getFeatureState({ source: 'daerah-sempadan', id: n }).status || null;
        return o;
      });
    let mk = await markerStatus();
    let fs_ = await stateStatus();
    const fs0 = fs_;
    ok(
      '(x) Kota Baharu: Kota Bharu ikut penanda dan Pasir Mas kelabu (fixture tiada harga)',
      fs_['Pasir Mas'] === 'kelabu' && fs_['Kota Bharu'] === mk['Kota Bharu'],
      fs_,
    );
    ok(
      '(x) Kota Baharu (FIS 2.1): Bachok kelabu; Tanah Merah (PO tambahan Machang) di luar PO terpilih = neutral',
      fs_.Bachok === 'kelabu' && fs_['Tanah Merah'] === null,
      fs_,
    );
    ok(
      '(x) warna kawasan sama dengan penanda daerah',
      Object.keys(mk).every((n) => fs_[n] === mk[n]),
      { mk, fs_ },
    );
    ok('(x) drill-down: daerah di luar PO tiada status (neutral)', fs_['Kuala Krai'] === null, fs_);
    ok(
      '(x) warna garis/isi guna ungkapan status',
      await sp.evaluate(
        () =>
          JSON.stringify(map.getPaintProperty('daerah-isi', 'fill-color')).includes(
            'feature-state',
          ) &&
          JSON.stringify(map.getPaintProperty('daerah-garis', 'line-color')).includes('#ff4e63'),
      ),
    );
    // denyut Kritikal
    const op = () =>
      sp.evaluate(() => JSON.stringify(map.getPaintProperty('daerah-denyut', 'fill-opacity')));
    const op1 = await op();
    await sleep(1700);
    ok('(x) kawasan Amaran harga (merah) tidak berdenyut', (await op()) === op1);
    await foto(sp, '1440-gelap-kota-baharu');
    // status berubah -> warna berubah (ubah status rekod harga Kota Bharu kepada merah, kemudian pulihkan)
    await sp.evaluate(() => {
      window.__rekodAsal = [];
      ['LADANG', 'RUNCIT'].forEach((p) =>
        HD.daerah[p]
          .filter((r) => r.po === 'kelantan')
          .forEach((r) => {
            window.__rekodAsal.push([r, r.status]);
            r.status = 'merah';
          }),
      );
      DASHBOARD_TEST.renderAll();
    });
    fs_ = await stateStatus();
    mk = await markerStatus();
    ok(
      '(x) data status berubah: Kota Bharu merah, lain kekal kelabu',
      fs_['Kota Bharu'] === 'merah' && fs_['Pasir Mas'] === 'kelabu',
      fs_,
    );
    ok(
      '(x) selepas ubah: sama dengan penanda',
      Object.keys(mk).every((n) => fs_[n] === mk[n]),
      { mk, fs_ },
    );
    await sp.evaluate(() => {
      window.__rekodAsal.forEach(([r, st]) => (r.status = st));
      DASHBOARD_TEST.renderAll();
    });
    // kekal selepas tukar peta asas
    for (const k of ['satelit', 'jalan', 'lalai']) {
      await tukar(sp, k);
      await sleep(300);
      const a = await stateStatus();
      ok(
        `(x) warna status kekal selepas peta asas ${k}`,
        JSON.stringify(a) === JSON.stringify(fs0),
        a,
      );
      if (k === 'satelit') await foto(sp, '1440-gelap-kota-baharu-satelit');
    }
    await sp.click('.tema-toggle button[data-tema="cerah"]');
    await sleep(400);
    await foto(sp, '1440-cerah-kota-baharu');
    ok('(x) tiada ralat konsol (status)', st.masalah.length === 0, st.masalah);
    await sp.close();
    // kurang gerak: tiada denyut
    const rg = await buka({ tema: 'gelap' });
    await rg.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await rg.page.evaluate(() => DASHBOARD_TEST.selectPO('kelantan'));
    await sleep(500);
    const r1 = await rg.page.evaluate(() =>
      JSON.stringify(map.getPaintProperty('daerah-denyut', 'fill-opacity')),
    );
    await sleep(700);
    const r2 = await rg.page.evaluate(() =>
      JSON.stringify(map.getPaintProperty('daerah-denyut', 'fill-opacity')),
    );
    ok('(x) prefers-reduced-motion: tiada denyut', r1 === r2);
    await rg.page.close();

    // (xi) klik penanda PO -> drill-down ke daerah seliaan (poligon sebenar), lapisan daerah + amaran cuaca HIDUP
    const dd = await buka({ tema: 'gelap', simpan: '0' });
    const dp = dd.page;
    await dp.evaluate(() => {
      const b = document.getElementById('petaAmaranBtn');
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    });
    const klikPO = async (idPO) => {
      const t = await dp.evaluate((id) => {
        const p = poById[id];
        const q = map.project([p.lon, p.lat]);
        const r = map.getCanvas().getBoundingClientRect();
        return { x: r.left + q.x, y: r.top + q.y };
      }, idPO);
      await dp.mouse.move(t.x, t.y);
      await dp.mouse.click(t.x, t.y);
    };
    const nasionalTeks = await dp.$eval('#mapMode', (e) => e.textContent);
    ok('(xi) mula: paparan nasional', /PETA MALAYSIA/.test(nasionalTeks), nasionalTeks);
    ok('(xi) mula: daerah tersembunyi', (await vis(dp, 'daerah-isi')) === 'none');
    ok(
      '(xi) amaran: lapisan tint amaran-daerah dipasang berasingan (tidak bergantung pada daerah-isi)',
      await dp.evaluate(
        () => !!map.getLayer('amaran-daerah-isi') && !!map.getSource('amaran-daerah'),
      ),
    );
    const SEL = {
      kelantan: ['Kota Bharu', 'Pasir Mas', 'Bachok', 'Tanah Merah'],
      johor: null,
    };
    for (const idPO of ['kelantan', 'johor']) {
      await dp.evaluate(() => document.getElementById('backMap').click());
      await sleep(1000);
      await dp.evaluate(() => map.fitBounds(MAP_BOUNDS, { padding: 20, duration: 0 }));
      await sleep(400);
      await klikPO(idPO);
      await sleep(1500);
      const r = await dp.evaluate((id) => {
        const b = map.getBounds();
        const po = poById[id];
        const dalam = po.districts.map((d) => {
          const f = FamaDaerah.fitur(po.negeri, d[0]);
          const k = f
            ? FamaDaerah.sempadan(f)
            : [
                [d[2], d[1]],
                [d[2], d[1]],
              ];
          return (
            b.getWest() <= k[0][0] + 1e-6 &&
            b.getEast() >= k[1][0] - 1e-6 &&
            b.getSouth() <= k[0][1] + 1e-6 &&
            b.getNorth() >= k[1][1] - 1e-6
          );
        });
        return {
          zoom: map.getZoom(),
          dalam,
          mode: document.getElementById('mapMode').textContent,
          po: state.po,
          popup: !!document.querySelector('.daerah-popup'),
          bil: po.districts.length,
        };
      }, idPO);
      ok(`(xi) ${idPO}: klik PO masuk drill-down`, r.po === idPO, r);
      ok(`(xi) ${idPO}: tajuk ZOOM: DAERAH SELIAAN`, /ZOOM: DAERAH SELIAAN/.test(r.mode), r);
      ok(
        `(xi) ${idPO}: klik PO papar lapisan daerah`,
        (await vis(dp, 'daerah-isi')) === 'visible' &&
          (await vis(dp, 'daerah-garis')) === 'visible' &&
          (await vis(dp, 'daerah-label')) === 'visible',
      );
      if (idPO === 'kelantan')
        ok(
          '(xi) kelantan: daerah seliaan berwarna status',
          await dp.evaluate(() =>
            ['Kota Bharu', 'Pasir Mas', 'Bachok'].every(
              (n) => !!map.getFeatureState({ source: 'daerah-sempadan', id: n }).status,
            ),
          ),
        );
      // PO Johor Baharu kini termasuk Mersing (jauh ke utara-timur), jadi pandangan muat lebih luas.
      const zumMin = idPO === 'johor' ? 7.5 : 8;
      ok(`(xi) ${idPO}: zum >= ${zumMin}`, r.zoom >= zumMin, r);
      ok(`(xi) ${idPO}: semua daerah seliaan dalam pandangan`, r.dalam.every(Boolean), r);
      ok(`(xi) ${idPO}: tiada pop-up daerah pada klik PO`, !r.popup, r);
      if (idPO === 'kelantan') {
        ok('(xi) kelantan: 5 daerah (FIS 2.1)', r.bil === 5, r);
        await foto(dp, '1440-gelap-klik-po-kota-baharu');
        // klik poligon jauh daripada penanda -> pop-up sahaja, drill-down tidak berubah
        const t = await dp.evaluate(() => {
          const q = FamaDaerah.fitur('Kelantan', 'Kuala Krai').properties;
          const p = map.project([q.lon, q.lat]);
          const rc = map.getCanvas().getBoundingClientRect();
          return { x: rc.left + p.x, y: rc.top + p.y };
        });
        await dp.evaluate(() => map.jumpTo({ center: [102.0, 5.5], zoom: 9 }));
        await sleep(600);
        const t2 = await dp.evaluate(() => {
          const q = FamaDaerah.fitur('Kelantan', 'Kuala Krai').properties;
          const p = map.project([q.lon, q.lat]);
          const rc = map.getCanvas().getBoundingClientRect();
          return { x: rc.left + p.x, y: rc.top + p.y };
        });
        await dp.mouse.click(t2.x, t2.y);
        await sleep(600);
        const r2 = await dp.evaluate(() => ({
          popup: !!document.querySelector('.daerah-popup'),
          po: state.po,
          mode: document.getElementById('mapMode').textContent,
        }));
        ok('(xi) klik poligon: pop-up dibuka', r2.popup, r2);
        ok(
          '(xi) klik poligon: drill-down tidak berubah',
          r2.po === 'kelantan' && /DAERAH SELIAAN/.test(r2.mode),
          r2,
        );
        void t;
      }
      await dp.evaluate(() => document.getElementById('backMap').click());
      await sleep(900);
      const nas = await dp.evaluate(() => ({
        po: state.po,
        mode: document.getElementById('mapMode').textContent,
        zoom: map.getZoom(),
      }));
      ok(
        `(xi) ${idPO}: butang kembali ke Malaysia`,
        nas.po === null && /PETA MALAYSIA/.test(nas.mode) && nas.zoom < 8,
        nas,
      );
      ok(
        `(xi) ${idPO}: kembali ke Malaysia sembunyi daerah`,
        (await vis(dp, 'daerah-isi')) === 'none' &&
          (await vis(dp, 'daerah-garis')) === 'none' &&
          (await vis(dp, 'daerah-label')) === 'none',
      );
    }
    ok('(xi) tiada ralat konsol drill-down', dd.masalah.length === 0, dd.masalah);
    void SEL;
    await dp.close();

    // (viii) Intervensi: pilih PO dengan daerah dipadankan -> poligon sebenar
    const iv = await buka({ tema: 'gelap' });
    await iv.page.click('#ivTabIv');
    await iv.page.waitForFunction(
      () => window.IV_TEST && IV_TEST.map() && IV_TEST.state().ui.mapReady,
      {
        timeout: 30000,
      },
    );
    const sumber = (p) =>
      p.evaluate(() => {
        const sr = IV_TEST.map().getSource('iv-districts');
        return sr
          ? sr.serialize().data.features.map((f) => ({
              ...f.properties,
              tipe: f.geometry.type,
              n: JSON.stringify(f.geometry.coordinates).length,
            }))
          : null;
      });
    // Tanpa PO: tiada poligon
    ok('(viii) tanpa PO tiada poligon', (await sumber(iv.page)).length === 0);
    const KES = {
      kedah: { sebenar: 5, anggaran: 0 }, // FIS 2.1: Kota Setar, Kubang Pasu, Padang Terap, Pendang, Pokok Sena
      perlis: { sebenar: 1, anggaran: 0 }, // FIS 2.1: Perlis (satu poligon)
      penang: { sebenar: 4, anggaran: 0 }, // FIS 2.1: Barat Daya + tiga Seberang Perai
      kelantan: { sebenar: 5, anggaran: 0 }, // FIS 2.1: Bachok, Kota Bharu, Pasir Mas, Pasir Puteh, Tumpat
      sabah: { sebenar: 18, anggaran: 1 }, // FIS 2.1: 18 daerah Sabah + Labuan; Membakut tiada poligon GeoJSON (anggaran)
    };
    for (const [po, jk] of Object.entries(KES)) {
      await iv.page.evaluate((id) => {
        const el = document.querySelector(`[data-iv-po="${id}"]`);
        el.click();
      }, po);
      await sleep(900);
      const f = await sumber(iv.page);
      const sebenar = f.filter((x) => !/anggaran/.test(x.name));
      const ang = f.filter((x) => /anggaran/.test(x.name));
      ok(
        `(viii) ${po}: poligon sebenar`,
        sebenar.length === jk.sebenar && ang.length === jk.anggaran,
        f.map((x) => x.name),
      );
      ok(
        `(viii) ${po}: tahap status poligon sah`,
        f.every((x) => ['kritikal', 'waspada', 'normal', 'tiada'].includes(x.lvl)),
        f.map((x) => x.lvl),
      );
      const bb = await iv.page.evaluate(() => {
        const b = IV_TEST.map().getBounds();
        return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      });
      ok(
        `(viii) ${po}: peta zum ke daerah (bukan seluruh Malaysia)`,
        bb[2] - bb[0] < (po === 'sabah' ? 12 : 6),
        bb,
      );
      if (po === 'kedah') await foto(iv.page, '1440-gelap-intervensi-kedah', '.iv-map-frame');
    }
    // daerah dipilih disorot (sel=1)
    ok('(viii) tiada ralat konsol Intervensi', iv.masalah.length === 0, iv.masalah);
    ok(
      '(viii) tiada pelanggaran CSP Intervensi',
      (await iv.page.evaluate(() => window.__csp)).length === 0,
    );
    await iv.page.close();

    // (ix) Intervensi tema cerah, tangkapan skrin
    if (SHOTS) {
      const c = await buka({ tema: 'cerah' });
      await c.page.click('#ivTabIv');
      await c.page.waitForFunction(
        () => window.IV_TEST && IV_TEST.map() && IV_TEST.state().ui.mapReady,
        {
          timeout: 30000,
        },
      );
      await c.page.evaluate(() => document.querySelector('[data-iv-po="kedah"]').click());
      await sleep(1000);
      await foto(c.page, '1440-cerah-intervensi-kedah', '.iv-map-frame');
      await c.page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(
    gagal.length
      ? 'GAGAL:\n' + gagal.join('\n')
      : 'OK: sempadan daerah (peta Pemantauan dan Intervensi) lulus',
  );
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

'use strict';
// Peta utama: tukar peta asas (lapisan tindihan kekal), pilihan diingati selepas muat semula, lapisan Amaran Rasmi
// (/api/met-malaysia distub), pautan Google Maps, kad Amaran Rasmi (sumber data.gov.my) dan CSP.
// Iframe radar luar telah dibuang (digantikan lapisan cuaca natif; lihat tests/frontend/lapisan-cuaca.js).
// Tile distub (PNG 1x1). Tangkapan skrin: PETA_SHOTS=<folder> PETA_ASLI=1 (tile sebenar).
// Jalankan dari root: node tests/frontend/peta.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const dg = require('../../api/_services/amaran-datagov.js');
const { buatFixture } = require('../helpers/cuaca-fixture.js');
const { buatFixtureBanjir, pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MENTAH = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'met-datagov-amaran.json'), 'utf8'),
);
const SHOTS = process.env.PETA_SHOTS || '';

// Amaran sampel sebenar: dua aktif (ribut petir, laut bergelora), satu tamat (hujan) dan satu ditanda pendua.
function fixtureDG() {
  const kini = Date.now();
  const iso = (ms) => new Date(ms + 8 * 36e5).toISOString().slice(0, 19) + '+08:00';
  const amaran = dg.normalisasi(MENTAH).map((a) => {
    const tamat = /HUJAN BERTERUSAN/.test(a.tajuk);
    return {
      ...a,
      dikeluarkan: iso(kini - 3 * 36e5),
      sah_dari: iso(kini - 2 * 36e5),
      sah_hingga: iso(kini + (tamat ? -36e5 : 20 * 36e5)),
      pendua: false,
    };
  });
  amaran.find((a) => /RIBUT PETIR/.test(a.tajuk)).pendua = true;
  return {
    versi: 1,
    fetchedAt: new Date().toISOString(),
    atribusi: dg.ATRIBUSI,
    sumber: { status: 'ok', mesej: '' },
    amaran,
  };
}

(async () => {
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'peta-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  const asli = !!process.env.PETA_ASLI;
  async function buka({ lebar = 1440, tinggi = 1300, tema = null, stubDG = fixtureDG() } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: tinggi });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      // AbortError: MapLibre membatalkan tile yang sedang diminta apabila peta asas ditukar (jangkaan).
      if (/AbortError/.test(m.text())) return;
      if (['error', 'warning'].includes(m.type())) masalah.push(`console.${m.type()}: ${m.text()}`);
    });
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
    await stubApi(page, {
      cuaca: buatFixture(),
      banjir: buatFixtureBanjir(),
      metmy: stubDG,
      tileAsli: asli,
    });
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
      () =>
        window.DASHBOARD_TEST &&
        DASHBOARD_TEST.peta().lapisan.banjir &&
        DASHBOARD_TEST.peta().lapisan.amaran,
      { timeout: 30000 },
    );
    return { page, masalah };
  }
  const info = (page) => page.evaluate(() => DASHBOARD_TEST.peta());
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
    await sleep(asli ? 5000 : 600);
    await page.evaluate(() =>
      document
        .querySelector('.map-svg-frame')
        .scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await sleep(600);
    const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    const b = await (await page.$('.map-svg-frame')).boundingBox();
    if (process.env.PETA_DEBUG)
      console.log(nama, JSON.stringify(b), JSON.stringify(page.viewport()));
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
    // (i) keadaan awal: lalai, tindihan dipasang, tiada iframe radar luar
    const { page, masalah } = await buka();
    let i = await info(page);
    ok('(i) peta asas lalai', i.asas === 'lalai' && !i.tiles, i);
    ok('(i) lapisan banjir dan amaran dipasang', i.lapisan.banjir && i.lapisan.amaran, i.lapisan);
    ok('(i) 15 penanda PO', i.markerPO === 15, i.markerPO);
    ok('(i) tiada iframe radar luar', (await page.$$('iframe')).length === 0);
    ok(
      '(i) tiada #petaRadar / butang radar',
      !(await page.$('#petaRadar')) && !(await page.$('#petaRadarBtn')),
    );
    ok(
      '(i) butang peta asas: 4 pilihan Lalai/Terrain/Jalan/Satelit',
      JSON.stringify(
        await page.$$eval('#petaKawalan [data-asas]', (b) => b.map((x) => x.textContent)),
      ) === JSON.stringify(['Lalai', 'Terrain', 'Jalan', 'Satelit']),
    );
    await foto(page, '1440-gelap-lalai');

    // (ii) tukar peta asas: sumber raster betul, tindihan dan penanda kekal, atribusi betul
    const JANGKAAN = {
      terrain: {
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
        maxzoom: 17,
        attr: 'OpenTopoMap (CC-BY-SA), © OpenStreetMap',
        host: /opentopomap\.org/,
      },
      jalan: {
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        maxzoom: 19,
        attr: '© OpenStreetMap contributors',
        host: /tile\.openstreetmap\.org/,
      },
      satelit: {
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        maxzoom: 19,
        attr: 'Esri, Maxar, Earthstar Geographics',
        host: /server\.arcgisonline\.com/,
      },
    };
    for (const [k, j] of Object.entries(JANGKAAN)) {
      await tukar(page, k);
      i = await info(page);
      ok(`(ii) ${k}: URL tile`, JSON.stringify(i.tiles) === JSON.stringify(j.tiles), i.tiles);
      ok(`(ii) ${k}: maxzoom`, i.maxzoom === j.maxzoom, i.maxzoom);
      ok(`(ii) ${k}: atribusi dalam sumber`, i.attribusi === j.attr, i.attribusi);
      await page
        .waitForFunction(
          (a) => document.querySelector('.maplibregl-ctrl-attrib').textContent.includes(a),
          { timeout: 5000 },
          j.attr,
        )
        .then(
          () => {},
          async () =>
            ok(
              `(ii) ${k}: atribusi dipaparkan`,
              false,
              await page.$eval('.maplibregl-ctrl-attrib', (e) => e.textContent),
            ),
        );
      ok(
        `(ii) ${k}: lapisan banjir + amaran kekal`,
        i.lapisan.banjir && i.lapisan.amaran && i.sumber.includes('banjir-stesen'),
        i,
      );
      ok(`(ii) ${k}: penanda PO kekal`, i.markerPO === 15, i.markerPO);
      ok(`(ii) ${k}: data banjir kekal`, i.fiturBanjir > 0, i.fiturBanjir);
      await page.waitForFunction((n) => true, {}, 0);
      await sleep(500);
      ok(
        `(ii) ${k}: tile diminta daripada hos betul`,
        page.tileUrls.some((u) => j.host.test(u)),
        page.tileUrls.slice(0, 3),
      );
      ok(
        `(ii) ${k}: butang ditekan`,
        (await page.$eval(`[data-asas="${k}"]`, (b) => b.getAttribute('aria-pressed'))) === 'true',
      );
      await foto(page, `1440-gelap-${k}`);
    }
    // tukar semula ke Lalai: sumber raster dibuang, tindihan kekal
    await tukar(page, 'lalai');
    i = await info(page);
    ok('(ii) lalai semula: tiada sumber peta-asas', !i.sumber.includes('peta-asas'), i.sumber);
    ok('(ii) lalai semula: tindihan kekal', i.lapisan.banjir && i.lapisan.amaran, i.lapisan);

    // (iii) pilihan diingati selepas muat semula
    await tukar(page, 'satelit');
    ok(
      '(iii) localStorage fama_peta_asas',
      (await page.evaluate(() => localStorage.getItem('fama_peta_asas'))) === 'satelit',
    );
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => window.DASHBOARD_TEST && DASHBOARD_TEST.peta().lapisan.amaran,
      {
        timeout: 30000,
      },
    );
    i = await info(page);
    ok('(iii) satelit dikekalkan selepas muat semula', i.asas === 'satelit' && !!i.tiles, i);
    ok(
      '(iii) butang Satelit ditekan',
      (await page.$eval('[data-asas="satelit"]', (b) => b.getAttribute('aria-pressed'))) === 'true',
    );
    ok('(iii) lapisan banjir dipasang selepas muat semula', i.lapisan.banjir, i.lapisan);
    await page.evaluate(() => localStorage.setItem('fama_peta_asas', 'tidak-sah'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => window.DASHBOARD_TEST && DASHBOARD_TEST.peta().lapisan.amaran,
      {
        timeout: 30000,
      },
    );
    ok('(iii) nilai tidak sah -> lalai', (await info(page)).asas === 'lalai');
    await tukar(page, 'lalai');

    // (iv) lapisan Amaran Rasmi (satu sumber dengan panel Rasmi; ujian terperinci: tests/frontend/amaran-peta.js)
    i = await info(page);
    const panelTag = await page.$eval('#metAlertTag', (e) => e.textContent.trim());
    const mt = /^(\d+) aktif · (\d+) terkini$/.exec(panelTag);
    ok('(iv) tag panel Rasmi berformat N aktif · M terkini', !!mt, panelTag);
    ok('(iv) ada titik amaran pada peta', i.fiturAmaran.length > 0, i.fiturAmaran.length);
    const teksBtn = await page.$eval('#petaAmaranBtn', (b) => b.textContent);
    ok(
      '(iv) butang Amaran Rasmi: kiraan sama dengan panel',
      !!mt && teksBtn === `Amaran Rasmi (${mt[1]} aktif)`,
      [panelTag, teksBtn],
    );
    await page.click('#petaAmaranBtn');
    ok(
      '(iv) togol mematikan lapisan',
      (await info(page)).lapisan.amaranTunjuk === 'none' &&
        (await page.$eval('#petaAmaranBtn', (b) => b.getAttribute('aria-pressed'))) === 'false',
    );
    await page.click('#petaAmaranBtn');
    ok('(iv) togol menghidupkan semula', (await info(page)).lapisan.amaranTunjuk === 'visible');
    const pop = await page.evaluate(() => {
      const k = FamaAmaranPeta.ujian().kumpulan.find((g) => g.jenis !== 'laut');
      const p = FamaAmaranPeta.bukaPopup(k.kunci);
      const n = p && p.getElement();
      const a = n && n.querySelector('.gmaps-link');
      return (
        n && {
          k,
          teks: n.innerText,
          href: a && a.getAttribute('href'),
          target: a && a.target,
          rel: a && a.rel,
          lagi: !!n.querySelector('.alert-more'),
        }
      );
    });
    ok('(iv) pop-up amaran dibuka', !!pop && /Amaran Rasmi · /.test(pop.teks), pop);
    ok(
      '(iv) pop-up: tajuk, tempoh sah, sumber',
      pop && /Sah hingga/.test(pop.teks) && /Sumber: /.test(pop.teks),
      pop && pop.teks,
    );
    ok('(iv) pop-up: Lihat lagi', pop && pop.lagi);
    ok(
      '(iv) pop-up: Google Maps href (titik kumpulan)',
      pop &&
        pop.href ===
          'https://www.google.com/maps/search/?api=1&query=' +
            encodeURIComponent(pop.k.lat + ',' + pop.k.lng),
      pop && [pop.href, pop.k],
    );
    ok(
      '(iv) pop-up: target=_blank rel=noopener noreferrer',
      pop && pop.target === '_blank' && pop.rel === 'noopener noreferrer',
      pop,
    );
    await foto(page, '1440-gelap-amaran');

    // (v) kad Amaran Rasmi: sumber data.gov.my tanpa pendua
    const kad = await page.evaluate(() =>
      DASHBOARD_TEST.senaraiAmaranRasmi()
        .filter((a) => a.sumber === 'MET Malaysia (data.gov.my)')
        .map((a) => a.tajuk),
    );
    ok('(v) kad: 3 amaran data.gov.my (pendua ribut petir disisih)', kad.length === 3, kad);
    ok('(v) kad: tiada ribut petir pendua', !kad.some((t) => /RIBUT PETIR/.test(t)), kad);
    ok(
      '(v) kad memaparkan label sumber',
      (await page.$eval('#metAlertBody', (e) => e.innerText)).includes(
        'MET Malaysia (data.gov.my)',
      ),
    );
    const susunan = await page.evaluate(() =>
      DASHBOARD_TEST.senaraiAmaranRasmi().map((a) => (a.aktif ? 1 : 0)),
    );
    ok(
      '(v) aktif dahulu, Tamat kemudian',
      susunan.join('') ===
        susunan
          .slice()
          .sort((x, y) => y - x)
          .join(''),
      susunan,
    );

    // (vi) tiada iframe radar luar dan CSP tidak membenarkan bingkai luar
    const cspPeta = await page.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    );
    ok(
      '(vi) CSP meta tiada frame-src dan tiada hos radar luar',
      !/frame-src|windy/i.test(cspPeta),
      cspPeta,
    );
    ok(
      '(vi) kawalan peta tiada teks radar luar',
      !/windy/i.test(await page.$eval('#petaKawalan', (e) => e.innerText)),
    );

    // (vii) Google Maps dalam pop-up PO (hover) dan stesen JPS
    const po = await page.evaluate(() => {
      const p = DASHBOARD_TEST.DATA.po[0];
      return { id: p.id, lat: p.lat, lon: p.lon };
    });
    // Pop-up amaran (klik) kini di atas penanda; tutup dahulu supaya hover mengena penanda PO.
    await page.evaluate(() =>
      document.querySelectorAll('.maplibregl-popup:not(.po-hover-popup)').forEach((e) => e.remove()),
    );
    await page.hover('.po-marker');
    await page.waitForSelector('.po-hover-popup .gmaps-link');
    const gl = await page.$eval('.po-hover-popup .gmaps-link', (a) => ({
      href: a.getAttribute('href'),
      target: a.target,
      rel: a.rel,
    }));
    const ph = await page.evaluate(() => {
      const el = document.querySelector('.po-hover-popup .ph-name');
      const p = DASHBOARD_TEST.DATA.po.find((x) => x.name === el.textContent);
      return { lat: p.lat, lon: p.lon };
    });
    ok(
      '(vii) pop-up PO: href Google Maps betul',
      gl.href ===
        'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(`${ph.lat},${ph.lon}`),
      [gl, ph],
    );
    ok(
      '(vii) pop-up PO: target + rel',
      gl.target === '_blank' && gl.rel === 'noopener noreferrer',
      gl,
    );
    // kursor boleh bergerak ke pop-up tanpa ia hilang
    const kotak = await (await page.$('.po-hover-popup .gmaps-link')).boundingBox();
    await page.mouse.move(kotak.x + 3, kotak.y + 3, { steps: 8 });
    await sleep(500);
    ok(
      '(vii) pop-up PO kekal bila kursor di atasnya',
      !!(await page.$('.po-hover-popup .gmaps-link')),
    );
    const st = await page.evaluate(() => {
      const p = DASHBOARD_TEST.bukaPopupStesen(
        { nama: 'UJI', statusRasmi: 'Waspada', parasAir: 3, lat: 3.1234, lon: 101.5678 },
        [101.5, 3.1],
      );
      const a = p.getElement().querySelector('.gmaps-link');
      return a && a.getAttribute('href');
    });
    ok(
      '(vii) pop-up stesen JPS: koordinat stesen',
      st === 'https://www.google.com/maps/search/?api=1&query=3.1234%2C101.5678',
      st,
    );

    ok(
      'tiada pelanggaran CSP',
      (await page.evaluate(() => window.__csp)).length === 0,
      await page.evaluate(() => window.__csp),
    );
    ok('tiada ralat/amaran konsol', masalah.length === 0, masalah);
    await page.close();

    // (viii) tema cerah 1440: tangkapan skrin
    if (SHOTS) {
      const c = await buka({ tema: 'cerah' });
      await foto(c.page, '1440-cerah-lalai');
      for (const k of ['terrain', 'jalan', 'satelit']) {
        await tukar(c.page, k);
        await foto(c.page, `1440-cerah-${k}`);
      }
      await c.page.close();
    }

    // (ix) 390px: kawalan runtuh jadi satu butang 'Lapisan'
    for (const tema of SHOTS ? ['gelap', 'cerah'] : ['gelap']) {
      const m = await buka({ lebar: 390, tinggi: 844, tema });
      const lihat = (s) => m.page.$eval(s, (e) => getComputedStyle(e).display);
      ok('(ix) butang Lapisan kelihatan', (await lihat('#petaMenuBtn')) !== 'none');
      ok('(ix) menu tersembunyi sebelum dibuka', (await lihat('#petaMenu')) === 'none');
      await foto(m.page, `390-${tema}-lalai`);
      await m.page.click('#petaMenuBtn');
      ok('(ix) menu terbuka', (await lihat('#petaMenu')) !== 'none');
      ok(
        '(ix) aria-expanded',
        (await m.page.$eval('#petaMenuBtn', (b) => b.getAttribute('aria-expanded'))) === 'true',
      );
      await foto(m.page, `390-${tema}-menu`);
      for (const k of ['terrain', 'jalan', 'satelit']) {
        await tukar(m.page, k);
        await foto(m.page, `390-${tema}-${k}`);
      }
      ok(
        '(ix) tiada limpahan mendatar',
        await m.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      );
      ok('(ix) tiada ralat konsol', m.masalah.length === 0, m.masalah);
      await m.page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(
    gagal.length
      ? 'GAGAL:\n' + gagal.join('\n')
      : 'OK: peta (asas, amaran, Google Maps, tanpa iframe radar) lulus',
  );
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

'use strict';
// Lapisan peta "Amaran Rasmi" mesti sama dengan senarai panel EWS > Amaran Rasmi (satu sumber kebenaran).
// Sumber amaran distub (MET api, data.gov.my, JPS) -> panel menunjukkan 6 item: BAHAYA aktif (3 negeri, 4 daerah),
// UMUM aktif (negeri yang sama, Sabah), WASPADA tamat, BURUK aktif (laut sahaja, 2 kawasan laut), satu laut tamat, satu data.gov.my.
// Disemak: peta hanya menunjukkan amaran AKTIF; satu penanda setiap negeri (dikumpul, lencana kiraan, warna tertinggi);
// satu penanda laut; daerah bernama diwarnakan (poligon); tiada penanda tamat/pin item tamat; label togol = bilangan aktif;
// panel -> peta (flyTo + pop-up), pop-up 'Lihat lagi' -> sorotan panel, kekal selepas tukar peta asas, tema gelap + cerah.
// Tangkapan skrin: AMARAN_SHOTS=<folder>. Jalankan dari root: node tests/frontend/amaran-peta.js
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
const SHOTS = process.env.AMARAN_SHOTS || '';

const jam = (ms) => new Date(Date.now() + ms * 36e5).toISOString();
const met = (tajuk, teks, negeri, lalu, hingga) => ({
  jenis: 'x',
  tajuk,
  teks,
  negeri,
  dikeluarkan: jam(-lalu),
  sah_dari: jam(-lalu),
  sah_hingga: jam(hingga),
  aktif: hingga > 0,
});
function fixtureCuaca() {
  const c = buatFixture();
  c.amaran = [
    met(
      'AMARAN RIBUT PETIR BAHAYA',
      'Ribut petir dijangka di negeri Sarawak: Limbang • Sabah: Sandakan (Telupid dan Paitan), Kudat • Perak: Kinta sehingga 3:00 Petang.',
      ['Sabah', 'Sarawak', 'Perak'],
      1,
      5,
    ),
    met('AMARAN HUJAN', 'Hujan dijangka di Sabah.', ['Sabah'], 2, 6),
    met('AMARAN WASPADA HUJAN', 'Hujan di Kelantan.', ['Kelantan'], 30, -20),
    met(
      'AMARAN LAUT BERGELORA KATEGORI KEDUA',
      'Laut bergelora dijangka di kawasan perairan Pahang • Terengganu • Reef North sehingga Isnin.',
      ['Pahang', 'Terengganu'],
      3,
      8,
    ),
    met(
      'AMARAN ANGIN KENCANG DAN LAUT BERGELORA',
      'Angin kencang di perairan tertentu.',
      ['Johor'],
      40,
      -30,
    ),
  ];
  return c;
}
function fixtureDG() {
  const a = {
    id: 'dg1',
    jenis: 'Amaran Hujan',
    tajuk: 'AMARAN BURUK HUJAN BERTERUSAN',
    tahap: 'BURUK',
    teks: 'Hujan berterusan dijangka di Kedah.',
    negeri: ['Kedah'],
    dikeluarkan: jam(-4),
    sah_dari: jam(-4),
    sah_hingga: jam(9),
    pendua: false,
  };
  return {
    versi: 1,
    fetchedAt: new Date().toISOString(),
    atribusi: 'data.gov.my',
    sumber: { status: 'ok', mesej: '' },
    amaran: [a, { ...a, id: 'dg2', tajuk: 'AMARAN BURUK DUPLIKAT', pendua: true }],
  };
}

(async () => {
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'amaran-peta-')),
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
    const bj = buatFixtureBanjir();
    bj.amaran = [];
    bj.amaranSejarah = [];
    await stubApi(page, { cuaca: fixtureCuaca(), banjir: bj, metmy: fixtureDG() });
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
      () => {
        const l = window.famaAmaranRasmi && famaAmaranRasmi().senarai;
        return (
          l &&
          l.length === 6 &&
          window.FamaAmaranPeta &&
          FamaAmaranPeta.ujian().fitur.length >= 5 &&
          document.querySelectorAll('#metAlertBody .amaran-pin').length
        );
      },
      { timeout: 30000 },
    );
    return { page, masalah };
  }
  const uji = (page) => page.evaluate(() => FamaAmaranPeta.ujian());
  const moveend = (page) =>
    page.evaluate(
      () =>
        new Promise((r) => {
          const t = setTimeout(r, 6000);
          map.once('idle', () => {
            clearTimeout(t);
            r();
          });
        }),
    );
  async function sahPanel(page, tema) {
    const p = await page.evaluate(() => {
      const L = famaAmaranRasmi().senarai;
      const warnaChip = (el) => getComputedStyle(el).color;
      const item = [...document.querySelectorAll('#metAlertBody .alert-item[data-amaran]')].map(
        (el) => ({
          i: Number(el.dataset.amaran),
          tahap: el.querySelector('.alert-tahap').textContent,
          warna: warnaChip(el.querySelector('.alert-tahap')),
          aktif: el.querySelector('.alert-chip').textContent === 'Aktif',
          pin: !!el.querySelector('.amaran-pin'),
          takpeta: !!el.querySelector('.amaran-takpeta'),
        }),
      );
      return {
        n: L.length,
        tag: document.getElementById('metAlertTag').textContent.trim(),
        btn: document.getElementById('petaAmaranBtn').textContent,
        item,
        tajuk: L.map((a) => a.tajuk),
      };
    });
    const T = `[${tema}] `;
    const aktif = p.item.filter((x) => x.aktif).length;
    const RANK = ['BAHAYA', 'BURUK', 'WASPADA', 'UMUM'];
    ok(T + 'panel: 6 item (5 MET + 1 data.gov.my tanpa pendua)', p.n === 6 && p.item.length === 6, p);
    ok(T + 'panel: tag 4 aktif · 6 terkini', aktif === 4 && p.tag === `${aktif} aktif · 6 terkini`, p.tag);
    ok(T + 'togol: label = bilangan aktif panel', p.btn === `Amaran Rasmi (${aktif} aktif)`, [p.btn, p.tag]);
    const tahap = Object.fromEntries(p.item.map((x) => [x.i, x.tahap + (x.aktif ? '/aktif' : '/tamat')]));
    const vals = Object.values(tahap);
    ok(T + 'panel: ada BAHAYA aktif, UMUM aktif, WASPADA tamat', ['BAHAYA/aktif', 'UMUM/aktif', 'WASPADA/tamat'].every((v) => vals.includes(v)), tahap);
    const u = await uji(page);
    const pin = p.item.filter((x) => x.pin).map((x) => x.i).sort();
    const peta = [...u.dipeta].sort();
    const idxAktif = p.item.filter((x) => x.aktif).map((x) => x.i).sort();
    ok(T + 'item tamat: tiada pin dan tiada tanda tidak dipetakan', p.item.filter((x) => !x.aktif).every((x) => !x.pin && !x.takpeta), p.item);
    ok(T + 'pin hanya untuk item aktif yang dipetakan', JSON.stringify(pin) === JSON.stringify(peta) && pin.every((i) => idxAktif.includes(i)), [pin, peta]);
    const idxKumpulan = [...new Set(u.kumpulan.flatMap((g) => g.idx))].sort();
    ok(T + 'indeks kumpulan = item aktif dipetakan sahaja', JSON.stringify(idxKumpulan) === JSON.stringify(peta) && idxKumpulan.every((i) => idxAktif.includes(i)), [idxKumpulan, peta]);
    ok(T + 'semua item aktif dipetakan (tiada yang tidak dipetakan)', u.tidakDipeta.length === 0, u.tidakDipeta);
    // satu penanda setiap negeri; satu penanda laut; tiada penanda tamat (Kelantan, Johor, Tioman)
    const lbl = u.kumpulan.map((g) => g.label).sort();
    const jangka = ['Sabah', 'Sarawak', 'Perak', 'Kedah', 'Perairan Pahang (anggaran)'].sort();
    ok(T + 'lokasi: 5 penanda (3 negeri BAHAYA, Kedah, 1 laut), tiada penanda tamat', JSON.stringify(lbl) === JSON.stringify(jangka), lbl);
    ok(T + 'sumber peta: 5 fitur, label unik', u.fitur.length === 5 && new Set(u.fitur.map((f) => f.kunci)).size === 5, u.fitur.length);
    ok(T + 'tepat 1 penanda laut', u.kumpulan.filter((g) => g.jenis === 'laut').length === 1);
    ok(T + 'tiada penanda daerah (hanya negeri/laut)', u.kumpulan.every((g) => g.jenis !== 'daerah'));
    ok(T + 'tiada penanda Kelantan/Johor/Tioman (tamat)', !lbl.some((x) => /Kelantan|Johor|Tioman/.test(x)), lbl);
    // pengumpulan: Sabah ada 2 amaran (BAHAYA + UMUM) -> lencana 2, warna tertinggi
    const fSabah = u.fitur.find((f) => f.label === 'Sabah');
    const cBahaya = p.item.find((x) => x.tahap === 'BAHAYA');
    ok(T + 'Sabah: 1 penanda dikumpul, kiraan 2, warna BAHAYA', fSabah && fSabah.jumlah === 2 && fSabah.tahap === 'BAHAYA' && fSabah.warna === cBahaya.warna, fSabah);
    ok(T + 'penanda lain kiraan 1', u.fitur.filter((f) => f.label !== 'Sabah').every((f) => f.jumlah === 1), u.fitur);
    // daerah bernama diwarnakan (poligon), bukan penanda
    const dl = u.daerah.map((d) => d.label).sort();
    ok(T + 'poligon daerah diwarnakan: Limbang, Telupid, Kudat, Kinta', JSON.stringify(dl) === JSON.stringify(['Kinta, Perak', 'Kudat, Sabah', 'Limbang, Sarawak', 'Telupid, Sabah']), dl);
    ok(T + 'warna poligon = warna cip BAHAYA', u.daerah.every((d) => d.warna === cBahaya.warna && d.tahap === 'BAHAYA'), u.daerah);
    const hA = u.hasil[p.tajuk.findIndex((t) => /RIBUT PETIR BAHAYA/.test(t))];
    ok(T + 'Paitan (tiada dalam GeoJSON) dilapor tidak dipadankan, 3 negeri', hA && hA.tidakPadan.includes('Paitan') && hA.tempat.length === 3, hA);
    const hD = u.hasil[p.tajuk.findIndex((t) => /KATEGORI KEDUA/.test(t))];
    ok(T + 'laut: Reef North tidak dipetakan, 1 titik', hD && hD.marin && hD.tidakDipeta.includes('Reef North') && hD.tempat.length === 1, hD);
    ok(T + 'tiada hasil untuk item tamat', [...p.item.filter((x) => !x.aktif)].every((x) => !(x.i in u.hasil)), Object.keys(u.hasil));
    // warna setiap penanda = cip item tertinggi (aktif) dalam kumpulannya
    u.fitur.forEach((f) => {
      const g = u.kumpulan.find((x) => x.kunci === f.kunci);
      const cs = g.idx.map((i) => p.item.find((x) => x.i === i));
      const atas = cs.reduce((a, c) => (RANK.indexOf(c.tahap) < RANK.indexOf(a.tahap) ? c : a));
      ok(T + `warna ${f.label} = cip panel (${atas.tahap})`, f.warna === atas.warna && f.tahap === atas.tahap, [f.warna, atas.warna, f.tahap, atas.tahap]);
      ok(T + `${f.label}: kiraan = bilangan amaran aktif`, f.jumlah === g.idx.length && cs.every((c) => c.aktif), [f.jumlah, g.idx]);
    });
    ok(T + 'gaya: semua penanda pekat (tiada gaya pudar)', /0\.85/.test(JSON.stringify(u.paint.opacity)) && !/0\.12/.test(JSON.stringify(u.paint.opacity)), u.paint);
    const warnaUniq = new Set(u.fitur.map((f) => f.warna));
    ok(T + 'warna berbeza bagi tahap berbeza', warnaUniq.size >= 2, [...warnaUniq]);    return { p, u };
  }

  try {
    const g = await buka('gelap');
    const { page } = g;
    const { p, u } = await sahPanel(page, 'gelap');
    ok('tiada lapisan lama (tahap warna kedua) dalam app.js', !(await page.evaluate(() => typeof AMARAN_WARNA !== 'undefined' || typeof NEGERI_PUSAT !== 'undefined')));

    // legenda: warna sama dengan cip
    const leg = await page.$$eval('#legendAmaran .amaran-leg-tahap', (e) => e.map((s) => [s.dataset.tahap, s.firstChild.style.background]));
    ok('legenda: 4 tahap, warna ikut cip', leg.length === 4 && leg.every(([, w]) => !!w), leg);
    ok('legenda: tiada pilihan amaran tamat, tiada item tidak dipetakan', !(await page.$('#petaAmaranTamat')) && (await page.$eval('#legendAmaranTakPeta', (e) => e.textContent)) === '');

    // panel -> peta (item peringkat daerah, 3 titik: fitBounds + pop-up)
    const iA = p.tajuk.findIndex((t) => /RIBUT PETIR BAHAYA/.test(t));
    await page.evaluate(() => map.jumpTo({ center: [101.5, 3.5], zoom: 5 }));
    await page.click(`#metAlertBody .alert-item[data-amaran="${iA}"] .amaran-pin`);
    await moveend(page);
    const a = await page.evaluate((i) => {
      const U = FamaAmaranPeta.ujian();
      const b = map.getBounds();
      const gs = U.kumpulan.filter((x) => x.idx.includes(i));
      return {
        semuaDalam: gs.every((x) => b.contains([x.lng, x.lat])),
        n: gs.length,
        popup: U.popup,
        popupDom: !!document.querySelector('.maplibregl-popup .amaran-popup'),
        kunciItem: gs.map((x) => x.kunci),
      };
    }, iA);
    ok('panel->peta (3 negeri): 3 titik semua dalam paparan', a.n === 3 && a.semuaDalam, a);
    ok('panel->peta (3 negeri): pop-up dibuka pada titik item', a.popupDom && a.kunciItem.includes(a.popup), a);

    // panel -> peta (satu titik: flyTo)
    const iB = p.tajuk.findIndex((t) => t === 'AMARAN HUJAN');
    await page.evaluate(() => map.jumpTo({ center: [112, 4], zoom: 5 }));
    await page.click(`#metAlertBody .alert-item[data-amaran="${iB}"] .amaran-pin`);
    await moveend(page);
    const b = await page.evaluate((i) => {
      const U = FamaAmaranPeta.ujian();
      const gr = U.kumpulan.find((x) => x.idx.includes(i));
      const c = map.getCenter();
      return { dx: Math.abs(c.lng - gr.lng), dy: Math.abs(c.lat - gr.lat), z: map.getZoom(), popup: U.popup, kunci: gr.kunci };
    }, iB);
    ok('panel->peta (satu titik): flyTo ke titik', b.dx < 0.05 && b.dy < 1.5 && b.z >= 6.9, b);
    ok('panel->peta (satu titik): pop-up kumpulan betul', b.popup === b.kunci, b);

    // item tamat: tiada pin; klik badan item tidak membuka pop-up / menggerakkan peta
    const iC = p.tajuk.findIndex((t) => /WASPADA HUJAN/.test(t));
    await page.evaluate(() => { map.jumpTo({ center: [112, 4], zoom: 5 }); if (FamaAmaranPeta.ujian().popup) document.querySelector('.maplibregl-popup-close-button').click(); });
    const sebelum = await page.evaluate(() => map.getCenter().lng);
    await page.click(`#metAlertBody .alert-item[data-amaran="${iC}"] .alert-top b`);
    await sleep(800);
    const tamatKlik = await page.evaluate(() => ({ popup: FamaAmaranPeta.ujian().popup, lng: map.getCenter().lng, z: map.getZoom() }));
    ok('item tamat: tiada pin pada panel', !(await page.$(`#metAlertBody .alert-item[data-amaran="${iC}"] .amaran-pin`)));
    ok('item tamat: klik tidak membuka pop-up atau menggerakkan peta', tamatKlik.popup === null && Math.abs(tamatKlik.lng - sebelum) < 0.01 && Math.abs(tamatKlik.z - 5) < 0.01, tamatKlik);
    ok('item tamat: tiada dalam kumpulan peta', !u.kumpulan.some((x) => x.idx.includes(iC)) && !u.dipeta.includes(iC));

    // pop-up kumpulan Sabah (2 amaran) -> 'Lihat lagi' -> panel sorot + tukar ke tab Rasmi
    await page.evaluate(() => setEwsTab('banjir'));
    const pop = await page.evaluate((i) => {
      const gr = FamaAmaranPeta.ujian().kumpulan.find((x) => x.idx.includes(i));
      const pp = FamaAmaranPeta.bukaPopup(gr.kunci).getElement();
      return {
        teks: pp.innerText,
        n: pp.querySelectorAll('.amaran-popup-item').length,
        tahap: [...pp.querySelectorAll('.amaran-popup-item .alert-tahap')].map((e) => e.textContent),
        chip: [...pp.querySelectorAll('.amaran-popup-item .alert-chip')].map((e) => e.textContent),
        gmaps: !!pp.querySelector('.gmaps-link'),
      };
    }, iB);
    ok('pop-up Sabah: 2 amaran (BAHAYA + UMUM), semua Aktif, daerah disenarai, Google Maps', pop.n === 2 && pop.tahap.includes('BAHAYA') && pop.tahap.includes('UMUM') && pop.chip.every((x) => x === 'Aktif') && /Daerah: .*Telupid/.test(pop.teks) && /Kudat/.test(pop.teks) && !/Tamat/.test(pop.teks) && /Amaran Rasmi · Sabah \(2\)/.test(pop.teks) && pop.gmaps, pop);
    await page.click('.maplibregl-popup .amaran-popup-item[data-amaran="' + iB + '"] [data-act="amaran-peta-lihat"]');
    const s = await page.evaluate((i) => ({
      tab: document.getElementById('ewsTabAmaran').getAttribute('aria-selected'),
      pandangan: !document.getElementById('ewsViewAmaran').hidden,
      sorot: document.querySelector(`#metAlertBody .alert-item[data-amaran="${i}"]`).classList.contains('sorot'),
      lain: document.querySelectorAll('#metAlertBody .alert-item.sorot').length,
    }), iB);
    ok("pop-up 'Lihat lagi': tab Rasmi + item disorot", s.tab === 'true' && s.pandangan && s.sorot && s.lain === 1, s);

    // titik laut: pop-up anggaran + kawasan laut lain
    const laut = await page.evaluate(() => {
      const gr = FamaAmaranPeta.ujian().kumpulan.find((x) => x.jenis === 'laut');
      const pp = FamaAmaranPeta.bukaPopup(gr.kunci).getElement();
      return pp.innerText;
    });
    ok('pop-up laut: anggaran, kawasan laut lain, Reef North tidak dipetakan', /anggaran/.test(laut) && /Kawasan laut lain: Perairan Terengganu/.test(laut) && /Tidak dipetakan: Reef North/.test(laut), laut);

    // semua penanda dirender (5), tiada penanda tamat
    await page.evaluate(() => {
      const bounds = new maplibregl.LngLatBounds();
      FamaAmaranPeta.ujian().kumpulan.forEach((x) => bounds.extend([x.lng, x.lat]));
      map.fitBounds(bounds, { padding: 60, duration: 0 });
    });
    await moveend(page);
    const nampak = await page.evaluate(() => {
      const f = map.queryRenderedFeatures({ layers: ['amaran-cuaca'] });
      return new Set(f.map((x) => x.properties.kunci)).size;
    });
    ok('peta: 5 penanda dirender', nampak === 5, nampak);
    // togol utama mematikan semua lapisan amaran
    await page.click('#petaAmaranBtn');
    const off = (await uji(page)).lapisan;
    ok('togol utama: semua lapisan amaran tersembunyi', Object.values(off).every((v) => v === 'none'), off);
    await page.click('#petaAmaranBtn');

    // tukar peta asas: titik kekal
    await page.click('#petaKawalan [data-asas="satelit"]');
    await page.waitForFunction(() => DASHBOARD_TEST.peta().asas === 'satelit' && DASHBOARD_TEST.peta().gayaDimuat && DASHBOARD_TEST.peta().lapisan.amaran, { timeout: 20000 });
    await sleep(500);
    const ss = await uji(page);
    ok('selepas tukar peta asas: 5 titik + 4 poligon daerah kekal', ss.fitur.length === 5 && ss.daerah.length === 4, [ss.fitur.length, ss.daerah.length]);
    await page.click('#petaKawalan [data-asas="lalai"]');
    await page.waitForFunction(() => DASHBOARD_TEST.peta().asas === 'lalai' && DASHBOARD_TEST.peta().gayaDimuat && DASHBOARD_TEST.peta().lapisan.amaran, { timeout: 20000 });

    // susunan lapisan: daerah < amaran < banjir; penanda PO (DOM) di atas kanvas
    const urut = await page.evaluate(() => map.getStyle().layers.map((l) => l.id));
    const pos = (id) => urut.indexOf(id);
    ok('susunan: daerah-label < garis amaran < halo < titik', pos('daerah-label') > -1 && pos('daerah-label') < pos('amaran-daerah-isi') && pos('amaran-daerah-isi') < pos('amaran-daerah-garis') && pos('amaran-daerah-garis') < pos('amaran-cuaca-halo') && pos('amaran-cuaca-halo') < pos('amaran-cuaca'), urut.filter((x) => /daerah|amaran|banjir/.test(x)));
    ok('tint amaran: lapisan sendiri nampak walau sempadan daerah tersembunyi (paparan Malaysia)', await page.evaluate(() => map.getLayoutProperty('daerah-isi', 'visibility') === 'none' && map.getLayoutProperty('amaran-daerah-isi', 'visibility') !== 'none' && FamaAmaranPeta.ujian().daerah.length === 4));

    // tangkapan skrin (peta + panel EWS) dalam dua tema
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.evaluate(() => {
        const bounds = new maplibregl.LngLatBounds();
        FamaAmaranPeta.ujian().kumpulan.forEach((x) => bounds.extend([x.lng, x.lat]));
        map.fitBounds(bounds, { padding: 40, duration: 0 });
        if (FamaAmaranPeta.ujian().popup) map.getCanvas().focus();
        document.querySelector('.maplibregl-popup-close-button') && document.querySelector('.maplibregl-popup-close-button').click();
      });
      await page.evaluate(() => { const k = document.querySelector('.cuaca-menu .cuaca-kecil'); if (k && document.querySelector('.cuaca-menu').offsetHeight > 60) k.click(); });
      await sleep(1500);
      await page.evaluate(() => document.getElementById('map').scrollIntoView({ block: 'start', behavior: 'instant' }));
      await sleep(400);
      const kotak = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const m = r('.map-svg-frame');
        const e = r('#ewsPanel');
        const l = Math.min(m.left, e.left);
        const t = Math.min(m.top, e.top);
        return { x: l + scrollX, y: t + scrollY, width: Math.min(1500, Math.max(m.right, e.right) - l), height: Math.min(900, Math.max(m.bottom, e.bottom) - t) };
      });
      await page.screenshot({ path: path.join(SHOTS, 'amaran-1440-gelap.png'), clip: kotak });
    }
    // tiada amaran aktif: label (0 aktif), tooltip, tiada penanda
    await page.evaluate(() => {
      const d = famaAmaranRasmi();
      terbitAmaranRasmi(d.senarai.map((x) => ({ ...x, aktif: false })), d.kini);
    });
    await sleep(500);
    const kosong = await page.evaluate(() => ({
      label: document.getElementById('petaAmaranBtn').textContent,
      title: document.getElementById('petaAmaranBtn').title,
      fitur: FamaAmaranPeta.ujian().fitur.length,
      daerah: FamaAmaranPeta.ujian().daerah.length,
    }));
    ok('0 aktif: label, tooltip, tiada penanda', kosong.label === 'Amaran Rasmi (0 aktif)' && kosong.title === 'Tiada amaran rasmi aktif' && kosong.fitur === 0 && kosong.daerah === 0, kosong);
    ok('tiada ralat konsol (gelap)', g.masalah.length === 0, g.masalah);
    await page.close();

    // tema cerah: warna cip = warna penanda
    const t = await buka('cerah');
    await sahPanel(t.page, 'cerah');
    if (SHOTS) {
      await t.page.evaluate(() => {
        const bounds = new maplibregl.LngLatBounds();
        FamaAmaranPeta.ujian().kumpulan.forEach((x) => bounds.extend([x.lng, x.lat]));
        map.fitBounds(bounds, { padding: 40, duration: 0 });
        document.getElementById('map').scrollIntoView({ block: 'start', behavior: 'instant' });
      });
      await t.page.evaluate(() => { const k = document.querySelector('.cuaca-menu .cuaca-kecil'); if (k && document.querySelector('.cuaca-menu').offsetHeight > 60) k.click(); });
      await sleep(1500);
      const kotak = await t.page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const m = r('.map-svg-frame');
        const e = r('#ewsPanel');
        const l = Math.min(m.left, e.left);
        const tp = Math.min(m.top, e.top);
        return { x: l + scrollX, y: tp + scrollY, width: Math.min(1500, Math.max(m.right, e.right) - l), height: Math.min(900, Math.max(m.bottom, e.bottom) - tp) };
      });
      await t.page.screenshot({ path: path.join(SHOTS, 'amaran-1440-cerah.png'), clip: kotak });
    }
    ok('tiada ralat konsol (cerah)', t.masalah.length === 0, t.masalah);
    await t.page.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: lapisan Amaran Rasmi sepadan dengan panel Rasmi');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

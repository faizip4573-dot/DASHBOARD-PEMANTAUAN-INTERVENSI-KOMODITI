'use strict';
// PO tambahan (FIS 2.1) pada peta Pemantauan dan Intervensi: 15 penanda bulat + 25 penanda petak, suis 'PO Tambahan (N)'
// (kekal dalam localStorage fama_po_tambahan), label dan hover, pop-up ('Tiada data logistik'), drill-down, optgroup
// dropdown, KPI '+N PO tambahan', susunan lapisan (PO utama di atas petak), legenda. Tema gelap dan cerah.
// PO_SHOTS=<folder> menyimpan tangkapan skrin dikliping (1440, suis ON/OFF, kedua-dua peta, gelap dan cerah).
// Jalankan dari root: node --no-warnings tests/frontend/po-tambahan.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { pasangSemuaCache } = require('../helpers/banjir-fixture.js');
pasangSemuaCache();
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = process.env.PO_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gagal = [];
const ok = (nama, cond, info) => {
  if (!cond)
    gagal.push(nama + (info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 500) : ''));
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'po-tbh-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const konsol = [];
  const buka = async (tema, simpan) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => konsol.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(
      (t, s) => {
        try {
          if (!sessionStorage.getItem('po_tbh_init')) {
            sessionStorage.setItem('po_tbh_init', '1');
            localStorage.setItem('fama_tema', t);
            if (s !== null) localStorage.setItem('fama_po_tambahan', s);
          }
        } catch {
          /* abaikan */
        }
      },
      tema,
      simpan,
    );
    await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(
      () => HD.sedia && document.querySelectorAll('.po-marker').length === 15,
      {
        timeout: 30000,
      },
    );
    await sleep(800);
    return page;
  };
  const sedia = (page) => page.waitForFunction(() => HD.sedia, { timeout: 30000 });
  const tangkap = async (page, sel, nama) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), sel);
    await sleep(900);
    const b = await (await page.$(sel)).boundingBox();
    const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await page.screenshot({
      path: path.join(SHOTS, nama + '.png'),
      clip: {
        x: Math.max(0, b.x) + sc.x,
        y: Math.max(0, b.y) + sc.y,
        width: Math.min(b.width, 1400),
        height: Math.min(b.height, 760),
      },
    });
  };
  try {
    for (const tema of ['gelap', 'cerah']) {
      const T = tema + ': ';
      const page = await buka(tema, null);
      const ev = (fn, ...a) => page.evaluate(fn, ...a);

      /* ---------- Pemantauan ---------- */
      const asas = await ev(() => {
        const bulat = [...document.querySelectorAll('#map .po-marker')];
        const petak = [...document.querySelectorAll('#map .po-tbh')];
        const cs = (e) => getComputedStyle(e.querySelector('.core'));
        return {
          bulat: bulat.length,
          petak: petak.length,
          n: DATA.poTambahan.length,
          rBulat: cs(bulat[0]).borderRadius,
          rPetak: cs(petak[0]).borderRadius,
          wBulat: parseFloat(cs(bulat[0]).width),
          wPetak: parseFloat(cs(petak[0]).width),
          butang: document.querySelector('[data-po-tbh-btn]').textContent,
          tekan: document.querySelector('[data-po-tbh-btn]').getAttribute('aria-pressed'),
          kelasPetak: petak.every((e) => /status-(merah|kuning|hijau|kelabu)/.test(e.className)),
          bukanPoMarker: petak.every((e) => !e.classList.contains('po-marker')),
          legenda: document.querySelector('.map-legend').innerText,
        };
      });
      ok(T + '15 penanda bulat PO utama', asas.bulat === 15, asas.bulat);
      ok(T + '25 penanda petak PO tambahan', asas.petak === 25 && asas.n === 25, asas);
      ok(
        T + 'petak bulat-sudut (bukan 50%) dan lebih kecil',
        !/50%/.test(asas.rPetak) && asas.wPetak < asas.wBulat,
        asas,
      );
      ok(
        T + 'petak berwarna palet status, bukan kelas po-marker',
        asas.kelasPetak && asas.bukanPoMarker,
      );
      ok(
        T + "butang 'PO Tambahan (25)' ON secara lalai",
        asas.butang === 'PO Tambahan (25)' && asas.tekan === 'true',
        asas,
      );
      ok(
        T + 'legenda petak = PO tambahan, bulatan = PO utama',
        /Petak = PO tambahan · Bulatan = PO utama/.test(asas.legenda),
        asas.legenda,
      );

      // butang dalam kumpulan suis lapisan yang sama dengan Amaran Rasmi / Sempadan Daerah / Sentimen
      const kump = await ev(() => {
        const b = document.querySelector('[data-po-tbh-btn]');
        return {
          sama: b.parentElement.getAttribute('aria-label') === 'Lapisan tambahan',
          adik: [...b.parentElement.querySelectorAll('button')].map((x) => x.id || 'tbh'),
        };
      });
      ok(
        T + 'butang dalam kumpulan Lapisan tambahan',
        kump.sama && kump.adik.includes('petaAmaranBtn') && kump.adik.includes('petaDaerahBtn'),
        kump,
      );

      // KPI: kekal 15, nota +N
      const kpi = await ev(() => {
        const k = [...document.querySelectorAll('#kpis .kpi')].find((x) =>
          /PO Dalam Tapisan/.test(x.innerText),
        );
        return {
          nilai: k.querySelector('.kpi-value').textContent.trim(),
          foot: k.querySelector('.kpi-foot').innerText,
        };
      });
      ok(
        T + "KPI 'PO Dalam Tapisan' = 15 dengan nota '+25 PO tambahan'",
        kpi.nilai === '15' && /\+25 PO tambahan/.test(kpi.foot),
        kpi,
      );

      // dropdown: optgroup 'PO tambahan' hanya bila ON, cascade ikut negeri
      const dd = (sel) =>
        ev(() => {
          const g = document.querySelector('#filterState optgroup');
          return {
            utama: [...document.querySelectorAll('#filterState > option')].length,
            grup: g ? g.label : null,
            pilihan: g ? [...g.querySelectorAll('option')].map((o) => o.textContent.trim()) : [],
          };
        });
      const d0 = await dd();
      ok(
        T + 'dropdown: Semua PO + 15 PO, kemudian optgroup PO tambahan (25)',
        d0.utama === 16 && d0.grup === 'PO tambahan' && d0.pilihan.length === 25,
        d0,
      );
      await page.select('#filterNegeri', 'Selangor');
      await sedia(page);
      await sleep(400);
      const d1 = await dd();
      ok(
        T + 'dropdown cascade Negeri=Selangor: PO tambahan Selangor sahaja',
        d1.pilihan.includes('Puchong') &&
          d1.pilihan.includes('Kuala Selangor') &&
          !d1.pilihan.includes('Tangkak'),
        d1,
      );
      const k2 = await ev(() =>
        [...document.querySelectorAll('#kpis .kpi')]
          .find((x) => /PO Dalam Tapisan/.test(x.innerText))
          .querySelector('.kpi-value')
          .textContent.trim(),
      );
      ok(T + 'KPI kekal kiraan PO utama (2 di Selangor)', k2 === '2', k2);
      await page.select('#filterNegeri', 'all');
      await sedia(page);
      await sleep(400);

      // label: tersembunyi pada zum kebangsaan; hover tunjuk nama penuh; label muncul bila zum dekat
      const lbl0 = await ev(() => {
        const e = document.querySelector('#map .po-tbh[data-po-tbh="tbh-puchong"]');
        return {
          zum: map.getZoom(),
          paparan: getComputedStyle(e.querySelector('.po-label')).display,
          title: e.title,
          teks: e.querySelector('.po-label').textContent,
        };
      });
      ok(
        T + 'label petak tersembunyi pada zum kebangsaan',
        lbl0.paparan === 'none' && lbl0.zum < 7,
        lbl0,
      );
      ok(
        T + 'title/hover membawa nama penuh FIS',
        /Pusat Operasi Puchong/.test(lbl0.title) && lbl0.teks === 'Pusat Operasi Puchong',
        lbl0,
      );
      const dekat = () =>
        ev(() => {
          const p = DATA.poTambahan.find((x) => x.id === 'tbh-puchong');
          map.jumpTo({ center: [p.lon, p.lat], zoom: 9 });
        });
      await dekat();
      await sleep(900);
      const POP = '.maplibregl-popup:has(.po-tbh-popup)';
      const bilPop = (sel = '#map') => ev((s) => document.querySelectorAll(s + ' .po-tbh-popup').length, sel);
      ok(T + 'pop-up PO tambahan tertutup sebelum hover', (await bilPop()) === 0);
      await page.hover('#map .po-tbh[data-po-tbh="tbh-puchong"]');
      await page.waitForSelector(POP, { timeout: 5000 });
      const pop = await ev((s) => {
        const p = document.querySelector(s);
        return {
          teks: p.innerText,
          gmaps: !!p.querySelector('a.gmaps-link'),
          z: getComputedStyle(p).zIndex,
          tutup: !!p.querySelector('.maplibregl-popup-close-button'),
        };
      }, POP);
      const hov = pop.teks;
      ok(
        T + 'hover: nama penuh dan Tiada data logistik',
        /Pusat Operasi Puchong/.test(hov) && /Tiada data logistik/.test(hov),
        hov,
      );
      ok(
        T + 'pop-up hover: nama, negeri, daerah, status, sebab',
        /Puchong \(PO tambahan\)/.test(pop.teks) &&
          /Negeri: Selangor/.test(pop.teks) &&
          /Klang, Petaling/.test(pop.teks) &&
          /Status harga: /.test(pop.teks) &&
          /Sebab: /.test(pop.teks),
        pop.teks,
      );
      ok(
        T + "pop-up hover: 'Tiada data logistik', sumber FIS 2.1, lokasi anggaran",
        /Tiada data logistik/.test(pop.teks) &&
          /Pemetaan: FIS 2\.1 \(Power BI\)/.test(pop.teks) &&
          /Lokasi anggaran: titik tengah daerah seliaan/.test(pop.teks),
        pop.teks,
      );
      ok(
        T + "pop-up hover: pautan 'Buka di Google Maps', tiada butang tutup, z-index >= 10",
        pop.gmaps && /Buka di Google Maps/.test(pop.teks) && !pop.tutup && Number(pop.z) >= 10,
        pop,
      );
      // keluar dari petak -> tutup dalam ~500 ms
      await page.mouse.move(5, 5);
      await sleep(500);
      ok(T + 'alih kursor: pop-up tertutup dalam 500 ms', (await bilPop()) === 0);
      // hover -> masuk ke pop-up kekal terbuka; keluar dari pop-up -> tutup
      await page.hover('#map .po-tbh[data-po-tbh="tbh-puchong"]');
      await page.waitForSelector(POP, { timeout: 5000 });
      const kotak = await (await page.$(POP + ' .po-tbh-popup')).boundingBox();
      await page.mouse.move(kotak.x + kotak.width / 2, kotak.y + kotak.height / 2);
      await sleep(700);
      ok(T + 'kursor dalam pop-up: kekal terbuka', (await bilPop()) === 1);
      await page.mouse.move(5, 5);
      await sleep(500);
      ok(T + 'kursor keluar pop-up: tertutup', (await bilPop()) === 0);
      // hanya satu pop-up pada satu masa
      await page.hover('#map .po-tbh[data-po-tbh="tbh-puchong"]');
      await page.waitForSelector(POP, { timeout: 5000 });
      const lain = await ev(() => DATA.poTambahan.find((x) => x.label === 'Kuala Selangor').id);
      await page.hover(`#map .po-tbh[data-po-tbh="${lain}"]`);
      await sleep(100);
      const satu = await ev(() =>
        [...document.querySelectorAll('.po-tbh-popup .banjir-popup-tajuk')].map((e) => e.textContent),
      );
      ok(T + 'hanya satu pop-up PO tambahan pada satu masa', satu.length === 1, satu);
      await page.mouse.move(5, 5);
      await sleep(500);
      await sleep(300);
      const lbl1 = await ev(() => ({
        on: map.getContainer().classList.contains('tbh-label-on'),
        paparan: getComputedStyle(
          document.querySelector('#map .po-tbh[data-po-tbh="tbh-puchong"] .po-label'),
        ).display,
      }));
      ok(T + 'label petak dipaparkan dari zum dekat', lbl1.on && lbl1.paparan === 'block', lbl1);
      await page.mouse.move(5, 5);
      await sleep(600);
      await ev(() => zoomTo(null));
      await sleep(1200);

      // susunan lapisan
      const susun = await ev(() => {
        const z = (s) => Number(getComputedStyle(document.querySelector(s)).zIndex);
        const ibu = document.querySelector('#map .po-marker').parentElement;
        const sem = [...ibu.parentElement.querySelectorAll('.po-marker, .po-tbh')];
        const idxBulat = sem.findIndex((e) => e.classList.contains('po-marker'));
        const idxPetakAkhir = sem.map((e) => e.classList.contains('po-tbh')).lastIndexOf(true);
        return {
          petak: z('#map .po-tbh'),
          bulat: z('#map .po-marker'),
          sentimen: (() => {
            const e = document.querySelector('#map .sent-marker');
            return e ? Number(getComputedStyle(e).zIndex) : 1;
          })(),
          urutanDOM: idxBulat > idxPetakAkhir,
        };
      });
      ok(
        T + 'susunan: sentimen < petak < PO utama (z-index) dan PO utama selepas petak dalam DOM',
        susun.sentimen < susun.petak && susun.petak < susun.bulat && susun.urutanDOM,
        susun,
      );

      await tangkap(page, '.map-panel', `pemantauan-${tema}-1440-on`);

      // klik petak: pop-up lengkap + drill-down + dropdown + sorot daerah
      ok(T + 'paparan Malaysia: lapisan daerah tersembunyi', (await ev(() => map.getLayoutProperty('daerah-isi', 'visibility'))) === 'none');
      await dekat();
      await sleep(900);
      await ev(() => map.jumpTo({ zoom: 7.5 }));
      await sleep(600);
      const zum0 = await ev(() => map.getZoom());
      await page.click('#map .po-tbh[data-po-tbh="tbh-puchong"]');
      await sedia(page);
      await sleep(1500);
      await page.mouse.move(5, 5);
      await sleep(500);
      ok(T + 'klik petak: pop-up tidak ditinggalkan terbuka', (await bilPop()) === 0);
      const dr = await ev(() => ({
        po: state.po,
        zum: map.getZoom(),
        dd: document.getElementById('filterState').value,
        negeri: state.negeri,
        sorot: window.FamaDaerah.statusDaerah(),
        daerahVis: map.getLayoutProperty('daerah-isi', 'visibility'),
        daerahMarker: [...document.querySelectorAll('#map .district-marker')].map((e) =>
          e.getAttribute('aria-label'),
        ),
        detail: document.getElementById('mapDetail').innerText,
        outlet: document.getElementById('outletContent').innerText,
        sempadan: (() => {
          const b = map.getBounds();
          return ['Klang', 'Petaling'].every((n) => {
            const f = FamaDaerah.semuaFitur().find((x) => x.properties.name === n);
            return b.contains([f.properties.lon, f.properties.lat]);
          });
        })(),
      }));
      ok(
        T + 'drill-down: state.po = PO tambahan, dropdown dan negeri dikemas kini',
        dr.po === 'tbh-puchong' && dr.dd === 'tbh-puchong' && dr.negeri === 'Selangor',
        dr,
      );
      ok(
        T + 'drill-down: peta zum ke daerah seliaan (Klang, Petaling dalam paparan)',
        dr.zum > zum0 && dr.sempadan,
        { zum0, ...dr },
      );
      ok(
        T + 'drill-down: poligon Klang dan Petaling berwarna status, penanda daerah dipaparkan',
        'Klang' in dr.sorot && 'Petaling' in dr.sorot && dr.daerahMarker.length === 2 && dr.daerahVis === 'visible',
        dr,
      );
      ok(
        T + 'drill-down: panel butiran dan logistik menyatakan tiada data logistik',
        /tiada data logistik/i.test(dr.detail) && /Tiada data logistik/.test(dr.outlet),
        dr,
      );
      // panel harga dipacu seperti PO utama (rekod daerah Klang/Petaling)
      const panel = await ev(() => filteredRecords({ issues: false }).map((r) => r.daerah));
      ok(
        T + 'panel harga: rekod terhad kepada daerah PO tambahan',
        panel.length > 0 && panel.every((d) => ['KLANG', 'PETALING'].includes(d)),
        panel.slice(0, 5),
      );
      await tangkap(page, '.map-panel', `pemantauan-${tema}-1440-drill`);

      // reset ke paparan kebangsaan, kemudian OFF
      await page.click('#backMap');
      await sedia(page);
      await sleep(1200);
      await page.click('[data-po-tbh-btn]');
      await sleep(700);
      const off = await ev(() => ({
        petak: document.querySelectorAll('#map .po-tbh').length,
        bulat: document.querySelectorAll('#map .po-marker').length,
        tekan: document.querySelector('[data-po-tbh-btn]').getAttribute('aria-pressed'),
        simpan: localStorage.getItem('fama_po_tambahan'),
        grup: !!document.querySelector('#filterState optgroup'),
        foot: [...document.querySelectorAll('#kpis .kpi')].find((x) =>
          /PO Dalam Tapisan/.test(x.innerText),
        ).innerText,
      }));
      ok(
        T + 'suis OFF: petak hilang, 15 bulat kekal, disimpan, tiada optgroup, tiada nota +N',
        off.petak === 0 &&
          off.bulat === 15 &&
          off.tekan === 'false' &&
          off.simpan === '0' &&
          !off.grup &&
          !/PO tambahan/.test(off.foot),
        off,
      );
      await tangkap(page, '.map-panel', `pemantauan-${tema}-1440-off`);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => HD.sedia && document.querySelectorAll('.po-marker').length === 15,
        { timeout: 30000 },
      );
      await sleep(600);
      const per = await ev(() => ({
        petak: document.querySelectorAll('#map .po-tbh').length,
        tekan: document.querySelector('[data-po-tbh-btn]').getAttribute('aria-pressed'),
      }));
      ok(
        T + 'suis OFF kekal selepas muat semula (localStorage)',
        per.petak === 0 && per.tekan === 'false',
        per,
      );
      await page.click('[data-po-tbh-btn]');
      await sleep(700);
      const on2 = await ev(() => ({
        petak: document.querySelectorAll('#map .po-tbh').length,
        simpan: localStorage.getItem('fama_po_tambahan'),
      }));
      ok(T + 'suis ON semula: 25 petak dan disimpan', on2.petak === 25 && on2.simpan === '1', on2);

      // OFF ketika PO tambahan dipilih -> pilihan dilepaskan
      await ev(() => selectPO('tbh-tangkak'));
      await sedia(page);
      await sleep(600);
      await page.click('[data-po-tbh-btn]');
      await sleep(700);
      const lepas = await ev(() => ({
        po: state.po,
        petak: document.querySelectorAll('#map .po-tbh').length,
      }));
      ok(
        T + 'suis OFF ketika PO tambahan dipilih: pilihan dilepaskan',
        lepas.po === null && lepas.petak === 0,
        lepas,
      );
      await page.click('[data-po-tbh-btn]');
      await sleep(500);

      /* ---------- Intervensi ---------- */
      await page.click('#ivTabIv');
      await page.waitForFunction(
        () => IV_TEST.ivHarga().sedia && document.querySelectorAll('#ivMap .po-marker').length > 0,
        { timeout: 30000 },
      );
      await sleep(1500);
      const iv = await ev(() => ({
        petak: document.querySelectorAll('#ivMap .po-tbh').length,
        bulat: document.querySelectorAll('#ivMap .po-marker').length,
        butang: document.querySelector('#ivPoTbhCtl [data-po-tbh-btn]').textContent,
        legenda: document.getElementById('ivLegend').innerText,
        nota: document.querySelector('.iv-map-tools').innerText,
        urutan: (() => {
          const s = [...document.querySelectorAll('#ivMap .po-marker, #ivMap .po-tbh')];
          return (
            s.findIndex((e) => e.classList.contains('po-marker')) >
            s.map((e) => e.classList.contains('po-tbh')).lastIndexOf(true)
          );
        })(),
        status: [...document.querySelectorAll('#ivMap .po-tbh')].every((e) =>
          /status-(merah|kuning|hijau|kelabu)/.test(e.className),
        ),
      }));
      ok(
        T + 'Intervensi: 15 bulat + 25 petak, butang PO Tambahan (25)',
        iv.bulat === 15 && iv.petak === 25 && iv.butang === 'PO Tambahan (25)',
        iv,
      );
      ok(T + 'Intervensi: petak berwarna status harga (bukan semua kelabu menunggu)', iv.status);
      ok(
        T + 'Intervensi: legenda petak/bulatan dan nota bukan calon mobilisasi',
        /Petak = PO tambahan · Bulatan = PO utama/.test(iv.legenda) &&
          /bukan calon mobilisasi/.test(iv.nota),
        iv,
      );
      ok(T + 'Intervensi: PO utama di atas petak (DOM)', iv.urutan, iv);
      await page.hover('#ivMap .po-tbh[data-po-tbh="tbh-tangkak"]');
      await page.waitForSelector('#ivMap .po-tbh-popup', { timeout: 5000 });
      const ivh = await ev(() => document.querySelector('#ivMap .po-tbh-popup').innerText);
      ok(
        T + 'Intervensi: pop-up hover ada Tiada data logistik, FIS 2.1, Muar/Segamat/Tangkak',
        /Tiada data logistik/.test(ivh) &&
          /Pemetaan: FIS 2\.1 \(Power BI\)/.test(ivh) &&
          /Muar, Segamat, Tangkak/.test(ivh) &&
          /Buka di Google Maps/.test(ivh),
        ivh,
      );
      await page.mouse.move(5, 5);
      await sleep(500);
      ok(T + 'Intervensi: alih kursor menutup pop-up', (await bilPop('#ivMap')) === 0);
      await page.click('#ivMap .po-tbh[data-po-tbh="tbh-tangkak"]');
      await sleep(1500);
      await page
        .waitForFunction(() => !!IV_TEST.map().getLayer('po-tbh-sorot-isi'), { timeout: 8000 })
        .catch(async () => {
          // sorot gagal bila gaya peta Intervensi sedang dikemas kini (kebolehulangan): klik semula sekali
          await page.click('#ivMap .po-tbh[data-po-tbh="tbh-tangkak"]');
          await sleep(1500);
        });
      await page.mouse.move(5, 5);
      await sleep(500);
      const ivp = await ev(() => ({ sorot: !!IV_TEST.map().getLayer('po-tbh-sorot-isi') }));
      ok(T + 'Intervensi: klik petak zum dan poligon daerah disorot', ivp.sorot, ivp);
      ok(T + 'Intervensi: klik petak tidak meninggalkan pop-up', (await bilPop('#ivMap')) === 0);
      await tangkap(page, '.iv-map-frame', `intervensi-${tema}-1440-on`);
      await page.click('#ivPoTbhCtl [data-po-tbh-btn]');
      await sleep(700);
      const ivOff = await ev(() => ({
        petak: document.querySelectorAll('#ivMap .po-tbh').length,
        bulat: document.querySelectorAll('#ivMap .po-marker').length,
        simpan: localStorage.getItem('fama_po_tambahan'),
      }));
      ok(
        T + 'Intervensi: suis OFF menyembunyikan petak, 15 bulat kekal, berkongsi simpanan',
        ivOff.petak === 0 && ivOff.bulat === 15 && ivOff.simpan === '0',
        ivOff,
      );
      await tangkap(page, '.iv-map-frame', `intervensi-${tema}-1440-off`);
      await page.click('#ivPoTbhCtl [data-po-tbh-btn]');
      await sleep(500);
      await page.close();
    }
    ok('tiada ralat halaman', konsol.length === 0, konsol);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL po-tambahan:\n - ' + gagal.join('\n - ') : 'OK po-tambahan');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

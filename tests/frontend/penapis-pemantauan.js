'use strict';
// Bar penapis tab Pemantauan: susunan Negeri, Pusat Operasi, Bulan, Komoditi, Varieti, Indikator; lata
// Negeri -> PO dan Komoditi -> Varieti; Bulan menapis panel harga; Set Semula; KPI dan peta.
// Jalankan dari root: node tests/frontend/penapis-pemantauan.js
// PENAPIS_SHOTS=<folder> menyimpan tangkapan skrin bar penapis (dikliping, 1440 dan 390, gelap dan cerah).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gagal = [];
const ok = (nama, cond, info) => {
  if (!cond)
    gagal.push(nama + (info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 400) : ''));
};
const IDS = [
  'filterNegeri',
  'filterState',
  'filterBulan',
  'filterMinggu',
  'filterCommodity',
  'filterVarieti',
  'filterSeverity',
];
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'penapis-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const konsol = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => konsol.push('pageerror: ' + e.message));
    await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2500);
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const pilih = async (id, v) => {
      await page.select('#' + id, v);
      await sleep(250);
    };
    const opsi = (id) =>
      ev(
        // pilihan terus sahaja; optgroup 'PO tambahan' (FIS 2.1) diuji dalam tests/frontend/po-tambahan.js
        (i) =>
          [...document.getElementById(i).options]
            .filter((o) => !o.closest('optgroup'))
            .map((o) => [o.value, o.textContent.trim()]),
        id,
      );
    const kpi = () =>
      ev(() =>
        Object.fromEntries(
          [...document.querySelectorAll('#kpis .kpi')].map((k) => [
            k.querySelector('.kpi-label').textContent.trim(),
            k.querySelector('.kpi-value').textContent.trim(),
          ]),
        ),
      );

    // 1. Susunan kiri ke kanan, satu baris, tinggi sama, tiada limpahan (1440 / 1024 / 390)
    for (const w of [1440, 1024, 390]) {
      await page.setViewport({ width: w, height: 900 });
      await sleep(300);
      const g = await ev((ids) => {
        const r = (el) => {
          const b = el.getBoundingClientRect();
          return { left: b.left, right: b.right, top: b.top, height: b.height };
        };
        const bar = r(document.querySelector('.filterbar'));
        const sel = ids.map((i) => r(document.getElementById(i)));
        const mod = r(document.getElementById('filterIssue'));
        const reset = r(document.getElementById('resetFilters'));
        const kotak = [...document.querySelectorAll('.filterbar select, .filterbar button')].map(
          (e) => r(e),
        );
        return {
          sel,
          mod,
          reset,
          bar,
          luar: kotak.some((k) => k.left < bar.left - 0.5 || k.right > bar.right + 0.5),
          limpah: document.documentElement.scrollWidth > window.innerWidth + 1,
          lajur: new Set(kotak.map((k) => Math.round(k.left))).size,
          tinggi: [...new Set([...sel, mod].map((k) => Math.round(k.height)))],
          label: [...document.querySelectorAll('.filterbar .ctrl > span')].map((s) =>
            s.textContent.trim(),
          ),
        };
      }, IDS);
      ok(`tiada limpahan ${w}`, !g.limpah && !g.luar, g);
      ok(`tinggi select sama ${w}`, g.tinggi.length === 1, g.tinggi);
      ok(
        'label ringkas',
        g.label.join('|') ===
          'Negeri|Pusat Operasi|Bulan|Minggu|Komoditi|Varieti|Indikator|Mod senarai',
        g.label,
      );
      if (w === 1440) {
        const atas = new Set([...g.sel, g.mod, g.reset].map((k) => Math.round(k.top + k.height)));
        ok('satu baris pada 1440', atas.size === 1, [...atas]);
        const kiri = g.sel.map((k) => k.left);
        ok(
          'susunan kiri ke kanan',
          kiri.every((x, i) => i === 0 || x > kiri[i - 1]),
          kiri,
        );
        ok(
          'Mod senarai dan Set Semula selepas enam',
          g.mod.left > g.sel[5].left && g.reset.left > g.mod.left,
        );
      } else {
        ok(`berbilang lajur ${w}`, g.lajur === (w === 1024 ? 3 : 2), g.lajur);
      }
    }
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(300);

    // 2. Negeri -> Pusat Operasi
    const neg = await opsi('filterNegeri');
    ok(
      'Negeri: Semua + 13 negeri A-Z',
      neg.length === 14 &&
        neg[0][0] === 'all' &&
        neg.slice(1).every((o, i, a) => !i || a[i - 1][1].localeCompare(o[1], 'ms') <= 0),
      neg,
    );
    const poSemua = await opsi('filterState');
    ok('PO: semua + 15', poSemua.length === 16, poSemua.length);
    await pilih('filterNegeri', 'Selangor');
    ok(
      'Selangor -> Dengkil + Selayang',
      (await opsi('filterState')).map((o) => o[1]).join() === 'Semua PO,PO Dengkil,PO Selayang',
      await opsi('filterState'),
    );
    const kSel = await kpi();
    ok('KPI PO Dalam Tapisan = 2 (Selangor)', kSel['PO Dalam Tapisan'] === '2', kSel);
    const peta = await ev(() => ({
      penanda: document.querySelectorAll('.po-marker').length,
      bil: document.getElementById('mapPOCount').textContent,
      pandangan: typeof mapView !== 'undefined' && mapView ? mapView.negeri : null,
      daerah: typeof mapView !== 'undefined' && mapView ? mapView.districts.length : 0,
      po: state.po,
      chip: document.getElementById('scopeChip').textContent,
    }));
    ok(
      'peta: 2 penanda PO + zum negeri',
      peta.penanda === 2 && peta.pandangan === 'Selangor' && peta.po === null && peta.daerah > 0,
      peta,
    );
    await pilih('filterNegeri', 'Johor');
    ok(
      'Johor -> Johor Baharu + Simpang Renggam',
      (await opsi('filterState')).map((o) => o[1]).join() ===
        'Semua PO,PO Johor Baharu,PO Simpang Renggam',
    );
    await pilih('filterNegeri', 'Perlis');
    ok('Perlis -> Kangar sahaja', (await opsi('filterState')).length === 2);
    ok('KPI Perlis = 1', (await kpi())['PO Dalam Tapisan'] === '1');

    // 3. PO menetapkan Negeri, dan berkelakuan seperti klik
    await pilih('filterNegeri', 'all');
    await pilih('filterState', 'simpangrenggam');
    const s1 = await ev(() => ({
      negeri: document.getElementById('filterNegeri').value,
      po: state.po,
      mod: document.getElementById('mapMode').textContent,
      daftar: [...document.getElementById('filterState').options]
        .filter((o) => !o.closest('optgroup'))
        .map((o) => o.value)
        .join(),
      mapView: mapView && mapView.id,
    }));
    ok('PO menetapkan Negeri', s1.negeri === 'Johor' && s1.po === 'simpangrenggam', s1);
    ok(
      'PO: zum daerah seliaan',
      s1.mod === 'ZOOM: DAERAH SELIAAN' && s1.mapView === 'simpangrenggam',
      s1,
    );
    ok('PO: senarai terhad kepada negeri', s1.daftar === 'all,johor,simpangrenggam', s1);
    // Tukar negeri lain membuang PO yang tidak sepadan
    await pilih('filterNegeri', 'Sabah');
    ok('tukar Negeri mengosongkan PO tak sepadan', (await ev(() => state.po)) === null);
    // PO "Semua" mengekalkan Negeri
    await pilih('filterState', 'sabah');
    await pilih('filterState', 'all');
    ok(
      'PO Semua kekal dalam Negeri',
      (await ev(() => state.negeri + '|' + state.po)) === 'Sabah|null',
    );

    // 4. Bulan: pilihan daripada meta (/api/harga/meta), menapis panel harga dan trend
    await pilih('filterNegeri', 'all');
    const meta = await (await fetch(base + '/api/harga/meta')).json();
    const namaBulan = [
      'Januari',
      'Februari',
      'Mac',
      'April',
      'Mei',
      'Jun',
      'Julai',
      'Ogos',
      'September',
      'Oktober',
      'November',
      'Disember',
    ];
    const bulanJangka = [...meta.penapis.bulan]
      .sort()
      .reverse()
      .map((k) => [k, namaBulan[+k.slice(5) - 1] + ' ' + k.slice(0, 4)]);
    const bul = await opsi('filterBulan');
    ok(
      'Bulan: Semua bulan + bulan daripada meta (terbaharu dahulu)',
      JSON.stringify(bul) === JSON.stringify([['all', 'Semua bulan'], ...bulanJangka]),
      { bul, bulanJangka },
    );
    ok(
      'Bulan lalai = Semua bulan (minggu lengkap terkini)',
      (await ev(() => document.getElementById('filterBulan').value)) === 'all',
    );
    ok('ada sekurang-kurangnya 2 bulan', bulanJangka.length >= 2, bulanJangka);
    await pilih('filterCommodity', 'CILI');
    await pilih('filterIssue', 'false');
    const papar = () =>
      ev(() => document.querySelector('#lowestPrices .price-value')?.textContent.trim());
    const nilaiBulan = {};
    for (const k of ['all', ...bulanJangka.map((b) => b[0])]) {
      await pilih('filterBulan', k);
      const j = await (
        await fetch(
          base +
            '/api/harga?mod=pengeluar&aras=daerah&commodity=CILI' +
            (k === 'all' ? '' : '&bulan=' + k),
        )
      ).json();
      const min = Math.min(...j.baris.filter((r) => r.harga != null).map((r) => r.harga));
      nilaiBulan[k] = [await papar(), 'RM ' + min.toFixed(2)];
      ok(`Harga Terendah ikut bulan ${k}`, nilaiBulan[k][0] === nilaiBulan[k][1], nilaiBulan[k]);
    }
    ok(
      'bulan berbeza memberi harga berbeza',
      new Set(Object.values(nilaiBulan).map((v) => v[0])).size > 1,
      nilaiBulan,
    );
    await pilih('filterBulan', bulanJangka[0][0]);
    const cmpTerkini = await ev(() => document.getElementById('compareBody').innerText);
    await pilih('filterBulan', bulanJangka[bulanJangka.length - 1][0]);
    const cmpLama = await ev(() => document.getElementById('compareBody').innerText);
    ok('Perbandingan berubah mengikut bulan', cmpTerkini !== cmpLama && cmpLama.includes('RM'));
    // Trend: bulan menapis julat titik
    const hari = async (k) => {
      await pilih('filterBulan', k);
      return ev(() => document.getElementById('chartSubject').textContent);
    };
    const tAll = await hari('all');
    ok(
      'trend Semua bulan = 30 hari terakhir',
      /(\d+) hari/.test(tAll) && +/(\d+) hari/.exec(tAll)[1] <= 30,
      tAll,
    );
    const tLama = await hari(bulanJangka[bulanJangka.length - 1][0]);
    ok(
      'trend bulan lama memaparkan nama bulan',
      tLama.includes(bulanJangka[bulanJangka.length - 1][1]),
      tLama,
    );

    // 5. Komoditi -> Varieti
    await pilih('filterBulan', 'all');
    await pilih('filterCommodity', 'all');
    const v0 = await ev(() => {
      const s = document.getElementById('filterVarieti');
      return [s.disabled, s.options.length, s.options[0].textContent];
    });
    ok('Varieti dinyahaktif tanpa komoditi', v0[0] === true && v0[1] === 1, v0);
    await pilih('filterCommodity', 'CILI');
    const v2 = await opsi('filterVarieti');
    ok(
      'Varieti: Semua + varieti komoditi sahaja',
      v2.map((o) => o[0]).join() === 'all,' + meta.penapis.varieti.CILI.join(),
      v2,
    );
    await pilih('filterVarieti', 'CILI MERAH KULAI / KULAI HIBRID');
    const rv = await ev(() => {
      const r = filteredRecords({ issues: false });
      return [r.length, r.every((x) => x.variety === state.varieti && x.commodity === 'CILI')];
    });
    ok('Varieti menapis rekod', rv[0] > 0 && rv[1], rv);
    await pilih('filterCommodity', 'KUBIS');
    const v3 = await ev(() => [
      document.getElementById('filterVarieti').value,
      [...document.getElementById('filterVarieti').options].map((o) => o.value).join(),
    ]);
    ok(
      'tukar Komoditi menetap semula Varieti & ubah senarai',
      v3[0] === 'all' && v3[1] === 'all,' + meta.penapis.varieti.KUBIS.join(),
      v3,
    );

    // 6. Set Semula
    await pilih('filterNegeri', 'Selangor');
    await pilih('filterState', 'selayang');
    await pilih('filterBulan', bulanJangka[0][0]);
    await pilih('filterCommodity', 'CILI');
    await pilih('filterSeverity', 'merah');
    await pilih('filterIssue', 'false');
    await page.click('#resetFilters');
    await sleep(400);
    const r0 = await ev(
      (ids) => ({
        nilai: ids.map((i) => document.getElementById(i).value),
        mod: document.getElementById('filterIssue').value,
        st: [
          state.po,
          state.negeri,
          state.bulan,
          state.komoditi,
          state.varieti,
          state.indikator,
          state.issues,
          mapView,
          state.minggu,
        ],
        po: [...document.getElementById('filterState').options].filter(
          (o) => !o.closest('optgroup'),
        ).length,
      }),
      IDS,
    );
    ok(
      'Set Semula: semua nilai asal',
      JSON.stringify(r0.nilai) === JSON.stringify(IDS.map(() => 'all')) &&
        r0.mod === 'true' &&
        r0.po === 16,
      r0,
    );
    ok(
      'Set Semula: state asal',
      r0.st[8] === 'all' &&
        r0.st[0] === null &&
        r0.st[1] === 'all' &&
        r0.st[2] === 'all' &&
        r0.st[3] === 'all' &&
        r0.st[4] === 'all' &&
        r0.st[5] === 'all' &&
        r0.st[6] === true &&
        r0.st[7] === null,
      r0.st,
    );
    ok('KPI selepas Set Semula = 15 PO', (await kpi())['PO Dalam Tapisan'] === '15');

    // 7. KPI mengikut Negeri; CSV mengikut tapisan
    await pilih('filterNegeri', 'Johor');
    const kj = await kpi();
    ok(
      'KPI Johor jumlah = 2',
      kj['PO Dalam Tapisan'] === '2' &&
        +kj['PO Amaran Harga'] +
          +kj['PO Berwaspada'] +
          +kj['PO Stabil'] +
          +kj['PO Tiada Ambang'] ===
          2,
      kj,
    );
    const csv = await ev(async () => {
      let teks = '';
      const asal = URL.createObjectURL;
      URL.createObjectURL = (b) => {
        b.text().then((t) => (teks = t));
        return 'blob:x';
      };
      HTMLAnchorElement.prototype.click = function () {};
      state.bulan = 'all';
      exportCSV();
      await new Promise((r) => setTimeout(r, 200));
      URL.createObjectURL = asal;
      const baris = teks.replace('\ufeff', '').split('\r\n');
      return {
        kepala: baris[0],
        bil: baris.length - 1,
        negeri: [...new Set(baris.slice(1).map((b) => b.split(',')[1]))],
      };
    });
    ok(
      'CSV: negeri tertapis + lajur minggu',
      csv.negeri.join() === '"Johor"' && csv.kepala.includes('minggu') && csv.bil > 0,
      csv,
    );

    ok('tiada pageerror', konsol.length === 0, konsol);

    // 8. Tangkapan skrin bar penapis (pilihan)
    if (process.env.PENAPIS_SHOTS) {
      fs.mkdirSync(process.env.PENAPIS_SHOTS, { recursive: true });
      await pilih('filterNegeri', 'all');
      for (const tema of ['gelap', 'cerah']) {
        for (const w of [1440, 390]) {
          await page.setViewport({ width: w, height: 900 });
          await ev((t) => {
            document.documentElement.setAttribute('data-theme', t);
          }, tema);
          await sleep(400);
          const box = await ev(() => {
            const b = document.querySelector('.filterbar').getBoundingClientRect();
            return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height };
          });
          await page.screenshot({
            path: path.join(process.env.PENAPIS_SHOTS, `penapis-${tema}-${w}.png`),
            clip: {
              x: Math.max(0, box.x - 8),
              y: Math.max(0, box.y - 8),
              width: Math.min(1600, box.w + 16),
              height: Math.min(1600, box.h + 16),
            },
          });
        }
      }
    }
  } catch (e) {
    gagal.push('ralat ujian: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
    server.close();
  }
  if (gagal.length) {
    console.error('GAGAL penapis-pemantauan:\n - ' + gagal.join('\n - '));
    process.exit(1);
  }
  console.log('OK penapis-pemantauan');
  process.exit(0);
})();

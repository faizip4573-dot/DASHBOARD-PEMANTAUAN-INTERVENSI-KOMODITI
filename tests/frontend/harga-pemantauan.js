'use strict';
// Tab Pemantauan memakai harga sebenar (DB Harga, fixture tests/fixtures/harga-db): penapis lata, KPI, warna
// PO/daerah, empat panel harga, trend dengan jalur sigma dan Lantai/Siling, CSV Harga, lencana, keadaan ralat.
// Jalankan dari root: node tests/frontend/harga-pemantauan.js
// HARGA_SHOTS=<folder> menyimpan tangkapan skrin dikliping (maks 1600x1600, tema gelap dan cerah).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { pasangSemuaCache, pasangCacheHarga } = require('../helpers/banjir-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
pasangSemuaCache();
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = process.env.HARGA_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gagal = [];
const ok = (nama, cond, info) => {
  if (!cond)
    gagal.push(nama + (info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 500) : ''));
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (q) => (await fetch(base + '/api/harga' + q)).json();
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harga-pem-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const konsol = [];
  const buka = async (url, pengendali) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => konsol.push('pageerror: ' + e.message));
    if (pengendali) await stubApi(page, pengendali);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    return page;
  };
  const sedia = (page) => page.waitForFunction(() => HD.sedia, { timeout: 30000 });
  try {
    const meta = await api('/meta');
    const page = await buka(base + '/');
    await sedia(page);
    await sleep(800);
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const pilih = async (id, v) => {
      await page.select('#' + id, v);
      await sedia(page);
      await sleep(350);
    };
    const opsi = (id) =>
      ev(
        (i) => [...document.getElementById(i).options].map((o) => [o.value, o.textContent.trim()]),
        id,
      );
    const kpi = () =>
      ev(() =>
        Object.fromEntries(
          [...document.querySelectorAll('#kpis .kpi')].map((k) => [
            k.querySelector('.kpi-label').textContent.trim(),
            +k.querySelector('.kpi-value').textContent.trim(),
          ]),
        ),
      );
    const statusPO = () =>
      ev(() =>
        Object.fromEntries(
          DATA.po.map((p) => {
            // MapLibre menimpa aria-label penanda; padankan melalui label teks PO dan kelas status.
            const m = [...document.querySelectorAll('.po-marker')].find(
              (e) => e.querySelector('.po-label')?.textContent === p.label,
            );
            return [p.id, m ? /status-(\w+)/.exec(m.className)[1] : null];
          }),
        ),
      );

    // 1. Teks halaman: harga sebenar, bukan dummy
    const teks = await ev(() => ({
      tajuk: document.title,
      lencana: document.querySelector('.demo-badge').textContent,
      csv: document.getElementById('downloadCsv').textContent,
      monitor: document.getElementById('viewMonitor').innerText,
    }));
    ok(
      '<title> harga sebenar',
      /Harga Sebenar/.test(teks.tajuk) && !/Data Dummy/.test(teks.tajuk),
      teks.tajuk,
    );
    ok('lencana harga sebenar', /HARGA SEBENAR/.test(teks.lencana), teks.lencana);
    ok(
      'butang CSV Harga (bukan Dummy)',
      /CSV Harga/.test(teks.csv) && !/Dummy/i.test(teks.csv),
      teks.csv,
    );
    ok('tiada DATA DUMMY pada Pemantauan', !/DATA DUMMY/.test(teks.monitor));

    // 2. Lencana tarikh data dan minggu separa
    const lc = await ev(() => document.getElementById('hargaLencana').innerText);
    ok('lencana tarikh terkini', /Data harga terkini: 2026-11-04/.test(lc), lc);
    ok('lencana minggu semasa separa', /Minggu semasa: separa/.test(lc), lc);
    ok('tiada lencana lapuk', !/lapuk/i.test(lc), lc);

    // 3. Penapis lata daripada meta
    const bul = await opsi('filterBulan');
    ok(
      'Bulan daripada meta (terbaharu dahulu)',
      JSON.stringify(bul) ===
        JSON.stringify([
          ['all', 'Semua bulan'],
          ...[...meta.penapis.bulan]
            .sort()
            .reverse()
            .map((k) => [
              k,
              [
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
              ][+k.slice(5) - 1] +
                ' ' +
                k.slice(0, 4),
            ]),
        ]),
      bul,
    );
    const kom = await opsi('filterCommodity');
    ok(
      'Komoditi daripada meta',
      kom.length === meta.penapis.komoditi.length + 1 &&
        meta.penapis.komoditi.every((c) => kom.some((o) => o[0] === c)),
      kom,
    );
    await pilih('filterCommodity', 'CILI');
    ok(
      'Varieti ikut Komoditi',
      (await opsi('filterVarieti')).map((o) => o[0]).join() ===
        'all,' + meta.penapis.varieti.CILI.join(),
      await opsi('filterVarieti'),
    );
    await pilih('filterNegeri', 'Selangor');
    ok(
      'Negeri -> PO',
      (await opsi('filterState'))
        .slice(0, 3)
        .map((o) => o[1])
        .join() === 'Semua PO,PO Dengkil,PO Selayang', // diikuti optgroup 'PO tambahan' (suis ON)
    );
    ok('KPI PO Dalam Tapisan = 2', (await kpi())['PO Dalam Tapisan'] === 2);
    await pilih('filterNegeri', 'all');
    ok(
      'Indikator ada Kelabu',
      (await opsi('filterSeverity')).map((o) => o[0]).join() === 'all,merah,kuning,hijau,kelabu',
    );

    // 4. KPI, penanda PO dan poligon daerah mengikut status (Komoditi CILI)
    const rowsPO = async (q) => (await api('?aras=po&commodity=CILI&' + q)).baris;
    const lad = await rowsPO('mod=pengeluar');
    const run = await rowsPO('peringkat=RUNCIT');
    const jangka = {};
    for (const id of meta.penapis.po.map((p) => p.id)) {
      const st = [...lad, ...run]
        .filter((r) => r.po === id)
        .map((r) => (r.amaranPo ? r.amaranPo.status : r.status));
      jangka[id] = ['merah', 'kuning', 'hijau'].find((s) => st.includes(s)) || 'kelabu';
    }
    const k1 = await kpi();
    const bil = (s) => Object.values(jangka).filter((x) => x === s).length;
    ok(
      'KPI ikut status PO',
      k1['PO Amaran Harga'] === bil('merah') &&
        k1['PO Berwaspada'] === bil('kuning') &&
        k1['PO Stabil'] === bil('hijau') &&
        k1['PO Tiada Ambang'] === bil('kelabu'),
      { k1, jangka },
    );
    ok(
      'fixture: ada merah, kuning dan kelabu (hijau perlu liputan data daerah >= 50%, fixture nipis)',
      bil('merah') > 0 && bil('kuning') > 0 && bil('kelabu') > 0,
      jangka,
    );
    ok(
      'Selangor merah, Kedah kuning, Pahang kelabu (liputan data daerah < 50%)',
      jangka.selangor === 'merah' && jangka.kedah === 'kuning' && jangka.pahang === 'kelabu',
      jangka,
    );
    const sp = await statusPO();
    ok(
      'penanda PO sepadan status',
      Object.entries(jangka).every(([id, s]) => sp[id] === s),
      { sp, jangka },
    );
    const kelip = await ev(() => {
      const m = document.querySelector('.po-marker.status-merah .halo');
      return m ? getComputedStyle(m).animationName : 'tiada-penanda-merah';
    });
    ok('penanda PO merah berkelip', kelip === 'pulsate', kelip);
    const poli = await ev(() => FamaDaerah.statusDaerah());
    ok(
      'poligon daerah berwarna dan sah',
      Object.keys(poli).length >= 20 &&
        Object.values(poli).every((s) => ['merah', 'kuning', 'hijau', 'kelabu'].includes(s)),
      poli,
    );
    const d1 = await ev(() =>
      JSON.stringify(map.getPaintProperty('daerah-denyut', 'fill-opacity')),
    );
    await sleep(1700);
    ok(
      'poligon merah tidak berdenyut',
      d1 ===
        (await ev(() => JSON.stringify(map.getPaintProperty('daerah-denyut', 'fill-opacity')))),
    );

    // 5. Kelabu "tiada ambang" tidak pernah hijau (BAYAM tiada ambang)
    await pilih('filterCommodity', 'BAYAM');
    const kb = await kpi();
    ok(
      'BAYAM: semua PO kelabu',
      kb['PO Tiada Ambang'] === 15 && kb['PO Stabil'] === 0 && kb['PO Amaran Harga'] === 0,
      kb,
    );
    ok(
      'BAYAM: penanda kelabu',
      (await ev(() => document.querySelectorAll('.po-marker.status-kelabu').length)) === 15,
    );
    ok(
      'BAYAM: poligon kelabu, tiada hijau',
      (await ev(() => Object.values(FamaDaerah.statusDaerah()))).every((s) => s === 'kelabu'),
    );

    // 6. BORONG pembanding sentiasa kelabu
    await pilih('filterCommodity', 'CILI');
    const bo = await ev(() =>
      [...document.querySelectorAll('#highestPrices .price-row')].map((r) => [
        r.querySelector('.status-text').className,
        r.querySelector('.price-sebab').textContent,
      ]),
    );
    ok(
      'BORONG: status kelabu "pembanding"',
      bo.length > 0 && bo.every(([c, s]) => /status-kelabu/.test(c) && /Pembanding/.test(s)),
      bo,
    );

    // 7. Pengeluar tanpa ladang: Tiada harga ladang + harga borong ganti berlabel (BAWANG)
    await pilih('filterCommodity', 'BAWANG');
    await pilih('filterIssue', 'false');
    const tl = await ev(() =>
      [...document.querySelectorAll('#lowestPrices .price-row')].map((r) => r.innerText),
    );
    ok(
      'Tiada harga ladang + ganti borong berlabel + kelabu',
      tl.length > 0 &&
        tl.every(
          (t) =>
            /Tiada harga ladang/.test(t) &&
            /Harga borong \(ganti, tiada data ladang\): RM \d/.test(t) &&
            /Tiada ambang/.test(t),
        ),
      tl,
    );

    // 8. Bulan menapis panel harga (harga daripada API sebenar)
    await pilih('filterCommodity', 'CILI');
    const terendah = (b) =>
      api('?mod=pengeluar&aras=daerah&commodity=CILI' + (b === 'all' ? '' : '&bulan=' + b)).then(
        (j) =>
          'RM ' +
          Math.min(...j.baris.filter((r) => r.harga != null).map((r) => r.harga)).toFixed(2),
      );
    const nilai = {};
    for (const b of ['all', ...meta.penapis.bulan]) {
      await pilih('filterBulan', b);
      nilai[b] = [
        await ev(() => document.querySelector('#lowestPrices .price-value')?.textContent.trim()),
        await terendah(b),
      ];
      ok(`Harga Terendah bulan ${b} = API`, nilai[b][0] === nilai[b][1], nilai[b]);
    }
    ok(
      'bulan berbeza memberi harga berbeza',
      new Set(Object.values(nilai).map((v) => v[0])).size > 1,
      nilai,
    );
    await pilih('filterBulan', 'all');

    // 9. Empat panel harga + trend (jalur sigma, Lantai/Siling)
    const panel = await ev(() => ({
      rendah: document.querySelectorAll('#lowestPrices .price-row').length,
      tinggi: document.querySelectorAll('#highestPrices .price-row').length,
      banding: document.querySelectorAll('#compareBody tr[data-record]').length,
      nota: document.getElementById('compareNota').textContent,
      svg: document.getElementById('priceChart').textContent,
      garis: document.querySelectorAll('#priceChart polyline.line').length,
      subjek: document.getElementById('chartSubject').textContent,
      status: document.getElementById('chartStatus').textContent,
    }));
    ok('5 Terendah ada baris', panel.rendah > 0 && panel.rendah <= 5, panel);
    ok('5 Tertinggi ada baris', panel.tinggi > 0 && panel.tinggi <= 5, panel);
    ok(
      'Perbandingan ada baris + minggu ISO',
      panel.banding > 0 && /Minggu 2026-W\d\d/.test(panel.nota),
      panel,
    );
    ok(
      'Trend: jalur +-1/2 sigma, mu, Lantai, Siling',
      ['+2σ', '−2σ', '+1σ', '−1σ', 'μ', 'Lantai', 'Siling'].every((t) => panel.svg.includes(t)) &&
        panel.garis === 1,
      panel.svg.slice(0, 300),
    );
    ok(
      'Trend: label asas tahun + status + sebab',
      /asas 2025/.test(panel.subjek) && panel.status.length > 8,
      panel,
    );
    ok(
      'Trend: tiada ramalan prototaip',
      !/Ramalan/.test(panel.svg) && !/Forecast/i.test(panel.status),
    );

    // 10. CSV Harga
    const csv = await ev(async () => {
      let isi = '';
      let nama = '';
      const asal = URL.createObjectURL;
      URL.createObjectURL = (b) => {
        b.text().then((t) => (isi = t));
        return 'blob:x';
      };
      HTMLAnchorElement.prototype.click = function () {
        nama = this.download;
      };
      exportCSV();
      await new Promise((r) => setTimeout(r, 250));
      URL.createObjectURL = asal;
      const baris = isi.replace('\ufeff', '').split('\r\n');
      return {
        nama,
        kepala: baris[0],
        bil: baris.length - 1,
        jangka: filteredRecords({ issues: false }).length,
        toast: document.getElementById('toast').textContent,
      };
    });
    ok('CSV: nama fail fama_harga_tapisan.csv', csv.nama === 'fama_harga_tapisan.csv', csv);
    ok(
      'CSV: lajur status, sebab, tahunAsas',
      ['peringkat', 'status', 'sebab', 'tahunAsas', 'harga'].every((f) => csv.kepala.includes(f)),
      csv.kepala,
    );
    ok(
      'CSV: bilangan rekod mengikut tapisan',
      csv.bil === csv.jangka &&
        csv.bil > 0 &&
        new RegExp(`^${csv.bil} rekod CSV dieksport`).test(csv.toast),
      csv,
    );

    // 11. Tangkapan skrin dikliping (pilihan)
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await pilih('filterIssue', 'true');
      await page.setViewport({ width: 1440, height: 900 });
      for (const tema of ['gelap', 'cerah']) {
        await ev((t) => document.documentElement.setAttribute('data-theme', t), tema);
        await sleep(600);
        const klip = await ev(() => {
          const a = document.querySelector('.filterbar').getBoundingClientRect();
          const b = document.querySelector('.susun-harga').getBoundingClientRect();
          return {
            x: Math.max(0, Math.floor(a.left)),
            y: Math.max(0, Math.floor(a.top + scrollY)),
            width: Math.min(1600, Math.ceil(a.width)),
            height: Math.min(1600, Math.ceil(b.bottom - a.top)),
          };
        });
        await page.screenshot({
          path: path.join(SHOTS, `pemantauan-${tema}.png`),
          clip: klip,
          captureBeyondViewport: true,
        });
      }
    }
    await page.close();

    // 12. Lencana lapuk (data terkini > 8 hari)
    pasangCacheHarga({ sekarang: '2026-11-21T00:00:00.000Z' });
    const pl = await buka(base + '/');
    await sedia(pl);
    const lapuk = await pl.evaluate(() => document.getElementById('hargaLencana').innerText);
    ok('lencana lapuk', /Data lapuk · terkini 2026-11-04/.test(lapuk), lapuk);
    await pl.close();
    pasangCacheHarga();

    // 13. Keadaan ralat dengan "Cuba semula" yang berfungsi
    const pr = await buka(base + '/', { harga: { status: 503 } });
    await pr.waitForFunction(() => HD.ralat && !HD.sedia, { timeout: 20000 });
    const ral = await pr.evaluate(() => ({
      keadaan: document.getElementById('hargaKeadaan').innerText,
      butang: !!document.getElementById('hargaCubaSemula'),
      senarai: document.getElementById('lowestPrices').innerText,
      kpi: document.querySelector('#kpis .kpi-value').textContent,
    }));
    ok(
      'ralat: mesej + butang Cuba semula',
      /tidak dapat dimuatkan/.test(ral.keadaan) && ral.butang,
      ral,
    );
    ok(
      'ralat: panel tidak memaparkan harga palsu',
      /tidak dapat dimuatkan/.test(ral.senarai),
      ral.senarai,
    );
    pr.removeAllListeners('request');
    await pr.setRequestInterception(false);
    await pr.click('#hargaCubaSemula');
    await pr.waitForFunction(() => HD.sedia, { timeout: 20000 });
    const pulih = await pr.evaluate(() => ({
      hidden: document.getElementById('hargaKeadaan').hidden,
      baris: document.querySelectorAll('#highestPrices .price-row').length,
    }));
    ok('Cuba semula memulihkan data', pulih.hidden && pulih.baris > 0, pulih);
    await pr.close();

    // 14. file:// memaparkan mesej jelas
    const fileUrl = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');
    const pf = await buka(fileUrl);
    await pf.waitForFunction(
      () => /npm start/.test(document.getElementById('hargaKeadaan').innerText),
      { timeout: 20000 },
    );
    const fi = await pf.evaluate(() => ({
      keadaan: document.getElementById('hargaKeadaan').innerText,
      cuba: !!document.getElementById('hargaCubaSemula'),
    }));
    ok(
      'file://: mesej npm start, tiada butang Cuba semula',
      /npm start/.test(fi.keadaan) && !fi.cuba,
      fi,
    );
    await pf.close();

    ok('tiada pageerror', konsol.length === 0, konsol);
  } catch (e) {
    gagal.push('ralat ujian: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
    server.close();
  }
  if (gagal.length) {
    console.error('GAGAL harga-pemantauan:\n - ' + gagal.join('\n - '));
    process.exit(1);
  }
  console.log('OK harga-pemantauan');
  process.exit(0);
})();

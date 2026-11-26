// Tab Intervensi memakai harga sebenar (DB Harga, fixture tests/fixtures/harga-db): senarai keutamaan daripada
// status sebenar, Kritikal (berkelip) hanya dengan pengesahan bekalan, "Amaran harga" tanpa pengesahan, kelabu
// bukan hijau, Pengeluar tanpa ladang (ganti borong), harga mobilisasi, margin, sejarah spread, lencana,
// keadaan memuat/ralat/lapuk/file://.
// Jalankan dari root: node --no-warnings tests/frontend/harga-intervensi.js
// HARGA_SHOTS=<folder> menyimpan tangkapan skrin dikliping (maks 1600x1600, kedua-dua tab, gelap dan cerah).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/server.js');
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
// Isnin bagi satu tarikh YYYY-MM-DD (UTC) dan tambah hari.
const tambah = (ds, n) => {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isnin = (ds) => {
  const [y, m, d] = ds.split('-').map(Number);
  return tambah(ds, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
};
// Purata mingguan minggu lengkap daripada siri harian (sama dengan sejarah margin Intervensi).
function mingguan(titik, terkini) {
  const by = new Map();
  titik.forEach((p) => {
    const w = isnin(p.t);
    if (!by.has(w)) by.set(w, []);
    by.get(w).push(p.h);
  });
  const out = new Map();
  by.forEach((v, w) => {
    if (tambah(w, 6) <= terkini) out.set(w, v.reduce((a, b) => a + b, 0) / v.length);
  });
  return out;
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (q) => (await fetch(base + '/api/harga?' + q)).json();
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harga-iv-')),
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
  const sediaIv = (page) => page.waitForFunction(() => IV_TEST.ivHarga().sedia, { timeout: 30000 });
  try {
    const borP = (await api('peringkat=BORONG&aras=po')).baris;
    // PO tambahan juga calon mobilisasi (harga Borong aras po_tambahan)
    borP.push(...(await api('peringkat=BORONG&aras=po_tambahan')).baris);
    const ladP = (await api('mod=pengeluar&aras=po')).baris;
    const cari = (rows, po, kom, vari) =>
      rows.find((r) => r.po === po && r.commodity === kom && r.variety === vari);
    const CILI = ['CILI', 'CILI MERAH KULAI / KULAI HIBRID'];

    const page = await buka(base + '/');
    await page.click('#ivTabIv');
    await sediaIv(page);
    await sleep(800);
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const mod = async (m) => {
      await ev((x) => {
        IV_TEST.dispatch('resetFilters');
        IV_TEST.dispatch('setMode', x);
      }, m);
      await sleep(400);
    };

    // 1. Lencana, label dan tiada baki dummy harga
    const teks = await ev(() => ({
      lencana: document.getElementById('ivHargaLencana').innerText,
      keadaan: document.getElementById('ivHargaKeadaan').hidden,
      kepala: document.querySelector('#viewIntervensi .iv-head').innerText,
      overlay: typeof window.IV_PRICE_OVERLAY,
      senarai: document.getElementById('ivPriList').innerText,
    }));
    ok('lencana tarikh terkini', /Data harga terkini: 2026-11-04/.test(teks.lencana), teks.lencana);
    ok('lencana minggu semasa separa', /Minggu semasa: separa/.test(teks.lencana), teks.lencana);
    ok('tiada lencana lapuk', !/lapuk/i.test(teks.lencana), teks.lencana);
    ok('blok keadaan tersembunyi bila data sedia', teks.keadaan === true);
    ok(
      'kepala: DB Harga + bekalan dummy',
      /DB Harga/.test(teks.kepala) && /DATA DUMMY/.test(teks.kepala),
      teks.kepala,
    );
    ok('IV_PRICE_OVERLAY tiada', teks.overlay === 'undefined', teks.overlay);
    ok('tiada "Senario ujian" pada senarai', !/Senario ujian/.test(teks.senarai), teks.senarai);
    const sumber = fs.readFileSync(path.resolve(__dirname, '../../src/js/intervensi.js'), 'utf8');
    ok(
      'sumber: tiada IV_PRICE_OVERLAY/IV_SCENARIO_TAG/DATA.rekod/HARGA.',
      !/IV_PRICE_OVERLAY|IV_SCENARIO_TAG|DATA\.rekod|\bHARGA\./.test(sumber),
    );

    // 2. Bekalan (mod pengeluar): penunjuk = harga Borong dinilai arah turun (/api/harga?peringkat=BORONG&arah=turun).
    //    Tahap: merah = Kritikal, kuning = Waspada; label "Harga borong ..."; kelabu tidak dalam senarai isu.
    await mod('pengeluar');
    const borPA = (await api('peringkat=BORONG&aras=po&arah=turun')).baris;
    const borDA = (await api('peringkat=BORONG&aras=daerah&arah=turun')).baris;
    const P1 = await ev(() =>
      IV_TEST.priRows().map((x) => ({
        ...x,
        st: IV_TEST.recsNow().find((r) => r.id === x.id).price.statusKongsi,
      })),
    );
    const TAHAP = { merah: 'kritikal', kuning: 'waspada' };
    ok(
      'Bekalan: senarai isu = Borong merah/kuning, label harga borong',
      P1.every((x) => TAHAP[x.st] === x.level && /^Harga borong (jatuh|berwaspada)$/.test(x.label)),
      P1.slice(0, 5),
    );
    const isuApi = borDA.filter(
      (x) => x.po && (x.status === 'merah' || x.status === 'kuning'),
    ).length;
    ok('Bekalan: bilangan isu sepadan dengan API (daerah PO)', P1.length <= isuApi, [
      P1.length,
      isuApi,
    ]);
    // Penanda PO: kelabu bukan hijau; warna = amaranPo BORONG (arah turun) terburuk merentas komoditi
    const kls = await ev(() =>
      Object.fromEntries(
        [...document.querySelectorAll('#ivMap .po-marker')].map((e) => [
          e.dataset.ivPo,
          e.className,
        ]),
      ),
    );
    ok(
      'PO kelabu tidak hijau',
      Object.values(kls).every((c) => !(/status-kelabu/.test(c) && /status-hijau/.test(c))),
      kls,
    );
    const W = { kelabu: 0, hijau: 1, kuning: 2, merah: 3 };
    const jangkaIv = {};
    borPA.forEach((r) => {
      const s = r.amaranPo ? r.amaranPo.status : r.status;
      if (!jangkaIv[r.po] || W[s] > W[jangkaIv[r.po]]) jangkaIv[r.po] = s;
    });
    const beza = Object.entries(jangkaIv).filter(
      ([po, s]) => kls[po] && !new RegExp('status-' + s + '\\b').test(kls[po]),
    );
    ok(
      'warna PO Intervensi = amaranPo BORONG arah turun (Bekalan)',
      Object.keys(jangkaIv).length >= 10 && beza.length === 0,
      { beza, jangkaIv },
    );
    ok(
      'penunjuk peta: Harga Borong',
      await ev(() =>
        /Penunjuk: Harga Borong · amaran apabila harga turun/.test(document.body.innerText),
      ),
    );

    // 3. Pengguna
    await mod('pengguna');
    const P2 = await ev(() => IV_TEST.priRows());
    const hl = P2.find(
      (x) =>
        x.po === 'selangor' &&
        x.district === 'Hulu Langat' &&
        x.commodity === 'cili-merah-kulai-kulai-hibrid',
    );
    ok(
      'Pengguna: merah = Kritikal (Hulu Langat)',
      hl && hl.level === 'kritikal' && /^Kenaikan harga runcit/.test(hl.label),
      hl,
    );
    const kng = P2.find(
      (x) => x.po === 'perlis' && x.commodity === 'cili-merah-kulai-kulai-hibrid',
    );
    ok(
      'Pengguna: Kangar merah = Kritikal (tanpa pengesahan bekalan)',
      kng && kng.level === 'kritikal' && kng.label === 'Kenaikan harga runcit',
      kng,
    );
    const rujukan = await ev(() => document.getElementById('ivPriList').innerText);
    ok(
      'baris memaparkan sebab dan tahun asas',
      /z = /.test(rujukan) && /asas 20\d\d/.test(rujukan),
      rujukan.slice(0, 400),
    );
    ok('ramalan: tiada (prototaip)', /Ramalan: tiada \(prototaip\)/.test(rujukan));
    ok('tiada sisihan/forecast dummy', !/forecast RM|sisihan [+-]/.test(rujukan));

    // 4. Mod Bekalan menilai harga Borong (arah turun): tiada senarai ganti ladang; status = API BORONG arah=turun
    await mod('pengeluar');
    const ganti = await ev(() => (document.getElementById('ivPriGanti') || {}).innerText || '');
    ok('Bekalan: tiada senarai ganti harga ladang', ganti === '', ganti);
    const borD = (await api('peringkat=BORONG&aras=daerah&arah=turun')).baris;
    const bek = await ev(() =>
      IV_TEST.recsNow().map((r) => [
        r.poId,
        r.district,
        r.price.variety,
        r.price.priceLevel,
        r.price.statusKongsi,
      ]),
    );
    const nd = (s) =>
      String(s || '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
    const bekSalah = bek.filter(([po, d, v, lv, st]) => {
      const a = borD.find((x) => x.po === po && nd(x.daerah) === nd(d) && x.variety === v);
      return lv !== 'Borong' || !a || a.status !== st;
    });
    ok(
      'Bekalan: rekod = harga Borong, status = API arah=turun',
      bek.length > 0 && bekSalah.length === 0,
      bekSalah.slice(0, 5),
    );
    const bwg = cari(ladP, 'simpangrenggam', 'BAWANG', 'BAWANG MERAH / KECIL (IMPORT)');
    ok(
      'API: bawang tanpa harga ladang + ganti',
      bwg && bwg.harga == null && bwg.ganti && bwg.status === 'kelabu',
      bwg,
    );

    // 5. Mobilisasi: harga sumber/destinasi daripada borong sebenar
    const M = await ev(() => {
      IV_TEST.dispatch('resetFilters');
      IV_TEST.dispatch('setMode', 'pengeluar');
      IV_TEST.dispatch('setFilter', ['komoditi', 'CILI']);
      IV_TEST.dispatch('setFilter', ['varieti', 'cili-merah-kulai-kulai-hibrid']);
      IV_TEST.dispatch('selectPO', 'simpangrenggam');
      const jangkar = IV_TEST.resolveMob();
      IV_TEST.dispatch('setMob', ['ref', 7]);
      const e = IV_TEST.engine();
      return {
        jangkar: jangkar.anchorPrice && jangkar.anchorPrice.actual,
        ref: jangkar.ref,
        sumber: jangkar.anchorPrice && jangkar.anchorPrice.source,
        calon: [...e.dalam, ...e.luar].map((x) => [x.poId, x.price]),
      };
    });
    const bj = cari(borP, 'simpangrenggam', ...CILI);
    ok('harga jangkar = borong PO (API)', M.jangkar === bj.harga && M.sumber === 'db-harga', [
      M,
      bj,
    ]);
    ok('harga rujukan lalai = harga Borong PO', M.ref === +bj.harga.toFixed(2), M.ref);
    ok('calon mobilisasi wujud', M.calon.length > 0, M.calon);
    ok(
      'calon termasuk PO tambahan',
      M.calon.some(([po]) => /^tbh-/.test(po)),
      M.calon,
    );
    ok(
      'harga setiap calon = borong PO (API)',
      M.calon.every(([po, h]) => h === cari(borP, po, ...CILI).harga),
      M.calon,
    );
    ok(
      'label sumber dari DB Harga',
      await ev(() =>
        /dari DB Harga/.test(
          document.getElementById('ivMobCtl').innerText +
            document.getElementById('ivMobHead').innerText,
        ),
      ),
    );

    // 6. Margin: Harga Borong Jual = borong PO, ladang = ladang PO, beli = input pengguna
    const MD = await ev(() =>
      IV_TEST.marginDefaults('simpangrenggam', 'cili-merah-kulai-kulai-hibrid'),
    );
    const ld = cari(ladP, 'simpangrenggam', ...CILI);
    ok('margin: jual = borong PO', MD.jual === +bj.harga.toFixed(2), MD);
    ok('margin: ladang = ladang PO', MD.ladang === +ld.harga.toFixed(2), MD);
    ok('margin: beli tiada nilai lalai (input pengguna)', MD.beli === null, MD);
    // 7. Sejarah spread = siri mingguan borong (jual) dan ladang (beli) sebenar
    await ev(() => IV_TEST.historyOf('simpangrenggam', 'cili-merah-kulai-kulai-hibrid'));
    await sleep(1800);
    const H = await ev(() => IV_TEST.historyOf('simpangrenggam', 'cili-merah-kulai-kulai-hibrid'));
    const terkini = (await api('')).tarikhTerkini;
    const sb = (
      await api(
        'siri=1&peringkat=BORONG&po=simpangrenggam&commodity=CILI&variety=' +
          encodeURIComponent(CILI[1]),
      )
    ).siri.titik;
    const sl = (
      await api(
        'siri=1&peringkat=LADANG&po=simpangrenggam&commodity=CILI&variety=' +
          encodeURIComponent(CILI[1]),
      )
    ).siri.titik;
    const mb = mingguan(sb, terkini),
      ml = mingguan(sl, terkini);
    const jangka = [...mb.keys()].filter((w) => ml.has(w)).sort();
    ok(
      'sejarah: minggu lengkap sahaja, menaik',
      H.length === jangka.length && H.length > 0 && H.every((x, i) => x.week === jangka[i]),
      [H, jangka],
    );
    ok(
      'sejarah: jual = purata mingguan borong, beli = purata mingguan ladang',
      H.every(
        (x) =>
          Math.abs(x.jual - mb.get(x.week)) < 0.006 && Math.abs(x.beli - ml.get(x.week)) < 0.006,
      ),
      H,
    );
    ok('sejarah: kurang minHistory minggu', H.length < 8, H.length);
    // Tab Simulasi Margin & Harga AI (susun atur ringkas): harga semasa = ladang/borong PO; kad cadangan menunggu formula
    await ev(() => {
      IV_TEST.dispatch('setFilter', ['komoditi', 'CILI']);
      IV_TEST.dispatch('setFilter', ['varieti', 'cili-merah-kulai-kulai-hibrid']);
      IV_TEST.dispatch('selectPO', 'simpangrenggam');
    });
    await sleep(400);
    const mr = await ev(() => document.getElementById('ivMarRes').innerText);
    ok(
      'margin ringkas: harga ladang dan borong semasa = API, kad cadangan PSI dipaparkan',
      /HARGA LADANG SEMASA/i.test(mr) &&
        mr.includes('RM ' + ld.harga.toFixed(2)) &&
        /HARGA BORONG SEMASA/i.test(mr) &&
        mr.includes('RM ' + bj.harga.toFixed(2)) &&
        /Cadangan Harga Belian PO \(Ladang\)/.test(mr) &&
        /Cadangan Harga Jualan PO \(Borong\)/.test(mr) &&
        /Biasa|Semakan manual|Margin tidak mencukupi|Data tidak lengkap|Memuatkan cadangan|Cadangan tidak dapat dimuatkan/.test(
          mr,
        ) &&
        !/Menunggu formula/.test(mr) &&
        !/NaN|Infinity|Analisis Spread/.test(mr),
      mr.slice(0, 600),
    );

    // 8. Skrin dikliping (pilihan)
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await mod('pengeluar');
      await ev(() => document.getElementById('ivTabIv').scrollIntoView());
      for (const tema of ['gelap', 'cerah']) {
        await ev((t) => document.documentElement.setAttribute('data-theme', t), tema);
        await sleep(700);
        const klip = await ev(() => {
          const a = document.querySelector('#viewIntervensi .iv-head').getBoundingClientRect();
          const b = document.getElementById('ivPriPanel').getBoundingClientRect();
          return {
            x: Math.max(0, Math.floor(a.left)),
            y: Math.max(0, Math.floor(a.top + scrollY)),
            width: Math.min(1600, Math.ceil(a.width)),
            height: Math.min(1600, Math.ceil(b.bottom - a.top)),
          };
        });
        await page.screenshot({
          path: path.join(SHOTS, `intervensi-${tema}.png`),
          clip: klip,
          captureBeyondViewport: true,
        });
      }
      await page.click('#ivTabMonitor');
      await sleep(900);
      for (const tema of ['gelap', 'cerah']) {
        await ev((t) => document.documentElement.setAttribute('data-theme', t), tema);
        await sleep(700);
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

    // 9. Lencana lapuk (data terkini > 8 hari)
    pasangCacheHarga({ sekarang: '2026-11-21T00:00:00.000Z' });
    const pl = await buka(base + '/');
    await pl.click('#ivTabIv');
    await sediaIv(pl);
    const lapuk = await pl.evaluate(() => document.getElementById('ivHargaLencana').innerText);
    ok('lencana lapuk', /Data lapuk · terkini 2026-11-04/.test(lapuk), lapuk);
    await pl.close();
    pasangCacheHarga();

    // 10. Keadaan ralat dengan "Cuba semula" yang berfungsi (tiada harga palsu, kelabu bukan hijau)
    const pr = await buka(base + '/', { harga: { status: 503 } });
    await pr.click('#ivTabIv');
    await pr.waitForFunction(() => IV_TEST.ivHarga().ralat, { timeout: 20000 });
    await sleep(500);
    const ral = await pr.evaluate(() => ({
      keadaan: document.getElementById('ivHargaKeadaan').innerText,
      butang: !!document.getElementById('ivHargaCubaSemula'),
      senarai: document.getElementById('ivPriList').innerText,
      hijau: document.querySelectorAll('#ivMap .po-marker.status-hijau').length,
      kelabu: document.querySelectorAll('#ivMap .po-marker.status-kelabu').length,
    }));
    ok(
      'ralat: mesej + butang Cuba semula',
      /tidak dapat dimuatkan/.test(ral.keadaan) && ral.butang,
      ral,
    );
    ok(
      'ralat: senarai tidak memaparkan harga palsu',
      /tidak dapat dimuatkan/.test(ral.senarai),
      ral.senarai,
    );
    ok('ralat: tiada penanda hijau (semua kelabu)', ral.hijau === 0 && ral.kelabu === 15, ral);
    pr.removeAllListeners('request');
    await pr.setRequestInterception(false);
    await pr.click('#ivHargaCubaSemula');
    await pr.waitForFunction(() => IV_TEST.ivHarga().sedia, { timeout: 20000 });
    await sleep(500);
    const pulih = await pr.evaluate(() => ({
      hidden: document.getElementById('ivHargaKeadaan').hidden,
      isu: IV_TEST.recsNow().length,
    }));
    ok('Cuba semula memulihkan data', pulih.hidden && pulih.isu > 0, pulih);
    await pr.close();

    // 11. file:// memaparkan mesej jelas
    const fileUrl = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');
    const pf = await buka(fileUrl);
    await pf.click('#ivTabIv');
    await pf.waitForFunction(
      () => /npm start/.test(document.getElementById('ivHargaKeadaan').innerText),
      { timeout: 20000 },
    );
    const fi = await pf.evaluate(() => ({
      keadaan: document.getElementById('ivHargaKeadaan').innerText,
      cuba: !!document.getElementById('ivHargaCubaSemula'),
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
    console.error('GAGAL harga-intervensi:\n - ' + gagal.join('\n - '));
    process.exit(1);
  }
  console.log('OK harga-intervensi');
  process.exit(0);
})();

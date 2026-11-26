// Senarai putih komoditi (config/komoditi-diliputi.json) pada kedua-dua tab: Pemantauan (Komoditi 17 jenis, Varieti
// lata, pasangan tiada data dimatikan) dan Intervensi (penapis sama, bekalan dummy hanya bagi varieti yang dipetakan).
// Jalankan dari root: node --no-warnings tests/frontend/komoditi-diliputi.js
// KOMODITI_SHOTS=<folder> menyimpan tangkapan skrin dikliping (maks 1600x1600) dengan senarai Komoditi/Varieti terbuka.
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
const SHOTS = process.env.KOMODITI_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gagal = [];
const ok = (nama, cond, info) => {
  if (!cond)
    gagal.push(nama + (info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 500) : ''));
};
const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'komoditi-diliputi.json'), 'utf8'),
);
const JENIS = [...new Set(cfg.pasangan.map((p) => p.jenis))].sort((a, b) =>
  a.localeCompare(b, 'ms'),
);
const varietiJenis = (j) => cfg.pasangan.filter((p) => p.jenis === j);
// Teks komoditi/varieti yang bukan dalam senarai (dummy lama dan data lain) tidak boleh muncul dalam penapis.
const TAK_DILIPUTI = [
  'Ayam Proses Super',
  'Ikan Kembung',
  'Kelapa Tua',
  'Tomato Bulat',
  'Bawang Merah Kecil',
  'Telur Gred A',
  'Cili Merah Kulai',
];

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'komoditi-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const ralatHalaman = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => ralatHalaman.push('pageerror: ' + e.message));
    await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => HD.sedia, { timeout: 30000 });
    await sleep(600);
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const opsi = (id) =>
      ev(
        (i) =>
          [...document.getElementById(i).options].map((o) => [
            o.value,
            o.textContent.trim(),
            o.disabled,
          ]),
        id,
      );
    const tanpaSemua = (o) => o.filter((x) => x[0] !== 'all');
    const klip = (sel, tinggi) =>
      ev(
        (s, h) => {
          const a = document.querySelector(s).getBoundingClientRect();
          return {
            x: Math.max(0, Math.floor(a.left)),
            y: Math.max(0, Math.floor(a.top + scrollY)),
            width: Math.min(1600, Math.ceil(a.width)),
            height: Math.min(1600, h),
          };
        },
        sel,
        tinggi,
      );
    // Senarai terbuka: pilih kotak (select native tidak dirakam), dilapis di atas kandungan di bawahnya.
    const buka = (id, n) =>
      ev(
        (i, k) => {
          const e = document.getElementById(i);
          const r = e.getBoundingClientRect();
          const n = Math.min(k, e.options.length);
          e.size = n;
          Object.assign(e.style, {
            position: 'absolute',
            left: r.left + scrollX + 'px',
            top: r.bottom + scrollY + 4 + 'px',
            width: '360px',
            height: n * 22 + 'px',
            background: '#0b1b3a',
            color: '#fff',
            zIndex: '9999',
          });
        },
        id,
        n,
      );
    const tutup = (id) =>
      ev((i) => {
        const e = document.getElementById(i);
        e.removeAttribute('size');
        e.removeAttribute('style');
      }, id);
    const foto = async (nama, sel, tinggi) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: path.join(SHOTS, nama),
        clip: await klip(sel, tinggi),
        captureBeyondViewport: true,
      });
    };

    /* ===== Pemantauan ===== */
    const kom = tanpaSemua(await opsi('filterCommodity'));
    ok('Pemantauan: Komoditi = 17 jenis', kom.length === 17, kom.length);
    ok(
      'Pemantauan: Komoditi A-Z mengikut config',
      kom.map((o) => o[0]).join() === JENIS.join(),
      kom.map((o) => o[0]),
    );
    ok(
      'Pemantauan: label Komoditi daripada config (jenisLabel)',
      kom.every((o) => {
        const p = cfg.pasangan.find((x) => x.jenis === o[0]);
        return o[1] === cfg.jenis.find((j) => j.kod === o[0]).label && p;
      }),
      kom,
    );
    ok(
      'Pemantauan: Varieti dimatikan sebelum Komoditi dipilih',
      (await ev(() => document.getElementById('filterVarieti').disabled)) === true,
    );
    await buka('filterCommodity', 18);
    await foto('pemantauan-komoditi-terbuka.png', '.filterbar', 520);
    await tutup('filterCommodity');

    await page.select('#filterCommodity', 'CILI');
    await sleep(500);
    let v = tanpaSemua(await opsi('filterVarieti'));
    ok('Pemantauan: CILI -> 8 varieti', v.length === 8, v);
    ok(
      'Pemantauan: Varieti CILI hanya yang disenaraikan',
      v.map((o) => o[0]).join() ===
        varietiJenis('CILI')
          .map((p) => p.variety)
          .sort((a, b) => a.localeCompare(b, 'ms'))
          .join(),
      v,
    );
    ok(
      'Pemantauan: label varieti daripada config',
      v.every((o) => o[1] === cfg.pasangan.find((p) => p.variety === o[0]).label),
      v,
    );
    ok(
      'Pemantauan: varieti CILI tidak dimatikan',
      v.every((o) => o[2] === false),
      v,
    );
    await buka('filterVarieti', 10);
    await foto('pemantauan-varieti-terbuka.png', '.filterbar', 520);
    await tutup('filterVarieti');

    // Setiap jenis: varieti cascade = senarai config sahaja; tiadaData dimatikan dengan "(tiada data)".
    for (const j of JENIS) {
      await page.select('#filterCommodity', j);
      await sleep(150);
      const o = tanpaSemua(await opsi('filterVarieti'));
      const jangka = varietiJenis(j).map((p) => p.variety);
      ok(
        'Pemantauan: ' + j + ' varieti = config',
        o.length === jangka.length && o.every((x) => jangka.includes(x[0])),
        o,
      );
      ok(
        'Pemantauan: ' + j + ' tiadaData dimatikan',
        o.every((x) => {
          const p = cfg.pasangan.find((q) => q.variety === x[0]);
          return x[2] === !!p.tiadaData && /\(tiada data\)$/.test(x[1]) === !!p.tiadaData;
        }),
        o,
      );
    }
    // Teks penapis tidak mengandungi komoditi di luar senarai
    await page.select('#filterCommodity', 'all');
    await sleep(200);
    const teksPenapis = await ev(() =>
      [...document.querySelectorAll('#filterCommodity option, #filterVarieti option')]
        .map((o) => o.textContent)
        .join('|'),
    );
    TAK_DILIPUTI.forEach((t) =>
      ok('Pemantauan: tiada teks tidak diliputi: ' + t, !teksPenapis.includes(t), teksPenapis),
    );
    const semuaVarieti = [];
    for (const j of JENIS) {
      await page.select('#filterCommodity', j);
      await sleep(100);
      semuaVarieti.push(...tanpaSemua(await opsi('filterVarieti')).map((o) => o[0]));
    }
    ok(
      'Pemantauan: jumlah varieti merentas jenis = 58',
      semuaVarieti.length === 58 && new Set(semuaVarieti).size === 58,
      semuaVarieti.length,
    );
    await page.select('#filterCommodity', 'all');

    /* ===== Intervensi ===== */
    await page.click('#ivTabIv');
    await page.waitForFunction(() => IV_TEST.ivHarga().sedia, { timeout: 30000 });
    await sleep(800);
    const ik = tanpaSemua(await opsi('ivFKomoditi'));
    ok('Intervensi: Komoditi = 17 jenis', ik.length === 17, ik.length);
    ok(
      'Intervensi: Komoditi sama dengan Pemantauan',
      ik.map((o) => o[0]).join() === kom.map((o) => o[0]).join() &&
        ik.map((o) => o[1]).join() === kom.map((o) => o[1]).join(),
      ik,
    );
    ok(
      'Intervensi: Varieti dimatikan sebelum Komoditi dipilih',
      (await ev(() => document.getElementById('ivFVarieti').disabled)) === true,
    );
    await buka('ivFKomoditi', 18);
    await foto('intervensi-komoditi-terbuka.png', '#ivFilters', 520);
    await tutup('ivFKomoditi');
    await page.select('#ivFKomoditi', 'CILI');
    await sleep(500);
    const iv = tanpaSemua(await opsi('ivFVarieti'));
    ok('Intervensi: CILI -> 8 varieti', iv.length === 8, iv);
    ok(
      'Intervensi: Varieti sama label dengan Pemantauan',
      iv.map((o) => o[1]).join() === v.map((o) => o[1]).join(),
      [iv, v],
    );
    await buka('ivFVarieti', 10);
    await foto('intervensi-varieti-terbuka.png', '#ivFilters', 520);
    await tutup('ivFVarieti');
    for (const j of ['TIMUN', 'PISANG', 'TEMBIKAI']) {
      await page.select('#ivFKomoditi', j);
      await sleep(150);
      const o = tanpaSemua(await opsi('ivFVarieti'));
      ok(
        'Intervensi: ' + j + ' varieti = config, tiadaData dimatikan',
        o.length === varietiJenis(j).length &&
          o.every((x) => {
            const p = cfg.pasangan.find(
              (q) => q.variety === x[0] || q.label === x[1].replace(' (tiada data)', ''),
            );
            return p && x[2] === !!p.tiadaData && /\(tiada data\)$/.test(x[1]) === !!p.tiadaData;
          }),
        o,
      );
    }
    await page.select('#ivFKomoditi', 'all');
    await sleep(200);
    const teksIv = await ev(() =>
      [...document.querySelectorAll('#ivFKomoditi option, #ivFVarieti option')]
        .map((o) => o.textContent)
        .join('|'),
    );
    TAK_DILIPUTI.forEach((t) =>
      ok('Intervensi: tiada teks tidak diliputi: ' + t, !teksIv.includes(t), teksIv),
    );
    // Rekod keutamaan hanya untuk pasangan senarai putih
    const idSah = await ev(() => IV_TEST.recsNow().map((r) => r.commodity));
    const labelSah = new Set(cfg.pasangan.map((p) => p.label));
    ok('Intervensi: cadangan wujud', idSah.length > 0, idSah.length);
    ok(
      'Intervensi: nama komoditi cadangan = label config',
      idSah.every((n) => labelSah.has(n)),
      [...new Set(idSah.filter((n) => !labelSah.has(n)))],
    );
    // Bekalan dummy hanya bagi varieti yang dipetakan; selainnya "Tiada data bekalan (dummy)" dan tidak Kritikal
    const bekalan = await ev(() => {
      const r = IV_TEST.recsNow();
      const tiada = r.filter((x) => x.cls.supply.state === 'tiada');
      return {
        bil: r.length,
        tiada: tiada.length,
        alasan: [...new Set(tiada.map((x) => x.cls.supply.reason))],
        kritikalTanpaBekalan: tiada.filter((x) => x.cls.level === 'kritikal').length,
        ayamHidup: r.filter((x) => x.commodityId === 'ayam-hidup').length,
        ayamHidupTiada: r.filter(
          (x) => x.commodityId === 'ayam-hidup' && x.cls.supply.state === 'tiada',
        ).length,
        kulai: r.filter(
          (x) =>
            x.commodityId === 'cili-merah-kulai-kulai-hibrid' && x.cls.supply.state !== 'tiada',
        ).length,
      };
    });
    ok(
      'Intervensi: varieti tanpa bekalan dummy = "Tiada data bekalan (dummy)"',
      bekalan.tiada > 0 && bekalan.alasan.join() === 'Tiada data bekalan (dummy)',
      bekalan,
    );
    ok(
      'Intervensi: tiada Kritikal tanpa data bekalan',
      bekalan.kritikalTanpaBekalan === 0,
      bekalan,
    );
    ok(
      'Intervensi: Ayam Hidup tiada bekalan, Cili Merah Kulai ada bekalan dummy',
      bekalan.ayamHidup > 0 && bekalan.ayamHidup === bekalan.ayamHidupTiada && bekalan.kulai > 0,
      bekalan,
    );
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (ralatHalaman.length) gagal.push('ralat halaman: ' + ralatHalaman.join('; '));
  if (gagal.length) {
    console.log('GAGAL komoditi-diliputi:\n - ' + gagal.join('\n - '));
    process.exit(1);
  }
  console.log('OK komoditi-diliputi');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

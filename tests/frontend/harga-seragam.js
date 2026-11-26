'use strict';
// Keseragaman harga sebenar: tab Pemantauan Komoditi dan tab Dashboard Intervensi Komoditi memaparkan nombor,
// status dan sebab yang sama, kedua-duanya daripada /api/harga (DB Harga, fixture tests/fixtures/harga-db).
// Jalankan dari root: node --no-warnings tests/frontend/harga-seragam.js
// HARGA_REPORT=<fail.json> menyimpan laporan ringkas.
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
const laporan = { semakan: {}, contoh: [] };
const ok = (nama, cond, info) => {
  if (!cond)
    gagal.push(nama + (info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 400) : ''));
};
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (q) => (await fetch(base + '/api/harga?' + q)).json();
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harga-ser-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const konsol = [];
  try {
    // Sumber kebenaran: baris /api/harga (lima pertanyaan yang sama dengan kedua-dua tab).
    const [ladP, ladD, runP, runD, borP] = await Promise.all([
      api('mod=pengeluar&aras=po'),
      api('mod=pengeluar&aras=daerah'),
      api('peringkat=RUNCIT&aras=po'),
      api('peringkat=RUNCIT&aras=daerah'),
      api('peringkat=BORONG&aras=po'),
    ]);
    const API = {
      LADANG: { po: ladP.baris, daerah: ladD.baris },
      RUNCIT: { po: runP.baris, daerah: runD.baris },
      BORONG: { po: borP.baris },
    };
    laporan.semakan.barisApi = {
      ladangPO: ladP.baris.length,
      ladangDaerah: ladD.baris.length,
      runcitPO: runP.baris.length,
      runcitDaerah: runD.baris.length,
      borongPO: borP.baris.length,
    };

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (e) => konsol.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') konsol.push('console.error: ' + m.text());
    });
    await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => HD.sedia, { timeout: 30000 });
    await page.click('#ivTabIv');
    await page.waitForFunction(() => IV_TEST.ivHarga().sedia, { timeout: 30000 });
    await sleep(800);
    const ev = (fn, ...a) => page.evaluate(fn, ...a);

    // 1. Nombor Intervensi (rekod daerah dan harga aras PO) = baris API.
    const D = await ev((API) => {
      const nd = HARGADB.normDaerah;
      const salah = [];
      let rekod = 0,
        po = 0;
      const sama = (a, b) =>
        (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);
      const banding = (nama, p, r) => {
        [
          ['actual', p.actual, r.harga],
          ['previous', p.previous, r.hargaSebelum],
          ['weeklyPct', p.weeklyPct, r.pctMinggu],
          ['floor', p.floor, r.lantai],
          ['ceiling', p.ceiling, r.siling],
        ].forEach(([f, a, b]) => {
          if (!sama(a, b)) salah.push(nama + ' ' + f + ' ' + a + ' != ' + b);
        });
        // Aras PO: status/sebab ialah amaranPo (dikira pelayan daripada status daerah)
        const st = r.amaranPo ? r.amaranPo.status : r.status;
        const sb = r.amaranPo ? r.amaranPo.sebab : r.sebab;
        if (p.statusKongsi !== st) salah.push(nama + ' status ' + p.statusKongsi + ' != ' + st);
        if (p.sebabKongsi !== sb) salah.push(nama + ' sebab');
        if (p.source !== 'db-harga') salah.push(nama + ' sumber ' + p.source);
      };
      ['pengeluar', 'pengguna'].forEach((m) => {
        const pr = m === 'pengeluar' ? 'LADANG' : 'RUNCIT';
        IV_TEST.dispatch('setMode', m);
        IV_TEST.recsNow().forEach((r) => {
          const a = API[pr].daerah.find(
            (x) =>
              x.po === r.poId &&
              nd(x.daerah) === nd(r.district) &&
              x.commodity === r.price.dbCommodity &&
              x.variety === r.price.variety,
          );
          rekod++;
          if (!a) return salah.push(r.id + ' tiada baris API');
          banding(r.id, r.price, a);
        });
      });
      // Aras PO: ivPrice (3 peringkat) = baris API aras PO bagi (komoditi, varieti) terpilih.
      const IVC = [...new Set(IV_TEST.recsNow().map((r) => r.commodityId))];
      DATA.po.forEach((p) =>
        IVC.forEach((cid) =>
          [
            ['Ladang', 'LADANG'],
            ['Runcit', 'RUNCIT'],
            ['Borong', 'BORONG'],
          ].forEach(([st, pr]) => {
            const ip = IV_TEST.ivPrice(p.id, cid, st);
            if (!ip) return;
            const a = API[pr].po.find(
              (x) => x.po === p.id && x.commodity === ip.dbCommodity && x.variety === ip.variety,
            );
            po++;
            if (!a) return salah.push(p.id + '/' + cid + '/' + st + ' tiada baris API aras PO');
            banding(p.id + '/' + cid + '/' + st, ip, a);
          }),
        ),
      );
      return { rekod, po, salah: salah.slice(0, 20), nSalah: salah.length };
    }, API);
    laporan.semakan.rekodIntervensiDibandingkan = D.rekod;
    laporan.semakan.hargaPODibandingkan = D.po;
    ok('rekod Intervensi wujud (>= 20)', D.rekod >= 20, D.rekod);
    ok('harga aras PO wujud (>= 20)', D.po >= 20, D.po);
    ok(
      'Intervensi = baris /api/harga (harga, sebelum, %, lantai, siling, status, sebab)',
      D.nSalah === 0,
      D.salah,
    );

    // 2. Paparan DOM: baris keutamaan Intervensi lawan baris harga Pemantauan untuk rekod yang sama.
    const semua = [];
    for (const mode of ['pengeluar', 'pengguna']) {
      await ev((m) => {
        IV_TEST.dispatch('resetFilters');
        IV_TEST.dispatch('setMode', m);
      }, mode);
      await sleep(500);
      await ev(() => {
        const b = document.querySelector('[data-iv-act=showAll]');
        if (b) b.click();
      });
      await sleep(400);
      const baris = await ev(() =>
        [...document.querySelectorAll('#ivPriList .iv-row')].map((el) => ({
          id: el.getAttribute('data-iv-arg'),
          r3: el.querySelector('.iv-r3').innerText,
          chips: [...el.querySelectorAll('.iv-r4 .iv-chip')].map((c) => c.innerText),
        })),
      );
      ok('baris keutamaan wujud (' + mode + ')', baris.length > 0, baris.length);
      baris.forEach((b) => semua.push({ mode, b }));
    }
    await page.click('#ivTabMonitor');
    await sleep(600);
    let dipaparkan = 0;
    for (const { mode, b } of semua) {
      const [, po] = b.id.split(':');
      const m = b.r3.match(
        /Harga semasa (RM [\d.]+)(?: \(minggu sebelum (RM [\d.]+), ([+-]?[\d.]+%)\))? · (.+?)(?: · asas (\d{4}))? · Ramalan: tiada/,
      );
      ok('format r3 ' + b.id, !!m, b.r3);
      if (!m) continue;
      const info = await ev(
        (id, md) => {
          IV_TEST.dispatch('setMode', md);
          const r = IV_TEST.recsNow().find((x) => x.id === id);
          return r && { daerah: r.district, kom: r.price.dbCommodity, vari: r.price.variety };
        },
        b.id,
        mode,
      );
      const stage = mode === 'pengeluar' ? 'Ladang' : 'Runcit';
      if (!info) {
        ok('rekod Intervensi wujud ' + b.id, false);
        continue;
      }
      const P = await ev(
        async (po, ds, kom, vari, st) => {
          state.po = po;
          state.daerah = ds;
          state.komoditi = kom;
          state.varieti = vari;
          state.indikator = 'all';
          state.issues = false;
          state.bulan = 'all';
          state.lowStage = st;
          renderAll();
          for (let i = 0; i < 80 && !(HD.sedia && HD.kunci === kunciPertanyaan()); i++)
            await new Promise((r) => setTimeout(r, 100));
          renderAll();
          const el = document.querySelector('#lowestPrices .price-row');
          const out = el && {
            harga: el.querySelector('.price-value').innerText.trim(),
            status: el.querySelector('.status-text').innerText.replace('●', '').trim(),
            sebab: el.querySelector('.price-sebab').innerText.trim(),
          };
          return out;
        },
        po,
        info.daerah,
        info.kom,
        info.vari,
        stage,
      );
      if (!P) {
        ok('baris Pemantauan wujud ' + b.id, false, info);
        continue;
      }
      dipaparkan++;
      ok('harga semasa sama ' + b.id, P.harga === m[1], [P.harga, m[1]]);
      ok('sebab sama ' + b.id, P.sebab === m[4], [P.sebab, m[4]]);
      ok(
        'status sama ' + b.id,
        b.chips.some((c) => c === 'Pemantauan: ' + P.status),
        [P.status, b.chips],
      );
      if (laporan.contoh.length < 8)
        laporan.contoh.push({ id: b.id, pemantauan: P.harga, intervensi: m[1], status: P.status });
    }
    laporan.semakan.barisPaparanDibandingkan = dipaparkan;
    ok('sekurang-kurangnya 5 baris dibandingkan dalam DOM', dipaparkan >= 5, dipaparkan);
    ok('tiada ralat konsol', konsol.length === 0, konsol);
  } finally {
    await browser.close();
    server.close();
  }
  if (process.env.HARGA_REPORT)
    fs.writeFileSync(process.env.HARGA_REPORT, JSON.stringify({ ...laporan, gagal }, null, 2));
  console.log(JSON.stringify(laporan.semakan));
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'harga-seragam: semua semakan lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

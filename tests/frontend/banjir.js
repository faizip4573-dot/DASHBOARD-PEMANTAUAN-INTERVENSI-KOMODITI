'use strict';
// Banjir sebenar (JPS): kad Amaran Rasmi (7 terkini MET + JPS), senario 'Risiko Banjir', lapisan peta stesen,
// bendera Intervensi, keadaan lapuk/503/abort/file://, overflow dan kontras. API distub (deterministik).
// Jalankan dari root: node tests/frontend/banjir.js
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
const jam = (n) => new Date(Date.now() - n * 36e5).toISOString();

// 5 amaran MET + 4 amaran JPS (9 semuanya) dengan masa dikeluarkan berselang-seli.
function amaranCampur() {
  const teksPanjang =
    'Hujan lebat dan ribut petir dijangka di Terengganu (Kemaman, Dungun). '.repeat(4);
  const met = [0, 1, 2, 3, 4].map((i) => ({
    jenis: 'hujan',
    tajuk: `AMARAN MET M${i}`,
    teks: i === 0 ? teksPanjang + 'AKHIR-M0' : `Teks M${i}`,
    negeri: ['Terengganu'],
    dikeluarkan: jam(2 * i + 1),
    sah_dari: jam(2 * i + 1),
    sah_hingga: new Date(Date.now() + (i % 2 === 0 ? 36e5 : -36e5)).toISOString(),
    aktif: i % 2 === 0,
  }));
  const jps = [0, 1, 2, 3].map((j) => ({
    sumber: 'JPS Malaysia (Public Info Banjir)',
    mesej: `Teks J${j}`,
    dikeluarkan: jam(2 * (j + 1)),
    anggaranMula: null,
    anggaranTamat: j === 2 ? jam(1) : null,
    negeri: ['Kelantan'],
    dilihat: jam(2 * (j + 1)),
    aktif: j === 0,
  }));
  return { met, jps };
}

(async () => {
  pasangSemuaCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'banjir-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka(api, { url = base + '/', rangkaian = false, lebar = 1440 } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: 900 });
    const masalah = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (!['error', 'warning'].includes(m.type())) return;
      if (rangkaian && /Failed to load resource/.test(m.text())) return;
      masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    if (api) await stubApi(page, api);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await sleep(2000);
    return { page, masalah };
  }
  const teks = (page, sel) => page.$eval(sel, (e) => e.innerText);
  const kad = (page) =>
    page.$$eval('#amsList .ams-card', (e) =>
      e.map((x) => x.querySelector('.ams-card-title').textContent + '|' + x.innerText),
    );

  try {
    // (i) tahap 'amaran': senario Risiko Banjir + drill-down stesen
    {
      const cuaca = buatFixture();
      const fx = buatFixtureBanjir({ tahap: 'amaran' });
      const { page, masalah } = await buka({ cuaca, banjir: fx });
      const senarai = await kad(page);
      const banjirKad = senarai.find((k) => k.includes('Risiko Banjir'));
      ok('(i) kad Risiko Banjir muncul', !!banjirKad, senarai);
      ok('(i) kad bersumber JPS', !!banjirKad && /JPS/.test(banjirKad), banjirKad);
      ok('(i) bilangan kad = cuaca + 1', senarai.length === cuaca.senario.length + 1, [
        senarai.length,
        cuaca.senario.length,
      ]);
      const kpi = await page.$$eval('#amsKpis .ams-kpi-v', (e) =>
        e.map((x) => Number(x.textContent)),
      );
      const semua = [...cuaca.senario, ...fx.senario].flatMap((s) => s.affectedPOIds);
      const unik = new Set(semua).size;
      const bertindih = [...new Set(semua)].filter(
        (id) => semua.filter((x) => x === id).length >= 2,
      ).length;
      ok(
        '(i) KPI senario/PO unik/PO bertindih',
        kpi.join() === [senarai.length, unik, bertindih].join(),
        [kpi, unik, bertindih],
      );
      ok(
        '(i) tiada lencana DATA SEBENAR',
        !(await page.$('#amsBadge')) && !/DATA SEBENAR/.test(await teks(page, '#amsPanel')),
      );
      const nota = await teks(page, '#amsFloodNote');
      ok('(i) nota banjir sebenar', /data sebenar JPS Malaysia \/ JPS Selangor/.test(nota), nota);
      ok('(i) tajuk bahagian', (await teks(page, '.ams-section')) === 'Senario yang Dikesan');
      // drill-down (panel AMS disembunyikan atas permintaan; dilangkau selagi tersembunyi)
      if (await page.$eval('#amsList', (e) => e.offsetParent !== null)) {
        const id = banjirKad.split('|')[0].split(' · ')[0];
        await page.click(`#amsList .ams-card[data-sid="${id}"]`);
        await sleep(500);
        await page.click('#amsDetail .ams-po-row');
        await sleep(500);
        const laci = await teks(page, '#amsPoDrawer');
        ok(
          '(i) laci: STESEN JPS BERHAMPIRAN',
          laci.includes('STESEN JPS BERHAMPIRAN'),
          laci.slice(0, 300),
        );
        ok(
          '(i) laci: stesen Duyong + status + paras + trend + masa + sumber',
          /Duyong/.test(laci) &&
            /Amaran/.test(laci) &&
            /Paras/.test(laci) &&
            /Trend/.test(laci) &&
            /MYT/.test(laci) &&
            /Sumber: JPS/.test(laci),
          laci,
        );
        ok(
          '(i) laci: label anggaran sistem',
          laci.includes('Anggaran sistem berdasarkan data JPS, bukan amaran rasmi'),
        );
      } else ok('(i) drill-down dilangkau: panel AMS disembunyikan', true);
      ok('(i) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
    }
    // (ii) semua Normal: tiada senario banjir
    {
      const cuaca = buatFixture();
      const { page } = await buka({ cuaca, banjir: buatFixtureBanjir({ tahap: 'normal' }) });
      const senarai = await kad(page);
      ok('(ii) tiada senario banjir', !senarai.some((k) => k.includes('Risiko Banjir')), senarai);
      ok(
        '(ii) bilangan kad = cuaca sahaja',
        senarai.length === cuaca.senario.length,
        senarai.length,
      );
      ok(
        '(ii) nota Tiada stesen Amaran/Bahaya',
        (await teks(page, '#amsFloodNote')).includes('Tiada stesen Amaran/Bahaya'),
      );
      await page.close();
    }
    // (iii) kad Amaran Rasmi: 7 terkini daripada 9 (5 MET + 4 JPS)
    {
      const { met, jps } = amaranCampur();
      const cuaca = buatFixture();
      cuaca.amaran = met.slice().reverse(); // susunan sumber sengaja tidak tertib
      const bj = buatFixtureBanjir();
      bj.amaranSejarah = jps.slice().reverse();
      bj.amaran = jps.filter((a) => a.aktif);
      const { page, masalah } = await buka({ cuaca, banjir: bj });
      const item = await page.$$eval('#metAlertBody .alert-item', (e) =>
        e.map((x) => ({
          teks: x.innerText,
          chip: (x.querySelector('.alert-chip') || {}).innerText,
        })),
      );
      // semua tahap UMUM: aktif dahulu (terbaharu dahulu), kemudian Tamat (terbaharu dahulu)
      const urutan = ['M0', 'J0', 'M2', 'M4', 'M1', 'J1', 'J2', 'M3'];
      ok('(iii) 7 terkini + M4 aktif di luar 7 = 8 amaran', item.length === 8, item.length);
      ok(
        '(iii) susunan terbaharu dahulu (MET + JPS bercampur)',
        urutan.every(
          (u, i) =>
            item[i] && new RegExp('Teks ' + u + '\\b|AMARAN MET ' + u + '\\b').test(item[i].teks),
        ),
        item.map((x) => x.teks.slice(0, 40)),
      );
      ok('(iii) J3 (tertua dan Tamat) tidak dipaparkan', !item.some((x) => /Teks J3/.test(x.teks)));
      ok(
        '(iii) chip Aktif/Tamat betul',
        item.map((x) => x.chip).join() === 'Aktif,Aktif,Aktif,Aktif,Tamat,Tamat,Tamat,Tamat',
        item.map((x) => x.chip),
      );
      ok(
        '(iii) setiap item bersumber',
        item.every((x) => /MET Malaysia|JPS Malaysia \(Public Info Banjir\)/.test(x.teks)),
      );
      const tag = await teks(page, '#metAlertTag');
      ok(
        '(iii) pengepala "4 aktif · 8 terkini"',
        tag.replace(/\s+/g, ' ').trim() === '4 aktif · 8 terkini',
        tag,
      );
      ok(
        '(iii) tajuk kad',
        (await teks(page, '#ewsTitle')) === 'EWS (AI)' &&
          (await page.$eval('#ewsTabAmaran', (e) => e.getAttribute('aria-label'))).includes(
            'Amaran Rasmi (MET Malaysia & JPS)',
          ),
      );
      // teks penuh boleh dikembangkan
      const sebelum = await page.$eval(
        '#metAlertBody .alert-item .alert-teks',
        (e) => e.scrollHeight > e.clientHeight,
      );
      ok('(iii) teks panjang terpotong dahulu', sebelum);
      await page.click('#metAlertBody .alert-item [data-act="amaran-lagi"]');
      const sesudah = await page.$eval('#metAlertBody .alert-item', (e) => ({
        buka: e.classList.contains('open'),
        penuh:
          e.querySelector('.alert-teks').scrollHeight <=
            e.querySelector('.alert-teks').clientHeight + 1 && e.innerText.includes('AKHIR-M0'),
        aria: e.querySelector('[data-act="amaran-lagi"]').getAttribute('aria-expanded'),
      }));
      ok(
        '(iii) Lihat lagi mengembangkan teks penuh',
        sesudah.buka && sesudah.penuh && sesudah.aria === 'true',
        sesudah,
      );
      const html = await teks(page, 'body');
      ok(
        '(iii) tiada "belum disambungkan"/"CONTOH" dalam halaman',
        !/belum disambungkan|CONTOH/.test(html),
      );
      ok('(iii) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
      // kurang daripada 7: tidak mereka
      const c2 = buatFixture();
      c2.amaran = met.slice(0, 2);
      const b2 = buatFixtureBanjir();
      const r = await buka({ cuaca: c2, banjir: b2 });
      ok(
        '(iii) kurang daripada 7: hanya yang ada',
        (await r.page.$$('#metAlertBody .alert-item')).length === 2,
      );
      await r.page.close();
    }
    // (iii-c) susunan tahap: aktif BAHAYA > BURUK > WASPADA > UMUM, kemudian Tamat (walaupun lebih baharu)
    {
      const cuaca = buatFixture();
      const mk = (tajuk, jamLalu, aktif) => ({
        jenis: 'hujan',
        tajuk,
        teks: 'Teks ' + tajuk,
        negeri: ['Pahang'],
        dikeluarkan: jam(jamLalu),
        sah_dari: jam(jamLalu),
        sah_hingga: new Date(Date.now() + (aktif ? 1 : -1) * 36e5).toISOString(),
        aktif,
      });
      cuaca.amaran = [
        mk('AMARAN CUACA BAHAYA TAMAT', 1, false),
        mk('AMARAN CUACA WASPADA AKTIF', 3, true),
        mk('AMARAN CUACA BURUK AKTIF', 5, true),
        mk('AMARAN RIBUT PETIR AKTIF', 2, true),
      ];
      const bj = buatFixtureBanjir();
      bj.amaranSejarah = [
        {
          sumber: 'JPS Malaysia (Public Info Banjir)',
          mesej: 'Status Danger di Sg. Contoh',
          dikeluarkan: jam(7),
          anggaranTamat: null,
          negeri: ['Kelantan'],
          dilihat: jam(7),
          aktif: true,
        },
      ];
      bj.amaran = bj.amaranSejarah;
      const { page, masalah } = await buka({ cuaca, banjir: bj });
      const item = await page.$$eval('#metAlertBody .alert-item', (e) =>
        e.map((x) => ({
          teks: x.innerText,
          chip: (x.querySelector('.alert-chip') || {}).innerText,
          tahap: (x.querySelector('.alert-tahap') || {}).innerText,
        })),
      );
      ok(
        '(iii-c) urutan: Danger JPS, BURUK, WASPADA, ribut petir (aktif), kemudian BAHAYA Tamat',
        item.length === 5 &&
          /Danger/.test(item[0].teks) &&
          /BURUK AKTIF/.test(item[1].teks) &&
          /WASPADA AKTIF/.test(item[2].teks) &&
          /RIBUT PETIR AKTIF/.test(item[3].teks) &&
          /BAHAYA TAMAT/.test(item[4].teks),
        item.map((x) => x.teks.slice(0, 40)),
      );
      ok(
        '(iii-c) chip Aktif/Tamat dan tahap',
        item.map((x) => x.chip + '/' + x.tahap).join() ===
          'Aktif/BAHAYA,Aktif/BURUK,Aktif/WASPADA,Aktif/UMUM,Tamat/BAHAYA',
        item.map((x) => x.chip + '/' + x.tahap),
      );
      ok(
        '(iii-c) pengepala "4 aktif · 5 terkini"',
        (await teks(page, '#metAlertTag')).replace(/\s+/g, ' ').trim() === '4 aktif · 5 terkini',
      );
      ok('(iii-c) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
    }
    // (iii-b) tiada amaran langsung
    {
      const { page } = await buka({
        cuaca: buatFixture({ amaran: false }),
        banjir: buatFixtureBanjir(),
      });
      const a = await teks(page, '#metAlertBody');
      ok(
        '(iii-b) Tiada amaran rasmi dalam 7 hari lepas + dua sumber + masa',
        a.includes('Tiada amaran rasmi dalam 7 hari lepas') &&
          a.includes('MET Malaysia') &&
          a.includes('JPS Malaysia') &&
          /MYT/.test(a),
        a,
      );
      await page.close();
    }
    // (iii-c) amaran rasmi JPS sintetik membawa Tinggi + senaraikan bersama MET
    {
      const { page } = await buka({
        cuaca: buatFixture(),
        banjir: buatFixtureBanjir({ amaranRasmi: true }),
      });
      const a = await teks(page, '#metAlertBody');
      ok(
        '(iii-c) amaran JPS bersama MET',
        a.includes('JPS Malaysia (Public Info Banjir)') &&
          a.includes('AMARAN RIBUT PETIR') &&
          a.includes('MET Malaysia'),
        a,
      );
      await page.close();
    }
    // (iv) lapisan peta
    {
      const { page, masalah } = await buka({
        cuaca: buatFixture(),
        banjir: buatFixtureBanjir({ tahap: 'amaran' }),
      });
      const l0 = await page.evaluate(() => DASHBOARD_TEST.floodLayer());
      ok(
        '(iv) lalai: lapisan dipaparkan, Normal tersembunyi',
        l0.visible && Array.isArray(l0.filter) && l0.filter[0] === '!=' && l0.features > 0,
        l0,
      );
      ok(
        '(iv) #floodToggle aktif dan aria-pressed',
        await page.$eval(
          '#floodToggle',
          (b) =>
            !b.disabled &&
            b.getAttribute('aria-pressed') === 'true' &&
            b.textContent.includes('Stesen banjir JPS'),
        ),
      );
      await page.click('#floodAllToggle');
      const l1 = await page.evaluate(() => DASHBOARD_TEST.floodLayer());
      ok('(iv) Tunjuk semua stesen: tiada penapis', l1.semua && l1.filter === null, l1);
      await page.click('#floodToggle');
      const l2 = await page.evaluate(() => DASHBOARD_TEST.floodLayer());
      ok('(iv) togol menyembunyikan lapisan', l2.visible === false, l2);
      await page.click('#floodToggle');
      const pop = await page.evaluate(() => {
        DASHBOARD_TEST.bukaPopupStesen(
          {
            nama: 'Stesen <b>Ujian</b>',
            sungai: 'Sg. Ujian',
            statusRasmi: 'Amaran',
            parasAir: 3.2,
            trend: 'Naik',
            masaBacaan: new Date().toISOString(),
            sumber: 'JPS Malaysia (Public Info Banjir)',
          },
          [102.2, 2.2],
        );
        const p = document.querySelector('.maplibregl-popup-content');
        return p ? { t: p.innerText, html: p.innerHTML } : null;
      });
      ok(
        '(iv) popup BM beratribusi',
        !!pop &&
          /Paras air/.test(pop.t) &&
          /Sumber: JPS Malaysia/.test(pop.t) &&
          /Sungai/.test(pop.t),
        pop,
      );
      ok(
        '(iv) popup guna textContent (tiada HTML disuntik)',
        !!pop && !/<b>Ujian/.test(pop.html),
        pop && pop.html,
      );
      const leg = await teks(page, '.map-legend');
      ok(
        '(iv) legenda 4 status JPS',
        /Normal/.test(leg) &&
          /Waspada/.test(leg) &&
          /Amaran/.test(leg) &&
          /Bahaya/.test(leg) &&
          !/belum disambungkan/.test(leg),
        leg,
      );
      ok('(iv) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
    }
    // (v) lapuk / 503 / abort / file://
    {
      let r = await buka({
        cuaca: buatFixture(),
        banjir: buatFixtureBanjir({ tahap: 'amaran', umurJam: 5 }),
      });
      ok('(v) lapuk: nota lapuk', (await teks(r.page, '#amsFloodNote')).includes('lapuk'));
      ok('(v) lapuk: nota peta', (await teks(r.page, '#mapCaption')).includes('lapuk'));
      const lp = await r.page.evaluate(() => DASHBOARD_TEST.floodLayer());
      ok('(v) lapuk: lapisan kosong', lp.features === 0, lp);
      await r.page.close();
      for (const mod of [{ status: 503 }, 'abort']) {
        let pulih = false;
        const cuaca = buatFixture();
        r = await buka(
          { cuaca, banjir: () => (pulih ? buatFixtureBanjir({ tahap: 'amaran' }) : mod) },
          { rangkaian: true },
        );
        const n = await teks(r.page, '#amsFloodNote');
        ok(
          '(v) ralat + Cuba semula',
          n.includes('tidak dapat dimuatkan') && n.includes('Cuba semula'),
          n,
        );
        ok(
          '(v) banjir gagal: senario cuaca kekal',
          (await kad(r.page)).length === cuaca.senario.length,
        );
        const a = await teks(r.page, '#metAlertBody');
        ok(
          '(v) banjir gagal: amaran MET kekal + ralat JPS',
          a.includes('AMARAN RIBUT PETIR') &&
            a.includes('Amaran JPS tidak dapat dimuatkan') &&
            a.includes('Cuba semula'),
          a,
        );
        ok(
          '(v) nota peta gagal',
          (await teks(r.page, '#mapCaption')).includes('tidak dapat dimuatkan'),
        );
        pulih = true;
        await r.page.click('#amsFloodNote [data-act="banjir-retry"]');
        await r.page.waitForFunction(
          () =>
            [...document.querySelectorAll('#amsList .ams-card')].some((k) =>
              k.innerText.includes('Risiko Banjir'),
            ),
          { timeout: 10000 },
        );
        ok('(v) pulih selepas Cuba semula', true);
        await r.page.close();
      }
      const url = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');
      r = await buka(null, { url, rangkaian: true });
      ok(
        '(v) file:// banjir',
        (await teks(r.page, '#amsFloodNote')).includes('memerlukan pelayan (npm start)'),
      );
      await r.page.close();
    }
    // (vi) Intervensi
    {
      const cuaca = buatFixture();
      const sasaran = async (tahap) => {
        const { page } = await buka({ cuaca, banjir: buatFixtureBanjir({ tahap }) });
        await sleep(1500);
        const hasil = await page.evaluate(() => {
          const d = IV_TEST.banjirDisruption('melaka');
          const lain = IV_TEST.banjirDisruption('kelantan');
          let calon = null;
          let chip = false;
          for (const mode of ['pengguna', 'pengeluar'])
            for (const po of [
              'johor',
              'selangor',
              'negerisembilan',
              'pahang',
              'simpangrenggam',
              'perak',
              'sabah',
            ])
              for (const cm of ['cili-merah', 'tomato', 'kobis']) {
                try {
                  IV_TEST.dispatch('resetFilters');
                  IV_TEST.dispatch('setMode', mode);
                  IV_TEST.dispatch('setFilter', ['komoditi', cm]);
                  IV_TEST.dispatch('selectPO', po);
                  const e = IV_TEST.engine();
                  const c = e && [...e.dalam, ...e.luar].find((x) => x.poId === 'melaka');
                  if (c && !calon) {
                    calon = { banjir: c.banjir, score: c.score };
                    chip = (document.getElementById('ivMobRes') || {}).textContent.includes(
                      'Banjir (JPS)',
                    );
                  }
                } catch (err) {
                  /* gabungan tidak sah: abaikan */
                }
              }
          return { d, lain, calon, chip };
        });
        await page.close();
        return hasil;
      };
      const a = await sasaran('amaran');
      ok(
        '(vi) banjirDisruption Tinggi -> Banjir (JPS)',
        a.d && a.d.source === 'Banjir (JPS)' && a.d.level === 'Waspada',
        a,
      );
      ok('(vi) PO lain -> null', a.lain === null, a);
      if (a.calon) {
        ok('(vi) calon mobilisasi membawa bendera banjir', !!a.calon.banjir, a.calon);
        ok('(vi) chip Banjir (JPS) kelihatan dalam calon', a.chip === true, a);
      } else
        console.log(
          'NOTA: tiada gabungan PO/komoditi menghasilkan calon Melaka; bendera calon tidak diuji',
        );
      const n = await sasaran('normal');
      ok('(vi) normal -> null', n.d === null, n);
      ok('(vi) normal -> calon tanpa bendera banjir', !n.calon || !n.calon.banjir, n);
    }
    // (vii) overflow mendatar dan (viii) kontras
    {
      const cuaca = buatFixture();
      const { met, jps } = amaranCampur();
      cuaca.amaran = met;
      const bj = buatFixtureBanjir({ tahap: 'amaran' });
      bj.amaranSejarah = jps;
      for (const lebar of [1440, 1024, 390]) {
        const { page } = await buka({ cuaca, banjir: bj }, { lebar });
        const o = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          iw: innerWidth,
        }));
        ok(`(vii) tiada overflow mendatar pada ${lebar}`, o.sw <= o.iw, o);
        const kad = await page.$eval('#metAlertBody', (e) => {
          const p = e.closest('.panel').getBoundingClientRect();
          return [...e.querySelectorAll('.alert-item')].every(
            (i) => i.getBoundingClientRect().right <= p.right + 1,
          );
        });
        ok(`(vii) amaran dalam sempadan panel pada ${lebar}`, kad);
        await page.close();
      }
      const { page } = await buka({ cuaca, banjir: bj });
      const id = await page.$eval('#amsList .ams-card', (e) => e.dataset.sid);
      const sid = await page.evaluate(
        () =>
          DASHBOARD_TEST.scenarioList().find((s) => s.warningType === 'amaran_banjir').scenarioId,
      );
      await page.click(`#amsList .ams-card[data-sid="${sid}"]`);
      await sleep(400);
      await page.click('#amsDetail .ams-po-row');
      await sleep(400);
      for (const tema of ['gelap', 'cerah']) {
        await page.evaluate((t) => {
          if (t === 'cerah') document.documentElement.setAttribute('data-theme', 'cerah');
          else document.documentElement.removeAttribute('data-theme');
        }, tema);
        await sleep(200);
        const rendah = await page.evaluate(() => {
          const parse = (c) => {
            const m = c.match(/[\d.]+/g).map(Number);
            return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
          };
          const lum = ({ r, g, b }) => {
            const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const latar = (el) => {
            for (let e = el; e; e = e.parentElement) {
              const c = parse(getComputedStyle(e).backgroundColor);
              if (c.a > 0.99) return c;
            }
            return { r: 255, g: 255, b: 255, a: 1 };
          };
          const nisbah = (el) => {
            const a = lum(parse(getComputedStyle(el).color));
            const b = lum(latar(el));
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };
          const sel = [
            '.alert-chip',
            '.alert-tahap',
            '.bj-chip',
            '#amsFloodNote',
            '.alert-lok',
            '.alert-more',
            '.alert-meta',
            '.ams-stesen-sumber',
          ];
          const buruk = [];
          let jumlah = 0;
          sel.forEach((s) =>
            document.querySelectorAll(s).forEach((el) => {
              jumlah++;
              const n = nisbah(el);
              if (n < 4.5) buruk.push(s + ' ' + n.toFixed(2) + ' ' + el.innerText.slice(0, 20));
            }),
          );
          return { buruk, jumlah };
        });
        ok(
          `(viii) kontras >= 4.5:1 tema ${tema}`,
          rendah.buruk.length === 0 && rendah.jumlah >= 8,
          rendah,
        );
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian banjir lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

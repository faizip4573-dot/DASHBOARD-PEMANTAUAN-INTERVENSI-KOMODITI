'use strict';
// Panel 'AI Muse - Gambaran Mingguan Komoditi' (tab Intervensi): data sebenar melalui /api/muse (cache fixture),
// senarai rata ringkas (tanpa kumpulan negeri), halaman 8 baris, dialog Baca lagi, navigasi minggu,
// keadaan kosong/ralat/lapuk/file://, overflow (1440/1024/390), kontras dua tema, tiada ralat konsol/CSP.
// Jalankan dari root: node --no-warnings tests/frontend/muse.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const { buatFixtureMuse, pasangCacheMuse } = require('../helpers/muse-fixture.js');
const { buatFixture } = require('../helpers/cuaca-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = '2026-11-17T12:00:00+08:00';

// Fixture: 16 hari; pada 2026-11-17 kubis -> Merah (5 -> 60), tembikai -> Kuning (9 -> 30)
function fixtureData() {
  const d = buatFixtureMuse();
  d.rekod.forEach((r) => {
    if (r.tarikh !== '2026-11-17') return;
    if (r.komoditiId === 'kubis')
      Object.assign(r, { band: 'Merah', risikoSebelum: 5, risikoSemasa: 60 });
    if (r.komoditiId === 'tembikai')
      Object.assign(r, { band: 'Kuning', risikoSebelum: 9, risikoSemasa: 30 });
  });
  return d;
}
const JANGKAAN_SUSUN = ['durian', 'kelapa-tua', 'tembikai', 'kubis', 'cili-padi'];

(async () => {
  pasangSemuaCache();
  pasangCacheMuse(fixtureData());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const nyata = await (await fetch(base + '/api/muse')).json();
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'muse-ui-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka({ muse, url = base + '/?muse=1', rangkaian = false, lebar = 1440, tema } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: 900 });
    const masalah = [],
      minta = [];
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (!['error', 'warning'].includes(m.type())) return;
      if (rangkaian && /Failed to load resource|Data AI Muse/.test(m.text())) return;
      masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('request', (r) => {
      if (/\/api\/muse/.test(r.url())) minta.push(r.url().replace(/^https?:\/\/[^/]+/, ''));
    });
    await stubApi(page, { cuaca: buatFixture(), ...(muse === undefined ? {} : { muse }) });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.click('#ivTabIv');
    await sleep(1500);
    await page.evaluate(
      (n, t) => {
        IV_TEST.setMuseNow(n);
        if (t) document.documentElement.setAttribute('data-theme', t);
      },
      NOW,
      tema || null,
    );
    await sleep(300);
    return { page, masalah, minta };
  }
  const teks = (page, sel) => page.$eval(sel, (e) => e.innerText);
  const kad = (page) =>
    page.$$eval('#ivMuseList .iv-mrow', (e) =>
      e.map((x) => ({
        id: x.dataset.id,
        band: x.dataset.band,
        teks: x.innerText,
        nama: x.querySelector('.iv-mr-n').textContent,
        hl: x.querySelector('.iv-mr-hl').textContent,
        loc: x.querySelector('.iv-mr-loc').innerText,
        risiko: x.querySelector('.iv-mr-risk').innerText,
        cls: x.querySelector('.iv-mr-risk .iv-chip').className,
        tarikh: x.querySelector('.iv-mr-d').textContent,
        tinggi: x.getBoundingClientRect().height,
      })),
    );
  const klik = async (page, act, arg) => {
    await page.click(`#ivMusePanel [data-iv-act="${act}"]${arg ? `[data-iv-arg="${arg}"]` : ''}`);
    await sleep(500);
  };
  // fixture dengan n komoditi (5 sebenar + klon), tahap berselang-seli
  const buatN = (n) => {
    const d = JSON.parse(JSON.stringify(nyata));
    const asas = d.rekod.slice();
    const kom = [...new Set(asas.map((r) => r.komoditiId))];
    for (let k = kom.length; k < n; k++) {
      asas
        .filter((r) => r.komoditiId === kom[k % kom.length])
        .forEach((r, i) => {
          const band = ['Hijau', 'Kuning', 'Merah'][k % 3];
          d.rekod.push({
            ...r,
            id: 900000 + k * 100 + i,
            kunci: r.tarikh + '|ekstra-' + k,
            komoditiId: 'ekstra-' + k,
            komoditiLabel: 'Ekstra ' + String(k).padStart(2, '0'),
            band,
            risikoSebelum: 10,
            risikoSemasa: 10 + ((k * 7) % 23),
          });
        });
    }
    return d;
  };
  const sudahSusun = (rows, rekod) => {
    // rows: id[] ; semak band, perubahan risiko, label
    const rank = { Merah: 0, Kuning: 1, Hijau: 2 };
    const m = new Map();
    rekod.forEach((r) => {
      const c = m.get(r.komoditiId);
      if (!c || r.tarikh > c.tarikh || (r.tarikh === c.tarikh && r.id > c.id))
        m.set(r.komoditiId, r);
    });
    const jangka = [...m.values()]
      .sort(
        (a, b) =>
          rank[a.band] - rank[b.band] ||
          b.risikoSemasa - b.risikoSebelum - (a.risikoSemasa - a.risikoSebelum) ||
          a.komoditiLabel.localeCompare(b.komoditiLabel, 'ms'),
      )
      .map((r) => r.komoditiId);
    return JSON.stringify(jangka) === JSON.stringify(rows) ? true : jangka;
  };
  const MINGGU = (d) => d.rekod.filter((r) => r.tarikh >= '2026-11-16');
  try {
    // (i) senarai rata ringkas, tiada kumpulan negeri
    {
      const { page, masalah, minta } = await buka();
      const k = await kad(page);
      ok(
        '(i) satu baris setiap komoditi',
        k.length === 5,
        k.map((x) => x.id),
      );
      const urut = sudahSusun(
        k.map((x) => x.id),
        MINGGU(nyata),
      );
      ok('(i) susunan Merah > Kuning > Hijau, kenaikan risiko, A-Z', urut === true, urut);
      ok(
        '(i) Merah dahulu, Kuning kedua',
        k[0].id === 'kubis' && k[1].id === 'tembikai',
        k.map((x) => x.id),
      );
      ok(
        '(i) tiada pengepala kumpulan negeri / hari / togol paparan',
        !(await page.$('.iv-mu-grp, .iv-mu-day, .iv-mu-toggle, [data-iv-act="museView"]')) &&
          !/Lokasi tidak dinyatakan \(/.test(await teks(page, '#ivMusePanel')),
      );
      ok('(i) data-band', k[0].band === 'merah' && k[1].band === 'kuning' && k[2].band === 'hijau');
      ok('(i) chip Merah dengan perubahan', /Merah\s+60 ↑ \+55/.test(k[0].risiko), k[0].risiko);
      ok(
        '(i) kelas chip band',
        /\bbad\b/.test(k[0].cls) && /\bwarn\b/.test(k[1].cls) && /\bok\b/.test(k[2].cls),
      );
      ok(
        '(i) tarikh ringkas',
        k.every((x) => /^\d{1,2} [A-Z][a-z]{2}$/.test(x.tarikh)),
        k.map((x) => x.tarikh),
      );
      const kel = k.find((x) => x.id === 'kelapa-tua');
      ok('(i) lokasi pertama + N', /Dungun, Terengganu \+1/.test(kel.loc), kel.loc);
      ok(
        '(i) tanpa lokasi: kosong',
        k.find((x) => x.id === 'kubis').loc.trim() === '',
        k.map((x) => x.loc),
      );
      ok(
        '(i) tajuk <= 70 aksara, sebaris, tidak kosong',
        k.every((x) => x.hl.length > 0 && x.hl.length <= 70),
        k.map((x) => x.hl),
      );
      const notaKelapa = nyata.rekod.find(
        (r) => r.komoditiId === 'kelapa-tua' && r.tarikh === '2026-11-17',
      ).nota;
      ok(
        '(i) nota penuh tidak dipaparkan pada senarai',
        !(await teks(page, '#ivMuseList')).includes(notaKelapa.slice(-30)),
      );
      ok(
        '(i) butang Baca lagi pada setiap baris',
        (await page.$$('#ivMuseList .iv-mr-more')).length === 5,
      );
      ok(
        '(i) tiada butang tindakan',
        !(await page.$('#ivMusePanel .iv-mc-act, #ivMusePanel [data-iv-act="museXfer"]')),
      );
      const p = await teks(page, '#ivMusePanel');
      ok(
        '(i) tiada DATA DUMMY',
        !/DATA DUMMY/i.test(p) && !(await page.$('#ivMusePanel .iv-tag.dummy')),
      );
      ok(
        '(i) Tarikh data terakhir',
        /Tarikh data terakhir\s*17 November 2026/.test(p),
        p.slice(0, 400),
      );
      ok(
        '(i) sumber',
        (await teks(page, '#ivMuseChips')).includes('Sumber: AI Muse · db-curated (Google Drive)'),
      );
      ok(
        '(i) ringkasan',
        (await teks(page, '#ivMuseCount')) === '5 komoditi · 1 Merah · 1 Kuning',
        await teks(page, '#ivMuseCount'),
      );
      ok('(i) label minggu', (await teks(page, '#ivWeekLbl')) === '16 – 22 November 2026');
      ok('(i) tiada kad lapuk', !(await page.$('#ivMuseStale')));
      ok('(i) minggu lalai tanpa param', minta[0] === '/api/muse', minta);
      ok(
        '(i) pager tersembunyi (<= 8)',
        await page.$eval('#ivMusePager', (e) => e.hidden || getComputedStyle(e).display === 'none'),
      );
      const ada = await page.$eval('#ivFKomoditi', (s) =>
        [...s.options].some((o) => o.value === 'KUBIS'),
      );
      if (ada) {
        await page.select('#ivFKomoditi', 'KUBIS');
        await page.select('#ivFVarieti', 'kubis-bulat-tanah-tinggi');
        await sleep(600);
        const k2 = await kad(page);
        ok(
          '(i) penapis komoditi KUBIS (Tanah Tinggi) -> kubis',
          k2.length === 1 && k2[0].id === 'kubis',
          k2.map((x) => x.id),
        );
        await page.select('#ivFKomoditi', 'all');
        await sleep(400);
      } else ok('(i) pilihan KUBIS wujud', false);
      ok('(i) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
    }
    // (i-b) 17 komoditi: 8 setiap halaman, halaman, tinggi baris, tinggi panel tidak membesar
    {
      const d17 = buatN(17),
        d8 = buatN(8),
        d40 = buatN(40);
      const tinggi = {};
      for (const [nama, d] of [
        ['8', d8],
        ['17', d17],
        ['40', d40],
      ]) {
        const { page, masalah } = await buka({ muse: d });
        const k = await kad(page);
        ok(`(i-b) ${nama}: 8 baris pada halaman 1`, k.length === 8, k.length);
        ok(
          `(i-b) ${nama}: baris <= 56px pada 1440`,
          k.every((x) => x.tinggi <= 56 && x.tinggi >= 30),
          k.map((x) => x.tinggi),
        );
        const urut = sudahSusun(
          (await kad(page)).map((x) => x.id),
          MINGGU(d),
        );
        tinggi[nama] = await page.$eval('#ivMusePanel', (e) =>
          Math.round(e.getBoundingClientRect().height),
        );
        if (nama === '8') {
          ok(
            '(i-b) 8: pager tersembunyi',
            await page.$eval(
              '#ivMusePager',
              (e) => e.hidden || getComputedStyle(e).display === 'none',
            ),
          );
          ok(
            '(i-b) 8: ringkasan',
            /^8 komoditi/.test(await teks(page, '#ivMuseCount')),
            await teks(page, '#ivMuseCount'),
          );
        }
        if (nama === '17') {
          const semua = [];
          ok(
            '(i-b) 17: ringkasan',
            /^17 komoditi · \d+ Merah · \d+ Kuning$/.test(await teks(page, '#ivMuseCount')),
            await teks(page, '#ivMuseCount'),
          );
          ok(
            '(i-b) 17: pager kelihatan',
            await page.$eval('#ivMusePager', (e) => !e.hidden && e.offsetHeight > 0),
          );
          ok(
            '(i-b) 17: Halaman 1 daripada 3',
            (await teks(page, '#ivMusePgLbl')) === 'Halaman 1 daripada 3',
            await teks(page, '#ivMusePgLbl'),
          );
          ok(
            '(i-b) 17: Sebelum dilumpuhkan',
            await page.$eval('[data-iv-act="musePage"][data-iv-arg="prev"]', (e) => e.disabled),
          );
          semua.push(...k.map((x) => x.id));
          await klik(page, 'musePage', 'next');
          const k2 = await kad(page);
          ok(
            '(i-b) 17: halaman 2 ada 8 baris',
            k2.length === 8 && (await teks(page, '#ivMusePgLbl')) === 'Halaman 2 daripada 3',
          );
          semua.push(...k2.map((x) => x.id));
          await klik(page, 'musePage', 'next');
          const k3 = await kad(page);
          ok(
            '(i-b) 17: halaman 3 ada baki 1',
            k3.length === 1 && (await teks(page, '#ivMusePgLbl')) === 'Halaman 3 daripada 3',
          );
          ok(
            '(i-b) 17: Seterusnya dilumpuhkan',
            await page.$eval('[data-iv-act="musePage"][data-iv-arg="next"]', (e) => e.disabled),
          );
          semua.push(...k3.map((x) => x.id));
          ok('(i-b) 17: 17 item unik merentas halaman', new Set(semua).size === 17, semua);
          ok(
            '(i-b) 17: susunan global betul',
            sudahSusun(semua, MINGGU(d17)) === true,
            sudahSusun(semua, MINGGU(d17)),
          );
          await klik(page, 'musePage', 'prev');
          ok(
            '(i-b) 17: Sebelum kembali ke halaman 2',
            (await teks(page, '#ivMusePgLbl')) === 'Halaman 2 daripada 3',
          );
        }
        ok(`(i-b) ${nama}: tiada ralat konsol/CSP`, masalah.length === 0, masalah);
        await page.close();
      }
      ok('(i-b) tinggi panel 17 sama dengan 40 komoditi', tinggi['17'] === tinggi['40'], tinggi);
      ok(
        '(i-b) tinggi panel 17 hanya lebih pager berbanding 8',
        tinggi['17'] - tinggi['8'] <= 60 && tinggi['17'] - tinggi['8'] >= 0,
        tinggi,
      );
      ok('(i-b) panel padat (< 640px pada 1440)', tinggi['17'] < 640, tinggi);
    }
    // (i-c) tiada lokasi sama sekali: tiada chip, tiada pengepala
    {
      const d = JSON.parse(JSON.stringify(nyata));
      d.rekod.forEach((r) => (r.lokasi = []));
      const { page } = await buka({ muse: d });
      const k = await kad(page);
      ok(
        '(i-c) tiada chip lokasi',
        k.every((x) => x.loc.trim() === ''),
        k.map((x) => x.loc),
      );
      ok('(i-c) Merah dahulu', k[0].id === 'kubis' && k[1].id === 'tembikai');
      await page.close();
    }
    // (ii) navigasi minggu
    {
      const { page, masalah, minta } = await buka();
      const dis = (sel) => page.$eval(sel, (e) => e.disabled);
      const P = '#ivMusePanel [data-iv-act="museWeek"][data-iv-arg="prev"]';
      const N = '#ivMusePanel [data-iv-act="museWeek"][data-iv-arg="next"]';
      ok('(ii) seterusnya dilumpuhkan pada minggu terkini', await dis(N));
      await page.click(P);
      await sleep(900);
      ok('(ii) prev minta 2026-11-09', minta.includes('/api/muse?minggu=2026-11-09'), minta);
      ok(
        '(ii) label 9 – 15 November 2026',
        (await teks(page, '#ivWeekLbl')) === '9 – 15 November 2026',
        await teks(page, '#ivWeekLbl'),
      );
      ok(
        '(ii) minggu 9 Nov: 5 kad, tarikh 15 Nov',
        (await kad(page)).length === 5 && /15 Nov/.test((await kad(page))[0].teks),
      );
      await page.click(P);
      await sleep(900);
      ok('(ii) prev minta 2026-11-02', minta.includes('/api/muse?minggu=2026-11-02'), minta);
      ok('(ii) prev dilumpuhkan pada minggu terawal', await dis(P));
      ok('(ii) seterusnya aktif', !(await dis(N)));
      await page.click('#ivMusePanel [data-iv-act="museWeek"][data-iv-arg="now"]');
      await sleep(900);
      ok(
        '(ii) Minggu ini -> 2026-11-16',
        (await teks(page, '#ivWeekLbl')) === '16 – 22 November 2026' &&
          minta[minta.length - 1] === '/api/muse?minggu=2026-11-16',
        minta,
      );
      await page.click(P);
      await sleep(800);
      await page.click(N);
      await sleep(800);
      ok(
        '(ii) seterusnya kembali ke 16 Nov',
        (await teks(page, '#ivWeekLbl')) === '16 – 22 November 2026',
      );
      ok('(ii) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
    }
    // (iv) kosong
    {
      const kosong = {
        ...nyata,
        minggu: '2026-11-16',
        mingguTersedia: ['2026-11-16'],
        rekod: [],
        bilRekod: 0,
      };
      const { page } = await buka({ muse: kosong });
      ok(
        '(iv) teks kosong tepat',
        (await teks(page, '#ivMuseEmpty')) === 'Tiada berita AI Muse untuk minggu ini',
        await page.$eval('#ivMuseBody', (e) => e.innerText.slice(0, 200)),
      );
      ok('(iv) tiada kad', (await kad(page)).length === 0);
      await page.close();
    }
    // (v) ralat -> Cuba Semula -> pulih
    for (const mod of [{ status: 503 }, 'abort']) {
      let n = 0;
      const { page } = await buka({ muse: () => (n++ === 0 ? mod : nyata), rangkaian: true });
      const awal = await teks(page, '#ivMuseBody');
      ok(
        `(v) ralat ${mod.status || mod}`,
        /Data AI Muse tidak dapat dimuatkan/.test(awal) && /Cuba Semula/.test(awal),
        awal,
      );
      ok('(v) tiada kad semasa ralat', (await kad(page)).length === 0);
      await page.click('#ivMusePanel [data-iv-act="museRetry"]');
      await sleep(900);
      ok('(v) pulih selepas Cuba Semula', (await kad(page)).length === 5);
      await page.close();
    }
    // (vi) lapuk
    {
      const lapuk = { ...nyata, latestDate: '2026-11-14' };
      const { page } = await buka({ muse: lapuk });
      const t = await page.$eval('#ivMuseStale', (e) => e.innerText).catch(() => '');
      ok(
        '(vi) banner lapuk',
        /Data AI Muse lapuk: tarikh data terakhir 14 November 2026/.test(t),
        t,
      );
      ok('(vi) kad masih dipaparkan', (await kad(page)).length === 5);
      await page.close();
    }
    // (vi-b) sebahagian
    {
      const { page } = await buka({ muse: { ...nyata, status: 'sebahagian' } });
      ok('(vi-b) nota sebahagian', (await page.$('#ivMusePart')) !== null);
      await page.close();
    }
    // (vii) file://
    {
      const { page } = await buka({
        url: 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/') + '?muse=1',
        rangkaian: true,
      });
      ok(
        '(vii) file:// memerlukan pelayan',
        (await teks(page, '#ivMuseBody')).includes('Data AI Muse memerlukan pelayan (npm start)'),
        await teks(page, '#ivMuseBody'),
      );
      await page.close();
    }
    // (viii) overflow pada 3 lebar, senarai penuh + dialog terbuka
    for (const lebar of [1440, 1024, 390]) {
      const { page } = await buka({ lebar, muse: buatN(17) });
      const ukur = () =>
        page.evaluate(() => {
          const p = document.getElementById('ivMusePanel').getBoundingClientRect();
          const luar = [...document.querySelectorAll('#ivMusePanel *')].filter((e) => {
            const a = e.getBoundingClientRect();
            return a.width > 0 && a.right > p.right + 1;
          });
          return {
            luar: luar.slice(0, 4).map((e) => e.className || e.tagName),
            sw: document.documentElement.scrollWidth,
            iw: innerWidth,
            baris: [...document.querySelectorAll('#ivMuseList .iv-mrow')].filter(
              (c) => c.scrollWidth > c.clientWidth + 1,
            ).length,
          };
        });
      const m = await ukur();
      ok(`(viii) ${lebar}: tiada elemen melebihi panel`, m.luar.length === 0, m.luar);
      ok(`(viii) ${lebar}: tiada overflow mendatar halaman`, m.sw <= m.iw, [m.sw, m.iw]);
      ok(`(viii) ${lebar}: tiada overflow baris`, m.baris === 0, m.baris);
      await klik(page, 'museOpen', 'kubis');
      await sleep(300);
      const dlg = await page.$eval('#ivMuseMdDlg', (e) => {
        const r = e.getBoundingClientRect();
        return {
          l: r.left,
          r: r.right,
          t: r.top,
          b: r.bottom,
          sw: e.scrollWidth,
          cw: e.clientWidth,
          iw: innerWidth,
          ih: innerHeight,
        };
      });
      ok(
        `(viii) ${lebar}: dialog muat dalam skrin`,
        dlg.l >= 0 && dlg.r <= dlg.iw && dlg.t >= 0 && dlg.b <= dlg.ih && dlg.sw <= dlg.cw + 1,
        dlg,
      );
      await page.close();
    }
    // (viii-b) dialog Baca lagi
    {
      const { page, masalah } = await buka();
      const btn = '#ivMuseList [data-iv-arg="kelapa-tua"]';
      ok('(viii-b) dialog tertutup pada mulanya', await page.$eval('#ivMuseMd', (e) => e.hidden));
      await page.focus(btn);
      await page.keyboard.press('Enter');
      await sleep(400);
      const a = await page.evaluate(() => {
        const d = document.getElementById('ivMuseMdDlg');
        return {
          buka:
            !document.getElementById('ivMuseMd').hidden &&
            document.getElementById('ivMuseMd').classList.contains('open'),
          role: d.getAttribute('role'),
          modal: d.getAttribute('aria-modal'),
          label: d.getAttribute('aria-labelledby'),
          tajuk: document.getElementById('ivMuseMdT').textContent,
          teks: d.innerText,
          fokus: d.contains(document.activeElement),
          blur: getComputedStyle(document.getElementById('ivMuseMd')).backdropFilter,
          halamanTinggi: document.documentElement.scrollHeight,
          baris: document.querySelectorAll('#ivMuseMdTl tbody tr').length,
          hari: [...document.querySelectorAll('#ivMuseMdTl tbody tr td:first-child')].map(
            (x) => x.textContent,
          ),
          nota: document.getElementById('ivMuseMdNota').textContent,
        };
      });
      const notaKelapa = nyata.rekod.find(
        (r) => r.komoditiId === 'kelapa-tua' && r.tarikh === '2026-11-17',
      ).nota;
      ok(
        '(viii-b) dialog terbuka',
        a.buka && a.role === 'dialog' && a.modal === 'true' && a.label === 'ivMuseMdT',
        a,
      );
      ok('(viii-b) tajuk komoditi', a.tajuk === 'Kelapa Tua', a.tajuk);
      ok('(viii-b) nota penuh', a.nota === notaKelapa, a.nota);
      ok(
        '(viii-b) risiko, harga, sentimen, sampel, sumber, lokasi',
        /Risiko sebelum/.test(a.teks) &&
          /Risiko semasa/.test(a.teks) &&
          /Risiko hadapan/.test(a.teks) &&
          /harga pada/.test(a.teks) &&
          /RM\//.test(a.teks) &&
          /Indeks sentimen/.test(a.teks) &&
          /Bilangan sampel/.test(a.teks) &&
          /Data awal/.test(a.teks) &&
          /db-curated-2026-11-17\.json/.test(a.teks) &&
          /Dungun, Terengganu/.test(a.teks) &&
          /Marang, Terengganu/.test(a.teks),
        a.teks,
      );
      ok(
        '(viii-b) garis masa 2 hari, terbaharu dahulu',
        a.baris === 2 && a.hari[0] === '17 Nov' && a.hari[1] === '16 Nov',
        a.teks.slice(-300),
      );
      ok('(viii-b) fokus dalam dialog', a.fokus);
      ok('(viii-b) latar kabur', /blur/.test(a.blur), a.blur);
      await page.keyboard.press('Escape');
      await sleep(400);
      const b = await page.evaluate(
        (s) => ({
          tutup: document.getElementById('ivMuseMd').hidden,
          fokus: document.activeElement === document.querySelector(s),
        }),
        btn,
      );
      ok('(viii-b) Esc menutup dan fokus dipulihkan', b.tutup && b.fokus, b);
      // X
      await page.click(btn);
      await sleep(400);
      await page.click('#ivMuseMdClose');
      await sleep(400);
      ok(
        '(viii-b) X menutup, fokus pulih',
        await page.evaluate(
          (s) =>
            document.getElementById('ivMuseMd').hidden &&
            document.activeElement === document.querySelector(s),
          btn,
        ),
      );
      // backdrop
      await page.click(btn);
      await sleep(400);
      await page.mouse.click(4, 4);
      await sleep(400);
      ok('(viii-b) klik latar menutup', await page.$eval('#ivMuseMd', (e) => e.hidden));
      // perangkap Tab
      await page.click(btn);
      await sleep(400);
      let luar = 0;
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        if (
          !(await page.evaluate(() =>
            document.getElementById('ivMuseMdDlg').contains(document.activeElement),
          ))
        )
          luar++;
      }
      for (let i = 0; i < 4; i++) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        await page.keyboard.up('Shift');
        if (
          !(await page.evaluate(() =>
            document.getElementById('ivMuseMdDlg').contains(document.activeElement),
          ))
        )
          luar++;
      }
      ok('(viii-b) Tab terperangkap dalam dialog', luar === 0, luar);
      await page.keyboard.press('Escape');
      await sleep(400);
      // sebelum / seterusnya
      await page.click('#ivMuseList [data-iv-arg="kubis"]');
      await sleep(400);
      ok(
        '(viii-b) pertama: Sebelum dilumpuhkan',
        await page.$eval('#ivMuseMdPrev', (e) => e.disabled),
      );
      ok(
        '(viii-b) kedudukan 1 daripada 5',
        (await teks(page, '#ivMuseMdPos')) === '1 daripada 5',
        await teks(page, '#ivMuseMdPos'),
      );
      await page.click('#ivMuseMdNext');
      await sleep(250);
      ok(
        '(viii-b) Seterusnya -> Tembikai',
        (await teks(page, '#ivMuseMdT')) === 'Tembikai' &&
          (await teks(page, '#ivMuseMdPos')) === '2 daripada 5',
      );
      await page.click('#ivMuseMdPrev');
      await sleep(250);
      ok('(viii-b) Sebelum -> Kubis', (await teks(page, '#ivMuseMdT')) === 'Kubis');
      for (let i = 0; i < 4; i++) {
        await page.click('#ivMuseMdNext');
        await sleep(150);
      }
      ok(
        '(viii-b) terakhir: Seterusnya dilumpuhkan, fokus kekal dalam dialog',
        (await page.$eval('#ivMuseMdNext', (e) => e.disabled)) &&
          (await page.evaluate(() =>
            document.getElementById('ivMuseMdDlg').contains(document.activeElement),
          )),
      );
      await page.keyboard.press('Escape');
      await sleep(400);
      ok(
        '(viii-b) selepas navigasi Esc memulihkan fokus ke baris terakhir',
        await page.evaluate(
          () =>
            document.activeElement.dataset.ivArg ===
            document.querySelector('#ivMuseList .iv-mrow:last-child').dataset.id,
        ),
      );
      ok('(viii-b) tiada ralat konsol/CSP', masalah.length === 0, masalah);
      await page.close();
    }
    // (viii-c) navigasi dialog merentas halaman
    {
      const { page } = await buka({ muse: buatN(17) });
      await page.click('#ivMuseList .iv-mrow:last-child .iv-mr-more');
      await sleep(300);
      for (let i = 0; i < 1; i++) await page.click('#ivMuseMdNext');
      await sleep(300);
      ok(
        '(viii-c) dialog menyeret halaman senarai ke halaman 2',
        (await teks(page, '#ivMusePgLbl')) === 'Halaman 2 daripada 3',
        await teks(page, '#ivMusePgLbl'),
      );
      ok(
        '(viii-c) kedudukan 9 daripada 17',
        (await teks(page, '#ivMuseMdPos')) === '9 daripada 17',
      );
      await page.keyboard.press('Escape');
      await sleep(400);
      ok(
        '(viii-c) fokus pulih ke baris item dibuka',
        await page.evaluate(
          () =>
            document.activeElement.classList.contains('iv-mr-more') &&
            document.activeElement.closest('li').querySelector('.iv-mr-n').textContent.length > 0,
        ),
      );
      await page.close();
    }
    // (ix) kontras kedua-dua tema + tangkapan skrin berklip
    for (const tema of ['gelap', 'cerah']) {
      for (const lebar of [1440, 390]) {
        const { page } = await buka({ tema, lebar, muse: buatN(17) });
        const kontras = () =>
          page.evaluate(() => {
            const rgb = (s) => (s.match(/[\d.]+/g) || [0, 0, 0, 0]).map(Number);
            const lum = ([r, g, b]) => {
              const f = (v) => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              };
              return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const latar = (e) => {
              const lapis = [];
              for (let x = e; x; x = x.parentElement) {
                const c = rgb(getComputedStyle(x).backgroundColor);
                const a = c.length >= 4 ? c[3] : 1;
                if (a > 0) lapis.push([c[0], c[1], c[2], a]);
                if (a >= 1) break;
              }
              let [r, g, b] = [255, 255, 255];
              if (!lapis.length || lapis[lapis.length - 1][3] < 1)
                [r, g, b] = rgb(getComputedStyle(document.body).backgroundColor);
              for (let i = lapis.length - 1; i >= 0; i--) {
                const [R, G, B, A] = lapis[i];
                r = R * A + r * (1 - A);
                g = G * A + g * (1 - A);
                b = B * A + b * (1 - A);
              }
              return [r, g, b];
            };
            const buruk = [];
            let n = 0;
            document
              .querySelectorAll(
                '#ivMusePanel .iv-mr-n, #ivMusePanel .iv-mr-hl, #ivMusePanel .iv-mr-d, #ivMusePanel .iv-mr-more, #ivMusePanel .iv-chip, #ivMusePanel .iv-tr, #ivMusePanel .iv-mu-last, #ivMusePanel .iv-mu-last b, #ivMusePanel .iv-mu-n, #ivMusePanel .iv-sec, #ivMusePanel #ivWeekLbl, #ivMusePanel .iv-mu-pg span, #ivMusePanel .iv-mu-pg button, #ivMusePanel details.iv-crit summary, #ivMuseMdDlg h2, #ivMuseMdDlg .iv-mc-ins, #ivMuseMdDlg .iv-kv span, #ivMuseMdDlg .iv-kv b, #ivMuseMdDlg .iv-sec, #ivMuseMdDlg th, #ivMuseMdDlg td, #ivMuseMdDlg .iv-mc-price, #ivMuseMdDlg .iv-mc-price b, #ivMuseMdDlg .iv-chip, #ivMuseMdDlg .iv-tr, #ivMuseMdDlg .iv-mm-foot, #ivMuseMdDlg .iv-mm-nav button:not(:disabled)',
              )
              .forEach((e) => {
                if (!e.offsetParent) return;
                n++;
                const a = lum(rgb(getComputedStyle(e).color));
                const b = lum(latar(e));
                const k = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                if (k < 4.5)
                  buruk.push([
                    e.className || e.id || e.tagName,
                    k.toFixed(2),
                    e.innerText.slice(0, 24),
                  ]);
              });
            return { buruk, n };
          });
        const r1 = await kontras();
        ok(
          `(ix) kontras senarai >= 4.5 tema ${tema} ${lebar}`,
          r1.buruk.length === 0 && r1.n > 25,
          r1,
        );
        const klip = async (sel, nama) => {
          const kotak = await page.$eval(sel, (e) => {
            const r = e.getBoundingClientRect();
            return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
          });
          const fail = path.join(os.tmpdir(), `muse-${nama}-${tema}-${lebar}.png`);
          await page.screenshot({
            path: fail,
            captureBeyondViewport: true,
            clip: {
              x: kotak.x,
              y: kotak.y,
              width: Math.min(kotak.width, 1600),
              height: Math.min(kotak.height, 1600),
            },
          });
          console.log('tangkapan skrin:', fail);
        };
        await klip('#ivMusePanel', 'panel');
        await page.click('#ivMuseList .iv-mrow:first-child .iv-mr-more');
        await sleep(400);
        const r2 = await kontras();
        ok(
          `(ix) kontras dialog >= 4.5 tema ${tema} ${lebar}`,
          r2.buruk.length === 0,
          r2.buruk.slice(0, 6),
        );
        await klip('#ivMuseMdDlg', 'dialog');
        await page.close();
      }
    }
    // (x) lalai: panel disembunyikan (IV_SHOW_MUSE=false), tiada jurang dan tiada permintaan /api/muse oleh Intervensi
    for (const lebar of [1440, 390]) {
      const { page, masalah, minta } = await buka({ url: base + '/', lebar });
      const h = await page.evaluate(() => {
        const p = document.getElementById('ivMusePanel');
        const g = document.querySelector('.iv-grid-top').getBoundingClientRect();
        let nxt = p.nextElementSibling;
        while (nxt && nxt.hidden) nxt = nxt.nextElementSibling;
        return {
          hidden: p.hidden,
          display: getComputedStyle(p).display,
          h: p.getBoundingClientRect().height,
          butang: document.querySelectorAll('#viewIntervensi [data-iv-act^="muse"]:not(#ivMuseMd *)')
            .length,
          nextTop: nxt ? nxt.getBoundingClientRect().top - g.bottom : null,
        };
      });
      ok(`(x) panel Muse tersembunyi ${lebar}`, h.hidden && h.display === 'none' && h.h === 0, h);
      ok(`(x) tiada butang Muse kelihatan ${lebar}`, h.butang === 0, h);
      // panel EWS (Pemantauan) memuat /api/muse sekali; Intervensi tidak membuat permintaan sendiri
      const dimuat = await page.evaluate(() => IV_TEST.museData());
      ok(`(x) Intervensi tidak memuat data Muse ${lebar}`, dimuat === null && minta.length <= 1, {
        dimuat,
        minta,
      });
      ok(`(x) tiada ralat konsol ${lebar}`, masalah.length === 0, masalah);
      await page.close();
    }
  } catch (e) {
    gagal.push('pengecualian: ' + (e && e.stack ? e.stack : e));
  }
  await browser.close();
  server.close();
  if (gagal.length) {
    console.error('GAGAL:\n - ' + gagal.join('\n - '));
    process.exit(1);
  }
  console.log(
    'OK: panel AI Muse (kad, susunan, garis masa, minggu, ikut hari, kosong/ralat/lapuk/file, overflow, kontras)',
  );
})();

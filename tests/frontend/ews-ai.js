'use strict';
// Panel 'EWS (AI)' (tab Pemantauan): tiga paparan bertab (Amaran Rasmi, Risiko Banjir, Risiko Sentimen),
// tab lalai, papan kekunci, kegigihan tab selepas renderAll()/penapis, tiada fetch tambahan ketika menukar tab,
// keadaan sentimen, reka letak dan tiada ralat konsol. API distub (deterministik).
// EWS_SHOTS=<folder> menyimpan tangkapan skrin panel (ews-ai-<paparan>-<lebar>.png).
// Jalankan dari root: node --no-warnings tests/frontend/ews-ai.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const { buatFixture } = require('../helpers/cuaca-fixture.js');
const { buatFixtureBanjir, pasangSemuaCache } = require('../helpers/banjir-fixture.js');
const { buatFixtureMuse, pasangCacheMuse, julat } = require('../helpers/muse-fixture.js');
const { stubApi } = require('../helpers/api-stub.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);
const EDGE =
  process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hariIni = (n) => new Date(Date.now() + 8 * 36e5 - n * 864e5).toISOString().slice(0, 10);
const fixtureMuse = () => buatFixtureMuse({ hari: julat(hariIni(7), hariIni(0)) });
const TAB = { amaran: 'ewsTabAmaran', banjir: 'ewsTabBanjir', sentimen: 'ewsTabSentimen' };
const VIEW = { amaran: 'ewsViewAmaran', banjir: 'ewsViewBanjir', sentimen: 'ewsViewSentimen' };

function amaranCampur() {
  const jam = (n) => new Date(Date.now() - n * 36e5).toISOString();
  const met = [0, 1, 2, 3, 4].map((i) => ({
    jenis: 'hujan',
    tajuk: `AMARAN MET M${i}`,
    teks: `Teks M${i}`,
    negeri: ['Terengganu'],
    dikeluarkan: jam(2 * i + 1),
    sah_dari: jam(2 * i + 1),
    sah_hingga: new Date(Date.now() + (i % 2 === 0 ? 36e5 : -36e5)).toISOString(),
    aktif: i % 2 === 0,
  }));
  return met;
}

(async () => {
  pasangSemuaCache();
  pasangCacheMuse(fixtureMuse());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const nyata = await (await fetch(base + '/api/muse')).json();
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ews-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const gagal = [];
  const ok = (nama, cond, info) => {
    if (!cond) gagal.push(nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  };
  async function buka({ muse, lebar = 1440, rangkaian = false } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: lebar, height: 900 });
    const masalah = [];
    page.minta = { muse: 0, banjir: 0, cuaca: 0 };
    page.on('pageerror', (e) => masalah.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (!['error', 'warning'].includes(m.type())) return;
      if (rangkaian && /Failed to load resource|Data sentimen|Data AI Muse/.test(m.text())) return;
      masalah.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('request', (r) => {
      for (const k of Object.keys(page.minta))
        if (new RegExp('/api/' + k + '(\\?|$)').test(r.url())) page.minta[k]++;
    });
    await stubApi(page, {
      cuaca: buatFixture(),
      banjir: buatFixtureBanjir({ tahap: 'amaran' }),
      ...(muse === undefined ? {} : { muse }),
    });
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    await sleep(2000);
    return { page, masalah };
  }
  const nampak = (page, sel) =>
    page.$eval(sel, (e) => {
      const r = e.getBoundingClientRect();
      return !e.hidden && r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none';
    });
  const viewNampak = (page) =>
    page.$$eval('#ewsPanel .ews-view', (v) =>
      v.filter((e) => !e.hidden && e.getBoundingClientRect().height > 0).map((e) => e.id),
    );
  const tabState = (page) =>
    page.$$eval('#ewsPanel [role=tab]', (t) =>
      t.map((e) => [e.id, e.getAttribute('aria-selected'), e.tabIndex]),
    );

  try {
    // (1) struktur, tab lalai, paparan Amaran Rasmi
    {
      const { page, masalah } = await buka();
      ok(
        '(1) tajuk EWS (AI)',
        (await page.$eval('#ewsTitle', (e) => e.textContent.trim())) === 'EWS (AI)',
      );
      const tabs = await page.$$eval('#ewsPanel [role=tab]', (t) =>
        t.map((e) => e.getAttribute('aria-label')),
      );
      ok(
        '(1) tiga tab',
        tabs.join('|') ===
          'Amaran Rasmi (MET Malaysia & JPS)|Risiko Banjir (JPS)|Risiko Sentimen (Muse AI)',
        tabs,
      );
      ok('(1) tablist wujud', !!(await page.$('#ewsTabs[role=tablist]')));
      const st = await tabState(page);
      ok(
        '(1) lalai Amaran Rasmi terpilih',
        st[0][1] === 'true' && st[1][1] === 'false' && st[2][1] === 'false',
        st,
      );
      ok('(1) roving tabindex', st[0][2] === 0 && st[1][2] === -1 && st[2][2] === -1, st);
      ok(
        '(1) state.ewsTab amaran',
        (await page.evaluate(() => DASHBOARD_TEST.ewsState().tab)) === 'amaran',
      );
      ok(
        '(1) item amaran kelihatan',
        (await page.$$eval(
          '#metAlertBody .alert-item',
          (e) => e.filter((x) => x.getBoundingClientRect().height > 0).length,
        )) > 0,
      );
      ok(
        '(1) hanya satu paparan',
        (await viewNampak(page)).join() === VIEW.amaran,
        await viewNampak(page),
      );
      const panelNampak = await page.$$eval('.bottom-grid > .panel, #ewsPanel', (p) =>
        p.filter((e) => getComputedStyle(e).display !== 'none' && !e.hidden).map((e) => e.id),
      );
      ok('(1) EWS satu-satunya panel kelihatan', panelNampak.join() === 'ewsPanel', panelNampak);
      ok('(1) #floodPanel kekal hidden', !(await nampak(page, '#floodPanel')));
      ok('(1) #amsPanel kekal hidden', !(await nampak(page, '#amsPanel')));
      ok(
        '(1) subtajuk amaran',
        /aktif/.test(await page.$eval('#ewsSubtitle', (e) => e.textContent)),
      );
      ok('(1) tiada ralat konsol', masalah.length === 0, masalah);
      await page.close();
    }

    // (2) menukar tab, satu paparan kelihatan, tiada fetch tambahan
    {
      const { page, masalah } = await buka();
      const sebelum = { ...page.minta };
      await page.click('#' + TAB.banjir);
      ok(
        '(2) banjir: hanya paparan banjir',
        (await viewNampak(page)).join() === VIEW.banjir,
        await viewNampak(page),
      );
      const bj = await page.evaluate(() => ({
        ews: [...document.querySelectorAll('#ewsFloodList .bj-nama')].map((e) => e.textContent),
        lama: [...document.querySelectorAll('#floodList .bj-nama')].map((e) => e.textContent),
        chipEws: [...document.querySelectorAll('#ewsFloodSummary .bj-chip')].map(
          (e) => e.textContent,
        ),
        chipLama: [...document.querySelectorAll('#floodSummary .bj-chip')].map(
          (e) => e.textContent,
        ),
        po: document.getElementById('ewsFloodPoNote').textContent,
        poLama: document.getElementById('floodPoNote').textContent,
        sumber: document.getElementById('ewsFloodAttrib').textContent,
        alertNampak: [...document.querySelectorAll('#metAlertBody .alert-item')].filter(
          (e) => e.getBoundingClientRect().height > 0,
        ).length,
      }));
      ok('(2) stesen banjir ada', bj.ews.length > 0, bj.ews);
      ok('(2) stesen sama dengan panel lama', bj.ews.join() === bj.lama.join(), [bj.ews, bj.lama]);
      ok(
        '(2) empat chip tahap',
        bj.chipEws.length === 4 && bj.chipEws.join() === bj.chipLama.join(),
        bj.chipEws,
      );
      ok('(2) PO berisiko sama dengan panel lama', bj.po === bj.poLama, [bj.po, bj.poLama]);
      ok('(2) nota sumber banjir', /JPS Malaysia/.test(bj.sumber), bj.sumber);
      ok('(2) amaran disembunyikan', bj.alertNampak === 0, bj.alertNampak);
      ok(
        '(2) subtajuk banjir',
        /Dikemas kini/.test(await page.$eval('#ewsSubtitle', (e) => e.textContent)),
      );
      await page.click('#' + TAB.sentimen);
      ok(
        '(2) sentimen: hanya paparan sentimen',
        (await viewNampak(page)).join() === VIEW.sentimen,
        await viewNampak(page),
      );
      const s = await page.evaluate(() => ({
        n: document.querySelectorAll('#ewsMuseBody .ews-sent-row').length,
        chip: document.querySelectorAll(
          '#ewsMuseBody .ews-sent-row .ews-chip.bad, #ewsMuseBody .ews-sent-row .ews-chip.warn, #ewsMuseBody .ews-sent-row .ews-chip.ok',
        ).length,
        chips: document.getElementById('ewsMuseChips').textContent,
        sub: document.getElementById('ewsSubtitle').textContent,
        teks: document.getElementById('ewsMuseBody').innerText,
        bandPertama: (document.querySelector('#ewsMuseBody .ews-sent-row') || {}).dataset,
      }));
      ok('(2) item sentimen > 0', s.n > 0, s.n);
      ok('(2) chip band pada setiap item', s.chip === s.n, [s.chip, s.n]);
      ok(
        '(2) sumber AI Muse db-curated',
        /Sumber: AI Muse · db-curated \(Google Drive\)/.test(s.chips),
        s.chips,
      );
      ok('(2) Dikemas kini', /Dikemas kini/.test(s.sub), s.sub);
      ok('(2) tahap keseluruhan', /Tahap keseluruhan/.test(s.teks), s.teks.slice(0, 200));
      ok('(2) indeks dan sampel', /Indeks sentimen/.test(s.teks) && /Sampel/.test(s.teks));
      await page.click('#' + TAB.amaran);
      ok('(2) kembali ke amaran', (await viewNampak(page)).join() === VIEW.amaran);
      for (const k of Object.keys(TAB)) {
        await page.click('#' + TAB[k]);
        ok(
          '(2) satu paparan: ' + k,
          (await viewNampak(page)).join() === VIEW[k],
          await viewNampak(page),
        );
      }
      await sleep(300);
      ok(
        '(2) tiada permintaan baharu ketika menukar tab',
        JSON.stringify(page.minta) === JSON.stringify(sebelum),
        [sebelum, page.minta],
      );
      ok(
        '(2) /api/muse sekali sahaja (dikongsi dengan Intervensi)',
        page.minta.muse === 1,
        page.minta,
      );
      ok('(2) tiada ralat konsol', masalah.length === 0, masalah);
      await page.close();
    }

    // (3) papan kekunci
    {
      const { page, masalah } = await buka();
      const aktif = () => page.evaluate(() => document.activeElement.id);
      const dipilih = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#ewsPanel [role=tab][aria-selected=true]')]
            .map((e) => e.id)
            .join(),
        );
      await page.focus('#' + TAB.amaran);
      await page.keyboard.press('ArrowRight');
      ok(
        '(3) ArrowRight -> banjir',
        (await dipilih()) === TAB.banjir && (await aktif()) === TAB.banjir,
        [await dipilih(), await aktif()],
      );
      await page.keyboard.press('ArrowRight');
      ok(
        '(3) ArrowRight -> sentimen',
        (await dipilih()) === TAB.sentimen && (await aktif()) === TAB.sentimen,
      );
      await page.keyboard.press('ArrowRight');
      ok(
        '(3) ArrowRight melilit -> amaran',
        (await dipilih()) === TAB.amaran && (await aktif()) === TAB.amaran,
      );
      await page.keyboard.press('ArrowLeft');
      ok('(3) ArrowLeft melilit -> sentimen', (await dipilih()) === TAB.sentimen);
      await page.keyboard.press('Home');
      ok('(3) Home -> amaran', (await dipilih()) === TAB.amaran);
      await page.keyboard.press('End');
      ok(
        '(3) End -> sentimen',
        (await dipilih()) === TAB.sentimen && (await aktif()) === TAB.sentimen,
      );
      ok(
        '(3) satu paparan selepas papan kekunci',
        (await viewNampak(page)).join() === VIEW.sentimen,
      );
      const fokus = await page.$eval('#' + TAB.sentimen, (e) => {
        const s = getComputedStyle(e);
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
      });
      ok('(3) fokus kelihatan pada tab', fokus);
      ok('(3) tiada ralat konsol', masalah.length === 0, masalah);
      await page.close();
    }

    // (4) kegigihan tab selepas renderAll() dan penapis
    {
      const { page, masalah } = await buka();
      await page.click('#' + TAB.banjir);
      const sebelum = { ...page.minta };
      await page.evaluate(() => DASHBOARD_TEST.renderAll());
      let t = await page.evaluate(() => DASHBOARD_TEST.ewsState().tab);
      ok('(4) tab banjir kekal selepas renderAll()', t === 'banjir', t);
      ok('(4) paparan banjir kekal', (await viewNampak(page)).join() === VIEW.banjir);
      await page.select(
        '#filterState',
        await page.$eval('#filterState', (s) => s.options[1].value),
      );
      await sleep(300);
      t = await page.evaluate(() => DASHBOARD_TEST.ewsState().tab);
      ok('(4) tab kekal selepas tukar penapis', t === 'banjir', t);
      ok('(4) tab ARIA kekal', (await tabState(page))[1][1] === 'true');
      await page.click('#' + TAB.sentimen);
      await page.evaluate(() => DASHBOARD_TEST.renderAll());
      ok(
        '(4) sentimen kekal selepas renderAll()',
        (await viewNampak(page)).join() === VIEW.sentimen,
      );
      ok('(4) sentimen masih ada item', (await page.$$('#ewsMuseBody .ews-sent-row')).length > 0);
      ok(
        '(4) tiada fetch semula',
        page.minta.muse === sebelum.muse && page.minta.banjir === sebelum.banjir,
        [sebelum, page.minta],
      );
      ok('(4) tiada ralat konsol', masalah.length === 0, masalah);
      await page.close();
    }

    // (5) keadaan sentimen: kosong, ralat + cuba semula, memuat (HTML sumber)
    {
      const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
      ok(
        '(5) teks awal Memuatkan data sentimen…',
        /id="ewsMuseBody"[^>]*>\s*Memuatkan data sentimen…/.test(html),
      );
      const kosong = { ...nyata, rekod: [] };
      let r = await buka({ muse: kosong });
      await r.page.click('#' + TAB.sentimen);
      const tk = await r.page.$eval('#ewsMuseBody', (e) => e.innerText);
      ok('(5) Tiada isyarat sentimen', /Tiada isyarat sentimen/.test(tk), tk);
      ok('(5) tiada ralat konsol (kosong)', r.masalah.length === 0, r.masalah);
      await r.page.close();
      let panggilan = 0;
      r = await buka({
        muse: () => (panggilan++ === 0 ? { status: 500 } : nyata),
        rangkaian: true,
      });
      await r.page.click('#' + TAB.sentimen);
      const te = await r.page.$eval('#ewsMuseBody', (e) => e.innerText);
      ok('(5) Data sentimen tidak tersedia', /Data sentimen tidak tersedia/.test(te), te);
      ok('(5) butang Cuba semula', !!(await r.page.$('#ewsMuseBody [data-act="muse-ews-retry"]')));
      await r.page.click('#ewsMuseBody [data-act="muse-ews-retry"]');
      await sleep(800);
      ok('(5) cuba semula berjaya', (await r.page.$$('#ewsMuseBody .ews-sent-row')).length > 0);
      ok('(5) tiada ralat konsol selain rangkaian', r.masalah.length === 0, r.masalah);
      await r.page.close();
    }

    // (6) reka letak dan tangkapan skrin
    const folder = process.env.EWS_SHOTS;
    if (folder) fs.mkdirSync(folder, { recursive: true });
    for (const lebar of [1440, 1280, 1024, 390]) {
      const { page, masalah } = await buka({ lebar });
      const geo = () =>
        page.evaluate(() => {
          const r = (s) => {
            const e = document.querySelector(s);
            if (!e) return null;
            const b = e.getBoundingClientRect();
            return { t: b.top + scrollY, b: b.bottom + scrollY, l: b.left, r: b.right, h: b.height };
          };
          const v = document.querySelector('#ewsPanel .ews-view:not([hidden])');
          const peta = r('.map-panel');
          const ews = r('#ewsPanel');
          const harga = r('#susunHarga');
          const kad = [...document.querySelectorAll('#metAlertBody .alert-item')]
            .filter((e) => e.getBoundingClientRect().height > 0)
            .slice(0, 2)
            .map((e) => [Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().left)]);
          const k1 = document.querySelector('#metAlertBody .alert-item');
          const gaya = (s) => {
            const e = k1 && k1.querySelector(s);
            return e ? getComputedStyle(e) : null;
          };
          const tj = gaya('.alert-top b');
          const tk = gaya('p.alert-teks');
          const lk = gaya('.alert-lok');
          const tabs = document.getElementById('ewsTabs');
          return {
            sw: document.documentElement.scrollWidth,
            iw: innerWidth,
            peta,
            ews,
            harga,
            kad,
            skrolDalam: v ? v.scrollHeight > v.clientHeight + 1 : false,
            viewOverflowY: v ? getComputedStyle(v).overflowY : '',
            tabsLimpah: tabs.scrollWidth > tabs.clientWidth + 1,
            tabsDalam: [...tabs.children].every((x) => x.getBoundingClientRect().right <= innerWidth + 1),
            klampTajuk: tj && tj.webkitLineClamp,
            klampTeks: tk && tk.webkitLineClamp,
            lokNowrap: lk && lk.whiteSpace,
            induk: document.getElementById('ewsPanel').parentElement.id,
          };
        });
      for (const k of Object.keys(TAB)) {
        await page.click('#' + TAB[k]);
        await sleep(150);
        const m = await geo();
        ok(`(6) tiada limpahan mendatar ${k}@${lebar}`, m.sw <= m.iw, m.sw);
        ok(`(6) panel EWS tidak melimpah lebar ${k}@${lebar}`, m.ews.r <= m.iw + 1 && m.ews.l >= -1, m.ews);
        ok(`(6) sub-tab muat ${k}@${lebar}`, !m.tabsLimpah && m.tabsDalam);
        ok(`(6) panel dalam #petaKananKosong ${k}@${lebar}`, m.induk === 'petaKananKosong', m.induk);
        if (lebar >= 1400) {
          ok(`(6) EWS di kanan peta ${k}@${lebar}`, m.ews.l >= m.peta.r - 1, [m.ews, m.peta]);
          ok(
            `(6) EWS sama atas/bawah dengan peta ${k}@${lebar}`,
            Math.abs(m.ews.t - m.peta.t) <= 2 && Math.abs(m.ews.b - m.peta.b) <= 2,
            [m.ews, m.peta],
          );
        } else {
          ok(`(6) EWS di bawah peta, atas baris harga ${k}@${lebar}`, m.ews.t >= m.peta.b - 1 && m.ews.b <= m.harga.t + 1, [m.ews, m.peta, m.harga]);
          ok(`(6) EWS lebar penuh ${k}@${lebar}`, Math.abs(m.ews.l - m.peta.l) <= 2 && Math.abs(m.ews.r - m.peta.r) <= 2, [m.ews, m.peta]);
          ok(`(6) EWS <= 421px ${k}@${lebar}`, m.ews.h <= 421, m.ews.h);
        }
        ok(`(6) badan skrol dalaman ${k}@${lebar}`, m.viewOverflowY === 'auto', m.viewOverflowY);
        if (k === 'amaran' && m.kad.length === 2) {
          ok(`(6) kad satu lajur @${lebar}`, m.kad[0][1] === m.kad[1][1] && m.kad[1][0] > m.kad[0][0], m.kad);
          ok(`(6) tajuk 2 baris, teks 2 baris, lokasi satu baris @${lebar}`, m.klampTajuk === '2' && m.klampTeks === '2' && m.lokNowrap === 'nowrap', [m.klampTajuk, m.klampTeks, m.lokNowrap]);
        }
      }
      // Panel kelihatan boleh diskrol dalaman bila kandungan melebihi tinggi
      await page.click('#' + TAB.amaran);
      await sleep(100);
      const sk = await geo();
      ok(`(6) amaran: badan skrol apabila kandungan panjang @${lebar}`, sk.skrolDalam || sk.kad.length < 2, sk.skrolDalam);
      // Sub-tab dan Lihat lagi masih berfungsi
      await page.click('#' + TAB.banjir);
      ok(`(6) sub-tab banjir berfungsi @${lebar}`, (await viewNampak(page)).join() === VIEW.banjir);
      await page.click('#' + TAB.amaran);
      const lagi = await page.$('#metAlertBody .alert-more');
      if (lagi) {
        await lagi.click();
        const buka2 = await page.$eval('#metAlertBody .alert-more', (e) => e.closest('.alert-item').classList.contains('open'));
        ok(`(6) Lihat lagi buka kad @${lebar}`, buka2);
        await page.click('#metAlertBody .alert-more');
      }
      if (folder && lebar !== 390 && lebar !== 1280) {
        for (const tema of ['gelap', 'cerah']) {
          await page.evaluate((x) => {
            document.documentElement.setAttribute('data-theme', x);
          }, tema);
          await sleep(200);
          const el = await page.$('.main-grid');
          await el.screenshot({ path: path.join(folder, `ews-peta-${tema}-${lebar}.png`) });
        }
      }
      ok(`(6) tiada ralat konsol @${lebar}`, masalah.length === 0, masalah);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (gagal.length) {
    console.error('GAGAL:\n' + gagal.join('\n'));
    process.exitCode = 1;
  } else console.log('ews-ai: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

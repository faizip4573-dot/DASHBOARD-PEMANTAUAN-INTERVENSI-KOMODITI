'use strict';
// Ujian unit banjir (normalisasi, tapis, dedupe, risiko PO, senario) dan endpoint /api/banjir.
// Tiada rangkaian luar. Jalankan dari root: node tests/api/banjir-api.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const banjir = require('../../api/_services/banjir.js');
const util = require('../../api/_services/util-rangkaian.js');
const { buatFixtureBanjir, pasangCacheBanjir } = require('../helpers/banjir-fixture.js');

const DIR = path.join(__dirname, '..', 'fixtures');
const baca = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
const NAS = '2026-11-17T04:30:00.000Z'; // 12:30 MYT
const SEL = '2026-11-17T07:10:00.000Z'; // 15:10 MYT

function get(base, p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Baris mentah JSON nasional (kekunci pendek).
const raw = (o = {}) => ({
  a: '1',
  b: 'Stesen Ujian',
  c: '3.0',
  d: '101.0',
  e: 'Daerah',
  f: 'SELANGOR',
  g: 'Sg. Ujian',
  i: 'RF,WL',
  m: '5.5',
  n: 'Normal',
  o: '5.0',
  q: '17/11/2026 11:45',
  s: 'No Change',
  u: '0',
  v: '0',
  w: '0',
  x: 'No Rainfall',
  y: '17/11/2026 11:45',
  ...o,
});
// Rekod ternormal sintetik untuk terbitPO.
const stesen = (o = {}) => ({
  id: 'jps:s',
  nama: 'S',
  negeri: 'Selangor',
  daerah: '',
  sungai: 'Sg. S',
  lat: 3.0,
  lon: 101.0,
  jenis: 'WL',
  parasAir: 1,
  statusRasmi: 'Normal',
  trend: null,
  hujan1j: null,
  hujan3j: null,
  hujanHariIni: null,
  kategoriHujan: null,
  masaBacaan: '2026-11-17T11:45:00+08:00',
  masaHujan: null,
  sumber: banjir.SUMBER_NASIONAL,
  ...o,
});
const PO = (o = {}) => ({ id: 'p', nama: 'PO P', negeri: 'Selangor', lat: 3.0, lon: 101.0, ...o });
const DLAT = 25 / ((6371 * Math.PI) / 180); // ~25 km ke utara

function risiko(stesenWL, opts = {}) {
  const { stesenHujan = [], amaran = [], sejarah = [], po = PO(), radiusKm } = opts;
  return banjir.terbitPO({ stesenWL, stesenHujan, amaran, sejarah, poList: [po], radiusKm })[0];
}

(async () => {
  const gagal = [];
  const ok = (nama, fn) => {
    try {
      fn();
    } catch (e) {
      gagal.push(nama + ': ' + e.message);
    }
  };

  /* --- util --- */
  ok('parseMasaMYT', () => {
    assert.equal(util.parseMasaMYT('17/11/2026 11:45'), '2026-11-17T11:45:00+08:00');
    assert.equal(util.parseMasaMYT('2026-11-17T12:00:00'), '2026-11-17T12:00:00+08:00');
    assert.equal(util.parseMasaMYT('2026-11-17T04:00:00Z'), '2026-11-17T12:00:00+08:00');
    assert.equal(util.parseMasaMYT(1794916800000), '2026-11-17T12:00:00+08:00');
    assert.equal(util.parseMasaMYT(''), null);
    assert.equal(util.parseMasaMYT('bukan tarikh'), null);
    assert.equal(util.parseMasaMYT('31/02/2026 10:00'), null);
  });
  ok('haversineKm', () => {
    assert.ok(Math.abs(util.haversineKm(3, 101, 3 + DLAT, 101) - 25) < 0.01);
    assert.equal(util.haversineKm(3, 101, 3, 101), 0);
  });

  /* --- tapis dan normalisasi nasional --- */
  ok('WL lapuk tetapi hujan segar -> rekod kekal tanpa paras', () => {
    const r = banjir.normalisasiNasional([raw({ q: '17/11/2026 06:00' })], NAS);
    assert.equal(r.length, 1);
    assert.equal(r[0].parasAir, null);
    assert.equal(r[0].statusRasmi, null);
    assert.ok(r[0].masaHujan);
  });
  ok('WL dan hujan lapuk -> dibuang', () => {
    const r = banjir.normalisasiNasional(
      [raw({ q: '17/11/2026 06:00', y: '17/11/2026 06:00' })],
      NAS,
    );
    assert.equal(r.length, 0);
  });
  ok('sempadan 3 jam (09:30 segar, 09:29 lapuk)', () => {
    const a = banjir.normalisasiNasional([raw({ q: '17/11/2026 09:30', y: '' })], NAS);
    const b = banjir.normalisasiNasional([raw({ q: '17/11/2026 09:29', y: '' })], NAS);
    assert.equal(a.length, 1);
    assert.equal(b.length, 0);
  });
  ok('sekarang dihantar masuk: sama data, masa lain -> hasil lain', () => {
    const r = [raw({ y: '' })];
    assert.equal(banjir.normalisasiNasional(r, NAS).length, 1);
    assert.equal(banjir.normalisasiNasional(r, '2026-11-18T04:30:00.000Z').length, 0);
  });
  ok('Danger palsu (o<=0 / bukan nombor) dibuang; Danger sah kekal', () => {
    const n = (o) => banjir.normalisasiNasional([raw({ n: 'Danger', y: '', ...o })], NAS);
    assert.equal(n({ o: '0' }).length, 0);
    assert.equal(n({ o: '-1' }).length, 0);
    assert.equal(n({ o: '' }).length, 0);
    assert.equal(n({ o: 'x' }).length, 0);
    const sah = n({ o: '19.1' });
    assert.equal(sah.length, 1);
    assert.equal(sah[0].statusRasmi, 'Bahaya');
  });
  ok('Error, kosong dan -9999 dibuang sebagai paras air', () => {
    [{ n: 'Error' }, { n: '' }, { m: '-9999' }, { m: '' }, { m: 'abc' }].forEach((o) => {
      const r = banjir.normalisasiNasional([raw({ y: '', ...o })], NAS);
      assert.equal(r.length, 0, JSON.stringify(o));
    });
  });
  ok('peta status nasional 4 aras', () => {
    const peta = { Normal: 'Normal', Alert: 'Waspada', Warning: 'Amaran', Danger: 'Bahaya' };
    Object.entries(peta).forEach(([n, bm]) => {
      const r = banjir.normalisasiNasional([raw({ n, y: '' })], NAS);
      assert.equal(r[0].statusRasmi, bm);
    });
  });
  ok('trend dan kategori hujan BM', () => {
    const t = { Rising: 'Naik', Receding: 'Surut', 'No Change': 'Tetap' };
    Object.entries(t).forEach(([s, bm]) => {
      assert.equal(banjir.normalisasiNasional([raw({ s, y: '' })], NAS)[0].trend, bm);
    });
    assert.equal(banjir.normalisasiNasional([raw({ s: '', y: '' })], NAS)[0].trend, null);
    const k = {
      'No Rainfall': 'Tiada hujan',
      Light: 'Ringan',
      Moderate: 'Sederhana',
      Heavy: 'Lebat',
      'Very Heavy': 'Sangat lebat',
    };
    Object.entries(k).forEach(([x, bm]) => {
      assert.equal(banjir.normalisasiNasional([raw({ x })], NAS)[0].kategoriHujan, bm);
    });
    assert.equal(banjir.normalisasiNasional([raw({ x: 'ERROR', m: '', n: '' })], NAS).length, 0);
  });
  ok('negeri di-trim dan dinormal', () => {
    const f = (v) => banjir.normalisasiNasional([raw({ f: v, y: '' })], NAS)[0].negeri;
    assert.equal(f('WILAYAH PERSEKUTUAN KUALA LUMPUR '), 'Kuala Lumpur');
    assert.equal(f('WILAYAH PERSEKUTUAN PUTRAJAYA'), 'Putrajaya');
    assert.equal(f('PULAU PINANG'), 'Pulau Pinang');
    assert.equal(f(' NEGERI SEMBILAN '), 'Negeri Sembilan');
  });
  ok('koordinat bukan nombor dibuang', () => {
    assert.equal(banjir.normalisasiNasional([raw({ c: 'x' })], NAS).length, 0);
    assert.equal(banjir.normalisasiNasional('bukan senarai', NAS).length, 0);
  });
  ok('fixture nasional sebenar', () => {
    const r = banjir.normalisasiNasional(baca('jps-nasional.json'), NAS);
    const nama = (re) => r.find((x) => re.test(x.nama));
    assert.equal(nama(/Duyong/).statusRasmi, 'Amaran');
    assert.equal(nama(/Duyong/).negeri, 'Melaka');
    assert.equal(nama(/Bukit Merah/).statusRasmi, 'Bahaya');
    assert.equal(nama(/Batu 12, Hulu Langat/).statusRasmi, 'Waspada');
    assert.equal(nama(/Meligan/).parasAir, null, 'Danger palsu Sabah: paras dibuang');
    assert.ok(!nama(/Bernam di Jambatan S\.K\.C/), 'Danger lapuk (16/11) mesti dibuang');
    assert.ok(!nama(/Teluk Buing/), 'status Error mesti dibuang');
    assert.ok(!nama(/Buan Bidi/), 'bacaan 2025 mesti dibuang');
    assert.equal(nama(/Maludam/).parasAir, null, 'RF-sahaja kekal tanpa paras');
    assert.equal(nama(/hujan lebat, disunting/).kategoriHujan, 'Lebat');
    const lapuk = nama(/WL lapuk/);
    assert.equal(lapuk.parasAir, null);
    assert.ok(lapuk.masaHujan);
    assert.ok(r.some((x) => x.negeri === 'Kuala Lumpur'));
    assert.ok(r.every((x) => !/\s$/.test(x.negeri)));
  });

  /* --- Selangor --- */
  ok('peta status Selangor 0/1/2/3 dan trend', () => {
    const baris = (st, o = {}) => ({
      id: 7,
      stationName: 'STESEN SEL',
      districtName: 'KLANG',
      mainRiverBasin: 'SG. KLANG',
      latitude: '3.0',
      longitude: '101.0',
      dateTime: '2026-11-17T15:00:00',
      waterLevel1: 3.2,
      waterLevel1Status: st,
      waterLevel1MessageEnglish: '<b>Water Level: </b>3.2m - X<br />Trend: <b>Rising</b> (Date: 1)',
      hourlyRainfall: null,
      ...o,
    });
    const bm = ['Normal', 'Waspada', 'Amaran', 'Bahaya'];
    bm.forEach((s, i) => {
      const r = banjir.normalisasiSelangor([baris(i)], SEL);
      assert.equal(r[0].statusRasmi, s);
      assert.equal(r[0].trend, 'Naik');
      assert.equal(r[0].negeri, 'Selangor');
      assert.equal(r[0].sungai, 'Sg. Klang');
    });
    assert.equal(banjir.normalisasiSelangor([baris(null, { waterLevel1: null })], SEL).length, 0);
    assert.equal(
      banjir.normalisasiSelangor([baris(1, { dateTime: '2026-11-17T10:00:00' })], SEL).length,
      0,
    );
  });
  ok('fixture Selangor: RF-sahaja dan Waspada', () => {
    const r = banjir.normalisasiSelangor(baca('jps-selangor-telemetry.json'), SEL);
    assert.equal(r.length, 6);
    const rf = r.find((x) => x.jenis === 'RF');
    assert.ok(rf && rf.parasAir === null && rf.hujan1j > 0);
    const b12 = r.find((x) => /Batu 12/.test(x.nama));
    assert.equal(b12.statusRasmi, 'Waspada');
    assert.equal(b12.trend, 'Surut');
    assert.ok(r.some((x) => x.statusRasmi === 'Bahaya'));
    assert.ok(r.some((x) => x.statusRasmi === 'Amaran'));
  });

  /* --- dedupe --- */
  ok('dedupe: padan ikut id (Selangor menang)', () => {
    const n = [stesen({ id: 'jps:160', nama: 'Nama Lain', statusRasmi: 'Normal' })];
    const s = [stesen({ id: 'sel:160', nama: 'Berbeza', statusRasmi: 'Bahaya', lat: 3.5 })];
    const g = banjir.gabungStesen(n, s);
    assert.equal(g.length, 1);
    assert.equal(g[0].id, 'sel:160');
    assert.equal(g[0].statusRasmi, 'Bahaya');
  });
  ok('dedupe: padan ikut nama dan < 1 km', () => {
    const n = [stesen({ id: 'jps:A', nama: 'Batu 12, Hulu Langat (F2)', lat: 3.0, lon: 101.0 })];
    const s = [stesen({ id: 'sel:9', nama: 'BATU 12 HULU LANGAT (F2)', lat: 3.003, lon: 101.0 })];
    const g = banjir.gabungStesen(n, s);
    assert.deepEqual(
      g.map((x) => x.id),
      ['sel:9'],
    );
  });
  ok('dedupe: nama sama tetapi jauh -> kedua-duanya kekal', () => {
    const n = [stesen({ id: 'jps:A', nama: 'Kolam Utama', lat: 3.0 })];
    const s = [stesen({ id: 'sel:9', nama: 'Kolam Utama', lat: 3.1 })];
    assert.equal(banjir.gabungStesen(n, s).length, 2);
  });
  ok('dedupe: nama berbeza dan dekat -> kedua-duanya kekal', () => {
    const n = [stesen({ id: 'jps:A', nama: 'Satu' })];
    const s = [stesen({ id: 'sel:9', nama: 'Dua' })];
    assert.equal(banjir.gabungStesen(n, s).length, 2);
  });
  ok('dedupe fixture sebenar: Batu 12 Hulu Langat sekali sahaja, menggunakan Selangor', () => {
    const n = banjir.normalisasiNasional(baca('jps-nasional.json'), NAS);
    const s = banjir.normalisasiSelangor(baca('jps-selangor-telemetry.json'), SEL);
    const g = banjir.gabungStesen(n, s);
    const b12 = g.filter((x) => /Batu 12,? Hulu Langat/i.test(x.nama));
    assert.equal(b12.length, 1);
    assert.equal(b12[0].sumber, banjir.SUMBER_SELANGOR);
    assert.equal(g.length, n.length + s.length - 1);
  });

  /* --- risiko PO: empat aras --- */
  ok('Tinggi: stesen Bahaya dalam radius', () => {
    const r = risiko([stesen({ statusRasmi: 'Bahaya', lat: 3.05 })]);
    assert.equal(r.risikoBanjir, 'Tinggi');
    assert.equal(r.statusTerburuk, 'Bahaya');
    assert.equal(r.bilanganAmaranBahaya, 1);
    assert.match(r.sebab[0], /Bahaya/);
  });
  ok('Tinggi: stesen Amaran dalam radius', () => {
    assert.equal(risiko([stesen({ statusRasmi: 'Amaran' })]).risikoBanjir, 'Tinggi');
  });
  ok('Tinggi: amaran rasmi menyebut negeri PO walaupun tiada stesen', () => {
    const r = risiko([], { amaran: [{ negeri: ['Selangor'] }] });
    assert.equal(r.risikoBanjir, 'Tinggi');
    assert.equal(r.amaranRasmiNegeri, true);
  });
  ok('Sederhana: stesen Waspada', () => {
    assert.equal(risiko([stesen({ statusRasmi: 'Waspada' })]).risikoBanjir, 'Sederhana');
  });
  ok('Sederhana: hujan Lebat/Sangat lebat dalam radius', () => {
    const wl = [stesen()];
    const rf = (k, o = {}) =>
      stesen({ id: 'jps:r', kategoriHujan: k, hujanHariIni: 70, masaHujan: 'x', ...o });
    const lebat = risiko(wl, { stesenHujan: [rf('Lebat')] });
    assert.equal(lebat.risikoBanjir, 'Sederhana');
    assert.equal(lebat.hujan.kategoriTertinggi, 'Lebat');
    assert.equal(lebat.hujan.maksHariIniMm, 70);
    assert.equal(
      risiko(wl, { stesenHujan: [rf('Sangat lebat')] }).hujan.kategoriTertinggi,
      'Sangat lebat',
    );
    assert.equal(risiko(wl, { stesenHujan: [rf('Sederhana')] }).risikoBanjir, 'Rendah');
    assert.equal(risiko(wl, { stesenHujan: [rf('Lebat', { lat: 4 })] }).risikoBanjir, 'Rendah');
  });
  ok('Rendah: semua Normal', () => {
    const r = risiko([stesen(), stesen({ id: 'jps:t', lat: 3.02 })]);
    assert.equal(r.risikoBanjir, 'Rendah');
    assert.equal(r.bilanganStesen, 2);
    assert.deepEqual(r.sebab, []);
  });
  ok('Tiada data: tiada stesen WL sah dalam radius', () => {
    const r = risiko([]);
    assert.equal(r.risikoBanjir, 'Tiada data');
    assert.equal(r.statusTerburuk, null);
    assert.equal(risiko([stesen({ lat: 4 })]).risikoBanjir, 'Tiada data');
  });
  ok('turutan: Tinggi mengatasi Tiada data; Tiada data mengatasi hujan lebat', () => {
    assert.equal(risiko([], { amaran: [{ negeri: ['Selangor'] }] }).risikoBanjir, 'Tinggi');
    const rf = stesen({ kategoriHujan: 'Lebat', hujanHariIni: 80, masaHujan: 'x' });
    assert.equal(risiko([], { stesenHujan: [rf] }).risikoBanjir, 'Tiada data');
  });
  ok('radius: tepat sempadan dikira, di luar tidak', () => {
    const s = stesen({ statusRasmi: 'Bahaya', lat: 3.0 + DLAT });
    const jarak = util.haversineKm(3, 101, s.lat, s.lon);
    assert.equal(risiko([s], { radiusKm: jarak }).risikoBanjir, 'Tinggi');
    assert.equal(risiko([s], { radiusKm: jarak - 0.001 }).risikoBanjir, 'Tiada data');
    assert.equal(risiko([{ ...s, lat: 3.0 + DLAT * 0.999 }]).risikoBanjir, 'Tinggi', '25 km lalai');
    assert.equal(
      risiko([stesen({ statusRasmi: 'Bahaya', lat: 3.0 + DLAT * 1.02 })]).risikoBanjir,
      'Tiada data',
    );
  });
  ok('BANJIR_RADIUS_KM boleh diubah', () => {
    const asal = process.env.BANJIR_RADIUS_KM;
    try {
      const s = stesen({ statusRasmi: 'Bahaya', lat: 3.09 }); // ~10 km
      process.env.BANJIR_RADIUS_KM = '5';
      assert.equal(risiko([s]).risikoBanjir, 'Tiada data');
      process.env.BANJIR_RADIUS_KM = '15';
      assert.equal(risiko([s]).risikoBanjir, 'Tinggi');
      delete process.env.BANJIR_RADIUS_KM;
      assert.equal(risiko([s]).risikoBanjir, 'Tinggi');
    } finally {
      if (asal === undefined) delete process.env.BANJIR_RADIUS_KM;
      else process.env.BANJIR_RADIUS_KM = asal;
    }
  });
  ok('stesenTerdekat: Waspada+ dahulu, Normal terdekat, maks 8, tersusun', () => {
    const wl = [];
    for (let i = 0; i < 6; i++)
      wl.push(stesen({ id: 'jps:n' + i, nama: 'N' + i, lat: 3 + 0.01 * (i + 1) }));
    wl.push(stesen({ id: 'jps:w', nama: 'W', statusRasmi: 'Waspada', lat: 3.15 }));
    wl.push(stesen({ id: 'jps:b', nama: 'B', statusRasmi: 'Bahaya', lat: 3.2 }));
    const t = risiko(wl).stesenTerdekat;
    assert.ok(t.length <= 8);
    assert.deepEqual(
      t.slice(0, 2).map((x) => x.id),
      ['jps:b', 'jps:w'],
    );
    assert.equal(t[2].id, 'jps:n0');
    assert.ok(t.every((x) => typeof x.jarakKm === 'number'));
  });
  ok('sejarah2024: hanya PO Selangor dalam 10 km', () => {
    const h = [
      { nama: 'A', lat: 3.045, lon: 101.0 },
      { nama: 'B', lat: 3.5, lon: 101.0 },
    ];
    const sel = risiko([stesen()], { sejarah: h });
    assert.deepEqual(sel.sejarah2024, { bilangan: 1, terdekatKm: 5, label: 'Sejarah 2024' });
    assert.equal(
      risiko([stesen({ negeri: 'Johor' })], { sejarah: h, po: PO({ negeri: 'Johor' }) })
        .sejarah2024,
      null,
    );
    assert.equal(risiko([stesen()], { sejarah: [h[1]] }).sejarah2024, null);
  });

  /* --- amaran rasmi --- */
  const AMARAN_NOW = '2026-11-17T04:30:00.000Z';
  ok('amaran: [] dan format luar jangka -> []', () => {
    assert.deepEqual(banjir.normalisasiAmaran([], AMARAN_NOW), []);
    assert.deepEqual(banjir.normalisasiAmaran(null, AMARAN_NOW), []);
    assert.deepEqual(banjir.normalisasiAmaran({ a: 1 }, AMARAN_NOW), []);
  });
  ok('amaran fixture: negeri dikesan, tamat lampau dibuang, tanpa negeri kekal', () => {
    const a = banjir.normalisasiAmaran(baca('getdisse-sintetik.json'), AMARAN_NOW);
    assert.equal(a.length, 2);
    assert.deepEqual(a[0].negeri, ['Kelantan', 'Terengganu']);
    assert.equal(a[0].dikeluarkan, '2026-11-17T08:00:00+08:00');
    assert.equal(a[0].anggaranTamat, '2026-11-19T20:00:00+08:00');
    assert.equal(a[0].sumber, banjir.SUMBER_NASIONAL);
    assert.deepEqual(a[1].negeri, []);
    assert.ok(!a.some((x) => /Pahang/.test(x.mesej)));
  });
  ok('amaran: sejarah 7 hari (dilihat, aktif/tamat, buang >7 hari, tiada rekaan)', () => {
    const N = new Date('2026-11-17T05:00:00Z');
    const a = { mesej: 'Banjir A', dikeluarkan: '2026-11-17T10:00:00+08:00', negeri: ['Kelantan'] };
    const h1 = banjir.gabungSejarahAmaran([], [a], N);
    assert.equal(h1.length, 1);
    assert.equal(h1[0].aktif, true);
    assert.equal(h1[0].dilihat, N.toISOString());
    // amaran hilang daripada sumber semasa: kekal dalam sejarah sebagai tamat, dilihat kekal
    const h2 = banjir.gabungSejarahAmaran(h1, [], new Date('2026-11-19T05:00:00Z'));
    assert.equal(h2.length, 1);
    assert.equal(h2[0].aktif, false);
    assert.equal(h2[0].dilihat, N.toISOString());
    // lebih 7 hari dibuang
    assert.equal(banjir.gabungSejarahAmaran(h1, [], new Date('2026-11-30T05:00:00Z')).length, 0);
    // tiada pendua
    assert.equal(banjir.gabungSejarahAmaran(h1, [a], N).length, 1);
  });
  ok('amaran: mesej dipotong 600 aksara dan HTML dibuang', () => {
    const a = banjir.normalisasiAmaran(
      [{ Message: '<b>Amaran</b> ' + 'x'.repeat(900), MessageDT: '17/11/2026 08:00' }],
      AMARAN_NOW,
    );
    assert.equal(a[0].mesej.length, 600);
    assert.ok(!/</.test(a[0].mesej));
  });
  ok('amaran: medan teks tidak dikenali tetap dikesan; tanpa teks dibuang', () => {
    const a = banjir.normalisasiAmaran(
      [
        { Aneh: 'Banjir besar di Pahang dijangka', MessageDT: '17/11/2026 08:00' },
        { MessageDT: '17/11/2026 08:00' },
      ],
      AMARAN_NOW,
    );
    assert.equal(a.length, 1);
    assert.deepEqual(a[0].negeri, ['Pahang']);
  });
  ok('amaran rasmi tanpa negeri tidak menaikkan risiko PO', () => {
    const tanpa = [{ negeri: [] }];
    assert.equal(risiko([stesen()], { amaran: tanpa }).risikoBanjir, 'Rendah');
    assert.equal(risiko([], { amaran: tanpa }).risikoBanjir, 'Tiada data');
    assert.equal(risiko([stesen()], { amaran: [{ negeri: ['Johor'] }] }).risikoBanjir, 'Rendah');
  });

  /* --- sejarah --- */
  ok('normalisasiSejarah: lat/lon rentetan dengan ruang/tab', () => {
    const s = banjir.normalisasiSejarah(baca('arcgis-banjir2024.json'));
    assert.equal(s.length, 10);
    assert.ok(s.every((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)));
    const rosak = banjir.normalisasiSejarah({
      features: [
        { attributes: { kawasan_banjir: 'A', latitude: ' 3.5\t', longitude: '101.5 ' } },
        { attributes: { kawasan_banjir: 'B', latitude: 'x', longitude: '101' } },
        {},
      ],
    });
    assert.equal(rosak.length, 1);
    assert.equal(rosak[0].lat, 3.5);
    assert.deepEqual(banjir.normalisasiSejarah(null), []);
  });

  /* --- senario --- */
  const SKRG = '2026-11-17T04:30:00.000Z';
  const senarioDari = (wl, amaran = []) => {
    const po = banjir.terbitPO({
      stesenWL: wl,
      stesenHujan: [],
      amaran,
      poList: [PO(), PO({ id: 'q', nama: 'PO Q', negeri: 'Johor', lat: 1.5, lon: 103.7 })],
    });
    return banjir.bangunSenarioBanjir({ po, sekarang: SKRG });
  };
  ok('senario: tiada bila semua Normal, Waspada atau amaran rasmi tanpa negeri', () => {
    assert.deepEqual(senarioDari([stesen()]), []);
    assert.deepEqual(senarioDari([stesen({ statusRasmi: 'Waspada' })]), []);
    assert.deepEqual(senarioDari([stesen()], [{ negeri: [] }]), []);
    assert.deepEqual(senarioDari([]), []);
  });
  ok('senario: Amaran -> sederhana; Bahaya -> tinggi; rasmi dan sumber JPS', () => {
    const a = senarioDari([stesen({ statusRasmi: 'Amaran' })]);
    assert.equal(a.length, 1);
    assert.equal(a[0].warningType, 'amaran_banjir');
    assert.equal(a[0].scenarioName, 'Risiko Banjir');
    assert.equal(a[0].dataStatus, 'rasmi');
    assert.equal(a[0].anggaran, true);
    assert.match(a[0].source, /JPS/);
    assert.equal(a[0].riskLevel, 'sederhana');
    assert.deepEqual(a[0].affectedPOIds, ['p']);
    assert.deepEqual(a[0].affectedStates, ['Selangor']);
    assert.equal(a[0].validFrom, SKRG);
    assert.equal(a[0].validUntil, '2026-11-17T07:30:00.000Z');
    assert.equal(a[0].rincian[0].poId, 'p');
    assert.equal(a[0].rincian[0].stesen[0].statusRasmi, 'Amaran');
    assert.match(a[0].ringkasan, /bukan amaran rasmi/);
    const b = senarioDari([stesen({ statusRasmi: 'Bahaya' })]);
    assert.equal(b[0].riskLevel, 'tinggi');
  });
  ok('senario: amaran rasmi negeri tanpa stesen -> tinggi', () => {
    const s = senarioDari([], [{ negeri: ['Johor'] }]);
    assert.equal(s.length, 1);
    assert.equal(s[0].riskLevel, 'tinggi');
    assert.deepEqual(s[0].affectedPOIds, ['q']);
  });
  ok('senario: sumber menyebut JPS Selangor bila stesen Selangor terlibat', () => {
    const s = senarioDari([stesen({ statusRasmi: 'Amaran', sumber: banjir.SUMBER_SELANGOR })]);
    assert.match(s[0].source, /JPS Selangor/);
    assert.match(s[0].source, /JPS Malaysia/);
  });
  ok('senario: deterministik', () => {
    const wl = [stesen({ statusRasmi: 'Amaran' })];
    assert.equal(JSON.stringify(senarioDari(wl)), JSON.stringify(senarioDari(wl)));
  });

  /* --- fixture helper (cache lengkap) --- */
  ok('buatFixtureBanjir: normal -> tiada senario, 15 PO, tiada Tinggi', () => {
    const f = buatFixtureBanjir();
    assert.equal(f.po.length, 15);
    assert.deepEqual(f.senario, []);
    assert.ok(f.po.every((p) => p.risikoBanjir !== 'Tinggi'));
    assert.ok(f.stesen.every((s) => s.statusRasmi === 'Normal' && s.parasAir != null));
    assert.ok(f.po.some((p) => p.risikoBanjir === 'Rendah'));
    assert.equal(f.radiusKm, 25);
    assert.match(f.atribusi, /bukan amaran rasmi/);
  });
  ok('buatFixtureBanjir: amaran/bahaya -> senario Melaka', () => {
    const a = buatFixtureBanjir({ tahap: 'amaran' });
    assert.equal(a.senario.length, 1);
    assert.deepEqual(a.senario[0].affectedPOIds, ['melaka']);
    assert.equal(a.senario[0].riskLevel, 'sederhana');
    assert.equal(a.po.find((p) => p.poId === 'melaka').risikoBanjir, 'Tinggi');
    const b = buatFixtureBanjir({ tahap: 'bahaya' });
    assert.equal(b.senario[0].riskLevel, 'tinggi');
  });
  ok('buatFixtureBanjir: amaran rasmi, umurJam dan masa dianjak', () => {
    const f = buatFixtureBanjir({ amaranRasmi: true, umurJam: 5, sumberGagal: ['amaranJps'] });
    assert.equal(f.amaran.length, 2);
    assert.equal(f.po.find((p) => p.poId === 'kelantan').risikoBanjir, 'Tinggi');
    assert.equal(f.po.find((p) => p.poId === 'terengganu').risikoBanjir, 'Tinggi');
    assert.equal(f.senario.length, 1);
    assert.equal(f.sumber.amaranJps.status, 'gagal');
    const umur = (Date.now() - Date.parse(f.fetchedAt)) / 36e5;
    assert.ok(Math.abs(umur - 5) < 0.1);
    assert.ok(f.stesen.every((s) => Date.now() - Date.parse(s.masaBacaan) < 8.1 * 36e5));
  });
  ok('cache tiada medan rahsia', () => {
    const t = JSON.stringify(buatFixtureBanjir({ tahap: 'bahaya', amaranRasmi: true }));
    assert.ok(!/token|apikey|authorization|password/i.test(t));
  });

  /* --- API --- */
  const server = require('../../api/_server.js');
  const fixtureFile = pasangCacheBanjir();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await get(base, '/api/banjir');
    ok('/api/banjir 200 JSON dengan umurJam', () => {
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /application\/json/);
      const j = JSON.parse(r.body);
      assert.ok(j.sumber && j.sumber.jpsNasional && j.sumber.jpsSelangor);
      assert.ok(Array.isArray(j.stesen) && j.stesen.length > 10);
      assert.equal(j.po.length, 15);
      assert.ok(Array.isArray(j.senario));
      assert.equal(typeof j.umurJam, 'number');
    });
    ok('tiada medan rahsia dalam respons', () => {
      assert.ok(!/token|authorization|password|api[_-]?key/i.test(r.body));
    });
    const h = await get(base, '/api/banjir', 'HEAD');
    ok('HEAD 200 tanpa badan', () => {
      assert.equal(h.status, 200);
      assert.equal(h.body, '');
    });
    const p = await get(base, '/api/banjir', 'POST');
    ok('POST ditolak 405', () => assert.equal(p.status, 405));
    const d = await get(base, '/data/processed/banjir-terkini.json');
    ok('/data/processed 404', () => assert.equal(d.status, 404));
    const d2 = await get(base, '/data/processed/banjir-sejarah.json');
    ok('/data/processed sejarah 404', () => assert.equal(d2.status, 404));

    fs.unlinkSync(fixtureFile);
    const tiada = await get(base, '/api/banjir');
    ok('cache tiada -> 503', () => {
      assert.equal(tiada.status, 503);
      const j = JSON.parse(tiada.body);
      assert.ok(j.ralat);
      assert.equal(typeof j.sedangDikemaskini, 'boolean');
    });
  } finally {
    server.close();
    fs.rmSync(path.dirname(fixtureFile), { recursive: true, force: true });
  }

  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian API banjir lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

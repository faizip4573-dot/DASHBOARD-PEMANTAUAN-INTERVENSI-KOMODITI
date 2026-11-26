'use strict';
// Ujian unit IPU (jalur, masa, gabung peta+jam, PO terdekat) dan endpoint /api/kualiti-udara.
// Tiada rangkaian luar. Jalankan dari root: node tests/api/ipu-api.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const ipu = require('../../api/_services/kualiti-udara.js');
const util = require('../../api/_services/util-rangkaian.js');
const { muatPO } = require('../../api/_services/cuaca.js');
const { buatFixtureIPU, pasangCacheIPU } = require('../helpers/banjir-fixture.js');

const DIR = path.join(__dirname, '..', 'fixtures');
const baca = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
const SEKARANG = '2026-11-17T06:30:00.000Z'; // 14:30 MYT

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

const siriJam = (nilai, mulaJam = 10) =>
  nilai.map((api, i) => ({
    t: `2026-11-17T${String(mulaJam + i).padStart(2, '0')}:00:00+08:00`,
    api,
  }));
const jam = (id, siri, o = {}) => ({
  id,
  nama: id,
  negeri: 'Selangor',
  lat: 3,
  lon: 101,
  siri,
  ...o,
});
const peta = (id, o = {}) => ({
  id,
  nama: id,
  negeri: 'Selangor',
  lat: 3,
  lon: 101,
  kategori: 'Urban',
  api: null,
  pencemar: null,
  masa: null,
  ...o,
});
const PO1 = { id: 'p', nama: 'PO P', negeri: 'Selangor', lat: 3, lon: 101 };

(async () => {
  delete process.env.IPU_STALE_JAM;
  const gagal = [];
  const ok = (nama, fn) => {
    try {
      fn();
    } catch (e) {
      gagal.push(nama + ': ' + e.message);
    }
  };

  ok('bandIPU sempadan jalur', () => {
    const b = (n) => ipu.bandIPU(n).band;
    assert.equal(b(0), 'baik');
    assert.equal(b(50), 'baik');
    assert.equal(b(51), 'sederhana');
    assert.equal(b(100), 'sederhana');
    assert.equal(b(101), 'tidak_sihat');
    assert.equal(b(200), 'tidak_sihat');
    assert.equal(b(201), 'sangat_tidak_sihat');
    assert.equal(b(300), 'sangat_tidak_sihat');
    assert.equal(b(301), 'berbahaya');
    assert.equal(b(null), 'tiada_data');
    assert.equal(b(undefined), 'tiada_data');
    assert.equal(b(''), 'tiada_data');
    assert.equal(b(-1), 'tiada_data');
    assert.equal(ipu.bandIPU(150).bandLabel, 'Tidak Sihat');
    assert.equal(ipu.bandIPU(250).bandLabel, 'Sangat Tidak Sihat');
    assert.equal(ipu.bandIPU(null).bandLabel, 'Tiada data');
  });

  ok('epoch tempatan-sebagai-UTC -> +08:00 (tanpa tambah 8 jam)', () => {
    assert.equal(util.parseMasaMYT(1794916800000), '2026-11-17T12:00:00+08:00');
    const p = ipu.normalisasiPeta({
      features: [
        {
          attributes: {
            STATION_ID: 'X',
            LATITUDE: 3,
            LONGITUDE: 101,
            DATETIME: 1794916800000,
            API: 44,
          },
        },
      ],
    });
    assert.equal(p[0].masa, '2026-11-17T12:00:00+08:00');
  });

  ok('normalisasiPeta fixture: 15 stesen, API null dikekalkan', () => {
    const p = ipu.normalisasiPeta(baca('ipu-peta.json'));
    assert.equal(p.length, 15);
    const larkin = p.find((x) => x.id === 'CA33J');
    assert.equal(larkin.api, null);
    assert.equal(p.find((x) => x.id === 'CA01R').nama, 'Kangar');
    assert.equal(p.find((x) => x.id === 'CA01R').negeri, 'Perlis');
    assert.equal(p.find((x) => x.id === 'CA15W').negeri, 'WP Kuala Lumpur');
    assert.deepEqual(ipu.normalisasiPeta(null), []);
  });

  ok('normalisasiJam fixture: siri tersusun, API null dibuang', () => {
    const j = ipu.normalisasiJam(baca('ipu-jam.json'));
    assert.equal(j.length, 15);
    j.forEach((s) => {
      assert.equal(s.siri.length, 24);
      for (let i = 1; i < s.siri.length; i++) assert.ok(s.siri[i - 1].t < s.siri[i].t);
    });
    assert.equal(
      ipu.normalisasiJam([{ STATION_ID: 'A', DATETIME: '2026-11-17T10:00:00', API: null }])[0].siri
        .length,
      0,
    );
  });

  ok('stesen API null pada peta diisi daripada jam', () => {
    const p = ipu.normalisasiPeta(baca('ipu-peta.json'));
    const j = ipu.normalisasiJam(baca('ipu-jam.json'));
    const s = ipu.gabungStesenIPU(p, j, SEKARANG);
    assert.equal(s.length, 15);
    ['CA33J', 'CA44T'].forEach((id) => {
      const x = s.find((y) => y.id === id);
      const siri = j.find((y) => y.id === id).siri;
      assert.equal(x.api, siri[siri.length - 1].api);
      assert.notEqual(x.band, 'tiada_data');
      assert.equal(x.masaBacaan, siri[siri.length - 1].t);
      assert.equal(x.sejarah24j.length, 24);
    });
  });

  ok('peta sahaja (tiada jam): bacaan peta digunakan', () => {
    const s = ipu.gabungStesenIPU(
      [peta('A', { api: 44, masa: '2026-11-17T14:00:00+08:00' })],
      [],
      SEKARANG,
    );
    assert.equal(s[0].api, 44);
    assert.equal(s[0].band, 'baik');
  });

  ok('stesen tanpa sebarang bacaan -> tiada_data, bukan lapuk', () => {
    const s = ipu.gabungStesenIPU([peta('A')], [jam('A', [])], SEKARANG)[0];
    assert.equal(s.api, null);
    assert.equal(s.band, 'tiada_data');
    assert.equal(s.lapuk, false);
    assert.equal(s.trend, null);
  });

  ok('pencemar dominan hanya bila masa peta sepadan bacaan terkini', () => {
    const sama = ipu.gabungStesenIPU(
      [peta('A', { pencemar: 'PM2.5', masa: '2026-11-17T14:00:00+08:00' })],
      [jam('A', siriJam([40, 42, 44, 46, 48], 10))],
      SEKARANG,
    )[0];
    assert.equal(sama.pencemar, 'PM2.5');
    const beza = ipu.gabungStesenIPU(
      [peta('A', { pencemar: 'PM2.5', masa: '2026-11-17T13:00:00+08:00' })],
      [jam('A', siriJam([40, 42, 44, 46, 48], 10))],
      SEKARANG,
    )[0];
    assert.equal(beza.pencemar, null);
  });

  ok('lapuk > IPU_STALE_JAM (3 j), sempadan tepat 3 j tidak lapuk', () => {
    const baru = (sekarang) =>
      ipu.gabungStesenIPU(
        [peta('A')],
        [jam('A', [{ t: '2026-11-17T12:00:00+08:00', api: 40 }])],
        sekarang,
      )[0];
    assert.equal(baru('2026-11-17T07:00:00.000Z').lapuk, false); // 15:00 MYT = 3 j
    assert.equal(baru('2026-11-17T07:01:00.000Z').lapuk, true);
    assert.equal(baru('2026-11-17T05:00:00.000Z').lapuk, false);
    process.env.IPU_STALE_JAM = '1';
    try {
      assert.equal(baru('2026-11-17T05:01:00.000Z').lapuk, true); // 13:01 MYT, > 1 j
      assert.equal(baru('2026-11-17T05:00:00.000Z').lapuk, false);
    } finally {
      delete process.env.IPU_STALE_JAM;
    }
  });

  ok('trend 3 jam: Naik, Turun, Tetap, null', () => {
    const t = (nilai) =>
      ipu.gabungStesenIPU([peta('A')], [jam('A', siriJam(nilai))], SEKARANG)[0].trend;
    assert.equal(t([40, 42, 44, 46]), 'Naik'); // 46 - 40 = +6
    assert.equal(t([46, 44, 42, 40]), 'Turun');
    assert.equal(t([40, 42, 44, 44]), 'Tetap'); // +4
    assert.equal(t([44, 42, 41, 40]), 'Tetap'); // -4
    assert.equal(t([40, 45, 45, 45]), 'Naik'); // tepat +5
    assert.equal(t([45, 45, 45, 40]), 'Turun'); // tepat -5
    assert.equal(t([40, 80, 99]), null); // kurang 3 jam data
    assert.equal(t([]), null);
  });

  ok('sejarah24j dihadkan 24 titik terkini', () => {
    const nilai = Array.from({ length: 30 }, (_, i) => 30 + i);
    const s = ipu.gabungStesenIPU(
      [peta('A')],
      [jam('A', siriJam(nilai, 0).slice(0, 24).concat([]))],
      SEKARANG,
    )[0];
    assert.equal(s.sejarah24j.length, 24);
    const panjang = Array.from({ length: 30 }, (_, i) => ({
      t: new Date(Date.UTC(2026, 10, 16, 0 + i)).toISOString().slice(0, 19) + '+08:00',
      api: 30 + i,
    }));
    const s2 = ipu.gabungStesenIPU([peta('A')], [jam('A', panjang)], SEKARANG)[0];
    assert.equal(s2.sejarah24j.length, 24);
    assert.equal(s2.sejarah24j[23].api, 59);
  });

  ok('PO: stesen terdekat melangkau API null', () => {
    const stesen = ipu.gabungStesenIPU(
      [peta('DEKAT', { lat: 3.001 }), peta('JAUH', { lat: 3.2 })],
      [jam('DEKAT', [], { lat: 3.001 }), jam('JAUH', siriJam([40, 41, 42, 43]), { lat: 3.2 })],
      SEKARANG,
    );
    const r = ipu.terbitPO(stesen, [PO1])[0];
    assert.equal(r.stesenId, 'JAUH');
    assert.equal(r.api, 43);
    assert.equal(r.jauh, false);
    assert.ok(r.jarakKm > 20 && r.jarakKm < 23);
  });

  ok('PO: jauh > 50 km (sempadan)', () => {
    const dlat = (km) => km / ((6371 * Math.PI) / 180);
    const mk = (km) =>
      ipu.gabungStesenIPU(
        [peta('A', { lat: 3 + dlat(km) })],
        [jam('A', siriJam([40, 41, 42, 43]), { lat: 3 + dlat(km) })],
        SEKARANG,
      );
    assert.equal(ipu.terbitPO(mk(49.9), [PO1])[0].jauh, false);
    assert.equal(ipu.terbitPO(mk(50.5), [PO1])[0].jauh, true);
  });

  ok('PO: bawa lapuk, trend dan sejarah daripada stesen', () => {
    const stesen = ipu.gabungStesenIPU(
      [peta('A')],
      [jam('A', siriJam([40, 42, 44, 50], 6))],
      '2026-11-17T07:30:00.000Z',
    );
    const r = ipu.terbitPO(stesen, [PO1])[0];
    assert.equal(r.lapuk, true);
    assert.equal(r.trend, 'Naik');
    assert.equal(r.sejarah24j.length, 4);
    assert.equal(r.band, 'baik');
  });

  ok('15 PO sentiasa dalam po[] (juga tanpa stesen sah)', () => {
    const po = muatPO();
    assert.equal(po.length, 15);
    const kosong = ipu.terbitPO([], po);
    assert.equal(kosong.length, 15);
    kosong.forEach((r) => {
      assert.equal(r.api, null);
      assert.equal(r.band, 'tiada_data');
      assert.equal(r.stesenId, null);
      assert.equal(r.jauh, false);
    });
    const semuaNull = ipu.gabungStesenIPU([peta('A')], [jam('A', [])], SEKARANG);
    assert.equal(ipu.terbitPO(semuaNull, po).length, 15);
  });

  ok('fixture: Johor Bahru dan Kuala Terengganu guna stesen yang API null pada peta', () => {
    const f = buatFixtureIPU();
    assert.equal(f.po.length, 15);
    assert.equal(f.po.find((p) => p.poId === 'johor').stesenId, 'CA33J');
    assert.equal(f.po.find((p) => p.poId === 'terengganu').stesenId, 'CA44T');
    assert.ok(f.po.every((p) => p.api != null && !p.jauh));
    assert.ok(f.po.every((p) => !p.lapuk));
    assert.match(f.atribusi, /JAS \(MyEQMS\)/);
  });

  ok('buatFixtureIPU: variasi lima jalur, lapuk dan umurJam', () => {
    const v = buatFixtureIPU({ band: 'variasi' });
    assert.equal(new Set(v.po.map((p) => p.band)).size, 5);
    const l = buatFixtureIPU({ lapuk: true, umurJam: 2 });
    assert.ok(l.po.every((p) => p.lapuk === true));
    assert.ok(Math.abs((Date.now() - Date.parse(l.fetchedAt)) / 36e5 - 7) < 0.1);
    assert.ok(buatFixtureIPU({ band: 'berbahaya' }).po.every((p) => p.band === 'berbahaya'));
  });

  ok('cache tiada medan rahsia dan tidak menggunakan resultRecordCount', () => {
    assert.ok(!/token|apikey|authorization|password/i.test(JSON.stringify(buatFixtureIPU())));
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'api', 'services', 'kualiti-udara.js'),
      'utf8',
    );
    assert.ok(!/resultRecordCount\s*=/.test(src.replace(/\/\/.*$/gm, '')));
  });

  /* --- API --- */
  const server = require('../../api/_server.js');
  const fixtureFile = pasangCacheIPU();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await get(base, '/api/kualiti-udara');
    ok('/api/kualiti-udara 200 JSON dengan umurJam', () => {
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /application\/json/);
      const j = JSON.parse(r.body);
      assert.ok(j.sumber && j.sumber.stesenPeta && j.sumber.jam);
      assert.equal(j.po.length, 15);
      assert.equal(j.stesen.length, 15);
      assert.equal(typeof j.umurJam, 'number');
    });
    const h = await get(base, '/api/kualiti-udara', 'HEAD');
    ok('HEAD 200 tanpa badan', () => {
      assert.equal(h.status, 200);
      assert.equal(h.body, '');
    });
    const p = await get(base, '/api/kualiti-udara', 'POST');
    ok('POST ditolak 405', () => assert.equal(p.status, 405));
    const d = await get(base, '/data/processed/kualiti-udara-terkini.json');
    ok('/data/processed 404', () => assert.equal(d.status, 404));

    fs.unlinkSync(fixtureFile);
    const tiada = await get(base, '/api/kualiti-udara');
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

  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian API IPU lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

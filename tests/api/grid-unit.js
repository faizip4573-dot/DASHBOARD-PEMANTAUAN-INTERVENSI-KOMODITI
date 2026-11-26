'use strict';
// Ujian unit pembina grid cuaca (titik, batch, pangkalan URL, normalisasi, kuantisasi, topeng laut, parse). Tiada rangkaian.
// Jalankan dari root: node tests/api/grid-unit.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const g = require('../../api/_services/grid-cuaca.js');

const FX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8'));

(async () => {
  const gagal = [];
  const ok = async (nama, fn) => {
    try {
      await fn();
    } catch (e) {
      gagal.push(nama + ' -> ' + e.message);
    }
  };
  const B = g.BBOX;
  const bebas = {
    forecast: 'https://api.open-meteo.com',
    marine: 'https://marine-api.open-meteo.com',
    kunci: '',
  };

  await ok('bina_titik 0.5 -> 615 (15x41); 0.25 -> 2349 (29x81); tepi tepat', () => {
    const a = g.bina_titik(B, 0.5);
    assert.strictEqual(a.ny, 15);
    assert.strictEqual(a.nx, 41);
    assert.strictEqual(a.titik.length, 615);
    assert.deepStrictEqual(a.titik[0], [0.5, 99.5]);
    assert.deepStrictEqual(a.titik[40], [0.5, 119.5]);
    assert.deepStrictEqual(a.titik[614], [7.5, 119.5]);
    assert.deepStrictEqual(a.titik[41], [1, 99.5]);
    const b = g.bina_titik(B, 0.25);
    assert.strictEqual(b.titik.length, 2349);
    assert.strictEqual(b.ny, 29);
    assert.strictEqual(b.nx, 81);
    // tiada hanyut apungan: semua nilai ialah gandaan 0.25 tepat
    b.lon.forEach((x) => assert.strictEqual((x * 4) % 1, 0));
  });
  await ok('bahagi_batch 615 -> 7 (6x100 + 15), 431 -> 5; URL <= 6000', () => {
    const t = g.bina_titik(B, 0.5).titik;
    const bin = (b) => g.binaUrlForecast(b, bebas);
    const bt = g.bahagi_batch(t, { binaUrl: bin });
    assert.strictEqual(bt.length, 7);
    assert.deepStrictEqual(
      bt.map((x) => x.length),
      [100, 100, 100, 100, 100, 100, 15],
    );
    bt.forEach((b) => assert.ok(bin(b).length <= 6000));
    assert.strictEqual(g.bahagi_batch(t.slice(0, 431), { binaUrl: bin }).length, 5);
    assert.strictEqual(bt.flat().length, 615);
  });
  await ok('bahagi_batch urlMaks kecil memecah lagi', () => {
    const t = g.bina_titik(B, 0.5).titik.slice(0, 100);
    const bin = (b) => g.binaUrlForecast(b, bebas);
    const kecil = g.bahagi_batch(t, { binaUrl: bin, urlMaks: 600 });
    assert.ok(kecil.length > 1);
    kecil.forEach((b) => assert.ok(b.length === 1 || bin(b).length <= 600));
    assert.strictEqual(kecil.flat().length, 100);
  });
  await ok(
    'pilih_pangkalan: tanpa kunci = hos percuma; berkunci = hos pelanggan + &apikey=',
    () => {
      const a = g.pilih_pangkalan({});
      assert.strictEqual(a.forecast, 'https://api.open-meteo.com');
      assert.strictEqual(a.marine, 'https://marine-api.open-meteo.com');
      const t = [[1, 100]];
      assert.ok(!/apikey/.test(g.binaUrlForecast(t, a)));
      const b = g.pilih_pangkalan({ apiKey: 'RAHSIA_UJIAN' });
      assert.strictEqual(b.forecast, 'https://customer-api.open-meteo.com');
      assert.strictEqual(b.marine, 'https://customer-marine-api.open-meteo.com');
      assert.ok(g.binaUrlForecast(t, b).endsWith('&apikey=RAHSIA_UJIAN'));
      assert.ok(
        g.binaUrlMarine(t, b).startsWith('https://customer-marine-api.open-meteo.com/v1/marine?'),
      );
      assert.ok(/forecast_days=4&timezone=UTC/.test(g.binaUrlForecast(t, a)));
    },
  );
  await ok(
    'pilih_pangkalan: override sah menang; hos bukan https ditolak dengan satu amaran',
    () => {
      const w = [];
      const asal = console.warn;
      console.warn = (m) => w.push(m);
      try {
        g._tetapSemula();
        const a = g.pilih_pangkalan({
          base: 'http://127.0.0.1:9999/',
          marineBase: 'http://localhost:1',
        });
        assert.strictEqual(a.forecast, 'http://127.0.0.1:9999');
        assert.strictEqual(a.marine, 'http://localhost:1');
        const b = g.pilih_pangkalan({ base: 'http://evil.example.com', marineBase: 'ftp://x' });
        assert.strictEqual(b.forecast, 'https://api.open-meteo.com');
        assert.strictEqual(b.marine, 'https://marine-api.open-meteo.com');
        g.pilih_pangkalan({ base: 'http://evil.example.com' });
        const c = g.pilih_pangkalan({ base: 'https://proksi.contoh.my' });
        assert.strictEqual(c.forecast, 'https://proksi.contoh.my');
      } finally {
        console.warn = asal;
      }
      assert.strictEqual(w.length, 2, 'satu amaran bagi setiap nama (' + w.length + ')');
    },
  );
  await ok('GRID_RES_DEG tidak disokong -> 0.5 dengan satu amaran', () => {
    const w = [];
    const asal = console.warn;
    console.warn = (m) => w.push(m);
    const lama = process.env.GRID_RES_DEG;
    try {
      g._tetapSemula();
      process.env.GRID_RES_DEG = '0.25';
      assert.strictEqual(g.resDeg(), 0.5);
      process.env.GRID_RES_DEG = 'abc';
      assert.strictEqual(g.resDeg(), 0.5);
      process.env.GRID_RES_DEG = '';
      assert.strictEqual(g.resDeg(), 0.5);
    } finally {
      console.warn = asal;
      if (lama === undefined) delete process.env.GRID_RES_DEG;
      else process.env.GRID_RES_DEG = lama;
    }
    assert.strictEqual(w.length, 1);
  });
  const VR = g.VAR_RAMALAN;
  const VO = g.VAR_OMBAK;
  await ok('normalisasiBatch: tatasusunan 3 titik (fixture sebenar), masa tanpa Z -> Z', () => {
    const n = g.normalisasiBatch(FX('openmeteo-3pt.json'), 3, VR);
    assert.strictEqual(n.length, 3);
    assert.strictEqual(n[0].times.length, 96);
    assert.match(n[0].times[0], /^\d{4}-\d{2}-\d{2}T00:00Z$/);
    VR.forEach((v) => assert.strictEqual(n[1].serie[v].length, 96));
  });
  await ok('normalisasiBatch: objek tunggal dibungkus; panjang tidak sepadan melempar', () => {
    const satu = FX('openmeteo-3pt.json')[0];
    assert.strictEqual(g.normalisasiBatch(satu, 1, VR).length, 1);
    assert.throws(() => g.normalisasiBatch(satu, 2, VR), g.RalatFormat);
    assert.throws(() => g.normalisasiBatch(FX('openmeteo-3pt.json'), 2, VR), g.RalatFormat);
    assert.throws(() => g.normalisasiBatch(null, 1, VR), g.RalatFormat);
    const rosak = FX('openmeteo-3pt.json');
    rosak[1].hourly.cape = rosak[1].hourly.cape.slice(1);
    assert.throws(() => g.normalisasiBatch(rosak, 3, VR), g.RalatFormat);
    const pendek = FX('openmeteo-3pt.json');
    pendek[0].hourly.time = pendek[0].hourly.time.slice(0, 50);
    assert.throws(() => g.normalisasiBatch(pendek, 3, VR), g.RalatFormat);
  });
  await ok('normalisasiBatch menerima masa berakhiran Z', () => {
    const j = FX('openmeteo-3pt.json');
    j.forEach((it) => (it.hourly.time = it.hourly.time.map((t) => t + 'Z')));
    assert.match(g.normalisasiBatch(j, 3, VR)[0].times[5], /T05:00Z$/);
  });
  await ok('kuantisasi: pusingan balik, null -> sentinel, klip', () => {
    assert.strictEqual(g.kuantisasi(27.64, 10), 276);
    assert.strictEqual(g.nyahkuantisasi(276, 10), 27.6);
    assert.strictEqual(g.kuantisasi(null, 10), g.SENTINEL);
    assert.strictEqual(g.kuantisasi(undefined, 10), g.SENTINEL);
    assert.strictEqual(g.kuantisasi(NaN, 10), g.SENTINEL);
    assert.strictEqual(g.nyahkuantisasi(g.SENTINEL, 10), null);
    assert.strictEqual(g.kuantisasi(9e9, 1), 32767);
    const arr = Int16Array.from([0, -5, 32767, g.SENTINEL, 123]);
    assert.deepStrictEqual(Array.from(g.dariPangkalan64(g.kePangkalan64(arr))), Array.from(arr));
  });
  await ok(
    'topeng laut daripada pola null (fixture marine: titik 1 darat, titik 2 & 3 laut)',
    () => {
      const n = g.normalisasiBatch(FX('openmeteo-marine-3pt.json'), 3, VO);
      assert.deepStrictEqual(g.terbitkanLaut(n), [1, 2]);
      assert.strictEqual(g.kunciLaut(0.5, B), '0.5|0.5,7.5,99.5,119.5');
    },
  );
  await ok('redak membuang apikey daripada mesej', () => {
    const m = g.redak(new Error('gagal https://x/v1?a=1&apikey=ABC123&b=2 tamat'));
    assert.ok(!m.includes('ABC123'));
    assert.match(m, /apikey=\[disembunyikan\]/);
    assert.ok(!g.redak('apikey=XYZ').includes('XYZ'));
  });
  await ok('parsePembolehubah / parseJam / parseKoordinat', () => {
    assert.strictEqual(g.parsePembolehubah('temperature_2m'), 'temperature_2m');
    assert.strictEqual(g.parsePembolehubah('wave_height'), 'wave_height');
    assert.strictEqual(g.parsePembolehubah('../etc'), null);
    assert.strictEqual(g.parsePembolehubah(undefined), null);
    assert.strictEqual(g.parsePembolehubah('constructor'), null);
    assert.strictEqual(g.parseJam(undefined, 96), null);
    assert.strictEqual(g.parseJam('0', 96), 0);
    assert.strictEqual(g.parseJam('95', 96), 95);
    assert.ok(Number.isNaN(g.parseJam('96', 96)));
    assert.ok(Number.isNaN(g.parseJam('-1', 96)));
    assert.ok(Number.isNaN(g.parseJam('1.5', 96)));
    assert.ok(Number.isNaN(g.parseJam('abc', 96)));
    assert.deepStrictEqual(g.parseKoordinat('4.2', '101.97', B), { lat: 4.2, lon: 101.97 });
    assert.strictEqual(g.parseKoordinat('0', '101', B), null);
    assert.strictEqual(g.parseKoordinat('4', '130', B), null);
    assert.strictEqual(g.parseKoordinat('abc', '101', B), null);
    assert.strictEqual(g.parseKoordinat('4e0', '101', B), null);
    assert.strictEqual(g.parseKoordinat('', '', B), null);
  });
  await ok('anggaranKos tanpa laut.json = 1230', () => {
    const lama = process.env.GRID_CACHE_DIR;
    process.env.GRID_CACHE_DIR = path.join(
      require('node:os').tmpdir(),
      'grid-unit-kosong-' + process.pid,
    );
    try {
      assert.strictEqual(g.anggaranKos(), 1230);
    } finally {
      if (lama === undefined) delete process.env.GRID_CACHE_DIR;
      else process.env.GRID_CACHE_DIR = lama;
    }
  });

  if (gagal.length) {
    console.error('GAGAL grid-unit:\n- ' + gagal.join('\n- '));
    process.exit(1);
  }
  console.log('grid-unit: semua ujian lulus');
})();

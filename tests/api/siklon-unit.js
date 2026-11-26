'use strict';
// Ujian unit penormal GDACS (fixture sebenar) dan ambilMentah dengan fetch disuntik. Tiada rangkaian.
// Jalankan dari root: node tests/api/siklon-unit.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sk = require('../../api/_services/siklon.js');
const FX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'gdacs-tc.json'), 'utf8'),
);
const salin = (o) => JSON.parse(JSON.stringify(o));

(async () => {
  const gagal = [];
  const ok = async (nama, fn) => {
    try {
      await fn();
    } catch (e) {
      gagal.push(nama + ' -> ' + e.message);
    }
  };

  await ok('acara aktif di luar bbox (AKVAN-26, 87.3E) digugurkan; acara lampau digugurkan', () => {
    assert.deepStrictEqual(sk.normalisasiSiklon(FX.senarai, FX.geometri), []);
  });
  await ok('iscurrent dipaksa benar: TWENTYEIGHT-26 dalam bbox lulus dengan semua medan', () => {
    const s = salin(FX.senarai);
    s.features.forEach((f) => (f.properties.iscurrent = 'true'));
    const h = sk.normalisasiSiklon(s, FX.geometri);
    assert.strictEqual(h.length, 1);
    const x = h[0];
    assert.strictEqual(x.id, '1001336');
    assert.strictEqual(x.nama, 'TWENTYEIGHT-26');
    assert.strictEqual(x.aras, 'Green');
    assert.strictEqual(x.kategori, 'Depresi Tropika');
    assert.strictEqual(x.anginKmj, 56);
    assert.match(x.teks, /Tropical Depression/);
    assert.strictEqual(x.dari, '2026-10-12T00:00:00');
    assert.strictEqual(x.hingga, '2026-10-15T06:00:00');
    assert.ok(x.pos[0] > 90 && x.pos[0] < 140 && x.pos[1] > -15 && x.pos[1] < 25);
    assert.strictEqual(
      x.pautan,
      'https://www.gdacs.org/report.aspx?eventid=1001336&episodeid=14&eventtype=TC',
    );
  });
  await ok('jejak dipisah ikut bendera forecast (false = lalu, true = ramalan)', () => {
    const s = salin(FX.senarai);
    s.features.forEach((f) => (f.properties.iscurrent = true)); // boolean pun diterima
    const g = salin(FX.geometri);
    const baris = g['1001336'].features.filter((f) => /^Line_Line_/.test(f.properties.Class));
    const jumRamalan = baris.filter((f) => f.properties.forecast === true).length;
    const jumLalu = baris.length - jumRamalan;
    const x = sk.normalisasiSiklon(s, g)[0];
    assert.strictEqual(x.jejakRamalan.length, jumRamalan);
    assert.strictEqual(x.jejakLalu.length, jumLalu);
    assert.ok(jumRamalan + jumLalu > 0);
    [...x.jejakLalu, ...x.jejakRamalan].forEach((l) => {
      assert.strictEqual(l.length, 2);
      assert.strictEqual(l[0].length, 2);
    });
    // bendera rentetan "true" juga dikenali
    g['1001336'].features.forEach((f) => {
      if (typeof f.properties.forecast === 'boolean')
        f.properties.forecast = String(f.properties.forecast);
    });
    const y = sk.normalisasiSiklon(s, g)[0];
    assert.strictEqual(y.jejakRamalan.length, jumRamalan);
  });
  await ok('tanpa geometri: guna titik senarai, jejak kosong', () => {
    const s = salin(FX.senarai);
    s.features.forEach((f) => (f.properties.iscurrent = 'true'));
    const x = sk.normalisasiSiklon(s, {})[0];
    assert.deepStrictEqual(x.jejakLalu, []);
    assert.deepStrictEqual(x.jejakRamalan, []);
    assert.strictEqual(x.pos[0], 139.7);
  });
  await ok('pemetaan kategori', () => {
    const k = sk.kategoriDaripada;
    assert.strictEqual(k('Tropical Depression (maximum wind speed of 56 km/h)'), 'Depresi Tropika');
    assert.strictEqual(k('Tropical Storm (maximum wind speed of 93 km/h)'), 'Ribut Tropika');
    assert.strictEqual(k('Typhoon (maximum wind speed of 150 km/h)'), 'Taufan');
    assert.strictEqual(k('Sesuatu Lain (x)'), 'Sesuatu Lain');
    assert.strictEqual(k(''), 'Siklon tropika');
  });
  await ok('pautan di luar gdacs.org dibuang', () => {
    const s = salin(FX.senarai);
    s.features.forEach((f) => (f.properties.iscurrent = 'true'));
    s.features[1].properties.url.report = 'https://evil.example.com/x';
    assert.strictEqual(sk.normalisasiSiklon(s, FX.geometri)[0].pautan, null);
    s.features[1].properties.url.report = 'javascript:alert(1)';
    assert.strictEqual(sk.normalisasiSiklon(s, FX.geometri)[0].pautan, null);
  });
  await ok('input rosak tidak melempar', () => {
    assert.deepStrictEqual(sk.normalisasiSiklon(null, {}), []);
    assert.deepStrictEqual(sk.normalisasiSiklon({ features: [{}, { properties: {} }] }, {}), []);
  });
  await ok(
    'ambilMentah: hanya acara aktif dalam bbox diambil geometrinya; hos bukan gdacs dilangkau',
    async () => {
      const s = salin(FX.senarai);
      s.features.forEach((f) => (f.properties.iscurrent = 'true'));
      s.features[1].properties.url.geometry = 'https://evil.example.com/g';
      const dipanggil = [];
      const fetchJson = async (u) => {
        dipanggil.push(u);
        return u.includes('SEARCH') ? s : { features: [] };
      };
      const r = await sk.ambilMentah(Date.parse('2026-11-17T12:00:00Z'), fetchJson);
      assert.strictEqual(dipanggil.length, 1);
      assert.match(
        dipanggil[0],
        /eventlist=TC&fromdate=2026-10-18&todate=2026-11-17&alertlevel=Green;Orange;Red$/,
      );
      assert.deepStrictEqual(r.gagalGeom, ['1001336']);
      s.features[1].properties.url.geometry = FX.senarai.features[1].properties.url.geometry;
      const d2 = [];
      const f2 = async (u) => {
        d2.push(u);
        return u.includes('SEARCH') ? s : FX.geometri['1001336'];
      };
      const r2 = await sk.ambilMentah(Date.parse('2026-11-17T12:00:00Z'), f2);
      assert.strictEqual(d2.length, 2);
      assert.ok(r2.geometriMap['1001336']);
    },
  );

  if (gagal.length) {
    console.error('GAGAL siklon-unit:\n- ' + gagal.join('\n- '));
    process.exit(1);
  }
  console.log('siklon-unit: semua ujian lulus');
})();

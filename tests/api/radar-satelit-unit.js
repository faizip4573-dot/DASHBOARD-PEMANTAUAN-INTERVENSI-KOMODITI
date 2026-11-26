'use strict';
// Ujian unit penghurai RainViewer dan pencari bingkai satelit GIBS (fetch disuntik). Tiada rangkaian.
// Jalankan dari root: node tests/api/radar-satelit-unit.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const radar = require('../../api/_services/radar.js');
const sat = require('../../api/_services/satelit.js');
const FX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'rainviewer-maps.json'), 'utf8'),
);

(async () => {
  const gagal = [];
  const ok = async (nama, fn) => {
    try {
      await fn();
    } catch (e) {
      gagal.push(nama + ' -> ' + e.message);
    }
  };

  await ok('fixture RainViewer: 13 bingkai, tertib, path sah', () => {
    const r = radar.normalisasiRadar(FX, 'https://tilecache.rainviewer.com');
    assert.strictEqual(r.frames.length, 13);
    assert.strictEqual(r.host, 'https://tilecache.rainviewer.com');
    assert.strictEqual(r.atribusi, 'RainViewer');
    for (let i = 1; i < 13; i++) assert.ok(r.frames[i].time > r.frames[i - 1].time);
    r.frames.forEach((f) => assert.match(f.path, /^\/v2\/radar\/[0-9a-f]+$/));
    assert.strictEqual(r.frames[12].path, '/v2/radar/d5c56b662fd1');
  });
  await ok('hos tile asing ditolak; format rosak ditolak', () => {
    const asing = { ...FX, host: 'https://evil.example.com' };
    assert.throws(
      () => radar.normalisasiRadar(asing, 'https://tilecache.rainviewer.com'),
      /tidak dibenarkan/,
    );
    assert.throws(() => radar.normalisasiRadar(null, 'https://tilecache.rainviewer.com'));
    assert.throws(() => radar.normalisasiRadar({ host: FX.host }, FX.host));
  });
  await ok('past kosong -> frames []; path/masa tidak sah digugurkan', () => {
    const kosong = { ...FX, radar: { past: [], nowcast: [] } };
    assert.deepStrictEqual(radar.normalisasiRadar(kosong, FX.host).frames, []);
    const campur = {
      ...FX,
      radar: {
        past: [
          { time: 100, path: '/v2/radar/abc123' },
          { time: 'x', path: '/v2/radar/abc123' },
          { time: 200, path: '/etc/passwd' },
          { time: 300, path: '/v2/radar/../x' },
        ],
      },
    };
    assert.deepStrictEqual(radar.normalisasiRadar(campur, FX.host).frames, [
      { time: 100, path: '/v2/radar/abc123' },
    ]);
  });
  await ok(
    'ambilRadar: cache memori 5 min; salinan lapuk <= 30 min apabila hulu gagal',
    async () => {
      radar._tetapSemula();
      let bil = 0;
      let gagalHulu = false;
      const fetchJson = async () => {
        bil++;
        if (gagalHulu) throw new Error('mati');
        return FX;
      };
      let t = 1_000_000;
      const a = await radar.ambilRadar({ fetchJson, kini: () => t });
      assert.strictEqual(a.frames.length, 13);
      await radar.ambilRadar({ fetchJson, kini: () => t + 4 * 6e4 });
      assert.strictEqual(bil, 1);
      gagalHulu = true;
      t += 10 * 6e4;
      const b = await radar.ambilRadar({ fetchJson, kini: () => t });
      assert.strictEqual(bil, 2);
      assert.strictEqual(b.lapuk, true);
      t += 40 * 6e4;
      await assert.rejects(radar.ambilRadar({ fetchJson, kini: () => t }));
      radar._tetapSemula();
    },
  );

  // ---- satelit ----
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(6000)]);
  const sekarang = Date.parse('2026-11-17T10:55:00Z');
  await ok('satelit: mula 45 min lewat dibundar 10 min; 6 bingkai lama->baru', async () => {
    const dipanggil = [];
    const f = async (u) => {
      dipanggil.push(u);
      return { status: 200, tipe: 'image/png', buf: PNG };
    };
    const r = await sat.cariBingkaiTerkini(sekarang, f);
    assert.strictEqual(dipanggil.length, 1);
    assert.match(
      dipanggil[0],
      /Himawari_AHI_Band13_Clean_Infrared\/default\/2026-11-17T10:10:00Z\/GoogleMapsCompatible_Level6\/6\/31\/51\.png$/,
    );
    assert.deepStrictEqual(r, [
      '2026-11-17T09:20:00Z',
      '2026-11-17T09:30:00Z',
      '2026-11-17T09:40:00Z',
      '2026-11-17T09:50:00Z',
      '2026-11-17T10:00:00Z',
      '2026-11-17T10:10:00Z',
    ]);
  });
  await ok('satelit: 404 diundur 10 min setiap kali; berhenti selepas 6 undur', async () => {
    const dipanggil = [];
    const f = async (u) => {
      dipanggil.push(u);
      return dipanggil.length < 3
        ? { status: 404, tipe: 'text/plain', buf: Buffer.from('x') }
        : { status: 200, tipe: 'image/png', buf: PNG };
    };
    const r = await sat.cariBingkaiTerkini(sekarang, f);
    assert.strictEqual(dipanggil.length, 3);
    assert.strictEqual(r[5], '2026-11-17T09:50:00Z');
    const semua404 = [];
    const g = async (u) => {
      semua404.push(u);
      return { status: 404, tipe: '', buf: Buffer.alloc(0) };
    };
    assert.deepStrictEqual(await sat.cariBingkaiTerkini(sekarang, g), []);
    assert.strictEqual(semua404.length, 7);
  });
  await ok(
    'satelit: PNG kecil (<=5000 bait) atau bukan PNG ditolak; ralat rangkaian = tiada',
    async () => {
      const kecil = async () => ({ status: 200, tipe: 'image/png', buf: PNG.subarray(0, 800) });
      assert.deepStrictEqual(await sat.cariBingkaiTerkini(sekarang, kecil), []);
      const html = async () => ({ status: 200, tipe: 'text/html', buf: PNG });
      assert.deepStrictEqual(await sat.cariBingkaiTerkini(sekarang, html), []);
      const mati = async () => {
        throw new Error('rangkaian');
      };
      assert.deepStrictEqual(await sat.cariBingkaiTerkini(sekarang, mati), []);
    },
  );
  await ok('ambilSatelit: bentuk dan cache 10 min', async () => {
    sat._tetapSemula();
    let bil = 0;
    const fetchTeks = async () => {
      bil++;
      return { status: 200, tipe: 'image/png', buf: PNG };
    };
    const a = await sat.ambilSatelit({ fetchTeks, kini: () => sekarang });
    assert.strictEqual(a.maxzoom, 6);
    assert.strictEqual(a.frames.length, 6);
    assert.strictEqual(a.lapisan, 'Himawari_AHI_Band13_Clean_Infrared');
    assert.strictEqual(a.matriks, 'GoogleMapsCompatible_Level6');
    assert.strictEqual(a.atribusi, 'NASA GIBS / JMA Himawari');
    await sat.ambilSatelit({ fetchTeks, kini: () => sekarang + 9 * 6e4 });
    assert.strictEqual(bil, 1);
    await sat.ambilSatelit({ fetchTeks, kini: () => sekarang + 11 * 6e4 });
    assert.strictEqual(bil, 2);
    sat._tetapSemula();
  });

  if (gagal.length) {
    console.error('GAGAL radar-satelit-unit:\n- ' + gagal.join('\n- '));
    process.exit(1);
  }
  console.log('radar-satelit-unit: semua ujian lulus');
})();

'use strict';
// Ujian grid cuaca: muat semula terhadap stub Open-Meteo tempatan (kiraan permintaan, kos, topeng laut, 429, backoff, kuota)
// dan titik akhir /api/grid*. Tiada rangkaian luar. Jalankan dari root: node tests/api/grid-api.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { buatGrid, medan, adaLaut, NX, NY } = require('../helpers/grid-fixture.js');

const KUNCI = 'KUNCI_RAHSIA_UJIAN_9f3a';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-api-'));
process.env.GRID_AUTO = '0';
process.env.OPEN_METEO_API_KEY = KUNCI;
const gridCuaca = require('../../api/_services/grid-cuaca.js');
const server = require('../../api/_server.js');

// ---- stub Open-Meteo ----
const cfg = {};
const stat = { forecast: [], marine: [] };
function janaMasa() {
  const t = [];
  for (let h = 0; h < 96; h++)
    t.push(new Date(Date.UTC(2026, 10, 17, h)).toISOString().slice(0, 16));
  return t;
}
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const jenis = u.pathname === '/v1/marine' ? 'marine' : 'forecast';
  const lat = u.searchParams.get('latitude').split(',').map(Number);
  const lon = u.searchParams.get('longitude').split(',').map(Number);
  stat[jenis].push({ n: lat.length, url: req.url });
  const nombor = stat[jenis].length;
  const balasan = (kod, badan) => {
    res.writeHead(kod, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(badan));
  };
  if (jenis === 'forecast' && cfg.forecast500)
    return balasan(500, { error: true, reason: 'ralat' });
  if (jenis === 'forecast' && cfg.minutely429 === nombor)
    return balasan(429, { error: true, reason: 'Minutely API request limit exceeded.' });
  if (jenis === 'forecast' && cfg.jam429)
    return balasan(429, { error: true, reason: 'Hourly API request limit exceeded.' });
  if (jenis === 'marine' && cfg.marineGagal && nombor >= cfg.marineGagal)
    return balasan(cfg.marineKod || 500, {
      error: true,
      reason: 'Hourly API request limit exceeded.',
    });
  if (jenis === 'marine' && cfg.marineSemuaGagal) return balasan(500, { error: true });
  const nama =
    jenis === 'marine'
      ? ['wave_height', 'wave_direction', 'wave_period']
      : [
          'temperature_2m',
          'wind_speed_10m',
          'wind_direction_10m',
          'wind_gusts_10m',
          'cloud_cover',
          'precipitation',
          'rain',
          'showers',
          'weather_code',
          'cape',
        ];
  const item = lat.map((a, i) => {
    const col = Math.round((lon[i] - 99.5) / 0.5);
    const row = Math.round((a - 0.5) / 0.5);
    const hourly = { time: janaMasa() };
    nama.forEach((n) => {
      hourly[n] = [];
      for (let h = 0; h < 96; h++) hourly[n].push(medan(n, h, col, row));
    });
    return { latitude: a, longitude: lon[i], hourly };
  });
  balasan(200, item.length === 1 ? item[0] : item);
});

function get(base, p, kaedah = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request(base + p, { method: kaedah }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const gagal = [];
  const ok = async (nama, fn) => {
    try {
      await fn();
    } catch (e) {
      gagal.push(nama + ' -> ' + e.message);
    }
  };
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.OPEN_METEO_BASE = 'http://127.0.0.1:' + stub.address().port;
  process.env.OPEN_METEO_MARINE_BASE = process.env.OPEN_METEO_BASE;

  // tangkap semua log supaya kunci tidak bocor
  const log = [];
  const asal = { log: console.log, warn: console.warn, error: console.error };
  ['log', 'warn', 'error'].forEach((k) => (console[k] = (...a) => log.push(a.join(' '))));

  let jam = Date.parse('2026-11-17T01:00:00Z');
  const tidurLog = [];
  const opsyen = () => ({
    kini: () => jam,
    tidur: async (ms) => {
      tidurLog.push(ms);
      jam += ms;
    },
  });
  const reset = () => {
    Object.keys(cfg).forEach((k) => delete cfg[k]);
    stat.forecast = [];
    stat.marine = [];
    tidurLog.length = 0;
    gridCuaca._tetapSemula();
  };
  const dirBaru = (nama) => {
    const d = path.join(TMP, nama);
    process.env.GRID_CACHE_DIR = d;
    return d;
  };
  const jumlah = () => stat.forecast.length + stat.marine.length;
  const kuotaKos = (d) => JSON.parse(fs.readFileSync(path.join(d, 'kuota.json'), 'utf8')).kos;

  await ok('sel laut fixture = 431 (sama dengan data sebenar 0.5 deg)', () => {
    let n = 0;
    for (let r = 0; r < NY; r++) for (let c = 0; c < NX; c++) if (adaLaut(c, r)) n++;
    assert.strictEqual(n, 431);
  });

  let dir1;
  await ok(
    'larian pertama: 14 permintaan, kos 1230, laut.json 431 sel, tiada permintaan > 100 titik',
    async () => {
      reset();
      dir1 = dirBaru('a');
      const r = await gridCuaca.segar(opsyen());
      assert.strictEqual(jumlah(), 14);
      assert.strictEqual(stat.forecast.length, 7);
      assert.strictEqual(stat.marine.length, 7);
      assert.strictEqual(r.permintaan, 14);
      assert.strictEqual(r.kos, 1230);
      assert.strictEqual(kuotaKos(dir1), 1230);
      [...stat.forecast, ...stat.marine].forEach((x) => assert.ok(x.n <= 100));
      const laut = JSON.parse(fs.readFileSync(path.join(dir1, 'laut.json'), 'utf8'));
      assert.strictEqual(laut.indeks.length, 431);
      assert.strictEqual(laut.kunci, '0.5|0.5,7.5,99.5,119.5');
      const g = gridCuaca.bacaGrid();
      assert.strictEqual(g.sumber.ombak, 'ok');
      assert.strictEqual(g.times.length, 96);
      assert.match(g.times[0], /^2026-11-17T00:00Z$/);
      assert.strictEqual(Object.keys(g.vars).length, 13);
      // kunci dihantar sebagai apikey= ke stub, tetapi tidak muncul dalam log
      assert.ok(stat.forecast[0].url.includes('apikey=' + KUNCI));
      assert.ok(r.saizBait > 100000);
    },
  );
  await ok('larian stabil: 12 permintaan (7 + 5), kos 1046', async () => {
    reset();
    const r = await gridCuaca.segar(opsyen());
    assert.strictEqual(jumlah(), 12);
    assert.strictEqual(stat.marine.length, 5);
    assert.strictEqual(r.kos, 1046);
    assert.strictEqual(kuotaKos(dir1), 1230 + 1046);
    assert.strictEqual(gridCuaca.bacaGrid().sumber.ombak, 'ok');
  });
  await ok('pacing: tidak melebihi 500 kos/min (tidur dipanggil)', async () => {
    assert.ok(tidurLog.length >= 1, 'perlu menunggu');
  });
  await ok(
    'batch marine ke-4 daripada 7 gagal: 11 permintaan, kos 1015, tiada laut.json, ombak=tiada; larian seterusnya 14',
    async () => {
      reset();
      cfg.marineGagal = 4;
      cfg.marineKod = 429; // had jam: tiada cuba semula
      const d = dirBaru('b');
      const r = await gridCuaca.segar(opsyen());
      assert.strictEqual(stat.forecast.length, 7);
      assert.strictEqual(stat.marine.length, 4);
      assert.strictEqual(jumlah(), 11);
      assert.strictEqual(r.ombak, 'tiada');
      assert.ok(!fs.existsSync(path.join(d, 'laut.json')));
      assert.strictEqual(gridCuaca.bacaGrid().sumber.ombak, 'tiada');
      assert.ok(!gridCuaca.bacaGrid().vars.wave_height);
      assert.strictEqual(kuotaKos(d), 615 + 4 * 100); // 1015: batch ke-4 yang gagal turut dikira
      // larian seterusnya: bina semula topeng (14)
      stat.forecast = [];
      stat.marine = [];
      delete cfg.marineGagal;
      await gridCuaca.segar(opsyen());
      assert.strictEqual(jumlah(), 14);
      assert.ok(fs.existsSync(path.join(d, 'laut.json')));
      // 5xx berterusan pada batch ke-4: cuba semula sekali (12 permintaan, kos 615 + 5x100)
      reset();
      cfg.marineGagal = 4;
      cfg.marineKod = 500;
      const d2 = dirBaru('b2');
      await gridCuaca.segar(opsyen());
      assert.strictEqual(jumlah(), 12);
      assert.strictEqual(kuotaKos(d2), 615 + 500);
      assert.ok(!fs.existsSync(path.join(d2, 'laut.json')));
    },
  );
  await ok(
    '429 "Minutely" dicuba semula sekali selepas 65 s; 429 jam/hari menggugurkan tanpa cuba semula',
    async () => {
      reset();
      dirBaru('c');
      cfg.minutely429 = 2;
      await gridCuaca.segar(opsyen());
      assert.strictEqual(jumlah(), 15);
      assert.ok(tidurLog.includes(65000));
      reset();
      const d = dirBaru('d');
      cfg.jam429 = true;
      await assert.rejects(gridCuaca.segar(opsyen()));
      assert.strictEqual(stat.forecast.length, 1);
      assert.ok(!tidurLog.includes(65000));
      assert.ok(!fs.existsSync(path.join(d, 'grid.json')));
      assert.strictEqual(kuotaKos(d), 100, 'kos 429 dikira');
    },
  );
  await ok(
    'backoff: semak melangkau sehingga cubaSemulaSelepas lalu, kemudian pulih dan set semula',
    async () => {
      reset();
      dirBaru('e');
      cfg.jam429 = true;
      jam = Date.parse('2026-11-17T01:00:00Z');
      const r1 = await gridCuaca.semak(opsyen());
      assert.ok(r1.gagal);
      jam += 5 * 60000;
      const r2 = await gridCuaca.semak(opsyen());
      assert.strictEqual(r2.sebab, 'backoff');
      jam += 6 * 60000;
      delete cfg.jam429;
      const r3 = await gridCuaca.semak(opsyen());
      assert.ok(r3.permintaan >= 12);
      assert.deepStrictEqual(gridCuaca.keadaanBackoff(), {
        gagalBerturut: 0,
        cubaSemulaSelepas: 0,
      });
      // cache segar: dilangkau
      const r4 = await gridCuaca.semak(opsyen());
      assert.strictEqual(r4.sebab, 'segar');
    },
  );
  await ok('5xx ramalan: cuba semula sekali lalu gugur; cache lama tidak disentuh', async () => {
    reset();
    const d = dirBaru('f');
    await gridCuaca.segar(opsyen());
    const sebelum = fs.readFileSync(path.join(d, 'grid.json'), 'utf8');
    reset();
    cfg.forecast500 = true;
    await assert.rejects(gridCuaca.segar(opsyen()));
    assert.strictEqual(stat.forecast.length, 2);
    assert.strictEqual(fs.readFileSync(path.join(d, 'grid.json'), 'utf8'), sebelum);
    assert.strictEqual(gridCuaca.sumberTerakhir().status, 'gagal');
  });
  await ok(
    'ombak gagal pada larian stabil: grid ditulis, sumber.ombak=gagal, tiada pembolehubah ombak',
    async () => {
      reset();
      dirBaru('g');
      await gridCuaca.segar(opsyen());
      reset();
      cfg.marineSemuaGagal = true;
      jam += 3600000;
      const r = await gridCuaca.segar(opsyen());
      assert.strictEqual(r.ombak, 'gagal');
      const g = gridCuaca.bacaGrid();
      assert.strictEqual(g.sumber.ombak, 'gagal');
      assert.ok(!g.vars.wave_height);
    },
  );
  await ok('had kuota harian: dilangkau dengan satu amaran seharian', async () => {
    reset();
    dirBaru('h');
    process.env.GRID_KUOTA_HARIAN = '1000';
    try {
      log.length = 0;
      const a = await gridCuaca.segar(opsyen());
      const b = await gridCuaca.segar(opsyen());
      assert.ok(a.dilangkau && b.dilangkau);
      assert.strictEqual(jumlah(), 0);
      assert.strictEqual(log.filter((l) => /Kuota harian/.test(l)).length, 1);
    } finally {
      delete process.env.GRID_KUOTA_HARIAN;
    }
  });
  await ok('kunci API tidak muncul dalam log', () => {
    assert.ok(log.length > 0);
    log.forEach((l) => assert.ok(!l.includes(KUNCI), 'bocor: ' + l));
  });

  // ---- titik akhir (fixture sintetik) ----
  Object.assign(console, asal);
  const dirEp = dirBaru('ep');
  buatGrid({ dir: dirEp });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const semuaBadan = [];
  const j = async (p, k) => {
    const r = await get(base, p, k);
    semuaBadan.push(r.body);
    return r;
  };
  await ok('/api/grid/meta bentuk betul, tanpa kunci atau hos', async () => {
    gridCuaca._tetapSemula();
    const r = await j('/api/grid/meta');
    assert.strictEqual(r.status, 200);
    const m = JSON.parse(r.body);
    assert.strictEqual(m.nx, 41);
    assert.strictEqual(m.ny, 15);
    assert.strictEqual(m.times.length, 96);
    assert.strictEqual(m.resDeg, 0.5);
    assert.deepStrictEqual(m.bbox, { latMin: 0.5, latMax: 7.5, lonMin: 99.5, lonMax: 119.5 });
    assert.strictEqual(m.vars.temperature_2m.unit, '°C');
    assert.strictEqual(m.vars.temperature_2m.skala, 10);
    assert.strictEqual(m.sumber.ombak, 'ok');
    assert.strictEqual(m.pelayan, 'berbayar');
    assert.strictEqual(m.atribusi, 'Open-Meteo.com (CC BY 4.0)');
    assert.strictEqual(m.lapuk, false);
    assert.ok(!r.body.includes('apikey') && !r.body.includes('127.0.0.1'));
    assert.match(r.headers['content-type'], /application\/json/);
  });
  await ok('/api/grid?var= data [jam][sel]; jam= tunggal; null untuk darat', async () => {
    const r = await j('/api/grid?var=temperature_2m');
    const b = JSON.parse(r.body);
    assert.strictEqual(b.data.length, 96);
    assert.strictEqual(b.data[0].length, 615);
    assert.strictEqual(b.data[3][5 * 41 + 7], Math.round(medan('temperature_2m', 3, 7, 5) * 10));
    const t = JSON.parse((await j('/api/grid?var=temperature_2m&jam=3')).body);
    assert.strictEqual(t.jam, 3);
    assert.strictEqual(t.data.length, 615);
    assert.deepStrictEqual(t.data, b.data[3]);
    const w = JSON.parse((await j('/api/grid?var=wave_height&jam=0')).body);
    assert.strictEqual(w.data[0], null); // darat
    assert.ok(w.data[14 * 41 + 40] !== null);
  });
  await ok('/api/grid ralat: 400 var/jam tidak sah, 404 var tiada, HEAD ok, POST 405', async () => {
    assert.strictEqual((await j('/api/grid')).status, 400);
    assert.strictEqual((await j('/api/grid?var=xyz')).status, 400);
    assert.strictEqual((await j('/api/grid?var=cape&jam=96')).status, 400);
    assert.strictEqual((await j('/api/grid?var=cape&jam=-1')).status, 400);
    assert.strictEqual((await j('/api/grid?var=cape&jam=abc')).status, 400);
    assert.strictEqual((await j('/api/grid/meta', 'HEAD')).status, 200);
    assert.strictEqual((await j('/api/grid/meta', 'POST')).status, 405);
    buatGrid({ dir: dirEp, ombak: 'gagal' });
    gridCuaca._tetapSemula();
    const r = await j('/api/grid?var=wave_height');
    assert.strictEqual(r.status, 404);
    assert.match(JSON.parse(r.body).ralat, /tidak tersedia/);
    buatGrid({ dir: dirEp });
    gridCuaca._tetapSemula();
  });
  await ok(
    '/api/grid/titik: nilai pada nod = fixture; titik antara = interpolasi; luar bbox 400',
    async () => {
      const lat = 0.5 + 5 * 0.5;
      const lon = 99.5 + 7 * 0.5;
      const n = JSON.parse((await j(`/api/grid/titik?lat=${lat}&lon=${lon}`)).body);
      assert.strictEqual(n.times.length, 96);
      assert.ok(Math.abs(n.nilai.temperature_2m[3] - medan('temperature_2m', 3, 7, 5)) < 0.06);
      assert.strictEqual(n.unit.temperature_2m, '°C');
      const a = medan('temperature_2m', 0, 7, 5);
      const b = medan('temperature_2m', 0, 8, 5);
      const t = JSON.parse((await j(`/api/grid/titik?lat=${lat}&lon=${lon + 0.25}`)).body);
      assert.ok(Math.abs(t.nilai.temperature_2m[0] - (a + b) / 2) < 0.1);
      assert.strictEqual((await j('/api/grid/titik?lat=0&lon=101')).status, 400);
      assert.strictEqual((await j('/api/grid/titik?lat=abc&lon=101')).status, 400);
      assert.strictEqual((await j('/api/grid/titik?lat=4')).status, 400);
      // kod cuaca = sel terdekat (integer)
      assert.ok(Number.isInteger(n.nilai.weather_code[0]));
    },
  );
  await ok(
    'ombak pantai: sel laut bersebelahan darat masih memberi nilai (renormalisasi)',
    async () => {
      // lajur 8 baris 4 ialah laut; lajur 7 baris 4 darat. Titik di antara (lajur 7.6) -> berat laut 0.6 >= 0.5
      const lat = 0.5 + 4 * 0.5;
      const lon = 99.5 + 7.6 * 0.5;
      const t = JSON.parse((await j(`/api/grid/titik?lat=${lat}&lon=${lon}`)).body);
      assert.ok(t.nilai.wave_height[0] !== null);
      const d = JSON.parse((await j(`/api/grid/titik?lat=${lat}&lon=${99.5 + 7.2 * 0.5}`)).body);
      assert.strictEqual(d.nilai.wave_height[0], null);
    },
  );
  await ok('503 tanpa cache', async () => {
    dirBaru('kosong');
    gridCuaca._tetapSemula();
    const r = await j('/api/grid/meta');
    assert.strictEqual(r.status, 503);
    assert.match(JSON.parse(r.body).ralat, /belum tersedia/);
    assert.strictEqual((await j('/api/grid?var=cape')).status, 503);
    assert.strictEqual((await j('/api/grid/titik?lat=4&lon=101')).status, 503);
  });
  await ok('kunci API tiada dalam mana-mana respons', () => {
    semuaBadan.forEach((b) => assert.ok(!b.includes(KUNCI)));
  });

  await new Promise((r) => server.close(r));
  await new Promise((r) => stub.close(r));
  fs.rmSync(TMP, { recursive: true, force: true });
  if (gagal.length) {
    console.error('GAGAL grid-api:\n- ' + gagal.join('\n- '));
    process.exit(1);
  }
  console.log('grid-api: semua ujian lulus');
})();

'use strict';
// Grid cuaca Open-Meteo (ramalan 96 j + ombak laut) untuk lapisan cuaca peta. Server-sahaja: kunci API tidak pernah sampai ke pelayar.
// Kos Open-Meteo = bilangan koordinat setiap permintaan. Lalai: 0.5 deg (615 titik), 100 koordinat/permintaan, segar setiap 6 j.
const path = require('node:path');
const fs = require('node:fs');
const util = require('./util-rangkaian.js');
const Interp = require('../../src/js/lapisan-cuaca/interp.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const DIR_LALAI = path.join(DATA_DIR, 'grid');
const BBOX = { latMin: 0.5, latMax: 7.5, lonMin: 99.5, lonMax: 119.5 };
const JAM = 96; // forecast_days=4 bermula 00:00 UTC hari ini
const SENTINEL = -32768;
const ATRIBUSI = 'Open-Meteo.com (CC BY 4.0)';
const BATCH_MAKS = 100;
const URL_MAKS = 6000;
const HAD_PER_MINIT = 500;
const VAR_RAMALAN = [
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
const VAR_OMBAK = ['wave_height', 'wave_direction', 'wave_period'];
const VAR_SEMUA = VAR_RAMALAN.concat(VAR_OMBAK);
const UNIT = {
  temperature_2m: ['°C', 10],
  wind_speed_10m: ['km/j', 10],
  wind_direction_10m: ['°', 1],
  wind_gusts_10m: ['km/j', 10],
  cloud_cover: ['%', 1],
  precipitation: ['mm', 10],
  rain: ['mm', 10],
  showers: ['mm', 10],
  weather_code: ['WMO', 1],
  cape: ['J/kg', 1],
  wave_height: ['m', 100],
  wave_direction: ['°', 1],
  wave_period: ['s', 10],
};

class RalatFormat extends Error {}
class RalatGrid extends Error {}

// ---------- Persekitaran ----------
function dirCache() {
  return process.env.GRID_CACHE_DIR || DIR_LALAI;
}
const failGrid = () => path.join(dirCache(), 'grid.json');
const failLaut = () => path.join(dirCache(), 'laut.json');
const failKuota = () => path.join(dirCache(), 'kuota.json');

function nomborEnv(nama, lalai, min) {
  const n = Number(process.env[nama]);
  return Number.isFinite(n) && n >= min ? n : lalai;
}
const selangJam = () => nomborEnv('GRID_POLL_JAM', 6, 1);
const kuotaHarian = () => nomborEnv('GRID_KUOTA_HARIAN', 8000, 1);
const jamLapuk = () => nomborEnv('GRID_STALE_JAM', 18, 1);

let amaranRes = false;
function resDeg() {
  const mentah = process.env.GRID_RES_DEG;
  if (mentah === undefined || mentah === '' || Number(mentah) === 0.5) return 0.5;
  if (!amaranRes) {
    amaranRes = true;
    console.warn('GRID_RES_DEG=' + mentah + ' tidak disokong; guna 0.5 (kos kuota).');
  }
  return 0.5;
}

const redak = (e) =>
  String((e && e.message) || e).replace(/apikey=[^&\s]*/gi, 'apikey=[disembunyikan]');

// ---------- Fungsi tulen ----------
function bina_titik(bbox, res) {
  const ny = Math.round((bbox.latMax - bbox.latMin) / res) + 1;
  const nx = Math.round((bbox.lonMax - bbox.lonMin) / res) + 1;
  const lat = [];
  const lon = [];
  for (let j = 0; j < ny; j++) lat.push(+(bbox.latMin + j * res).toFixed(4));
  for (let i = 0; i < nx; i++) lon.push(+(bbox.lonMin + i * res).toFixed(4));
  const titik = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) titik.push([lat[j], lon[i]]);
  return { nx, ny, lat, lon, titik };
}

function bahagi_batch(titik, { maks = BATCH_MAKS, urlMaks = URL_MAKS, binaUrl } = {}) {
  const hasil = [];
  const pecah = (bahagian) => {
    if (binaUrl && bahagian.length > 1 && binaUrl(bahagian).length > urlMaks) {
      const t = Math.ceil(bahagian.length / 2);
      pecah(bahagian.slice(0, t));
      pecah(bahagian.slice(t));
    } else hasil.push(bahagian);
  };
  for (let i = 0; i < titik.length; i += maks) pecah(titik.slice(i, i + maks));
  return hasil;
}

let amaranBase = {};
function asalSah(nilai, nama) {
  if (!nilai) return null;
  try {
    const u = new URL(nilai);
    const hostTempatan = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && hostTempatan)) return u.origin;
  } catch {
    /* jatuh ke amaran */
  }
  if (!amaranBase[nama]) {
    amaranBase[nama] = true;
    console.warn(nama + ' tidak sah (perlu https); guna asal lalai Open-Meteo.');
  }
  return null;
}

function pilih_pangkalan({ apiKey, base, marineBase } = {}) {
  const kunci = String(apiKey || '').trim();
  const bakiF = kunci ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
  const bakiM = kunci
    ? 'https://customer-marine-api.open-meteo.com'
    : 'https://marine-api.open-meteo.com';
  return {
    forecast: asalSah(base, 'OPEN_METEO_BASE') || bakiF,
    marine: asalSah(marineBase, 'OPEN_METEO_MARINE_BASE') || bakiM,
    kunci,
  };
}
const pangkalanEnv = () =>
  pilih_pangkalan({
    apiKey: process.env.OPEN_METEO_API_KEY,
    base: process.env.OPEN_METEO_BASE,
    marineBase: process.env.OPEN_METEO_MARINE_BASE,
  });

function bahagianUrl(batch, pangkalan, hourly) {
  const lat = batch.map((p) => p[0]).join(',');
  const lon = batch.map((p) => p[1]).join(',');
  return (
    `latitude=${lat}&longitude=${lon}&hourly=${hourly.join(',')}&forecast_days=4&timezone=UTC` +
    (pangkalan.kunci ? '&apikey=' + encodeURIComponent(pangkalan.kunci) : '')
  );
}
const binaUrlForecast = (batch, p) =>
  `${p.forecast}/v1/forecast?` + bahagianUrl(batch, p, VAR_RAMALAN);
const binaUrlMarine = (batch, p) => `${p.marine}/v1/marine?` + bahagianUrl(batch, p, VAR_OMBAK);

function normMasa(t) {
  const s = String(t);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s + 'Z';
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(\.\d+)?)?Z$/);
  if (m) return m[1] + 'Z';
  throw new RalatFormat('Format masa tidak dijangka');
}

// Satu koordinat -> objek tunggal; >=2 -> tatasusunan mengikut urutan input.
function normalisasiBatch(json, n, nama) {
  const senarai = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : null;
  if (!senarai || senarai.length !== n) throw new RalatFormat('Bilangan titik tidak sepadan');
  return senarai.map((it) => {
    const h = it && it.hourly;
    if (!h || !Array.isArray(h.time) || h.time.length !== JAM)
      throw new RalatFormat('Bilangan jam tidak sepadan');
    const serie = {};
    nama.forEach((v) => {
      if (!Array.isArray(h[v]) || h[v].length !== JAM) throw new RalatFormat('Pembolehubah ' + v);
      serie[v] = h[v];
    });
    return { times: h.time.map(normMasa), serie };
  });
}

function kuantisasi(nilai, skala) {
  if (nilai === null || nilai === undefined || typeof nilai !== 'number' || !Number.isFinite(nilai))
    return SENTINEL;
  const q = Math.round(nilai * skala);
  return Math.max(-32767, Math.min(32767, q));
}
const nyahkuantisasi = (q, skala) => (q === SENTINEL ? null : q / skala);

const kePangkalan64 = (arr) => {
  const b = Buffer.alloc(arr.length * 2);
  for (let i = 0; i < arr.length; i++) b.writeInt16LE(arr[i], i * 2);
  return b.toString('base64');
};
const dariPangkalan64 = (s) => {
  const b = Buffer.from(s, 'base64');
  const a = new Int16Array(b.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = b.readInt16LE(i * 2);
  return a;
};

// Laut jika wave_height jam 0 bukan null. Pulangan: indeks (baris-utama) sel laut.
function terbitkanLaut(items) {
  const idx = [];
  items.forEach((it, i) => {
    if (it.serie.wave_height[0] !== null && it.serie.wave_height[0] !== undefined) idx.push(i);
  });
  return idx;
}

const kunciLaut = (res, bbox) =>
  `${res}|${bbox.latMin},${bbox.latMax},${bbox.lonMin},${bbox.lonMax}`;

function parsePembolehubah(v) {
  return typeof v === 'string' && VAR_SEMUA.includes(v) ? v : null;
}
function parseJam(v, bilJam) {
  if (v === null || v === undefined || v === '') return null;
  if (!/^\d{1,3}$/.test(String(v))) return NaN;
  const n = Number(v);
  return n >= 0 && n < bilJam ? n : NaN;
}
function parseKoordinat(lat, lon, bbox) {
  const re = /^-?\d+(\.\d+)?$/;
  if (!re.test(String(lat)) || !re.test(String(lon))) return null;
  const a = Number(lat);
  const o = Number(lon);
  if (!(a >= bbox.latMin && a <= bbox.latMax && o >= bbox.lonMin && o <= bbox.lonMax)) return null;
  return { lat: a, lon: o };
}

// ---------- Kuota ----------
function bacaKuota(sekarang) {
  const hari = new Date(sekarang).toISOString().slice(0, 10);
  const k = util.bacaJson(failKuota());
  if (k && k.tarikhUTC === hari && Number.isFinite(k.kos)) return k;
  return { tarikhUTC: hari, kos: 0 };
}
const simpanKuota = (k) => util.tulisJsonAtomik(failKuota(), k);

function anggaranKos() {
  const laut = util.bacaJson(failLaut());
  const nLaut = laut && Array.isArray(laut.indeks) ? laut.indeks.length : null;
  const tapak = bina_titik(BBOX, resDeg()).titik.length;
  return tapak + (nLaut !== null ? nLaut : tapak);
}

// ---------- Permintaan ----------
function bina_ctx(opsyen = {}) {
  const tetap = opsyen.sekarang ? new Date(opsyen.sekarang).getTime() : null;
  const kini = opsyen.kini || (tetap !== null ? () => tetap : Date.now);
  const tidur =
    opsyen.tidur ||
    (async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
    });
  const tetingkap = [];
  const ctx = {
    kini,
    tidur,
    fetchTeks: opsyen.fetchTeks || util.fetchTeks,
    permintaan: 0,
    kos: 0,
    gagalSemasa: null,
  };
  ctx.pacu = async (kos) => {
    for (;;) {
      const t = kini();
      while (tetingkap.length && tetingkap[0][0] <= t - 60000) tetingkap.shift();
      const jum = tetingkap.reduce((a, x) => a + x[1], 0);
      if (jum + kos <= HAD_PER_MINIT || !tetingkap.length) break;
      await tidur(tetingkap[0][0] + 60000 - t + 50);
    }
    tetingkap.push([kini(), kos]);
  };
  return ctx;
}

// Satu permintaan JSON. Kos dicatat selepas setiap jawapan (termasuk ralat), kerana Open-Meteo mengira per koordinat.
async function minta(url, kos, ctx) {
  let ulang5xx = false;
  let ulang429 = 0;
  for (;;) {
    await ctx.pacu(kos);
    ctx.permintaan++;
    let res;
    try {
      res = await ctx.fetchTeks(url, { retries: 0, timeoutMs: 20000 });
    } catch (e) {
      ctx.kos += kos;
      if (!ulang5xx) {
        ulang5xx = true;
        continue;
      }
      throw new RalatGrid('Rangkaian: ' + redak(e));
    }
    ctx.kos += kos;
    if (res.status === 200) {
      try {
        return JSON.parse(res.buf.toString('utf8'));
      } catch {
        throw new RalatFormat('Badan bukan JSON');
      }
    }
    if (res.status === 429) {
      let sebab = '';
      try {
        sebab = String(JSON.parse(res.buf.toString('utf8')).reason || '');
      } catch {
        /* badan tidak boleh dibaca: bukan "Minutely" */
      }
      if (/minutely/i.test(sebab) && ulang429 < 2) {
        ulang429++;
        await ctx.tidur(65000);
        continue;
      }
      throw new RalatGrid('Had kadar Open-Meteo (429)');
    }
    if (res.status >= 500) {
      if (!ulang5xx) {
        ulang5xx = true;
        continue;
      }
      throw new RalatGrid('Open-Meteo HTTP ' + res.status);
    }
    throw new RalatFormat('Open-Meteo HTTP ' + res.status);
  }
}

// ---------- Cache ----------
let memo = { kunci: null, grid: null };
function bacaGrid() {
  let st;
  try {
    st = fs.statSync(failGrid());
  } catch {
    return null;
  }
  const kunci = failGrid() + ':' + st.mtimeMs + ':' + st.size;
  if (memo.kunci === kunci) return memo.grid;
  const mentah = util.bacaJson(failGrid());
  if (!mentah || !mentah.vars) return null;
  const vars = {};
  Object.keys(mentah.vars).forEach((n) => {
    vars[n] = {
      unit: mentah.vars[n].unit,
      skala: mentah.vars[n].skala,
      data: dariPangkalan64(mentah.vars[n].data),
    };
  });
  const grid = { ...mentah, vars };
  memo = { kunci, grid };
  return grid;
}
const bacaCache = bacaGrid;
const umurJam = (g, sekarang) => util.umurJam(g, sekarang);

function ringkasMeta(g, sekarang = Date.now()) {
  const umur = util.umurJam(g, sekarang);
  const vars = {};
  Object.keys(g.vars).forEach((n) => (vars[n] = { unit: g.vars[n].unit, skala: g.vars[n].skala }));
  return {
    versi: g.versi,
    fetchedAt: g.fetchedAt,
    umurJam: Number.isFinite(umur) ? umur : null,
    lapuk: umur > jamLapuk(),
    resDeg: g.resDeg,
    bbox: g.bbox,
    nx: g.nx,
    ny: g.ny,
    times: g.times,
    vars,
    sumber: g.sumber,
    pelayan: pangkalanEnv().kunci ? 'berbayar' : 'percuma',
    atribusi: ATRIBUSI,
    sedangDikemaskini: sedangAmbilBendera,
  };
}

// data: [jam][nx*ny] integer (null untuk sentinel); dengan jam: satu tatasusunan rata.
function ambilVar(g, nama, jam) {
  const v = g.vars[nama];
  if (!v) return null;
  const sel = g.nx * g.ny;
  const salin = (h) => {
    const o = new Array(sel);
    for (let i = 0; i < sel; i++) {
      const q = v.data[h * sel + i];
      o[i] = q === SENTINEL ? null : q;
    }
    return o;
  };
  const badan = {
    var: nama,
    unit: v.unit,
    skala: v.skala,
    nx: g.nx,
    ny: g.ny,
    fetchedAt: g.fetchedAt,
  };
  if (jam !== null && jam !== undefined) return { ...badan, jam, data: salin(jam) };
  const data = [];
  for (let h = 0; h < g.times.length; h++) data.push(salin(h));
  return { ...badan, data };
}

// Nilai pada titik untuk semua jam (bilinear kongsi; kod cuaca = sel terdekat).
function nilaiTitik(g, lat, lon) {
  const p = Interp.lonlatKeGrid(g.bbox, g.nx, g.ny, lat, lon);
  if (!p) return null;
  const sel = g.nx * g.ny;
  const x0 = Math.min(Math.floor(p.fx), g.nx - 2);
  const y0 = Math.min(Math.floor(p.fy), g.ny - 2);
  const tx = p.fx - x0;
  const ty = p.fy - y0;
  const sudut = [
    y0 * g.nx + x0,
    y0 * g.nx + x0 + 1,
    (y0 + 1) * g.nx + x0,
    (y0 + 1) * g.nx + x0 + 1,
  ];
  const terdekat = y0 * g.nx + x0 + (tx >= 0.5 ? 1 : 0) + (ty >= 0.5 ? g.nx : 0);
  const nilai = {};
  const unit = {};
  Object.keys(g.vars).forEach((n) => {
    const v = g.vars[n];
    unit[n] = v.unit;
    const gelombang = VAR_OMBAK.includes(n);
    const siri = [];
    for (let h = 0; h < g.times.length; h++) {
      const off = h * sel;
      if (n === 'weather_code') {
        siri.push(nyahkuantisasi(v.data[off + terdekat], v.skala));
        continue;
      }
      const arr = sudut.map((i) => nyahkuantisasi(v.data[off + i], v.skala));
      const r = Interp.bilinear(arr, 2, 2, tx, ty, { renormalisasi: gelombang });
      siri.push(r === null ? null : Math.round(r * 1000) / 1000);
    }
    nilai[n] = siri;
  });
  return { lat, lon, times: g.times, nilai, unit };
}

// ---------- Segar ----------
let sedangAmbilBendera = false;
let sumberTerakhir = { status: 'belum', mesej: '' };
let gagalBerturut = 0;
let cubaSemulaSelepas = 0;
let amaranKuotaHari = null;

async function segar(opsyen = {}) {
  const ctx = bina_ctx(opsyen);
  const res = resDeg();
  const { nx, ny, titik } = bina_titik(BBOX, res);
  const sekarangMs = ctx.kini();
  const kuota = bacaKuota(sekarangMs);
  const anggaran = anggaranKos();
  if (kuota.kos + anggaran > kuotaHarian()) {
    if (amaranKuotaHari !== kuota.tarikhUTC) {
      amaranKuotaHari = kuota.tarikhUTC;
      console.warn('Kuota harian grid cuaca hampir penuh; muat semula dilangkau.');
    }
    return { dilangkau: true, sebab: 'kuota' };
  }
  sedangAmbilBendera = true;
  const pangkalan = pangkalanEnv();
  try {
    // 1. Ramalan (mesti berjaya; jika tidak, cache lama dikekalkan)
    const bForecast = bahagi_batch(titik, { binaUrl: (b) => binaUrlForecast(b, pangkalan) });
    const adaForecast = [];
    for (const b of bForecast) {
      const j = await minta(binaUrlForecast(b, pangkalan), b.length, ctx);
      adaForecast.push(...normalisasiBatch(j, b.length, VAR_RAMALAN));
    }
    const times = adaForecast[0].times;
    if (adaForecast.some((it) => it.times.some((t, i) => t !== times[i])))
      throw new RalatFormat('Masa ramalan tidak seragam');

    // 2. Ombak
    let lautIdx = null;
    const lautLama = util.bacaJson(failLaut());
    const kunci = kunciLaut(res, BBOX);
    if (lautLama && lautLama.kunci === kunci && Array.isArray(lautLama.indeks))
      lautIdx = lautLama.indeks;
    let ombak = 'tiada';
    let dataOmbak = null; // {nama: Int16Array}, indeks penuh
    const sel = nx * ny;
    const binaOmbak = () => {
      const o = {};
      VAR_OMBAK.forEach((n) => (o[n] = new Int16Array(JAM * sel).fill(SENTINEL)));
      return o;
    };
    try {
      if (lautIdx) {
        const titikLaut = lautIdx.map((i) => titik[i]);
        const bLaut = bahagi_batch(titikLaut, { binaUrl: (b) => binaUrlMarine(b, pangkalan) });
        const o = binaOmbak();
        let pos = 0;
        for (const b of bLaut) {
          const j = await minta(binaUrlMarine(b, pangkalan), b.length, ctx);
          const items = normalisasiBatch(j, b.length, VAR_OMBAK);
          if (items.some((it) => it.times.some((t, i) => t !== times[i])))
            throw new RalatFormat('Masa ombak tidak sepadan');
          items.forEach((it, k) => {
            const cell = lautIdx[pos + k];
            VAR_OMBAK.forEach((n) => {
              for (let h = 0; h < JAM; h++)
                o[n][h * sel + cell] = kuantisasi(it.serie[n][h], UNIT[n][1]);
            });
          });
          pos += b.length;
        }
        dataOmbak = o;
        ombak = 'ok';
      } else {
        // Bina topeng laut daripada semua titik; respons yang sama dipakai sebagai data ombak.
        const bSemua = bahagi_batch(titik, { binaUrl: (b) => binaUrlMarine(b, pangkalan) });
        const semuaItem = [];
        for (const b of bSemua) {
          const j = await minta(binaUrlMarine(b, pangkalan), b.length, ctx);
          semuaItem.push(...normalisasiBatch(j, b.length, VAR_OMBAK));
        }
        if (semuaItem.some((it) => it.times.some((t, i) => t !== times[i])))
          throw new RalatFormat('Masa ombak tidak sepadan');
        const idx = terbitkanLaut(semuaItem);
        util.tulisJsonAtomik(failLaut(), { kunci, indeks: idx });
        const o = binaOmbak();
        idx.forEach((cell) => {
          VAR_OMBAK.forEach((n) => {
            for (let h = 0; h < JAM; h++)
              o[n][h * sel + cell] = kuantisasi(semuaItem[cell].serie[n][h], UNIT[n][1]);
          });
        });
        dataOmbak = o;
        ombak = 'ok';
      }
    } catch (e) {
      console.warn('Ombak Open-Meteo gagal: ' + redak(e));
      dataOmbak = null;
      ombak = lautIdx ? 'gagal' : 'tiada';
    }

    // 3. Himpun dan tulis (atomik)
    const vars = {};
    VAR_RAMALAN.forEach((n) => {
      const arr = new Int16Array(JAM * sel);
      adaForecast.forEach((it, cell) => {
        for (let h = 0; h < JAM; h++) arr[h * sel + cell] = kuantisasi(it.serie[n][h], UNIT[n][1]);
      });
      vars[n] = { unit: UNIT[n][0], skala: UNIT[n][1], data: kePangkalan64(arr) };
    });
    if (dataOmbak)
      VAR_OMBAK.forEach((n) => {
        vars[n] = { unit: UNIT[n][0], skala: UNIT[n][1], data: kePangkalan64(dataOmbak[n]) };
      });
    const baru = {
      versi: 1,
      fetchedAt: new Date(ctx.kini()).toISOString(),
      resDeg: res,
      bbox: BBOX,
      nx,
      ny,
      times,
      sumber: { forecast: 'ok', ombak },
      vars,
    };
    util.tulisJsonAtomik(failGrid(), baru);
    sumberTerakhir = { status: 'ok', mesej: '' };
    gagalBerturut = 0;
    cubaSemulaSelepas = 0;
    return {
      dilangkau: false,
      titik: titik.length,
      jam: JAM,
      permintaan: ctx.permintaan,
      kos: ctx.kos,
      ombak,
      saizBait: fs.statSync(failGrid()).size,
    };
  } catch (e) {
    sumberTerakhir = { status: 'gagal', mesej: redak(e) };
    gagalBerturut++;
    cubaSemulaSelepas = ctx.kini() + Math.min(60, 10 * 2 ** (gagalBerturut - 1)) * 6e4;
    if (e instanceof RalatFormat) console.error('Grid cuaca: format tidak dijangka: ' + redak(e));
    else console.warn('Grid cuaca gagal dikemas kini: ' + redak(e));
    const ralat = new RalatGrid(redak(e));
    ralat.permintaan = ctx.permintaan;
    ralat.kos = ctx.kos;
    throw ralat;
  } finally {
    sedangAmbilBendera = false;
    try {
      const k = bacaKuota(ctx.kini());
      k.kos += ctx.kos;
      simpanKuota(k);
    } catch (e) {
      console.error('Kuota grid tidak dapat ditulis: ' + redak(e));
    }
  }
}

// Satu pusingan penjadual: segar jika cache tiada atau sudah >= GRID_POLL_JAM dan tiada backoff.
async function semak(opsyen = {}) {
  if (sedangAmbilBendera) return { dilangkau: true, sebab: 'sibuk' };
  const kini = opsyen.kini
    ? opsyen.kini()
    : opsyen.sekarang
      ? new Date(opsyen.sekarang).getTime()
      : Date.now();
  if (kini < cubaSemulaSelepas) return { dilangkau: true, sebab: 'backoff' };
  const g = bacaGrid();
  if (g && util.umurJam(g, kini) < selangJam()) return { dilangkau: true, sebab: 'segar' };
  try {
    return await segar(opsyen);
  } catch {
    return { dilangkau: false, gagal: true };
  }
}

let pemasa = null;
function mulaPenjadual() {
  if (process.env.GRID_AUTO === '0') return;
  const jalan = () =>
    semak().then((r) => {
      if (r && r.permintaan)
        console.log('Grid cuaca dikemas kini (' + r.permintaan + ' permintaan).');
    });
  jalan();
  if (!pemasa) {
    pemasa = setInterval(jalan, 10 * 6e4);
    pemasa.unref();
  }
}

// Untuk ujian: tetapkan semula keadaan dalam memori.
function _tetapSemula() {
  memo = { kunci: null, grid: null };
  gagalBerturut = 0;
  cubaSemulaSelepas = 0;
  amaranKuotaHari = null;
  amaranRes = false;
  amaranBase = {};
  sumberTerakhir = { status: 'belum', mesej: '' };
}

module.exports = {
  BBOX,
  JAM,
  SENTINEL,
  ATRIBUSI,
  VAR_RAMALAN,
  VAR_OMBAK,
  VAR_SEMUA,
  UNIT,
  RalatFormat,
  RalatGrid,
  bina_titik,
  bahagi_batch,
  pilih_pangkalan,
  binaUrlForecast,
  binaUrlMarine,
  normalisasiBatch,
  kuantisasi,
  nyahkuantisasi,
  kePangkalan64,
  dariPangkalan64,
  terbitkanLaut,
  kunciLaut,
  parsePembolehubah,
  parseJam,
  parseKoordinat,
  redak,
  resDeg,
  anggaranKos,
  bacaGrid,
  bacaCache,
  umurJam,
  ringkasMeta,
  ambilVar,
  nilaiTitik,
  segar,
  semak,
  mulaPenjadual,
  sedangAmbil: () => sedangAmbilBendera,
  sumberTerakhir: () => sumberTerakhir,
  keadaanBackoff: () => ({ gagalBerturut, cubaSemulaSelepas }),
  _tetapSemula,
};

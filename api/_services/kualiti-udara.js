'use strict';
// Kualiti udara (IPU/API) sebenar daripada JAS (MyEQMS). Tiada kunci diperlukan. Hanya GET dari pelayan.
const path = require('node:path');
const { muatPO } = require('./cuaca.js');
const util = require('./util-rangkaian.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const CACHE_LALAI = path.join(DATA_DIR, 'kualiti-udara-terkini.json');
// JANGAN guna resultRecordCount: pelayan memulangkan HTTP 400.
const URL_PETA =
  'https://eqms.doe.gov.my/api3/publicmapproxy/PUBLIC_DISPLAY/CAQM_MCAQM_Current_Reading/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json';
const URL_JAM =
  'https://eqms.doe.gov.my/api3/publicportalapims/apitablehourly?stationf=&location=&stateid=';
const ATRIBUSI = 'Sumber: JAS (MyEQMS)';
const JARAK_JAUH_KM = 50;
const AMBANG_TREND = 5;
const JAM_TREND = 3;
const MAKS_SIRI = 24;

const LABEL_BAND = {
  baik: 'Baik',
  sederhana: 'Sederhana',
  tidak_sihat: 'Tidak Sihat',
  sangat_tidak_sihat: 'Sangat Tidak Sihat',
  berbahaya: 'Berbahaya',
  tiada_data: 'Tiada data',
};

function staleJam() {
  const n = Number(process.env.IPU_STALE_JAM);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
function selangMin() {
  const n = Number(process.env.IPU_POLL_MIN);
  return Number.isFinite(n) && n > 0 ? n : 60;
}
function laluanCache() {
  return process.env.IPU_CACHE_FILE || CACHE_LALAI;
}
function redak(e) {
  return String((e && e.message) || e);
}
function nombor(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function titleCase(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(\-/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function namaNegeri(s) {
  return titleCase(s).replace(/^Wp /, 'WP ');
}

// Jalur IPU Malaysia: <=50 baik, <=100 sederhana, <=200 tidak sihat, <=300 sangat tidak sihat, selebihnya berbahaya.
function bandIPU(api) {
  const n = nombor(api);
  let band;
  if (n == null || n < 0) band = 'tiada_data';
  else if (n <= 50) band = 'baik';
  else if (n <= 100) band = 'sederhana';
  else if (n <= 200) band = 'tidak_sihat';
  else if (n <= 300) band = 'sangat_tidak_sihat';
  else band = 'berbahaya';
  return { band, bandLabel: LABEL_BAND[band] };
}

// Lapisan peta: metadata stesen + bacaan semasa. DATETIME ialah epoch tempatan-sebagai-UTC.
function normalisasiPeta(json) {
  const fitur = json && Array.isArray(json.features) ? json.features : [];
  const hasil = [];
  fitur.forEach((f) => {
    const a = f && f.attributes;
    if (!a || !a.STATION_ID) return;
    const lat = nombor(a.LATITUDE);
    const lon = nombor(a.LONGITUDE);
    if (lat == null || lon == null) return;
    hasil.push({
      id: String(a.STATION_ID),
      nama: String(a.STATION_LOCATION || a.PLACE || a.STATION_ID)
        .split(',')[0]
        .trim(),
      negeri: namaNegeri(a.STATE_NAME),
      lat,
      lon,
      kategori: a.STATION_CATEGORY ? String(a.STATION_CATEGORY).trim() : null,
      api: nombor(a.API),
      pencemar: a.PARAM_SELECTED ? String(a.PARAM_SELECTED).trim() : null,
      masa: typeof a.DATETIME === 'number' ? util.parseMasaMYT(a.DATETIME) : null,
    });
  });
  return hasil;
}

// apitablehourly: baris per stesen per jam; DATETIME ialah rentetan tempatan MYT tanpa zon.
function normalisasiJam(rows) {
  const senarai = Array.isArray(rows)
    ? rows
    : rows && Array.isArray(rows.api_table_hourly)
      ? rows.api_table_hourly
      : [];
  const peta = new Map();
  senarai.forEach((r) => {
    if (!r || !r.STATION_ID) return;
    const id = String(r.STATION_ID);
    let s = peta.get(id);
    if (!s) {
      const lokasi = String(r.STATION_LOCATION || id).split(',');
      s = {
        id,
        nama: lokasi[0].trim(),
        negeri: namaNegeri(lokasi.slice(1).join(',')),
        lat: nombor(r.LATITUDE),
        lon: nombor(r.LONGITUDE),
        siri: [],
      };
      peta.set(id, s);
    }
    const t = util.parseMasaMYT(r.DATETIME);
    const api = nombor(r.API);
    if (t && api != null) s.siri.push({ t, api });
  });
  const hasil = [...peta.values()];
  hasil.forEach((s) => s.siri.sort((a, b) => a.t.localeCompare(b.t)));
  return hasil;
}

function hitungTrend(siri) {
  if (!siri.length) return null;
  const akhir = siri[siri.length - 1];
  const sasaran = Date.parse(akhir.t) - JAM_TREND * 36e5;
  let lalu = null;
  for (const x of siri) if (Date.parse(x.t) <= sasaran) lalu = x;
  if (!lalu) return null;
  const beza = akhir.api - lalu.api;
  return beza >= AMBANG_TREND ? 'Naik' : beza <= -AMBANG_TREND ? 'Turun' : 'Tetap';
}

// Gabung peta (metadata) dan jam (bacaan utama). `sekarang` dihantar masuk.
function gabungStesenIPU(peta, jam, sekarang = new Date()) {
  const mapPeta = new Map((peta || []).map((s) => [s.id, s]));
  const mapJam = new Map((jam || []).map((s) => [s.id, s]));
  const id = [...new Set([...mapPeta.keys(), ...mapJam.keys()])];
  const hasil = [];
  id.forEach((k) => {
    const p = mapPeta.get(k);
    const j = mapJam.get(k);
    const lat = p ? p.lat : j.lat;
    const lon = p ? p.lon : j.lon;
    if (lat == null || lon == null) return;
    let siri = j ? j.siri.slice() : [];
    if (!siri.length && p && p.api != null && p.masa) siri = [{ t: p.masa, api: p.api }];
    const akhir = siri.length ? siri[siri.length - 1] : null;
    const { band, bandLabel } = bandIPU(akhir ? akhir.api : null);
    hasil.push({
      id: k,
      nama: p ? p.nama : j.nama,
      negeri: (p && p.negeri) || (j && j.negeri) || '',
      lat,
      lon,
      kategori: (p && p.kategori) || null,
      api: akhir ? akhir.api : null,
      band,
      bandLabel,
      pencemar: akhir && p && p.pencemar && p.masa === akhir.t ? p.pencemar : null,
      masaBacaan: akhir ? akhir.t : null,
      lapuk: akhir ? util.umurJam(akhir.t, sekarang) > staleJam() : false,
      trend: hitungTrend(siri),
      sejarah24j: siri.slice(-MAKS_SIRI),
    });
  });
  return hasil;
}

// Satu baris bagi setiap PO: stesen terdekat yang ada bacaan sah (melangkau API null).
function terbitPO(stesen, poList) {
  return poList.map((p) => {
    let terbaik = null;
    let jarak = Infinity;
    (stesen || []).forEach((s) => {
      if (s.api == null) return;
      const d = util.haversineKm(p.lat, p.lon, s.lat, s.lon);
      if (d < jarak) {
        jarak = d;
        terbaik = s;
      }
    });
    if (!terbaik)
      return {
        poId: p.id,
        nama: p.nama,
        negeri: p.negeri,
        stesenId: null,
        stesenNama: null,
        jarakKm: null,
        api: null,
        ...bandIPU(null),
        pencemar: null,
        masaBacaan: null,
        lapuk: false,
        jauh: false,
        trend: null,
        sejarah24j: [],
      };
    return {
      poId: p.id,
      nama: p.nama,
      negeri: p.negeri,
      stesenId: terbaik.id,
      stesenNama: terbaik.nama,
      jarakKm: Math.round(jarak * 10) / 10,
      api: terbaik.api,
      band: terbaik.band,
      bandLabel: terbaik.bandLabel,
      pencemar: terbaik.pencemar,
      masaBacaan: terbaik.masaBacaan,
      lapuk: terbaik.lapuk,
      jauh: jarak > JARAK_JAUH_KM,
      trend: terbaik.trend,
      sejarah24j: terbaik.sejarah24j,
    };
  });
}

/* --- Rangkaian --- */
async function ambilIPU() {
  const diambil = new Date().toISOString();
  const [p, j] = await Promise.allSettled([util.fetchJson(URL_PETA), util.fetchJson(URL_JAM)]);
  const status = (r, sah) => {
    if (r.status === 'fulfilled' && sah(r.value)) return { status: 'ok', mesej: '', diambil };
    const mesej = r.status === 'rejected' ? redak(r.reason) : 'Format tidak dijangka';
    return { status: 'gagal', mesej, diambil };
  };
  const sahPeta = (v) => v && Array.isArray(v.features);
  const sahJam = (v) => v && Array.isArray(v.api_table_hourly);
  return {
    peta: p.status === 'fulfilled' && sahPeta(p.value) ? p.value : null,
    jam: j.status === 'fulfilled' && sahJam(j.value) ? j.value : null,
    sumber: { stesenPeta: status(p, sahPeta), jam: status(j, sahJam) },
  };
}

/* --- Cache --- */
function bacaCache() {
  return util.bacaJson(laluanCache());
}
function tulisCache(obj) {
  util.tulisJsonAtomik(laluanCache(), obj);
}
const umurJam = util.umurJam;

async function bina(lama = null, sekarang = new Date()) {
  const r = await ambilIPU();
  const peta = r.peta ? normalisasiPeta(r.peta) : [];
  const jam = r.jam ? normalisasiJam(r.jam) : [];
  const stesen = gabungStesenIPU(peta, jam, sekarang);
  return {
    versi: 1,
    fetchedAt: sekarang.toISOString(),
    atribusi: ATRIBUSI,
    sumber: r.sumber,
    stesen,
    po: terbitPO(stesen, muatPO()),
  };
}

let sedangAmbilBendera = false;
async function segar() {
  sedangAmbilBendera = true;
  try {
    const lama = bacaCache();
    const j = await bina(lama);
    const semuaGagal = Object.values(j.sumber).every((s) => s.status === 'gagal');
    if (semuaGagal && lama) {
      lama.sumber = j.sumber;
      return { data: lama, ditulis: false };
    }
    if (!semuaGagal) tulisCache(j);
    return { data: j, ditulis: !semuaGagal };
  } finally {
    sedangAmbilBendera = false;
  }
}

let pemasa = null;
function mulaPenjadual() {
  if (process.env.IPU_AUTO === '0') return;
  const selang = selangMin();
  const semak = async () => {
    if (sedangAmbilBendera) return;
    const c = bacaCache();
    if (c && umurJam(c) < selang / 60) return;
    try {
      await segar();
      console.log('Data kualiti udara dikemas kini.');
    } catch (e) {
      console.warn('Gagal mengemas kini data kualiti udara: ' + redak(e));
    }
  };
  semak();
  if (!pemasa) {
    pemasa = setInterval(semak, selang * 6e4);
    pemasa.unref();
  }
}

module.exports = {
  LABEL_BAND,
  bandIPU,
  normalisasiPeta,
  normalisasiJam,
  gabungStesenIPU,
  terbitPO,
  ambilIPU,
  bina,
  segar,
  bacaCache,
  tulisCache,
  umurJam,
  mulaPenjadual,
  sedangAmbil: () => sedangAmbilBendera,
};

'use strict';
// Data banjir sebenar: JPS Malaysia (Public Info Banjir), JPS Selangor (telemetri), amaran rasmi JPS
// dan sejarah banjir 2024 (ArcGIS Selangor). Tiada kunci/token diperlukan. Hanya GET, dipanggil dari pelayan.
const path = require('node:path');
const { muatPO } = require('./cuaca.js');
const util = require('./util-rangkaian.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const CACHE_LALAI = path.join(DATA_DIR, 'banjir-terkini.json');
const SEJARAH_LALAI = path.join(DATA_DIR, 'banjir-sejarah.json');

const URL_NASIONAL =
  'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/latestreadingstrendabc.json';
const URL_AMARAN =
  'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/query/getdisse.php';
const URL_SELANGOR = 'https://infobanjirjps.selangor.gov.my/JPSAPI/api/LatestAlert/Telemetry';
const URL_SEJARAH =
  'https://jpsselgis.selangor.gov.my/gis/rest/services/Hosted/BANJIR_2024/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json';

const SUMBER_NASIONAL = 'JPS Malaysia (Public Info Banjir)';
const SUMBER_SELANGOR = 'JPS Selangor';
const NOTA_RISIKO = 'Anggaran sistem berdasarkan data JPS, bukan amaran rasmi';
const ATRIBUSI =
  'Sumber: JPS Malaysia (Public Info Banjir); JPS Selangor. Anggaran sistem berdasarkan data JPS, bukan amaran rasmi.';
const SEJARAH_MAKS_HARI = 7;
const SEJARAH_RADIUS_KM = 10;
const MAKS_STESEN_PO = 8;
const MAKS_NORMAL_PO = 3;

const PANGKAT_STATUS = { Normal: 0, Waspada: 1, Amaran: 2, Bahaya: 3 };
const STATUS_NASIONAL = { Normal: 'Normal', Alert: 'Waspada', Warning: 'Amaran', Danger: 'Bahaya' };
const STATUS_SELANGOR = { 0: 'Normal', 1: 'Waspada', 2: 'Amaran', 3: 'Bahaya' };
const TREND_BM = { rising: 'Naik', receding: 'Surut', 'no change': 'Tetap' };
const HUJAN_BM = {
  'no rainfall': 'Tiada hujan',
  'no rain': 'Tiada hujan',
  light: 'Ringan',
  moderate: 'Sederhana',
  heavy: 'Lebat',
  'very heavy': 'Sangat lebat',
};
const PANGKAT_HUJAN = { Ringan: 1, Sederhana: 2, Lebat: 3, 'Sangat lebat': 4 };
const NAMA_NEGERI = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Kuala Lumpur',
  'Labuan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Pulau Pinang',
  'Perak',
  'Perlis',
  'Putrajaya',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
];

/* --- Konfigurasi (dibaca setiap panggilan supaya ujian boleh menukar env) --- */
function radiusLalai() {
  const n = Number(process.env.BANJIR_RADIUS_KM);
  return Number.isFinite(n) && n > 0 ? n : 25;
}
function maksJam() {
  const n = Number(process.env.BANJIR_DATA_MAX_JAM);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
function selangMin() {
  const n = Number(process.env.BANJIR_POLL_MIN);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
function laluanCache() {
  return process.env.BANJIR_CACHE_FILE || CACHE_LALAI;
}
function laluanSejarah() {
  return process.env.BANJIR_SEJARAH_FILE || SEJARAH_LALAI;
}

/* --- Pembantu --- */
function nombor(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function teks(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}
function titleCase(s) {
  return teks(s)
    .toLowerCase()
    .replace(/(^|[\s(\-/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
function normalNegeri(v) {
  const s = teks(v)
    .replace(/^wilayah persekutuan\s+/i, '')
    .replace(/^w\.?p\.?\s+/i, '');
  return titleCase(s);
}
function kunciNama(s) {
  return teks(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function umurJamIso(iso, sekarang) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (new Date(sekarang).getTime() - t) / 36e5;
}
function segarIso(iso, sekarang) {
  return !!iso && umurJamIso(iso, sekarang) <= maksJam();
}
function bulat1(n) {
  return Math.round(n * 10) / 10;
}
function negeriDalamTeks(t) {
  const rendah = String(t || '').toLowerCase();
  const hasil = NAMA_NEGERI.filter((n) => rendah.includes(n.toLowerCase()));
  if (/\bpenang\b/i.test(t) && !hasil.includes('Pulau Pinang')) hasil.push('Pulau Pinang');
  return hasil;
}
function redak(e) {
  return String((e && e.message) || e);
}

/* --- Normalisasi --- */
function rekodKosong(asas) {
  return {
    ...asas,
    parasAir: null,
    statusRasmi: null,
    trend: null,
    hujan1j: null,
    hujan3j: null,
    hujanHariIni: null,
    kategoriHujan: null,
    masaBacaan: null,
    masaHujan: null,
  };
}

// JSON nasional: kekunci pendek (lihat laporan). Pulang rekod yang ada paras sah ATAU hujan sah.
function normalisasiNasional(rows, sekarang = new Date()) {
  if (!Array.isArray(rows)) return [];
  const hasil = [];
  rows.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const lat = nombor(r.c);
    const lon = nombor(r.d);
    if (lat == null || lon == null || !teks(r.a)) return;
    const rek = rekodKosong({
      id: 'jps:' + teks(r.a),
      nama: teks(r.b),
      negeri: normalNegeri(r.f),
      daerah: teks(r.e),
      sungai: teks(r.g),
      lat,
      lon,
      jenis: teks(r.i),
      sumber: SUMBER_NASIONAL,
    });
    // Paras air
    const status = STATUS_NASIONAL[teks(r.n)];
    const paras = nombor(r.m);
    const masaWL = util.parseMasaMYT(r.q);
    const ambang = nombor(r.o);
    const dangerPalsu = teks(r.n) === 'Danger' && (ambang == null || ambang <= 0);
    if (status && paras != null && paras !== -9999 && !dangerPalsu && segarIso(masaWL, sekarang)) {
      rek.parasAir = paras;
      rek.statusRasmi = status;
      rek.trend = TREND_BM[teks(r.s).toLowerCase()] || null;
      rek.masaBacaan = masaWL;
    }
    // Hujan
    const masaRF = util.parseMasaMYT(r.y);
    const kat = teks(r.x).toLowerCase();
    const hariIni = nombor(r.w);
    if (kat !== 'error' && hariIni != null && hariIni >= 0 && segarIso(masaRF, sekarang)) {
      const u = nombor(r.u);
      const v = nombor(r.v);
      rek.hujan1j = u != null && u >= 0 ? u : null;
      rek.hujan3j = v != null && v >= 0 ? v : null;
      rek.hujanHariIni = hariIni;
      rek.kategoriHujan = HUJAN_BM[kat] || null;
      rek.masaHujan = masaRF;
    }
    if (rek.parasAir != null || rek.masaHujan != null) hasil.push(rek);
  });
  return hasil;
}

// Telemetri Selangor (LatestAlert/Telemetry). waterLevel1Status: 0 Normal, 1 Waspada, 2 Amaran, 3 Bahaya.
function normalisasiSelangor(rows, sekarang = new Date()) {
  if (!Array.isArray(rows)) return [];
  const hasil = [];
  rows.forEach((r) => {
    if (!r || typeof r !== 'object' || r.id == null) return;
    const lat = nombor(r.latitude);
    const lon = nombor(r.longitude);
    if (lat == null || lon == null) return;
    const masa = util.parseMasaMYT(r.dateTime);
    if (!segarIso(masa, sekarang)) return;
    const paras = nombor(r.waterLevel1);
    const status = STATUS_SELANGOR[r.waterLevel1Status];
    const wlSah = paras != null && paras !== -9999 && status != null;
    const hujan = nombor(r.hourlyRainfall);
    const rfSah = hujan != null && hujan >= 0;
    if (!wlSah && !rfSah) return;
    const rek = rekodKosong({
      id: 'sel:' + r.id,
      nama: titleCase(r.stationName),
      negeri: 'Selangor',
      daerah: titleCase(r.districtName),
      sungai: titleCase(r.mainRiverBasin),
      lat,
      lon,
      jenis: wlSah && rfSah ? 'RF,WL' : wlSah ? 'WL' : 'RF',
      sumber: SUMBER_SELANGOR,
    });
    if (wlSah) {
      rek.parasAir = paras;
      rek.statusRasmi = status;
      const m = String(r.waterLevel1MessageEnglish || '').match(
        /Trend:\s*(?:<b>)?\s*([A-Za-z ]+?)\s*(?:<|\()/,
      );
      rek.trend = (m && TREND_BM[m[1].toLowerCase()]) || null;
      rek.masaBacaan = masa;
    }
    if (rfSah) {
      const k = String(r.rainfallMessageEnglish || '').match(
        /is at\s*(?:<b>)?\s*([A-Za-z ]+?)\s*level/i,
      );
      rek.hujan1j = hujan;
      rek.kategoriHujan =
        (k && HUJAN_BM[k[1].toLowerCase()]) || (hujan === 0 ? 'Tiada hujan' : null);
      rek.masaHujan = masa;
    }
    hasil.push(rek);
  });
  return hasil;
}

// Rekod Selangor menggantikan rekod nasional yang sepadan (id sama, atau nama sama dan jarak < 1 km).
function gabungStesen(nasional, selangor) {
  const sel = selangor || [];
  const idSel = new Set(sel.map((s) => s.id.replace(/^sel:/, '')));
  const sisa = (nasional || []).filter((n) => {
    if (idSel.has(n.id.replace(/^jps:/, ''))) return false;
    const k = kunciNama(n.nama);
    return !sel.some(
      (s) => k && kunciNama(s.nama) === k && util.haversineKm(n.lat, n.lon, s.lat, s.lon) < 1,
    );
  });
  return [...sisa, ...sel];
}

function normalisasiAmaran(rows, sekarang = new Date()) {
  if (!Array.isArray(rows)) return [];
  const kunciMasa = new Set(['MessageDT', 'EstimatedDT', 'EstimatedEndDT']);
  const keutamaan = [
    'Message',
    'message',
    'MessageText',
    'Mesej',
    'mesej',
    'Description',
    'Text',
    'Title',
  ];
  const sekarangMs = new Date(sekarang).getTime();
  const hasil = [];
  rows.forEach((r) => {
    const o = typeof r === 'string' ? { Message: r } : r;
    if (!o || typeof o !== 'object') return;
    const bersih = (v) =>
      String(v)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    let mesej = '';
    for (const k of keutamaan) {
      if (typeof o[k] === 'string' && bersih(o[k])) {
        mesej = bersih(o[k]);
        break;
      }
    }
    if (!mesej) {
      for (const [k, v] of Object.entries(o)) {
        if (kunciMasa.has(k) || typeof v !== 'string') continue;
        const b = bersih(v);
        if (b.length >= 10 && /[A-Za-z]/.test(b) && !util.parseMasaMYT(b)) {
          mesej = b;
          break;
        }
      }
    }
    if (!mesej) return;
    const anggaranTamat = util.parseMasaMYT(o.EstimatedEndDT);
    if (anggaranTamat && Date.parse(anggaranTamat) < sekarangMs) return;
    const semuaTeks = Object.values(o)
      .filter((v) => typeof v === 'string')
      .join(' ');
    hasil.push({
      sumber: SUMBER_NASIONAL,
      mesej: mesej.slice(0, 600),
      dikeluarkan: util.parseMasaMYT(o.MessageDT),
      anggaranMula: util.parseMasaMYT(o.EstimatedDT),
      anggaranTamat,
      negeri: negeriDalamTeks(bersih(semuaTeks)),
    });
  });
  return hasil;
}

// Sejarah amaran JPS yang pernah dilihat (getdisse hanya memberi amaran semasa), disimpan 7 hari.
// Fungsi tulen: `sekarang` dihantar masuk. Setiap rekod ada `dilihat` (kali pertama dilihat) dan `aktif`.
function gabungSejarahAmaran(lama = [], semasa = [], sekarang = new Date()) {
  const now = new Date(sekarang).getTime();
  const had = now - SEJARAH_MAKS_HARI * 864e5;
  const kunci = (a) => [a.mesej, a.dikeluarkan || a.anggaranMula || ''].join('|');
  const aktifSet = new Set(semasa.map(kunci));
  const peta = new Map();
  (Array.isArray(lama) ? lama : []).forEach((a) => {
    if (a && a.mesej) peta.set(kunci(a), { ...a });
  });
  semasa.forEach((a) => {
    const ada = peta.get(kunci(a));
    peta.set(kunci(a), { ...a, dilihat: (ada && ada.dilihat) || new Date(now).toISOString() });
  });
  return [...peta.values()]
    .map((a) => ({ ...a, dilihat: a.dilihat || a.dikeluarkan || new Date(now).toISOString() }))
    .filter((a) => (Date.parse(a.dikeluarkan || a.dilihat) || 0) >= had)
    .map((a) => ({
      ...a,
      aktif: aktifSet.has(kunci(a)) || (!!a.anggaranTamat && Date.parse(a.anggaranTamat) >= now),
    }))
    .sort(
      (x, y) =>
        (Date.parse(y.dikeluarkan || y.dilihat) || 0) -
        (Date.parse(x.dikeluarkan || x.dilihat) || 0),
    );
}

function normalisasiSejarah(json) {
  const fitur = json && Array.isArray(json.features) ? json.features : [];
  const hasil = [];
  fitur.forEach((f) => {
    const a = f && f.attributes;
    if (!a) return;
    const lat = nombor(a.latitude);
    const lon = nombor(a.longitude);
    if (lat == null || lon == null) return;
    hasil.push({
      nama: teks(a.kawasan_banjir),
      daerah: teks(a.daerah),
      negeri: teks(a.negeri),
      lat,
      lon,
      jenis: teks(a.jenis_banjir),
    });
  });
  return hasil;
}

/* --- Terbitan risiko PO (fungsi tulen) --- */
function stesenRingkas(s, jarak) {
  return {
    id: s.id,
    nama: s.nama,
    sungai: s.sungai,
    jarakKm: bulat1(jarak),
    statusRasmi: s.statusRasmi,
    parasAir: s.parasAir,
    trend: s.trend,
    masaBacaan: s.masaBacaan,
    sumber: s.sumber,
  };
}

function terbitPO({
  stesenWL = [],
  stesenHujan = [],
  amaran = [],
  sejarah = [],
  poList = [],
  radiusKm = radiusLalai(),
} = {}) {
  return poList.map((p) => {
    const wl = stesenWL
      .map((s) => ({ s, jarak: util.haversineKm(p.lat, p.lon, s.lat, s.lon) }))
      .filter((x) => x.jarak <= radiusKm)
      .sort((a, b) => a.jarak - b.jarak);
    const rf = stesenHujan.filter((s) => util.haversineKm(p.lat, p.lon, s.lat, s.lon) <= radiusKm);
    const amaranRasmiNegeri = amaran.some((a) => (a.negeri || []).includes(p.negeri));
    const pangkat = (x) => PANGKAT_STATUS[x.s.statusRasmi] || 0;
    const bahayaAmaran = wl.filter((x) => pangkat(x) >= 2);
    const waspada = wl.filter((x) => pangkat(x) === 1);
    const hujanLebat = rf.filter((s) => (PANGKAT_HUJAN[s.kategoriHujan] || 0) >= 3);

    let risiko;
    const sebab = [];
    if (bahayaAmaran.length || amaranRasmiNegeri) {
      risiko = 'Tinggi';
      bahayaAmaran
        .slice()
        .sort((a, b) => pangkat(b) - pangkat(a) || a.jarak - b.jarak)
        .forEach((x) =>
          sebab.push(`Stesen ${x.s.statusRasmi}: ${x.s.nama} (${bulat1(x.jarak)} km)`),
        );
      if (amaranRasmiNegeri) sebab.push(`Amaran rasmi JPS menyebut ${p.negeri}`);
    } else if (!wl.length) {
      risiko = 'Tiada data';
      sebab.push(`Tiada stesen paras air sah dalam ${radiusKm} km`);
    } else if (waspada.length || hujanLebat.length) {
      risiko = 'Sederhana';
      waspada.forEach((x) => sebab.push(`Stesen Waspada: ${x.s.nama} (${bulat1(x.jarak)} km)`));
      hujanLebat.forEach((s) =>
        sebab.push(`Hujan ${String(s.kategoriHujan).toLowerCase()}: ${s.nama}`),
      );
    } else {
      risiko = 'Rendah';
    }

    const penting = wl
      .filter((x) => pangkat(x) >= 1)
      .sort((a, b) => pangkat(b) - pangkat(a) || a.jarak - b.jarak);
    const normal = wl.filter((x) => pangkat(x) === 0).slice(0, MAKS_NORMAL_PO);
    const stesenTerdekat = [...penting, ...normal]
      .slice(0, MAKS_STESEN_PO)
      .map((x) => stesenRingkas(x.s, x.jarak));

    const kategori = hujanLebat.length
      ? hujanLebat.reduce(
          (a, s) =>
            (PANGKAT_HUJAN[s.kategoriHujan] || 0) > (PANGKAT_HUJAN[a] || 0) ? s.kategoriHujan : a,
          'Lebat',
        )
      : null;
    const hariIni = rf.map((s) => s.hujanHariIni).filter((v) => v != null);

    let sejarah2024 = null;
    if (p.negeri === 'Selangor') {
      const dekat = sejarah
        .map((h) => util.haversineKm(p.lat, p.lon, h.lat, h.lon))
        .filter((j) => j <= SEJARAH_RADIUS_KM);
      if (dekat.length)
        sejarah2024 = {
          bilangan: dekat.length,
          terdekatKm: bulat1(Math.min(...dekat)),
          label: 'Sejarah 2024',
        };
    }

    return {
      poId: p.id,
      nama: p.nama,
      negeri: p.negeri,
      risikoBanjir: risiko,
      sebab,
      statusTerburuk: wl.length
        ? wl.reduce((a, x) => (pangkat(x) > PANGKAT_STATUS[a] ? x.s.statusRasmi : a), 'Normal')
        : null,
      bilanganStesen: wl.length,
      bilanganAmaranBahaya: bahayaAmaran.length,
      stesenTerdekat,
      hujan: {
        maksHariIniMm: hariIni.length ? Math.max(...hariIni) : null,
        kategoriTertinggi: kategori,
      },
      amaranRasmiNegeri,
      sejarah2024,
      nota: NOTA_RISIKO,
    };
  });
}

// Senario 'Risiko Banjir' (0 atau 1). PO terjejas = PO berisiko Tinggi.
function bangunSenarioBanjir({ po = [], sekarang } = {}) {
  const terjejas = po.filter((p) => p.risikoBanjir === 'Tinggi');
  if (!terjejas.length) return [];
  const now = new Date(sekarang || 0);
  const tinggi = (p) => p.statusTerburuk === 'Bahaya' || p.amaranRasmiNegeri;
  const sumber = new Set();
  terjejas.forEach((p) => p.stesenTerdekat.forEach((s) => sumber.add(s.sumber)));
  const label = [SUMBER_NASIONAL];
  if (sumber.has(SUMBER_SELANGOR)) label.push(SUMBER_SELANGOR);
  const negeri = [...new Set(terjejas.map((p) => p.negeri))];
  const adaBahaya = terjejas.some((p) => p.statusTerburuk === 'Bahaya');
  const adaAmaranRasmi = terjejas.some((p) => p.amaranRasmiNegeri);
  const isyarat = [
    adaBahaya ? 'stesen paras air pada tahap Bahaya' : 'stesen paras air pada tahap Amaran',
    adaAmaranRasmi ? 'amaran rasmi JPS' : null,
  ]
    .filter(Boolean)
    .join(' dan ');
  const tindakan = [
    'Semak akses logistik dan keselamatan pusat pengumpulan di PO terlibat',
    'Semak stok komoditi mudah rosak dan kapasiti bilik sejuk',
    'Sediakan pilihan mobilisasi bekalan daripada PO lain jika gangguan disahkan',
    'Pantau amaran rasmi JPS Malaysia',
  ];
  return [
    {
      scenarioId: 'S01',
      scenarioName: 'Risiko Banjir',
      warningType: 'amaran_banjir',
      source: label.join(' + '),
      issuedAt: now.toISOString(),
      validFrom: now.toISOString(),
      validUntil: new Date(now.getTime() + 3 * 36e5).toISOString(),
      affectedStates: negeri,
      affectedDistricts: [],
      affectedPOIds: terjejas.map((p) => p.poId),
      riskLevel: terjejas.some(tinggi) ? 'tinggi' : 'sederhana',
      affectedCommodities: [],
      recommendedActions: tindakan,
      ringkasan: `Risiko banjir dikesan di ${negeri.join(', ')} (${terjejas.length} PO: ${terjejas.map((p) => p.nama).join(', ')}); ${isyarat}. ${NOTA_RISIKO}.`,
      cadangan: tindakan.join('; ') + '.',
      rincian: terjejas.map((p) => ({
        poId: p.poId,
        hujanMm: (p.hujan && p.hujan.maksHariIniMm) || 0,
        tiupan: 0,
        tahap: tinggi(p) ? 'tinggi' : 'sederhana',
        statusTerburuk: p.statusTerburuk,
        stesen: p.stesenTerdekat,
      })),
      dataStatus: 'rasmi',
      anggaran: true,
    },
  ];
}

/* --- Rangkaian --- */
async function ambilSumber(url, sahkan) {
  const diambil = new Date().toISOString();
  try {
    const j = await util.fetchJson(url);
    const rows = sahkan(j);
    return { rows, status: { status: 'ok', mesej: '', diambil } };
  } catch (e) {
    return { rows: null, status: { status: 'gagal', mesej: redak(e), diambil } };
  }
}
const mestiTatasusunan = (j) => {
  if (!Array.isArray(j)) throw new Error('Format tidak dijangka');
  return j;
};
const ambilNasional = () => ambilSumber(URL_NASIONAL, mestiTatasusunan);
const ambilSelangor = () => ambilSumber(URL_SELANGOR, mestiTatasusunan);
const ambilAmaran = () => ambilSumber(URL_AMARAN, mestiTatasusunan);
const ambilSejarah = () =>
  ambilSumber(URL_SEJARAH, (j) => {
    if (!j || !Array.isArray(j.features)) throw new Error('Format tidak dijangka');
    return j;
  });

/* --- Cache --- */
function bacaCache() {
  return util.bacaJson(laluanCache());
}
function tulisCache(obj) {
  util.tulisJsonAtomik(laluanCache(), obj);
}
function bacaSejarah() {
  return util.bacaJson(laluanSejarah());
}
const umurJam = util.umurJam;

async function muatSejarah(sekarang, lama) {
  const f = bacaSejarah();
  if (f && Array.isArray(f.kawasan) && util.umurJam(f, sekarang) < SEJARAH_MAKS_HARI * 24)
    return {
      kawasan: f.kawasan,
      status: { status: 'ok', mesej: '', diambil: f.fetchedAt, bilangan: f.kawasan.length },
    };
  const r = await ambilSejarah();
  if (r.rows) {
    const kawasan = normalisasiSejarah(r.rows);
    util.tulisJsonAtomik(laluanSejarah(), { fetchedAt: sekarang.toISOString(), kawasan });
    return { kawasan, status: { ...r.status, bilangan: kawasan.length } };
  }
  if (f && Array.isArray(f.kawasan))
    return {
      kawasan: f.kawasan,
      status: {
        status: 'gagal',
        mesej: r.status.mesej + ' (data lama dikekalkan)',
        diambil: f.fetchedAt,
        bilangan: f.kawasan.length,
      },
    };
  return { kawasan: [], status: { ...r.status, bilangan: 0 } };
}

function stesenLama(lama, sumber) {
  return ((lama && lama.stesen) || []).filter((s) => s.sumber === sumber);
}

async function bina(lama = null, sekarang = new Date()) {
  const [nas, sel, aml, sej] = await Promise.all([
    ambilNasional(),
    ambilSelangor(),
    ambilAmaran(),
    muatSejarah(sekarang, lama),
  ]);
  const sumber = {
    jpsNasional: nas.status,
    jpsSelangor: sel.status,
    amaranJps: aml.status,
    sejarahSelangor: sej.status,
  };
  const lamaTanda = (st) => ({ ...st, mesej: st.mesej + ' (data lama dikekalkan)' });

  let rekodNasional;
  if (nas.rows) {
    rekodNasional = normalisasiNasional(nas.rows, sekarang);
    sumber.jpsNasional.bilangan = rekodNasional.length;
    if (!rekodNasional.length) sumber.jpsNasional.status = 'tiada_data';
  } else {
    rekodNasional = stesenLama(lama, SUMBER_NASIONAL);
    if (lama) sumber.jpsNasional = lamaTanda(nas.status);
  }
  let rekodSelangor;
  if (sel.rows) {
    rekodSelangor = normalisasiSelangor(sel.rows, sekarang);
    sumber.jpsSelangor.bilangan = rekodSelangor.length;
    if (!rekodSelangor.length) sumber.jpsSelangor.status = 'tiada_data';
  } else {
    rekodSelangor = stesenLama(lama, SUMBER_SELANGOR);
    if (lama) sumber.jpsSelangor = lamaTanda(sel.status);
  }
  let amaran;
  let amaranDiambil = sekarang.toISOString();
  const sejarahLama = (lama && (lama.amaranSejarah || lama.amaran)) || [];
  if (aml.rows) {
    amaran = normalisasiAmaran(aml.rows, sekarang);
    sumber.amaranJps.bilangan = amaran.length;
  } else if (lama && lama.amaran) {
    amaran = lama.amaran;
    amaranDiambil = lama.amaranDiambil || lama.fetchedAt;
    sumber.amaranJps = lamaTanda(aml.status);
  } else amaran = [];

  return susun({
    rekodNasional,
    rekodSelangor,
    amaran,
    amaranSejarah: gabungSejarahAmaran(sejarahLama, aml.rows ? amaran : [], sekarang),
    amaranDiambil,
    sejarah: sej.kawasan,
    sumber,
    sekarang,
  });
}

// Fungsi tulen: gabung semua sumber ternormal menjadi objek cache (juga digunakan oleh fixture ujian).
function susun({
  rekodNasional = [],
  rekodSelangor = [],
  amaran = [],
  amaranSejarah,
  amaranDiambil,
  sejarah = [],
  sumber = {},
  sekarang = new Date(),
  poList = muatPO(),
  radiusKm = radiusLalai(),
}) {
  const semua = gabungStesen(rekodNasional, rekodSelangor);
  const stesenWL = semua.filter((s) => s.parasAir != null);
  const stesenHujan = semua.filter((s) => s.masaHujan != null);
  const po = terbitPO({ stesenWL, stesenHujan, amaran, sejarah, poList, radiusKm });
  return {
    versi: 1,
    fetchedAt: new Date(sekarang).toISOString(),
    amaranDiambil: amaranDiambil || new Date(sekarang).toISOString(),
    radiusKm,
    sumber,
    atribusi: ATRIBUSI,
    stesen: stesenWL,
    amaran,
    amaranSejarah: amaranSejarah || gabungSejarahAmaran([], amaran, sekarang),
    po,
    senario: bangunSenarioBanjir({ po, sekarang: new Date(sekarang).toISOString() }),
  };
}

let sedangAmbilBendera = false;
async function segar() {
  sedangAmbilBendera = true;
  try {
    const lama = bacaCache();
    const j = await bina(lama);
    const s = j.sumber;
    const semuaGagal = [s.jpsNasional, s.jpsSelangor, s.amaranJps].every(
      (x) => x.status === 'gagal',
    );
    if (semuaGagal && lama) {
      lama.sumber = { ...lama.sumber, ...s };
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
  if (process.env.BANJIR_AUTO === '0') return;
  const selang = selangMin();
  const semak = async () => {
    if (sedangAmbilBendera) return;
    const c = bacaCache();
    if (c && umurJam(c) < selang / 60) return;
    try {
      await segar();
      console.log('Data banjir dikemas kini.');
    } catch (e) {
      console.warn('Gagal mengemas kini data banjir: ' + redak(e));
    }
  };
  semak();
  if (!pemasa) {
    pemasa = setInterval(semak, selang * 6e4);
    pemasa.unref();
  }
}

module.exports = {
  SUMBER_NASIONAL,
  SUMBER_SELANGOR,
  normalisasiNasional,
  normalisasiSelangor,
  gabungStesen,
  normalisasiAmaran,
  gabungSejarahAmaran,
  normalisasiSejarah,
  terbitPO,
  bangunSenarioBanjir,
  susun,
  ambilNasional,
  ambilSelangor,
  ambilAmaran,
  ambilSejarah,
  bina,
  segar,
  bacaCache,
  tulisCache,
  umurJam,
  mulaPenjadual,
  sedangAmbil: () => sedangAmbilBendera,
};

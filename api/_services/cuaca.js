'use strict';
// Pengambil data cuaca sebenar: MET Malaysia (ramalan negeri + amaran) dan Open-Meteo (15 PO).
// Token MET hanya dibaca daripada process.env.MET_API_TOKEN di pelayan; tidak pernah dicetak, disimpan atau dihantar ke pelayar.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* .env tiada: guna nilai persekitaran sedia ada */
}

const TZ = 'Asia/Kuala_Lumpur';
const CACHE_LALAI = path.join(DATA_DIR, 'cuaca-terkini.json');
const MET_BASE_LALAI = 'https://api.met.gov.my/v2';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const NOTA_RISIKO = 'Risiko cuaca ialah anggaran sistem, bukan amaran rasmi.';
const NOTA_SENARIO = 'Dijana daripada data cuaca sebenar (anggaran sistem, bukan amaran rasmi)';
const ATRIBUSI = 'Data cuaca: Open-Meteo.com (CC BY 4.0); MET Malaysia';

// Ambang boleh ubah (satuan: mm, %, km/j).
const AMBANG = {
  hujanSederhanaMm: 10,
  hujanTinggiMm: 30,
  hujanLebatSenarioMm: 30,
  hujanLebatTinggiMm: 50,
  kebarangkalianSederhana: 70,
  kebarangkalianTinggi: 90,
  tiupanSederhana: 40,
  tiupanTinggi: 60,
  berterusanKebarangkalian: 70,
  berterusanMinMm: 1,
  berterusanMinHari: 2,
  berterusanTinggiMm: 60,
  hariSenario: 2,
  hariRamalan: 3,
  amaranHari: 7,
  umurSegarJam: 24,
};

// Negeri (seperti dalam DATA.po) -> LOCATION MET peringkat negeri.
const NEGERI_MET = {
  Johor: 'LOCATION:1',
  Kedah: 'LOCATION:2',
  Kelantan: 'LOCATION:3',
  Melaka: 'LOCATION:6',
  'Negeri Sembilan': 'LOCATION:7',
  Pahang: 'LOCATION:8',
  'Pulau Pinang': 'LOCATION:9',
  Perak: 'LOCATION:10',
  Perlis: 'LOCATION:11',
  Sabah: 'LOCATION:13',
  Sarawak: 'LOCATION:14',
  Selangor: 'LOCATION:15',
  Terengganu: 'LOCATION:16',
};
// PO wakil bagi paparan peringkat negeri (selayang dan simpangrenggam kekal sebagai PO biasa).
const NEGERI_WAKIL_PO = {
  Johor: 'johor',
  Kedah: 'kedah',
  Kelantan: 'kelantan',
  Melaka: 'melaka',
  'Negeri Sembilan': 'negerisembilan',
  Pahang: 'pahang',
  'Pulau Pinang': 'penang',
  Perak: 'perak',
  Perlis: 'perlis',
  Sabah: 'sabah',
  Sarawak: 'sarawak',
  Selangor: 'selangor',
  Terengganu: 'terengganu',
};
const NAMA_NEGERI_AMARAN = [
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
const KATEGORI_AMARAN = [
  ['RAIN', 'hujan'],
  ['THUNDERSTORM2', 'ribut_petir'],
  ['WINDSEA', 'angin_laut'],
  ['CYCLONE', 'siklon'],
];

/* --- Pembantu umum --- */
function redak(mesej) {
  let s = String(mesej && mesej.message ? mesej.message : mesej);
  const t = process.env.MET_API_TOKEN;
  if (t) s = s.split(t).join('***');
  return s.replace(/METToken\s+\S+/gi, 'METToken ***');
}
function tarikhMYT(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d instanceof Date ? d : new Date(d));
}
function tambahHari(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function muatPO() {
  const teks = fs.readFileSync(path.join(ROOT, 'src', 'data', 'dashboard-data.js'), 'utf8');
  const g = {};
  new Function('g', teks.replace(/^\s*const DATA\s*=/m, 'g.DATA ='))(g);
  return g.DATA.po.map((p) => ({
    id: p.id,
    nama: p.name,
    negeri: p.negeri,
    lat: p.lat,
    lon: p.lon,
  }));
}

/* --- Terjemahan --- */
const KAMUS_MET = [
  ['no rain', 'Tiada hujan', '🌤️'],
  ['scattered thunderstorms', 'Ribut petir berselerak', '⛈️'],
  ['isolated thunderstorms', 'Ribut petir terpencil', '⛈️'],
  ['thunderstorms', 'Ribut petir', '⛈️'],
  ['thunderstorm', 'Ribut petir', '⛈️'],
  ['heavy rain', 'Hujan lebat', '🌧️'],
  ['light rain', 'Hujan ringan', '🌦️'],
  ['scattered rain', 'Hujan berselerak', '🌦️'],
  ['isolated rain', 'Hujan terpencil', '🌦️'],
  ['scattered showers', 'Hujan renyai berselerak', '🌦️'],
  ['isolated showers', 'Hujan renyai terpencil', '🌦️'],
  ['showers', 'Hujan renyai', '🌦️'],
  ['rain', 'Hujan', '🌧️'],
  ['fair', 'Cerah', '☀️'],
  ['cloudy', 'Mendung', '☁️'],
];
const SUFIKS_MET = [
  [/\s+in the morning/i, ' pada waktu pagi'],
  [/\s+in the afternoon/i, ' pada waktu petang'],
  [/\s+in the evening/i, ' pada waktu petang'],
  [/\s+at night/i, ' pada waktu malam'],
  [/\s+over inland areas/i, ' di kawasan pedalaman'],
  [/\s+over coastal areas/i, ' di kawasan pesisir'],
];
function terjemahMET(teks) {
  if (typeof teks !== 'string' || !teks.trim()) return '';
  const rendah = teks.toLowerCase();
  const m = KAMUS_MET.find(([k]) => rendah.includes(k));
  if (!m) return teks;
  let bm = m[1];
  SUFIKS_MET.forEach(([re, t]) => {
    if (re.test(teks)) bm += t;
  });
  return bm;
}
function ikonMET(teks) {
  const rendah = String(teks || '').toLowerCase();
  const m = KAMUS_MET.find(([k]) => rendah.includes(k));
  return m ? m[2] : '🌡️';
}
const WMO = {
  0: ['Cerah', '☀️'],
  1: ['Sebahagian besar cerah', '🌤️'],
  2: ['Separa berawan', '⛅'],
  3: ['Mendung', '☁️'],
  45: ['Kabus', '🌫️'],
  48: ['Kabus beku', '🌫️'],
  51: ['Gerimis ringan', '🌦️'],
  53: ['Gerimis', '🌦️'],
  55: ['Gerimis lebat', '🌦️'],
  56: ['Gerimis beku ringan', '🌦️'],
  57: ['Gerimis beku', '🌦️'],
  61: ['Hujan ringan', '🌦️'],
  63: ['Hujan sederhana', '🌧️'],
  65: ['Hujan lebat', '🌧️'],
  66: ['Hujan beku ringan', '🌧️'],
  67: ['Hujan beku lebat', '🌧️'],
  80: ['Hujan mencurah ringan', '🌦️'],
  81: ['Hujan mencurah', '🌧️'],
  82: ['Hujan mencurah lebat', '🌧️'],
  95: ['Ribut petir', '⛈️'],
  96: ['Ribut petir dengan hujan batu', '⛈️'],
  99: ['Ribut petir dengan hujan batu lebat', '⛈️'],
};
function wmoKeBM(kod) {
  const w = WMO[kod];
  return w ? { label: w[0], ikon: w[1] } : { label: 'Tidak diketahui', ikon: '🌡️' };
}

/* --- Risiko --- */
function kiraRisiko({ hujanMm = 0, kebarangkalian = 0, tiupan = 0, metBerat = false } = {}) {
  const sebab = [];
  let tahap = 'Rendah';
  if (hujanMm >= AMBANG.hujanTinggiMm) {
    tahap = 'Tinggi';
    sebab.push(`hujan ${hujanMm} mm`);
  } else if (metBerat && kebarangkalian >= AMBANG.kebarangkalianTinggi) {
    tahap = 'Tinggi';
    sebab.push('MET: ribut petir/hujan lebat, kebarangkalian ' + kebarangkalian + '%');
  } else if (
    hujanMm >= AMBANG.hujanSederhanaMm ||
    kebarangkalian >= AMBANG.kebarangkalianSederhana ||
    tiupan >= AMBANG.tiupanSederhana
  ) {
    tahap = 'Sederhana';
    if (hujanMm >= AMBANG.hujanSederhanaMm) sebab.push(`hujan ${hujanMm} mm`);
    if (kebarangkalian >= AMBANG.kebarangkalianSederhana)
      sebab.push('kebarangkalian hujan ' + kebarangkalian + '%');
    if (tiupan >= AMBANG.tiupanSederhana) sebab.push(`tiupan ${tiupan} km/j`);
  }
  return { tahap, sebab };
}

/* --- Rangkaian --- */
async function fetchJson(url, { headers = {}, timeoutMs = 15000, retries = 1 } = {}) {
  let ralat;
  for (let cuba = 0; cuba <= retries; cuba++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ac.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      ralat = new Error(e && e.name === 'AbortError' ? 'Tamat masa' : redak(e));
    } finally {
      clearTimeout(timer);
    }
  }
  throw ralat;
}
function metBase() {
  return (process.env.MET_API_BASE || MET_BASE_LALAI).replace(/\/+$/, '');
}
function metGet(laluan) {
  const token = process.env.MET_API_TOKEN;
  if (!token) return Promise.reject(new Error('MET_API_TOKEN belum ditetapkan'));
  return fetchJson(metBase() + laluan, { headers: { Authorization: 'METToken ' + token } }).catch(
    (e) => {
      throw new Error(redak(e));
    },
  );
}

function kumpulHariMET(rekod) {
  const hari = {};
  (rekod || []).forEach((r) => {
    const t = String(r.date || '').slice(0, 10);
    if (!t) return;
    const h = (hari[t] = hari[t] || { tarikh: t });
    const nilai = r.value;
    if (r.datatype === 'FGM') h.pagi = nilai;
    else if (r.datatype === 'FGA') h.tengahHari = nilai;
    else if (r.datatype === 'FGN') h.malam = nilai;
    else if (r.datatype === 'FSIGW') h.signifikan = nilai;
    else if (r.datatype === 'FMAXT') h.suhuMax = Number(nilai);
    else if (r.datatype === 'FMINT') h.suhuMin = Number(nilai);
  });
  return Object.values(hari)
    .sort((a, b) => a.tarikh.localeCompare(b.tarikh))
    .map((h) => {
      const utama = h.signifikan || h.tengahHari || h.pagi || h.malam || '';
      return {
        ...h,
        pagiMs: terjemahMET(h.pagi),
        tengahHariMs: terjemahMET(h.tengahHari),
        malamMs: terjemahMET(h.malam),
        keadaan: terjemahMET(utama),
        ikon: ikonMET(utama),
      };
    });
}

async function ambilMET(sekarang = new Date()) {
  const mula = tarikhMYT(sekarang);
  const tamat = tambahHari(mula, AMBANG.hariRamalan - 1);
  const negeri = [];
  const gagal = [];
  for (const [nama, locationId] of Object.entries(NEGERI_MET)) {
    try {
      const j = await metGet(
        `/data?datasetid=FORECAST&datacategoryid=GENERAL&locationid=${encodeURIComponent(locationId)}&start_date=${mula}&end_date=${tamat}`,
      );
      const tarikh = kumpulHariMET(j && j.results);
      if (!tarikh.length) throw new Error('tiada data');
      negeri.push({ negeri: nama, locationId, poWakilId: NEGERI_WAKIL_PO[nama], tarikh });
    } catch (e) {
      gagal.push(nama + ': ' + redak(e));
    }
  }
  return {
    negeri,
    status: negeri.length
      ? { status: 'ok', mesej: gagal.length ? 'Sebahagian gagal: ' + gagal.join('; ') : '' }
      : { status: 'gagal', mesej: gagal[0] || 'Tiada data' },
  };
}

function negeriDalamTeks(teks) {
  const rendah = String(teks || '').toLowerCase();
  const hasil = NAMA_NEGERI_AMARAN.filter((n) => rendah.includes(n.toLowerCase()));
  if (/\bpenang\b/i.test(teks) && !hasil.includes('Pulau Pinang')) hasil.push('Pulau Pinang');
  return hasil;
}
async function ambilAmaranMET(sekarang = new Date()) {
  const hari = tarikhMYT(sekarang);
  const mula = tambahHari(hari, -AMBANG.amaranHari);
  const amaran = [];
  const mesej = [];
  let berjaya = 0;
  try {
    const ds = await metGet('/datasets');
    const ada = ((ds && ds.results) || []).some((d) => d.id === 'WARNING');
    if (!ada)
      return { amaran: [], status: { status: 'tiada_dataset', mesej: 'Dataset WARNING tiada' } };
  } catch (e) {
    return { amaran: [], status: { status: 'gagal', mesej: redak(e) } };
  }
  for (const [kategori, jenis] of KATEGORI_AMARAN) {
    try {
      let offset = 0;
      for (;;) {
        const j = await metGet(
          `/data?datasetid=WARNING&datacategoryid=${kategori}&start_date=${mula}&end_date=${hari}&limit=50&offset=${offset}`,
        );
        const hasil = (j && j.results) || [];
        hasil.forEach((r) => {
          let v = {};
          try {
            v = JSON.parse(r.value);
          } catch {
            return;
          }
          const a = r.attributes || {};
          const tajuk =
            (v.heading && (v.heading.ms || v.heading.en)) ||
            (a.title && (a.title.ms || a.title.en)) ||
            '';
          const t = v.text || {};
          const teks = (t.ms && t.ms.warning) || (t.en && t.en.warning) || '';
          const sahDari = a.valid_from || null;
          const sahHingga = a.valid_to || null;
          const aktif = sahHingga
            ? Date.parse(sahHingga) >= sekarang.getTime()
            : tarikhMYT(r.date) === hari;
          amaran.push({
            id: r.id || a.id || null,
            jenis,
            tajuk,
            teks,
            negeri: negeriDalamTeks(teks),
            dikeluarkan: a.timestamp || r.date || null,
            sah_dari: sahDari,
            sah_hingga: sahHingga,
            aktif,
          });
        });
        const jumlah = (j && j.metadata && j.metadata.resultset && j.metadata.resultset.count) || 0;
        offset += 50;
        if (hasil.length === 0 || offset >= jumlah) break;
      }
      berjaya++;
    } catch (e) {
      mesej.push(kategori + ': ' + redak(e));
    }
  }
  return {
    amaran: dedupeAmaran(amaran.filter((a) => !/tiada nasihat|no advisory/i.test(a.tajuk))),
    status: berjaya
      ? { status: 'ok', mesej: mesej.join('; ') }
      : { status: 'gagal', mesej: mesej[0] || 'Tiada data' },
  };
}
// Buang pendua (id sama, atau tajuk + negeri + tarikh dikeluarkan sama); terbaharu dahulu.
function dedupeAmaran(senarai) {
  const lihat = new Set();
  const hasil = [];
  senarai
    .slice()
    .sort((x, y) => (Date.parse(y.dikeluarkan) || 0) - (Date.parse(x.dikeluarkan) || 0))
    .forEach((a) => {
      const kunci = a.id
        ? 'id|' + a.id
        : [a.tajuk, (a.negeri || []).join(','), a.dikeluarkan].join('|');
      if (lihat.has(kunci)) return;
      lihat.add(kunci);
      hasil.push(a);
    });
  return hasil;
}

async function ambilOpenMeteo(poList) {
  try {
    const q = new URLSearchParams({
      latitude: poList.map((p) => p.lat).join(','),
      longitude: poList.map((p) => p.lon).join(','),
      current:
        'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max',
      timezone: TZ,
      forecast_days: String(AMBANG.hariRamalan),
    });
    const j = await fetchJson(OPEN_METEO_URL + '?' + q.toString());
    const arr = Array.isArray(j) ? j : [j];
    if (arr.length !== poList.length) throw new Error('Bilangan lokasi tidak sepadan');
    const po = poList.map((p, i) => {
      const c = arr[i].current || {};
      const d = arr[i].daily || {};
      const w = wmoKeBM(c.weather_code);
      return {
        poId: p.id,
        nama: p.nama,
        negeri: p.negeri,
        semasa: {
          suhu: c.temperature_2m,
          kelembapan: c.relative_humidity_2m,
          hujan: c.precipitation,
          angin: c.wind_speed_10m,
          tiupan: c.wind_gusts_10m,
          wmoKod: c.weather_code,
          keadaan: w.label,
          ikon: w.ikon,
        },
        harian: (d.time || []).map((t, k) => ({
          tarikh: t,
          wmoKod: d.weather_code && d.weather_code[k],
          keadaan: wmoKeBM(d.weather_code && d.weather_code[k]).label,
          hujanMm: d.precipitation_sum ? d.precipitation_sum[k] : null,
          kebarangkalian: d.precipitation_probability_max
            ? d.precipitation_probability_max[k]
            : null,
          anginMax: d.wind_speed_10m_max ? d.wind_speed_10m_max[k] : null,
          tiupanMax: d.wind_gusts_10m_max ? d.wind_gusts_10m_max[k] : null,
          suhuMin: d.temperature_2m_min ? d.temperature_2m_min[k] : null,
          suhuMax: d.temperature_2m_max ? d.temperature_2m_max[k] : null,
        })),
      };
    });
    return { po, status: { status: 'ok', mesej: '' } };
  } catch (e) {
    return { po: [], status: { status: 'gagal', mesej: redak(e) } };
  }
}

/* --- Gabung --- */
function teksMETHari(negeriRek, tarikh) {
  const h = negeriRek && negeriRek.tarikh.find((x) => x.tarikh === tarikh);
  if (!h) return '';
  return [h.signifikan, h.pagi, h.tengahHari, h.malam].filter(Boolean).join(' | ').toLowerCase();
}
function lengkapiRisiko(negeri, po) {
  const mapNegeri = {};
  negeri.forEach((n) => (mapNegeri[n.negeri] = n));
  po.forEach((p) => {
    p.harian.forEach((h) => {
      const t = teksMETHari(mapNegeri[p.negeri], h.tarikh);
      const metBerat = t.includes('thunderstorm') || t.includes('heavy rain');
      h.risiko = kiraRisiko({
        hujanMm: h.hujanMm || 0,
        kebarangkalian: h.kebarangkalian || 0,
        tiupan: h.tiupanMax || 0,
        metBerat,
      });
    });
  });
}

const URUTAN_SENARIO = [
  ['hujan_lebat', 'Hujan Lebat'],
  ['ribut_petir', 'Ribut Petir & Angin Kencang'],
  ['hujan_berterusan', 'Hujan Berterusan'],
];
const TAHAP_NILAI = { sederhana: 1, tinggi: 2 };
function sumberLabel(set) {
  const s = [];
  if (set.has('MET')) s.push('MET Malaysia');
  if (set.has('OM')) s.push('Open-Meteo');
  return s.join(' + ');
}
// Fungsi tulen: tiada jam tersembunyi; `sekarang` dihantar masuk.
function bangunSenario({ negeri = [], po = [], sekarang } = {}) {
  const now = new Date(sekarang || 0);
  const hariIni = tarikhMYT(now);
  const mapNegeri = {};
  negeri.forEach((n) => (mapNegeri[n.negeri] = n));
  const hasil = {};
  URUTAN_SENARIO.forEach(([jenis]) => (hasil[jenis] = []));

  po.forEach((p) => {
    const hari = (p.harian || []).filter((h) => h.tarikh >= hariIni);
    const hariSen = hari.slice(0, AMBANG.hariSenario);
    const info = (h) => {
      const t = teksMETHari(mapNegeri[p.negeri], h.tarikh);
      return {
        metRibut: t.includes('thunderstorm'),
        metLebat: t.includes('heavy rain'),
      };
    };
    // hujan_lebat
    {
      const d = [];
      hariSen.forEach((h) => {
        const m = info(h);
        const mm = h.hujanMm || 0;
        if (mm >= AMBANG.hujanLebatSenarioMm || m.metLebat) {
          const tinggi =
            mm >= AMBANG.hujanLebatTinggiMm ||
            (mm >= AMBANG.hujanLebatSenarioMm && (m.metRibut || m.metLebat));
          d.push({
            tarikh: h.tarikh,
            tahap: tinggi ? 'tinggi' : 'sederhana',
            hujanMm: mm,
            sumber: [
              mm >= AMBANG.hujanLebatSenarioMm ? 'OM' : null,
              m.metLebat ? 'MET' : null,
            ].filter(Boolean),
          });
        }
      });
      if (d.length) hasil.hujan_lebat.push({ p, d });
    }
    // ribut_petir
    {
      const d = [];
      hariSen.forEach((h) => {
        const m = info(h);
        const g = h.tiupanMax || 0;
        if (m.metRibut || g >= AMBANG.tiupanSederhana) {
          const tinggi = g >= AMBANG.tiupanTinggi || (m.metRibut && g >= AMBANG.tiupanSederhana);
          d.push({
            tarikh: h.tarikh,
            tahap: tinggi ? 'tinggi' : 'sederhana',
            tiupan: g,
            hujanMm: h.hujanMm || 0,
            sumber: [m.metRibut ? 'MET' : null, g >= AMBANG.tiupanSederhana ? 'OM' : null].filter(
              Boolean,
            ),
          });
        }
      });
      if (d.length) hasil.ribut_petir.push({ p, d });
    }
    // hujan_berterusan: hari berturut-turut dengan kebarangkalian tinggi dan hujan
    {
      const lari = hari.slice(0, AMBANG.hariRamalan);
      let terbaik = [];
      let semasa = [];
      lari.forEach((h) => {
        if (
          (h.kebarangkalian || 0) >= AMBANG.berterusanKebarangkalian &&
          (h.hujanMm || 0) >= AMBANG.berterusanMinMm
        ) {
          semasa.push(h);
          if (semasa.length > terbaik.length) terbaik = semasa.slice();
        } else semasa = [];
      });
      if (terbaik.length >= AMBANG.berterusanMinHari) {
        const jumlah = terbaik.reduce((a, h) => a + (h.hujanMm || 0), 0);
        const tinggi = terbaik.length >= 3 && jumlah >= AMBANG.berterusanTinggiMm;
        hasil.hujan_berterusan.push({
          p,
          d: terbaik.map((h) => ({
            tarikh: h.tarikh,
            tahap: tinggi ? 'tinggi' : 'sederhana',
            hujanMm: h.hujanMm || 0,
            kebarangkalian: h.kebarangkalian || 0,
            sumber: ['OM'],
          })),
        });
      }
    }
  });

  const senario = [];
  URUTAN_SENARIO.forEach(([jenis, nama]) => {
    const senarai = hasil[jenis];
    if (!senarai.length) return;
    const id = 'S' + String(senario.length + 1).padStart(2, '0');
    const sumber = new Set();
    const tarikh = [];
    let tahap = 'sederhana';
    let maxMm = 0;
    let maxGust = 0;
    senarai.forEach(({ d }) =>
      d.forEach((x) => {
        (x.sumber || []).forEach((s) => sumber.add(s));
        tarikh.push(x.tarikh);
        if (TAHAP_NILAI[x.tahap] > TAHAP_NILAI[tahap]) tahap = x.tahap;
        maxMm = Math.max(maxMm, x.hujanMm || 0);
        maxGust = Math.max(maxGust, x.tiupan || 0);
      }),
    );
    tarikh.sort();
    const negeriTerlibat = [...new Set(senarai.map(({ p }) => p.negeri))];
    const namaPO = senarai.map(({ p }) => p.nama);
    const isyarat =
      jenis === 'ribut_petir'
        ? `tiupan maksimum ${maxGust} km/j`
        : jenis === 'hujan_lebat'
          ? `hujan maksimum ${maxMm} mm sehari`
          : `hujan maksimum ${maxMm} mm sehari, kebarangkalian tinggi berturut-turut`;
    const ringkasan = `${nama} dianggarkan di ${negeriTerlibat.join(', ')} (${senarai.length} PO: ${namaPO.join(', ')}) pada ${tarikh[0]}${tarikh[tarikh.length - 1] !== tarikh[0] ? ' hingga ' + tarikh[tarikh.length - 1] : ''}; ${isyarat}. Ringkasan dijana sistem daripada data cuaca (bukan model AI).`;
    const tindakan = {
      hujan_lebat: [
        'Semak akses logistik dan keadaan pusat pengumpulan di PO terlibat',
        'Semak stok komoditi mudah rosak dan kapasiti bilik sejuk',
        'Sediakan pilihan mobilisasi bekalan daripada PO lain jika gangguan disahkan',
      ],
      ribut_petir: [
        'Semak keselamatan pusat pengumpulan dan kenderaan di PO terlibat',
        'Laraskan jadual penghantaran mengikut keadaan cuaca',
        'Pantau perkembangan amaran rasmi MET Malaysia',
      ],
      hujan_berterusan: [
        'Semak status pengeluaran dan stok komoditi di PO terlibat',
        'Pantau laluan penghantaran yang berisiko',
        'Sediakan pilihan mobilisasi bekalan daripada PO lain dalam zon yang sama',
      ],
    }[jenis];
    senario.push({
      scenarioId: id,
      scenarioName: nama,
      warningType: jenis,
      source: sumberLabel(sumber) || 'Open-Meteo',
      issuedAt: now.toISOString(),
      validFrom: tarikh[0] + 'T00:00:00+08:00',
      validUntil: tarikh[tarikh.length - 1] + 'T23:59:59+08:00',
      affectedStates: negeriTerlibat,
      affectedDistricts: [],
      affectedPOIds: senarai.map(({ p }) => p.poId),
      riskLevel: tahap,
      affectedCommodities: [],
      recommendedActions: tindakan,
      ringkasan,
      cadangan: tindakan.join('; ') + '.',
      rincian: senarai.map(({ p, d }) => ({
        poId: p.poId,
        hujanMm: Math.max(...d.map((x) => x.hujanMm || 0)),
        tiupan: Math.max(...d.map((x) => x.tiupan || 0)),
        tahap: d.reduce(
          (a, x) => (TAHAP_NILAI[x.tahap] > TAHAP_NILAI[a] ? x.tahap : a),
          'sederhana',
        ),
      })),
      dataStatus: 'sebenar',
      anggaran: true,
    });
  });
  return senario;
}

/* --- Cache --- */
function laluanCache() {
  return process.env.CUACA_CACHE_FILE || CACHE_LALAI;
}
function bacaCache() {
  try {
    return JSON.parse(fs.readFileSync(laluanCache(), 'utf8'));
  } catch {
    return null;
  }
}
function tulisCache(obj) {
  const f = laluanCache();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f);
}
function umurJam(obj, sekarang = Date.now()) {
  const t = obj && Date.parse(obj.fetchedAt);
  return Number.isNaN(t) || t == null ? Infinity : (sekarang - t) / 36e5;
}

async function bina(lama = null) {
  const sekarang = new Date();
  const poList = muatPO();
  const [met, amaran, om] = await Promise.all([
    ambilMET(sekarang),
    ambilAmaranMET(sekarang),
    ambilOpenMeteo(poList),
  ]);
  const sumber = { met: met.status, metAmaran: amaran.status, openMeteo: om.status };
  let negeri = met.negeri;
  let po = om.po;
  let aml = amaran.amaran;
  let amlDiambil = sekarang.toISOString();
  if (lama) {
    if (met.status.status === 'gagal' && lama.negeri) {
      negeri = lama.negeri;
      sumber.met = { status: 'gagal', mesej: met.status.mesej + ' (data lama dikekalkan)' };
    }
    if (om.status.status === 'gagal' && lama.po) {
      po = lama.po;
      sumber.openMeteo = { status: 'gagal', mesej: om.status.mesej + ' (data lama dikekalkan)' };
    }
    if (amaran.status.status === 'gagal' && lama.amaran) {
      aml = lama.amaran;
      amlDiambil = lama.amaranDiambil || lama.fetchedAt;
      sumber.metAmaran = {
        status: 'gagal',
        mesej: amaran.status.mesej + ' (data lama dikekalkan)',
      };
    }
  }
  lengkapiRisiko(negeri, po);
  return {
    versi: 1,
    fetchedAt: sekarang.toISOString(),
    amaranDiambil: amlDiambil,
    sumber,
    negeri,
    po,
    amaran: aml,
    senario: bangunSenario({ negeri, po, sekarang: sekarang.toISOString() }),
    senarioNota: NOTA_SENARIO,
    nota: NOTA_RISIKO,
    atribusi: ATRIBUSI,
  };
}
let sedangAmbil = false;
async function segar() {
  sedangAmbil = true;
  try {
    return await segarDalam();
  } finally {
    sedangAmbil = false;
  }
}
async function segarDalam() {
  const lama = bacaCache();
  const j = await bina(lama);
  const semuaGagal = Object.values(j.sumber).every((s) => s.status === 'gagal');
  if (semuaGagal && lama) {
    lama.sumber = j.sumber;
    return { data: lama, ditulis: false };
  }
  if (!semuaGagal) tulisCache(j);
  return { data: j, ditulis: !semuaGagal };
}

let pemasa = null;
function mulaPenjadual() {
  if (process.env.CUACA_AUTO === '0') return;
  const semak = async () => {
    const c = bacaCache();
    if (c && umurJam(c) < AMBANG.umurSegarJam) return;
    try {
      await segar();
      console.log('Data cuaca dikemas kini.');
    } catch (e) {
      console.warn('Gagal mengemas kini data cuaca: ' + redak(e));
    }
  };
  semak();
  if (!pemasa) {
    pemasa = setInterval(semak, 36e5);
    pemasa.unref();
  }
}

module.exports = {
  AMBANG,
  NEGERI_MET,
  NEGERI_WAKIL_PO,
  terjemahMET,
  wmoKeBM,
  kiraRisiko,
  fetchJson,
  ambilMET,
  ambilAmaranMET,
  dedupeAmaran,
  negeriDalamTeks,
  ambilOpenMeteo,
  bangunSenario,
  bina,
  segar,
  tulisCache,
  bacaCache,
  umurJam,
  mulaPenjadual,
  sedangAmbil: () => sedangAmbil,
  muatPO,
};

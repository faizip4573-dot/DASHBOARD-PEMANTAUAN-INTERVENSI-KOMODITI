'use strict';
// Ambil pemetaan Pusat Operasi -> negeri -> daerah daripada model semantik Power BI (FIS Version 2.1, jadual 'Master')
// dan tulis config/pemetaan-po-fis.json (dikesan git) serta cerminan src/data/pemetaan-po-fis.js untuk pelayar.
// Pelayan tidak memanggil Power BI semasa jalan; ia hanya membaca config. Rahsia (PBI_*) dibaca daripada .env dan tidak dicetak.
// Guna: npm run po:ambil   (pilihan: --mentah untuk mencetak nilai Negeri mentah)
const fs = require('node:fs');
const path = require('node:path');
const { normDaerahDb } = require('../api/_services/pemetaan-po.js');

const ROOT = path.join(__dirname, '..');
const FAIL_CONFIG = path.join(ROOT, 'config', 'pemetaan-po-fis.json');
const FAIL_CERMIN = path.join(ROOT, 'src', 'data', 'pemetaan-po-fis.js');
const FAIL_GEO = path.join(ROOT, 'src', 'data', 'geo', 'malaysia_district.geojson');

// Jadual lalai (boleh disunting terus dalam config/pemetaan-po-fis.json; larian seterusnya mengekalkan suntingan).
const ALIAS_LALAI = {
  // PO utama (15): nama FIS -> id dashboard
  po: [
    { fisNama: 'KBS Kangar', id: 'perlis', nota: 'PO Kangar' },
    { fisNama: 'Pusat Operasi Alor Setar', id: 'kedah', nota: 'PO Alor Setar' },
    { fisNama: 'Pusat Operasi Perai', id: 'penang', nota: 'PO Perai' },
    { fisNama: 'Pusat Operasi Simpang Pulai', id: 'perak', nota: 'PO Simpang Pulai' },
    { fisNama: 'KBS Pusat Operasi Selayang', id: 'selayang', nota: 'PO Selayang' },
    { fisNama: 'Pusat Operasi KBS FAMA Dengkil', id: 'selangor', nota: 'PO Dengkil' },
    { fisNama: 'Pusat Operasi Seremban', id: 'negerisembilan', nota: 'PO Seremban' },
    { fisNama: 'Pusat Operasi Ayer Keroh', id: 'melaka', nota: 'PO Ayer Keroh' },
    {
      fisNama: 'Pusat Operasi Kota Bahru',
      id: 'kelantan',
      nota: "FIS 'Kota Bahru' = dashboard 'Kota Baharu'",
    },
    {
      fisNama: 'Pusat Operasi KBS FAMA Chendering, Kuala Terengganu',
      id: 'terengganu',
      nota: "FIS 'Chendering, Kuala Terengganu' = dashboard 'Kuala Terengganu'",
    },
    { fisNama: 'Pusat Operasi KBS FAMA Kuantan', id: 'pahang', nota: 'PO Kuantan' },
    {
      fisNama: 'KBS Tampoi /Pusat Operasi Johor Bahru',
      id: 'johor',
      nota: "FIS 'KBS Tampoi /Pusat Operasi Johor Bahru' = dashboard 'Johor Baharu'",
    },
    { fisNama: 'Pusat Operasi Simpang Renggam', id: 'simpangrenggam', nota: 'PO Simpang Renggam' },
    { fisNama: 'Pusat Operasi Kota Kinabalu', id: 'sabah', nota: 'PO Kota Kinabalu' },
    {
      fisNama: 'Pusat Operasi Samarahan',
      id: 'sarawak',
      nota: "Disahkan pengguna: dashboard 'Samarahan' = FIS 'Pusat Operasi Samarahan' (Betong, Samarahan). 'Pusat Operasi Kota Samarahan' (Kuching) ialah PO tambahan.",
    },
  ],
  perluDisahkan: [],
  // Label pendek untuk PO utama (nama dashboard) dan PO tambahan
  label: {
    'KBS Kangar': 'Kangar',
    'Pusat Operasi Alor Setar': 'Alor Setar',
    'Pusat Operasi Perai': 'Perai',
    'Pusat Operasi Simpang Pulai': 'Simpang Pulai',
    'KBS Pusat Operasi Selayang': 'Selayang',
    'Pusat Operasi KBS FAMA Dengkil': 'Dengkil',
    'Pusat Operasi Seremban': 'Seremban',
    'Pusat Operasi Ayer Keroh': 'Ayer Keroh',
    'Pusat Operasi Kota Bahru': 'Kota Baharu',
    'Pusat Operasi KBS FAMA Chendering, Kuala Terengganu': 'Kuala Terengganu',
    'Pusat Operasi KBS FAMA Kuantan': 'Kuantan',
    'KBS Tampoi /Pusat Operasi Johor Bahru': 'Johor Baharu',
    'Pusat Operasi Simpang Renggam': 'Simpang Renggam',
    'Pusat Operasi Kota Kinabalu': 'Kota Kinabalu',
    'Pusat Operasi Samarahan': 'Samarahan',
    'Pusat Operasi KBS Kuala Selangor': 'Kuala Selangor',
    'Pusat Operasi Pasar Borong Kuala Lumpur': 'Pasar Borong KL',
  },
  // Nama daerah FIS (huruf besar) -> nama dalam DB Harga (Supabase)
  daerahDb: {
    'HULU PERAK': 'ULU PERAK',
    LIPIS: 'KUALA LIPIS',
    MANJUNG: 'MANJUNG DINDING',
  },
  // Nama daerah FIS (huruf besar) -> nama dalam GeoJSON src/data/geo
  daerahGeo: {
    'LARUT, MATANG DAN SELAMA': 'Larut, Matang & Selama',
    'KUALA LUMPUR': 'W.P. Kuala Lumpur',
    TITIWANGSA: 'W.P. Kuala Lumpur',
    PUTRAJAYA: 'W.P. Putrajaya',
    LABUAN: 'W.P. Labuan',
  },
};

const DAX_PEMETAAN =
  "EVALUATE SUMMARIZECOLUMNS('Master'[Pusat Operasi], 'Master'[Negeri], 'Master'[Daerah], \"n\", COUNTROWS('Master'), \"maks\", MAX('Master'[Tarikh]))";

/* --- Fungsi tulen (diuji dalam tests/api/pemetaan-po-unit.js) --- */
const bersih = (s) => (s == null ? '' : String(s).normalize('NFKC').replace(/\s+/g, ' ').trim());
const besar = (s) => bersih(s).toUpperCase();

// Negeri FIS (campur huruf) -> nilai negeri dashboard/Supabase (huruf besar). Nilai gabungan Selangor + WP dipecah ikut daerah.
function normNegeriFis(negeri, daerah) {
  const n = besar(negeri).replace(/\./g, '');
  const d = besar(daerah);
  if (d === 'LABUAN') return 'LABUAN';
  if (n.includes('SELANGOR') && /KUALA LUMPUR|PUTRAJAYA/.test(n)) {
    if (d === 'KUALA LUMPUR' || d === 'TITIWANGSA') return 'KUALA LUMPUR';
    if (d === 'PUTRAJAYA') return 'PUTRAJAYA';
    return 'SELANGOR';
  }
  const tanpaWp = n.replace(/^(WP|WILAYAH PERSEKUTUAN)\s+/, '');
  if (tanpaWp === 'N SEMBILAN') return 'NEGERI SEMBILAN';
  if (tanpaWp === 'P PINANG') return 'PULAU PINANG';
  return tanpaWp.replace(/BAHARU/g, 'BHARU');
}
function labelUntuk(fisNama, label = ALIAS_LALAI.label) {
  if (label[fisNama]) return label[fisNama];
  let s = bersih(fisNama)
    .replace(/^Kompleks Bilik Sejuk FAMA\s+/i, 'KBS ')
    .replace(/^KBS Pusat Operasi\s+/i, '')
    .replace(/^Pusat Operasi\s+/i, '')
    .replace(/^KBS FAMA\s+/i, 'KBS ');
  return s;
}
/* --- Geometri: titik tengah daerah (GeoJSON src/data/geo) --- */
const normGeo = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/baharu/g, 'bharu')
    .replace(/[^a-z0-9]/g, '');
function cariFitur(geo, nama, aliasGeo = {}) {
  if (!geo || !geo.features) return null;
  const alias = Object.fromEntries(
    Object.entries(aliasGeo).map(([k, v]) => [normGeo(k), normGeo(v)]),
  );
  const k = normGeo(nama);
  const sasaran = alias[k] || k;
  return geo.features.find((f) => normGeo(f.properties.name) === sasaran) || null;
}
// Luas dan sentroid satu gelang (satah lon/lat; cukup untuk titik anggaran). Orientasi gelang tidak mempengaruhi sentroid.
function gelang(r) {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[i + 1];
    const c = x0 * y1 - x1 * y0;
    a2 += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (!a2) return null;
  return { luas: Math.abs(a2) / 2, lon: cx / (3 * a2), lat: cy / (3 * a2) };
}
function sentroidGeom(g) {
  const poligon =
    g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let luas = 0;
  let sx = 0;
  let sy = 0;
  for (const p of poligon)
    p.forEach((r, i) => {
      const q = gelang(r);
      if (!q) return;
      const w = i === 0 ? q.luas : -q.luas; // lubang ditolak
      luas += w;
      sx += q.lon * w;
      sy += q.lat * w;
    });
  return luas > 0 ? { luas, lon: sx / luas, lat: sy / luas } : null;
}
// Titik tengah berpemberat luas bagi senarai fitur (gabungan poligon daerah).
function titikTengah(fitur) {
  let luas = 0;
  let sx = 0;
  let sy = 0;
  for (const f of fitur) {
    const s = sentroidGeom(f.geometry);
    if (!s) continue;
    luas += s.luas;
    sx += s.lon * s.luas;
    sy += s.lat * s.luas;
  }
  return luas > 0 ? { lat: +(sy / luas).toFixed(5), lon: +(sx / luas).toFixed(5) } : null;
}

// rows = [{po, negeri, daerah, n, maks}] daripada DAX. Baris tanpa PO atau negeri diabaikan (dilaporkan sebagai tiadaPo).
function bangunKonfig(
  rows,
  { alias = ALIAS_LALAI, tarikh, dataset = 'FIS Version 2.1', geo = null } = {},
) {
  const poMap = new Map();
  let tiadaPo = 0;
  for (const r of rows) {
    const nama = bersih(r.po);
    if (!nama || !bersih(r.negeri)) {
      tiadaPo += Number(r.n) || 0;
      continue;
    }
    let p = poMap.get(nama);
    if (!p)
      poMap.set(
        nama,
        (p = { fisNama: nama, daerah: new Map(), fitur: new Map(), baris: 0, terkini: null }),
      );
    p.baris += Number(r.n) || 0;
    const t = r.maks ? String(r.maks).slice(0, 10) : null;
    if (t && (!p.terkini || t > p.terkini)) p.terkini = t;
    const neg = normNegeriFis(r.negeri, r.daerah);
    const dNama = bersih(r.daerah);
    if (!dNama) continue;
    const kunci = neg + '|' + besar(dNama);
    if (!p.daerah.has(kunci)) {
      const ft = cariFitur(geo, dNama, alias.daerahGeo);
      const d = { nama: dNama, negeri: neg };
      const s = ft && sentroidGeom(ft.geometry);
      if (s) {
        d.lat = +s.lat.toFixed(5);
        d.lon = +s.lon.toFixed(5);
      }
      p.daerah.set(kunci, d);
      if (ft) p.fitur.set(ft.properties.name, ft);
    }
  }
  const utamaPeta = new Map(alias.po.map((a) => [a.fisNama, a]));
  const tiadaUtama = alias.po.filter((a) => !poMap.has(a.fisNama)).map((a) => a.fisNama);
  const po = [...poMap.values()]
    .map((p) => {
      const daerah = [...p.daerah.values()].sort(
        (a, b) => a.negeri.localeCompare(b.negeri, 'ms') || a.nama.localeCompare(b.nama, 'ms'),
      );
      const kira = {};
      daerah.forEach((d) => (kira[d.negeri] = (kira[d.negeri] || 0) + 1));
      const negeriSemua = Object.keys(kira).sort(
        (a, b) => kira[b] - kira[a] || a.localeCompare(b, 'ms'),
      );
      const u = utamaPeta.get(p.fisNama);
      const o = {
        fisNama: p.fisNama,
        label: labelUntuk(p.fisNama, alias.label),
        negeri: negeriSemua[0],
        negeriSemua,
        daerah,
        utama: !!u,
      };
      if ((alias.perluDisahkan || []).includes(p.fisNama)) o.perluDisahkan = true;
      if (u) o.id = u.id;
      else
        o.id =
          'tbh-' +
          o.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
      const tt = titikTengah([...p.fitur.values()]);
      if (tt) o.titik = { ...tt, anggaran: true, asas: 'titik tengah daerah seliaan (GeoJSON)' };
      o.baris = p.baris;
      o.terkini = p.terkini;
      return o;
    })
    // utama dahulu (ikut susunan alias), kemudian tambahan A-Z
    .sort((a, b) => {
      if (a.utama !== b.utama) return a.utama ? -1 : 1;
      if (a.utama) {
        const i = (x) => alias.po.findIndex((q) => q.fisNama === x.fisNama);
        return i(a) - i(b);
      }
      return a.label.localeCompare(b.label, 'ms');
    });
  return {
    konfig: {
      versi: 1,
      sumber: {
        dataset,
        jadual: 'Master',
        lajur: ['Pusat Operasi', 'Negeri', 'Daerah'],
        tarikhSnapshot: tarikh,
        status: 'disahkan (FIS 2.1)',
        kaedah:
          'Power BI executeQueries (service principal), diambil luar talian oleh npm run po:ambil',
      },
      alias: {
        po: alias.po,
        perluDisahkan: alias.perluDisahkan,
        label: alias.label,
        daerahDb: alias.daerahDb,
        daerahGeo: alias.daerahGeo,
      },
      po,
    },
    tiadaPo,
    tiadaUtama,
  };
}
const kandunganCermin = (konfig) =>
  '/* Dijana oleh scripts/ambil-pemetaan-po-pbi.js daripada config/pemetaan-po-fis.json. Jangan sunting; ubah config lalu jalankan semula. */\n' +
  'const PEMETAAN_PO_FIS = ' +
  JSON.stringify(konfig) +
  ';\n';

/* --- Power BI --- */
function bacaEnv() {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
  return env;
}
async function ambilBaris(env) {
  const perlu = [
    'PBI_TENANT_ID',
    'PBI_CLIENT_ID',
    'PBI_CLIENT_SECRET',
    'PBI_WORKSPACE_ID',
    'PBI_DATASET_ID',
  ];
  const tiada = perlu.filter((k) => !env[k]);
  if (tiada.length) throw new Error('Tiada pembolehubah env: ' + tiada.join(', '));
  const tok = await fetch(
    `https://login.microsoftonline.com/${env.PBI_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.PBI_CLIENT_ID,
        client_secret: env.PBI_CLIENT_SECRET,
        scope: 'https://analysis.windows.net/powerbi/api/.default',
      }),
    },
  );
  const tj = await tok.json().catch(() => ({}));
  if (!tok.ok) throw new Error('Token gagal: HTTP ' + tok.status + ' ' + (tj.error || ''));
  const H = { Authorization: 'Bearer ' + tj.access_token, 'Content-Type': 'application/json' };
  const base = `https://api.powerbi.com/v1.0/myorg/groups/${env.PBI_WORKSPACE_ID}/datasets/${env.PBI_DATASET_ID}`;
  const ds = await fetch(base, { headers: H });
  const dj = await ds.json().catch(() => ({}));
  const r = await fetch(base + '/executeQueries', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      queries: [{ query: DAX_PEMETAAN }],
      serializerSettings: { includeNulls: true },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('executeQueries gagal: HTTP ' + r.status);
  const t = j.results && j.results[0] && j.results[0].tables && j.results[0].tables[0];
  if (!t || t.error) throw new Error('DAX gagal');
  const rows = (t.rows || []).map((x) => ({
    po: x['Master[Pusat Operasi]'],
    negeri: x['Master[Negeri]'],
    daerah: x['Master[Daerah]'],
    n: x['[n]'],
    maks: x['[maks]'],
  }));
  return { rows, dataset: dj.name || 'FIS Version 2.1' };
}
function muatAlias() {
  try {
    const lama = JSON.parse(fs.readFileSync(FAIL_CONFIG, 'utf8'));
    if (lama && lama.alias && lama.alias.po) {
      const a = lama.alias;
      return {
        po: a.po,
        perluDisahkan: a.perluDisahkan || ALIAS_LALAI.perluDisahkan,
        label: { ...ALIAS_LALAI.label, ...a.label },
        daerahDb: { ...ALIAS_LALAI.daerahDb, ...a.daerahDb },
        daerahGeo: { ...ALIAS_LALAI.daerahGeo, ...a.daerahGeo },
      };
    }
  } catch (_) {}
  return ALIAS_LALAI;
}
async function utama() {
  const env = bacaEnv();
  const { rows, dataset } = await ambilBaris(env);
  if (process.argv.includes('--mentah')) {
    console.log([...new Set(rows.map((r) => r.negeri))].join(' | '));
  }
  const tarikh = new Date().toISOString().slice(0, 10);
  const geo = JSON.parse(fs.readFileSync(FAIL_GEO, 'utf8'));
  const hasil = bangunKonfig(rows, { alias: muatAlias(), tarikh, dataset, geo });
  if (hasil.tiadaUtama.length) {
    console.error('PO utama tiada dalam FIS: ' + hasil.tiadaUtama.join('; '));
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(FAIL_CONFIG), { recursive: true });
  fs.writeFileSync(FAIL_CONFIG, JSON.stringify(hasil.konfig, null, 2) + '\n');
  fs.writeFileSync(FAIL_CERMIN, kandunganCermin(hasil.konfig));
  const utamaBil = hasil.konfig.po.filter((p) => p.utama).length;
  console.log(
    `Dataset: ${dataset}. PO: ${hasil.konfig.po.length} (utama ${utamaBil}, tambahan ${hasil.konfig.po.length - utamaBil}). Baris tanpa PO/negeri diabaikan: ${hasil.tiadaPo}.`,
  );
  for (const p of hasil.konfig.po)
    console.log(
      `${p.utama ? 'U' : 'T'} ${p.label} [${p.negeriSemua.join('+')}] ${p.daerah.length} daerah, ${p.baris} baris, terkini ${p.terkini}`,
    );
}

module.exports = {
  ALIAS_LALAI,
  DAX_PEMETAAN,
  normNegeriFis,
  normDaerahDb,
  labelUntuk,
  cariFitur,
  sentroidGeom,
  titikTengah,
  bangunKonfig,
  kandunganCermin,
};
if (require.main === module)
  utama().catch((e) => {
    console.error('Gagal: ' + String(e && e.message ? e.message : e).slice(0, 200));
    process.exitCode = 1;
  });

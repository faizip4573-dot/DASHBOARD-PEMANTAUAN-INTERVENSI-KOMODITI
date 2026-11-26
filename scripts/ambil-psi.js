'use strict';
// Ambil siri bulanan untuk Harga Cadangan PSI (Prompt_Dashboard_Harga_Cadangan_PSI.md) dan tulis
// data/processed/psi-bulanan.json (diabaikan git). Pelayan hanya membaca fail ini (api/_services/psi.js).
//   AMI   : DB Harga (Supabase) harga_ladang_mingguan / harga_borong_mingguan -> purata bulanan setiap PO utama
//           (purata harian daerah -> purata PO harian -> purata bulan; hierarki sama dengan dashboard)
//   FIS   : Power BI FIS Version 2.1, jadual Master, Sumber = FIS, Peringkat LADANG (Belian) / BORONG (Jualan);
//           "Tiada Maklumat" dikecualikan. Purata harga transaksi bulanan setiap PO (lajur pusat operasi) dan varieti
//           mengikut config/psi-padanan-fis.json
//   SISDA : Supabase v3_harga_forecast_2026, analysis_level NEGERI, LADANG/BORONG (unjuran bulanan)
// Rahsia (.env: DB_HARGA_*, PBI_*) tidak dicetak. Guna: npm run psi:ambil
const fs = require('node:fs');
const path = require('node:path');
const util = require('../api/_services/util-rangkaian.js');
const kira = require('../api/_services/harga-db-kira.js');
const hargaDb = require('../api/_services/harga-db.js');
const psiKira = require('../api/_services/psi-kira.js');

const ROOT = path.join(__dirname, '..');
const FAIL_OUT = process.env.PSI_FILE || path.join(ROOT, 'data', 'processed', 'psi-bulanan.json');
const FAIL_PADANAN = path.join(ROOT, 'config', 'psi-padanan-fis.json');
const FAIL_PO = path.join(ROOT, 'config', 'pemetaan-po-fis.json');
const ARAS = ['LADANG', 'BORONG'];

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* .env tiada */
}
const env = process.env;
const rahsia = () =>
  [env.DB_HARGA_URL, env.DB_HARGA_PUBLISHABLE_KEY, env.PBI_CLIENT_SECRET].filter(Boolean);
const tapisRahsia = (s) => rahsia().reduce((a, r) => a.split(r).join('***'), String(s));
const ym = (t) => String(t).slice(0, 7);

/* --- Supabase --- */
function ctxSupabase() {
  const url = String(env.DB_HARGA_URL || '').replace(/\/+$/, '');
  const kunci = String(env.DB_HARGA_PUBLISHABLE_KEY || '');
  if (!url || !kunci) throw new Error('DB_HARGA_URL / DB_HARGA_PUBLISHABLE_KEY tiada dalam .env');
  return { url, kunci, fetchJson: util.fetchJson, timeoutMs: 30000, retries: 3, backoffMs: 1500 };
}
const ambil = (jadual, opts, c) => hargaDb.ambilHalaman(jadual, opts, c);

async function bulanTerkiniAmi(c) {
  let maks = null;
  for (const [jadual] of hargaDb.JADUAL.filter((x) => ARAS.includes(x[1]))) {
    const r = await ambil(
      jadual,
      { select: 'tarikh_akhir', order: 'tarikh_akhir.desc', satu: true },
      c,
    );
    if (r[0] && (!maks || r[0].tarikh_akhir > maks)) maks = r[0].tarikh_akhir;
  }
  return maks;
}

async function ambilAmi(c, mula) {
  const idKecuali = String(env.DB_HARGA_EXCLUDE_IDS ?? hargaDb.ID_KECUALI_LALAI)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const siri = {}; // "P|po|variety" -> {YYYY-MM: harga}
  const unit = {};
  const terkini = {};
  for (const [jadual, P] of hargaDb.JADUAL.filter((x) => ARAS.includes(x[1]))) {
    const rows = await ambil(
      jadual,
      {
        select:
          'id,created_at,tarikh_akhir,avg_harga,commodity,commodity_variety_name,negeri,daerah,unit',
        tapis: [['tarikh_akhir', 'gte.' + mula]],
        order: 'id.asc',
      },
      c,
    );
    const { simpan } = kira.kecualiBaris(rows, { idKecuali });
    // purata harian daerah -> PO harian (purata daerah) -> bulan (purata hari)
    const harian = new Map(); // po|v|t -> [jum, n]
    for (const e of kira.agregatHarian(simpan)) {
      const po = kira.poUntuk(e.n, e.d);
      if (!po) continue;
      const k = po + '\u0001' + e.v + '\u0001' + e.t;
      const x = harian.get(k) || [0, 0];
      x[0] += e.h;
      x[1]++;
      harian.set(k, x);
      unit[e.v] = e.u;
      if (!terkini[P] || e.t > terkini[P]) terkini[P] = e.t;
    }
    const bulan = new Map(); // P|po|v -> ym -> [jum, n]
    for (const [k, [j, n]] of harian) {
      const [po, v, t] = k.split('\u0001');
      const kk = P + '|' + po + '|' + v;
      if (!bulan.has(kk)) bulan.set(kk, new Map());
      const m = bulan.get(kk);
      const x = m.get(ym(t)) || [0, 0];
      x[0] += j / n;
      x[1]++;
      m.set(ym(t), x);
    }
    for (const [kk, m] of bulan)
      siri[kk] = Object.fromEntries([...m].map(([b, [j, n]]) => [b, +(j / n).toFixed(4)]));
    console.log(`AMI ${P}: ${rows.length} baris sejak ${mula}, ${bulan.size} kunci PO x varieti`);
  }
  return { siri, unit, terkini };
}

async function ambilSisda(c) {
  const rows = await ambil(
    'v3_harga_forecast_2026',
    {
      select:
        'geo_name,negeri,commodity_variety_name,peringkat,forecast_year,forecast_month,forecast_price,mape,created_at',
      tapis: [
        ['analysis_level', 'eq.NEGERI'],
        ['peringkat', 'in.(LADANG,BORONG)'],
      ],
      order: 'id.asc',
    },
    c,
  );
  const siri = {}; // "P|NEGERI|variety" -> {YYYY-MM: unjuran}
  let dijana = null,
    bulanAkhir = null;
  for (const r of rows) {
    const p = Number(r.forecast_price);
    if (!Number.isFinite(p) || !r.forecast_year || !r.forecast_month) continue;
    const n = kira.normNegeri(r.geo_name || r.negeri);
    const k =
      String(r.peringkat).toUpperCase() + '|' + n + '|' + kira.normNama(r.commodity_variety_name);
    const b = r.forecast_year + '-' + String(r.forecast_month).padStart(2, '0');
    (siri[k] || (siri[k] = {}))[b] = +p.toFixed(4);
    if (r.created_at && (!dijana || r.created_at > dijana)) dijana = r.created_at;
    if (!bulanAkhir || b > bulanAkhir) bulanAkhir = b;
  }
  console.log(`SISDA: ${rows.length} baris (NEGERI), ${Object.keys(siri).length} kunci`);
  return { siri, dijana, bulanAkhir };
}

/* --- Power BI FIS --- */
async function ambilFis(mula, padanan) {
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
  if (!tok.ok) throw new Error('Token Power BI gagal: HTTP ' + tok.status);
  const H = { Authorization: 'Bearer ' + tj.access_token, 'Content-Type': 'application/json' };
  const base = `https://api.powerbi.com/v1.0/myorg/groups/${env.PBI_WORKSPACE_ID}/datasets/${env.PBI_DATASET_ID}`;
  const ds = await (await fetch(base, { headers: H })).json().catch(() => ({}));
  const varieti = [...new Set(padanan.flatMap((p) => p.fis.map((f) => f.varieti)))];
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const [y, m, d] = mula.split('-').map(Number);
  const dax = `EVALUATE CALCULATETABLE(
  SUMMARIZECOLUMNS('Master'[pusat operasi], 'Master'[Varieti], 'Master'[Peringkat], 'Master'[Unit], 'Master'[Tarikh],
    "jum", SUM('Master'[Harga]), "n", COUNTROWS('Master')),
  'Master'[Sumber] = "FIS", 'Master'[Peringkat] IN {"LADANG", "BORONG"},
  'Master'[Tarikh] >= DATE(${y}, ${m}, ${d}), 'Master'[Varieti] IN {${varieti.map(q).join(', ')}})`;
  const r = await fetch(base + '/executeQueries', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('executeQueries FIS gagal: HTTP ' + r.status);
  const t = j.results && j.results[0] && j.results[0].tables && j.results[0].tables[0];
  if (!t || t.error) throw new Error('DAX FIS gagal');
  return { rows: t.rows || [], dataset: ds.name || 'FIS Version 2.1' };
}

function prosesFis(rows, padanan, poKonfig) {
  const poIkutNama = new Map(
    (poKonfig.po || [])
      .filter((p) => p.utama)
      .map((p) => [String(p.fisNama).trim().toUpperCase(), p.id]),
  );
  for (const a of (poKonfig.alias && poKonfig.alias.po) || [])
    if (a.fisNama && a.id) poIkutNama.set(String(a.fisNama).trim().toUpperCase(), a.id);
  const pad = new Map(); // VARIETI|UNIT -> [{variety, faktor}]
  for (const p of padanan)
    for (const f of p.fis) {
      const k = String(f.varieti).toUpperCase() + '|' + String(f.unit).toUpperCase();
      if (!pad.has(k)) pad.set(k, []);
      pad.get(k).push({ variety: kira.normNama(p.variety), faktor: Number(f.faktor) || 1 });
    }
  const jum = new Map(); // P|po|v -> ym -> [jum, n]
  const terkini = {};
  let tanpaPo = 0,
    tanpaPadanan = 0;
  for (const x of rows) {
    // Nama lajur dalam respons ikut kes model (cth. 'Master[Pusat Operasi]'); padan tanpa kira huruf besar/kecil.
    const g = (c) => {
      const k = Object.keys(x).find((kk) => kk.toLowerCase() === `master[${c.toLowerCase()}]`);
      return k ? x[k] : undefined;
    };
    const po = poIkutNama.get(
      String(g('pusat operasi') || '')
        .trim()
        .toUpperCase(),
    );
    if (!po) {
      tanpaPo += x['[n]'] || 0;
      continue;
    }
    const sasaran = pad.get(
      String(g('Varieti')).toUpperCase() + '|' + String(g('Unit')).toUpperCase(),
    );
    if (!sasaran) {
      tanpaPadanan += x['[n]'] || 0;
      continue;
    }
    const P = String(g('Peringkat')).toUpperCase();
    const t = String(g('Tarikh')).slice(0, 10);
    for (const s of sasaran) {
      const k = P + '|' + po + '|' + s.variety;
      if (!jum.has(k)) jum.set(k, new Map());
      const m = jum.get(k);
      const a = m.get(ym(t)) || [0, 0];
      a[0] += (x['[jum]'] || 0) * s.faktor;
      a[1] += x['[n]'] || 0;
      m.set(ym(t), a);
      if (!terkini[k] || t > terkini[k]) terkini[k] = t;
    }
  }
  const siri = {};
  for (const [k, m] of jum)
    siri[k] = Object.fromEntries(
      [...m].filter(([, [, n]]) => n > 0).map(([b, [j, n]]) => [b, +(j / n).toFixed(4)]),
    );
  return { siri, terkini, tanpaPo, tanpaPadanan };
}

async function utama() {
  const padanan = JSON.parse(fs.readFileSync(FAIL_PADANAN, 'utf8')).padanan;
  const poKonfig = JSON.parse(fs.readFileSync(FAIL_PO, 'utf8'));
  const c = ctxSupabase();
  const akhir = await bulanTerkiniAmi(c);
  if (!akhir) throw new Error('Tiada data AMI');
  const bulanTerkini = ym(akhir);
  const mula = psiKira.tambahBulan(bulanTerkini, -(psiKira.TETAPAN.tetingkapBulan - 1)) + '-01';
  console.log(`Bulan data terkini (AMI): ${bulanTerkini}; tetingkap dari ${mula}`);
  const ami = await ambilAmi(c, mula);
  const sisda = await ambilSisda(c);
  const fisMentah = await ambilFis(mula, padanan);
  const fis = prosesFis(fisMentah.rows, padanan, poKonfig);
  console.log(
    `FIS (${fisMentah.dataset}): ${fisMentah.rows.length} baris harian, ${Object.keys(fis.siri).length} kunci PO x varieti; transaksi tanpa PO utama: ${fis.tanpaPo}, tanpa padanan unit: ${fis.tanpaPadanan}`,
  );
  const out = {
    versi: 1,
    disegarPada: new Date().toISOString(),
    bulanTerkini,
    tetingkapMula: mula,
    sumber: {
      ami: { sistem: 'DB Harga (Supabase)', terkini: ami.terkini },
      fis: {
        sistem: 'Power BI ' + fisMentah.dataset + ', jadual Master',
        terkini: Object.values(fis.terkini).sort().pop() || null,
      },
      sisda: {
        sistem: 'Supabase v3_harga_forecast_2026 (NEGERI)',
        dijana: sisda.dijana,
        bulanAkhir: sisda.bulanAkhir,
      },
    },
    unit: ami.unit,
    ami: ami.siri,
    fis: fis.siri,
    fisTerkini: fis.terkini,
    sisda: sisda.siri,
  };
  util.tulisJsonAtomik(FAIL_OUT, out);
  console.log('Ditulis: ' + path.relative(ROOT, FAIL_OUT));
}

if (require.main === module)
  utama().catch((e) => {
    console.error('Gagal: ' + tapisRahsia((e && e.message) || e));
    process.exitCode = 1;
  });
module.exports = { prosesFis, FAIL_OUT };

'use strict';
// DB Harga (Supabase PostgREST): sync tokokan dari pelayan, agregasi harian, cache atomik dalam data/processed.
// Pelanggan hanya membaca /api/harga*; kunci dan URL tidak pernah dipaparkan, dilog atau ditulis ke cache.
const fs = require('node:fs');
const path = require('node:path');
const util = require('./util-rangkaian.js');
const kira = require('./harga-db-kira.js');
const komoditiDiliputi = require('./komoditi-diliputi.js');
const pemetaanPo = require('./pemetaan-po.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const HALAMAN = 1000; // had max-rows PostgREST
const JADUAL = [
  ['harga_ladang_mingguan', 'LADANG'],
  ['harga_borong_mingguan', 'BORONG'],
  ['harga_runcit_mingguan', 'RUNCIT'],
];
const ID_KECUALI_LALAI = '6912893,6912894,6912895,6912896,6912897';
const KOLOM_HARGA =
  'id,created_at,tarikh_akhir,avg_harga,commodity,commodity_variety_name,negeri,daerah,unit';
const TETINGKAP_HARI = 84; // 12 minggu
const REKONSILIASI_HARI = 14; // 3 minggu ISO terakhir (Isnin minggu ke-3 dikira dari tarikh terkini)
const TAHUN_ASAS = [2022, 2023, 2024, 2025];

function laluan(env, nama) {
  return process.env[env] || path.join(DATA_DIR, nama);
}
const laluanRingkas = () => laluan('HARGA_RINGKAS_FILE', 'harga-ringkas.json');
const laluanAmbang = () => laluan('HARGA_AMBANG_FILE', 'harga-ambang.json');
const laluanMeta = () => laluan('HARGA_META_FILE', 'harga-meta.json');
function intEnv(nama, lalai) {
  const n = Number(process.env[nama]);
  return Number.isFinite(n) && n > 0 ? n : lalai;
}
const redak = (e) => String((e && e.message) || e);
function buang(mesej, rahsia) {
  let s = String(mesej);
  for (const r of rahsia) if (r) s = s.split(r).join('***');
  return s;
}
function konfig(opsyen = {}) {
  const url = String(opsyen.url !== undefined ? opsyen.url : process.env.DB_HARGA_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const kunci = String(
    opsyen.kunci !== undefined ? opsyen.kunci : process.env.DB_HARGA_PUBLISHABLE_KEY || '',
  ).trim();
  const idKecuali = String(
    opsyen.idKecuali !== undefined
      ? opsyen.idKecuali
      : process.env.DB_HARGA_EXCLUDE_IDS !== undefined
        ? process.env.DB_HARGA_EXCLUDE_IDS
        : ID_KECUALI_LALAI,
  )
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  const sekarang = opsyen.sekarang
    ? new Date(opsyen.sekarang)
    : process.env.HARGA_SEKARANG
      ? new Date(process.env.HARGA_SEKARANG)
      : new Date();
  return {
    url,
    kunci,
    idKecuali,
    fetchJson: opsyen.fetchJson || util.fetchJson,
    timeoutMs: opsyen.timeoutMs || 15000,
    retries: opsyen.retries != null ? opsyen.retries : 3,
    backoffMs: opsyen.backoffMs != null ? opsyen.backoffMs : 1500,
    ambangJam: opsyen.ambangJam || intEnv('DB_HARGA_AMBANG_JAM', 24),
    sekarang,
  };
}

/* --- Rangkaian --- */
// Ambil semua halaman satu jadual (limit=1000&offset=). opts: {select, tapis:[[kunci,nilai]], order, satu}
async function ambilHalaman(jadual, opts, ctx) {
  const semua = [];
  for (let offset = 0, n = 0; n < 2000; n++) {
    const u = new URL(ctx.url + '/rest/v1/' + jadual);
    u.searchParams.set('select', opts.select);
    for (const [k, v] of opts.tapis || []) u.searchParams.append(k, v);
    if (opts.order) u.searchParams.set('order', opts.order);
    u.searchParams.set('limit', opts.satu ? '1' : String(HALAMAN));
    if (!opts.satu) u.searchParams.set('offset', String(offset));
    let rows;
    try {
      rows = await ctx.fetchJson(u.toString(), {
        headers: { apikey: ctx.kunci, Authorization: 'Bearer ' + ctx.kunci },
        timeoutMs: ctx.timeoutMs,
        retries: ctx.retries,
        backoffMs: ctx.backoffMs,
      });
    } catch (e) {
      throw new Error(`Jadual ${jadual}: ${buang(redak(e), [ctx.kunci, ctx.url])}`);
    }
    if (!Array.isArray(rows)) throw new Error(`Jadual ${jadual}: respons bukan tatasusunan`);
    semua.push(...rows);
    if (opts.satu || rows.length < HALAMAN) break;
    offset += rows.length;
  }
  return semua;
}

/* --- Pemprosesan tulen --- */
const kunciRuj = (a) => a[0] + '|' + a[1];
// Ganti tarikh dalam tarikhGanti dengan agregat `baris`. Pulangan {hari, dikecualikan}.
function terapBaris(hariLama, baris, tarikhGanti, idKecuali) {
  const rujukan = new Map();
  for (const [t, arr] of Object.entries(hariLama || {})) {
    if (tarikhGanti.has(t)) continue;
    for (const a of arr) {
      const k = kunciRuj(a);
      if (!rujukan.has(k)) rujukan.set(k, new Set());
      rujukan.get(k).add(t);
    }
  }
  const { simpan, dikecualikan } = kira.kecualiBaris(baris, { idKecuali, rujukan });
  const hari = {};
  for (const [t, arr] of Object.entries(hariLama || {})) if (!tarikhGanti.has(t)) hari[t] = arr;
  for (const e of kira.agregatHarian(simpan))
    (hari[e.t] || (hari[e.t] = [])).push([e.c, e.v, e.n, e.d, e.h, e.nb, e.u]);
  return { hari, dikecualikan };
}
function pangkas(hari) {
  const tarikh = Object.keys(hari).sort();
  if (!tarikh.length) return hari;
  const potong = kira.isnin(kira.tambahHari(tarikh[tarikh.length - 1], -TETINGKAP_HARI));
  return Object.fromEntries(Object.entries(hari).filter(([t]) => t >= potong));
}
const lebihBesarMasa = (a, b) => {
  if (!b) return a;
  if (!a) return b;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return ta !== tb ? (ta > tb ? a : b) : a > b ? a : b;
};
function kursorDari(rows, lama) {
  let maxCreatedAt = (lama && lama.maxCreatedAt) || null;
  let maxId = (lama && lama.maxId) || 0;
  for (const r of rows) {
    if (r.created_at) maxCreatedAt = lebihBesarMasa(maxCreatedAt, r.created_at);
    if (Number(r.id) > maxId) maxId = Number(r.id);
  }
  return { maxCreatedAt, maxId };
}
function kiraKunci(hari) {
  const s = new Set();
  let n = 0;
  for (const arr of Object.values(hari))
    for (const a of arr) {
      n++;
      s.add(a[0] + '|' + a[1] + '|' + a[2]);
    }
  return { entri: n, kunci: s.size, hari: Object.keys(hari).length };
}
// Daerah dalam data yang tidak masuk mana-mana PO (utama atau tambahan), dan nama daerah PO (config FIS) yang tiada dalam data.
function semakDaerah(hariSemua) {
  const bil = new Map();
  const ada = new Set();
  for (const hari of Object.values(hariSemua))
    for (const arr of Object.values(hari))
      for (const a of arr) {
        ada.add(a[2] + '|' + a[3]);
        if (
          a[2] === 'MALAYSIA' ||
          kira.poUntuk(a[2], a[3]) ||
          kira.poTambahanUntuk(a[2], a[3]).length
        )
          continue;
        const k = a[2] + '|' + a[3];
        bil.set(k, (bil.get(k) || 0) + 1);
      }
  const tidakDitugaskan = [...bil.entries()]
    .map(([k, n]) => {
      const [negeri, daerah] = k.split('|');
      return { negeri, daerah, bil: n };
    })
    .sort((a, b) => b.bil - a.bil)
    .slice(0, 100);
  const daerahTakPadan = [];
  for (const p of pemetaanPo.muat().po)
    for (const x of p.pasangan)
      if (!ada.has(x.negeri + '|' + x.daerah))
        daerahTakPadan.push({ po: p.id, negeri: x.negeri, daerah: x.daerah, utama: p.utama });
  return { tidakDitugaskan, daerahTakPadan };
}
function binaMeta({ hari, kursor, dikecualikan, diambil, ambangMeta, sekarang, status, mesej }) {
  const tarikhTerkini = {};
  const kiraan = {};
  for (const [, p] of JADUAL) {
    const t = Object.keys(hari[p] || {}).sort();
    tarikhTerkini[p] = t.length ? t[t.length - 1] : null;
    kiraan[p] = { ...kiraKunci(hari[p] || {}), diambil: diambil[p] || 0 };
  }
  return {
    versi: 1,
    disegarPada: new Date(sekarang).toISOString(),
    status,
    mesej: mesej || '',
    tarikhTerkini,
    kursor,
    kiraan,
    dikecualikan,
    ...semakDaerah(hari),
    ambang: ambangMeta || null,
  };
}
function binaAmbangFail(jadual, sekarang) {
  const { baris, kiraan } = kira.binaAmbang(jadual);
  return {
    ambang: { versi: 1, fetchedAt: new Date(sekarang).toISOString(), kiraan, baris },
    ringkasMeta: {
      baris: baris.length,
      bilanganTiadaDitemui: kiraan.bilanganTiadaDitemui,
      asas: kiraan.asas,
    },
  };
}
// Bina semua cache daripada baris mentah (bootstrap sepenuhnya). Digunakan oleh ujian dan penjana fixture.
function binaDariBaris(barisPer, jadualAmbang, opsyen = {}) {
  const c = konfig(opsyen);
  const hari = {};
  const dikecualikan = { id: 0, tiadaRujukan: 0, contoh: [] };
  const diambil = {};
  const kursor = {};
  for (const [jadual, p] of JADUAL) {
    const rows = barisPer[p] || [];
    const tarikh = new Set(rows.map((r) => r.tarikh_akhir));
    const r = terapBaris({}, rows, tarikh, c.idKecuali);
    hari[p] = pangkas(r.hari);
    dikecualikan.id += r.dikecualikan.id;
    dikecualikan.tiadaRujukan += r.dikecualikan.tiadaRujukan;
    dikecualikan.contoh.push(...r.dikecualikan.contoh);
    diambil[p] = rows.length;
    kursor[jadual] = kursorDari(rows, null);
  }
  const amb = jadualAmbang ? binaAmbangFail(jadualAmbang, c.sekarang) : null;
  return {
    ringkas: { versi: 1, hari },
    ambang: amb ? amb.ambang : null,
    meta: binaMeta({
      hari,
      kursor,
      dikecualikan,
      diambil,
      ambangMeta: amb ? amb.ringkasMeta : null,
      sekarang: c.sekarang,
      status: 'ok',
    }),
  };
}

/* --- Sync --- */
async function segarJadual(jadual, p, lama, c) {
  const hariLama = lama.ringkas && lama.ringkas.hari && lama.ringkas.hari[p];
  const kurLama = lama.meta && lama.meta.kursor && lama.meta.kursor[jadual];
  const ids = c.idKecuali;
  const idSet = new Set(ids);
  const tapisId = ids.length ? [['id', 'not.in.(' + ids.join(',') + ')']] : [];
  let bilDiambil = 0;
  const ambil = async (tapis, order = 'id.asc') => {
    const rows = await ambilHalaman(jadual, { select: KOLOM_HARGA, tapis, order }, c);
    bilDiambil += rows.length;
    return rows;
  };
  if (!hariLama || !kurLama || !kurLama.maxCreatedAt) {
    const atas = await ambilHalaman(
      jadual,
      {
        select: 'tarikh_akhir',
        tapis: [['tarikh_akhir', 'not.is.null'], ...tapisId],
        order: 'tarikh_akhir.desc',
        satu: true,
      },
      c,
    );
    if (!atas.length)
      return {
        hari: {},
        kursor: kurLama || { maxCreatedAt: null, maxId: 0 },
        dikecualikan: { id: 0, tiadaRujukan: 0, contoh: [] },
        diambil: 0,
      };
    const mula = kira.isnin(kira.tambahHari(atas[0].tarikh_akhir, -TETINGKAP_HARI));
    const rows = await ambil([['tarikh_akhir', 'gte.' + mula]]);
    const r = terapBaris({}, rows, new Set(rows.map((x) => x.tarikh_akhir)), ids);
    return {
      hari: pangkas(r.hari),
      kursor: kursorDari(rows, null),
      dikecualikan: r.dikecualikan,
      diambil: bilDiambil,
    };
  }
  // Tokokan: baris baharu mengikut created_at, kemudian rekonsiliasi 3 minggu ISO dan tarikh lama yang tersentuh.
  const baharu = await ambil([['created_at', 'gt.' + kurLama.maxCreatedAt]]);
  const kunciLama = Object.keys(hariLama).sort();
  const sah = baharu.filter((x) => !idSet.has(String(x.id)) && kira.tarikhSah(x.tarikh_akhir));
  const tRef = [kunciLama[kunciLama.length - 1] || '', ...sah.map((x) => x.tarikh_akhir)].reduce(
    (a, b) => (a > b ? a : b),
  );
  const mulaRekon = kira.isnin(kira.tambahHari(tRef, -REKONSILIASI_HARI));
  const potong = kira.isnin(kira.tambahHari(tRef, -TETINGKAP_HARI));
  const baris = await ambil([['tarikh_akhir', 'gte.' + mulaRekon]]);
  const ganti = new Set(kunciLama.filter((t) => t >= mulaRekon));
  baris.forEach((x) => ganti.add(x.tarikh_akhir));
  const tersentuh = [...new Set(sah.map((x) => x.tarikh_akhir))].filter(
    (t) => t < mulaRekon && t >= potong,
  );
  for (const t of tersentuh) {
    baris.push(...(await ambil([['tarikh_akhir', 'eq.' + t]])));
    ganti.add(t);
  }
  const r = terapBaris(hariLama, baris, ganti, ids);
  return {
    hari: pangkas(r.hari),
    kursor: kursorDari(baharu, kurLama),
    dikecualikan: r.dikecualikan,
    diambil: bilDiambil,
  };
}

async function segarAmbang(c) {
  const sel = (jadual, select, order) => ambilHalaman(jadual, { select, order }, c);
  const cache = await sel(
    'threshold_autofill_cache',
    'commodity,commodity_variety_name,negeri,peringkat,mean_last_year,sd_last_year,nilai_perubahan_rm,floor_warning,ceiling_warning,error_messages,updated_at',
    'id.asc',
  );
  const ami = await sel(
    'maklumat_ami',
    'commodity_variety_name,peringkat,nilai_perubahan_rm,nilai_perubahan_unit,ceiling_warning,floor_warning',
    'bil.asc',
  );
  const meanSd = {};
  for (const t of TAHUN_ASAS) {
    try {
      meanSd[t] = await sel(
        'mean_sd_based_year_' + t,
        'negeri,peringkat,commodity,commodity_variety_name,bilangan_rekod',
        'id_pk.asc',
      );
    } catch (e) {
      meanSd[t] = [];
    }
  }
  return binaAmbangFail({ cache, ami, meanSd }, c.sekarang);
}

let sedangAmbilBendera = false;
let pemasa = null;
const memo = new Map();
function bacaMemo(f) {
  let st;
  try {
    st = fs.statSync(f);
  } catch {
    return null;
  }
  const m = memo.get(f);
  if (m && m.mtime === st.mtimeMs && m.size === st.size) return m.data;
  const data = util.bacaJson(f);
  memo.set(f, { mtime: st.mtimeMs, size: st.size, data });
  return data;
}
// {ringkas, ambang, meta} atau null jika ringkas/meta tiada. ambang boleh null.
function bacaCache() {
  const ringkas = bacaMemo(laluanRingkas());
  const meta = bacaMemo(laluanMeta());
  if (!ringkas || !ringkas.hari || !meta) return null;
  return { ringkas, meta, ambang: bacaMemo(laluanAmbang()) };
}

async function segar(opsyen = {}) {
  const c = konfig(opsyen);
  if (!c.url || !c.kunci)
    return {
      ditulis: false,
      status: 'gagal',
      mesej: 'DB_HARGA_URL atau DB_HARGA_PUBLISHABLE_KEY belum ditetapkan',
    };
  sedangAmbilBendera = true;
  try {
    const lama = { ringkas: util.bacaJson(laluanRingkas()), meta: util.bacaJson(laluanMeta()) };
    const ambangLama = util.bacaJson(laluanAmbang());
    const hari = {};
    const kursor = { ...((lama.meta && lama.meta.kursor) || {}) };
    const dikecualikan = { id: 0, tiadaRujukan: 0, contoh: [] };
    const diambil = {};
    const ralat = [];
    for (const [jadual, p] of JADUAL) {
      try {
        const r = await segarJadual(jadual, p, lama, c);
        hari[p] = r.hari;
        kursor[jadual] = r.kursor;
        diambil[p] = r.diambil;
        dikecualikan.id += r.dikecualikan.id;
        dikecualikan.tiadaRujukan += r.dikecualikan.tiadaRujukan;
        dikecualikan.contoh.push(...r.dikecualikan.contoh);
      } catch (e) {
        ralat.push(buang(redak(e), [c.kunci, c.url]));
        hari[p] = (lama.ringkas && lama.ringkas.hari && lama.ringkas.hari[p]) || {};
        diambil[p] = 0;
      }
    }
    let ambang = ambangLama;
    let ambangMeta = lama.meta && lama.meta.ambang;
    const ambangPerlu =
      !ambangLama || util.umurJam(ambangLama.fetchedAt, c.sekarang) >= c.ambangJam;
    if (ambangPerlu) {
      try {
        const r = await segarAmbang(c);
        ambang = r.ambang;
        ambangMeta = r.ringkasMeta;
      } catch (e) {
        ralat.push(buang(redak(e), [c.kunci, c.url]));
      }
    }
    const bilData = Object.values(hari).reduce((j, h) => j + Object.keys(h).length, 0);
    if (ralat.length >= JADUAL.length + (ambangPerlu ? 1 : 0) || !bilData)
      return {
        ditulis: false,
        status: 'gagal',
        mesej: ralat.join('; ') || 'Tiada data',
        diambil,
        ralat,
      };
    const meta = binaMeta({
      hari,
      kursor,
      dikecualikan,
      diambil,
      ambangMeta,
      sekarang: c.sekarang,
      status: ralat.length ? 'sebahagian' : 'ok',
      mesej: ralat.join('; '),
    });
    const ringkas = { versi: 1, hari };
    util.tulisJsonAtomik(laluanRingkas(), ringkas);
    if (ambang) util.tulisJsonAtomik(laluanAmbang(), ambang);
    util.tulisJsonAtomik(laluanMeta(), meta);
    return {
      ditulis: true,
      status: meta.status,
      mesej: meta.mesej,
      diambil,
      meta,
      ringkas,
      ambang,
      ralat,
    };
  } finally {
    sedangAmbilBendera = false;
  }
}

/* --- Respons API --- */
function opsyenRespons() {
  return { sekarang: konfig().sekarang, senarai: komoditiDiliputi.muat() };
}
const jawabHarga = (c, params) =>
  kira.jawabHarga(c.ringkas, c.ambang, c.meta, params, opsyenRespons());
const jawabMeta = (c) => kira.jawabMeta(c.ringkas, c.meta, opsyenRespons());
function jawabAmbang(c) {
  const a = c.ambang;
  if (!a) return null;
  const senarai = komoditiDiliputi.muat();
  const baris = a.baris.filter((b) => senarai.padan(b.commodity, b.variety));
  return { versi: 1, fetchedAt: a.fetchedAt, kiraan: a.kiraan, baris };
}
// Taburan status per mod (Pengeluar = LADANG, Pengguna = RUNCIT) pada aras PO, untuk laporan CLI.
function taburanStatus(c) {
  const hasil = {};
  for (const [mod, peringkat] of [
    ['pengeluar', 'LADANG'],
    ['pengguna', 'RUNCIT'],
  ]) {
    const r = kira.jawabHarga(
      c.ringkas,
      c.ambang,
      c.meta,
      { peringkat, aras: 'po' },
      opsyenRespons(),
    );
    const t = { merah: 0, kuning: 0, hijau: 0, kelabu: 0 };
    r.baris.forEach((b) => t[b.status]++);
    hasil[mod] = { jumlah: r.baris.length, ...t };
  }
  return hasil;
}

function mulaPenjadual() {
  if (process.env.DB_HARGA_AUTO === '0') return;
  if (!process.env.DB_HARGA_URL || !process.env.DB_HARGA_PUBLISHABLE_KEY) {
    console.log('DB Harga: kelayakan belum ditetapkan, penjadual tidak dimulakan.');
    return;
  }
  const jam = intEnv('DB_HARGA_POLL_JAM', 6);
  const semak = async () => {
    if (sedangAmbilBendera) return;
    const m = util.bacaJson(laluanMeta());
    if (m && util.umurJam(m.disegarPada) < jam) return;
    try {
      const r = await segar();
      console.log(
        r.ditulis ? 'Data DB Harga dikemas kini.' : 'DB Harga tidak dikemas kini: ' + r.mesej,
      );
    } catch (e) {
      console.warn('Gagal mengemas kini DB Harga: ' + redak(e));
    }
  };
  semak();
  if (!pemasa) {
    pemasa = setInterval(semak, jam * 36e5);
    pemasa.unref();
  }
}

module.exports = {
  kira,
  JADUAL,
  ID_KECUALI_LALAI,
  ambilHalaman,
  terapBaris,
  binaDariBaris,
  segar,
  bacaCache,
  jawabHarga,
  jawabMeta,
  jawabAmbang,
  taburanStatus,
  mulaPenjadual,
  laluanRingkas,
  laluanAmbang,
  laluanMeta,
  sedangAmbil: () => sedangAmbilBendera,
};

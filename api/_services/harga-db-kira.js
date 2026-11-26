'use strict';
// DB Harga: logik tulen (tiada rangkaian, tiada fail). Minggu ISO, agregasi, pemetaan PO, peraturan alarm dan
// pembina respons untuk /api/harga. Dikongsi oleh api/_services/harga-db.js dan ujian.

const komoditiDiliputi = require('./komoditi-diliputi.js');
const pemetaanPo = require('./pemetaan-po.js');

const HARI_MS = 864e5;
const RE_TARIKH = /^\d{4}-\d{2}-\d{2}$/;
const RE_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERINGKAT = ['LADANG', 'BORONG', 'RUNCIT'];
const MOD_PERINGKAT = { pengeluar: 'LADANG', pengguna: 'RUNCIT' };
const PERINGKAT_MOD = { LADANG: 'pengeluar', RUNCIT: 'pengguna' };
const ARAS = ['negeri', 'po', 'po_tambahan', 'daerah'];

// Satu-satunya tempat ambang alarm. Boleh ditimpa melalui parameter `opsyen`/`cfg`.
const AMBANG_ALARM = Object.freeze({
  zMerah: 2,
  zKuning: 1,
  minRekod: 8,
  staleHari: 8,
  minggu: 12,
  // Amaran PO (daripada status daerah): kuning jika nisbah daerah kuning (antara daerah sah) >= amaranPoKuning;
  // hijau hanya jika nisbah daerah sah (antara semua daerah liputan PO) >= amaranPoLiputan.
  amaranPoKuning: 0.3,
  amaranPoLiputan: 0.5,
});

/* --- Tarikh dan minggu ISO (Isnin-Ahad) --- */
function tarikhSah(s) {
  if (typeof s !== 'string' || !RE_TARIKH.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function tambahHari(ymd, n) {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + n * HARI_MS).toISOString().slice(0, 10);
}
function isnin(ymd) {
  const hari = (new Date(ymd + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return tambahHari(ymd, -hari);
}
const ahad = (ymd) => tambahHari(isnin(ymd), 6);
// {iso:'2026-W45', tahun, minggu, mula, akhir}. Tahun ISO ditentukan oleh hari Khamis minggu itu.
function mingguIso(ymd) {
  const mula = isnin(ymd);
  const khamis = tambahHari(mula, 3);
  const tahun = Number(khamis.slice(0, 4));
  const hariKe = Math.round((Date.parse(khamis + 'T00:00:00Z') - Date.UTC(tahun, 0, 1)) / HARI_MS);
  const minggu = Math.floor(hariKe / 7) + 1;
  return {
    iso: `${tahun}-W${String(minggu).padStart(2, '0')}`,
    tahun,
    minggu,
    mula,
    akhir: tambahHari(mula, 6),
  };
}
// Isnin minggu lengkap terkini: minggu yang Ahadnya <= tarikhTerkini.
function mingguLengkap(tarikhTerkini) {
  const m = isnin(tarikhTerkini);
  return ahad(m) <= tarikhTerkini ? m : tambahHari(m, -7);
}
function infoMinggu(mula, tarikhTerkini) {
  const w = mingguIso(mula);
  return { iso: w.iso, mula: w.mula, akhir: w.akhir, separa: w.akhir > tarikhTerkini };
}
// Minggu yang dipaparkan bagi satu peringkat. null jika bulan tiada data langsung.
function pilihMinggu(tarikhTerkini, { bulan, minggu } = {}, tarikhAda = []) {
  if (minggu) return infoMinggu(isnin(minggu), tarikhTerkini);
  const lengkap = mingguLengkap(tarikhTerkini);
  if (!bulan) return infoMinggu(lengkap, tarikhTerkini);
  const awal = tarikhAda.length ? tarikhAda.reduce((a, b) => (a < b ? a : b)) : lengkap;
  for (let m = lengkap; m >= tambahHari(isnin(awal), -7); m = tambahHari(m, -7))
    if (ahad(m).slice(0, 7) === bulan) return infoMinggu(m, tarikhTerkini);
  const dalamBulan = tarikhAda.filter((t) => t.slice(0, 7) === bulan);
  if (!dalamBulan.length) return null;
  return infoMinggu(isnin(dalamBulan.reduce((a, b) => (a > b ? a : b))), tarikhTerkini);
}

/* --- Normalisasi nama --- */
function norm(s) {
  return s == null
    ? ''
    : String(s).normalize('NFKC').toUpperCase().replace(/[.()]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normNegeri(s) {
  return norm(s)
    .replace(/^(W P|WP|WILAYAH PERSEKUTUAN)\s+/, '')
    .replace(/BAHARU/g, 'BHARU');
}
function normDaerah(s) {
  const n = norm(s).replace(/BAHARU/g, 'BHARU');
  return /^JOHOR (BHARU|BAHRU)$/.test(n) ? 'JOHOR BAHRU' : n;
}
// Komoditi/varieti: huruf besar dan ruang kemas sahaja (kurungan kekal, ia sebahagian nama DB).
const normNama = (s) => (s == null ? '' : String(s).toUpperCase().replace(/\s+/g, ' ').trim());
function normUnit(u) {
  const n = norm(u);
  return n === 'KILOGRAM' ? 'KG' : n;
}

/* --- Pusat Operasi --- */
// Semua daripada config/pemetaan-po-fis.json (FIS Version 2.1, status 'disahkan (FIS 2.1)'): satu sumber untuk 15 PO utama
// dan PO tambahan. PO utama = tepat satu PO bagi (negeri, daerah); PO tambahan boleh bertindih dengan PO utama dan sesama sendiri.
const PEM = pemetaanPo.muat();
const PO_SENARAI = Object.freeze(
  PEM.utama.map((p) => Object.freeze({ id: p.id, nama: p.nama, negeri: p.negeri })),
);
const PO_TAMBAHAN = Object.freeze(
  PEM.tambahan.map((p) =>
    Object.freeze({ id: p.id, nama: p.label, fisNama: p.fisNama, negeri: p.negeri }),
  ),
);
// `negeri`/`daerah` = negeri utama PO dan daerah di dalamnya; `pasangan` = semua (negeri, daerah) termasuk negeri lain
// (cth. KUALA LUMPUR, PUTRAJAYA, LABUAN ialah nilai NEGERI dalam DB).
const PO_DAERAH = Object.freeze(
  Object.fromEntries(
    PEM.utama.map((p) => [
      p.id,
      {
        negeri: p.negeri,
        daerah: p.pasangan.filter((x) => x.negeri === p.negeri).map((x) => x.daerah),
        pasangan: p.pasangan,
      },
    ]),
  ),
);
const PO_IKUT_ID = Object.freeze(Object.fromEntries(PO_SENARAI.map((p) => [p.id, p])));
const PO_SEMUA_IKUT_ID = Object.freeze({
  ...PO_IKUT_ID,
  ...Object.fromEntries(PO_TAMBAHAN.map((p) => [p.id, p])),
});
// id PO utama bagi (negeri, daerah) DB, atau null jika tidak ditugaskan (cth. BATU di KUALA LUMPUR, MALAYSIA).
function poUntuk(negeri, daerah) {
  const n = normNegeri(negeri);
  if (!n || n === 'MALAYSIA') return null;
  return pemetaanPo.utamaUntuk(PEM, n, normDaerah(daerah));
}
// Semua id PO tambahan bagi (negeri, daerah) DB (boleh lebih satu).
function poTambahanUntuk(negeri, daerah) {
  const n = normNegeri(negeri);
  if (!n || n === 'MALAYSIA') return [];
  return pemetaanPo.tambahanUntuk(PEM, n, normDaerah(daerah));
}
/* --- Pengecualian dan agregasi baris DB --- */
const kunciRujukan = (b) => normNama(b.commodity) + '|' + normNama(b.commodity_variety_name);
// Buang baris ujian: id dalam idKecuali, dan varieti yang tidak muncul pada >= minTarikh tarikh_akhir berbeza.
// `rujukan` (Map kunci -> Set tarikh) membawa tarikh lain yang sudah disimpan (untuk tarikhan semula separa).
function kecualiBaris(baris, { idKecuali = [], rujukan = null, minTarikh = 2 } = {}) {
  const idSet = new Set([...idKecuali].map(String));
  const tanpaId = [];
  let bilId = 0;
  for (const b of baris) {
    if (idSet.has(String(b.id))) bilId++;
    else tanpaId.push(b);
  }
  const tarikh = new Map();
  if (rujukan) for (const [k, s] of rujukan) tarikh.set(k, new Set(s));
  for (const b of tanpaId) {
    const k = kunciRujukan(b);
    if (!tarikh.has(k)) tarikh.set(k, new Set());
    tarikh.get(k).add(b.tarikh_akhir);
  }
  const simpan = [];
  const contoh = [];
  let bilRujukan = 0;
  for (const b of tanpaId) {
    if (tarikh.get(kunciRujukan(b)).size >= minTarikh) simpan.push(b);
    else {
      bilRujukan++;
      if (contoh.length < 10)
        contoh.push({
          id: b.id,
          commodity: b.commodity,
          variety: b.commodity_variety_name,
          tarikh: b.tarikh_akhir,
        });
    }
  }
  return { simpan, dikecualikan: { id: bilId, tiadaRujukan: bilRujukan, contoh } };
}
const bulat = (x, d) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};
// Purata harian per (tarikh, commodity, varieti, negeri, daerah): purata baris merentas gred/institusi.
// Pulangan: [{t, c, v, n, d, h, nb, u}] diisih.
function agregatHarian(baris) {
  const peta = new Map();
  for (const b of baris) {
    const h = Number(b.avg_harga);
    if (b.avg_harga == null || b.avg_harga === '' || !Number.isFinite(h)) continue;
    if (!tarikhSah(b.tarikh_akhir)) continue;
    const n = normNegeri(b.negeri);
    let d = normDaerah(b.daerah);
    if (n === 'KUALA LUMPUR' && !d) d = 'KUALA LUMPUR';
    const c = normNama(b.commodity);
    const v = normNama(b.commodity_variety_name);
    const k = [b.tarikh_akhir, c, v, n, d].join('\u0001');
    let e = peta.get(k);
    if (!e) {
      e = { t: b.tarikh_akhir, c, v, n, d, jum: 0, nb: 0, u: normUnit(b.unit) };
      peta.set(k, e);
    }
    e.jum += h;
    e.nb++;
  }
  return [...peta.values()]
    .map((e) => ({
      t: e.t,
      c: e.c,
      v: e.v,
      n: e.n,
      d: e.d,
      h: bulat(e.jum / e.nb, 4),
      nb: e.nb,
      u: e.u,
    }))
    .sort((a, b) => (a.t + a.c + a.v + a.n + a.d).localeCompare(b.t + b.c + b.v + b.n + b.d, 'en'));
}

/* --- Peraturan alarm --- */
function ambangPerubahan(nilai, unit) {
  const n = Number(nilai);
  if (nilai == null || nilai === '' || !Number.isFinite(n) || n <= 0) return null;
  return {
    nilai: n,
    unit:
      String(unit || '')
        .trim()
        .toUpperCase() === 'RM'
        ? 'RM'
        : '%',
  };
}
const rm = (x) => 'RM ' + x.toFixed(2);
const fmtZ = (z) => (z < 0 ? '\u2212' : '') + Math.abs(z).toFixed(1);
const fmtAmbang = (a) => (a.unit === 'RM' ? rm(a.nilai) : a.nilai + '%');
// mod: 'pengeluar' | 'pengguna' | null. input: {harga, hargaSebelum, mean, sd, lantai, siling, bilangan,
// ambangPerubahan:{nilai,unit}|null, adaAmbang, separa, asas}. Pulangan: {status, sebab, asas, z, had, perubahanPct}.
function nilaiAlarm(mod, input, cfg = AMBANG_ALARM) {
  const i = input || {};
  const asas = i.asas == null ? null : i.asas;
  const hasil = (status, sebab, extra = {}) => ({
    status,
    sebab,
    asas,
    z: null,
    had: null,
    perubahanPct: null,
    ...extra,
  });
  const ada = (v) => v != null && Number.isFinite(Number(v));
  const harga = ada(i.harga) ? Number(i.harga) : null;
  const prev = ada(i.hargaSebelum) ? Number(i.hargaSebelum) : null;
  const perubahanPct = harga != null && prev ? bulat(((harga - prev) / prev) * 100, 1) : null;
  if (!mod) return hasil('kelabu', 'Pembanding (tiada mod)', { perubahanPct });
  if (harga == null) return hasil('kelabu', 'Tiada harga');
  if (i.separa) return hasil('kelabu', 'Minggu belum lengkap', { perubahanPct });
  if (!i.adaAmbang) return hasil('kelabu', 'Tiada ambang', { perubahanPct });
  const sd = ada(i.sd) ? Number(i.sd) : null;
  const mean = ada(i.mean) ? Number(i.mean) : null;
  const bil = ada(i.bilangan) ? Number(i.bilangan) : null;
  if (mean == null || sd == null || !(sd > 0))
    return hasil('kelabu', 'sd tidak sah (' + (sd === 0 ? 'sd = 0' : 'tiada min/sd') + ')', {
      perubahanPct,
    });
  if (bil == null || bil < cfg.minRekod)
    return hasil(
      'kelabu',
      'sd tidak sah (' +
        (bil == null ? 'bilangan rekod tiada' : `rekod kurang daripada ${cfg.minRekod}`) +
        ')',
      { perubahanPct },
    );
  const z = (harga - mean) / sd;
  const zArah = mod === 'pengeluar' ? -z : z;
  const lantai = ada(i.lantai) ? Number(i.lantai) : null;
  const siling = ada(i.siling) ? Number(i.siling) : null;
  const had =
    mod === 'pengeluar' ? lantai != null && harga <= lantai : siling != null && harga >= siling;
  const sebabZ = `z = ${z < 0 ? '\u2212' : ''}${Math.abs(z).toFixed(1)}\u03c3 (asas ${asas})`;
  const sebabHad =
    mod === 'pengeluar'
      ? `di bawah lantai dasar ${rm(lantai || 0)}`
      : `melepasi siling dasar ${rm(siling || 0)}`;
  const extra = { z: bulat(z, 2), had, perubahanPct };
  if (zArah >= cfg.zMerah) return hasil('merah', sebabZ, extra);
  if (had && zArah >= cfg.zKuning) return hasil('merah', sebabZ + '; ' + sebabHad, extra);
  const sebab = [];
  if (zArah >= cfg.zKuning) sebab.push(sebabZ);
  if (had) sebab.push(sebabHad);
  const ap = i.ambangPerubahan;
  if (ap && ada(ap.nilai) && harga != null && prev != null) {
    const arah = mod === 'pengeluar' ? -1 : 1;
    const naik = mod === 'pengguna';
    if (ap.unit === 'RM') {
      const d = (harga - prev) * arah;
      if (d >= ap.nilai)
        sebab.push(
          `${naik ? 'naik' : 'turun'} ${rm(Math.abs(harga - prev))} minggu ke minggu, ambang ${fmtAmbang(ap)}`,
        );
    } else if (prev) {
      const d = ((harga - prev) / prev) * 100 * arah;
      if (d >= ap.nilai)
        sebab.push(
          `${naik ? 'naik' : 'turun'} ${Math.abs(bulat(((harga - prev) / prev) * 100, 1))}% minggu ke minggu, ambang ${fmtAmbang(ap)}`,
        );
    }
  }
  if (sebab.length) return hasil('kuning', sebab.join('; '), extra);
  return hasil('hijau', `Dalam julat normal (z = ${fmtZ(z)}\u03c3, asas ${asas})`, extra);
}

/* --- Ambang (cache + maklumat_ami + mean_sd) --- */
const kunciAmbang = (p, c, v, n) => [p, normNama(c), normNama(v), normNegeri(n)].join('|');
const numOrNull = (x) => {
  if (x == null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
function tahunAsas(mesej) {
  const m = /tahun\s*(20\d\d)/i.exec(String(mesej || ''));
  return m ? Number(m[1]) : 2025;
}
// Pulangan: {baris:[{peringkat, commodity, variety, negeri, asas, mean, sd, lantai, siling, perubahan, bilangan}], kiraan}
function binaAmbang({ cache = [], ami = [], meanSd = {} } = {}) {
  const unitAmi = new Map();
  for (const a of ami)
    unitAmi.set(normNama(a.peringkat) + '|' + normNama(a.commodity_variety_name), a);
  const idxSd = {};
  for (const [thn, senarai] of Object.entries(meanSd)) {
    idxSd[thn] = new Map();
    for (const r of senarai)
      idxSd[thn].set(
        kunciAmbang(normNama(r.peringkat), r.commodity, r.commodity_variety_name, r.negeri),
        numOrNull(r.bilangan_rekod),
      );
  }
  const kiraan = { jumlah: 0, bilanganTiadaDitemui: 0, asas: {}, bilanganTiadaContoh: [] };
  const baris = [];
  for (const r of cache) {
    const peringkat = normNama(r.peringkat);
    const ami1 = unitAmi.get(peringkat + '|' + normNama(r.commodity_variety_name));
    const asas = tahunAsas(r.error_messages);
    const nilaiP =
      numOrNull(r.nilai_perubahan_rm) != null
        ? r.nilai_perubahan_rm
        : ami1
          ? ami1.nilai_perubahan_rm
          : null;
    const bil = idxSd[asas]
      ? idxSd[asas].get(kunciAmbang(peringkat, r.commodity, r.commodity_variety_name, r.negeri))
      : undefined;
    const bilangan = bil == null ? null : bil;
    kiraan.jumlah++;
    kiraan.asas[asas] = (kiraan.asas[asas] || 0) + 1;
    if (bilangan == null) {
      kiraan.bilanganTiadaDitemui++;
      if (kiraan.bilanganTiadaContoh.length < 5)
        kiraan.bilanganTiadaContoh.push(
          [peringkat, r.commodity, r.commodity_variety_name, r.negeri].join(' / '),
        );
    }
    baris.push({
      peringkat,
      commodity: normNama(r.commodity),
      variety: normNama(r.commodity_variety_name),
      negeri: normNegeri(r.negeri),
      asas,
      mean: numOrNull(r.mean_last_year),
      sd: numOrNull(r.sd_last_year),
      lantai: numOrNull(r.floor_warning),
      siling: numOrNull(r.ceiling_warning),
      perubahan: ambangPerubahan(nilaiP, ami1 && ami1.nilai_perubahan_unit),
      bilangan,
    });
  }
  return { baris, kiraan };
}
const _idxAmbang = new WeakMap();
function indeksAmbang(ambang) {
  if (!ambang || !Array.isArray(ambang.baris)) return new Map();
  let m = _idxAmbang.get(ambang);
  if (!m) {
    m = new Map();
    for (const b of ambang.baris)
      m.set(kunciAmbang(b.peringkat, b.commodity, b.variety, b.negeri), b);
    _idxAmbang.set(ambang, m);
  }
  return m;
}

/* --- Indeks ringkasan harian --- */
// ringkas = {versi, hari:{PERINGKAT:{tarikh:[[c,v,n,d,h,nb,u], ...]}}}
// senarai = senarai putih komoditi (komoditi-diliputi.js). Lalai: config/komoditi-diliputi.json; null = tanpa tapisan
// (hanya untuk ujian logik tulen). Tapisan dibuat di sini supaya status, KPI dan senarai hanya melibatkan pasangan
// yang diliputi, dan tukar konfigurasi berkesan tanpa sync semula. e.c/e.v = jenis dan varieti konfigurasi;
// e.cdb/e.vdb = nama DB (untuk carian ambang).
const _idx = new WeakMap();
function indeks(ringkas, senarai) {
  if (senarai === undefined) senarai = komoditiDiliputi.muat();
  let r = _idx.get(ringkas);
  if (r && r.senarai === senarai) return r;
  r = {
    senarai,
    entri: {},
    tarikhTerkini: {},
    tarikhAda: {},
    bulan: new Set(),
    komoditi: {},
    negeri: new Set(),
  };
  for (const p of PERINGKAT) {
    const hari = (ringkas && ringkas.hari && ringkas.hari[p]) || {};
    const entri = [];
    for (const t of Object.keys(hari).sort())
      for (const a of hari[t]) {
        const pas = senarai ? senarai.padan(a[0], a[1]) : null;
        if (senarai && !pas) continue;
        const c = pas ? pas.jenis : a[0];
        const v = pas ? pas.variety : a[1];
        const po = poUntuk(a[2], a[3]);
        const tpo = poTambahanUntuk(a[2], a[3]);
        entri.push({
          p,
          t,
          c,
          v,
          cdb: a[0],
          vdb: a[1],
          n: a[2],
          d: a[3],
          h: a[4],
          nb: a[5],
          u: a[6],
          po,
          tpo,
        });
        if (a[2] !== 'MALAYSIA') r.negeri.add(a[2]);
        (r.komoditi[c] || (r.komoditi[c] = new Set())).add(v);
      }
    r.entri[p] = entri;
    r.tarikhAda[p] = Object.keys(hari).sort();
    r.tarikhTerkini[p] = r.tarikhAda[p].length ? r.tarikhAda[p][r.tarikhAda[p].length - 1] : null;
    for (const t of r.tarikhAda[p]) r.bulan.add(t.slice(0, 7));
  }
  _idx.set(ringkas, r);
  return r;
}
const maks = (arr) => arr.filter(Boolean).reduce((a, b) => (a > b ? a : b), '') || null;

/* --- Pertanyaan --- */
function padanPenapis(e, f) {
  if (f.negeri && e.n !== f.negeri) return false;
  if (f.po && e.po !== f.po && !e.tpo.includes(f.po)) return false;
  if (f.daerah && e.d !== f.daerah) return false;
  if (f.commodity && e.c !== f.commodity) return false;
  if (f.variety && e.v !== f.variety) return false;
  return true;
}
// Entiti (kunci) mengikut aras; senarai kosong jika entri tidak masuk aras itu. Aras po_tambahan boleh memberi lebih satu.
function entiti(e, aras, f) {
  if (aras === 'po_tambahan')
    return e.tpo.map((id) => ({
      id,
      negeri: PO_SEMUA_IKUT_ID[id].negeri,
      po: id,
      daerah: null,
    }));
  if (aras === 'po')
    return e.po ? [{ id: e.po, negeri: PO_IKUT_ID[e.po].negeri, po: e.po, daerah: null }] : [];
  if (aras === 'negeri') {
    if (e.n === 'MALAYSIA' && f.negeri !== 'MALAYSIA') return [];
    return [{ id: e.n, negeri: e.n, po: null, daerah: null }];
  }
  if (!e.d || e.n === 'MALAYSIA') return [];
  return [{ id: e.n + '|' + e.d, negeri: e.n, po: e.po, daerah: e.d }];
}
// Purata mingguan bagi senarai entri (pelbagai hari): purata harian (purata purata-daerah) kemudian purata hari.
function hargaMinggu(entri, mula) {
  const akhir = tambahHari(mula, 6);
  const harian = new Map();
  for (const e of entri) {
    if (e.t < mula || e.t > akhir) continue;
    const x = harian.get(e.t) || [0, 0];
    x[0] += e.h;
    x[1]++;
    harian.set(e.t, x);
  }
  if (!harian.size) return null;
  let jum = 0;
  for (const [s, n] of harian.values()) jum += s / n;
  return bulat(jum / harian.size, 4);
}
function harianSiri(entri) {
  const harian = new Map();
  for (const e of entri) {
    const x = harian.get(e.t) || [0, 0, 0];
    x[0] += e.h;
    x[1]++;
    x[2] += e.nb;
    harian.set(e.t, x);
  }
  return [...harian.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([t, [s, n, nb]]) => ({ t, h: bulat(s / n, 4), n: nb }));
}

function kiraBaris(idx, ambIdx, p, f, params, cfg) {
  const mod = PERINGKAT_MOD[p] || null;
  const T = idx.tarikhTerkini[p];
  if (!T) return [];
  const minggu = pilihMinggu(T, { bulan: params.bulan, minggu: params.minggu }, idx.tarikhAda[p]);
  if (!minggu) return [];
  const prev = tambahHari(minggu.mula, -7);
  const kumpul = new Map();
  for (const e of idx.entri[p]) {
    if (e.t < prev || e.t > minggu.akhir || !padanPenapis(e, f)) continue;
    for (const en of entiti(e, params.aras, f)) {
      const k = e.c + '\u0001' + e.v + '\u0001' + en.id;
      let g = kumpul.get(k);
      if (!g) {
        g = { en, c: e.c, v: e.v, cdb: e.cdb, vdb: e.vdb, u: e.u, entri: [] };
        kumpul.set(k, g);
      }
      g.entri.push(e);
    }
  }
  const hasil = [];
  for (const g of kumpul.values()) {
    const harga = hargaMinggu(g.entri, minggu.mula);
    const sebelum = hargaMinggu(g.entri, prev);
    const amb = ambIdx.get(kunciAmbang(p, g.cdb, g.vdb, g.en.negeri)) || null;
    const adaAmbang =
      !!amb &&
      ([amb.mean, amb.sd, amb.lantai, amb.siling].some((x) => x != null) || !!amb.perubahan);
    const a = nilaiAlarm(
      mod,
      {
        harga,
        hargaSebelum: sebelum,
        mean: amb && amb.mean,
        sd: amb && amb.sd,
        lantai: amb && amb.lantai,
        siling: amb && amb.siling,
        bilangan: amb && amb.bilangan,
        ambangPerubahan: amb && amb.perubahan,
        adaAmbang: !!adaAmbang,
        separa: minggu.separa,
        asas: amb ? amb.asas : null,
      },
      cfg,
    );
    hasil.push({
      peringkat: p,
      aras: params.aras,
      negeri: g.en.negeri,
      po: g.en.po,
      daerah: g.en.daerah,
      commodity: g.c,
      variety: g.v,
      unit: g.u,
      harga,
      hargaSebelum: sebelum,
      pctMinggu: a.perubahanPct,
      rmMinggu: harga != null && sebelum != null ? bulat(harga - sebelum, 2) : null,
      minggu,
      status: a.status,
      sebab: a.sebab,
      asas: amb ? amb.asas : null,
      mean: amb ? amb.mean : null,
      sd: amb ? amb.sd : null,
      lantai: amb ? amb.lantai : null,
      siling: amb ? amb.siling : null,
      z: a.z,
      ganti: null,
      _id: g.en.id,
    });
  }
  return hasil;
}
const urutBaris = (a, b) =>
  (
    a.peringkat +
    a.commodity +
    a.variety +
    a.negeri +
    (a.po || '') +
    (a.daerah || '')
  ).localeCompare(
    b.peringkat + b.commodity + b.variety + b.negeri + (b.po || '') + (b.daerah || ''),
    'en',
  );

function penapisDariParam(params) {
  return {
    negeri: params.negeri ? normNegeri(params.negeri) : null,
    po: params.po || null,
    daerah: params.daerah ? normDaerah(params.daerah) : null,
    commodity: params.commodity ? normNama(params.commodity) : null,
    variety: params.variety ? normNama(params.variety) : null,
  };
}
function kepala(idx, meta, sekarang, cfg) {
  const tarikhTerkini = maks(Object.values(idx.tarikhTerkini));
  const umur = tarikhTerkini
    ? (Date.parse(new Date(sekarang).toISOString().slice(0, 10) + 'T00:00:00Z') -
        Date.parse(tarikhTerkini + 'T00:00:00Z')) /
      HARI_MS
    : Infinity;
  const separa = tarikhTerkini && ahad(isnin(tarikhTerkini)) > tarikhTerkini;
  return {
    tarikhTerkini,
    tarikhPeringkat: { ...idx.tarikhTerkini },
    lapuk: !(umur <= cfg.staleHari),
    disegarPada: (meta && meta.disegarPada) || null,
    mingguSemasaSeparaIso: separa ? mingguIso(tarikhTerkini).iso : null,
  };
}

// params (telah disahkan): peringkat, negeri, po, daerah, commodity, variety, bulan, minggu, aras, mod, siri
function jawabHarga(ringkas, ambang, meta, params = {}, opsyen = {}) {
  const cfg = { ...AMBANG_ALARM, ...(opsyen.cfg || {}) };
  const sekarang = opsyen.sekarang || Date.now();
  const idx = indeks(ringkas, opsyen.senarai);
  const ambIdx = indeksAmbang(ambang);
  const f = penapisDariParam(params);
  const p2 = { ...params, aras: params.aras || 'po' };
  const kep = kepala(idx, meta, sekarang, cfg);
  if (params.siri) {
    const p = params.peringkat;
    const entri = idx.entri[p].filter(
      (e) =>
        padanPenapis(e, f) &&
        e.n !== 'MALAYSIA' &&
        (!params.bulan || e.t.slice(0, 7) === params.bulan),
    );
    const negeriAmb = f.po ? PO_SEMUA_IKUT_ID[f.po].negeri : f.negeri;
    const dbAmb = entri.length
      ? { c: entri[0].cdb, v: entri[0].vdb }
      : { c: f.commodity, v: f.variety };
    const amb = negeriAmb ? ambIdx.get(kunciAmbang(p, dbAmb.c, dbAmb.v, negeriAmb)) : null;
    return {
      versi: 1,
      ...kep,
      siri: {
        peringkat: p,
        commodity: f.commodity,
        variety: f.variety,
        negeri: negeriAmb || null,
        po: f.po,
        daerah: f.daerah,
        unit: entri.length ? entri[0].u : null,
        titik: harianSiri(entri),
        asas: amb ? amb.asas : null,
        mean: amb ? amb.mean : null,
        sd: amb ? amb.sd : null,
        lantai: amb ? amb.lantai : null,
        siling: amb ? amb.siling : null,
      },
    };
  }
  const senarai = params.peringkat
    ? [params.peringkat]
    : params.mod
      ? [MOD_PERINGKAT[params.mod]]
      : PERINGKAT;
  let baris = senarai.flatMap((p) => kiraBaris(idx, ambIdx, p, f, p2, cfg));
  if (params.mod === 'pengeluar') {
    // Pengeluar tanpa harga ladang: tunjuk harga borong sebagai ganti berlabel; alarm tidak dijana daripadanya.
    const ada = new Set(
      baris
        .filter((b) => b.peringkat === 'LADANG' && b.harga != null)
        .map((b) => b.commodity + '\u0001' + b.variety + '\u0001' + b._id),
    );
    for (const b of kiraBaris(idx, ambIdx, 'BORONG', f, p2, cfg)) {
      if (b.harga == null || ada.has(b.commodity + '\u0001' + b.variety + '\u0001' + b._id))
        continue;
      baris = baris.filter(
        (x) =>
          !(
            x.peringkat === 'LADANG' &&
            x.commodity === b.commodity &&
            x.variety === b.variety &&
            x._id === b._id
          ),
      );
      baris.push({
        ...b,
        peringkat: 'LADANG',
        harga: null,
        hargaSebelum: null,
        pctMinggu: null,
        rmMinggu: null,
        status: 'kelabu',
        sebab: 'Tiada harga ladang',
        asas: null,
        mean: null,
        sd: null,
        lantai: null,
        siling: null,
        z: null,
        ganti: {
          peringkat: 'BORONG',
          harga: b.harga,
          label: 'Harga borong (ganti, tiada data ladang)',
        },
      });
    }
  }
  if (p2.aras === 'po') {
    // Amaran PO: dikira daripada status daerah dalam liputan PO, bagi setiap peringkat/komoditi/varieti.
    const { daerah: _d, ...pDaerah } = params;
    const barisDaerah = jawabHarga(
      ringkas,
      ambang,
      meta,
      { ...pDaerah, aras: 'daerah' },
      opsyen,
    ).baris;
    const ikutKunci = new Map();
    for (const d of barisDaerah) {
      if (!d.po) continue;
      const k = d.peringkat + '\u0001' + d.commodity + '\u0001' + d.variety + '\u0001' + d.po;
      if (!ikutKunci.has(k)) ikutKunci.set(k, []);
      ikutKunci.get(k).push(d);
    }
    for (const b of baris) {
      const k = b.peringkat + '\u0001' + b.commodity + '\u0001' + b.variety + '\u0001' + b._id;
      b.amaranPo = amaranPo(b, ikutKunci.get(k) || [], f, cfg);
    }
  }
  baris.sort(urutBaris);
  baris.forEach((b) => delete b._id);
  return { versi: 1, ...kep, aras: p2.aras, bilangan: baris.length, baris };
}

// Amaran PO daripada status daerah. Pulangan: {status, sebab, daerah{merah,kuning,hijau,kelabu,jumlah,sah}, daerahMerah[]}.
// Susunan: merah (>= 1 daerah merah) > kuning (nisbah kuning antara daerah sah >= amaranPoKuning, atau status PO sendiri
// merah/kuning) > hijau (nisbah daerah sah antara semua daerah liputan >= amaranPoLiputan) > kelabu.
function amaranPo(barisPo, barisDaerah, f, cfg) {
  const pasangan = PEM.ikutId[barisPo.po].pasangan.filter(
    (x) => !f.negeri || normNegeri(x.negeri) === f.negeri,
  );
  const kira = { merah: 0, kuning: 0, hijau: 0, kelabu: 0 };
  const merahNama = [];
  const dilihat = new Set();
  for (const d of barisDaerah) {
    if (dilihat.has(d.daerah)) continue;
    dilihat.add(d.daerah);
    kira[d.status] = (kira[d.status] || 0) + 1;
    if (d.status === 'merah') merahNama.push(d.daerah);
  }
  const jumlah = Math.max(pasangan.length, dilihat.size);
  const sah = kira.merah + kira.kuning + kira.hijau;
  kira.kelabu = jumlah - sah;
  const daerah = { ...kira, jumlah, sah };
  const nisbahKuning = sah ? kira.kuning / sah : 0;
  const nisbahLiputan = jumlah ? sah / jumlah : 0;
  const pct = (x) => Math.round(x * 100) + '%';
  let status;
  let sebab;
  if (kira.merah >= 1) {
    status = 'merah';
    sebab = `${kira.merah} daerah merah: ${merahNama.sort((a, b) => a.localeCompare(b, 'ms')).join(', ')}`;
  } else if (nisbahKuning >= cfg.amaranPoKuning && kira.kuning > 0) {
    status = 'kuning';
    sebab = `${kira.kuning} daripada ${sah} daerah sah kuning (${pct(nisbahKuning)})`;
  } else if (barisPo.status === 'merah' || barisPo.status === 'kuning') {
    status = 'kuning';
    sebab = `status purata PO ${barisPo.status}`;
  } else if (nisbahLiputan >= cfg.amaranPoLiputan) {
    status = 'hijau';
    sebab = `tiada daerah merah; ${sah} daripada ${jumlah} daerah ada data sah`;
  } else {
    status = 'kelabu';
    sebab = `data sah hanya ${sah} daripada ${jumlah} daerah (kurang ${pct(cfg.amaranPoLiputan)})`;
  }
  return { status, sebab, daerah, daerahMerah: merahNama };
}

// Daerah (NEGERI/DAERAH DB) yang diliputi satu PO mengikut config FIS 2.1
const daerahPO = (id) => PEM.ikutId[id].pasangan.map((x) => x.negeri + '/' + x.daerah);
function jawabMeta(ringkas, meta, opsyen = {}) {
  const cfg = { ...AMBANG_ALARM, ...(opsyen.cfg || {}) };
  const idx = indeks(ringkas, opsyen.senarai);
  const m = meta || {};
  const varieti = {};
  let komoditiSenarai = null;
  const senarai = opsyen.senarai === undefined ? komoditiDiliputi.muat() : opsyen.senarai;
  if (senarai) {
    // Senarai putih (bukan data): semua jenis dan varieti yang diliputi, pasangan tanpa data ditanda tiadaData.
    komoditiSenarai = senarai.jenis.map((j) => {
      const pas = senarai.pasangan.filter((p) => p.jenis === j.kod);
      varieti[j.kod] = pas.map((p) => p.variety).sort((a, b) => a.localeCompare(b, 'ms'));
      return {
        kod: j.kod,
        label: j.label,
        varieti: pas
          .map((p) => ({ kod: p.variety, label: p.label, tiadaData: p.tiadaData }))
          .sort((a, b) => a.kod.localeCompare(b.kod, 'ms')),
      };
    });
  } else for (const c of Object.keys(idx.komoditi).sort()) varieti[c] = [...idx.komoditi[c]].sort();
  return {
    versi: 1,
    ...kepala(idx, meta, opsyen.sekarang || Date.now(), cfg),
    penapis: {
      negeri: [...idx.negeri].sort(),
      po: PO_SENARAI.map((p) => ({ ...p, daerah: daerahPO(p.id) })),
      poTambahan: PO_TAMBAHAN.map((p) => ({ ...p, daerah: daerahPO(p.id) })),
      bulan: [...idx.bulan].sort(),
      komoditi: Object.keys(varieti),
      varieti,
      komoditiSenarai,
    },
    kiraan: m.kiraan || null,
    dikecualikan: m.dikecualikan || null,
    daerahTakPadan: m.daerahTakPadan || [],
    tidakDitugaskan: m.tidakDitugaskan || [],
    status: m.status || null,
    ambang: m.ambang || null,
  };
}

/* --- Pengesahan parameter --- */
const RE_TEKS = /^[\p{L}\p{N} .,()&'/\-[\]]{1,100}$/u;
// Pulangan {nilai} atau {ralat}. Parameter tidak dikenali ditolak.
function sahkanParam(sp) {
  const kenal = new Set([
    'peringkat',
    'negeri',
    'po',
    'daerah',
    'commodity',
    'variety',
    'bulan',
    'minggu',
    'aras',
    'mod',
    'siri',
  ]);
  const n = {};
  for (const k of sp.keys()) {
    if (!kenal.has(k)) return { ralat: 'Parameter tidak dikenali: ' + k.slice(0, 30) };
    if (sp.getAll(k).length > 1) return { ralat: 'Parameter berulang: ' + k };
  }
  const get = (k) => (sp.has(k) ? sp.get(k) : null);
  const peringkat = get('peringkat');
  if (peringkat !== null) {
    n.peringkat = peringkat.toUpperCase();
    if (!PERINGKAT.includes(n.peringkat)) return { ralat: 'Parameter peringkat tidak sah' };
  }
  const aras = get('aras');
  if (aras !== null) {
    if (!ARAS.includes(aras))
      return { ralat: 'Parameter aras tidak sah; guna negeri, po, po_tambahan atau daerah' };
    n.aras = aras;
  }
  const mod = get('mod');
  if (mod !== null) {
    if (!MOD_PERINGKAT[mod])
      return { ralat: 'Parameter mod tidak sah; guna pengeluar atau pengguna' };
    n.mod = mod;
  }
  const po = get('po');
  if (po !== null) {
    if (!PO_SEMUA_IKUT_ID[po]) return { ralat: 'Parameter po tidak sah' };
    n.po = po;
  }
  for (const k of ['negeri', 'daerah', 'commodity', 'variety']) {
    const v = get(k);
    if (v === null) continue;
    if (!RE_TEKS.test(v)) return { ralat: `Parameter ${k} tidak sah` };
    n[k] = v;
  }
  const bulan = get('bulan');
  if (bulan !== null) {
    if (!RE_BULAN.test(bulan)) return { ralat: 'Parameter bulan tidak sah; guna format YYYY-MM' };
    n.bulan = bulan;
  }
  const minggu = get('minggu');
  if (minggu !== null) {
    if (!tarikhSah(minggu)) return { ralat: 'Parameter minggu tidak sah; guna format YYYY-MM-DD' };
    n.minggu = minggu;
  }
  const siri = get('siri');
  if (siri !== null) {
    if (siri !== '1' && siri !== '0') return { ralat: 'Parameter siri tidak sah; guna 1' };
    if (siri === '1') {
      n.siri = true;
      if (!n.peringkat || !n.commodity || !n.variety)
        return { ralat: 'siri=1 memerlukan peringkat, commodity dan variety' };
    }
  }
  return { nilai: n };
}

module.exports = {
  AMBANG_ALARM,
  PERINGKAT,
  PO_SENARAI,
  PO_TAMBAHAN,
  PO_DAERAH,
  isnin,
  ahad,
  tambahHari,
  tarikhSah,
  mingguIso,
  mingguLengkap,
  pilihMinggu,
  normNegeri,
  normDaerah,
  normNama,
  poUntuk,
  poTambahanUntuk,
  kecualiBaris,
  agregatHarian,
  ambangPerubahan,
  nilaiAlarm,
  binaAmbang,
  indeks,
  indeksAmbang,
  jawabHarga,
  jawabMeta,
  sahkanParam,
};

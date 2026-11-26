'use strict';
// Penjana fixture DB Harga (deterministik, tiada rahsia, tiada rangkaian). Sampel ini sintetik tetapi berbentuk
// sama dengan data sebenar. Jalankan semula: node tests/fixtures/harga-db/jana.js && npx prettier --write tests/fixtures/harga-db
// Output: *-sampel.json (baris mentah kecil), cache-ambang-sampel.json, maklumat-ami-sampel.json,
// mean-sd-2025-sampel.json, mean-sd-2024-sampel.json dan cache siap pasang harga-ringkas/ambang/meta.json
// (dijana melalui binaDariBaris, kod yang sama dengan sync sebenar).
const fs = require('node:fs');
const path = require('node:path');
const hargaDb = require('../../../api/_services/harga-db.js');

const BULAT = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const SEKARANG = '2026-11-12T00:00:00.000Z';
const DIBUAT = '2026-11-11T01:00:00.123456+00:00';
const DIBUAT_UJIAN = '2026-11-21T07:37:24.489156+00:00';
const TARIKH_MULA = '2026-10-19';
const TARIKH_AKHIR = '2026-11-04';

const NEGERI = [
  ['PERLIS', ['PERLIS']],
  ['KEDAH', ['KOTA SETAR', 'KULIM', 'LANGKAWI']],
  ['PULAU PINANG', ['SEBERANG PERAI TENGAH']],
  ['PERAK', ['KAMPAR', 'KINTA', 'MANJUNG DINDING']],
  [
    'SELANGOR',
    ['KUALA LANGAT', 'HULU LANGAT', 'SEPANG', 'GOMBAK', 'HULU SELANGOR', 'PETALING', 'KLANG'],
  ],
  ['KUALA LUMPUR', ['KUALA LUMPUR', 'BATU', 'TITIWANGSA']],
  ['NEGERI SEMBILAN', ['SEREMBAN']],
  ['MELAKA', ['MELAKA TENGAH']],
  ['KELANTAN', ['KOTA BHARU', 'MACHANG']],
  ['TERENGGANU', ['KUALA TERENGGANU']],
  ['PAHANG', ['KUANTAN']],
  [
    'JOHOR',
    [
      'JOHOR BHARU',
      'KULAI',
      'KOTA TINGGI',
      'MERSING',
      'KLUANG',
      'PONTIAN',
      'BATU PAHAT',
      'TANGKAK',
    ],
  ],
  ['SABAH', ['KOTA KINABALU']],
  ['SARAWAK', ['SAMARAHAN', 'KUCHING']],
];
const TIDAK_DITUGASKAN = new Set(['BATU']);
const SEMUA_NEGERI = NEGERI.map((n) => n[0]);

const V = {
  cili: ['CILI', 'CILI MERAH KULAI / KULAI HIBRID', 'KILOGRAM'],
  bawang: ['BAWANG', 'BAWANG MERAH / KECIL (IMPORT)', 'KILOGRAM'],
  telur: ['TELUR AYAM', 'TELUR AYAM A', 'BIJI'],
  ayam: ['AYAM', 'AYAM HIDUP', 'KILOGRAM'],
  kubis: ['KUBIS', 'KUBIS BULAT (TANAH TINGGI)', 'KILOGRAM'],
  bayam: ['BAYAM', 'BAYAM', 'KILOGRAM'],
};
// kes: [varieti, peringkat, harga asas, ambang {mean,sd,lantai,siling,pct,unit,bil}|null, negeri ada|null, penimpa]
// penimpa: {NEGERI: {h:[minggu43, minggu44], amb:{...}|null}}
const A = (mean, sd, lantai, siling, pct = 15, unit = '%', bil = 40) => ({
  mean,
  sd,
  lantai,
  siling,
  pct,
  unit,
  bil,
});
const KES = [
  [
    'cili',
    'RUNCIT',
    10,
    A(10, 1, 7, 12),
    null,
    {
      SELANGOR: { h: [10, 12.5] }, // merah: z = 2.5
      KEDAH: { h: [10, 12.2], amb: A(11.5, 2, 7, 12) }, // kuning: siling sahaja
      PERAK: { h: [10, 11.2] }, // kuning: z = 1.2
      PERLIS: { h: [10, 12.6], amb: A(10, 2, 7, 12) }, // merah: siling + z = 1.3
      'PULAU PINANG': { h: [9, 10.5] }, // kuning: naik 16.7% (> 15%)
      KELANTAN: { h: [10, 10.2], amb: A(10, 0, 7, 12) }, // kelabu: sd = 0
      TERENGGANU: { h: [10, 10.2], amb: A(10, 1, 7, 12, 15, '%', 3) }, // kelabu: bilangan rekod 3
      PAHANG: { h: [10, 10.2], amb: null }, // kelabu: tiada ambang
    },
  ],
  [
    'cili',
    'LADANG',
    6,
    A(6, 0.8, 4.8, 8),
    null,
    {
      SELANGOR: { h: [6, 4.2] }, // merah: z = -2.25
      JOHOR: { h: [6, 4.7] }, // merah: lantai + z = -1.6
      KEDAH: { h: [6, 5.1] }, // kuning: z = -1.1
      SABAH: { h: [5.5, 4.7], amb: A(5.2, 1, 4.8, 8) }, // kuning: lantai sahaja
      SARAWAK: { h: [7, 5.9] }, // kuning: turun 15.7% (> 15%)
      PAHANG: { h: [6, 8.5] }, // arah salah untuk Pengeluar: hijau
    },
  ],
  ['cili', 'BORONG', 8, A(8, 0.8, 6, 10.5), null, {}],
  ['bawang', 'BORONG', 5, A(5, 0.4, 4, 6.5), null, {}],
  ['bawang', 'RUNCIT', 7, A(7, 0.5, 5.5, 8.5), null, {}],
  [
    'telur',
    'RUNCIT',
    0.45,
    A(0.45, 0.05, 0.36, 0.56, 0.1, 'RM'),
    null,
    {
      'NEGERI SEMBILAN': { h: [0.45, 0.58] }, // merah: z = 2.6
      SABAH: { h: [0.45, 0.58], amb: A(0.5, 0.2, 0.36, 0.7, 0.1, 'RM') }, // kuning: naik RM 0.13 (> RM 0.10)
      MELAKA: { h: [0.5, 0.45] }, // turun: bukan isyarat untuk Pengguna
    },
  ],
  ['telur', 'BORONG', 0.43, A(0.43, 0.04, 0.34, 0.54, 0.1, 'RM'), null, {}],
  [
    'telur',
    'LADANG',
    0.4,
    A(0.4, 0.04, 0.32, 0.5, 0.1, 'RM'),
    SEMUA_NEGERI.filter((n) => n !== 'PERLIS' && n !== 'KEDAH'),
    {},
  ],
  ['ayam', 'RUNCIT', 9, A(9, 0.6, 7.5, 11), null, {}],
  ['ayam', 'BORONG', 6.5, A(6.5, 0.5, 5.5, 8), null, {}],
  ['ayam', 'LADANG', 6, A(6, 0.5, 5, 7.5), null, {}],
  ['kubis', 'RUNCIT', 3.5, A(3.5, 0.3, 2.8, 4.4), null, {}],
  ['kubis', 'BORONG', 2.5, A(2.5, 0.2, 2, 3.2), null, {}],
  ['kubis', 'LADANG', 2, A(2, 0.2, 1.5, 2.6), ['PAHANG', 'PERAK'], {}],
  ['bayam', 'RUNCIT', 4, null, null, {}],
];
const KECUALI_AMBANG = {
  'AYAM HIDUP|RUNCIT|JOHOR': 'tiada-meansd',
  'AYAM HIDUP|RUNCIT|MELAKA': 'asas-2024',
};

// Hari dalam minggu: Isnin..Ahad. Hasil tambah 0 supaya purata mingguan = harga sasaran.
const GOYANG = [-0.02, 0.02, -0.01, 0.01, 0, 0, 0];
function senaraiTarikh() {
  const hasil = [];
  for (
    let t = TARIKH_MULA;
    t <= TARIKH_AKHIR;
    t = new Date(Date.parse(t + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10)
  )
    hasil.push(t);
  return hasil;
}
const hariKeMinggu = (t) => (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7;
function harga(h, t) {
  const sasaran = t < '2026-10-26' ? h[0] : h[1];
  const goyang = t >= '2026-11-02' ? 0 : GOYANG[hariKeMinggu(t)];
  return sasaran * (1 + goyang);
}

function binaData() {
  const baris = { LADANG: [], BORONG: [], RUNCIT: [] };
  const cache = [];
  const ami = [];
  const meanSd = { 2024: [], 2025: [] };
  let id = 1000;
  const tarikh = senaraiTarikh();
  for (const [kv, peringkat, asas, amb, negeriAda, penimpa] of KES) {
    const [commodity, variety, unit] = V[kv];
    if (amb)
      ami.push({
        commodity_variety_name: variety,
        peringkat,
        rutin_kutipan: 'MINGGUAN',
        nilai_perubahan_rm: amb.pct,
        nilai_perubahan_unit: amb.unit,
        ceiling_warning: amb.siling,
        floor_warning: amb.lantai,
      });
    for (const [negeri, daerahList] of NEGERI) {
      if (negeriAda && !negeriAda.includes(negeri)) continue;
      const p = penimpa[negeri] || {};
      const h = p.h || [asas, BULAT(asas * 1.01)];
      const a = p.amb !== undefined ? p.amb : amb;
      if (a) {
        const k = `${variety}|${peringkat}|${negeri}`;
        const khas = KECUALI_AMBANG[k];
        cache.push({
          commodity,
          commodity_variety_name: variety,
          negeri,
          peringkat,
          mean_last_year: a.mean,
          sd_last_year: a.sd,
          nilai_perubahan_rm: a.pct,
          floor_warning: a.lantai,
          ceiling_warning: a.siling,
          error_messages:
            khas === 'asas-2024' ? 'Fallback ke tahun 2024 kerana tahun asal tiada padanan' : null,
          updated_at: '2026-11-13T04:03:53+00:00',
        });
        if (khas !== 'tiada-meansd')
          meanSd[khas === 'asas-2024' ? 2024 : 2025].push({
            negeri,
            peringkat,
            commodity,
            commodity_variety_name: variety,
            bilangan_rekod: a.bil,
          });
      }
      for (const daerah of daerahList) {
        const faktor = TIDAK_DITUGASKAN.has(daerah) ? 1.1 : 1;
        for (const t of tarikh) {
          const hp = harga(h, t) * faktor;
          const d = asas * 0.01;
          [-d, d].forEach((ofset, i) =>
            baris[peringkat].push({
              id: id++,
              created_at: DIBUAT,
              tarikh_akhir: t,
              avg_harga: BULAT(hp + ofset),
              commodity,
              commodity_variety_name: variety,
              negeri,
              daerah,
              unit,
              gred: String(i + 1),
            }),
          );
        }
      }
    }
    // Satu baris kebangsaan (MALAYSIA, tanpa daerah) per kunci: masuk cache tetapi bukan peta/PO.
    for (const t of tarikh.slice(-2))
      baris[peringkat].push({
        id: id++,
        created_at: DIBUAT,
        tarikh_akhir: t,
        avg_harga: BULAT(asas),
        commodity,
        commodity_variety_name: variety,
        negeri: 'MALAYSIA',
        daerah: null,
        unit,
        gred: null,
      });
  }
  // Baris ujian pengguna (id env) dan satu varieti tunggal tanpa rujukan.
  const ujian = [
    [6912893, 'TELUR AYAM GRED B', 'TELUR AYAM', 'SELANGOR', 'GOMBAK', 'BIJI', '0.48'],
    [6912894, 'CILI MERAH KULAI', 'CILI MERAH', 'JOHOR', 'KLUANG', 'KG', '4.50'],
    [6912895, 'IKAN KEMBUNG', 'IKAN KEMBUNG', 'PERAK', 'MANJUNG', 'KG', '14.80'],
    [6912896, 'KUBIS BULAT (TEMPATAN)', 'KUBIS BULAT', 'PAHANG', 'CAMERON HIGHLANDS', 'KG', '3.20'],
    [6912897, 'AYAM BERSIH - STANDARD', 'AYAM', 'SELANGOR', 'GOMBAK', 'KG', '10.40'],
  ];
  for (const [i, v, c, n, d, u, h] of ujian)
    baris.RUNCIT.push({
      id: i,
      created_at: DIBUAT_UJIAN,
      tarikh_akhir: '2026-11-21',
      avg_harga: h,
      commodity: c,
      commodity_variety_name: v,
      negeri: n,
      daerah: d,
      unit: u,
      gred: null,
    });
  baris.RUNCIT.push({
    id: 9000001,
    created_at: DIBUAT,
    tarikh_akhir: '2026-11-04',
    avg_harga: 1.23,
    commodity: 'UJIAN',
    commodity_variety_name: 'VARIETI UJIAN TUNGGAL',
    negeri: 'KEDAH',
    daerah: 'ALOR SETAR',
    unit: 'KILOGRAM',
    gred: null,
  });
  return { baris, cache, ami, meanSd };
}

const KOLOM = (r) => {
  const { gred, ...baki } = r;
  return baki;
};
function tulis(nama, obj) {
  fs.writeFileSync(path.join(__dirname, nama), JSON.stringify(obj));
}
const { baris, cache, ami, meanSd } = binaData();
// Sampel mentah kecil (dua hari terkini, satu varieti) + baris ujian: untuk ujian pagination/pengecualian.
const sampel = (p) =>
  baris[p].filter(
    (r) =>
      (r.commodity_variety_name === 'CILI MERAH KULAI / KULAI HIBRID' &&
        r.tarikh_akhir >= '2026-11-03' &&
        r.tarikh_akhir <= '2026-11-04') ||
      r.id >= 6912893,
  );
tulis('ladang-sampel.json', sampel('LADANG').map(KOLOM));
tulis('borong-sampel.json', sampel('BORONG').map(KOLOM));
tulis('runcit-sampel.json', sampel('RUNCIT').map(KOLOM));
tulis('cache-ambang-sampel.json', cache);
tulis('maklumat-ami-sampel.json', ami);
tulis('mean-sd-2025-sampel.json', meanSd[2025]);
tulis('mean-sd-2024-sampel.json', meanSd[2024]);

const hasil = hargaDb.binaDariBaris(
  {
    LADANG: baris.LADANG.map(KOLOM),
    BORONG: baris.BORONG.map(KOLOM),
    RUNCIT: baris.RUNCIT.map(KOLOM),
  },
  { cache, ami, meanSd },
  { sekarang: SEKARANG, idKecuali: hargaDb.ID_KECUALI_LALAI },
);
tulis('harga-ringkas.json', hasil.ringkas);
tulis('harga-ambang.json', hasil.ambang);
tulis('harga-meta.json', hasil.meta);
console.log(
  JSON.stringify({
    tarikhTerkini: hasil.meta.tarikhTerkini,
    kiraan: hasil.meta.kiraan,
    dikecualikan: {
      id: hasil.meta.dikecualikan.id,
      tiadaRujukan: hasil.meta.dikecualikan.tiadaRujukan,
    },
    tidakDitugaskan: hasil.meta.tidakDitugaskan.length,
    daerahTakPadan: hasil.meta.daerahTakPadan,
    ambang: hasil.meta.ambang,
  }),
);

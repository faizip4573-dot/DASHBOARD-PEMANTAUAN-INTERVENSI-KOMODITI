'use strict';
// Gazetteer lokasi dan pengekstrak lokasi daripada teks nota AI Muse. Deterministik; tiada lokasi direka.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const MAKS_LOKASI = 5;

// Daerah dalam dashboard-data.js (DATA.po[].districts) beserta poId.
// semua=true menambah daerah PO tambahan (poId null: bukan 15 PO utama) supaya lokasi seperti Setiu atau Kuching kekal dikenali.
function muatDaerahPO(semua = false) {
  const teks = fs.readFileSync(path.join(ROOT, 'src', 'data', 'dashboard-data.js'), 'utf8');
  const g = {};
  new Function('g', teks.replace(/^\s*const DATA\s*=/m, 'g.DATA ='))(g);
  require('../../src/data/pemetaan-po-terap.js').terap(
    g.DATA,
    require('./pemetaan-po.js').muat().konfig,
  );
  const hasil = [];
  g.DATA.po.forEach((p) =>
    (p.districts || []).forEach((d) => hasil.push({ nama: d[0], negeri: p.negeri, poId: p.id })),
  );
  if (semua)
    (g.DATA.poTambahan || []).forEach((p) =>
      p.districts
        .filter((d) => !['KUALA LUMPUR', 'PUTRAJAYA', 'LABUAN'].includes(d[3]))
        .forEach((d) => hasil.push({ nama: d[0], negeri: p.negeri, poId: null })),
    );
  return hasil;
}

const NEGERI = [
  ['Johor', 'Johor'],
  ['Kedah', 'Kedah'],
  ['Kelantan', 'Kelantan'],
  ['Melaka', 'Melaka'],
  ['Negeri Sembilan', 'Negeri Sembilan'],
  ['Pahang', 'Pahang'],
  ['Perak', 'Perak'],
  ['Perlis', 'Perlis'],
  ['Pulau Pinang', 'Pulau Pinang'],
  ['Penang', 'Pulau Pinang'],
  ['Sabah', 'Sabah'],
  ['Sarawak', 'Sarawak'],
  ['Selangor', 'Selangor'],
  ['Terengganu', 'Terengganu'],
  ['Kuala Lumpur', 'WP Kuala Lumpur'],
  ['Putrajaya', 'WP Putrajaya'],
  ['Labuan', 'WP Labuan'],
];

const TAMBAHAN = {
  Terengganu: ['Dungun', 'Kemaman', 'Besut', 'Hulu Terengganu', 'Kuala Nerus'],
  Kelantan: ['Gua Musang', 'Jeli', 'Machang', 'Pasir Puteh', 'Kuala Krai', 'Tumpat'],
  Pahang: ['Cameron Highlands', 'Lipis', 'Raub', 'Jerantut', 'Rompin', 'Maran', 'Bera'],
  Johor: ['Muar', 'Segamat', 'Mersing', 'Tangkak'],
  Kedah: ['Baling', 'Kulim', 'Langkawi', 'Padang Terap', 'Bandar Baharu', 'Sik'],
  Perak: [
    'Ipoh',
    'Taiping',
    'Teluk Intan',
    'Hilir Perak',
    'Batang Padang',
    'Tapah',
    'Bagan Datuk',
    'Larut Matang',
    'Hulu Perak',
  ],
  Selangor: ['Klang', 'Kuala Selangor', 'Sabak Bernam', 'Shah Alam'],
  'Negeri Sembilan': ['Kuala Pilah', 'Tampin', 'Rembau', 'Jempol'],
  Sabah: [
    'Sandakan',
    'Tawau',
    'Keningau',
    'Kudat',
    'Lahad Datu',
    'Semporna',
    'Beaufort',
    'Kota Belud',
    'Papar',
    'Tenom',
  ],
  Sarawak: [
    'Miri',
    'Sibu',
    'Bintulu',
    'Sri Aman',
    'Betong',
    'Limbang',
    'Sarikei',
    'Mukah',
    'Kapit',
    'Bau',
    'Lundu',
  ],
};

// Perkataan biasa Bahasa Melayu / nama pendek: hanya padan dengan huruf besar permulaan (sensitif huruf).
const PEKA = new Set(['Pekan', 'Yan', 'Bau', 'Sik', 'Bera', 'Kapit', 'Tanah Merah']);

let _entri = null;
function entri() {
  if (_entri) return _entri;
  const peta = new Map();
  const tambah = (e) => {
    const k = e.negeri + '|' + e.nama;
    if (!peta.has(k)) peta.set(k, e);
    else if (e.poId && !peta.get(k).poId) peta.get(k).poId = e.poId;
  };
  muatDaerahPO(true).forEach((d) => tambah({ ...d, jenis: 'daerah' }));
  Object.entries(TAMBAHAN).forEach(([negeri, senarai]) =>
    senarai.forEach((nama) => tambah({ nama, negeri, poId: null, jenis: 'daerah' })),
  );
  NEGERI.forEach(([nama, negeri]) => tambah({ nama, negeri, poId: null, jenis: 'negeri' }));
  _entri = [...peta.values()]
    .map((e) => {
      const peka = PEKA.has(e.nama);
      const corak = e.nama.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return {
        ...e,
        re: new RegExp(`(?<![\\p{L}\\p{N}])${corak}(?![\\p{L}\\p{N}])`, peka ? 'gu' : 'giu'),
      };
    })
    .sort((a, b) => b.nama.length - a.nama.length);
  return _entri;
}

// Pulangan: [{negeri, daerah|null, jenis:'disebut', poId|null}] ikut susunan sebutan pertama, maks 5.
function ekstrakLokasi(nota) {
  const teks = typeof nota === 'string' ? nota : '';
  if (!teks) return [];
  const guna = [];
  const hit = [];
  for (const e of entri()) {
    e.re.lastIndex = 0;
    let m;
    while ((m = e.re.exec(teks))) {
      const a = m.index;
      const b = a + m[0].length;
      if (guna.some(([x, y]) => a < y && b > x)) continue;
      guna.push([a, b]);
      hit.push({ pos: a, e });
    }
  }
  const negeriAdaDaerah = new Set(hit.filter((h) => h.e.jenis === 'daerah').map((h) => h.e.negeri));
  const lihat = new Set();
  const hasil = [];
  hit
    .filter((h) => h.e.jenis === 'daerah' || !negeriAdaDaerah.has(h.e.negeri))
    .sort((x, y) => x.pos - y.pos)
    .forEach(({ e }) => {
      const k = e.negeri + '|' + (e.jenis === 'daerah' ? e.nama : '');
      if (lihat.has(k)) return;
      lihat.add(k);
      hasil.push({
        negeri: e.negeri,
        daerah: e.jenis === 'daerah' ? e.nama : null,
        jenis: 'disebut',
        poId: e.jenis === 'daerah' ? e.poId || null : null,
      });
    });
  return hasil.slice(0, MAKS_LOKASI);
}

module.exports = { ekstrakLokasi, muatDaerahPO, MAKS_LOKASI };

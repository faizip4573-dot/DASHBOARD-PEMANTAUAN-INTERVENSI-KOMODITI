'use strict';
// Ujian DB Harga: minggu ISO, normalisasi, pemetaan PO, pengecualian, agregasi, peraturan alarm, paginasi dan sync.
// Tiada rangkaian (fetchJson disuntik). Jalankan dari root: node --no-warnings tests/api/harga-db-unit.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const kira = require('../../api/_services/harga-db-kira.js');
const hargaDb = require('../../api/_services/harga-db.js');

const DIR = path.join(__dirname, '..', 'fixtures', 'harga-db');
const baca = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
const KUNCI = 'KUNCI-PALSU-UNTUK-UJIAN-123';
const URL_PALSU = 'https://pangkalan-palsu.example';
const hampir = (a, b, t = 0.01) => assert.ok(Math.abs(a - b) <= t, `${a} !~ ${b}`);

const gagal = [];
const senarai = [];
const ok = (nama, fn) => senarai.push([nama, fn]);

/* --- Minggu ISO --- */
ok('mingguIso: sempadan tahun dan minggu 53', () => {
  assert.deepStrictEqual(kira.mingguIso('2026-11-04'), {
    iso: '2026-W45',
    tahun: 2026,
    minggu: 45,
    mula: '2026-11-02',
    akhir: '2026-11-08',
  });
  assert.strictEqual(kira.mingguIso('2025-12-29').iso, '2026-W01');
  assert.strictEqual(kira.mingguIso('2025-12-29').mula, '2025-12-29');
  assert.strictEqual(kira.mingguIso('2026-01-04').iso, '2026-W01');
  assert.strictEqual(kira.mingguIso('2021-01-03').iso, '2020-W53');
  assert.strictEqual(kira.mingguIso('2026-10-26').iso, '2026-W44');
  assert.strictEqual(kira.mingguIso('2026-11-01').iso, '2026-W44');
});
ok('mingguLengkap: Ahad dikira lengkap, hari lain minggu sebelum', () => {
  assert.strictEqual(kira.mingguLengkap('2026-11-04'), '2026-10-26');
  assert.strictEqual(kira.mingguLengkap('2026-11-01'), '2026-10-26');
  assert.strictEqual(kira.mingguLengkap('2026-11-08'), '2026-11-02');
  assert.strictEqual(kira.mingguLengkap('2026-10-31'), '2026-10-19');
});
ok('pilihMinggu: lalai, bulan, minggu separa dan bulan tanpa minggu lengkap', () => {
  const ada = ['2026-10-19', '2026-11-04'];
  const lalai = kira.pilihMinggu('2026-11-04', {}, ada);
  assert.deepStrictEqual(lalai, {
    iso: '2026-W44',
    mula: '2026-10-26',
    akhir: '2026-11-01',
    separa: false,
  });
  assert.strictEqual(kira.pilihMinggu('2026-11-04', { bulan: '2026-11' }, ada).iso, '2026-W44');
  assert.strictEqual(kira.pilihMinggu('2026-11-04', { bulan: '2026-10' }, ada).iso, '2026-W43');
  assert.strictEqual(kira.pilihMinggu('2026-11-04', { bulan: '2026-09' }, ada), null);
  const sep = kira.pilihMinggu('2026-11-04', { minggu: '2026-11-04' }, ada);
  assert.deepStrictEqual([sep.iso, sep.mula, sep.separa], ['2026-W45', '2026-11-02', true]);
  // Bulan yang hanya ada minggu belum lengkap: paparkan minggu separa itu
  const f = kira.pilihMinggu('2026-12-03', { bulan: '2026-12' }, [
    '2026-12-01',
    '2026-12-02',
    '2026-12-03',
  ]);
  assert.deepStrictEqual([f.mula, f.separa], ['2026-11-30', true]);
});

/* --- Normalisasi dan PO --- */
ok('normalisasi nama negeri dan daerah', () => {
  assert.strictEqual(kira.normDaerah('Johor Baharu'), 'JOHOR BAHRU');
  assert.strictEqual(kira.normDaerah('JOHOR BHARU'), 'JOHOR BAHRU');
  assert.strictEqual(kira.normDaerah('Johor Bahru'), 'JOHOR BAHRU');
  assert.strictEqual(kira.normDaerah('MANJUNG (DINDING)'), 'MANJUNG DINDING');
  assert.strictEqual(kira.normNegeri('W.P. Kuala Lumpur'), 'KUALA LUMPUR');
  assert.strictEqual(kira.normNegeri(' pulau  pinang '), 'PULAU PINANG');
  assert.strictEqual(kira.normDaerah(null), '');
});
ok('poUntuk: pemetaan FIS 2.1 (config), PO tambahan bertindih dan daerah tidak ditugaskan', () => {
  const u = kira.poUntuk;
  assert.strictEqual(u('SELANGOR', 'SEPANG'), 'selangor');
  assert.strictEqual(u('SELANGOR', 'KUALA LANGAT'), 'selangor');
  assert.strictEqual(u('SELANGOR', 'HULU LANGAT'), 'selangor');
  assert.strictEqual(u('SELANGOR', 'GOMBAK'), 'selayang');
  assert.strictEqual(u('SELANGOR', 'HULU SELANGOR'), 'selayang');
  assert.strictEqual(u('KUALA LUMPUR', null), null); // tanpa daerah: tiada PO (FIS ikut daerah)
  assert.strictEqual(u('KUALA LUMPUR', 'BATU'), null);
  assert.strictEqual(u('Kuala Lumpur', 'Kuala Lumpur'), 'selayang');
  assert.strictEqual(u('JOHOR', 'JOHOR BAHRU'), 'johor');
  assert.strictEqual(u('JOHOR', 'Johor Bharu'), 'johor');
  assert.strictEqual(u('JOHOR', 'KULAI'), 'johor');
  assert.strictEqual(u('JOHOR', 'KOTA TINGGI'), 'johor');
  assert.strictEqual(u('JOHOR', 'MERSING'), 'johor');
  assert.strictEqual(u('JOHOR', 'KLUANG'), 'simpangrenggam');
  assert.strictEqual(u('JOHOR', 'PONTIAN'), 'simpangrenggam');
  assert.strictEqual(u('SELANGOR', 'PETALING'), null);
  assert.strictEqual(u('SELANGOR', 'KLANG'), null);
  assert.strictEqual(u('JOHOR', 'BATU PAHAT'), 'simpangrenggam'); // FIS 2.1
  assert.strictEqual(u('JOHOR', 'MUAR'), null);
  assert.strictEqual(u('MALAYSIA', null), null);
  assert.strictEqual(u('PUTRAJAYA', 'PUTRAJAYA'), 'selangor'); // Dengkil termasuk Putrajaya
  assert.strictEqual(u('LABUAN', 'LABUAN'), 'sabah');
  assert.strictEqual(u('PERAK', 'MANJUNG (DINDING)'), null); // Manjung = PO tambahan
  assert.strictEqual(u('PERAK', 'KAMPAR'), 'perak');
  assert.strictEqual(u('PERAK', 'KINTA'), null);
  assert.strictEqual(u('Pulau Pinang', 'Barat Daya'), 'penang');
  const t = kira.poTambahanUntuk;
  assert.deepStrictEqual(t('SELANGOR', 'KLANG'), ['tbh-puchong']);
  assert.deepStrictEqual(t('SELANGOR', 'PETALING'), ['tbh-puchong']);
  assert.deepStrictEqual(t('PERAK', 'MANJUNG (DINDING)'), ['tbh-manjung']);
  assert.deepStrictEqual(t('SELANGOR', 'GOMBAK'), ['tbh-pasar-tani-borong-selayang']); // bertindih dgn Selayang
  assert.deepStrictEqual(t('NEGERI SEMBILAN', 'JELEBU'), ['tbh-jelebu']); // bertindih dgn Seremban
  assert.deepStrictEqual(t('SARAWAK', 'KUCHING'), ['tbh-kota-samarahan']);
  assert.deepStrictEqual(t('JOHOR', 'KLUANG'), []);
  assert.strictEqual(kira.PO_TAMBAHAN.length, 25);
  assert.strictEqual(kira.PO_SENARAI.length, 15);
});

/* --- Pengecualian dan agregasi --- */
const baris = (id, t, c, v, extra = {}) => ({
  id,
  tarikh_akhir: t,
  commodity: c,
  commodity_variety_name: v,
  negeri: 'KEDAH',
  daerah: 'ALOR SETAR',
  unit: 'KILOGRAM',
  avg_harga: 5,
  ...extra,
});
ok('kecualiBaris: id env dan varieti tanpa rujukan >= 2 tarikh', () => {
  const rows = [
    baris(1, '2026-11-01', 'CILI', 'CILI A'),
    baris(2, '2026-11-02', 'CILI', 'CILI A'),
    baris(6912893, '2026-11-21', 'CILI', 'CILI A'),
    baris(3, '2026-11-02', 'UJIAN', 'UJIAN TUNGGAL'),
    baris(4, '2026-11-02', 'UJIAN', 'UJIAN TUNGGAL'), // tarikh sama = masih satu tarikh
  ];
  const r = kira.kecualiBaris(rows, { idKecuali: ['6912893'] });
  assert.deepStrictEqual(
    r.simpan.map((x) => x.id),
    [1, 2],
  );
  assert.strictEqual(r.dikecualikan.id, 1);
  assert.strictEqual(r.dikecualikan.tiadaRujukan, 2);
  assert.strictEqual(r.dikecualikan.contoh[0].variety, 'UJIAN TUNGGAL');
  // Rujukan daripada tarikh lain yang sudah disimpan menyelamatkan baris tunggal
  const rujukan = new Map([['UJIAN|UJIAN TUNGGAL', new Set(['2026-10-30'])]]);
  const r2 = kira.kecualiBaris(rows.slice(3), { rujukan });
  assert.strictEqual(r2.simpan.length, 2);
});
ok('agregatHarian: purata merentas gred/institusi, unit, nama dan baris tidak sah', () => {
  const rows = [
    baris(1, '2026-11-02', 'CILI', 'CILI A', { avg_harga: 4, gred: '1' }),
    baris(2, '2026-11-02', 'CILI', 'CILI A', { avg_harga: '6.00', gred: '2' }),
    baris(3, '2026-11-02', 'CILI', 'CILI A', { avg_harga: null }),
    baris(4, '2026-11-02', 'CILI', 'CILI A', { daerah: 'KUBANG PASU', avg_harga: 10 }),
    baris(5, '2026-11-02', 'CILI', 'CILI A', {
      negeri: 'W.P. Kuala Lumpur',
      daerah: null,
      avg_harga: 8,
    }),
    baris(6, '2026-11-02', 'CILI', 'CILI A', {
      negeri: 'JOHOR',
      daerah: 'Johor Baharu',
      avg_harga: 2,
    }),
    baris(7, '2026-11-02', 'CILI', 'CILI A', {
      negeri: 'JOHOR',
      daerah: 'JOHOR BHARU',
      avg_harga: 4,
    }),
    baris(8, 'bukan-tarikh', 'CILI', 'CILI A'),
  ];
  const a = kira.agregatHarian(rows);
  const cari = (n, d) => a.find((e) => e.n === n && e.d === d);
  assert.deepStrictEqual(
    {
      h: cari('KEDAH', 'ALOR SETAR').h,
      nb: cari('KEDAH', 'ALOR SETAR').nb,
      u: cari('KEDAH', 'ALOR SETAR').u,
    },
    { h: 5, nb: 2, u: 'KG' },
  );
  assert.strictEqual(cari('KEDAH', 'KUBANG PASU').h, 10);
  assert.strictEqual(cari('KUALA LUMPUR', 'KUALA LUMPUR').h, 8);
  assert.deepStrictEqual([cari('JOHOR', 'JOHOR BAHRU').h, cari('JOHOR', 'JOHOR BAHRU').nb], [3, 2]);
  assert.strictEqual(a.length, 4);
});

/* --- Ambang perubahan dan peraturan alarm --- */
ok('ambangPerubahan: % lalai, RM dan nilai tidak sah', () => {
  assert.deepStrictEqual(kira.ambangPerubahan(15, '%'), { nilai: 15, unit: '%' });
  assert.deepStrictEqual(kira.ambangPerubahan('0.1', 'RM'), { nilai: 0.1, unit: 'RM' });
  assert.deepStrictEqual(kira.ambangPerubahan(10, null), { nilai: 10, unit: '%' });
  assert.strictEqual(kira.ambangPerubahan(null, '%'), null);
  assert.strictEqual(kira.ambangPerubahan(0, '%'), null);
});
const asasIn = {
  harga: 10,
  hargaSebelum: 10,
  mean: 10,
  sd: 1,
  lantai: 7,
  siling: 12,
  bilangan: 40,
  ambangPerubahan: { nilai: 15, unit: '%' },
  adaAmbang: true,
  separa: false,
  asas: 2025,
};
const a = (mod, o) => kira.nilaiAlarm(mod, { ...asasIn, ...o });
ok('nilaiAlarm Pengguna: merah, kuning, hijau dan sebab', () => {
  let r = a('pengguna', { harga: 12.5, hargaSebelum: 12.5 });
  assert.strictEqual(r.status, 'merah');
  assert.match(r.sebab, /z = 2\.5\u03c3 \(asas 2025\)/);
  // siling + z >= 1 -> merah
  r = a('pengguna', { harga: 12.5, hargaSebelum: 12.5, sd: 2 });
  assert.strictEqual(r.status, 'merah');
  assert.match(r.sebab, /melepasi siling dasar RM 12\.00/);
  // siling sahaja (z < 1) -> kuning
  r = a('pengguna', { harga: 12.1, hargaSebelum: 12.1, mean: 11.5, sd: 2 });
  assert.strictEqual(r.status, 'kuning');
  assert.match(r.sebab, /melepasi siling dasar RM 12\.00/);
  // z >= 1 sahaja -> kuning
  r = a('pengguna', { harga: 11.2, hargaSebelum: 11.2 });
  assert.strictEqual(r.status, 'kuning');
  assert.match(r.sebab, /z = 1\.2/);
  // perubahan % mingguan -> kuning
  r = a('pengguna', { harga: 10.5, hargaSebelum: 9 });
  assert.strictEqual(r.status, 'kuning');
  assert.match(r.sebab, /naik 16\.7% minggu ke minggu, ambang 15%/);
  assert.strictEqual(r.perubahanPct, 16.7);
  // perubahan RM mingguan -> kuning
  r = a('pengguna', {
    harga: 0.58,
    hargaSebelum: 0.45,
    mean: 0.5,
    sd: 0.2,
    lantai: 0.3,
    siling: 0.9,
    ambangPerubahan: { nilai: 0.1, unit: 'RM' },
  });
  assert.strictEqual(r.status, 'kuning');
  assert.match(r.sebab, /naik RM 0\.13 minggu ke minggu, ambang RM 0\.10/);
  // hijau
  r = a('pengguna', { harga: 10.2, hargaSebelum: 10 });
  assert.strictEqual(r.status, 'hijau');
  assert.strictEqual(r.asas, 2025);
  // turun tinggi bukan isyarat untuk Pengguna
  assert.strictEqual(a('pengguna', { harga: 8, hargaSebelum: 12 }).status, 'hijau');
});
ok('nilaiAlarm Pengeluar: arah terbalik, lantai dan perubahan turun', () => {
  const p = { mean: 6, sd: 0.8, lantai: 4.8, siling: 8 };
  let r = a('pengeluar', { ...p, harga: 4.2, hargaSebelum: 4.2 });
  assert.strictEqual(r.status, 'merah');
  assert.match(r.sebab, /z = \u22122\.2\u03c3|z = \u22122\.3\u03c3/);
  r = a('pengeluar', { ...p, harga: 4.7, hargaSebelum: 4.7 }); // lantai + z = -1.6
  assert.strictEqual(r.status, 'merah');
  assert.match(r.sebab, /di bawah lantai dasar RM 4\.80/);
  r = a('pengeluar', { ...p, harga: 5.1, hargaSebelum: 5.1 }); // z = -1.1
  assert.strictEqual(r.status, 'kuning');
  r = a('pengeluar', { mean: 5.2, sd: 1, lantai: 4.8, siling: 8, harga: 4.7, hargaSebelum: 4.8 }); // lantai sahaja
  assert.strictEqual(r.status, 'kuning');
  r = a('pengeluar', { ...p, harga: 5.9, hargaSebelum: 7 }); // turun 15.7%
  assert.strictEqual(r.status, 'kuning');
  assert.match(r.sebab, /turun 15\.7% minggu ke minggu, ambang 15%/);
  // arah salah: harga naik tinggi melepasi siling bukan merah untuk Pengeluar
  r = a('pengeluar', { ...p, harga: 9, hargaSebelum: 6 });
  assert.strictEqual(r.status, 'hijau');
});
ok('nilaiAlarm kelabu: sd=0, rekod kurang, tiada ambang, tiada harga, separa, pembanding', () => {
  let r = a('pengguna', { sd: 0 });
  assert.strictEqual(r.status, 'kelabu');
  assert.match(r.sebab, /^sd tidak sah/);
  r = a('pengguna', { bilangan: 3 });
  assert.strictEqual(r.status, 'kelabu');
  assert.match(r.sebab, /^sd tidak sah/);
  r = a('pengguna', { bilangan: null });
  assert.strictEqual(r.status, 'kelabu');
  r = a('pengguna', { adaAmbang: false });
  assert.deepStrictEqual([r.status, r.sebab], ['kelabu', 'Tiada ambang']);
  r = a('pengguna', { harga: null });
  assert.deepStrictEqual([r.status, r.sebab], ['kelabu', 'Tiada harga']);
  r = a('pengguna', { separa: true, harga: 20 });
  assert.deepStrictEqual([r.status, r.sebab], ['kelabu', 'Minggu belum lengkap']);
  r = a(null, { harga: 20 });
  assert.deepStrictEqual([r.status, r.sebab], ['kelabu', 'Pembanding (tiada mod)']);
  // z tidak sah walaupun siling dilanggar: kelabu (peraturan paling selamat)
  r = a('pengguna', { sd: 0, harga: 13, hargaSebelum: 9 });
  assert.strictEqual(r.status, 'kelabu');
  // ambang boleh ditimpa melalui cfg
  r = kira.nilaiAlarm(
    'pengguna',
    { ...asasIn, harga: 11.2 },
    { ...kira.AMBANG_ALARM, zKuning: 1.5 },
  );
  assert.strictEqual(r.status, 'hijau');
});

/* --- Fixture: respons API (logik tulen) --- */
const ringkas = baca('harga-ringkas.json');
const ambang = baca('harga-ambang.json');
const meta = baca('harga-meta.json');
const opsRespons = { sekarang: Date.parse('2026-11-06T00:00:00Z') };
const tanya = (p) => kira.jawabHarga(ringkas, ambang, meta, p, opsRespons);
const poStatus = (r) => Object.fromEntries(r.baris.map((b) => [b.po, b]));

ok(
  'fixture: baris ujian dan varieti tanpa rujukan dikecualikan; tarikh terkini bukan tarikh ujian',
  () => {
    assert.strictEqual(meta.dikecualikan.id, 5);
    assert.strictEqual(meta.dikecualikan.tiadaRujukan, 1);
    assert.strictEqual(meta.tarikhTerkini.RUNCIT, '2026-11-04');
    const semua = JSON.stringify(ringkas);
    [
      'TELUR AYAM GRED B',
      'IKAN KEMBUNG',
      'VARIETI UJIAN TUNGGAL',
      'KUBIS BULAT (TEMPATAN)',
    ].forEach((x) => assert.ok(!semua.includes(x), x));
    assert.ok(!Object.keys(ringkas.hari.RUNCIT).includes('2026-11-21'));
  },
);
ok('fixture: daerah tidak ditugaskan dilaporkan; PO pecahan padan semua nama', () => {
  const td = meta.tidakDitugaskan.map((x) => x.negeri + '/' + x.daerah);
  assert.ok(td.includes('KUALA LUMPUR/BATU'));
  assert.ok(!td.includes('SELANGOR/PETALING')); // dalam PO tambahan Puchong
  assert.ok(!td.includes('JOHOR/BATU PAHAT')); // dalam Simpang Renggam
  // Nama PO dalam config yang tiada dalam fixture dilaporkan; daerah yang ada dalam fixture tidak
  const tp = meta.daerahTakPadan.map((x) => x.negeri + '/' + x.daerah);
  ['SELANGOR/SEPANG', 'JOHOR/MERSING', 'PERLIS/PERLIS', 'SARAWAK/SAMARAHAN'].forEach((x) =>
    assert.ok(!tp.includes(x), x),
  );
  assert.ok(tp.includes('SABAH/MEMBAKUT'));
});
ok('fixture: ambang asas 2024 dan bilangan_rekod tidak ditemui dilaporkan', () => {
  assert.strictEqual(meta.ambang.bilanganTiadaDitemui, 1);
  assert.strictEqual(ambang.kiraan.asas['2024'], 1);
  const r = tanya({ peringkat: 'RUNCIT', variety: 'AYAM HIDUP', aras: 'po' });
  const s = poStatus(r);
  assert.strictEqual(s.melaka.asas, 2024);
  assert.strictEqual(s.johor.status, 'kelabu');
  assert.match(s.johor.sebab, /sd tidak sah/);
});
ok('jawabHarga Pengguna (RUNCIT, aras PO): semua status ikut peraturan', () => {
  const r = tanya({ peringkat: 'RUNCIT', variety: 'CILI MERAH KULAI / KULAI HIBRID', aras: 'po' });
  assert.strictEqual(r.bilangan, 15);
  assert.strictEqual(r.tarikhTerkini, '2026-11-04');
  assert.strictEqual(r.lapuk, false);
  assert.strictEqual(r.mingguSemasaSeparaIso, '2026-W45');
  const s = poStatus(r);
  assert.deepStrictEqual(r.baris[0].minggu, {
    iso: '2026-W44',
    mula: '2026-10-26',
    akhir: '2026-11-01',
    separa: false,
  });
  assert.strictEqual(s.selangor.status, 'merah'); // z = 2.5
  assert.strictEqual(s.perlis.status, 'merah'); // siling + z >= 1
  assert.strictEqual(s.kedah.status, 'kuning'); // siling sahaja
  assert.match(s.kedah.sebab, /melepasi siling dasar RM 12\.00/);
  assert.strictEqual(s.perak.status, 'kuning'); // z = 1.2
  assert.strictEqual(s.penang.status, 'kuning'); // perubahan %
  assert.strictEqual(s.kelantan.status, 'kelabu'); // sd = 0
  assert.strictEqual(s.terengganu.status, 'kelabu'); // bilangan rekod 3
  assert.strictEqual(s.pahang.status, 'kelabu'); // tiada baris ambang
  assert.strictEqual(s.pahang.sebab, 'Tiada ambang');
  assert.strictEqual(s.melaka.status, 'hijau');
  hampir(s.selangor.harga, 12.5, 0.01);
  hampir(s.selangor.hargaSebelum, 10, 0.01);
  hampir(s.selangor.pctMinggu, 25, 0.2);
  assert.strictEqual(s.selangor.unit, 'KG');
  assert.deepStrictEqual(
    [s.selangor.mean, s.selangor.sd, s.selangor.lantai, s.selangor.siling],
    [10, 1, 7, 12],
  );
  // PO pecahan: Dengkil guna daerah Selangor sahaja; Selayang = purata Gombak, Hulu Selangor dan KL
  hampir(s.selayang.harga, (12.5 + 12.5 + 10.1) / 3, 0.02);
  assert.strictEqual(s.selayang.negeri, 'SELANGOR');
  assert.strictEqual(s.johor.negeri, 'JOHOR');
});
ok('amaranPo: merah > kuning > hijau > kelabu daripada status daerah (aras PO sahaja)', () => {
  const p = { peringkat: 'RUNCIT', variety: 'CILI MERAH KULAI / KULAI HIBRID' };
  const po = tanya({ ...p, aras: 'po' }).baris;
  const dae = tanya({ ...p, aras: 'daerah' }).baris;
  assert.ok(po.every((b) => b.amaranPo));
  assert.ok(tanya({ ...p, aras: 'daerah' }).baris.every((b) => !b.amaranPo));
  assert.ok(tanya({ ...p, aras: 'negeri' }).baris.every((b) => !b.amaranPo));
  let merah = 0;
  for (const b of po) {
    const d = dae.filter((x) => x.po === b.po);
    const n = (s) => d.filter((x) => x.status === s).length;
    const a = b.amaranPo;
    assert.strictEqual(a.daerah.merah, n('merah'));
    assert.strictEqual(a.daerah.kuning, n('kuning'));
    assert.strictEqual(a.daerah.sah, n('merah') + n('kuning') + n('hijau'));
    assert.ok(a.daerah.jumlah >= a.daerah.sah);
    if (n('merah') >= 1) {
      merah++;
      assert.strictEqual(a.status, 'merah');
      assert.strictEqual(a.daerahMerah.length, n('merah'));
    } else {
      assert.notStrictEqual(a.status, 'merah');
      const sah = a.daerah.sah;
      if (sah && n('kuning') / sah >= 0.3) assert.strictEqual(a.status, 'kuning');
      if (a.status === 'hijau') assert.ok(sah / a.daerah.jumlah >= 0.5);
    }
    assert.ok(typeof a.sebab === 'string' && a.sebab.length > 0);
  }
  assert.ok(merah >= 1);
  // Hijau: tiada daerah merah/kuning dan liputan data mencukupi (fixture nipis, maka liputan dilonggarkan)
  const longgar = kira.jawabHarga(
    ringkas,
    ambang,
    meta,
    { ...p, aras: 'po' },
    { ...opsRespons, cfg: { amaranPoLiputan: 0 } },
  );
  const melaka = longgar.baris.find((b) => b.po === 'melaka');
  assert.strictEqual(melaka.status, 'hijau');
  assert.strictEqual(melaka.amaranPo.status, 'hijau');
  assert.strictEqual(po.find((b) => b.po === 'melaka').amaranPo.status, 'kelabu');
  // BORONG ialah pembanding: tiada amaran merah/kuning/hijau
  assert.ok(
    tanya({ peringkat: 'BORONG', variety: p.variety, aras: 'po' }).baris.every(
      (b) => b.amaranPo.status === 'kelabu',
    ),
  );
});
ok('jawabHarga Pengeluar (LADANG): arah turun, lantai dan arah salah', () => {
  const s = poStatus(
    tanya({ peringkat: 'LADANG', variety: 'CILI MERAH KULAI / KULAI HIBRID', aras: 'po' }),
  );
  assert.strictEqual(s.selangor.status, 'merah');
  assert.strictEqual(s.johor.status, 'merah'); // lantai + z
  assert.strictEqual(s.kedah.status, 'kuning');
  assert.strictEqual(s.sabah.status, 'kuning'); // lantai sahaja
  assert.match(s.sabah.sebab, /di bawah lantai dasar RM 4\.80/);
  assert.strictEqual(s.sarawak.status, 'kuning'); // turun 15.7%
  assert.strictEqual(s.pahang.status, 'hijau'); // naik tinggi: arah salah
  assert.strictEqual(s.melaka.status, 'hijau');
});
ok('jawabHarga BORONG: pembanding sentiasa kelabu', () => {
  const r = tanya({ peringkat: 'BORONG', variety: 'CILI MERAH KULAI / KULAI HIBRID', aras: 'po' });
  assert.ok(r.baris.length > 0);
  r.baris.forEach((b) => {
    assert.strictEqual(b.status, 'kelabu');
    assert.strictEqual(b.sebab, 'Pembanding (tiada mod)');
    assert.ok(b.harga > 0);
  });
});
ok('jawabHarga Pengeluar tanpa ladang: kelabu + ganti borong berlabel', () => {
  const r = tanya({
    mod: 'pengeluar',
    variety: 'BAWANG MERAH / KECIL (IMPORT)',
    aras: 'negeri',
    negeri: 'SELANGOR',
  });
  assert.strictEqual(r.baris.length, 1);
  const b = r.baris[0];
  assert.strictEqual(b.peringkat, 'LADANG');
  assert.strictEqual(b.harga, null);
  assert.strictEqual(b.status, 'kelabu');
  assert.strictEqual(b.sebab, 'Tiada harga ladang');
  assert.strictEqual(b.ganti.peringkat, 'BORONG');
  assert.ok(b.ganti.harga > 5 && b.ganti.harga < 6);
  assert.match(b.ganti.label, /ganti, tiada data ladang/);
  // Ladang yang ada tidak digantikan
  const l = tanya({
    mod: 'pengeluar',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    aras: 'negeri',
    negeri: 'SELANGOR',
  });
  assert.ok(l.baris.every((x) => x.ganti === null && x.harga != null));
  // Mod pengguna = RUNCIT, tiada ganti
  const g = tanya({
    mod: 'pengguna',
    variety: 'BAWANG MERAH / KECIL (IMPORT)',
    aras: 'negeri',
    negeri: 'SELANGOR',
  });
  assert.ok(g.baris.every((x) => x.peringkat === 'RUNCIT' && x.ganti === null));
});
ok('jawabHarga: aras negeri/daerah, penapis, bulan dan minggu', () => {
  const n = tanya({
    peringkat: 'RUNCIT',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    aras: 'negeri',
  });
  assert.ok(n.baris.every((b) => b.negeri !== 'MALAYSIA' && b.po === null && b.daerah === null));
  assert.strictEqual(n.baris.length, 14);
  const d = tanya({
    peringkat: 'RUNCIT',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    aras: 'daerah',
    negeri: 'johor',
  });
  assert.deepStrictEqual(d.baris.map((x) => x.daerah).sort(), [
    'BATU PAHAT',
    'JOHOR BAHRU',
    'KLUANG',
    'KOTA TINGGI',
    'KULAI',
    'MERSING',
    'PONTIAN',
    'TANGKAK',
  ]);
  assert.strictEqual(d.baris.find((x) => x.daerah === 'BATU PAHAT').po, 'simpangrenggam');
  assert.strictEqual(d.baris.find((x) => x.daerah === 'TANGKAK').po, null);
  assert.strictEqual(d.baris.find((x) => x.daerah === 'KLUANG').po, 'simpangrenggam');
  const po = tanya({
    peringkat: 'RUNCIT',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    po: 'johor',
  });
  assert.strictEqual(po.baris.length, 1);
  assert.strictEqual(
    tanya({
      peringkat: 'RUNCIT',
      variety: 'CILI MERAH KULAI / KULAI HIBRID',
      aras: 'daerah',
      po: 'johor',
    }).baris.length,
    4,
  );
  // bulan: Oktober -> W43; November -> W44; bulan tanpa data -> kosong
  const okt = tanya({
    peringkat: 'RUNCIT',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    bulan: '2026-10',
    po: 'selangor',
  });
  assert.strictEqual(okt.baris[0].minggu.iso, '2026-W43');
  hampir(okt.baris[0].harga, 10, 0.01);
  assert.strictEqual(tanya({ bulan: '2026-09', peringkat: 'RUNCIT' }).baris.length, 0);
  // minggu separa: harga dipaparkan tetapi status kelabu
  const sep = tanya({
    peringkat: 'RUNCIT',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    minggu: '2026-11-04',
    po: 'selangor',
  });
  assert.strictEqual(sep.baris[0].minggu.separa, true);
  assert.strictEqual(sep.baris[0].status, 'kelabu');
  assert.strictEqual(sep.baris[0].sebab, 'Minggu belum lengkap');
  assert.ok(sep.baris[0].harga > 12);
});
ok('jawabHarga siri=1: titik harian dengan mean/sd/lantai/siling dan asas', () => {
  const r = tanya({
    siri: true,
    peringkat: 'RUNCIT',
    commodity: 'CILI',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    po: 'selangor',
  });
  assert.strictEqual(r.siri.titik.length, 17);
  assert.strictEqual(r.siri.titik[0].t, '2026-10-19');
  assert.strictEqual(r.siri.titik[16].t, '2026-11-04');
  assert.deepStrictEqual(
    [r.siri.asas, r.siri.mean, r.siri.sd, r.siri.lantai, r.siri.siling],
    [2025, 10, 1, 7, 12],
  );
  const nov = tanya({
    siri: true,
    bulan: '2026-11',
    peringkat: 'RUNCIT',
    commodity: 'CILI',
    variety: 'CILI MERAH KULAI / KULAI HIBRID',
    negeri: 'KEDAH',
  });
  assert.strictEqual(nov.siri.titik.length, 4);
  assert.strictEqual(nov.siri.mean, 11.5);
});
ok('jawabMeta: penapis bulan/komoditi/varieti/PO dan lencana lapuk', () => {
  const m = kira.jawabMeta(ringkas, meta, opsRespons);
  assert.deepStrictEqual(m.penapis.bulan, ['2026-10', '2026-11']);
  assert.ok(m.penapis.komoditi.includes('CILI') && !m.penapis.komoditi.includes('IKAN KEMBUNG'));
  assert.ok(m.penapis.varieti.CILI.includes('CILI MERAH KULAI / KULAI HIBRID'));
  assert.strictEqual(m.penapis.po.length, 15);
  assert.ok(!m.penapis.negeri.includes('MALAYSIA'));
  assert.strictEqual(m.lapuk, false);
  assert.strictEqual(
    kira.jawabMeta(ringkas, meta, { sekarang: Date.parse('2026-11-12T00:00:00Z') }).lapuk,
    false,
  ); // 8 hari
  assert.strictEqual(
    kira.jawabMeta(ringkas, meta, { sekarang: Date.parse('2026-11-13T00:00:00Z') }).lapuk,
    true,
  ); // 9 hari
});
ok('sahkanParam: senarai putih dan nilai tak sah', () => {
  const s = (q) => kira.sahkanParam(new URLSearchParams(q));
  assert.deepStrictEqual(s('peringkat=runcit&aras=daerah&bulan=2026-11').nilai, {
    peringkat: 'RUNCIT',
    aras: 'daerah',
    bulan: '2026-11',
  });
  [
    'peringkat=XX',
    'aras=zon',
    'mod=lain',
    'po=tiada',
    'bulan=2026-13',
    'bulan=11-2026',
    'minggu=2026-02-30',
    'siri=1',
    'siri=2',
    'negeri=%3Cscript%3E',
    'ganjil=1',
    'aras=po&aras=negeri',
    'commodity=' + 'A'.repeat(101),
  ].forEach((q) => assert.ok(s(q).ralat, q));
});

/* --- Paginasi --- */
ok('ambilHalaman: 1000+1000+n baris, header kunci, tapis dan ralat tanpa kunci', async () => {
  const panggilan = [];
  const fetchJson = async (url, opts) => {
    panggilan.push({ url, opts });
    const off = Number(new URL(url).searchParams.get('offset'));
    const n = off === 0 ? 1000 : off === 1000 ? 1000 : 250;
    return Array.from({ length: n }, (_, i) => ({ id: off + i }));
  };
  const ctx = {
    url: URL_PALSU,
    kunci: KUNCI,
    fetchJson,
    timeoutMs: 15000,
    retries: 3,
    backoffMs: 1,
  };
  const rows = await hargaDb.ambilHalaman(
    'harga_runcit_mingguan',
    { select: 'id', tapis: [['tarikh_akhir', 'gte.2026-10-19']], order: 'id.asc' },
    ctx,
  );
  assert.strictEqual(rows.length, 2250);
  assert.strictEqual(new Set(rows.map((r) => r.id)).size, 2250);
  assert.deepStrictEqual(
    panggilan.map((p) => new URL(p.url).searchParams.get('offset')),
    ['0', '1000', '2000'],
  );
  const u = new URL(panggilan[0].url);
  assert.strictEqual(u.pathname, '/rest/v1/harga_runcit_mingguan');
  assert.strictEqual(u.searchParams.get('limit'), '1000');
  assert.strictEqual(u.searchParams.get('tarikh_akhir'), 'gte.2026-10-19');
  assert.strictEqual(u.searchParams.get('order'), 'id.asc');
  assert.strictEqual(panggilan[0].opts.headers.apikey, KUNCI);
  assert.strictEqual(panggilan[0].opts.headers.Authorization, 'Bearer ' + KUNCI);
  assert.strictEqual(panggilan[0].opts.timeoutMs, 15000);
  assert.strictEqual(panggilan[0].opts.retries, 3);
  assert.ok(!panggilan.some((p) => p.url.includes(KUNCI)));
  // Halaman penuh tepat 1000 diikuti halaman kosong
  let k = 0;
  const f2 = async () => (k++ === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : []);
  assert.strictEqual(
    (await hargaDb.ambilHalaman('t', { select: 'id' }, { ...ctx, fetchJson: f2 })).length,
    1000,
  );
  // Ralat: kunci dan URL dibuang daripada mesej
  const f3 = async () => {
    throw new Error(`HTTP 500 ${KUNCI} ${URL_PALSU}`);
  };
  await assert.rejects(
    () => hargaDb.ambilHalaman('t', { select: 'id' }, { ...ctx, fetchJson: f3 }),
    (e) => !e.message.includes(KUNCI) && !e.message.includes(URL_PALSU) && /\*\*\*/.test(e.message),
  );
  await assert.rejects(
    () => hargaDb.ambilHalaman('t', { select: 'id' }, { ...ctx, fetchJson: async () => ({}) }),
    /bukan tatasusunan/,
  );
});

/* --- Sync (bootstrap, tokokan, rekonsiliasi, kegagalan) dengan pangkalan data palsu --- */
function dunia() {
  const jadual = {
    harga_ladang_mingguan: baca('ladang-sampel.json'),
    harga_borong_mingguan: baca('borong-sampel.json'),
    harga_runcit_mingguan: baca('runcit-sampel.json'),
    threshold_autofill_cache: baca('cache-ambang-sampel.json').map((r, i) => ({ id: i + 1, ...r })),
    maklumat_ami: baca('maklumat-ami-sampel.json').map((r, i) => ({ bil: i + 1, ...r })),
    mean_sd_based_year_2025: baca('mean-sd-2025-sampel.json').map((r, i) => ({
      id_pk: i + 1,
      ...r,
    })),
    mean_sd_based_year_2024: baca('mean-sd-2024-sampel.json').map((r, i) => ({
      id_pk: i + 1,
      ...r,
    })),
  };
  const log = [];
  const tarikhMasa = (s) => Date.parse(s);
  const fetchJson = async (url, opts) => {
    const u = new URL(url);
    const nama = u.pathname.replace('/rest/v1/', '');
    log.push({ nama, params: u.searchParams.toString(), headers: opts.headers });
    if (!jadual[nama]) throw new Error('HTTP 404');
    let rows = jadual[nama].slice();
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (v === 'not.is.null') rows = rows.filter((r) => r[k] != null);
      else if (v.startsWith('not.in.(')) {
        const s = new Set(v.slice(8, -1).split(','));
        rows = rows.filter((r) => !s.has(String(r[k])));
      } else if (v.startsWith('gte.')) rows = rows.filter((r) => String(r[k]) >= v.slice(4));
      else if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith('gt.'))
        rows = rows.filter((r) =>
          k === 'created_at' ? tarikhMasa(r[k]) > tarikhMasa(v.slice(3)) : r[k] > v.slice(3),
        );
      else throw new Error('tapis tidak disokong: ' + v);
    }
    const order = u.searchParams.get('order');
    if (order === 'tarikh_akhir.desc')
      rows.sort((x, y) => (x.tarikh_akhir < y.tarikh_akhir ? 1 : -1));
    else if (order)
      rows.sort(
        (x, y) => Number(x.id || x.bil || x.id_pk || 0) - Number(y.id || y.bil || y.id_pk || 0),
      );
    const off = Number(u.searchParams.get('offset') || 0);
    return rows.slice(off, off + Number(u.searchParams.get('limit')));
  };
  return { jadual, log, fetchJson };
}
ok(
  'segar: bootstrap, tokokan + rekonsiliasi (tambah, ubah, padam), ambang 24 j dan kegagalan',
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harga-sync-'));
    const asal = {
      r: process.env.HARGA_RINGKAS_FILE,
      a: process.env.HARGA_AMBANG_FILE,
      m: process.env.HARGA_META_FILE,
    };
    process.env.HARGA_RINGKAS_FILE = path.join(tmp, 'harga-ringkas.json');
    process.env.HARGA_AMBANG_FILE = path.join(tmp, 'harga-ambang.json');
    process.env.HARGA_META_FILE = path.join(tmp, 'harga-meta.json');
    try {
      const w = dunia();
      const opsyen = (sekarang) => ({
        url: URL_PALSU,
        kunci: KUNCI,
        fetchJson: w.fetchJson,
        sekarang,
        backoffMs: 1,
      });
      // 1. Bootstrap
      const r1 = await hargaDb.segar(opsyen('2026-11-12T01:00:00Z'));
      assert.strictEqual(r1.ditulis, true);
      assert.strictEqual(r1.status, 'ok');
      const meta1 = JSON.parse(fs.readFileSync(process.env.HARGA_META_FILE, 'utf8'));
      assert.strictEqual(meta1.tarikhTerkini.RUNCIT, '2026-11-04'); // bukan 2026-11-21 (baris ujian)
      assert.strictEqual(meta1.dikecualikan.id, 5);
      assert.ok(meta1.kursor.harga_runcit_mingguan.maxCreatedAt.startsWith('2026-11-21')); // kursor lalui baris ujian
      assert.ok(
        w.log.every(
          (l) => l.headers.apikey === KUNCI && l.headers.Authorization === 'Bearer ' + KUNCI,
        ),
      );
      assert.ok(w.log.some((l) => l.nama === 'threshold_autofill_cache'));
      const r1c = w.log.filter(
        (l) => l.nama === 'harga_ladang_mingguan' && /limit=1&/.test(l.params + '&'),
      );
      assert.ok(r1c.length === 1 && r1c[0].params.includes('id=not.in.'));
      // Tiada kunci/URL dalam cache
      for (const f of [
        process.env.HARGA_RINGKAS_FILE,
        process.env.HARGA_AMBANG_FILE,
        process.env.HARGA_META_FILE,
      ]) {
        const t = fs.readFileSync(f, 'utf8');
        assert.ok(!t.includes(KUNCI) && !t.includes(URL_PALSU) && !t.includes('pangkalan-palsu'));
      }
      const ringkas1 = JSON.parse(fs.readFileSync(process.env.HARGA_RINGKAS_FILE, 'utf8'));
      assert.deepStrictEqual(Object.keys(ringkas1.hari.LADANG).sort(), [
        '2026-11-03',
        '2026-11-04',
      ]);
      const hargaKedah = (r, t) => r.hari.LADANG[t].find((a) => a[2] === 'KEDAH')[4];
      const lama = hargaKedah(ringkas1, '2026-11-04');

      // 2. Tokokan: baris baharu (tarikh baharu), baris diubah (created_at tidak berubah) dan baris dipadam
      const tk = w.jadual.harga_ladang_mingguan;
      const barisKedah = tk.filter((x) => x.negeri === 'KEDAH' && x.tarikh_akhir === '2026-11-04');
      barisKedah.forEach((x) => (x.avg_harga = lama + 1));
      for (let i = tk.length - 1; i >= 0; i--)
        if (tk[i].tarikh_akhir === '2026-11-03' && tk[i].negeri === 'SABAH') tk.splice(i, 1);
      const contoh = tk.find((x) => x.negeri === 'KEDAH');
      tk.push({
        ...contoh,
        id: 5000,
        created_at: '2026-11-12T00:30:00.000000+00:00',
        tarikh_akhir: '2026-11-05',
        avg_harga: 7,
      });
      w.log.length = 0;
      const r2 = await hargaDb.segar(opsyen('2026-11-12T02:00:00Z'));
      assert.strictEqual(r2.ditulis, true);
      const ringkas2 = JSON.parse(fs.readFileSync(process.env.HARGA_RINGKAS_FILE, 'utf8'));
      assert.ok(ringkas2.hari.LADANG['2026-11-05'], 'tarikh baharu masuk');
      hampir(hargaKedah(ringkas2, '2026-11-04'), lama + 1, 0.001); // diubah dikesan oleh rekonsiliasi
      assert.ok(
        !ringkas2.hari.LADANG['2026-11-03'].some((a) => a[2] === 'SABAH'),
        'baris dipadam hilang',
      );
      const l2 = w.log.filter((l) => l.nama === 'harga_ladang_mingguan');
      assert.ok(l2[0].params.includes('created_at=gt.'), 'tokokan guna created_at');
      assert.ok(
        l2.some((l) => l.params.includes('tarikh_akhir=gte.2026-10-19')),
        'rekonsiliasi 3 minggu ISO',
      );
      assert.ok(
        !w.log.some((l) => l.nama === 'threshold_autofill_cache'),
        'ambang tidak diambil semula dalam 24 j',
      );
      const meta2 = JSON.parse(fs.readFileSync(process.env.HARGA_META_FILE, 'utf8'));
      assert.strictEqual(meta2.tarikhTerkini.LADANG, '2026-11-05');
      assert.ok(meta2.kursor.harga_ladang_mingguan.maxCreatedAt.startsWith('2026-11-12T00:30'));
      assert.strictEqual(meta2.kursor.harga_ladang_mingguan.maxId >= 5000, true);

      // 3. Ambang diambil semula selepas 24 j
      w.log.length = 0;
      await hargaDb.segar(opsyen('2026-11-13T03:00:00Z'));
      assert.ok(w.log.some((l) => l.nama === 'threshold_autofill_cache'));
      assert.ok(w.log.some((l) => l.nama === 'mean_sd_based_year_2024'));

      // 4. Kegagalan: cache lama kekal
      const sebelum = fs.readFileSync(process.env.HARGA_RINGKAS_FILE, 'utf8');
      const metaSebelum = fs.readFileSync(process.env.HARGA_META_FILE, 'utf8');
      const rg = await hargaDb.segar({
        url: URL_PALSU,
        kunci: KUNCI,
        sekarang: '2026-11-14T03:00:00Z',
        fetchJson: async () => {
          throw new Error(`HTTP 503 ${KUNCI}`);
        },
      });
      assert.strictEqual(rg.ditulis, false);
      assert.ok(!rg.mesej.includes(KUNCI));
      assert.strictEqual(fs.readFileSync(process.env.HARGA_RINGKAS_FILE, 'utf8'), sebelum);
      assert.strictEqual(fs.readFileSync(process.env.HARGA_META_FILE, 'utf8'), metaSebelum);
      // Tanpa kelayakan: tiada panggilan rangkaian
      const tk2 = await hargaDb.segar({
        url: '',
        kunci: '',
        fetchJson: async () => assert.fail('tidak patut dipanggil'),
      });
      assert.strictEqual(tk2.ditulis, false);
    } finally {
      for (const [k, e] of [
        ['r', 'HARGA_RINGKAS_FILE'],
        ['a', 'HARGA_AMBANG_FILE'],
        ['m', 'HARGA_META_FILE'],
      ])
        if (asal[k] === undefined) delete process.env[e];
        else process.env[e] = asal[k];
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
);
ok(
  'mulaPenjadual: tiada tindakan jika DB_HARGA_AUTO=0 atau kelayakan tiada (tiada rangkaian)',
  () => {
    const simpan = {
      a: process.env.DB_HARGA_AUTO,
      u: process.env.DB_HARGA_URL,
      k: process.env.DB_HARGA_PUBLISHABLE_KEY,
      f: global.fetch,
    };
    let dipanggil = 0;
    global.fetch = async () => {
      dipanggil++;
      throw new Error('rangkaian tidak dibenarkan');
    };
    const log = console.log;
    console.log = () => {};
    try {
      process.env.DB_HARGA_AUTO = '0';
      process.env.DB_HARGA_URL = URL_PALSU;
      process.env.DB_HARGA_PUBLISHABLE_KEY = KUNCI;
      hargaDb.mulaPenjadual();
      delete process.env.DB_HARGA_AUTO;
      delete process.env.DB_HARGA_URL;
      hargaDb.mulaPenjadual();
      assert.strictEqual(dipanggil, 0);
    } finally {
      console.log = log;
      global.fetch = simpan.f;
      for (const [k, e] of [
        ['a', 'DB_HARGA_AUTO'],
        ['u', 'DB_HARGA_URL'],
        ['k', 'DB_HARGA_PUBLISHABLE_KEY'],
      ])
        if (simpan[k] === undefined) delete process.env[e];
        else process.env[e] = simpan[k];
    }
  },
);

/* --- Senarai putih komoditi (config/komoditi-diliputi.json) --- */
const diliputi = require('../../api/_services/komoditi-diliputi.js');
ok('komoditi-diliputi: konfigurasi dimuat (58 pasangan, 17 jenis A-Z, 3 tiadaData)', () => {
  const s = diliputi.muat();
  assert.strictEqual(s.pasangan.length, 58);
  assert.strictEqual(s.jenis.length, 17);
  const kod = s.jenis.map((j) => j.kod);
  assert.deepStrictEqual(
    kod,
    [...kod].sort((a, b) => a.localeCompare(b, 'ms')),
  );
  assert.strictEqual(s.pasangan.filter((p) => p.jenis === 'CILI').length, 8);
  assert.deepStrictEqual(
    s.pasangan
      .filter((p) => p.tiadaData)
      .map((p) => p.variety)
      .sort(),
    ['PISANG RAJA', 'TEMBIKAI KUNING TANPA BIJI', 'TIMUN SUSU'],
  );
  assert.strictEqual(
    s.cari('CILI', 'CILI MERAH KULAI / KULAI HIBRID').label,
    'Cili Merah Kulai / Kulai Hibrid',
  );
  assert.throws(() => diliputi.bina({ pasangan: [] }));
  assert.throws(() =>
    diliputi.bina({
      pasangan: [
        { jenis: 'A', variety: 'X' },
        { jenis: 'a', variety: 'x ' },
      ],
    }),
  );
});
ok(
  'komoditi-diliputi: padanan varieti (tepat, huruf/ruang, commodity DB berbeza, tiada padanan)',
  () => {
    const s = diliputi.bina({
      jenis: [{ kod: 'KAMBING', label: 'Kambing' }],
      pasangan: [
        {
          jenis: 'KAMBING',
          commodity: 'DAGING KAMBING',
          variety: 'DAGING KAMBING',
          label: 'Daging Kambing',
        },
        {
          jenis: 'TIMUN',
          commodity: 'TIMUN',
          variety: 'TIMUN SUSU',
          label: 'Timun Susu',
          tiadaData: true,
        },
      ],
    });
    assert.strictEqual(s.padan('DAGING KAMBING', 'DAGING KAMBING').jenis, 'KAMBING');
    // DB menamakan commodity lain: varieti dipadan dan dipetakan kepada jenis pengguna
    assert.strictEqual(s.padan('KAMBING & BIRI', 'DAGING KAMBING').jenis, 'KAMBING');
    assert.strictEqual(s.padan('X', 'daging  kambing ').variety, 'DAGING KAMBING');
    assert.strictEqual(s.padan('DAGING KAMBING', 'DAGING LEMBU PEJAL'), null);
    assert.strictEqual(s.padan('IKAN KEMBUNG', 'IKAN KEMBUNG'), null);
    assert.strictEqual(s.padan('TIMUN', 'TIMUN SUSU').tiadaData, true);
  },
);
ok(
  'jawabHarga: hanya pasangan senarai putih; commodity DB berbeza dipetakan ke jenis pengguna',
  () => {
    const s = diliputi.bina({
      pasangan: [
        { jenis: 'KAMBING', commodity: 'DAGING KAMBING', variety: 'DAGING KAMBING' },
        { jenis: 'TIMUN', commodity: 'TIMUN', variety: 'TIMUN SUSU', tiadaData: true },
      ],
    });
    const r = {
      versi: 1,
      hari: {
        RUNCIT: {
          '2026-10-27': [
            ['DAGING', 'DAGING KAMBING', 'KEDAH', 'ALOR SETAR', 30, 1, 'KG'],
            ['IKAN KEMBUNG', 'IKAN KEMBUNG', 'KEDAH', 'ALOR SETAR', 12, 1, 'KG'],
          ],
          '2026-11-04': [
            ['DAGING', 'daging kambing', 'KEDAH', 'ALOR SETAR', 32, 1, 'KG'],
            ['IKAN KEMBUNG', 'IKAN KEMBUNG', 'KEDAH', 'ALOR SETAR', 13, 1, 'KG'],
          ],
        },
      },
    };
    const a = { peringkat: 'RUNCIT', aras: 'negeri' };
    const o = { sekarang: Date.parse('2026-11-06T00:00:00Z'), senarai: s };
    const j = kira.jawabHarga(r, null, null, a, o);
    assert.strictEqual(j.bilangan, 1);
    assert.strictEqual(j.baris[0].commodity, 'KAMBING');
    assert.strictEqual(j.baris[0].variety, 'DAGING KAMBING');
    assert.strictEqual(
      kira.jawabHarga(r, null, null, { ...a, commodity: 'DAGING' }, o).bilangan,
      0,
    );
    assert.strictEqual(
      kira.jawabHarga(r, null, null, { ...a, commodity: 'KAMBING' }, o).bilangan,
      1,
    );
    // senarai null = tanpa tapisan (hanya untuk ujian logik tulen)
    assert.strictEqual(kira.jawabHarga(r, null, null, a, { ...o, senarai: null }).bilangan, 2);
    // pasangan tanpa data kekal dalam meta, ditanda tiadaData, tanpa harga rekaan
    const m = kira.jawabMeta(r, null, o);
    assert.deepStrictEqual(m.penapis.komoditi, ['KAMBING', 'TIMUN']);
    const timun = m.penapis.komoditiSenarai.find((k) => k.kod === 'TIMUN').varieti[0];
    assert.deepStrictEqual(timun, { kod: 'TIMUN SUSU', label: 'TIMUN SUSU', tiadaData: true });
    assert.strictEqual(
      kira.jawabHarga(r, null, null, { ...a, variety: 'TIMUN SUSU' }, o).bilangan,
      0,
    );
  },
);
ok('jawabHarga/jawabMeta/ambang fixture: hanya senarai putih (config sebenar), 17 komoditi', () => {
  const semua = tanya({ aras: 'negeri' });
  const s = diliputi.muat();
  assert.ok(semua.bilangan > 0);
  semua.baris.forEach((b) =>
    assert.ok(s.cari(b.commodity, b.variety), b.commodity + '|' + b.variety),
  );
  assert.ok(!semua.baris.some((b) => b.variety === 'VARIETI UJIAN TUNGGAL'));
  const tanpa = kira.jawabHarga(
    ringkas,
    ambang,
    meta,
    { aras: 'negeri' },
    { ...opsRespons, senarai: null },
  );
  assert.ok(tanpa.baris.length >= semua.baris.length);
  const m = kira.jawabMeta(ringkas, meta, opsRespons);
  assert.strictEqual(m.penapis.komoditi.length, 17);
  assert.strictEqual(m.penapis.varieti.CILI.length, 8);
  assert.strictEqual(Object.values(m.penapis.varieti).flat().length, 58);
  assert.ok(!m.penapis.komoditi.includes('IKAN KEMBUNG'));
  const a = hargaDb.jawabAmbang({ ambang });
  assert.ok(a.baris.length > 0 && a.baris.every((b) => s.padan(b.commodity, b.variety)));
});

(async () => {
  for (const [nama, fn] of senarai) {
    try {
      await fn();
      console.log('ok   ' + nama);
    } catch (e) {
      gagal.push(nama);
      console.log(
        'GAGAL ' +
          nama +
          '\n     ' +
          String((e && e.stack) || e)
            .split('\n')
            .slice(0, 4)
            .join('\n     '),
      );
    }
  }
  console.log(`\n${senarai.length - gagal.length}/${senarai.length} ujian harga-db-unit lulus`);
  if (gagal.length) process.exitCode = 1;
})();

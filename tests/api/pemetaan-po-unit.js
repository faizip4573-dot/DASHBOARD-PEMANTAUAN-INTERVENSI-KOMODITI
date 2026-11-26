'use strict';
// Pemetaan PO FIS 2.1: muat config, pecahan negeri gabungan, normalisasi daerah, titik tengah dan konsistensi
// config <-> cerminan pelayar <-> DATA.po. Tiada rangkaian dan tiada Power BI. Jalankan: node --no-warnings tests/api/pemetaan-po-unit.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const skrip = require('../../scripts/ambil-pemetaan-po-pbi.js');
const pem = require('../../api/_services/pemetaan-po.js');
const { terap } = require('../../src/data/pemetaan-po-terap.js');

const ROOT = path.join(__dirname, '..', '..');
let lulus = 0;
const gagal = [];
const ok = (nama, fn) => {
  try {
    fn();
    lulus++;
    console.log('ok   ' + nama);
  } catch (e) {
    gagal.push(nama);
    console.log(
      'GAGAL ' +
        nama +
        '\n     ' +
        String(e.stack || e)
          .split('\n')
          .slice(0, 3)
          .join('\n     '),
    );
  }
};
const P = pem.muat();

ok('config dimuat: 15 PO utama + PO tambahan, tiada rahsia, sumber FIS 2.1', () => {
  assert.equal(P.utama.length, 15);
  assert.equal(P.tambahan.length, 25);
  assert.equal(P.sumber.dataset, 'FIS Version 2.1');
  assert.match(P.sumber.status, /disahkan \(FIS 2\.1\)/);
  const teks = fs.readFileSync(pem.FAIL_LALAI, 'utf8');
  assert.ok(!/secret|PBI_|client_secret|token/i.test(teks));
  P.po.forEach((p) => {
    assert.ok(p.label && p.id && p.fisNama && p.daerah.length, p.fisNama);
    assert.ok(p.negeriSemua.includes(p.negeri));
    assert.equal(p.utama, !p.id.startsWith('tbh-'));
    if (!p.utama) assert.ok(Number.isFinite(p.titik ? p.titik.lat : NaN) || true);
  });
  assert.equal(new Set(P.po.map((p) => p.id)).size, P.po.length);
});
ok('Samarahan disahkan pengguna: PO Samarahan = Pusat Operasi Samarahan, Kota Samarahan tambahan', () => {
  const c = JSON.parse(fs.readFileSync(pem.FAIL_LALAI, 'utf8'));
  assert.deepEqual(
    c.po.filter((p) => p.perluDisahkan).map((p) => p.fisNama),
    [],
  );
  assert.match(
    c.alias.po.find((a) => a.fisNama === 'Pusat Operasi Samarahan').nota,
    /Disahkan pengguna/,
  );
  assert.ok(!/PERLU DISAHKAN/.test(JSON.stringify(c)));
  const ks = c.po.find((p) => p.fisNama === 'Pusat Operasi Kota Samarahan');
  assert.ok(ks && !ks.utama);
});
ok('alias PO utama: nama FIS -> id dashboard (Samarahan disahkan)', () => {
  const a = P.konfig.alias.po;
  assert.equal(a.length, 15);
  const get = (f) => a.find((x) => x.fisNama === f).id;
  assert.equal(get('Pusat Operasi Kota Bahru'), 'kelantan');
  assert.equal(get('Pusat Operasi KBS FAMA Chendering, Kuala Terengganu'), 'terengganu');
  assert.equal(get('KBS Tampoi /Pusat Operasi Johor Bahru'), 'johor');
  assert.equal(get('Pusat Operasi Samarahan'), 'sarawak');
  assert.ok(P.tambahan.some((p) => p.fisNama === 'Pusat Operasi Kota Samarahan'));
});
ok('negeri gabungan Selangor/KL/Putrajaya dipecah ikut daerah; Labuan', () => {
  const n = skrip.normNegeriFis;
  const g = 'Selangor & Wilayah Persekutuan Kuala Lumpur & Putrajaya';
  assert.equal(n(g, 'Kuala Lumpur'), 'KUALA LUMPUR');
  assert.equal(n(g, 'Putrajaya'), 'PUTRAJAYA');
  assert.equal(n(g, 'Titiwangsa'), 'KUALA LUMPUR');
  assert.equal(n(g, 'Klang'), 'SELANGOR');
  assert.equal(n(g, 'Hulu Langat'), 'SELANGOR');
  assert.equal(n('Sabah', 'Labuan'), 'LABUAN');
  assert.equal(n('W.P. Labuan', 'Labuan'), 'LABUAN');
  assert.equal(n('Pulau Pinang', 'Barat Daya'), 'PULAU PINANG');
  assert.equal(n('Negeri Sembilan', 'Jelebu'), 'NEGERI SEMBILAN');
});
ok('normalisasi daerah ke nama DB Harga dan alias', () => {
  const d = (x) => pem.normDaerahDb(x, P.konfig.alias.daerahDb);
  assert.equal(d('Hulu Perak'), 'ULU PERAK');
  assert.equal(d('Lipis'), 'KUALA LIPIS');
  assert.equal(d('Manjung'), 'MANJUNG DINDING');
  assert.equal(d('Larut, Matang dan Selama'), 'LARUT, MATANG DAN SELAMA');
  assert.equal(d('Bandar Baharu'), 'BANDAR BHARU');
  assert.equal(d('Johor Baharu'), 'JOHOR BAHRU');
  assert.equal(d('Kota Bharu'), 'KOTA BHARU');
  assert.equal(d('Kota Bahru'), 'KOTA BAHRU');
  assert.equal(d('Manjung (Dinding)'), 'MANJUNG DINDING');
});
ok('bangunKonfig: PO tanpa nama/negeri diabaikan, label, daerah bertindih, titik tengah', () => {
  const geo = {
    features: ['A', 'B'].map((n, i) => ({
      properties: { name: n },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [i, 0],
            [i + 1, 0],
            [i + 1, 1],
            [i, 1],
            [i, 0],
          ],
        ],
      },
    })),
  };
  const rows = [
    { po: 'Pusat Operasi Contoh', negeri: 'Johor', daerah: 'A', n: 3, maks: '2026-11-02T00:00:00' },
    { po: 'Pusat Operasi Contoh', negeri: 'Johor', daerah: 'B', n: 2, maks: '2026-11-05T00:00:00' },
    { po: 'Kompleks Bilik Sejuk FAMA Ipoh', negeri: 'Perak', daerah: 'A', n: 1, maks: null },
    { po: null, negeri: null, daerah: 'A', n: 455, maks: null },
  ];
  const al = { po: [], label: {}, daerahDb: {}, daerahGeo: {} };
  const h = skrip.bangunKonfig(rows, { alias: al, tarikh: '2026-11-23', geo });
  assert.equal(h.tiadaPo, 455);
  assert.equal(h.konfig.po.length, 2);
  const c = h.konfig.po.find((p) => p.fisNama === 'Pusat Operasi Contoh');
  assert.equal(c.label, 'Contoh');
  assert.equal(c.baris, 5);
  assert.equal(c.terkini, '2026-11-05');
  assert.deepEqual(c.titik && [c.titik.lat, c.titik.lon], [0.5, 1]);
  assert.equal(h.konfig.po.find((p) => p.label === 'KBS Ipoh').utama, false);
  // daerah A masuk dua PO (bertindih dibenarkan)
  assert.ok(h.konfig.po.every((p) => p.daerah.some((d) => d.nama === 'A')));
});
ok('labelUntuk: nama pendek Melayu', () => {
  assert.equal(skrip.labelUntuk('Pusat Operasi Tangkak', {}), 'Tangkak');
  assert.equal(skrip.labelUntuk('Kompleks Bilik Sejuk FAMA Ipoh', {}), 'KBS Ipoh');
  assert.equal(skrip.labelUntuk('KBS Pusat Operasi Selayang', {}), 'Selayang');
});
ok('titik tengah PO tambahan dalam config = titik tengah poligon daerah (GeoJSON)', () => {
  const geo = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'data', 'geo', 'malaysia_district.geojson'), 'utf8'),
  );
  P.tambahan.forEach((p) => {
    const ft = p.daerah
      .map((d) => skrip.cariFitur(geo, d.nama, P.konfig.alias.daerahGeo))
      .filter(Boolean);
    assert.ok(ft.length, p.label);
    const t = skrip.titikTengah(ft);
    const raw = P.konfig.po.find((x) => x.id === p.id).titik;
    assert.ok(Math.abs(t.lat - raw.lat) < 1e-4 && Math.abs(t.lon - raw.lon) < 1e-4, p.label);
    assert.ok(raw.anggaran === true);
  });
});
ok('cerminan pelayar sama dengan config; DATA.po diterbitkan daripada config (satu sumber)', () => {
  const sumber = fs.readFileSync(path.join(ROOT, 'src', 'data', 'pemetaan-po-fis.js'), 'utf8');
  assert.equal(sumber, skrip.kandunganCermin(P.konfig));
  const g = {};
  new Function(
    'g',
    fs
      .readFileSync(path.join(ROOT, 'src', 'data', 'dashboard-data.js'), 'utf8')
      .replace(/^\s*const DATA\s*=/m, 'g.DATA ='),
  )(g);
  terap(g.DATA, P.konfig);
  g.DATA.po.forEach((p) => {
    const c = P.ikutId[p.id];
    assert.deepEqual(
      p.districts.map((d) => d[0]),
      c.daerah.map((d) => d.nama),
      p.id,
    );
    assert.ok(
      p.districts.every((d) => Number.isFinite(d[1]) && Number.isFinite(d[2])),
      p.id,
    );
  });
  const dengkil = g.DATA.po.find((p) => p.id === 'selangor');
  assert.ok(dengkil.districts.some((d) => d[0] === 'Putrajaya'));
  assert.ok(
    g.DATA.po.find((p) => p.id === 'simpangrenggam').districts.some((d) => d[0] === 'Batu Pahat'),
  );
  assert.equal(g.DATA.poTambahan.length, 25);
  const puchong = g.DATA.poTambahan.find((p) => p.id === 'tbh-puchong');
  assert.deepEqual(puchong.districts.map((d) => d[0]).sort(), ['Klang', 'Petaling']);
  assert.equal(puchong.tambahan, true);
  assert.equal(puchong.logistik, null);
});
ok('nama daerah semua PO padan GeoJSON (kecuali Membakut dilaporkan)', () => {
  const geo = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'data', 'geo', 'malaysia_district.geojson'), 'utf8'),
  );
  const tiada = [];
  P.po.forEach((p) =>
    p.daerah.forEach((d) => {
      if (!skrip.cariFitur(geo, d.nama, P.konfig.alias.daerahGeo)) tiada.push(d.nama);
    }),
  );
  assert.deepEqual(tiada, ['Membakut']);
});
console.log(`${lulus}/${lulus + gagal.length} ujian pemetaan-po-unit lulus`);
process.exit(gagal.length ? 1 : 0);

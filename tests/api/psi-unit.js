'use strict';
// Ujian enjin Harga Cadangan PSI (api/_services/psi-kira.js): contoh kerja Seksyen 9 dan senarai semak Seksyen 10
// dalam Prompt_Dashboard_Harga_Cadangan_PSI.md. Tiada rangkaian. Jalankan: node --no-warnings tests/api/psi-unit.js
const assert = require('node:assert');
const P = require('../../api/_services/psi-kira.js');

const senarai = [];
const ok = (nama, fn) => senarai.push([nama, fn]);
const hampir = (a, b, t = 0.005) => assert.ok(Math.abs(a - b) <= t, `${a} !~ ${b}`);
const r2 = (x) => Math.round(x * 100) / 100;

// Siri asas: tetingkap Jun–Nov 2026, cadangan Dis 2026
const BULAN = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const siri = (ami, fis, sisda) => ({
  ami: Object.fromEntries(BULAN.map((m, i) => [m, ami[i]]).filter((x) => x[1] != null)),
  fis: Object.fromEntries(BULAN.map((m, i) => [m, fis[i]]).filter((x) => x[1] != null)),
  sisda: Object.fromEntries(
    [...BULAN, '2026-12'].map((m, i) => [m, sisda[i]]).filter((x) => x[1] != null),
  ),
});
const OPS = { bulanTerkini: '2026-11' };

ok('Seksyen 9: contoh JUALAN Dis 2026 = RM3.42, julat RM3.08–RM3.76', () => {
  const g = P.gabung({
    nisbah2: 0.83,
    nisbah6: 0.96,
    hargaPasaranTerkini: 4.15,
    nisbahSisda: 1.1,
    ralatRamalan: 0.167,
    sisdaCadangan: 2.95,
    turunNaik: 0.32,
  });
  hampir(g.bezaNisbah, 0.1354, 0.001);
  assert.strictEqual(g.pilihanNisbah, 'Nisbah_2_Bulan');
  assert.strictEqual(r2(g.hargaPasaran), 3.44);
  assert.strictEqual(g.beratSisda, 0.1);
  assert.strictEqual(r2(g.hargaRamalan), 3.25);
  assert.strictEqual(r2(g.hargaCadangan), 3.42);
  assert.strictEqual(g.lebarJulat, 0.1);
  assert.strictEqual(r2(g.hargaBawah), 3.08);
  assert.strictEqual(r2(g.hargaAtas), 3.76);
});

ok('Berat_SISDA mengikut Ralat_Ramalan (had 5/10/20%)', () => {
  assert.deepStrictEqual(
    [0, 0.05, 0.051, 0.1, 0.15, 0.2, 0.21].map(P.beratSisda),
    [0.5, 0.5, 0.3, 0.3, 0.1, 0.1, 0],
  );
});

ok('Langkah 3: Beza_Nisbah <= 5% guna 6 bulan; 5–10% purata + Semakan manual', () => {
  const asas = {
    hargaPasaranTerkini: 10,
    nisbahSisda: 1,
    ralatRamalan: 0.5,
    sisdaCadangan: 10,
    turunNaik: 0,
  };
  const a = P.gabung({ ...asas, nisbah2: 1.02, nisbah6: 1 });
  assert.strictEqual(a.pilihanNisbah, 'Nisbah_6_Bulan');
  assert.strictEqual(a.semakanManual, false);
  const b = P.gabung({ ...asas, nisbah2: 1.08, nisbah6: 1 });
  assert.strictEqual(b.semakanManual, true);
  hampir(b.nisbahTerpilih, 1.04);
  // Lebar julat minimum 5% bila turun naik kecil; SISDA ralat > 20% tidak diguna
  assert.strictEqual(a.lebarJulat, 0.05);
  assert.strictEqual(a.beratSisda, 0);
  assert.strictEqual(a.sebabSisda, 'SISDA tidak diguna, ralat melebihi 20%');
});

ok('kiraTrek: data mentah 6 bulan (semua langkah, dikira tangan)', () => {
  const s = siri([4, 4, 4, 4, 4, 5], [4, 4, 4, 4, 4.4, 5.5], [4, 4, 4, 4, 4.4, 5.5, 6]);
  const t = P.kiraTrek(s, OPS);
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.bulanCadangan, '2026-12');
  assert.deepStrictEqual(t.bulan2, ['2026-10', '2026-11']);
  hampir(t.nisbah2, 4.95 / 4.5, 1e-9); // 1.1
  hampir(t.nisbah6, 25.9 / 25, 1e-9); // 1.036
  hampir(t.bezaNisbah, Math.abs(1.1 - 1.036) / 1.036, 1e-9); // 6.18% -> purata
  assert.strictEqual(t.semakanManual, true);
  hampir(t.nisbahTerpilih, (1.1 + 1.036) / 2, 1e-9);
  hampir(t.hargaPasaran, 5.34, 1e-9); // 5 × 1.068 = 5.34
  // SISDA = FIS untuk semua bulan sah: Nisbah_SISDA 1, ralat 0 -> berat 0.5; ramalan = SISDA Dis × 1 = 6
  hampir(t.nisbahSisda, 1, 1e-9);
  assert.strictEqual(t.ralatRamalan, 0);
  assert.strictEqual(t.beratSisda, 0.5);
  hampir(t.hargaRamalan, 6, 1e-9);
  hampir(t.hargaCadangan, 5.67, 1e-9); // 0.5 × 5.34 + 0.5 × 6
  // Turun_Naik = sd sampel FIS / purata FIS
  const f = [4, 4, 4, 4, 4.4, 5.5],
    m = f.reduce((a, b) => a + b) / 6;
  const sd = Math.sqrt(f.reduce((a, x) => a + (x - m) ** 2, 0) / 5);
  hampir(t.turunNaik, sd / m, 1e-9);
  hampir(t.lebarJulat, Math.min(Math.max(0.05, sd / m), 0.1), 1e-9);
  assert.strictEqual(t.bilBulanSah6, 6);
  assert.strictEqual(t.bilBulanSahSisda, 6);
  assert.strictEqual(t.bulan2Terkini, true);
  assert.strictEqual(t.bulan2Label, 'Okt–Nov 2026');
});

ok('Seksyen 10(c): tiada AMI bulan terkini -> Data tidak lengkap', () => {
  const s = siri([4, 4, 4, 4, 4, null], [4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4, 4]);
  const t = P.kiraTrek(s, OPS);
  assert.strictEqual(t.ok, false);
  assert.strictEqual(t.sebab, 'Data tidak lengkap — cadangan tidak dapat dikira');
  assert.match(t.butiran, /AMI/);
});

ok('Seksyen 6: tiada SISDA bulan cadangan -> Data tidak lengkap', () => {
  const s = siri([4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4, null]);
  const t = P.kiraTrek(s, OPS);
  assert.strictEqual(t.ok, false);
  assert.match(t.butiran, /SISDA Dis 2026/);
});

ok(
  'Seksyen 10(e): FIS bulan terkini tiada -> cadangan keluar + amaran kuning + bulan dipakai',
  () => {
    const s = siri([4, 4, 4, 4, 4, 4], [4, 4, 4, 4.2, 4.1, null], [4, 4, 4, 4, 4, 4, 4]);
    const t = P.kiraTrek(s, OPS);
    assert.strictEqual(t.ok, true);
    assert.deepStrictEqual(t.bulan2, ['2026-09', '2026-10']);
    assert.strictEqual(t.bulan2Terkini, false);
    assert.strictEqual(t.bulan2Label, 'Sep–Okt 2026 (FIS Nov tiada)');
    assert.ok(t.amaran.includes('Nisbah 2 bulan bukan dari 2 bulan terkini'));
    assert.strictEqual(t.bilBulanSah6, 5);
    assert.strictEqual(t.bilBulanSahSisda, 5);
  },
);

ok('Seksyen 10(f): FIS hanya 1 daripada 6 bulan -> Data tidak lengkap', () => {
  const s = siri([4, 4, 4, 4, 4, 4], [null, null, null, null, null, 4], [4, 4, 4, 4, 4, 4, 4]);
  const t = P.kiraTrek(s, OPS);
  assert.strictEqual(t.ok, false);
  assert.match(t.butiran, /Bulan sah FIS \+ AMI/);
});

ok(
  'Langkah 7: bulan sah SISDA < 3 -> Berat_SISDA 0, "SISDA tidak diguna, data tidak mencukupi"',
  () => {
    const s = siri([4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4], [null, null, null, null, 4, 4, 4]);
    const t = P.kiraTrek(s, OPS);
    assert.strictEqual(t.ok, true);
    assert.strictEqual(t.bilBulanSahSisda, 2);
    assert.strictEqual(t.beratSisda, 0);
    assert.strictEqual(t.sebabSisda, 'SISDA tidak diguna, data tidak mencukupi');
    hampir(t.hargaCadangan, t.hargaPasaran, 1e-12);
  },
);

ok('Langkah 0: bulan separuh data digugurkan daripada pengangka dan penyebut', () => {
  // Jul: AMI tiada (FIS ada) -> Jul bukan bulan sah Nisbah_6_Bulan, tetapi sah untuk SISDA
  const s = siri([4, null, 4, 4, 4, 4], [4, 9, 4, 4, 4, 4], [4, 9, 4, 4, 4, 4, 4]);
  const t = P.kiraTrek(s, OPS);
  assert.strictEqual(t.bilBulanSah6, 5);
  hampir(t.nisbah6, 1, 1e-12);
  assert.strictEqual(t.bilBulanSahSisda, 6);
});

ok('kiraPSI: margin kasar dan "Margin tidak mencukupi" (< 5%)', () => {
  const belian = siri([4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4, 4]);
  const jualan = siri(
    [4.1, 4.1, 4.1, 4.1, 4.1, 4.1],
    [4.1, 4.1, 4.1, 4.1, 4.1, 4.1],
    [4.1, 4.1, 4.1, 4.1, 4.1, 4.1, 4.1],
  );
  const r = P.kiraPSI({ belian, jualan, bulanTerkini: '2026-11' });
  hampir(r.margin.rm, 0.1, 1e-9);
  hampir(r.margin.pct, 2.5, 1e-9);
  hampir(r.margin.minRm, r.jualan.hargaBawah - r.belian.hargaAtas, 1e-12);
  assert.strictEqual(r.margin.tidakMencukupi, true);
  assert.strictEqual(r.belian.status, 'Margin tidak mencukupi');
  assert.strictEqual(r.jualan.status, 'Margin tidak mencukupi');
  const jualan2 = siri([5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5]);
  const r2_ = P.kiraPSI({ belian, jualan: jualan2, bulanTerkini: '2026-11' });
  assert.strictEqual(r2_.margin.tidakMencukupi, false);
  assert.strictEqual(r2_.belian.status, 'Biasa');
});

ok('Seksyen 8: tiada medan yang dibuang (Nisbah_Bulan_Terkini, lantai, transaksi terakhir)', () => {
  const s = siri([4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4, 4]);
  const teks = JSON.stringify(P.kiraPSI({ belian: s, jualan: s, bulanTerkini: '2026-11' }));
  assert.ok(
    !/BulanTerkini\b|nisbahTerkini|lantai|floor|transaksiTerakhir/i.test(
      teks.replace(/"bulanTerkini"/g, ''),
    ),
  );
});

ok('label bulan dan julat', () => {
  assert.strictEqual(P.labelJulatBulan('2026-08', '2026-09'), 'Ogo–Sep 2026');
  assert.strictEqual(P.labelJulatBulan('2025-12', '2026-01'), 'Dis 2025–Jan 2026');
  assert.strictEqual(P.tambahBulan('2026-12', 1), '2027-01');
  assert.deepStrictEqual(P.tetingkap('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
});

(async () => {
  const gagal = [];
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
            .slice(0, 3)
            .join('\n     '),
      );
    }
  }
  console.log(`\n${senarai.length - gagal.length}/${senarai.length} ujian psi-unit lulus`);
  if (gagal.length) process.exitCode = 1;
})();

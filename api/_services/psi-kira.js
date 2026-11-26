'use strict';
// Harga Cadangan PSI: logik tulen (tiada rangkaian, tiada fail). Formula daripada
// Prompt_Dashboard_Harga_Cadangan_PSI.md (formula akhir 18 Nov 2026, pindaan 22 Nov 2026: Langkah 0, 1, 2, 5, 6, 7).
// Dua trek dikira berasingan dengan formula yang sama: BELIAN = aras LADANG, JUALAN = aras BORONG.
// Input setiap trek ialah siri bulanan satu aras sahaja: AMI (harga pasaran), FIS (harga transaksi) dan SISDA (unjuran).
// Tiada Nisbah_Bulan_Terkini, tiada harga lantai, tiada MAKS(C, transaksi terakhir), tiada kiraan mingguan.

const TETAPAN = Object.freeze({
  tetingkapBulan: 6, // semua nisbah dikira daripada 6 bulan terakhir
  minBulanNisbah2: 2, // kurang daripada ini: Data tidak lengkap
  minBulanSisda: 3, // kurang daripada ini: Berat_SISDA = 0 (cadangan fail; boleh diubah)
  bezaGuna2: 0.1, // Beza_Nisbah > 10%: guna Nisbah_2_Bulan
  bezaGuna6: 0.05, // Beza_Nisbah <= 5%: guna Nisbah_6_Bulan; antara: purata + Semakan manual
  julatMin: 0.05,
  julatMaks: 0.1,
  marginMinPct: 5, // [ISI] ambang margin minimum PSI (contoh fail: 5%)
  lapukHari: 35, // [ISI] had data lapuk dari bulan cadangan (contoh fail: 35 hari)
});
// Berat_SISDA mengikut Ralat_Ramalan (pecahan, bukan %)
function beratSisda(ralat) {
  if (ralat <= 0.05) return 0.5;
  if (ralat <= 0.1) return 0.3;
  if (ralat <= 0.2) return 0.1;
  return 0;
}

/* --- Bulan YYYY-MM --- */
const RE_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;
function tambahBulan(ym, n) {
  const y = +ym.slice(0, 4),
    m = +ym.slice(5, 7) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
// Tetingkap n bulan berakhir pada bulanTerkini (menaik)
const tetingkap = (bulanTerkini, n) =>
  Array.from({ length: n }, (_, i) => tambahBulan(bulanTerkini, i - n + 1));
const BLN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const labelBulan = (ym) => BLN[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
// "Ogo–Sep 2026" / "Dis 2025–Jan 2026"
function labelJulatBulan(a, b) {
  if (a === b) return labelBulan(a);
  return a.slice(0, 4) === b.slice(0, 4)
    ? BLN[+a.slice(5, 7) - 1] + '–' + labelBulan(b)
    : labelBulan(a) + '–' + labelBulan(b);
}

const ada = (x) => typeof x === 'number' && Number.isFinite(x);
const purata = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const bulat = (x, d = 4) => (ada(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
// Harga RM dibundarkan ke sen (2 titik perpuluhan, Seksyen 7) pada setiap langkah, seperti contoh kerja Seksyen 9
// (Harga_Pasaran RM3.44 dan Harga_Ramalan RM3.25 -> Harga_Cadangan RM3.42 -> julat RM3.08–RM3.76).
// Epsilon mengelak ralat titik terapung (cth. 2.95 × 1.1 = 3.2450000000000006).
const sen = (x) => (ada(x) ? Math.round((x + Math.sign(x) * 1e-9) * 100) / 100 : null);
// Sisihan piawai sampel (n − 1); satu nilai sahaja = 0
function sisihan(a) {
  if (a.length < 2) return 0;
  const m = purata(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/* --- Gabungan akhir (Langkah 3, 4, 6 hingga 8) daripada nilai perantaraan ---
   Diasingkan supaya contoh kerja Seksyen 9 boleh disahkan terus. */
function gabung({
  nisbah2,
  nisbah6,
  hargaPasaranTerkini,
  nisbahSisda,
  ralatRamalan,
  sisdaCadangan,
  turunNaik,
  bulanSisda = Infinity,
  cfg = TETAPAN,
}) {
  const beza = Math.abs(nisbah2 - nisbah6) / nisbah6;
  let nisbahTerpilih, pilihan;
  let semakanManual = false;
  if (beza > cfg.bezaGuna2) {
    nisbahTerpilih = nisbah2;
    pilihan = 'Nisbah_2_Bulan';
  } else if (beza <= cfg.bezaGuna6) {
    nisbahTerpilih = nisbah6;
    pilihan = 'Nisbah_6_Bulan';
  } else {
    nisbahTerpilih = (nisbah2 + nisbah6) / 2;
    pilihan = 'Purata Nisbah_2_Bulan dan Nisbah_6_Bulan';
    semakanManual = true;
  }
  const hargaPasaran = sen(hargaPasaranTerkini * nisbahTerpilih);
  const hargaRamalan =
    ada(sisdaCadangan) && ada(nisbahSisda) ? sen(sisdaCadangan * nisbahSisda) : null;
  let berat = 0,
    sebabSisda = null;
  if (!(bulanSisda >= cfg.minBulanSisda) || !ada(ralatRamalan)) {
    sebabSisda = 'SISDA tidak diguna, data tidak mencukupi';
  } else {
    berat = beratSisda(ralatRamalan);
    if (berat === 0) sebabSisda = 'SISDA tidak diguna, ralat melebihi 20%';
  }
  if (hargaRamalan == null) berat = 0;
  const hargaCadangan = sen((1 - berat) * hargaPasaran + berat * (hargaRamalan || 0));
  const lebarJulat = Math.min(
    Math.max(cfg.julatMin, ada(turunNaik) ? turunNaik : 0),
    cfg.julatMaks,
  );
  return {
    bezaNisbah: beza,
    nisbahTerpilih,
    pilihanNisbah: pilihan,
    semakanManual,
    hargaPasaran,
    hargaRamalan,
    beratSisda: berat,
    sebabSisda,
    hargaCadangan,
    turunNaik,
    lebarJulat,
    hargaBawah: sen(hargaCadangan * (1 - lebarJulat)),
    hargaAtas: sen(hargaCadangan * (1 + lebarJulat)),
  };
}

/* --- Satu trek (Langkah 0 hingga 8) ---
   siri: {ami: {YYYY-MM: harga}, fis: {...}, sisda: {...}}; bulanTerkini = bulan data AMI terkini;
   bulanCadangan lalai = bulanTerkini + 1. Pulangan {ok, ...} atau {ok:false, sebab}. */
function kiraTrek(siri, { bulanTerkini, bulanCadangan, cfg = TETAPAN } = {}) {
  const ami = (siri && siri.ami) || {},
    fis = (siri && siri.fis) || {},
    sisda = (siri && siri.sisda) || {};
  if (!bulanTerkini || !RE_BULAN.test(bulanTerkini))
    return {
      ok: false,
      sebab: 'Data tidak lengkap — cadangan tidak dapat dikira',
      butiran: 'Tiada bulan data terkini',
    };
  bulanCadangan = bulanCadangan || tambahBulan(bulanTerkini, 1);
  const win = tetingkap(bulanTerkini, cfg.tetingkapBulan);
  const asas = { bulanTerkini, bulanCadangan, tetingkap: [win[0], win[win.length - 1]] };
  const tidakLengkap = (butiran) => ({
    ok: false,
    ...asas,
    sebab: 'Data tidak lengkap — cadangan tidak dapat dikira',
    butiran,
  });
  // Input wajib: AMI bulan terkini dan SISDA bulan cadangan (Seksyen 6)
  if (!ada(ami[bulanTerkini]))
    return tidakLengkap('Tiada harga pasaran (AMI) ' + labelBulan(bulanTerkini));
  if (!ada(sisda[bulanCadangan]))
    return tidakLengkap('Tiada unjuran SISDA ' + labelBulan(bulanCadangan));
  // Langkah 0: bulan sah
  const sahAmi = win.filter((m) => ada(fis[m]) && ada(ami[m]) && ami[m] > 0);
  const sahSisda = win.filter((m) => ada(fis[m]) && ada(sisda[m]) && sisda[m] > 0 && fis[m] > 0);
  if (sahAmi.length < cfg.minBulanNisbah2)
    return tidakLengkap(
      `Bulan sah FIS + AMI dalam ${labelJulatBulan(win[0], win[win.length - 1])}: ${sahAmi.length} (perlu sekurang-kurangnya ${cfg.minBulanNisbah2})`,
    );
  // Langkah 1 dan 2
  const bulan2 = sahAmi.slice(-2);
  const nisbah = (bln) => purata(bln.map((m) => fis[m])) / purata(bln.map((m) => ami[m]));
  const nisbah2 = nisbah(bulan2),
    nisbah6 = nisbah(sahAmi);
  const bulan2Terkini = bulan2.includes(bulanTerkini);
  const fisTiada = win.filter((m) => !ada(fis[m]) && m > bulan2[1]);
  // Langkah 5 dan 7
  let nisbahSisda = null,
    ralatRamalan = null;
  if (sahSisda.length) {
    nisbahSisda = purata(sahSisda.map((m) => fis[m])) / purata(sahSisda.map((m) => sisda[m]));
    ralatRamalan = purata(sahSisda.map((m) => Math.abs(sisda[m] - fis[m]) / fis[m]));
  }
  // Langkah 8: turun naik harga transaksi bulanan (6 bulan)
  const fisWin = win.filter((m) => ada(fis[m])).map((m) => fis[m]);
  const turunNaik = fisWin.length ? sisihan(fisWin) / purata(fisWin) : 0;
  const g = gabung({
    nisbah2,
    nisbah6,
    hargaPasaranTerkini: ami[bulanTerkini],
    nisbahSisda,
    ralatRamalan,
    sisdaCadangan: sisda[bulanCadangan],
    turunNaik,
    bulanSisda: sahSisda.length,
    cfg,
  });
  const amaran = [];
  if (!bulan2Terkini) amaran.push('Nisbah 2 bulan bukan dari 2 bulan terkini');
  if (g.semakanManual) amaran.push('Semakan manual');
  if (g.sebabSisda) amaran.push(g.sebabSisda);
  return {
    ok: true,
    ...asas,
    ...g,
    nisbah2,
    nisbah6,
    nisbahSisda,
    ralatRamalan,
    hargaPasaranTerkini: ami[bulanTerkini],
    sisdaCadangan: sisda[bulanCadangan],
    bulan2,
    bulan2Label:
      labelJulatBulan(bulan2[0], bulan2[1]) +
      (fisTiada.length
        ? ` (FIS ${fisTiada.map((m) => BLN[+m.slice(5, 7) - 1]).join(', ')} tiada)`
        : ''),
    bulan2Terkini,
    bilBulanSah6: sahAmi.length,
    bilBulanSahSisda: sahSisda.length,
    amaran,
  };
}

/* --- Dua trek + margin (Seksyen 4) --- */
function kiraPSI({ belian, jualan, bulanTerkini, bulanCadangan, cfg = TETAPAN }) {
  const b = kiraTrek(belian, { bulanTerkini, bulanCadangan, cfg });
  const j = kiraTrek(jualan, { bulanTerkini, bulanCadangan, cfg });
  let margin = null;
  if (b.ok && j.ok) {
    const rm = j.hargaCadangan - b.hargaCadangan;
    const pct = (rm / b.hargaCadangan) * 100;
    margin = {
      rm,
      pct,
      minRm: j.hargaBawah - b.hargaAtas, // margin paling kecil (julat)
      tidakMencukupi: rm < 0 || pct < cfg.marginMinPct,
      ambangPct: cfg.marginMinPct,
    };
  }
  // Status kad: Margin tidak mencukupi (merah) > Semakan manual (kuning) > Biasa (hijau); tidak lengkap = merah
  const status = (t) =>
    !t.ok
      ? 'Data tidak lengkap'
      : margin && margin.tidakMencukupi
        ? 'Margin tidak mencukupi'
        : t.semakanManual
          ? 'Semakan manual'
          : 'Biasa';
  b.status = status(b);
  j.status = status(j);
  return { belian: b, jualan: j, margin };
}

// Bulatkan nombor dalam keputusan untuk respons API (4 titik perpuluhan; paparan 2 titik)
function bulatKeputusan(o) {
  if (Array.isArray(o)) return o.map(bulatKeputusan);
  if (o && typeof o === 'object')
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, bulatKeputusan(v)]));
  return typeof o === 'number' ? bulat(o) : o;
}

module.exports = {
  TETAPAN,
  beratSisda,
  tambahBulan,
  tetingkap,
  labelBulan,
  labelJulatBulan,
  sisihan,
  gabung,
  kiraTrek,
  kiraPSI,
  bulatKeputusan,
  RE_BULAN,
};

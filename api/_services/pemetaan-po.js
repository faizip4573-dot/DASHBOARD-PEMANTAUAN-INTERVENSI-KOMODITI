'use strict';
// Pemetaan Pusat Operasi -> daerah daripada config/pemetaan-po-fis.json (FIS Version 2.1, diambil melalui npm run po:ambil).
// Satu sumber untuk 15 PO utama dan PO tambahan. Pelayan tidak memanggil Power BI semasa jalan.
const fs = require('node:fs');
const path = require('node:path');

const FAIL_LALAI = path.join(__dirname, '..', '..', 'config', 'pemetaan-po-fis.json');

const besar = (s) =>
  s == null ? '' : String(s).normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
// Nama daerah FIS -> nama DB Harga (huruf besar, tanda baca ringkas, BAHARU=BHARU, alias DB daripada config).
function normDaerahDb(nama, aliasDb = {}) {
  const n = besar(nama)
    .replace(/[.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/BAHARU/g, 'BHARU');
  const k = /^JOHOR (BHARU|BAHRU)$/.test(n) ? 'JOHOR BAHRU' : n;
  return aliasDb[k] || k;
}
function sahkanKonfig(k) {
  if (!k || !Array.isArray(k.po) || !k.po.length) throw new Error('Config pemetaan PO tidak sah');
  return k;
}
// Tukar config mentah kepada bentuk kerja. `po` = semua PO; `utama` / `tambahan` = tapisan.
function proses(konfig) {
  sahkanKonfig(konfig);
  const aliasDb = (konfig.alias && konfig.alias.daerahDb) || {};
  const po = konfig.po.map((p) => {
    const pasangan = p.daerah.map((d) => ({
      negeri: besar(d.negeri),
      daerah: normDaerahDb(d.nama, aliasDb),
    }));
    return {
      id: p.id,
      fisNama: p.fisNama,
      label: p.label,
      nama: 'PO ' + p.label,
      negeri: besar(p.negeri),
      negeriSemua: (p.negeriSemua || [p.negeri]).map(besar),
      utama: !!p.utama,
      daerah: p.daerah.map((d) => ({ nama: d.nama, negeri: besar(d.negeri) })),
      pasangan,
      baris: p.baris,
      terkini: p.terkini,
    };
  });
  return {
    konfig,
    sumber: konfig.sumber,
    po,
    utama: po.filter((p) => p.utama),
    tambahan: po.filter((p) => !p.utama),
    ikutId: Object.fromEntries(po.map((p) => [p.id, p])),
  };
}
let _cache = null;
function muat(fail) {
  if (!fail && _cache) return _cache;
  const k = JSON.parse(fs.readFileSync(fail || FAIL_LALAI, 'utf8'));
  const r = proses(k);
  if (!fail) _cache = r;
  return r;
}
// id PO utama (satu) bagi pasangan (negeri, daerah) yang telah dinormalkan. Null jika tiada.
function utamaUntuk(pem, negeri, daerah) {
  if (!negeri || !daerah) return null;
  for (const p of pem.utama)
    if (p.pasangan.some((x) => x.negeri === negeri && x.daerah === daerah)) return p.id;
  return null;
}
// Semua id PO tambahan (boleh lebih satu) bagi pasangan (negeri, daerah) yang telah dinormalkan.
function tambahanUntuk(pem, negeri, daerah) {
  if (!negeri || !daerah) return [];
  return pem.tambahan
    .filter((p) => p.pasangan.some((x) => x.negeri === negeri && x.daerah === daerah))
    .map((p) => p.id);
}

module.exports = { FAIL_LALAI, besar, normDaerahDb, proses, muat, utamaUntuk, tambahanUntuk };

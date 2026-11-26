'use strict';
// Harga Cadangan PSI: baca cache data/processed/psi-bulanan.json (ditulis oleh npm run psi:ambil) dan kira
// cadangan BELIAN (ladang) dan JUALAN (borong) untuk satu PO + varieti dengan api/_services/psi-kira.js.
const path = require('node:path');
const util = require('./util-rangkaian.js');
const kira = require('./harga-db-kira.js');
const P = require('./psi-kira.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const laluan = () => process.env.PSI_FILE || path.join(DATA_DIR, 'psi-bulanan.json');
let memo = null;
function bacaCache() {
  const f = laluan();
  let mtime = 0;
  try {
    mtime = require('node:fs').statSync(f).mtimeMs;
  } catch {
    return null;
  }
  if (memo && memo.f === f && memo.mtime === mtime) return memo.data;
  const data = util.bacaJson(f);
  memo = { f, mtime, data };
  return data;
}

const RE_TEKS = /^[\p{L}\p{N} .,()&'/\-[\]]{1,100}$/u;
// Pulangan {nilai} atau {ralat}
function sahkanParam(sp) {
  const kenal = new Set(['po', 'variety', 'bulan']);
  for (const k of sp.keys())
    if (!kenal.has(k)) return { ralat: 'Parameter tidak dikenali: ' + k.slice(0, 30) };
  const po = sp.get('po');
  if (!po || !kira.PO_DAERAH[po]) return { ralat: 'Parameter po tidak sah (15 PO utama sahaja)' };
  const variety = sp.get('variety');
  if (!variety || !RE_TEKS.test(variety)) return { ralat: 'Parameter variety tidak sah' };
  const bulan = sp.get('bulan');
  if (bulan !== null && !P.RE_BULAN.test(bulan))
    return { ralat: 'Parameter bulan tidak sah; guna YYYY-MM' };
  return { nilai: { po, variety: kira.normNama(variety), bulan } };
}

const hariAntara = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

function jawab(c, { po, variety, bulan }, cfg = P.TETAPAN) {
  const negeri = kira.PO_DAERAH[po].negeri;
  const bulanTerkini = c.bulanTerkini;
  const bulanCadangan = bulan || P.tambahBulan(bulanTerkini, 1);
  const siri = (aras) => ({
    ami: c.ami[aras + '|' + po + '|' + variety] || {},
    fis: c.fis[aras + '|' + po + '|' + variety] || {},
    sisda: c.sisda[aras + '|' + negeri + '|' + variety] || {},
  });
  const r = P.kiraPSI({
    belian: siri('LADANG'),
    jualan: siri('BORONG'),
    bulanTerkini,
    bulanCadangan,
    cfg,
  });
  // Panel amaran (a): data lapuk, sumber yang tarikh terakhirnya melebihi had hari dari bulan cadangan
  const mulaCadangan = bulanCadangan + '-01';
  const lapuk = [];
  const semak = (nama, t) => {
    if (t && hariAntara(t, mulaCadangan) > cfg.lapukHari)
      lapuk.push(
        `${nama}: data terakhir ${t} (${hariAntara(t, mulaCadangan)} hari sebelum ${P.labelBulan(bulanCadangan)})`,
      );
  };
  const tarikh = {};
  for (const [aras, trek] of [
    ['LADANG', 'belian'],
    ['BORONG', 'jualan'],
  ]) {
    const t = {
      ami: (c.sumber.ami.terkini || {})[aras] || null,
      fis: (c.fisTerkini || {})[aras + '|' + po + '|' + variety] || null,
    };
    tarikh[trek] = t;
    semak(`AMI ${aras.toLowerCase()}`, t.ami);
    semak(`FIS ${aras.toLowerCase()}`, t.fis);
  }
  return P.bulatKeputusan({
    versi: 1,
    po,
    variety,
    unit: c.unit[variety] || 'KG',
    bulanTerkini,
    bulanCadangan,
    labelCadangan: P.labelBulan(bulanCadangan),
    labelTerkini: P.labelBulan(bulanTerkini),
    disegarPada: c.disegarPada,
    sumber: c.sumber,
    tarikh,
    lapuk,
    ambangMarginPct: cfg.marginMinPct,
    ...r,
    nota: 'Peraturan harga lantai akan ditambah bila senarai lantai rasmi ada.',
  });
}

module.exports = { bacaCache, sahkanParam, jawab, laluan };

'use strict';
// Amaran cuaca MET Malaysia melalui data.gov.my (https://api.data.gov.my/weather/warning). Tiada kunci diperlukan.
// Had kadar data.gov.my ~4 permintaan seminit: satu permintaan setiap 30 minit sudah mencukupi. Hanya GET dari pelayan.
const path = require('node:path');
const util = require('./util-rangkaian.js');
const { negeriDalamTeks } = require('./cuaca.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const CACHE_LALAI = path.join(DATA_DIR, 'amaran-datagov.json');
const URL_AMARAN = 'https://api.data.gov.my/weather/warning';
const ATRIBUSI = 'MET Malaysia (data.gov.my)';
const TOLERANSI_PENDUA_MS = 60 * 6e4;

function selangMin() {
  const n = Number(process.env.AMARAN_DG_POLL_MIN);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
function laluanCache() {
  return process.env.AMARAN_DG_CACHE_FILE || CACHE_LALAI;
}
function redak(e) {
  return String((e && e.message) || e);
}

// Tahap daripada tajuk: sama dengan peraturan kad Amaran Rasmi (Bahaya/Buruk/Waspada/Umum).
function tahapDaripada(teks) {
  const u = String(teks || '').toUpperCase();
  if (/\bBERBAHAYA\b|\bBAHAYA\b|\bDANGER\b|KATEGORI KETIGA|THIRD CATEGORY/.test(u)) return 'BAHAYA';
  if (/\bBURUK\b|\bWARNING\b|KATEGORI KEDUA|SECOND CATEGORY/.test(u)) return 'BURUK';
  if (/\bWASPADA\b|\bALERT\b|KATEGORI PERTAMA|FIRST CATEGORY/.test(u)) return 'WASPADA';
  return 'UMUM';
}
const tiadaNasihat = (a) =>
  /tiada nasihat|no advisory/i.test(
    String((a.warning_issue && a.warning_issue.title_bm) || a.heading_bm || ''),
  );

function normalisasi(mentah) {
  if (!Array.isArray(mentah)) return [];
  const hasil = [];
  mentah.forEach((r) => {
    if (!r || typeof r !== 'object' || !r.warning_issue || tiadaNasihat(r)) return;
    const wi = r.warning_issue;
    const tajuk = String(r.heading_bm || wi.title_bm || r.heading_en || wi.title_en || '').trim();
    const teks = String(r.text_bm || r.text_en || '').trim();
    if (!tajuk && !teks) return;
    const dikeluarkan = util.parseMasaMYT(wi.issued);
    const sahDari = util.parseMasaMYT(r.valid_from);
    const sahHingga = util.parseMasaMYT(r.valid_to);
    const negeri = negeriDalamTeks(teks + ' ' + String(r.text_en || ''));
    hasil.push({
      id: [wi.title_bm || tajuk, wi.issued, r.valid_from, r.valid_to].join('|'),
      jenis: String(wi.title_bm || '').trim(),
      jenisEn: String(wi.title_en || '').trim(),
      tajuk,
      tahap: tahapDaripada(tajuk),
      teks,
      arahan: r.instruction_bm ? String(r.instruction_bm).trim() : null,
      negeri,
      dikeluarkan,
      sah_dari: sahDari,
      sah_hingga: sahHingga,
    });
  });
  return hasil.sort((x, y) => (Date.parse(y.dikeluarkan) || 0) - (Date.parse(x.dikeluarkan) || 0));
}

const ringkasTajuk = (t) =>
  String(t || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Sama dengan amaran MET (api.met.gov.my) jika tajuk sama (selepas dinormalkan), masa dikeluarkan dalam
// lingkungan 60 minit dan negeri bertindih (atau kedua-duanya tiada negeri).
function samaDenganMET(a, met) {
  const ta = ringkasTajuk(a.tajuk);
  const masaA = Date.parse(a.dikeluarkan);
  return (met || []).some((m) => {
    const tm = ringkasTajuk(m.tajuk);
    if (!ta || !tm || (ta !== tm && !ta.includes(tm) && !tm.includes(ta))) return false;
    const masaM = Date.parse(m.dikeluarkan);
    if (Number.isNaN(masaA) || Number.isNaN(masaM)) return false;
    if (Math.abs(masaA - masaM) > TOLERANSI_PENDUA_MS) return false;
    const na = a.negeri || [];
    const nm = m.negeri || [];
    if (!na.length && !nm.length) return true;
    return na.some((n) => nm.includes(n));
  });
}
function tandaiPendua(senarai, met) {
  return (senarai || []).map((a) => ({ ...a, pendua: samaDenganMET(a, met) }));
}

async function ambil() {
  const j = await util.fetchJson(URL_AMARAN, { timeoutMs: 20000, retries: 1 });
  if (!Array.isArray(j)) throw new Error('Format tidak dijangka');
  return j;
}
function bacaCache() {
  return util.bacaJson(laluanCache());
}
function tulisCache(obj) {
  util.tulisJsonAtomik(laluanCache(), obj);
}
const umurJam = util.umurJam;

let sedangAmbilBendera = false;
async function segar(sekarang = new Date()) {
  sedangAmbilBendera = true;
  try {
    const lama = bacaCache();
    try {
      const mentah = await ambil();
      const baru = {
        versi: 1,
        fetchedAt: sekarang.toISOString(),
        atribusi: ATRIBUSI,
        sumber: { status: 'ok', mesej: '' },
        amaran: normalisasi(mentah),
      };
      tulisCache(baru);
      return { data: baru, ditulis: true };
    } catch (e) {
      if (!lama) throw e;
      lama.sumber = { status: 'gagal', mesej: redak(e) };
      return { data: lama, ditulis: false };
    }
  } finally {
    sedangAmbilBendera = false;
  }
}

let pemasa = null;
function mulaPenjadual() {
  if (process.env.AMARAN_DG_AUTO === '0') return;
  const selang = selangMin();
  const semak = async () => {
    if (sedangAmbilBendera) return;
    const c = bacaCache();
    if (c && umurJam(c) < selang / 60) return;
    try {
      await segar();
      console.log('Amaran cuaca data.gov.my dikemas kini.');
    } catch (e) {
      console.warn('Gagal mengemas kini amaran data.gov.my: ' + redak(e));
    }
  };
  semak();
  if (!pemasa) {
    pemasa = setInterval(semak, selang * 6e4);
    pemasa.unref();
  }
}

module.exports = {
  URL_AMARAN,
  ATRIBUSI,
  tahapDaripada,
  normalisasi,
  samaDenganMET,
  tandaiPendua,
  ambil,
  segar,
  bacaCache,
  tulisCache,
  umurJam,
  mulaPenjadual,
  sedangAmbil: () => sedangAmbilBendera,
};

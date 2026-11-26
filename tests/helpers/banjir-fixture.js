'use strict';
// Fixture /api/banjir dan /api/kualiti-udara deterministik (tiada rangkaian). Dijana guna fungsi tulen sebenar
// atas data dalam tests/fixtures; semua cap masa dianjak supaya kelihatan segar relatif kepada masa kini.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const banjir = require('../../api/_services/banjir.js');
const ipu = require('../../api/_services/kualiti-udara.js');
const { muatPO } = require('../../api/_services/cuaca.js');
const { buatFixture, pasangCache } = require('./cuaca-fixture.js');
const { buatFixtureMuse, pasangCacheMuse } = require('./muse-fixture.js');

const DIR = path.join(__dirname, '..', 'fixtures');
const baca = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));

// Masa rujukan tetap bagi data dalam fixture.
const MASA_NASIONAL = '2026-11-17T04:30:00.000Z';
const MASA_SELANGOR = '2026-11-17T07:10:00.000Z';
const MASA_IPU = '2026-11-17T06:30:00.000Z';
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;

function anjakMasa(nilai, deltaMs) {
  if (typeof nilai === 'string')
    return RE_ISO.test(nilai)
      ? new Date(Date.parse(nilai) + deltaMs + 8 * 36e5).toISOString().slice(0, 19) + '+08:00'
      : nilai;
  if (Array.isArray(nilai)) return nilai.map((x) => anjakMasa(x, deltaMs));
  if (nilai && typeof nilai === 'object')
    return Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k, anjakMasa(v, deltaMs)]));
  return nilai;
}

// opsyen: tahap 'normal' (lalai) | 'amaran' | 'bahaya', umurJam, amaranRasmi (boolean), sumberGagal (kunci sumber)
function buatFixtureBanjir(opsyen = {}) {
  const { tahap = 'normal', umurJam = 0, amaranRasmi = false, sumberGagal = [] } = opsyen;
  const dasar = Date.now() - umurJam * 36e5;
  const nas = anjakMasa(
    banjir.normalisasiNasional(baca('jps-nasional.json'), MASA_NASIONAL),
    dasar - Date.parse(MASA_NASIONAL),
  );
  const sel = anjakMasa(
    banjir.normalisasiSelangor(baca('jps-selangor-telemetry.json'), MASA_SELANGOR),
    dasar - Date.parse(MASA_SELANGOR),
  );
  // Semua stesen Normal; tahap menaikkan satu stesen dalam radius PO Melaka (Pintu Air Sg. Duyong).
  [...nas, ...sel].forEach((s) => {
    if (s.parasAir != null) s.statusRasmi = 'Normal';
  });
  const duyong = nas.find((s) => /Duyong/.test(s.nama));
  if (tahap === 'amaran') duyong.statusRasmi = 'Amaran';
  if (tahap === 'bahaya') duyong.statusRasmi = 'Bahaya';
  const amaran = amaranRasmi
    ? anjakMasa(
        banjir.normalisasiAmaran(baca('getdisse-sintetik.json'), MASA_NASIONAL),
        dasar - Date.parse(MASA_NASIONAL),
      )
    : [];
  const diambil = new Date(dasar).toISOString();
  const sumber = {
    jpsNasional: { status: 'ok', mesej: '', diambil, bilangan: nas.length },
    jpsSelangor: { status: 'ok', mesej: '', diambil, bilangan: sel.length },
    amaranJps: { status: 'ok', mesej: '', diambil, bilangan: amaran.length },
    sejarahSelangor: { status: 'ok', mesej: '', diambil, bilangan: 10 },
  };
  sumberGagal.forEach((k) => {
    sumber[k] = { status: 'gagal', mesej: 'Tidak dapat dihubungi (ujian)', diambil };
  });
  return banjir.susun({
    rekodNasional: nas,
    rekodSelangor: sel,
    amaran,
    amaranDiambil: diambil,
    sejarah: banjir.normalisasiSejarah(baca('arcgis-banjir2024.json')),
    sumber,
    sekarang: new Date(dasar),
    poList: muatPO(),
    radiusKm: 25,
  });
}

// opsyen: umurJam, band ('variasi' = lima jalur silih berganti, atau nama jalur untuk semua), lapuk (boolean)
function buatFixtureIPU(opsyen = {}) {
  const { umurJam = 0, band = null, lapuk = false } = opsyen;
  const dasar = Date.now() - umurJam * 36e5 - (lapuk ? 5 * 36e5 : 0);
  const peta = ipu.normalisasiPeta(baca('ipu-peta.json'));
  const jam = ipu.normalisasiJam(baca('ipu-jam.json'));
  const stesen = anjakMasa(ipu.gabungStesenIPU(peta, jam, MASA_IPU), dasar - Date.parse(MASA_IPU));
  const NILAI = {
    baik: 30,
    sederhana: 80,
    tidak_sihat: 150,
    sangat_tidak_sihat: 250,
    berbahaya: 350,
  };
  const URUTAN = Object.keys(NILAI);
  stesen.forEach((s, i) => {
    if (band) {
      const kunci = band === 'variasi' ? URUTAN[i % URUTAN.length] : band;
      s.api = NILAI[kunci];
      Object.assign(s, ipu.bandIPU(s.api));
      if (s.sejarah24j.length) s.sejarah24j[s.sejarah24j.length - 1].api = s.api;
    }
    s.lapuk = lapuk ? true : s.lapuk;
  });
  const diambil = new Date(dasar).toISOString();
  return {
    versi: 1,
    fetchedAt: diambil,
    atribusi: 'Sumber: JAS (MyEQMS)',
    sumber: {
      stesenPeta: { status: 'ok', mesej: '', diambil },
      jam: { status: 'ok', mesej: '', diambil },
    },
    stesen,
    po: ipu.terbitPO(stesen, muatPO()),
  };
}

function tulisTemp(awalan, nama, obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), awalan)), nama);
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}
function pasangCacheBanjir(obj) {
  const f = tulisTemp('banjir-', 'banjir.json', obj || buatFixtureBanjir());
  process.env.BANJIR_CACHE_FILE = f;
  return f;
}
function pasangCacheIPU(obj) {
  const f = tulisTemp('ipu-', 'ipu.json', obj || buatFixtureIPU());
  process.env.IPU_CACHE_FILE = f;
  return f;
}
// Amaran data.gov.my: lalai tiada cache (fail tidak wujud) supaya ujian tidak membaca data sebenar pembangun.
function pasangCacheAmaranDG(obj) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amaran-dg-'));
  const f = path.join(d, 'amaran-dg.json');
  if (obj) fs.writeFileSync(f, JSON.stringify(obj));
  process.env.AMARAN_DG_CACHE_FILE = f;
  return f;
}
// DB Harga: arahkan fail cache ke tests/fixtures/harga-db (baca sahaja), matikan sync automatik dan tetapkan
// "masa kini" pelayan (HARGA_SEKARANG) 2 hari selepas data terkini (2026-11-04) supaya data tidak lapuk.
// opsyen.sekarang menimpa masa itu (cth. '2026-11-21T00:00:00Z' = lapuk); opsyen.tiada = tiada cache (503).
function pasangCacheHarga(opsyen = {}) {
  const dir = path.join(DIR, 'harga-db');
  const fail = (n) => (opsyen.tiada ? path.join(os.tmpdir(), 'harga-tiada', n) : path.join(dir, n));
  process.env.DB_HARGA_AUTO = '0';
  process.env.HARGA_RINGKAS_FILE = fail('harga-ringkas.json');
  process.env.HARGA_AMBANG_FILE = fail('harga-ambang.json');
  process.env.HARGA_META_FILE = fail('harga-meta.json');
  process.env.HARGA_SEKARANG = opsyen.sekarang || '2026-11-06T00:00:00.000Z';
  return {
    ringkas: process.env.HARGA_RINGKAS_FILE,
    ambang: process.env.HARGA_AMBANG_FILE,
    meta: process.env.HARGA_META_FILE,
  };
}
// Cuaca + banjir (lalai normal) + IPU + AI Muse + harga.
function pasangSemuaCache(opsyen = {}) {
  return {
    harga: pasangCacheHarga(opsyen.harga),
    cuaca: pasangCache(opsyen.cuaca || buatFixture()),
    banjir: pasangCacheBanjir(opsyen.banjir || buatFixtureBanjir()),
    ipu: pasangCacheIPU(opsyen.ipu || buatFixtureIPU()),
    muse: pasangCacheMuse(opsyen.muse || buatFixtureMuse()),
    amaranDG: pasangCacheAmaranDG(opsyen.amaranDG),
  };
}

module.exports = {
  buatFixtureBanjir,
  buatFixtureIPU,
  pasangCacheBanjir,
  pasangCacheIPU,
  pasangCacheAmaranDG,
  pasangCacheHarga,
  pasangSemuaCache,
  anjakMasa,
};

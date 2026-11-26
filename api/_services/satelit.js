'use strict';
// Satelit inframerah Himawari (JMA) melalui NASA GIBS WMTS. Id lapisan dan matriks ditetapkan (disahkan, lihat lapisan-cuaca-sources.md);
// capabilities (5.8 MB) tidak diambil semasa jalan. GIBS lewat ~45 min, jadi pelayan menyiasat tile untuk mencari masa terkini.
const util = require('./util-rangkaian.js');

const LAPISAN = 'Himawari_AHI_Band13_Clean_Infrared';
const MATRIKS = 'GoogleMapsCompatible_Level6';
const ATRIBUSI = 'NASA GIBS / JMA Himawari';
const HOS = 'https://gibs.earthdata.nasa.gov';
const LANGKAH_MS = 10 * 6e4;
const LEWAT_MS = 45 * 6e4;
const BILANGAN_BINGKAI = 6;
const CUBA_UNDUR = 6;
const CACHE_MS = 10 * 6e4;
// Tile siasatan tetap: z6, baris 31, lajur 51 (baris sebelum lajur) = sekitar Borneo / Laut China Selatan.
const SIASAT = '6/31/51';

const isoZ = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';
const urlTile = (masaIso, zyx) =>
  `${HOS}/wmts/epsg3857/best/${LAPISAN}/default/${masaIso}/${MATRIKS}/${zyx}.png`;

const adaPng = (r) =>
  r &&
  r.status === 200 &&
  /image\/png/i.test(r.tipe || '') &&
  r.buf &&
  r.buf.length > 5000 &&
  r.buf[0] === 0x89 &&
  r.buf[1] === 0x50;

// fetchTeks(url) -> {status, tipe, buf}. Pulangan: tatasusunan ISO (lama -> baru), atau [] jika tiada siasatan berjaya.
async function cariBingkaiTerkini(
  sekarangMs,
  fetchTeks = (u) => util.fetchTeks(u, { retries: 0, timeoutMs: 15000 }),
) {
  let t = Math.floor((sekarangMs - LEWAT_MS) / LANGKAH_MS) * LANGKAH_MS;
  for (let i = 0; i <= CUBA_UNDUR; i++, t -= LANGKAH_MS) {
    let r = null;
    try {
      r = await fetchTeks(urlTile(isoZ(t), SIASAT));
    } catch {
      r = null;
    }
    if (adaPng(r)) {
      const hasil = [];
      for (let k = BILANGAN_BINGKAI - 1; k >= 0; k--) hasil.push(isoZ(t - k * LANGKAH_MS));
      return hasil;
    }
  }
  return [];
}

let memori = null;
async function ambilSatelit(opsyen = {}) {
  const kini = opsyen.kini ? opsyen.kini() : Date.now();
  if (memori && kini - memori.ms < CACHE_MS) return memori.data;
  const frames = await cariBingkaiTerkini(kini, opsyen.fetchTeks);
  const data = {
    versi: 1,
    fetchedAt: new Date(kini).toISOString(),
    atribusi: ATRIBUSI,
    lapisan: LAPISAN,
    matriks: MATRIKS,
    maxzoom: 6,
    frames,
  };
  memori = { ms: kini, data };
  return data;
}
const _tetapSemula = () => {
  memori = null;
};

module.exports = {
  LAPISAN,
  MATRIKS,
  ATRIBUSI,
  urlTile,
  adaPng,
  cariBingkaiTerkini,
  ambilSatelit,
  _tetapSemula,
};

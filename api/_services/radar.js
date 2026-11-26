'use strict';
// Radar cuaca RainViewer (Weather Maps API, percuma, skala kecil). Pelayar tidak boleh memanggil api.rainviewer.com
// kerana CSP; pelayan mengesahkan JSON ini dan hanya memulangkan bingkai lampau. Tile dimuat terus daripada hos tile (dibenarkan CSP).
const util = require('./util-rangkaian.js');

const ASAL_LALAI = 'https://api.rainviewer.com';
const HOS_TILE_LALAI = 'https://tilecache.rainviewer.com';
const ATRIBUSI = 'RainViewer';
const CACHE_MS = 5 * 6e4;
const LAPUK_MS = 30 * 6e4;
const RE_PATH = /^\/v2\/radar\/[0-9a-f]+$/;

let amaranBase = false;
function asalRainViewer() {
  const mentah = process.env.RAINVIEWER_BASE;
  if (!mentah) return ASAL_LALAI;
  try {
    const u = new URL(mentah);
    const tempatan = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && tempatan)) return u.origin;
  } catch {
    /* jatuh ke amaran */
  }
  if (!amaranBase) {
    amaranBase = true;
    console.warn('RAINVIEWER_BASE tidak sah (perlu https); guna asal lalai.');
  }
  return ASAL_LALAI;
}
const hosTile = () => process.env.RAINVIEWER_TILE_HOST || HOS_TILE_LALAI;

// Hos tile mesti sama dengan hos yang dibenarkan CSP; selain itu pelayar akan menyekatnya.
function normalisasiRadar(json, tileHost = hosTile()) {
  if (!json || typeof json !== 'object' || typeof json.host !== 'string')
    throw new Error('Format RainViewer tidak dijangka');
  if (json.host !== tileHost) throw new Error('Hos tile RainViewer tidak dibenarkan');
  const past = json.radar && json.radar.past;
  if (!Array.isArray(past)) throw new Error('Format RainViewer tidak dijangka');
  const frames = past
    .filter(
      (f) =>
        f &&
        Number.isInteger(f.time) &&
        f.time > 0 &&
        typeof f.path === 'string' &&
        RE_PATH.test(f.path),
    )
    .map((f) => ({ time: f.time, path: f.path }))
    .sort((a, b) => a.time - b.time);
  return { versi: 1, atribusi: ATRIBUSI, host: json.host, frames };
}

let memori = null; // {ms, data}
async function ambilRadar(opsyen = {}) {
  const kini = opsyen.kini ? opsyen.kini() : Date.now();
  if (memori && kini - memori.ms < CACHE_MS) return memori.data;
  const ambil = opsyen.fetchJson || util.fetchJson;
  try {
    const j = await ambil(asalRainViewer() + '/public/weather-maps.json', {
      timeoutMs: 15000,
      retries: 1,
    });
    const data = { ...normalisasiRadar(j), fetchedAt: new Date(kini).toISOString() };
    memori = { ms: kini, data };
    return data;
  } catch (e) {
    if (memori && kini - memori.ms <= LAPUK_MS) return { ...memori.data, lapuk: true };
    throw e;
  }
}
const _tetapSemula = () => {
  memori = null;
  amaranBase = false;
};

module.exports = { ATRIBUSI, normalisasiRadar, ambilRadar, hosTile, _tetapSemula };

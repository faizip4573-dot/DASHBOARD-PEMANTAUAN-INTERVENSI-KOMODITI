'use strict';
// Siklon tropika aktif di rantau ini daripada GDACS (GeoJSON awam, tanpa kunci). Cache dikemas kini setiap jam.
const path = require('node:path');
const util = require('./util-rangkaian.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const CACHE_LALAI = path.join(DATA_DIR, 'siklon.json');
const URL_SENARAI = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
const ATRIBUSI = 'GDACS';
const BBOX = { lonMin: 90, lonMax: 140, latMin: -15, latMax: 25 };
const HOS_GDACS = 'www.gdacs.org';
const PAUTAN_AWAL = 'https://www.gdacs.org/';

const laluanCache = () => process.env.SIKLON_CACHE_FILE || CACHE_LALAI;
const selangMin = () => {
  const n = Number(process.env.GDACS_POLL_MIN);
  return Number.isFinite(n) && n > 0 ? n : 60;
};
const redak = (e) => String((e && e.message) || e);

function kategoriDaripada(teks) {
  const awal = String(teks || '')
    .split('(')[0]
    .trim();
  if (/^tropical depression$/i.test(awal)) return 'Depresi Tropika';
  if (/^tropical storm$/i.test(awal)) return 'Ribut Tropika';
  if (/^(super )?typhoon$/i.test(awal) || /^(tropical )?cyclone$/i.test(awal)) return 'Taufan';
  return awal || 'Siklon tropika';
}

const dalamBbox = (lon, lat) =>
  lon >= BBOX.lonMin && lon <= BBOX.lonMax && lat >= BBOX.latMin && lat <= BBOX.latMax;
const urlGdacsSah = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === HOS_GDACS;
  } catch {
    return false;
  }
};
const benar = (v) => v === true || v === 'true';

// senarai: FeatureCollection GDACS; geometriMap: {eventid: FeatureCollection geometri}. Fungsi tulen.
function normalisasiSiklon(senarai, geometriMap = {}) {
  const ciri = senarai && Array.isArray(senarai.features) ? senarai.features : [];
  const hasil = [];
  ciri.forEach((f) => {
    const p = f && f.properties;
    const g = f && f.geometry;
    if (!p || !g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return;
    if (!benar(p.iscurrent)) return;
    let [lon, lat] = g.coordinates;
    const geom = geometriMap[p.eventid];
    const jejakLalu = [];
    const jejakRamalan = [];
    if (geom && Array.isArray(geom.features)) {
      geom.features.forEach((x) => {
        const c = x && x.properties && x.properties.Class;
        if (c === 'Point_Centroid' && x.geometry && x.geometry.type === 'Point') {
          lon = x.geometry.coordinates[0];
          lat = x.geometry.coordinates[1];
        } else if (/^Line_Line_/.test(c || '') && x.geometry && x.geometry.type === 'LineString') {
          (benar(x.properties.forecast) ? jejakRamalan : jejakLalu).push(x.geometry.coordinates);
        }
      });
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !dalamBbox(lon, lat)) return;
    const sd = p.severitydata || {};
    const pautan =
      p.url && typeof p.url.report === 'string' && p.url.report.startsWith(PAUTAN_AWAL)
        ? p.url.report
        : null;
    hasil.push({
      id: String(p.eventid),
      nama: String(p.eventname || p.name || ''),
      aras: String(p.alertlevel || ''),
      kategori: kategoriDaripada(sd.severitytext),
      anginKmj: Number.isFinite(sd.severity) ? Math.round(sd.severity) : null,
      teks: String(sd.severitytext || ''),
      dari: p.fromdate || null,
      hingga: p.todate || null,
      negara: String(p.country || ''),
      pos: [lon, lat],
      jejakLalu,
      jejakRamalan,
      pautan,
    });
  });
  return hasil;
}

const tarikh = (ms) => new Date(ms).toISOString().slice(0, 10);

async function ambilMentah(sekarangMs = Date.now(), fetchJson = util.fetchJson) {
  const url =
    URL_SENARAI +
    `?eventlist=TC&fromdate=${tarikh(sekarangMs - 30 * 864e5)}&todate=${tarikh(sekarangMs)}&alertlevel=Green;Orange;Red`;
  const senarai = await fetchJson(url, { timeoutMs: 20000, retries: 1 });
  const geometriMap = {};
  const gagalGeom = [];
  for (const f of (senarai && senarai.features) || []) {
    const p = f && f.properties;
    if (!p || !benar(p.iscurrent)) continue;
    const g = f.geometry && f.geometry.coordinates;
    if (!g || !dalamBbox(g[0], g[1])) continue;
    const u = p.url && p.url.geometry;
    if (!urlGdacsSah(u)) {
      gagalGeom.push(String(p.eventid));
      continue;
    }
    try {
      geometriMap[p.eventid] = await fetchJson(u, { timeoutMs: 20000, retries: 1 });
    } catch (e) {
      gagalGeom.push(String(p.eventid));
      console.warn('Geometri siklon ' + p.eventid + ' gagal: ' + redak(e));
    }
  }
  return { senarai, geometriMap, gagalGeom };
}

const bacaCache = () => util.bacaJson(laluanCache());
const umurJam = util.umurJam;
let sedangAmbilBendera = false;

async function segar(sekarang = new Date(), fetchJson = util.fetchJson) {
  sedangAmbilBendera = true;
  try {
    const lama = bacaCache();
    try {
      const { senarai, geometriMap, gagalGeom } = await ambilMentah(sekarang.getTime(), fetchJson);
      const baru = {
        versi: 1,
        fetchedAt: sekarang.toISOString(),
        atribusi: ATRIBUSI,
        sumber: {
          status: 'ok',
          mesej: gagalGeom.length ? 'Jejak tidak lengkap: ' + gagalGeom.join(',') : '',
        },
        siklon: normalisasiSiklon(senarai, geometriMap),
      };
      util.tulisJsonAtomik(laluanCache(), baru);
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
  if (process.env.GDACS_AUTO === '0') return;
  const selang = selangMin();
  const semak = async () => {
    if (sedangAmbilBendera) return;
    const c = bacaCache();
    if (c && umurJam(c) < selang / 60) return;
    try {
      await segar();
    } catch (e) {
      console.warn('Gagal mengemas kini siklon GDACS: ' + redak(e));
    }
  };
  semak();
  if (!pemasa) {
    pemasa = setInterval(semak, selang * 6e4);
    pemasa.unref();
  }
}

module.exports = {
  ATRIBUSI,
  BBOX,
  kategoriDaripada,
  normalisasiSiklon,
  ambilMentah,
  segar,
  bacaCache,
  umurJam,
  mulaPenjadual,
  sedangAmbil: () => sedangAmbilBendera,
};

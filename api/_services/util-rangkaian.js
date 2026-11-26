'use strict';
// Pembantu kongsi untuk servis banjir (JPS) dan kualiti udara (JAS): rangkaian, jarak, fail cache, masa MYT.
const fs = require('node:fs');
const path = require('node:path');

const UA = 'FAMA-dashboard-prototype';
const OFFSET_MYT_MS = 8 * 36e5;

async function fetchJson(
  url,
  { headers = {}, timeoutMs = 20000, retries = 1, backoffMs = 1500 } = {},
) {
  let ralat;
  for (let cuba = 0; cuba <= retries; cuba++) {
    if (cuba > 0) await new Promise((r) => setTimeout(r, backoffMs));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        signal: ac.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      ralat = new Error(
        e && e.name === 'AbortError' ? 'Tamat masa' : String((e && e.message) || e),
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw ralat;
}

// Ambil badan mentah (Buffer) + status + content-type. Status bukan 2xx dibaca juga (pemanggil memutuskan);
// ralat rangkaian/tamat masa dicuba semula.
async function fetchTeks(
  url,
  { headers = {}, timeoutMs = 20000, retries = 1, backoffMs = 1500 } = {},
) {
  let ralat;
  for (let cuba = 0; cuba <= retries; cuba++) {
    if (cuba > 0) await new Promise((r) => setTimeout(r, backoffMs));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: ac.signal,
      });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status >= 500 && cuba < retries) {
        ralat = new Error('HTTP ' + res.status);
        continue;
      }
      return { status: res.status, tipe: res.headers.get('content-type') || '', buf };
    } catch (e) {
      ralat = new Error(
        e && e.name === 'AbortError' ? 'Tamat masa' : String((e && e.message) || e),
      );
    } finally {
      clearTimeout(timer);
    }
  }
  throw ralat;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function tulisJsonAtomik(fail, obj) {
  fs.mkdirSync(path.dirname(fail), { recursive: true });
  const tmp = fail + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, fail);
}

function bacaJson(fail) {
  try {
    return JSON.parse(fs.readFileSync(fail, 'utf8'));
  } catch {
    return null;
  }
}

// Umur (jam) bagi objek dengan `fetchedAt`, atau rentetan ISO. Infinity jika tidak sah.
function umurJam(obj, sekarang = Date.now()) {
  const iso = typeof obj === 'string' ? obj : obj && obj.fetchedAt;
  const t = iso ? Date.parse(iso) : NaN;
  const now =
    sekarang instanceof Date
      ? sekarang.getTime()
      : typeof sekarang === 'string'
        ? Date.parse(sekarang)
        : Number(sekarang);
  return Number.isNaN(t) ? Infinity : (now - t) / 36e5;
}

function keIsoMYT(msWaktuDinding) {
  return new Date(msWaktuDinding).toISOString().slice(0, 19) + '+08:00';
}

// Terima: 'dd/MM/yyyy HH:mm[:ss]', ISO tanpa zon (dianggap MYT), ISO berzon (ditukar ke +08:00),
// atau nombor epoch ms "tempatan-sebagai-UTC" (waktu dinding MYT dikodkan seperti UTC; JANGAN tambah 8 j).
// Pulangan: ISO '+08:00' atau null.
function parseMasaMYT(nilai) {
  if (nilai == null || nilai === '') return null;
  if (typeof nilai === 'number') {
    return Number.isFinite(nilai) ? keIsoMYT(nilai) : null;
  }
  const s = String(nilai).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
    const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
    const cek = new Date(ms);
    if (cek.getUTCMonth() !== +mo - 1 || cek.getUTCDate() !== +d) return null;
    return keIsoMYT(ms);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (m) {
    const [, y, mo, d, h, mi, se = '0'] = m;
    return keIsoMYT(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  }
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : keIsoMYT(t + OFFSET_MYT_MS);
  }
  return null;
}

module.exports = {
  UA,
  fetchJson,
  fetchTeks,
  haversineKm,
  tulisJsonAtomik,
  bacaJson,
  umurJam,
  parseMasaMYT,
};

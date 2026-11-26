'use strict';
// Pelayan statik + API kecil tanpa dependensi. Jalankan: node api/_server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* .env tiada: guna nilai lalai */
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Hanya laluan ini boleh dilayan. .env, .git, data/, docs/, api/ tidak pernah didedahkan.
const PUBLIC_FILES = new Set(['/', '/index.html', '/config/app.config.js']);
const PUBLIC_DIRS = ['/src/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const { CSP } = require('../config/security.js');
const cuaca = require('./_services/cuaca.js');
const banjir = require('./_services/banjir.js');
const kualitiUdara = require('./_services/kualiti-udara.js');
const muse = require('./_services/muse.js');
const hargaDb = require('./_services/harga-db.js');
const psi = require('./_services/psi.js');
const amaranDG = require('./_services/amaran-datagov.js');
const gridCuaca = require('./_services/grid-cuaca.js');
const radar = require('./_services/radar.js');
const satelit = require('./_services/satelit.js');
const siklon = require('./_services/siklon.js');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP + "; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function resolvePublic(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (p.includes('\0')) return null;
  const allowed = PUBLIC_FILES.has(p) || PUBLIC_DIRS.some((d) => p.startsWith(d));
  if (!allowed) return null;
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null; // cegah path traversal
  return full;
}

const server = http.createServer((req, res) => {
  applyCors(req, res);
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS')
    return send(
      res,
      204,
      '',
      Object.fromEntries(
        [
          'Access-Control-Allow-Origin',
          'Access-Control-Allow-Methods',
          'Access-Control-Allow-Headers',
          'Access-Control-Max-Age',
          'Vary',
        ]
          .map((h) => [h, res.getHeader(h)])
          .filter(([, v]) => v !== undefined),
      ),
    );
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD, OPTIONS' });

  if (pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ status: 'ok' }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }

  if (pathname === '/api/muse') {
    const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    const minggu = new URL(req.url, 'http://localhost').searchParams.get('minggu');
    if (minggu !== null && !muse.tarikhSah(minggu))
      return send(
        res,
        400,
        JSON.stringify({ ralat: 'Parameter minggu tidak sah; guna format YYYY-MM-DD' }),
        JSON_HDR,
      );
    const cache = muse.bacaCache();
    if (!cache)
      return send(
        res,
        503,
        JSON.stringify({
          ralat: 'Data AI Muse belum tersedia',
          sedangDikemaskini: muse.sedangAmbil(),
        }),
        JSON_HDR,
      );
    return send(
      res,
      200,
      req.method === 'HEAD' ? '' : JSON.stringify(muse.kumpulMinggu(cache, minggu)),
      JSON_HDR,
    );
  }

  if (
    pathname === '/api/harga' ||
    pathname === '/api/harga/ambang' ||
    pathname === '/api/harga/meta'
  ) {
    const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    const kandungan = (status, obj) =>
      send(res, status, req.method === 'HEAD' ? '' : JSON.stringify(obj), JSON_HDR);
    const sah = hargaDb.kira.sahkanParam(new URL(req.url, 'http://localhost').searchParams);
    if (sah.ralat) return kandungan(400, { ralat: sah.ralat });
    const cache = hargaDb.bacaCache();
    if (!cache)
      return kandungan(503, {
        ralat: 'Data harga belum tersedia',
        sedangDikemaskini: hargaDb.sedangAmbil(),
      });
    if (pathname === '/api/harga/meta') return kandungan(200, hargaDb.jawabMeta(cache));
    if (pathname === '/api/harga/ambang') {
      const a = hargaDb.jawabAmbang(cache);
      return a
        ? kandungan(200, a)
        : kandungan(503, {
            ralat: 'Data ambang belum tersedia',
            sedangDikemaskini: hargaDb.sedangAmbil(),
          });
    }
    return kandungan(200, hargaDb.jawabHarga(cache, sah.nilai));
  }

  // Harga Cadangan PSI (BELIAN ladang, JUALAN borong) daripada cache npm run psi:ambil
  if (pathname === '/api/psi') {
    const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    const kandungan = (status, obj) =>
      send(res, status, req.method === 'HEAD' ? '' : JSON.stringify(obj), JSON_HDR);
    const sah = psi.sahkanParam(new URL(req.url, 'http://localhost').searchParams);
    if (sah.ralat) return kandungan(400, { ralat: sah.ralat });
    const cache = psi.bacaCache();
    if (!cache)
      return kandungan(503, {
        ralat: 'Data cadangan PSI belum tersedia (jalankan npm run psi:ambil)',
      });
    return kandungan(200, psi.jawab(cache, sah.nilai));
  }

  if (pathname === '/api/met-malaysia') {
    const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    const cache = amaranDG.bacaCache();
    // Lapisan ini pilihan: tanpa cache, pulangkan 200 kosong (bukan 503) supaya pelayar tidak mencatat ralat.
    if (!cache)
      return send(
        res,
        200,
        JSON.stringify({
          versi: 1,
          fetchedAt: null,
          atribusi: amaranDG.ATRIBUSI,
          sumber: { status: 'belum_tersedia', mesej: '' },
          sedangDikemaskini: amaranDG.sedangAmbil(),
          amaran: [],
        }),
        JSON_HDR,
      );
    const umur = amaranDG.umurJam(cache);
    const met = (cuaca.bacaCache() || {}).amaran || [];
    return send(
      res,
      200,
      req.method === 'HEAD'
        ? ''
        : JSON.stringify({
            ...cache,
            amaran: amaranDG.tandaiPendua(cache.amaran, met),
            umurJam: Number.isFinite(umur) ? umur : null,
          }),
      JSON_HDR,
    );
  }

  if (pathname === '/api/grid/meta' || pathname === '/api/grid' || pathname === '/api/grid/titik') {
    const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    const balas = (status, obj) =>
      send(res, status, req.method === 'HEAD' ? '' : JSON.stringify(obj), JSON_HDR);
    const g = gridCuaca.bacaGrid();
    if (!g)
      return balas(503, {
        ralat: 'Data grid cuaca belum tersedia',
        sedangDikemaskini: gridCuaca.sedangAmbil(),
      });
    if (pathname === '/api/grid/meta') {
      const m = gridCuaca.ringkasMeta(g);
      return balas(200, m);
    }
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (pathname === '/api/grid') {
      const nama = gridCuaca.parsePembolehubah(q.get('var'));
      if (!nama) return balas(400, { ralat: 'Parameter var tidak sah' });
      const jam = gridCuaca.parseJam(q.get('jam'), g.times.length);
      if (Number.isNaN(jam)) return balas(400, { ralat: 'Parameter jam tidak sah' });
      if (!g.vars[nama]) return balas(404, { ralat: 'Data ' + nama + ' tidak tersedia' });
      return balas(200, gridCuaca.ambilVar(g, nama, jam));
    }
    const k = gridCuaca.parseKoordinat(q.get('lat'), q.get('lon'), g.bbox);
    if (!k) return balas(400, { ralat: 'Koordinat tidak sah atau di luar liputan data cuaca' });
    return balas(200, gridCuaca.nilaiTitik(g, k.lat, k.lon));
  }

  if (pathname === '/api/radar' || pathname === '/api/satelit') {
    const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    const [servis, fn, label] =
      pathname === '/api/radar'
        ? [radar, 'ambilRadar', 'radar']
        : [satelit, 'ambilSatelit', 'satelit'];
    return servis[fn]().then(
      (data) => send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(data), JSON_HDR),
      () =>
        send(
          res,
          502,
          JSON.stringify({ ralat: `Data ${label} tidak dapat diambil sekarang` }),
          JSON_HDR,
        ),
    );
  }

  if (pathname === '/api/siklon') {
    const JSON_HDR = { 'Content-Type': 'application/json; charset=utf-8' };
    const cache = siklon.bacaCache();
    // Lapisan pilihan: tanpa cache pulangkan 200 kosong (sama seperti /api/met-malaysia).
    if (!cache)
      return send(
        res,
        200,
        JSON.stringify({
          versi: 1,
          fetchedAt: null,
          atribusi: siklon.ATRIBUSI,
          sumber: { status: 'belum_tersedia', mesej: '' },
          sedangDikemaskini: siklon.sedangAmbil(),
          siklon: [],
        }),
        JSON_HDR,
      );
    const umur = siklon.umurJam(cache);
    return send(
      res,
      200,
      req.method === 'HEAD'
        ? ''
        : JSON.stringify({ ...cache, umurJam: Number.isFinite(umur) ? umur : null }),
      JSON_HDR,
    );
  }

  const API_CACHE = {
    '/api/cuaca': [cuaca, 'cuaca'],
    '/api/banjir': [banjir, 'banjir'],
    '/api/kualiti-udara': [kualitiUdara, 'kualiti udara'],
  };
  if (Object.hasOwn(API_CACHE, pathname)) {
    const [servis, label] = API_CACHE[pathname];
    const cache = servis.bacaCache();
    if (!cache)
      return send(
        res,
        503,
        JSON.stringify({
          ralat: `Data ${label} belum tersedia`,
          sedangDikemaskini: servis.sedangAmbil(),
        }),
        {
          'Content-Type': 'application/json; charset=utf-8',
        },
      );
    const umur = servis.umurJam(cache);
    return send(
      res,
      200,
      req.method === 'HEAD'
        ? ''
        : JSON.stringify({ ...cache, umurJam: Number.isFinite(umur) ? umur : null }),
      { 'Content-Type': 'application/json; charset=utf-8' },
    );
  }

  const file = resolvePublic(pathname);
  if (!file) return send(res, 404, 'Not Found');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not Found');
    send(res, 200, req.method === 'HEAD' ? '' : buf, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    });
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Dashboard: http://${HOST}:${PORT}`);
    cuaca.mulaPenjadual();
    banjir.mulaPenjadual();
    kualitiUdara.mulaPenjadual();
    muse.mulaPenjadual();
    hargaDb.mulaPenjadual();
    amaranDG.mulaPenjadual();
    gridCuaca.mulaPenjadual();
    siklon.mulaPenjadual();
  });
}
module.exports = server;

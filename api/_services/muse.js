'use strict';
// AI Muse: berita komoditi daripada Google Drive (hanya fail db-curated-YYYY-MM-DD.json). GET sahaja dari pelayan.
// Penyenaraian: HTML embeddedfolderview (lalai) atau Drive API v3 jika GOOGLE_API_KEY ditetapkan.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const util = require('./util-rangkaian.js');
const { ekstrakLokasi } = require('./muse-lokasi.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = require('./laluan-data.js');
const CACHE_LALAI = path.join(DATA_DIR, 'muse-curated.json');
const DIR_LALAI = path.join(DATA_DIR, 'muse');
const FOLDER_LALAI = '1wXNm0nG7dUOvNWkepN9ev3BcgwFZEn8M';
const SUMBER = 'AI Muse (db-curated, Google Drive)';
const ATRIBUSI = 'Sumber: ' + SUMBER;
const HARI_MS = 864e5;
const RE_TARIKH = /^\d{4}-\d{2}-\d{2}$/;
const LABEL = {
  'kelapa-tua': 'Kelapa Tua',
  tembikai: 'Tembikai',
  'kacang-panjang': 'Kacang Panjang',
  kubis: 'Kubis',
  terung: 'Terung',
  timun: 'Timun',
  bendi: 'Bendi',
  bayam: 'Bayam',
  kangkung: 'Kangkung',
  sawi: 'Sawi',
  'cili-merah-hijau': 'Cili Merah/Hijau',
  'cili-padi': 'Cili Padi',
  telur: 'Telur',
  ayam: 'Ayam',
  durian: 'Durian',
  bawang: 'Bawang',
  tomato: 'Tomato',
};

function laluanCache() {
  return process.env.MUSE_CACHE_FILE || CACHE_LALAI;
}
function laluanDir() {
  return process.env.MUSE_DIR || DIR_LALAI;
}
function intEnv(nama, lalai) {
  const n = Number(process.env[nama]);
  return Number.isFinite(n) && n > 0 ? n : lalai;
}
function redak(e) {
  return String((e && e.message) || e);
}
function buang(mesej, kunci) {
  return kunci ? String(mesej).split(kunci).join('***') : String(mesej);
}

/* --- Tarikh dan minggu (Isnin-Ahad, MYT) --- */
function tarikhSah(s) {
  if (typeof s !== 'string' || !RE_TARIKH.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function tambahHari(ymd, n) {
  return new Date(Date.parse(ymd + 'T00:00:00Z') + n * HARI_MS).toISOString().slice(0, 10);
}
function mingguMulai(ymd) {
  const hari = (new Date(ymd + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return tambahHari(ymd, -hari);
}
// Instan (ISO berzon atau ms) -> Isnin minggu itu dalam waktu Malaysia.
function mingguMulaiDariMasa(masa) {
  const ms = typeof masa === 'number' ? masa : Date.parse(masa);
  if (!Number.isFinite(ms)) return null;
  return mingguMulai(new Date(ms + 8 * 36e5).toISOString().slice(0, 10));
}
function senaraiMinggu(rekod) {
  return [...new Set(rekod.map((r) => mingguMulai(r.tarikh)))].sort();
}

/* --- Penyenaraian --- */
function nyahEntiti(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
// Pulangan: [{id, nama, jenis:'folder'|'fail', diubahsuai}]
function parseSenaraiHtml(html) {
  const hasil = [];
  const bahagian = String(html)
    .split(/<div class="flip-entry"\s/)
    .slice(1);
  for (const b of bahagian) {
    const id = (b.match(/id="entry-([^"]+)"/) || [])[1];
    const href = (b.match(/<a href="([^"]+)"/) || [])[1] || '';
    const nama = (b.match(/<div class="flip-entry-title">([\s\S]*?)<\/div>/) || [])[1];
    if (!id || nama == null) continue;
    const ubah = (b.match(/<div class="flip-entry-last-modified"><div>([\s\S]*?)<\/div>/) || [])[1];
    hasil.push({
      id,
      nama: nyahEntiti(nama).trim(),
      jenis: /\/folders\//.test(href) ? 'folder' : 'fail',
      diubahsuai: ubah ? nyahEntiti(ubah).trim() : '',
    });
  }
  return hasil;
}
function senaraiApi(json) {
  const fail = json && Array.isArray(json.files) ? json.files : [];
  return fail
    .filter((f) => f && f.id && typeof f.name === 'string')
    .map((f) => ({
      id: f.id,
      nama: f.name,
      jenis: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'fail',
      diubahsuai: f.modifiedTime || '',
    }));
}
// Folder harian sahaja (YYYY-MM-DD sah), dalam tetingkap `mingguan` minggu dari folder terbaharu. Isih menaik.
function pilihFolderHarian(entries, { mingguan = 8 } = {}) {
  const harian = entries
    .filter((e) => e.jenis === 'folder' && tarikhSah(e.nama))
    .map((e) => ({ tarikh: e.nama, id: e.id, diubahsuai: e.diubahsuai }));
  if (!harian.length) return [];
  const terbaru = harian.reduce((m, e) => (e.tarikh > m ? e.tarikh : m), '');
  const potong = tambahHari(terbaru, -(mingguan * 7 - 1));
  return harian.filter((e) => e.tarikh >= potong).sort((a, b) => (a.tarikh < b.tarikh ? -1 : 1));
}

/* --- Pengesahan dan normalisasi --- */
function labelKomoditi(slug) {
  if (LABEL[slug]) return LABEL[slug];
  return String(slug)
    .replace(/-/g, ' ')
    .replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}
// Nombor terhingga; fail lama kadangkala menyimpan nombor sebagai rentetan ("2"), diterima. null/kosong -> null.
function angka(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
// Baris pengisi "tiada data" (band 'tiada data', risiko null): bukan berita, dilangkau dan dikira berasingan.
const TIADA_DATA = Symbol('tiada-data');
// preliminary: boolean, 0/1 atau 'true'/'false' (fail lama); selain itu tidak sah (null).
function awalan(v) {
  if (v == null || v === false || v === 0) return false;
  if (v === true || v === 1) return true;
  if (typeof v === 'string' && /^(true|false)$/i.test(v.trim()))
    return v.trim().toLowerCase() === 'true';
  return null;
}
const BAND = { hijau: 'Hijau', kuning: 'Kuning', merah: 'Merah' };
// Satu rekod mentah -> rekod ternormal atau null jika tidak sah.
function sahkanRekod(raw, { tarikhFail = null, namaFail = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.commodity !== 'string' || !raw.commodity.trim()) return null;
  if (!tarikhSah(raw.date)) return null;
  if (typeof raw.analyst_note !== 'string') return null;
  if (typeof raw.band === 'string' && /^tiada\s+data$/i.test(raw.band.trim())) return TIADA_DATA;
  const band = typeof raw.band === 'string' ? BAND[raw.band.trim().toLowerCase()] : null;
  if (!band) return null;
  const rSebelum = angka(raw.risk_before);
  const rSemasa = angka(raw.risk_current);
  const rHadapan = angka(raw.risk_forward);
  if (rSebelum === null || rSemasa === null || rHadapan === null) return null;
  const longgar = (v) => (v == null ? 0 : angka(v));
  const sentimen = longgar(raw.sentiment_index);
  const sampel = longgar(raw.sample_n);
  const nilaiHarga = angka(raw.price_value);
  if (sentimen === null || sampel === null) return null;
  const awal = awalan(raw.preliminary);
  if (awal === null) return null;
  const id = Number(raw.id);
  const slug = raw.commodity
    .trim()
    .toLowerCase()
    .replace(/[\s/]+/g, '-');
  const nota = raw.analyst_note;
  return {
    id: Number.isFinite(id) ? id : 0,
    kunci: raw.date + '|' + slug,
    tarikh: raw.date,
    komoditiId: slug,
    komoditiLabel: labelKomoditi(slug),
    nota,
    band,
    risikoSebelum: rSebelum,
    risikoSemasa: rSemasa,
    risikoHadapan: rHadapan,
    indeksSentimen: sentimen,
    bilSampel: sampel,
    harga:
      nilaiHarga !== null
        ? {
            nilai: nilaiHarga,
            unit: typeof raw.price_unit === 'string' ? raw.price_unit : '',
            label: typeof raw.price_label === 'string' ? raw.price_label : '',
            tarikh: tarikhSah(raw.price_date) ? raw.price_date : null,
          }
        : null,
    awal,
    lokasi: ekstrakLokasi(nota),
    sumberFail: {
      nama: namaFail || (tarikhFail ? `db-curated-${tarikhFail}.json` : null),
      tarikh: tarikhFail || raw.date,
    },
    sumber: SUMBER,
  };
}
function dedupe(senarai) {
  const peta = new Map();
  for (const r of senarai) {
    const lama = peta.get(r.kunci);
    if (!lama || r.id > lama.id) peta.set(r.kunci, r);
  }
  return [...peta.values()];
}
const urutRekod = (a, b) =>
  a.tarikh < b.tarikh
    ? -1
    : a.tarikh > b.tarikh
      ? 1
      : a.komoditiId < b.komoditiId
        ? -1
        : a.komoditiId > b.komoditiId
          ? 1
          : 0;
// Tatasusunan mentah satu fail -> {rekod, tidakSah}; bukan tatasusunan -> null.
function normalisasiFail(arr, opsyen) {
  if (!Array.isArray(arr)) return null;
  const sah = [];
  let tidakSah = 0;
  let tiadaData = 0;
  arr.forEach((r) => {
    const n = sahkanRekod(r, opsyen);
    if (n === TIADA_DATA) tiadaData++;
    else if (n) sah.push(n);
    else tidakSah++;
  });
  return { rekod: dedupe(sah), tidakSah, tiadaData };
}
function huraiJson(buf) {
  return JSON.parse(
    Buffer.from(buf)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
}

/* --- Rangkaian (http boleh disuntik) --- */
const HTTP_LALAI = {
  async teks(url, opts) {
    const r = await util.fetchTeks(url, opts);
    return { status: r.status, tipe: r.tipe, teks: r.buf.toString('utf8') };
  },
  buf(url, opts) {
    return util.fetchTeks(url, opts);
  },
};
async function denganUlang(fn, { retries = 1, backoffMs = 1500 } = {}) {
  let ralat;
  for (let i = 0; i <= retries; i++) {
    if (i > 0 && backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs));
    try {
      return await fn();
    } catch (e) {
      ralat = e;
    }
  }
  throw ralat;
}
async function kolam(items, n, fn) {
  const hasil = new Array(items.length);
  let i = 0;
  const pekerja = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      hasil[k] = await fn(items[k], k);
    }
  });
  await Promise.all(pekerja);
  return hasil;
}
const OPS_RANGKAIAN = { timeoutMs: 20000, retries: 0 };

async function senaraiFolder(folderId, { http, kunci, ulang }) {
  if (kunci) {
    const semua = [];
    let halaman = '';
    for (let n = 0; n < 20; n++) {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const f = encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime)');
      const url =
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${f}&pageSize=1000&key=${encodeURIComponent(kunci)}` +
        (halaman ? '&pageToken=' + encodeURIComponent(halaman) : '');
      const r = await denganUlang(async () => {
        const res = await http.teks(url, OPS_RANGKAIAN);
        if (res.status !== 200) throw new Error('Drive API HTTP ' + res.status);
        return JSON.parse(res.teks);
      }, ulang);
      semua.push(...senaraiApi(r));
      halaman = r.nextPageToken;
      if (!halaman) break;
    }
    return semua;
  }
  const url = 'https://drive.google.com/embeddedfolderview?id=' + encodeURIComponent(folderId);
  return denganUlang(async () => {
    const res = await http.teks(url, OPS_RANGKAIAN);
    if (res.status !== 200) throw new Error('Senarai folder HTTP ' + res.status);
    return parseSenaraiHtml(res.teks);
  }, ulang);
}

const esHtml = (tipe) => /text\/html/i.test(tipe || '');
// Muat turun satu fail Drive; kendalikan halaman pengesahan. Pulangan: Buffer.
async function muatTurun(id, { http = HTTP_LALAI, kunci = '', ulang } = {}) {
  const ambil = async (url) => {
    const r = await http.buf(url, OPS_RANGKAIAN);
    if (r.status !== 200) throw new Error('Muat turun HTTP ' + r.status);
    return r;
  };
  return denganUlang(async () => {
    if (kunci) {
      const r = await ambil(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&key=${encodeURIComponent(kunci)}`,
      );
      return r.buf;
    }
    let r = await ambil(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`);
    if (!esHtml(r.tipe)) return r.buf;
    const html = r.buf.toString('utf8');
    const form = html.match(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i);
    let url;
    if (form) {
      const u = new URL(nyahEntiti(form[1]));
      for (const m of form[2].matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
        const nama = (m[0].match(/name="([^"]*)"/) || [])[1];
        const nilai = (m[0].match(/value="([^"]*)"/) || [])[1] || '';
        if (nama) u.searchParams.set(nama, nyahEntiti(nilai));
      }
      url = u.toString();
    } else {
      url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
    }
    r = await ambil(url);
    if (esHtml(r.tipe)) throw new Error('Drive memulangkan halaman HTML, bukan fail JSON');
    return r.buf;
  }, ulang);
}

/* --- Cache --- */
function bacaCache() {
  const c = util.bacaJson(laluanCache());
  return c && Array.isArray(c.rekod) ? c : null;
}
const umurJam = util.umurJam;

let sedangAmbilBendera = false;
let pemasa = null;

// Ambil tambahan (incremental). Pulangan {data, ditulis, statistik}.
async function segar(opsyen = {}) {
  const http = opsyen.http || HTTP_LALAI;
  const kunci = opsyen.kunci !== undefined ? opsyen.kunci : process.env.GOOGLE_API_KEY || '';
  const folderId = opsyen.folderId || process.env.MUSE_DRIVE_FOLDER_ID || FOLDER_LALAI;
  const mingguan = opsyen.mingguan || intEnv('MUSE_WEEKS', 8);
  const fCache = opsyen.cacheFile || laluanCache();
  const dir = opsyen.dir || laluanDir();
  const ulang = { retries: 1, backoffMs: opsyen.backoffMs != null ? opsyen.backoffMs : 1500 };
  const sekarang = opsyen.sekarang ? new Date(opsyen.sekarang) : new Date();
  const fManifest = path.join(dir, 'manifest.json');
  sedangAmbilBendera = true;
  try {
    const stat = {
      folder: 0,
      fail: 0,
      unduh: 0,
      dariCache: 0,
      rekod: 0,
      minggu: 0,
      tidakSah: 0,
      tiadaData: 0,
    };
    const lama = util.bacaJson(fCache);
    const lamaSah = lama && Array.isArray(lama.rekod) ? lama : null;
    const gagalSemua = (mesej) => {
      const data = {
        versi: 1,
        fetchedAt: sekarang.toISOString(),
        atribusi: ATRIBUSI,
        latestDate: null,
        status: 'gagal',
        amaran: { rekodTidakSah: 0 },
        folder: [],
        rekod: [],
        mesej,
      };
      return lamaSah
        ? { data: lamaSah, ditulis: false, statistik: stat }
        : { data, ditulis: false, statistik: stat };
    };

    let akar;
    try {
      akar = await senaraiFolder(folderId, { http, kunci, ulang });
    } catch (e) {
      return gagalSemua(buang(redak(e), kunci));
    }
    const folderPilih = pilihFolderHarian(akar, { mingguan });
    if (!folderPilih.length) return gagalSemua('Tiada folder harian ditemui');
    const terbaru = folderPilih[folderPilih.length - 1].tarikh;
    const tepi = tambahHari(terbaru, -1); // dua hari terakhir sentiasa disemak semula

    let manifest = util.bacaJson(fManifest);
    if (!manifest || manifest.versi !== 1 || typeof manifest.folder !== 'object')
      manifest = { versi: 1, folder: {} };

    const proses = async (f) => {
      const nama = `db-curated-${f.tarikh}.json`;
      const fRaw = path.join(dir, nama);
      const rm = manifest.folder[f.tarikh];
      const ada = !!(rm && rm.fail && fs.existsSync(fRaw));
      const baru = f.tarikh >= tepi;
      const info = {
        tarikh: f.tarikh,
        folderId: f.id,
        status: 'ok',
        fail: null,
        bilRekod: 0,
        mesej: '',
      };
      let dilangkau = false;
      let meta = null;
      try {
        if (ada && !baru && rm.folderDiubahsuai === f.diubahsuai && rm.folderId === f.id) {
          dilangkau = true;
          meta = rm.fail;
        } else {
          const isi = await senaraiFolder(f.id, { http, kunci, ulang });
          const fail = isi.find((e) => e.jenis === 'fail' && e.nama === nama);
          if (!fail) {
            info.status = 'tiada-fail';
            delete manifest.folder[f.tarikh];
            return { info };
          }
          const perluMuat =
            !ada || baru || rm.fail.id !== fail.id || rm.fail.diubahsuai !== fail.diubahsuai;
          if (perluMuat) {
            const buf = await muatTurun(fail.id, { http, kunci, ulang });
            const arr = huraiJson(buf);
            if (!Array.isArray(arr)) throw new Error('Fail bukan tatasusunan JSON');
            const sha = crypto.createHash('sha256').update(buf).digest('hex');
            if (!ada || !rm.fail || rm.fail.sha256 !== sha) {
              fs.mkdirSync(dir, { recursive: true });
              const tmp = fRaw + '.tmp';
              fs.writeFileSync(tmp, buf);
              fs.renameSync(tmp, fRaw);
            }
            stat.unduh++;
            meta = {
              id: fail.id,
              nama,
              diubahsuai: fail.diubahsuai,
              sha256: sha,
              bytes: buf.length,
              diambil: sekarang.toISOString(),
            };
          } else {
            meta = rm.fail;
            stat.dariCache++;
          }
          manifest.folder[f.tarikh] = {
            folderId: f.id,
            folderDiubahsuai: f.diubahsuai,
            fail: meta,
          };
        }
      } catch (e) {
        info.status = 'gagal';
        info.mesej = buang(redak(e), kunci);
        // Guna salinan lama (jika ada) supaya data tidak hilang.
        if (!ada) return { info };
      }
      if (dilangkau) {
        info.status = 'dilangkau';
        stat.dariCache++;
      }
      let norm = null;
      try {
        norm = normalisasiFail(huraiJson(fs.readFileSync(fRaw)), {
          tarikhFail: f.tarikh,
          namaFail: nama,
        });
      } catch (e) {
        info.status = 'gagal';
        info.mesej = info.mesej || 'Fail disimpan rosak: ' + redak(e);
        return { info };
      }
      if (!norm) {
        info.status = 'gagal';
        info.mesej = 'Fail bukan tatasusunan JSON';
        return { info };
      }
      info.fail = nama;
      info.bilRekod = norm.rekod.length;
      return { info, rekod: norm.rekod, tidakSah: norm.tidakSah, tiadaData: norm.tiadaData };
    };

    const hasil = await kolam(folderPilih, 2, proses);
    const rekod = dedupe(hasil.flatMap((h) => h.rekod || [])).sort(urutRekod);
    const folder = hasil.map((h) => h.info);
    const bilOk = folder.filter((f) => f.status === 'ok' || f.status === 'dilangkau').length;
    const bilGagal = folder.filter((f) => f.status === 'gagal').length;
    stat.folder = folder.length;
    stat.fail = folder.filter((f) => f.fail).length;
    stat.rekod = rekod.length;
    stat.minggu = senaraiMinggu(rekod).length;
    stat.tidakSah = hasil.reduce((j, h) => j + (h.tidakSah || 0), 0);
    stat.tiadaData = hasil.reduce((j, h) => j + (h.tiadaData || 0), 0);
    if (bilOk === 0 && bilGagal > 0 && lamaSah)
      return { data: lamaSah, ditulis: false, statistik: stat };
    const data = {
      versi: 1,
      fetchedAt: sekarang.toISOString(),
      atribusi: ATRIBUSI,
      latestDate: rekod.length ? rekod[rekod.length - 1].tarikh : null,
      status: bilGagal === 0 ? 'ok' : bilOk > 0 ? 'sebahagian' : 'gagal',
      amaran: { rekodTidakSah: stat.tidakSah, tiadaData: stat.tiadaData },
      folder,
      rekod,
    };
    if (bilOk === 0 && !rekod.length) return { data, ditulis: false, statistik: stat };
    util.tulisJsonAtomik(fManifest, manifest);
    util.tulisJsonAtomik(fCache, data);
    return { data, ditulis: true, statistik: stat };
  } finally {
    sedangAmbilBendera = false;
  }
}

/* --- Badan respons API --- */
// minggu: YYYY-MM-DD sah (disnap ke Isnin) atau tiada (lalai: minggu latestDate).
function kumpulMinggu(cache, minggu, { sekarang = Date.now() } = {}) {
  const tersedia = senaraiMinggu(cache.rekod);
  const mula = minggu
    ? mingguMulai(minggu)
    : cache.latestDate
      ? mingguMulai(cache.latestDate)
      : tersedia[tersedia.length - 1] || mingguMulaiDariMasa(sekarang);
  const akhir = tambahHari(mula, 6);
  const rekod = cache.rekod.filter((r) => r.tarikh >= mula && r.tarikh <= akhir);
  const umur = umurJam(cache, sekarang);
  return {
    versi: 1,
    status: cache.status,
    fetchedAt: cache.fetchedAt,
    umurJam: Number.isFinite(umur) ? umur : null,
    latestDate: cache.latestDate,
    sumber: SUMBER,
    minggu: mula,
    mingguAkhir: akhir,
    mingguTersedia: tersedia,
    bilRekod: rekod.length,
    rekod,
    folder: cache.folder || [],
    amaran: cache.amaran || { rekodTidakSah: 0 },
  };
}

function mulaPenjadual() {
  if (process.env.MUSE_AUTO === '0') return;
  const jam = intEnv('MUSE_POLL_JAM', 6);
  const semak = async () => {
    if (sedangAmbilBendera) return;
    const c = bacaCache();
    if (c && umurJam(c) < jam) return;
    try {
      await segar();
      console.log('Data AI Muse dikemas kini.');
    } catch (e) {
      console.warn('Gagal mengemas kini data AI Muse: ' + redak(e));
    }
  };
  semak();
  if (!pemasa) {
    pemasa = setInterval(semak, jam * 36e5);
    pemasa.unref();
  }
}

module.exports = {
  SUMBER,
  FOLDER_LALAI,
  parseSenaraiHtml,
  senaraiApi,
  pilihFolderHarian,
  sahkanRekod,
  normalisasiFail,
  labelKomoditi,
  tarikhSah,
  tambahHari,
  mingguMulai,
  mingguMulaiDariMasa,
  senaraiMinggu,
  kumpulMinggu,
  muatTurun,
  segar,
  bacaCache,
  umurJam,
  laluanCache,
  mulaPenjadual,
  sedangAmbil: () => sedangAmbilBendera,
};

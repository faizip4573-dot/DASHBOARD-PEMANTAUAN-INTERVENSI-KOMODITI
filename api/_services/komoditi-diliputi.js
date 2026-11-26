'use strict';
// Senarai putih komoditi (Jenis) dan varieti yang diliputi kedua-dua dashboard. Satu sumber: config/komoditi-diliputi.json.
// Pelayan menapis semua jawapan /api/harga* dengan senarai ini dan menghantarnya kepada pelanggan melalui /api/harga/meta.
const fs = require('node:fs');
const path = require('node:path');

const FAIL_LALAI = path.resolve(__dirname, '..', '..', 'config', 'komoditi-diliputi.json');
const norm = (s) => (s == null ? '' : String(s).toUpperCase().replace(/\s+/g, ' ').trim());

// mentah = kandungan JSON. Pulangan: {jenis, pasangan, padan(commodityDb, varietiDb), cari(jenis, varieti)}.
function bina(mentah) {
  if (!mentah || !Array.isArray(mentah.pasangan) || !mentah.pasangan.length)
    throw new Error('komoditi-diliputi: "pasangan" mesti tatasusunan tidak kosong');
  const labelJenis = new Map((mentah.jenis || []).map((j) => [norm(j.kod), j.label]));
  const pasangan = [];
  const tepat = new Map();
  const ternorm = new Map();
  const kenal = new Set();
  for (const p of mentah.pasangan) {
    const jenis = norm(p && p.jenis);
    const variety = norm(p && p.variety);
    if (!jenis || !variety)
      throw new Error('komoditi-diliputi: setiap pasangan perlu jenis dan variety');
    const k = jenis + '|' + variety;
    if (kenal.has(k)) throw new Error('komoditi-diliputi: pasangan berulang ' + k);
    kenal.add(k);
    const e = Object.freeze({
      jenis,
      jenisLabel: labelJenis.get(jenis) || jenis,
      commodity: norm(p.commodity) || jenis,
      variety,
      label: p.label || variety,
      tiadaData: p.tiadaData === true,
    });
    pasangan.push(e);
    for (const [peta, kunci] of [
      [tepat, String(p.variety)],
      [ternorm, variety],
    ]) {
      if (!peta.has(kunci)) peta.set(kunci, []);
      peta.get(kunci).push(e);
    }
  }
  const jenis = [...new Set(pasangan.map((p) => p.jenis))]
    .sort((a, b) => a.localeCompare(b, 'ms'))
    .map((kod) => ({ kod, label: labelJenis.get(kod) || kod }));
  // Padan mengikut varieti dahulu (tepat, kemudian huruf besar dan ruang dinormalkan). Jika DB menamakan commodity
  // lain, pasangan tetap dipadan (dipetakan kepada jenis pengguna); jika varieti sama wujud di bawah beberapa jenis,
  // commodity DB menentukan.
  function padan(commodityDb, varietiDb) {
    const calon = tepat.get(String(varietiDb)) || ternorm.get(norm(varietiDb));
    if (!calon) return null;
    if (calon.length === 1) return calon[0];
    const c = norm(commodityDb);
    return calon.find((x) => x.commodity === c || x.jenis === c) || null;
  }
  const cari = (jenisKod, varieti) =>
    pasangan.find((p) => p.jenis === norm(jenisKod) && p.variety === norm(varieti)) || null;
  return { versi: mentah.versi || 1, jenis, pasangan, padan, cari };
}

let memo = null;
// Muat (dan cache mengikut masa ubah fail). Env KOMODITI_DILIPUTI_FILE menggantikan laluan lalai (untuk ujian).
function muat(fail) {
  const f = fail || process.env.KOMODITI_DILIPUTI_FILE || FAIL_LALAI;
  const st = fs.statSync(f);
  if (memo && memo.f === f && memo.mtime === st.mtimeMs && memo.size === st.size) return memo.data;
  const data = bina(JSON.parse(fs.readFileSync(f, 'utf8')));
  memo = { f, mtime: st.mtimeMs, size: st.size, data };
  return data;
}

module.exports = { bina, muat, norm, FAIL_LALAI };

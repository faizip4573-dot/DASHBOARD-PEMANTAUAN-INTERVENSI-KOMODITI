'use strict';
// Fungsi Vercel tunggal untuk semua /api/* (vercel.json menghala /api/(.*) ke sini).
// Cache data JSON dibina oleh GitHub Actions (.github/workflows/vercel-deploy.yml) ke api/_data dan dimuat naik
// bersama deployment. Sistem fail Vercel hanya boleh dibaca, jadi cache disalin ke /tmp/data semasa cold start
// supaya perkhidmatan boleh membaca (dan, jika perlu, menulis semula) fail itu.
const fs = require('node:fs');
const path = require('node:path');

const SUMBER = path.join(__dirname, '_data');
const TMP = path.join(require('node:os').tmpdir(), 'data');
if (!process.env.DATA_DIR) {
  try {
    if (fs.existsSync(SUMBER) && !fs.existsSync(path.join(TMP, '.sedia'))) {
      fs.cpSync(SUMBER, TMP, { recursive: true });
      fs.writeFileSync(path.join(TMP, '.sedia'), new Date().toISOString());
    }
    process.env.DATA_DIR = TMP;
  } catch (e) {
    console.warn('Cache data tidak dapat disalin ke /tmp: ' + (e && e.message));
    process.env.DATA_DIR = SUMBER;
  }
}

// api/_server.js mengeksport http.Server; pengendali permintaannya dipanggil terus. Penjadual tidak dimulakan
// (hanya bila server.js dijalankan dengan npm start).
const server = require('./_server.js');
module.exports = (req, res) => server.emit('request', req, res);

'use strict';
// Satu muat semula grid cuaca Open-Meteo (ramalan + ombak). Jalankan: npm run grid:ambil
// Jangan jalankan berulang: setiap muat semula menggunakan ~1046 daripada had percuma 10 000 unit/hari.
const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* .env tiada */
}
const grid = require('../api/_services/grid-cuaca.js');
grid
  .segar()
  .then((r) => {
    if (r.dilangkau) {
      console.log('Dilangkau: ' + r.sebab);
      return;
    }
    console.log(`Titik grid: ${r.titik}`);
    console.log(`Jam setiap pembolehubah: ${r.jam}`);
    console.log(`Permintaan HTTP: ${r.permintaan}`);
    console.log(`Kos (unit Open-Meteo): ${r.kos}`);
    console.log(`Ombak: ${r.ombak}`);
    console.log(`Saiz cache: ${r.saizBait} bait (${(r.saizBait / 1048576).toFixed(2)} MB)`);
    const g = grid.bacaGrid();
    console.log(`Masa pertama: ${g.times[0]}, terakhir: ${g.times[g.times.length - 1]}`);
  })
  .catch((e) => {
    console.error('Gagal: ' + e.message);
    process.exitCode = 1;
  });

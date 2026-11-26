'use strict';
// Cache grid cuaca sintetik tetapi deterministik untuk ujian API dan frontend (bukan data sebenar).
// Susun atur sama dengan api/_services/grid-cuaca.js: [jam][baris][lajur], baris 0 = lat 0.5, lajur 0 = lon 99.5.
const fs = require('node:fs');
const path = require('node:path');
const grid = require('../../api/_services/grid-cuaca.js');

const NX = 41;
const NY = 15;

// Garis pantai ringkas: darat = Semenanjung (lajur 0-8) dan Borneo (lajur 22-31, baris 2-7). Selainnya laut.
// 184 sel darat (431 sel laut daripada 615), sama dengan bilangan titik laut sebenar pada 0.5 deg.
const adaLaut = (col, row) =>
  !(col <= 7 || (col === 8 && row <= 3) || (col >= 22 && col <= 31 && row >= 2 && row <= 7));

function medan(nama, h, col, row) {
  const had = (v, a, b) => Math.max(a, Math.min(b, v));
  const pusat = (h * 0.5) % NX;
  const jarak = Math.hypot(col - pusat, (row - 7) * 1.5);
  const hujan = Math.max(0, 9 - jarak);
  switch (nama) {
    case 'temperature_2m':
      return 22 + 0.2 * col + 0.5 * (h % 6) + 0.1 * row;
    case 'wind_speed_10m':
      return had(15 + 10 * Math.sin(col / 6 + h / 8) + 8 * Math.cos(row / 3), 0, 90);
    case 'wind_direction_10m':
      return (h * 10 + col * 5 + row * 3) % 360;
    case 'wind_gusts_10m':
      return had(medan('wind_speed_10m', h, col, row) * 1.5, 0, 140);
    case 'cloud_cover':
      return Math.round(had(50 + 50 * Math.sin(col / 5 + row / 4 + h / 10), 0, 100));
    case 'precipitation':
      return +hujan.toFixed(1);
    case 'rain':
      return +(hujan * 0.8).toFixed(1);
    case 'showers':
      return +(hujan * 0.2).toFixed(1);
    case 'weather_code':
      return hujan > 7.5 ? 96 : hujan > 6 ? 95 : hujan > 2 ? 63 : 1;
    case 'cape':
      return Math.round(200 + hujan * 330);
    case 'wave_height':
      return adaLaut(col, row)
        ? +(0.5 + 0.5 * Math.sin(col / 4 + h / 6) + (0.3 * row) / 14 + 0.5).toFixed(2)
        : null;
    case 'wave_direction':
      return adaLaut(col, row) ? (200 + h) % 360 : null;
    case 'wave_period':
      return adaLaut(col, row) ? +(6 + Math.sin(h / 5)).toFixed(1) : null;
    default:
      throw new Error('var tidak diketahui ' + nama);
  }
}

// opsyen: {dir, bilJam=96, mula=Date (jam 0 UTC), fetchedAt, ombak='ok'|'gagal'|'tiada', tulisLaut=true}
function buatGrid(opsyen = {}) {
  const bilJam = opsyen.bilJam || 96;
  const mula = opsyen.mula ? new Date(opsyen.mula) : new Date();
  mula.setUTCHours(0, 0, 0, 0);
  const times = [];
  for (let h = 0; h < bilJam; h++)
    times.push(new Date(mula.getTime() + h * 36e5).toISOString().slice(0, 16) + 'Z');
  const ombak = opsyen.ombak || 'ok';
  const nama = grid.VAR_RAMALAN.concat(ombak === 'ok' ? grid.VAR_OMBAK : []);
  const vars = {};
  nama.forEach((n) => {
    const [unit, skala] = grid.UNIT[n];
    const arr = new Int16Array(bilJam * NX * NY);
    for (let h = 0; h < bilJam; h++)
      for (let r = 0; r < NY; r++)
        for (let c = 0; c < NX; c++)
          arr[h * NX * NY + r * NX + c] = grid.kuantisasi(medan(n, h, c, r), skala);
    vars[n] = { unit, skala, data: grid.kePangkalan64(arr) };
  });
  const obj = {
    versi: 1,
    fetchedAt: opsyen.fetchedAt || new Date().toISOString(),
    resDeg: 0.5,
    bbox: grid.BBOX,
    nx: NX,
    ny: NY,
    times,
    sumber: { forecast: 'ok', ombak },
    vars,
  };
  if (opsyen.dir) {
    fs.mkdirSync(opsyen.dir, { recursive: true });
    fs.writeFileSync(path.join(opsyen.dir, 'grid.json'), JSON.stringify(obj));
    if (opsyen.tulisLaut !== false) {
      const indeks = [];
      for (let r = 0; r < NY; r++)
        for (let c = 0; c < NX; c++) if (adaLaut(c, r)) indeks.push(r * NX + c);
      fs.writeFileSync(
        path.join(opsyen.dir, 'laut.json'),
        JSON.stringify({ kunci: grid.kunciLaut(0.5, grid.BBOX), indeks }),
      );
    }
  }
  return obj;
}

module.exports = { buatGrid, medan, adaLaut, NX, NY };

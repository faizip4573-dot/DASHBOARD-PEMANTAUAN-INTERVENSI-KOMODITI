'use strict';
// Ambil data kualiti udara (IPU, JAS MyEQMS) dan tulis cache. Jalankan: npm run ipu:ambil
const { segar } = require('../api/_services/kualiti-udara.js');

const baris = (nama, s) => `${nama}: ${s.status}${s.mesej ? ' - ' + s.mesej : ''}`;

segar()
  .then(({ data, ditulis }) => {
    const s = data.sumber;
    console.log(`fetchedAt: ${data.fetchedAt}`);
    console.log(baris('Lapisan peta', s.stesenPeta));
    console.log(baris('IPU per jam', s.jam));
    const band = {};
    data.stesen.forEach((x) => (band[x.band] = (band[x.band] || 0) + 1));
    console.log(`Stesen: ${data.stesen.length} ${JSON.stringify(band)}`);
    console.log(
      `PO: ${data.po.length}, tiada data: ${data.po.filter((p) => p.api == null).length}`,
    );
    if (!ditulis) console.log('Semua sumber gagal: cache lama dikekalkan.');
    process.exitCode = ditulis ? 0 : 1;
  })
  .catch((e) => {
    console.error('Gagal: ' + e.message);
    process.exitCode = 1;
  });

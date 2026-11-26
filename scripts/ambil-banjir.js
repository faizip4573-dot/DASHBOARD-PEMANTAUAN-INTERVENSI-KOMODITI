'use strict';
// Ambil data banjir (JPS Malaysia + JPS Selangor) dan tulis cache. Jalankan: npm run banjir:ambil
const { segar } = require('../api/_services/banjir.js');

const baris = (nama, s) =>
  `${nama}: ${s.status}${s.bilangan != null ? ' (' + s.bilangan + ')' : ''}${s.mesej ? ' - ' + s.mesej : ''}`;

segar()
  .then(({ data, ditulis }) => {
    const s = data.sumber;
    console.log(`fetchedAt: ${data.fetchedAt}`);
    console.log(baris('JPS nasional', s.jpsNasional));
    console.log(baris('JPS Selangor', s.jpsSelangor));
    console.log(baris('Amaran JPS', s.amaranJps));
    console.log(baris('Sejarah Selangor', s.sejarahSelangor));
    const status = {};
    data.stesen.forEach((x) => (status[x.statusRasmi] = (status[x.statusRasmi] || 0) + 1));
    console.log(`Stesen paras air sah: ${data.stesen.length} ${JSON.stringify(status)}`);
    const risiko = {};
    data.po.forEach((p) => (risiko[p.risikoBanjir] = (risiko[p.risikoBanjir] || 0) + 1));
    console.log(`PO: ${data.po.length} ${JSON.stringify(risiko)}, senario: ${data.senario.length}`);
    if (!ditulis) console.log('Semua sumber gagal: cache lama dikekalkan.');
    process.exitCode = ditulis ? 0 : 1;
  })
  .catch((e) => {
    console.error('Gagal: ' + e.message);
    process.exitCode = 1;
  });

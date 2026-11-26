'use strict';
// Ambil data cuaca (MET Malaysia + Open-Meteo) dan tulis cache. Jalankan: npm run cuaca:ambil
const { segar } = require('../api/_services/cuaca.js');

segar()
  .then(({ data, ditulis }) => {
    const s = data.sumber;
    console.log(`fetchedAt: ${data.fetchedAt}`);
    console.log(`MET ramalan: ${s.met.status}${s.met.mesej ? ' (' + s.met.mesej + ')' : ''}`);
    console.log(
      `MET amaran: ${s.metAmaran.status}${s.metAmaran.mesej ? ' (' + s.metAmaran.mesej + ')' : ''}`,
    );
    console.log(
      `Open-Meteo: ${s.openMeteo.status}${s.openMeteo.mesej ? ' (' + s.openMeteo.mesej + ')' : ''}`,
    );
    console.log(
      `Negeri: ${data.negeri.length}, PO: ${data.po.length}, amaran aktif: ${data.amaran.length}, senario: ${data.senario.length}`,
    );
    if (!ditulis) console.log('Semua sumber gagal: cache lama dikekalkan.');
    process.exitCode = ditulis ? 0 : 1;
  })
  .catch((e) => {
    console.error('Gagal: ' + e.message);
    process.exitCode = 1;
  });

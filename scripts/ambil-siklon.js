'use strict';
// Ambil siklon tropika aktif (GDACS) dan tulis cache. Jalankan: npm run siklon:ambil
const { segar } = require('../api/_services/siklon.js');
segar()
  .then(({ data, ditulis }) => {
    console.log(`fetchedAt: ${data.fetchedAt}`);
    console.log(
      `Status sumber: ${data.sumber.status}${data.sumber.mesej ? ' (' + data.sumber.mesej + ')' : ''}`,
    );
    console.log(`Siklon aktif dalam rantau (90-140E, 15S-25N): ${data.siklon.length}`);
    data.siklon.forEach((s) =>
      console.log(
        `  ${s.nama} ${s.aras} ${s.kategori} ${s.anginKmj} km/j pos ${s.pos.join(',')} jejak lalu ${s.jejakLalu.length} ramalan ${s.jejakRamalan.length}`,
      ),
    );
    if (!ditulis) console.log('Tiada data baharu ditulis: cache lama dikekalkan.');
    process.exitCode = ditulis ? 0 : 1;
  })
  .catch((e) => {
    console.error('Gagal: ' + e.message);
    process.exitCode = 1;
  });

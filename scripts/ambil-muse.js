'use strict';
// Ambil berita AI Muse (Google Drive, db-curated) secara tokokan dan tulis cache. Jalankan: npm run muse:ambil
const { segar } = require('../api/_services/muse.js');
segar()
  .then(({ data, ditulis, statistik: s }) => {
    const bil = (st) => data.folder.filter((f) => f.status === st).length;
    console.log(`fetchedAt: ${data.fetchedAt}`);
    console.log(
      `Folder: ${s.folder} (ok ${bil('ok')}, dilangkau ${bil('dilangkau')}, tiada fail ${bil('tiada-fail')}, gagal ${bil('gagal')})`,
    );
    console.log(
      `Fail db-curated: ${s.fail}, dimuat turun: ${s.unduh}, daripada cache: ${s.dariCache}`,
    );
    console.log(
      `Rekod: ${s.rekod}, tidak sah: ${s.tidakSah}, baris tiada data (dilangkau): ${s.tiadaData}, minggu: ${s.minggu}`,
    );
    console.log(`Tarikh data terakhir: ${data.latestDate || '-'}, status: ${data.status}`);
    data.folder
      .filter((f) => f.status === 'gagal')
      .forEach((f) => console.log(`  Gagal ${f.tarikh}: ${f.mesej}`));
    if (!ditulis) console.log('Tiada data baharu ditulis: cache lama dikekalkan (jika ada).');
    process.exitCode = ditulis ? 0 : 1;
  })
  .catch((e) => {
    console.error('Gagal: ' + e.message);
    process.exitCode = 1;
  });

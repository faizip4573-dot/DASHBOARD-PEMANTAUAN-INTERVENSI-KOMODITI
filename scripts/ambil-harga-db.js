'use strict';
// Ambil harga sebenar (DB Harga, Supabase) secara tokokan dan tulis cache. Jalankan: npm run harga:ambil
// Memuat .env sendiri kerana skrip ini tidak melalui api/_server.js. Kunci dan URL tidak pernah dicetak.
const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // tiada .env: guna pemboleh ubah persekitaran sedia ada
}
const hargaDb = require('../api/_services/harga-db.js');

const nombor = (n) => Number(n).toLocaleString('en-US');
hargaDb
  .segar()
  .then((r) => {
    if (!r.ditulis) {
      console.error('Tiada data baharu ditulis: ' + r.mesej);
      process.exitCode = 1;
      return;
    }
    const m = r.meta;
    console.log(`Disegarkan: ${m.disegarPada}, status: ${m.status}`);
    for (const [jadual, p] of hargaDb.JADUAL) {
      const k = m.kiraan[p];
      console.log(
        `${jadual}: ${nombor(k.diambil)} baris diambil, ${nombor(k.entri)} entri harian, ${nombor(k.kunci)} kunci, ${k.hari} hari, terkini ${m.tarikhTerkini[p] || '-'}`,
      );
    }
    const c = hargaDb.bacaCache();
    const t = hargaDb.taburanStatus(c);
    for (const [mod, x] of Object.entries(t))
      console.log(
        `Status ${mod === 'pengeluar' ? 'Pengeluar (LADANG)' : 'Pengguna (RUNCIT)'} aras PO: ${x.jumlah} kunci (merah ${x.merah}, kuning ${x.kuning}, hijau ${x.hijau}, kelabu ${x.kelabu})`,
      );
    const d = m.dikecualikan;
    console.log(`Baris dikecualikan: ${d.id} (id env), ${d.tiadaRujukan} (varieti tanpa rujukan)`);
    d.contoh
      .slice(0, 5)
      .forEach((x) => console.log(`  ${x.id} ${x.commodity} / ${x.variety} ${x.tarikh}`));
    console.log(`Daerah tidak ditugaskan: ${m.tidakDitugaskan.length} kombinasi`);
    m.tidakDitugaskan
      .slice(0, 10)
      .forEach((x) => console.log(`  ${x.negeri} / ${x.daerah || '-'}: ${x.bil} entri`));
    console.log(`Daerah PO tidak padan dalam data: ${m.daerahTakPadan.length}`);
    m.daerahTakPadan.forEach((x) => console.log(`  ${x.po}: ${x.daerah}`));
    if (m.ambang)
      console.log(
        `Ambang: ${m.ambang.baris} baris, bilangan_rekod tidak ditemui: ${m.ambang.bilanganTiadaDitemui}, asas ${JSON.stringify(m.ambang.asas)}`,
      );
    if (m.mesej) console.log('Amaran: ' + m.mesej);
    process.exitCode = 0;
  })
  .catch((e) => {
    console.error('Gagal: ' + e.message);
    process.exitCode = 1;
  });

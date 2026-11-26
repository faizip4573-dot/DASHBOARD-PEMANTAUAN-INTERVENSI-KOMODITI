'use strict';
// Fixture /api/muse deterministik (tiada rangkaian). Mengklon 5 rekod db-curated sebenar (tests/fixtures/muse)
// merentas tarikh melalui fungsi pengesahan sebenar.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const muse = require('../../api/_services/muse.js');
const DIR = path.join(__dirname, '..', 'fixtures', 'muse');
const bacaFixture = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
const julat = (a, b) => {
  const h = [];
  for (let d = a; d <= b; d = muse.tambahHari(d, 1)) h.push(d);
  return h;
};
// opsyen: hari (senarai YYYY-MM-DD; lalai 2026-11-02..2026-11-17), umurJam, status
function buatFixtureMuse(opsyen = {}) {
  const { hari = julat('2026-11-02', '2026-11-17'), umurJam = 0, status = 'ok' } = opsyen;
  const mentah = bacaFixture('db-curated-2026-11-15.json');
  const rekod = [];
  let id = 1000;
  hari.forEach((tarikh) => {
    const nama = `db-curated-${tarikh}.json`;
    const { rekod: r } = muse.normalisasiFail(
      mentah.map((m) => ({ ...m, id: id++, date: tarikh })),
      { tarikhFail: tarikh, namaFail: nama },
    );
    rekod.push(...r);
  });
  rekod.sort((a, b) =>
    a.tarikh === b.tarikh ? a.komoditiId.localeCompare(b.komoditiId) : a.tarikh < b.tarikh ? -1 : 1,
  );
  return {
    versi: 1,
    fetchedAt: new Date(Date.now() - umurJam * 36e5).toISOString(),
    atribusi: 'Sumber: ' + muse.SUMBER,
    latestDate: rekod.length ? rekod[rekod.length - 1].tarikh : null,
    status,
    amaran: { rekodTidakSah: 0, tiadaData: 0 },
    folder: hari.map((t) => ({
      tarikh: t,
      folderId: 'F-' + t,
      status: 'ok',
      fail: `db-curated-${t}.json`,
      bilRekod: mentah.length,
      mesej: '',
    })),
    rekod,
  };
}
function pasangCacheMuse(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'muse-')), 'muse.json');
  fs.writeFileSync(f, JSON.stringify(obj || buatFixtureMuse()));
  process.env.MUSE_CACHE_FILE = f;
  return f;
}
module.exports = { buatFixtureMuse, pasangCacheMuse, bacaFixture, julat };

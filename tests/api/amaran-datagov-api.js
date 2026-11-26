'use strict';
// Ujian unit amaran cuaca data.gov.my (normalisasi sampel sebenar, tahap, dedupe dengan amaran MET) dan /api/met-malaysia.
// Tiada rangkaian luar. Jalankan dari root: node tests/api/amaran-datagov-api.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const dg = require('../../api/_services/amaran-datagov.js');
const { buatFixture, pasangCache } = require('../helpers/cuaca-fixture.js');
const { pasangCacheAmaranDG } = require('../helpers/banjir-fixture.js');
const MENTAH = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'met-datagov-amaran.json'), 'utf8'),
);
function get(base, p) {
  return new Promise((resolve, reject) => {
    http
      .get(base + p, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      })
      .on('error', reject);
  });
}

(async () => {
  const gagal = [];
  const ok = async (nama, fn) => {
    try {
      await fn();
    } catch (e) {
      gagal.push(nama + ' -> ' + e.message);
    }
  };
  const n = dg.normalisasi(MENTAH);

  await ok('"Tiada Nasihat" dibuang; medan sampel sebenar dinormalkan', () => {
    assert.strictEqual(MENTAH.length, 5);
    assert.strictEqual(n.length, 4);
    assert.ok(!n.some((a) => /tiada nasihat/i.test(a.tajuk)));
    const hujan = n.find((a) => /HUJAN BERTERUSAN/.test(a.tajuk));
    assert.strictEqual(hujan.tahap, 'WASPADA');
    assert.strictEqual(hujan.dikeluarkan, '2026-11-15T14:00:00+08:00');
    assert.strictEqual(hujan.sah_dari, '2026-11-15T00:00:00+08:00');
    assert.strictEqual(hujan.sah_hingga, '2026-11-17T23:59:59+08:00');
    assert.deepStrictEqual(hujan.negeri, ['Terengganu']);
    assert.match(hujan.teks, /^Hujan berterusan dijangka/);
  });
  await ok('terbaharu dahulu', () => {
    const t = n.map((a) => Date.parse(a.dikeluarkan));
    assert.deepStrictEqual(
      t,
      t.slice().sort((x, y) => y - x),
    );
  });
  await ok('ribut petir menyenaraikan banyak negeri (Pulau Pinang tidak tercicir)', () => {
    const r = n.find((a) => /RIBUT PETIR/.test(a.tajuk));
    ['Perlis', 'Kedah', 'Selangor', 'Kuala Lumpur', 'Sabah', 'Sarawak', 'Labuan'].forEach((s) =>
      assert.ok(r.negeri.includes(s), s),
    );
    assert.strictEqual(r.tahap, 'UMUM');
  });
  await ok('laut bergelora kategori pertama = WASPADA; id unik', () => {
    const l = n.filter((a) => /LAUT BERGELORA/.test(a.tajuk));
    assert.strictEqual(l.length, 2);
    l.forEach((a) => assert.strictEqual(a.tahap, 'WASPADA'));
    assert.strictEqual(new Set(n.map((a) => a.id)).size, n.length);
  });
  await ok('input bukan tatasusunan / rekod rosak tidak melempar', () => {
    assert.deepStrictEqual(dg.normalisasi(null), []);
    assert.deepStrictEqual(dg.normalisasi({}), []);
    assert.deepStrictEqual(dg.normalisasi([null, 1, {}, { warning_issue: {} }]), []);
  });

  // Dedupe dengan amaran MET (api.met.gov.my): bentuk sama seperti cuaca.js (tajuk, negeri, dikeluarkan)
  const hujan = n.find((a) => /HUJAN BERTERUSAN/.test(a.tajuk));
  const metSama = {
    tajuk: 'AMARAN HUJAN BERTERUSAN (WASPADA)',
    negeri: ['Terengganu'],
    dikeluarkan: '2026-11-15T14:05:00+08:00',
  };
  await ok('pendua: tajuk + negeri + masa (dalam 60 minit) sama', () => {
    assert.strictEqual(dg.samaDenganMET(hujan, [metSama]), true);
  });
  await ok('bukan pendua: negeri berbeza', () => {
    assert.strictEqual(dg.samaDenganMET(hujan, [{ ...metSama, negeri: ['Kelantan'] }]), false);
  });
  await ok('bukan pendua: masa dikeluarkan jauh berbeza', () => {
    assert.strictEqual(
      dg.samaDenganMET(hujan, [{ ...metSama, dikeluarkan: '2026-11-16T14:00:00+08:00' }]),
      false,
    );
  });
  await ok('bukan pendua: tajuk berbeza; senarai MET kosong', () => {
    assert.strictEqual(
      dg.samaDenganMET(hujan, [{ ...metSama, tajuk: 'AMARAN RIBUT PETIR' }]),
      false,
    );
    assert.strictEqual(dg.samaDenganMET(hujan, []), false);
    assert.strictEqual(dg.samaDenganMET(hujan, undefined), false);
  });
  await ok('tandaiPendua menanda hanya yang sama', () => {
    const t = dg.tandaiPendua(n, [metSama]);
    assert.strictEqual(t.length, n.length);
    assert.deepStrictEqual(
      t.filter((a) => a.pendua).map((a) => a.id),
      [hujan.id],
    );
  });

  // Endpoint
  const server = require('../../api/_server.js');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    pasangCacheAmaranDG(null);
    await ok('tiada cache: 200 kosong (bukan 404/503)', async () => {
      const r = await get(base, '/api/met-malaysia');
      const j = JSON.parse(r.body);
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(j.amaran, []);
      assert.strictEqual(j.sumber.status, 'belum_tersedia');
    });
    const met = buatFixture();
    met.amaran = [metSama];
    pasangCache(met);
    pasangCacheAmaranDG({
      versi: 1,
      fetchedAt: new Date().toISOString(),
      atribusi: dg.ATRIBUSI,
      sumber: { status: 'ok', mesej: '' },
      amaran: n,
    });
    await ok('dengan cache: amaran + pendua + atribusi + umurJam', async () => {
      const r = await get(base, '/api/met-malaysia');
      const j = JSON.parse(r.body);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(j.atribusi, 'MET Malaysia (data.gov.my)');
      assert.strictEqual(j.amaran.length, 4);
      assert.strictEqual(j.amaran.filter((a) => a.pendua).length, 1);
      assert.ok(j.umurJam < 0.1);
    });
    await ok('POST ditolak 405', async () => {
      const s = await new Promise((resolve) => {
        const q = http.request(base + '/api/met-malaysia', { method: 'POST' }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        q.end();
      });
      assert.strictEqual(s, 405);
    });
  } finally {
    server.close();
  }
  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: amaran data.gov.my lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

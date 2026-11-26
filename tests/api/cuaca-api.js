'use strict';
// Ujian API /api/cuaca dan unit bangunSenario/terjemahMET/kiraRisiko. Tiada rangkaian luar.
// Jalankan dari root: node tests/api/cuaca-api.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const cuaca = require('../../api/_services/cuaca.js');
const { buatFixture, pasangCache } = require('../helpers/cuaca-fixture.js');

function get(base, p) {
  return new Promise((resolve, reject) => {
    http
      .get(base + p, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      })
      .on('error', reject);
  });
}

(async () => {
  const gagal = [];
  const ok = (nama, fn) => {
    try {
      fn();
    } catch (e) {
      gagal.push(nama + ': ' + e.message);
    }
  };

  // --- Unit ---
  ok('dedupeAmaran: ikut id atau tajuk+negeri+tarikh, terbaharu dahulu', () => {
    const d = (o) => ({ tajuk: 'T', negeri: ['Johor'], ...o });
    const r = cuaca.dedupeAmaran([
      d({ id: 1, dikeluarkan: '2026-11-10T01:00:00Z' }),
      d({ id: 1, dikeluarkan: '2026-11-10T01:00:00Z' }),
      d({ dikeluarkan: '2026-11-12T01:00:00Z' }),
      d({ dikeluarkan: '2026-11-12T01:00:00Z' }),
      d({ tajuk: 'U', dikeluarkan: '2026-11-11T01:00:00Z' }),
    ]);
    assert.equal(r.length, 3);
    assert.deepEqual(
      r.map((x) => x.dikeluarkan),
      ['2026-11-12T01:00:00Z', '2026-11-11T01:00:00Z', '2026-11-10T01:00:00Z'],
    );
    assert.equal(cuaca.AMBANG.amaranHari, 7);
  });
  ok('kiraRisiko sempadan', () => {
    assert.equal(cuaca.kiraRisiko({ hujanMm: 9.9 }).tahap, 'Rendah');
    assert.equal(cuaca.kiraRisiko({ hujanMm: 10 }).tahap, 'Sederhana');
    assert.equal(cuaca.kiraRisiko({ hujanMm: 29.9 }).tahap, 'Sederhana');
    assert.equal(cuaca.kiraRisiko({ hujanMm: 30 }).tahap, 'Tinggi');
    assert.equal(cuaca.kiraRisiko({ kebarangkalian: 69 }).tahap, 'Rendah');
    assert.equal(cuaca.kiraRisiko({ kebarangkalian: 70 }).tahap, 'Sederhana');
    assert.equal(cuaca.kiraRisiko({ kebarangkalian: 90 }).tahap, 'Sederhana');
    assert.equal(cuaca.kiraRisiko({ kebarangkalian: 90, metBerat: true }).tahap, 'Tinggi');
    assert.equal(cuaca.kiraRisiko({ kebarangkalian: 89, metBerat: true }).tahap, 'Sederhana');
    assert.equal(cuaca.kiraRisiko({ tiupan: 39 }).tahap, 'Rendah');
    assert.equal(cuaca.kiraRisiko({ tiupan: 40 }).tahap, 'Sederhana');
  });
  ok('terjemahMET', () => {
    assert.equal(cuaca.terjemahMET('No Rain'), 'Tiada hujan');
    assert.equal(cuaca.terjemahMET('Thunderstorms'), 'Ribut petir');
    assert.equal(cuaca.terjemahMET('Rain'), 'Hujan');
    assert.equal(cuaca.terjemahMET('Scattered thunderstorms'), 'Ribut petir berselerak');
    assert.equal(cuaca.terjemahMET('Misteri'), 'Misteri');
    assert.equal(cuaca.terjemahMET(''), '');
  });
  ok('wmoKeBM', () => {
    assert.equal(cuaca.wmoKeBM(95).label, 'Ribut petir');
    assert.equal(cuaca.wmoKeBM(65).label, 'Hujan lebat');
    assert.ok(cuaca.wmoKeBM(12345).label);
  });

  const hari = ['2026-11-17', '2026-11-18', '2026-11-19'];
  const sekarang = '2026-11-17T04:00:00.000Z';
  const mkPO = (id, negeri, harian) => ({
    poId: id,
    nama: 'PO ' + id,
    negeri,
    harian: harian.map((h, i) => ({
      tarikh: hari[i],
      hujanMm: 0,
      kebarangkalian: 0,
      tiupanMax: 0,
      ...h,
    })),
  });
  const mkNegeri = (nama, teks) => ({
    negeri: nama,
    tarikh: hari.map((t) => ({ tarikh: t, pagi: teks, tengahHari: teks, malam: teks })),
  });
  ok('bangunSenario kosong', () => {
    assert.deepEqual(cuaca.bangunSenario({ negeri: [], po: [], sekarang }), []);
    const po = [mkPO('a', 'Kedah', [{}, {}, {}])];
    assert.deepEqual(
      cuaca.bangunSenario({ negeri: [mkNegeri('Kedah', 'No Rain')], po, sekarang }),
      [],
    );
  });
  ok('bangunSenario hujan_lebat', () => {
    const po = [mkPO('a', 'Kedah', [{ hujanMm: 35 }, {}, {}]), mkPO('b', 'Perak', [{}, {}, {}])];
    const s = cuaca.bangunSenario({
      negeri: [mkNegeri('Kedah', 'No Rain'), mkNegeri('Perak', 'No Rain')],
      po,
      sekarang,
    });
    assert.equal(s.length, 1);
    assert.equal(s[0].scenarioId, 'S01');
    assert.equal(s[0].warningType, 'hujan_lebat');
    assert.deepEqual(s[0].affectedPOIds, ['a']);
    assert.equal(s[0].riskLevel, 'sederhana');
    assert.equal(s[0].source, 'Open-Meteo');
  });
  ok('bangunSenario ribut_petir (MET + tiupan)', () => {
    const po = [mkPO('a', 'Kedah', [{ tiupanMax: 45 }, {}, {}]), mkPO('b', 'Perak', [{}, {}, {}])];
    const s = cuaca.bangunSenario({
      negeri: [mkNegeri('Kedah', 'Thunderstorms'), mkNegeri('Perak', 'No Rain')],
      po,
      sekarang,
    });
    assert.equal(s.length, 1);
    assert.equal(s[0].warningType, 'ribut_petir');
    assert.deepEqual(s[0].affectedPOIds, ['a']);
    assert.equal(s[0].riskLevel, 'tinggi');
    assert.equal(s[0].source, 'MET Malaysia + Open-Meteo');
  });
  ok('bangunSenario hujan_berterusan + bertindih', () => {
    const lebat = { hujanMm: 35, kebarangkalian: 80 };
    const po = [
      mkPO('a', 'Kedah', [lebat, { hujanMm: 5, kebarangkalian: 80 }, {}]),
      mkPO('b', 'Perak', [
        { hujanMm: 5, kebarangkalian: 80 },
        { hujanMm: 5, kebarangkalian: 80 },
        {},
      ]),
    ];
    const negeri = [mkNegeri('Kedah', 'No Rain'), mkNegeri('Perak', 'No Rain')];
    const s = cuaca.bangunSenario({ negeri, po, sekarang });
    assert.deepEqual(
      s.map((x) => x.warningType),
      ['hujan_lebat', 'hujan_berterusan'],
    );
    assert.deepEqual(
      s.map((x) => x.scenarioId),
      ['S01', 'S02'],
    );
    const bertindih = s[0].affectedPOIds.filter((id) => s[1].affectedPOIds.includes(id));
    assert.deepEqual(bertindih, ['a']);
    assert.deepEqual(s[1].affectedPOIds, ['a', 'b']);
  });
  ok('bangunSenario tiada banjir dan deterministik', () => {
    const f = buatFixture();
    const input = { negeri: f.negeri, po: f.po, sekarang };
    const a = JSON.stringify(cuaca.bangunSenario(input));
    const b = JSON.stringify(cuaca.bangunSenario(input));
    assert.equal(a, b);
    assert.ok(!/amaran_banjir/.test(a));
    assert.ok(!/JPS/.test(a));
  });

  // --- API ---
  const server = require('../../api/_server.js');
  const fixtureFile = pasangCache();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await get(base, '/api/cuaca');
    ok('/api/cuaca 200 JSON', () => {
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /application\/json/);
      const j = JSON.parse(r.body);
      assert.ok(j.sumber && j.sumber.met && j.sumber.openMeteo);
      assert.ok(Array.isArray(j.negeri) && j.negeri.length === 13);
      assert.ok(Array.isArray(j.po) && j.po.length === 15);
      assert.ok(Array.isArray(j.senario) && j.senario.length >= 1);
      assert.ok(typeof j.umurJam === 'number');
    });
    ok('tiada token dalam respons', () => {
      const token = process.env.MET_API_TOKEN;
      if (token) assert.ok(!r.body.includes(token), 'token bocor');
      assert.ok(!/METToken/i.test(r.body));
    });
    const d = await get(base, '/data/processed/cuaca-terkini.json');
    ok('/data/processed 404', () => assert.equal(d.status, 404));
    const p = await get(base, '/api/cuaca?segar=1');
    ok('?segar=1 tidak mencetus apa-apa (baca cache sahaja)', () => {
      assert.equal(p.status, 200);
    });
    const m = await new Promise((resolve, reject) => {
      const req = http.request(base + '/api/cuaca', { method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    ok('POST ditolak 405', () => assert.equal(m, 405));

    fs.unlinkSync(fixtureFile);
    const tiada = await get(base, '/api/cuaca');
    ok('cache tiada -> 503', () => {
      assert.equal(tiada.status, 503);
      assert.ok(JSON.parse(tiada.body).ralat);
    });
  } finally {
    server.close();
    fs.rmSync(path.dirname(fixtureFile), { recursive: true, force: true });
  }

  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian API cuaca lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

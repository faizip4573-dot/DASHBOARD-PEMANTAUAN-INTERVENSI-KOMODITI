'use strict';
// Ujian titik akhir /api/harga, /api/harga/meta, /api/harga/ambang (cache fixture, tiada rangkaian).
// Jalankan dari root: node --no-warnings tests/api/harga-db-api.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pasangCacheHarga } = require('../helpers/banjir-fixture.js');

const KUNCI = 'KUNCI-RAHSIA-PALSU-XYZ-987';
const URL_PALSU = 'https://rahsia-palsu.example';

function get(base, p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}
const json = (r) => JSON.parse(r.body);

(async () => {
  process.env.DB_HARGA_URL = URL_PALSU;
  process.env.DB_HARGA_PUBLISHABLE_KEY = KUNCI;
  pasangCacheHarga();
  const log = [];
  const asalLog = { log: console.log, warn: console.warn, error: console.error };
  ['log', 'warn', 'error'].forEach((k) => {
    console[k] = (...a) => {
      log.push(a.join(' '));
      asalLog[k](...a);
    };
  });
  const server = require('../../api/_server.js');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const semuaBadan = [];
  const dapat = async (p, method) => {
    const r = await get(base, p, method);
    semuaBadan.push(r.body + JSON.stringify(r.headers));
    return r;
  };
  const gagal = [];
  const ok = async (nama, fn) => {
    try {
      await fn();
      console.log('ok   ' + nama);
    } catch (e) {
      gagal.push(nama);
      console.log(
        'GAGAL ' +
          nama +
          '\n     ' +
          String((e && e.stack) || e)
            .split('\n')
            .slice(0, 4)
            .join('\n     '),
      );
    }
  };
  try {
    await ok('GET /api/harga: kepala, baris dan status mengikut peraturan', async () => {
      const r = await dapat(
        '/api/harga?peringkat=RUNCIT&variety=CILI%20MERAH%20KULAI%20%2F%20KULAI%20HIBRID&aras=po',
      );
      assert.strictEqual(r.status, 200);
      assert.match(r.headers['content-type'], /application\/json/);
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      const d = json(r);
      assert.deepStrictEqual(
        [d.tarikhTerkini, d.lapuk, d.aras, d.bilangan, d.mingguSemasaSeparaIso],
        ['2026-11-04', false, 'po', 15, '2026-W45'],
      );
      assert.ok(d.disegarPada);
      const s = Object.fromEntries(d.baris.map((b) => [b.po, b]));
      assert.strictEqual(s.selangor.status, 'merah');
      assert.strictEqual(s.kedah.status, 'kuning');
      assert.strictEqual(s.melaka.status, 'hijau');
      assert.strictEqual(s.kelantan.status, 'kelabu');
      const b = s.selangor;
      for (const k of [
        'peringkat',
        'aras',
        'negeri',
        'po',
        'daerah',
        'commodity',
        'variety',
        'unit',
        'harga',
        'hargaSebelum',
        'pctMinggu',
        'rmMinggu',
        'minggu',
        'status',
        'sebab',
        'asas',
        'mean',
        'sd',
        'lantai',
        'siling',
        'ganti',
      ])
        assert.ok(k in b, 'medan ' + k);
      assert.strictEqual(b.minggu.iso, '2026-W44');
    });
    await ok(
      'GET /api/harga: tanpa peringkat memulangkan ketiga-tiga peringkat; penapis huruf kecil',
      async () => {
        const d = json(await dapat('/api/harga?commodity=cili&negeri=selangor&aras=negeri'));
        assert.deepStrictEqual(
          [...new Set(d.baris.map((b) => b.peringkat))],
          ['BORONG', 'LADANG', 'RUNCIT'],
        );
        assert.ok(d.baris.every((b) => b.negeri === 'SELANGOR' && b.commodity === 'CILI'));
      },
    );
    await ok(
      'GET /api/harga: aras=po_tambahan guna daerah FIS (Puchong = Klang + Petaling)',
      async () => {
        const q = '/api/harga?peringkat=RUNCIT&variety=CILI%20MERAH%20KULAI%20%2F%20KULAI%20HIBRID';
        const d = json(await dapat(q + '&aras=po_tambahan'));
        assert.strictEqual(d.aras, 'po_tambahan');
        const ids = d.baris.map((b) => b.po);
        assert.ok(ids.includes('tbh-puchong') && ids.includes('tbh-pasar-tani-borong-selayang'));
        assert.ok(ids.every((id) => id.startsWith('tbh-')));
        assert.ok(d.baris.every((b) => b.daerah === null));
        // 15 PO utama tidak berubah bilangan; PO tambahan tidak bocor ke aras po
        const u = json(await dapat(q + '&aras=po'));
        assert.ok(u.baris.every((b) => !String(b.po).startsWith('tbh-')));
        // penapis po tambahan pada aras daerah memulangkan daerah PO itu sahaja
        const dd = json(await dapat(q + '&aras=daerah&po=tbh-puchong'));
        assert.deepStrictEqual(dd.baris.map((b) => b.daerah).sort(), ['KLANG', 'PETALING']);
        assert.strictEqual((await dapat('/api/harga?po=tbh-tiada')).status, 400);
      },
    );
    await ok('GET /api/harga: mod=pengeluar memberi ganti borong; bulan dan minggu', async () => {
      const g = json(await dapat('/api/harga?mod=pengeluar&commodity=BAWANG&aras=po'));
      assert.strictEqual(g.baris.length, 15);
      assert.ok(
        g.baris.every(
          (b) =>
            b.ganti && b.ganti.peringkat === 'BORONG' && b.status === 'kelabu' && b.harga === null,
        ),
      );
      const o = json(
        await dapat(
          '/api/harga?peringkat=RUNCIT&variety=CILI%20MERAH%20KULAI%20%2F%20KULAI%20HIBRID&bulan=2026-10&po=selangor',
        ),
      );
      assert.strictEqual(o.baris[0].minggu.iso, '2026-W43');
      const m = json(
        await dapat(
          '/api/harga?peringkat=RUNCIT&variety=CILI%20MERAH%20KULAI%20%2F%20KULAI%20HIBRID&minggu=2026-11-04&po=selangor',
        ),
      );
      assert.strictEqual(m.baris[0].minggu.separa, true);
      assert.strictEqual(m.baris[0].status, 'kelabu');
    });
    await ok('GET /api/harga siri=1: titik harian dan ambang', async () => {
      const d = json(
        await dapat(
          '/api/harga?siri=1&peringkat=RUNCIT&commodity=CILI&variety=CILI%20MERAH%20KULAI%20%2F%20KULAI%20HIBRID&po=selangor',
        ),
      );
      assert.strictEqual(d.siri.titik.length, 17);
      assert.deepStrictEqual(
        [d.siri.mean, d.siri.sd, d.siri.lantai, d.siri.siling, d.siri.asas],
        [10, 1, 7, 12, 2025],
      );
      assert.strictEqual(d.baris, undefined);
    });
    await ok('GET /api/harga/meta: penapis, kiraan, daerah dan lapuk', async () => {
      const d = json(await dapat('/api/harga/meta'));
      assert.strictEqual(d.tarikhTerkini, '2026-11-04');
      assert.strictEqual(d.lapuk, false);
      assert.deepStrictEqual(d.penapis.bulan, ['2026-10', '2026-11']);
      assert.strictEqual(d.penapis.po.length, 15);
      assert.ok(d.penapis.po.every((p) => p.id && p.nama && p.negeri));
      assert.ok(d.penapis.komoditi.includes('CILI'));
      assert.ok(d.penapis.varieti.CILI.includes('CILI MERAH KULAI / KULAI HIBRID'));
      assert.strictEqual(d.dikecualikan.id, 5);
      assert.ok(d.tidakDitugaskan.some((x) => x.negeri === 'KUALA LUMPUR' && x.daerah === 'BATU'));
      assert.ok(!d.tidakDitugaskan.some((x) => x.daerah === 'PETALING'));
      assert.ok(Array.isArray(d.daerahTakPadan));
      // PO utama dan tambahan mengikut pemetaan FIS 2.1 (config/pemetaan-po-fis.json)
      const dpo = (id) => d.penapis.po.find((p) => p.id === id).daerah;
      assert.strictEqual(d.penapis.po.length, 15);
      assert.ok(dpo('selangor').includes('PUTRAJAYA/PUTRAJAYA'));
      assert.ok(dpo('simpangrenggam').includes('JOHOR/BATU PAHAT'));
      assert.ok(dpo('sabah').includes('LABUAN/LABUAN'));
      assert.ok(!dpo('perak').includes('PERAK/KINTA'));
      assert.strictEqual(d.penapis.poTambahan.length, 25);
      const puchong = d.penapis.poTambahan.find((p) => p.id === 'tbh-puchong').daerah;
      assert.deepStrictEqual(puchong.sort(), ['SELANGOR/KLANG', 'SELANGOR/PETALING']);
      assert.ok(d.kiraan.RUNCIT.entri > 0);
      process.env.HARGA_SEKARANG = '2026-11-21T00:00:00.000Z';
      try {
        assert.strictEqual(json(await dapat('/api/harga/meta')).lapuk, true);
        assert.strictEqual(json(await dapat('/api/harga?peringkat=RUNCIT&po=perlis')).lapuk, true);
      } finally {
        process.env.HARGA_SEKARANG = '2026-11-06T00:00:00.000Z';
      }
    });
    await ok(
      'senarai putih: /api/harga hanya pasangan diliputi; meta 17 komoditi dan 58 varieti',
      async () => {
        const s = JSON.parse(
          fs.readFileSync(
            path.join(__dirname, '..', '..', 'config', 'komoditi-diliputi.json'),
            'utf8',
          ),
        );
        const ada = new Set(s.pasangan.map((p) => p.jenis + '|' + p.variety));
        const d = json(await dapat('/api/harga?aras=negeri'));
        assert.ok(d.baris.length > 0);
        assert.ok(d.baris.every((b) => ada.has(b.commodity + '|' + b.variety)));
        assert.ok(!d.baris.some((b) => /UJIAN|IKAN KEMBUNG/.test(b.variety + b.commodity)));
        // varieti di luar senarai ditapis walau diminta terus
        const luar = json(await dapat('/api/harga?variety=VARIETI%20UJIAN%20TUNGGAL&aras=negeri'));
        assert.strictEqual(luar.baris.length, 0);
        const m = json(await dapat('/api/harga/meta'));
        assert.strictEqual(m.penapis.komoditi.length, 17);
        assert.deepStrictEqual(
          m.penapis.komoditi,
          [...new Set(s.pasangan.map((p) => p.jenis))].sort((a, b) => a.localeCompare(b, 'ms')),
        );
        assert.strictEqual(Object.values(m.penapis.varieti).flat().length, 58);
        assert.strictEqual(m.penapis.varieti.CILI.length, 8);
        const tiada = m.penapis.komoditiSenarai
          .flatMap((k) => k.varieti)
          .filter((v) => v.tiadaData);
        assert.deepStrictEqual(tiada.map((v) => v.kod).sort(), [
          'PISANG RAJA',
          'TEMBIKAI KUNING TANPA BIJI',
          'TIMUN SUSU',
        ]);
        const a = json(await dapat('/api/harga/ambang'));
        assert.ok(a.baris.every((b) => ada.has(b.commodity + '|' + b.variety)));
      },
    );
    await ok('GET /api/harga/ambang: baris ambang dan HEAD', async () => {
      const d = json(await dapat('/api/harga/ambang'));
      assert.strictEqual(d.baris.length, 181);
      const b = d.baris.find(
        (x) =>
          x.variety === 'CILI MERAH KULAI / KULAI HIBRID' &&
          x.peringkat === 'RUNCIT' &&
          x.negeri === 'SELANGOR',
      );
      assert.deepStrictEqual(
        [b.mean, b.sd, b.lantai, b.siling, b.asas, b.bilangan, b.perubahan.unit],
        [10, 1, 7, 12, 2025, 40, '%'],
      );
      assert.strictEqual(d.kiraan.bilanganTiadaDitemui, 1);
      const h = await dapat('/api/harga/meta', 'HEAD');
      assert.strictEqual(h.status, 200);
      assert.strictEqual(h.body.replace(/\{.*\}$/, ''), '');
    });
    await ok('400 untuk parameter tidak sah', async () => {
      for (const q of [
        'aras=zon',
        'peringkat=XX',
        'mod=lain',
        'po=tiada',
        'bulan=2026-13',
        'bulan=Nov',
        'minggu=2026-02-30',
        'siri=1',
        'negeri=%3Cscript%3E',
        'ganjil=1',
      ]) {
        const r = await dapat('/api/harga?' + q);
        assert.strictEqual(r.status, 400, q);
        assert.ok(json(r).ralat, q);
      }
      assert.strictEqual((await dapat('/api/harga/meta?aras=zon')).status, 400);
    });
    await ok('405 untuk kaedah selain GET/HEAD', async () => {
      assert.strictEqual((await dapat('/api/harga', 'POST')).status, 405);
    });
    await ok(
      '503 tanpa cache; /api/harga tanpa ambang masih 200 (semua kelabu) dan /ambang 503',
      async () => {
        const fixture = pasangCacheHarga({ tiada: true });
        try {
          for (const p of ['/api/harga', '/api/harga/meta', '/api/harga/ambang']) {
            const r = await dapat(p);
            assert.strictEqual(r.status, 503, p);
            assert.strictEqual(json(r).sedangDikemaskini, false);
            assert.ok(json(r).ralat);
          }
          // hanya ambang tiada
          const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harga-api-'));
          const asal = pasangCacheHarga();
          process.env.HARGA_AMBANG_FILE = path.join(tmp, 'tiada.json');
          const r = await dapat(
            '/api/harga?peringkat=RUNCIT&variety=CILI%20MERAH%20KULAI%20%2F%20KULAI%20HIBRID&po=selangor',
          );
          assert.strictEqual(r.status, 200);
          assert.deepStrictEqual(
            [json(r).baris[0].status, json(r).baris[0].sebab],
            ['kelabu', 'Tiada ambang'],
          );
          assert.strictEqual((await dapat('/api/harga/ambang')).status, 503);
          assert.ok(asal.ringkas && fixture.ringkas);
          fs.rmSync(tmp, { recursive: true, force: true });
        } finally {
          pasangCacheHarga();
        }
      },
    );
    await ok('tiada kunci atau URL dalam sebarang respons atau log', async () => {
      await dapat('/api/harga?peringkat=RUNCIT');
      assert.ok(semuaBadan.length > 10);
      for (const b of semuaBadan) {
        assert.ok(!b.includes(KUNCI), 'kunci bocor dalam respons');
        assert.ok(!b.includes(URL_PALSU) && !b.includes('rahsia-palsu'), 'URL bocor dalam respons');
      }
      for (const l of log)
        assert.ok(!l.includes(KUNCI) && !l.includes('rahsia-palsu'), 'bocor dalam log');
      const fail = ['harga-ringkas.json', 'harga-ambang.json', 'harga-meta.json'].map((n) =>
        fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'harga-db', n), 'utf8'),
      );
      fail.forEach((t) => assert.ok(!t.includes('supabase') && !t.includes('sb_publishable')));
    });
  } finally {
    Object.assign(console, asalLog);
    server.close();
  }
  console.log(
    gagal.length
      ? `\n${gagal.length} ujian harga-db-api GAGAL`
      : '\nSemua ujian harga-db-api lulus',
  );
  if (gagal.length) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

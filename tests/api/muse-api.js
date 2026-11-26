'use strict';
// Ujian AI Muse (Google Drive db-curated): penyenaraian, tokokan, pengesahan, minggu MYT, lokasi, endpoint.
// Tiada rangkaian luar (http disuntik). Jalankan dari root: node tests/api/muse-api.js
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const muse = require('../../api/_services/muse.js');
const { ekstrakLokasi, muatDaerahPO } = require('../../api/_services/muse-lokasi.js');
const {
  buatFixtureMuse,
  pasangCacheMuse,
  bacaFixture,
  julat,
} = require('../helpers/muse-fixture.js');
const DIR = path.join(__dirname, '..', 'fixtures', 'muse');
const html = (n) => fs.readFileSync(path.join(DIR, n), 'utf8');

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
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'muse-ujian-'));

// Dunia Drive palsu: folder harian + satu fail db-curated setiap hari. Merekod semua permintaan.
function buatDunia(hari, { kandungan } = {}) {
  const mentah = bacaFixture('db-curated-2026-11-15.json');
  const dunia = {
    log: [],
    aktif: 0,
    maksAktif: 0,
    akarGagal: false,
    gagalSekali: new Set(),
    gagalSelalu: new Set(),
    confirm: false,
    hari: {},
  };
  hari.forEach((t, i) => {
    dunia.hari[t] = {
      ubah: 'Nov ' + (i + 1),
      folderUbah: 'Nov ' + (i + 1),
      buf: Buffer.from(
        JSON.stringify(kandungan ? kandungan(t) : mentah.map((m) => ({ ...m, date: t }))),
      ),
    };
  });
  const ent = (id, nama, folder, ubah) =>
    `<div class="flip-entry" id="entry-${id}"><div class="flip-entry-info"><a href="https://drive.google.com/${folder ? 'drive/folders/' + id : 'file/d/' + id + '/view'}"><div class="flip-entry-title">${nama}</div></a></div><div class="flip-entry-last-modified"><div>${ubah}</div></div></div>`;
  async function lapor(fn) {
    dunia.aktif++;
    dunia.maksAktif = Math.max(dunia.maksAktif, dunia.aktif);
    try {
      await tidur(5);
      return await fn();
    } finally {
      dunia.aktif--;
    }
  }
  dunia.http = {
    teks: (url) =>
      lapor(async () => {
        dunia.log.push(url);
        const api = url.match(/googleapis\.com\/drive\/v3\/files\?q=([^&]+)/);
        const m = url.match(/embeddedfolderview\?id=([^&]+)/);
        const idFolder = m
          ? decodeURIComponent(m[1])
          : api
            ? /'([^']+)'/.exec(decodeURIComponent(api[1]))[1]
            : null;
        if (!idFolder) throw new Error('URL tidak dijangka ' + url);
        if (idFolder === 'AKAR') {
          if (dunia.akarGagal) throw new Error('rangkaian terputus');
          const akar = [
            ent('F-HIST', 'Historical', 1, 'Sep 1'),
            ...Object.keys(dunia.hari).map((t) => ent('F-' + t, t, 1, dunia.hari[t].folderUbah)),
          ].join('');
          return api
            ? {
                status: 200,
                tipe: 'application/json',
                teks: JSON.stringify({
                  files: [
                    {
                      id: 'F-HIST',
                      name: 'Historical',
                      mimeType: 'application/vnd.google-apps.folder',
                      modifiedTime: '2026-09-01T00:00:00Z',
                    },
                    ...Object.keys(dunia.hari).map((t) => ({
                      id: 'F-' + t,
                      name: t,
                      mimeType: 'application/vnd.google-apps.folder',
                      modifiedTime: dunia.hari[t].folderUbah,
                    })),
                  ],
                }),
              }
            : { status: 200, tipe: 'text/html', teks: akar };
        }
        const t = idFolder.replace(/^F-/, '');
        const h = dunia.hari[t];
        if (!h) return { status: 404, tipe: 'text/html', teks: '' };
        if (api)
          return {
            status: 200,
            tipe: 'application/json',
            teks: JSON.stringify({
              files: [
                {
                  id: `FILE-${t}-JSON`,
                  name: `db-curated-${t}.json`,
                  mimeType: 'application/json',
                  modifiedTime: h.ubah,
                },
                {
                  id: `FILE-${t}-CSV`,
                  name: `db-curated-${t}.csv`,
                  mimeType: 'text/csv',
                  modifiedTime: h.ubah,
                },
              ],
            }),
          };
        return {
          status: 200,
          tipe: 'text/html',
          teks: html('folder-harian.html').replaceAll('{{TARIKH}}', t).replaceAll('Nov 15', h.ubah),
        };
      }),
    buf: (url) =>
      lapor(async () => {
        dunia.log.push(url);
        const m = url.match(/[?&]id=(FILE-[^&]+)/) || url.match(/files\/(FILE-[^?]+)\?alt=media/);
        if (!m) throw new Error('URL tidak dijangka ' + url);
        const id = decodeURIComponent(m[1]);
        const t = /^FILE-(\d{4}-\d{2}-\d{2})-JSON$/.exec(id)[1];
        if (dunia.gagalSelalu.has(t)) throw new Error('muat turun gagal');
        if (dunia.gagalSekali.has(t)) {
          dunia.gagalSekali.delete(t);
          throw new Error('gagal sekali');
        }
        if (dunia.confirm && /drive\.google\.com\/uc/.test(url))
          return {
            status: 200,
            tipe: 'text/html; charset=utf-8',
            buf: Buffer.from(
              `<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="${id}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="U-1"></form>`,
            ),
          };
        return { status: 200, tipe: 'application/json', buf: dunia.hari[t].buf };
      }),
  };
  return dunia;
}
const jumlahMuat = (dunia) => dunia.log.filter((u) => /[?&]id=FILE-|alt=media/.test(u)).length;
const opsSegar = (dir, dunia, lebih = {}) => ({
  http: dunia.http,
  kunci: '',
  folderId: 'AKAR',
  dir: path.join(dir, 'muse'),
  cacheFile: path.join(dir, 'muse-curated.json'),
  backoffMs: 0,
  sekarang: '2026-11-17T08:00:00Z',
  ...lebih,
});

(async () => {
  delete process.env.MUSE_AUTO;
  const gagal = [];
  const ok = (nama, fn) => {
    try {
      fn();
    } catch (e) {
      gagal.push(nama + ': ' + e.message);
    }
  };
  const okA = async (nama, fn) => {
    try {
      await fn();
    } catch (e) {
      gagal.push(nama + ': ' + e.message);
    }
  };

  /* --- (a) penyenaraian HTML --- */
  ok('parseSenaraiHtml: id, nama, jenis, tarikh ubah suai, entiti HTML', () => {
    const s = muse.parseSenaraiHtml(html('folder-akar.html'));
    assert.equal(s.length, 8);
    const f = s.find((x) => x.nama === '2026-11-15');
    assert.deepEqual(f, {
      id: 'F-1115',
      nama: '2026-11-15',
      jenis: 'folder',
      diubahsuai: 'Nov 15',
    });
    const fail = s.find((x) => x.jenis === 'fail');
    assert.equal(fail.nama, 'Nota & Rujukan.txt');
    const h = muse.parseSenaraiHtml(
      html('folder-harian.html').replaceAll('{{TARIKH}}', '2026-11-15'),
    );
    assert.equal(h.length, 4);
    assert.ok(h.every((x) => x.jenis === 'fail'));
    assert.equal(h[0].id, 'FILE-2026-11-15-JSON');
    assert.deepEqual(muse.parseSenaraiHtml(''), []);
  });
  ok('senaraiApi: bentuk sama dengan HTML', () => {
    const s = muse.senaraiApi({
      files: [
        {
          id: 'a',
          name: '2026-11-15',
          mimeType: 'application/vnd.google-apps.folder',
          modifiedTime: 'T1',
        },
        {
          id: 'b',
          name: 'db-curated-2026-11-15.json',
          mimeType: 'application/json',
          modifiedTime: 'T2',
        },
      ],
    });
    assert.deepEqual(s, [
      { id: 'a', nama: '2026-11-15', jenis: 'folder', diubahsuai: 'T1' },
      { id: 'b', nama: 'db-curated-2026-11-15.json', jenis: 'fail', diubahsuai: 'T2' },
    ]);
    assert.deepEqual(muse.senaraiApi({}), []);
  });

  /* --- (b) pemilihan folder harian --- */
  ok(
    'pilihFolderHarian: abaikan Historical dan tarikh tidak sah, ikut tetingkap MUSE_WEEKS',
    () => {
      const s = muse.parseSenaraiHtml(html('folder-akar.html'));
      const semua = muse.pilihFolderHarian(s, { mingguan: 8 });
      assert.deepEqual(
        semua.map((x) => x.tarikh),
        ['2026-10-01', '2026-11-13', '2026-11-14', '2026-11-15'],
      );
      const sempit = muse.pilihFolderHarian(s, { mingguan: 1 });
      assert.deepEqual(
        sempit.map((x) => x.tarikh),
        ['2026-11-13', '2026-11-14', '2026-11-15'],
      );
      assert.deepEqual(muse.pilihFolderHarian([], { mingguan: 8 }), []);
    },
  );

  /* --- (e) pengesahan --- */
  ok(
    'normalisasiFail: tidak sah dilangkau dan dikira, pendua ambil id tertinggi, tiada data berasingan',
    () => {
      const r = muse.normalisasiFail(bacaFixture('db-curated-invalid.json'), {
        tarikhFail: '2026-11-15',
      });
      assert.equal(r.tidakSah, 5);
      assert.equal(r.tiadaData, 1);
      assert.deepEqual(r.rekod.map((x) => x.komoditiId).sort(), [
        'ayam',
        'cili-padi',
        'telur',
        'terung',
      ]);
      assert.equal(r.rekod.find((x) => x.komoditiId === 'telur').id, 9011);
      const cp = r.rekod.find((x) => x.komoditiId === 'cili-padi');
      assert.equal(cp.band, 'Merah');
      assert.equal(cp.risikoSemasa, 60);
      assert.equal(cp.harga, null);
      assert.equal(cp.awal, false);
      assert.equal(cp.komoditiLabel, 'Cili Padi');
      assert.equal(muse.normalisasiFail({}, {}), null);
    },
  );
  ok('sahkanRekod: bentuk rekod ternormal', () => {
    const [kt] = bacaFixture('db-curated-2026-11-15.json');
    const r = muse.sahkanRekod(kt, {
      tarikhFail: '2026-11-15',
      namaFail: 'db-curated-2026-11-15.json',
    });
    assert.equal(r.kunci, '2026-11-15|kelapa-tua');
    assert.equal(r.komoditiLabel, 'Kelapa Tua');
    assert.deepEqual(r.harga, {
      nilai: 3.33,
      unit: 'RM/biji',
      label: 'Kelapa biji (ManaMurah)',
      tarikh: '2026-11-02',
    });
    assert.equal(r.band, 'Hijau');
    assert.deepEqual([r.risikoSebelum, r.risikoSemasa, r.risikoHadapan], [24, 20, 22]);
    assert.deepEqual(r.sumberFail, { nama: 'db-curated-2026-11-15.json', tarikh: '2026-11-15' });
    assert.equal(r.sumber, 'AI Muse (db-curated, Google Drive)');
    assert.ok(r.lokasi.some((l) => l.daerah === 'Dungun' && l.negeri === 'Terengganu'));
    assert.equal(muse.sahkanRekod({ ...kt, price_value: null }).harga, null);
    assert.equal(muse.sahkanRekod({ ...kt, band: 'HIJAU' }).band, 'Hijau');
    assert.equal(muse.sahkanRekod({ ...kt, preliminary: 'True' }).awal, true);
    assert.equal(muse.sahkanRekod({ ...kt, preliminary: 'mungkin' }), null);
    assert.equal(muse.sahkanRekod({ ...kt, sentiment_index: null }).indeksSentimen, 0);
    assert.equal(muse.sahkanRekod({ ...kt, sentiment_index: 'x' }), null);
    assert.equal(muse.sahkanRekod({ ...kt, commodity: '  ' }), null);
    assert.equal(muse.sahkanRekod(null), null);
    assert.equal(muse.sahkanRekod([]), null);
  });
  ok('labelKomoditi: kamus dan fallback title-case', () => {
    assert.equal(muse.labelKomoditi('cili-merah-hijau'), 'Cili Merah/Hijau');
    assert.equal(muse.labelKomoditi('bunga-kobis'), 'Bunga Kobis');
  });

  /* --- (f) minggu --- */
  ok('minggu Isnin-Ahad MYT: sempadan Ahad 23:59 / Isnin 00:00, tahun baharu, snap', () => {
    assert.equal(muse.mingguMulaiDariMasa('2026-11-15T15:59:00Z'), '2026-11-09');
    assert.equal(muse.mingguMulaiDariMasa('2026-11-15T16:00:00Z'), '2026-11-16');
    assert.equal(muse.mingguMulaiDariMasa(Date.parse('2026-11-15T23:59:00+08:00')), '2026-11-09');
    assert.equal(muse.mingguMulaiDariMasa('2026-11-16T00:00:00+08:00'), '2026-11-16');
    assert.equal(muse.mingguMulaiDariMasa('rosak'), null);
    assert.equal(muse.mingguMulai('2026-11-16'), '2026-11-16');
    assert.equal(muse.mingguMulai('2026-11-15'), '2026-11-09');
    assert.equal(muse.mingguMulai('2027-01-01'), '2026-12-28');
    assert.equal(muse.mingguMulai('2026-01-01'), '2025-12-29');
    assert.equal(muse.tambahHari('2026-12-31', 1), '2027-01-01');
    assert.ok(muse.tarikhSah('2024-02-29'));
    assert.ok(!muse.tarikhSah('2026-02-29'));
    assert.ok(!muse.tarikhSah('2026-2-9'));
    assert.deepEqual(muse.senaraiMinggu(buatFixtureMuse().rekod), [
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
  });

  /* --- (g) lokasi --- */
  ok('gazetteer: daerah PO dimuat dengan poId', () => {
    const d = muatDaerahPO();
    assert.equal(d.length, 71); // daerah 15 PO utama mengikut pemetaan FIS 2.1
    assert.equal(d.find((x) => x.nama === 'Kluang').poId, 'simpangrenggam');
    assert.equal(d.find((x) => x.nama === 'Pasir Mas').negeri, 'Kelantan');
  });
  ok('ekstrakLokasi: kes daerah dan negeri', () => {
    const s = (t) => ekstrakLokasi(t).map((l) => `${l.negeri}/${l.daerah}/${l.poId}`);
    assert.deepEqual(s('pekebun kelapa Matag Dungun terjejas'), ['Terengganu/Dungun/terengganu']);
    assert.deepEqual(s('Lelong di Setiu 22 Okt'), ['Terengganu/Setiu/null']);
    assert.deepEqual(s('sayur Cameron Highlands naik'), ['Pahang/Cameron Highlands/null']);
    assert.deepEqual(s('harga di Kluang'), ['Johor/Kluang/simpangrenggam']);
    assert.deepEqual(s('pasar Pasir Mas'), ['Kelantan/Pasir Mas/kelantan']);
    assert.deepEqual(s('santan Marang'), ['Terengganu/Marang/terengganu']);
    assert.deepEqual(s('banjir di Selangor'), ['Selangor/null/null']);
    assert.deepEqual(s('Hulu Selangor dan Gombak'), [
      'Selangor/Hulu Selangor/selayang',
      'Selangor/Gombak/selayang',
    ]);
    assert.deepEqual(s('di Kuala Terengganu'), ['Terengganu/Kuala Terengganu/terengganu']);
    assert.deepEqual(s('Johor Bahru'), ['Johor/Johor Bahru/johor']);
    assert.deepEqual(s('Ahli Parlimen Kuching'), ['Sarawak/Kuching/null']);
    assert.deepEqual(s('di Pulau Pinang dan Penang'), ['Pulau Pinang/null/null']);
  });
  ok('ekstrakLokasi: perkataan biasa, negara lain, huruf kecil, had', () => {
    assert.deepEqual(ekstrakLokasi('pekan kecil dekat sini'), []);
    assert.deepEqual(ekstrakLokasi('tanah merah dan yan serta bau'), []);
    const p = ekstrakLokasi('Pekan, Pahang');
    assert.deepEqual(
      p.map((l) => l.daerah),
      ['Pekan'],
    );
    assert.equal(p[0].negeri, 'Pahang');
    assert.equal(p[0].poId, 'pahang');
    assert.deepEqual(ekstrakLokasi('impor Indonesia dan Matag'), []);
    assert.deepEqual(ekstrakLokasi(''), []);
    assert.deepEqual(ekstrakLokasi(null), []);
    assert.ok(ekstrakLokasi('Kangar Arau Kuantan Bentong Kluang Muar Kulim Ipoh').length <= 5);
    assert.deepEqual(ekstrakLokasi('semakin Dungunan'), []);
    assert.ok(ekstrakLokasi('dungun').length === 1);
  });
  ok('lokasi tidak diambil daripada price_label', () => {
    const [kt] = bacaFixture('db-curated-2026-11-15.json');
    const r = muse.sahkanRekod({
      ...kt,
      analyst_note: 'tiada tempat',
      price_label: 'Harga di Kluang',
    });
    assert.deepEqual(r.lokasi, []);
  });

  /* --- (d) halaman pengesahan --- */
  await okA('muatTurun: halaman pengesahan diikuti sekali', async () => {
    const dunia = buatDunia(['2026-11-15']);
    dunia.confirm = true;
    const buf = await muse.muatTurun('FILE-2026-11-15-JSON', {
      http: dunia.http,
      ulang: { retries: 0 },
    });
    assert.ok(Array.isArray(JSON.parse(buf.toString('utf8'))));
    assert.equal(dunia.log.length, 2);
    assert.match(dunia.log[1], /drive\.usercontent\.google\.com\/download\?/);
    assert.match(dunia.log[1], /confirm=t/);
    assert.match(dunia.log[1], /uuid=U-1/);
  });
  await okA(
    'muatTurun: tanpa borang -> URL pengesahan sandaran; HTML berterusan -> ralat',
    async () => {
      const log = [];
      const h1 = {
        buf: async (url) => {
          log.push(url);
          return log.length === 1
            ? { status: 200, tipe: 'text/html', buf: Buffer.from('<html>tiada borang</html>') }
            : { status: 200, tipe: 'application/json', buf: Buffer.from('[]') };
        },
      };
      await muse.muatTurun('XYZ', { http: h1, ulang: { retries: 0 } });
      assert.match(log[1], /usercontent\.google\.com\/download\?id=XYZ&export=download&confirm=t/);
      const h2 = {
        buf: async () => ({ status: 200, tipe: 'text/html', buf: Buffer.from('<html></html>') }),
      };
      await assert.rejects(
        () => muse.muatTurun('XYZ', { http: h2, ulang: { retries: 0 } }),
        /HTML/,
      );
      const h3 = { buf: async () => ({ status: 404, tipe: 'text/html', buf: Buffer.from('') }) };
      await assert.rejects(() => muse.muatTurun('XYZ', { http: h3, ulang: { retries: 0 } }), /404/);
    },
  );

  /* --- (c) tokokan dan manifest --- */
  await okA(
    'segar: tokokan, manifest, hanya db-curated, tiada muat turun semula folder lama',
    async () => {
      const dir = tmp();
      try {
        const hari = julat('2026-11-01', '2026-11-15');
        const dunia = buatDunia(hari);
        const r1 = await muse.segar(opsSegar(dir, dunia));
        assert.equal(r1.ditulis, true);
        assert.equal(r1.statistik.folder, 15);
        assert.equal(r1.statistik.unduh, 15);
        assert.equal(r1.statistik.rekod, 15 * 5);
        assert.equal(r1.statistik.minggu, 3);
        assert.equal(r1.data.latestDate, '2026-11-15');
        assert.equal(r1.data.status, 'ok');
        assert.equal(jumlahMuat(dunia), 15);
        assert.ok(
          dunia.log.every((u) => !/CSV|CLEAN|RAW/.test(u)),
          'hanya db-curated .json diminta',
        );
        const manifest = JSON.parse(
          fs.readFileSync(path.join(dir, 'muse', 'manifest.json'), 'utf8'),
        );
        assert.equal(Object.keys(manifest.folder).length, 15);
        const m15 = manifest.folder['2026-11-15'];
        assert.equal(m15.fail.nama, 'db-curated-2026-11-15.json');
        assert.match(m15.fail.sha256, /^[0-9a-f]{64}$/);
        assert.ok(fs.existsSync(path.join(dir, 'muse', 'db-curated-2026-11-15.json')));
        const cache = JSON.parse(fs.readFileSync(path.join(dir, 'muse-curated.json'), 'utf8'));
        assert.equal(cache.versi, 1);
        assert.equal(cache.rekod.length, 75);
        assert.ok(cache.rekod.every((x, i, a) => !i || a[i - 1].tarikh <= x.tarikh));

        // Larian kedua: hanya dua hari terakhir dimuat turun semula; folder lama tidak disentuh sama sekali.
        dunia.log.length = 0;
        const r2 = await muse.segar(opsSegar(dir, dunia));
        assert.equal(r2.statistik.unduh, 2);
        assert.equal(r2.statistik.dariCache, 13);
        assert.equal(r2.statistik.rekod, 75);
        assert.equal(jumlahMuat(dunia), 2);
        const lama = dunia.log.filter((u) =>
          /F-2026-11-0|FILE-2026-11-0|FILE-2026-11-1[0-2]|F-2026-11-1[0-2]/.test(u),
        );
        assert.deepEqual(lama, [], 'folder lama tidak diminta');
        assert.equal(r2.data.folder.filter((f) => f.status === 'dilangkau').length, 13);
        const m2 = JSON.parse(fs.readFileSync(path.join(dir, 'muse', 'manifest.json'), 'utf8'));
        assert.equal(m2.folder['2026-11-15'].fail.sha256, m15.fail.sha256);

        // Fail lama diubah (teks ubah suai berbeza): dimuat turun semula dan rekod dikemas kini.
        dunia.hari['2026-11-03'].ubah = 'Nov 16';
        dunia.hari['2026-11-03'].folderUbah = 'Nov 16';
        dunia.hari['2026-11-03'].buf = Buffer.from(
          JSON.stringify(
            bacaFixture('db-curated-2026-11-15.json')
              .slice(0, 2)
              .map((m) => ({ ...m, date: '2026-11-03' })),
          ),
        );
        dunia.log.length = 0;
        const r3 = await muse.segar(opsSegar(dir, dunia));
        assert.equal(r3.statistik.unduh, 3);
        assert.equal(r3.statistik.rekod, 75 - 3);
        assert.equal(r3.data.folder.find((f) => f.tarikh === '2026-11-03').bilRekod, 2);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  await okA(
    'segar: satu percubaan semula bagi muat turun gagal, konkurensi maks 2, kunci tidak bocor',
    async () => {
      const dir = tmp();
      try {
        const hari = julat('2026-11-05', '2026-11-12');
        const dunia = buatDunia(hari);
        dunia.gagalSekali.add('2026-11-08');
        const r = await muse.segar(opsSegar(dir, dunia));
        assert.equal(r.data.status, 'ok');
        assert.equal(
          dunia.log.filter((u) => /FILE-2026-11-08-JSON/.test(u)).length,
          2,
          'tepat satu percubaan semula',
        );
        assert.ok(dunia.maksAktif <= 2, 'konkurensi ' + dunia.maksAktif);
        assert.ok(dunia.maksAktif >= 2, 'kolam benar-benar selari');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  await okA(
    'segar: kunci Drive API digunakan, tidak ditulis ke cache/manifest atau mesej ralat',
    async () => {
      const dir = tmp();
      try {
        const dunia = buatDunia(['2026-11-14', '2026-11-15']);
        dunia.gagalSelalu.add('2026-11-14');
        const r = await muse.segar(opsSegar(dir, dunia, { kunci: 'KUNCI-RAHSIA-123' }));
        assert.ok(dunia.log.some((u) => /googleapis\.com\/drive\/v3\/files\?q=/.test(u)));
        assert.ok(
          dunia.log.some((u) =>
            /files\/FILE-2026-11-15-JSON\?alt=media&key=KUNCI-RAHSIA-123/.test(u),
          ),
        );
        assert.equal(r.data.status, 'sebahagian');
        assert.equal(r.data.rekod.length, 5);
        const semua =
          fs.readFileSync(path.join(dir, 'muse-curated.json'), 'utf8') +
          fs.readFileSync(path.join(dir, 'muse', 'manifest.json'), 'utf8') +
          JSON.stringify(r.data);
        assert.ok(!semua.includes('KUNCI-RAHSIA-123'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
  await okA('segar: UTF-8 dan BOM dikekalkan, nombor/pendua dinormal', async () => {
    const dir = tmp();
    try {
      const dunia = buatDunia(['2026-11-15']);
      const isi = JSON.stringify(
        bacaFixture('db-curated-2026-11-15.json').map((m) => ({ ...m, date: '2026-11-15' })),
      );
      dunia.hari['2026-11-15'].buf = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(isi, 'utf8'),
      ]);
      const r = await muse.segar(opsSegar(dir, dunia));
      const tembikai = r.data.rekod.find((x) => x.komoditiId === 'tembikai');
      assert.ok(tembikai.nota.includes('\u2014'), 'tanda sengkang em dikekalkan');
      assert.ok(!/â€/.test(tembikai.nota));
      assert.equal(tembikai.awal, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  await okA(
    'segar: fail bukan tatasusunan -> folder gagal, folder lain kekal (sebahagian)',
    async () => {
      const dir = tmp();
      try {
        const dunia = buatDunia(['2026-11-14', '2026-11-15']);
        dunia.hari['2026-11-14'].buf = Buffer.from('{"bukan":"tatasusunan"}');
        const r = await muse.segar(opsSegar(dir, dunia));
        assert.equal(r.data.status, 'sebahagian');
        assert.equal(r.data.folder.find((f) => f.tarikh === '2026-11-14').status, 'gagal');
        assert.equal(r.data.rekod.length, 5);
        assert.equal(r.ditulis, true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  /* --- (j) semua gagal kekalkan cache lama --- */
  await okA('segar: senarai akar gagal / semua muat turun gagal -> cache lama kekal', async () => {
    const dir = tmp();
    try {
      const hari = ['2026-11-14', '2026-11-15'];
      const dunia = buatDunia(hari);
      await muse.segar(opsSegar(dir, dunia));
      const fCache = path.join(dir, 'muse-curated.json');
      const sebelum = fs.readFileSync(fCache, 'utf8');
      dunia.akarGagal = true;
      const r1 = await muse.segar(opsSegar(dir, dunia, { sekarang: '2026-11-18T08:00:00Z' }));
      assert.equal(r1.ditulis, false);
      assert.equal(fs.readFileSync(fCache, 'utf8'), sebelum);
      // Direktori mentah baharu (tiada salinan) + semua muat turun gagal.
      dunia.akarGagal = false;
      hari.forEach((t) => dunia.gagalSelalu.add(t));
      const r2 = await muse.segar(
        opsSegar(dir, dunia, { dir: path.join(dir, 'kosong'), sekarang: '2026-11-18T08:00:00Z' }),
      );
      assert.equal(r2.ditulis, false);
      assert.equal(fs.readFileSync(fCache, 'utf8'), sebelum);
      assert.equal(r2.data.rekod.length, 10);
      // Tiada cache lama langsung: tiada fail ditulis.
      const dir2 = tmp();
      try {
        const r3 = await muse.segar(opsSegar(dir2, dunia));
        assert.equal(r3.ditulis, false);
        assert.ok(!fs.existsSync(path.join(dir2, 'muse-curated.json')));
      } finally {
        fs.rmSync(dir2, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /* --- (i) penjadual --- */
  await okA('mulaPenjadual: tiada tindakan jika MUSE_AUTO=0 (tiada rangkaian)', async () => {
    process.env.MUSE_AUTO = '0';
    const asal = global.fetch;
    let dipanggil = 0;
    global.fetch = () => {
      dipanggil++;
      return Promise.reject(new Error('rangkaian dilarang dalam ujian'));
    };
    try {
      muse.mulaPenjadual();
      await tidur(20);
      assert.equal(dipanggil, 0);
      assert.equal(muse.sedangAmbil(), false);
    } finally {
      global.fetch = asal;
      delete process.env.MUSE_AUTO;
    }
  });

  /* --- kumpulMinggu --- */
  ok('kumpulMinggu: lalai minggu latestDate, snap, minggu kosong', () => {
    const c = buatFixtureMuse();
    const lalai = muse.kumpulMinggu(c);
    assert.equal(lalai.minggu, '2026-11-16');
    assert.equal(lalai.mingguAkhir, '2026-11-22');
    assert.equal(lalai.bilRekod, 10);
    assert.deepEqual(lalai.mingguTersedia, ['2026-11-02', '2026-11-09', '2026-11-16']);
    assert.equal(muse.kumpulMinggu(c, '2026-11-12').minggu, '2026-11-09');
    assert.equal(muse.kumpulMinggu(c, '2026-11-12').bilRekod, 35);
    const kosong = muse.kumpulMinggu(c, '2026-01-05');
    assert.deepEqual(kosong.rekod, []);
    assert.equal(kosong.bilRekod, 0);
    assert.equal(muse.kumpulMinggu({ ...c, rekod: [], latestDate: null }).rekod.length, 0);
  });

  /* --- (h) endpoint --- */
  const server = require('../../api/_server.js');
  const fixtureFile = pasangCacheMuse();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await get(base, '/api/muse');
    ok('/api/muse 200 JSON minggu lalai dengan bentuk didokumenkan', () => {
      assert.equal(r.status, 200);
      assert.match(r.headers['content-type'], /application\/json/);
      assert.equal(r.headers['cache-control'], 'no-store');
      const j = JSON.parse(r.body);
      assert.equal(j.versi, 1);
      assert.equal(j.status, 'ok');
      assert.equal(j.latestDate, '2026-11-17');
      assert.equal(j.minggu, '2026-11-16');
      assert.equal(j.mingguAkhir, '2026-11-22');
      assert.equal(j.sumber, 'AI Muse (db-curated, Google Drive)');
      assert.deepEqual(j.mingguTersedia, ['2026-11-02', '2026-11-09', '2026-11-16']);
      assert.equal(j.bilRekod, 10);
      assert.equal(j.rekod.length, 10);
      assert.equal(typeof j.umurJam, 'number');
      assert.ok(Array.isArray(j.folder));
      assert.ok(j.amaran);
      const rk = j.rekod[0];
      [
        'id',
        'kunci',
        'tarikh',
        'komoditiId',
        'komoditiLabel',
        'nota',
        'band',
        'risikoSebelum',
        'risikoSemasa',
        'risikoHadapan',
        'indeksSentimen',
        'bilSampel',
        'harga',
        'awal',
        'lokasi',
        'sumberFail',
        'sumber',
      ].forEach((k) => assert.ok(k in rk, 'medan ' + k));
    });
    const w = await get(base, '/api/muse?minggu=2026-11-09');
    ok('?minggu= memilih minggu tepat', () => {
      const j = JSON.parse(w.body);
      assert.equal(j.minggu, '2026-11-09');
      assert.equal(j.bilRekod, 35);
      assert.ok(j.rekod.every((x) => x.tarikh >= '2026-11-09' && x.tarikh <= '2026-11-15'));
    });
    const s = await get(base, '/api/muse?minggu=2026-11-12');
    ok('hari bukan Isnin dipadankan ke Isnin', () => {
      assert.equal(JSON.parse(s.body).minggu, '2026-11-09');
    });
    const k = await get(base, '/api/muse?minggu=2026-01-05');
    ok('minggu tanpa data -> 200 rekod kosong', () => {
      assert.equal(k.status, 200);
      const j = JSON.parse(k.body);
      assert.deepEqual(j.rekod, []);
      assert.equal(j.bilRekod, 0);
    });
    for (const buruk of ['abc', '2026-13-01', '2026-02-30', '2026-1-1', '', '2026-11-09T00:00']) {
      const b = await get(base, '/api/muse?minggu=' + encodeURIComponent(buruk));
      ok(`minggu tidak sah '${buruk}' -> 400`, () => {
        assert.equal(b.status, 400);
        assert.ok(JSON.parse(b.body).ralat);
      });
    }
    const h = await get(base, '/api/muse', 'HEAD');
    ok('HEAD 200 tanpa badan', () => {
      assert.equal(h.status, 200);
      assert.equal(h.body, '');
    });
    const p = await get(base, '/api/muse', 'POST');
    ok('POST ditolak 405', () => assert.equal(p.status, 405));
    fs.unlinkSync(fixtureFile);
    const tiada = await get(base, '/api/muse');
    ok('cache tiada -> 503 dengan sedangDikemaskini', () => {
      assert.equal(tiada.status, 503);
      const j = JSON.parse(tiada.body);
      assert.ok(j.ralat);
      assert.equal(typeof j.sedangDikemaskini, 'boolean');
    });
    const tiada400 = await get(base, '/api/muse?minggu=xx');
    ok('minggu tidak sah diutamakan sebelum semakan cache (400)', () =>
      assert.equal(tiada400.status, 400),
    );
  } finally {
    server.close();
    fs.rmSync(path.dirname(fixtureFile), { recursive: true, force: true });
  }

  console.log(gagal.length ? 'GAGAL:\n' + gagal.join('\n') : 'OK: ujian API AI Muse lulus');
  process.exitCode = gagal.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

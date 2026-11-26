'use strict';
// Fixture /api/cuaca deterministik untuk ujian (tiada rangkaian, tiada token).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cuaca = require('../../api/_services/cuaca.js');

function hariMYT(tambah = 0) {
  const d = new Date(Date.now() + tambah * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
}

// opsyen: umurJam (fetchedAt didahulukan), amaran (true/false), metAmaranStatus, tanpaSenario
function buatFixture(opsyen = {}) {
  const { umurJam = 0, amaran = true, metAmaranStatus = 'ok', tanpaSenario = false } = opsyen;
  const hari = [hariMYT(0), hariMYT(1), hariMYT(2)];
  const sekarang = new Date(Date.now() - umurJam * 36e5);
  const poList = cuaca.muatPO();
  const berat = { kelantan: 55, sarawak: 52, pahang: 40 };
  const po = poList.map((p) => ({
    poId: p.id,
    nama: p.nama,
    negeri: p.negeri,
    semasa: {
      suhu: 27.5,
      kelembapan: 85,
      hujan: 0.2,
      angin: p.id === 'kelantan' ? 9.5 : 8.2,
      tiupan: 22,
      wmoKod: 53,
      keadaan: 'Gerimis',
      ikon: '🌦️',
    },
    harian: hari.map((tarikh, i) => {
      const lebat = berat[p.id] && i === 0;
      const berterusan = ['johor', 'simpangrenggam'].includes(p.id);
      const h = {
        tarikh,
        wmoKod: 3,
        keadaan: 'Mendung',
        hujanMm: lebat ? berat[p.id] : berterusan ? 5 : 2,
        kebarangkalian: berterusan ? 80 : 20,
        anginMax: 12,
        tiupanMax: p.id === 'terengganu' && i === 0 ? 45 : 20,
        suhuMin: 23,
        suhuMax: 31,
      };
      h.risiko = cuaca.kiraRisiko({
        hujanMm: h.hujanMm,
        kebarangkalian: h.kebarangkalian,
        tiupan: h.tiupanMax,
        metBerat: false,
      });
      return h;
    }),
  }));
  const negeri = Object.keys(cuaca.NEGERI_MET).map((nama) => ({
    negeri: nama,
    locationId: cuaca.NEGERI_MET[nama],
    poWakilId: cuaca.NEGERI_WAKIL_PO[nama],
    tarikh: hari.map((tarikh) => ({
      tarikh,
      pagi: 'No Rain',
      tengahHari: 'Isolated rain',
      malam: 'No Rain',
      suhuMax: 31,
      suhuMin: 23,
      pagiMs: 'Tiada hujan',
      tengahHariMs: 'Hujan terpencil',
      malamMs: 'Tiada hujan',
      keadaan: nama === 'Kelantan' ? 'Hujan terpencil' : 'Tiada hujan',
      ikon: nama === 'Kelantan' ? '🌦️' : '🌤️',
    })),
  }));
  const tamat = new Date(Date.now() + 864e5).toISOString();
  return {
    versi: 1,
    fetchedAt: sekarang.toISOString(),
    amaranDiambil: sekarang.toISOString(),
    sumber: {
      met: { status: 'ok', mesej: '' },
      metAmaran: { status: metAmaranStatus, mesej: '' },
      openMeteo: { status: 'ok', mesej: '' },
    },
    negeri,
    po,
    amaran: amaran
      ? [
          {
            jenis: 'ribut_petir',
            tajuk: 'AMARAN RIBUT PETIR',
            teks: 'Ribut petir dan hujan lebat dijangka di negeri Terengganu (Kemaman, Dungun).',
            negeri: ['Terengganu'],
            dikeluarkan: sekarang.toISOString(),
            sah_dari: sekarang.toISOString(),
            sah_hingga: tamat,
            aktif: true,
          },
        ]
      : [],
    senario: tanpaSenario
      ? []
      : cuaca.bangunSenario({ negeri, po, sekarang: sekarang.toISOString() }),
    senarioNota: 'Dijana daripada data cuaca sebenar (anggaran sistem, bukan amaran rasmi)',
    nota: 'Risiko cuaca ialah anggaran sistem, bukan amaran rasmi.',
    atribusi: 'Data cuaca: Open-Meteo.com (CC BY 4.0); MET Malaysia',
  };
}

// Tulis fixture ke fail sementara dan arahkan pelayan membacanya.
function pasangCache(obj) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cuaca-')), 'cuaca.json');
  fs.writeFileSync(f, JSON.stringify(obj || buatFixture()));
  process.env.CUACA_CACHE_FILE = f;
  return f;
}

// Pintas /api/cuaca pada halaman puppeteer. mod: fixture | 503 | abort | fungsi(req) => {status, body}
async function stubCuaca(page, handler) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (!/\/api\/cuaca(\?|$)/.test(req.url())) return req.continue();
    const h = typeof handler === 'function' ? handler() : handler;
    if (h === 'abort') return req.abort('failed');
    if (h && h.status && h.status !== 200)
      return req.respond({
        status: h.status,
        contentType: 'application/json',
        body: JSON.stringify({ ralat: 'tidak tersedia' }),
      });
    return req.respond({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(h && h.body ? h.body : h),
    });
  });
}

module.exports = { buatFixture, pasangCache, stubCuaca, hariMYT };

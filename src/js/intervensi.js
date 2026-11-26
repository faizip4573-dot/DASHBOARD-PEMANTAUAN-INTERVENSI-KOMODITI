(function () {
  'use strict';
  /* ===== Dashboard Intervensi Komoditi: modul data dan logik tulen (ruang nama iv*) ===== */
  const $i = (id) => document.getElementById(id);
  const slug = (s) =>
    String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const f2 = (x) => (fin(x) ? x.toFixed(2) : '—');
  const sgn = (x, d = 2) => (fin(x) ? (x > 0 ? '+' : '') + x.toFixed(d) : '—');
  const rmPos = (x) => (fin(x) && x > 0 ? 'RM ' + x.toFixed(2) : '—');
  const rmAny = (x) => (fin(x) ? 'RM ' + x.toFixed(2) : '—');
  const E = (s) => esc(s);
  function hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const MY_MONTHS = [
    'Januari',
    'Februari',
    'Mac',
    'April',
    'Mei',
    'Jun',
    'Julai',
    'Ogos',
    'September',
    'Oktober',
    'November',
    'Disember',
  ];

  const IV_CONFIG = {
    refNow: '2026-11-15T12:00:00+08:00',
    thresholds: {
      pengeluar: { direction: 'turun', warnPct: -8, critPct: -15, stage: 'Borong' },
      pengguna: { direction: 'naik', warnPct: 8, critPct: 15, stage: 'Runcit' },
    },
    supply: { minSurplusMT: 3, minSurplusRatio: 0.15, shortageCoverage: 0.8, staleHours: 72 },
    detour: 1.3,
    crossZoneRules: [],
    minHistory: 8,
    labelShift: {
      perlis: ['l'],
      kedah: ['l', 0, 6],
      penang: ['l'],
      perak: ['r'],
      selayang: ['l', 0, -8],
      selangor: ['l', 0, -2],
      negerisembilan: ['r', 0, -6],
      melaka: ['l', 0, 6],
      kelantan: ['r'],
      terengganu: ['r'],
      pahang: ['r'],
      johor: ['r', 0, 6],
      simpangrenggam: ['r', 0, -6],
      sabah: ['l'],
      sarawak: ['r'],
    },
  };
  const IV_THR_DEFAULT = JSON.parse(JSON.stringify(IV_CONFIG.thresholds));
  let refNow = IV_CONFIG.refNow;
  const nowMs = () => Date.parse(refNow);
  const myDate = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);
  function addDays(ds, n) {
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function weekStart(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return addDays(ds, -((dow + 6) % 7));
  }
  function weekRange(ws) {
    return [ws, addDays(ws, 6)];
  }
  function fmtDate(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    return d + ' ' + MY_MONTHS[m - 1] + ' ' + y;
  }
  function fmtWeek(ws) {
    const [a, b] = weekRange(ws);
    const [y1, m1, d1] = a.split('-').map(Number),
      [y2, m2, d2] = b.split('-').map(Number);
    return m1 === m2
      ? `${d1} – ${d2} ${MY_MONTHS[m2 - 1]} ${y2}`
      : `${d1} ${MY_MONTHS[m1 - 1]} – ${d2} ${MY_MONTHS[m2 - 1]} ${y2}`;
  }

  /* ===== MODUL DATA: PO (paparan terbitan DATA.po, tiada salinan nilai) ===== */
  const IV_PO = DATA.po.map((p) => ({
    id: p.id,
    name: p.name,
    label: p.label,
    negeri: p.negeri,
    stateId: slug(p.negeri),
    zone: p.negeri === 'Sabah' ? 'Sabah' : p.negeri === 'Sarawak' ? 'Sarawak' : 'Semenanjung',
    lat: p.lat,
    lon: p.lon,
    coordApprox: true,
    group: p.logistikGroup,
    districts: p.districts,
    logistik: p.logistik,
    source: 'sebenar',
    origin: 'DATA.po',
  }));
  const IV_POBY = Object.fromEntries(IV_PO.map((p) => [p.id, p]));
  // PO tambahan (FIS 2.1): calon dan PO terpilih mobilisasi sahaja. Lokasi = titik tengah daerah seliaan (anggaran),
  // tiada data logistik, cuaca atau banjir.
  const IV_TBH = ((typeof DATA !== 'undefined' && DATA.poTambahan) || []).map((p) => ({
    id: p.id,
    name: p.label + ' (PO tambahan)',
    label: p.label,
    negeri: p.negeri,
    stateId: slug(p.negeri),
    lat: p.lat,
    lon: p.lon,
    districts: p.districts,
    tambahan: true,
  }));
  const IV_TBHBY = Object.fromEntries(IV_TBH.map((p) => [p.id, p]));
  const poObj = (id) => IV_POBY[id] || IV_TBHBY[id] || null;
  // Daerah liputan PO (nama dinormalkan) untuk mengecualikan calon yang berkongsi liputan.
  const liputan = (p) => new Set((p.districts || []).map((d) => HARGADB.normDaerah(d[0])));
  const IV_STATES = [...new Map(IV_PO.map((p) => [p.stateId, p.negeri])).entries()].map(
    ([id, name]) => ({ id, name }),
  );
  /* Komoditi Intervensi = pasangan (jenis, varieti) senarai putih config/komoditi-diliputi.json, diterima daripada
     /api/harga/meta (komoditiSenarai) dan diisi oleh ivPasangKomoditi(); tiada salinan senarai di klien.
     DATA.komoditi (dummy) kini hanya sumber bekalan/stok dummy (IV_DUMMY_COMM), dipetakan ke varieti senarai
     melalui IV_BEKALAN_PETA (kunci = id dummy, nilai = nama varieti DB). Varieti tanpa petaan = tiada data bekalan. */
  const IV_COMM = [];
  const IV_COMMBY = {};
  const IV_JENIS = [];
  const IV_DUMMY_COMM = DATA.komoditi.map((k) => ({ id: slug(k.name), unit: k.unit }));
  const IV_BEKALAN_PETA = {
    'cili-merah': 'CILI MERAH KULAI / KULAI HIBRID',
    'cili-hijau': 'CILI HIJAU',
    'tomato-bulat': 'TOMATO (TANAH TINGGI)',
    'bawang-merah-kecil': 'BAWANG MERAH / KECIL (IMPORT)',
    'ayam-proses-super': 'AYAM PROSES STANDARD',
    'kubis-bulat': 'KUBIS BULAT (TANAH TINGGI)',
    'telur-gred-a': 'TELUR AYAM A',
  };
  const IV_BEKALAN_DUMMY = {}; // id varieti -> id dummy
  const IV_DUMMY_PAIR = {}; // id dummy -> id varieti
  Object.keys(IV_BEKALAN_PETA).forEach((d) => {
    IV_BEKALAN_DUMMY[slug(IV_BEKALAN_PETA[d])] = d;
    IV_DUMMY_PAIR[d] = slug(IV_BEKALAN_PETA[d]);
  });
  const IV_LALAI_ID = IV_DUMMY_PAIR['cili-merah']; // komoditi panel lalai (mobilisasi, margin) bila penapis Semua
  IV_COMMBY[IV_LALAI_ID] = {
    id: IV_LALAI_ID,
    name: '\u2014',
    unit: 'RM/kg',
    jenis: '',
    variety: '',
  };
  function ivPasangKomoditi(m) {
    const s = m && m.penapis && m.penapis.komoditiSenarai;
    if (!Array.isArray(s)) return;
    IV_COMM.length = 0;
    IV_JENIS.length = 0;
    Object.keys(IV_COMMBY).forEach((k) => delete IV_COMMBY[k]);
    s.forEach((k) => {
      IV_JENIS.push({ kod: k.kod, label: k.label });
      k.varieti.forEach((v) => {
        const c = {
          id: slug(v.kod),
          name: v.label,
          jenis: k.kod,
          jenisLabel: k.label,
          variety: v.kod,
          tiadaData: !!v.tiadaData,
          unit: 'RM/kg',
          source: 'senarai',
          origin: 'config/komoditi-diliputi.json',
        };
        IV_COMM.push(c);
        IV_COMMBY[c.id] = c;
      });
    });
    if (!IV_COMMBY[IV_LALAI_ID])
      IV_COMMBY[IV_LALAI_ID] = {
        id: IV_LALAI_ID,
        name: '\u2014',
        unit: 'RM/kg',
        jenis: '',
        variety: '',
      };
  }
  const isKg = (cid) => IV_COMMBY[cid] && IV_COMMBY[cid].unit === 'RM/kg';
  // RM dengan unit bukan kg (cth. 'RM 0.45 /biji'); RM/kg dipapar seperti biasa.
  const rmUnit = (x, cid) =>
    rmAny(x) +
    (fin(x) && cid && !isKg(cid) && IV_COMMBY[cid]
      ? ' /' + IV_COMMBY[cid].unit.replace(/^RM\//, '')
      : '');
  const ivEffCid = () => effCommodity().id;

  /* Pemetaan daerah ke PO (dummy, eksplisit) */
  const IV_DISTRICTS = [];
  IV_PO.forEach((p) =>
    p.districts.forEach((d) =>
      IV_DISTRICTS.push({
        districtId: p.stateId + '/' + slug(d[0]),
        name: d[0],
        stateId: p.stateId,
        negeri: p.negeri,
        poId: p.id,
        lat: d[1],
        lon: d[2],
        coordApprox: true,
        mappingStatus: 'dummy-sah',
        source: 'dummy',
        origin: 'DATA.po.districts',
      }),
    ),
  );
  const IV_DISTBY = Object.fromEntries(IV_DISTRICTS.map((d) => [d.districtId, d]));
  const IV_GAZETTEER = [
    { name: 'Dungun', stateId: 'terengganu', negeri: 'Terengganu', lat: 4.76, lon: 103.42 },
    { name: 'Kemaman', stateId: 'terengganu', negeri: 'Terengganu', lat: 4.23, lon: 103.42 },
    { name: 'Besut', stateId: 'terengganu', negeri: 'Terengganu', lat: 5.83, lon: 102.55 },
    { name: 'Cameron Highlands', stateId: 'pahang', negeri: 'Pahang', lat: 4.47, lon: 101.38 },
  ];
  let ivWithheld = {};

  /* Outlet (dummy) */
  const IV_CATS = [
    { id: 'pasar-awam', label: 'Pasar Awam', glyph: 'PA' },
    { id: 'ptk', label: 'PTK', glyph: 'PT' },
    { id: 'rakr', label: 'RAKR', glyph: 'RK' },
    { id: 'agrobazaar', label: 'Agrobazaar', glyph: 'AB' },
  ];
  const IV_CATBY = Object.fromEntries(IV_CATS.map((c) => [c.id, c]));
  const IV_OUTLETS = (function () {
    const out = [];
    const named = {
      'johor/kluang': [
        ['OUT-KLU-01', 'Pasar Awam Kluang', 'pasar-awam'],
        ['OUT-KLU-02', 'Agrobazaar Kluang', 'agrobazaar'],
        ['OUT-KLU-03', 'RAKR Kluang', 'rakr'],
      ],
      'johor/johor-bahru': [
        ['OUT-JHB-01', 'Pasar Awam Larkin', 'pasar-awam'],
        ['OUT-JHB-02', 'PTK Johor Bahru', 'ptk'],
        ['OUT-JHB-03', 'Agrobazaar Johor Bahru', 'agrobazaar'],
      ],
      'kelantan/pasir-mas': [
        ['OUT-PMS-01', 'Pasar Awam Pasir Mas', 'pasar-awam'],
        ['OUT-PMS-02', 'PTK Pasir Mas', 'ptk'],
        ['OUT-PMS-03', 'RAKR Pasir Mas', 'rakr'],
      ],
    };
    const commPool = IV_DUMMY_COMM.filter((c) => c.unit === 'RM/kg').map((c) => c.id);
    const stat = (h) =>
      h % 7 === 0 ? 'Tidak beroperasi' : h % 11 === 0 ? 'Data tidak tersedia' : 'Beroperasi';
    IV_DISTRICTS.forEach((d, i) => {
      if (d.name === 'Jasin' || d.name === 'Jelebu') return;
      const h = hash32(d.districtId);
      let list = named[d.districtId];
      if (!list) {
        const n = 1 + (h % 2);
        list = [];
        for (let k = 0; k < n; k++) {
          const c = IV_CATS[(h + k + i) % 4];
          list.push([
            'OUT-' + slug(d.name).toUpperCase().replace(/-/g, '').slice(0, 5) + '-0' + (k + 1),
            c.label + ' ' + d.name,
            c.id,
          ]);
        }
      }
      list.forEach(([id, nama, kat], k) => {
        const hh = hash32(id);
        const dlat = ((hh % 81) - 40) / 1000,
          dlon = (((hh >>> 8) % 81) - 40) / 1000;
        let kom = [commPool[hh % commPool.length], commPool[(hh + 3) % commPool.length]];
        if (d.districtId === 'johor/kluang' || d.districtId === 'johor/johor-bahru')
          kom = ['cili-merah', kom[0]];
        if (d.districtId === 'kelantan/pasir-mas') kom = ['bawang-merah-kecil', kom[0]];
        out.push({
          outletId: id,
          nama: nama + ' (Contoh)',
          kategori: kat,
          stateId: d.stateId,
          negeri: d.negeri,
          districtId: d.districtId,
          districtName: d.name,
          supervisingPOId: d.poId,
          lat: +(d.lat + dlat).toFixed(4),
          lon: +(d.lon + dlon).toFixed(4),
          coordApprox: true,
          status: named[d.districtId] ? 'Beroperasi' : stat(hh),
          komoditiBerkaitan: [...new Set(kom)],
          assignmentStatus: 'dummy-sah',
          source: 'dummy',
          origin: 'iv',
        });
      });
    });
    [
      ['OUT-KMN-01', 'Pasar Awam Kemaman', 'pasar-awam', IV_GAZETTEER[1]],
      ['OUT-KMN-02', 'RAKR Kemaman', 'rakr', IV_GAZETTEER[1]],
    ].forEach(([id, n, k, g]) =>
      out.push({
        outletId: id,
        nama: n + ' (Contoh)',
        kategori: k,
        stateId: g.stateId,
        negeri: g.negeri,
        districtId: g.stateId + '/' + slug(g.name),
        districtName: g.name,
        supervisingPOId: null,
        lat: g.lat + 0.01,
        lon: g.lon + 0.01,
        coordApprox: true,
        status: 'Data tidak tersedia',
        komoditiBerkaitan: ['cili-merah'],
        assignmentStatus: 'tidak-disahkan',
        source: 'dummy',
        origin: 'iv',
      }),
    );
    return out;
  })();
  function outletsOfPO(poId) {
    return IV_OUTLETS.filter((o) => o.supervisingPOId === poId && !ivWithheld[poId]);
  }
  function outletStats() {
    const cat = {},
      po = {};
    IV_CATS.forEach((c) => (cat[c.id] = 0));
    IV_PO.forEach((p) => (po[p.id] = 0));
    IV_OUTLETS.forEach((o) => {
      cat[o.kategori]++;
      if (o.supervisingPOId) po[o.supervisingPOId]++;
    });
    const empty = IV_DISTRICTS.filter(
      (d) => !IV_OUTLETS.some((o) => o.districtId === d.districtId),
    ).map((d) => d.name);
    return { cat, po, empty, total: IV_OUTLETS.length };
  }

  /* ===== Harga sebenar (DB Harga) melalui HARGADB =====
     Pelayan (/api/harga) ialah satu-satunya pengira status dan sebab; klien hanya membaca baris.
     Lima pertanyaan dikongsi dengan tab Pemantauan (URL sama, cache HARGADB sama): LADANG (mod pengeluar,
     kunci tanpa ladang diganti borong berlabel) dan RUNCIT pada aras PO dan daerah, serta BORONG aras PO. */
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const IVH_Q = [
    ['po', 'LADANG', { mod: 'pengeluar', aras: 'po' }],
    ['daerah', 'LADANG', { mod: 'pengeluar', aras: 'daerah' }],
    ['po', 'RUNCIT', { peringkat: 'RUNCIT', aras: 'po' }],
    ['daerah', 'RUNCIT', { peringkat: 'RUNCIT', aras: 'daerah' }],
    // BORONG dinilai dengan arah turun (mod Bekalan): status/amaranPo seperti Pengeluar, tetapi pada harga borong
    ['po', 'BORONG', { peringkat: 'BORONG', aras: 'po', arah: 'turun' }],
    ['daerah', 'BORONG', { peringkat: 'BORONG', aras: 'daerah', arah: 'turun' }],
    ['po_tambahan', 'BORONG', { peringkat: 'BORONG', aras: 'po_tambahan' }],
  ];
  const IVH = {
    sedia: false,
    memuat: false,
    ralat: null,
    ver: 0,
    meta: null,
    idxPO: {},
    idxDaerah: {},
    pasang: {},
    siriGagal: new Set(),
  };
  const STAGE_KEY = { Ladang: 'LADANG', Runcit: 'RUNCIT', Borong: 'BORONG' };
  const STAGE_LABEL = { LADANG: 'Ladang', RUNCIT: 'Runcit', BORONG: 'Borong' };
  const STATUS_W = { kelabu: -1, hijau: 0, kuning: 1, merah: 2 };
  // Label status kongsi (sama dengan tab Pemantauan).
  const STATUS_LABEL = {
    merah: 'Amaran harga',
    kuning: 'Berwaspada',
    hijau: 'Stabil',
    kelabu: 'Tiada ambang',
  };
  const ivNorm = HARGADB.normDaerah;
  const ivNama = (s) =>
    String(s || '')
      .toUpperCase()
      .replace(/\s*\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  function ivTerapHarga() {
    IVH.idxPO = {};
    IVH.idxDaerah = {};
    IVH.pasang = {};
    IVH.meta = HARGADB.segerak('meta') || null;
    ivPasangKomoditi(IVH.meta);
    const s0 = ivState;
    if (s0.selectedCommodityId && !IV_COMMBY[s0.selectedCommodityId]) s0.selectedCommodityId = null;
    if (s0.selectedJenis && !IV_JENIS.some((j) => j.kod === s0.selectedJenis))
      s0.selectedJenis = null;
    IVH_Q.forEach(([aras, pr, params]) => {
      const rows = (HARGADB.segerak('ringkasan', params) || {}).baris || [];
      const idx = new Map();
      rows.forEach((r) => {
        const kc = IV_COMMBY[slug(r.variety)];
        if (kc && r.unit)
          kc.unit = /^(KG|KILOGRAM)$/i.test(r.unit)
            ? 'RM/kg'
            : 'RM/' + String(r.unit).toLowerCase();
        if (!r.po) return;
        const k =
          aras === 'po' || aras === 'po_tambahan'
            ? [r.po, r.commodity, r.variety].join('|')
            : [r.po, ivNorm(r.daerah), r.commodity, r.variety].join('|');
        idx.set(k, r);
      });
      if (aras === 'po_tambahan') {
        // Digabung ke indeks PO (id PO tambahan unik, awalan tbh-)
        const t = IVH.idxPO[pr] || (IVH.idxPO[pr] = new Map());
        idx.forEach((v, k) => t.set(k, v));
      } else (aras === 'po' ? IVH.idxPO : IVH.idxDaerah)[pr] = idx;
    });
    IVH.sedia = true;
    IVH.memuat = false;
    IVH.ralat = null;
    IVH.ver++;
    if (!ivState.margin.touched) {
      ivState.margin.ctx = null;
      const mc = $i('ivMarCtl');
      if (mc) mc.dataset.sig = '';
    }
  }
  // Muat data harga sekali; ralat disimpan (tiada percubaan semula senyap) sehingga "Cuba semula".
  function ivMuatHarga() {
    if (IVH.sedia || IVH.memuat || IVH.ralat) return;
    if (HARGADB.segerak('meta') && IVH_Q.every((q) => HARGADB.segerak('ringkasan', q[2]))) {
      ivTerapHarga();
      return;
    }
    IVH.memuat = true;
    Promise.all([HARGADB.meta(), ...IVH_Q.map((q) => HARGADB.ringkasan(q[2]))]).then(
      () => {
        ivTerapHarga();
        ivRender(ALL_PANELS);
      },
      (e) => {
        IVH.memuat = false;
        IVH.ralat = e && e.kind === 'file' ? 'file' : (e && e.message) || 'ralat';
        ivRender(ALL_PANELS);
      },
    );
  }
  function ivCubaSemulaHarga() {
    HARGADB.cubaSemula();
    IVH.sedia = false;
    IVH.memuat = false;
    IVH.ralat = null;
    IVH.siriGagal = new Set();
    ivMuatHarga();
    ivRender(ALL_PANELS);
  }
  // Pasangan (jenis, varieti DB) bagi komoditi Intervensi (satu pasangan senarai putih).
  function ivDbPairs(cid) {
    if (IVH.pasang[cid]) return IVH.pasang[cid];
    const c = IV_COMMBY[cid];
    if (!c || !c.variety || !IVH.meta) return [];
    const out = [[c.jenis, c.variety]];
    IVH.pasang[cid] = out;
    return out;
  }
  // Baris paling teruk (merah > kuning > hijau > kelabu); sama taraf: ada harga, kemudian |z| terbesar.
  function ivPickRow(rows) {
    let best = null;
    const key = (r) => [
      STATUS_W[r.amaranPo ? r.amaranPo.status : r.status] ?? -1,
      fin(r.harga) ? 1 : 0,
      Math.abs(r.z || 0),
    ];
    rows.forEach((r) => {
      if (!best) return (best = r);
      const a = key(r),
        b = key(best);
      for (let i = 0; i < 3; i++) {
        if (a[i] > b[i]) return (best = r);
        if (a[i] < b[i]) return;
      }
    });
    return best;
  }
  function ivPoRow(poId, cid, stage) {
    const idx = IVH.idxPO[STAGE_KEY[stage]];
    if (!idx) return null;
    return ivPickRow(
      ivDbPairs(cid)
        .map(([k, v]) => idx.get([poId, k, v].join('|')))
        .filter(Boolean),
    );
  }
  function ivDistrictRow(poId, districtName, cid, stage) {
    const idx = IVH.idxDaerah[STAGE_KEY[stage]];
    if (!idx) return null;
    const dn = ivNorm(districtName);
    return ivPickRow(
      ivDbPairs(cid)
        .map(([k, v]) => idx.get([poId, dn, k, v].join('|')))
        .filter(Boolean),
    );
  }
  // Semua nombor harga datang daripada baris /api/harga (sama seperti Pemantauan); tiada ramalan.
  function ivPriceFromRow(r) {
    if (!r) return null;
    const mg = r.minggu || {};
    return {
      actual: fin(r.harga) ? r.harga : null,
      previous: fin(r.hargaSebelum) ? r.hargaSebelum : null,
      weeklyPct: fin(r.pctMinggu) ? r.pctMinggu : null,
      weeklyRm: fin(r.rmMinggu) ? r.rmMinggu : null,
      floor: fin(r.lantai) ? r.lantai : null,
      ceiling: fin(r.siling) ? r.siling : null,
      mean: fin(r.mean) ? r.mean : null,
      sigma: fin(r.sd) ? r.sd : null,
      z: fin(r.z) ? r.z : null,
      asas: r.asas || null,
      forecast: null,
      unit: r.unit,
      priceLevel: STAGE_LABEL[r.peringkat] || r.peringkat,
      grade: null,
      gradeNote: 'gred tidak tersedia dalam data sedia ada',
      statusKongsi: (r.amaranPo ? r.amaranPo.status : r.status) || null,
      sebabKongsi: (r.amaranPo ? r.amaranPo.sebab : r.sebab) || '',
      ganti: r.ganti || null,
      variety: r.variety,
      dbCommodity: r.commodity,
      minggu: mg,
      priceAsOf: HARGADB.terkini,
      windowLabel: mg.iso
        ? 'Minggu ISO ' + mg.iso + ' (' + mg.mula + ' hingga ' + mg.akhir + ')'
        : '',
      source: 'db-harga',
      origin: '/api/harga',
    };
  }
  function recPrice(poId, districtName, cid, stage) {
    return ivPriceFromRow(ivDistrictRow(poId, districtName, cid, stage));
  }
  // Harga aras PO (purata daerah dalam PO, dikira pelayan). `days` dikekalkan untuk keserasian tandatangan.
  function ivPrice(poId, commodityId, stage) {
    if (!IVH.sedia || !poObj(poId)) return null;
    return ivPriceFromRow(ivPoRow(poId, commodityId, stage));
  }

  /* ===== Bekalan (dummy) ===== */
  const IV_UPD = '2026-11-15T06:00:00+08:00';
  function mkSupply(poId, cid, avail, res, req, upd, tag) {
    const net = +(avail - res).toFixed(6);
    return {
      poId,
      commodityId: cid,
      availableStockMT: avail,
      reservedMT: res,
      requiredMT: req,
      net,
      surplusMT: +Math.max(0, net - req).toFixed(6),
      shortageMT: +Math.max(0, req - net).toFixed(6),
      coverage: req > 0 ? net / req : null,
      lastUpdated: upd || IV_UPD,
      scenario: tag || null,
      source: 'dummy',
      origin: 'iv',
    };
  }
  const IV_SUPPLY_OVERRIDE = (function () {
    const o = {};
    const add = (po, c, a, r, q, upd, t) => (o[po + '|' + c] = mkSupply(po, c, a, r, q, upd, t));
    add('simpangrenggam', 'cili-merah', 18, 1, 5, null, 'T1');
    add('johor', 'cili-merah', 2, 0, 8, null, 'T1b/T2');
    add('selangor', 'cili-merah', 2, 0, 7, null, 'T1b');
    add('perak', 'cili-merah', 3, 0, 7, null, 'T1b');
    add('sabah', 'cili-merah', 2, 0, 8, null, 'T1b');
    add('melaka', 'cili-merah', 16, 0, 6, null, 'T2s');
    add('negerisembilan', 'cili-merah', 11, 0, 6, null, 'T2s');
    add('selayang', 'cili-merah', 12, 0, 6, null, 'T2s');
    add('pahang', 'cili-merah', 14, 0, 6, null, 'T2s');
    add('kelantan', 'cili-merah', 15, 0, 6, null, 'T2s');
    add('sarawak', 'cili-merah', 14, 0, 6, null, 'T2s');
    add('perlis', 'cili-merah', 6, 0, 5.5, null, 'T4');
    add('kedah', 'cili-merah', 8, 0, 8);
    add('penang', 'cili-merah', 8, 0, 8);
    add('terengganu', 'cili-merah', 8, 0, 8);
    add('kelantan', 'bawang-merah-kecil', 3, 0, 9, null, 'T3');
    add('perak', 'bawang-merah-kecil', 14, 0, 6, null, 'T3');
    add('pahang', 'bawang-merah-kecil', 12, 0, 6, null, 'T3');
    add('terengganu', 'bawang-merah-kecil', 13, 0, 6, null, 'T3');
    add('johor', 'bawang-merah-kecil', 9, 0, 6, null, 'T3');
    add('sarawak', 'kubis-bulat', 15, 1, 5, '2026-11-10T06:00:00+08:00', 'T5');
    add('pahang', 'cili-hijau', 12, 0, 6, null, 'T6');
    add('sabah', 'tomato-bulat', 10, 0, 5, null, 'T6');
    add('pahang', 'tomato-bulat', 12, 0, 10, null, 'T7');
    add('selangor', 'cili-hijau', 7, 0, 10, '2026-11-11T06:00:00+08:00', 'T8');
    add('sarawak', 'ayam-proses-super', 7, 0, 10, '2026-11-11T06:00:00+08:00', 'T8');
    return o;
  })();
  const IV_SUPPLY = (function () {
    const rows = {};
    IV_PO.forEach((p) =>
      IV_DUMMY_COMM.forEach((c) => {
        if (c.unit !== 'RM/kg') return;
        const k = p.id + '|' + c.id;
        if (IV_SUPPLY_OVERRIDE[k]) {
          rows[k] = IV_SUPPLY_OVERRIDE[k];
          return;
        }
        const r = mulberry32(hash32(k));
        const a = r();
        const arche = a < 0.35 ? 'surplus' : a < 0.75 ? 'balanced' : 'shortage';
        const req = 3 + Math.round(r() * 90) / 10;
        const res = Math.round(r() * 20) / 10;
        let avail;
        if (arche === 'surplus') avail = req + res + 3 + r() * 8;
        else if (arche === 'balanced') avail = req + res + (r() - 0.5);
        else avail = Math.max(1, req * (0.3 + r() * 0.45) + res);
        avail = Math.min(20, Math.max(4, Math.round(avail * 10) / 10));
        rows[k] = mkSupply(p.id, c.id, avail, res, req);
      }),
    );
    return rows;
  })();
  // Bekalan dummy hanya wujud bagi varieti yang dipetakan (IV_BEKALAN_PETA); selainnya null = tiada data bekalan.
  const supplyRow = (poId, cid) =>
    IV_BEKALAN_DUMMY[cid] ? IV_SUPPLY[poId + '|' + IV_BEKALAN_DUMMY[cid]] || null : null;

  /* ===== Logistik ===== */
  const IV_LOGISTICS_AVAIL = {
    johor_simpang: { availableVehicleCount: 5, availableCapacityMT: 62.0, actualStockMT: 92.4 },
    ayerkeroh: { availableVehicleCount: 6, availableCapacityMT: 28.0, actualStockMT: 6.6 },
    kotabaharu: { availableVehicleCount: 1, availableCapacityMT: 1.5, actualStockMT: 8.6 },
  };
  function logisticsOf(poId) {
    const p = IV_POBY[poId];
    if (!p) return null;
    const l = p.logistik;
    const a = IV_LOGISTICS_AVAIL[p.group] || null;
    const members = IV_PO.filter((x) => x.group === p.group).map((x) => x.id);
    return {
      poId,
      logisticsCapacityGroupId: p.group,
      kenderaanMax: l.kenderaan,
      muatanMaxMT: l.muatanMT,
      bilikSejukMax: l.bilikSejuk,
      simpananMaxMT: l.kapasitiSimpananMT,
      groupShared: members.length > 1,
      groupMemberPOIds: members,
      availableVehicleCount: a ? a.availableVehicleCount : null,
      availableCapacityMT: a ? a.availableCapacityMT : null,
      actualStockMT: a ? a.actualStockMT : null,
      availabilityUpdated: a ? IV_UPD : null,
      source: 'sebenar',
      availSource: 'dummy',
    };
  }
  function readiness(lg) {
    const parts = [];
    if (lg.availableVehicleCount != null && lg.kenderaanMax > 0)
      parts.push(lg.availableVehicleCount / lg.kenderaanMax);
    if (lg.availableCapacityMT != null && lg.simpananMaxMT > 0)
      parts.push(lg.availableCapacityMT / lg.simpananMaxMT);
    if (!parts.length)
      return { state: 'tidak-dinilai', r: null, label: 'Kesiapsiagaan tidak dapat dinilai' };
    const r = mean(parts);
    return r >= 0.6
      ? { state: 'sedia', r, label: 'Sedia' }
      : r >= 0.3
        ? { state: 'terhad', r, label: 'Terhad' }
        : { state: 'kritikal', r, label: 'Kritikal' };
  }

  /* ===== Pengiraan tahap, bekalan dan skor ===== */
  function supplyConfirm(mode, row, now) {
    now = now == null ? nowMs() : now;
    const cfg = IV_CONFIG.supply;
    if (!row || row.availableStockMT == null || row.requiredMT == null)
      return { state: 'tiada', reason: 'Tiada data bekalan (dummy)' };
    if ((now - Date.parse(row.lastUpdated)) / 36e5 > cfg.staleHours)
      return { state: 'lapuk', reason: 'Data stok lapuk' };
    if (mode === 'pengeluar') {
      if (row.surplusMT >= Math.max(cfg.minSurplusMT, cfg.minSurplusRatio * row.net))
        return { state: 'disahkan', reason: 'Lebihan bekalan dikesan' };
    } else if (
      row.coverage !== null &&
      row.coverage < cfg.shortageCoverage &&
      row.shortageMT >= cfg.minSurplusMT
    )
      return { state: 'disahkan', reason: 'Kekurangan bekalan dikesan' };
    return { state: 'tidak-disahkan', reason: 'Menunggu pengesahan bekalan' };
  }
  // Tahap harga = status kongsi pelayan, selari dengan Pemantauan: merah = Kritikal (amaran harga), kuning = Waspada,
  // hijau = Normal, kelabu = tiada ambang (tidak pernah hijau). Pengesahan bekalan DIKECUALIKAN buat masa ini (tiada
  // data bekalan sebenar); `supply` masih dikira untuk paparan maklumat sahaja dan tidak mengubah tahap.
  function ivClassify(mode, price, row) {
    const st = price.statusKongsi || null;
    const noThreshold = !st || st === 'kelabu';
    const pl = st === 'merah' ? 'kritikal' : st === 'kuning' ? 'waspada' : 'normal';
    // Skor: |z| arah merugikan mod ini (Pengeluar z negatif, Pengguna z positif); tiada z = 0.
    const harm = fin(price.z) ? (mode === 'pengeluar' ? -price.z : price.z) : 0;
    const sc = supplyConfirm(mode, row);
    const level = pl,
      flag = null,
      early = false;
    return {
      priceLevel: pl,
      level,
      flag,
      earlySignal: early,
      supply: sc,
      harm,
      harmF: 0,
      noThreshold,
      amaranHarga: false,
      sharedStatus: st,
    };
  }
  function priorityScore(mode, price, row, cls) {
    const P = clamp(cls.harm / 4, 0, 1),
      F = 0;
    let gap = 0;
    if (row)
      gap =
        mode === 'pengeluar'
          ? row.surplusMT / Math.max(row.net, 1)
          : row.shortageMT / Math.max(row.requiredMT, 1);
    const S = clamp(gap, 0, 1);
    const C = 0; // pengesahan bekalan dikecualikan (tiada data sebenar)
    return { score: Math.round(100 * (0.45 * P + 0.35 * S + 0.1 * F + 0.1 * C)), P, S, F, C };
  }
  const LV_W = { normal: 0, waspada: 1, kritikal: 2 };
  const LV_LABEL = {
    normal: 'Normal',
    waspada: 'Waspada',
    kritikal: 'Kritikal',
    tiada: 'Tiada ambang',
  };
  // Penunjuk harga setiap mod: Bekalan = harga Borong (turun), Pasaran = harga Runcit (naik)
  const MODE_STAGE = { pengeluar: 'Borong', pengguna: 'Runcit' };
  const _recCache = {};
  function computeRecs(mode) {
    if (!IVH.sedia) return [];
    const key = mode + '|' + IVH.ver + '|' + refNow;
    if (_recCache[key]) return _recCache[key];
    const stage = MODE_STAGE[mode];
    const out = [];
    IV_DISTRICTS.forEach((d) =>
      IV_COMM.forEach((c) => {
        const rw = ivDistrictRow(d.poId, d.name, c.id, stage);
        if (!rw) return;
        const price = ivPriceFromRow(rw);
        const row = isKg(c.id) ? supplyRow(d.poId, c.id) : null;
        const cls = ivClassify(mode, price, row);
        const sc = priorityScore(mode, price, row, cls);
        const po = IV_POBY[d.poId];
        out.push({
          id: `${mode}:${d.poId}:${d.districtId}:${c.id}`,
          mode,
          poId: d.poId,
          poName: po.name,
          stateId: po.stateId,
          negeri: po.negeri,
          district: d.name,
          districtId: d.districtId,
          commodityId: c.id,
          commodity: c.name,
          price,
          row,
          cls,
          score: sc.score,
          comp: sc,
        });
      }),
    );
    Object.keys(_recCache).forEach((k) => delete _recCache[k]);
    _recCache[key] = out;
    return out;
  }
  const worst = (a, b) => (LV_W[a] >= LV_W[b] ? a : b);

  /* ===== Cuaca/banjir ===== */
  function ivScenarios() {
    return typeof SCEN_LIST !== 'undefined' && Array.isArray(SCEN_LIST) ? SCEN_LIST : [];
  }
  function hav(lat1, lon1, lat2, lon2) {
    const R = 6371,
      r = Math.PI / 180;
    const dl = (lat2 - lat1) * r,
      dn = (lon2 - lon1) * r;
    const a =
      Math.sin(dl / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function disruptionLevel(poId, now) {
    now = now == null ? nowMs() : now;
    const p = IV_POBY[poId];
    let best = null;
    // Hanya cuaca sebenar (Open-Meteo/MET): risiko hujan lebat Tinggi menjadi penanda Waspada. Tiada data banjir JPS.
    ivScenarios().forEach((s) => {
      if (s.warningType !== 'hujan_lebat' || s.riskLevel !== 'tinggi' || best) return;
      if (!(s.affectedPOIds || []).includes(poId)) return;
      // Senario cuaca sebenar dinilai pada masa sebenar; tarikh rujukan prototaip (refNow) hanya untuk data dummy.
      const t = s.dataStatus === 'sebenar' ? Date.now() : now;
      if (!(Date.parse(s.validFrom) <= t && t <= Date.parse(s.validUntil))) return;
      best = { level: 'Waspada', source: `Cuaca (Open-Meteo/MET) ${s.scenarioId}` };
    });
    return best;
  }
  // Banjir sebenar (JPS): risiko PO 'Tinggi' daripada /api/banjir menjadi penanda Waspada (anggaran sistem, bukan amaran rasmi).
  function banjirDisruption(poId) {
    if (typeof banjirState === 'undefined' || banjirState.status !== 'ready') return null;
    if (banjirLapuk(banjirState.data)) return null;
    const p = (banjirState.data.po || []).find((x) => x.poId === poId);
    return p && p.risikoBanjir === 'Tinggi' ? { level: 'Waspada', source: 'Banjir (JPS)' } : null;
  }
  const disruptionLabel = (d) =>
    d
      ? 'Cuaca tinggi (Open-Meteo/MET)' +
        (d.source.split(') ')[1] ? ' ' + d.source.split(') ')[1] : '')
      : '';
  /* ===== Enjin mobilisasi (tulen) ===== */
  function mobilisationEngine(inp) {
    const { mode, anchorPOId, commodityId } = inp;
    const out = {
      dalam: [],
      luar: [],
      excluded: [],
      trigger: { ok: false, reason: null },
      inputsEcho: { ...inp },
    };
    const anchor = poObj(anchorPOId);
    if (!anchor) {
      out.trigger.reason = 'tiada';
      return out;
    }
    // Buat masa ini calon PO dinilai pada jarak dan harga sahaja: bekalan (data dummy) diabaikan, tiada syarat
    // pengesahan bekalan, lebihan/kekurangan stok atau zon.
    out.trigger = { ok: true, reason: 'bekalan-diabaikan', text: 'Bekalan tidak dinilai' };
    const wP = clamp(inp.wPrice, 0, 100) / 100,
      wD = 1 - wP;
    const need = inp.needMT;
    const refPrice = inp.refPrice;
    const el = [];
    const lipA = liputan(anchor);
    [...IV_PO, ...IV_TBH].forEach((c) => {
      const ex = (r) => out.excluded.push({ poId: c.id, name: c.name, reason: r });
      if (c.id === anchorPOId) return ex('PO terpilih sendiri');
      // PO tambahan (atau PO terpilih tambahan) yang berkongsi daerah liputan dikecualikan
      if ((c.tambahan || anchor.tambahan) && [...liputan(c)].some((d) => lipA.has(d)))
        return ex('Liputan daerah sama dengan PO terpilih');
      const pr = ivPrice(c.id, commodityId, 'Borong', inp.days);
      if (!pr || !fin(pr.actual)) return ex('Tiada harga Borong (DB Harga)');
      const km = hav(anchor.lat, anchor.lon, c.lat, c.lon) * IV_CONFIG.detour;
      if (km > inp.distLimitKm)
        return ex(`Jarak ${Math.round(km)} km melebihi had ${inp.distLimitKm} km`);
      const dis = c.tambahan ? null : disruptionLevel(c.id, inp.now);
      const banjir = c.tambahan ? null : banjirDisruption(c.id);
      if (dis && dis.level === 'Amaran') return ex(dis.source);
      const adv = mode === 'pengguna' ? refPrice - pr.actual : pr.actual - refPrice;
      if (!(adv > 0)) return ex('Harga tidak lebih baik daripada harga rujukan');
      const lg = c.tambahan ? null : logisticsOf(c.id);
      // Kuantiti (MT) hanya bermakna untuk komoditi RM/kg; unit lain (cth. RM/biji) tiada penukaran ke MT.
      let qty = isKg(commodityId) ? need : null,
        cap = null;
      if (qty != null && lg && lg.availableVehicleCount != null) {
        cap = (lg.availableVehicleCount * lg.muatanMaxMT) / lg.kenderaanMax;
        qty = Math.min(qty, cap);
      }
      el.push({
        poId: c.id,
        name: c.name,
        negeri: c.negeri,
        zone: c.zone,
        sameState: c.negeri === anchor.negeri,
        stockMT: null, // bekalan diabaikan
        price: pr.actual,
        km,
        priceAdv: adv,
        qty,
        vehicleCapMT: cap,
        vehicleKnown: !!lg && lg.availableVehicleCount != null,
        maxCapMT: lg ? lg.muatanMaxMT : null,
        sameGroup: !c.tambahan && !anchor.tambahan && c.group === anchor.group,
        tambahan: !!c.tambahan,
        flood: dis && dis.level === 'Waspada' ? dis : null,
        banjir,
      });
    });
    const rank = (list) => {
      const mx = Math.max(...list.map((x) => x.priceAdv), 1e-9);
      list.forEach((x) => {
        const ps = x.priceAdv / mx,
          ds = clamp(1 - x.km / inp.distLimitKm, 0, 1);
        x.priceScore = ps;
        x.distScore = ds;
        x.score = Math.max(
          0,
          Math.round(100 * (wP * ps + wD * ds)) - (x.flood || x.banjir ? 5 : 0),
        );
      });
      list.sort(
        (a, b) =>
          b.score - a.score ||
          (b.qty || 0) - (a.qty || 0) ||
          a.km - b.km ||
          a.name.localeCompare(b.name),
      );
      list.slice(0, 5).forEach((x, i) => (x.rank = i + 1));
      return list.slice(0, 5);
    };
    out.dalam = rank(el.filter((x) => x.sameState));
    out.luar = rank(el.filter((x) => !x.sameState));
    return out;
  }

  /* ===== Margin ===== */
  const marginPct = (S, F, C) => (S > 0 ? ((S - F - C) / S) * 100 : NaN);
  const maxFarmPrice = (S, C, t) => S * (1 - t / 100) - C;
  const minSell = (F, C, t) => (1 - t / 100 > 0 ? (F + C) / (1 - t / 100) : NaN);
  function historyStats(h) {
    const sp = h.map((x) => x.jual - x.beli),
      n = sp.length;
    if (!n) return null;
    const m = mean(sp),
      s = [...sp].sort((a, b) => a - b),
      med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    const sd = Math.sqrt(mean(sp.map((x) => (x - m) ** 2)));
    const xm = (n - 1) / 2;
    let num = 0,
      den = 0;
    sp.forEach((y, i) => {
      num += (i - xm) * (y - m);
      den += (i - xm) ** 2;
    });
    const slope = den ? num / den : 0;
    return {
      n,
      mean: m,
      median: med,
      sd,
      slope,
      trend: Math.abs(slope) < 0.01 ? 'stabil' : slope > 0 ? 'naik' : 'turun',
    };
  }
  const IV_OPCOST = Object.fromEntries(
    IV_PO.map((p) => [p.id, +(0.35 + (hash32('kos' + p.id) % 26) / 100).toFixed(2)]),
  );
  IV_OPCOST.simpangrenggam = 0.45;
  // Sejarah spread (data sebenar DB Harga): untuk setiap minggu ISO lengkap, jual = harga Borong PO dan
  // beli = harga Ladang PO (purata harian dalam minggu itu, siri /api/harga?siri=1). Harga Borong Beli
  // sebenar FAMA PO tiada dalam DB Harga, maka spread sejarah ialah Borong tolak Ladang. Kurang
  // minHistory minggu: julat sokongan pasaran tidak dipaparkan (tiada ralat).
  function ivSiriMingguan(stage, poId, cid) {
    const row = ivPoRow(poId, cid, stage);
    if (!row) return null;
    const params = {
      peringkat: STAGE_KEY[stage],
      po: poId,
      commodity: row.commodity,
      variety: row.variety,
    };
    const d = HARGADB.segerak('siri', params);
    if (!d) {
      const u = HARGADB.url('siri', params);
      if (!IVH.siriGagal.has(u)) {
        HARGADB.siri(params).then(
          () => ivRender(['mar', 'marres']),
          () => IVH.siriGagal.add(u),
        );
      }
      return null;
    }
    const terkini = HARGADB.terkini || '';
    const by = new Map();
    ((d.siri && d.siri.titik) || []).forEach((p) => {
      if (!fin(p.h) || !p.t) return;
      const w = weekStart(p.t);
      if (!by.has(w)) by.set(w, []);
      by.get(w).push(p.h);
    });
    const out = new Map();
    by.forEach((v, w) => {
      if (addDays(w, 6) <= terkini) out.set(w, mean(v));
    });
    return out;
  }
  function historyOf(poId, cid) {
    if (!IVH.sedia) return [];
    const jual = ivSiriMingguan('Borong', poId, cid),
      beli = ivSiriMingguan('Ladang', poId, cid);
    if (!jual || !beli) return [];
    return [...jual.keys()]
      .filter((w) => beli.has(w))
      .sort()
      .slice(-12)
      .map((w) => ({
        week: w,
        beli: +beli.get(w).toFixed(2),
        jual: +jual.get(w).toFixed(2),
      }));
  }
  // Harga Borong Jual = harga Borong PO minggu terkini (jadual harga_borong_mingguan dianggap padanan bagi
  // "harga jualan borong yang diperhatikan"); Harga Borong Beli kekal input pengguna; ladang = harga ladang PO.
  function marginDefaults(poId, cid) {
    const bor = ivPrice(poId, cid, 'Borong'),
      lad = ivPrice(poId, cid, 'Ladang');
    return {
      jual: bor && fin(bor.actual) ? +bor.actual.toFixed(2) : null,
      beli: null,
      ladang: lad && fin(lad.actual) ? +lad.actual.toFixed(2) : null,
      kos: IV_OPCOST[poId],
      target: 15,
      override: false,
    };
  }
  function validateMargin(m) {
    const err = {};
    const val = {};
    const pf = (k, lbl, allowZero) => {
      const raw = String(m[k]).trim();
      const v = Number(raw);
      if (raw === '' || !Number.isFinite(v)) {
        err[k] = `${lbl} mesti nombor`;
        return;
      }
      if (allowZero ? v < 0 || v > 999 : v <= 0 || v > 999) {
        err[k] = allowZero
          ? `${lbl} mesti antara 0 dan 999`
          : `${lbl} mesti lebih daripada 0 dan tidak melebihi 999`;
        return;
      }
      val[k] = v;
    };
    pf('beli', 'Harga Borong Beli');
    pf('jual', 'Harga Borong Jual');
    pf('ladang', 'Harga Belian Ladang');
    pf('kos', 'Kos Operasi', true);
    const traw = String(m.target).trim(),
      t = Number(traw);
    if (traw === '' || !Number.isFinite(t)) err.target = 'Margin sasaran mesti nombor';
    else if (t < 0) err.target = 'Margin sasaran tidak boleh negatif';
    else if (t >= 100) err.target = 'Margin sasaran mesti kurang daripada 100%';
    else if (t > 95) err.target = 'Margin sasaran maksimum 95%';
    else val.target = t;
    return { ok: !Object.keys(err).length, err, val };
  }
  function simulateMargin(v, hist, ctx) {
    const S = v.beli,
      F = v.ladang,
      C = v.kos,
      t = v.target,
      J = v.jual;
    const cur = marginPct(S, F, C),
      spread = J - S,
      maxF = maxFarmPrice(S, C, t),
      minS = minSell(F, C, t);
    const hs = historyStats(hist);
    const enough = hist.length >= IV_CONFIG.minHistory;
    const farmLow = Math.max(0, ctx.farmFloor || 0);
    const farmOk = fin(maxF) && maxF > 0 && maxF >= farmLow;
    let mLow = NaN,
      mHigh = NaN,
      recLow = NaN,
      recHigh = NaN,
      sellOk = false;
    if (hs && enough) {
      mLow = Math.max(0, J - (hs.median + hs.sd));
      mHigh = Math.max(0, J - Math.max(0, hs.median - hs.sd));
      recLow = Math.max(minS, mLow);
      recHigh = mHigh;
      sellOk = fin(minS) && minS > 0 && minS <= mHigh && recLow <= recHigh;
    }
    return {
      S,
      F,
      C,
      t,
      J,
      cur,
      spread,
      maxF,
      minS,
      farmLow,
      farmOk,
      hs,
      enough,
      mLow,
      mHigh,
      recLow,
      recHigh,
      sellOk,
      impact: t - cur,
      marginAtLow: marginPct(recLow, F, C),
      marginAtHigh: marginPct(recHigh, F, C),
      buyAboveSell: S > J,
    };
  }

  /* ===== Keadaan ternamaruang dan dispatch ===== */
  const ivState = {
    selectedMode: 'pengeluar',
    selectedCommodityId: null,
    selectedJenis: null,
    selectedStateId: null,
    selectedDistrictId: null,
    selectedPOId: null,
    selectedOutletId: null,
    selectedDateRange: { days: 30 },
    selectedRisk: 'all',
    selectedInterventionId: null,
    selectedSourcePOId: null,
    selectedDestinationPOId: null,
    outletCats: { 'pasar-awam': true, ptk: true, rakr: true, agrobazaar: true },
    mob: { needMT: null, refPrice: null, wPrice: 65, distLimitKm: 550, candidateKey: null },
    margin: { jual: '', beli: '', ladang: '', kos: '', target: '15', touched: false, ctx: null },
    muse: { weekStart: null, page: 0, detailKey: null, status: 'loading', errMsg: '' },
    ui: {
      mapReady: false,
      mapError: null,
      loading: {},
      errors: {},
      scenPending: false,
      priBanner: null,
      showAll: false,
      marInsight: false,
    },
  };
  const failFlags = { ai: false, muse: false, map: false };
  let ivDrafts = [];
  const DRAFT_KEY = 'fama-iv-draf-v1';
  function loadDrafts() {
    try {
      const a = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
      if (!Array.isArray(a)) return [];
      return a.filter(
        (d) =>
          d &&
          d.status === 'draf' &&
          typeof d.interventionId === 'string' &&
          typeof d.sourcePOId === 'string' &&
          typeof d.destinationPOId === 'string' &&
          (d.quantityMT === null || fin(d.quantityMT)),
      );
    } catch (_) {
      return [];
    }
  }
  function saveDrafts() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(ivDrafts));
      return true;
    } catch (err) {
      console.warn('Draf tidak dapat disimpan', err);
      return false;
    }
  }
  ivDrafts = loadDrafts();

  const thr = () => IV_CONFIG.thresholds[ivState.selectedMode];
  const modeLbl = (m) => (m === 'pengeluar' ? 'Pengeluar' : 'Pengguna');
  function effPO() {
    if (ivState.selectedPOId) return ivState.selectedPOId;
    if (ivState.selectedInterventionId) {
      const x = ivState.selectedInterventionId.split(':')[1];
      if (IV_POBY[x]) return x;
    }
    return null;
  }
  function effCommodity() {
    if (ivState.selectedCommodityId) return { id: ivState.selectedCommodityId, def: false };
    if (ivState.selectedInterventionId) {
      const x = ivState.selectedInterventionId.split(':')[3];
      if (IV_COMMBY[x]) return { id: x, def: false };
    }
    if (ivState.selectedJenis) {
      const c = IV_COMM.find((x) => x.jenis === ivState.selectedJenis && !x.tiadaData);
      if (c) return { id: c.id, def: true };
    }
    return { id: IV_LALAI_ID, def: true };
  }
  // Penapis komoditi (jenis dan/atau varieti) terpakai pada id varieti ini?
  function commOk(cid) {
    const s = ivState;
    if (s.selectedCommodityId) return cid === s.selectedCommodityId;
    if (s.selectedJenis) return !!IV_COMMBY[cid] && IV_COMMBY[cid].jenis === s.selectedJenis;
    return true;
  }
  const poName = (id) => (poObj(id) ? poObj(id).name : '—');
  // id dummy lama (cth. outlet dummy) dipaparkan sebagai varieti senarai yang dipetakan kepadanya.
  const commName = (id) => {
    const c = IV_COMMBY[id] || IV_COMMBY[IV_DUMMY_PAIR[id]];
    return c ? c.name : '—';
  };

  /* ===== Penyesuai AI (simulasi, deterministik) ===== */
  const aiAdapter = (function () {
    const model = 'mock-deterministik-v1';
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    async function run(kind, fn, lat = true) {
      if (failFlags[kind]) {
        failFlags[kind] = false;
        throw new Error('Kegagalan AI disuntik (ujian)');
      }
      if (lat) await delay(200 + Math.floor(Math.random() * 200));
      return { ok: true, text: fn(), model, generatedAt: new Date().toISOString() };
    }
    return Object.freeze({
      model,
      explainMobilisation: (f) => run('ai', () => f.text),
      explainMargin: (f) => run('ai', () => f.text),
      recommendPriority: (f) => run('ai', () => f.text),
      summariseMuse: (f) => run('ai', () => f.text),
    });
  })();
  function ivValidateAi(r) {
    return !!(
      r &&
      r.ok === true &&
      typeof r.text === 'string' &&
      r.text.length >= 1 &&
      r.text.length <= 1200
    );
  }
  async function callAI(method, facts, fallback) {
    try {
      const r = await Promise.race([
        aiAdapter[method](facts),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Tamat masa AI')), 4000)),
      ]);
      if (ivValidateAi(r)) return { text: r.text, ai: true };
      throw new Error('Respons AI tidak sah');
    } catch (err) {
      console.warn('Penjelasan AI tidak tersedia', err && err.message);
      return { text: fallback, ai: false };
    }
  }

  /* ===== Penyaringan dan tahap ===== */
  function recsNow() {
    return computeRecs(ivState.selectedMode);
  }
  function recsForPO(poId, commOnly = true) {
    return recsNow().filter((r) => r.poId === poId && (!commOnly || commOk(r.commodityId)));
  }
  // Tahap PO = amaranPo pelayan (sama dengan Pemantauan: merah >= 1 daerah merah, kuning >= 30% daerah kuning atau
  // purata PO kuning, hijau perlu liputan data >= 50%) bagi peringkat mod semasa, terburuk merentas komoditi tertapis.
  // 'tiada' = tiada rekod atau semua kelabu: kelabu, tidak pernah hijau.
  const AMARAN_LV = { merah: 'kritikal', kuning: 'waspada', hijau: 'normal' };
  function poLevel(poId) {
    const stage = MODE_STAGE[ivState.selectedMode];
    let l = 'tiada';
    IV_COMM.forEach((c) => {
      if (!commOk(c.id)) return;
      const rw = ivPoRow(poId, c.id, stage);
      if (!rw) return;
      const lv = AMARAN_LV[rw.amaranPo ? rw.amaranPo.status : rw.status];
      if (lv) l = worst(l === 'tiada' ? 'normal' : l, lv);
    });
    return l;
  }
  function districtLevel(did) {
    let l = 'tiada';
    recsNow().forEach((r) => {
      if (r.districtId === did && commOk(r.commodityId) && !r.cls.noThreshold)
        l = worst(l === 'tiada' ? 'normal' : l, r.cls.level);
    });
    return l;
  }
  const STATUS_CLS = { normal: 'hijau', waspada: 'kuning', kritikal: 'merah', tiada: 'kelabu' };
  function poPasses(p, lvl) {
    const s = ivState;
    return (
      (!s.selectedStateId || p.stateId === s.selectedStateId) &&
      (s.selectedRisk === 'all' || lvl === s.selectedRisk)
    );
  }
  const priCmp = (a, b) =>
    b.score - a.score ||
    LV_W[b.cls.level] - LV_W[a.cls.level] ||
    b.comp.S - a.comp.S ||
    a.poName.localeCompare(b.poName) ||
    a.district.localeCompare(b.district);
  function priRows() {
    const s = ivState;
    return recsNow()
      .filter(
        (r) =>
          r.cls.level !== 'normal' &&
          (s.selectedRisk === 'all' || r.cls.level === s.selectedRisk) &&
          commOk(r.commodityId) &&
          (!s.selectedStateId || r.stateId === s.selectedStateId) &&
          (!s.selectedPOId || r.poId === s.selectedPOId) &&
          (!s.selectedDistrictId || r.districtId === s.selectedDistrictId),
      )
      .sort(priCmp);
  }
  function issueLabel(r) {
    const m = r.mode;
    // Merah = Kritikal terus (pengesahan bekalan dikecualikan), selari dengan Pemantauan.
    const base = r.cls.amaranHarga
      ? 'Amaran harga'
      : r.cls.priceLevel === 'kritikal'
        ? m === 'pengeluar'
          ? 'Harga borong jatuh'
          : 'Kenaikan harga runcit'
        : m === 'pengeluar'
          ? 'Harga borong berwaspada'
          : 'Harga runcit berwaspada';
    return base; // pengesahan bekalan dikecualikan
  }
  function intervType(r) {
    const k = r.cls.level === 'kritikal';
    return r.mode === 'pengeluar'
      ? k
        ? 'Pengumpulan dan pengedaran semula bekalan'
        : 'Pantau dan sedia pembelian lebihan'
      : k
        ? 'Mobilisasi stok tambahan'
        : 'Pantau bekalan dan sedia stok sokongan';
  }
  const tagD = '<span class="iv-tag dummy">DATA DUMMY</span>',
    tagR = '<span class="iv-tag real">Data sedia ada</span>';
  const chip = (t, c = '') => `<span class="iv-chip ${c}">${E(t)}</span>`;
  const tagH = '<span class="iv-tag real">DB Harga</span>';
  const statusKongsiChips = (r) =>
    r.price.statusKongsi
      ? chip(
          'Pemantauan: ' + STATUS_LABEL[r.price.statusKongsi],
          r.price.statusKongsi === 'hijau' || r.price.statusKongsi === 'kelabu' ? 'grey' : 'warn',
        )
      : '';
  const pctTxt = (x) => (fin(x) ? sgn(x, 1) + '%' : '—');
  // Satu baris harga: harga semasa, minggu sebelum + perubahan, sebab status dan tahun asas.
  function hargaRingkas(p) {
    if (!fin(p.actual)) {
      return p.ganti && fin(p.ganti.harga)
        ? `Tiada harga ladang · ${E(p.ganti.label)}: ${rmAny(p.ganti.harga)}`
        : 'Tiada harga ladang';
    }
    return `Harga semasa ${rmAny(p.actual)}${fin(p.previous) ? ` (minggu sebelum ${rmAny(p.previous)}, ${pctTxt(p.weeklyPct)})` : ''} · ${E(p.sebabKongsi)}${p.asas ? ` · asas ${p.asas}` : ''}`;
  }

  /* ===== Dispatch ===== */
  // ubah kepada true untuk papar semula panel AI Muse (sementara disembunyikan); ?muse=1 hanya untuk ujian
  const IV_SHOW_MUSE = false;
  const ivShowMuse = IV_SHOW_MUSE || /[?&]muse=1(&|$)/.test(location.search);
  (function () {
    const p = document.getElementById('ivMusePanel');
    if (p) p.hidden = !ivShowMuse;
  })();
  const ALL_PANELS = ['filters', 'map', 'log', 'pri', 'mob', 'draft', 'mar', 'muse'];
  function resetMobSel() {
    ivState.mob.needMT = null;
    ivState.mob.refPrice = null;
    ivState.mob.candidateKey = null;
    ivState.selectedSourcePOId = null;
    ivState.selectedDestinationPOId = null;
  }
  function applyRoles() {
    const s = ivState;
    if (s.selectedMode === 'pengeluar') {
      s.selectedSourcePOId = s.selectedPOId;
      s.selectedDestinationPOId = null;
    } else {
      s.selectedDestinationPOId = s.selectedPOId;
      s.selectedSourcePOId = null;
    }
  }
  function toastSafe(m) {
    try {
      toast(m);
    } catch (_) {}
  }
  function ivDispatch(type, payload) {
    const s = ivState;
    let dirty = ALL_PANELS,
      focus = false;
    switch (type) {
      case 'setMode': {
        if (payload !== 'pengeluar' && payload !== 'pengguna') return;
        s.selectedMode = payload;
        s.selectedInterventionId = null;
        s.selectedOutletId = null;
        resetMobSel();
        applyRoles();
        s.ui.priBanner = null;
        break;
      }
      case 'setFilter': {
        const [k, v] = payload;
        if (k === 'komoditi' || k === 'varieti') {
          if (k === 'komoditi') {
            s.selectedJenis = v === 'all' || !IV_JENIS.some((j) => j.kod === v) ? null : v;
            s.selectedCommodityId = null;
          } else {
            const c = v === 'all' ? null : IV_COMMBY[v];
            s.selectedCommodityId = c && c.variety && !c.tiadaData ? v : null;
          }
          s.selectedInterventionId = null;
          s.mob.candidateKey = null;
          s.mob.needMT = null;
          s.mob.refPrice = null;
        } else if (k === 'negeri') {
          s.selectedStateId = v === 'all' || !IV_STATES.some((x) => x.id === v) ? null : v;
          if (s.selectedDistrictId && !s.selectedDistrictId.startsWith(s.selectedStateId + '/'))
            s.selectedDistrictId = null;
        } else if (k === 'po') {
          if (v === 'all' || !IV_POBY[v]) {
            s.selectedPOId = null;
            s.selectedDistrictId = null;
            s.selectedOutletId = null;
            s.selectedInterventionId = null;
            resetMobSel();
            focus = true;
          } else {
            return ivDispatch('selectPO', v);
          }
        } else if (k === 'daerah') {
          return ivDispatch('selectDistrict', v === 'all' ? null : v);
        } else if (k === 'tempoh') {
          const d = +v;
          s.selectedDateRange.days = [7, 14, 30].includes(d) ? d : 30;
        } else if (k === 'risiko') {
          s.selectedRisk = ['kritikal', 'waspada', 'normal'].includes(v) ? v : 'all';
        }
        break;
      }
      case 'resetFilters': {
        Object.assign(s, {
          selectedMode: 'pengeluar',
          selectedCommodityId: null,
          selectedJenis: null,
          selectedStateId: null,
          selectedDistrictId: null,
          selectedPOId: null,
          selectedOutletId: null,
          selectedRisk: 'all',
          selectedInterventionId: null,
          selectedSourcePOId: null,
          selectedDestinationPOId: null,
        });
        s.selectedDateRange = { days: 30 };
        s.outletCats = { 'pasar-awam': true, ptk: true, rakr: true, agrobazaar: true };
        s.mob = { needMT: null, refPrice: null, wPrice: 65, distLimitKm: 550, candidateKey: null };
        s.ui.priBanner = null;
        s.ui.showAll = false;
        s.margin.touched = false;
        s.margin.ctx = null;
        IV_CONFIG.thresholds = JSON.parse(JSON.stringify(IV_THR_DEFAULT));
        focus = true;
        break;
      }
      case 'setMobAnchor': {
        // PO tambahan sebagai PO terpilih mobilisasi (tidak mengubah PO terpilih panel lain)
        if (!IV_TBHBY[payload]) return;
        s.mob.anchorTbh = payload;
        s.mob.candidateKey = null;
        s.mob.needMT = null;
        s.mob.refPrice = null;
        dirty = ['mob', 'map'];
        break;
      }
      case 'selectPO': {
        const p = IV_POBY[payload];
        if (!p) {
          toastSafe('Pilihan tidak sah, penapis diset semula');
          console.warn('PO tidak sah', payload);
          return;
        }
        s.selectedPOId = p.id;
        s.mob.anchorTbh = null;
        s.selectedStateId = p.stateId;
        s.selectedDistrictId = null;
        s.selectedOutletId = null;
        s.selectedInterventionId = null;
        resetMobSel();
        applyRoles();
        s.ui.priBanner = null;
        focus = true;
        break;
      }
      case 'selectDistrict': {
        if (payload === null || payload === s.selectedDistrictId) {
          s.selectedDistrictId = null;
          focus = true;
          break;
        }
        const d = IV_DISTBY[payload];
        if (!d) return;
        s.selectedDistrictId = d.districtId;
        if (!ivWithheld[d.poId] && s.selectedPOId !== d.poId) {
          s.selectedPOId = d.poId;
          s.selectedStateId = d.stateId;
          s.selectedOutletId = null;
          s.selectedInterventionId = null;
          resetMobSel();
          applyRoles();
        }
        focus = true;
        break;
      }
      case 'toggleOutletCat': {
        if (IV_CATBY[payload]) s.outletCats[payload] = !s.outletCats[payload];
        dirty = ['map'];
        break;
      }
      case 'selectOutlet': {
        s.selectedOutletId = payload;
        dirty = ['map'];
        break;
      }
      case 'selectIntervention': {
        const r = recsNow().find((x) => x.id === payload);
        if (!r) return;
        s.selectedInterventionId = r.id;
        s.selectedPOId = r.poId;
        s.selectedStateId = r.stateId;
        s.selectedDistrictId = r.districtId;
        s.selectedCommodityId = r.commodityId;
        s.selectedJenis = IV_COMMBY[r.commodityId] ? IV_COMMBY[r.commodityId].jenis : null;
        s.selectedOutletId = null;
        resetMobSel();
        applyRoles();
        s.margin.touched = false;
        focus = true;
        s.ui.priBanner = { id: r.id, text: null, loading: true };
        ivRecommendBanner(r);
        toastSafe('Intervensi dipilih: ' + r.commodity + ' · ' + r.district + ' · ' + r.poName);
        break;
      }
      case 'setMob': {
        const [k, v] = payload;
        if (k === 'need') s.mob.needMT = v;
        else if (k === 'ref') s.mob.refPrice = v;
        else if (k === 'limit') s.mob.distLimitKm = v;
        else if (k === 'wPrice') s.mob.wPrice = clamp(Math.round(v / 5) * 5, 0, 100);
        else if (k === 'resetNeed') s.mob.needMT = null;
        else if (k === 'resetRef') s.mob.refPrice = null;
        dirty = k === 'resetNeed' || k === 'resetRef' ? ['mob'] : ['mobres'];
        break;
      }
      case 'selectCandidate': {
        s.mob.candidateKey = s.mob.candidateKey === payload ? null : payload;
        const eng = curEngine();
        if (s.mob.candidateKey) {
          if (s.selectedMode === 'pengeluar') s.selectedDestinationPOId = payload;
          else s.selectedSourcePOId = payload;
        } else applyRoles();
        dirty = ['mobres'];
        break;
      }
      case 'createDraft': {
        return createDraft();
      }
      case 'deleteDraft': {
        ivDrafts = ivDrafts.filter((d) => d.interventionId !== payload);
        saveDrafts();
        dirty = ['draft'];
        break;
      }
      case 'setMargin': {
        const [k, v] = payload;
        s.margin[k] = v;
        s.margin.touched = true;
        dirty = ['marres'];
        break;
      }
      case 'resetMargin': {
        s.margin.touched = false;
        s.margin.ctx = null;
        dirty = ['mar'];
        break;
      }
      case 'museWeek': {
        const tersedia = (museData && museData.mingguTersedia) || [];
        const cur = s.muse.weekStart;
        let target = null;
        if (payload === 'prev' || payload === 'next') {
          const i = tersedia.indexOf(cur);
          const j = payload === 'prev' ? i - 1 : i + 1;
          if (i >= 0 && j >= 0 && j < tersedia.length) target = tersedia[j];
        } else {
          const minggu = weekStart(myDate(new Date(museNow()).toISOString()));
          target = tersedia.includes(minggu) ? minggu : tersedia[tersedia.length - 1] || null;
        }
        if (!target || target === cur) return false;
        ivLoadMuse(target);
        return true;
      }
      case 'musePage': {
        const n = museItems().length,
          pages = Math.max(1, Math.ceil(n / MUSE_PAGE));
        const p = Math.min(pages - 1, Math.max(0, s.muse.page + (payload === 'prev' ? -1 : 1)));
        if (p === s.muse.page) return false;
        s.muse.page = p;
        dirty = ['muse'];
        break;
      }
      case 'setThreshold': {
        const [m, k, v] = payload;
        const o = IV_CONFIG.thresholds[m];
        const w = Math.abs(o.warnPct),
          c = Math.abs(o.critPct);
        let nw = w,
          nc = c;
        if (k === 'warn') nw = v;
        else nc = v;
        if (!(nw >= 1 && nw <= 50 && nc > nw && nc <= 90)) return false;
        const sg = m === 'pengeluar' ? -1 : 1;
        o.warnPct = sg * nw;
        o.critPct = sg * nc;
        break;
      }
      default:
        return;
    }
    if (focus) ivFocusMap();
    ivRender(dirty);
    return true;
  }

  /* ===== Peta ===== */
  const MY_BOUNDS = (typeof FAMA_MAP_CONFIG !== 'undefined' && FAMA_MAP_CONFIG.bounds) || [
    [99.5, 0.8],
    [119.5, 7.5],
  ];
  let ivMap = null,
    ivMapLoaded = false,
    ivMapTimer = null,
    ivMapWarned = false,
    ivPoMk = [],
    ivDistMk = [],
    ivOutMk = [],
    ivPopup = null;
  function ivMapBox() {
    return $i('ivMap');
  }
  function ivInitMap() {
    if (ivMap) return;
    const sk = $i('ivMapSkel'),
      fb = $i('ivMapFallback');
    if (typeof maplibregl === 'undefined' || failFlags.map) {
      const injected = failFlags.map;
      failFlags.map = false;
      if (!ivMapWarned) {
        ivMapWarned = true;
        console.warn(
          'Peta intervensi tidak dapat dimulakan',
          injected ? '(disuntik)' : 'MapLibre tiada',
        );
      }
      ivState.ui.mapError = 'fallback';
      sk.hidden = true;
      ivRenderMapFallback();
      return;
    }
    try {
      fb.hidden = true;
      sk.hidden = false;
      ivState.ui.mapError = null;
      const cfg = window.FAMA_MAP_CONFIG || {};
      ivMap = new maplibregl.Map({
        container: 'ivMap',
        style: cfg.style || 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        bounds: MY_BOUNDS,
        fitBoundsOptions: { padding: 20 },
        attributionControl: true,
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
        locale: {
          'CooperativeGesturesHandler.WindowsHelpText': 'Tekan Ctrl + skrol untuk zum peta',
          'CooperativeGesturesHandler.MacHelpText': 'Tekan ⌘ + skrol untuk zum peta',
          'CooperativeGesturesHandler.MobileHelpText': 'Guna dua jari untuk gerakkan peta',
        },
      });
      ivMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      if (window.FamaPOT) {
        FamaPOT.pasangZum(ivMap);
        FamaPOT.pasangButang($i('ivPoTbhCtl'));
      }
      if (window.ResizeObserver) {
        if (ivMap._ro) ivMap._ro.disconnect();
        ivMap._ro = new ResizeObserver(() => {
          try {
            if (ivMap) ivMap.resize();
          } catch (_) {}
        });
        ivMap._ro.observe(document.querySelector('.iv-map-frame'));
      }
      ivMap.on('load', () => {
        ivMapLoaded = true;
        ivState.ui.mapReady = true;
        ivState.ui.mapError = null;
        clearTimeout(ivMapTimer);
        sk.hidden = true;
        ivDrawDistrictLayer();
        ivRenderMapBanner();
      });
      ivMap.on('error', () => {
        if (!ivMapLoaded && !ivState.ui.mapError) {
          ivState.ui.mapError = 'style';
          sk.hidden = true;
          if (!ivMapWarned) {
            ivMapWarned = true;
            console.warn('Peta asas intervensi tidak dapat dimuatkan');
          }
          ivRenderMapBanner();
        }
      });
      ivMapTimer = setTimeout(() => {
        if (!ivMapLoaded) {
          ivState.ui.mapError = 'style';
          sk.hidden = true;
          if (!ivMapWarned) {
            ivMapWarned = true;
            console.warn('Peta asas intervensi lambat dimuatkan');
          }
          ivRenderMapBanner();
        }
      }, 10000);
    } catch (err) {
      if (!ivMapWarned) {
        ivMapWarned = true;
        console.warn('Peta intervensi tidak dapat dimulakan', err);
      }
      ivMap = null;
      ivState.ui.mapError = 'fallback';
      sk.hidden = true;
      ivRenderMapFallback();
    }
    ivRenderMap();
  }
  function ivRetryMap() {
    try {
      if (ivMap) {
        ivMap.remove();
      }
    } catch (_) {}
    ivMap = null;
    ivMapLoaded = false;
    ivMapWarned = false;
    ivPoMk = [];
    ivDistMk = [];
    ivOutMk = [];
    ivState.ui.mapError = null;
    $i('ivMapFallback').hidden = true;
    ivInitMap();
  }
  function ivFocusMap() {
    if (!ivMap) return;
    const s = ivState;
    try {
      const d = s.selectedDistrictId && IV_DISTBY[s.selectedDistrictId];
      const FD = window.FamaDaerah && window.FamaDaerah.sedia() ? window.FamaDaerah : null;
      if (d && !ivWithheld[d.poId]) {
        const rf = FD && FD.fitur(d.negeri, d.name);
        if (rf) ivMap.fitBounds(FD.sempadan(rf), { padding: 60, maxZoom: 11, duration: 700 });
        else ivMap.flyTo({ center: [d.lon, d.lat], zoom: 10.5, duration: 700 });
        return;
      }
      const p = s.selectedPOId && IV_POBY[s.selectedPOId];
      if (p) {
        const b = new maplibregl.LngLatBounds([p.lon, p.lat], [p.lon, p.lat]);
        if (!ivWithheld[p.id])
          p.districts.forEach((x) => {
            const rf = FD && FD.fitur(p.negeri, x[0]);
            if (rf) FD.sempadan(rf).forEach((c) => b.extend(c));
            else b.extend([x[2], x[1]]);
          });
        ivMap.fitBounds(b, { padding: 60, maxZoom: 10, duration: 700 });
        return;
      }
      ivMap.fitBounds(MY_BOUNDS, { padding: 20, duration: 700 });
    } catch (err) {
      console.warn('Gerakan peta gagal', err);
    }
  }
  function mkEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function ivRenderMapFallback() {
    const fb = $i('ivMapFallback');
    fb.hidden = false;
    fb.innerHTML = `<div class="iv-banner bad">Peta tidak dapat dimuatkan. Pilihan PO melalui senarai masih berfungsi.</div><button type="button" class="button" data-iv-act="mapRetry">Cuba Semula</button><div class="iv-fb-grid">${IV_PO.map(
      (p) => {
        const l = poLevel(p.id);
        return `<button type="button" class="iv-fb-btn status-${STATUS_CLS[l]}" data-iv-act="selPO" data-iv-arg="${E(p.id)}">${E(p.name)}<br><small>${LV_LABEL[l]}</small></button>`;
      },
    ).join('')}</div>`;
  }
  function ivRenderMapBanner() {
    const b = $i('ivMapBanner');
    const s = ivState;
    let h = '';
    if (s.ui.mapError === 'style')
      h += `<div class="iv-banner">Peta asas tidak dapat dimuatkan. Penanda PO tetap berfungsi. <button type="button" class="button tiny ghost" data-iv-act="mapRetry">Cuba Semula</button></div>`;
    if (s.selectedPOId && ivWithheld[s.selectedPOId])
      h += `<div class="iv-banner info">Pemetaan daerah untuk PO ini belum disediakan. Daerah dan outlet tidak dipaparkan.</div>`;
    b.innerHTML = h;
  }
  function circlePoly(lon, lat, rKm, n = 24) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 2 * Math.PI;
      pts.push([
        lon + (rKm / 111.32 / Math.cos((lat * Math.PI) / 180)) * Math.cos(a),
        lat + (rKm / 110.57) * Math.sin(a),
      ]);
    }
    return pts;
  }
  function ivDrawDistrictLayer() {
    if (!ivMap || !ivMapLoaded) return;
    try {
      const s = ivState,
        p = s.selectedPOId && IV_POBY[s.selectedPOId];
      // Poligon sebenar (FamaDaerah) jika nama daerah dipadankan; selainnya bulatan anggaran lama.
      const FD = window.FamaDaerah && window.FamaDaerah.sedia() ? window.FamaDaerah : null;
      const dipakai = new Map();
      const feats = [];
      if (p && !ivWithheld[p.id])
        IV_DISTRICTS.filter((d) => d.poId === p.id).forEach((d) => {
          const rf = FD && FD.fitur(d.negeri, d.name);
          const sel = d.districtId === s.selectedDistrictId ? 1 : 0;
          if (rf && dipakai.has(rf)) {
            if (sel) dipakai.get(rf).properties.sel = 1;
            return;
          }
          if (FD && !rf)
            console.debug('Daerah tiada padanan GeoJSON, guna kawasan anggaran:', d.name);
          const f = {
            type: 'Feature',
            properties: {
              name: rf ? d.name : d.name + ' (anggaran)',
              lvl: districtLevel(d.districtId),
              sel,
            },
            geometry: rf
              ? rf.geometry
              : { type: 'Polygon', coordinates: [circlePoly(d.lon, d.lat, 10)] },
          };
          if (rf) dipakai.set(rf, f);
          feats.push(f);
        });
      const data = { type: 'FeatureCollection', features: feats };
      // Kawasan Kritikal berdenyut lembut (tiada denyut jika pengguna pilih kurang gerak)
      if (window.FamaDaerah)
        window.FamaDaerah.denyut(
          ivMap,
          'iv-districts-denyut',
          feats.some((f) => f.properties.lvl === 'kritikal'),
        );
      const src = ivMap.getSource('iv-districts');
      if (src) {
        src.setData(data);
        return;
      }
      ivMap.addSource('iv-districts', { type: 'geojson', data });
      const col = [
        'match',
        ['get', 'lvl'],
        'kritikal',
        '#ff4e63',
        'waspada',
        '#ffbd43',
        'normal',
        '#22d88a',
        '#7f9bb8',
      ];
      ivMap.addLayer({
        id: 'iv-districts-fill',
        type: 'fill',
        source: 'iv-districts',
        paint: { 'fill-color': col, 'fill-opacity': 0.28 },
      });
      ivMap.addLayer({
        id: 'iv-districts-denyut',
        type: 'fill',
        source: 'iv-districts',
        filter: ['==', ['get', 'lvl'], 'kritikal'],
        paint: { 'fill-color': '#ff4e63', 'fill-opacity': 0.14 },
      });
      ivMap.addLayer({
        id: 'iv-districts-line',
        type: 'line',
        source: 'iv-districts',
        paint: {
          'line-color': col,
          'line-width': ['case', ['==', ['get', 'sel'], 1], 3.5, 2],
          'line-dasharray': [2, 2],
        },
      });
    } catch (err) {
      console.warn('Lapisan kawasan daerah gagal', err);
    }
  }
  window.addEventListener('fama-daerah-sedia', ivDrawDistrictLayer);
  function outletPopupNode(o) {
    const n = mkEl('div', '');
    n.append(mkEl('strong', '', o.nama));
    const dl = mkEl('dl');
    const row = (k, v) => {
      dl.append(mkEl('dt', '', k), mkEl('dd', '', v));
    };
    row('Jenis', IV_CATBY[o.kategori].label);
    row('Negeri', o.negeri);
    row('Daerah', o.districtName);
    row('PO penyelia', o.supervisingPOId ? poName(o.supervisingPOId) : 'Belum disahkan');
    row('Koordinat (anggaran)', o.lat.toFixed(3) + ', ' + o.lon.toFixed(3));
    row('Status operasi', o.status);
    row('Komoditi berkaitan', o.komoditiBerkaitan.map(commName).join(', '));
    row('Data', 'DATA DUMMY');
    n.append(dl);
    return n;
  }
  function visibleOutlets() {
    const s = ivState,
      p = s.selectedPOId;
    if (!p || ivWithheld[p]) return [];
    let l = outletsOfPO(p);
    if (s.selectedDistrictId) l = l.filter((o) => o.districtId === s.selectedDistrictId);
    return l;
  }
  /* ----- PO tambahan (FIS 2.1): penanda petak, status harga daripada /api/harga?aras=po_tambahan ----- */
  const TBHD = { sedia: false, memuat: false, rows: [] };
  const TBHQ = [
    { mod: 'pengeluar', aras: 'po_tambahan' },
    { peringkat: 'RUNCIT', aras: 'po_tambahan' },
  ];
  function ivTbhMuat() {
    if (!window.FamaPOT || !FamaPOT.bil() || TBHD.sedia || TBHD.memuat) return;
    TBHD.memuat = true;
    Promise.all(TBHQ.map((q) => HARGADB.ringkasan(q))).then(
      (rs) => {
        TBHD.rows = rs.flatMap((r) => r.baris || []);
        TBHD.sedia = true;
        TBHD.memuat = false;
        ivRenderMapMarkers();
      },
      () => {
        TBHD.memuat = false;
      },
    );
  }
  function ivTbhInfo(p) {
    let t = null;
    TBHD.rows.forEach((r) => {
      if (r.po === p.id && (!t || HARGADB.BOBOT[r.status] > HARGADB.BOBOT[t.status])) t = r;
    });
    const st = t ? t.status : 'kelabu';
    return { status: st, statusTeks: labels[st], sebab: t ? t.sebab : null };
  }
  function ivRenderTbhMarkers() {
    if (!ivMap || !window.FamaPOT || !FamaPOT.tunjuk()) return;
    ivTbhMuat();
    const s = ivState;
    FamaPOT.senarai().forEach((p) => {
      const inf = ivTbhInfo(p);
      const el = FamaPOT.penanda(p, inf.status, inf.statusTeks, { kecil: !!s.selectedPOId });
      FamaPOT.pasangHover(ivMap, el, p, () => ivTbhInfo(p));
      const go = () => {
        if (IV_TBHBY[p.id]) ivDispatch('setMobAnchor', p.id);
        if (ivPopup) ivPopup.remove();
        ivPopup = null;
        FamaPOT.tutup();
        FamaPOT.sorot(ivMap, p);
        // Pop-up dibuka selepas peta zum supaya anchor dan kedudukannya muat dalam kotak peta
        ivMap.once('moveend', () => {
          if (ivPopup) ivPopup.remove();
          // Peranti sentuh tiada hover: pop-up kekal dibuka sehingga diketik di tempat lain
          if (FamaPOT.sentuh()) ivPopup = FamaPOT.bukaPopup(ivMap, p, ivTbhInfo(p));
        });
        ivMap.fitBounds(FamaPOT.sempadan(p), {
          padding: { top: 40, left: 60, right: 60, bottom: 220 },
          maxZoom: 10,
          duration: 700,
        });
      };
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        go();
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          go();
        }
      });
      ivTbhMk.push(
        new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lon, p.lat])
          .addTo(ivMap),
      );
    });
  }
  let ivTbhMk = [];
  window.addEventListener('fama-po-tambahan', () => ivRenderMapMarkers());
  function ivRenderMapMarkers() {
    ivTbhMk.forEach((m) => m.remove());
    ivTbhMk = [];
    if (window.FamaPOT) FamaPOT.tutup();
    if (ivMap && window.FamaPOT) FamaPOT.sorot(ivMap, null);
    ivPoMk.forEach((m) => m.remove());
    ivDistMk.forEach((m) => m.remove());
    ivOutMk.forEach((m) => m.remove());
    ivPoMk = [];
    ivDistMk = [];
    ivOutMk = [];
    if (ivPopup) {
      ivPopup.remove();
      ivPopup = null;
    }
    if (!ivMap) return;
    const s = ivState;
    // PO tambahan (petak) dahulu supaya berada di bawah penanda PO utama
    ivRenderTbhMarkers();
    IV_PO.forEach((p) => {
      const lvl = poLevel(p.id),
        sel = s.selectedPOId === p.id,
        pass = poPasses(p, lvl);
      const show = s.selectedPOId ? s.selectedRisk === 'all' || lvl === s.selectedRisk : pass;
      if (!show && !sel) return;
      const el = mkEl(
        'div',
        `po-marker iv-po-marker status-${STATUS_CLS[lvl]}${sel ? ' iv-sel' : ''}${!pass ? ' iv-outside' : ''}${s.selectedPOId && !sel ? ' compact' : ''}`,
      );
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${p.name}, ${LV_LABEL[lvl]}`);
      el.title = `${p.name} · ${LV_LABEL[lvl]} (lokasi anggaran bandar)`;
      el.dataset.ivPo = p.id;
      el.append(mkEl('span', 'halo'), mkEl('span', 'core'));
      if (!s.selectedPOId) {
        const [sauh, lx = 0, ly = 0] = IV_CONFIG.labelShift[p.id] || ['r'];
        const t = mkEl('span', `map-label po-label sauh-${sauh}`, p.label);
        t.style.setProperty('--lx', lx + 'px');
        t.style.setProperty('--ly', ly + 'px');
        el.append(t);
      }
      const go = () => ivDispatch('selectPO', p.id);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        go();
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          go();
        }
      });
      ivPoMk.push(
        new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([p.lon, p.lat])
          .addTo(ivMap),
      );
    });
    const p = s.selectedPOId && IV_POBY[s.selectedPOId];
    if (p && !ivWithheld[p.id]) {
      IV_DISTRICTS.filter((d) => d.poId === p.id).forEach((d) => {
        const lv = districtLevel(d.districtId);
        const el = mkEl(
          'div',
          `iv-dist status-${lv === 'tiada' ? 'tiada' : STATUS_CLS[lv]}${s.selectedDistrictId === d.districtId ? ' iv-sel' : ''}`,
        );
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `Daerah ${d.name} (kawasan anggaran)`);
        el.dataset.ivDist = d.districtId;
        el.append(mkEl('span', 'dot-core'), mkEl('span', 'map-label', d.name));
        const go = () => ivDispatch('selectDistrict', d.districtId);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          go();
        });
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            go();
          }
        });
        ivDistMk.push(
          new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([d.lon, d.lat])
            .addTo(ivMap),
        );
      });
      visibleOutlets()
        .filter((o) => s.outletCats[o.kategori])
        .forEach((o) => {
          const el = mkEl(
            'button',
            'iv-out c-' + o.kategori + (s.selectedOutletId === o.outletId ? ' iv-sel' : ''),
          );
          el.type = 'button';
          el.append(mkEl('span', '', IV_CATBY[o.kategori].glyph));
          el.setAttribute('aria-label', `${o.nama}, ${IV_CATBY[o.kategori].label}`);
          el.title = o.nama;
          el.dataset.ivOutlet = o.outletId;
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            s.selectedOutletId = o.outletId;
            if (ivPopup) ivPopup.remove();
            ivPopup = new maplibregl.Popup({ offset: 16, maxWidth: '260px', className: 'iv-popup' })
              .setLngLat([o.lon, o.lat])
              .setDOMContent(outletPopupNode(o))
              .addTo(ivMap);
          });
          ivOutMk.push(
            new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat([o.lon, o.lat])
              .addTo(ivMap),
          );
        });
    }
  }
  function ivRenderMap() {
    const s = ivState;
    $i('ivModePengeluar').setAttribute('aria-selected', String(s.selectedMode === 'pengeluar'));
    $i('ivModePengguna').setAttribute('aria-selected', String(s.selectedMode === 'pengguna'));
    $i('ivMapHint').textContent =
      s.selectedMode === 'pengeluar'
        ? 'Penunjuk: Harga Borong · amaran apabila harga turun'
        : 'Penunjuk: Harga Runcit · amaran apabila harga naik';
    $i('ivMapBack').hidden = !s.selectedPOId;
    const cnt = { normal: 0, waspada: 0, kritikal: 0, tiada: 0 };
    IV_PO.forEach((p) => cnt[poLevel(p.id)]++);
    const sel = s.selectedPOId ? IV_POBY[s.selectedPOId] : null;
    const outside = sel && !poPasses(sel, poLevel(sel.id));
    $i('ivMapChips').innerHTML =
      chip('Kritikal ' + cnt.kritikal, 'bad') +
      chip('Waspada ' + cnt.waspada, 'warn') +
      chip('Normal ' + cnt.normal, 'ok') +
      chip('Tiada ambang ' + cnt.tiada, 'grey') +
      (outside ? chip('Terpilih (di luar penapis)', 'info') : '') +
      (sel ? chip(sel.name, 'info') : '') +
      (s.mob.anchorTbh && IV_TBHBY[s.mob.anchorTbh]
        ? `<button type="button" class="iv-chip info" data-iv-act="openMob">Mobilisasi dari ${E(IV_TBHBY[s.mob.anchorTbh].name)}</button>`
        : '') +
      notApplicable('map');
    const outs =
      sel && !ivWithheld[sel.id]
        ? outletsOfPO(sel.id).filter(
            (o) => !s.selectedDistrictId || o.districtId === s.selectedDistrictId,
          )
        : [];
    $i('ivOutletChips').innerHTML = IV_CATS.map(
      (c) =>
        `<button type="button" class="iv-chip" aria-pressed="${s.outletCats[c.id]}" data-iv-act="outCat" data-iv-arg="${c.id}"><i class="iv-leg-i c-${c.id}"></i>${c.label} (${outs.filter((o) => o.kategori === c.id).length})</button>`,
    ).join('');
    $i('ivLegend').innerHTML =
      IV_CATS.map((c) => `<span><i class="iv-leg-i c-${c.id}"></i>${c.label}</span>`).join('') +
      `<span><i class="iv-dot g"></i>Normal</span><span><i class="iv-dot y"></i>Waspada</span><span><i class="iv-dot r"></i>Merah: kritikal (amaran harga, sama dengan Pemantauan)</span><span><i class="iv-dot n"></i>Kelabu: tiada ambang</span>` +
      (window.FamaPOT && FamaPOT.bil()
        ? '<span><i class="tbh-leg" aria-hidden="true"></i>Petak = PO tambahan · Bulatan = PO utama</span>'
        : '');
    let dc = '';
    if (sel && !ivWithheld[sel.id]) {
      dc = IV_DISTRICTS.filter((d) => d.poId === sel.id)
        .map((d) => {
          const n = IV_OUTLETS.filter((o) => o.districtId === d.districtId).length;
          return `<button type="button" class="iv-chip" aria-pressed="${s.selectedDistrictId === d.districtId}" data-iv-act="district" data-iv-arg="${E(d.districtId)}">${E(d.name)} · ${n ? n + ' outlet' : 'Tiada outlet dalam daerah ini'}</button>`;
        })
        .join('');
    }
    $i('ivDistChips').innerHTML = dc;
    $i('ivUnmappedList').innerHTML = IV_OUTLETS.filter((o) => !o.supervisingPOId)
      .map((o) => `${E(o.nama)} · ${E(o.districtName)}, ${E(o.negeri)} ${tagD}`)
      .join('<br>');
    ivRenderMapBanner();
    if (ivMap) {
      ivRenderMapMarkers();
      ivDrawDistrictLayer();
    } else if (s.ui.mapError === 'fallback') ivRenderMapFallback();
  }

  /* ===== Penapis (toolbar) ===== */
  function notApplicable(panel) {
    const s = ivState;
    const act = [];
    const f = (n, on) => {
      if (on) act.push(n);
    };
    if (panel === 'log' || (panel === 'map' && false)) {
      f('Komoditi', !!(s.selectedCommodityId || s.selectedJenis));
      f('Negeri', !!s.selectedStateId);
      f('Daerah', !!s.selectedDistrictId);
      f('Tempoh', s.selectedDateRange.days !== 30);
      f('Tahap Risiko', s.selectedRisk !== 'all');
    }
    if (panel === 'mob' || panel === 'mar') {
      f('Negeri', !!s.selectedStateId);
      f('Daerah', !!s.selectedDistrictId);
      f('Tahap Risiko', s.selectedRisk !== 'all');
    }
    if (panel === 'muse') {
      f('Tempoh', s.selectedDateRange.days !== 30);
    }
    return act.length ? chip('Penapis tidak terpakai: ' + act.join(', '), 'grey') : '';
  }
  function fillSel(id, opts, val, mati) {
    const e = $i(id);
    const h = opts
      .map(
        ([v, l, off]) =>
          `<option value="${E(v)}"${v === val ? ' selected' : ''}${off ? ' disabled' : ''}>${E(l)}</option>`,
      )
      .join('');
    if (e.dataset.sig !== h) {
      e.innerHTML = h;
      e.dataset.sig = h;
    }
    e.value = val;
    if (mati !== undefined) e.disabled = !!mati;
  }
  // Teks keadaan data harga (memuat / ralat / file://); '' bila sedia.
  function ivHargaMesej() {
    if (IVH.sedia) return '';
    if (IVH.ralat === 'file' || HARGADB.keadaan === 'file')
      return 'Data harga sebenar memerlukan npm start (tidak tersedia pada file://).';
    if (IVH.ralat) return 'Data harga tidak dapat dimuatkan.';
    return 'Memuat harga…';
  }
  // Lencana tarikh data, lapuk dan minggu separa + blok keadaan; sama dengan tab Pemantauan.
  function ivRenderHargaBar() {
    const lc = $i('ivHargaLencana'),
      k = $i('ivHargaKeadaan');
    if (lc) {
      const b = [];
      const t = HARGADB.terkini;
      if (t)
        b.push(
          HARGADB.lapuk
            ? `<span class="harga-lencana lapuk" title="Data terkini lebih lapan hari lalu">⚠ Data lapuk · terkini ${E(t)}</span>`
            : `<span class="harga-lencana">Data harga terkini: ${E(t)}</span>`,
        );
      if (HARGADB.mingguSeparaIso)
        b.push(
          `<span class="harga-lencana separa" title="Minggu ISO semasa belum lengkap dan tidak dinilai">Minggu semasa: separa (${E(HARGADB.mingguSeparaIso)})</span>`,
        );
      lc.innerHTML = b.join('');
    }
    if (!k) return;
    const msg = ivHargaMesej();
    const ralat = !IVH.sedia && (IVH.ralat || HARGADB.keadaan === 'file');
    k.hidden = !msg;
    k.className = 'harga-keadaan' + (ralat ? ' ralat' : '');
    if (!msg) {
      k.textContent = '';
      return;
    }
    const boleh = ralat && IVH.ralat !== 'file' && HARGADB.keadaan !== 'file';
    k.innerHTML = `<span>${E(msg)}</span>${boleh ? '<button type="button" class="button tiny ghost" id="ivHargaCubaSemula" data-iv-act="hargaRetry">Cuba semula</button>' : ''}`;
  }
  function ivRenderFilters() {
    ivRenderHargaBar();
    const s = ivState;
    fillSel(
      'ivFKomoditi',
      [['all', 'Semua komoditi'], ...IV_JENIS.map((j) => [j.kod, j.label])],
      s.selectedJenis || 'all',
    );
    const vs = s.selectedJenis ? IV_COMM.filter((c) => c.jenis === s.selectedJenis) : [];
    fillSel(
      'ivFVarieti',
      vs.length
        ? [
            ['all', 'Semua varieti'],
            ...vs.map((c) => [c.id, c.name + (c.tiadaData ? ' (tiada data)' : ''), c.tiadaData]),
          ]
        : [['all', 'Pilih komoditi']],
      s.selectedCommodityId || 'all',
      !vs.length,
    );
    fillSel(
      'ivFNegeri',
      [['all', 'Semua negeri'], ...IV_STATES.map((x) => [x.id, x.name])],
      s.selectedStateId || 'all',
    );
    let pos = IV_PO.filter((p) => !s.selectedStateId || p.stateId === s.selectedStateId);
    const out =
      s.selectedPOId && !pos.some((p) => p.id === s.selectedPOId) ? IV_POBY[s.selectedPOId] : null;
    fillSel(
      'ivFPO',
      [
        ['all', 'Semua PO'],
        ...pos.map((p) => [p.id, p.name]),
        ...(out ? [[out.id, out.name + ' (di luar penapis)']] : []),
      ],
      s.selectedPOId || 'all',
    );
    let ds = IV_DISTRICTS.filter((d) =>
      s.selectedPOId
        ? d.poId === s.selectedPOId
        : !s.selectedStateId || d.stateId === s.selectedStateId,
    );
    if (
      s.selectedDistrictId &&
      !ds.some((d) => d.districtId === s.selectedDistrictId) &&
      IV_DISTBY[s.selectedDistrictId]
    )
      ds = [...ds, IV_DISTBY[s.selectedDistrictId]];
    fillSel(
      'ivFDaerah',
      [['all', 'Semua daerah'], ...ds.map((d) => [d.districtId, d.name])],
      s.selectedDistrictId || 'all',
    );
    // Penapis Tarikh / Tempoh Analisis dibuang daripada UI; tempoh kekal lalai 30 hari.
    if ($i('ivFTempoh')) $i('ivFTempoh').value = String(s.selectedDateRange.days);
    $i('ivFRisiko').value = s.selectedRisk;
    const nAktif =
      [s.selectedJenis, s.selectedStateId, s.selectedPOId, s.selectedDistrictId].filter(Boolean)
        .length +
      (s.selectedDateRange.days !== 30 ? 1 : 0) +
      (s.selectedRisk !== 'all' ? 1 : 0);
    const rb = $i('ivResetBadge');
    rb.hidden = !nAktif;
    rb.textContent = String(nAktif);
    const rs = $i('ivReset');
    rs.dataset.idle = nAktif ? 'false' : 'true';
    rs.setAttribute(
      'aria-label',
      nAktif ? 'Set semula penapis (' + nAktif + ' aktif)' : 'Set semula penapis',
    );
    const t = IV_CONFIG.thresholds;
    [
      ['ivThrPW', Math.abs(t.pengeluar.warnPct)],
      ['ivThrPC', Math.abs(t.pengeluar.critPct)],
      ['ivThrGW', Math.abs(t.pengguna.warnPct)],
      ['ivThrGC', Math.abs(t.pengguna.critPct)],
    ].forEach(([id, v]) => {
      const e = $i(id);
      if (document.activeElement !== e) {
        e.value = v;
        e.removeAttribute('aria-invalid');
      }
    });
  }

  /* ===== Paparan 2 ===== */
  const ICON_TRUCK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 6h11v9H2zM13 9h4l3 3v3h-7z"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>';
  const ICON_SNOW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 2v20M4 7l16 10M20 7L4 17M9 3l3 3 3-3M9 21l3-3 3 3"/></svg>';
  const ICON_WH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 10l9-6 9 6v10H3z"/><path d="M8 20v-6h8v6"/></svg>';
  function logTotals(pos) {
    const has = (p) =>
      p.logistik &&
      ['kenderaan', 'muatanMT', 'bilikSejuk', 'kapasitiSimpananMT'].every((k) =>
        fin(p.logistik[k]),
      );
    const withData = pos.filter(has),
      noData = pos.filter((p) => !has(p));
    const groups = new Map();
    withData.forEach((p) => {
      if (!groups.has(p.group)) groups.set(p.group, { id: p.group, l: p.logistik, pos: [] });
      groups.get(p.group).pos.push(p);
    });
    const G = [...groups.values()],
      sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    const cov = G.filter((g) => IV_LOGISTICS_AVAIL[g.id]);
    const tot = {
      kenderaan: sum(G, (g) => g.l.kenderaan),
      muatan: sum(G, (g) => g.l.muatanMT),
      bilikSejuk: sum(G, (g) => g.l.bilikSejuk),
      simpanan: sum(G, (g) => g.l.kapasitiSimpananMT),
    };
    const av = {
      groups: cov.length,
      kenderaanMax: sum(cov, (g) => g.l.kenderaan),
      simpananMax: sum(cov, (g) => g.l.kapasitiSimpananMT),
      vehicles: sum(cov, (g) => IV_LOGISTICS_AVAIL[g.id].availableVehicleCount),
      space: sum(cov, (g) => IV_LOGISTICS_AVAIL[g.id].availableCapacityMT),
      stock: sum(cov, (g) => IV_LOGISTICS_AVAIL[g.id].actualStockMT),
    };
    return { withData, noData, groups: G, shared: G.filter((g) => g.pos.length > 1), tot, av };
  }
  function ivRenderLogTotal(body, ch, nt) {
    const s = ivState,
      st = s.selectedStateId ? IV_STATES.find((x) => x.id === s.selectedStateId) : null;
    const pos = IV_PO.filter((p) => !st || p.stateId === st.id),
      T = logTotals(pos);
    const scope = st
      ? `Jumlah Negeri ${st.name} (${pos.length} PO)`
      : `Jumlah Keseluruhan (${pos.length} PO)`;
    nt.textContent = scope + ' · tiada PO dipilih.';
    const tile = (ico, v, l) =>
      `<div class="iv-stat">${ico}<div><b>${v}</b><span>${l}</span></div></div>`;
    let rd = { state: 'tidak-dinilai', label: 'Kesiapsiagaan tidak dapat dinilai' };
    if (T.av.groups)
      rd = readiness({
        availableVehicleCount: T.av.vehicles,
        kenderaanMax: T.av.kenderaanMax,
        availableCapacityMT: T.av.space,
        simpananMaxMT: T.av.simpananMax,
      });
    const rc =
      rd.state === 'sedia'
        ? 'ok'
        : rd.state === 'terhad'
          ? 'warn'
          : rd.state === 'kritikal'
            ? 'bad'
            : 'grey';
    ch.innerHTML = chip(rd.label, rc) + notApplicable('log');
    if (!pos.length) {
      body.innerHTML =
        '<div class="iv-empty" id="ivLogTotal">Tiada PO dalam skop penapis ini</div>';
      return;
    }
    let h = `<div id="ivLogTotal"><div class="iv-chips"><b>${E(scope)}</b></div>
 <div class="iv-note">Dikira daripada ${T.withData.length} daripada ${pos.length} PO${T.noData.length ? `; ${T.noData.length} PO belum mempunyai data logistik (dikecualikan, tiada nilai direka)` : ''}. Pilih PO pada peta untuk melihat butiran PO.</div>
 <div class="iv-sec">JUMLAH KAPASITI MAKSIMUM STATIK</div><div class="iv-stats" id="ivLogTotStats">${tile(ICON_TRUCK, T.tot.kenderaan, 'Bilangan Kenderaan')}${tile(ICON_TRUCK, f2(T.tot.muatan), 'Kapasiti Muatan (MT)')}${tile(ICON_SNOW, T.tot.bilikSejuk, 'Bilangan Bilik Sejuk')}${tile(ICON_WH, f2(T.tot.simpanan), 'Kapasiti Simpanan (MT)')}</div>`;
    if (T.shared.length)
      h += `<div class="iv-banner info" id="ivLogTotGrp">Rekod logistik dikongsi: ${E(T.shared.map((g) => g.pos.map((x) => x.name).join(' dan ')).join('; '))}. Kapasiti kumpulan dikira sekali sahaja, tidak digandakan.</div>`;
    const IV_SHOW_AVAIL = false; // ubah kepada true untuk papar semula "Ketersediaan Semasa"
    if (IV_SHOW_AVAIL) {
      h += `<div class="iv-sec">KETERSEDIAAN SEMASA ${tagD}</div>`;
      if (!T.av.groups)
        h += `<div class="iv-empty" id="ivLogNull">Data ketersediaan semasa belum tersedia</div>`;
      else
        h += `<div class="iv-stats" id="ivLogTotAvail">${tile(ICON_TRUCK, T.av.vehicles, 'Kenderaan tersedia (daripada ' + T.av.kenderaanMax + ')')}${tile(ICON_WH, T.av.space.toFixed(1), 'Ruang simpanan kosong (MT)')}${tile(ICON_WH, T.av.stock.toFixed(1), 'Stok sebenar disimpan (MT)')}${tile(ICON_SNOW, T.av.simpananMax.toFixed(1), 'Simpanan maksimum (MT)')}</div><div class="iv-note">Hanya ${T.av.groups} daripada ${T.groups.length} kumpulan logistik mempunyai data ketersediaan semasa; yang lain belum tersedia dan tidak disimpulkan daripada kapasiti maksimum. Kesiapsiagaan dinilai daripada kumpulan berdata sahaja. Dikemas kini ${E(myDate(IV_UPD))} (dummy).</div>`;
    }
    const IV_SHOW_PO_BREAKDOWN = false; // ubah kepada true untuk papar semula "Pecahan mengikut PO"
    if (IV_SHOW_PO_BREAKDOWN)
      h += `<details class="iv-brk" id="ivLogBrk" open><summary>Pecahan mengikut PO (${pos.length})</summary><div class="iv-brk-list">${pos
        .map((p) => {
          const d = T.withData.includes(p),
            l = p.logistik;
          const sh = d && T.groups.find((g) => g.id === p.group).pos.length > 1;
          return `<button type="button" class="iv-brk-row" data-iv-act="selPO" data-iv-arg="${E(p.id)}"><b>${E(p.name)}</b><span>${d ? `${l.kenderaan} kenderaan · ${f2(l.muatanMT)} MT · ${l.bilikSejuk} bilik sejuk · ${f2(l.kapasitiSimpananMT)} MT simpanan${sh ? ' (gabungan kumpulan)' : ''}` : 'Belum mempunyai data logistik'}</span></button>`;
        })
        .join('')}</div></details>`;
    h += `</div>`;
    body.innerHTML = h;
  }
  function ivRenderLog() {
    const id = effPO(),
      body = $i('ivLogBody'),
      ch = $i('ivLogChips');
    const nt = $i('ivLogNote');
    if (!id) {
      ivRenderLogTotal(body, ch, nt);
      return;
    }
    nt.textContent = 'Kenderaan, muatan, bilik sejuk dan simpanan PO terpilih.';
    const p = IV_POBY[id],
      lg = logisticsOf(id),
      rd = readiness(lg);
    const rc =
      rd.state === 'sedia'
        ? 'ok'
        : rd.state === 'terhad'
          ? 'warn'
          : rd.state === 'kritikal'
            ? 'bad'
            : 'grey';
    ch.innerHTML = chip(rd.label, rc) + notApplicable('log');
    const names = lg.groupMemberPOIds.map(poName);
    const tile = (ico, v, l) =>
      `<div class="iv-stat">${ico}<div><b>${v}</b><span>${l}</span></div></div>`;
    let h = `<div class="iv-chips"><b>${E(p.name)}</b>${chip(p.negeri)}</div>
 <div class="iv-sec">KAPASITI MAKSIMUM STATIK</div><div class="iv-stats">${tile(ICON_TRUCK, lg.kenderaanMax, 'Bilangan Kenderaan')}${tile(ICON_TRUCK, f2(lg.muatanMaxMT), 'Kapasiti Muatan (MT)')}${tile(ICON_SNOW, lg.bilikSejukMax, 'Bilangan Bilik Sejuk')}${tile(ICON_WH, f2(lg.simpananMaxMT), 'Kapasiti Simpanan (MT)')}</div>`;
    if (lg.groupShared)
      h += `<div class="iv-banner info">Angka gabungan ${E(names.join(' dan '))}. Tidak digandakan. ${lg.groupMemberPOIds
        .filter((x) => x !== id)
        .map(
          (x) =>
            `<button type="button" class="iv-chip info" data-iv-act="selPO" data-iv-arg="${E(x)}">Lihat ${E(poName(x))}</button>`,
        )
        .join(' ')}</div>`;
    const IV_SHOW_AVAIL = false; // ubah kepada true untuk papar semula "Ketersediaan Semasa"
    if (IV_SHOW_AVAIL) {
      h += `<div class="iv-sec">KETERSEDIAAN SEMASA ${tagD}</div>`;
      if (lg.availableVehicleCount == null && lg.availableCapacityMT == null)
        h += `<div class="iv-empty" id="ivLogNull">Data ketersediaan semasa belum tersedia</div>`;
      else
        h += `<div class="iv-stats">${tile(ICON_TRUCK, lg.availableVehicleCount, 'Kenderaan tersedia (daripada ' + lg.kenderaanMax + ')')}${tile(ICON_WH, lg.availableCapacityMT.toFixed(1), 'Ruang simpanan kosong (MT)')}${tile(ICON_WH, lg.actualStockMT.toFixed(1), 'Stok sebenar disimpan (MT)')}${tile(ICON_SNOW, lg.simpananMaxMT.toFixed(1), 'Simpanan maksimum (MT)')}</div><div class="iv-note">Dikemas kini ${E(myDate(lg.availabilityUpdated))} (dummy). Ketersediaan tidak pernah disimpulkan daripada kapasiti maksimum.</div>`;
    }
    body.innerHTML = h;
  }

  /* ===== Paparan 3 ===== */
  let _priBannerSeq = 0;
  async function ivRecommendBanner(r) {
    const seq = ++_priBannerSeq;
    const fb = `Cadangan: ${r.cls.level === 'kritikal' ? 'utamakan' : 'pantau'} ${r.commodity} di ${r.district} (${r.poName}). ${intervType(r)}.`;
    const res = await callAI('recommendPriority', { text: fb }, fb);
    if (seq !== _priBannerSeq || !ivState.ui.priBanner || ivState.ui.priBanner.id !== r.id) return;
    ivState.ui.priBanner = { id: r.id, text: res.text, loading: false, ai: res.ai };
    ivRender(['pri']);
  }
  // Pengeluar tanpa harga ladang: tiada alarm; harga borong dipaparkan sebagai ganti berlabel (aras PO).
  function ivGantiHTML() {
    const s = ivState;
    if (!IVH.sedia || s.selectedMode !== 'pengeluar') return '';
    const idx = IVH.idxPO.LADANG;
    if (!idx) return '';
    const items = [];
    IV_PO.forEach((p) => {
      if (s.selectedStateId && p.stateId !== s.selectedStateId) return;
      if (s.selectedPOId && p.id !== s.selectedPOId) return;
      IV_COMM.forEach((c) => {
        if (!commOk(c.id)) return;
        const rw = ivPoRow(p.id, c.id, 'Ladang');
        if (rw && !fin(rw.harga) && rw.ganti && fin(rw.ganti.harga))
          items.push(
            `<li>${E(c.name)} · ${E(p.name)}: Tiada harga ladang · ${E(rw.ganti.label)}: ${rmAny(rw.ganti.harga)}</li>`,
          );
      });
    });
    return items.length
      ? `<div class="iv-ganti" id="ivPriGanti"><b>Tiada harga ladang (${items.length})</b><ul>${items.slice(0, 8).join('')}</ul>${items.length > 8 ? `<div>…dan ${items.length - 8} lagi</div>` : ''}</div>`
      : '';
  }
  function ivRenderPri() {
    const s = ivState,
      rows = priRows();
    const list = $i('ivPriList');
    const shown = s.ui.showAll ? rows : rows.slice(0, 12);
    $i('ivPriChips').innerHTML =
      chip('Mod: ' + modeLbl(s.selectedMode), 'info') +
      chip('Harga ' + (s.selectedMode === 'pengeluar' ? 'Borong' : 'Runcit'), 'grey') +
      chip(rows.length + ' isu', rows.length ? 'warn' : 'ok') +
      (IVH.sedia
        ? chip('Tiada ambang ' + recsNow().filter((r) => r.cls.noThreshold).length, 'grey')
        : '') +
      tagH +
      tagD;
    const bn = s.ui.priBanner;
    let bh = '';
    if (bn) {
      bh = `<div class="iv-banner info" id="ivPriBannerBox" tabindex="-1">${bn.loading ? 'Menyediakan cadangan…' : E(bn.text)} <button type="button" class="button tiny ghost" data-iv-act="openMob">Buka Mobilisasi Stok</button></div>`;
    }
    $i('ivPriBanner').innerHTML = bh;
    if (!IVH.sedia) {
      list.innerHTML = `<div class="iv-empty" id="ivPriKeadaan">${E(ivHargaMesej())}</div>`;
    } else if (!rows.length) {
      list.innerHTML = '<div class="iv-empty">Tiada isu keutamaan untuk penapis ini</div>';
    } else
      list.innerHTML = shown
        .map((r) => {
          const lv = r.cls.level;
          const tel = !isKg(r.commodityId);
          return `<div class="iv-row" role="button" tabindex="0" aria-pressed="${s.selectedInterventionId === r.id}" data-iv-act="selRow" data-iv-arg="${E(r.id)}">
   <div class="iv-r1"><span class="iv-lv ${lv}">${LV_LABEL[lv]}</span><b class="iv-r-com">${E(r.commodity)}</b><span class="iv-r-loc">${E(r.district)}, ${E(r.negeri)}</span><span class="iv-r-score" title="Komponen skor: harga ${(r.comp.P * 100).toFixed(0)}%, bekalan ${(r.comp.S * 100).toFixed(0)}%, forecast ${(r.comp.F * 100).toFixed(0)}%, pengesahan ${(r.comp.C * 100).toFixed(0)}%">Skor ${r.score}</span></div>
   <div class="iv-r2">${E(r.poName)} · <b>Jenis isu:</b> ${E(issueLabel(r))}</div>
   <div class="iv-r3" title="${E(r.price.windowLabel)} · sumber DB Harga (/api/harga), sama dengan Pemantauan">${hargaRingkas(r.price)} · Ramalan: tiada (prototaip)</div>
   <div class="iv-r4"><div class="iv-r-int"><span><b>Intervensi:</b> ${E(intervType(r))}</span>${r.cls.flag ? chip(r.cls.flag, 'warn') : ''}${statusKongsiChips(r)}${tel ? chip('Telur: bekalan dalam unit lain, tidak dinilai', 'grey') : ''}</div><button type="button" class="button tiny iv-act" data-iv-act="tindakan" data-iv-arg="${E(r.id)}">Tindakan</button></div></div>`;
        })
        .join('');
    const pend = rows.filter((r) => r.cls.flag === 'Menunggu pengesahan bekalan').length;
    let foot = '';
    if (rows.length > 12)
      foot += `<button type="button" class="button tiny ghost" data-iv-act="showAll">${s.ui.showAll ? 'Papar 12 teratas' : 'Papar semua (' + rows.length + ')'}</button> `;
    if (pend) foot += `${pend} isu harga menunggu pengesahan bekalan. `;
    foot += 'Skor ialah indeks keutamaan prototaip, bukan kebarangkalian.';
    foot +=
      ' Harga sebenar (DB Harga), minggu ISO lengkap terkini, sama dengan Pemantauan; bekalan, stok dan logistik ialah data dummy.';
    // Ganti borong untuk Pengeluar tanpa harga ladang tidak lagi relevan: mod Bekalan menilai harga borong terus
    if (MODE_STAGE.pengeluar === 'Ladang') foot += ivGantiHTML();
    $i('ivPriFoot').innerHTML = foot;
  }

  /* ===== Paparan 4 ===== */
  // PO terpilih mobilisasi: PO tambahan (dipilih pada peta atau senarai) atau PO utama seperti biasa.
  function mobPO() {
    const t = ivState.mob.anchorTbh;
    return t && IV_TBHBY[t] ? t : effPO();
  }
  function mobResolve() {
    const s = ivState,
      po = mobPO(),
      cm = effCommodity(),
      mode = s.selectedMode;
    const row = po && isKg(cm.id) ? supplyRow(po, cm.id) : null;
    const defNeed = row ? (mode === 'pengeluar' ? row.surplusMT : row.shortageMT) : 0;
    const ap = po ? ivPrice(po, cm.id, 'Borong') : null;
    const need = s.mob.needMT != null ? s.mob.needMT : defNeed > 0 ? +defNeed.toFixed(1) : 1;
    const ref = s.mob.refPrice != null ? s.mob.refPrice : ap ? +ap.actual.toFixed(2) : null;
    return {
      po,
      cm,
      mode,
      row,
      defNeed,
      need,
      ref,
      anchorPrice: ap,
      needDefault: s.mob.needMT == null,
      refDefault: s.mob.refPrice == null,
    };
  }
  function curEngine() {
    const r = mobResolve();
    if (!r.po || r.ref == null) return null;
    return mobilisationEngine({
      mode: r.mode,
      anchorPOId: r.po,
      commodityId: r.cm.id,
      needMT: r.need,
      refPrice: r.ref,
      wPrice: ivState.mob.wPrice,
      distLimitKm: ivState.mob.distLimitKm,
      days: ivState.selectedDateRange.days,
      now: nowMs(),
    });
  }
  // Kawalan mobilisasi yang dipaparkan. Disembunyikan: Keperluan/lebihan (MT) dan wajaran harga/jarak; nilai lalai
  // (keperluan daripada data dummy, wajaran semasa ivState.mob.wPrice) masih dipakai oleh enjin.
  const IV_MOB_PAPAR = { keperluan: false, wajaran: false };
  function ivRenderMobCtl() {
    const s = ivState,
      r = mobResolve();
    const box = $i('ivMobCtl'),
      head = $i('ivMobHead');
    $i('ivMobChips').innerHTML =
      chip('Mod: ' + modeLbl(s.mode || s.selectedMode), 'info') + tagD + notApplicable('mob');
    if (!r.po) {
      head.innerHTML = '';
      box.innerHTML =
        '<div class="iv-empty">Pilih Pusat Operasi pada peta atau senarai keutamaan</div>';
      return;
    }
    const p = poObj(r.po);
    const kg = isKg(r.cm.id),
      unit = IV_COMMBY[r.cm.id].unit;
    const role = r.mode === 'pengeluar' ? 'PO SUMBER' : 'PO DESTINASI';
    const row = r.row;
    head.innerHTML = `<div class="iv-card"><div class="iv-chips"><span class="iv-chip info">${role}</span><b>${E(p.name)}</b>${chip(p.negeri)}${p.tambahan ? chip('PO tambahan · lokasi anggaran, tiada data logistik', 'warn') : ''}${chip(IV_COMMBY[r.cm.id].name)}${chip('Peringkat Borong', 'grey')}${kg ? '' : chip('Unit ' + unit + ': perbandingan harga sahaja, tiada kuantiti MT', 'info')}${r.cm.def ? chip('Komoditi panel: ' + IV_COMMBY[r.cm.id].name + ' (lalai, penapis ialah Semua)', 'warn') : ''}</div>
 <div class="iv-kv"><span title="${E(r.anchorPrice ? r.anchorPrice.windowLabel : '')}">Harga Borong PO (dari DB Harga)<b>${rmUnit(r.anchorPrice && r.anchorPrice.actual, r.cm.id)}</b></span><span>Bekalan<b>Tidak dinilai</b></span></div></div>`;
    const sig = [s.selectedMode, r.po, r.cm.id, s.selectedInterventionId].join('|');
    const pilihPO = `<label>PO terpilih<select class="iv-in" data-iv-sel="mobpo" aria-label="PO terpilih mobilisasi"><optgroup label="PO utama">${IV_PO.map((x) => `<option value="${E(x.id)}"${x.id === r.po ? ' selected' : ''}>${E(x.name)}</option>`).join('')}</optgroup>${IV_TBH.length ? `<optgroup label="PO tambahan">${IV_TBH.map((x) => `<option value="${E(x.id)}"${x.id === r.po ? ' selected' : ''}>${E(x.label)} (${E(x.negeri)})</option>`).join('')}</optgroup>` : ''}</select></label>`;
    const hints = () => {
      const a = $i('ivNeedHint'),
        b = $i('ivRefHint');
      if (a)
        a.innerHTML = r.needDefault
          ? 'dari data dummy'
          : 'ditetapkan pengguna <a href="#" data-iv-act="resetNeed">Pulih lalai</a>';
      if (b)
        b.innerHTML = r.refDefault
          ? 'lalai: harga Borong PO'
          : 'ditetapkan pengguna <a href="#" data-iv-act="resetRef">Pulih lalai</a>';
    };
    if (box.dataset.sig === sig && box.firstChild) {
      hints();
      return;
    }
    box.dataset.sig = sig;
    box.innerHTML = `<div class="iv-ctl">
  ${pilihPO}
  ${IV_MOB_PAPAR.keperluan && kg ? `<label>Keperluan/lebihan (MT)<input class="iv-in" type="number" id="ivNeed" data-iv-in="need" min="0.1" max="500" step="0.1" value="${r.need}"><span class="iv-err" id="ivNeedErr"></span><small id="ivNeedHint"></small></label>` : ''}
  <label>Harga rujukan pasaran (${E(unit)})<input class="iv-in" type="number" id="ivRef" data-iv-in="ref" min="0.01" max="999" step="0.01" value="${r.ref}"><span class="iv-err" id="ivRefErr"></span><small id="ivRefHint"></small></label>
  ${
    IV_MOB_PAPAR.wajaran
      ? `<label>Wajaran harga <b id="ivWPL">${s.mob.wPrice}%</b><input type="range" id="ivWP" data-iv-in="wp" min="0" max="100" step="5" value="${s.mob.wPrice}" aria-label="Wajaran harga"></label>
  <label>Wajaran jarak (%) <b id="ivWDL">${100 - s.mob.wPrice}%</b><input type="range" id="ivWD" data-iv-in="wd" min="0" max="100" step="5" value="${100 - s.mob.wPrice}" aria-label="Wajaran jarak"></label>`
      : ''
  }
  <label>Had jarak (km)<input class="iv-in" type="number" id="ivLimit" data-iv-in="limit" min="50" max="2000" step="10" value="${s.mob.distLimitKm}"><span class="iv-err" id="ivLimitErr"></span></label>
 </div>${IV_MOB_PAPAR.wajaran ? `<div class="iv-note" id="ivWTotal">Jumlah wajaran: <b>${s.mob.wPrice}% + ${100 - s.mob.wPrice}% = 100%</b></div>` : ''}`;
    hints();
  }
  function candCard(c, side, key) {
    const s = ivState;
    const lbl = s.selectedMode === 'pengguna' ? 'Lebihan stok' : 'Keperluan';
    const chips = [];
    if (c.tambahan) chips.push(chip('PO tambahan · lokasi anggaran', 'warn'));
    if (c.sameGroup) chips.push(chip('Kongsi kapasiti logistik (kumpulan gabungan)', 'info'));
    if (c.flood) chips.push(chip('Cuaca (Open-Meteo/MET)', 'warn'));
    if (c.banjir) chips.push(chip('Banjir (JPS)', 'warn'));
    return `<button type="button" class="iv-cand" aria-pressed="${s.mob.candidateKey === c.poId}" data-iv-act="cand" data-iv-arg="${E(c.poId)}" data-iv-side="${side}"><div class="iv-cand-h"><span>#${c.rank} ${E(c.name)}</span><span>Skor ${c.score}/100</span></div>
 <div class="iv-row-s">${E(c.negeri)}</div>
 <div class="iv-kv">${c.stockMT == null ? '' : `<span>${lbl}<b>${f2(c.stockMT)} MT</b></span>`}<span>Harga ${s.selectedMode === 'pengguna' ? 'sumber' : 'destinasi'}<b>${rmUnit(c.price, ivEffCid())}</b></span><span>Anggaran jarak<b>${Math.round(c.km)} km</b></span>${c.qty == null ? '' : `<span>Boleh dihantar<b>${f2(c.qty)} MT</b></span>`}</div>
 <div class="iv-chips" style="margin-top:6px">${chips.join('')}</div></button>`;
  }
  function ivEngineFacts(r, eng) {
    const top = eng.dalam[0] || eng.luar[0];
    if (!top) return null;
    return { top, inState: !!eng.dalam[0] };
  }
  let _mobAISeq = 0;
  const _aiCache = {};
  async function ivFillMobAI(r, eng) {
    const host = $i('ivMobAI');
    if (!host) return;
    const tf = ivEngineFacts(r, eng);
    if (!tf) {
      host.innerHTML = '';
      return;
    }
    const t = tf.top,
      m = r.mode;
    const fb = `Berdasarkan pengiraan, ${t.name} (${tf.inState ? 'dalam negeri' : 'luar negeri'}) ialah calon utama ${m === 'pengguna' ? 'sumber' : 'destinasi'} untuk ${commName(r.cm.id)}, ${t.qty == null ? 'dengan' : `dengan kuantiti boleh dihantar ${f2(t.qty)} MT,`} anggaran jarak ${Math.round(t.km)} km serta harga ${m === 'pengguna' ? 'sumber' : 'destinasi'} ${rmUnit(t.price, r.cm.id)}. Cadangan ini perlu disahkan oleh pegawai operasi.`;
    const key = JSON.stringify([fb]);
    const seq = ++_mobAISeq;
    if (_aiCache[key] && !failFlags.ai) {
      host.innerHTML = aiCard(_aiCache[key]);
      return;
    }
    host.innerHTML =
      '<div class="iv-ai" aria-busy="true"><h4>Ringkasan AI (simulasi, bukan keputusan)</h4><div class="iv-spin">Menjana ringkasan…</div></div>';
    const res = await callAI('explainMobilisation', { text: fb }, fb);
    if (seq !== _mobAISeq) return;
    const h = $i('ivMobAI');
    if (!h) return;
    const o = { text: res.text, ai: res.ai };
    if (res.ai) _aiCache[key] = o;
    h.innerHTML = aiCard(o);
  }
  const aiCard = (o) =>
    `<div class="iv-ai"><h4>Ringkasan AI (simulasi, bukan keputusan)</h4><div>${E(o.text)}</div>${o.ai ? '' : '<div class="iv-note">Penjelasan AI tidak tersedia, angka dikira oleh enjin.</div>'}<div class="iv-note">Model: ${aiAdapter.model}. Teks ini tidak menambah angka di luar blok pengiraan.</div></div>`;
  function ivRenderMobRes() {
    const s = ivState,
      r = mobResolve(),
      host = $i('ivMobRes');
    if (!r.po) {
      host.innerHTML = '';
      return;
    }
    const eng = curEngine();
    if (!eng) {
      host.innerHTML = '';
      return;
    }
    let h = '';
    if (s.ui.scenPending)
      h += `<div class="iv-chips">${chip('Data cuaca sedang dimuatkan', 'warn')}</div>`;
    else if (s.ui.scenError)
      h += `<div class="iv-chips">${chip('Data cuaca tidak tersedia, gangguan cuaca tidak dikira', 'warn')}</div>`;
    const ad = disruptionLevel(r.po);
    const adBanjir = banjirDisruption(r.po);
    if (adBanjir)
      h += `<div class="iv-banner">PO terpilih berada dalam kawasan risiko banjir (JPS). Sahkan akses laluan sebelum menghantar. <small>(Anggaran sistem berdasarkan data JPS, bukan amaran rasmi)</small></div>`;
    if (ad)
      h += `<div class="iv-banner ${ad.level === 'Amaran' ? 'bad' : ''}">PO terpilih berada dalam kawasan risiko cuaca tinggi. Sahkan akses laluan sebelum menghantar. <small>(${E(ad.source)})</small></div>`;
    if (!eng.trigger.ok) {
      h += `<div class="iv-empty">PO terpilih tiada lebihan/kekurangan bekalan yang disahkan<br><small>${E(eng.trigger.text || '')}</small></div>`;
      host.innerHTML = h;
      return;
    }
    const tf = ivEngineFacts(r, eng);
    const empD =
        'Tiada PO dalam negeri yang layak. Sistem tidak menambah calon yang tidak memenuhi syarat.',
      empL =
        'Tiada PO luar negeri yang layak. Sistem tidak menambah calon yang tidak memenuhi syarat.';
    if (tf) {
      const t = tf.top;
      h += `<div class="iv-calc" id="ivMobSummary"><h4>Ringkasan Cadangan Mobilisasi ${tagD}</h4>
  <div class="iv-kv"><span>PO ${r.mode === 'pengguna' ? 'sumber' : 'destinasi'} dicadangkan<b>${E(t.name)}</b></span><span>Lokasi<b>${tf.inState ? 'Dalam negeri' : 'Luar negeri'} (${E(t.negeri)})</b></span>${t.qty == null ? '' : `<span>Kuantiti<b>${f2(t.qty)} MT</b></span>`}<span>Anggaran jarak<b>${Math.round(t.km)} km</b></span></div>
  <div class="iv-note"><b>Mengapa:</b> skor tertinggi ${t.score}/100 dalam senarai ${tf.inState ? 'Dalam Negeri' : 'Luar Negeri'}; harga lebih baik daripada harga rujukan dan jarak ${Math.round(t.km)} km dalam had ${s.mob.distLimitKm} km. <b>Kekangan:</b> ${t.qty == null ? 'kuantiti tidak dikira untuk unit ' + IV_COMMBY[r.cm.id].unit : t.tambahan ? 'PO tambahan tiada data logistik (kapasiti tidak diketahui; jarak dari titik tengah daerah)' : t.vehicleKnown ? 'kenderaan tersedia dihadkan kepada ' + f2(t.vehicleCapMT) + ' MT' : 'ketersediaan kenderaan semasa tidak diketahui (kapasiti maksimum statik ' + f2(t.maxCapMT) + ' MT)'}${t.sameGroup ? '; kapasiti logistik dikongsi dengan PO terpilih' : ''}${t.flood || t.banjir ? '; waspada banjir' : ''}. Bekalan tidak dinilai (cadangan berdasarkan jarak dan harga sahaja).</div></div><div id="ivMobAI"></div>`;
    }
    h += `<div class="iv-two" style="margin-top:10px"><div><div class="iv-sec">TOP 5 PO DALAM NEGERI ${E(poObj(r.po).negeri)} ${tagD}</div><div id="ivListDalam">${eng.dalam.length ? eng.dalam.map((c) => candCard(c, 'dalam')).join('') : `<div class="iv-empty">${empD}</div>`}</div></div>
 <div><div class="iv-sec">TOP 5 PO LUAR NEGERI ${tagD}</div><div id="ivListLuar">${eng.luar.length ? eng.luar.map((c) => candCard(c, 'luar')).join('') : `<div class="iv-empty">${empL}</div>`}</div></div></div>`;
    const all = [...eng.dalam, ...eng.luar];
    const sel = all.find((c) => c.poId === s.mob.candidateKey);
    if (sel) {
      const src = r.mode === 'pengguna' ? sel.name : poName(r.po),
        dst = r.mode === 'pengguna' ? poName(r.po) : sel.name;
      const risks = [];
      if (ad && ad.level === 'Amaran') risks.push('Destinasi/sumber terjejas banjir');
      if (sel.flood) risks.push('Cuaca tinggi (Open-Meteo/MET) pada ' + sel.name);
      if (sel.banjir) risks.push('Banjir (JPS) pada ' + sel.name);
      if (sel.sameGroup) risks.push('Kapasiti kenderaan dikongsi dengan PO terpilih');
      if (sel.tambahan)
        risks.push(
          'PO tambahan: tiada data logistik, cuaca atau banjir; lokasi ialah titik tengah daerah seliaan (anggaran)',
        );
      else if (!sel.vehicleKnown && sel.qty != null)
        risks.push(
          'Ketersediaan kenderaan semasa tidak diketahui. Kapasiti maksimum statik: ' +
            f2(sel.maxCapMT) +
            ' MT',
        );
      h += `<div class="iv-card" id="ivCandDetail" style="margin-top:10px"><h4>Butiran calon: ${E(sel.name)}</h4>
  <div class="iv-kv"><span>PO sumber<b>${E(src)}</b></span><span>PO destinasi<b>${E(dst)}</b></span><span>Komoditi<b>${E(commName(r.cm.id))}</b></span>${sel.qty == null ? '' : `<span>Kuantiti<b>${f2(sel.qty)} MT</b></span>`}<span>Jarak<b>${Math.round(sel.km)} km (anggaran dummy)</b></span><span>Bekalan<b>Tidak dinilai</b></span></div>
  <ul class="iv-note"><li>Justifikasi: harga ${r.mode === 'pengguna' ? 'sumber' : 'destinasi'} ${rmUnit(sel.price, r.cm.id)} berbanding harga rujukan ${rmUnit(r.ref, r.cm.id)}, jarak ${Math.round(sel.km)} km.</li><li>Skor harga ${(sel.priceScore * 100).toFixed(0)}%, skor jarak ${(sel.distScore * 100).toFixed(0)}% (wajaran ${s.mob.wPrice}/${100 - s.mob.wPrice}).</li></ul>
  <div class="iv-sec">RISIKO PENGHANTARAN</div><ul class="iv-note">${risks.length ? risks.map((x) => `<li>${E(x)}</li>`).join('') : '<li>Tiada risiko tambahan dikesan oleh enjin.</li>'}</ul>
  <button type="button" class="button" id="ivDraftBtn" data-iv-act="draft">Sediakan Cadangan Intervensi</button> <span class="iv-note">Hanya draf (status: draf). Tiada kelulusan atau pelaksanaan automatik.</span></div>`;
    }
    h += `<details style="margin-top:10px"><summary class="iv-note" style="cursor:pointer">${eng.excluded.length} PO ditapis keluar</summary><ul class="iv-note" id="ivExcluded">${eng.excluded.map((x) => `<li>${E(x.name)}: ${E(x.reason)}</li>`).join('')}</ul></details>`;
    host.innerHTML = h;
    if (tf) ivFillMobAI(r, eng);
  }
  function createDraft() {
    const s = ivState,
      r = mobResolve(),
      eng = curEngine();
    if (!eng || !eng.trigger.ok) return;
    const all = [...eng.dalam, ...eng.luar];
    const c = all.find((x) => x.poId === s.mob.candidateKey);
    if (!c) return;
    const src = r.mode === 'pengguna' ? c.poId : r.po,
      dst = r.mode === 'pengguna' ? r.po : c.poId;
    if (
      ivDrafts.some(
        (d) =>
          d.status === 'draf' &&
          d.sourcePOId === src &&
          d.destinationPOId === dst &&
          d.commodityId === r.cm.id &&
          d.quantityMT === (c.qty == null ? null : +c.qty.toFixed(2)),
      )
    ) {
      toastSafe('Draf yang sama sudah wujud');
      return;
    }
    const ds = myDate(refNow).replace(/-/g, '');
    const suf =
      Math.max(
        0,
        ...ivDrafts
          .filter((d) => d.interventionId.startsWith('IV-' + ds + '-'))
          .map((d) => +d.interventionId.slice(-3) || 0),
      ) + 1;
    const ad = disruptionLevel(r.po);
    const adBanjir = banjirDisruption(r.po);
    ivDrafts.push({
      interventionId: `IV-${ds}-${String(suf).padStart(3, '0')}`,
      mode: r.mode,
      status: 'draf',
      createdAt: refNow,
      sourcePOId: src,
      destinationPOId: dst,
      commodityId: r.cm.id,
      quantityMT: c.qty == null ? null : +c.qty.toFixed(2),
      distanceKm: Math.round(c.km),
      score: c.score,
      justification: `Harga ${r.mode === 'pengguna' ? 'sumber' : 'destinasi'} ${rmUnit(c.price, r.cm.id)} dan jarak ${Math.round(c.km)} km; skor ${c.score}/100.`,
      deliveryRisk:
        (ad && ad.level === 'Amaran'
          ? 'PO terpilih berada dalam kawasan risiko cuaca tinggi. Sahkan akses laluan sebelum menghantar. '
          : '') +
        (adBanjir
          ? 'Banjir (JPS) pada PO terpilih. Sahkan akses laluan sebelum menghantar. '
          : '') +
        (c.banjir ? 'Banjir (JPS) pada ' + c.name + '. ' : '') +
        (c.vehicleKnown || c.qty == null ? '' : 'Ketersediaan kenderaan tidak diketahui.'),
      stockVerification: 'belum disahkan',
      weights: { price: s.mob.wPrice, dist: 100 - s.mob.wPrice },
      createdBy: 'prototaip',
      source: 'dummy',
    });
    const ok = saveDrafts();
    toastSafe(
      ok
        ? 'Draf cadangan intervensi disediakan (status: draf)'
        : 'Draf disimpan sementara dalam sesi ini sahaja',
    );
    ivRender(['draft']);
    return true;
  }
  function ivRenderDrafts() {
    const box = $i('ivDraftBox');
    box.innerHTML = `<details style="margin-top:12px" ${ivDrafts.length ? 'open' : ''}><summary class="iv-sec" style="cursor:pointer">DRAF CADANGAN INTERVENSI (${ivDrafts.length}) ${tagD}</summary><div id="ivDrafts">${ivDrafts.length ? ivDrafts.map((d) => `<div class="iv-draft"><span><b>${E(d.interventionId)}</b> · ${E(commName(d.commodityId))} · ${E(poName(d.sourcePOId))} → ${E(poName(d.destinationPOId))} · ${d.quantityMT == null ? 'tiada kuantiti MT' : f2(d.quantityMT) + ' MT'} · ${E(d.distanceKm)} km ${chip('status: draf', 'warn')}</span><button type="button" class="button tiny danger" data-iv-act="delDraft" data-iv-arg="${E(d.interventionId)}">Padam Draf</button></div>`).join('') : '<div class="iv-empty">Belum ada draf. Pilih calon dan tekan “Sediakan Cadangan Intervensi”.</div>'}</div></details>`;
  }

  /* ===== Paparan 5 ===== */
  function marCtx() {
    const po = effPO(),
      cm = effCommodity();
    return { po, cm };
  }
  function ivRenderMarDefs() {
    $i('ivMarDefs').innerHTML =
      `<div class="iv-defs"><p><b>Harga Borong Beli:</b> harga yang FAMA PO jual kepada pemborong luar.</p><p><b>Harga Borong Jual:</b> harga jualan borong yang diperhatikan dan dikutip oleh FAMA di pasaran terbuka.</p><p><b>Spread = Harga Borong Jual − Harga Borong Beli. Spread bukan margin operasi PO.</b></p><details class="iv-formula"><summary>Lihat formula pengiraan</summary><p class="iv-note">Harga Jualan PO (dalam formula) = Harga Borong Beli. Margin% = (Jualan − Ladang − Kos) ÷ Jualan × 100; Harga Ladang Maksimum = Jualan × (1 − sasaran) − Kos; Harga Jualan Minimum = (Ladang + Kos) ÷ (1 − sasaran).</p></details></div>`;
  }
  function seedMargin() {
    const { po, cm } = marCtx();
    const m = ivState.margin;
    const ctx = po + '|' + cm.id;
    if (!po || !isKg(cm.id)) {
      return;
    }
    if (m.ctx !== ctx && !m.touched) {
      const d = marginDefaults(po, cm.id);
      m.jual = d.jual != null ? String(d.jual) : '';
      m.beli = d.beli != null ? String(d.beli) : '';
      m.ladang = d.ladang != null ? String(d.ladang) : '';
      m.kos = String(d.kos);
      m.target = '15';
    }
    m.ctx = ctx;
  }
  function ivRenderMarCtl() {
    const { po, cm } = marCtx();
    const box = $i('ivMarCtl'),
      res = $i('ivMarRes');
    const m = ivState.margin;
    $i('ivMarChips').innerHTML = tagD + notApplicable('mar');
    if (!po) {
      box.innerHTML = '';
      res.innerHTML =
        '<div class="iv-empty">Pilih Pusat Operasi pada peta atau senarai keutamaan</div>';
      box.dataset.sig = '';
      return;
    }
    if (!isKg(cm.id)) {
      box.innerHTML = '';
      res.innerHTML = `<div class="iv-banner">Unit komoditi (${E(IV_COMMBY[cm.id].unit)}) tidak disokong untuk pengiraan MT dan RM/kg. Pilih komoditi RM/kg.</div>`;
      box.dataset.sig = '';
      return;
    }
    seedMargin();
    const sig = po + '|' + cm.id + '|' + m.ctx;
    if (box.dataset.sig === sig && box.firstChild) return;
    box.dataset.sig = sig;
    const d = marginDefaults(po, cm.id);
    box.innerHTML = `<div class="iv-chips"><span>PO:</span><select class="iv-in" style="width:auto" data-iv-sel="marpo" aria-label="PO simulasi margin">${IV_PO.map((p) => `<option value="${E(p.id)}"${p.id === po ? ' selected' : ''}>${E(p.name)}</option>`).join('')}</select>${chip('Komoditi: ' + IV_COMMBY[cm.id].name, 'info')}${cm.def ? chip('lalai (penapis ialah Semua)', 'warn') : ''}${d.override ? chip('nilai lalai ujian (dummy)', 'warn') : ''}<button type="button" class="button tiny ghost" data-iv-act="marReset">Pulih nilai lalai</button></div>
 <div class="iv-ctl">
 <label>Harga Borong Jual (RM/kg)<input class="iv-in" type="number" step="0.01" data-iv-in="m-jual" id="ivMJual" value="${E(m.jual)}"><span class="iv-err" id="ivMJualErr"></span></label>
 <label>Harga Borong Beli (RM/kg)<input class="iv-in" type="number" step="0.01" data-iv-in="m-beli" id="ivMBeli" value="${E(m.beli)}"><span class="iv-err" id="ivMBeliErr"></span></label>
 <label>Harga Belian Ladang (RM/kg)<input class="iv-in" type="number" step="0.01" data-iv-in="m-ladang" id="ivMLadang" value="${E(m.ladang)}"><span class="iv-err" id="ivMLadangErr"></span></label>
 <label>Kos Operasi (RM/kg)<input class="iv-in" type="number" step="0.01" data-iv-in="m-kos" id="ivMKos" value="${E(m.kos)}"><span class="iv-err" id="ivMKosErr"></span></label>
 <label>Margin Sasaran (%)<input class="iv-in" type="number" step="0.5" data-iv-in="m-target" id="ivMTarget" value="${E(m.target)}"><input type="range" min="0" max="95" step="1" data-iv-in="m-target-range" id="ivMTargetR" value="${E(Math.min(95, Math.max(0, Number(m.target) || 0)))}" aria-label="Margin sasaran"><span class="iv-err" id="ivMTargetErr"></span></label></div>`;
  }
  const BLN_PENDEK = [
    'Jan',
    'Feb',
    'Mac',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Ogo',
    'Sep',
    'Okt',
    'Nov',
    'Dis',
  ];
  const blnLabel = (ymd, tambah = 0) => {
    if (!ymd) return '';
    const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1 + tambah, 1));
    return BLN_PENDEK[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  };
  // Kad harga semasa (harga + unit, cth. RM 8.50 /kg) dengan bulan data.
  function hargaKadHTML(label, pr, cid) {
    const unit = (IV_COMMBY[cid] ? IV_COMMBY[cid].unit : 'RM/kg').replace(/^RM\//, '/');
    const ada = pr && fin(pr.actual);
    const tkh = pr && pr.minggu && pr.minggu.akhir;
    return `<div class="iv-mr-harga"><div class="iv-mr-harga-l">${E(label)}</div><div class="iv-mr-harga-v">${ada ? `RM ${pr.actual.toFixed(2)} <small>${E(unit)}</small>` : '<span class="iv-mr-kosong">Tiada data</span>'}</div>${tkh ? `<span class="iv-mr-tkh" title="${E(pr.windowLabel || '')}">&#8635; ${E(blnLabel(tkh))}</span>` : ''}</div>`;
  }
  // Harga Cadangan PSI daripada /api/psi (enjin pelayan api/services/psi-kira.js; formula
  // Prompt_Dashboard_Harga_Cadangan_PSI.md). Klien hanya memaparkan; tiada kiraan semula.
  const PSI = { data: new Map(), memuat: new Set(), ralat: new Map() };
  function psiAmbil(po, variety) {
    const k = po + '|' + variety;
    if (PSI.data.has(k) || PSI.memuat.has(k)) return PSI.data.get(k) || null;
    PSI.memuat.add(k);
    fetch('/api/psi?po=' + encodeURIComponent(po) + '&variety=' + encodeURIComponent(variety))
      .then((r) => {
        // 404 = pelayan lama tanpa laluan /api/psi (perlu dimulakan semula)
        if (r.status === 404)
          return Promise.reject(
            new Error('laluan /api/psi tiada pada pelayan; mulakan semula pelayan (npm start)'),
          );
        return r
          .json()
          .catch(() => ({ ralat: 'HTTP ' + r.status }))
          .then((j) => (r.ok ? j : Promise.reject(new Error(j.ralat || 'HTTP ' + r.status))));
      })
      .then(
        (j) => {
          PSI.data.set(k, j);
          PSI.ralat.delete(k);
        },
        (e) => PSI.ralat.set(k, String((e && e.message) || e)),
      )
      .finally(() => {
        PSI.memuat.delete(k);
        ivRender(['mar']);
      });
    return null;
  }
  const rm2 = (x) => (fin(x) ? 'RM ' + x.toFixed(2) : '—');
  const pct2 = (x) => (fin(x) ? (x * 100).toFixed(2) + '%' : '—');
  const LENCANA_PSI = {
    Biasa: 'ok',
    'Semakan manual': 'warn',
    'Margin tidak mencukupi': 'bad',
    'Data tidak lengkap': 'bad',
  };
  function cadanganKadHTML(id, tajuk, kelas, unit, t) {
    const u = E(unit);
    if (!t)
      return `<div class="iv-mr-cad ${kelas}" id="${id}"><div class="iv-mr-cad-h"><span>${E(tajuk)}</span></div><div class="iv-mr-cad-n">Memuatkan cadangan…</div></div>`;
    const lencana = `<span class="iv-mr-lencana ${LENCANA_PSI[t.status] || 'warn'}">${E(t.status)}</span>`;
    if (!t.ok)
      return `<div class="iv-mr-cad ${kelas}" id="${id}"><div class="iv-mr-cad-h"><span>${E(tajuk)}</span>${lencana}</div><div class="iv-mr-cad-v iv-mr-tiada">${E(t.sebab)}</div><div class="iv-mr-cad-n">${E(t.butiran || '')}</div></div>`;
    const sisda = `berat SISDA ${t.beratSisda.toFixed(2)}${t.sebabSisda ? ', ' + t.sebabSisda : ''}`;
    const amaran = (t.amaran || []).filter(
      (a) => a === 'Nisbah 2 bulan bukan dari 2 bulan terkini',
    );
    return `<div class="iv-mr-cad ${kelas}" id="${id}"><div class="iv-mr-cad-h"><span>${E(tajuk)}</span>${lencana}</div>
 <div class="iv-mr-cad-v">${rm2(t.hargaBawah)} - ${rm2(t.hargaAtas)} <small>${u}</small></div>
 <div class="iv-mr-cad-n">Harga cadangan ${rm2(t.hargaCadangan)}${u} · Harga pasaran ${rm2(t.hargaPasaran)} · Harga ramalan ${rm2(t.hargaRamalan)} (${E(sisda)}) · Lebar julat ±${pct2(t.lebarJulat)}</div>
 <div class="iv-mr-cad-n">Nisbah_2_Bulan: ${E(t.bulan2Label)} · Bulan sah Nisbah_6_Bulan: ${t.bilBulanSah6} · Bulan sah Nisbah_SISDA: ${t.bilBulanSahSisda}</div>
 ${amaran.map((a) => `<div class="iv-mr-amaran">${E(a)}</div>`).join('')}
 <details class="iv-mr-diag"><summary>Diagnostik</summary><table><tbody>${[
   ['Nisbah_2_Bulan', t.nisbah2.toFixed(2)],
   ['Nisbah_6_Bulan', t.nisbah6.toFixed(2)],
   ['Beza_Nisbah', pct2(t.bezaNisbah)],
   ['Nisbah_Terpilih', t.nisbahTerpilih.toFixed(2) + ' (' + t.pilihanNisbah + ')'],
   ['Nisbah_SISDA', fin(t.nisbahSisda) ? t.nisbahSisda.toFixed(2) : '—'],
   ['Ralat_Ramalan', pct2(t.ralatRamalan)],
   ['Berat_SISDA', t.beratSisda.toFixed(2)],
   ['Turun_Naik', pct2(t.turunNaik)],
   ['Lebar_Julat', pct2(t.lebarJulat)],
   ['Harga pasaran ' + labelBulanPsi(t.bulanTerkini), rm2(t.hargaPasaranTerkini)],
   ['Unjuran SISDA ' + labelBulanPsi(t.bulanCadangan), rm2(t.sisdaCadangan)],
 ]
   .map(([k, v]) => `<tr><th>${E(k)}</th><td>${E(v)}</td></tr>`)
   .join('')}</tbody></table></details></div>`;
  }
  const labelBulanPsi = (ym) => (ym ? blnLabel(ym + '-01') : '');
  function ivRenderMarRingkas() {
    const { po, cm } = marCtx();
    const box = $i('ivMarCtl'),
      res = $i('ivMarRes');
    $i('ivMarDefs').innerHTML = '';
    $i('ivMarChips').innerHTML = notApplicable('mar');
    box.dataset.sig = '';
    if (!po) {
      box.innerHTML = '';
      res.innerHTML =
        '<div class="iv-empty">Pilih Pusat Operasi pada peta atau senarai keutamaan</div>';
      return;
    }
    box.innerHTML = `<div class="iv-chips"><span>PO:</span><select class="iv-in" style="width:auto" data-iv-sel="marpo" aria-label="PO simulasi margin">${IV_PO.map((p) => `<option value="${E(p.id)}"${p.id === po ? ' selected' : ''}>${E(p.name)}</option>`).join('')}</select>${chip('Komoditi: ' + IV_COMMBY[cm.id].name, 'info')}${cm.def ? chip('lalai (penapis ialah Semua)', 'warn') : ''}</div>`;
    const ld = ivPrice(po, cm.id, 'Ladang'),
      br = ivPrice(po, cm.id, 'Borong');
    const unit = (IV_COMMBY[cm.id] ? IV_COMMBY[cm.id].unit : 'RM/kg').replace(/^RM\//, '/');
    const variety = IV_COMMBY[cm.id] && IV_COMMBY[cm.id].variety;
    const k = po + '|' + variety;
    const d = variety ? psiAmbil(po, variety) : null;
    const ralat = PSI.ralat.get(k);
    let isi;
    if (!variety)
      isi = '<div class="iv-empty">Pilih varieti komoditi untuk melihat cadangan.</div>';
    else if (ralat && !d)
      isi = `<div class="iv-banner">Cadangan tidak dapat dimuatkan: ${E(ralat)}</div>`;
    else {
      const m = d && d.margin;
      const margin = m
        ? `<div class="iv-mr-margin ${m.tidakMencukupi ? 'bad' : ''}" id="ivMrMargin"><b>Margin kasar:</b> ${rm2(m.rm)}${E(unit)} (${m.pct.toFixed(2)}%) · Margin paling kecil (julat): ${rm2(m.minRm)}${E(unit)}${m.tidakMencukupi ? ` · <b>Margin tidak mencukupi — semak semula</b> (bawah ${m.ambangPct}%)` : ''}</div>`
        : '';
      const sumber = d
        ? `<div class="iv-mr-sumber">Data terakhir: AMI ladang ${E(d.tarikh.belian.ami || '—')}, borong ${E(d.tarikh.jualan.ami || '—')} · FIS ladang ${E(d.tarikh.belian.fis || '—')}, borong ${E(d.tarikh.jualan.fis || '—')} · SISDA dijana ${E(String(d.sumber.sisda.dijana || '—').slice(0, 10))} · dikemas kini ${E(String(d.disegarPada || '').slice(0, 10))}</div>${(d.lapuk || []).map((x) => `<div class="iv-mr-amaran">Data lapuk: ${E(x)}</div>`).join('')}<div class="iv-mr-sumber">${E(d.nota)}</div>`
        : '';
      isi = `<div class="iv-note">${d ? `Cadangan bulan ${E(d.labelCadangan)}, berasaskan data AMI, FIS dan SISDA sehingga ${E(d.labelTerkini)}` : 'Memuatkan cadangan…'}</div>
 <div class="iv-mr-dua">${cadanganKadHTML('ivMrBelian', 'Cadangan Harga Belian PO (Ladang)', 'ladang', unit, d && d.belian)}${cadanganKadHTML('ivMrJualan', 'Cadangan Harga Jualan PO (Borong)', 'borong', unit, d && d.jualan)}</div>${margin}${sumber}`;
    }
    res.innerHTML = `<div class="iv-mr-dua">${hargaKadHTML('HARGA LADANG SEMASA', ld, cm.id)}${hargaKadHTML('HARGA BORONG SEMASA', br, cm.id)}</div>
 <div class="iv-mr-sek"><h4>Cadangan Margin &amp; Harga PO</h4>${isi}</div>`;
  }
  let _lastGoodMargin = null;
  function ivRenderMarRes() {
    const { po, cm } = marCtx();
    const host = $i('ivMarRes');
    const m = ivState.margin;
    if (!po || !isKg(cm.id)) return;
    const v = validateMargin(m);
    ['jual', 'beli', 'ladang', 'kos', 'target'].forEach((k) => {
      const id = {
        jual: 'ivMJual',
        beli: 'ivMBeli',
        ladang: 'ivMLadang',
        kos: 'ivMKos',
        target: 'ivMTarget',
      }[k];
      const inp = $i(id),
        er = $i(id + 'Err');
      if (!inp) return;
      if (v.err[k]) {
        inp.setAttribute('aria-invalid', 'true');
        if (er) er.textContent = v.err[k];
      } else {
        inp.removeAttribute('aria-invalid');
        if (er) er.textContent = '';
      }
    });
    const hist = historyOf(po, cm.id);
    const fl = ivPrice(po, cm.id, 'Ladang', 30);
    const ctx = { farmFloor: fl ? fl.floor : 0 };
    let note = '';
    if (v.ok) {
      _lastGoodMargin = { v: v.val, po, cm: cm.id };
    }
    const use = v.ok
      ? v.val
      : _lastGoodMargin && _lastGoodMargin.po === po && _lastGoodMargin.cm === cm.id
        ? _lastGoodMargin.v
        : null;
    if (!use) {
      host.innerHTML = `<div class="iv-banner">Masukkan nilai yang sah untuk melihat hasil simulasi. ${Object.values(v.err).map(E).join('. ')}</div>`;
      return;
    }
    if (!v.ok)
      note = `<div class="iv-banner">Input tidak sah (${Object.values(v.err).map(E).join('; ')}). Hasil terakhir yang sah dikekalkan.</div>`;
    const r = simulateMargin(use, hist, ctx);
    const warnBeli = r.buyAboveSell
      ? '<div class="iv-banner" id="ivWarnBeli">Harga Borong Beli melebihi Harga Borong Jual</div>'
      : '';
    const tile = (l, val) => `<div class="iv-stat"><div><b>${val}</b><span>${l}</span></div></div>`;
    let h =
      note +
      warnBeli +
      `<div class="iv-stats" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))" id="ivMarSummary">${tile('Harga Borong Beli', rmAny(r.S))}${tile('Harga Borong Jual', rmAny(r.J))}${tile('Spread Semasa', sgn(r.spread) + ' RM/kg')}${tile('Margin Operasi PO Semasa', fin(r.cur) ? sgn(r.cur, 2) + ' %' : '—')}</div>`;
    const INF = 'Tiada julat harga yang memenuhi margin sasaran';
    const farm = r.farmOk
      ? `<div class="iv-big" id="ivMaxFarm">${rmPos(r.maxF)}</div><div class="iv-note">Harga belian maksimum</div><div class="iv-kv"><span>Julat dicadangkan<b>${rmPos(r.farmLow)} – ${rmPos(r.maxF)}</b></span><span>Kesan margin<b>${sgn(r.impact)} mata peratus</b></span></div>`
      : `<div class="iv-big">—</div><div class="iv-banner" id="ivFarmInf">${INF}</div>`;
    let sell;
    if (!r.enough)
      sell = `<div class="iv-big" id="ivMinSell">${rmPos(r.minS)}</div><div class="iv-note">Harga minimum untuk margin sasaran</div><div class="iv-banner" id="ivHistWarn">Data sejarah tidak mencukupi (${r.hs ? r.hs.n : 0} minggu, perlu sekurang-kurangnya ${IV_CONFIG.minHistory}). Julat sokongan pasaran tidak dipaparkan.</div>`;
    else if (r.sellOk)
      sell = `<div class="iv-big" id="ivSellRange">${rmPos(r.recLow)} – ${rmPos(r.recHigh)}</div><div class="iv-note">Julat jualan dicadangkan (julat dicadangkan, bukan nilai optimum)</div><div class="iv-kv"><span>Harga minimum untuk margin sasaran<b id="ivMinSell">${rmPos(r.minS)}</b></span><span>Margin pada hujung julat<b>${fin(r.marginAtLow) ? r.marginAtLow.toFixed(2) : '—'}% – ${fin(r.marginAtHigh) ? r.marginAtHigh.toFixed(2) : '—'}%</b></span><span>Julat sokongan pasaran<b>${rmPos(r.mLow)} – ${rmPos(r.mHigh)}</b></span></div>`;
    else
      sell = `<div class="iv-big">—</div><div class="iv-note">Harga minimum untuk margin sasaran: <b id="ivMinSell">${rmPos(r.minS)}</b></div><div class="iv-banner" id="ivSellInf">${INF}</div>`;
    h += `<div class="iv-two" style="margin-top:10px"><div class="iv-res-g" id="ivCardFarm"><h4>Cadangan Harga Belian Ladang</h4>${farm}</div><div class="iv-res-c" id="ivCardSell"><h4>Cadangan Harga Jualan Borong PO</h4>${sell}</div></div>`;
    const hs = r.hs;
    h += `<div class="iv-card" style="margin-top:10px" id="ivHistBlock"><h4>Analisis Spread Sejarah ${tagH}</h4>${hs ? `<div class="iv-kv"><span>Purata<b id="ivHMean">${f2(hs.mean)}</b></span><span>Median<b id="ivHMed">${f2(hs.median)}</b></span><span>Sisihan piawai<b id="ivHSd">${f2(hs.sd)}</b></span><span>Trend<b id="ivHTrend">${hs.trend}</b></span><span>Bilangan minggu<b>${hs.n}</b></span></div>` : '<div class="iv-note">Tiada data sejarah.</div>'}<div class="iv-note">Jika sejarah kurang daripada ${IV_CONFIG.minHistory} minggu, julat sokongan pasaran tidak dipaparkan. Sejarah ialah data sebenar DB Harga: setiap minggu ISO lengkap ialah harga Borong PO tolak harga Ladang PO (Harga Borong Beli FAMA tiada dalam DB Harga).</div></div>`;
    const open = ivState.ui.marInsight;
    h += `<div style="margin-top:10px"><button type="button" class="button ghost" id="ivInsightBtn" data-iv-act="marInsight" aria-expanded="${open}">${open ? '▾' : '▸'} Pandangan AI Margin</button><div id="ivInsight" ${open ? '' : 'hidden'}></div></div>`;
    host.innerHTML = h;
    if (open) ivFillInsight(r, po, cm.id);
  }
  let _insSeq = 0;
  async function ivFillInsight(r, po, cid) {
    const host = $i('ivInsight');
    if (!host) return;
    const seq = ++_insSeq;
    const fb = `Margin semasa ${fin(r.cur) ? r.cur.toFixed(2) + '%' : 'tidak dapat dikira'} berbanding sasaran ${r.t.toFixed(2)}%. Harga belian ladang maksimum untuk sasaran ialah ${rmPos(r.maxF)} (semasa ${rmAny(r.F)}), jadi kemampanan harga belian ${r.F <= r.maxF ? 'mencukupi' : 'tidak mencukupi'}. Harga jualan minimum ialah ${rmPos(r.minS)} berbanding harga jualan semasa ${rmAny(r.S)}, jadi kecukupan harga jualan ${r.S >= r.minS ? 'mencukupi' : 'tidak mencukupi'}. Risiko harga jatuh: ${r.hs && r.hs.trend === 'turun' ? 'trend spread menurun' : 'tiada isyarat trend menurun'}. Cadangan pelarasan: ${r.F > r.maxF ? 'turunkan harga belian ladang atau naikkan harga jualan' : 'kekalkan dan pantau'}.`;
    host.innerHTML =
      '<div class="iv-ai" aria-busy="true"><div class="iv-spin">Menjana pandangan…</div></div>';
    const res = await callAI('explainMargin', { text: fb }, fb);
    if (seq !== _insSeq) return;
    const h = $i('ivInsight');
    if (!h) return;
    h.innerHTML = `<div class="iv-ai"><h4>Pandangan AI Margin (simulasi)</h4><div>${E(res.text)}</div>${res.ai ? '' : '<div class="iv-note">Penjelasan AI tidak tersedia, angka dikira oleh enjin.</div>'}<div class="iv-note">Nasihat sahaja dan tertakluk kepada pengesahan operasi.</div></div>`;
  }

  /* ===== Paparan 6: AI Muse (db-curated, Google Drive melalui /api/muse) ===== */
  let museData = null,
    _museSeq = 0,
    _museNowOverride = null;
  const museNow = () => (_museNowOverride != null ? _museNowOverride : Date.now());
  const MUSE_STALE_MS = 36 * 3600e3;
  const MUSE_COMM_ALIAS = {
    'cili-merah': ['cili-merah-hijau'],
    'cili-hijau': ['cili-merah-hijau'],
    'tomato-bulat': ['tomato'],
    'bawang-merah-kecil': ['bawang'],
    'ayam-proses-super': ['ayam'],
    'kubis-bulat': ['kubis'],
    'telur-gred-a': ['telur'],
  };
  const MUSE_BAND = {
    Merah: { cls: 'bad', rank: 0 },
    Kuning: { cls: 'warn', rank: 1 },
    Hijau: { cls: 'ok', rank: 2 },
  };
  const ivDataService = {
    async loadMuse(minggu, reuse) {
      if (failFlags.muse) {
        failFlags.muse = false;
        throw new Error('Kegagalan data Muse disuntik (ujian)');
      }
      return FamaMuse.load(minggu, { reuse });
    },
  };
  async function ivLoadMuse(minggu, reuse) {
    if (!ivShowMuse) return;
    const seq = ++_museSeq;
    ivState.muse.status = 'loading';
    ivState.muse.page = 0;
    museMdClose(false);
    ivRender(['muse']);
    try {
      const d = await ivDataService.loadMuse(minggu, reuse);
      if (seq !== _museSeq) return;
      museData = d;
      ivState.muse.weekStart = d.minggu;
      ivState.muse.status = 'ready';
    } catch (err) {
      if (seq !== _museSeq) return;
      console.warn('Data AI Muse tidak dapat dimuatkan', err && err.message);
      ivState.muse.status = err && err.kind === 'file' ? 'file' : 'error';
    }
    ivRender(['muse']);
  }
  function museShortDate(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    return d + ' ' + MY_MONTHS[m - 1].slice(0, 3);
  }
  // ubah kepada true untuk papar semula butang tindakan pada kad
  const IV_MUSE_SHOW_ACTION = false;
  function museMatch(r) {
    const f = ivState,
      lk = r.lokasi || [];
    if (f.selectedCommodityId) {
      const ok = [
        f.selectedCommodityId,
        ...(MUSE_COMM_ALIAS[IV_BEKALAN_DUMMY[f.selectedCommodityId]] || []),
      ];
      if (!ok.includes(r.komoditiId)) return false;
    }
    if (f.selectedStateId && !lk.some((l) => slug(l.negeri || '') === f.selectedStateId))
      return false;
    if (f.selectedPOId && !lk.some((l) => l.poId === f.selectedPOId)) return false;
    if (f.selectedDistrictId) {
      const d = IV_DISTBY[f.selectedDistrictId];
      if (
        !d ||
        !lk.some(
          (l) =>
            l.daerah &&
            l.daerah.toLowerCase() === d.name.toLowerCase() &&
            slug(l.negeri) === d.stateId,
        )
      )
        return false;
    }
    if (
      f.selectedRisk !== 'all' &&
      r.band !== { kritikal: 'Merah', waspada: 'Kuning', normal: 'Hijau' }[f.selectedRisk]
    )
      return false;
    return true;
  }
  function museSort(a, b) {
    return (
      MUSE_BAND[a.band].rank - MUSE_BAND[b.band].rank ||
      b.risikoSemasa - b.risikoSebelum - (a.risikoSemasa - a.risikoSebelum) ||
      String(a.komoditiLabel).localeCompare(String(b.komoditiLabel), 'ms')
    );
  }
  const MUSE_PAGE = 8;
  const MM = { open: false, timer: null, opener: null, prevOv: '', prevPad: '' };
  const museNewest = (a, b) => (a.tarikh < b.tarikh ? 1 : a.tarikh > b.tarikh ? -1 : b.id - a.id);
  // satu item bagi setiap komoditi (rekod terbaharu dalam minggu), disusun ikut tahap dan kenaikan risiko
  function museItems() {
    if (!museData) return [];
    const m = new Map();
    museData.rekod.filter(museMatch).forEach((r) => {
      const c = m.get(r.komoditiId);
      if (!c || museNewest(r, c) < 0) m.set(r.komoditiId, r);
    });
    return [...m.values()].sort(museSort);
  }
  function museRiskChip(r) {
    const ch = r.risikoSemasa - r.risikoSebelum;
    const dir = ch > 0 ? 'up' : ch < 0 ? 'down' : 'flat',
      arr = ch > 0 ? '↑' : ch < 0 ? '↓' : '→';
    const b = MUSE_BAND[r.band];
    return `<span class="iv-chip ${b.cls}">Risiko ${E(r.band)} <span class="iv-tr ${dir}">${r.risikoSemasa} ${arr} ${sgn(ch, 0)}</span></span>`;
  }
  function museRiskRow(r) {
    const ch = r.risikoSemasa - r.risikoSebelum;
    const dir = ch > 0 ? 'up' : ch < 0 ? 'down' : 'flat',
      arr = ch > 0 ? '↑' : ch < 0 ? '↓' : '→';
    return `<span class="iv-chip ${MUSE_BAND[r.band].cls}">${E(r.band)} <span class="iv-tr ${dir}">${r.risikoSemasa} ${arr} ${sgn(ch, 0)}</span></span>`;
  }
  const museLokLabel = (l) => (l.daerah ? l.daerah + ', ' + l.negeri : l.negeri);
  function museLokRow(r) {
    const lk = r.lokasi || [];
    if (!lk.length) return '';
    const sisa = lk.length > 1 ? ' +' + (lk.length - 1) : '';
    return `<span class="iv-chip grey" title="${E(lk.map(museLokLabel).join('; '))}">${E(museLokLabel(lk[0]) + sisa)}</span>`;
  }
  function musePrice(r) {
    const h = r.harga;
    if (!h) return '';
    return `<div class="iv-mc-price">${E(h.label)} · <b>${E(Number(h.nilai).toFixed(2))} ${E(h.unit)}</b> (harga pada ${fmtDate(h.tarikh)})</div>`;
  }
  // tajuk ringkas: klausa/ayat pertama nota (sehingga ';' atau '.'), dibersihkan, maks. 70 aksara
  function museTajuk(nota) {
    let x = String(nota || '')
      .replace(/\s+/g, ' ')
      .trim();
    const m = x.search(/;|\.(?=\s|$)/);
    if (m > 0) x = x.slice(0, m);
    x = x.replace(/^[^\p{L}\p{N}]+|[\s,:;.\-–—]+$/gu, '');
    if (x.length > 70) {
      x = x.slice(0, 69);
      const sp = x.lastIndexOf(' ');
      if (sp > 35) x = x.slice(0, sp);
      x = x.replace(/[\s,:;.\-–—]+$/, '') + '…';
    }
    return x.charAt(0).toUpperCase() + x.slice(1);
  }
  function museRow(r) {
    const id = E(r.komoditiId),
      t = museTajuk(r.nota);
    return `<li class="iv-mrow" data-band="${E(r.band.toLowerCase())}" data-id="${id}">
  <b class="iv-mr-n" title="${E(r.komoditiLabel)}">${E(r.komoditiLabel)}</b>
  <span class="iv-mr-hl" title="${E(t)}">${E(t)}</span>
  <span class="iv-mr-loc">${museLokRow(r)}</span>
  <span class="iv-mr-risk">${museRiskRow(r)}</span>
  <span class="iv-mr-d">${museShortDate(r.tarikh)}</span>
  <button type="button" class="iv-mr-more" data-iv-act="museOpen" data-iv-arg="${id}" aria-label="Baca lagi: ${E(r.komoditiLabel)}">Baca lagi</button>
</li>`;
  }
  function museSummary(items) {
    const n = (b) => items.filter((r) => r.band === b).length;
    return [
      items.length + ' komoditi',
      n('Merah') ? n('Merah') + ' Merah' : '',
      n('Kuning') ? n('Kuning') + ' Kuning' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  function ivRenderMuse() {
    const s = ivState,
      body = $i('ivMuseBody'),
      ms = s.muse;
    const src = chip('Sumber: AI Muse · db-curated (Google Drive)');
    $i('ivMuseChips').innerHTML = chip('Kelompok harian', 'grey') + src + notApplicable('muse');
    if (ms.status !== 'ready') museMdClose(false);
    if (ms.status === 'loading') {
      body.innerHTML = '<div class="iv-empty" aria-busy="true">Memuatkan data AI Muse…</div>';
      return;
    }
    if (ms.status === 'file') {
      body.innerHTML =
        '<div class="iv-banner bad" id="ivMuseFile">Data AI Muse memerlukan pelayan (npm start)</div>';
      return;
    }
    if (ms.status === 'error' || !museData) {
      body.innerHTML =
        '<div class="iv-banner bad">Data AI Muse tidak dapat dimuatkan <button type="button" class="button tiny" data-iv-act="museRetry">Cuba Semula</button></div>';
      return;
    }
    const d = museData,
      ws = ms.weekStart || d.minggu,
      tersedia = d.mingguTersedia;
    const idx = tersedia.indexOf(ws);
    const items = museItems();
    const pages = Math.max(1, Math.ceil(items.length / MUSE_PAGE));
    ms.page = Math.min(Math.max(0, ms.page), pages - 1);
    const stale =
      d.latestDate && museNow() - Date.parse(d.latestDate + 'T00:00:00+08:00') > MUSE_STALE_MS;
    let h = '';
    if (stale)
      h += `<div class="iv-banner" id="ivMuseStale">Data AI Muse lapuk: tarikh data terakhir ${fmtDate(d.latestDate)}</div>`;
    if (d.status === 'sebahagian')
      h +=
        '<div class="iv-note" id="ivMusePart">Sebahagian folder Drive gagal dimuat turun; data mungkin tidak lengkap.</div>';
    h += `<div class="iv-mu-bar">
  <div class="iv-mu-nav"><span class="iv-sec">MINGGU ANALISIS</span><button type="button" class="button tiny ghost" data-iv-act="museWeek" data-iv-arg="prev" aria-label="Minggu sebelum" ${idx <= 0 ? 'disabled' : ''}>◀</button><b id="ivWeekLbl">${fmtWeek(ws)}</b><button type="button" class="button tiny ghost" data-iv-act="museWeek" data-iv-arg="next" aria-label="Minggu seterusnya" ${idx < 0 || idx >= tersedia.length - 1 ? 'disabled' : ''}>▶</button><button type="button" class="button tiny" data-iv-act="museWeek" data-iv-arg="now">Minggu ini</button></div>
  <div class="iv-mu-last">${items.length ? `<span class="iv-mu-n" id="ivMuseCount">${museSummary(items)}</span><span aria-hidden="true">|</span>` : ''}<span title="Minggu Isnin hingga Ahad, waktu Malaysia (UTC+8)">Tarikh data terakhir</span><b>${d.latestDate ? fmtDate(d.latestDate) : '—'}</b></div>
  </div><div id="ivMuseCards">`;
    if (!items.length) {
      h += '<div class="iv-empty" id="ivMuseEmpty">Tiada berita AI Muse untuk minggu ini</div>';
    } else {
      const mula = ms.page * MUSE_PAGE;
      h += `<ul class="iv-mrows" id="ivMuseList" aria-label="Senarai komoditi AI Muse">${items
        .slice(mula, mula + MUSE_PAGE)
        .map(museRow)
        .join('')}</ul>`;
      h += `<div class="iv-mu-pg" id="ivMusePager" ${pages > 1 ? '' : 'hidden'}><button type="button" class="button tiny ghost" data-iv-act="musePage" data-iv-arg="prev" ${ms.page <= 0 ? 'disabled' : ''}>Sebelum</button><span id="ivMusePgLbl">Halaman ${ms.page + 1} daripada ${pages}</span><button type="button" class="button tiny ghost" data-iv-act="musePage" data-iv-arg="next" ${ms.page >= pages - 1 ? 'disabled' : ''}>Seterusnya</button></div>`;
    }
    h +=
      '</div><details class="iv-crit" id="ivMuseCrit"><summary>Maklumat paparan</summary><p>Sumber ialah fail db-curated JSON sahaja (Google Drive). Minggu dikira Isnin hingga Ahad mengikut waktu Malaysia. Lokasi diekstrak daripada teks nota dan mungkin tidak lengkap.</p></details>';
    body.innerHTML = h;
    if (ms.detailKey) museMdFill();
  }

  /* ----- Dialog Baca lagi ----- */
  function museMdFill() {
    const ms = ivState.muse,
      items = museItems();
    const i = items.findIndex((x) => x.komoditiId === ms.detailKey);
    if (i < 0) {
      museMdClose(false);
      return;
    }
    const r = items[i];
    const tl = museData.rekod
      .filter((x) => x.komoditiId === r.komoditiId && museMatch(x))
      .sort(museNewest);
    $i('ivMuseMdT').textContent = r.komoditiLabel;
    $i('ivMuseMdCtx').innerHTML =
      museRiskChip(r) + chip(fmtDate(r.tarikh), 'grey') + (r.awal ? chip('Awal', 'warn') : '');
    const lk = r.lokasi || [];
    $i('ivMuseMdBody').innerHTML =
      `<div class="iv-kv" id="ivMuseMdRisk"><span>Risiko sebelum<b>${r.risikoSebelum}</b></span><span>Risiko semasa<b>${r.risikoSemasa}</b></span><span>Risiko hadapan<b>${r.risikoHadapan}</b></span><span>Perubahan<b>${sgn(r.risikoSemasa - r.risikoSebelum, 0)}</b></span></div>
<div><div class="iv-sec">NOTA PENGANALISIS</div><p class="iv-mc-ins" id="ivMuseMdNota">${E(r.nota)}</p></div>
<div><div class="iv-sec">LOKASI</div><div class="iv-chips">${lk.length ? lk.map((l) => chip(museLokLabel(l))).join('') : '<span class="iv-note">Lokasi tidak dinyatakan dalam nota</span>'}</div></div>
${r.harga ? `<div><div class="iv-sec">HARGA</div>${musePrice(r)}</div>` : ''}
<div class="iv-kv"><span>Indeks sentimen<b>${f2(r.indeksSentimen)}</b></span><span>Bilangan sampel<b>${r.bilSampel}</b></span><span>Data awal<b>${r.awal ? 'Ya' : 'Tidak'}</b></span><span>Sumber<b>${E(r.sumberFail ? r.sumberFail.nama + ' (' + fmtDate(r.sumberFail.tarikh) + ')' : '—')}</b></span></div>
<div><div class="iv-sec">REKOD HARIAN MINGGU INI</div><table class="iv-mm-tl" id="ivMuseMdTl"><thead><tr><th scope="col">Tarikh</th><th scope="col">Tahap</th><th scope="col">Nota ringkas</th></tr></thead><tbody>${tl
        .map(
          (t) =>
            `<tr><td>${museShortDate(t.tarikh)}</td><td>${chip(t.band, MUSE_BAND[t.band].cls)}</td><td>${E(museTajuk(t.nota))}</td></tr>`,
        )
        .join('')}</tbody></table></div>`;
    $i('ivMuseMdBody').scrollTop = 0;
    $i('ivMuseMdPos').textContent = i + 1 + ' daripada ' + items.length;
    $i('ivMuseMdPrev').disabled = i <= 0;
    $i('ivMuseMdNext').disabled = i >= items.length - 1;
    const pg = Math.floor(i / MUSE_PAGE);
    if (pg !== ms.page) {
      ms.page = pg;
      ivRender(['muse']);
    }
    const ac = document.activeElement;
    if (MM.open && (!ac || ac === document.body || ac.disabled)) $i('ivMuseMdClose').focus();
  }
  function museMdOpen(key, opener) {
    if (!museItems().some((x) => x.komoditiId === key)) return;
    ivState.muse.detailKey = key;
    museMdFill();
    if (MM.open) return;
    clearTimeout(MM.timer);
    MM.opener = opener || null;
    MM.open = true;
    const back = $i('ivMuseMd');
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    MM.prevOv = document.body.style.overflow;
    MM.prevPad = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    document.body.classList.add('iv-md-open');
    back.hidden = false;
    void back.offsetWidth;
    back.classList.add('open');
    $i('ivMuseMdClose').focus({ preventScroll: true });
  }
  function museMdClose(restore) {
    const key = ivState.muse.detailKey;
    ivState.muse.detailKey = null;
    if (!MM.open) return;
    MM.open = false;
    const back = $i('ivMuseMd');
    back.classList.remove('open');
    document.body.style.overflow = MM.prevOv;
    document.body.style.paddingRight = MM.prevPad;
    document.body.classList.remove('iv-md-open');
    const fin = () => {
      if (!MM.open) back.hidden = true;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) fin();
    else MM.timer = setTimeout(fin, 200);
    if (restore !== false) {
      let o = key
        ? document.querySelector(
            `#ivMuseBody [data-iv-act="museOpen"][data-iv-arg="${CSS.escape(key)}"]`,
          )
        : null;
      if (!o && MM.opener && MM.opener.isConnected) o = MM.opener;
      if (o && o.focus) o.focus({ preventScroll: true });
    }
  }
  function museMdNav(dir) {
    const ms = ivState.muse,
      items = museItems();
    const i = items.findIndex((x) => x.komoditiId === ms.detailKey);
    const j = dir === 'prev' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= items.length) return;
    ms.detailKey = items[j].komoditiId;
    museMdFill();
  }
  (function () {
    let down = false;
    const back = $i('ivMuseMd'),
      dlg = $i('ivMuseMdDlg');
    $i('ivMuseMdClose').addEventListener('click', () => museMdClose());
    back.addEventListener('pointerdown', (e) => {
      down = e.target === back;
    });
    back.addEventListener('click', (e) => {
      if (e.target === back && (down || e.detail === 0)) museMdClose();
      down = false;
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (!MM.open) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          museMdClose();
          return;
        }
        if (e.key !== 'Tab') return;
        const f = [...dlg.querySelectorAll('button:not([disabled])')].filter(
          (x) => x.offsetParent !== null,
        );
        if (!f.length) {
          e.preventDefault();
          dlg.focus();
          return;
        }
        const first = f[0],
          last = f[f.length - 1],
          ac = document.activeElement,
          inside = dlg.contains(ac) && ac !== dlg;
        if (e.shiftKey && (!inside || ac === first)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inside || ac === last)) {
          e.preventDefault();
          first.focus();
        }
      },
      true,
    );
  })();
  /* ===== Render ===== */
  const _pan = {
    filters: ivRenderFilters,
    map: ivRenderMap,
    log: ivRenderLog,
    pri: ivRenderPri,
    mob: () => {
      ivRenderMobCtl();
      ivRenderMobRes();
    },
    mobres: () => {
      ivRenderMobCtl();
      ivRenderMobRes();
    },
    draft: ivRenderDrafts,
    // Tab Simulasi Margin & Harga AI: susun atur ringkas (harga semasa + kad cadangan). Simulasi margin lama
    // (ivRenderMarDefs/Ctl/Res) dikekalkan dalam kod tetapi tidak dipaparkan.
    mar: ivRenderMarRingkas,
    marres: ivRenderMarRingkas,
    muse: ivRenderMuse,
  };
  const DEP = {};
  function ivRender(keys) {
    ivMuatHarga();
    const set = new Set(keys || ALL_PANELS);
    const order = [
      'filters',
      'map',
      'log',
      'pri',
      'mob',
      'mobres',
      'draft',
      'mar',
      'marres',
      'muse',
    ];
    order.forEach((k) => {
      if (!set.has(k)) return;
      if (k === 'muse' && !ivShowMuse) return;
      if (k === 'mobres' && set.has('mob')) return;
      if (k === 'marres' && set.has('mar')) return;
      try {
        _pan[k]();
      } catch (err) {
        console.error('Paparan gagal dipaparkan:', k, err);
        const t = {
          filters: 'ivFilters',
          map: 'ivMapChips',
          log: 'ivLogBody',
          pri: 'ivPriList',
          mob: 'ivMobRes',
          mobres: 'ivMobRes',
          draft: 'ivDraftBox',
          mar: 'ivMarRes',
          marres: 'ivMarRes',
          muse: 'ivMuseBody',
        }[k];
        const e = $i(t);
        if (e)
          e.innerHTML = `<div class="iv-banner bad">Paparan ini tidak dapat dipaparkan. Cuba semula <button type="button" class="button tiny" data-iv-act="retryPanel">Cuba Semula</button></div>`;
      }
    });
    try {
      mdCtx();
    } catch (e) {
      console.error(e);
    }
  }
  function ivRenderAll() {
    ivRender(ALL_PANELS);
  }
  let _scenSig = '';
  function scenSig() {
    return JSON.stringify(
      ivScenarios().map((s) => [
        s.scenarioId,
        s.warningType,
        s.riskLevel,
        s.affectedPOIds,
        s.validUntil,
      ]),
    );
  }
  function ivRefreshScenarios(force) {
    const sg = scenSig();
    if (sg !== _scenSig || force) {
      _scenSig = sg;
      ivRender(['map', 'pri', 'mob', 'log']);
    }
  }

  /* ===== Pengendali acara ===== */
  /* ===== Pop-up Mobilisasi Stok & Simulasi Margin ===== */
  const MD = {
    open: false,
    tab: 'mob',
    opener: null,
    openerSel: null,
    timer: null,
    prevOv: '',
    prevPad: '',
  };
  const MD_TABS = ['mob', 'mar'];
  const mdTabEl = (k) => $i(k === 'mob' ? 'ivMdTabMob' : 'ivMdTabMar');
  function mdSetTab(t, focus) {
    if (!MD_TABS.includes(t)) t = 'mob';
    MD.tab = t;
    try {
      sessionStorage.setItem('ivMdTab', t);
    } catch (e) {}
    MD_TABS.forEach((k) => {
      const b = mdTabEl(k),
        on = k === t;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      $i(k === 'mob' ? 'ivMobPanel' : 'ivMarPanel').hidden = !on;
    });
    $i('ivMdBody').scrollTop = 0;
    if (focus) mdTabEl(t).focus();
  }
  function mdCtx() {
    const host = $i('ivMdCtx');
    if (!host) return;
    const po = effPO(),
      cm = effCommodity();
    const tbh = ivState.mob.anchorTbh && IV_TBHBY[ivState.mob.anchorTbh];
    host.innerHTML =
      (tbh ? chip('PO terpilih (mobilisasi): ' + tbh.name, 'info') : '') +
      chip(po ? 'PO terpilih: ' + poName(po) : 'PO belum dipilih', po ? 'info' : 'grey') +
      chip('Komoditi: ' + commName(cm.id), 'info') +
      chip('Mod: ' + modeLbl(ivState.selectedMode), 'grey');
    const ie = $i('ivMdIssue');
    if (ie) ie.innerHTML = mdIssueHTML(mdIssueRow(po, cm));
  }
  function mdIssueRow(po, cm) {
    const s = ivState,
      all = recsNow();
    const sel = all.find((x) => x.id === s.selectedInterventionId);
    if (sel && sel.cls.level !== 'normal' && sel.poId === po && sel.commodityId === cm.id)
      return sel;
    return (
      all
        .filter((r) => r.cls.level !== 'normal' && r.poId === po && r.commodityId === cm.id)
        .sort(priCmp)[0] || null
    );
  }
  function mdIssueHTML(r) {
    if (!r)
      return '<div class="iv-iss-none">Tiada isu keutamaan direkodkan untuk PO dan komoditi ini</div>';
    const lv = r.cls.level,
      m = r.mode,
      rw = r.row;
    let sup = '';
    if (rw && isKg(r.commodityId)) {
      const v = m === 'pengeluar' ? rw.surplusMT : rw.shortageMT;
      if (v > 0)
        sup = `<span class="iv-iss-i"><b>${m === 'pengeluar' ? 'Lebihan' : 'Kekurangan'} bekalan:</b> ${f2(v)} MT (${r.cls.supply.state === 'disahkan' ? 'disahkan' : 'belum disahkan'})</span>`;
    }
    return `<div class="iv-iss-l1"><b class="iv-iss-h">Isu memerlukan intervensi</b><span class="iv-lv ${lv}">${LV_LABEL[lv]}</span><b class="iv-iss-t">${E(issueLabel(r))}</b><span class="iv-iss-loc">${E(r.district)}, ${E(r.negeri)}</span>${tagD}</div>
 <div class="iv-iss-l2"><span class="iv-iss-i"><b>Harga ${MODE_STAGE[m]}:</b> ${rmAny(r.price.actual)} (${pctTxt(r.price.weeklyPct)} minggu ke minggu) · ${E(r.price.sebabKongsi)}${r.price.asas ? ` · asas ${r.price.asas}` : ''}</span>${sup}<span class="iv-iss-i"><b>Intervensi:</b> ${E(intervType(r))}</span></div>`;
  }
  function mdOpen(tab, opener) {
    const back = $i('ivMd');
    if (MD.open) {
      mdSetTab(tab || MD.tab);
      mdCtx();
      return;
    }
    clearTimeout(MD.timer);
    MD.opener = opener || null;
    MD.openerSel = null;
    if (opener && opener.dataset && opener.dataset.ivAct) {
      const a = opener.dataset.ivAct,
        g = opener.dataset.ivArg;
      MD.openerSel =
        `[data-iv-act="${a}"]` +
        (g != null ? `[data-iv-arg="${String(g).replace(/["\\]/g, '\\$&')}"]` : '');
    }
    MD.open = true;
    mdCtx();
    mdSetTab(tab || MD.tab);
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    MD.prevOv = document.body.style.overflow;
    MD.prevPad = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    document.body.classList.add('iv-md-open');
    back.hidden = false;
    void back.offsetWidth;
    back.classList.add('open');
    mdTabEl(MD.tab).focus({ preventScroll: true });
  }
  function mdClose(restore) {
    if (!MD.open) return;
    MD.open = false;
    const back = $i('ivMd');
    back.classList.remove('open');
    document.body.style.overflow = MD.prevOv;
    document.body.style.paddingRight = MD.prevPad;
    document.body.classList.remove('iv-md-open');
    const fin = () => {
      if (!MD.open) back.hidden = true;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) fin();
    else MD.timer = setTimeout(fin, 200);
    if (restore !== false) {
      let o = MD.opener;
      if (!(o && o.isConnected) && MD.openerSel)
        o = document.querySelector('#viewIntervensi ' + MD.openerSel);
      if (o && o.focus) o.focus({ preventScroll: true });
    }
  }
  (function () {
    let down = false;
    const back = $i('ivMd'),
      dlg = $i('ivMdDlg');
    try {
      const st = sessionStorage.getItem('ivMdTab');
      if (MD_TABS.includes(st)) MD.tab = st;
    } catch (e) {}
    $i('ivMdClose').addEventListener('click', () => mdClose());
    back.addEventListener('pointerdown', (e) => {
      down = e.target === back;
    });
    back.addEventListener('click', (e) => {
      if (e.target === back && (down || e.detail === 0)) mdClose();
      down = false;
    });
    MD_TABS.forEach((k) => mdTabEl(k).addEventListener('click', () => mdSetTab(k)));
    $i('ivMdTabMob').parentNode.addEventListener('keydown', (e) => {
      const i = MD_TABS.indexOf(MD.tab);
      let n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % MD_TABS.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        n = (i + MD_TABS.length - 1) % MD_TABS.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = MD_TABS.length - 1;
      if (n === null) return;
      e.preventDefault();
      mdSetTab(MD_TABS[n], true);
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (!MD.open) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          mdClose();
          return;
        }
        if (e.key !== 'Tab') return;
        const f = [
          ...dlg.querySelectorAll(
            'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
          ),
        ].filter((x) => x.offsetParent !== null && getComputedStyle(x).visibility !== 'hidden');
        if (!f.length) {
          e.preventDefault();
          dlg.focus();
          return;
        }
        const first = f[0],
          last = f[f.length - 1],
          ac = document.activeElement,
          inside = dlg.contains(ac) && ac !== dlg;
        if (e.shiftKey && (!inside || ac === first)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inside || ac === last)) {
          e.preventDefault();
          first.focus();
        }
      },
      true,
    );
  })();
  const root = $i('viewIntervensi');
  function mobField(id, errId, val, lo, hi, msg) {
    const inp = $i(id),
      er = $i(errId);
    const ok = Number.isFinite(val) && val >= lo && val <= hi;
    if (ok) {
      inp.removeAttribute('aria-invalid');
      if (er) er.textContent = '';
    } else {
      inp.setAttribute('aria-invalid', 'true');
      if (er) er.textContent = msg;
    }
    return ok;
  }
  function onAct(el, ev) {
    const a = el.dataset.ivAct,
      arg = el.dataset.ivArg;
    switch (a) {
      case 'mode':
        ivDispatch('setMode', arg);
        break;
      case 'reset':
        ivDispatch('resetFilters');
        $i('ivMobCtl').dataset.sig = '';
        $i('ivMarCtl').dataset.sig = '';
        toastSafe('Penapis dan paparan disetkan semula');
        break;
      case 'backMY':
        ivState.selectedStateId = null;
        ivDispatch('setFilter', ['po', 'all']);
        break;
      case 'outCat':
        ivDispatch('toggleOutletCat', arg);
        break;
      case 'district':
        ivDispatch('selectDistrict', arg);
        break;
      case 'selPO':
        ivDispatch('selectPO', arg);
        break;
      case 'selRow': {
        const r = recsNow().find((x) => x.id === arg);
        if (r) {
          ivState.selectedInterventionId = r.id;
          ivRender(['log', 'pri', 'mob', 'mar']);
        }
        break;
      }
      case 'tindakan':
        if (ivDispatch('selectIntervention', arg) === true) mdOpen('mob', el);
        break;
      case 'showAll':
        ivState.ui.showAll = !ivState.ui.showAll;
        ivRender(['pri']);
        break;
      case 'openMob':
        mdOpen('mob', el);
        break;
      case 'cand':
        ivDispatch('selectCandidate', arg);
        break;
      case 'draft':
        createDraft();
        break;
      case 'delDraft':
        ivDispatch('deleteDraft', arg);
        break;
      case 'resetNeed':
        $i('ivMobCtl').dataset.sig = '';
        ivDispatch('setMob', ['resetNeed']);
        break;
      case 'resetRef':
        $i('ivMobCtl').dataset.sig = '';
        ivDispatch('setMob', ['resetRef']);
        break;
      case 'marReset':
        $i('ivMarCtl').dataset.sig = '';
        ivDispatch('resetMargin');
        break;
      case 'marInsight':
        ivState.ui.marInsight = !ivState.ui.marInsight;
        ivRender(['marres']);
        break;
      case 'museWeek':
        ivDispatch('museWeek', arg);
        break;
      case 'musePage':
        ivDispatch('musePage', arg);
        break;
      case 'museOpen':
        museMdOpen(arg, el);
        break;
      case 'museNav':
        museMdNav(arg);
        break;
      case 'museRetry':
        ivLoadMuse(ivState.muse.weekStart || undefined);
        break;
      case 'mapRetry':
        ivRetryMap();
        break;
      case 'retryPanel':
        ivRenderAll();
        break;
      case 'hargaRetry':
        ivCubaSemulaHarga();
        break;
    }
  }
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-iv-act]');
    if (!el || !root.contains(el)) return;
    if (el.tagName === 'A') ev.preventDefault();
    onAct(el, ev);
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target.closest && ev.target.closest('[data-iv-act]');
    if (
      !el ||
      el !== ev.target ||
      el.tagName === 'BUTTON' ||
      el.tagName === 'A' ||
      el.tagName === 'INPUT'
    )
      return;
    ev.preventDefault();
    onAct(el, ev);
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target;
    const k = t.dataset && t.dataset.ivSel;
    if (!k) return;
    if (k === 'marpo') {
      ivDispatch('selectPO', t.value);
      return;
    }
    if (k === 'mobpo') {
      $i('ivMobCtl').dataset.sig = '';
      if (IV_TBHBY[t.value]) ivDispatch('setMobAnchor', t.value);
      else ivDispatch('selectPO', t.value);
      return;
    }
    ivDispatch('setFilter', [k, t.value]);
  });
  root.addEventListener('input', (ev) => {
    const t = ev.target;
    const k = t.dataset && t.dataset.ivIn;
    if (t.dataset && t.dataset.ivThr) {
      const [m, w] = t.dataset.ivThr.split('.');
      const v = Number(t.value);
      const ok =
        t.value !== '' && Number.isFinite(v) && ivDispatch('setThreshold', [m, w, v]) !== false;
      if (ok) {
        t.removeAttribute('aria-invalid');
        $i('ivThrErr').textContent = '';
        ivRender(ALL_PANELS);
      } else {
        t.setAttribute('aria-invalid', 'true');
        $i('ivThrErr').textContent =
          'Ambang tidak sah: amaran antara 1 dan 50; kritikal lebih besar daripada amaran dan tidak melebihi 90';
      }
      return;
    }
    if (!k) return;
    if (k === 'need') {
      const v = Number(t.value);
      if (
        t.value !== '' &&
        mobField('ivNeed', 'ivNeedErr', v, 0.1, 500, 'Masukkan 0.1 hingga 500 MT')
      )
        ivDispatch('setMob', ['need', v]);
      else mobField('ivNeed', 'ivNeedErr', NaN, 0.1, 500, 'Masukkan 0.1 hingga 500 MT');
    } else if (k === 'ref') {
      const v = Number(t.value);
      if (
        t.value !== '' &&
        mobField('ivRef', 'ivRefErr', v, 0.01, 999, 'Masukkan harga antara RM 0.01 dan 999')
      )
        ivDispatch('setMob', ['ref', v]);
      else mobField('ivRef', 'ivRefErr', NaN, 0.01, 999, 'Masukkan harga antara RM 0.01 dan 999');
    } else if (k === 'limit') {
      const v = Number(t.value);
      if (
        t.value !== '' &&
        mobField('ivLimit', 'ivLimitErr', v, 50, 2000, 'Masukkan 50 hingga 2000 km')
      )
        ivDispatch('setMob', ['limit', v]);
      else mobField('ivLimit', 'ivLimitErr', NaN, 50, 2000, 'Masukkan 50 hingga 2000 km');
    } else if (k === 'wp' || k === 'wd') {
      const raw = Number(t.value);
      const wp = k === 'wp' ? raw : 100 - raw;
      ivDispatch('setMob', ['wPrice', wp]);
      const w = ivState.mob.wPrice;
      $i('ivWP').value = w;
      $i('ivWD').value = 100 - w;
      $i('ivWPL').textContent = w + '%';
      $i('ivWDL').textContent = 100 - w + '%';
      $i('ivWTotal').innerHTML = `Jumlah wajaran: <b>${w}% + ${100 - w}% = 100%</b>`;
    } else if (k.startsWith('m-')) {
      const f = k.slice(2);
      if (f === 'target-range') {
        ivDispatch('setMargin', ['target', t.value]);
        $i('ivMTarget').value = t.value;
      } else {
        ivDispatch('setMargin', [f, t.value]);
        if (f === 'target') {
          const n = Number(t.value);
          if (Number.isFinite(n)) $i('ivMTargetR').value = Math.min(95, Math.max(0, n));
        }
      }
    }
  });
  $i('ivFilterToggle').addEventListener('click', () => {
    const f = $i('ivFilters');
    const c = f.classList.toggle('iv-collapsed');
    $i('ivFilterToggle').setAttribute('aria-expanded', String(!c));
  });

  /* ===== Tab ===== */
  const tabM = $i('ivTabMonitor'),
    tabI = $i('ivTabIv'),
    viewM = $i('viewMonitor');
  let ivInited = false,
    ivActive = 'pemantauan';
  function writeHash(h) {
    try {
      history.replaceState(null, '', '#' + h);
    } catch (_) {
      try {
        location.hash = h;
      } catch (__) {}
    }
  }
  function showTab(which, opts) {
    opts = opts || {};
    ivActive = which;
    const iv = which === 'intervensi';
    tabM.setAttribute('aria-selected', String(!iv));
    tabI.setAttribute('aria-selected', String(iv));
    tabM.tabIndex = iv ? -1 : 0;
    tabI.tabIndex = iv ? 0 : -1;
    viewM.hidden = iv;
    root.hidden = !iv;
    document.body.dataset.ivTab = iv ? 'intervensi' : 'pemantauan';
    if (!opts.noHash) writeHash(iv ? 'intervensi' : 'pemantauan');
    if (iv) {
      if (!ivInited) {
        ivInited = true;
        ivInit();
      }
      requestAnimationFrame(() => {
        if (!ivMap && !ivState.ui.mapError) ivInitMap();
        if (ivMap) {
          try {
            ivMap.resize();
          } catch (_) {}
        }
        ivRefreshScenarios(false);
        ivRender(['map']);
      });
    } else {
      requestAnimationFrame(() => {
        try {
          if (window.famaMonitorMapResize) window.famaMonitorMapResize();
        } catch (_) {}
      });
    }
  }
  tabM.addEventListener('click', () => showTab('pemantauan'));
  tabI.addEventListener('click', () => showTab('intervensi'));
  [tabM, tabI].forEach((t) =>
    t.addEventListener('keydown', (ev) => {
      const order = [tabM, tabI];
      let i = order.indexOf(t);
      if (ev.key === 'ArrowRight') i = (i + 1) % 2;
      else if (ev.key === 'ArrowLeft') i = (i + 1) % 2;
      else if (ev.key === 'Home') i = 0;
      else if (ev.key === 'End') i = 1;
      else return;
      ev.preventDefault();
      order[i].focus();
      showTab(i === 1 ? 'intervensi' : 'pemantauan');
    }),
  );

  function ivInit() {
    ivState.ui.scenPending = !scenSettled;
    ivRenderMarDefs();
    ivRenderAll();
    ivLoadMuse(undefined, true);
    const sp = window.famaScenariosReady;
    if (sp && typeof sp.then === 'function') {
      const done = () => {
        scenSettled = true;
        ivState.ui.scenPending = false;
        ivState.ui.scenError = ivState.ui.scenError || false;
        ivRefreshScenarios(true);
        ivRender(['mob']);
      };
      sp.then(done, (e) => {
        ivState.ui.scenError = true;
        done();
      });
    }
  }
  let scenSettled = false;
  if (window.famaScenariosReady && typeof window.famaScenariosReady.then === 'function')
    window.famaScenariosReady.then(
      () => {
        scenSettled = true;
      },
      () => {
        scenSettled = true;
      },
    );
  else scenSettled = true;

  /* Pautan dalam (hash): hanya selepas load dan senario selesai */
  (function () {
    const want = (location.hash || '').toLowerCase();
    if (want !== '#intervensi') return;
    const loadP =
      document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise((r) => window.addEventListener('load', r, { once: true }));
    const sp =
      window.famaScenariosReady && window.famaScenariosReady.then
        ? window.famaScenariosReady
        : Promise.resolve();
    let applied = false;
    const apply = () => {
      if (applied) return;
      applied = true;
      showTab('intervensi', { noHash: true });
    };
    Promise.allSettled([loadP, sp]).then(() => requestAnimationFrame(apply));
    setTimeout(apply, 3000);
  })();

  /* ===== Hook ujian ===== */
  window.IV_TEST = {
    state: () => JSON.parse(JSON.stringify(ivState)),
    outletStats,
    dispatch: ivDispatch,
    refresh: () => ivRefreshScenarios(true),
    setScenariosPending: (b) => {
      ivState.ui.scenPending = !!b;
      ivRender(['mob']);
    },
    ivClassify,
    supplyConfirm,
    priorityScore,
    mobilisationEngine,
    disruptionLevel,
    banjirDisruption,
    marginPct,
    maxFarmPrice,
    minSell,
    historyStats,
    weekStart,
    weekRange,
    ivValidateAi,
    map: () => ivMap,
    drafts: () => JSON.parse(JSON.stringify(ivDrafts)),
    failNext: (k) => {
      if (k in failFlags) failFlags[k] = true;
    },
    withholdDistrictMap: (id) => {
      ivWithheld[id] = true;
      ivRender(ALL_PANELS);
    },
    setRefNow: (iso) => {
      refNow = iso;
      ivRender(ALL_PANELS);
    },
    engine: curEngine,
    priRows: () =>
      priRows().map((r) => ({
        id: r.id,
        level: r.cls.level,
        score: r.score,
        label: issueLabel(r),
        flag: r.cls.flag,
        po: r.poId,
        district: r.district,
        commodity: r.commodityId,
      })),
    poLevel,
    museData: () => (museData ? JSON.parse(JSON.stringify(museData)) : null),
    setMuseNow: (iso) => {
      _museNowOverride = iso == null ? null : Date.parse(iso);
      ivRender(['muse']);
    },
    config: () => IV_CONFIG,
    resolveMob: mobResolve,
    marginDefaults,
    simulateMargin,
    validateMargin,
    historyOf,
    ivPrice,
    recPrice,
    recsNow,
    ivDbPairs,
    ivHarga: () => ({ sedia: IVH.sedia, memuat: IVH.memuat, ralat: IVH.ralat, ver: IVH.ver }),
  };
})();

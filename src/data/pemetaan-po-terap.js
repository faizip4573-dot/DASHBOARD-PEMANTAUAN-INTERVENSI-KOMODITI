/* Terap pemetaan PO (config/pemetaan-po-fis.json, FIS Version 2.1) pada DATA: daerah 15 PO utama dan senarai PO tambahan.
   Pelayar: dimuat selepas dashboard-data.js dan pemetaan-po-fis.js (global PEMETAAN_PO_FIS). Node: require().terap(DATA, konfig).
   Satu sumber: tiada senarai daerah PO lain dalam dashboard-data.js yang dikira. */
(function () {
  'use strict';
  const besar = (s) =>
    String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  const judul = (s) =>
    String(s)
      .toLowerCase()
      .replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const NEGERI_PAPAR = { 'KUALA LUMPUR': 'SELANGOR', PUTRAJAYA: 'SELANGOR', LABUAN: 'SABAH' };
  // Nama daerah FIS -> nama DB Harga (sama dengan api/_services/pemetaan-po.js)
  function dbNama(nama, aliasDb) {
    const n = besar(nama)
      .replace(/[.()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/BAHARU/g, 'BHARU');
    const k = /^JOHOR (BHARU|BAHRU)$/.test(n) ? 'JOHOR BAHRU' : n;
    return aliasDb[k] || k;
  }
  // Setiap daerah: [nama, lat, lon, NEGERI DB, NAMA DB]
  function terap(DATA, PEM) {
    const aliasDb = (PEM.alias && PEM.alias.daerahDb) || {};
    const sumber = PEM.sumber || {};
    const dst = (cfg, lat, lon) =>
      cfg.daerah.map((d) => [
        d.nama,
        Number.isFinite(d.lat) ? d.lat : lat,
        Number.isFinite(d.lon) ? d.lon : lon,
        besar(d.negeri),
        dbNama(d.nama, aliasDb),
      ]);
    const tambahan = [];
    PEM.po.forEach((cfg) => {
      if (cfg.utama) {
        const po = DATA.po.find((x) => x.id === cfg.id);
        if (!po) return;
        po.districts = dst(cfg, po.lat, po.lon);
        po.disahkan = cfg.daerah.map((d) => d.nama);
        po.pemetaan = {
          status: cfg.perluDisahkan ? 'PERLU DISAHKAN' : sumber.status || 'disahkan (FIS 2.1)',
          fisNama: cfg.fisNama,
        };
        return;
      }
      const t = cfg.titik || {};
      tambahan.push({
        id: cfg.id,
        name: cfg.label,
        label: cfg.label,
        fisNama: cfg.fisNama,
        // Negeri dalam bentuk DATA.po (KL/Putrajaya di bawah Selangor, Labuan di bawah Sabah) untuk penapis Negeri
        negeri: judul(NEGERI_PAPAR[cfg.negeri] || cfg.negeri),
        negeriAsal: judul(cfg.negeri),
        lat: t.lat,
        lon: t.lon,
        districts: dst(cfg, t.lat, t.lon),
        tambahan: true,
        perluDisahkan: !!cfg.perluDisahkan,
        lokasiAnggaran: true,
        logistik: null,
        outlets: [],
        sumber: 'Pemetaan: FIS 2.1 (Power BI)',
      });
    });
    DATA.poTambahan = tambahan.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    return DATA;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { terap, dbNama };
  else if (typeof DATA !== 'undefined' && typeof PEMETAAN_PO_FIS !== 'undefined')
    terap(DATA, PEMETAAN_PO_FIS);
})();

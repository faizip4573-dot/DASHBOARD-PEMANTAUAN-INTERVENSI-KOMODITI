/* ===== AI Multi-Scenario Monitoring (data, servis, UI) =====
   Panel tambahan. Semua keadaan senario disimpan dalam medan sendiri (state.scenario,
   state.scenarioPO, state.scenarioLoad) dan dirender semula daripada state oleh renderAll(). */
Object.assign(state, { scenario: null, scenarioPO: null, scenarioLoad: 'loading' });
let SCEN_LIST = []; // senario yang sah (dimuat melalui ScenarioService)
const INSIGHT_CACHE = {}; // scenarioId -> ringkasan dijana sistem daripada data sebenar (bukan model AI)
let scenFetchedAt = ''; // masa data cuaca terakhir dikemas kini (untuk banner lapuk)
let scenBanjir = { status: 'memuat', fetchedAt: '', senario: 0, lapuk: false }; // keadaan data banjir JPS
let amsFitted = false; // true jika peta digerakkan oleh panel ini
let amsListSig = '',
  amsDetailSig = '';

/* --- Senario dijana di pelayan: cuaca (api/_services/cuaca.js) dan banjir (api/_services/banjir.js, JPS). --- */
const WARNING_LABELS = {
  hujan_berterusan: 'Hujan berterusan',
  hujan_lebat: 'Hujan lebat',
  ribut_petir: 'Ribut petir & angin kencang',
  amaran_banjir: 'Banjir',
};
const RISK_LABELS = { sederhana: 'Sederhana', tinggi: 'Tinggi' };
const COMMODITY_PRICE_MAP = { 'Cili Merah': 'Cili Merah', Tomato: 'Tomato Bulat' }; // komoditi senario -> komoditi harga sedia ada

/* --- Lapisan servis ---
   MET Malaysia + Open-Meteo -> pelayan (api/_services/cuaca.js) -> senario -> /api/cuaca -> dashboard.
   Tiada kunci API di pelayar; pelayar hanya memanggil /api/cuaca (same-origin) melalui CUACA.load().
   Banjir: /api/banjir melalui BANJIR.load(). Senario banjir hanya dibenarkan daripada sumber rasmi (dataStatus 'rasmi', sumber JPS). */
const ScenarioService = {
  async loadScenarios() {
    // Cuaca dan banjir dimuat serentak; banjir gagal tidak menggagalkan senario cuaca.
    const [c, b] = await Promise.allSettled([CUACA.load(), BANJIR.load()]);
    if (c.status === 'rejected') throw c.reason;
    const j = c.value;
    const data = [];
    const tambah = (s) => {
      const v = ScenarioService.validateScenario(s);
      if (v.ok) {
        s.affectedCommodities = ScenarioService.commoditiesFor(s);
        data.push(s);
      } else console.warn('Senario tidak sah diabaikan', s && s.scenarioId, v.errors);
      return v.ok;
    };
    (Array.isArray(j.senario) ? j.senario : []).forEach(tambah);
    const banjir = { status: 'ready', fetchedAt: '', senario: 0, lapuk: false };
    if (b.status === 'fulfilled') {
      if (banjirState.status === 'memuat') banjirState = { status: 'ready', data: b.value };
      banjir.fetchedAt = b.value.fetchedAt;
      banjir.lapuk = banjirLapuk(b.value);
      (Array.isArray(b.value.senario) ? b.value.senario : []).forEach((s) => {
        const ids = data.map((x) => Number(String(x.scenarioId).slice(1)) || 0);
        const id = 'S' + String(Math.max(0, ...ids) + 1).padStart(2, '0');
        if (tambah({ ...s, scenarioId: id })) banjir.senario++;
      });
    } else banjir.status = b.reason && b.reason.kind === 'file' ? 'file' : 'error';
    return { status: 'sebenar', data, fetchedAt: j.fetchedAt, banjir };
  },
  // Komoditi paling kerap berstatus bukan hijau (peringkat Borong) di PO terlibat; data harga ialah dummy.
  commoditiesFor(s) {
    const kira = {};
    DATA.rekod.forEach((r) => {
      if (r.peringkat === 'Borong' && r.status !== 'hijau' && s.affectedPOIds.includes(r.poId))
        kira[r.komoditi] = (kira[r.komoditi] || 0) + 1;
    });
    return Object.keys(kira)
      .sort((a, b) => kira[b] - kira[a] || a.localeCompare(b))
      .slice(0, 3);
  },
  validateScenario(o) {
    const errors = [];
    if (!o || typeof o !== 'object') return { ok: false, errors: ['bukan objek'] };
    ['scenarioId', 'scenarioName', 'warningType', 'source', 'riskLevel'].forEach((k) => {
      if (typeof o[k] !== 'string' || !o[k]) errors.push('medan ' + k + ' tidak sah');
    });
    ['affectedStates', 'affectedPOIds', 'affectedCommodities', 'recommendedActions'].forEach(
      (k) => {
        if (!Array.isArray(o[k])) errors.push('medan ' + k + ' mesti tatasusunan');
      },
    );
    if (!Object.prototype.hasOwnProperty.call(RISK_LABELS, o.riskLevel))
      errors.push('riskLevel tidak dikenali');
    if (o.warningType === 'amaran_banjir' && !(o.dataStatus === 'rasmi' && /JPS/.test(o.source)))
      errors.push('senario banjir hanya daripada sumber rasmi JPS');
    if (Array.isArray(o.affectedPOIds)) {
      if (!o.affectedPOIds.length) errors.push('affectedPOIds kosong');
      o.affectedPOIds.forEach((id) => {
        if (!poById[id]) errors.push('PO tidak wujud: ' + id);
      });
    }
    ['issuedAt', 'validFrom', 'validUntil'].forEach((k) => {
      if (Number.isNaN(Date.parse(o[k]))) errors.push('tarikh ' + k + ' tidak sah');
    });
    return { ok: !errors.length, errors };
  },
  async fetchAIInsight(scenarioId) {
    // Ringkasan dijana sistem daripada data cuaca (bukan model AI); tiada kunci API di pelayar.
    await Promise.resolve();
    const sc = scenarioById(scenarioId);
    return sc ? { summary: sc.ringkasan, cadangan: sc.cadangan, source: 'sistem' } : null;
  },
};
/* --- Pembantu terbitan (tanpa DOM) --- */
function poScenarioMap() {
  const m = {};
  SCEN_LIST.forEach((s) =>
    s.affectedPOIds.forEach((id) => {
      (m[id] = m[id] || []).push(s.scenarioId);
    }),
  );
  return m;
}
function scenarioStats() {
  const m = poScenarioMap();
  const ids = Object.keys(m);
  return {
    scenarios: SCEN_LIST.length,
    uniquePO: ids.length,
    overlapPO: ids.filter((id) => m[id].length >= 2).length,
  };
}
function relatedIds(sc) {
  const m = poScenarioMap();
  const out = new Set();
  sc.affectedPOIds.forEach((id) =>
    (m[id] || []).forEach((x) => {
      if (x !== sc.scenarioId) out.add(x);
    }),
  );
  return [...out];
}
function joinAmp(list) {
  return list.length < 2
    ? list[0] || ''
    : list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
}
const commText = (list) => {
  return list && list.length ? joinDan(list) : 'Tiada komoditi terjejas dikenal pasti';
};
function joinDan(list) {
  return list.length < 2
    ? list[0] || ''
    : list.slice(0, -1).join(', ') + ' dan ' + list[list.length - 1];
}
function poName(id) {
  return poById[id] ? poById[id].name : id;
}
function scenarioById(id) {
  return SCEN_LIST.find((s) => s.scenarioId === id) || null;
}
function commodityMatch(name) {
  const m = COMMODITY_PRICE_MAP[name] || name;
  return DATA.komoditi.some((c) => c.name === m) ? m : null;
}
function riskText(r) {
  return 'Risiko ' + (RISK_LABELS[r] || r);
}
function warningLabel(t) {
  return WARNING_LABELS[t] || t;
}
function insightFor(sc) {
  return (
    INSIGHT_CACHE[sc.scenarioId] || {
      summary: 'Ringkasan untuk senario ini belum tersedia.',
      cadangan: sc.recommendedActions.join('; ') + '.',
    }
  );
}
function scenarioRingClass(id) {
  const s = state.scenario ? scenarioById(state.scenario) : null;
  return s && s.affectedPOIds.includes(id) ? ' scenario-ring' : '';
}
function applyScenarios(list) {
  SCEN_LIST = list;
  SCEN_LIST.forEach((s) => {
    s.relatedScenarioIds = relatedIds(s);
  });
  if (state.scenario && !scenarioById(state.scenario)) state.scenario = null;
  if (
    state.scenarioPO &&
    !(state.scenario && scenarioById(state.scenario).affectedPOIds.includes(state.scenarioPO))
  )
    state.scenarioPO = null;
}

/* --- Ikon SVG --- */
const AMS_SVG = (inner, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${inner}</svg>`;
const AMS_CLOUD =
  '<path d="M6.5 14.5a3.8 3.8 0 0 1 .4-7.5 5.4 5.4 0 0 1 10.4 1.2 3.2 3.2 0 0 1-.2 6.3z"/>';
function weatherIcon(type) {
  if (type === 'ribut_petir') return AMS_SVG(AMS_CLOUD + '<path d="M12.6 14l-2.4 3.6h3L11.4 21"/>');
  if (type === 'hujan_lebat')
    return AMS_SVG(
      AMS_CLOUD + '<path d="M7.5 17.5l-1.2 3M11 17.5l-1.2 3M14.5 17.5l-1.2 3M18 17.5l-1.2 3"/>',
    );
  if (type === 'amaran_banjir')
    return AMS_SVG(
      '<path d="M6.5 11.5a3.6 3.6 0 0 1 .4-7 5.2 5.2 0 0 1 10 1.1 3 3 0 0 1-.2 5.9z"/><path d="M3 15.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0"/><path d="M3 19.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0"/>',
    );
  if (type === 'hujan_berterusan')
    return AMS_SVG(AMS_CLOUD + '<path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5"/>');
  return AMS_SVG(AMS_CLOUD);
}
const ICON_CHEV = AMS_SVG('<path d="M9 6l6 6-6 6"/>', ' class="ams-chev"');
const ICON_PIN = AMS_SVG(
  '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  ' class="ams-pin"',
);
const ICON_SPARK = AMS_SVG(
  '<path d="M11 3l1.9 5.3L18 10l-5.1 1.7L11 17l-1.9-5.3L4 10l5.1-1.7z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
);

/* --- Render --- */
function renderScenarioKpis() {
  const st = scenarioStats();
  $('amsKpis').innerHTML = [
    ['Senario', st.scenarios],
    ['PO unik terlibat', st.uniquePO],
    ['PO bertindih', st.overlapPO],
  ]
    .map(
      ([l, v]) =>
        `<div class="ams-kpi"><div class="ams-kpi-v">${esc(v)}</div><div class="ams-kpi-l">${esc(l)}</div></div>`,
    )
    .join('');
}
function renderScenarioList() {
  const sig = JSON.stringify(
    SCEN_LIST.map((s) => [
      s.scenarioId,
      s.scenarioName,
      s.riskLevel,
      s.warningType,
      s.source,
      s.affectedStates,
      s.affectedPOIds,
    ]),
  );
  const box = $('amsList');
  if (sig !== amsListSig) {
    amsListSig = sig;
    box.innerHTML = SCEN_LIST.map(
      (s) =>
        `<button type="button" class="ams-card risk-${esc(s.riskLevel)}" data-sid="${esc(s.scenarioId)}" aria-pressed="false"><span class="ams-ico">${weatherIcon(s.warningType)}</span><span class="ams-card-main"><span class="ams-card-title">${esc(s.scenarioId)} · ${esc(s.scenarioName)}</span><span class="ams-card-line" style="display:block">${esc(joinAmp(s.affectedStates))}</span><span class="ams-card-line" style="display:block">${s.affectedPOIds.length} PO berkaitan · ${esc(s.source)}</span></span><span class="ams-risk">${esc(riskText(s.riskLevel))}</span>${ICON_CHEV}</button>`,
    ).join('');
  }
  box.querySelectorAll('.ams-card').forEach((b) => {
    const on = b.dataset.sid === state.scenario;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function poRowsHTML(sc) {
  const m = poScenarioMap();
  return sc.affectedPOIds
    .map((id) => {
      const all = m[id] || [sc.scenarioId];
      const others = all.filter((x) => x !== sc.scenarioId);
      const open = state.scenarioPO === id;
      return `<button type="button" class="ams-po-row" data-po="${esc(id)}" aria-expanded="${open}" aria-controls="amsPoDrawer">${ICON_PIN}<span class="ams-po-name">${esc(poName(id))}${others.length ? ` <span class="ams-po-also">· Juga dalam ${esc(others.join(', '))}</span>` : ''}</span><span class="ams-pill${all.length >= 2 ? ' multi' : ''}">${all.length} senario</span>${ICON_CHEV}</button>`;
    })
    .join('');
}
function priceStatusHTML(poId, commodities) {
  return commodities
    .map((c) => {
      const m = commodityMatch(c);
      if (!m) return `<div>${esc(c)}: Data harga tidak tersedia (dummy)</div>`;
      const rr = DATA.rekod.filter(
        (r) => r.poId === poId && r.komoditi === m && r.peringkat === 'Borong',
      );
      if (!rr.length) return `<div>${esc(c)}: Data harga tidak tersedia (dummy)</div>`;
      const s = rr.reduce((a, r) => (weight[r.status] > weight[a] ? r.status : a), 'hijau');
      return `<div>${esc(c)}${m !== c ? ` → ${esc(m)}` : ''}: ${statusHTML(s)}</div>`;
    })
    .join('');
}
function stesenBanjirHTML(poId, scs) {
  const bs = scs.find((s) => s.warningType === 'amaran_banjir');
  const r = bs && (bs.rincian || []).find((x) => x.poId === poId);
  const st = (r && r.stesen) || [];
  if (!st.length) return '';
  const baris = st
    .map((s) => {
      const paras = s.parasAir == null ? '-' : Number(s.parasAir).toFixed(2) + ' m';
      const jarak = s.jarakKm == null ? '' : ' · ' + esc(s.jarakKm) + ' km';
      return `<li><b>${esc(s.nama)}</b> · ${esc(s.sungai || '-')}${jarak}<br><span class="bj-chip bj-${esc(String(s.statusRasmi).toLowerCase())}">${esc(s.statusRasmi)}</span> Paras ${esc(paras)} · Trend ${esc(s.trend || '-')} · Bacaan ${esc(s.masaBacaan ? cuacaMasa(s.masaBacaan) : '-')}<br><span class="ams-stesen-sumber">Sumber: ${esc(s.sumber || '-')}</span></li>`;
    })
    .join('');
  return `<div class="ams-drawer-row ams-stesen"><span class="ams-k">STESEN JPS BERHAMPIRAN</span><ul>${baris}</ul><div class="ams-note">Anggaran sistem berdasarkan data JPS, bukan amaran rasmi</div></div>`;
}
function poDrawerHTML(poId, sc) {
  const p = poById[poId];
  if (!p) return '';
  const ids = poScenarioMap()[poId] || [];
  const scs = ids.map(scenarioById).filter(Boolean);
  const comms = [...new Set(scs.flatMap((s) => s.affectedCommodities))];
  const l = p.logistik || {};
  const val = (v, u = '') => (v == null ? 'Tidak tersedia (dummy)' : esc(v) + u);
  const risk = scs
    .map(
      (s) =>
        `<li>${esc(s.scenarioId)} · ${esc(warningLabel(s.warningType))}: ${esc(riskText(s.riskLevel))}</li>`,
    )
    .join('');
  return `<div class="ams-drawer" id="amsPoDrawer" role="region" aria-label="Butiran ${esc(p.name)}"><div class="ams-drawer-head"><h4>${esc(p.name)}</h4><button type="button" class="button ghost" data-act="closepo">Tutup</button></div>
 <div class="ams-drawer-row"><span class="ams-k">NEGERI</span>${esc(p.negeri)}</div>
 <div class="ams-drawer-row"><span class="ams-k">SENARIO TERLIBAT</span>${esc(ids.join(', '))}</div>
 <div class="ams-drawer-row"><span class="ams-k">KOMODITI SENARIO</span>${esc(commText(comms))}</div>
 <div class="ams-drawer-row"><span class="ams-k">RISIKO SENARIO</span><ul>${risk}</ul></div>
 ${stesenBanjirHTML(poId, scs)}
 <div class="ams-drawer-grid"><div class="ams-stat"><span>Kenderaan</span><b>${val(l.kenderaan, ' buah')}</b></div><div class="ams-stat"><span>Muatan</span><b>${val(l.muatanMT, ' MT')}</b></div><div class="ams-stat"><span>Bilik sejuk</span><b>${val(l.bilikSejuk, ' unit')}</b></div><div class="ams-stat"><span>Kapasiti simpanan</span><b>${val(l.kapasitiSimpananMT, ' MT')}</b></div></div>
 ${l.shared && Array.isArray(l.pemilikBersama) ? `<div class="ams-note">Angka gabungan: ${esc(l.pemilikBersama.join(' + '))}</div>` : ''}
 <div class="ams-price-box"><span class="ams-k">Status bekalan/harga komoditi (berasingan daripada amaran cuaca)</span>${priceStatusHTML(poId, comms)}</div>
 <div class="ams-note">Amaran cuaca dan banjir tidak menukar status PO kepada merah. Status merah/kuning/hijau pada peta kekal berdasarkan data harga dan bekalan sahaja.</div>
 <div class="ams-drawer-row"><span class="ams-k">TINDAKAN DICADANGKAN</span><ul>${sc.recommendedActions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>
 <button type="button" class="button" data-act="prices">Lihat harga komoditi PO ini</button></div>`;
}
function renderScenarioDetail() {
  const box = $('amsDetail');
  const sc = state.scenario ? scenarioById(state.scenario) : null;
  const sig = sc
    ? JSON.stringify([
        sc,
        state.scenarioPO,
        INSIGHT_CACHE[sc.scenarioId],
        poScenarioMap(),
        SCEN_LIST.map((s) => s.scenarioId),
      ])
    : '';
  if (sig === amsDetailSig) return;
  amsDetailSig = sig;
  if (!sc) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const ins = insightFor(sc);
  box.hidden = false;
  box.innerHTML = `<div class="ams-topbar"><button type="button" class="button ghost ams-back" data-act="back">← Kembali ke Senarai Senario</button><span class="ams-crumb">Senarai › <b>${esc(sc.scenarioId)}</b></span><span class="ams-chips" role="group" aria-label="Tukar senario">${SCEN_LIST.map((s) => `<button type="button" class="ams-chip risk-${esc(s.riskLevel)}" data-sid="${esc(s.scenarioId)}"${s.scenarioId === sc.scenarioId ? ' aria-current="true"' : ''}>${esc(s.scenarioId)}</button>`).join('')}</span></div><div class="ams-det-head"><h3>Senario Dipilih: ${esc(sc.scenarioId)}</h3><span class="ams-risk ams-risk-${esc(sc.riskLevel)}">${esc(riskText(sc.riskLevel))}</span></div>
 <h4 class="ams-sub-title">PO YANG BERKAITAN</h4><div class="ams-po-list">${poRowsHTML(sc)}</div>
 ${state.scenarioPO ? poDrawerHTML(state.scenarioPO, sc) : ''}
 <section class="ams-ai" aria-labelledby="amsAiTitle"><h4 class="ams-ai-title" id="amsAiTitle">${ICON_SPARK}<span>AI Insight — ${esc(sc.scenarioName)}</span></h4>
  <p><span class="ams-k">AI INSIGHT SUMMARY</span><span class="ams-ins-summary">${esc(ins.summary)}</span></p>
  <p><span class="ams-k">KOMODITI BERPOTENSI TERJEJAS</span><b>Komoditi:</b> <span class="ams-ins-comm">${esc(commText(sc.affectedCommodities))}.</span></p>
  <p><span class="ams-k">CADANGAN INTERVENSI</span><b>Cadangan:</b> <span class="ams-ins-rec">${esc(ins.cadangan)}</span></p>
  <span class="ams-dummy-chip">Ringkasan dijana sistem daripada data sebenar (bukan model AI)</span></section>
 <div class="ams-actions"><button type="button" class="button" data-act="interv">Lihat Pilihan Intervensi</button></div>`;
}
function floodNoteHTML() {
  const b = scenBanjir;
  if (state.scenarioLoad === 'loading' || b.status === 'memuat')
    return 'Memuatkan data banjir JPS…';
  if (b.status === 'file') return 'Data banjir JPS sebenar memerlukan pelayan (npm start)';
  if (b.status === 'error') return 'Data banjir JPS tidak dapat dimuatkan.' + banjirRetryBtn();
  let s =
    'Risiko banjir: data sebenar JPS Malaysia / JPS Selangor · dikemas kini ' +
    esc(cuacaMasa(b.fetchedAt));
  if (!b.senario) s += ' · Tiada stesen Amaran/Bahaya berhampiran PO';
  if (b.lapuk) s += ' · Data banjir lapuk';
  return s;
}
function renderScenarioPanel() {
  if (!$('amsPanel')) return;
  const st = $('amsState');
  const ld = state.scenarioLoad;
  st.className = 'ams-state' + (ld === 'error' || ld === 'stale' ? ' err' : '');
  if (ld === 'error')
    st.innerHTML =
      'Data cuaca tidak dapat dimuatkan, senario tidak dapat dijana. <button type="button" class="button tiny" data-act="cuaca-retry">Cuba semula</button>';
  else
    st.textContent =
      ld === 'loading'
        ? 'Memuatkan senario…'
        : ld === 'file'
          ? 'Senario cuaca sebenar memerlukan pelayan (npm start)'
          : ld === 'empty'
            ? 'Tiada senario cuaca berisiko dikesan hari ini'
            : ld === 'stale'
              ? 'Data cuaca lapuk: kemas kini terakhir ' + cuacaMasa(scenFetchedAt)
              : '';
  $('amsFloodNote').innerHTML = floodNoteHTML();
  renderScenarioKpis();
  renderScenarioList();
  renderScenarioDetail();
  const pg = state.scenario && scenarioById(state.scenario) ? 'detail' : 'list';
  $('amsPanel').dataset.page = pg;
  $('amsOverview').hidden = pg === 'detail' || ld === 'error' || ld === 'file';
}

/* --- Interaksi --- */
const amsReduced = () =>
  window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function fitScenarioPOs(ids) {
  if (state.po || !map || typeof maplibregl === 'undefined') return false;
  const ps = (ids || []).map((i) => poById[i]).filter(Boolean);
  if (!ps.length) return false;
  const go = () => {
    if (ps.length === 1) map.easeTo({ center: [ps[0].lon, ps[0].lat], zoom: 8, duration: 700 });
    else {
      const b = new maplibregl.LngLatBounds([ps[0].lon, ps[0].lat], [ps[0].lon, ps[0].lat]);
      ps.forEach((p) => b.extend([p.lon, p.lat]));
      map.fitBounds(b, { padding: 60, maxZoom: 8, duration: 700 });
    }
  };
  if (map.loaded()) go();
  else map.once('load', go);
  amsFitted = true;
  return true;
}
function amsRestoreMap() {
  if (amsFitted && !state.po) {
    zoomTo(null);
  }
  amsFitted = false;
}
function selectScenario(id) {
  if (!scenarioById(id)) return;
  const open = state.scenario !== id;
  state.scenario = open ? id : null;
  state.scenarioPO = null;
  renderAll();
  if (open) {
    fitScenarioPOs(scenarioById(id).affectedPOIds);
    const d = $('amsDetail');
    d.scrollTop = 0;
    $('amsPanel').scrollTop = 0;
    const b = d.querySelector('.ams-back');
    if (b) b.focus({ preventScroll: true });
  } else amsRestoreMap();
}
function backToScenarioList() {
  const prev = state.scenario;
  state.scenario = null;
  state.scenarioPO = null;
  renderAll();
  amsRestoreMap();
  $('amsPanel').scrollTop = 0;
  const b = prev && document.querySelector(`.ams-card[data-sid="${prev}"]`);
  if (b) b.focus({ preventScroll: true });
}
function openScenarioPO(poId) {
  const sc = state.scenario && scenarioById(state.scenario);
  if (!sc || !sc.affectedPOIds.includes(poId)) return;
  state.scenarioPO = state.scenarioPO === poId ? null : poId;
  renderScenarioPanel();
  const row = document.querySelector(`.ams-po-row[data-po="${poId}"]`);
  if (row) row.focus({ preventScroll: true });
  if (state.scenarioPO) {
    fitScenarioPOs([poId]);
    const d = $('amsPoDrawer');
    if (d) d.scrollIntoView({ block: 'nearest', behavior: amsReduced() ? 'instant' : 'smooth' });
  }
}
function closeScenarioPO() {
  const id = state.scenarioPO;
  state.scenarioPO = null;
  renderScenarioPanel();
  const row = id && document.querySelector(`.ams-po-row[data-po="${id}"]`);
  if (row) row.focus({ preventScroll: true });
}
function viewPOPrices(poId) {
  const sc = state.scenario && scenarioById(state.scenario);
  const m = sc ? sc.affectedCommodities.map(commodityMatch).find(Boolean) : null;
  const km = m ? komoditiHarga(m) : null;
  if (km) {
    state.komoditi = km;
    state.varieti = 'all';
    $('filterCommodity').value = km;
  }
  selectPO(poId);
}
function scenarioInterventionContext() {
  const sc = state.scenario && scenarioById(state.scenario);
  if (!sc) return null;
  const cand = state.scenarioPO ? [state.scenarioPO] : sc.affectedPOIds;
  const matched = sc.affectedCommodities.map(commodityMatch).filter(Boolean);
  const borong = DATA.rekod.filter((r) => r.peringkat === 'Borong');
  const best = (list) =>
    list.reduce((a, r) => (!a || weight[r.status] > weight[a.status] ? r : a), null);
  let rec = best(borong.filter((r) => cand.includes(r.poId) && matched.includes(r.komoditi)));
  let fallback = false;
  if (!rec) {
    fallback = true;
    rec =
      best(borong.filter((r) => r.poId === cand[0])) ||
      best(DATA.rekod.filter((r) => r.poId === cand[0]));
  }
  if (!rec) return null;
  return {
    record: rec,
    fallback,
    note: `Konteks senario ${sc.scenarioId} · ${sc.scenarioName} · ${poName(rec.poId)} · Komoditi: ${commText(sc.affectedCommodities)}`,
  };
}
function openScenarioIntervention() {
  const c = scenarioInterventionContext();
  if (!c) {
    toast('Tiada rekod intervensi sepadan untuk senario ini.');
    return;
  }
  openActionModal(c.record.id, { note: c.note }); // hanya membuka borang; tiada simpanan automatik
  if (c.fallback)
    toast('Konteks senario dihantar; tiada rekod harga sepadan untuk komoditi senario.');
}
$('amsPanel').addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-sid],[data-po],[data-act]');
  if (!t || !$('amsPanel').contains(t)) return;
  if (t.dataset.sid) {
    if (t.dataset.sid !== state.scenario) selectScenario(t.dataset.sid);
  } else if (t.dataset.po) openScenarioPO(t.dataset.po);
  else if (t.dataset.act === 'back') backToScenarioList();
  else if (t.dataset.act === 'interv') openScenarioIntervention();
  else if (t.dataset.act === 'closepo') closeScenarioPO();
  else if (t.dataset.act === 'prices' && state.scenarioPO) viewPOPrices(state.scenarioPO);
});
$('amsPanel').addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (state.scenarioPO) {
    ev.preventDefault();
    closeScenarioPO();
  } else if (state.scenario) {
    ev.preventDefault();
    backToScenarioList();
  }
});
$('amsPanel').setAttribute('role', 'region');
$('amsDetail').setAttribute('role', 'region');
$('amsDetail').setAttribute('aria-label', 'Butiran senario dipilih');
$('amsDetail').tabIndex = -1;

/* --- Pemuatan awal (async; keadaan nyata: loading/ready/empty/stale/error/file) --- */
async function initScenarios(loader = ScenarioService.loadScenarios) {
  state.scenarioLoad = 'loading';
  renderScenarioPanel();
  try {
    const r = await loader();
    applyScenarios(Array.isArray(r && r.data) ? r.data : []);
    Object.keys(INSIGHT_CACHE).forEach((k) => delete INSIGHT_CACHE[k]);
    await Promise.all(
      SCEN_LIST.map(async (s) => {
        INSIGHT_CACHE[s.scenarioId] = await ScenarioService.fetchAIInsight(s.scenarioId);
      }),
    );
    scenBanjir = (r && r.banjir) || {
      status: 'ready',
      fetchedAt: (r && r.fetchedAt) || '',
      senario: 0,
      lapuk: false,
    };
    scenFetchedAt = (r && r.fetchedAt) || '';
    state.scenarioLoad =
      scenFetchedAt && cuacaLapuk({ fetchedAt: scenFetchedAt })
        ? 'stale'
        : SCEN_LIST.length
          ? 'ready'
          : 'empty';
  } catch (err) {
    applyScenarios([]);
    scenBanjir = {
      status: banjirState.status === 'file' ? 'file' : 'error',
      fetchedAt: '',
      senario: 0,
      lapuk: false,
    };
    state.scenarioLoad = err && err.kind === 'file' ? 'file' : 'error';
  }
  renderAll();
} /* ===== Tamat AI Multi-Scenario Monitoring ===== */

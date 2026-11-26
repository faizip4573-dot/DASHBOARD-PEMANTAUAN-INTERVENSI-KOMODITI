# Dashboard Pemantauan Intervensi Komoditi

Dashboard pemantauan dan intervensi komoditi FAMA bagi 15 Pusat Operasi (PO). Data cuaca, banjir dan kualiti udara serta senario yang dijana daripadanya ialah data sebenar (MET Malaysia, Open-Meteo, JPS Malaysia, JPS Selangor, JAS MyEQMS) dan berita AI Muse (Google Drive db-curated) ialah data sebenar; selebihnya (harga, stok dll.) ialah data dummy/simulasi. Dashboard ialah alat sokongan keputusan, bukan sistem amaran rasmi.

## Struktur

```
.
├── index.html                  Fail utama (HTML sahaja; CSS & JS dimuat dari src/)
├── src/
│   ├── css/
│   │   ├── base.css            Gaya asas: layout, panel, peta, KPI, jadual, carta, modal
│   │   ├── scenarios.css       Panel AI Multi-Scenario Monitoring
│   │   ├── intervensi.css      Tab Dashboard Intervensi Komoditi & pop-up
│   │   └── tema.css            Palet tema Gelap / Cerah (dimuat terakhir)
│   ├── js/
│   │   ├── theme-init.js       Tetapkan tema sebelum render (elak kelipan)
│   │   ├── app.js              Tab Pemantauan: state, penapis, peta, KPI, senarai, carta, modal, eksport CSV
│   │   ├── muse-data.js        Pemuat /api/muse yang dikongsi (EWS dan Intervensi)
│   │   ├── lapisan-amaran.js   Lapisan peta Amaran Rasmi (melanggan senarai panel Rasmi)
│   │   ├── ews.js              Panel EWS (AI): tab, paparan Risiko Sentimen
│   │   ├── scenarios.js        AI Multi-Scenario Monitoring (senario daripada data cuaca sebenar, ScenarioService, UI)
│   │   ├── main.js             Titik mula: initControls(), renderAll(), initScenarios()
│   │   ├── intervensi.js       Tab Intervensi: harga, bekalan, logistik, mobilisasi, margin, AI Muse
│   │   └── theme-toggle.js     Butang tukar tema
│   └── data/
│       └── dashboard-data.js   Data dummy (objek DATA): PO, rekod harga, logistik
├── api/                        Pelayan statik + API (server.js) dan folder routes/controllers/services/...
├── config/
│   ├── app.config.js           Konfigurasi sisi pelanggan (gaya peta). Tiada rahsia.
│   └── security.js             Polisi CSP (dikongsi pelayan & <meta> di index.html)
├── data/                       raw/ dan processed/ (diabaikan git)
├── docs/                       spesifikasi, rujukan, laporan, pembentangan (.pptx)
├── scripts/                    Skrip utiliti
├── tests/                      api/ (cuaca-api, banjir-api, ipu-api, muse-api, harga-db-unit, harga-db-api), helpers/ (fixture, api-stub), fixtures/ (data contoh JPS/JAS/Muse, harga-db),  frontend/ (smoke, click-all, cuaca, banjir, ipu, muse, ews-ai, filter-bar, ams, startup-csp, harga-pemantauan, harga-intervensi, harga-seragam, snapshot, intervensi-test)
│                               scripts/ambil-cuaca.js, ambil-banjir.js, ambil-ipu.js, ambil-muse.js, ambil-harga-db.js  Skrip CLI ambil data (npm run cuaca:ambil / banjir:ambil / ipu:ambil / muse:ambil / harga:ambil)
│                               api/services/cuaca.js, banjir.js, kualiti-udara.js, muse.js, muse-lokasi.js, harga-db.js, harga-db-kira.js, util-rangkaian.js  Pengambil, normalisasi, risiko, senario, cache, berita AI Muse dan harga sebenar
├── .env.example                Templat pembolehubah persekitaran
└── package.json
```

### Susunan muat dalam `index.html`

Urutan ini penting kerana fail berkongsi pemboleh ubah global:

1. `theme-init.js`, MapLibre (CDN), `config/app.config.js`
2. CSS: `base` → `scenarios` → `intervensi` → `tema`
3. Di hujung `<body>`: `dashboard-data.js` → `harga.js` → `harga-db.js` → `muse-data.js` → `app.js` → `scenarios.js` → `ews.js` → `main.js` → `intervensi.js` → `theme-toggle.js`

## Persediaan & jalankan

Perlu Node.js 20.12 atau lebih baharu.

```
cp .env.example .env    # isi nilai jika perlu
npm install             # hanya untuk prettier (dev)
npm start               # http://127.0.0.1:3000
npm test                # smoke, klik semua butang, API cuaca/banjir/IPU/Muse/amaran data.gov.my, peta (asas, amaran, radar), kad cuaca, banjir, IPU, AI Muse, bar penapis, AMS, permulaan + CSP (set BROWSER_PATH jika lain)
npm run cuaca:ambil     # ambil data cuaca sebenar sekarang (MET + Open-Meteo)
npm run banjir:ambil    # ambil data banjir sebenar sekarang (JPS Malaysia + JPS Selangor)
npm run ipu:ambil       # ambil IPU sebenar sekarang (JAS MyEQMS)
npm run muse:ambil      # ambil berita AI Muse sekarang (Google Drive db-curated)
npm run harga:ambil     # ambil harga sebenar sekarang (DB Harga, Supabase; perlu DB_HARGA_URL dan DB_HARGA_PUBLISHABLE_KEY)
npm run po:ambil        # muat semula pemetaan PO-daerah daripada Power BI FIS 2.1 (config/pemetaan-po-fis.json; perlu PBI_* dalam .env)
npm run format          # format kod dengan Prettier
```

Buka melalui `npm start`. Membuka `index.html` terus (file://) masih berfungsi, tetapi header keselamatan hanya dihantar oleh pelayan.

## Data cuaca sebenar

Sumber: **MET Malaysia** (api.met.gov.my v2: ramalan negeri `FORECAST/GENERAL` dan amaran rasmi dataset `WARNING`) dan **Open-Meteo** (suhu, kelembapan, hujan, angin, tiupan, 3 hari untuk 15 PO). Atribusi: Data cuaca: Open-Meteo.com (CC BY 4.0).

- Pembolehubah persekitaran dalam `.env` (jangan commit): `MET_API_TOKEN` dan `MET_API_BASE` (lalai `https://api.met.gov.my/v2`). Token tidak pernah dihantar ke pelayar, cache atau log.
- Jalankan `npm start`. Semasa permulaan pelayan mengambil data jika cache tiada atau lebih 24 jam, kemudian menyemak setiap jam. Cache: `data/processed/cuaca-terkini.json` (diabaikan git; boleh ditukar dengan `CUACA_CACHE_FILE`; `CUACA_AUTO=0` mematikan pengambilan automatik).
- Ambil secara manual: `npm run cuaca:ambil`. Alternatif Windows Task Scheduler (harian 06:00): `schtasks /Create /SC DAILY /ST 06:00 /TN "CuacaFAMA" /TR "cmd /c cd /d <laluan projek> && npm run cuaca:ambil"`.
- `GET /api/cuaca` memulangkan cache (503 jika belum ada; pelayar mencuba semula sebentar bila pelayan sedang mengambil data). Selepas menambah laluan baharu, **mulakan semula** pelayan (proses lama akan membalas 404).
- Risiko cuaca PO ialah anggaran sistem, bukan amaran rasmi. Ambang boleh ubah dalam `AMBANG` (`api/services/cuaca.js`): Tinggi jika hujan >= 30 mm atau (MET ribut petir/hujan lebat dan kebarangkalian >= 90%); Sederhana jika >= 10 mm, kebarangkalian >= 70% atau tiupan >= 40 km/j.
- Senario AMS dijana di pelayan (`bangunSenario`): Hujan Lebat (>= 30 mm atau MET hujan lebat), Ribut Petir & Angin Kencang (MET ribut petir atau tiupan >= 40 km/j) dan Hujan Berterusan (>= 2 hari berturut-turut, kebarangkalian >= 70% dan hujan >= 1 mm).
- Panel "EWS (AI)" (tab Pemantauan) mempunyai tiga tab: Amaran Rasmi (MET Malaysia & JPS), Risiko Banjir (JPS) dan Risiko Sentimen (Muse AI). Tab dipilih disimpan dalam `state.ewsTab` (lalai Amaran Rasmi), kekal selepas `renderAll()` dan penapis, dan menukar tab tidak memuat data semula. Risiko Sentimen memakai band Merah/Kuning/Hijau daripada fail db-curated AI Muse (tiada ambang baharu) melalui `/api/muse` yang dikongsi dengan tab Intervensi. Tab Amaran Rasmi memaparkan amaran sebenar sehingga 7 hari lepas. Amaran aktif dipaparkan dahulu, disusun ikut tahap (Bahaya, Buruk, Waspada, lain-lain) kemudian masa dikeluarkan; amaran Tamat menyusul, terbaharu dahulu. Amaran aktif di luar 7 terkini tidak disembunyikan.
- Membuka `index.html` melalui `file://` tidak menyokong data sebenar (perlu `npm start`).

## Data banjir (JPS) dan kualiti udara (JAS)

**Banjir.** Sumber: Public Info Banjir JPS Malaysia (`latestreadingstrendabc.json` dan `getdisse.php`), JPS Selangor (`infobanjirjps.selangor.gov.my/JPSAPI/api/LatestAlert/Telemetry`) dan sejarah banjir 2024 Selangor (ArcGIS `BANJIR_2024`). Selang: banjir setiap 30 minit (`BANJIR_POLL_MIN`), sejarah setiap 7 hari. Cache: `data/processed/banjir-terkini.json` dan `banjir-sejarah.json` (diabaikan git). Endpoint: `GET /api/banjir`.

**Kualiti udara.** Sumber: JAS MyEQMS (`eqms.doe.gov.my`, lapisan peta stesen dan `apitablehourly`). Selang: setiap 60 minit (`IPU_POLL_MIN`). Cache: `data/processed/kualiti-udara-terkini.json`. Endpoint: `GET /api/kualiti-udara`. Kad "Kualiti Udara (IPU) Berhampiran PO" memaparkan IPU stesen terdekat bagi setiap 15 PO, terburuk dahulu. Jalur: Baik (0-50), Sederhana (51-100), Tidak Sihat (101-200), Sangat Tidak Sihat (201-300), Berbahaya (301+). Stesen lebih 50 km ditanda "jauh"; bacaan lebih `IPU_STALE_JAM` (3 jam) ditanda "lapuk". Ini bacaan stesen terdekat, bukan di lokasi PO.

**Pembolehubah persekitaran** (semua pilihan; lihat `.env.example`; tiada token diperlukan): `BANJIR_RADIUS_KM` (25), `BANJIR_POLL_MIN` (30), `BANJIR_DATA_MAX_JAM` (3), `IPU_POLL_MIN` (60), `IPU_STALE_JAM` (3), `BANJIR_AUTO` / `IPU_AUTO` (`0` mematikan pengambilan automatik), `BANJIR_CACHE_FILE`, `BANJIR_SEJARAH_FILE`, `IPU_CACHE_FILE`.

**Peraturan penapis banjir.** Bacaan paras air (WL) dan hujan (RF) lebih tua daripada 3 jam dibuang secara berasingan. Bacaan Error/kosong dan `-9999` tidak sah. Status `Danger` dengan nilai paras `<= 0` dibuang sebagai palsu. Stesen JPS Selangor menggantikan stesen nasional yang sama (padan ikut id, atau nama dan jarak kurang 1 km).

**Peraturan risiko banjir PO** (turutan tetap, radius `BANJIR_RADIUS_KM`): Tinggi jika ada stesen Bahaya atau Amaran, atau amaran rasmi aktif menyebut negeri PO; selain itu Tiada data jika tiada stesen paras air sah; Sederhana jika ada stesen Waspada atau hujan Lebat/Sangat lebat; selebihnya Rendah. Senario "Risiko Banjir" hanya wujud bila ada PO berisiko Tinggi. Risiko ini ialah anggaran sistem berdasarkan data JPS, bukan amaran rasmi.

**Atribusi.** Setiap kad memaparkan sumber: "JPS Malaysia (Public Info Banjir)", "JPS Selangor" dan "JAS (MyEQMS)".

**Had.** Selangor hanya melalui `LatestAlert/Telemetry` (tiada `StationRiverLevels`, `Announcements`, `Siren`). Data pusat pemindahan (PPS) tiada. Bentuk mesej `getdisse.php` belum disahkan semasa amaran sebenar (sentiasa `[]` ketika siasatan), jadi pengurai amaran JPS bersifat longgar. Sumber ialah data awam tanpa API rasmi berdokumen; strukturnya boleh berubah tanpa notis.

**Kebenaran sebelum pengeluaran (production).** Tiada terma yang membenarkan capaian automatik dinyatakan oleh JPS atau JAS. Kebenaran bertulis daripada JPS (Malaysia dan Selangor) dan JAS diperlukan sebelum dashboard ini digunakan di production. Prototaip ini menghantar `User-Agent: FAMA-dashboard-prototype`, selang yang jarang dan GET sahaja.

**Penafian.** Dashboard ini ialah penyokong keputusan, bukan sistem amaran rasmi. Rujuk MET Malaysia, JPS dan JAS untuk amaran dan status rasmi.

## AI Muse (Google Drive db-curated)

**Sumber.** Folder Google Drive awam `1wXNm0nG7dUOvNWkepN9ev3BcgwFZEn8M`. Hanya fail `db-curated-YYYY-MM-DD.json` dibaca; fail lain diabaikan. Data folder dikemas kini dari semasa ke semasa, jadi sistem mengambilnya secara berjadual.

**Paparan.** Ruangan "AI Muse - Gambaran Mingguan Komoditi" memaparkan berita seminggu sahaja, Isnin hingga Ahad mengikut waktu Malaysia (MYT). Minggu lalai ialah minggu `latestDate` dalam data; minggu lain boleh dipilih.

**Penjadual.** Pelayan mengambil data semasa permulaan, kemudian setiap 6 jam (`MUSE_POLL_JAM`). Ambil secara manual dengan `npm run muse:ambil`.

**Pembolehubah persekitaran** (lihat `.env.example`):

- `GOOGLE_API_KEY`: pilihan. Jika diisi, Drive API digunakan; jika kosong, paparan folder HTML digunakan. Jangan commit `.env`.
- `MUSE_DRIVE_FOLDER_ID`: ID folder Drive (lalai folder di atas).
- `MUSE_WEEKS`: bilangan minggu dikekalkan (lalai 8).
- `MUSE_POLL_JAM`: selang semakan dalam jam (lalai 6).
- `MUSE_AUTO`: `0` mematikan pengambilan automatik.

**Endpoint.** `GET /api/muse?minggu=YYYY-MM-DD`. Tarikh disesuaikan ke Isnin minggu itu; tanpa `minggu`, minggu `latestDate` digunakan. Respons turut menyenaraikan minggu yang tersedia.

**Cache.** `data/processed/muse-curated.json` (boleh ditukar dengan `MUSE_CACHE_FILE`) dan folder `data/processed/muse/` (`MUSE_DIR`). Kedua-duanya diabaikan git.

**Penjadual luaran.** Windows Task Scheduler (harian 06:00):

```
schtasks /Create /SC DAILY /ST 06:00 /TN "MuseFAMA" /TR "cmd /c cd /d <laluan projek> && npm run muse:ambil"
```

Linux cron (setiap 6 jam):

```
0 */6 * * * cd /laluan/projek && npm run muse:ambil
```

**Had.** Lokasi berita diekstrak daripada teks nota, jadi sesetengah berita mungkin tiada lokasi. Struktur fail Drive bukan API rasmi berdokumen dan boleh berubah tanpa notis.

## Data harga sebenar (DB Harga, Supabase)

Komoditi dan varieti yang diliputi Pemantauan dan Intervensi ditetapkan di `config/komoditi-diliputi.json` (17 jenis, 58 pasangan; `tiadaData: true` = tiada baris di DB). Pelayan menapis semua `/api/harga*` dengan senarai ini semasa agregasi (tukar fail tanpa sync semula) dan menghantarnya melalui `/api/harga/meta` (`penapis.komoditiSenarai`); pelanggan tidak mempunyai salinan sendiri.

**Sumber.** Pangkalan data Supabase (PostgREST) DB Harga, dibaca dari pelayan sahaja dengan kunci publishable. Jadual harga: `harga_ladang_mingguan`, `harga_borong_mingguan`, `harga_runcit_mingguan`. Jadual ambang: `threshold_autofill_cache` (kunci dan nilai ambang), `maklumat_ami` (unit ambang perubahan) dan `mean_sd_based_year_2022..2025` (bilangan rekod di sebalik mean/sd). Kunci dan URL tidak pernah dihantar ke pelayar, dilog atau ditulis ke cache.

**Pembolehubah persekitaran** (lihat `.env.example`; jangan commit `.env`):

- `DB_HARGA_URL` dan `DB_HARGA_PUBLISHABLE_KEY`: wajib untuk sync.
- `DB_HARGA_POLL_JAM`: selang sync harga (lalai 6). `DB_HARGA_AMBANG_JAM`: umur maksimum cache ambang sebelum diambil semula (lalai 24).
- `DB_HARGA_AUTO`: `0` mematikan sync automatik. `DB_HARGA_EXCLUDE_IDS`: id baris ujian yang dikecualikan (lalai `6912893` hingga `6912897`).
- `HARGA_RINGKAS_FILE`, `HARGA_AMBANG_FILE`, `HARGA_META_FILE`: lokasi cache (lalai `data/processed/harga-ringkas.json`, `harga-ambang.json`, `harga-meta.json`, diabaikan git).

**Sync.** Pelayan menyegerak semasa permulaan dan setiap 6 jam; `npm run harga:ambil` melakukannya sekali dari terminal dan mencetak ringkasan (tanpa kunci). Setiap larian mengambil baris baharu mengikut `created_at`, menarik semula semua baris bagi tarikh yang tersentuh, dan merekonsiliasi 3 minggu ISO terakhir (baris diubah atau dipadam di sumber turut dikemas kini). Hanya 12 minggu terkini disimpan. PostgREST memulangkan maksimum 1000 baris sehingga data diambil berhalaman (`limit` dan `offset`); tiada agregat atau RPC, jadi pengagregatan dibuat di pelayan. Tamat masa 15 saat, 3 percubaan semula; jika sync gagal, cache terakhir yang baik kekal.

**Hierarki purata.** Purata harian satu daerah = purata baris merentas gred dan institusi. Harga negeri atau PO pada satu hari = purata purata-daerah. Harga mingguan = purata harga harian dalam minggu ISO itu. Paksi masa ialah `tarikh_akhir` (tarikh pemerhatian), bukan lajur `week`. Baris `negeri=MALAYSIA` (tanpa daerah) ialah kunci kebangsaan dan tidak masuk peta atau PO. Unit `KILOGRAM` dipaparkan sebagai `KG`.

**Minggu lengkap.** Minggu ISO (Isnin hingga Ahad) lengkap jika Ahadnya jatuh pada atau sebelum tarikh data terkini. Paparan lalai ialah minggu lengkap terkini; minggu semasa yang belum lengkap ditanda `separa` dan statusnya kelabu "Minggu belum lengkap". Pilihan `bulan` memilih minggu lengkap terkini yang Ahadnya dalam bulan itu. Data dianggap `lapuk` jika tarikh terkini lebih 8 hari daripada hari ini.

**Peraturan alarm** (satu objek `AMBANG_ALARM` dalam `api/services/harga-db-kira.js`: `zMerah=2`, `zKuning=1`, `minRekod=8`, `staleHari=8`, `minggu=12`). Mod ditentukan oleh peringkat: Pengeluar = LADANG (alarm bila harga turun), Pengguna = RUNCIT (alarm bila harga naik). BORONG ialah pembanding, sentiasa kelabu.

- `z = (harga - mean) / sd` (mean dan sd tahun asas, kebiasaannya 2025; sesetengah kunci jatuh balik ke 2022 hingga 2024). Sah hanya jika `sd > 0` dan `bilangan_rekod >= 8`. Arah: Pengeluar `-z`, Pengguna `+z`.
- Had dasar: Pengeluar `harga <= floor_warning` (lantai), Pengguna `harga >= ceiling_warning` (siling).
- **Merah**: arah z >= 2, atau had dilanggar dan arah z >= 1.
- **Kuning**: arah z >= 1, atau had dilanggar sahaja, atau perubahan minggu ke minggu searah mod melebihi ambang (peratus atau RM mengikut `maklumat_ami`).
- **Hijau**: input sah dan tiada syarat di atas.
- **Kelabu**: tiada ambang, `sd` tidak sah (sd = 0, rekod kurang, bilangan rekod tidak ditemui), tiada harga, minggu belum lengkap, atau peringkat BORONG. Status tidak pernah jatuh ke hijau tanpa ambang yang sah.
- Setiap status membawa `sebab` (cth. `z = -2.3σ (asas 2025)`, `di bawah lantai dasar RM 4.90`) dan `asas` (tahun).
- Pengeluar tanpa data ladang: status kelabu "Tiada harga ladang" dengan `ganti` (harga borong berlabel). Alarm tidak dijana daripada harga ganti.

**Hos di Vercel.** Vercel ialah serverless: tiada penjadual dan sistem fail hanya boleh dibaca. Oleh itu:
- `api/index.js` ialah satu fungsi untuk semua `/api/*` (`vercel.json` rewrite); ia memanggil pengendali `api/server.js`. Cache dibaca daripada `DATA_DIR` (`api/services/laluan-data.js`; lalai `data/processed`).
- `.github/workflows/vercel-deploy.yml` (setiap jam, setiap push ke `main`, atau manual) menjalankan skrip `*:ambil`, menyalin cache ke `api/_data` dan menjalankan `vercel deploy --prod`. Deployment automatik Git dimatikan (`git.deploymentEnabled: false`) supaya deployment sentiasa ada cache.
- GitHub Secrets diperlukan: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DB_HARGA_URL`, `DB_HARGA_PUBLISHABLE_KEY`, `PBI_*` (5) dan `MET_API_TOKEN` (pilihan). `.vercelignore` mengecualikan rahsia, data mentah, ujian dan dokumen.
- Had: data dikemas kini setiap jam (bukan 30 minit); sejarah amaran banjir JPS bermula semula setiap larian.
**Harga Cadangan PSI (tab Intervensi > Simulasi Margin & Harga AI).** Formula daripada `Prompt_Dashboard_Harga_Cadangan_PSI.md` (bulanan, setiap PO utama dan varieti; BELIAN = ladang, JUALAN = borong, tiada campur aras). Enjin tulen `api/services/psi-kira.js` (diuji dengan contoh Seksyen 9: RM3.42, julat RM3.08–RM3.76; `tests/api/psi-unit.js`). Harga RM dibundarkan ke sen pada setiap langkah seperti contoh itu. Ambang: margin minimum 5%, data lapuk 35 hari (`TETAPAN`).
- Sumber: AMI = DB Harga (Supabase, purata bulanan PO); FIS = Power BI FIS 2.1 jadual `Master` (Sumber FIS, Peringkat LADANG/BORONG, "Tiada Maklumat" dikecualikan, lajur `pusat operasi`); SISDA = Supabase `v3_harga_forecast_2026` aras NEGERI (negeri PO).
- Padanan varieti FIS kepada varieti DB Harga: `config/psi-padanan-fis.json` (cadangan awal, perlu disahkan; telur PAPAN 30 biji ditukar ke per biji).
- Muat semula data: `npm run psi:ambil` (perlu `DB_HARGA_*` dan `PBI_*` dalam `.env`) menulis `data/processed/psi-bulanan.json`; pelayan membaca fail ini (`GET /api/psi?po=&variety=[&bulan=YYYY-MM]`). Tiada penjadual automatik.
**Amaran PO (daripada status daerah).** Setiap baris `aras=po` (15 PO utama) membawa `amaranPo` `{status, sebab, daerah{merah,kuning,hijau,kelabu,jumlah,sah}, daerahMerah[]}`, dikira bagi setiap peringkat, komoditi dan varieti. Peta, pop-up, KPI dan tab Intervensi memakai `amaranPo` untuk status PO; status purata PO (`status`) kekal dalam respons. Turutan (`AMBANG_ALARM.amaranPoKuning = 0.3`, `amaranPoLiputan = 0.5`):
- **Merah**: sekurang-kurangnya 1 daerah dalam liputan PO merah.
- **Kuning**: tiada daerah merah, dan sama ada >= 30% daerah sah kuning, atau status purata PO sendiri merah/kuning.
- **Hijau**: tiada syarat di atas dan >= 50% daripada semua daerah liputan PO (config FIS) ada data sah.
- **Kelabu**: selain itu (data daerah tidak cukup). BORONG sentiasa kelabu. PO tambahan belum ada `amaranPo`.

**Pusat Operasi (pemetaan FIS 2.1).** Satu sumber: `config/pemetaan-po-fis.json` (dikesan git, tanpa rahsia), diambil daripada model semantik Power BI **FIS Version 2.1** (jadual `Master`, lajur `Pusat Operasi`, `Negeri`, `Daerah`) dan ditanda `disahkan (FIS 2.1)`. Pelayan membaca config ini (`api/services/pemetaan-po.js`) dan tidak memanggil Power BI semasa jalan. Pelayar membaca cerminan yang dijana, `src/data/pemetaan-po-fis.js`, dan `src/data/pemetaan-po-terap.js` menerapkannya pada `DATA.po[].districts` (15 PO utama) dan `DATA.poTambahan` (PO tambahan). Harga kekal daripada DB Harga (Supabase); Power BI hanya memberi pemetaan PO kepada daerah.

- **15 PO utama** mengikut daerah FIS (cth. PO Dengkil termasuk Putrajaya, PO Simpang Renggam termasuk Batu Pahat, PO Kota Kinabalu termasuk Labuan, PO Samarahan = Betong dan Samarahan). Ini menggantikan pemetaan manual awal. Padanan nama (jadual `alias` dalam config, boleh disunting): FIS `Kota Bahru` = dashboard `Kota Baharu`, `Chendering, Kuala Terengganu` = `Kuala Terengganu`, `KBS Tampoi /Pusat Operasi Johor Bahru` = `Johor Baharu`, FIS `Pusat Operasi Samarahan` = dashboard `Samarahan` (disahkan pengguna).
- **PO tambahan** (25, di luar 15 PO utama, cth. Tangkak, Puchong, KBS Ipoh) dipaparkan sebagai penanda **petak** pada peta Pemantauan dan Intervensi, diwarnakan dengan palet status harga yang sama. Suis `PO Tambahan (N)` dalam kumpulan Lapisan tambahan menyembunyikan atau menunjukkannya (lalai ON, disimpan dalam `localStorage` `fama_po_tambahan`). Lokasi ialah **anggaran**: titik tengah poligon daerah seliaan (`src/data/geo`), bukan koordinat kemudahan. PO tambahan tiada data logistik dan bukan calon mobilisasi. Dropdown Pusat Operasi menambah kumpulan `PO tambahan` apabila suis ON; KPI `PO Dalam Tapisan` kekal mengira 15 PO utama dengan nota `+N PO tambahan`.
- Satu daerah boleh dalam beberapa PO (Gombak: Selayang dan Pasar Tani Borong Selayang; Jelebu dan Kuala Pilah: Seremban dan PO sendiri). Agregat 15 PO utama guna pemetaan FIS apa adanya; PO tambahan dikira berasingan (`GET /api/harga?aras=po_tambahan`, dan `po=<id tbh-...>` diterima pada aras lain). Daerah DB tanpa mana-mana PO (cth. KUALA LUMPUR/BATU) dilaporkan sebagai `tidakDitugaskan`; nama daerah dalam config yang tiada dalam data harga dilaporkan sebagai `daerahTakPadan` (`/api/harga/meta`).
- **Muat semula pemetaan secara manual:** `npm run po:ambil` (perlu `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET`, `PBI_WORKSPACE_ID`, `PBI_DATASET_ID` dalam `.env`; rahsia tidak dicetak). Skrip menulis `config/pemetaan-po-fis.json` dan `src/data/pemetaan-po-fis.js`, mengekalkan jadual `alias` yang telah disunting. Semak `git diff` sebelum commit.

**Pengecualian.** Baris dengan id dalam `DB_HARGA_EXCLUDE_IDS` dan varieti yang tidak muncul pada sekurang-kurangnya 2 tarikh berbeza dibuang sebelum agregasi. Kiraan dan contoh dilaporkan dalam `harga-meta.json`.

**Endpoint** (GET sahaja, 503 `{ralat, sedangDikemaskini}` jika cache tiada, 400 jika parameter tidak sah):

- `GET /api/harga`: parameter `peringkat` (LADANG/BORONG/RUNCIT), `negeri`, `po` (id PO), `daerah`, `commodity`, `variety`, `bulan` (YYYY-MM), `minggu` (YYYY-MM-DD), `aras` (`negeri`, `po` lalai, `daerah`), `mod` (`pengeluar` memilih LADANG dengan ganti borong, `pengguna` memilih RUNCIT) dan `siri=1` (siri harian satu kunci; memerlukan `peringkat`, `commodity` dan `variety`). Respons: `{tarikhTerkini, tarikhPeringkat, lapuk, disegarPada, mingguSemasaSeparaIso, aras, bilangan, baris[]}`; setiap baris: `peringkat, aras, negeri, po, daerah, commodity, variety, unit, harga, hargaSebelum, pctMinggu, rmMinggu, minggu{iso,mula,akhir,separa}, status, sebab, asas, mean, sd, lantai, siling, z, ganti`.
- `GET /api/harga/meta`: tarikh terkini, `lapuk`, penapis (`negeri`, `po`, `bulan`, `komoditi`, `varieti` mengikut komoditi), kiraan, `dikecualikan`, `daerahTakPadan`, `tidakDitugaskan`.
- `GET /api/harga/ambang`: baris ambang (`peringkat, commodity, variety, negeri, asas, mean, sd, lantai, siling, perubahan{nilai,unit}, bilangan`).

**Had.** Cache `threshold_autofill_cache` ialah snapshot; hanya sebahagian baris mempunyai mean, sd, lantai dan siling lengkap, dan sebahagian kunci tiada `bilangan_rekod` sepadan (status kelabu). Ambang perubahan dalam `nilai_perubahan_rm` ialah peratus (unit sebenar dari `maklumat_ami`).

## Peta utama (Pemantauan)

Kawalan peta berada di penjuru kanan atas peta. Pada skrin 640 px dan ke bawah, kawalan runtuh menjadi satu butang **Lapisan**.

- **Peta asas**: Lalai (CARTO), Terrain (OpenTopoMap, zum maks 17), Jalan (OpenStreetMap, zum maks 19) dan Satelit (Esri World Imagery, zum maks 19). Pilihan disimpan dalam `localStorage` (`fama_peta_asas`). Tukar peta asas memuat semula gaya peta dan memasang semula lapisan tindihan (stesen banjir JPS, Amaran Rasmi). Penanda PO ialah elemen DOM dan tidak terjejas. Atribusi setiap peta dipaparkan pada kawalan atribusi. Tile dimuat oleh pelayar seperti biasa tanpa prefetch; hanya cache HTTP piawai digunakan.
- **Amaran Rasmi** (togol, label `Amaran Rasmi (N aktif · M)` = tag panel EWS): titik peta dibina daripada senarai yang sama dengan kad EWS > Amaran Rasmi (`window.famaAmaranRasmi()` / peristiwa `fama:amaran-rasmi` dari `app.js`: gabungan MET api + data.gov.my + JPS, dedupe, susunan, 7 terkini + amaran aktif, Aktif/Tamat pada masa `kini` yang sama). `src/js/lapisan-amaran.js` tidak mengambil data sendiri. Lokasi: daerah yang disebut dalam teks (mis. "Sabah: Sandakan (Telupid dan Paitan)") ditanda pada titik tengah daerah GeoJSON dengan garis poligon nipis; selainnya titik tengah negeri; amaran laut sahaja pada pusat kawasan laut anggaran (jadual `LAUT`, dilabel anggaran); yang tidak dikenal pasti ditanda "tidak dipetakan" (tiada lokasi direka). Warna ialah warna cip tahap panel (dibaca daripada CSS). Aktif pekat (BAHAYA berdenyut), Tamat pudar (garis daerah putus-putus); kotak "Tunjuk amaran tamat" dalam legenda. Klik item/pin panel terbang ke titik dan buka pop-up; "Lihat lagi" dalam pop-up menyorot item panel. Amaran data.gov.my yang tidak menyamai amaran `api.met.gov.my` masuk ke kad Amaran Rasmi dengan sumber "MET Malaysia (data.gov.my)".
- **Radar cuaca**: iframe Windy telah diganti dengan lapisan cuaca natif (bahagian "Lapisan cuaca" di bawah).
- **Google Maps**: pop-up PO, stesen banjir JPS dan amaran cuaca ada pautan "Buka di Google Maps" (`https://www.google.com/maps/search/?api=1&query=lat,lng`). Pautan sahaja, tiada API. Baris kad Stesen Banjir JPS tiada pautan kerana baris ialah butang.
- Ikon penanda Leaflet (cdnjs) tidak diperlukan; peta menggunakan penanda sendiri dan CDN tidak ditambah.

**Amaran data.gov.my (pelayan).** `GET /api/met-malaysia` memulangkan cache amaran ternormal. Semakan setiap 30 minit (`AMARAN_DG_POLL_MIN`), tamat masa 20 s, 1 percubaan semula, `User-Agent: FAMA-dashboard-prototype`. Had kadar data.gov.my kira-kira 4 permintaan seminit. Cache: `data/processed/amaran-datagov.json` (`AMARAN_DG_CACHE_FILE`; `AMARAN_DG_AUTO=0` mematikan pengambilan automatik). Tanpa cache, respons ialah 200 dengan `amaran: []`. Setiap amaran ada `pendua` jika sama dengan amaran MET yang sedia ada.

**Had tile.** Tile OpenStreetMap untuk penggunaan ringan sahaja ([dasar tile OSM](https://operations.osmfoundation.org/policies/tiles/)); untuk production gunakan penyedia tile yang sesuai. OpenTopoMap juga untuk penggunaan sederhana. Peta tab Intervensi (`src/js/intervensi.js`) belum mendapat pilihan peta asas dan pautan Google Maps (cadangan susulan).

## Lapisan cuaca

Menu **Lapisan cuaca** pada peta utama (dalam butang `Lapisan` pada mobil): Radar cuaca, Satelit, Angin, Hujan/petir, Suhu, Penjejak siklon, Awan, Ombak, Kumpulan hujan, Ribut petir. Satu lapisan utama pada satu masa; Radar, Satelit dan Siklon ialah tindihan. Garis masa (main/jeda) untuk ramalan 72 j atau imbasan radar/satelit; klik peta untuk nilai pada titik. Ribut petir ialah anggaran (CAPE dan kod cuaca). Windy diganti dengan lapisan natif ini; tiada iframe.

| Lapisan                                       | Sumber                                             | Laluan                                                     |
| --------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Grid (angin, suhu, awan, hujan, ombak, ribut) | Open-Meteo (CC BY 4.0), grid 0.5°, 615 titik, 96 j | `/api/grid/meta`, `/api/grid?var=&jam=`, `/api/grid/titik` |
| Radar                                         | RainViewer                                         | `/api/radar`                                               |
| Satelit                                       | NASA GIBS (Himawari IR)                            | `/api/satelit`                                             |
| Siklon                                        | GDACS                                              | `/api/siklon`                                              |

- Had percuma Open-Meteo: 10 000 unit/hari, bukan komersial. Satu muat semula = 12 permintaan / 1046 unit (larian pertama 14 / 1230, membina topeng laut); setiap 6 j (`GRID_POLL_JAM`) ~4 200 unit/hari. Pengawal kuota harian `GRID_KUOTA_HARIAN` (lalai 8000). RainViewer percuma, skala kecil tanpa SLA.
- Produksi: letak kunci dalam `.env` sahaja (`OPEN_METEO_API_KEY`, `OPEN_METEO_BASE`, `OPEN_METEO_MARINE_BASE`, `RAINVIEWER_BASE`, `GRID_RES_DEG`, `GRID_POLL_JAM`). Kunci tidak pernah dihantar ke pelayar atau log. Jika `RAINVIEWER_TILE_HOST` ditukar, kedua-dua CSP (`config/security.js` dan `<meta>` index.html) mesti disunting.
- Skrip: `npm run grid:ambil`, `npm run siklon:ambil` (jalankan sekali sahaja; setiap larian grid menggunakan kuota).
- CORS disahkan 17 Nov 2026: tilecache.rainviewer.com dan gibs.earthdata.nasa.gov memulangkan `Access-Control-Allow-Origin: *`.
- Atribusi: Open-Meteo.com, RainViewer, NASA GIBS / JMA Himawari, GDACS.

## Fungsi dashboard

**Tab Pemantauan Komoditi**

- Peta MapLibre 15 PO dengan status risiko (Kritikal / Berwaspada / Stabil), lapisan banjir, zum ke daerah seliaan dan pop-up logistik PO.
- Penapis: komoditi, PO, indikator, mod senarai dan julat tren.
- KPI: PO dalam tapisan, kritikal, berwaspada, stabil dan isu komoditi.
- Analisis harga: 5 harga terendah dan 5 tertinggi, perbandingan negeri/daerah, trend harga harian dengan jalur sigma dan had lantai/siling.
- Ramalan cuaca sebenar (MET Malaysia + Open-Meteo), amaran rasmi MET dan AI Multi-Scenario Monitoring yang dijana daripada data cuaca sebenar.
- Rekod tindakan intervensi (disimpan dalam pelayar), eksport CSV harga dan logistik PO.
- Tema Gelap / Cerah yang diingati oleh pelayar.

**Tab Dashboard Intervensi Komoditi**

- Peta outlet dan daerah, senarai keutamaan isu dan paparan logistik PO.
- Mobilisasi Stok Pintar: cadangan PO sumber/destinasi dan draf cadangan intervensi.
- Simulasi Margin & Harga, serta AI Muse (berita mingguan sebenar daripada Google Drive db-curated).

**Harga sebenar seragam (kedua-dua tab):** Pemantauan dan Intervensi membaca harga, status dan sebab daripada `/api/harga` melalui modul kongsi `src/js/harga-db.js` (`HARGADB`, lihat "Data harga sebenar (DB Harga, Supabase)"). Lima pertanyaan yang sama dikongsi (LADANG mod pengeluar dan RUNCIT pada aras PO dan daerah, BORONG aras PO), jadi nombor kedua-dua tab sentiasa sama. Pelayan ialah satu-satunya pengira status dan sebab; klien tidak mengira semula.

**Tab Intervensi dan harga sebenar:**

- Mod Pengeluar = harga LADANG (amaran bila harga turun); mod Pengguna = harga RUNCIT (amaran bila harga naik). Tahap harga = status kongsi pelayan: merah, kuning, hijau atau kelabu (tiada ambang). Ambang prototaip lama (±8% / ±15%), tindihan senario T1-T8 dan ramalan dummy tidak lagi memacu penilaian harga; panel "Tetapan Ambang (prototaip)" disembunyikan. Ramalan dipaparkan "tiada (prototaip)".
- **Selari dengan Pemantauan:** pengesahan bekalan dikecualikan buat masa ini (tiada data bekalan sebenar). Harga merah = **Kritikal**, kuning = Waspada, hijau = Normal, kelabu = Tiada ambang; penanda tidak berkelip. Warna PO di peta Intervensi = `amaranPo` pelayan bagi peringkat mod semasa (Bekalan = Ladang, Pasaran = Runcit), terburuk merentas komoditi tertapis. Kuning = Waspada. Kelabu = "Tiada ambang" (penanda dan kawasan daerah kelabu, tidak pernah hijau, tidak disenaraikan sebagai isu).
- Pengeluar tanpa harga ladang: tiada alarm; harga borong dipaparkan sebagai ganti berlabel "Harga borong (ganti, tiada data ladang)" di bawah senarai keutamaan.
- Skor keutamaan harga = |z| arah merugikan mod (z daripada ambang tahun asas) ÷ 4 (maks 1); tiada z = 0.
- Komoditi Intervensi (`DATA.komoditi`, masih berkait dengan bekalan dummy) dipadankan kepada (komoditi, varieti) DB Harga mengikut nama varieti (cth. Cili Merah = varieti "CILI MERAH ..."); jika ada beberapa varieti sepadan, baris paling teruk dipaparkan. Komoditi tanpa varieti sepadan tiada rekod harga.
- **Penunjuk mod Bekalan = harga Borong** (dinilai arah turun: amaran bila harga borong turun atau di bawah lantai; `/api/harga?peringkat=BORONG&arah=turun`). Mod Pasaran = harga Runcit. Tab Pemantauan tidak berubah (Borong kekal pembanding kelabu).
- Mobilisasi: harga sumber/destinasi dan harga rujukan lalai = harga BORONG PO minggu lengkap terkini ("dari DB Harga").
- Margin: **Harga Borong Jual** lalai = harga BORONG PO minggu terkini (andaian: jadual `harga_borong_mingguan` sepadan dengan "harga jualan borong yang diperhatikan"); **Harga Borong Beli** kekal input pengguna tanpa nilai lalai (definisi tidak berubah); Harga Belian Ladang lalai = harga LADANG PO.
- Analisis Spread Sejarah: setiap minggu ISO lengkap (maks 12 minggu) = purata mingguan harga Borong PO (jual) tolak harga Ladang PO (beli), daripada siri `/api/harga?siri=1`. Harga Borong Beli sebenar FAMA tiada dalam DB Harga. Kurang 8 minggu: julat sokongan pasaran tidak dipaparkan (tiada ralat).
- Lencana "Data harga terkini", "Data lapuk" (> 8 hari), "Minggu semasa: separa", keadaan "Memuat harga…", ralat dengan butang "Cuba semula" dan mesej `file://` sama seperti Pemantauan.
- Semakan: `node tests/frontend/harga-intervensi.js` dan `node tests/frontend/harga-seragam.js` (fixture `tests/fixtures/harga-db`).

## Penambahbaikan yang telah dibuat

**Struktur projek**

- Folder `api/`, `config/`, `data/`, `docs/`, `scripts/`, `src/`, `tests/` dan fail `.env.example`, `.gitignore`.
- Fail utama dinamakan semula kepada `index.html`. Fail `.pptx` dipindah ke `docs/pembentangan/`.

**Kod kemas**

- `index.html` dikecilkan daripada ~840 KB (2,286 baris) kepada ~735 baris HTML sahaja.
- CSS inline dipecah kepada 4 fail dan JS inline kepada 6 fail mengikut modul.
- Data dummy (`DATA`) dipindah ke `src/data/dashboard-data.js`, satu rekod setiap baris.
- Semua CSS, JS dan HTML diformat dengan Prettier (`.prettierrc`). Logik dan rekaan tidak diubah.
- Disahkan dengan tangkapan skrin sebelum/selepas (desktop 1440 px, mudah alih 390 px, tema cerah, tab intervensi).

**Pembaikan pepijat**

- `localStorage` boleh menyebabkan ralat dalam mod peribadi atau apabila storan penuh. Simpan/padam rekod tindakan kini dalam `try/catch` dengan mesej kepada pengguna.
- Rekod tindakan yang rosak dalam `localStorage` ditapis supaya tidak memecahkan modal.
- Tag `</div>` penutup `.wrap` yang hilang ditambah (DOM yang terhasil kekal sama).
- Ralat 404 `/favicon.ico` dihentikan.

**Keselamatan**

- API key CARTO yang tertulis dalam kod dibuang. Gaya peta kini dari `config/app.config.js`. **Key lama masih dalam sejarah git; sila revoke/rotate di akaun CARTO.**
- `api/server.js` menghantar header: Content-Security-Policy, X-Frame-Options `DENY`, X-Content-Type-Options `nosniff`, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, `Cache-Control: no-store`.
- CSP: `script-src` tanpa `'unsafe-inline'` (semua JS kini fail luaran). `style-src` masih perlukan `'unsafe-inline'` kerana atribut `style=""` dalam templat UI.
- CORS: hanya origin dalam `CORS_ORIGIN` dibenarkan. Lalai: same-origin sahaja.
- Hanya `index.html`, `src/` dan `config/app.config.js` dilayan. `.env`, `.git`, `data/`, `docs/`, `api/` dan path traversal (`../`) dibalas 404. Kaedah selain GET/HEAD/OPTIONS dibalas 405.
- MapLibre dari unpkg dikunci dengan SRI (`integrity` + `crossorigin`).
- `.env` diabaikan git. Jangan letak rahsia dalam `config/app.config.js` kerana fail itu boleh dibaca sesiapa.

## Nota pembangunan

- Jika menukar `config/security.js`, kemas kini juga `<meta http-equiv="Content-Security-Policy">` dalam `index.html`.
- Jika menambah fail JS/CSS baharu, letakkan dalam `src/` (folder lain tidak dilayan oleh pelayan).
- Ujian bergantung pada `puppeteer-core` dalam `.agents/tasks/bt/node_modules`.
- `tests/frontend/intervensi-test.js` ialah fail ujian lama yang mengandungi HTML terbenam, jadi ia dikecualikan daripada Prettier.

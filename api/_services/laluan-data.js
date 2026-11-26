'use strict';
// Folder cache data (JSON). Lalai: data/processed. DATA_DIR menukar lokasi (cth. /tmp/data di Vercel, di mana
// sistem fail projek hanya boleh dibaca). Mesti ditetapkan sebelum modul perkhidmatan dimuat.
const path = require('node:path');
module.exports = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data', 'processed');

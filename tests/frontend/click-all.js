'use strict';
// Klik semua butang (kecuali yang memadam data) dan laporkan ralat JS/konsol.
// Jalankan dari root: BROWSER_PATH=... node --no-warnings tests/frontend/click-all.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
require('../helpers/banjir-fixture.js').pasangSemuaCache(); // cuaca, banjir dan IPU deterministik, tidak bergantung pada cache tempatan
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);

const BROWSER =
  process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'click-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors = [];
  let clicked = 0;
  try {
    const page = await browser.newPage();
    // Butang eksport CSV memicu muat turun; tanpa ini Edge tanpa kepala menyimpan
    // fail ke folder Downloads pengguna setiap kali ujian dijalankan.
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() =>
      cdp.send('Page.setDownloadBehavior', { behavior: 'deny' }),
    );
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push('console: ' + m.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 2000));
    clicked = await page.evaluate(async () => {
      let c = 0;
      for (const el of document.querySelectorAll('button,[role=tab]')) {
        if (el.disabled || el.id === 'clearLogs' || /padam/i.test(el.textContent)) continue;
        el.click();
        c++;
        await new Promise((r) => setTimeout(r, 20));
      }
      return c;
    });
    await new Promise((r) => setTimeout(r, 1000));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`klik: ${clicked}, ralat: ${errors.length}`);
  errors.forEach((e) => console.log(e));
  process.exitCode = errors.length ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});

'use strict';
// Ambil snapshot visual + DOM untuk semak regresi selepas refactor.
// node --no-warnings tests/frontend/snapshot.js <folder-output>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../../api/_server.js');
const puppeteer = require(
  path.resolve(__dirname, '../../.agents/tasks/bt/node_modules/puppeteer-core'),
);

const BROWSER =
  process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const out = path.resolve(process.argv[2] || 'snapshot-out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({
    executablePath: BROWSER,
    headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'snap-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    for (const [name, width, height, theme, tab] of [
      ['1440', 1440, 900, 'gelap'],
      ['390', 390, 800, 'gelap'],
      ['1440-cerah', 1440, 900, 'cerah'],
      ['1440-intervensi', 1440, 900, 'gelap', 'ivTabIv'],
      ['390-intervensi', 390, 800, 'gelap', 'ivTabIv'],
    ]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.evaluateOnNewDocument((t) => {
        try {
          localStorage.setItem('fama_tema', t);
        } catch {
          /* abaikan */
        }
      }, theme);
      await page.goto(`http://127.0.0.1:${server.address().port}/`, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await sleep(3000);
      if (tab) {
        await page.click('#' + tab);
        await sleep(2500);
      }
      await page.addStyleTag({
        content:
          '*{animation:none!important;transition:none!important;caret-color:transparent!important}',
      });
      await sleep(300);
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
      const dom = await page.evaluate(() => {
        const c = document.body.cloneNode(true);
        c.querySelectorAll('script,.maplibregl-map,.maplibregl-canvas-container').forEach((e) =>
          e.remove(),
        );
        return c.innerHTML;
      });
      fs.writeFileSync(path.join(out, `${name}.dom.html`), dom);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('snapshot disimpan di', out);
})().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});

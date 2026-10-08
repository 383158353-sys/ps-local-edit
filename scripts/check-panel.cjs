const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 650 } });
    await page.goto(pathToFileURL(path.resolve('dist/panel-preview.html')).href);
    await page.screenshot({ path: path.resolve('dist/panel-preview.png'), fullPage: true });
    const report = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, primary: document.querySelector('#generate').textContent, settingsHidden: getComputedStyle(document.querySelector('#settings')).display === 'none' }));
    await page.click('#settings-toggle');
    report.settingsOpened = await page.locator('#api-key').isVisible();
    if (report.scrollWidth > report.width || !report.settingsHidden || !report.settingsOpened) throw new Error(JSON.stringify(report));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

const path = require('path');
const fs = require('fs/promises');
const { chromium } = require('playwright');

async function run() {
  const outputDir = process.env.SCREENSHOT_DIR || '/tmp/codex-screenshots';
  await fs.mkdir(outputDir, { recursive: true });

  const indexPath = path.resolve(__dirname, '..', 'index.html');
  const url = `file://${indexPath}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(outputDir, '01-home.png'), fullPage: true });

  await page.waitForSelector('.taskbar-tab[data-tab="map"]');
  const mapTab = page.locator('.taskbar-tab[data-tab="map"]');
  await mapTab.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outputDir, '02-map.png'), fullPage: true });

  const favoritesTab = page.locator('.taskbar-tab[data-tab="favorites"]');
  await favoritesTab.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outputDir, '03-favorites.png'), fullPage: true });

  await browser.close();
  console.log(`Saved screenshots to ${outputDir}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

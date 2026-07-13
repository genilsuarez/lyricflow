const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

(async () => {
  const BASE = 'http://localhost:51447';
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const dir = __dirname;

  // Load player
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.song-list-item');
  await page.click('.song-list-item');
  await page.waitForSelector('.subtitle-container');
  await page.waitForTimeout(400);

  // 1. Vocab mode (light)
  await page.click('.toggle-vocab-btn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/mobile-vocab-light.png` });
  console.log('1/4 vocab-light done');

  // 2. Vocab dark
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/mobile-vocab-dark.png` });
  console.log('2/4 vocab-dark done');

  // Go back to player with blanks - reload approach
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.song-list-item');
  await page.click('.song-list-item');
  await page.waitForSelector('.subtitle-container');
  await page.waitForTimeout(400);

  // 3. Blanks mode (light)
  await page.click('.toggle-blanks-btn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/mobile-blanks-light.png` });
  console.log('3/4 blanks-light done');

  // 4. Blanks dark
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/mobile-blanks-dark.png` });
  console.log('4/4 blanks-dark done');

  await browser.close();
  console.log('All done!');
})();

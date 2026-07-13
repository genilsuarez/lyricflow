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

  // Load player directly
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.song-list-item');
  await page.waitForTimeout(300);

  // Click first song to enter player
  await page.click('.song-list-item');
  await page.waitForSelector('.subtitle-container');
  await page.waitForTimeout(400);

  // 1. Vocab mode (light)
  const vocabBtn = await page.$('.toggle-vocab-btn');
  if (vocabBtn) {
    await vocabBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/mobile-vocab-light.png` });
    console.log('1/4 vocab-light done');

    // dark
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/mobile-vocab-dark.png` });
    console.log('2/4 vocab-dark done');

    // close vocab
    await vocabBtn.click();
    await page.waitForTimeout(300);
  } else {
    console.log('vocab btn not found');
  }

  // 3. Blanks mode (dark)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const blanksBtn = await page.$('.toggle-blanks-btn');
  if (blanksBtn) {
    await blanksBtn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/mobile-blanks-dark.png` });
    console.log('3/4 blanks-dark done');

    // light
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/mobile-blanks-light.png` });
    console.log('4/4 blanks-light done');
  } else {
    console.log('blanks btn not found');
  }

  await browser.close();
  console.log('All done!');
})();

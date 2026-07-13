const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

(async () => {
  const BASE = 'http://localhost:51447';
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const dir = __dirname;

  // Load song directly via query param
  await page.goto(BASE + '?song=Hello_Goodbye', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.subtitle-container');
  await page.waitForTimeout(500);

  // Blanks mode (light)
  await page.click('.toggle-blanks-btn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/mobile-blanks-light.png` });
  console.log('1/2 blanks-light done');

  // Blanks dark
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/mobile-blanks-dark.png` });
  console.log('2/2 blanks-dark done');

  await browser.close();
  console.log('Done!');
})();

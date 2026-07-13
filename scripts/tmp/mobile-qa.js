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

  // 1. Song Picker (light)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.song-list-item');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/mobile-picker-light.png` });
  console.log('1/6 picker-light done');

  // 2. Song Picker (dark)
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/mobile-picker-dark.png` });
  console.log('2/6 picker-dark done');

  // 3. Player view — click first song (dark)
  await page.click('.song-list-item');
  await page.waitForSelector('.subtitle-container');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/mobile-player-dark.png` });
  console.log('3/6 player-dark done');

  // 4. Player view (light)
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/mobile-player-light.png` });
  console.log('4/6 player-light done');

  // 5. Quiz mode
  const quizBtn = await page.$('.toggle-quiz-btn');
  if (quizBtn) {
    await quizBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/mobile-quiz-light.png` });
    console.log('5/6 quiz-light done');
    // dark
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/mobile-quiz-dark.png` });
    console.log('5b/6 quiz-dark done');
  } else {
    console.log('5/6 quiz btn not found, skipped');
  }

  // 6. Blanks mode — go back and re-enter player
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.song-list-item');
  await page.click('.song-list-item');
  await page.waitForSelector('.subtitle-container');
  await page.waitForTimeout(300);
  const blanksBtn = await page.$('.toggle-blanks-btn');
  if (blanksBtn) {
    await blanksBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/mobile-blanks-light.png` });
    console.log('6/6 blanks-light done');
  } else {
    console.log('6/6 blanks btn not found, skipped');
  }

  await browser.close();
  console.log('All done!');
})();

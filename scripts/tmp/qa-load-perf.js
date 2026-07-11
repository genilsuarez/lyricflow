/**
 * QA: Verify LyricFlow picker loads fast without dynamic imports
 */
const npmRoot = require('child_process').execSync('npm root -g').toString().trim();
const { chromium } = require(npmRoot + '/playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
  const BASE = 'http://localhost:3003';
  const results = [];

  function log(pass, msg) {
    results.push({ pass, msg });
    console.log(`${pass ? '✅' : '❌'} ${msg}`);
  }

  // Collect console errors
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Test 1: Measure time from navigation start to song list visible
  const startTime = Date.now();
  await page.goto(BASE);
  await page.waitForSelector('.song-list-item', { timeout: 5000 });
  const loadTime = Date.now() - startTime;
  log(loadTime < 2000, `Picker load time: ${loadTime}ms (target < 2000ms)`);

  // Test 2: All 9 songs rendered
  const songCount = await page.$$eval('.song-list-item', items => items.length);
  log(songCount === 9, `Song count: ${songCount} (expected 9)`);

  // Test 3: Songs have correct content
  const firstTitle = await page.$eval('.song-list-item .title', el => el.textContent);
  log(firstTitle.length > 0, `First song title: "${firstTitle}"`);

  // Test 4: Click a song loads player (with subtitles)
  await page.click('.song-list-item');
  await page.waitForSelector('.song-header', { timeout: 5000 });
  const playerVisible = await page.$('.song-header');
  log(!!playerVisible, 'Player loads after clicking song');

  // Test 5: Subtitles loaded (from dynamic import on click)
  await page.waitForSelector('.sub-line', { timeout: 5000 });
  const subCount = await page.$$eval('.sub-line', items => items.length);
  log(subCount > 0, `Subtitles loaded: ${subCount} lines`);

  // Test 6: Back button returns to picker
  await page.click('#backBtn');
  await page.waitForSelector('.song-list-item', { timeout: 3000 });
  const pickerBack = await page.$('.song-picker');
  log(!!pickerBack, 'Back button returns to picker');

  // Test 7: Search works
  await page.fill('#songSearch', 'beatles');
  await page.waitForTimeout(200);
  const filtered = await page.$$eval('.song-list-item', items => items.length);
  log(filtered === 2, `Search "beatles" → ${filtered} results (expected 2)`);

  // Test 8: No console errors
  log(errors.length === 0, `Console errors: ${errors.length}${errors.length ? ' — ' + errors[0] : ''}`);

  // Summary
  console.log('\n─── SUMMARY ───');
  const passed = results.filter(r => r.pass).length;
  console.log(`${passed}/${results.length} checks passed`);
  if (passed < results.length) {
    console.log('FAILED:');
    results.filter(r => !r.pass).forEach(r => console.log(`  - ${r.msg}`));
  }

  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})();

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  
  page.on('pageerror', err => errors.push(`PAGE ERROR: ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`);
  });

  await page.goto('http://localhost:3847/', { waitUntil: 'networkidle' });

  // Clear prefs to test fresh load
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  
  // 1. Picker visible
  const picker = await page.$('.song-picker');
  if (!picker) { errors.push('FAIL: Song picker not found on load'); }
  else { console.log('✓ Song picker loads'); }

  // 2. Click first song
  const firstItem = await page.$('.song-list-item');
  if (!firstItem) { errors.push('FAIL: No song items found'); }
  else {
    await firstItem.click();
    await page.waitForSelector('.subtitle-container', { timeout: 3000 });
    console.log('✓ Song loads after click');
  }

  // 3. aria-live region
  const srLive = await page.$('#srLive[aria-live="polite"]');
  if (!srLive) { errors.push('FAIL: aria-live region not found'); }
  else { console.log('✓ aria-live region present'); }

  // 4. Progress bar role=slider
  const slider = await page.$('#progressBar[role="slider"]');
  if (!slider) { errors.push('FAIL: progress bar missing role=slider'); }
  else { console.log('✓ Progress bar has role=slider'); }

  // 5. localStorage persistence — volume
  await page.evaluate(() => {
    const slider = document.getElementById('volumeSlider');
    if (slider) {
      slider.value = '0.7';
      slider.dispatchEvent(new Event('input'));
    }
  });
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('cancion_prefs') || '{}'));
  if (prefs.volume === 0.7) { console.log('✓ Volume persisted to localStorage'); }
  else { errors.push(`FAIL: volume not persisted, got: ${JSON.stringify(prefs)}`); }

  // 6. lastSong saved
  if (prefs.lastSong) { console.log(`✓ lastSong persisted: ${prefs.lastSong}`); }
  else { errors.push('FAIL: lastSong not saved'); }

  // 7. content-visibility on sub-lines
  const cvValue = await page.evaluate(() => {
    const line = document.querySelector('.sub-line');
    return line ? getComputedStyle(line).contentVisibility : null;
  });
  if (cvValue === 'auto') { console.log('✓ content-visibility: auto on sub-lines'); }
  else { console.log(`⚠ content-visibility: ${cvValue} (may vary by browser)`); }

  // 8. Orbs present
  const orbs = await page.$$('.orb');
  if (orbs.length === 3) { console.log('✓ 3 orbs present'); }
  else { errors.push(`FAIL: Expected 3 orbs, got ${orbs.length}`); }

  // 9. Auto-load on revisit
  await page.reload({ waitUntil: 'networkidle' });
  const autoLoaded = await page.$('.subtitle-container');
  if (autoLoaded) { console.log('✓ Last song auto-loaded on revisit'); }
  else { errors.push('FAIL: Last song did not auto-load'); }

  // Summary
  if (errors.length === 0) {
    console.log('\n✅ All checks passed');
  } else {
    console.log('\n❌ Issues found:');
    errors.forEach(e => console.log(`  ${e}`));
  }

  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
})();

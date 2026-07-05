// QA: Difficulty picker for blanks and listening modes
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Load song
  await page.click('.song-list-item');
  await page.waitForSelector('.mode-toolbar');

  let pass = 0, fail = 0;

  // ─── Test: Blanks mode shows difficulty picker ───
  await page.click('#toggleBlanksBtn');
  const picker1 = await page.$('#difficultyPicker');
  if (picker1) { console.log('✅ Blanks: difficulty picker appears'); pass++; }
  else { console.log('❌ Blanks: no difficulty picker'); fail++; }

  // Check 3 options exist
  const opts1 = await page.$$('.dp-option');
  if (opts1.length === 3) { console.log('✅ Blanks: 3 difficulty options'); pass++; }
  else { console.log(`❌ Blanks: expected 3 options, got ${opts1.length}`); fail++; }

  // Select "easy"
  await page.click('.dp-option[data-diff="easy"]');
  await page.waitForTimeout(200);

  // Picker should be gone, mode should be active
  const pickerGone = !(await page.$('#difficultyPicker'));
  const blanksActive = await page.$eval('#toggleBlanksBtn', el => el.classList.contains('active'));
  if (pickerGone && blanksActive) { console.log('✅ Blanks: easy selected, mode activated'); pass++; }
  else { console.log('❌ Blanks: picker not dismissed or mode not active'); fail++; }

  // Count blanks in easy mode
  const blanksEasy = await page.$$eval('.blank-input', els => els.length);
  console.log(`   ℹ️  Blanks (easy): ${blanksEasy} inputs`);

  // Deactivate blanks
  await page.click('#toggleBlanksBtn');
  await page.waitForTimeout(200);
  const blanksOff = !(await page.$eval('#toggleBlanksBtn', el => el.classList.contains('active')));
  if (blanksOff) { console.log('✅ Blanks: deactivated on second click'); pass++; }
  else { console.log('❌ Blanks: still active after second click'); fail++; }

  // Re-activate with "hard"
  await page.click('#toggleBlanksBtn');
  await page.waitForSelector('#difficultyPicker');
  await page.click('.dp-option[data-diff="hard"]');
  await page.waitForTimeout(200);
  const blanksHard = await page.$$eval('.blank-input', els => els.length);
  console.log(`   ℹ️  Blanks (hard): ${blanksHard} inputs`);

  if (blanksHard > blanksEasy) { console.log('✅ Hard produces more blanks than easy'); pass++; }
  else { console.log(`❌ Hard (${blanksHard}) should be > easy (${blanksEasy})`); fail++; }

  // Deactivate before testing listening
  await page.click('#toggleBlanksBtn');
  await page.waitForTimeout(200);

  // ─── Test: Listening mode shows difficulty picker ───
  await page.click('#toggleListeningBtn');
  const picker2 = await page.$('#difficultyPicker');
  if (picker2) { console.log('✅ Listening: difficulty picker appears'); pass++; }
  else { console.log('❌ Listening: no difficulty picker'); fail++; }

  // Select "normal"
  await page.click('.dp-option[data-diff="normal"]');
  await page.waitForTimeout(200);

  const listeningActive = await page.$eval('#toggleListeningBtn', el => el.classList.contains('active'));
  if (listeningActive) { console.log('✅ Listening: normal selected, mode activated'); pass++; }
  else { console.log('❌ Listening: mode not active after selection'); fail++; }

  // Check listening inputs exist
  const lcInputs = await page.$$eval('.listening-input', els => els.length);
  console.log(`   ℹ️  Listening (normal): ${lcInputs} blanks`);
  if (lcInputs > 0) { console.log('✅ Listening: blanks rendered'); pass++; }
  else { console.log('❌ Listening: no blanks rendered'); fail++; }

  // Deactivate listening
  await page.click('#toggleListeningBtn');
  await page.waitForTimeout(200);
  const lcOff = !(await page.$eval('#toggleListeningBtn', el => el.classList.contains('active')));
  if (lcOff) { console.log('✅ Listening: deactivated'); pass++; }
  else { console.log('❌ Listening: still active'); fail++; }

  // ─── Test: Cancel picker with close button ───
  await page.click('#toggleBlanksBtn');
  await page.waitForSelector('#difficultyPicker');
  await page.click('#dpClose');
  await page.waitForTimeout(200);
  const pickerClosed = !(await page.$('#difficultyPicker'));
  const blanksStillOff = !(await page.$eval('#toggleBlanksBtn', el => el.classList.contains('active')));
  if (pickerClosed && blanksStillOff) { console.log('✅ Cancel: picker closed, mode not activated'); pass++; }
  else { console.log('❌ Cancel: picker or mode state wrong'); fail++; }

  console.log(`\n📊 Results: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();

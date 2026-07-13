const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 820 } });

  await page.goto('http://localhost:51026');
  await page.waitForTimeout(2500);

  // Click the first song
  const songItem = await page.$('.song-list-item');
  if (!songItem) {
    console.log('No .song-list-item found');
    await page.screenshot({ path: 'scripts/tmp/quiz-debug-picker.png' });
    await browser.close();
    return;
  }
  await songItem.click();
  await page.waitForTimeout(2500);

  // Find quiz button by tooltip or aria-label
  const allBtns = await page.$$('button');
  let quizClicked = false;
  for (const btn of allBtns) {
    const tooltip = await btn.getAttribute('data-tooltip') || '';
    const label = await btn.getAttribute('aria-label') || '';
    const text = (await btn.textContent()).trim();
    if (tooltip.toLowerCase().includes('quiz') || label.toLowerCase().includes('quiz') || text.toLowerCase().includes('quiz')) {
      await btn.click();
      quizClicked = true;
      console.log(`Clicked quiz button: tooltip="${tooltip}" label="${label}"`);
      break;
    }
  }

  if (!quizClicked) {
    console.log('Quiz button not found. Available buttons:');
    for (const btn of allBtns.slice(0, 20)) {
      const tooltip = await btn.getAttribute('data-tooltip') || '';
      const label = await btn.getAttribute('aria-label') || '';
      const text = (await btn.textContent()).trim().slice(0, 30);
      console.log(`  "${text}" tooltip="${tooltip}" label="${label}"`);
    }
    await page.screenshot({ path: 'scripts/tmp/quiz-debug-player.png' });
    await browser.close();
    return;
  }

  await page.waitForTimeout(1500);

  // Screenshot quiz view
  await page.screenshot({ path: 'scripts/tmp/quiz-design-modern.png' });
  console.log('Saved: scripts/tmp/quiz-design-modern.png');

  // Click first option to see feedback
  const option = await page.$('.quiz-option');
  if (option) {
    await option.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'scripts/tmp/quiz-design-answered.png' });
    console.log('Saved: scripts/tmp/quiz-design-answered.png');

    // Click "Siguiente" to go to next question and then results eventually
    const nextBtn = await page.$('.quiz-next-btn');
    if (nextBtn) {
      await nextBtn.click();
      await page.waitForTimeout(500);
    }
  }

  await browser.close();
  console.log('Done!');
})();

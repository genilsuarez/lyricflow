const globalModules = require('child_process').execSync('npm root -g').toString().trim();
const { chromium } = require(globalModules + '/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => consoleMessages.push({ type: 'pageerror', text: err.message }));
  
  const failedRequests = [];
  page.on('requestfailed', req => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  // Also track responses with errors
  const badResponses = [];
  page.on('response', resp => {
    if (resp.status() >= 400) {
      badResponses.push({ url: resp.url(), status: resp.status() });
    }
  });

  console.log('=== LyricFlow Navigation Debug ===\n');

  // Load the picker
  console.log('1. Loading picker at http://localhost:3000/lyricflow/');
  const response = await page.goto('http://localhost:3000/lyricflow/', { waitUntil: 'networkidle' });
  console.log(`   HTTP status: ${response.status()}`);
  
  // Check what rendered
  const appHTML = await page.$eval('#app', el => el.innerHTML.substring(0, 500));
  console.log(`   #app content preview: ${appHTML.substring(0, 200)}...`);
  
  const songItems = await page.$$('.song-list-item');
  console.log(`   Song items: ${songItems.length}`);

  if (songItems.length === 0) {
    console.log('\n   PROBLEM: Picker did not render songs.');
    console.log('   Console messages:');
    consoleMessages.forEach(m => console.log(`     [${m.type}] ${m.text}`));
    console.log('   Bad responses:');
    badResponses.forEach(r => console.log(`     ${r.status} ${r.url}`));
    await browser.close();
    process.exit(1);
  }

  // Click first song
  console.log('\n2. Clicking first song...');
  const songName = await songItems[0].$eval('.title', el => el.textContent);
  console.log(`   Target: ${songName}`);
  
  // Clear tracking
  consoleMessages.length = 0;
  failedRequests.length = 0;
  badResponses.length = 0;

  await songItems[0].click();
  
  // Wait more time for everything to settle
  await page.waitForTimeout(3000);

  // Check current state
  const currentURL = page.url();
  console.log(`   Current URL: ${currentURL}`);
  
  const hasPlayerUI = await page.$('.song-header');
  const hasBackBtn = await page.$('#backBtn');
  const hasSongTitle = await page.$('.song-title');
  const hasSubContainer = await page.$('#subContainer');
  const hasAudioError = await page.$('.audio-error');
  const subLines = await page.$$('.sub-line');
  
  console.log(`   Player header: ${!!hasPlayerUI}`);
  console.log(`   Back button: ${!!hasBackBtn}`);
  console.log(`   Song title: ${!!hasSongTitle}`);
  console.log(`   Sub container: ${!!hasSubContainer}`);
  console.log(`   Audio error shown: ${!!hasAudioError}`);
  console.log(`   Subtitle lines: ${subLines.length}`);

  if (hasSongTitle) {
    const titleText = await hasSongTitle.textContent();
    console.log(`   Title text: "${titleText}"`);
  }

  // Full app HTML after click
  const appAfter = await page.$eval('#app', el => el.innerHTML);
  if (appAfter.length < 100) {
    console.log(`   #app HTML (short): ${appAfter}`);
  } else {
    console.log(`   #app HTML length: ${appAfter.length} chars`);
    console.log(`   First 300: ${appAfter.substring(0, 300)}`);
  }

  // Console messages after click
  console.log('\n3. Console messages after click:');
  if (consoleMessages.length === 0) console.log('   (none)');
  consoleMessages.forEach(m => console.log(`   [${m.type}] ${m.text}`));

  console.log('\n4. Failed requests:');
  if (failedRequests.length === 0) console.log('   (none - all resolved)');
  failedRequests.forEach(r => console.log(`   ${r.url} → ${r.failure}`));

  console.log('\n5. Bad HTTP responses (4xx/5xx):');
  if (badResponses.length === 0) console.log('   (none)');
  badResponses.forEach(r => console.log(`   ${r.status} ${r.url}`));

  // Also screenshot for visual
  await page.screenshot({ path: '/tmp/lyricflow-after-click.png', fullPage: true });
  console.log('\n   Screenshot: /tmp/lyricflow-after-click.png');

  await browser.close();
  console.log('\n=== Done ===');
})();

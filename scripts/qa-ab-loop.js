/**
 * QA: Verify A→B loop button behavior.
 * Tests: set A, cancel from setting state (B≤A), set valid B, clear active loop.
 * Run: ./scripts/qa ab-loop
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.mp4':'video/mp4' };

function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const fp = path.join(ROOT, decodeURIComponent(req.url === '/' ? '/index.html' : req.url));
      if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  let exitCode = 0;
  let passed = 0;
  let total = 0;

  function check(label, condition) {
    total++;
    if (condition) { passed++; console.log(`  ✓ ${label}`); }
    else { console.log(`  ✗ ${label}`); exitCode = 1; }
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:${port}`);
    await page.waitForSelector('.song-list-item', { timeout: 5000 });
    await page.click('.song-list-item');
    await page.waitForSelector('#loopBtn', { timeout: 5000 });

    // Wait for audio to exist in DOM
    await page.waitForFunction(() => !!document.querySelector('audio'), { timeout: 5000 });
    await page.waitForTimeout(500);

    // Helpers
    const getBtn = () => page.$eval('#loopBtn', el => ({
      text: el.textContent.trim(),
      classes: [...el.classList]
    }));
    const getIndicator = () => page.$eval('#loopIndicator', el => el.textContent.trim());
    const seekTo = (t) => page.evaluate((time) => {
      const audio = document.querySelector('audio');
      if (audio) audio.currentTime = time;
    }, t);

    // ─── Test 1: Set point A ───────────────────────────────────────────
    console.log('\n[1] Set point A');
    await seekTo(10);
    await page.waitForTimeout(100);
    await page.click('#loopBtn');
    await page.waitForTimeout(100);

    let btn = await getBtn();
    let ind = await getIndicator();
    check('Button shows "A→"', btn.text === 'A→');
    check('Button has "setting" class', btn.classes.includes('setting'));
    check('Indicator shows A time', ind.includes('A:'));

    // ─── Test 2: Cancel from setting state (time ≤ A) ──────────────────
    console.log('\n[2] Cancel from setting state (seek before A, click)');
    await seekTo(5);
    await page.waitForTimeout(100);
    await page.click('#loopBtn');
    await page.waitForTimeout(100);

    btn = await getBtn();
    ind = await getIndicator();
    check('Button reverts to "⟳"', btn.text === '⟳');
    check('Button loses "setting" class', !btn.classes.includes('setting'));
    check('Indicator shows "Cancelado"', ind === 'Cancelado');

    // Wait for indicator to clear
    await page.waitForTimeout(1600);
    ind = await getIndicator();
    check('Indicator clears after timeout', ind === '');

    // ─── Test 3: Cancel at same position as A ──────────────────────────
    console.log('\n[3] Cancel at exact A position (click twice at same spot)');
    await seekTo(15);
    await page.waitForTimeout(100);
    await page.click('#loopBtn');
    await page.waitForTimeout(100);
    await page.click('#loopBtn');
    await page.waitForTimeout(100);

    btn = await getBtn();
    check('Double click at same pos → cancels', btn.text === '⟳' && !btn.classes.includes('setting'));

    // ─── Test 4: Set valid A→B loop ────────────────────────────────────
    console.log('\n[4] Set valid A→B loop');
    await seekTo(10);
    await page.waitForTimeout(100);
    await page.click('#loopBtn');
    await page.waitForTimeout(100);
    await seekTo(25);
    await page.waitForTimeout(100);
    await page.click('#loopBtn');
    await page.waitForTimeout(100);

    btn = await getBtn();
    ind = await getIndicator();
    check('Button shows "⟳" with active class', btn.text === '⟳' && btn.classes.includes('active'));
    check('Indicator shows A → B range', ind.includes('→') && !ind.includes('A:'));

    const regionVisible = await page.$eval('#loopRegion', el => el.style.display !== 'none');
    check('Loop region visible on progress bar', regionVisible);

    // ─── Test 5: Clear active loop ─────────────────────────────────────
    console.log('\n[5] Clear active loop');
    await page.click('#loopBtn');
    await page.waitForTimeout(100);

    btn = await getBtn();
    ind = await getIndicator();
    check('Button back to idle "⟳"', btn.text === '⟳');
    check('No active/setting classes', !btn.classes.includes('active') && !btn.classes.includes('setting'));
    check('Indicator empty', ind === '');

    const regionHidden = await page.$eval('#loopRegion', el => el.style.display === 'none');
    check('Loop region hidden', regionHidden);

    // ─── Summary ───────────────────────────────────────────────────────
    console.log(`\n${passed}/${total} checks passed`);
    if (exitCode === 0) console.log('✓ A→B loop behavior correct');

    await browser.close();
  } catch (e) {
    console.error('Error:', e.message);
    exitCode = 1;
  }
  server.close();
  process.exit(exitCode);
})();

/**
 * QA: Verify custom tooltips appear on hover for control buttons.
 * Run: NODE_PATH=$(npm root -g) node scripts/qa-tooltips.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.mp4':'video/mp4' };

const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, decodeURIComponent(req.url === '/' ? '/index.html' : req.url));
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

server.listen(0, async () => {
  const port = server.address().port;
  let exitCode = 0;
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://localhost:${port}`);
    await page.waitForSelector('.song-list-item', { timeout: 5000 });
    await page.click('.song-list-item');
    await page.waitForSelector('.ctrl-group', { timeout: 5000 });

    // 1. Verify data-tooltip attributes exist
    const btns = await page.$$eval('.ctrl-group [data-tooltip]', els =>
      els.map(el => ({ text: el.textContent.trim(), tooltip: el.dataset.tooltip }))
    );
    console.log(`✓ Found ${btns.length} tooltip buttons`);
    btns.forEach(b => console.log(`  ${b.text} → "${b.tooltip}"`));

    if (btns.length === 0) {
      console.log('✗ No data-tooltip buttons found');
      exitCode = 1;
    }

    // 2. Hover each button and check ::after opacity
    const selectors = await page.$$('.ctrl-group [data-tooltip]');
    let passed = 0;
    for (const btn of selectors) {
      await btn.hover();
      await page.waitForTimeout(300);
      const info = await btn.evaluate(el => {
        const s = window.getComputedStyle(el, '::after');
        return { content: s.content, opacity: s.opacity, tooltip: el.dataset.tooltip };
      });
      const visible = parseFloat(info.opacity) > 0.5;
      if (visible) {
        passed++;
      } else {
        console.log(`  ⚠ "${info.tooltip}" — opacity: ${info.opacity}, content: ${info.content}`);
      }
    }

    console.log(`\n${passed}/${selectors.length} tooltips visible on hover`);
    if (passed < selectors.length) {
      console.log('✗ Some tooltips not appearing');
      exitCode = 1;
    } else {
      console.log('✓ All tooltips working');
    }

    // 3. Check no native title attributes (would cause double tooltip)
    const nativeTitles = await page.$$eval('.ctrl-group button[title]', els => els.length);
    if (nativeTitles > 0) {
      console.log(`⚠ ${nativeTitles} buttons still have native title attr`);
    } else {
      console.log('✓ No native title attributes (no double tooltip)');
    }

    await browser.close();
  } catch (e) {
    console.error('Error:', e.message);
    exitCode = 1;
  }
  server.close();
  process.exit(exitCode);
});

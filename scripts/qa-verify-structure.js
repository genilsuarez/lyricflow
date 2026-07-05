const { chromium } = require('playwright');
const { createServer } = require('http');
const { readFileSync, existsSync } = require('fs');
const { resolve, extname } = require('path');

const ROOT = resolve(__dirname, '..');
const PORT = 9879;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};

const server = createServer((req, res) => {
  const filePath = resolve(ROOT, decodeURIComponent(req.url).slice(1) || 'index.html');
  if (!existsSync(filePath)) { res.writeHead(404); res.end(); return; }
  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

(async () => {
  server.listen(PORT);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('\n🔍 Verificando player rediseñado...\n');

  // 1. Load index
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.song-picker');
  console.log('✅ Song picker visible');

  // 2. Song list
  const songCount = await page.locator('.song-list-item').count();
  console.log(songCount > 0 ? `✅ ${songCount} canción(es) listada(s)` : '❌ Listado vacío');

  // 3. Click Indila
  await page.locator('.song-list-item').first().click();
  await page.waitForSelector('.subtitle-container');

  const title = await page.locator('.song-title').textContent();
  console.log(title === 'Dernière Danse' ? '✅ Carga correcta: Dernière Danse' : `❌ Título: ${title}`);

  // 4. Subtitle count
  const subCount = await page.locator('.sub-line').count();
  console.log(subCount === 41 ? `✅ 41 líneas de subtítulos` : `❌ Esperado 41, hay ${subCount}`);

  // 5. Translation toggle
  await page.locator('#toggleTransBtn').click();
  const transVisible = await page.locator('.sub-line.show-trans').count();
  console.log(transVisible === 41 ? '✅ Toggle traducción OK' : `❌ Traducciones: ${transVisible}/41`);

  // 6. Back navigation
  await page.locator('#backBtn').click();
  await page.waitForSelector('.song-picker');
  console.log('✅ Navegación back OK');

  // 7. Re-enter player
  await page.locator('.song-list-item').first().click();
  await page.waitForSelector('#playBtn');
  console.log('✅ Re-render player OK');

  // 8. Check CSS custom properties loaded (design tokens)
  const accentColor = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  );
  console.log(accentColor === '#2563eb' ? '✅ Design tokens cargados (--accent)' : `❌ --accent: ${accentColor}`);

  // 9. Check Fraunces font applied to title
  const fontFamily = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.song-title')).fontFamily
  );
  const hasFraunces = fontFamily.includes('Fraunces');
  console.log(hasFraunces ? '✅ Tipografía Fraunces en títulos' : `⚠️  Font fallback (red sin Google Fonts): ${fontFamily}`);

  console.log('\n📊 Verificación completada.\n');

  await browser.close();
  server.close();
})();

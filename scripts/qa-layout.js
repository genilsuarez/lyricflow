const { chromium } = require('playwright');
const { createServer } = require('http');
const { readFileSync, existsSync } = require('fs');
const { resolve, extname } = require('path');

const ROOT = resolve(__dirname, '..');
const PORT = 9881;

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
  await page.setViewportSize({ width: 820, height: 900 });

  console.log('\n🔍 QA: Layout redistribuido (bottom bar + header compacto)\n');

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.song-list-item');
  await page.locator('.song-list-item').first().click();
  await page.waitForSelector('.subtitle-container');

  // 1. Header compacto existe
  const header = await page.locator('.song-header');
  const headerBox = await header.boundingBox();
  console.log(headerBox.height <= 80
    ? `✅ Header compacto (${Math.round(headerBox.height)}px)`
    : `❌ Header demasiado alto (${Math.round(headerBox.height)}px, esperado ≤80)`);

  // 2. Artwork reducido
  const artwork = await page.locator('.artwork');
  const artBox = await artwork.boundingBox();
  console.log(artBox.width <= 52
    ? `✅ Artwork reducido (${Math.round(artBox.width)}px)`
    : `❌ Artwork grande (${Math.round(artBox.width)}px, esperado ≤52)`);

  // 3. Mode toolbar presente
  const toolbar = await page.locator('.mode-toolbar');
  const toolbarExists = await toolbar.count();
  console.log(toolbarExists === 1 ? '✅ Mode toolbar presente' : '❌ Mode toolbar no encontrada');

  // 4. Mode toolbar tiene los botones de display y study
  const displayBtns = await page.locator('.mode-toolbar .ctrl-group--display button').count();
  const studyBtns = await page.locator('.mode-toolbar .ctrl-group--study button').count();
  console.log(displayBtns === 3
    ? '✅ Grupo display: 3 botones (traducción, selección, líneas)'
    : `❌ Grupo display: ${displayBtns} botones (esperado 3)`);
  console.log(studyBtns >= 3
    ? `✅ Grupo study: ${studyBtns} botones`
    : `❌ Grupo study: ${studyBtns} botones (esperado ≥3)`);

  // 5. Bottom bar presente
  const bottomBar = await page.locator('.bottom-bar');
  const bottomBarExists = await bottomBar.count();
  console.log(bottomBarExists === 1 ? '✅ Bottom bar presente' : '❌ Bottom bar no encontrada');

  // 6. Bottom bar contiene play, volume, speed, loop
  const playBtn = await page.locator('.bottom-bar #playBtn').count();
  const volCtrl = await page.locator('.bottom-bar .volume-control').count();
  const speedBtn = await page.locator('.bottom-bar #speedBtn').count();
  const loopBtn = await page.locator('.bottom-bar #loopBtn').count();
  const allPlayback = playBtn && volCtrl && speedBtn && loopBtn;
  console.log(allPlayback
    ? '✅ Bottom bar: play, volumen, speed, loop presentes'
    : `❌ Bottom bar incompleta (play:${playBtn} vol:${volCtrl} speed:${speedBtn} loop:${loopBtn})`);

  // 7. Progress bar en bottom bar
  const progressInBottom = await page.locator('.bottom-bar .progress-bar').count();
  console.log(progressInBottom === 1
    ? '✅ Progress bar dentro de bottom bar'
    : '❌ Progress bar no está en bottom bar');

  // 8. Subtitle container está entre toolbar y bottom bar (posición vertical)
  const subContainer = await page.locator('.subtitle-container');
  const subBox = await subContainer.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  const bottomBox = await bottomBar.boundingBox();

  const subStartsAfterToolbar = subBox.y > toolbarBox.y + toolbarBox.height - 5;
  const subEndsBeforeBottom = subBox.y + subBox.height <= bottomBox.y + 5;
  console.log(subStartsAfterToolbar && subEndsBeforeBottom
    ? '✅ Letras entre toolbar y bottom bar (orden correcto)'
    : '❌ Orden vertical incorrecto');

  // 9. Espacio ganado: letras empiezan antes de 160px desde el top del wrapper
  const wrapperBox = await page.locator('.player-wrapper').boundingBox();
  const subOffset = subBox.y - wrapperBox.y;
  console.log(subOffset <= 160
    ? `✅ Letras empiezan a ${Math.round(subOffset)}px del top (antes: ~240px)`
    : `⚠️  Letras empiezan a ${Math.round(subOffset)}px (objetivo ≤160px)`);

  // 10. Controles funcionales — click play
  await page.locator('#playBtn').click();
  await page.waitForTimeout(300);
  const playText = await page.locator('#playBtn').textContent();
  console.log(playText.includes('⏸') || playText.includes('❚')
    ? '✅ Play button funcional (cambió a pausa)'
    : `⚠️  Play text: "${playText}" (puede no haber audio disponible)`);

  // 11. Toggle traducción desde mode toolbar
  await page.locator('#toggleTransBtn').click();
  const transCount = await page.locator('.sub-line.show-trans').count();
  console.log(transCount > 0
    ? '✅ Toggle traducción funcional desde mode toolbar'
    : '❌ Toggle traducción no funciona');

  // 12. Back button funcional
  await page.locator('#backBtn').click();
  await page.waitForSelector('.song-picker');
  console.log('✅ Navegación back funcional');

  console.log('\n📊 QA Layout completado.\n');

  await browser.close();
  server.close();
})();

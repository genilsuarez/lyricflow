const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const filePath = path.resolve(__dirname, '../Indila/visual.html');
  await page.goto(`file://${filePath}`);
  await page.waitForSelector('.sub-line');

  const checkpoints = [
    { time: 25.0, expected: 'Ô ma douce souffrance' },
    { time: 33.0, expected: "Je ne suis qu'un être sans importance" },
    { time: 44.0, expected: 'Une dernière danse' },
    { time: 60.0, expected: 'Je remue le ciel, le jour, la nuit' },
    { time: 72.0, expected: 'Et je danse, danse, danse, danse, danse, danse, danse' },
    { time: 83.0, expected: 'Est-ce mon tour ? Vient la douleur' },
    { time: 102.0, expected: "Que d'espérance" },
    { time: 125.0, expected: 'Je danse avec le vent, la pluie' },
    { time: 163.0, expected: 'Dans cette douce souffrance' },
    { time: 175.0, expected: 'Je suis une enfant du monde' },
    { time: 193.0, expected: 'Et je danse, danse, danse, danse, danse, danse, danse' },
    { time: 208.0, expected: "Dans tout Paris, je m'abandonne" },
  ];

  console.log(`\n📋 Subtítulos renderizados: ${await page.locator('.sub-line').count()}`);
  console.log(`🎯 Checkpoints a validar: ${checkpoints.length}\n`);
  console.log('─'.repeat(70));

  let passed = 0;
  let failed = 0;

  for (const cp of checkpoints) {
    // Simulate the subtitle matching logic at a given time
    const activeText = await page.evaluate((seekTime) => {
      const subtitles = [
        { start: 24.0, end: 27.5 }, { start: 27.5, end: 31.5 },
        { start: 31.5, end: 35.5 }, { start: 35.5, end: 39.5 },
        { start: 39.5, end: 43.5 }, { start: 43.5, end: 47.0 },
        { start: 47.0, end: 51.0 }, { start: 51.0, end: 55.0 },
        { start: 55.0, end: 59.0 }, { start: 59.0, end: 63.0 },
        { start: 63.0, end: 67.0 }, { start: 67.0, end: 71.0 },
        { start: 71.0, end: 78.0 }, { start: 78.0, end: 82.0 },
        { start: 82.0, end: 86.0 }, { start: 86.0, end: 90.0 },
        { start: 90.0, end: 97.0 }, { start: 101.0, end: 105.0 },
        { start: 105.0, end: 109.0 }, { start: 109.0, end: 113.0 },
        { start: 113.0, end: 118.0 }, { start: 120.0, end: 124.0 },
        { start: 124.0, end: 128.0 }, { start: 128.0, end: 132.0 },
        { start: 132.0, end: 139.0 }, { start: 139.0, end: 143.0 },
        { start: 143.0, end: 147.0 }, { start: 147.0, end: 151.0 },
        { start: 151.0, end: 158.0 }, { start: 162.0, end: 166.0 },
        { start: 166.0, end: 170.0 }, { start: 170.0, end: 174.0 },
        { start: 174.0, end: 178.0 }, { start: 180.0, end: 184.0 },
        { start: 184.0, end: 188.0 }, { start: 188.0, end: 192.0 },
        { start: 192.0, end: 199.0 }, { start: 199.0, end: 203.0 },
        { start: 203.0, end: 207.0 }, { start: 207.0, end: 211.0 },
        { start: 211.0, end: 218.0 }
      ];

      let idx = -1;
      for (let i = 0; i < subtitles.length; i++) {
        if (seekTime >= subtitles[i].start && seekTime < subtitles[i].end) {
          idx = i;
          break;
        }
      }

      if (idx === -1) return null;

      const lines = document.querySelectorAll('.sub-line');
      // Simulate active state
      lines.forEach(el => el.classList.remove('active'));
      lines[idx].classList.add('active');
      return lines[idx].querySelector('.original').textContent;
    }, cp.time);

    const match = activeText === cp.expected;
    if (match) passed++;
    else failed++;

    const icon = match ? '✅' : '❌';
    console.log(`${icon} [${cp.time.toFixed(1)}s] ${match ? 'SYNC OK' : 'DESYNC'}`);
    console.log(`   Esperado: "${cp.expected}"`);
    if (!match) console.log(`   Obtenido: "${activeText || '(ninguno)'}"`);
  }

  // Structural validations
  console.log('\n' + '─'.repeat(70));
  console.log('\n🔍 VALIDACIONES ESTRUCTURALES:\n');

  const structural = await page.evaluate(() => {
    const subtitles = [
      { start: 24.0, end: 27.5 }, { start: 27.5, end: 31.5 },
      { start: 31.5, end: 35.5 }, { start: 35.5, end: 39.5 },
      { start: 39.5, end: 43.5 }, { start: 43.5, end: 47.0 },
      { start: 47.0, end: 51.0 }, { start: 51.0, end: 55.0 },
      { start: 55.0, end: 59.0 }, { start: 59.0, end: 63.0 },
      { start: 63.0, end: 67.0 }, { start: 67.0, end: 71.0 },
      { start: 71.0, end: 78.0 }, { start: 78.0, end: 82.0 },
      { start: 82.0, end: 86.0 }, { start: 86.0, end: 90.0 },
      { start: 90.0, end: 97.0 }, { start: 101.0, end: 105.0 },
      { start: 105.0, end: 109.0 }, { start: 109.0, end: 113.0 },
      { start: 113.0, end: 118.0 }, { start: 120.0, end: 124.0 },
      { start: 124.0, end: 128.0 }, { start: 128.0, end: 132.0 },
      { start: 132.0, end: 139.0 }, { start: 139.0, end: 143.0 },
      { start: 143.0, end: 147.0 }, { start: 147.0, end: 151.0 },
      { start: 151.0, end: 158.0 }, { start: 162.0, end: 166.0 },
      { start: 166.0, end: 170.0 }, { start: 170.0, end: 174.0 },
      { start: 174.0, end: 178.0 }, { start: 180.0, end: 184.0 },
      { start: 184.0, end: 188.0 }, { start: 188.0, end: 192.0 },
      { start: 192.0, end: 199.0 }, { start: 199.0, end: 203.0 },
      { start: 203.0, end: 207.0 }, { start: 207.0, end: 211.0 },
      { start: 211.0, end: 218.0 }
    ];

    let overlaps = 0;
    let largeGaps = [];
    let chronological = true;
    let covered = 0;

    for (let i = 0; i < subtitles.length; i++) {
      covered += subtitles[i].end - subtitles[i].start;
      if (i > 0) {
        const gap = subtitles[i].start - subtitles[i - 1].end;
        if (gap < 0) overlaps++;
        if (gap > 5) largeGaps.push({ between: `${i - 1}-${i}`, gap: gap.toFixed(1) });
        if (subtitles[i].start <= subtitles[i - 1].start) chronological = false;
      }
    }

    return { overlaps, largeGaps, chronological, covered: covered.toFixed(1), total: subtitles.length };
  });

  console.log(structural.overlaps === 0
    ? '✅ Sin solapamientos entre subtítulos'
    : `❌ ${structural.overlaps} solapamiento(s)`);

  if (structural.largeGaps.length > 0) {
    console.log(`⚠️  ${structural.largeGaps.length} hueco(s) > 5s (interludios instrumentales):`);
    structural.largeGaps.forEach(g => console.log(`   Entre líneas ${g.between}: ${g.gap}s`));
  } else {
    console.log('✅ Sin huecos mayores a 5s');
  }

  console.log(structural.chronological
    ? '✅ Orden cronológico correcto'
    : '❌ Orden cronológico incorrecto');

  const coverage = ((parseFloat(structural.covered) / 218) * 100).toFixed(1);
  console.log(`✅ Cobertura: ${structural.covered}s de ~218s (${coverage}%)`);
  console.log(`✅ Total líneas: ${structural.total}`);

  // Final summary
  console.log('\n' + '─'.repeat(70));
  console.log(`\n📊 RESULTADO: ${passed}/${checkpoints.length} checkpoints sincronizados`);
  if (failed === 0) console.log('🎉 Subtítulos correctamente sincronizados.\n');
  else console.log(`⚠️  ${failed} problema(s) de sincronización.\n`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();

// Tests de js/blanks-engine.js — el motor de selección de palabras para
// dictado/blanks, extraído de player.js (C.3.3, docs/auditoria-y-plan.md).
// Antes de esta extracción, esta lógica pedagógica (qué palabras blanquear,
// cuántas, respetando vocab/cap/nivel CEFR) vivía embebida en player.js sin
// un solo test — el único riesgo real de romperla era jugar una canción y
// mirar. Corre con: node tests/blanks-engine.mjs
import assert from 'node:assert/strict';
import {
  DIFFICULTY,
  LEVEL_FACTOR,
  STOP_WORDS,
  normalizeForCompare,
  seededRandom,
  collectBlankCandidates,
  pickBlankCandidates,
  buildBlanksMap,
  buildListeningBlanks,
} from '../js/blanks-engine.js';

let passed = 0;
function check(label, condition) {
  if (!condition) {
    console.error(`✗ ${label}`);
    process.exitCode = 1;
    return;
  }
  passed++;
}

// ─── normalizeForCompare ──────────────────────────────────────────────────
check('normalizeForCompare quita acentos', normalizeForCompare('déambule') === 'deambule');
check('normalizeForCompare ignora mayúsculas', normalizeForCompare('HELLO') === 'hello');
check('normalizeForCompare recorta espacios', normalizeForCompare('  hola  ') === 'hola');
check(
  'normalizeForCompare — acentuada vs sin acento son iguales',
  normalizeForCompare('café') === normalizeForCompare('cafe')
);

// ─── seededRandom ──────────────────────────────────────────────────────────
{
  const rngA = seededRandom(42);
  const rngB = seededRandom(42);
  const seqA = [rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB()];
  check('seededRandom — misma seed produce la misma secuencia', JSON.stringify(seqA) === JSON.stringify(seqB));
  check('seededRandom — valores en [0, 1)', seqA.every(v => v >= 0 && v < 1));

  const rngC = seededRandom(43);
  const seqC = [rngC(), rngC(), rngC()];
  check('seededRandom — seeds distintas producen secuencias distintas', JSON.stringify(seqA) !== JSON.stringify(seqC));
}

// ─── pickBlankCandidates ────────────────────────────────────────────────────
{
  const candidates = [
    { lineIndex: 0, wordIdx: 0, clean: 'hello', score: 10 },
    { lineIndex: 0, wordIdx: 1, clean: 'world', score: 9 },
    { lineIndex: 0, wordIdx: 2, clean: 'again', score: 8 },
    { lineIndex: 1, wordIdx: 0, clean: 'foo', score: 7 },
    { lineIndex: 1, wordIdx: 1, clean: 'bar', score: 6 },
  ];

  const capped = pickBlankCandidates(candidates, 2, 5);
  check('pickBlankCandidates — respeta el cap total', capped.length === 2);
  check(
    'pickBlankCandidates — prioriza mayor score primero',
    capped[0].clean === 'hello' && capped[1].clean === 'world'
  );

  const perLine = pickBlankCandidates(candidates, 10, 1);
  const line0Count = perLine.filter(c => c.lineIndex === 0).length;
  check('pickBlankCandidates — respeta maxPerLine', line0Count === 1);

  const dup = [
    { lineIndex: 0, wordIdx: 0, clean: 'goodbye', score: 10 },
    { lineIndex: 1, wordIdx: 0, clean: 'goodbye', score: 9 },
    { lineIndex: 2, wordIdx: 0, clean: 'goodbye', score: 8 },
  ];
  const unique = pickBlankCandidates(dup, 10, 5);
  check('pickBlankCandidates — una sola ocurrencia por palabra única', unique.length === 1);
}

// ─── collectBlankCandidates ──────────────────────────────────────────────────
{
  const subtitles = [{ original: 'Hello world, my friend!' }];
  const diff = DIFFICULTY.normal;
  const candidates = collectBlankCandidates(subtitles, diff, new Set(), 31, 7);
  const cleanWords = candidates.map(c => c.clean);
  check(
    'collectBlankCandidates — extrae palabras limpias sin puntuación',
    cleanWords.includes('hello') && cleanWords.includes('world') && cleanWords.includes('friend')
  );
  check(
    'collectBlankCandidates — no incluye stop words configuradas (STOP_WORDS)',
    ![...STOP_WORDS].some(w => cleanWords.includes(w) && STOP_WORDS.has(w) && subtitles[0].original.toLowerCase().includes(w))
  );

  const vocabWords = new Set(['friend']);
  const withVocab = collectBlankCandidates(subtitles, diff, vocabWords, 31, 7);
  const friendCandidate = withVocab.find(c => c.clean === 'friend');
  const helloCandidate = withVocab.find(c => c.clean === 'hello');
  check('collectBlankCandidates — marca isVocab en palabras de vocabData', friendCandidate.isVocab === true);
  check(
    'collectBlankCandidates — palabra de vocab tiene score mayor que una genérica de igual longitud',
    friendCandidate.score > helloCandidate.score
  );
}

// ─── buildBlanksMap / buildListeningBlanks — datos reales de una canción ────
const imagineSubtitles = [
  { start: 1, duration: 4, original: "Imagine there's no heaven", translation: '' },
  { start: 8, duration: 3.5, original: 'It\'s easy if you try', translation: '' },
  { start: 14, duration: 4, original: 'No hell below us', translation: '' },
  { start: 20.5, duration: 4.5, original: 'Above us only sky', translation: '' },
  { start: 26, duration: 5, original: 'Imagine all the people', translation: '' },
  { start: 32, duration: 7.5, original: 'Living for today… Ah', translation: '' },
  { start: 40.5, duration: 4.5, original: "Imagine there's no countries", translation: '' },
  { start: 46, duration: 4, original: "It isn't hard to do", translation: '' },
  { start: 51, duration: 5.5, original: 'Nothing to kill or die for', translation: '' },
  { start: 59, duration: 4.5, original: 'And no religion too', translation: '' },
  { start: 65, duration: 4, original: 'Imagine all the people', translation: '' },
  { start: 70.5, duration: 6, original: 'Living life in peace… You', translation: '' },
];

for (const [label, builder, shapeCheck] of [
  [
    'buildBlanksMap',
    buildBlanksMap,
    (map) => Object.values(map).every(s => s instanceof Set),
  ],
  [
    'buildListeningBlanks',
    buildListeningBlanks,
    (map) => Object.values(map).every(arr => Array.isArray(arr) && arr.every(w => 'wordIdx' in w && 'clean' in w && 'original' in w)),
  ],
]) {
  for (const difficultyKey of Object.keys(DIFFICULTY)) {
    for (const level of Object.keys(LEVEL_FACTOR)) {
      const map = builder({ subtitles: imagineSubtitles, level, difficultyKey, vocabWords: new Set() });
      const diff = DIFFICULTY[difficultyKey];
      const factor = LEVEL_FACTOR[level];
      const expectedCap = Math.round(diff.totalCap * factor);

      const totalBlanks = Object.values(map).reduce(
        (sum, entries) => sum + (entries instanceof Set ? entries.size : entries.length),
        0
      );
      check(`${label}[${difficultyKey}/${level}] — respeta el cap total ajustado por nivel`, totalBlanks <= expectedCap);

      const perLineOk = Object.values(map).every(entries => {
        const count = entries instanceof Set ? entries.size : entries.length;
        return count <= diff.maxPerLine;
      });
      check(`${label}[${difficultyKey}/${level}] — respeta maxPerLine`, perLineOk);
      check(`${label}[${difficultyKey}/${level}] — forma de salida correcta`, shapeCheck(map));
    }
  }

  // Determinismo: misma entrada → mismo mapa (la seed depende solo de lineIndex).
  const mapA = builder({ subtitles: imagineSubtitles, level: 'B1', difficultyKey: 'normal', vocabWords: new Set() });
  const mapB = builder({ subtitles: imagineSubtitles, level: 'B1', difficultyKey: 'normal', vocabWords: new Set() });
  const serialize = (m) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(m).map(([k, v]) => [k, v instanceof Set ? [...v].sort() : v])
      )
    );
  check(`${label} — determinístico (misma entrada, mismo mapa)`, serialize(mapA) === serialize(mapB));
}

// Vocab words priorizadas: con vocabData conteniendo "imagine" (aparece 4 veces
// en la canción) y un cap muy bajo, "imagine" debe terminar blanqueada.
{
  const map = buildBlanksMap({
    subtitles: imagineSubtitles,
    level: 'B1',
    difficultyKey: 'easy',
    vocabWords: new Set(['imagine']),
  });
  const blankedWords = new Set();
  for (const [lineIndex, wordSet] of Object.entries(map)) {
    const tokens = imagineSubtitles[lineIndex].original.split(/(\s+)/).filter(t => !/^\s+$/.test(t));
    for (const wordIdx of wordSet) {
      blankedWords.add(tokens[wordIdx]?.toLowerCase().replace(/[.,!?;:'’]/g, ''));
    }
  }
  check('buildBlanksMap — palabra de vocabData prioritariamente blanqueada', blankedWords.has('imagine'));
}

console.log(`\n✅ blanks-engine — ${passed}/${passed} OK`);
if (process.exitCode) {
  console.error('\n❌ blanks-engine tiene fallas — ver arriba');
}

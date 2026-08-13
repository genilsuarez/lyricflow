// blanks-engine.js — Motor de selección de palabras para dictado/blanks.
// Extraído de player.js (C.3.3, docs/auditoria-y-plan.md): antes vivía embebido
// en player.js, duplicado casi textual entre Fill-in-the-Blanks (buildBlanksMap)
// y Listening Challenge (buildListeningBlanks), y dependía del `state` mutable
// del módulo — imposible de testear sin arrancar el player completo.
//
// Filosofía pedagógica (sin cambios): los blanks refuerzan vocabulario CLAVE de
// la canción, no palabras al azar. Las palabras de vocabData se blanquean
// primero; solo si el cap lo permite entran palabras de contenido genéricas.
//
// Todo acá es puro: recibe datos, devuelve datos. Sin DOM, sin `state`, sin
// localStorage. Eso es lo que lo hace testeable (ver tests/blanks-engine.mjs).

// totalCap: máximo de blanks para toda la canción (techo absoluto)
// vocabBoost: multiplicador del score de una palabra de vocabData (más alto =
//   casi siempre elegida)
// minWordLen: palabras más cortas que esto nunca se blanquean
// maxPerLine: nunca exceder esta cantidad de blanks en una sola línea
export const DIFFICULTY = {
  easy: { totalCap: 8, vocabBoost: 200, minWordLen: 3, maxPerLine: 1 },
  normal: { totalCap: 16, vocabBoost: 150, minWordLen: 2, maxPerLine: 1 },
  hard: { totalCap: 30, vocabBoost: 100, minWordLen: 1, maxPerLine: 2 },
};

// Multiplicador por nivel CEFR — niveles más bajos reciben menos blanks (más
// foco, menos abrumar).
export const LEVEL_FACTOR = { A1: 0.6, A2: 0.75, B1: 1.0, B2: 1.0, C1: 1.1, C2: 1.2 };

// Stop words compartidas — nunca se blanquean en ningún modo.
export const STOP_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'le', 'la', 'les', 'un', 'une', 'des', 'du',
  'de', 'et', 'ou', 'mais', 'en', 'au', 'aux', 'ce', 'ma', 'mon',
  'sa', 'son', 'ne', 'pas', 'que', 'qui', 'est', 'ai', 'a', 'y',
  'dans', 'sur', 'pour', 'par', 'avec', 'tout', 'si', 'ô', 'oh',
]);

// Idénticos byte a byte a los originales en player.js — escapes unicode
// explícitos, no comillas tipográficas literales (riesgo de mismatch por
// encoding al copiar/pegar caracteres como " " ' — que se ven iguales
// pero no son el mismo codepoint).
const STRIP_PUNCT = /[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g;
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Quita acentos para comparar respuestas — "déambule" == "deambule". */
export function normalizeForCompare(s) {
  return s.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().trim();
}

/** PRNG determinístico (LCG) — misma seed produce siempre la misma secuencia,
 *  así el mapa de blanks de una canción es estable entre renders. */
export function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Recorre las líneas de una canción y arma la lista de candidatos a blank
 * con su score, sin decidir todavía cuáles se usan (eso es pickBlankCandidates).
 *
 * @param {Array<{original: string}>} subtitles
 * @param {{totalCap: number, vocabBoost: number, minWordLen: number, maxPerLine: number}} diff
 * @param {Set<string>} vocabWords — palabras de vocabData en minúsculas
 * @param {number} seedMultiplier — separa el RNG de dictado vs listening
 * @param {number} seedOffset
 * @returns {Array<{lineIndex: number, wordIdx: number, clean: string, original: string, score: number, isVocab: boolean}>}
 */
export function collectBlankCandidates(subtitles, diff, vocabWords, seedMultiplier, seedOffset) {
  const allCandidates = [];
  subtitles.forEach((sub, lineIndex) => {
    const tokens = sub.original.split(/(\s+)/);
    const rng = seededRandom(lineIndex * seedMultiplier + seedOffset);
    let wordIdx = 0;

    tokens.forEach(token => {
      if (/^\s+$/.test(token)) return;
      const clean = token.toLowerCase().replace(STRIP_PUNCT, '');
      if (!clean || clean.length <= diff.minWordLen || STOP_WORDS.has(clean)) {
        wordIdx++;
        return;
      }

      const isVocab = vocabWords.has(clean);
      const score = (isVocab ? diff.vocabBoost : 0) + clean.length * 2 + rng() * 3;
      allCandidates.push({ lineIndex, wordIdx, clean, original: token, score, isVocab });
      wordIdx++;
    });
  });

  return allCandidates;
}

/**
 * Elige codiciosamente candidatos a blank respetando el cap global, el cap
 * por línea, y una ocurrencia por palabra única en toda la canción (evita
 * "goodbye" ×10 en Hello, Goodbye). Asume candidates ya viene ordenado por
 * score descendente.
 */
export function pickBlankCandidates(sortedCandidates, totalCap, maxPerLine) {
  const lineCounts = {};
  const usedWords = new Set();
  const picked = [];

  for (const c of sortedCandidates) {
    if (picked.length >= totalCap) break;
    const lc = lineCounts[c.lineIndex] || 0;
    if (lc >= maxPerLine) continue;
    if (usedWords.has(c.clean)) continue;

    picked.push(c);
    lineCounts[c.lineIndex] = lc + 1;
    usedWords.add(c.clean);
  }

  return picked;
}

function effectiveTotalCap(difficultyKey, level) {
  const diff = DIFFICULTY[difficultyKey];
  const factor = LEVEL_FACTOR[level] ?? 1.0;
  return { diff, totalCap: Math.round(diff.totalCap * factor) };
}

/**
 * Modo dictado (Fill-in-the-Blanks) — mapa lineIndex -> Set<wordIdx>.
 *
 * @param {{subtitles: Array<{original: string}>, level?: string, difficultyKey: string, vocabWords: Set<string>}} options
 * @returns {Record<number, Set<number>>}
 */
export function buildBlanksMap({ subtitles, level, difficultyKey, vocabWords }) {
  const { diff, totalCap } = effectiveTotalCap(difficultyKey, level || 'B1');
  const candidates = collectBlankCandidates(subtitles, diff, vocabWords, 31, 7);
  candidates.sort((a, b) => b.score - a.score);

  const map = {};
  for (const c of pickBlankCandidates(candidates, totalCap, diff.maxPerLine)) {
    if (!map[c.lineIndex]) map[c.lineIndex] = new Set();
    map[c.lineIndex].add(c.wordIdx);
  }
  return map;
}

/**
 * Modo Listening Challenge — mapa lineIndex -> [{wordIdx, clean, original}].
 * Mismo algoritmo que buildBlanksMap, seed y forma de salida distintas
 * (el listening necesita el texto original de la palabra para reproducir
 * el audio de esa línea; el dictado no).
 *
 * @param {{subtitles: Array<{original: string}>, level?: string, difficultyKey: string, vocabWords: Set<string>}} options
 * @returns {Record<number, Array<{wordIdx: number, clean: string, original: string}>>}
 */
export function buildListeningBlanks({ subtitles, level, difficultyKey, vocabWords }) {
  const { diff, totalCap } = effectiveTotalCap(difficultyKey, level || 'B1');
  const candidates = collectBlankCandidates(subtitles, diff, vocabWords, 47, 13);
  candidates.sort((a, b) => b.score - a.score);

  const map = {};
  for (const c of pickBlankCandidates(candidates, totalCap, diff.maxPerLine)) {
    if (!map[c.lineIndex]) map[c.lineIndex] = [];
    map[c.lineIndex].push({ wordIdx: c.wordIdx, clean: c.clean, original: c.original });
  }
  return map;
}

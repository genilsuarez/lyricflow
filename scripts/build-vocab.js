#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// build-vocab.js — Extracts unique words from song subtitles into vocab.js
// Usage: node scripts/build-vocab.js
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const songsDir = join(__dirname, '..', 'songs');

// Only filter out single-letter fragments from apostrophe splits (d', l', m', etc.)
// Single chars with meaning (ô, à, y, a) are allowed via DICTIONARY check
const FRAGMENTS = new Set(['d', 'n', 's', 'm', 'j', 'l', 'c', 'qu']);

// French → Spanish dictionary for individual word translations
const DICTIONARY = {
  // Interjections
  'ô': 'oh (interjección poética)',
  'oh': 'oh',
  // Pronouns
  'je': 'yo',
  'tu': 'tú',
  'il': 'él',
  'elle': 'ella',
  'on': 'uno / se (impersonal)',
  'nous': 'nosotros',
  'vous': 'ustedes / vosotros',
  'ils': 'ellos',
  'elles': 'ellas',
  'me': 'me',
  'te': 'te',
  'se': 'se',
  'ce': 'esto / este',
  'ça': 'eso',
  'qui': 'quien / que',
  'que': 'que',
  'toi': 'ti',
  'lui': 'él / a él',
  'moi': 'yo / a mí',
  // Possessives
  'ma': 'mi (femenino)',
  'mon': 'mi (masculino)',
  'mes': 'mis',
  'ton': 'tu (masculino)',
  'ta': 'tu (femenino)',
  'tes': 'tus',
  'son': 'su (masculino)',
  'sa': 'su (femenino)',
  'ses': 'sus',
  'notre': 'nuestro/a',
  'votre': 'vuestro/a',
  'leur': 'su (de ellos)',
  'leurs': 'sus (de ellos)',
  // Articles
  'le': 'el',
  'la': 'la',
  'les': 'los / las',
  'un': 'un',
  'une': 'una',
  'des': 'unos / unas',
  'du': 'del',
  'au': 'al',
  'aux': 'a los / a las',
  // Prepositions & conjunctions
  'de': 'de',
  'à': 'a',
  'en': 'en',
  'dans': 'en / dentro de',
  'sur': 'sobre',
  'sous': 'bajo',
  'par': 'por',
  'pour': 'para',
  'avec': 'con',
  'sans': 'sin',
  'et': 'y',
  'ou': 'o',
  'ne': 'no (negación)',
  'pas': 'no (negación)',
  'y': 'allí / ahí',
  // Demonstratives
  'cette': 'esta',
  'ces': 'estos / estas',
  'cet': 'este (antes de vocal)',
  // Common verbs
  'est': 'es / está',
  'ai': 'tengo / he',
  'a': 'tiene / ha',
  'sont': 'son / están',
  'suis': 'soy / estoy',
  'veux': 'quiero',
  'vient': 'viene',
  'danse': 'bailo / baile',
  'cours': 'corro',
  'remue': 'muevo / agito',
  'brille': 'brilla',
  'vole': 'vuelo / vuela',
  'envole': 'vuelo (despego)',
  'abandonne': 'abandono',
  'écoute': 'escucha',
  'déambule': 'deambulo',
  'recommence': 'vuelve a empezar',
  'recommences': 'vuelves a empezar',
  'oublier': 'olvidar',
  'enfuir': 'huir',
  'acharner': 'empeñarse / ensañarse',
  'trimer': 'esforzarse / trabajar duro',
  'payé': 'pagado',
  'beau': 'bonito / (tener) buen (intento)',
  // Adjectives
  'douce': 'dulce',
  'immense': 'inmenso/a',
  'seule': 'sola',
  'vide': 'vacío/a',
  'dernière': 'última',
  'tout': 'todo',
  'toutes': 'todas',
  // Nouns
  'souffrance': 'sufrimiento',
  'peine': 'pena',
  'douleur': 'dolor',
  'amour': 'amor',
  'miel': 'miel',
  'brin': 'pizca / brizna',
  'bruit': 'ruido',
  'peur': 'miedo',
  'tour': 'turno',
  'ciel': 'cielo',
  'jour': 'día',
  'nuit': 'noche',
  'vent': 'viento',
  'pluie': 'lluvia',
  'sens': 'sentido',
  'vie': 'vida',
  'monde': 'mundo',
  'enfant': 'niño/a',
  'cœur': 'corazón',
  'espérance': 'esperanza',
  'chemin': 'camino',
  'absence': 'ausencia',
  'décor': 'decorado / escenario',
  'offenses': 'ofensas',
  'métro': 'metro',
  'paris': 'París',
  'paro': 'perdida (argot)',
  'importance': 'importancia',
  'être': 'ser / estar',
  // Adverbs & misc
  'peu': 'poco',
  'pourquoi': 'por qué',
  'dont': 'del cual / cuyo',
  'comme': 'como',
};

function extractWords(subtitles) {
  const wordMap = new Map(); // word → { count, lines[], examples[] }

  subtitles.forEach((sub, idx) => {
    const text = sub.original
      .toLowerCase()
      .replace(/[.,!?;:«»""''…\-–—()]/g, ' ')
      .replace(/'/g, ' ')
      .replace(/'/g, ' ');

    const words = text.split(/\s+/).filter(w =>
      !FRAGMENTS.has(w) && (w.length > 1 || DICTIONARY[w])
    );

    const seen = new Set();
    for (const word of words) {
      if (seen.has(word)) continue;
      seen.add(word);

      if (!wordMap.has(word)) {
        wordMap.set(word, { count: 0, lines: [], examples: [] });
      }
      const entry = wordMap.get(word);
      entry.count++;
      if (entry.lines.length < 3) {
        entry.lines.push(idx);
        entry.examples.push({ original: sub.original, translation: sub.translation });
      }
    }
  });

  // Sort alphabetically
  const sorted = [...wordMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));

  return sorted.map(([word, data]) => ({
    word,
    translation: DICTIONARY[word] || null,
    count: data.count,
    lines: data.lines,
    examples: data.examples,
  }));
}

// Process each song folder
const folders = readdirSync(songsDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const folder of folders) {
  const dataPath = join(songsDir, folder, 'data.js');
  const content = readFileSync(dataPath, 'utf-8');

  // Extract subtitles array via regex (simple parse)
  const subtitlesMatch = content.match(/subtitles:\s*\[([\s\S]*?)\]\s*\}/);
  if (!subtitlesMatch) {
    console.log(`⚠ No subtitles found in ${folder}/data.js`);
    continue;
  }

  // Eval-safe: extract original fields
  const originals = [...content.matchAll(/original:\s*"([^"]*)"/g)].map(m => m[1]);
  const translations = [...content.matchAll(/translation:\s*"([^"]*)"/g)].map(m => m[1]);

  const subtitles = originals.map((original, i) => ({
    original,
    translation: translations[i] || '',
  }));

  const vocab = extractWords(subtitles);
  const missing = vocab.filter(v => v.translation === null);

  const output = `// Auto-generated vocabulary — run \`node scripts/build-vocab.js\` to refresh
export default ${JSON.stringify(vocab, null, 2)};
`;

  const outPath = join(songsDir, folder, 'vocab.js');
  writeFileSync(outPath, output, 'utf-8');
  console.log(`✓ ${folder}/vocab.js — ${vocab.length} words`);
  if (missing.length > 0) {
    console.log(`  ⚠ Missing translations: ${missing.map(m => m.word).join(', ')}`);
  }
}

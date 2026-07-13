// Analyze gaps between lyrics (data.js) and vocabulary (vocab.js)
const { readdir } = require('fs').promises;
const { join } = require('path');
const { pathToFileURL } = require('url');

async function main() {

const songsDir = new URL('../songs/', import.meta.url).pathname;
const dirs = (await readdir(songsDir, { withFileTypes: true }))
  .filter(d => d.isDirectory())
  .map(d => d.name);

// Common words to skip (too basic / function words)
const SKIP = new Set([
  'i', 'me', 'my', 'you', 'your', 'he', 'she', 'it', 'we', 'they', 'them', 'us',
  'the', 'a', 'an', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'can', 'may', 'might', 'shall', 'must',
  'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
  'not', 'no', 'so', 'as', 'just', 'all', 'than', 'then', 'too', 'very',
  'oh', 'ooh', 'ah', 'la', 'na', 'da', 'mm', 'uh', 'hey', 'yeah',
  'up', 'out', 'down', 'off', 'here', 'there', 'now', 'when', 'how',
  'its', 'his', 'her', 'our', 'their', 'him', 'us',
  'by', 'about', 'through', 'over', 'into', 'back', 'some', 'any',
  'don\'t', 'didn\'t', 'won\'t', 'can\'t', 'isn\'t', 'aren\'t', 'wasn\'t', 'weren\'t',
  'doesn\'t', 'haven\'t', 'hasn\'t', 'couldn\'t', 'wouldn\'t', 'shouldn\'t',
  'let', 'get', 'got', 'say', 'said', 'know', 'see', 'come', 'go', 'went',
  'make', 'take', 'like', 'think', 'thought', 'well', 'still', 'even',
  've', 'll', 'd', 're', 's', 't', 'ain', 'gonna', 'gotta', 'wanna',
  'been', 'never', 'ever', 'always', 'only', 'also', 'much', 'more',
  'right', 'way', 'time', 'life', 'day', 'night',
]);

for (const dir of dirs) {
  const dataPath = join(songsDir, dir, 'data.js');
  const vocabPath = join(songsDir, dir, 'vocab.js');
  
  let data, vocab;
  try {
    data = (await import(dataPath)).default;
    vocab = (await import(vocabPath)).default;
  } catch(e) {
    console.log(`\n⚠️  ${dir}: could not load files`);
    continue;
  }

  // Extract all words from lyrics
  const allText = data.subtitles.map(s => s.original).join(' ');
  const words = allText.toLowerCase()
    .replace(/[^a-z'\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !SKIP.has(w));

  // Unique words
  const uniqueWords = [...new Set(words)];
  
  // Words already in vocab (check both exact and partial matches)
  const vocabWords = vocab.map(v => v.word.toLowerCase());
  const vocabText = vocabWords.join(' ');
  
  const unmapped = uniqueWords.filter(w => {
    // Check if word appears in any vocab entry
    return !vocabWords.some(vw => vw.includes(w) || w.includes(vw));
  });

  // Find potential phrasal verbs (verb + particle combinations in the text)
  const phrasalPatterns = [];
  const particles = ['up', 'down', 'out', 'in', 'on', 'off', 'away', 'back', 'over', 'through', 'around', 'along', 'by'];
  const lines = data.subtitles.map(s => s.original.toLowerCase());
  
  for (const line of lines) {
    for (const particle of particles) {
      const regex = new RegExp(`\\b(\\w+)\\s+${particle}\\b`, 'g');
      let match;
      while ((match = regex.exec(line)) !== null) {
        const pv = `${match[1]} ${particle}`;
        if (!SKIP.has(match[1]) && !vocabText.includes(pv)) {
          phrasalPatterns.push(pv);
        }
      }
    }
  }

  // Find potential idioms (multi-word expressions)
  const idiomPatterns = [];
  for (const line of lines) {
    // Look for common idiom patterns
    if (line.match(/\b(in\s+the\s+\w+\s+of)\b/)) idiomPatterns.push(line.match(/\b(in\s+the\s+\w+\s+of)\b/)[1]);
    if (line.match(/\b(as\s+\w+\s+as)\b/)) idiomPatterns.push(line.match(/\b(as\s+\w+\s+as)\b/)[1]);
  }

  const uniquePhrasals = [...new Set(phrasalPatterns)];
  
  if (unmapped.length > 0 || uniquePhrasals.length > 0) {
    console.log(`\n═══ ${dir} (${data.level}) — ${data.subtitles.length} lines ═══`);
    if (unmapped.length > 0) {
      console.log(`  📝 Unmapped words (${unmapped.length}): ${unmapped.join(', ')}`);
    }
    if (uniquePhrasals.length > 0) {
      console.log(`  🔗 Potential phrasal verbs not in vocab: ${uniquePhrasals.join(', ')}`);
    }
  }
}

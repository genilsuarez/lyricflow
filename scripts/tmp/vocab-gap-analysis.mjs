// Analyze gaps between lyrics (data.js) and vocabulary (vocab.js)
import { readdir } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';

const songsDir = join(process.cwd(), 'songs');
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
  'its', 'his', 'her', 'our', 'their', 'him',
  'by', 'about', 'through', 'over', 'into', 'back', 'some', 'any',
  "don't", "didn't", "won't", "can't", "isn't", "aren't", "wasn't", "weren't",
  "doesn't", "haven't", "hasn't", "couldn't", "wouldn't", "shouldn't",
  'let', 'get', 'got', 'say', 'said', 'know', 'see', 'come', 'go', 'went',
  'make', 'take', 'like', 'think', 'thought', 'well', 'still', 'even',
  "ve", "ll", "re", "ain", "gonna", "gotta", "wanna",
  'been', 'never', 'ever', 'always', 'only', 'also', 'much', 'more',
  'right', 'way', 'time', 'life', 'day',
]);

for (const dir of dirs) {
  const dataUrl = pathToFileURL(join(songsDir, dir, 'data.js')).href;
  const vocabUrl = pathToFileURL(join(songsDir, dir, 'vocab.js')).href;
  
  let data, vocab;
  try {
    data = (await import(dataUrl)).default;
    vocab = (await import(vocabUrl)).default;
  } catch(e) {
    console.log(`\n⚠️  ${dir}: ${e.message}`);
    continue;
  }

  // Extract all words from lyrics
  const allText = data.subtitles.map(s => s.original).join(' ');
  const words = allText.toLowerCase()
    .replace(/[^a-z'\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !SKIP.has(w));

  // Unique words with frequency
  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const uniqueWords = Object.keys(freq);
  
  // Words already in vocab (check both exact and partial matches)
  const vocabWords = vocab.map(v => v.word.toLowerCase());
  const vocabJoined = vocabWords.join('|||');
  
  const unmapped = uniqueWords.filter(w => {
    return !vocabWords.some(vw => vw.includes(w) || w.includes(vw));
  }).sort((a, b) => freq[b] - freq[a]);

  // Find potential phrasal verbs
  const phrasalPatterns = [];
  const particles = ['up', 'down', 'out', 'in', 'on', 'off', 'away', 'back', 'over', 'through', 'around', 'along', 'by'];
  const lines = data.subtitles.map(s => s.original.toLowerCase());
  
  for (const line of lines) {
    for (const particle of particles) {
      const regex = new RegExp(`\\b(\\w+)\\s+${particle}\\b`, 'g');
      let match;
      while ((match = regex.exec(line)) !== null) {
        const pv = `${match[1]} ${particle}`;
        if (!SKIP.has(match[1]) && !vocabJoined.includes(pv) && match[1].length > 2) {
          phrasalPatterns.push({ pv, ctx: line });
        }
      }
    }
  }

  const uniquePhrasals = [...new Map(phrasalPatterns.map(p => [p.pv, p])).values()];
  
  console.log(`\n═══ ${dir} (${data.level}) — ${data.subtitles.length} lines, ${vocab.length} vocab entries ═══`);
  if (unmapped.length > 0) {
    console.log(`  📝 Unmapped words (${unmapped.length}): ${unmapped.map(w => `${w}(${freq[w]})`).join(', ')}`);
  } else {
    console.log(`  ✅ All significant words mapped`);
  }
  if (uniquePhrasals.length > 0) {
    console.log(`  🔗 Potential unmapped phrasal verbs:`);
    uniquePhrasals.forEach(p => console.log(`     • "${p.pv}" — "${p.ctx}"`));
  }
}

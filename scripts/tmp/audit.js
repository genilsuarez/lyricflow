const fs = require('fs');
const path = require('path');

const songsDir = path.join(__dirname, '../../songs');
const songs = fs.readdirSync(songsDir).filter(d => fs.statSync(path.join(songsDir,d)).isDirectory());

let totalSubs = 0, totalVocab = 0, totalBlanks = 0;

songs.forEach(s => {
  const dataRaw = fs.readFileSync(path.join(songsDir,s,'data.js'),'utf8');
  const vocabRaw = fs.readFileSync(path.join(songsDir,s,'vocab.js'),'utf8');
  const subs = (dataRaw.match(/start:/g)||[]).length;
  const vocab = (vocabRaw.match(/term:/g)||[]).length;
  const blanks = (dataRaw.match(/blank:/g)||[]).length;
  const level = (dataRaw.match(/level:\s*['"]([^'"]+)/) || ['','?'])[1];
  const artist = (dataRaw.match(/artist:\s*['"]([^'"]+)/) || ['','?'])[1];
  totalSubs += subs; totalVocab += vocab; totalBlanks += blanks;
  console.log(s.replace(/_/g,' ') + ' — ' + artist + ' [' + level + ']: ' + subs + ' líneas sync, ' + blanks + ' blanks, ' + vocab + ' vocab');
});

console.log('\n=== LyricFlow Totals ===');
console.log('Canciones:', songs.length);
console.log('Líneas sincronizadas (subtítulos):', totalSubs);
console.log('Fill-in-blank items:', totalBlanks);
console.log('Vocab entries totales:', totalVocab);

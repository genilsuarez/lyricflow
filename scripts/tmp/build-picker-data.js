import { readdir } from 'fs/promises';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const songsDir = resolve(import.meta.dirname, '../../songs');
const folders = (await readdir(songsDir, { withFileTypes: true }))
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

const entries = [];
for (const folder of folders) {
  const mod = await import(pathToFileURL(resolve(songsDir, folder, 'data.js')).href);
  const d = mod.default;
  entries.push({
    title: d.title,
    artist: d.artist,
    icon: d.icon || '🎵',
    level: d.level || '',
    folder: `songs/${folder}`,
  });
}

console.log(`// Auto-generated picker metadata — run: node scripts/tmp/build-picker-data.js
// Only metadata needed for the song list; full data.js loaded on song select.
export default ${JSON.stringify(entries, null, 2)};
`);

#!/usr/bin/env node
// Scans songs/ for subfolders containing data.js and regenerates songs/catalog.js

import { readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const songsDir = join(__dirname, '..', 'songs');

const folders = readdirSync(songsDir)
  .filter(name => {
    const full = join(songsDir, name);
    return statSync(full).isDirectory() && existsSync(join(full, 'data.js'));
  })
  .sort();

const content = `// Auto-generated — run \`node scripts/build-catalog.js\` to refresh
// Or simply add your folder name here when adding a new song
export default [
${folders.map(f => `  '${f}'`).join(',\n')}
];
`;

writeFileSync(join(songsDir, 'catalog.js'), content);
console.log(`catalog.js updated — ${folders.length} song(s): ${folders.join(', ')}`);

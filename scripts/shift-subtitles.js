#!/usr/bin/env node
// shift-subtitles.js — desplaza el start de todos los subtítulos desde un índice en adelante
//
// Uso:
//   node scripts/shift-subtitles.js <carpeta> <desde-índice> <delta>
//   node scripts/shift-subtitles.js <carpeta> --list
//
// Ejemplos:
//   node scripts/shift-subtitles.js Derniere_Danse 10 +2      ← suma 2s desde línea 10
//   node scripts/shift-subtitles.js Derniere_Danse 10 -1.5    ← resta 1.5s desde línea 10
//   node scripts/shift-subtitles.js Derniere_Danse --list     ← muestra índices y textos

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = join(__dir, '..');

const [,, folder, second, third] = process.argv;

if (!folder) {
  console.error('Uso: node scripts/shift-subtitles.js <carpeta> [--list | <desde-índice> <delta>]');
  process.exit(1);
}

const filePath = join(root, 'songs', folder, 'data.js');
let content;
try {
  content = readFileSync(filePath, 'utf-8');
} catch {
  console.error(`No se encontró: ${filePath}`);
  process.exit(1);
}

// Extrae todas las líneas de subtítulo con sus posiciones en el texto
const subLineRegex = /\{ start: (\d+\.?\d*), duration:/g;
const matches = [];
let m;
while ((m = subLineRegex.exec(content)) !== null) {
  matches.push({
    pos:      m.index,        // posición del `{`
    rawStr:   m[1],           // string original: "39.0", "18.5", etc.
    start:    parseFloat(m[1]),
  });
}

// ── --list ──────────────────────────────────────────────────────────────────
if (second === '--list') {
  const originalRegex = /original:\s*"([^"]+)"/g;
  const originals = [];
  let o;
  while ((o = originalRegex.exec(content)) !== null) originals.push(o[1]);

  console.log(`\n  ${folder} — ${matches.length} subtítulos\n`);
  matches.forEach((sub, i) => {
    const text  = originals[i] ?? '';
    const start = String(sub.start).padStart(6);   // JS omite .0 en enteros
    console.log(`  [${String(i).padStart(2, ' ')}]  start: ${start}   ${text}`);
  });
  console.log('');
  process.exit(0);
}

// ── shift ───────────────────────────────────────────────────────────────────
const fromIndex = parseInt(second, 10);
const delta     = parseFloat(third);

if (isNaN(fromIndex) || isNaN(delta)) {
  console.error('Error: índice y delta deben ser números.');
  console.error('Uso: node scripts/shift-subtitles.js <carpeta> <desde-índice> <delta>');
  process.exit(1);
}

if (fromIndex < 0 || fromIndex >= matches.length) {
  console.error(`Error: índice ${fromIndex} fuera de rango (0–${matches.length - 1})`);
  process.exit(1);
}

// Reemplaza de atrás hacia adelante para no desplazar los offsets
const toShift = matches.slice(fromIndex).reverse();
toShift.forEach(({ pos, rawStr, start }) => {
  const raw     = Math.round((start + delta) * 100) / 100;
  const newVal  = Number.isInteger(raw) ? raw.toFixed(1) : String(raw);
  const oldStr  = `start: ${rawStr},`;
  const newStr  = `start: ${newVal},`;
  const anchor  = pos + 2;
  content = content.slice(0, anchor) + newStr + content.slice(anchor + oldStr.length);
});

writeFileSync(filePath, content, 'utf-8');

const sign = delta >= 0 ? '+' : '';
console.log(`✓  ${toShift.length} subtítulos desplazados ${sign}${delta}s (desde índice ${fromIndex})`);
console.log(`   songs/${folder}/data.js`);

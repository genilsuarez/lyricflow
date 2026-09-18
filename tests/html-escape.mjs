import { escapeHtml } from '../js/html-escape.js';

let failed = 0;
function eq(name, got, want) {
  if (got === want) return;
  failed++;
  console.error(`✗ ${name}\n    got:  ${got}\n    want: ${want}`);
}

eq('etiquetas', escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
eq('comillas de atributo', escapeHtml(`" onmouseover="x' `), '&quot; onmouseover=&quot;x&#39; ');
eq('ampersand primero (sin doble escape)', escapeHtml('a & b &amp;'), 'a &amp; b &amp;amp;');
eq('null/undefined', `${escapeHtml(null)}|${escapeHtml(undefined)}`, '|');
eq('número', escapeHtml(42), '42');
eq('texto normal intacto', escapeHtml("Don't stop — canción"), 'Don&#39;t stop — canción');

if (failed) process.exit(1);
console.log('✅ html-escape — 6/6 OK');

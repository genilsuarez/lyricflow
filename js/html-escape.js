// Escapa texto para interpolarlo en plantillas que acaban en innerHTML.
// Úsalo con cualquier dato que no sea una constante de la app: eventos del
// ledger (localStorage / nube), títulos, nombres. Cubre también atributos
// entre comillas dobles o simples.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

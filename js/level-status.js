/* ═══════════════════════════════════════════════════════
   LyricFlow — Level Status Banner
   LearnFlow Progression System — docs/to-do/learnflow-progression-system.md
   § "Comunicación cuando el nivel no avanza": si LyricFlow ya cumplió su
   parte (100% de las canciones del nivel activo) pero lp-level no subió
   porque otra app sigue por debajo de su umbral, se muestra un aviso con
   enlace a DeskFlow (el widget de nivel de DeskFlow es la vista de
   "estadísticas globales").
   ═══════════════════════════════════════════════════════ */

import { getActiveLevel, getCombinedLevelProgress } from './lp-progress-summary.js';

export function refreshLevelStatusBanner() {
  const banner = document.getElementById('levelStatusBanner');
  if (!banner) return;

  const level = getActiveLevel();
  const progress = getCombinedLevelProgress(level);
  const lyricflowDone = progress.lyricflow.progressPct >= 100;
  const allDone = lyricflowDone && progress.fluentflow.progressPct >= 100 && progress.hubflow.progressPct >= 50;

  // Si las 3 ya se cumplieron, checkLevelAdvancement() ya debería haber
  // subido el nivel (se dispara al guardar progreso) — no mostrar el aviso
  // en ese instante de transición para no parpadear justo antes de avanzar.
  const shouldShow = lyricflowDone && !allDone;
  banner.hidden = !shouldShow;
  if (!shouldShow) return;

  const link = document.getElementById('levelStatusBannerLink');
  if (link && typeof window.LPPlatformUrls?.portalHref === 'function') {
    link.href = window.LPPlatformUrls.portalHref();
  }
}

let listenersAttached = false;

export function initLevelStatus() {
  refreshLevelStatusBanner();
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener('lp-level-changed', refreshLevelStatusBanner);
  window.addEventListener('storage', (event) => {
    if (event.key === 'lp-level') refreshLevelStatusBanner();
  });
}

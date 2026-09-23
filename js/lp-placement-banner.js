/**
 * LP Placement Banner — aviso en satélites cuando quedó pendiente validar el
 * nivel en DeskFlow: o se pidió B1+ en la encuesta y no se rindió el examen,
 * o se dejó un examen a medias. Rellena título, texto y botón según el caso. No porta el examen (vive solo en DeskFlow);
 * solo informa y enlaza. Ver docs/auditoria-y-plan.md — M4.
 *
 *   lpPlacementBanner.mount('placementTestBanner')
 */
/* eslint-disable no-var */
var lpPlacementBanner = (function () {
  'use strict';

  var REQUEST_KEY = 'lp-placement-request';
  var SNAPSHOT_KEY = 'lp-placement-progress';

  // Mismo plazo que DeskFlow (SNAPSHOT_MAX_AGE_MS en lp-placement-test.js):
  // pasado ese tiempo el intento ya no se ofrece retomar allá, así que acá
  // tampoco.
  var SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Qué queda pendiente: un examen a medias (con al menos una respuesta, igual
   * que el criterio de DeskFlow) manda sobre una petición sin empezar.
   */
  function pendingState() {
    var request = null;
    var snap = null;
    try {
      request = localStorage.getItem(REQUEST_KEY);
      snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
    } catch (e) {
      snap = null;
    }
    var resumable =
      snap &&
      typeof snap.requestedLevel === 'string' &&
      Array.isArray(snap.given) &&
      snap.given.length > 0 &&
      Date.now() - (snap.updatedAt || 0) <= SNAPSHOT_MAX_AGE_MS;
    if (resumable) return { kind: 'resume', level: snap.requestedLevel };
    if (request) return { kind: 'request', level: request };
    return null;
  }

  function currentLevel() {
    try {
      return localStorage.getItem('lp-level') || 'a1';
    } catch (e) {
      return 'a1';
    }
  }

  /** Textos según el estado real. Antes era un texto fijo ("Confirmaste nivel
   *  B2+") que no decía qué nivel estaba pendiente y afirmaba lo contrario de
   *  lo que pasaba: el nivel todavía NO estaba confirmado. */
  function copyFor(state) {
    var level = state.level.toUpperCase();
    if (state.kind === 'resume') {
      return {
        title: 'Examen de ' + level + ' sin terminar',
        text: 'Retómalo en DeskFlow donde lo dejaste.',
        button: 'Retomar el examen →',
      };
    }
    return {
      title: 'Confirma tu nivel ' + level,
      text: 'Un examen corto en DeskFlow lo confirma. Mientras, tu contenido sigue en ' +
        currentLevel().toUpperCase() + '.',
      button: 'Hacer el examen →',
    };
  }

  function portalHref() {
    if (window.LPPlatformUrls && typeof window.LPPlatformUrls.portalHref === 'function') {
      return window.LPPlatformUrls.portalHref();
    }
    return '/deskflow/';
  }

  function mount(elementId) {
    var el = document.getElementById(elementId);
    if (!el) return;
    var state = pendingState();
    if (!state) {
      el.hidden = true;
      return;
    }
    var copy = copyFor(state);
    var title = el.querySelector('.level-status-banner__title');
    var text = el.querySelector('.level-status-banner__text');
    // Con título propio en el markup (HubFlow) van separados; sin él
    // (LyricFlow) se unen en la única línea de texto.
    if (title) title.textContent = copy.title;
    if (text) text.textContent = title ? copy.text : copy.title + ' · ' + copy.text;
    var link = el.querySelector('a');
    if (link) {
      link.href = portalHref();
      link.textContent = copy.button;
    }
    el.hidden = false;
  }

  return { mount: mount };
})();
window.lpPlacementBanner = lpPlacementBanner; // ESM side-effect import (main.js) does not attach top-level vars to window like a classic <script> did — restore it explicitly.

/**
 * LP Placement Banner — aviso en satélites cuando quedó pendiente validar el
 * nivel en DeskFlow: o se pidió B1/B2 en la encuesta y no se rindió el examen,
 * o se dejó un examen a medias. No porta el examen (vive solo en DeskFlow);
 * solo informa y enlaza. Ver docs/auditoria-y-plan.md — M4.
 *
 *   lpPlacementBanner.mount('placementTestBanner')
 */
/* eslint-disable no-var */
var lpPlacementBanner = (function () {
  'use strict';

  var REQUEST_KEY = 'lp-placement-request';
  var SNAPSHOT_KEY = 'lp-placement-progress';

  function hasPendingValidation() {
    try {
      return !!localStorage.getItem(REQUEST_KEY) || !!localStorage.getItem(SNAPSHOT_KEY);
    } catch (e) {
      return false;
    }
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
    if (!hasPendingValidation()) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var link = el.querySelector('a');
    if (link) link.href = portalHref();
  }

  return { mount: mount };
})();
window.lpPlacementBanner = lpPlacementBanner; // ESM side-effect import (main.js) does not attach top-level vars to window like a classic <script> did — restore it explicitly.

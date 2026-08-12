/**
 * LP Placement Banner — aviso en satélites cuando el placement test B2+
 * quedó pendiente en DeskFlow. No porta el examen (vive solo en DeskFlow);
 * solo informa y enlaza. Ver docs/auditoria-y-plan.md — M4.
 *
 *   lpPlacementBanner.mount('placementTestBanner')
 */
/* eslint-disable no-var */
var lpPlacementBanner = (function () {
  'use strict';

  var PENDING_KEY = 'lp-placement-test-pending';

  function portalHref() {
    if (window.LPPlatformUrls && typeof window.LPPlatformUrls.portalHref === 'function') {
      return window.LPPlatformUrls.portalHref();
    }
    return '/deskflow/';
  }

  function mount(elementId) {
    var el = document.getElementById(elementId);
    if (!el) return;
    if (localStorage.getItem(PENDING_KEY) !== '1') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var link = el.querySelector('a');
    if (link) link.href = portalHref();
  }

  return { mount: mount };
})();

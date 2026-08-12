/**
 * LP Mini Onboarding — pantalla de contexto de 1 sola vista para quien entra
 * directo a una satélite (HubFlow/LyricFlow/FluentFlow) sin pasar por
 * DeskFlow primero. No reemplaza el onboarding completo de DeskFlow (nivel,
 * meta diaria, placement test) — solo ubica qué es esta app dentro de
 * LearnFlow. Ver docs/auditoria-y-plan.md — M1.
 *
 * Reusa las clases .about-overlay/.about-modal (lp-about.css, ya compartido)
 * para no introducir un CSS nuevo.
 *
 *   lpMiniOnboarding.maybeShow({ appName, appDesc, siblingApps })
 */
/* eslint-disable no-var */
var lpMiniOnboarding = (function () {
  'use strict';

  var SEEN_KEY = 'lp-mini-onboarding-seen';
  var SEEN_VERSION = 'v1';

  function portalHref() {
    if (window.LPPlatformUrls && typeof window.LPPlatformUrls.portalHref === 'function') {
      return window.LPPlatformUrls.portalHref();
    }
    return '/deskflow/';
  }

  function setInert(el, inert) {
    if (el) el.inert = inert;
  }

  function maybeShow(options) {
    options = options || {};
    if (localStorage.getItem(SEEN_KEY)) return false;
    // Nunca leer/escribir lp-onboarding-seen — es la bandera de DeskFlow.
    if (localStorage.getItem('lp-onboarding-seen')) return false;

    var shell = document.querySelector('.app-shell') || document.body;
    setInert(shell, true);

    var overlay = document.createElement('div');
    overlay.id = 'lpMiniOnboarding';
    overlay.className = 'about-overlay';
    overlay.innerHTML =
      '<section class="about-modal" role="dialog" aria-modal="true" ' +
      'aria-labelledby="lpMiniOnboardingTitle" aria-describedby="lpMiniOnboardingDesc">' +
      '<header class="about-header">' +
      '<div class="about-header__text">' +
      '<p class="about-eyebrow">Forma parte de LearnFlow</p>' +
      '<h2 id="lpMiniOnboardingTitle">' + (options.appName || '') + '</h2>' +
      '</div></header>' +
      '<div class="about-body">' +
      '<p id="lpMiniOnboardingDesc" class="about-description">' +
      (options.appDesc || '') + ' Forma parte de LearnFlow junto con ' +
      (options.siblingApps || '') + '.' +
      '</p></div>' +
      '<footer class="about-footer" style="display:flex; gap:8px; justify-content:flex-end;">' +
      '<a class="lp-btn lp-btn--ghost" id="lpMiniOnboardingPortal" href="' + portalHref() + '">' +
      'Ver el portal primero →</a>' +
      '<button class="lp-btn lp-btn--primary" id="lpMiniOnboardingStart" type="button">' +
      'Empezar aquí</button>' +
      '</footer></section>';

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      setInert(shell, false);
      document.removeEventListener('keydown', onKeydown);
      localStorage.setItem(SEEN_KEY, SEEN_VERSION);
    }

    var focusable = Array.prototype.slice.call(overlay.querySelectorAll('button, a[href]'));
    function onKeydown(keyEvent) {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        close();
        return;
      }
      if (keyEvent.key !== 'Tab' || focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (keyEvent.shiftKey && document.activeElement === first) {
        keyEvent.preventDefault();
        last.focus();
      } else if (!keyEvent.shiftKey && document.activeElement === last) {
        keyEvent.preventDefault();
        first.focus();
      }
    }

    overlay.querySelector('#lpMiniOnboardingStart').addEventListener('click', close);
    overlay.querySelector('#lpMiniOnboardingPortal').addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);
    overlay.querySelector('#lpMiniOnboardingStart').focus();
    return true;
  }

  return { maybeShow: maybeShow };
})();

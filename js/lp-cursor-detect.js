/**
 * Cursor IDE embedded browser detection.
 * Cursor's mobile device preview draws its own bottom chrome around the
 * page — confirmed live (2026-07-23) that the player's bottom-bar controls
 * (play/volume/speed/loop) get clipped by it. Adds `.browser-cursor-embedded`
 * to <html> so CSS can reserve clearance. See styles.css for the pixel value
 * (single source of truth) and the reasoning for why it's a hardcoded
 * estimate rather than a runtime measurement.
 *
 * Same detection approach as FluentFlow's src/utils/cursorBrowserDetection.ts
 * — kept independent here since LyricFlow is plain JS with no shared build.
 */
(function () {
  'use strict';

  var CURSOR_UA_PATTERN = /\bCursor\//;

  function isCursorEmbeddedBrowser() {
    return typeof navigator !== 'undefined' && CURSOR_UA_PATTERN.test(navigator.userAgent);
  }

  function applyCursorBrowserClass() {
    if (!isCursorEmbeddedBrowser()) return;
    document.documentElement.classList.add('browser-cursor-embedded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyCursorBrowserClass);
  } else {
    applyCursorBrowserClass();
  }
})();

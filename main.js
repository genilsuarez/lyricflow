/**
 * LyricFlow — single bundle entry point.
 *
 * Side-effect imports in the EXACT order the old <script defer> tags had in
 * index.html (deferred scripts execute in document order regardless of
 * head/body position, so this linear order reproduces prior behavior).
 * Each imported classic file is a self-contained IIFE that exposes itself
 * via `window.X` when other scripts need it — none rely on implicit
 * globals — so wrapping them as ESM side-effect imports is safe without
 * touching their internals. `js/player.js` (the real app entry — catalog,
 * player, quiz, stats, sync-engine…) is already an ES module, so it's just
 * the final import here, same relative position as its original <script
 * type="module"> tag.
 *
 * `js/lp-theme.js` is intentionally NOT here: it must stay a separate,
 * synchronous, unbundled <script> to apply the theme before first paint
 * (see index.html).
 *
 * CSS is NOT imported here — see main.css and the <link rel="stylesheet">
 * in index.html. Importing CSS from this file would make Vite inject it
 * via a <style> tag at runtime in dev, after this deferred module script
 * runs — a visible flash of unstyled content on every reload that a real
 * blocking <link> doesn't have.
 */
import './js/lp-input-zoom.js';
import './js/lp-cursor-detect.js';
import './js/lp-platform-urls.js';
import './js/lp-nav-icons.js';
import './js/lp-analytics.js';
import './js/lp-cookie-consent.js';
import './js/lp-guest-reset.js';
import './js/lp-login.js';
import './js/lp-login-nudge.js';
import './js/lp-placement-banner.js';
import './js/lp-about-content.js';
import './js/lp-about.js';
import './js/lp-mini-onboarding.js';
import './js/lp-settings.js';
import './js/lp-dev-tools.js';
import './js/lp-nav-helpers.js';
import './js/player.js';

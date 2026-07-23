/**
 * LP Nav Helpers — shared theme toggle + platform URLs + nav icons.
 * Requires lp-theme.js, lp-platform-urls.js, lp-nav-icons.js (load before this).
 */
/* eslint-disable no-var */
var LpNavHelpers = (function () {
  'use strict';

  function themedAppHref(app) {
    var href;
    if (window.LPPlatformUrls && typeof window.LPPlatformUrls.appHref === 'function') {
      href = window.LPPlatformUrls.appHref(app);
    } else if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      href = '/' + app + '/';
    } else {
      href = 'https://genilsuarez.github.io/' + app + '/';
    }
    if (window.LPTheme && typeof window.LPTheme.appendThemeToHref === 'function') {
      href = window.LPTheme.appendThemeToHref(href);
    }
    return href;
  }

  function navIcon(name) {
    return window.LpNavIcons ? window.LpNavIcons.svg(name) : '';
  }

  function currentThemeIcon() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return window.LpNavIcons ? window.LpNavIcons.themeIcon(isDark) : '';
  }

  function toggleTheme(iconEl) {
    if (window.LPTheme) {
      window.LPTheme.toggleTheme();
    } else {
      document.documentElement.classList.add('theme-transitioning');
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var newTheme = isDark ? 'light' : 'dark';
      if (newTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('lp-theme', newTheme);
      var url = new URL(location.href);
      if (url.searchParams.has('theme')) {
        url.searchParams.set('theme', newTheme);
        history.replaceState(null, '', url);
      }
      setTimeout(function () {
        document.documentElement.classList.remove('theme-transitioning');
      }, 350);
    }
    if (iconEl && window.LpNavIcons) {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      window.LpNavIcons.setTheme(iconEl, dark);
    }
  }

  return {
    themedAppHref: themedAppHref,
    navIcon: navIcon,
    currentThemeIcon: currentThemeIcon,
    toggleTheme: toggleTheme,
  };
})();

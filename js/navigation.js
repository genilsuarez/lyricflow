// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Navegación unificada (drawer, tema, enlaces entre apps)
// Extraído de player.js. Mismo patrón que vocab-culture.js / quiz.js: importa
// `app` y las vistas desde player.js (import circular: solo se usan al llamar).
// ═══════════════════════════════════════════════════════════════════════════════

import { app, showDashboard, showStats, showPicker } from './player.js';
// ─── Shared nav helpers (lp-nav-helpers.js) ──────────────────────────────────
export const navIcon = (name) => window.LpNavHelpers.navIcon(name);
const currentThemeIcon = () => window.LpNavHelpers.currentThemeIcon();
const toggleTheme = (iconEl) => window.LpNavHelpers.toggleTheme(iconEl);
const themedAppHref = (app) => window.LpNavHelpers.themedAppHref(app);

function bindPortalNavigation(root = document) {
  root.querySelectorAll('[data-lp-portal]').forEach(link => {
    link.href = themedAppHref('deskflow');
    if (link.dataset.portalBound) return;
    link.dataset.portalBound = '1';
    link.addEventListener('click', () => {
      link.href = themedAppHref('deskflow');
      setNavigationOpen(false, true);
    });
  });
}

const NAVIGATION_STORAGE_KEY = 'lp-navigation-mode';

function navigationMode() {
  return localStorage.getItem(NAVIGATION_STORAGE_KEY) === 'floating' ? 'floating' : 'sidebar';
}

function isNavigationPersistent() {
  return window.innerWidth >= 861 && navigationMode() === 'sidebar';
}

function syncNavigationLayout() {
  setNavigationOpen(isNavigationPersistent());
}

function updateNavigationMode(mode, persist = false) {
  const resolvedMode = mode === 'floating' ? 'floating' : 'sidebar';
  document.documentElement.dataset.navigationMode = resolvedMode;
  if (persist) localStorage.setItem(NAVIGATION_STORAGE_KEY, resolvedMode);

  const toggle = document.getElementById('navigationModeToggle');
  const isFloating = resolvedMode === 'floating';
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(isFloating));
    toggle.setAttribute('aria-label', isFloating ? 'Usar barra lateral fija' : 'Usar menú flotante');
    toggle.title = isFloating ? 'Muestra la barra lateral fija' : 'Oculta la barra lateral y usa un menú flotante';
    const icon = toggle.querySelector('span');
    if (icon) icon.textContent = isFloating ? '▣' : '◫';
  }
  syncNavigationLayout();
}

export function setNavigationOpen(isOpen, restoreFocus = false) {
  const navigation = document.getElementById('unifiedNavigation');
  const trigger = document.getElementById('unifiedNavTrigger');
  const headerMenuBtn = document.getElementById('headerMenuBtn');
  const backdrop = document.getElementById('unifiedNavBackdrop');
  if (!navigation || !trigger || !backdrop) return;

  const isPersistent = isNavigationPersistent();
  const effectivelyOpen = isPersistent || isOpen;
  const focusTarget = headerMenuBtn && document.querySelector('.app-header--player')
    ? headerMenuBtn
    : trigger;
  navigation.classList.toggle('is-open', effectivelyOpen);
  navigation.inert = !effectivelyOpen;
  navigation.setAttribute('aria-hidden', String(!effectivelyOpen));
  backdrop.classList.toggle('is-open', isOpen && !isPersistent);
  trigger.setAttribute('aria-expanded', String(effectivelyOpen));
  if (headerMenuBtn) headerMenuBtn.setAttribute('aria-expanded', String(effectivelyOpen));
  document.body.classList.toggle('lp-drawer-open', isOpen && !isPersistent);
  navigation.classList.toggle('is-persistent', isPersistent);
  if (isOpen && !isPersistent && typeof lpLogin !== 'undefined' && lpLogin.refreshNavLabels) {
    lpLogin.refreshNavLabels();
  }
  if (isOpen && !isPersistent) navigation.querySelector('button, a[href]')?.focus();
  else if (restoreFocus && !isPersistent) focusTarget.focus();
}

function showAboutLearnFlow(event) {
  lpAbout.open(event, {
    inertElements: [
      document.getElementById('app'),
      document.getElementById('unifiedNavigation'),
      document.getElementById('unifiedNavTrigger'),
    ],
    onClose() {
      setNavigationOpen(false);
      const navigationTrigger = document.getElementById('unifiedNavTrigger');
      if (navigationTrigger) navigationTrigger.inert = false;
    },
  });
}

export function initUnifiedNavigation() {
  // Guard against duplicate initialization (Vite HMR re-executes the module)
  if (document.getElementById('unifiedNavTrigger')) return;

  const trigger = document.createElement('button');
  trigger.id = 'unifiedNavTrigger';
  trigger.className = 'lp-icon-btn unified-nav-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Abrir navegación');
  trigger.setAttribute('aria-controls', 'unifiedNavigation');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = navIcon('menu');

  const backdrop = document.createElement('div');
  backdrop.id = 'unifiedNavBackdrop';
  backdrop.className = 'lp-drawer-scrim';
  backdrop.setAttribute('aria-hidden', 'true');

  const navigation = document.createElement('aside');
  navigation.id = 'unifiedNavigation';
  navigation.className = 'unified-nav lp-drawer';
  navigation.setAttribute('aria-label', 'Navegación de LearnFlow');
  navigation.innerHTML = `
    <div class="unified-nav-brand">
      <span class="unified-nav-mark" aria-hidden="true">LF</span>
      <span><strong>LyricFlow</strong><small>LearnFlow</small></span>
      <button class="unified-nav-mode-toggle" id="navigationModeToggle" type="button" aria-pressed="false" aria-label="Usar menú flotante" title="Oculta la barra lateral y usa un menú flotante"><span aria-hidden="true">◫</span></button>
      <button class="unified-nav-close-btn" id="drawerCloseBtn" type="button" aria-label="Cerrar navegación">✕</button>
    </div>
    <nav class="unified-nav-menu" aria-label="Navegación principal">
      <button class="unified-nav-item is-active" id="navigationHome" type="button">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('home')}</span><span>Inicio</span>
      </button>
      <button class="unified-nav-item" id="navigationSongs" type="button">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('music')}</span><span>Canciones</span>
      </button>
      <button class="unified-nav-item" id="navigationStats" type="button">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('chart')}</span><span>Estadísticas</span>
      </button>

    </nav>
    <footer class="unified-nav-footer">
      <button class="unified-nav-item" id="navigationTheme" type="button">
        <span class="unified-nav-icon" id="navigationThemeIcon" aria-hidden="true">${currentThemeIcon()}</span><span id="navigationThemeLabel">Modo oscuro</span>
      </button>
      <button class="unified-nav-item" id="settingsTrigger" type="button">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('settings')}</span><span>Ajustes</span>
      </button>
      <a class="unified-nav-item" id="navigationPortalQuick" data-lp-portal href="${themedAppHref('deskflow')}" aria-label="Volver a LearnFlow" title="Volver a LearnFlow">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('home')}</span><span>Portal</span>
      </a>
    </footer>
  `;

  const settingsOverlay = document.createElement('div');
  settingsOverlay.id = 'settingsOverlay';
  settingsOverlay.className = 'lp-settings-overlay';
  settingsOverlay.hidden = true;
  settingsOverlay.innerHTML = `
    <section class="lp-settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
      <header class="lp-settings-header">
        <h2 id="settingsModalTitle">Ajustes</h2>
        <button class="lp-settings-close" id="settingsCloseBtn" type="button" aria-label="Cerrar ajustes">✕</button>
      </header>
      <div class="lp-settings-body">
        <section class="lp-settings-section" aria-labelledby="settingsSectionAccount">
          <h3 class="lp-settings-section__title" id="settingsSectionAccount">Cuenta</h3>
          <button class="unified-nav-item" id="navigationLogin" type="button" aria-label="Iniciar sesión">
            <span class="unified-nav-icon" aria-hidden="true">${navIcon('user')}</span><span>Iniciar Sesión</span>
          </button>
        </section>
        <section class="lp-settings-section" aria-labelledby="settingsSectionAppearance">
          <h3 class="lp-settings-section__title" id="settingsSectionAppearance">Apariencia</h3>
          <button class="unified-nav-item" id="navigationThemeModal" type="button">
            <span class="unified-nav-icon" id="navigationThemeModalIcon" aria-hidden="true">${currentThemeIcon()}</span><span id="navigationThemeModalLabel">Modo oscuro</span>
          </button>
        </section>
        <section class="lp-settings-section" aria-labelledby="settingsSectionHelp">
          <h3 class="lp-settings-section__title" id="settingsSectionHelp">Ayuda y acerca de</h3>
          <button class="unified-nav-item" id="navigationAbout" type="button">
            <span class="unified-nav-icon" aria-hidden="true">${navIcon('info')}</span><span>About LearnFlow</span>
          </button>
          <a class="unified-nav-item" id="navigationPortal" data-lp-portal href="${themedAppHref('deskflow')}">
            <span class="unified-nav-icon" aria-hidden="true">${navIcon('home')}</span><span>Portal</span>
          </a>
          <a class="unified-nav-item" href="privacy.html">
            <span class="unified-nav-icon" aria-hidden="true">${navIcon('info')}</span><span>Privacidad</span>
          </a>
        </section>
        <section class="lp-settings-section" id="settingsSectionDev" aria-labelledby="settingsSectionDevTitle" hidden>
          <h3 class="lp-settings-section__title" id="settingsSectionDevTitle">Desarrollador</h3>
          <button class="unified-nav-item" type="button" id="devToolsTrigger" aria-expanded="false" aria-controls="devToolsPanel">
            <span class="unified-nav-icon" aria-hidden="true">${navIcon('wrench')}</span><span>Dev</span>
          </button>
          <div class="lp-dev-panel" id="devToolsPanel" hidden>
            <header class="lp-dev-panel__header">
              <span><span class="unified-nav-icon" aria-hidden="true">${navIcon('wrench')}</span><strong>Herramientas de desarrollo</strong></span>
              <code id="devBuildStamp"></code>
            </header>
            <div class="lp-dev-panel__actions">
              <button type="button" id="devRecompileBtn"><span class="unified-nav-icon" aria-hidden="true">${navIcon('refresh')}</span>Recargar</button>
              <button type="button" id="devForceSyncBtn"><span class="unified-nav-icon" aria-hidden="true">${navIcon('refresh')}</span>Forzar sync</button>
              <button type="button" id="devClearCacheBtn" aria-expanded="false"><span class="unified-nav-icon" aria-hidden="true">${navIcon('trash')}</span>Limpiar caché</button>
              <button type="button" id="devScreenInfoBtn" aria-expanded="false"><span class="unified-nav-icon" aria-hidden="true">${navIcon('monitor')}</span>Información de Pantalla</button>
            </div>
            <p class="lp-dev-panel__status" id="devSyncStatus" hidden></p>
            <div class="lp-dev-cache-confirm" id="devCacheConfirm" hidden role="alert">
              <p>Borra caché y datos locales de LearnFlow en este navegador y recarga. Tema, modo y sesión se mantienen.</p>
              <div>
                <button type="button" id="devCacheCancelBtn">Cancelar</button>
                <button type="button" id="devCacheConfirmBtn">Limpiar y recargar</button>
              </div>
            </div>
            <dl class="lp-dev-screen-grid" id="devScreenGrid" hidden></dl>
          </div>
        </section>
      </div>
    </section>
  `;

  document.body.append(backdrop, navigation, trigger, settingsOverlay);
  updateNavigationMode(navigationMode());

  const modeToggle = document.getElementById('navigationModeToggle');
  const themeButton = document.getElementById('navigationTheme');
  const themeIcon = document.getElementById('navigationThemeIcon');
  const themeLabel = document.getElementById('navigationThemeLabel');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  themeLabel.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
  themeButton.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  const themeModalButton = document.getElementById('navigationThemeModal');
  const themeModalIcon = document.getElementById('navigationThemeModalIcon');
  const themeModalLabel = document.getElementById('navigationThemeModalLabel');
  themeModalLabel.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
  themeModalButton.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  themeModalButton.addEventListener('click', () => {
    toggleTheme(themeModalIcon);
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    [
      [themeIcon, themeLabel, themeButton],
      [themeModalIcon, themeModalLabel, themeModalButton],
    ].forEach(([icon, label, button]) => {
      icon.innerHTML = currentThemeIcon();
      label.textContent = nowDark ? 'Modo claro' : 'Modo oscuro';
      button.setAttribute('aria-label', nowDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    });
  });
  document.getElementById('settingsTrigger').addEventListener('click', (event) => {
    if (window.lpDevTools) lpDevTools.updateSectionVisibility();
    lpSettings.open(event, { inertElements: [navigation] });
  });
  trigger.addEventListener('click', () => setNavigationOpen(true));
  backdrop.addEventListener('click', () => setNavigationOpen(false, true));
  document.getElementById('drawerCloseBtn').addEventListener('click', () => setNavigationOpen(false, true));
  modeToggle.addEventListener('click', () => {
    const nextMode = navigationMode() === 'sidebar' ? 'floating' : 'sidebar';
    updateNavigationMode(nextMode, true);
  });
  document.getElementById('navigationHome').addEventListener('click', () => {
    setNavigationOpen(false, true);
    showDashboard();
  });
  document.getElementById('navigationSongs').addEventListener('click', () => {
    setNavigationOpen(false, true);
    showPicker(true);
  });
  document.getElementById('navigationStats').addEventListener('click', () => {
    setNavigationOpen(false, true);
    showStats();
  });
  document.getElementById('navigationAbout').addEventListener('click', aboutEvent => {
    setNavigationOpen(false);
    lpSettings.close();
    showAboutLearnFlow(aboutEvent);
  });
  lpLogin?.bindNavButton?.('#navigationLogin', {
    beforeOpen: () => { setNavigationOpen(false); lpSettings.close(); },
    labelSelector: 'span:last-child',
  });
  themeButton.addEventListener('click', () => {
    toggleTheme(themeIcon);
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    [
      [themeIcon, themeLabel, themeButton],
      [themeModalIcon, themeModalLabel, themeModalButton],
    ].forEach(([icon, label, button]) => {
      icon.innerHTML = currentThemeIcon();
      label.textContent = nowDark ? 'Modo claro' : 'Modo oscuro';
      button.setAttribute('aria-label', nowDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    });
  });
  bindPortalNavigation(document);
  window.addEventListener('storage', storageEvent => {
    if (storageEvent.key !== NAVIGATION_STORAGE_KEY) return;
    updateNavigationMode(storageEvent.newValue === 'floating' ? 'floating' : 'sidebar');
  });
  window.addEventListener('resize', () => syncNavigationLayout());
  document.addEventListener('keydown', navigationEvent => {
    if (!navigation.classList.contains('is-open')) return;
    if (navigationEvent.key === 'Escape') {
      navigationEvent.preventDefault();
      setNavigationOpen(false, true);
      return;
    }
    if (navigationEvent.key !== 'Tab') return;
    const focusable = [...navigation.querySelectorAll('button, a[href]')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (navigationEvent.shiftKey && document.activeElement === first) {
      navigationEvent.preventDefault();
      last.focus();
    } else if (!navigationEvent.shiftKey && document.activeElement === last) {
      navigationEvent.preventDefault();
      first.focus();
    }
  });
}

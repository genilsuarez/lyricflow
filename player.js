// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Learn languages through music
// Auto-discovers songs from songs/ folder via catalog.js
// Features: synced lyrics, vocab, fill-in-the-blanks, A-B loop, speed control, culture
// ═══════════════════════════════════════════════════════════════════════════════

import pickerSongs from './songs/picker-data.js';
import { loadVocab, toggleVocabMode, showCultureView } from './vocab-culture.js';
import { toggleQuizMode } from './quiz.js';
import { renderDashboard, cleanupDashboard, renderStats, cleanupStats } from './stats.js';
import {
  configureProgressCatalog,
  createListenTracker,
  createRunId,
  getProgress,
  getSongProgress,
  markListenCompleted,
  recordActivityResult,
} from './progress.js';
import { setupSupabaseAuth } from './lp-auth-setup.js';

configureProgressCatalog(pickerSongs);

function refreshLyricFlowUiAfterAuth() {
  configureProgressCatalog(pickerSongs);
  const dashboard = document.getElementById('dashboard');
  if (dashboard && !dashboard.hidden) renderDashboard();
  const headerProgress = document.getElementById('appHeaderProgress');
  if (headerProgress) updateAppHeaderProgress();
}

setupSupabaseAuth({
  onAfterLogin: () => {
    refreshLyricFlowUiAfterAuth();
  },
  onAfterLogout: () => {
    configureProgressCatalog(pickerSongs);
    const dashboard = document.getElementById('dashboard');
    if (dashboard && !dashboard.hidden) renderDashboard();
  },
});

function refreshLyricFlowAfterGuestReset() {
  configureProgressCatalog(pickerSongs);
  const dashboard = document.getElementById('dashboard');
  if (dashboard && !dashboard.hidden) renderDashboard();
}

window.addEventListener('lp-guest-reset', refreshLyricFlowAfterGuestReset);
window.addEventListener('storage', storageEvent => {
  if (storageEvent.key?.startsWith('learnflow:progress:') && storageEvent.newValue === null) {
    refreshLyricFlowAfterGuestReset();
  }
});

export const app = document.getElementById('app');

// Speed control options
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25];

// ─── Difficulty System (pedagogically-driven) ──────────────────────────────────
// Philosophy: blanks reinforce KEY vocabulary from the song, not random words.
// vocabData words are blanked first; only when cap allows do content words fill in.
//
// totalCap: max blanks for the entire song (absolute ceiling)
// vocabBoost: multiplier for vocab-word score (higher = vocab almost always chosen)
// minWordLen: words shorter than this are never blanked
// maxPerLine: never exceed this many blanks on a single line
const DIFFICULTY = {
  easy:   { totalCap: 8,  vocabBoost: 200, minWordLen: 3, maxPerLine: 1 },
  normal: { totalCap: 16, vocabBoost: 150, minWordLen: 2, maxPerLine: 1 },
  hard:   { totalCap: 30, vocabBoost: 100, minWordLen: 1, maxPerLine: 2 },
};

// CEFR multiplier — lower levels get fewer blanks (more focus, less overwhelm)
const LEVEL_FACTOR = { A1: 0.6, A2: 0.75, B1: 1.0, B2: 1.0, C1: 1.1, C2: 1.2 };

// Shared stop words — never blanked in either mode
const STOP_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'le', 'la', 'les', 'un', 'une', 'des', 'du',
  'de', 'et', 'ou', 'mais', 'en', 'au', 'aux', 'ce', 'ma', 'mon',
  'sa', 'son', 'ne', 'pas', 'que', 'qui', 'est', 'ai', 'a', 'y',
  'dans', 'sur', 'pour', 'par', 'avec', 'tout', 'si', 'ô', 'oh',
]);

// Single mutable state object — every module-level piece of player state
// lives here so it can be read/written uniformly (and later map cleanly
// onto React state when this file gets ported).
export const state = {
  // Playback
  audio: null,
  currentSubIndex: -1,
  animationFrame: null,
  isDragging: false,
  currentSong: null,
  playbackRate: 1,

  // View toggles
  showTranslation: false,
  selectMode: false,
  theaterMode: false,
  showLineNumbers: false,
  vocabData: null,

  // A-B loop
  loopA: null,
  loopB: null,
  loopActive: false,

  // Fill-in-the-blanks
  blanksMode: false,
  blanksAnswers: {},
  blanksBlanksMap: {},  // lineIndex -> Set of wordIdx to blank (pre-computed)
  blanksDifficulty: 'normal',
  challengeRunId: null,
  listeningDifficulty: 'normal',
  dictationRunId: null,

  // Listening challenge
  listeningMode: false,
  listeningStarted: false, // true once user clicks play in listening mode
  listeningWaiting: false,
  listeningCurrentBlank: null,
  listeningTimerId: null,
  listeningResumeTimers: [], // setTimeout IDs from resumeListeningAfterDelay
  listeningScore: { correct: 0, wrong: 0 },
  listeningBlanksMap: {}, // lineIndex -> [{wordIdx, clean, original}]
  listeningPauseAt: null,   // audio time (s) to pause and activate blank
  listeningRepeatCount: 0,  // 0 = first play, 1 = already repeated → now pause
  listeningLineStart: null, // start time of current listening line (for replay)

  // Highlight toggle
  highlightEnabled: true, // Ctrl/Cmd+H toggles lyric highlighting on/off

  // Misc
  playerCleanup: null,   // Event listener cleanup (AbortController per player session)
  listenTracker: null,   // Unique timeline coverage tracker for the active song
  cachedSubLines: [],    // Cached DOM references (set after renderSubtitles)
  scrollRAF: null,       // Debounce scroll — avoid queueing multiple smooth scrolls

  // Navigation
  previousView: 'dashboard', // 'dashboard' | 'picker' | 'stats' — where to return on back
};

// ─── Persistence (localStorage) ────────────────────────────────────────────────

const STORAGE_KEY = 'lyricflow_prefs';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { return {}; }
}

function savePrefs(partial) {
  const prefs = { ...loadPrefs(), ...partial };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}

// ─── Section Visit Tracking ────────────────────────────────────────────────────

const VISITS_KEY = 'lyricflow_visits';

function getVisits() {
  try { return JSON.parse(localStorage.getItem(VISITS_KEY)) || {}; } catch { return {}; }
}

function getSectionVisited(songId, section) {
  const visits = getVisits();
  return !!(visits[songId] && visits[songId][section]);
}

function markSectionVisited(songId, section) {
  const visits = getVisits();
  if (!visits[songId]) visits[songId] = {};
  if (visits[songId][section]) return; // already marked
  visits[songId][section] = Date.now();
  try { localStorage.setItem(VISITS_KEY, JSON.stringify(visits)); } catch {}
  // Update just the button — no full re-render to avoid breaking song load
  const btnMap = { vocab: 'toggleVocabBtn', culture: 'toggleCultureBtn' };
  const btn = document.getElementById(btnMap[section]);
  if (btn && !btn.querySelector('.toolbar-done-dot')) {
    btn.classList.add('is-activity-done');
    btn.insertAdjacentHTML('beforeend', '<span class="toolbar-done-dot toolbar-done-dot--visited" aria-label="visitado">👁</span>');
    const tooltip = btn.dataset.tooltip;
    if (tooltip && !tooltip.includes('✓')) btn.dataset.tooltip = tooltip + ' ✓';
  }
}

// ─── Mode Toolbar (shared across player, quiz, vocab, culture) ─────────────────

export function modeToolbarHtml(song, activeMode = '') {
  const showDisplay = activeMode === '' || activeMode === 'blanks' || activeMode === 'listening';
  const sp = getSongProgress(song.id);
  const done = (act) => sp.activities[act]?.completed;
  const visited = (section) => getSectionVisited(song.id, section);
  const check = (show) => show ? '<span class="toolbar-done-dot" aria-label="completada">✓</span>' : '';
  const eye = (show) => show ? '<span class="toolbar-done-dot toolbar-done-dot--visited" aria-label="visitado">👁</span>' : '';
  const overflowActive = activeMode === 'vocab' || activeMode === 'culture';
  return `
    <div class="mode-toolbar">
      <div class="ctrl-group ctrl-group--study">
        <button class="toggle-player-btn${activeMode === '' ? ' active' : ''}${done('listen') ? ' is-activity-done' : ''}" id="togglePlayerBtn" aria-label="Volver al reproductor" data-tooltip="Escucha${done('listen') ? ' ✓' : ''}">🎵${check(done('listen'))}</button>
        <button class="toggle-listening-btn${activeMode === 'listening' ? ' active' : ''}${done('dictation') ? ' is-activity-done' : ''}" id="toggleListeningBtn" aria-label="Dictado auditivo" data-tooltip="Dictado${done('dictation') ? ' ✓' : ''}">🎧${check(done('dictation'))}</button>
        <button class="toggle-blanks-btn${activeMode === 'blanks' ? ' active' : ''}${done('challenge') ? ' is-activity-done' : ''}" id="toggleBlanksBtn" aria-label="Fill in the blanks" data-tooltip="Completar huecos${done('challenge') ? ' ✓' : ''}">✎${check(done('challenge'))}</button>
        <button class="toggle-quiz-btn${activeMode === 'quiz' ? ' active' : ''}${done('quiz') ? ' is-activity-done' : ''}" id="toggleQuizBtn" aria-label="Mini Quiz" data-tooltip="Quiz${done('quiz') ? ' ✓' : ''}">🧠${check(done('quiz'))}</button>
        <div class="ctrl-study-more">
          <button type="button" class="ctrl-study-more-btn${overflowActive ? ' has-active-overflow' : ''}" id="toggleStudyMoreBtn" aria-label="Más modos de estudio" aria-expanded="false" aria-haspopup="true" data-tooltip="Más">+</button>
          <div class="ctrl-study-overflow" id="studyOverflowMenu" role="menu" aria-label="Más modos de estudio">
            <button class="toggle-vocab-btn${activeMode === 'vocab' ? ' active' : ''}${visited('vocab') ? ' is-activity-done' : ''}" id="toggleVocabBtn" role="menuitem" aria-label="Vocabulario" data-tooltip="Vocabulario${visited('vocab') ? ' ✓' : ''}">📖${eye(visited('vocab'))}</button>
            ${song.culture ? `<button class="toggle-culture-btn${activeMode === 'culture' ? ' active' : ''}${visited('culture') ? ' is-activity-done' : ''}" id="toggleCultureBtn" role="menuitem" aria-label="Contexto cultural" data-tooltip="Cultura${visited('culture') ? ' ✓' : ''}">🌍${eye(visited('culture'))}</button>` : ''}
          </div>
        </div>
      </div>
      <span class="ctrl-divider${showDisplay ? '' : ' hidden'}${isLocalHost() ? ' hidden' : ''}" aria-hidden="true"></span>
      <div class="ctrl-group ctrl-group--display">
        ${isLocalHost() ? '<button class="toggle-shortcuts-btn" id="shortcutsBtnToolbar" aria-label="Atajos de teclado" data-tooltip="Atajos de teclado">⚙</button>' : ''}
        <button class="toggle-trans-btn${showDisplay ? '' : ' hidden'}" id="toggleTransBtn" aria-label="Traducción" data-tooltip="Mostrar traducción">Aa</button>
        <button class="toggle-select-btn${showDisplay ? '' : ' hidden'}" id="toggleSelectBtn" aria-label="Modo selección" data-tooltip="Seleccionar texto">⌶</button>
        <button class="toggle-theater-btn" id="toggleTheaterBtn" aria-label="Modo teatro" data-tooltip="Maximizar reproductor">⛶</button>
      </div>
    </div>
  `;
}

// Update toolbar active states without destroying/recreating it
export function updateToolbarActiveState(activeMode) {
  const map = {
    '': 'togglePlayerBtn',
    vocab: 'toggleVocabBtn',
    listening: 'toggleListeningBtn',
    blanks: 'toggleBlanksBtn',
    quiz: 'toggleQuizBtn',
    culture: 'toggleCultureBtn',
  };
  // Remove active from all study buttons
  Object.values(map).forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  // Set active on current
  const activeId = map[activeMode];
  if (activeId) document.getElementById(activeId)?.classList.add('active');

  // Reset scroll to top on mode switch
  const modeContent = document.getElementById('modeContent');
  if (modeContent) modeContent.scrollTop = 0;
  const subContainer = document.getElementById('subContainer');
  if (subContainer) subContainer.scrollTop = 0;

  // Show/hide display group (translation + select only — theater stays visible)
  const showDisplay = activeMode === '' || activeMode === 'blanks' || activeMode === 'listening';
  const divider = document.querySelector('.mode-toolbar .ctrl-divider');
  const transBtn = document.getElementById('toggleTransBtn');
  const selectBtn = document.getElementById('toggleSelectBtn');
  if (divider) divider.classList.toggle('hidden', !showDisplay);
  if (transBtn) transBtn.classList.toggle('hidden', !showDisplay);
  if (selectBtn) selectBtn.classList.toggle('hidden', !showDisplay);

  const moreBtn = document.getElementById('toggleStudyMoreBtn');
  if (moreBtn) {
    moreBtn.classList.toggle('has-active-overflow', activeMode === 'vocab' || activeMode === 'culture');
  }
}

// Render toolbar into persistent container (only if not already there)
function ensureModeToolbar(song, activeMode = '') {
  let container = document.getElementById('modeToolbarContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'modeToolbarContainer';
    app.prepend(container);
  }
  // Always re-render toolbar with correct culture button presence
  container.innerHTML = modeToolbarHtml(song, activeMode);
  // Bind persistent nav handlers on toolbar
  bindModeToolbarNav(song);
}

// Set mode content (everything below the toolbar)
function setModeContent(html) {
  let content = document.getElementById('modeContent');
  if (!content) {
    content = document.createElement('div');
    content.id = 'modeContent';
    content.className = 'mode-content';
    app.appendChild(content);
  }
  content.innerHTML = html;
}

export function bindModeToolbarNav(song) {
  document.getElementById('togglePlayerBtn')?.addEventListener('click', () => {
    if (state.blanksMode || state.listeningMode) {
      pauseOnModeSwitch();
      returnToPlayer();
    } else {
      loadSong(song);
    }
  });
  document.getElementById('toggleVocabBtn')?.addEventListener('click', () => {
    pauseOnModeSwitch();
    markSectionVisited(song.id, 'vocab');
    toggleVocabMode();
  });
  document.getElementById('toggleListeningBtn')?.addEventListener('click', () => {
    if (!document.getElementById('subContainer')) {
      pauseOnModeSwitch();
      state.pendingMode = 'listening';
      loadSong(song);
      return;
    }
    pauseOnModeSwitch();
    toggleListeningMode();
  });
  document.getElementById('toggleBlanksBtn')?.addEventListener('click', () => {
    if (!document.getElementById('subContainer')) {
      pauseOnModeSwitch();
      state.pendingMode = 'blanks';
      loadSong(song);
      return;
    }
    pauseOnModeSwitch();
    toggleBlanksMode();
  });
  document.getElementById('toggleQuizBtn')?.addEventListener('click', () => {
    pauseOnModeSwitch();
    toggleQuizMode();
  });
  if (song.culture) {
    document.getElementById('toggleCultureBtn')?.addEventListener('click', () => {
      pauseOnModeSwitch();
      markSectionVisited(song.id, 'culture');
      showCultureView(song);
    });
  }
  // Theater button — always available regardless of mode
  document.getElementById('toggleTheaterBtn')?.addEventListener('click', toggleTheaterMode);
  bindStudyOverflowMenu();
}

function bindStudyOverflowMenu() {
  const moreBtn = document.getElementById('toggleStudyMoreBtn');
  const menu = document.getElementById('studyOverflowMenu');
  if (!moreBtn || !menu) return;

  const closeMenu = () => {
    menu.classList.remove('is-open');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.classList.remove('is-active');
  };

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !menu.classList.contains('is-open');
    if (opening) {
      menu.classList.add('is-open');
      moreBtn.setAttribute('aria-expanded', 'true');
      moreBtn.classList.add('is-active');
      requestAnimationFrame(() => {
        document.addEventListener('click', closeMenu, { once: true });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') closeMenu();
        }, { once: true });
      });
    } else {
      closeMenu();
    }
  });

  menu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', closeMenu);
  });
}

// Pause audio when switching between study modes
function pauseOnModeSwitch() {
  if (state.audio && !state.audio.paused) {
    state.audio.pause();
    stopUpdateLoop();
    const playBtn = document.getElementById('playBtn');
    if (playBtn) setPlayButtonState(false);
    document.querySelector('.artwork')?.classList.remove('playing');
  }
}

// Strip accents for comparison — "déambule" == "deambule"
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
function normalizeForCompare(s) {
  return s.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().trim();
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const PROGRESS_ACTIVITY_LABELS = {
  listen: 'Escucha',
  dictation: 'Dictado',
  challenge: 'Challenge',
  quiz: 'Quiz',
};

function progressTooltipHtml(songProgress) {
  const lines = Object.entries(PROGRESS_ACTIVITY_LABELS).map(([activity, label]) => {
    const done = songProgress.activities[activity].completed;
    return `<span class="progress-tooltip-line ${done ? 'is-done' : ''}">${done ? '✓' : '○'} ${label}</span>`;
  }).join('');
  return lines;
}

function progressInnerHtml(songProgress) {
  const completed = Object.values(songProgress.activities).filter(activity => activity.completed).length;
  const segments = Object.entries(PROGRESS_ACTIVITY_LABELS).map(([activity, label]) => {
    const done = songProgress.activities[activity].completed;
    return `<span class="song-progress-segment ${done ? 'is-complete' : ''}" title="${label}: ${done ? 'completada' : 'pendiente'}"></span>`;
  }).join('');
  return `
    <span class="song-progress-copy"><strong>${completed}/4</strong> actividades</span>
    <span class="song-progress-hitarea" aria-hidden="true"><span class="song-progress-track">${segments}</span></span>
  `;
}

function songProgressHtml(contentId, className = '') {
  const songProgress = getSongProgress(contentId);
  return `<div class="song-learning-progress ${className}" data-song-progress="${contentId}" role="status" aria-label="Progreso de la canción: ${songProgress.progressPct}%">${progressInnerHtml(songProgress)}</div>`;
}

function updateToolbarDoneStates(contentId) {
  const songProgress = getSongProgress(contentId);
  const btnMap = {
    listen: 'togglePlayerBtn',
    dictation: 'toggleListeningBtn',
    challenge: 'toggleBlanksBtn',
    quiz: 'toggleQuizBtn',
  };
  Object.entries(btnMap).forEach(([activity, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const done = songProgress.activities[activity]?.completed;
    if (done && !btn.classList.contains('is-activity-done')) {
      btn.classList.add('is-activity-done');
      btn.insertAdjacentHTML('beforeend', '<span class="toolbar-done-dot" aria-label="completada">✓</span>');
      const tooltip = btn.dataset.tooltip;
      if (tooltip && !tooltip.includes('✓')) btn.dataset.tooltip = tooltip + ' ✓';
    }
  });
}

export function updateSongProgressUi(contentId) {
  const songProgress = getSongProgress(contentId);
  document.querySelectorAll(`[data-song-progress="${contentId}"]`).forEach(element => {
    element.innerHTML = progressInnerHtml(songProgress);
    element.setAttribute('aria-label', `Progreso de la canción: ${songProgress.progressPct}%`);
  });
  updateToolbarDoneStates(contentId);
  updateAppHeaderProgress();
}

// ─── App Header (persistent: brand + overall progress, shown on every view) ────

const LP_ICON_TROPHY = '<svg class="lp-header-stats__icon lp-header-stats__icon--trophy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978"/><path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978"/><path d="M18 9h1.5a1 1 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6 9H4.5a1 1 0 0 1 0-5H6"/></svg>';
const LP_ICON_STAR = '<svg class="lp-header-stats__icon lp-header-stats__icon--star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';

function updateAppHeaderProgress() {
  const el = document.getElementById('appHeaderProgress');
  if (!el) return;
  const { summary } = getProgress();
  el.innerHTML = `
    <span class="lp-header-stats__group">
      ${LP_ICON_TROPHY}
      <strong class="lp-header-stats__value">${summary.completedActivities}/${summary.totalActivities}</strong>
      <span class="lp-header-stats__label">actividades</span>
    </span>
    <span class="lp-header-stats__divider" aria-hidden="true"></span>
    <span class="lp-header-stats__group">
      <strong class="lp-header-stats__value">${summary.completedContent}</strong>
      ${LP_ICON_STAR}
      <span class="lp-header-stats__label">canciones</span>
    </span>
  `;
}

function renderAppHeader(song) {
  const header = document.getElementById('appHeader');
  if (!header) return;
  if (song) {
    const backLabel = state.previousView === 'picker' ? 'Volver a canciones' : state.previousView === 'stats' ? 'Volver a estadísticas' : 'Volver al inicio';
    header.classList.add('app-header--player');
    header.innerHTML = `
      <div class="app-header__player-bar">
        <div class="app-header__learning-toolbar" role="group" aria-label="Navegación del reproductor">
          <button class="app-header__toolbar-btn app-header__back-btn" id="headerBackBtn" type="button" aria-label="${backLabel}" title="Volver">${navIcon('arrow-left')}</button>
          <div class="app-header__song-block">
            <h2 class="app-header__song-title" title="${song.title}">${song.title}</h2>
            <div class="app-header__song-sub">
              <span class="app-header__song-artist">${song.artist}</span>
              ${song.level ? `<span class="level-badge level-${song.level.toLowerCase()}">${song.level}</span>` : ''}
            </div>
          </div>
          <button class="app-header__toolbar-btn app-header__menu-btn" id="headerMenuBtn" type="button" aria-label="Abrir navegación" aria-controls="unifiedNavigation" aria-expanded="false">${navIcon('menu')}</button>
        </div>
      </div>
      <div class="app-header__player-center" aria-hidden="false">
        ${songProgressHtml(song.id, 'song-learning-progress--player')}
      </div>
    `;
    document.getElementById('headerBackBtn').addEventListener('click', () => {
      const dest = state.previousView;
      if (dest === 'picker') showPicker(true);
      else if (dest === 'stats') showStats();
      else showDashboard();
    });
    document.getElementById('headerMenuBtn')?.addEventListener('click', () => setNavigationOpen(true));
  } else {
    header.classList.remove('app-header--player');
    header.innerHTML = `
      <div class="app-header-brand">
        <h1>Lyric<em>Flow</em></h1>
        <span>Aprende idiomas con música</span>
      </div>
      <div class="lp-header-stats" id="appHeaderProgress" role="status" aria-label="Progreso total de LyricFlow"></div>
    `;
    updateAppHeaderProgress();
  }
}

// Simple seeded random for consistent blanks per song
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Greedily pick blank candidates: respect global cap, per-line cap, and one
// occurrence per unique word across the whole song (avoids "goodbye" ×10 in Hello, Goodbye).
function pickBlankCandidates(allCandidates, totalCap, maxPerLine) {
  const lineCounts = {};
  const usedWords = new Set();
  const picked = [];

  for (const c of allCandidates) {
    if (picked.length >= totalCap) break;
    const lc = lineCounts[c.lineIndex] || 0;
    if (lc >= maxPerLine) continue;
    if (usedWords.has(c.clean)) continue;

    picked.push(c);
    lineCounts[c.lineIndex] = lc + 1;
    usedWords.add(c.clean);
  }

  return picked;
}

// ─── Stats View ────────────────────────────────────────────────────────────────

function setActiveNavItem(id) {
  document.querySelectorAll('.unified-nav-item').forEach(item => item.classList.remove('is-active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('is-active');
}

function showDashboard() {
  state.playerCleanup?.();
  state.playerCleanup = null;
  state.currentSong = null;
  state.previousView = 'dashboard';
  if (state.audio) { state.audio.pause(); state.audio.src = ''; state.audio = null; }
  stopUpdateLoop();
  cleanupStats();
  if (location.search.includes('song=')) {
    const u = new URL(location.href);
    u.searchParams.delete('song');
    history.replaceState(null, '', u);
  }
  setActiveNavItem('navigationHome');
  renderAppHeader();
  renderDashboard(loadSong, () => showPicker(true));
}

function showStats() {
  state.playerCleanup?.();
  state.playerCleanup = null;
  state.currentSong = null;
  state.previousView = 'stats';
  if (state.audio) { state.audio.pause(); state.audio.src = ''; state.audio = null; }
  stopUpdateLoop();
  cleanupDashboard();
  if (location.search.includes('song=')) {
    const u = new URL(location.href);
    u.searchParams.delete('song');
    history.replaceState(null, '', u);
  }
  setActiveNavItem('navigationStats');
  renderAppHeader();
  renderStats();
}

// ─── Song Picker ───────────────────────────────────────────────────────────────

function showPicker(skipAutoLoad = false) {
  state.playerCleanup?.();
  state.playerCleanup = null;
  state.currentSong = null;
  state.previousView = 'picker';
  if (state.audio) { state.audio.pause(); state.audio.src = ''; state.audio = null; }
  stopUpdateLoop();
  cleanupStats();
  cleanupDashboard();
  if (state.theaterMode) { state.theaterMode = false; document.body.classList.remove('theater-mode'); }
  setActiveNavItem('navigationSongs');
  if (location.search.includes('song=')) {
    const u = new URL(location.href);
    u.searchParams.delete('song');
    history.replaceState(null, '', u);
  }
  renderAppHeader();

  // Songs pre-sorted by CEFR level from picker-data.js (no dynamic imports needed)
  const levelOrder = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  const songs = [...pickerSongs].sort((a, b) => {
    const la = levelOrder.indexOf((a.level || '').toLowerCase());
    const lb = levelOrder.indexOf((b.level || '').toLowerCase());
    const ia = la === -1 ? levelOrder.length : la;
    const ib = lb === -1 ? levelOrder.length : lb;
    return ia - ib || a.title.localeCompare(b.title);
  });

  app.innerHTML = `
    <div class="song-picker">
      <div class="picker-toprow picker-toprow--solo">
        <div class="search-bar">
          <input type="search" id="songSearch" placeholder="Buscar canciones…" aria-label="Buscar canciones" autocomplete="off">
        </div>
      </div>
      <div class="song-list" id="songList"></div>
    </div>
  `;

  const list = document.getElementById('songList');

  function renderSongs(filtered) {
    list.innerHTML = '';
    if (filtered.length === 0) {
      list.innerHTML = '<div class="no-results">No songs match your search.</div>';
      return;
    }
    filtered.forEach((song) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'song-list-item';
      item.setAttribute('aria-label', `Abrir ${song.title} de ${song.artist}`);
      item.innerHTML = `
        <span class="song-list-item__icon" aria-hidden="true">${song.icon || '🎵'}</span>
        <span class="song-list-item__body">
          <span class="song-list-item__head">
            <span class="song-list-item__copy">
              <span class="title">${song.title}</span>
              <span class="artist">${song.artist}</span>
            </span>
            ${song.level ? `<span class="level-badge level-${song.level.toLowerCase()}">${song.level}</span>` : ''}
          </span>
          ${songProgressHtml(song.id, 'song-learning-progress--card')}
        </span>
        <span class="song-list-item__chevron" aria-hidden="true"></span>
      `;
      item.addEventListener('click', () => loadSong(song));
      list.appendChild(item);
    });
  }

  renderSongs(songs);

  // Floating tooltip for song progress on hover
  let floatingTooltip = document.getElementById('progressFloatingTooltip');
  if (!floatingTooltip) {
    floatingTooltip = document.createElement('div');
    floatingTooltip.id = 'progressFloatingTooltip';
    floatingTooltip.className = 'progress-tooltip';
    floatingTooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(floatingTooltip);
  }

  list.addEventListener('pointerenter', (e) => {
    const hitarea = e.target.closest('.song-progress-hitarea');
    if (!hitarea) return;
    const progressEl = hitarea.closest('[data-song-progress]');
    if (!progressEl) return;
    const contentId = progressEl.dataset.songProgress;
    const sp = getSongProgress(contentId);
    floatingTooltip.innerHTML = progressTooltipHtml(sp);
    floatingTooltip.classList.add('is-visible');
    const rect = hitarea.getBoundingClientRect();
    requestAnimationFrame(() => {
      const ttRect = floatingTooltip.getBoundingClientRect();
      let top = rect.top - ttRect.height - 6;
      if (top < 4) top = rect.bottom + 6;
      let left = rect.right - ttRect.width;
      if (left < 4) left = 4;
      floatingTooltip.style.top = `${top}px`;
      floatingTooltip.style.left = `${left}px`;
    });
  }, true);

  list.addEventListener('pointerleave', (e) => {
    const hitarea = e.target.closest('.song-progress-hitarea');
    if (hitarea) floatingTooltip.classList.remove('is-visible');
  }, true);

  list.addEventListener('click', () => {
    floatingTooltip.classList.remove('is-visible');
  }, true);

  const searchInput = document.getElementById('songSearch');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) { renderSongs(songs); return; }
    const filtered = songs.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q) ||
      (s.level && s.level.toLowerCase().includes(q))
    );
    renderSongs(filtered);
  });

  // Auto-load last played song ONLY if this is a same-session return
  // (not a fresh tab, not from DeskFlow, not first visit)
  // If navigated from DeskFlow (portal), always show picker
  const prefs = loadPrefs();
  const isSessionActive = sessionStorage.getItem('lyricflow_active');
  const fromPortal = document.referrer.includes('deskflow') || document.referrer.includes(':3000');
  if (!skipAutoLoad && prefs.lastSong && isSessionActive && !fromPortal) {
    const lastSong = songs.find(s => s.folder === prefs.lastSong);
    if (lastSong) loadSong(lastSong);
  }
}

// ─── Player View ───────────────────────────────────────────────────────────────

export async function loadSong(song) {
  cleanupStats();
  // If song only has picker metadata, load full data (subtitles, culture, etc.)
  if (!song.subtitles) {
    try {
      const folderName = song.folder.replace(/^songs\//, '');
      const mod = await import(`./songs/${folderName}/data.js`);
      song = { ...mod.default, id: song.id, folder: song.folder };
    } catch (err) {
      console.error(`[LyricFlow] Failed to load song data: ${song.folder}`, err);
      app.innerHTML = `
        <div class="audio-error">
          <p class="audio-error-icon">⚠️</p>
          <p class="audio-error-msg">No se pudo cargar la canción</p>
          <p class="audio-error-path">${song.title || song.folder}</p>
          <button class="audio-error-retry" onclick="location.reload()">Reintentar</button>
        </div>
      `;
      return;
    }
  }
  state.playerCleanup?.();
  state.playerCleanup = null;
  if (state.audio) { state.audio.pause(); state.audio = null; }
  stopUpdateLoop();
  state.currentSong = song;
  state.showTranslation = false;
  state.showLineNumbers = false;
  state.blanksMode = false;
  state.blanksAnswers = {};
  state.challengeRunId = null;
  state.listeningMode = false;
  state.listeningStarted = false;
  state.listeningWaiting = false;
  state.listeningCurrentBlank = null;
  state.listeningScore = { correct: 0, wrong: 0 };
  state.dictationRunId = null;
  state.listeningBlanksMap = {};
  state.listeningPauseAt = null;
  clearListeningTimer();
  state.loopA = null;
  state.loopB = null;
  state.loopActive = false;
  state.playbackRate = 1;
  state.currentSubIndex = -1;

  // Preserve toolbar if already present, only recreate content
  const existingToolbar = document.getElementById('modeToolbarContainer');
  if (existingToolbar) {
    updateToolbarActiveState('');
  } else {
    app.innerHTML = '';
    ensureModeToolbar(song, '');
  }
  setModeContent(`
    <div class="subtitle-container" id="subContainer"></div>
    <div class="song-fin-actions hidden" id="songFinActions">
      <button class="lr-btn lr-btn--retry" id="finRepeatBtn" aria-label="Repetir canción">↻</button>
      <button class="lr-btn lr-btn--next" id="finNextBtn"></button>
    </div>
    <div class="sr-live" id="srLive" aria-live="polite" aria-atomic="true"></div>

    <div class="bottom-bar">
      <div class="progress-section">
        <div class="progress-bar" id="progressBar" role="slider" aria-label="Progreso de la canción" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00" tabindex="0">
          <div class="progress-fill" id="progressFill"></div>
          <div class="loop-region" id="loopRegion"></div>
        </div>
        <div class="time-row">
          <span id="currentTime">0:00</span>
          <span class="loop-indicator" id="loopIndicator"></span>
          <span id="durationTime">0:00</span>
        </div>
      </div>
      <div class="controls-row">
        <button class="play-btn" id="playBtn" type="button" aria-label="Reproducir"></button>
        <div class="volume-control" id="volumeControl">
          <button class="volume-btn" id="volumeBtn" aria-label="Silenciar/Volumen">🔊</button>
          <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.01" value="1" aria-label="Volumen" />
        </div>
        <button class="speed-btn" id="speedBtn" aria-label="Velocidad" data-tooltip="Velocidad de reproducción">1×</button>
        <button class="loop-btn" id="loopBtn" aria-label="A-B Loop" data-tooltip="Repetir sección A→B">⟳</button>
      </div>
    </div>
    ${isLocalHost() ? `
    <div class="shortcuts-panel hidden" id="shortcutsPanel">
      <div class="shortcuts-panel-title">Atajos de teclado</div>
      <div class="shortcuts-panel-section">
        <div class="shortcuts-panel-heading">Reproducción</div>
        <div class="shortcut-row"><kbd>Space</kbd> / <kbd>K</kbd><span>Play / Pausa</span></div>
        <div class="shortcut-row"><kbd>S</kbd><span>Velocidad</span></div>
        <div class="shortcut-row"><kbd>L</kbd><span>A-B Loop</span></div>
        <div class="shortcut-row"><kbd>←</kbd> / <kbd>→</kbd><span>Seek ±5s</span></div>
        <div class="shortcut-row"><kbd>Shift</kbd>+<kbd>←</kbd> / <kbd>→</kbd><span>Seek ±10s</span></div>
      </div>
      <div class="shortcuts-panel-section">
        <div class="shortcuts-panel-heading">Visualización</div>
        <div class="shortcut-row"><kbd>Ctrl</kbd>+<kbd>N</kbd><span>Números de línea</span></div>
        <div class="shortcut-row"><kbd>Ctrl</kbd>+<kbd>T</kbd><span>Traducción</span></div>
        <div class="shortcut-row"><kbd>Ctrl</kbd>+<kbd>H</kbd><span>Highlight letras</span></div>
      </div>

    </div>` : ''}
  `);

  renderAppHeader(song);

  bindPlayerEvents(song);
  renderSubtitles(song.subtitles);

  // Local dev: always show line numbers
  const _hn = location.hostname;
  if (_hn === 'localhost' || _hn === '127.0.0.1' || _hn.startsWith('192.168.')) {
    state.showLineNumbers = true;
    const _sc = document.getElementById('subContainer');
    if (_sc) _sc.classList.add('show-line-numbers');
  }

  initAudio(song);
  loadVocab(song);

  // Restore persisted preferences
  const prefs = loadPrefs();
  if (prefs.volume !== undefined) {
    savedVolume = prefs.volume;
    const slider = document.getElementById('volumeSlider');
    if (slider) slider.value = savedVolume;
  }
  if (prefs.speed !== undefined && SPEED_OPTIONS.includes(prefs.speed)) {
    state.playbackRate = prefs.speed;
    if (state.audio) state.audio.playbackRate = state.playbackRate;
    const btn = document.getElementById('speedBtn');
    if (btn) btn.textContent = state.playbackRate === 1 ? '1×' : `${state.playbackRate}×`;
    btn?.classList.toggle('active', state.playbackRate !== 1);
  }
  if (state.audio) state.audio.volume = savedVolume;
  updateVolumeIcon(savedVolume);

  // Persist last song & mark session as active
  savePrefs({ lastSong: song.folder });
  sessionStorage.setItem('lyricflow_active', '1');
  const u = new URL(location.href);
  u.searchParams.set('song', song.folder.split('/').pop());
  history.replaceState(null, '', u);

  // Activate pending mode if navigated from another view
  if (state.pendingMode) {
    const mode = state.pendingMode;
    state.pendingMode = null;
    if (mode === 'blanks') toggleBlanksMode();
    else if (mode === 'listening') toggleListeningMode();
  }
}

// ─── Shared nav helpers (lp-nav-helpers.js) ──────────────────────────────────
const navIcon = (name) => window.LpNavHelpers.navIcon(name);
const currentThemeIcon = () => window.LpNavHelpers.currentThemeIcon();
const toggleTheme = (iconEl) => window.LpNavHelpers.toggleTheme(iconEl);
const themedAppHref = (app) => window.LpNavHelpers.themedAppHref(app);


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

function setNavigationOpen(isOpen, restoreFocus = false) {
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
  document.body.classList.toggle('navigation-open', isOpen && !isPersistent);
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

function initUnifiedNavigation() {
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
  backdrop.className = 'unified-nav-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const navigation = document.createElement('aside');
  navigation.id = 'unifiedNavigation';
  navigation.className = 'unified-nav';
  navigation.setAttribute('aria-label', 'Navegación de LearnFlow');
  navigation.innerHTML = `
    <div class="unified-nav-brand">
      <span class="unified-nav-mark" aria-hidden="true">LF</span>
      <span><strong>LyricFlow</strong><small>LearnFlow</small></span>
      <button class="unified-nav-mode-toggle" id="navigationModeToggle" type="button" aria-pressed="false" aria-label="Usar menú flotante" title="Oculta la barra lateral y usa un menú flotante"><span aria-hidden="true">◫</span></button>
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
      <button class="unified-nav-item" id="navigationAbout" type="button">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('info')}</span><span>About LearnFlow</span>
      </button>
      <button class="unified-nav-item" id="navigationTheme" type="button">
        <span class="unified-nav-icon" id="navigationThemeIcon" aria-hidden="true">${currentThemeIcon()}</span><span id="navigationThemeLabel">Modo oscuro</span>
      </button>
      <button class="unified-nav-item" id="navigationLogin" type="button" aria-label="Iniciar sesión">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('user')}</span><span>Iniciar Sesión</span>
      </button>
      <a class="unified-nav-item" id="navigationPortal" href="${themedAppHref('deskflow')}">
        <span class="unified-nav-icon" aria-hidden="true">${navIcon('home')}</span><span>Portal</span>
      </a>
    </footer>
  `;

  document.body.append(backdrop, navigation, trigger);
  updateNavigationMode(navigationMode());

  const modeToggle = document.getElementById('navigationModeToggle');
  const themeButton = document.getElementById('navigationTheme');
  const themeIcon = document.getElementById('navigationThemeIcon');
  const themeLabel = document.getElementById('navigationThemeLabel');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  themeLabel.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
  themeButton.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  const platformLinks = [
    ['navigationPortal', 'deskflow'],
  ];

  trigger.addEventListener('click', () => setNavigationOpen(true));
  backdrop.addEventListener('click', () => setNavigationOpen(false, true));
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
    showAboutLearnFlow(aboutEvent);
  });
  lpLogin.bindNavButton('#navigationLogin', {
    beforeOpen: () => setNavigationOpen(false),
    labelSelector: 'span:last-child',
  });
  themeButton.addEventListener('click', () => {
    toggleTheme(themeIcon);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeLabel.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
    themeButton.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  });
  platformLinks.forEach(([id, app]) => {
    document.getElementById(id).addEventListener('click', linkEvent => {
      linkEvent.currentTarget.href = themedAppHref(app);
      setNavigationOpen(false);
    });
  });
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

function bindPlayerEvents(song) {
  const controller = new AbortController();
  const { signal } = controller;
  state.playerCleanup = () => {
    controller.abort();
    state.listenTracker?.destroy();
    state.listenTracker = null;
  };

  document.getElementById('playBtn').addEventListener('click', togglePlay, { signal });
  document.getElementById('toggleTransBtn').addEventListener('click', toggleTranslation, { signal });
  document.getElementById('toggleSelectBtn').addEventListener('click', toggleSelectMode, { signal });
  document.getElementById('toggleTheaterBtn')?.addEventListener('click', toggleTheaterMode, { signal });
  document.getElementById('speedBtn').addEventListener('click', cycleSpeed, { signal });
  document.getElementById('loopBtn').addEventListener('click', onLoopClick, { signal });
  document.getElementById('shortcutsBtnToolbar')?.addEventListener('click', toggleShortcutsPanel, { signal });
  document.getElementById('volumeBtn').addEventListener('click', toggleMute, { signal });
  document.getElementById('volumeSlider').addEventListener('input', onVolumeChange, { signal });

  const progressBar = document.getElementById('progressBar');
  progressBar.addEventListener('mousedown', onProgressDown, { signal });
  progressBar.addEventListener('touchstart', onProgressTouchStart, { passive: true, signal });
  window.addEventListener('mousemove', onProgressMove, { signal });
  window.addEventListener('mouseup', onProgressUp, { signal });
  window.addEventListener('touchmove', onProgressTouchMove, { passive: false, signal });
  window.addEventListener('touchend', onProgressTouchEnd, { signal });
  bindLoopRegionDrag(signal);
  document.addEventListener('keydown', onKeydown, { signal });
}

// ─── Audio ─────────────────────────────────────────────────────────────────────

function initAudio(song) {
  const mediaPath = `${song.folder}/${song.file}`;
  state.audio = new Audio(mediaPath);
  state.audio.preload = 'metadata';
  state.audio.playbackRate = state.playbackRate;
  const eligibleRange = song.eligibleRange || {};
  state.listenTracker = createListenTracker({
    contentId: song.id,
    title: song.title,
    eligibleStartSec: Number.isFinite(eligibleRange.start) ? eligibleRange.start : 0,
    eligibleEndSec: Number.isFinite(eligibleRange.end) ? eligibleRange.end : null,
    onProgress: () => updateSongProgressUi(song.id),
  });

  state.audio.addEventListener('error', () => {
    console.warn(`[Cancion] Audio failed to load: ${mediaPath}`);
    document.getElementById('durationTime').textContent = '—:——';
    // Show error message in subtitle container with retry
    const container = document.getElementById('subContainer');
    if (container) {
      container.innerHTML = `
        <div class="audio-error">
          <p class="audio-error-icon">⚠️</p>
          <p class="audio-error-msg">No se pudo cargar el audio</p>
          <p class="audio-error-path">${song.file}</p>
          <button class="audio-error-retry" id="audioRetryBtn">Reintentar</button>
        </div>
      `;
      document.getElementById('audioRetryBtn')?.addEventListener('click', () => {
        loadSong(song);
      });
    }
  });

  state.audio.addEventListener('loadedmetadata', () => {
    document.getElementById('durationTime').textContent = formatTime(state.audio.duration);
  });

  state.audio.addEventListener('playing', () => {
    state.listenTracker?.play(state.audio.currentTime, state.audio.duration);
  });
  state.audio.addEventListener('pause', () => {
    state.listenTracker?.pause(state.audio.currentTime, state.audio.duration);
  });
  state.audio.addEventListener('seeking', () => state.listenTracker?.seeking());
  state.audio.addEventListener('seeked', () => {
    state.listenTracker?.seeked(state.audio.currentTime, state.audio.duration);
  });

  state.audio.addEventListener('ended', () => {
    state.listenTracker?.pause(state.audio.currentTime, state.audio.duration);
    // Mark listen activity as completed when song reaches the end
    markListenCompleted({ contentId: song.id, title: song.title });
    updateSongProgressUi(song.id);
    setPlayButtonState(false);
    stopUpdateLoop();
    document.getElementById('progressFill').style.width = '100%';
    state.cachedSubLines.forEach(el => el.classList.remove('active', 'past'));
    document.querySelector('.artwork')?.classList.remove('playing');
    state.currentSubIndex = -1;
    showSongEnd();
  });

  state.audio.addEventListener('timeupdate', () => {
    if (!state.isDragging) updateProgress();
  });
}

function setPlayButtonState(isPlaying) {
  const playBtn = document.getElementById('playBtn');
  if (!playBtn) return;
  playBtn.classList.toggle('is-playing', isPlaying);
  playBtn.setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
}

function playAudio() {
  if (!state.audio) return;
  // Block play while difficulty picker is open
  if (document.getElementById('difficultyPicker')) return;
  state.audio.play().catch(() => {});
  setPlayButtonState(true);
  if (state.listeningMode) state.listeningStarted = true;
  startUpdateLoop();
  document.querySelector('.artwork')?.classList.add('playing');
  // Hide fin actions if visible (replaying after song ended)
  document.getElementById('songFinActions')?.classList.add('hidden');
}

function pauseAudio() {
  if (!state.audio) return;
  state.audio.pause();
  setPlayButtonState(false);
  stopUpdateLoop();
  document.querySelector('.artwork')?.classList.remove('playing');
}

function togglePlay() {
  if (!state.audio) return;
  // Block play while difficulty picker is open
  if (document.getElementById('difficultyPicker')) return;

  // In listening mode: don't resume while waiting for blank input (timer already running)
  if (state.listeningMode && state.listeningWaiting && state.audio.paused && state.listeningCurrentBlank?.classList.contains('lc-active')) {
    state.listeningCurrentBlank.focus();
    return;
  }

  if (state.audio.paused) playAudio(); else pauseAudio();
}

// ─── Speed Control ─────────────────────────────────────────────────────────────

function cycleSpeed() {
  const currentIdx = SPEED_OPTIONS.indexOf(state.playbackRate);
  const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
  state.playbackRate = SPEED_OPTIONS[nextIdx];
  if (state.audio) state.audio.playbackRate = state.playbackRate;
  const btn = document.getElementById('speedBtn');
  btn.textContent = state.playbackRate === 1 ? '1×' : `${state.playbackRate}×`;
  btn.classList.toggle('active', state.playbackRate !== 1);
  savePrefs({ speed: state.playbackRate });
}

// ─── A-B Loop ──────────────────────────────────────────────────────────────────

function disableLoopBtn() {
  const btn = document.getElementById('loopBtn');
  if (!btn) return;
  // Reset any active/partial loop
  state.loopA = null;
  state.loopB = null;
  state.loopActive = false;
  btn.classList.remove('active', 'setting');
  btn.textContent = '⟳';
  btn.disabled = true;
  const indicator = document.getElementById('loopIndicator');
  if (indicator) indicator.textContent = '';
  updateLoopRegion();
}

function enableLoopBtn() {
  const btn = document.getElementById('loopBtn');
  if (btn) btn.disabled = false;
}

function onLoopClick() {
  const btn = document.getElementById('loopBtn');
  const indicator = document.getElementById('loopIndicator');

  if (state.loopA === null) {
    // Set point A
    state.loopA = state.audio ? state.audio.currentTime : 0;
    btn.classList.add('setting');
    btn.textContent = 'A→';
    indicator.textContent = `A: ${formatTime(state.loopA)}`;
  } else if (state.loopB === null) {
    // Attempting to set B
    const currentTime = state.audio ? state.audio.currentTime : 0;
    if (currentTime <= state.loopA) {
      // Cancel: position is at or before A
      state.loopA = null;
      btn.classList.remove('setting');
      btn.textContent = '⟳';
      indicator.textContent = 'Cancelado';
      setTimeout(() => { if (!state.loopActive) indicator.textContent = ''; }, 1500);
      return;
    }
    state.loopB = currentTime;
    state.loopActive = true;
    btn.classList.remove('setting');
    btn.classList.add('active');
    btn.textContent = '⟳';
    indicator.textContent = `${formatTime(state.loopA)} → ${formatTime(state.loopB)}`;
    updateLoopRegion();
    if (state.audio) state.audio.currentTime = state.loopA;
  } else {
    // Clear loop
    state.loopA = null;
    state.loopB = null;
    state.loopActive = false;
    btn.classList.remove('active', 'setting');
    btn.textContent = '⟳';
    indicator.textContent = '';
    updateLoopRegion();
  }
}

function updateLoopRegion() {
  const region = document.getElementById('loopRegion');
  if (!region) return;
  if (state.loopActive && state.loopA !== null && state.loopB !== null && state.audio && state.audio.duration) {
    const leftPct = (state.loopA / state.audio.duration) * 100;
    const widthPct = ((state.loopB - state.loopA) / state.audio.duration) * 100;
    region.style.left = `${leftPct}%`;
    region.style.width = `${widthPct}%`;
    region.style.display = 'block';
  } else {
    region.style.display = 'none';
  }
}

// ─── Loop Region Drag ──────────────────────────────────────────────────────────

let loopDragging = false;
let loopDragStartX = 0;
let loopDragStartA = 0;
let loopDragStartB = 0;

function onLoopRegionDown(e) {
  if (!state.loopActive || !state.audio || !state.audio.duration) return;
  e.stopPropagation();
  loopDragging = true;
  loopDragStartX = e.clientX ?? e.touches[0].clientX;
  loopDragStartA = state.loopA;
  loopDragStartB = state.loopB;
}

function onLoopRegionMove(e) {
  if (!loopDragging) return;
  e.preventDefault();
  const clientX = e.clientX ?? e.touches[0].clientX;
  const bar = document.getElementById('progressBar');
  const barWidth = bar.getBoundingClientRect().width;
  const dx = clientX - loopDragStartX;
  const dt = (dx / barWidth) * state.audio.duration;
  const duration = loopDragStartB - loopDragStartA;

  let newA = loopDragStartA + dt;
  let newB = newA + duration;

  // Clamp to bounds
  if (newA < 0) { newA = 0; newB = duration; }
  if (newB > state.audio.duration) { newB = state.audio.duration; newA = newB - duration; }

  state.loopA = newA;
  state.loopB = newB;
  updateLoopRegion();
  document.getElementById('loopIndicator').textContent = `${formatTime(state.loopA)} → ${formatTime(state.loopB)}`;
  if (state.audio.currentTime < state.loopA || state.audio.currentTime > state.loopB) {
    state.audio.currentTime = state.loopA;
  }
}

function onLoopRegionUp() {
  loopDragging = false;
}

function bindLoopRegionDrag(signal) {
  const region = document.getElementById('loopRegion');
  if (!region) return;
  region.addEventListener('mousedown', onLoopRegionDown, { signal });
  region.addEventListener('touchstart', (e) => { onLoopRegionDown(e); }, { passive: false, signal });
  window.addEventListener('mousemove', onLoopRegionMove, { signal });
  window.addEventListener('touchmove', onLoopRegionMove, { passive: false, signal });
  window.addEventListener('mouseup', onLoopRegionUp, { signal });
  window.addEventListener('touchend', onLoopRegionUp, { signal });
}

// ─── Progress ──────────────────────────────────────────────────────────────────

function updateProgress() {
  if (!state.audio || state.isDragging) return;
  const current = state.audio.currentTime;
  const duration = state.audio.duration || 0;
  state.listenTracker?.sample(current, duration);

  // A-B loop enforcement (in rAF for higher precision than timeupdate)
  if (state.loopActive && state.loopA !== null && state.loopB !== null && current >= state.loopB) {
    state.audio.currentTime = state.loopA;
    return; // skip rest this frame, next frame will pick up from state.loopA
  }

  const percent = duration > 0 ? (current / duration) * 100 : 0;
  document.getElementById('progressFill').style.width = `${Math.min(percent, 100)}%`;
  document.getElementById('currentTime').textContent = formatTime(current);
  updateSubtitles(current);

  // Update ARIA on progress bar
  const bar = document.getElementById('progressBar');
  if (bar) {
    bar.setAttribute('aria-valuenow', Math.round(percent));
    bar.setAttribute('aria-valuetext', formatTime(current));
  }

  // Fire scheduled listening pause (after line finishes playing)
  if (state.listeningMode && state.listeningPauseAt !== null && current >= state.listeningPauseAt) {
    // If already answered (user typed fast before line ended), skip pause
    if (state.listeningCurrentBlank && !state.listeningCurrentBlank.classList.contains('lc-correct') && !state.listeningCurrentBlank.classList.contains('lc-wrong') && !state.listeningCurrentBlank.classList.contains('lc-timeout')) {
      if (state.listeningRepeatCount === 0) {
        // First play done — replay the line once more
        state.listeningRepeatCount = 1;
        state.audio.currentTime = state.listeningLineStart;
        // Re-schedule pause at end of this same line
        // state.listeningPauseAt stays the same value (recalculated from same endpoint)
      } else {
        // Second play done — now pause and start timer
        state.listeningPauseAt = null;
        state.audio.pause();
        setPlayButtonState(false);
        // Ensure line stays visually active
        const blankLine = state.listeningCurrentBlank.closest('.sub-line');
        if (blankLine) {
          state.cachedSubLines.forEach(el => el.classList.remove('active', 'past'));
          blankLine.classList.add('active');
        }
        // NOW activate the input visually and start timer
        state.listeningCurrentBlank.classList.add('lc-active');
        state.listeningCurrentBlank.focus();
        startListeningTimer(state.listeningCurrentBlank);
      }
    } else {
      state.listeningPauseAt = null;
    }
  }
}

function startUpdateLoop() {
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  (function loop() {
    if (state.audio && !state.audio.paused) updateProgress();
    state.animationFrame = requestAnimationFrame(loop);
  })();
}

export function stopUpdateLoop() {
  if (state.animationFrame) { cancelAnimationFrame(state.animationFrame); state.animationFrame = null; }
}

function seekTo(clientX) {
  const bar = document.getElementById('progressBar');
  const rect = bar.getBoundingClientRect();
  const x = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  if (state.audio && state.audio.duration) {
    state.audio.currentTime = x * state.audio.duration;
    document.getElementById('progressFill').style.width = `${x * 100}%`;
    document.getElementById('currentTime').textContent = formatTime(state.audio.currentTime);
    updateSubtitles(state.audio.currentTime);
  }
}

function onProgressDown(e)       { if (!state.audio || loopDragging) return; state.isDragging = true; seekTo(e.clientX); }
function onProgressMove(e)        { if (state.isDragging && !loopDragging) seekTo(e.clientX); }
function onProgressUp()           { if (state.isDragging) { state.isDragging = false; if (state.audio) updateProgress(); } }
function onProgressTouchStart(e)  { if (!state.audio || loopDragging) return; state.isDragging = true; seekTo(e.touches[0].clientX); }
function onProgressTouchMove(e)   { if (state.isDragging && !loopDragging) { e.preventDefault(); seekTo(e.touches[0].clientX); } }
function onProgressTouchEnd()     { if (state.isDragging) { state.isDragging = false; if (state.audio) updateProgress(); } }

// ─── Subtitles ─────────────────────────────────────────────────────────────────

function scrollLyricIntoView(target) {
  const container = document.getElementById('subContainer');
  if (!container || !target) return;
  const pad = window.matchMedia('(max-width: 580px)').matches ? 20 : 12;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const deltaTop = targetRect.top - containerRect.top;
  const deltaBottom = targetRect.bottom - containerRect.bottom;

  if (deltaTop < pad) {
    container.scrollBy({ top: deltaTop - pad, behavior: 'smooth' });
  } else if (deltaBottom > -pad) {
    container.scrollBy({ top: deltaBottom + pad, behavior: 'smooth' });
  }
}

function renderSubtitles(subtitles) {
  const container = document.getElementById('subContainer');
  container.innerHTML = '';

  // Remove any existing word tooltip
  const oldTip = document.getElementById('wordTooltip');
  if (oldTip) oldTip.remove();

  subtitles.forEach((sub, i) => {
    const line = document.createElement('div');
    line.className = 'sub-line';
    line.dataset.index = i;
    line.style.animationDelay = `${0.3 + i * 0.018}s`;

    let originalHtml;
    if (state.blanksMode) {
      originalHtml = renderBlanksLine(sub.original, i);
    } else if (state.listeningMode) {
      originalHtml = renderListeningLine(sub.original, i);
    } else {
      // Split original into clickable words
      originalHtml = sub.original.replace(/(\S+)/g, (match) => {
        const parts = match.split(/([''])/);
        return parts.map(part => {
          if (part === "'" || part === "\u2019") return part;
          const clean = part.toLowerCase().replace(/[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()]/g, '');
          if (!clean) return part;
          return `<span class="word-tap" data-word="${clean}" data-line="${i}">${part}</span>`;
        }).join('');
      });
    }

    line.innerHTML = `
      <span class="sub-index">${i}</span>
      <div class="sub-text">
        <div class="original">${originalHtml}</div>
        <div class="translation">${sub.translation}</div>
      </div>
    `;

    // Single click: seek to line
    line.addEventListener('click', (e) => {
      if (state.selectMode) return;
      if (e.target.closest('.word-tap')) return;
      if (e.target.closest('.blank-input')) return;
      if (e.target.closest('.listening-input')) return;
      if (state.listeningMode) return;

      // In blanks mode, focus the first empty input (or first input) on the clicked line
      if (state.blanksMode) {
        const inputs = line.querySelectorAll('.blank-input');
        if (inputs.length) {
          const firstEmpty = [...inputs].find(inp => !inp.value.trim()) || inputs[0];
          firstEmpty.focus();
        }
      }

      if (!state.audio) return;
      const offset = state.currentSong.offset || 0;
      state.audio.currentTime = sub.start + offset;
      if (state.audio.paused) playAudio();
    });

    // Double click: loop this line
    line.addEventListener('dblclick', (e) => {
      if (state.selectMode || state.listeningMode || state.blanksMode) return;
      if (e.target.closest('.word-tap')) return;
      if (!state.audio) return;
      const offset = state.currentSong.offset || 0;
      state.loopA = sub.start + offset;
      state.loopB = state.loopA + sub.duration;
      state.loopActive = true;
      const loopBtn = document.getElementById('loopBtn');
      if (loopBtn) {
        loopBtn.classList.remove('setting');
        loopBtn.classList.add('active');
        loopBtn.textContent = '⟳';
      }
      const indicator = document.getElementById('loopIndicator');
      if (indicator) indicator.textContent = `${formatTime(state.loopA)} → ${formatTime(state.loopB)}`;
      updateLoopRegion();
      state.audio.currentTime = state.loopA;
      if (state.audio.paused) playAudio();
    });

    container.appendChild(line);
  });

  const tail = document.createElement('div');
  tail.className = 'sub-scroll-end';
  tail.setAttribute('aria-hidden', 'true');
  container.appendChild(tail);

  // Cache nodeList for perf (avoid querySelectorAll every frame)
  state.cachedSubLines = [...container.querySelectorAll('.sub-line')];

  // Delegate word tap events
  container.addEventListener('click', onWordTap);
}

// ─── Difficulty Picker (shared) ─────────────────────────────────────────────────

function showDifficultyPicker(mode, onSelect) {
  // Remove existing picker
  const existing = document.getElementById('difficultyPicker');
  if (existing) existing.remove();

  const labels = { easy: 'Fácil', normal: 'Normal', hard: 'Desafío' };
  const descriptions = {
    easy: 'Solo vocabulario clave',
    normal: 'Vocabulario + contexto',
    hard: 'Intensivo, muchas palabras',
  };
  const icons = { easy: '🌱', normal: '🎯', hard: '🔥' };
  const currentDiff = mode === 'blanks' ? state.blanksDifficulty : state.listeningDifficulty;

  const picker = document.createElement('div');
  picker.id = 'difficultyPicker';
  picker.className = 'difficulty-picker';
  picker.dataset.mode = mode;
  picker.innerHTML = `
    <div class="dp-options">
      ${Object.keys(DIFFICULTY).map(key => `
        <button class="dp-option ${key === currentDiff ? 'dp-selected' : ''}" data-diff="${key}">
          <span class="dp-icon">${icons[key]}</span>
          <span class="dp-label">${labels[key]}</span>
          <span class="dp-desc">${descriptions[key]}</span>
        </button>
      `).join('')}
    </div>
  `;

  const container = document.getElementById('subContainer');
  container.parentNode.insertBefore(picker, container);

  // Bind events
  picker.querySelectorAll('.dp-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const diff = btn.dataset.diff;
      picker.remove();
      document.removeEventListener('keydown', onPickerEsc);
      onSelect(diff);
    });
  });

  // Escape to close
  const onPickerEsc = (e) => {
    if (e.key === 'Escape' && document.getElementById('difficultyPicker')) {
      picker.remove();
      document.removeEventListener('keydown', onPickerEsc);
      // Re-enable loop if mode was not activated (picker dismissed)
      if (!state.blanksMode && !state.listeningMode) enableLoopBtn();
    }
  };
  document.addEventListener('keydown', onPickerEsc);
}

// ─── Return to Player (deactivate any active in-place mode) ────────────────────

function returnToPlayer() {
  // Close difficulty picker if open
  const picker = document.getElementById('difficultyPicker');
  if (picker) picker.remove();

  if (state.blanksMode) {
    toggleBlanksMode(); // deactivates blanks
  } else if (state.listeningMode) {
    toggleListeningMode(); // deactivates listening
  } else {
    // Picker was open but mode not yet activated
    enableLoopBtn();
  }
}

// ─── Fill-in-the-Blanks ────────────────────────────────────────────────────────

function toggleBlanksMode() {
  // If the picker is already open for this mode, ignore repeated clicks
  const openPicker = document.getElementById('difficultyPicker');
  if (openPicker && openPicker.dataset.mode === 'blanks') {
    return;
  }

  // If active → deactivate
  if (state.blanksMode) {
    state.blanksMode = false;
    document.getElementById('toggleBlanksBtn').classList.remove('active');
    document.getElementById('togglePlayerBtn')?.classList.add('active');
    enableLoopBtn();
    renderSubtitles(state.currentSong.subtitles);
    const toolbar = document.getElementById('blanksToolbar');
    if (toolbar) toolbar.remove();
    const picker = document.getElementById('difficultyPicker');
    if (picker) picker.remove();
    return;
  }

  // Show difficulty picker
  disableLoopBtn();
  showDifficultyPicker('blanks', (diff) => {
    state.blanksDifficulty = diff;
    state.blanksMode = true;
    const btn = document.getElementById('toggleBlanksBtn');
    btn.classList.add('active');
    document.getElementById('togglePlayerBtn')?.classList.remove('active');

    // Deactivate listening mode if active
    if (state.listeningMode) {
      state.listeningMode = false;
      state.listeningStarted = false;
      document.getElementById('toggleListeningBtn').classList.remove('active');
      clearListeningTimer();
      state.listeningWaiting = false;
      state.listeningCurrentBlank = null;
      updateListeningToolbar();
    }

    state.blanksAnswers = {};
    state.challengeRunId = createRunId('challenge');
    blanksRevealed = false;
    if (state.showTranslation) toggleTranslation();

    state.blanksBlanksMap = buildBlanksMap();
    renderSubtitles(state.currentSong.subtitles);

    // Reset scroll to top
    const subContainer = document.getElementById('subContainer');
    if (subContainer) subContainer.scrollTop = 0;

    // Add blanks toolbar
    const existing = document.getElementById('blanksToolbar');
    if (existing) existing.remove();

    const toolbar = document.createElement('div');
    toolbar.id = 'blanksToolbar';
    toolbar.className = 'blanks-toolbar';
    toolbar.innerHTML = `
      <button class="blanks-check-btn" id="blanksCheckBtn">✓ Verificar</button>
      <button class="blanks-reveal-btn" id="blanksRevealBtn">👁 Revelar</button>
      <span class="blanks-progress" id="blanksProgress"></span>
      <span class="blanks-score" id="blanksScore"></span>
    `;
    const container = document.getElementById('subContainer');
    container.parentNode.insertBefore(toolbar, container);
    document.getElementById('blanksCheckBtn').addEventListener('click', checkBlanks);
    document.getElementById('blanksRevealBtn').addEventListener('click', revealBlanks);
    updateBlanksProgress();
  });
}

function renderBlanksLine(text, lineIndex) {
  const STRIP = /[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g;
  const tokens = text.split(/(\s+)/);
  const blankSet = state.blanksBlanksMap[lineIndex];

  // No blanks planned for this line — render all visible
  if (!blankSet || blankSet.size === 0) {
    return tokens.map(token => {
      if (/^\s+$/.test(token)) return token;
      return `<span class="blanks-visible">${token}</span>`;
    }).join('');
  }

  // Render with blanks at pre-computed positions
  let wordIdx = 0;
  return tokens.map(token => {
    if (/^\s+$/.test(token)) return token;
    const clean = token.toLowerCase().replace(STRIP, '');
    const idx = wordIdx++;

    if (!blankSet.has(idx)) return `<span class="blanks-visible">${token}</span>`;

    const key = `${lineIndex}-${idx}`;
    const answered = state.blanksAnswers[key] || '';
    return `<span class="blank-wrapper" data-key="${key}">
      <input class="blank-input"
        type="text"
        data-key="${key}"
        data-answer="${clean}"
        data-original="${token}"
        style="width:${Math.max(clean.length, 3) + 2}ch"
        maxlength="${clean.length + 5}"
        value="${answered}"
        placeholder="${'·'.repeat(clean.length)}"
        autocomplete="off"
        spellcheck="false" />
    </span>`;
  }).join('');
}

// ─── Blanks Map Builder (pedagogically-driven word selection) ───────────────────
// Pre-computes which words to blank across the entire song, respecting:
// 1. Global cap (adjusted by CEFR level)
// 2. Vocab words have massive score priority
// 3. Per-line max to avoid overwhelming any single line
// 4. Spread across the song (not clustered at the top)

function buildBlanksMap() {
  const STRIP = /[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g;
  const subs = state.currentSong.subtitles;
  const diff = DIFFICULTY[state.blanksDifficulty];

  // Adjust cap by CEFR level
  const level = state.currentSong.level || 'B1';
  const factor = LEVEL_FACTOR[level] ?? 1.0;
  const totalCap = Math.round(diff.totalCap * factor);

  // Build vocab word set with their line positions for extra precision
  const vocabWords = new Set();
  if (state.vocabData && state.vocabData.length) {
    state.vocabData.forEach(v => vocabWords.add(v.word.toLowerCase()));
  }

  // Pass 1: collect ALL candidates across the song with scores
  const allCandidates = [];
  subs.forEach((sub, lineIndex) => {
    const tokens = sub.original.split(/(\s+)/);
    const rng = seededRandom(lineIndex * 31 + 7);
    let wordIdx = 0;

    tokens.forEach(token => {
      if (/^\s+$/.test(token)) return;
      const clean = token.toLowerCase().replace(STRIP, '');
      if (!clean || clean.length <= diff.minWordLen || STOP_WORDS.has(clean)) { wordIdx++; return; }

      const inVocab = vocabWords.has(clean);
      // Score: vocab words get huge boost; then word length; small random jitter for variety
      const score = (inVocab ? diff.vocabBoost : 0) + clean.length * 2 + rng() * 3;
      allCandidates.push({ lineIndex, wordIdx, clean, score, isVocab: inVocab });
      wordIdx++;
    });
  });

  // Pass 2: sort by score (vocab first, then longest/most interesting)
  allCandidates.sort((a, b) => b.score - a.score);

  const map = {};
  for (const c of pickBlankCandidates(allCandidates, totalCap, diff.maxPerLine)) {
    if (!map[c.lineIndex]) map[c.lineIndex] = new Set();
    map[c.lineIndex].add(c.wordIdx);
  }

  return map;
}

function validateSingleBlank(input) {
  const answer = normalizeForCompare(input.dataset.answer);
  const original = input.dataset.original;
  const value = normalizeForCompare(input.value);
  const valueTrimmed = input.value.trim().toLowerCase();
  const wrapper = input.closest('.blank-wrapper');

  state.blanksAnswers[input.dataset.key] = input.value.trim();

  input.classList.remove('blank-correct', 'blank-wrong', 'blank-accent');
  wrapper.classList.remove('blank-correct', 'blank-wrong', 'blank-accent');
  wrapper.removeAttribute('data-hint');
  wrapper.removeAttribute('data-correction');

  if (!value) return;

  if (valueTrimmed === input.dataset.answer) {
    input.classList.add('blank-correct');
    wrapper.classList.add('blank-correct');
  } else if (value === answer) {
    input.classList.add('blank-accent');
    wrapper.classList.add('blank-accent');
    wrapper.dataset.hint = original.replace(/[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g, '');
  } else {
    input.classList.add('blank-wrong');
    wrapper.classList.add('blank-wrong');
    wrapper.dataset.correction = original.replace(/[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g, '');
  }
}

function focusNextBlank(current) {
  const allBlanks = [...document.querySelectorAll('.blank-input')];
  const idx = allBlanks.indexOf(current);
  // Find next blank that is empty or wrong
  for (let i = idx + 1; i < allBlanks.length; i++) {
    if (!allBlanks[i].classList.contains('blank-correct') && !allBlanks[i].classList.contains('blank-accent')) {
      allBlanks[i].focus();
      allBlanks[i].select();
      return;
    }
  }
  // Wrap around from the beginning
  for (let i = 0; i < idx; i++) {
    if (!allBlanks[i].classList.contains('blank-correct') && !allBlanks[i].classList.contains('blank-accent')) {
      allBlanks[i].focus();
      allBlanks[i].select();
      return;
    }
  }
}

function checkBlanks() {
  const inputs = document.querySelectorAll('.blank-input');
  let correct = 0;
  let total = 0;

  inputs.forEach(input => {
    const original = input.dataset.original;
    const value = normalizeForCompare(input.value);
    const valueTrimmed = input.value.trim().toLowerCase();
    const wrapper = input.closest('.blank-wrapper');

    state.blanksAnswers[input.dataset.key] = input.value.trim();

    input.classList.remove('blank-correct', 'blank-wrong', 'blank-accent');
    wrapper.classList.remove('blank-correct', 'blank-wrong', 'blank-accent');
    wrapper.removeAttribute('data-hint');
    wrapper.removeAttribute('data-correction');

    if (!value) {
      // Empty — skip validation, don't count toward score
      return;
    }

    total++;
    const answer = normalizeForCompare(input.dataset.answer);

    if (valueTrimmed === input.dataset.answer) {
      // Exact match including accents
      input.classList.add('blank-correct');
      wrapper.classList.add('blank-correct');
      correct++;
    } else if (value === answer) {
      // Normalized match — accepted but show accented form
      input.classList.add('blank-accent');
      wrapper.classList.add('blank-accent');
      wrapper.dataset.hint = original.replace(/[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g, '');
      correct++;
    } else {
      // Wrong answer — show correction
      input.classList.add('blank-wrong');
      wrapper.classList.add('blank-wrong');
      wrapper.dataset.correction = original.replace(/[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g, '');
    }
  });

  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Show score
  const scoreEl = document.getElementById('blanksScore');
  if (scoreEl) {
    scoreEl.textContent = `${correct}/${total} (${pct}%)`;
    scoreEl.classList.toggle('score-good', pct >= 80);
    scoreEl.classList.toggle('score-mid', pct >= 50 && pct < 80);
    scoreEl.classList.toggle('score-low', pct < 50);
  }

  recordActivityResult({
    contentId: state.currentSong.id,
    title: state.currentSong.title,
    activity: 'challenge',
    scorePct: pct,
    correct,
    total,
    runId: state.challengeRunId,
  });
  state.challengeRunId = createRunId('challenge');
  updateSongProgressUi(state.currentSong.id);
  updateBlanksProgress();
}

function updateBlanksProgress() {
  const el = document.getElementById('blanksProgress');
  if (!el) return;
  const inputs = document.querySelectorAll('.blank-input');
  const total = inputs.length;
  const answered = [...inputs].filter(i => i.value.trim() !== '').length;
  el.textContent = `${answered}/${total} palabras`;
}

let blanksRevealed = false;

function revealBlanks() {
  const btn = document.getElementById('blanksRevealBtn');

  if (blanksRevealed) {
    // Hide again — restore user answers
    blanksRevealed = false;
    btn.textContent = '👁 Revelar';
    const inputs = document.querySelectorAll('.blank-input');
    inputs.forEach(input => {
      const key = input.dataset.key;
      const saved = state.blanksAnswers[key] || '';
      const wrapper = input.closest('.blank-wrapper');
      input.value = saved;
      input.classList.remove('blank-revealed', 'blank-correct', 'blank-wrong', 'blank-accent');
      wrapper.classList.remove('blank-revealed', 'blank-correct', 'blank-wrong', 'blank-accent');
      wrapper.removeAttribute('data-hint');
      wrapper.removeAttribute('data-correction');
      input.readOnly = false;
    });
    document.getElementById('blanksScore').textContent = '';
    return;
  }

  // Reveal answers
  blanksRevealed = true;
  btn.textContent = '🙈 Ocultar';
  const inputs = document.querySelectorAll('.blank-input');
  inputs.forEach(input => {
    const answer = input.dataset.answer;
    const original = input.dataset.original;
    const wrapper = input.closest('.blank-wrapper');

    // Save current user value before overwriting
    state.blanksAnswers[input.dataset.key] = input.value.trim();

    input.classList.remove('blank-wrong');
    wrapper.classList.remove('blank-wrong');

    if (input.value.trim().toLowerCase() !== answer) {
      input.value = original;
      input.classList.add('blank-revealed');
      wrapper.classList.add('blank-revealed');
    } else {
      input.classList.add('blank-correct');
      wrapper.classList.add('blank-correct');
    }
    input.readOnly = true;
  });
}

function onBlankInput(e) {
  const input = e.target.closest('.blank-input');
  if (!input) return;
  // Just save the value, no auto-correction
  state.blanksAnswers[input.dataset.key] = input.value.trim();
  updateBlanksProgress();
}

function onWordTap(e) {
  // Handle blank inputs
  if (e.target.closest('.blank-input')) {
    onBlankInput(e);
    return;
  }

  const wordEl = e.target.closest('.word-tap');
  if (!wordEl || state.selectMode) return;
  e.stopPropagation();

  const word = wordEl.dataset.word;
  if (!word) return;

  let translation = '';
  if (state.vocabData) {
    const entry = state.vocabData.find(v => v.word === word);
    if (entry && entry.translation) {
      translation = entry.translation;
    }
  }

  if (!translation) return; // No tooltip for words without vocab entry

  showWordTooltip(wordEl, word, translation);
}

// Tooltip cleanup controller (single active tooltip at a time)
let tooltipCleanup = null;

function showWordTooltip(anchor, word, translation) {
  // Clean up previous tooltip and its listeners
  if (tooltipCleanup) { tooltipCleanup(); tooltipCleanup = null; }

  let tip = document.getElementById('wordTooltip');
  if (tip) tip.remove();

  tip = document.createElement('div');
  tip.id = 'wordTooltip';
  tip.className = 'word-tooltip';
  tip.innerHTML = `
    <span class="wt-word">${word}</span>
    <span class="wt-trans">${translation}</span>
  `;
  document.body.appendChild(tip);

  const anchorRect = anchor.getBoundingClientRect();
  const tipWidth = tip.offsetWidth;
  const tipHeight = tip.offsetHeight;
  const wordCenter = anchorRect.left + anchorRect.width / 2;

  // Clamp tooltip so it stays on screen
  const minLeft = tipWidth / 2 + 8;
  const maxLeft = window.innerWidth - tipWidth / 2 - 8;
  const left = Math.max(minLeft, Math.min(wordCenter, maxLeft));

  // Arrow offset: how far from tooltip center the arrow should shift
  const arrowOffset = wordCenter - left;
  tip.style.setProperty('--wt-arrow', `${arrowOffset}px`);

  // Position below the word
  let top = anchorRect.bottom + 6;
  if (top + tipHeight > window.innerHeight - 8) {
    top = anchorRect.top - tipHeight - 6;
    tip.classList.add('wt-above');
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;

  // Single cleanup function that handles all timers and listeners
  let fadeTimer = null;
  let removeTimer = null;
  const controller = new AbortController();

  const cleanup = () => {
    if (fadeTimer) clearTimeout(fadeTimer);
    if (removeTimer) clearTimeout(removeTimer);
    controller.abort();
    if (tip.parentNode) tip.remove();
  };

  tooltipCleanup = cleanup;

  // Auto-dismiss after 2.5s
  fadeTimer = setTimeout(() => {
    if (tip.parentNode) tip.classList.add('wt-fade');
    removeTimer = setTimeout(() => { cleanup(); tooltipCleanup = null; }, 300);
  }, 2500);

  // Click anywhere to dismiss
  document.addEventListener('click', () => { cleanup(); tooltipCleanup = null; }, { once: true, capture: true, signal: controller.signal });
}

function updateSubtitles(time) {
  if (!state.currentSong) return;
  const subs = state.currentSong.subtitles;
  const offset = state.currentSong.offset || 0;
  let activeIndex = -1;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i].start + offset;
    const e = s + subs[i].duration;
    if (time >= s && time < e) { activeIndex = i; break; }
  }
  if (activeIndex === state.currentSubIndex) return;
  state.currentSubIndex = activeIndex;

  const lines = state.cachedSubLines;
  if (state.highlightEnabled) {
    for (let i = 0; i < lines.length; i++) {
      const el = lines[i];
      el.classList.remove('active', 'past');
      if (i === activeIndex) {
        el.classList.add('active');
      } else if (activeIndex !== -1 && i < activeIndex) {
        el.classList.add('past');
      }
    }

    // Debounced scroll — cancel previous pending scroll
    if (activeIndex !== -1 && lines[activeIndex]) {
      if (state.scrollRAF) cancelAnimationFrame(state.scrollRAF);
      const target = lines[activeIndex];
      state.scrollRAF = requestAnimationFrame(() => {
        scrollLyricIntoView(target);
        state.scrollRAF = null;
      });
    }
  }


  // Blanks mode: auto-focus the first empty input on the newly active line
  if (state.blanksMode && activeIndex !== -1 && lines[activeIndex]) {
    const blankInput = lines[activeIndex].querySelector('.blank-input:not(.blanks-correct)');
    if (blankInput && !blankInput.value.trim()) {
      blankInput.focus();
    }
  }

  // Announce current line to screen readers
  const srLive = document.getElementById('srLive');
  if (srLive && activeIndex !== -1) {
    srLive.textContent = state.currentSong.subtitles[activeIndex].original;
  }

  // Listening challenge: schedule pause at END of line so user hears it first
  // The blank gets focus (so user can type ahead) but NOT the timer animation until post-replay
  if (state.listeningMode && activeIndex !== -1 && !state.listeningWaiting && state.listeningPauseAt === null) {
    const line = lines[activeIndex];
    const blank = line?.querySelector('.listening-input:not(.lc-correct):not(.lc-wrong):not(.lc-timeout)');
    if (blank) {
      const sub = subs[activeIndex];
      const offset = state.currentSong.offset || 0;
      state.listeningPauseAt = sub.start + offset + sub.duration;
      state.listeningLineStart = sub.start + offset;
      state.listeningRepeatCount = 0;
      // Mark as waiting so no other blank gets scheduled
      state.listeningWaiting = true;
      state.listeningCurrentBlank = blank;
      // Focus for type-ahead but no lc-active animation yet (timer hasn't started)
      blank.focus();
    }
  }
}

function toggleTranslation() {
  state.showTranslation = !state.showTranslation;
  document.getElementById('toggleTransBtn').classList.toggle('active', state.showTranslation);
  state.cachedSubLines.forEach(el => el.classList.toggle('show-trans', state.showTranslation));
}

function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  document.getElementById('toggleSelectBtn').classList.toggle('active', state.selectMode);
  document.getElementById('subContainer').classList.toggle('select-mode', state.selectMode);
}

function toggleTheaterMode() {
  state.theaterMode = !state.theaterMode;
  document.body.classList.toggle('theater-mode', state.theaterMode);

  const btn = document.getElementById('toggleTheaterBtn');
  if (state.theaterMode) {
    btn.textContent = '⊡';
    btn.setAttribute('aria-label', 'Restaurar vista');
    btn.setAttribute('data-tooltip', 'Restaurar vista');
  } else {
    btn.textContent = '⛶';
    btn.setAttribute('aria-label', 'Modo teatro');
    btn.setAttribute('data-tooltip', 'Maximizar reproductor');
  }
}

function toggleLineNumbers() {
  state.showLineNumbers = !state.showLineNumbers;
  const container = document.getElementById('subContainer');
  if (container) container.classList.toggle('show-line-numbers', state.showLineNumbers);
}

function toggleHighlight() {
  state.highlightEnabled = !state.highlightEnabled;
  const lines = state.cachedSubLines;
  if (!state.highlightEnabled) {
    // Remove all highlight classes
    for (const el of lines) el.classList.remove('active', 'past');
  } else {
    // Restore highlight at current position
    const idx = state.currentSubIndex;
    for (let i = 0; i < lines.length; i++) {
      lines[i].classList.remove('active', 'past');
      if (i === idx) lines[i].classList.add('active');
      else if (idx !== -1 && i < idx) lines[i].classList.add('past');
    }
    // Scroll to current line
    if (idx !== -1 && lines[idx]) {
      scrollLyricIntoView(lines[idx]);
    }
  }
}

// ─── Listening Challenge Mode ──────────────────────────────────────────────────

function toggleListeningMode() {
  // If the picker is already open for this mode, ignore repeated clicks
  const openPicker = document.getElementById('difficultyPicker');
  if (openPicker && openPicker.dataset.mode === 'listening') {
    return;
  }

  // If active → deactivate
  if (state.listeningMode) {
    state.listeningMode = false;
    state.listeningStarted = false;
    document.getElementById('toggleListeningBtn').classList.remove('active');
    document.getElementById('togglePlayerBtn')?.classList.add('active');
    enableLoopBtn();
    clearListeningTimer();
    // Cancel any pending resume timeouts
    state.listeningResumeTimers.forEach(tid => clearTimeout(tid));
    state.listeningResumeTimers = [];
    state.listeningWaiting = false;
    state.listeningCurrentBlank = null;
    state.listeningPauseAt = null;
    state.listeningRepeatCount = 0;
    state.listeningLineStart = null;
    renderSubtitles(state.currentSong.subtitles);
    updateListeningToolbar();
    return;
  }

  // Show difficulty picker
  disableLoopBtn();
  showDifficultyPicker('listening', (diff) => {
    state.listeningDifficulty = diff;
    state.listeningMode = true;
    const btn = document.getElementById('toggleListeningBtn');
    btn.classList.add('active');
    document.getElementById('togglePlayerBtn')?.classList.remove('active');

    // Deactivate static blanks if active
    if (state.blanksMode) {
      state.blanksMode = false;
      document.getElementById('toggleBlanksBtn').classList.remove('active');
      const toolbar = document.getElementById('blanksToolbar');
      if (toolbar) toolbar.remove();
    }

    state.listeningScore = { correct: 0, wrong: 0 };
    state.dictationRunId = createRunId('dictation');
    state.listeningBlanksMap = buildListeningBlanks();
    if (state.showTranslation) toggleTranslation();

    // Clear any leftover resume timers from prior session
    state.listeningResumeTimers.forEach(tid => clearTimeout(tid));
    state.listeningResumeTimers = [];

    // Restart from beginning
    if (state.audio) {
      state.audio.currentTime = 0;
    }
    state.currentSubIndex = -1;
    state.listeningWaiting = false;
    state.listeningStarted = false;
    state.listeningCurrentBlank = null;
    state.listeningPauseAt = null;

    renderSubtitles(state.currentSong.subtitles);

    // Reset scroll to top
    const subContainer = document.getElementById('subContainer');
    if (subContainer) subContainer.scrollTop = 0;

    updateListeningToolbar();

    // Auto-play after setup
    playAudio();
  });
}

function buildListeningBlanks() {
  const STRIP = /[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g;
  const subs = state.currentSong.subtitles;
  const diff = DIFFICULTY[state.listeningDifficulty];

  // Adjust cap by CEFR level
  const level = state.currentSong.level || 'B1';
  const factor = LEVEL_FACTOR[level] ?? 1.0;
  const totalCap = Math.round(diff.totalCap * factor);

  // Build vocab word set
  const vocabWords = new Set();
  if (state.vocabData && state.vocabData.length) {
    state.vocabData.forEach(v => vocabWords.add(v.word.toLowerCase()));
  }

  // Collect all candidates across the song
  const allCandidates = [];
  subs.forEach((sub, lineIndex) => {
    const tokens = sub.original.split(/(\s+)/);
    const rng = seededRandom(lineIndex * 47 + 13);
    let wordIdx = 0;

    tokens.forEach(token => {
      if (/^\s+$/.test(token)) return;
      const clean = token.toLowerCase().replace(STRIP, '');
      if (!clean || clean.length <= diff.minWordLen || STOP_WORDS.has(clean)) { wordIdx++; return; }

      const inVocab = vocabWords.has(clean);
      const score = (inVocab ? diff.vocabBoost : 0) + clean.length * 2 + rng() * 3;
      allCandidates.push({ lineIndex, wordIdx, clean, original: token, score });
      wordIdx++;
    });
  });

  allCandidates.sort((a, b) => b.score - a.score);

  const map = {};
  for (const c of pickBlankCandidates(allCandidates, totalCap, diff.maxPerLine)) {
    if (!map[c.lineIndex]) map[c.lineIndex] = [];
    map[c.lineIndex].push({ wordIdx: c.wordIdx, clean: c.clean, original: c.original });
  }

  return map;
}

function renderListeningLine(text, lineIndex) {
  const blanks = state.listeningBlanksMap[lineIndex];
  if (!blanks) return text; // No blanks for this line, show as-is

  const words = text.split(/(\s+)/);
  let wordIdx = 0;
  const blankSet = new Set(blanks.map(b => b.wordIdx));
  const blankLookup = {};
  blanks.forEach(b => { blankLookup[b.wordIdx] = b; });

  return words.map(token => {
    if (/^\s+$/.test(token)) return token;
    const clean = token.toLowerCase().replace(/[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g, '');
    if (!clean || clean.length <= 1) { wordIdx++; return token; }

    const currentWordIdx = wordIdx;
    wordIdx++;

    if (blankSet.has(currentWordIdx)) {
      const b = blankLookup[currentWordIdx];
      return `<span class="lc-blank-wrapper">
        <input class="listening-input"
          type="text"
          data-line="${lineIndex}"
          data-answer="${b.clean}"
          data-original="${b.original}"
          style="width:${Math.max(b.clean.length, 3) + 2}ch"
          maxlength="${b.clean.length + 5}"
          placeholder="${'·'.repeat(b.clean.length)}"
          autocomplete="off"
          spellcheck="false" />
      </span>`;
    }
    return token;
  }).join('');
}

function updateListeningToolbar() {
  const existing = document.getElementById('listeningToolbar');
  if (existing) existing.remove();

  if (!state.listeningMode) return;

  const totalLines = Object.keys(state.listeningBlanksMap).length;
  const completedLines = countCompletedListeningLines();

  const toolbar = document.createElement('div');
  toolbar.id = 'listeningToolbar';
  toolbar.className = 'listening-toolbar';
  toolbar.innerHTML = `
    <span class="lt-badge">🎧 Dictado</span>
    <span class="lt-score" id="listeningScoreEl"><span class="lt-correct">✓ 0</span><span class="lt-wrong">✗ 0</span></span>
    <span class="lt-progress" id="listeningProgressEl">${completedLines}/${totalLines}</span>
    <span class="lt-hint">Escucha y completa — Enter para confirmar</span>
  `;
  const container = document.getElementById('subContainer');
  container.parentNode.insertBefore(toolbar, container);
}

function countCompletedListeningLines() {
  let completed = 0;
  for (const lineIdx of Object.keys(state.listeningBlanksMap)) {
    const inputs = document.querySelectorAll(`.listening-input[data-line="${lineIdx}"]`);
    if (inputs.length === 0) continue;
    const allDone = [...inputs].every(el =>
      el.classList.contains('lc-correct') || el.classList.contains('lc-wrong') || el.classList.contains('lc-timeout')
    );
    if (allDone) completed++;
  }
  return completed;
}

function updateListeningScore() {
  const el = document.getElementById('listeningScoreEl');
  if (el) {
    el.innerHTML = `<span class="lt-correct">✓ ${state.listeningScore.correct}</span><span class="lt-wrong">✗ ${state.listeningScore.wrong}</span>`;
  }
  // Update progress counter
  const progEl = document.getElementById('listeningProgressEl');
  if (progEl) {
    const totalLines = Object.keys(state.listeningBlanksMap).length;
    const completedLines = countCompletedListeningLines();
    progEl.textContent = `${completedLines}/${totalLines}`;
  }
}

function startListeningTimer(input) {
  clearListeningTimer();
  const TIMEOUT = 15; // seconds
  // Create timer bar
  let timerBar = document.getElementById('lcTimerBar');
  if (timerBar) timerBar.remove();

  timerBar = document.createElement('div');
  timerBar.id = 'lcTimerBar';
  timerBar.className = 'lc-timer-bar';
  timerBar.innerHTML = '<div class="lc-timer-fill" id="lcTimerFill"></div>';
  input.closest('.lc-blank-wrapper').appendChild(timerBar);

  let elapsed = 0;
  state.listeningTimerId = setInterval(() => {
    elapsed += 50;
    const pct = Math.min((elapsed / (TIMEOUT * 1000)) * 100, 100);
    const fill = document.getElementById('lcTimerFill');
    if (fill) fill.style.width = `${pct}%`;

    if (elapsed >= TIMEOUT * 1000) {
      // Timeout — validate what's in the field before failing
      clearListeningTimer();
      const value = normalizeForCompare(input.value);
      const answer = normalizeForCompare(input.dataset.answer);
      input.classList.remove('lc-active');

      if (value && value === answer) {
        input.classList.add('lc-correct');
        state.listeningScore.correct++;
      } else {
        state.listeningScore.wrong++;
        input.value = input.dataset.original;
        input.size = Math.max(input.dataset.original.length + 1, 4);
        input.classList.add('lc-timeout');
      }

      input.readOnly = true;
      updateListeningScore();
      resumeListeningAfterDelay();
    }
  }, 50);
}

function clearListeningTimer() {
  if (state.listeningTimerId) { clearInterval(state.listeningTimerId); state.listeningTimerId = null; }
  const bar = document.getElementById('lcTimerBar');
  if (bar) bar.remove();
}

function submitListeningAnswer() {
  if (!state.listeningWaiting || !state.listeningCurrentBlank) return;
  const input = state.listeningCurrentBlank;
  const answer = normalizeForCompare(input.dataset.answer);
  const value = normalizeForCompare(input.value);

  clearListeningTimer();
  input.classList.remove('lc-active');

  if (value === answer) {
    input.classList.add('lc-correct');
    state.listeningScore.correct++;
  } else {
    input.classList.add('lc-wrong');
    input.value = input.dataset.original;
    input.size = Math.max(input.dataset.original.length + 1, 4);
    state.listeningScore.wrong++;
  }

  input.readOnly = true;
  updateListeningScore();
  resumeListeningAfterDelay();
}

function resumeListeningAfterDelay() {
  // Save line index BEFORE clearing state
  const answeredLineIdx = state.listeningCurrentBlank?.dataset.line;
  state.listeningWaiting = false;
  state.listeningCurrentBlank = null;
  state.listeningPauseAt = null;
  state.listeningRepeatCount = 0;
  state.listeningLineStart = null;

  // Check for another blank in the SAME line (identified by data-line, not .active class)
  // Using .active would pick up the next line if its start time coincides with the pause point
  if (answeredLineIdx !== undefined) {
    const nextBlank = document.querySelector(
      `.listening-input[data-line="${answeredLineIdx}"]:not(.lc-correct):not(.lc-wrong):not(.lc-timeout)`
    );
    if (nextBlank) {
      const tid = setTimeout(() => {
        if (!state.listeningMode) return;
        state.listeningWaiting = true;
        state.listeningCurrentBlank = nextBlank;
        nextBlank.focus();
        nextBlank.classList.add('lc-active');
        startListeningTimer(nextBlank);
      }, 400);
      state.listeningResumeTimers.push(tid);
      return;
    }
  }

  // Resume state.audio — reset state.currentSubIndex so updateSubtitles re-evaluates
  // the current line and can schedule state.listeningPauseAt for it
  state.currentSubIndex = -1;
  const tid = setTimeout(() => {
    if (state.audio && state.listeningMode) playAudio();
  }, 600);
  state.listeningResumeTimers.push(tid);
}

// ─── Song End ──────────────────────────────────────────────────────────────────

function showSongEnd() {
  const container = document.getElementById('subContainer');
  if (!container) return;

  // Listening mode → show results modal overlay
  if (state.listeningMode) {
    showListeningResults();
    return;
  }

  // Blanks mode → show results modal overlay
  if (state.blanksMode) {
    showBlanksResults();
    return;
  }

  // Determine next activity for this song
  const songProgress = getSongProgress(state.currentSong.id);
  const nextActivity = getNextPendingActivity(songProgress, 'listen');

  const actions = document.getElementById('songFinActions');
  if (!actions) return;

  const nextBtn = document.getElementById('finNextBtn');
  nextBtn.textContent = nextActivity.label;

  // Bind actions (replace to avoid stale closures)
  const repeatBtn = document.getElementById('finRepeatBtn');
  const newRepeat = repeatBtn.cloneNode(true);
  repeatBtn.replaceWith(newRepeat);
  newRepeat.addEventListener('click', () => {
    actions.classList.add('hidden');
    if (state.audio) {
      state.audio.currentTime = 0;
      playAudio();
    }
  });

  const newNext = nextBtn.cloneNode(true);
  nextBtn.replaceWith(newNext);
  newNext.addEventListener('click', () => {
    actions.classList.add('hidden');
    nextActivity.action();
  });

  // Show and scroll to bottom
  actions.classList.remove('hidden');
  requestAnimationFrame(() => {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  });
}

// ─── Smart Next Activity + Lesson Complete Modal ─────────────────────────────

/**
 * Determines the next pending activity to suggest after completing one.
 * Follows pedagogical order: listen → dictation → challenge → quiz
 */
function getNextPendingActivity(songProgress, currentActivity) {
  const order = ['listen', 'dictation', 'challenge', 'quiz'];
  const labels = {
    listen: '🎵 Escuchar',
    dictation: '🎧 Dictado →',
    challenge: '✎ Huecos →',
    quiz: 'Quiz →',
  };
  const actions = {
    listen: () => {
      // Go back to normal player mode
      if (state.blanksMode) toggleBlanksMode();
      if (state.listeningMode) toggleListeningMode();
    },
    dictation: () => toggleListeningMode(),
    challenge: () => toggleBlanksMode(),
    quiz: () => toggleQuizMode(),
  };

  // Find next incomplete activity after the current one in pedagogical order
  const currentIdx = order.indexOf(currentActivity);
  for (let i = currentIdx + 1; i < order.length; i++) {
    const activity = order[i];
    if (!songProgress.activities[activity].completed) {
      return { label: labels[activity], action: actions[activity] };
    }
  }
  // Wrap around — check before current
  for (let i = 0; i < currentIdx; i++) {
    const activity = order[i];
    if (!songProgress.activities[activity].completed) {
      return { label: labels[activity], action: actions[activity] };
    }
  }
  // All complete — suggest next song in catalog order
  const levelOrder = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  const sorted = [...pickerSongs].sort((a, b) => {
    const la = levelOrder.indexOf((a.level || '').toLowerCase());
    const lb = levelOrder.indexOf((b.level || '').toLowerCase());
    return (la === -1 ? 99 : la) - (lb === -1 ? 99 : lb) || a.title.localeCompare(b.title);
  });
  const curIdx = sorted.findIndex(s => s.folder === state.currentSong?.folder);
  const nextSong = curIdx >= 0 && curIdx < sorted.length - 1 ? sorted[curIdx + 1] : null;
  if (nextSong) {
    return { label: 'Siguiente canción →', action: () => loadSong(nextSong) };
  }
  return { label: 'Inicio', action: () => showDashboard() };
}

/**
 * Shows a celebratory modal when all 4 activities for a song are complete.
 */
export function showLessonCompleteModal(existingModalId, pct, correct, total) {
  document.getElementById(existingModalId)?.remove();

  const song = state.currentSong;
  const levelOrder = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  const sorted = [...pickerSongs].sort((a, b) => {
    const la = levelOrder.indexOf((a.level || '').toLowerCase());
    const lb = levelOrder.indexOf((b.level || '').toLowerCase());
    return (la === -1 ? 99 : la) - (lb === -1 ? 99 : lb) || a.title.localeCompare(b.title);
  });
  const curIdx = sorted.findIndex(s => s.folder === song?.folder);
  const nextSong = curIdx >= 0 && curIdx < sorted.length - 1 ? sorted[curIdx + 1] : null;

  const overlay = document.createElement('div');
  overlay.id = 'lessonCompleteModal';
  overlay.className = 'lr-overlay';
  overlay.innerHTML = `
    <div class="lr-modal lr-modal--complete" role="dialog" aria-labelledby="lcTitle" aria-modal="true">
      <button class="lr-close-btn" id="lcCloseBtn" aria-label="Cerrar">✕</button>
      <div class="lr-emoji lr-emoji--big">🎓</div>
      <h3 class="lr-title" id="lcTitle">Lección completada</h3>
      <p class="lr-message">Completaste todas las actividades de <strong>${song.title}</strong></p>
      <div class="lr-complete-checklist">
        <span class="lr-check-item is-done">✓ Escucha</span>
        <span class="lr-check-item is-done">✓ Dictado</span>
        <span class="lr-check-item is-done">✓ Completar huecos</span>
        <span class="lr-check-item is-done">✓ Quiz</span>
      </div>
      <div class="lr-actions">
        <button class="lr-btn lr-btn--ghost" id="lcCatalogBtn">← Catálogo</button>
        ${nextSong ? `<button class="lr-btn lr-btn--primary" id="lcNextSongBtn">Siguiente canción →</button>` : `<button class="lr-btn lr-btn--primary" id="lcDashBtn">Inicio</button>`}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#lcCloseBtn');
  const catalogBtn = overlay.querySelector('#lcCatalogBtn');
  const nextSongBtn = overlay.querySelector('#lcNextSongBtn');
  const dashBtn = overlay.querySelector('#lcDashBtn');

  setTimeout(() => (nextSongBtn || dashBtn).focus(), 100);

  catalogBtn.addEventListener('click', () => { overlay.remove(); showPicker(true); });
  if (nextSongBtn) {
    nextSongBtn.addEventListener('click', () => { overlay.remove(); loadSong(nextSong); });
  }
  if (dashBtn) {
    dashBtn.addEventListener('click', () => { overlay.remove(); showDashboard(); });
  }
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const onEsc = (e) => {
    if (e.key === 'Escape' && document.getElementById('lessonCompleteModal')) {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);
}

function showBlanksResults() {
  // Remove existing modal if any
  document.getElementById('blanksResultsModal')?.remove();

  // Calculate score from all blanks
  const inputs = document.querySelectorAll('.blank-input');
  let correct = 0;
  const total = inputs.length;

  inputs.forEach(input => {
    const answer = normalizeForCompare(input.dataset.answer);
    const value = normalizeForCompare(input.value);
    if (value && value === answer) correct++;
  });

  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Record progress (mirrors showListeningResults pattern)
  recordActivityResult({
    contentId: state.currentSong.id,
    title: state.currentSong.title,
    activity: 'challenge',
    scorePct: pct,
    correct,
    total,
    runId: state.challengeRunId,
  });
  state.challengeRunId = createRunId('challenge');
  updateSongProgressUi(state.currentSong.id);

  // Check if this completed the entire song
  const songProgress = getSongProgress(state.currentSong.id);
  if (songProgress.completed) {
    showLessonCompleteModal('blanksResultsModal', pct, correct, total);
    return;
  }

  let emoji, grade, message;
  if (pct >= 90) {
    emoji = '🏆'; grade = 'Excelente'; message = 'Dominio sólido del vocabulario';
  } else if (pct >= 70) {
    emoji = '🎉'; grade = 'Muy bien'; message = 'Buen manejo de las palabras clave';
  } else if (pct >= 50) {
    emoji = '💪'; grade = 'No está mal'; message = 'Revisa el vocabulario y reintenta';
  } else {
    emoji = '📖'; grade = 'Necesitas práctica'; message = 'Usa el modo vocabulario para repasar';
  }

  const diffLabels = { easy: 'Fácil', normal: 'Normal', hard: 'Desafío' };
  const diffLabel = diffLabels[state.blanksDifficulty] || 'Normal';

  // Determine next action based on pending activities
  const nextActivity = getNextPendingActivity(songProgress, 'challenge');

  const overlay = document.createElement('div');
  overlay.id = 'blanksResultsModal';
  overlay.className = 'lr-overlay';
  overlay.innerHTML = `
    <div class="lr-modal" role="dialog" aria-labelledby="brTitle" aria-modal="true">
      <button class="lr-close-btn" id="brCloseBtn" aria-label="Cerrar">✕</button>
      <div class="lr-emoji">${emoji}</div>
      <h3 class="lr-title" id="brTitle">${grade}</h3>
      <p class="lr-message">${message}</p>
      <div class="lr-stats">
        <div class="lr-stat lr-stat--correct">
          <span class="lr-stat-value">${correct}</span>
          <span class="lr-stat-label">Correctas</span>
        </div>
        <div class="lr-stat lr-stat--total">
          <span class="lr-stat-value">${pct}%</span>
          <span class="lr-stat-label">Precisión</span>
        </div>
        <div class="lr-stat lr-stat--wrong">
          <span class="lr-stat-value">${total - correct}</span>
          <span class="lr-stat-label">Errores</span>
        </div>
      </div>
      <p class="lr-meta">✎ Completar huecos · ${diffLabel}</p>
      <div class="lr-actions">
        <button class="lr-btn lr-btn--ghost" id="brRetryBtn">↻ Reintentar</button>
        <button class="lr-btn lr-btn--primary" id="brNextBtn">${nextActivity.label}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const retryBtn = overlay.querySelector('#brRetryBtn');
  const nextBtn = overlay.querySelector('#brNextBtn');
  const closeBtn = overlay.querySelector('#brCloseBtn');
  setTimeout(() => nextBtn.focus(), 100);

  retryBtn.addEventListener('click', () => {
    overlay.remove();
    // Reset blanks and re-render as a new attempt
    state.blanksAnswers = {};
    state.challengeRunId = createRunId('challenge');
    blanksRevealed = false;
    renderSubtitles(state.currentSong.subtitles);
    const scoreEl = document.getElementById('blanksScore');
    if (scoreEl) scoreEl.textContent = '';
    if (state.audio) {
      state.audio.currentTime = 0;
      playAudio();
    }
  });

  nextBtn.addEventListener('click', () => {
    overlay.remove();
    nextActivity.action();
  });

  closeBtn.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const onEsc = (e) => {
    if (e.key === 'Escape' && document.getElementById('blanksResultsModal')) {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);
}

function showListeningResults() {
  // Remove existing modal if any
  document.getElementById('listeningResultsModal')?.remove();

  const { correct, wrong } = state.listeningScore;
  const total = correct + wrong;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  recordActivityResult({
    contentId: state.currentSong.id,
    title: state.currentSong.title,
    activity: 'dictation',
    scorePct: pct,
    correct,
    total,
    runId: state.dictationRunId,
  });
  updateSongProgressUi(state.currentSong.id);

  // Check if this completed the entire song
  const songProgress = getSongProgress(state.currentSong.id);
  if (songProgress.completed) {
    showLessonCompleteModal('listeningResultsModal', pct, correct, total);
    return;
  }

  // Determine grade/feedback
  let emoji, grade, message;
  if (pct >= 90) {
    emoji = '🏆'; grade = 'Excelente'; message = 'Oído impecable';
  } else if (pct >= 70) {
    emoji = '🎉'; grade = 'Muy bien'; message = 'Buen dominio auditivo';
  } else if (pct >= 50) {
    emoji = '💪'; grade = 'No está mal'; message = 'Sigue practicando';
  } else {
    emoji = '🎧'; grade = 'Necesitas práctica'; message = 'Intenta a menor velocidad';
  }

  const diffLabels = { easy: 'Fácil', normal: 'Normal', hard: 'Desafío' };
  const diffLabel = diffLabels[state.listeningDifficulty] || 'Normal';

  // Determine next action based on pending activities
  const nextActivity = getNextPendingActivity(songProgress, 'dictation');

  const overlay = document.createElement('div');
  overlay.id = 'listeningResultsModal';
  overlay.className = 'lr-overlay';
  overlay.innerHTML = `
    <div class="lr-modal" role="dialog" aria-labelledby="lrTitle" aria-modal="true">
      <button class="lr-close-btn" id="lrCloseBtn" aria-label="Cerrar">✕</button>
      <div class="lr-emoji">${emoji}</div>
      <h3 class="lr-title" id="lrTitle">${grade}</h3>
      <p class="lr-message">${message}</p>
      <div class="lr-stats">
        <div class="lr-stat lr-stat--correct">
          <span class="lr-stat-value">${correct}</span>
          <span class="lr-stat-label">Correctas</span>
        </div>
        <div class="lr-stat lr-stat--total">
          <span class="lr-stat-value">${pct}%</span>
          <span class="lr-stat-label">Precisión</span>
        </div>
        <div class="lr-stat lr-stat--wrong">
          <span class="lr-stat-value">${wrong}</span>
          <span class="lr-stat-label">Errores</span>
        </div>
      </div>
      <p class="lr-meta">🎧 Dictado · ${diffLabel}</p>
      <div class="lr-actions">
        <button class="lr-btn lr-btn--ghost" id="lrRetryBtn">↻ Reintentar</button>
        <button class="lr-btn lr-btn--primary" id="lrNextBtn">${nextActivity.label}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Focus trap — focus next-challenge button (positive action)
  const retryBtn = overlay.querySelector('#lrRetryBtn');
  const nextBtn = overlay.querySelector('#lrNextBtn');
  const closeBtn = overlay.querySelector('#lrCloseBtn');
  setTimeout(() => nextBtn.focus(), 100);

  retryBtn.addEventListener('click', () => {
    overlay.remove();
    // Reset score and restart song in listening mode as a new attempt
    state.listeningScore = { correct: 0, wrong: 0 };
    state.dictationRunId = createRunId('dictation');
    state.listeningBlanksMap = buildListeningBlanks();
    state.currentSubIndex = -1;
    state.listeningWaiting = false;
    state.listeningCurrentBlank = null;
    state.listeningPauseAt = null;
    state.listeningRepeatCount = 0;
    state.listeningLineStart = null;
    renderSubtitles(state.currentSong.subtitles);
    updateListeningToolbar();
    if (state.audio) {
      state.audio.currentTime = 0;
      playAudio();
    }
  });

  nextBtn.addEventListener('click', () => {
    overlay.remove();
    nextActivity.action();
  });

  closeBtn.addEventListener('click', () => {
    overlay.remove();
  });

  // Close on overlay click (outside modal)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape
  const onEsc = (e) => {
    if (e.key === 'Escape' && document.getElementById('listeningResultsModal')) {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);
}

// ─── Volume ────────────────────────────────────────────────────────────────────

let savedVolume = loadPrefs().volume ?? 1;

function onVolumeChange(e) {
  const vol = parseFloat(e.target.value);
  if (state.audio) state.audio.volume = vol;
  savedVolume = vol;
  updateVolumeIcon(vol);
  savePrefs({ volume: vol });
}

function toggleMute() {
  if (!state.audio) return;
  const slider = document.getElementById('volumeSlider');
  if (state.audio.volume > 0) {
    savedVolume = state.audio.volume;
    state.audio.volume = 0;
    slider.value = 0;
    updateVolumeIcon(0);
  } else {
    state.audio.volume = savedVolume || 1;
    slider.value = state.audio.volume;
    updateVolumeIcon(state.audio.volume);
  }
}

function updateVolumeIcon(vol) {
  const btn = document.getElementById('volumeBtn');
  if (!btn) return;
  if (vol === 0) btn.textContent = '🔇';
  else if (vol < 0.5) btn.textContent = '🔉';
  else btn.textContent = '🔊';
}

// ─── Keyboard ──────────────────────────────────────────────────────────────────

// ─── Shortcuts Panel ───────────────────────────────────────────────────────────

function toggleShortcutsPanel() {
  const panel = document.getElementById('shortcutsPanel');
  if (!panel) return;
  const isHidden = panel.classList.toggle('hidden');
  document.getElementById('shortcutsBtnToolbar')?.classList.toggle('active', !isHidden);
  if (!isHidden) {
    // Close on outside click
    const close = (e) => {
      if (!panel.contains(e.target) && e.target.id !== 'shortcutsBtnToolbar') {
        panel.classList.add('hidden');
        document.getElementById('shortcutsBtnToolbar')?.classList.remove('active');
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

function onKeydown(e) {
  if (e.target.closest('.about-overlay, .unified-nav, .unified-nav-trigger')) return;
  if (e.target.tagName === 'INPUT') {
    // Enter submits listening answer
    if (e.key === 'Enter' && state.listeningWaiting && state.listeningCurrentBlank) {
      e.preventDefault();
      submitListeningAnswer();
    }
    return;
  }

  // Progress bar keyboard control (when focused)
  if (e.target.id === 'progressBar' && state.audio && state.audio.duration) {
    const step = e.shiftKey ? 10 : 5;
    if (e.key === 'ArrowRight') { e.preventDefault(); state.audio.currentTime = Math.min(state.audio.currentTime + step, state.audio.duration); updateProgress(); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); state.audio.currentTime = Math.max(state.audio.currentTime - step, 0); updateProgress(); return; }
  }

  if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); togglePlay(); }
  if (e.code === 'KeyN' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleLineNumbers(); }
  if (e.code === 'KeyT' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleTranslation(); }
  if (e.code === 'KeyS') cycleSpeed();
  if (e.code === 'KeyL') onLoopClick();

  if (e.code === 'KeyH' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleHighlight(); }
}

// ─── Blank input delegation ────────────────────────────────────────────────────

document.addEventListener('input', (e) => {
  if (e.target.classList.contains('blank-input')) {
    onBlankInput(e);
  }
  // Listening mode: auto-submit when typed value matches the answer
  if (e.target.classList.contains('listening-input') && state.listeningWaiting && state.listeningCurrentBlank === e.target) {
    const value = normalizeForCompare(e.target.value);
    const answer = normalizeForCompare(e.target.dataset.answer);
    if (value && value === answer) {
      submitListeningAnswer();
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('blank-input') && state.blanksMode) {
    e.preventDefault();
    validateSingleBlank(e.target);
    focusNextBlank(e.target);
  }
});

// ─── Visibility: pause orbs when tab hidden (save GPU/battery) ──────────────────

document.addEventListener('visibilitychange', () => {
  const orbs = document.querySelectorAll('.orb');
  if (document.hidden) {
    orbs.forEach(el => el.classList.add('paused'));
  } else {
    orbs.forEach(el => el.classList.remove('paused'));
  }
});

// ─── Page unload: stop audio when navigating away ───────────────────────────────

window.addEventListener('pagehide', () => {
  if (state.audio) { state.audio.pause(); state.audio.src = ''; }
});

// ─── Init ──────────────────────────────────────────────────────────────────────

initUnifiedNavigation();
renderAppHeader();

// Hide CSS tooltips on tap/click (sticky :hover on touch otherwise keeps them visible)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tooltip]');
  document.querySelectorAll('[data-tooltip].tooltip-hidden').forEach(el => {
    if (el !== btn) el.classList.remove('tooltip-hidden');
  });
  if (btn) btn.classList.add('tooltip-hidden');
}, true);

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('[data-tooltip]')) {
    document.querySelectorAll('[data-tooltip].tooltip-hidden').forEach(el => {
      el.classList.remove('tooltip-hidden');
    });
  }
}, true);

const songParam = new URLSearchParams(location.search).get('song');
const isSessionReturn = sessionStorage.getItem('lyricflow_active');
const initialSong = songParam && isSessionReturn && pickerSongs.find(s => s.folder.split('/').pop() === songParam);
if (initialSong) {
  loadSong(initialSong);
} else {
  // Clean stale ?song= param if not resuming
  if (songParam) {
    const u = new URL(location.href);
    u.searchParams.delete('song');
    history.replaceState(null, '', u);
  }
  showDashboard();
}

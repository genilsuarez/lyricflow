// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Learn languages through music
// Auto-discovers songs from songs/ folder via catalog.js
// Features: synced lyrics, vocab, fill-in-the-blanks, A-B loop, speed control, culture
// ═══════════════════════════════════════════════════════════════════════════════

import pickerSongs from './songs/picker-data.js';
import { loadVocab, toggleVocabMode, showCultureView } from './vocab-culture.js';

export const app = document.getElementById('app');

// Speed control options
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25];

// Difficulty levels — shared between blanks and listening
// easy: 1 blank/line, only rich lines, min 4 chars
// normal: 1-2 blanks (current default)
// hard: 2-3 blanks, shorter words eligible
const DIFFICULTY = {
  easy:   { maxBlanks: 1, richThreshold: 2, minWordLen: 2 },
  normal: { maxBlanks: 2, richThreshold: 3, minWordLen: 2 },
  hard:   { maxBlanks: 3, richThreshold: 2, minWordLen: 1 },
};

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
  isPlaying: false,
  currentSubIndex: -1,
  animationFrame: null,
  isDragging: false,
  currentSong: null,
  playbackRate: 1,

  // View toggles
  showTranslation: false,
  selectMode: false,
  showLineNumbers: false,
  vocabData: null,
  vocabMode: false,

  // A-B loop
  loopA: null,
  loopB: null,
  loopActive: false,

  // Fill-in-the-blanks
  blanksMode: false,
  blanksAnswers: {},
  blanksDifficulty: 'normal',
  listeningDifficulty: 'normal',

  // Listening challenge
  listeningMode: false,
  listeningWaiting: false,
  listeningCurrentBlank: null,
  listeningTimerId: null,
  listeningScore: { correct: 0, wrong: 0 },
  listeningBlanksMap: {}, // lineIndex -> [{wordIdx, clean, original}]
  listeningPauseAt: null,   // audio time (s) to pause and activate blank
  listeningNextBlank: null, // blank element to activate when listeningPauseAt fires
  listeningRepeatCount: 0,  // 0 = first play, 1 = already repeated → now pause
  listeningLineStart: null, // start time of current listening line (for replay)

  // Misc
  playerCleanup: null,   // Event listener cleanup (AbortController per player session)
  cachedSubLines: [],    // Cached DOM references (set after renderSubtitles)
  scrollRAF: null,       // Debounce scroll — avoid queueing multiple smooth scrolls
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


// ─── Helpers ───────────────────────────────────────────────────────────────────

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

// Simple seeded random for consistent blanks per song
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Song Picker ───────────────────────────────────────────────────────────────

function showPicker(skipAutoLoad = false) {
  state.playerCleanup?.();
  state.playerCleanup = null;
  state.currentSong = null;
  if (state.audio) { state.audio.pause(); state.audio = null; }

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
      <div class="picker-header">
        <div class="picker-brand">
          <h2>LyricFlow</h2>
          <p>Learn languages through music</p>
        </div>
        <div class="picker-actions">
          <a class="picker-btn" id="portalLink" href="https://genilsuarez.github.io/deskflow/" aria-label="Back to Portal" title="Back to Portal">🏠</a>
          <button class="picker-btn" id="themeToggle" aria-label="Toggle theme">🌙</button>
        </div>
      </div>
      <div class="search-bar">
        <input type="search" id="songSearch" placeholder="Search songs..." aria-label="Search songs" autocomplete="off">
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
    filtered.forEach((song, idx) => {
      const item = document.createElement('div');
      item.className = 'song-list-item';
      item.innerHTML = `
        <span class="icon">${song.icon || '🎵'}</span>
        <div class="info">
          <div class="title">${song.title}</div>
          <div class="artist">${song.artist}</div>
          ${song.level ? `<div class="song-tags"><span class="level-badge level-${song.level.toLowerCase()}">${song.level}</span></div>` : ''}
        </div>
      `;
      item.addEventListener('click', () => loadSong(song));
      list.appendChild(item);
    });
  }

  renderSongs(songs);

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

  // Theme toggle + portal link (inside picker)
  setupPickerActions();

  // Auto-load last played song ONLY if this is a same-session return
  // (not a fresh tab, not from DeskFlow, not first visit)
  // If navigated from DeskFlow (portal), always show picker
  const prefs = loadPrefs();
  const isSessionActive = sessionStorage.getItem('lyricflow_active');
  const fromPortal = document.referrer.includes('deskflow') || document.referrer.includes('localhost:3000');
  if (!skipAutoLoad && prefs.lastSong && isSessionActive && !fromPortal) {
    const lastSong = songs.find(s => s.folder === prefs.lastSong);
    if (lastSong) loadSong(lastSong);
  }
}

// ─── Player View ───────────────────────────────────────────────────────────────

export async function loadSong(song) {
  // If song only has picker metadata, load full data (subtitles, culture, etc.)
  if (!song.subtitles) {
    const mod = await import(`./${song.folder}/data.js`);
    song = { ...mod.default, folder: song.folder };
  }
  state.playerCleanup?.();
  state.playerCleanup = null;
  state.currentSong = song;
  state.showTranslation = false;
  state.showLineNumbers = false;
  state.vocabMode = false;
  state.blanksMode = false;
  state.blanksAnswers = {};
  state.listeningMode = false;
  state.listeningWaiting = false;
  state.listeningCurrentBlank = null;
  state.listeningScore = { correct: 0, wrong: 0 };
  state.listeningBlanksMap = {};
  state.listeningPauseAt = null;
  state.listeningNextBlank = null;
  clearListeningTimer();
  state.loopA = null;
  state.loopB = null;
  state.loopActive = false;
  state.playbackRate = 1;
  state.currentSubIndex = -1;

  app.innerHTML = `
    <div class="song-header">
      <div class="artwork">${song.icon || '🎵'}</div>
      <div class="song-meta">
        <div class="song-title">${song.title}</div>
        <div class="song-artist">${song.artist}</div>
      </div>
      <div class="song-header-actions">
        <button class="picker-btn" id="backBtn" aria-label="Volver al picker" title="Volver">←</button>
        <a class="picker-btn" id="playerPortalLink" href="https://genilsuarez.github.io/deskflow/" aria-label="Ir al portal DeskFlow" title="Portal">🏠</a>
        <button class="picker-btn" id="playerThemeToggle" aria-label="Cambiar tema">${document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'}</button>
      </div>
    </div>

    <div class="mode-toolbar">
      <div class="ctrl-group ctrl-group--display">
        <button class="toggle-trans-btn" id="toggleTransBtn" aria-label="Traducción" data-tooltip="Mostrar traducción">Aa</button>
        <button class="toggle-select-btn" id="toggleSelectBtn" aria-label="Modo selección" data-tooltip="Seleccionar texto">⌶</button>
      </div>
      <span class="ctrl-divider" aria-hidden="true"></span>
      <div class="ctrl-group ctrl-group--study">
        <button class="toggle-listening-btn" id="toggleListeningBtn" aria-label="Dictado auditivo" data-tooltip="Dictado auditivo">🎧</button>
        <button class="toggle-blanks-btn" id="toggleBlanksBtn" aria-label="Fill in the blanks" data-tooltip="Completar huecos">✎</button>
        <button class="toggle-vocab-btn" id="toggleVocabBtn" aria-label="Vocabulario" data-tooltip="Vocabulario">📖</button>
        ${song.culture ? '<button class="toggle-culture-btn" id="toggleCultureBtn" aria-label="Contexto cultural" data-tooltip="Contexto cultural">🌍</button>' : ''}
      </div>
    </div>

    <div class="subtitle-container" id="subContainer"></div>
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
        <button class="play-btn" id="playBtn" aria-label="Reproducir/Pausar">▶</button>
        <div class="volume-control" id="volumeControl">
          <button class="volume-btn" id="volumeBtn" aria-label="Silenciar/Volumen">🔊</button>
          <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.01" value="1" aria-label="Volumen" />
        </div>
        <button class="speed-btn" id="speedBtn" aria-label="Velocidad" data-tooltip="Velocidad de reproducción">1×</button>
        <button class="loop-btn" id="loopBtn" aria-label="A-B Loop" data-tooltip="Repetir sección A→B">⟳</button>
      </div>
    </div>
  `;

  bindPlayerEvents(song);
  renderSubtitles(song.subtitles);
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
}

// ─── Theme (shared between picker and player) ──────────────────────────────────

function currentThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return isDark ? '☀️' : '🌙';
}

function toggleTheme(iconEl) {
  document.documentElement.classList.add('theme-transitioning');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme === 'dark' ? 'dark' : '');
  localStorage.setItem('lp-theme', newTheme);
  if (location.search.includes('theme=')) {
    const u = new URL(location.href); u.searchParams.set('theme', newTheme); history.replaceState(null, '', u);
  }
  if (iconEl) iconEl.textContent = currentThemeIcon();
  setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
}

function bindPlayerEvents(song) {
  const controller = new AbortController();
  const { signal } = controller;
  state.playerCleanup = () => controller.abort();

  document.getElementById('backBtn').addEventListener('click', () => showPicker(true), { signal });
  // Local dev: el portal del player apunta a la DeskFlow local (mismo patrón que el picker)
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    const pPortal = document.getElementById('playerPortalLink');
    if (pPortal) {
      const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      pPortal.href = 'http://localhost:3000/?theme=' + theme;
    }
  }
  document.getElementById('playerThemeToggle').addEventListener('click', () => {
    toggleTheme(document.getElementById('playerThemeToggle'));
  }, { signal });
  document.getElementById('playBtn').addEventListener('click', togglePlay, { signal });
  document.getElementById('toggleTransBtn').addEventListener('click', toggleTranslation, { signal });
  document.getElementById('toggleSelectBtn').addEventListener('click', toggleSelectMode, { signal });
  document.getElementById('toggleVocabBtn').addEventListener('click', toggleVocabMode, { signal });
  document.getElementById('toggleBlanksBtn').addEventListener('click', toggleBlanksMode, { signal });
  document.getElementById('toggleListeningBtn').addEventListener('click', toggleListeningMode, { signal });
  document.getElementById('speedBtn').addEventListener('click', cycleSpeed, { signal });
  document.getElementById('loopBtn').addEventListener('click', onLoopClick, { signal });
  document.getElementById('volumeBtn').addEventListener('click', toggleMute, { signal });
  document.getElementById('volumeSlider').addEventListener('input', onVolumeChange, { signal });

  if (song.culture) {
    document.getElementById('toggleCultureBtn').addEventListener('click', () => showCultureView(song), { signal });
  }

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

  state.audio.addEventListener('ended', () => {
    document.getElementById('playBtn').textContent = '▶';
    state.isPlaying = false;
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

function playAudio() {
  if (!state.audio) return;
  state.audio.play().catch(() => {});
  document.getElementById('playBtn').textContent = '⏸';
  document.getElementById('playBtn').setAttribute('aria-label', 'Pausar');
  state.isPlaying = true;
  startUpdateLoop();
  document.querySelector('.artwork')?.classList.add('playing');
}

function pauseAudio() {
  if (!state.audio) return;
  state.audio.pause();
  document.getElementById('playBtn').textContent = '▶';
  document.getElementById('playBtn').setAttribute('aria-label', 'Reproducir');
  state.isPlaying = false;
  stopUpdateLoop();
  document.querySelector('.artwork')?.classList.remove('playing');
}

function togglePlay() {
  if (!state.audio) return;

  // In listening mode: don't resume while waiting for blank input
  if (state.listeningMode && state.listeningWaiting && state.audio.paused) {
    if (state.listeningCurrentBlank) state.listeningCurrentBlank.focus();
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
        state.listeningNextBlank = null;
        state.audio.pause();
        document.getElementById('playBtn').textContent = '▶';
        state.isPlaying = false;
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
      state.listeningNextBlank = null;
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
    easy: '1 palabra por línea',
    normal: '1–2 palabras por línea',
    hard: '2–3 palabras por línea',
  };
  const icons = { easy: '🌱', normal: '🎯', hard: '🔥' };
  const currentDiff = mode === 'blanks' ? state.blanksDifficulty : state.listeningDifficulty;

  const picker = document.createElement('div');
  picker.id = 'difficultyPicker';
  picker.className = 'difficulty-picker';
  picker.innerHTML = `
    <div class="dp-header">
      <span class="dp-title">${mode === 'blanks' ? '✎ Completar huecos' : '🎧 Dictado auditivo'}</span>
      <button class="dp-close" id="dpClose" aria-label="Cancelar">✕</button>
    </div>
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
  picker.querySelector('#dpClose').addEventListener('click', () => picker.remove());
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
    }
  };
  document.addEventListener('keydown', onPickerEsc);
}

// ─── Fill-in-the-Blanks ────────────────────────────────────────────────────────

function toggleBlanksMode() {
  // If active → deactivate
  if (state.blanksMode) {
    state.blanksMode = false;
    document.getElementById('toggleBlanksBtn').classList.remove('active');
    renderSubtitles(state.currentSong.subtitles);
    const toolbar = document.getElementById('blanksToolbar');
    if (toolbar) toolbar.remove();
    const picker = document.getElementById('difficultyPicker');
    if (picker) picker.remove();
    return;
  }

  // Show difficulty picker
  showDifficultyPicker('blanks', (diff) => {
    state.blanksDifficulty = diff;
    state.blanksMode = true;
    const btn = document.getElementById('toggleBlanksBtn');
    btn.classList.add('active');

    // Deactivate listening mode if active
    if (state.listeningMode) {
      state.listeningMode = false;
      document.getElementById('toggleListeningBtn').classList.remove('active');
      clearListeningTimer();
      state.listeningWaiting = false;
      state.listeningCurrentBlank = null;
      updateListeningToolbar();
    }

    state.blanksAnswers = {};
    blanksRevealed = false;
    if (state.showTranslation) toggleTranslation();

    renderSubtitles(state.currentSong.subtitles);

    // Add blanks toolbar
    const existing = document.getElementById('blanksToolbar');
    if (existing) existing.remove();

    const toolbar = document.createElement('div');
    toolbar.id = 'blanksToolbar';
    toolbar.className = 'blanks-toolbar';
    toolbar.innerHTML = `
      <button class="blanks-check-btn" id="blanksCheckBtn">✓ Verificar</button>
      <button class="blanks-reveal-btn" id="blanksRevealBtn">👁 Revelar</button>
      <span class="blanks-score" id="blanksScore"></span>
    `;
    const container = document.getElementById('subContainer');
    container.parentNode.insertBefore(toolbar, container);
    document.getElementById('blanksCheckBtn').addEventListener('click', checkBlanks);
    document.getElementById('blanksRevealBtn').addEventListener('click', revealBlanks);
  });
}

function renderBlanksLine(text, lineIndex) {
  const STRIP = /[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g;
  const tokens = text.split(/(\s+)/);
  const rng = seededRandom(lineIndex * 31 + 7);
  const diff = DIFFICULTY[state.blanksDifficulty];

  // Pass 1 — score content-word candidates
  let wordIdx = 0;
  const candidates = [];
  tokens.forEach(token => {
    if (/^\s+$/.test(token)) return;
    const clean = token.toLowerCase().replace(STRIP, '');
    if (!clean || clean.length <= diff.minWordLen || STOP_WORDS.has(clean)) { wordIdx++; return; }
    const inVocab = state.vocabData?.some(v => v.word === clean) ?? false;
    candidates.push({ wordIdx, clean, original: token, score: (inVocab ? 100 : 0) + clean.length + rng() * 5 });
    wordIdx++;
  });

  // Skip lines without enough candidates for this difficulty
  if (candidates.length < diff.richThreshold) {
    wordIdx = 0;
    return tokens.map(token => {
      if (/^\s+$/.test(token)) return token;
      wordIdx++;
      return `<span class="blanks-visible">${token}</span>`;
    }).join('');
  }

  // Pick blanks based on difficulty
  candidates.sort((a, b) => b.score - a.score);
  const maxBlanks = Math.min(diff.maxBlanks, candidates.length);
  const blankSet = new Set(candidates.slice(0, maxBlanks).map(c => c.wordIdx));

  // Pass 2 — render tokens
  wordIdx = 0;
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
        style="width:${Math.max(clean.length, 3) + 1}ch"
        maxlength="${clean.length + 5}"
        value="${answered}"
        placeholder="${'·'.repeat(clean.length)}"
        autocomplete="off"
        spellcheck="false" />
    </span>`;
  }).join('');
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
  let total = inputs.length;

  inputs.forEach(input => {
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

    if (!value) {
      total--;
    } else if (valueTrimmed === input.dataset.answer) {
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

  // Show score
  const scoreEl = document.getElementById('blanksScore');
  if (scoreEl) {
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    scoreEl.textContent = `${correct}/${total} (${pct}%)`;
    scoreEl.classList.toggle('score-good', pct >= 80);
    scoreEl.classList.toggle('score-mid', pct >= 50 && pct < 80);
    scoreEl.classList.toggle('score-low', pct < 50);
  }
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
  let left = anchorRect.left + anchorRect.width / 2;
  let top = anchorRect.top - 8;

  const tipWidth = tip.offsetWidth;
  const minLeft = tipWidth / 2 + 8;
  const maxLeft = window.innerWidth - tipWidth / 2 - 8;
  left = Math.max(minLeft, Math.min(left, maxLeft));

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
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      state.scrollRAF = null;
    });
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
      state.listeningNextBlank = blank;
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

function toggleLineNumbers() {
  state.showLineNumbers = !state.showLineNumbers;
  const container = document.getElementById('subContainer');
  if (container) container.classList.toggle('show-line-numbers', state.showLineNumbers);
}

// ─── Listening Challenge Mode ──────────────────────────────────────────────────

function toggleListeningMode() {
  // If active → deactivate
  if (state.listeningMode) {
    state.listeningMode = false;
    document.getElementById('toggleListeningBtn').classList.remove('active');
    clearListeningTimer();
    state.listeningWaiting = false;
    state.listeningCurrentBlank = null;
    state.listeningPauseAt = null;
    state.listeningNextBlank = null;
    state.listeningRepeatCount = 0;
    state.listeningLineStart = null;
    renderSubtitles(state.currentSong.subtitles);
    updateListeningToolbar();
    return;
  }

  // Show difficulty picker
  showDifficultyPicker('listening', (diff) => {
    state.listeningDifficulty = diff;
    state.listeningMode = true;
    const btn = document.getElementById('toggleListeningBtn');
    btn.classList.add('active');

    // Deactivate static blanks if active
    if (state.blanksMode) {
      state.blanksMode = false;
      document.getElementById('toggleBlanksBtn').classList.remove('active');
      const toolbar = document.getElementById('blanksToolbar');
      if (toolbar) toolbar.remove();
    }

    state.listeningScore = { correct: 0, wrong: 0 };
    state.listeningBlanksMap = buildListeningBlanks();
    if (state.showTranslation) toggleTranslation();

    // Restart from beginning
    if (state.audio) {
      state.audio.currentTime = 0;
      state.audio.pause();
    }
    state.currentSubIndex = -1;
    state.listeningWaiting = false;
    document.getElementById('playBtn').textContent = '▶';
    state.isPlaying = false;
    stopUpdateLoop();

    renderSubtitles(state.currentSong.subtitles);
    updateListeningToolbar();
  });
}

function buildListeningBlanks() {
  const map = {};
  const subs = state.currentSong.subtitles;
  const diff = DIFFICULTY[state.listeningDifficulty];

  // Build set of vocab words (these are the pedagogically interesting ones)
  const vocabWords = new Set();
  if (state.vocabData && state.vocabData.length) {
    state.vocabData.forEach(v => vocabWords.add(v.word.toLowerCase()));
  }

  subs.forEach((sub, lineIndex) => {
    const words = sub.original.split(/(\s+)/);
    const rng = seededRandom(lineIndex * 47 + 13);
    let wordIdx = 0;
    const candidates = [];

    words.forEach(token => {
      if (/^\s+$/.test(token)) return;
      const clean = token.toLowerCase().replace(/[.,!?;:«»\u201C\u201D\u2018\u2019\u2026\-\u2013\u2014()']/g, '');
      if (!clean || clean.length <= diff.minWordLen) { wordIdx++; return; }
      if (STOP_WORDS.has(clean)) { wordIdx++; return; }

      const inVocab = vocabWords.has(clean);
      const score = (inVocab ? 100 : 0) + clean.length + rng() * 3;
      candidates.push({ wordIdx, clean, original: token, score });
      wordIdx++;
    });

    // Skip lines without enough candidates for this difficulty
    if (candidates.length < diff.richThreshold) return;

    candidates.sort((a, b) => b.score - a.score);
    const maxBlanks = Math.min(diff.maxBlanks, candidates.length);
    const blanks = candidates.slice(0, maxBlanks);

    map[lineIndex] = blanks;
  });
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
          style="width:${Math.max(b.clean.length, 3) + 1}ch"
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
  const TIMEOUT = 13; // seconds
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
      // Timeout — fail
      clearListeningTimer();
      state.listeningScore.wrong++;
      input.value = input.dataset.original;
      input.size = Math.max(input.dataset.original.length + 1, 4);
      input.classList.remove('lc-active');
      input.classList.add('lc-timeout');
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
  state.listeningNextBlank = null;
  state.listeningRepeatCount = 0;
  state.listeningLineStart = null;

  // Check for another blank in the SAME line (identified by data-line, not .active class)
  // Using .active would pick up the next line if its start time coincides with the pause point
  if (answeredLineIdx !== undefined) {
    const nextBlank = document.querySelector(
      `.listening-input[data-line="${answeredLineIdx}"]:not(.lc-correct):not(.lc-wrong):not(.lc-timeout)`
    );
    if (nextBlank) {
      setTimeout(() => {
        state.listeningWaiting = true;
        state.listeningCurrentBlank = nextBlank;
        nextBlank.focus();
        nextBlank.classList.add('lc-active');
        startListeningTimer(nextBlank);
      }, 400);
      return;
    }
  }

  // Resume state.audio — reset state.currentSubIndex so updateSubtitles re-evaluates
  // the current line and can schedule state.listeningPauseAt for it
  state.currentSubIndex = -1;
  setTimeout(() => {
    if (state.audio && state.listeningMode) playAudio();
  }, 600);
}

// ─── Song End ──────────────────────────────────────────────────────────────────

function showSongEnd() {
  const container = document.getElementById('subContainer');
  if (!container) return;

  // Remove previous fin card if any
  container.querySelector('.song-fin-card')?.remove();

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

  const fin = document.createElement('div');
  fin.className = 'song-fin-card';

  const titleEl = document.createElement('p');
  titleEl.className = 'song-fin-label';
  titleEl.textContent = 'fin';
  fin.appendChild(titleEl);

  const backBtn = document.createElement('button');
  backBtn.className = 'song-fin-back';
  backBtn.textContent = '← catálogo';
  backBtn.addEventListener('click', () => showPicker(true));
  fin.appendChild(backBtn);

  container.appendChild(fin);
  fin.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showBlanksResults() {
  // Remove existing modal if any
  document.getElementById('blanksResultsModal')?.remove();

  // Calculate score from all blanks
  const inputs = document.querySelectorAll('.blank-input');
  let correct = 0;
  let total = 0;

  inputs.forEach(input => {
    const answer = normalizeForCompare(input.dataset.answer);
    const value = normalizeForCompare(input.value);
    if (!input.value.trim()) return; // skip empty
    total++;
    if (value === answer) correct++;
  });

  // If user hasn't filled anything, count total blanks
  if (total === 0) total = inputs.length;

  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

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

  const overlay = document.createElement('div');
  overlay.id = 'blanksResultsModal';
  overlay.className = 'lr-overlay';
  overlay.innerHTML = `
    <div class="lr-modal" role="dialog" aria-labelledby="brTitle" aria-modal="true">
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
        <button class="lr-btn lr-btn--retry" id="brRetryBtn">↻ Reintentar</button>
        <button class="lr-btn lr-btn--catalog" id="brCatalogBtn">← Catálogo</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const retryBtn = overlay.querySelector('#brRetryBtn');
  const catalogBtn = overlay.querySelector('#brCatalogBtn');
  setTimeout(() => retryBtn.focus(), 100);

  retryBtn.addEventListener('click', () => {
    overlay.remove();
    // Reset blanks and re-render
    state.blanksAnswers = {};
    blanksRevealed = false;
    renderSubtitles(state.currentSong.subtitles);
    const scoreEl = document.getElementById('blanksScore');
    if (scoreEl) scoreEl.textContent = '';
    if (state.audio) {
      state.audio.currentTime = 0;
      playAudio();
    }
  });

  catalogBtn.addEventListener('click', () => {
    overlay.remove();
    showPicker(true);
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

  const overlay = document.createElement('div');
  overlay.id = 'listeningResultsModal';
  overlay.className = 'lr-overlay';
  overlay.innerHTML = `
    <div class="lr-modal" role="dialog" aria-labelledby="lrTitle" aria-modal="true">
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
        <button class="lr-btn lr-btn--retry" id="lrRetryBtn">↻ Reintentar</button>
        <button class="lr-btn lr-btn--catalog" id="lrCatalogBtn">← Catálogo</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Focus trap — focus first button
  const retryBtn = overlay.querySelector('#lrRetryBtn');
  const catalogBtn = overlay.querySelector('#lrCatalogBtn');
  setTimeout(() => retryBtn.focus(), 100);

  retryBtn.addEventListener('click', () => {
    overlay.remove();
    // Reset score and restart song in listening mode
    state.listeningScore = { correct: 0, wrong: 0 };
    state.listeningBlanksMap = buildListeningBlanks();
    state.currentSubIndex = -1;
    state.listeningWaiting = false;
    state.listeningCurrentBlank = null;
    state.listeningPauseAt = null;
    state.listeningNextBlank = null;
    state.listeningRepeatCount = 0;
    state.listeningLineStart = null;
    renderSubtitles(state.currentSong.subtitles);
    updateListeningToolbar();
    if (state.audio) {
      state.audio.currentTime = 0;
      playAudio();
    }
  });

  catalogBtn.addEventListener('click', () => {
    overlay.remove();
    showPicker(true);
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

function onKeydown(e) {
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
  if (e.code === 'KeyN') toggleLineNumbers();
  if (e.code === 'KeyT') toggleTranslation();
  if (e.code === 'KeyS') cycleSpeed();
  if (e.code === 'KeyL') onLoopClick();
  if (e.code === 'KeyB') toggleBlanksMode();
}

// ─── Blank input delegation ────────────────────────────────────────────────────

document.addEventListener('input', (e) => {
  if (e.target.classList.contains('blank-input')) {
    onBlankInput(e);
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

// ─── Picker Actions (theme + portal) ────────────────────────────────────────────

function setupPickerActions() {
  const themeBtn = document.getElementById('themeToggle');
  const portalLink = document.getElementById('portalLink');

  themeBtn.textContent = currentThemeIcon();

  themeBtn.addEventListener('click', () => toggleTheme(themeBtn));

  // Local dev: rewrite portal link and propagate theme
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    portalLink.href = 'http://localhost:3000/';
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href*="localhost:"]');
      if (a) {
        const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const url = new URL(a.href);
        url.searchParams.set('theme', theme);
        a.href = url.toString();
      }
    });
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────

showPicker();

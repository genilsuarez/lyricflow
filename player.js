// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Learn languages through music
// Auto-discovers songs from songs/ folder via catalog.js
// Features: synced lyrics, vocab, fill-in-the-blanks, A-B loop, speed control, culture
// ═══════════════════════════════════════════════════════════════════════════════

import songFolders from './songs/catalog.js';

const app = document.getElementById('app');

// State
let audio = null;
let isPlaying = false;
let showTranslation = false;
let selectMode = false;
let showLineNumbers = false;
let currentSubIndex = -1;
let animationFrame = null;
let isDragging = false;
let currentSong = null;
let vocabData = null;
let vocabMode = false;

// Speed control state
let playbackRate = 1;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25];

// A-B loop state
let loopA = null;
let loopB = null;
let loopActive = false;

// Fill-in-the-blanks state
let blanksMode = false;
let blanksAnswers = {};

// Difficulty levels — shared between blanks and listening
// easy: 1 blank/line, only rich lines, min 4 chars
// normal: 1-2 blanks (current default)
// hard: 2-3 blanks, shorter words eligible
const DIFFICULTY = {
  easy:   { maxBlanks: 1, richThreshold: 2, minWordLen: 2 },
  normal: { maxBlanks: 2, richThreshold: 3, minWordLen: 2 },
  hard:   { maxBlanks: 3, richThreshold: 2, minWordLen: 1 },
};
let blanksDifficulty = 'normal';
let listeningDifficulty = 'normal';

// Shared stop words — never blanked in either mode
const STOP_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'le', 'la', 'les', 'un', 'une', 'des', 'du',
  'de', 'et', 'ou', 'mais', 'en', 'au', 'aux', 'ce', 'ma', 'mon',
  'sa', 'son', 'ne', 'pas', 'que', 'qui', 'est', 'ai', 'a', 'y',
  'dans', 'sur', 'pour', 'par', 'avec', 'tout', 'si', 'ô', 'oh',
]);

// Listening challenge state
let listeningMode = false;
let listeningWaiting = false;
let listeningCurrentBlank = null;
let listeningTimerId = null;
let listeningScore = { correct: 0, wrong: 0 };
let listeningBlanksMap = {}; // lineIndex -> [{wordIdx, clean, original}]
let listeningPauseAt = null;   // audio time (s) to pause and activate blank
let listeningNextBlank = null; // blank element to activate when listeningPauseAt fires
let listeningRepeatCount = 0;  // 0 = first play, 1 = already repeated → now pause
let listeningLineStart = null; // start time of current listening line (for replay)

// Event listener cleanup (AbortController per player session)
let playerCleanup = null;

// Cached DOM references (set after renderSubtitles)
let cachedSubLines = [];

// Debounce scroll — avoid queueing multiple smooth scrolls
let scrollRAF = null;

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

async function showPicker(skipAutoLoad = false) {
  playerCleanup?.();
  playerCleanup = null;
  currentSong = null;
  if (audio) { audio.pause(); audio = null; }

  const results = await Promise.allSettled(
    songFolders.map(async (folder) => {
      const mod = await import(`./songs/${folder}/data.js`);
      return { ...mod.default, folder: `songs/${folder}` };
    })
  );
  const songs = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  if (results.some(r => r.status === 'rejected')) {
    const failed = results
      .map((r, i) => r.status === 'rejected' ? songFolders[i] : null)
      .filter(Boolean);
    console.warn('[LyricFlow] Failed to load songs:', failed);
  }

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
      <div class="song-list" id="songList"></div>
    </div>
  `;

  const list = document.getElementById('songList');
  songs.forEach((song, idx) => {
    const item = document.createElement('div');
    item.className = 'song-list-item';
    item.style.animationDelay = `${0.15 + idx * 0.07}s`;
    item.style.animation = 'fadeUp 0.45s var(--ease-out) both';
    item.innerHTML = `
      <span class="icon">${song.icon || '🎵'}</span>
      <div class="info">
        <div class="title">${song.title}</div>
        <div class="artist">${song.artist}</div>
      </div>
      <span class="arrow">→</span>
    `;
    item.addEventListener('click', () => loadSong(song));
    list.appendChild(item);
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

function loadSong(song) {
  playerCleanup?.();
  playerCleanup = null;
  currentSong = song;
  showTranslation = false;
  showLineNumbers = false;
  vocabMode = false;
  blanksMode = false;
  blanksAnswers = {};
  listeningMode = false;
  listeningWaiting = false;
  listeningCurrentBlank = null;
  listeningScore = { correct: 0, wrong: 0 };
  listeningBlanksMap = {};
  listeningPauseAt = null;
  listeningNextBlank = null;
  clearListeningTimer();
  loopA = null;
  loopB = null;
  loopActive = false;
  playbackRate = 1;
  currentSubIndex = -1;

  app.innerHTML = `
    <div class="song-header">
      <button class="back-btn" id="backBtn" aria-label="Volver">←</button>
      <div class="artwork">${song.icon || '🎵'}</div>
      <div class="song-meta">
        <div class="song-title">${song.title}</div>
        <div class="song-artist">${song.artist}</div>
      </div>
      <button class="picker-btn" id="playerThemeToggle" aria-label="Toggle theme">${document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'}</button>
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
    playbackRate = prefs.speed;
    if (audio) audio.playbackRate = playbackRate;
    const btn = document.getElementById('speedBtn');
    if (btn) btn.textContent = playbackRate === 1 ? '1×' : `${playbackRate}×`;
    btn?.classList.toggle('active', playbackRate !== 1);
  }
  if (audio) audio.volume = savedVolume;
  updateVolumeIcon(savedVolume);

  // Persist last song & mark session as active
  savePrefs({ lastSong: song.folder });
  sessionStorage.setItem('lyricflow_active', '1');
}

function bindPlayerEvents(song) {
  const controller = new AbortController();
  const { signal } = controller;
  playerCleanup = () => controller.abort();

  document.getElementById('backBtn').addEventListener('click', () => showPicker(true), { signal });
  document.getElementById('playerThemeToggle').addEventListener('click', () => {
    document.documentElement.classList.add('theme-transitioning');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme === 'dark' ? 'dark' : '');
    localStorage.setItem('lp-theme', newTheme);
    if (location.search.includes('theme=')) {
      const u = new URL(location.href); u.searchParams.set('theme', newTheme); history.replaceState(null, '', u);
    }
    document.getElementById('playerThemeToggle').textContent = isDark ? '🌙' : '☀️';
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
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
  audio = new Audio(mediaPath);
  audio.preload = 'metadata';
  audio.playbackRate = playbackRate;

  audio.addEventListener('error', () => {
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

  audio.addEventListener('loadedmetadata', () => {
    document.getElementById('durationTime').textContent = formatTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    document.getElementById('playBtn').textContent = '▶';
    isPlaying = false;
    stopUpdateLoop();
    document.getElementById('progressFill').style.width = '100%';
    cachedSubLines.forEach(el => el.classList.remove('active', 'past'));
    document.querySelector('.artwork')?.classList.remove('playing');
    currentSubIndex = -1;
    showSongEnd();
  });

  audio.addEventListener('timeupdate', () => {
    if (!isDragging) updateProgress();
  });
}

function togglePlay() {
  if (!audio) return;

  // In listening mode: don't resume while waiting for blank input
  if (listeningMode && listeningWaiting && audio.paused) {
    if (listeningCurrentBlank) listeningCurrentBlank.focus();
    return;
  }

  const artwork = document.querySelector('.artwork');
  if (audio.paused) {
    audio.play().catch(() => {});
    document.getElementById('playBtn').textContent = '⏸';
    document.getElementById('playBtn').setAttribute('aria-label', 'Pausar');
    isPlaying = true;
    startUpdateLoop();
    artwork?.classList.add('playing');
  } else {
    audio.pause();
    document.getElementById('playBtn').textContent = '▶';
    document.getElementById('playBtn').setAttribute('aria-label', 'Reproducir');
    isPlaying = false;
    stopUpdateLoop();
    artwork?.classList.remove('playing');
  }
}

// ─── Speed Control ─────────────────────────────────────────────────────────────

function cycleSpeed() {
  const currentIdx = SPEED_OPTIONS.indexOf(playbackRate);
  const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
  playbackRate = SPEED_OPTIONS[nextIdx];
  if (audio) audio.playbackRate = playbackRate;
  const btn = document.getElementById('speedBtn');
  btn.textContent = playbackRate === 1 ? '1×' : `${playbackRate}×`;
  btn.classList.toggle('active', playbackRate !== 1);
  savePrefs({ speed: playbackRate });
}

// ─── A-B Loop ──────────────────────────────────────────────────────────────────

function onLoopClick() {
  const btn = document.getElementById('loopBtn');
  const indicator = document.getElementById('loopIndicator');

  if (loopA === null) {
    // Set point A
    loopA = audio ? audio.currentTime : 0;
    btn.classList.add('setting');
    btn.textContent = 'A→';
    indicator.textContent = `A: ${formatTime(loopA)}`;
  } else if (loopB === null) {
    // Attempting to set B
    const currentTime = audio ? audio.currentTime : 0;
    if (currentTime <= loopA) {
      // Cancel: position is at or before A
      loopA = null;
      btn.classList.remove('setting');
      btn.textContent = '⟳';
      indicator.textContent = 'Cancelado';
      setTimeout(() => { if (!loopActive) indicator.textContent = ''; }, 1500);
      return;
    }
    loopB = currentTime;
    loopActive = true;
    btn.classList.remove('setting');
    btn.classList.add('active');
    btn.textContent = '⟳';
    indicator.textContent = `${formatTime(loopA)} → ${formatTime(loopB)}`;
    updateLoopRegion();
    if (audio) audio.currentTime = loopA;
  } else {
    // Clear loop
    loopA = null;
    loopB = null;
    loopActive = false;
    btn.classList.remove('active', 'setting');
    btn.textContent = '⟳';
    indicator.textContent = '';
    updateLoopRegion();
  }
}

function updateLoopRegion() {
  const region = document.getElementById('loopRegion');
  if (!region) return;
  if (loopActive && loopA !== null && loopB !== null && audio && audio.duration) {
    const leftPct = (loopA / audio.duration) * 100;
    const widthPct = ((loopB - loopA) / audio.duration) * 100;
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
  if (!loopActive || !audio || !audio.duration) return;
  e.stopPropagation();
  loopDragging = true;
  loopDragStartX = e.clientX ?? e.touches[0].clientX;
  loopDragStartA = loopA;
  loopDragStartB = loopB;
}

function onLoopRegionMove(e) {
  if (!loopDragging) return;
  e.preventDefault();
  const clientX = e.clientX ?? e.touches[0].clientX;
  const bar = document.getElementById('progressBar');
  const barWidth = bar.getBoundingClientRect().width;
  const dx = clientX - loopDragStartX;
  const dt = (dx / barWidth) * audio.duration;
  const duration = loopDragStartB - loopDragStartA;

  let newA = loopDragStartA + dt;
  let newB = newA + duration;

  // Clamp to bounds
  if (newA < 0) { newA = 0; newB = duration; }
  if (newB > audio.duration) { newB = audio.duration; newA = newB - duration; }

  loopA = newA;
  loopB = newB;
  updateLoopRegion();
  document.getElementById('loopIndicator').textContent = `${formatTime(loopA)} → ${formatTime(loopB)}`;
  if (audio.currentTime < loopA || audio.currentTime > loopB) {
    audio.currentTime = loopA;
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
  if (!audio || isDragging) return;
  const current = audio.currentTime;
  const duration = audio.duration || 0;

  // A-B loop enforcement (in rAF for higher precision than timeupdate)
  if (loopActive && loopA !== null && loopB !== null && current >= loopB) {
    audio.currentTime = loopA;
    return; // skip rest this frame, next frame will pick up from loopA
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
  if (listeningMode && listeningPauseAt !== null && current >= listeningPauseAt) {
    // If already answered (user typed fast before line ended), skip pause
    if (listeningCurrentBlank && !listeningCurrentBlank.classList.contains('lc-correct') && !listeningCurrentBlank.classList.contains('lc-wrong') && !listeningCurrentBlank.classList.contains('lc-timeout')) {
      if (listeningRepeatCount === 0) {
        // First play done — replay the line once more
        listeningRepeatCount = 1;
        audio.currentTime = listeningLineStart;
        // Re-schedule pause at end of this same line
        // listeningPauseAt stays the same value (recalculated from same endpoint)
      } else {
        // Second play done — now pause and start timer
        listeningPauseAt = null;
        listeningNextBlank = null;
        audio.pause();
        document.getElementById('playBtn').textContent = '▶';
        isPlaying = false;
        // Ensure line stays visually active
        const blankLine = listeningCurrentBlank.closest('.sub-line');
        if (blankLine) {
          cachedSubLines.forEach(el => el.classList.remove('active', 'past'));
          blankLine.classList.add('active');
        }
        // Focus & lc-active already set when line was highlighted; start timer now
        listeningCurrentBlank.focus();
        startListeningTimer(listeningCurrentBlank);
      }
    } else {
      listeningPauseAt = null;
      listeningNextBlank = null;
    }
  }
}

function startUpdateLoop() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  (function loop() {
    if (audio && !audio.paused) updateProgress();
    animationFrame = requestAnimationFrame(loop);
  })();
}

function stopUpdateLoop() {
  if (animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = null; }
}

function seekTo(clientX) {
  const bar = document.getElementById('progressBar');
  const rect = bar.getBoundingClientRect();
  const x = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  if (audio && audio.duration) {
    audio.currentTime = x * audio.duration;
    document.getElementById('progressFill').style.width = `${x * 100}%`;
    document.getElementById('currentTime').textContent = formatTime(audio.currentTime);
    updateSubtitles(audio.currentTime);
  }
}

function onProgressDown(e)       { if (!audio || loopDragging) return; isDragging = true; seekTo(e.clientX); }
function onProgressMove(e)        { if (isDragging && !loopDragging) seekTo(e.clientX); }
function onProgressUp()           { if (isDragging) { isDragging = false; if (audio) updateProgress(); } }
function onProgressTouchStart(e)  { if (!audio || loopDragging) return; isDragging = true; seekTo(e.touches[0].clientX); }
function onProgressTouchMove(e)   { if (isDragging && !loopDragging) { e.preventDefault(); seekTo(e.touches[0].clientX); } }
function onProgressTouchEnd()     { if (isDragging) { isDragging = false; if (audio) updateProgress(); } }

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
    if (blanksMode) {
      originalHtml = renderBlanksLine(sub.original, i);
    } else if (listeningMode) {
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
      if (selectMode) return;
      if (e.target.closest('.word-tap')) return;
      if (e.target.closest('.blank-input')) return;
      if (e.target.closest('.listening-input')) return;
      if (listeningMode) return;
      if (!audio) return;
      const offset = currentSong.offset || 0;
      audio.currentTime = sub.start + offset;
      if (audio.paused) {
        audio.play().catch(() => {});
        document.getElementById('playBtn').textContent = '⏸';
        isPlaying = true;
        startUpdateLoop();
        document.querySelector('.artwork')?.classList.add('playing');
      }
    });

    // Double click: loop this line
    line.addEventListener('dblclick', (e) => {
      if (selectMode || listeningMode || blanksMode) return;
      if (e.target.closest('.word-tap')) return;
      if (!audio) return;
      const offset = currentSong.offset || 0;
      loopA = sub.start + offset;
      loopB = loopA + sub.duration;
      loopActive = true;
      const loopBtn = document.getElementById('loopBtn');
      if (loopBtn) {
        loopBtn.classList.remove('setting');
        loopBtn.classList.add('active');
        loopBtn.textContent = '⟳';
      }
      const indicator = document.getElementById('loopIndicator');
      if (indicator) indicator.textContent = `${formatTime(loopA)} → ${formatTime(loopB)}`;
      updateLoopRegion();
      audio.currentTime = loopA;
      if (audio.paused) {
        audio.play().catch(() => {});
        document.getElementById('playBtn').textContent = '⏸';
        isPlaying = true;
        startUpdateLoop();
        document.querySelector('.artwork')?.classList.add('playing');
      }
    });

    container.appendChild(line);
  });

  // Cache nodeList for perf (avoid querySelectorAll every frame)
  cachedSubLines = [...container.querySelectorAll('.sub-line')];

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
  const currentDiff = mode === 'blanks' ? blanksDifficulty : listeningDifficulty;

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
      onSelect(diff);
    });
  });
}

// ─── Fill-in-the-Blanks ────────────────────────────────────────────────────────

function toggleBlanksMode() {
  // If active → deactivate
  if (blanksMode) {
    blanksMode = false;
    document.getElementById('toggleBlanksBtn').classList.remove('active');
    renderSubtitles(currentSong.subtitles);
    const toolbar = document.getElementById('blanksToolbar');
    if (toolbar) toolbar.remove();
    const picker = document.getElementById('difficultyPicker');
    if (picker) picker.remove();
    return;
  }

  // Show difficulty picker
  showDifficultyPicker('blanks', (diff) => {
    blanksDifficulty = diff;
    blanksMode = true;
    const btn = document.getElementById('toggleBlanksBtn');
    btn.classList.add('active');

    // Deactivate listening mode if active
    if (listeningMode) {
      listeningMode = false;
      document.getElementById('toggleListeningBtn').classList.remove('active');
      clearListeningTimer();
      listeningWaiting = false;
      listeningCurrentBlank = null;
      updateListeningToolbar();
    }

    blanksAnswers = {};
    blanksRevealed = false;
    if (showTranslation) toggleTranslation();

    renderSubtitles(currentSong.subtitles);

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
  const diff = DIFFICULTY[blanksDifficulty];

  // Pass 1 — score content-word candidates
  let wordIdx = 0;
  const candidates = [];
  tokens.forEach(token => {
    if (/^\s+$/.test(token)) return;
    const clean = token.toLowerCase().replace(STRIP, '');
    if (!clean || clean.length <= diff.minWordLen || STOP_WORDS.has(clean)) { wordIdx++; return; }
    const inVocab = vocabData?.some(v => v.word === clean) ?? false;
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
    const answered = blanksAnswers[key] || '';
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

  blanksAnswers[input.dataset.key] = input.value.trim();

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

    blanksAnswers[input.dataset.key] = input.value.trim();

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
      const saved = blanksAnswers[key] || '';
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
    blanksAnswers[input.dataset.key] = input.value.trim();

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
  blanksAnswers[input.dataset.key] = input.value.trim();
}

function onWordTap(e) {
  // Handle blank inputs
  if (e.target.closest('.blank-input')) {
    onBlankInput(e);
    return;
  }

  const wordEl = e.target.closest('.word-tap');
  if (!wordEl || selectMode) return;
  e.stopPropagation();

  const word = wordEl.dataset.word;
  if (!word) return;

  let translation = '';
  if (vocabData) {
    const entry = vocabData.find(v => v.word === word);
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
  if (!currentSong) return;
  const subs = currentSong.subtitles;
  const offset = currentSong.offset || 0;
  let activeIndex = -1;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i].start + offset;
    const e = s + subs[i].duration;
    if (time >= s && time < e) { activeIndex = i; break; }
  }
  if (activeIndex === currentSubIndex) return;
  currentSubIndex = activeIndex;

  const lines = cachedSubLines;
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
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    const target = lines[activeIndex];
    scrollRAF = requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      scrollRAF = null;
    });
  }

  // Announce current line to screen readers
  const srLive = document.getElementById('srLive');
  if (srLive && activeIndex !== -1) {
    srLive.textContent = currentSong.subtitles[activeIndex].original;
  }

  // Listening challenge: schedule pause at END of line so user hears it first
  // Focus the blank immediately so user can type while line plays
  if (listeningMode && activeIndex !== -1 && !listeningWaiting && listeningPauseAt === null) {
    const line = lines[activeIndex];
    const blank = line?.querySelector('.listening-input:not(.lc-correct):not(.lc-wrong):not(.lc-timeout)');
    if (blank) {
      const sub = subs[activeIndex];
      const offset = currentSong.offset || 0;
      listeningPauseAt = sub.start + offset + sub.duration;
      listeningLineStart = sub.start + offset;
      listeningRepeatCount = 0;
      listeningNextBlank = blank;
      // Activate input immediately — no waiting for audio to finish
      listeningWaiting = true;
      listeningCurrentBlank = blank;
      blank.focus();
      blank.classList.add('lc-active');
    }
  }
}

function toggleTranslation() {
  showTranslation = !showTranslation;
  document.getElementById('toggleTransBtn').classList.toggle('active', showTranslation);
  cachedSubLines.forEach(el => el.classList.toggle('show-trans', showTranslation));
}

function toggleSelectMode() {
  selectMode = !selectMode;
  document.getElementById('toggleSelectBtn').classList.toggle('active', selectMode);
  document.getElementById('subContainer').classList.toggle('select-mode', selectMode);
}

function toggleLineNumbers() {
  showLineNumbers = !showLineNumbers;
  const container = document.getElementById('subContainer');
  if (container) container.classList.toggle('show-line-numbers', showLineNumbers);
}

// ─── Listening Challenge Mode ──────────────────────────────────────────────────

function toggleListeningMode() {
  // If active → deactivate
  if (listeningMode) {
    listeningMode = false;
    document.getElementById('toggleListeningBtn').classList.remove('active');
    clearListeningTimer();
    listeningWaiting = false;
    listeningCurrentBlank = null;
    listeningPauseAt = null;
    listeningNextBlank = null;
    listeningRepeatCount = 0;
    listeningLineStart = null;
    renderSubtitles(currentSong.subtitles);
    updateListeningToolbar();
    return;
  }

  // Show difficulty picker
  showDifficultyPicker('listening', (diff) => {
    listeningDifficulty = diff;
    listeningMode = true;
    const btn = document.getElementById('toggleListeningBtn');
    btn.classList.add('active');

    // Deactivate static blanks if active
    if (blanksMode) {
      blanksMode = false;
      document.getElementById('toggleBlanksBtn').classList.remove('active');
      const toolbar = document.getElementById('blanksToolbar');
      if (toolbar) toolbar.remove();
    }

    listeningScore = { correct: 0, wrong: 0 };
    listeningBlanksMap = buildListeningBlanks();
    if (showTranslation) toggleTranslation();

    // Restart from beginning
    if (audio) {
      audio.currentTime = 0;
      audio.pause();
    }
    currentSubIndex = -1;
    listeningWaiting = false;
    document.getElementById('playBtn').textContent = '▶';
    isPlaying = false;
    stopUpdateLoop();

    renderSubtitles(currentSong.subtitles);
    updateListeningToolbar();
  });
}

function buildListeningBlanks() {
  const map = {};
  const subs = currentSong.subtitles;
  const diff = DIFFICULTY[listeningDifficulty];

  // Build set of vocab words (these are the pedagogically interesting ones)
  const vocabWords = new Set();
  if (vocabData && vocabData.length) {
    vocabData.forEach(v => vocabWords.add(v.word.toLowerCase()));
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
  const blanks = listeningBlanksMap[lineIndex];
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

  if (!listeningMode) return;

  const toolbar = document.createElement('div');
  toolbar.id = 'listeningToolbar';
  toolbar.className = 'listening-toolbar';
  toolbar.innerHTML = `
    <span class="lt-badge">🎧 Dictado</span>
    <span class="lt-score" id="listeningScoreEl"><span class="lt-correct">✓ 0</span><span class="lt-wrong">✗ 0</span></span>
    <span class="lt-hint">Escucha y completa — Enter para confirmar</span>
  `;
  const container = document.getElementById('subContainer');
  container.parentNode.insertBefore(toolbar, container);
}

function updateListeningScore() {
  const el = document.getElementById('listeningScoreEl');
  if (el) {
    el.innerHTML = `<span class="lt-correct">✓ ${listeningScore.correct}</span><span class="lt-wrong">✗ ${listeningScore.wrong}</span>`;
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
  listeningTimerId = setInterval(() => {
    elapsed += 50;
    const pct = Math.min((elapsed / (TIMEOUT * 1000)) * 100, 100);
    const fill = document.getElementById('lcTimerFill');
    if (fill) fill.style.width = `${pct}%`;

    if (elapsed >= TIMEOUT * 1000) {
      // Timeout — fail
      clearListeningTimer();
      listeningScore.wrong++;
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
  if (listeningTimerId) { clearInterval(listeningTimerId); listeningTimerId = null; }
  const bar = document.getElementById('lcTimerBar');
  if (bar) bar.remove();
}

function submitListeningAnswer() {
  if (!listeningWaiting || !listeningCurrentBlank) return;
  const input = listeningCurrentBlank;
  const answer = normalizeForCompare(input.dataset.answer);
  const value = normalizeForCompare(input.value);

  clearListeningTimer();
  input.classList.remove('lc-active');

  if (value === answer) {
    input.classList.add('lc-correct');
    listeningScore.correct++;
  } else {
    input.classList.add('lc-wrong');
    input.value = input.dataset.original;
    input.size = Math.max(input.dataset.original.length + 1, 4);
    listeningScore.wrong++;
  }

  input.readOnly = true;
  updateListeningScore();
  resumeListeningAfterDelay();
}

function resumeListeningAfterDelay() {
  // Save line index BEFORE clearing state
  const answeredLineIdx = listeningCurrentBlank?.dataset.line;
  listeningWaiting = false;
  listeningCurrentBlank = null;
  listeningPauseAt = null;
  listeningNextBlank = null;
  listeningRepeatCount = 0;
  listeningLineStart = null;

  // Check for another blank in the SAME line (identified by data-line, not .active class)
  // Using .active would pick up the next line if its start time coincides with the pause point
  if (answeredLineIdx !== undefined) {
    const nextBlank = document.querySelector(
      `.listening-input[data-line="${answeredLineIdx}"]:not(.lc-correct):not(.lc-wrong):not(.lc-timeout)`
    );
    if (nextBlank) {
      setTimeout(() => {
        listeningWaiting = true;
        listeningCurrentBlank = nextBlank;
        nextBlank.focus();
        nextBlank.classList.add('lc-active');
        startListeningTimer(nextBlank);
      }, 400);
      return;
    }
  }

  // Resume audio — reset currentSubIndex so updateSubtitles re-evaluates
  // the current line and can schedule listeningPauseAt for it
  currentSubIndex = -1;
  setTimeout(() => {
    if (audio && listeningMode) {
      audio.play().catch(() => {});
      document.getElementById('playBtn').textContent = '⏸';
      isPlaying = true;
      startUpdateLoop();
      document.querySelector('.artwork')?.classList.add('playing');
    }
  }, 600);
}

// ─── Vocabulary ────────────────────────────────────────────────────────────────

async function loadVocab(song) {
  try {
    const mod = await import(`./${song.folder}/vocab.js`);
    vocabData = mod.default;
  } catch {
    vocabData = [];
  }
}

function toggleVocabMode() {
  if (!currentSong || !vocabData) return;
  showVocabView(currentSong);
}

function showVocabView(song) {
  vocabMode = true;
  if (audio && !audio.paused) {
    audio.pause();
    isPlaying = false;
    stopUpdateLoop();
  }

  app.innerHTML = `
    <div class="vocab-view">
      <div class="vocab-header">
        <button class="back-btn" id="vocabBackBtn" aria-label="Volver al player">←</button>
        <div class="vocab-header-meta">
          <div class="vocab-header-title">${song.title}</div>
          <div class="vocab-header-subtitle">${vocabData.length} palabras</div>
        </div>
      </div>
      <div class="vocab-filter">
        <input type="text" id="vocabFilter" class="vocab-filter-input" placeholder="Filtrar palabras…" autocomplete="off" />
      </div>
      <div class="vocab-container" id="vocabContainer"></div>
      <div class="vocab-detail" id="vocabDetail" hidden>
        <div class="vocab-detail-word" id="detailWord"></div>
        <div class="vocab-detail-body">
          <div class="vocab-detail-section">
            <span class="vocab-detail-label">Traducción</span>
            <div class="vocab-detail-value" id="detailTranslation"></div>
          </div>
          <div class="vocab-detail-section">
            <span class="vocab-detail-label">Ejemplo</span>
            <div class="vocab-detail-example" id="detailExample"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('vocabBackBtn').addEventListener('click', () => {
    vocabMode = false;
    loadSong(song);
  });

  document.getElementById('vocabFilter').addEventListener('input', (e) => {
    renderVocab(e.target.value.trim().toLowerCase());
  });

  renderVocab();
}

function renderVocab(filter = '') {
  const container = document.getElementById('vocabContainer');
  container.innerHTML = '';

  const filtered = filter
    ? vocabData.filter(entry =>
        entry.word.includes(filter) ||
        entry.translation.toLowerCase().includes(filter)
      )
    : vocabData;

  filtered.forEach((entry) => {
    const chip = document.createElement('span');
    chip.className = 'vocab-chip';
    chip.dataset.word = entry.word;
    chip.dataset.lines = JSON.stringify(entry.lines);
    chip.textContent = entry.word;
    chip.addEventListener('click', onVocabTap);
    container.appendChild(chip);
  });
}

function onVocabTap(e) {
  const word = e.currentTarget.dataset.word;

  document.querySelectorAll('.vocab-chip.selected').forEach(el => el.classList.remove('selected'));
  e.currentTarget.classList.add('selected');

  const entry = vocabData.find(v => v.word === word);
  const detail = document.getElementById('vocabDetail');
  const detailWord = document.getElementById('detailWord');
  const detailTrans = document.getElementById('detailTranslation');
  const detailExample = document.getElementById('detailExample');

  detailWord.textContent = word;
  detailTrans.textContent = '';
  detailExample.innerHTML = '';

  if (entry && entry.translation) {
    detailTrans.textContent = entry.translation;
  }

  if (entry && entry.examples && entry.examples.length > 0) {
    const ex = entry.examples[0];
    detailExample.innerHTML = `
      <span class="detail-original">${ex.original}</span>
      <span class="detail-trans">${ex.translation}</span>
    `;
  }

  detail.hidden = false;
}

// ─── Song End ──────────────────────────────────────────────────────────────────

function showSongEnd() {
  const container = document.getElementById('subContainer');
  if (!container) return;

  // Remove previous fin card if any
  container.querySelector('.song-fin-card')?.remove();

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

  // Score summary if blanks mode was active
  const scoreEl = document.getElementById('blanksScore');
  if (blanksMode && scoreEl && scoreEl.textContent) {
    const scoreNote = document.createElement('p');
    scoreNote.className = 'song-fin-score';
    scoreNote.textContent = scoreEl.textContent;
    fin.insertBefore(scoreNote, backBtn);
  }

  container.appendChild(fin);
  fin.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── Culture View ──────────────────────────────────────────────────────────────

function showCultureView(song) {
  if (audio && !audio.paused) {
    audio.pause();
    isPlaying = false;
    stopUpdateLoop();
  }

  const c = song.culture;
  const factsHtml = c.funFacts
    ? c.funFacts.map(f => `<li>${f}</li>`).join('')
    : '';

  app.innerHTML = `
    <div class="culture-view">
      <div class="culture-header">
        <button class="back-btn" id="cultureBackBtn" aria-label="Volver al player">←</button>
        <div class="culture-header-meta">
          <div class="culture-header-title">${song.title}</div>
          <div class="culture-header-subtitle">Contexto cultural</div>
        </div>
      </div>
      <div class="culture-content">
        <div class="culture-section">
          <div class="culture-section-label">Artista</div>
          <p class="culture-section-text">${c.artist}</p>
        </div>
        <div class="culture-section">
          <div class="culture-section-label">La canción</div>
          <p class="culture-section-text">${c.song}</p>
        </div>
        <div class="culture-section">
          <div class="culture-section-label">El idioma</div>
          <p class="culture-section-text">${c.language}</p>
        </div>
        ${factsHtml ? `
        <div class="culture-section">
          <div class="culture-section-label">Datos curiosos</div>
          <ul class="culture-facts">${factsHtml}</ul>
        </div>
        ` : ''}
      </div>
    </div>
  `;

  document.getElementById('cultureBackBtn').addEventListener('click', () => loadSong(song));
}

// ─── Volume ────────────────────────────────────────────────────────────────────

let savedVolume = loadPrefs().volume ?? 1;

function onVolumeChange(e) {
  const vol = parseFloat(e.target.value);
  if (audio) audio.volume = vol;
  savedVolume = vol;
  updateVolumeIcon(vol);
  savePrefs({ volume: vol });
}

function toggleMute() {
  if (!audio) return;
  const slider = document.getElementById('volumeSlider');
  if (audio.volume > 0) {
    savedVolume = audio.volume;
    audio.volume = 0;
    slider.value = 0;
    updateVolumeIcon(0);
  } else {
    audio.volume = savedVolume || 1;
    slider.value = audio.volume;
    updateVolumeIcon(audio.volume);
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
    if (e.key === 'Enter' && listeningWaiting && listeningCurrentBlank) {
      e.preventDefault();
      submitListeningAnswer();
    }
    return;
  }

  // Progress bar keyboard control (when focused)
  if (e.target.id === 'progressBar' && audio && audio.duration) {
    const step = e.shiftKey ? 10 : 5;
    if (e.key === 'ArrowRight') { e.preventDefault(); audio.currentTime = Math.min(audio.currentTime + step, audio.duration); updateProgress(); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); audio.currentTime = Math.max(audio.currentTime - step, 0); updateProgress(); return; }
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
  if (e.key === 'Enter' && e.target.classList.contains('blank-input') && blanksMode) {
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

  function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.textContent = isDark ? '☀️' : '🌙';
  }
  updateThemeIcon();

  themeBtn.addEventListener('click', () => {
    document.documentElement.classList.add('theme-transitioning');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme === 'dark' ? 'dark' : '');
    localStorage.setItem('lp-theme', newTheme);
    if (location.search.includes('theme=')) {
      const u = new URL(location.href); u.searchParams.set('theme', newTheme); history.replaceState(null, '', u);
    }
    updateThemeIcon();
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
  });

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

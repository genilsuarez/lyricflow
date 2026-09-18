// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Fin de canción y modales de resultados (Blanks / Listening)
// Extraído de player.js. Mismo patrón que quiz.js: importa `state` y las
// acciones del player desde player.js (import circular: solo al llamar).
// ═══════════════════════════════════════════════════════════════════════════════

import {
  state, loadPrefs, updateSongProgressUi, showDashboard, showPicker, loadSong,
  playAudio, renderSubtitles, toggleBlanksMode, toggleListeningMode,
  buildListeningBlanks, updateListeningToolbar,
} from './player.js';
import pickerSongs from '../songs/picker-data.js';
import { toggleQuizMode } from './quiz.js';
import { createRunId, getSongProgress, recordActivityResult } from './progress.js';
import { normalizeForCompare } from './blanks-engine.js';
// ─── Song End ──────────────────────────────────────────────────────────────────

export function showSongEnd() {
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
    state.blanksRevealed = false;
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

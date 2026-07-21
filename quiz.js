// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Mini Quiz de vocabulario
// Reutiliza los campos enriquecidos de cada songs/<Song>/vocab.js (translation,
// synonyms, antonyms, formalEquivalent, examples) para armar preguntas de opción
// múltiple. Sigue el mismo patrón que vocab-culture.js: vista propia sobre `app`,
// vuelve al player vía loadSong.
// ═══════════════════════════════════════════════════════════════════════════════

import { state, app, loadSong, stopUpdateLoop, updateToolbarActiveState, updateSongProgressUi, showLessonCompleteModal } from './player.js';
import { createRunId, recordActivityResult, getSongProgress } from './progress.js';

const TARGET_QUESTIONS = 5;
const MIN_QUESTIONS = 4; // mínimo de entradas de vocab para poder armar 3 distractores

const TYPE_LABEL = {
  translation: 'Traducción',
  synonym: 'Sinónimo',
  antonym: 'Antónimo',
  formal: 'Registro formal',
};

let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let quizRunId = null;
let quizKeyHandler = null;

export function toggleQuizMode() {
  if (!state.currentSong) return;
  showQuizView(state.currentSong);
}

function showQuizView(song) {
  if (state.audio && !state.audio.paused) {
    state.audio.pause();
    stopUpdateLoop();
  }

  quizQuestions = selectQuestions(buildPool(state.vocabData));
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  quizRunId = createRunId('quiz');

  updateToolbarActiveState('quiz');
  const content = document.getElementById('modeContent');
  content.innerHTML = `
    <div class="quiz-view">
      <div class="quiz-header">
        <div class="quiz-header-meta">
          <div class="quiz-header-title">${song.title}</div>
          <div class="quiz-header-subtitle" id="quizProgress">Mini Quiz</div>
        </div>
      </div>
      <div class="quiz-progress-bar"><div class="quiz-progress-fill" id="quizProgressFill" style="width:0%"></div></div>
      <div class="quiz-body" id="quizBody"></div>
    </div>
  `;

  if (quizQuestions.length < MIN_QUESTIONS) {
    document.getElementById('quizBody').innerHTML = `
      <div class="quiz-empty">Todavía no hay suficiente vocabulario enriquecido en esta canción para armar un quiz.</div>
    `;
    return;
  }

  renderQuizQuestion();
}

// ─── Preguntas ─────────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickDistractors(values, exclude, count, alsoExclude = null) {
  const unique = [...new Set(values.filter(v => v && v !== exclude && v !== alsoExclude))];
  return shuffle(unique).slice(0, count);
}

function makeQuestion(type, word, prompt, answer, distractors) {
  const uniqueDistractors = [...new Set(distractors.filter(d => d && d !== answer))];
  if (uniqueDistractors.length < 3) return null;
  const options = shuffle([answer, ...uniqueDistractors.slice(0, 3)]);
  return { type, word, prompt, answer, options, correctIndex: options.indexOf(answer) };
}

function buildPool(vocabData) {
  if (!vocabData || vocabData.length < MIN_QUESTIONS) return [];

  const allWords = vocabData.map(e => e.word);
  const allTranslations = vocabData.map(e => e.translation).filter(Boolean);
  const pool = [];

  vocabData.forEach(entry => {
    if (entry.translation) {
      const distractors = pickDistractors(allTranslations, entry.translation, 3);
      const q = makeQuestion('translation', entry.word, `¿Qué significa "${entry.word}"?`, entry.translation, distractors);
      if (q) pool.push(q);
    }

    if (entry.synonyms?.length) {
      const answer = entry.synonyms[Math.floor(Math.random() * entry.synonyms.length)];
      const distractors = pickDistractors(allWords, entry.word, 3, answer);
      const q = makeQuestion('synonym', entry.word, `¿Cuál es sinónimo de "${entry.word}"?`, answer, distractors);
      if (q) pool.push(q);
    }

    if (entry.antonyms?.length) {
      const answer = entry.antonyms[Math.floor(Math.random() * entry.antonyms.length)];
      const distractors = pickDistractors(allWords, entry.word, 3, answer);
      const q = makeQuestion('antonym', entry.word, `¿Cuál es el opuesto de "${entry.word}"?`, answer, distractors);
      if (q) pool.push(q);
    }

    if (entry.type === 'phrasal' && entry.formalEquivalent) {
      const distractors = pickDistractors(allWords, entry.word, 3, entry.formalEquivalent);
      const q = makeQuestion('formal', entry.word, `¿Cuál es el equivalente formal de "${entry.word}"?`, entry.formalEquivalent, distractors);
      if (q) pool.push(q);
    }
  });

  return pool;
}

// Hasta TARGET_QUESTIONS, sin repetir palabra (variedad sobre todo el vocabulario).
function selectQuestions(pool) {
  const used = new Set();
  const selected = [];
  for (const q of shuffle(pool)) {
    if (used.has(q.word)) continue;
    used.add(q.word);
    selected.push(q);
    if (selected.length >= TARGET_QUESTIONS) break;
  }
  return selected;
}

// ─── Render ────────────────────────────────────────────────────────────────────

function renderQuizQuestion() {
  quizAnswered = false;
  const q = quizQuestions[quizIndex];
  const total = quizQuestions.length;
  document.getElementById('quizProgress').textContent = `Pregunta ${quizIndex + 1} / ${total}`;
  const progressFill = document.getElementById('quizProgressFill');
  if (progressFill) progressFill.style.width = `${((quizIndex) / total) * 100}%`;

  document.getElementById('quizBody').innerHTML = `
    <div class="quiz-card">
      <span class="quiz-type-badge">${TYPE_LABEL[q.type]}</span>
      <p class="quiz-prompt">${q.prompt}</p>
    </div>
    <div class="quiz-options" id="quizOptions">
      ${q.options.map((opt, i) => `<button class="quiz-option" data-index="${i}" data-letter="${i + 1}">${opt}</button>`).join('')}
    </div>
  `;
  // Render next button outside the scrollable quiz-body so it never gets clipped
  let nextBtnContainer = document.getElementById('quizNextBtnContainer');
  if (!nextBtnContainer) {
    nextBtnContainer = document.createElement('div');
    nextBtnContainer.id = 'quizNextBtnContainer';
    nextBtnContainer.className = 'quiz-next-container';
    document.getElementById('quizBody').after(nextBtnContainer);
  }
  nextBtnContainer.innerHTML = `<button class="lp-btn lp-btn--primary quiz-next-btn quiz-next-btn--hidden" id="quizNextBtn">Siguiente →</button>`;
  document.getElementById('quizBody').scrollTop = 0;

  document.querySelectorAll('.quiz-option').forEach(btn => btn.addEventListener('click', onOptionClick));

  // Keyboard shortcut: 1–4 selects option
  quizKeyHandler = (e) => {
    if (quizAnswered) return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= q.options.length) {
      const btn = document.querySelector(`.quiz-option[data-index="${num - 1}"]`);
      if (btn) btn.click();
    }
  };
  document.addEventListener('keydown', quizKeyHandler);
}

function onOptionClick(e) {
  if (quizAnswered) return;
  quizAnswered = true;

  // Remove keyboard shortcut listener
  if (quizKeyHandler) {
    document.removeEventListener('keydown', quizKeyHandler);
    quizKeyHandler = null;
  }

  // Lock scroll position to prevent jump on DOM mutations
  const quizBody = document.getElementById('quizBody');
  const scrollTop = quizBody.scrollTop;
  quizBody.style.overflow = 'hidden';

  const q = quizQuestions[quizIndex];
  const chosenIdx = Number(e.currentTarget.dataset.index);
  const correctIdx = q.correctIndex ?? q.options.indexOf(q.answer);
  if (chosenIdx === correctIdx) quizScore++;

  // Update progress bar to current completed question
  const total = quizQuestions.length;
  const progressFill = document.getElementById('quizProgressFill');
  if (progressFill) progressFill.style.width = `${((quizIndex + 1) / total) * 100}%`;

  const optionsEl = document.getElementById('quizOptions');
  optionsEl.querySelectorAll('.quiz-option').forEach((btn, i) => {
    btn.disabled = true;
    if (i === correctIdx) btn.classList.add('quiz-option--correct');
    else if (i === chosenIdx) btn.classList.add('quiz-option--wrong');
  });

  const isLast = quizIndex === quizQuestions.length - 1;
  const nextBtn = document.getElementById('quizNextBtn');
  nextBtn.textContent = isLast ? 'Ver resultado →' : 'Siguiente →';
  nextBtn.classList.remove('quiz-next-btn--hidden');
  nextBtn.addEventListener('click', () => {
    quizIndex++;
    if (quizIndex < quizQuestions.length) renderQuizQuestion();
    else renderQuizResults();
  });
  nextBtn.focus({ preventScroll: true });

  // Enter key advances to next question
  quizKeyHandler = (e) => {
    if (e.key === 'Enter') {
      document.removeEventListener('keydown', quizKeyHandler);
      quizKeyHandler = null;
      nextBtn.click();
    }
  };
  document.addEventListener('keydown', quizKeyHandler);

  // Restore scroll after DOM settles
  requestAnimationFrame(() => {
    quizBody.scrollTop = scrollTop;
    quizBody.style.overflow = '';
  });
}

function renderQuizResults() {
  const total = quizQuestions.length;
  const pct = total > 0 ? Math.round((quizScore / total) * 100) : 0;

  recordActivityResult({
    contentId: state.currentSong.id,
    title: state.currentSong.title,
    activity: 'quiz',
    scorePct: pct,
    correct: quizScore,
    total,
    runId: quizRunId,
  });
  updateSongProgressUi(state.currentSong.id);

  // Check if this completed the entire song
  const songProgress = getSongProgress(state.currentSong.id);
  if (songProgress.completed) {
    showLessonCompleteModal('quizResultsModal', pct, quizScore, total);
    return;
  }

  let emoji, message;
  if (pct >= 80) { emoji = '🏆'; message = 'Dominas este vocabulario'; }
  else if (pct >= 50) { emoji = '👍'; message = 'Buen progreso'; }
  else { emoji = '💪'; message = 'Sigue repasando'; }

  // SVG ring circumference: 2 * pi * 40 = 251.2
  const circumference = 251.2;
  const offset = circumference - (circumference * pct / 100);

  // Determine next action label based on pending activities
  const nextLabel = getQuizNextLabel(songProgress);

  document.getElementById('quizProgress').textContent = 'Resultado';
  // Remove external next-btn container (results have their own buttons)
  const nextBtnContainer = document.getElementById('quizNextBtnContainer');
  if (nextBtnContainer) nextBtnContainer.remove();
  const quizBody = document.getElementById('quizBody');
  quizBody.innerHTML = `
    <div class="quiz-results">
      <div class="quiz-score-ring">
        <svg viewBox="0 0 100 100">
          <circle class="ring-bg" cx="50" cy="50" r="40"/>
          <circle class="ring-fill" cx="50" cy="50" r="40" id="quizRingFill"/>
        </svg>
        <div class="ring-label">${emoji}</div>
      </div>
      <div class="quiz-results-score">${quizScore}/${total}</div>
      <div class="quiz-results-pct">${pct}% correcto</div>
      <p class="quiz-results-message">${message}</p>
      <div class="quiz-results-actions">
        <button class="lp-btn lp-btn--ghost" id="quizRetryBtn">↻ Otra ronda</button>
        <button class="lp-btn lp-btn--primary" id="quizNextBtn">${nextLabel}</button>
      </div>
    </div>
  `;
  quizBody.scrollTop = 0;

  // Animate ring after DOM paint
  requestAnimationFrame(() => {
    const ring = document.getElementById('quizRingFill');
    if (ring) ring.style.strokeDashoffset = offset;
  });

  document.getElementById('quizRetryBtn').addEventListener('click', () => showQuizView(state.currentSong));
  document.getElementById('quizNextBtn').addEventListener('click', () => loadSong(state.currentSong));
}

function getQuizNextLabel(songProgress) {
  // If only listen is pending and the 3 challenges are done, just say "Reproductor"
  const pending = ['listen', 'dictation', 'challenge'].filter(
    a => !songProgress.activities[a].completed
  );
  if (pending.length === 0 || (pending.length === 1 && pending[0] === 'listen')) {
    return 'Reproductor →';
  }
  if (pending.includes('dictation')) return '🎧 Dictado →';
  if (pending.includes('challenge')) return '✎ Huecos →';
  return 'Reproductor →';
}

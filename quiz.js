// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Mini Quiz de vocabulario
// Reutiliza los campos enriquecidos de cada songs/<Song>/vocab.js (translation,
// synonyms, antonyms, formalEquivalent, examples) para armar preguntas de opción
// múltiple. Sigue el mismo patrón que vocab-culture.js: vista propia sobre `app`,
// vuelve al player vía loadSong.
// ═══════════════════════════════════════════════════════════════════════════════

import { state, app, loadSong, stopUpdateLoop } from './player.js';

const TARGET_QUESTIONS = 10;
const MIN_QUESTIONS = 4; // también: mínimo de entradas de vocab para poder armar 3 distractores

const TYPE_LABEL = {
  translation: 'Traducción',
  synonym: 'Sinónimo',
  antonym: 'Antónimo',
  formal: 'Registro formal',
  context: 'Contexto',
};

let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;

export function toggleQuizMode() {
  if (!state.currentSong) return;
  showQuizView(state.currentSong);
}

function showQuizView(song) {
  if (state.audio && !state.audio.paused) {
    state.audio.pause();
    state.isPlaying = false;
    stopUpdateLoop();
  }

  quizQuestions = selectQuestions(buildPool(state.vocabData));
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;

  app.innerHTML = `
    <div class="quiz-view">
      <div class="quiz-header">
        <button class="back-btn" id="quizBackBtn" aria-label="Volver al player">←</button>
        <div class="quiz-header-meta">
          <div class="quiz-header-title">${song.title}</div>
          <div class="quiz-header-subtitle" id="quizProgress">Mini Quiz</div>
        </div>
      </div>
      <div class="quiz-progress-bar"><div class="quiz-progress-fill" id="quizProgressFill" style="width:0%"></div></div>
      <div class="quiz-body" id="quizBody"></div>
    </div>
  `;

  document.getElementById('quizBackBtn').addEventListener('click', () => loadSong(song));

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

function pickDistractors(values, exclude, count) {
  const unique = [...new Set(values.filter(v => v && v !== exclude))];
  return shuffle(unique).slice(0, count);
}

function makeQuestion(type, word, prompt, answer, distractors) {
  return { type, word, prompt, answer, options: shuffle([answer, ...distractors]) };
}

// Tacha la palabra dentro de la línea de ejemplo (para preguntas de contexto).
// Si la palabra no aparece literalmente (formas conjugadas: "rise up" -> "Rising up"),
// no hay línea válida y esa entrada simplemente no genera pregunta de contexto.
function blankLine(line, word) {
  const idx = line.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return null;
  return `${line.slice(0, idx)}____${line.slice(idx + word.length)}`;
}

function buildPool(vocabData) {
  if (!vocabData || vocabData.length < MIN_QUESTIONS) return [];

  const allWords = vocabData.map(e => e.word);
  const allTranslations = vocabData.map(e => e.translation).filter(Boolean);
  const pool = [];

  vocabData.forEach(entry => {
    if (entry.translation) {
      const distractors = pickDistractors(allTranslations, entry.translation, 3);
      if (distractors.length === 3) {
        pool.push(makeQuestion('translation', entry.word, `¿Qué significa "${entry.word}"?`, entry.translation, distractors));
      }
    }

    if (entry.synonyms?.length) {
      const answer = entry.synonyms[Math.floor(Math.random() * entry.synonyms.length)];
      const distractors = pickDistractors(allWords, entry.word, 3);
      if (distractors.length === 3) {
        pool.push(makeQuestion('synonym', entry.word, `¿Cuál es sinónimo de "${entry.word}"?`, answer, distractors));
      }
    }

    if (entry.antonyms?.length) {
      const answer = entry.antonyms[Math.floor(Math.random() * entry.antonyms.length)];
      const distractors = pickDistractors(allWords, entry.word, 3);
      if (distractors.length === 3) {
        pool.push(makeQuestion('antonym', entry.word, `¿Cuál es el opuesto de "${entry.word}"?`, answer, distractors));
      }
    }

    if (entry.type === 'phrasal' && entry.formalEquivalent) {
      const distractors = pickDistractors(allWords, entry.word, 3);
      if (distractors.length === 3) {
        pool.push(makeQuestion('formal', entry.word, `¿Cuál es el equivalente formal de "${entry.word}"?`, entry.formalEquivalent, distractors));
      }
    }

    if (entry.examples?.length) {
      const blanked = blankLine(entry.examples[0].original, entry.word);
      if (blanked) {
        const distractors = pickDistractors(allWords, entry.word, 3);
        if (distractors.length === 3) {
          pool.push(makeQuestion('context', entry.word, blanked, entry.word, distractors));
        }
      }
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
  const letters = ['A', 'B', 'C', 'D'];

  document.getElementById('quizProgress').textContent = `Pregunta ${quizIndex + 1} / ${total}`;
  const progressFill = document.getElementById('quizProgressFill');
  if (progressFill) progressFill.style.width = `${((quizIndex) / total) * 100}%`;

  document.getElementById('quizBody').innerHTML = `
    <div class="quiz-card">
      <span class="quiz-type-badge">${TYPE_LABEL[q.type]}</span>
      <p class="quiz-prompt">${q.prompt}</p>
    </div>
    <div class="quiz-options" id="quizOptions">
      ${q.options.map((opt, i) => `<button class="quiz-option" data-index="${i}" data-letter="${letters[i] || ''}">${opt}</button>`).join('')}
    </div>
  `;

  document.querySelectorAll('.quiz-option').forEach(btn => btn.addEventListener('click', onOptionClick));
}

function onOptionClick(e) {
  if (quizAnswered) return;
  quizAnswered = true;

  const q = quizQuestions[quizIndex];
  const chosenIdx = Number(e.currentTarget.dataset.index);
  if (q.options[chosenIdx] === q.answer) quizScore++;

  // Update progress bar to current completed question
  const total = quizQuestions.length;
  const progressFill = document.getElementById('quizProgressFill');
  if (progressFill) progressFill.style.width = `${((quizIndex + 1) / total) * 100}%`;

  const optionsEl = document.getElementById('quizOptions');
  optionsEl.querySelectorAll('.quiz-option').forEach((btn, i) => {
    btn.disabled = true;
    if (q.options[i] === q.answer) btn.classList.add('quiz-option--correct');
    else if (i === chosenIdx) btn.classList.add('quiz-option--wrong');
  });

  const isLast = quizIndex === quizQuestions.length - 1;
  const nextBtn = document.createElement('button');
  nextBtn.className = 'lp-btn lp-btn--primary quiz-next-btn';
  nextBtn.textContent = isLast ? 'Ver resultado →' : 'Siguiente →';
  nextBtn.addEventListener('click', () => {
    quizIndex++;
    if (quizIndex < quizQuestions.length) renderQuizQuestion();
    else renderQuizResults();
  });
  optionsEl.after(nextBtn);
  nextBtn.focus();
}

function renderQuizResults() {
  const total = quizQuestions.length;
  const pct = total > 0 ? Math.round((quizScore / total) * 100) : 0;

  let emoji, message;
  if (pct >= 80) { emoji = '🏆'; message = 'Dominas este vocabulario'; }
  else if (pct >= 50) { emoji = '👍'; message = 'Buen progreso'; }
  else { emoji = '💪'; message = 'Sigue repasando'; }

  // SVG ring circumference: 2 * pi * 40 = 251.2
  const circumference = 251.2;
  const offset = circumference - (circumference * pct / 100);

  document.getElementById('quizProgress').textContent = 'Resultado';
  document.getElementById('quizBody').innerHTML = `
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
        <button class="lp-btn lp-btn--primary" id="quizRetryBtn">↻ Otra ronda</button>
        <button class="lp-btn lp-btn--ghost" id="quizBackBtn2">← Volver</button>
      </div>
    </div>
  `;

  // Animate ring after DOM paint
  requestAnimationFrame(() => {
    const ring = document.getElementById('quizRingFill');
    if (ring) ring.style.strokeDashoffset = offset;
  });

  document.getElementById('quizRetryBtn').addEventListener('click', () => showQuizView(state.currentSong));
  document.getElementById('quizBackBtn2').addEventListener('click', () => loadSong(state.currentSong));
}

// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Vocabulary panel + Culture panel
// Split out of player.js (2026-07-10): these two views are the only sections
// with narrow coupling to the rest of the player (they just read `state` and
// call back into `loadSong`/`stopUpdateLoop` to return to the player view).
// ═══════════════════════════════════════════════════════════════════════════════

import { state, app, loadSong, stopUpdateLoop } from './player.js';

// ─── Vocabulary ────────────────────────────────────────────────────────────────

export async function loadVocab(song) {
  try {
    const mod = await import(`./${song.folder}/vocab.js`);
    state.vocabData = mod.default;
  } catch {
    state.vocabData = [];
  }
}

export function toggleVocabMode() {
  if (!state.currentSong || !state.vocabData) return;
  showVocabView(state.currentSong);
}

function showVocabView(song) {
  state.vocabMode = true;
  if (state.audio && !state.audio.paused) {
    state.audio.pause();
    state.isPlaying = false;
    stopUpdateLoop();
  }

  app.innerHTML = `
    <div class="vocab-view">
      <div class="vocab-header">
        <button class="back-btn" id="vocabBackBtn" aria-label="Volver al player">←</button>
        <div class="vocab-header-meta">
          <div class="vocab-header-title">${song.title}</div>
          <div class="vocab-header-subtitle">${state.vocabData.length} palabras</div>
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
          <div class="vocab-detail-section" id="detailAltSection" hidden>
            <span class="vocab-detail-label">Otro significado</span>
            <div class="vocab-alt-meaning" id="detailAltMeaning"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('vocabBackBtn').addEventListener('click', () => {
    state.vocabMode = false;
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
    ? state.vocabData.filter(entry =>
        entry.word.includes(filter) ||
        entry.translation.toLowerCase().includes(filter)
      )
    : state.vocabData;

  filtered.forEach((entry) => {
    const chip = document.createElement('span');
    chip.className = 'vocab-chip';
    chip.dataset.word = entry.word;
    chip.dataset.lines = JSON.stringify(entry.lines);
    chip.textContent = entry.word;
    if (entry.type === 'phrasal') chip.classList.add('vocab-chip--phrasal');
    chip.addEventListener('click', onVocabTap);
    container.appendChild(chip);
  });
}

function onVocabTap(e) {
  const word = e.currentTarget.dataset.word;

  document.querySelectorAll('.vocab-chip.selected').forEach(el => el.classList.remove('selected'));
  e.currentTarget.classList.add('selected');

  const entry = state.vocabData.find(v => v.word === word);
  const detail = document.getElementById('vocabDetail');
  const detailWord = document.getElementById('detailWord');
  const detailTrans = document.getElementById('detailTranslation');
  const detailExample = document.getElementById('detailExample');
  const detailAltSection = document.getElementById('detailAltSection');
  const detailAltMeaning = document.getElementById('detailAltMeaning');

  detailWord.innerHTML = entry && entry.type === 'phrasal'
    ? `${word}<span class="vocab-type-badge">phrasal verb</span>`
    : word;
  detailTrans.textContent = '';
  detailExample.innerHTML = '';
  detailAltMeaning.textContent = '';
  detailAltSection.hidden = true;

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

  if (entry && entry.altMeaning) {
    detailAltMeaning.textContent = entry.altMeaning;
    detailAltSection.hidden = false;
  }

  detail.hidden = false;
}

// ─── Culture View ──────────────────────────────────────────────────────────────

export function showCultureView(song) {
  if (state.audio && !state.audio.paused) {
    state.audio.pause();
    state.isPlaying = false;
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

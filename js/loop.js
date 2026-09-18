// ═══════════════════════════════════════════════════════════════════════════════
// LYRICFLOW — Bucle A-B (botón, región visual y arrastre de los extremos)
// Extraído de player.js. `loopDragging` se exporta como binding vivo: la barra
// de progreso lo lee para no iniciar un seek mientras se arrastra la región.
// ═══════════════════════════════════════════════════════════════════════════════

import { state, formatTime } from './player.js';
// ─── A-B Loop ──────────────────────────────────────────────────────────────────

export function disableLoopBtn() {
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

export function enableLoopBtn() {
  const btn = document.getElementById('loopBtn');
  if (btn) btn.disabled = false;
}

export function onLoopClick() {
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

export function updateLoopRegion() {
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

export let loopDragging = false;
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

export function bindLoopRegionDrag(signal) {
  const region = document.getElementById('loopRegion');
  if (!region) return;
  region.addEventListener('mousedown', onLoopRegionDown, { signal });
  region.addEventListener('touchstart', (e) => { onLoopRegionDown(e); }, { passive: false, signal });
  window.addEventListener('mousemove', onLoopRegionMove, { signal });
  window.addEventListener('touchmove', onLoopRegionMove, { passive: false, signal });
  window.addEventListener('mouseup', onLoopRegionUp, { signal });
  window.addEventListener('touchend', onLoopRegionUp, { signal });
}

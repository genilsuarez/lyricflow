// ═══════════════════════════════════════════════════════════════════════════════
// LyricFlow — Stats View
// Full-page statistics view (inline, not modal) accessible from the picker.
// ═══════════════════════════════════════════════════════════════════════════════

import pickerSongs from './songs/picker-data.js';
import { getProgress, getSongProgress, progressConfig } from './progress.js';
import { app } from './player.js';

const ACTIVITY_KEY = progressConfig.activityKey;
const ACTIVITY_IDS = progressConfig.activities;

const ACTIVITY_META = {
  listen: { icon: '🎧', label: 'Escucha' },
  challenge: { icon: '✍️', label: 'Challenge' },
  dictation: { icon: '📝', label: 'Dictado' },
  quiz: { icon: '🧠', label: 'Quiz' },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function readActivityLedger() {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.events)) return parsed.events;
  } catch {}
  return [];
}

function timeAgo(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  const weeks = Math.floor(days / 7);
  return `hace ${weeks}sem`;
}

function computeStreak(events) {
  if (!events.length) return { current: 0, best: 0, lastDate: null };

  const daySet = new Set();
  events.forEach(e => {
    if (e.occurredAt) daySet.add(e.occurredAt.slice(0, 10));
  });

  const sortedDays = [...daySet].sort().reverse();
  if (!sortedDays.length) return { current: 0, best: 0, lastDate: null };

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let current = 0;
  const startFrom = sortedDays[0] === today || sortedDays[0] === yesterday ? sortedDays[0] : null;

  if (startFrom) {
    let checkDate = new Date(startFrom + 'T00:00:00');
    for (const day of sortedDays) {
      const expected = checkDate.toISOString().slice(0, 10);
      if (day === expected) {
        current++;
        checkDate = new Date(checkDate.getTime() - 86400000);
      } else if (day < expected) {
        break;
      }
    }
  }

  let best = 1;
  let run = 1;
  const ascending = [...sortedDays].reverse();
  for (let i = 1; i < ascending.length; i++) {
    const prev = new Date(ascending[i - 1] + 'T00:00:00');
    const curr = new Date(ascending[i] + 'T00:00:00');
    if (curr.getTime() - prev.getTime() === 86400000) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  if (sortedDays.length === 1) best = 1;

  return { current, best, lastDate: sortedDays[0] };
}

function groupByLevel(songs) {
  const groups = {};
  songs.forEach(song => {
    const level = song.level || 'Other';
    if (!groups[level]) groups[level] = [];
    groups[level].push(song);
  });
  return groups;
}

function svgRing(percent, size = 64) {
  const radius = 27;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return `
    <svg class="stats-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle class="stats-ring__bg" cx="${size / 2}" cy="${size / 2}" r="${radius}" />
      <circle class="stats-ring__fill" cx="${size / 2}" cy="${size / 2}" r="${radius}"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${offset}"
        style="--target-offset: ${offset}" />
    </svg>
  `;
}

// ─── Render ────────────────────────────────────────────────────────────────────

export function cleanupStats() {
  const shell = document.querySelector('.app-shell--fullscreen');
  if (shell) shell.classList.remove('app-shell--fullscreen');
}

export function renderStats() {
  const progress = getProgress();
  const events = readActivityLedger();
  const streak = computeStreak(events);
  const songDetails = pickerSongs.map(song => ({
    ...song,
    progress: getSongProgress(song.id),
  }));

  // Sort by CEFR level
  const LEVEL_ORDER = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  songDetails.sort((a, b) => {
    const la = LEVEL_ORDER.indexOf((a.level || '').toLowerCase());
    const lb = LEVEL_ORDER.indexOf((b.level || '').toLowerCase());
    const ia = la === -1 ? LEVEL_ORDER.length : la;
    const ib = lb === -1 ? LEVEL_ORDER.length : lb;
    return ia - ib || a.title.localeCompare(b.title);
  });

  const shell = app.closest('.app-shell');
  if (shell) shell.classList.add('app-shell--fullscreen');
  const byLevel = groupByLevel(pickerSongs);

  const activityCounts = {};
  ACTIVITY_IDS.forEach(act => {
    activityCounts[act] = { completed: 0, total: pickerSongs.length };
  });
  songDetails.forEach(song => {
    ACTIVITY_IDS.forEach(act => {
      if (song.progress.activities[act]?.completed) activityCounts[act].completed++;
    });
  });

  const levelStats = Object.entries(byLevel).map(([level, songs]) => {
    const completed = songs.filter(s => {
      const sp = songDetails.find(d => d.id === s.id);
      return sp?.progress.completed;
    }).length;
    return { level, completed, total: songs.length };
  });

  const totalAttempts = songDetails.reduce((sum, s) => sum + (s.progress.attempts || 0), 0);
  const allScores = songDetails.map(s => s.progress.bestScorePct).filter(s => s !== null && s !== undefined);
  const bestScore = allScores.length ? Math.max(...allScores) : null;
  const recentEvents = events.slice(0, 6);
  const pct = Math.round(progress.summary.progressPct);

  app.innerHTML = `
    <div class="stats-view">

      <!-- Top: Summary row -->
      <div class="sv-top">
        <div class="sv-top__ring">
          ${svgRing(pct)}
          <div class="sv-ring-label"><strong>${pct}%</strong></div>
        </div>
        <div class="sv-top__info">
          <div class="sv-top__title">
            <span class="sv-kicker">Tus métricas</span>
            <h2>Estadísticas</h2>
          </div>
          <div class="sv-top__numbers">
            <div class="sv-stat"><strong>${progress.summary.completedContent}</strong><span>/ ${progress.summary.totalContent} canciones</span></div>
            <div class="sv-stat"><strong>${progress.summary.completedActivities}</strong><span>/ ${progress.summary.totalActivities} actividades</span></div>
            <div class="sv-stat"><strong>${totalAttempts}</strong><span>intentos</span></div>
            ${bestScore !== null ? `<div class="sv-stat"><strong>${Math.round(bestScore)}%</strong><span>mejor score</span></div>` : ''}
            <div class="sv-stat"><strong>${streak.current}</strong><span>racha actual</span></div>
            <div class="sv-stat"><strong>${streak.best}</strong><span>mejor racha</span></div>
          </div>
        </div>
      </div>

      <!-- Mid: 3-column row -->
      <div class="sv-mid">
        <section class="sv-card" aria-labelledby="svActTitle">
          <h3 id="svActTitle">Actividades</h3>
          <div class="sv-acts">
            ${ACTIVITY_IDS.map(act => {
              const { completed, total } = activityCounts[act];
              const p = total ? (completed / total) * 100 : 0;
              const meta = ACTIVITY_META[act];
              return `
                <div class="sv-act-row">
                  <span class="sv-act-icon">${meta.icon}</span>
                  <span class="sv-act-name">${meta.label}</span>
                  <div class="sv-bar"><div class="sv-bar__fill" style="width:${p}%"></div></div>
                  <span class="sv-act-count">${completed}/${total}</span>
                </div>`;
            }).join('')}
          </div>
        </section>

        <section class="sv-card" aria-labelledby="svLevelsTitle">
          <h3 id="svLevelsTitle">Por nivel</h3>
          <div class="sv-levels">
            ${levelStats.map(({ level, completed, total }) => {
              const p = total ? (completed / total) * 100 : 0;
              return `
                <div class="sv-level-row">
                  <span class="level-badge level-${level.toLowerCase()}">${level}</span>
                  <div class="sv-bar sv-bar--sm"><div class="sv-bar__fill" style="width:${p}%"></div></div>
                  <span class="sv-level-count">${completed}/${total}</span>
                </div>`;
            }).join('')}
          </div>
        </section>

        <section class="sv-card" aria-labelledby="svRecentTitle">
          <h3 id="svRecentTitle">Actividad reciente</h3>
          ${recentEvents.length ? `
          <div class="sv-recent">
            ${recentEvents.map(event => {
              const meta = ACTIVITY_META[event.activity] || { icon: '•', label: event.activity };
              const scoreStr = event.scorePct != null ? `${Math.round(event.scorePct)}%` : '';
              const passedStr = event.passed === true ? '✓' : event.passed === false ? '✗' : '';
              return `
                <div class="sv-recent-row">
                  <span class="sv-recent-icon">${meta.icon}</span>
                  <span class="sv-recent-title">${event.title || event.contentId}</span>
                  <span class="sv-recent-score">${scoreStr}${passedStr ? ' ' + passedStr : ''}</span>
                  <time class="sv-recent-time">${timeAgo(event.occurredAt)}</time>
                </div>`;
            }).join('')}
          </div>
          ` : '<p class="sv-empty">Sin actividad aún</p>'}
        </section>
      </div>

      <!-- Bottom: Songs table -->
      <section class="sv-songs" aria-labelledby="svSongsTitle">
        <h3 id="svSongsTitle">Canciones</h3>
        <div class="sv-songs-grid">
          ${songDetails.map(song => {
            const sp = song.progress.progressPct;
            const segments = ACTIVITY_IDS.map(act => {
              const done = song.progress.activities[act]?.completed;
              return `<span class="sv-seg ${done ? 'is-done' : ''}" title="${ACTIVITY_META[act].label}"></span>`;
            }).join('');
            return `
              <div class="sv-song-row">
                <span class="sv-song-icon">${song.icon || '🎵'}</span>
                <span class="sv-song-name">${song.title}</span>
                <span class="sv-song-artist">${song.artist}</span>
                <span class="level-badge level-${(song.level || '').toLowerCase()}">${song.level || ''}</span>
                <div class="sv-song-segs">${segments}</div>
                <span class="sv-song-pct">${sp}%</span>
              </div>`;
          }).join('')}
        </div>
      </section>

    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LyricFlow — Dashboard & Stats
// Dashboard: motivational landing with hero + compact stats.
// Stats: full-page detailed statistics (songs table, per-level breakdown).
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

const LEVEL_ORDER = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

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

function svgRingLarge(percent, size = 140) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return `
    <svg class="stats-ring stats-ring--lg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle class="stats-ring__bg" cx="${size / 2}" cy="${size / 2}" r="${radius}" />
      <circle class="stats-ring__fill" cx="${size / 2}" cy="${size / 2}" r="${radius}"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${offset}"
        style="--target-offset: ${offset}" />
    </svg>
  `;
}

function getComputedData() {
  const progress = getProgress();
  const events = readActivityLedger();
  const streak = computeStreak(events);
  const songDetails = pickerSongs.map(song => ({
    ...song,
    progress: getSongProgress(song.id),
  }));

  songDetails.sort((a, b) => {
    const la = LEVEL_ORDER.indexOf((a.level || '').toLowerCase());
    const lb = LEVEL_ORDER.indexOf((b.level || '').toLowerCase());
    const ia = la === -1 ? LEVEL_ORDER.length : la;
    const ib = lb === -1 ? LEVEL_ORDER.length : lb;
    return ia - ib || a.title.localeCompare(b.title);
  });

  const activityCounts = {};
  ACTIVITY_IDS.forEach(act => {
    activityCounts[act] = { completed: 0, total: pickerSongs.length };
  });
  songDetails.forEach(song => {
    ACTIVITY_IDS.forEach(act => {
      if (song.progress.activities[act]?.completed) activityCounts[act].completed++;
    });
  });

  const totalAttempts = songDetails.reduce((sum, s) => sum + (s.progress.attempts || 0), 0);
  const allScores = songDetails.map(s => s.progress.bestScorePct).filter(s => s !== null && s !== undefined);
  const bestScore = allScores.length ? Math.max(...allScores) : null;
  const pct = Math.round(progress.summary.progressPct);

  return { progress, events, streak, songDetails, activityCounts, totalAttempts, bestScore, pct };
}

// Recommendation engine (same logic as picker had)
const PICKER_ACTIVITY_ORDER = ['listen', 'dictation', 'challenge', 'quiz'];
const ACTIVITY_LABELS = { listen: 'Escucha', dictation: 'Dictado', challenge: 'Challenge', quiz: 'Quiz' };

function pickRecommendation(songDetails) {
  const withProgress = songDetails.map(song => ({ song, progress: song.progress }));

  const inProgress = withProgress
    .filter(({ progress }) => progress.progressPct > 0 && !progress.completed)
    .map(({ song, progress }) => {
      const lastAttemptAt = Math.max(0, ...PICKER_ACTIVITY_ORDER.map(activity => {
        const at = progress.activities[activity].lastAttemptAt;
        return at ? new Date(at).getTime() : 0;
      }));
      return { song, progress, lastAttemptAt };
    })
    .sort((a, b) => b.lastAttemptAt - a.lastAttemptAt);

  if (inProgress.length) {
    const { song, progress } = inProgress[0];
    const nextActivity = PICKER_ACTIVITY_ORDER.find(activity => !progress.activities[activity].completed);
    return { type: 'continue', song, progress, nextLabel: ACTIVITY_LABELS[nextActivity] };
  }

  const untouched = withProgress.find(({ progress }) => progress.attempts === 0 && progress.progressPct === 0);
  if (untouched) return { type: 'start', song: untouched.song, progress: untouched.progress };

  return null;
}

// ─── Dashboard (Home) ──────────────────────────────────────────────────────────

export function cleanupDashboard() {
  const shell = document.querySelector('.app-shell--fullscreen');
  if (shell) shell.classList.remove('app-shell--fullscreen');
}

export function renderDashboard(onSongClick, onShowSongs) {
  const { progress, events, streak, songDetails, activityCounts, totalAttempts, bestScore, pct } = getComputedData();
  const recommendation = pickRecommendation(songDetails);
  const recentEvents = events.slice(0, 5);

  const shell = app.closest('.app-shell');
  if (shell) shell.classList.add('app-shell--fullscreen');

  app.innerHTML = `
    <div class="dashboard-view">

      <!-- Hero: motivational banner with large ring + CTA -->
      <div class="dash-hero">
        <div class="dash-hero__ring">
          ${svgRingLarge(pct)}
          <div class="dash-hero__pct"><strong>${pct}%</strong><span>completado</span></div>
        </div>
        <div class="dash-hero__body">
          <div class="dash-hero__headline">
            <div class="dash-hero__title-row">
              <p class="dash-hero__eyebrow">Tu biblioteca</p>
              <button type="button" class="dash-hero__browse" id="dashSongsCta" aria-label="Ver todas las canciones">
                <span class="dash-hero__browse-label">Ver todas</span>
                <span class="dash-hero__browse-chevron" aria-hidden="true">›</span>
              </button>
              <div class="dash-hero__lead">
                <h2 class="dash-hero__title">
                  <span class="dash-hero__title-value">${progress.summary.completedContent}</span>
                  <span class="dash-hero__title-muted">de ${progress.summary.totalContent} canciones</span>
                </h2>
                <span class="dash-hero__pct-badge" aria-label="${pct}% completado">${pct}%</span>
              </div>
            </div>
          </div>
          <div class="dash-hero__metrics">
            <div class="dash-metric"><strong>${streak.current}</strong><span>racha</span></div>
            <div class="dash-metric"><strong>${progress.summary.completedActivities}</strong><span>actividades</span></div>
            <div class="dash-metric"><strong>${totalAttempts}</strong><span>intentos</span></div>
            <div class="dash-metric dash-metric--global"><strong>${pct}%</strong><span>avance</span></div>
          </div>
          ${recommendation ? `
          <button type="button" class="dash-hero__cta" id="dashHeroCta">
            <span class="dash-hero__cta-song"><span class="dash-hero__cta-icon">${recommendation.song.icon || '🎵'}</span><span class="dash-hero__cta-info"><span class="dash-hero__cta-title">${recommendation.song.title}</span><span class="dash-hero__cta-artist">${recommendation.song.artist}</span></span></span>
            <span class="dash-hero__cta-play"><span class="dash-hero__cta-play-label">${recommendation.type === 'continue' ? 'Continuar' : 'Comenzar'}</span>▶</span>
          </button>
          ` : `
          <button type="button" class="dash-hero__cta dash-hero__cta--browse" id="dashBrowseCta">
            <span class="dash-hero__cta-song">Explorar canciones</span>
            <span class="dash-hero__cta-play"><span class="dash-hero__cta-play-label">Ver</span>→</span>
          </button>
          `}
        </div>
      </div>

      <!-- Activity cards row -->
      <div class="dash-activities">
        ${ACTIVITY_IDS.map(act => {
          const { completed, total } = activityCounts[act];
          const p = total ? (completed / total) * 100 : 0;
          const meta = ACTIVITY_META[act];
          return `
            <div class="dash-act-card">
              <span class="dash-act-icon">${meta.icon}</span>
              <span class="dash-act-label">${meta.label}</span>
              <div class="dash-act-bar"><div class="dash-act-bar__fill" style="width:${p}%"></div></div>
              <span class="dash-act-count">${completed}/${total}</span>
            </div>`;
        }).join('')}
      </div>

      <!-- Recent activity -->
      <section class="dash-recent" aria-labelledby="dashRecentTitle">
        <h3 id="dashRecentTitle">Actividad reciente</h3>
        ${recentEvents.length ? `
        <div class="dash-recent__list">
          ${recentEvents.map(event => {
            const meta = ACTIVITY_META[event.activity] || { icon: '•', label: event.activity };
            const scoreStr = event.scorePct != null ? `${Math.round(event.scorePct)}%` : '';
            const passedStr = event.passed === true ? '✓' : event.passed === false ? '✗' : '';
            const songData = pickerSongs.find(s => s.id === event.contentId);
            const displayTitle = songData?.title || event.title || event.contentId;
            const displayArtist = songData?.artist || '';
            return `
              <div class="dash-recent__row">
                <span class="dash-recent__icon">${meta.icon}</span>
                <span class="dash-recent__title">${displayTitle}${displayArtist ? `<span class="dash-recent__artist">${displayArtist}</span>` : ''}</span>
                <span class="dash-recent__activity">${meta.label}</span>
                <span class="dash-recent__score">${scoreStr}${passedStr ? ' ' + passedStr : ''}</span>
                <time class="dash-recent__time">${timeAgo(event.occurredAt)}</time>
              </div>`;
          }).join('')}
        </div>
        ` : '<p class="dash-empty">Comienza con una canción para ver tu actividad aqui</p>'}
      </section>

      <!-- Songs CTA -->
    </div>
  `;

  // Bind CTA
  if (recommendation) {
    document.getElementById('dashHeroCta')?.addEventListener('click', () => onSongClick(recommendation.song));
  } else {
    document.getElementById('dashBrowseCta')?.addEventListener('click', onShowSongs);
  }
  document.getElementById('dashSongsCta')?.addEventListener('click', onShowSongs);
}

// ─── Stats (detailed) ──────────────────────────────────────────────────────────

export function cleanupStats() {
  const shell = document.querySelector('.app-shell--fullscreen');
  if (shell) shell.classList.remove('app-shell--fullscreen');
}

export function renderStats() {
  const { progress, events, streak, songDetails, activityCounts, totalAttempts, bestScore, pct } = getComputedData();
  const recentEvents = events.slice(0, 5);

  const shell = app.closest('.app-shell');
  if (shell) shell.classList.add('app-shell--fullscreen');

  const levelStats = (() => {
    const groups = {};
    pickerSongs.forEach(song => {
      const level = song.level || 'Other';
      if (!groups[level]) groups[level] = [];
      groups[level].push(song);
    });
    return Object.entries(groups).map(([level, songs]) => {
      const completed = songs.filter(s => {
        const sp = songDetails.find(d => d.id === s.id);
        return sp?.progress.completed;
      }).length;
      return { level, completed, total: songs.length };
    }).sort((a, b) => {
      const ia = LEVEL_ORDER.indexOf(a.level.toLowerCase());
      const ib = LEVEL_ORDER.indexOf(b.level.toLowerCase());
      return (ia === -1 ? LEVEL_ORDER.length : ia) - (ib === -1 ? LEVEL_ORDER.length : ib);
    });
  })();

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
            <span class="sv-kicker">Tus metricas<span class="sv-top__pct-inline"> · ${pct}% completado</span></span>
            <h2>Estadisticas</h2>
          </div>
          <div class="sv-top__numbers">
            <div class="sv-stat"><strong>${progress.summary.completedContent} / ${progress.summary.totalContent}</strong><span>canciones</span></div>
            <div class="sv-stat"><strong>${progress.summary.completedActivities} / ${progress.summary.totalActivities}</strong><span>actividades</span></div>
            <div class="sv-stat"><strong>${totalAttempts}</strong><span>intentos</span></div>
            ${bestScore !== null ? `<div class="sv-stat"><strong>${Math.round(bestScore)}%</strong><span>mejor score</span></div>` : ''}
            <div class="sv-stat"><strong>${streak.current}</strong><span>racha actual</span></div>
            <div class="sv-stat sv-stat--hide-mobile"><strong>${streak.best}</strong><span>mejor racha</span></div>
          </div>
        </div>
      </div>

      <!-- Mid: 3-column row -->
      <div class="sv-mid">
        <section class="sv-card" aria-labelledby="svActTitle">
          <h3 id="svActTitle">Actividades</h3>
          <table class="sv-act-table" role="table">
            <thead>
              <tr>
                <th class="sv-act-table__th" colspan="2">Actividad</th>
                <th class="sv-act-table__th sv-act-table__th--num">Hecho</th>
                <th class="sv-act-table__th sv-act-table__th--num">Total</th>
                <th class="sv-act-table__th sv-act-table__th--num">%</th>
              </tr>
            </thead>
            <tbody>
              ${ACTIVITY_IDS.map(act => {
                const { completed, total } = activityCounts[act];
                const pct = total ? Math.round((completed / total) * 100) : 0;
                const meta = ACTIVITY_META[act];
                return `
                <tr class="sv-act-table__row">
                  <td class="sv-act-table__icon">${meta.icon}</td>
                  <td class="sv-act-table__name">${meta.label}</td>
                  <td class="sv-act-table__num">${completed}</td>
                  <td class="sv-act-table__num">${total}</td>
                  <td class="sv-act-table__num sv-act-table__pct">${pct}%</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
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
              const songData = pickerSongs.find(s => s.id === event.contentId);
              const displayTitle = songData?.title || event.title || event.contentId;
              const displayArtist = songData?.artist || '';
              return `
                <div class="sv-recent-row">
                  <span class="sv-recent-icon">${meta.icon}</span>
                  <span class="sv-recent-title">${displayTitle}${displayArtist ? `<span class="sv-recent-artist">${displayArtist}</span>` : ''}</span>
                  <span class="sv-recent-activity">${meta.label}</span>
                  <span class="sv-recent-score">${scoreStr}${passedStr ? ' ' + passedStr : ''}</span>
                  <time class="sv-recent-time">${timeAgo(event.occurredAt)}</time>
                </div>`;
            }).join('')}
          </div>
          ` : '<p class="sv-empty">Sin actividad aun</p>'}
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

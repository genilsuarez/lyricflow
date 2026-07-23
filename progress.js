import * as lpSupabase from './lp-supabase.js';

const PROGRESS_KEY = 'learnflow:progress:lyricflow:v1';
const ACTIVITY_KEY = 'learnflow:activity:lyricflow:v1';
const SCHEMA_VERSION = 1;
const APP_ID = 'lyricflow';
const PASS_SCORE_PCT = 60;
const LISTEN_COMPLETION_PCT = 90;
const MAX_EVENTS = 200;
const ACTIVITY_IDS = ['listen', 'dictation', 'challenge', 'quiz'];

let catalogIds = [];

function nowIso() {
  return new Date().toISOString();
}

function clampPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqueId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function createRunId(activity = 'activity') {
  return uniqueId(`${activity}_run`);
}

function emptyActivity(activity) {
  const base = {
    completed: false,
    completedAt: null,
    bestScorePct: null,
    lastScorePct: null,
    attempts: 0,
    lastAttemptAt: null,
    lastRunId: null,
  };

  if (activity === 'listen') {
    return {
      ...base,
      coveragePct: 0,
      eligibleDurationSec: 0,
      coveredDurationSec: 0,
      coverageRanges: [],
    };
  }
  return base;
}

function emptySong(contentId) {
  return {
    contentId,
    contentType: 'song',
    progressPct: 0,
    completed: false,
    completedAt: null,
    bestScorePct: null,
    lastScorePct: null,
    attempts: 0,
    activities: Object.fromEntries(ACTIVITY_IDS.map(activity => [activity, emptyActivity(activity)])),
  };
}

function emptyProgress() {
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    app: APP_ID,
    updatedAt: timestamp,
    catalogVersion: 'v1',
    summary: {
      progressPct: 0,
      completedContent: 0,
      totalContent: catalogIds.length,
      attemptedContent: 0,
      completedActivities: 0,
      totalActivities: catalogIds.length * ACTIVITY_IDS.length,
      attemptedActivities: 0,
    },
    content: {},
  };
}

function emptyActivityLedger() {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: APP_ID,
    updatedAt: nowIso(),
    events: [],
  };
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || parsed.app !== APP_ID) return fallback();
    return parsed;
  } catch {
    return fallback();
  }
}

function ensureSong(document, contentId) {
  if (!document.content || typeof document.content !== 'object') document.content = {};
  if (!document.content[contentId]) document.content[contentId] = emptySong(contentId);

  const song = document.content[contentId];
  song.contentId = contentId;
  song.contentType = 'song';
  if (!song.activities || typeof song.activities !== 'object') song.activities = {};
  ACTIVITY_IDS.forEach(activity => {
    song.activities[activity] = { ...emptyActivity(activity), ...(song.activities[activity] || {}) };
  });
  return song;
}

function deriveSong(song) {
  const completedCount = ACTIVITY_IDS.filter(activity => song.activities[activity].completed).length;
  song.progressPct = completedCount * 25;

  // Song is complete if all 4 activities done, OR if the 3 scored challenges are done
  // (listening is not mandatory if the user completed dictation + challenge + quiz)
  const challengesDone = ['dictation', 'challenge', 'quiz'].every(
    activity => song.activities[activity].completed
  );
  song.completed = completedCount === ACTIVITY_IDS.length || challengesDone;
  if (!song.completed) song.completedAt = null;

  const scored = ACTIVITY_IDS
    .map(activity => song.activities[activity].bestScorePct)
    .filter(score => Number.isFinite(score));
  song.bestScorePct = scored.length ? Math.max(...scored) : null;
}

function deriveSummary(document) {
  const ids = catalogIds.length ? catalogIds : Object.keys(document.content || {});
  ids.forEach(contentId => deriveSong(ensureSong(document, contentId)));
  const songs = ids.map(contentId => document.content[contentId]);
  const completedActivities = songs.reduce((sum, song) => (
    sum + ACTIVITY_IDS.filter(activity => song.activities[activity].completed).length
  ), 0);
  const attemptedActivities = songs.reduce((sum, song) => (
    sum + ACTIVITY_IDS.filter(activity => {
      const entry = song.activities[activity];
      return entry.attempts > 0 || entry.coveredDurationSec > 0;
    }).length
  ), 0);

  document.summary = {
    progressPct: songs.length
      ? songs.reduce((sum, song) => sum + song.progressPct, 0) / songs.length
      : 0,
    completedContent: songs.filter(song => song.completed).length,
    totalContent: songs.length,
    attemptedContent: songs.filter(song => (
      song.attempts > 0 || song.activities.listen.coveredDurationSec > 0
    )).length,
    completedActivities,
    totalActivities: songs.length * ACTIVITY_IDS.length,
    attemptedActivities,
  };
}

function writeProgress(document) {
  deriveSummary(document);
  document.updatedAt = nowIso();
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(document));
  } catch {
    return false;
  }
  return true;
}

function appendEvent(event) {
  const ledger = readJson(ACTIVITY_KEY, emptyActivityLedger);
  if (!Array.isArray(ledger.events)) ledger.events = [];
  if (ledger.events.some(item => item.eventId === event.eventId || item.runId === event.runId)) return;
  ledger.events.unshift(event);
  ledger.events = ledger.events.slice(0, MAX_EVENTS);
  ledger.updatedAt = nowIso();
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(ledger));
  } catch {}
  scheduleCloudSync();
}

// Sube progreso + eventos a Supabase cuando el usuario esta autenticado.
// Debounced: recordActivityResult/markListenCompleted pueden dispararse
// varias veces seguidas (una cancion tiene 4 actividades).
let cloudSyncTimer = null;
function scheduleCloudSync() {
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(async () => {
    cloudSyncTimer = null;
    const authed = await lpSupabase.isAuthenticated().catch(() => false);
    if (!authed) return;

    const progressDoc = readJson(PROGRESS_KEY, emptyProgress);
    if (progressDoc.content && Object.keys(progressDoc.content).length) {
      await lpSupabase.syncProgress(APP_ID, { content: progressDoc.content });
    }
    const activityDoc = readJson(ACTIVITY_KEY, emptyActivityLedger);
    if (activityDoc.events?.length) {
      await lpSupabase.syncActivityEvents(APP_ID, activityDoc.events);
    }
  }, 500);
}

function hasRecordedRun(runId) {
  const ledger = readJson(ACTIVITY_KEY, emptyActivityLedger);
  return Array.isArray(ledger.events) && ledger.events.some(event => event.runId === runId);
}

function eventFor({ contentId, title, activity, runId, scorePct, passed, durationMs, metrics }) {
  const event = {
    eventId: uniqueId('event'),
    runId,
    app: APP_ID,
    contentId,
    title: title || contentId,
    activity,
    eventType: 'attempt_completed',
    occurredAt: nowIso(),
    scorePct,
    passed,
    metrics: metrics || {},
  };
  if (Number.isFinite(durationMs)) event.durationMs = Math.max(0, Math.round(durationMs));
  return event;
}

export function configureProgressCatalog(songs) {
  catalogIds = [...new Set(songs.map(song => song.id).filter(Boolean))];
  const document = readJson(PROGRESS_KEY, emptyProgress);
  catalogIds.forEach(contentId => ensureSong(document, contentId));
  writeProgress(document);
  return clone(document);
}

export function getProgress() {
  const document = readJson(PROGRESS_KEY, emptyProgress);
  catalogIds.forEach(contentId => ensureSong(document, contentId));
  deriveSummary(document);
  return clone(document);
}

export function getSongProgress(contentId) {
  const document = readJson(PROGRESS_KEY, emptyProgress);
  const song = ensureSong(document, contentId);
  deriveSong(song);
  return clone(song);
}

export function recordActivityResult({
  contentId,
  title,
  activity,
  scorePct,
  correct,
  total,
  runId = createRunId(activity),
  durationMs = null,
}) {
  if (!contentId || !['challenge', 'dictation', 'quiz'].includes(activity)) return null;

  const document = readJson(PROGRESS_KEY, emptyProgress);
  const song = ensureSong(document, contentId);
  const activityProgress = song.activities[activity];
  const attemptRunId = typeof runId === 'string' && runId ? runId : createRunId(activity);
  if (activityProgress.lastRunId === attemptRunId || hasRecordedRun(attemptRunId)) return clone(song);

  const timestamp = nowIso();
  const normalizedScore = clampPct(scorePct);
  const passed = normalizedScore >= PASS_SCORE_PCT;
  activityProgress.attempts += 1;
  activityProgress.lastScorePct = normalizedScore;
  activityProgress.bestScorePct = activityProgress.bestScorePct === null
    ? normalizedScore
    : Math.max(activityProgress.bestScorePct, normalizedScore);
  activityProgress.lastAttemptAt = timestamp;
  activityProgress.lastRunId = attemptRunId;
  if (passed && !activityProgress.completed) {
    activityProgress.completed = true;
    activityProgress.completedAt = timestamp;
  }

  song.attempts += 1;
  song.lastScorePct = normalizedScore;
  const wasCompleted = song.completed;
  deriveSong(song);
  if (song.completed && !wasCompleted && !song.completedAt) song.completedAt = timestamp;
  writeProgress(document);

  appendEvent(eventFor({
    contentId,
    title,
    activity,
    runId: attemptRunId,
    scorePct: normalizedScore,
    passed,
    durationMs,
    metrics: {
      correct: Number.isFinite(correct) ? correct : null,
      total: Number.isFinite(total) ? total : null,
    },
  }));

  return clone(song);
}

export function createListenTracker({
  contentId,
  title,
  eligibleStartSec = 0,
  eligibleEndSec = null,
  onProgress = null,
}) {
  // Simplified: no coverage tracking. Completion is triggered by the 'ended' event.
  return {
    play() {},
    sample() {},
    pause() {},
    seeking() {},
    seeked() {},
    destroy() {},
  };
}

export function markListenCompleted({ contentId, title }) {
  const document = readJson(PROGRESS_KEY, emptyProgress);
  const song = ensureSong(document, contentId);
  const listen = song.activities.listen;

  if (listen.completed) return clone(song);

  const timestamp = nowIso();
  const runId = createRunId('listen');

  listen.completed = true;
  listen.completedAt = timestamp;
  listen.attempts += 1;
  listen.lastAttemptAt = timestamp;
  listen.lastRunId = runId;
  listen.coveragePct = 100;
  listen.lastScorePct = 100;
  listen.bestScorePct = 100;

  song.attempts += 1;
  song.lastScorePct = 100;

  const wasCompleted = song.completed;
  deriveSong(song);
  if (song.completed && !wasCompleted && !song.completedAt) song.completedAt = timestamp;
  writeProgress(document);

  appendEvent(eventFor({
    contentId,
    title,
    activity: 'listen',
    runId,
    scorePct: 100,
    passed: true,
    durationMs: null,
    metrics: {},
  }));

  return clone(song);
}

export const progressConfig = Object.freeze({
  progressKey: PROGRESS_KEY,
  activityKey: ACTIVITY_KEY,
  passScorePct: PASS_SCORE_PCT,
  listenCompletionPct: LISTEN_COMPLETION_PCT,
  maxEvents: MAX_EVENTS,
  activities: [...ACTIVITY_IDS],
});

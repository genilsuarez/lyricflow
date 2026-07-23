// Canonical progress summary helpers — copy to DeskFlow (progress-reader imports inline),
// HubFlow/js, and LyricFlow. Keep in sync with DeskFlow/progress-reader.js.

const FLUENTFLOW_LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const LYRICFLOW_ACTIVITY_IDS = Object.freeze(['listen', 'dictation', 'challenge', 'quiz']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function groupFluentflowContentByLevel(content) {
  const byLevel = Object.fromEntries(FLUENTFLOW_LEVELS.map((level) => [level, []]));
  for (const item of Object.values(content || {})) {
    if (!isRecord(item) || typeof item.cefrLevel !== 'string' || !item.cefrLevel.trim()) continue;
    const level = item.cefrLevel.toUpperCase();
    if (byLevel[level]) byLevel[level].push(item);
  }
  return byLevel;
}

function isFluentflowPreviousLevelComplete(cefrLevel, byLevel) {
  const idx = FLUENTFLOW_LEVELS.indexOf(cefrLevel);
  if (idx <= 0) return true;
  const previousLevel = FLUENTFLOW_LEVELS[idx - 1];
  const previousModules = byLevel[previousLevel] || [];
  if (previousModules.length === 0) return true;
  return previousModules.every((item) => item.completed === true);
}

export function computeFluentflowProgressSummary(content) {
  const byLevel = groupFluentflowContentByLevel(content);
  let completedContent = 0;

  for (const level of FLUENTFLOW_LEVELS) {
    for (const item of byLevel[level]) {
      if (item.completed !== true) continue;
      if (!isFluentflowPreviousLevelComplete(level, byLevel)) continue;
      completedContent++;
    }
  }

  const totalContent = Object.values(content || {}).filter(isRecord).length;
  const cefr = Object.fromEntries(
    FLUENTFLOW_LEVELS.map((level) => {
      const levelModules = byLevel[level];
      const completedModules = levelModules.filter(
        (item) => item.completed === true && isFluentflowPreviousLevelComplete(level, byLevel)
      ).length;
      const totalModules = levelModules.length;
      const progressPct = totalModules > 0 ? (completedModules / totalModules) * 100 : 0;
      const status =
        completedModules === 0
          ? 'not_started'
          : completedModules === totalModules
            ? 'completed'
            : progressPct >= 80
              ? 'near_completion'
              : 'in_progress';
      return [level, { progressPct, completedModules, totalModules, status }];
    })
  );

  return {
    completedContent,
    totalContent,
    progressPct: totalContent > 0 ? (completedContent / totalContent) * 100 : 0,
    cefr,
  };
}

export function computeHubflowActivitySummary(content) {
  const items = content && typeof content === 'object' ? Object.values(content) : [];
  let completedActivities = 0;
  let totalActivities = 0;
  let attemptedActivities = 0;

  for (const item of items) {
    const activities = item?.activities && typeof item.activities === 'object'
      ? Object.values(item.activities)
      : [];
    totalActivities += activities.length;
    for (const activity of activities) {
      if (activity?.completed) completedActivities++;
      if ((activity?.attempts ?? 0) > 0 || (activity?.completedKeys ?? 0) > 0) attemptedActivities++;
    }
  }

  return { completedActivities, totalActivities, attemptedActivities };
}

export function computeLyricflowActivitySummary(content, totalSongs = null) {
  const songs = content && typeof content === 'object' ? Object.values(content) : [];
  const songCount = Number.isInteger(totalSongs) ? totalSongs : songs.length;
  let completedActivities = 0;
  let attemptedActivities = 0;

  for (const song of songs) {
    const activities = song?.activities && typeof song.activities === 'object' ? song.activities : {};
    for (const activityId of LYRICFLOW_ACTIVITY_IDS) {
      const activity = activities[activityId];
      if (activity?.completed) completedActivities++;
      if ((activity?.attempts ?? 0) > 0 || (activity?.coveredDurationSec ?? 0) > 0) attemptedActivities++;
    }
  }

  return {
    completedActivities,
    totalActivities: songCount * LYRICFLOW_ACTIVITY_IDS.length,
    attemptedActivities,
  };
}

/** Rebuild summary (and FluentFlow cefr) from raw content after cloud merge. */
export function recomputeProgressDocumentSummary(doc, app) {
  if (!isRecord(doc) || !isRecord(doc.content)) return false;
  doc.summary = isRecord(doc.summary) ? doc.summary : {};
  const items = Object.values(doc.content).filter(isRecord);

  if (app === 'fluentflow') {
    const ff = computeFluentflowProgressSummary(doc.content);
    doc.summary.completedContent = ff.completedContent;
    doc.summary.totalContent = ff.totalContent;
    doc.summary.progressPct = ff.progressPct;
    doc.cefr = ff.cefr;
    return true;
  }

  if (app === 'hubflow') {
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: items.length,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...computeHubflowActivitySummary(doc.content),
    };
    return true;
  }

  if (app === 'lyricflow') {
    const catalogTotal = Number.isInteger(doc.summary.totalContent) && doc.summary.totalContent > 0
      ? doc.summary.totalContent
      : items.length;
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: catalogTotal,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...computeLyricflowActivitySummary(doc.content, catalogTotal),
    };
    return true;
  }

  return false;
}

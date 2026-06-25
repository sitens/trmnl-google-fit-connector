/**
 * TRMNL Google Fit Connector
 * Google Apps Script Web App
 *
 * Returns JSON for a TRMNL Private Plugin.
 *
 * URL params:
 *   ?token=YOUR_SECRET_TOKEN
 *   &steps_goal=6500
 *   &heart_goal=20
 *   &move_goal=60
 *   &cal_goal=2200
 *   &window=24h|48h|72h       Optional. Omit for today midnight -> now.
 *   &debug=1                 Optional. Includes debug payload.
 *
 * Notes:
 * - The Web App should execute as "Me" and be accessible to "Anyone".
 * - The token check prevents random callers from seeing your stats.
 */

const FIT_ROOT = 'https://www.googleapis.com/fitness/v1/users/me';
const FIT_AGGREGATE_URL = `${FIT_ROOT}/dataset:aggregate`;

const DS = {
  stepsMerged: 'derived:com.google.step_count.delta:com.google.android.gms:merge_step_deltas',
  stepsEstimated: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
  heartMerged: 'derived:com.google.heart_minutes:com.google.android.gms:merge_heart_minutes',
  activeMerged: 'derived:com.google.active_minutes:com.google.android.gms:merge_active_minutes',
  caloriesMerged: 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended',
  bmrMerged: 'derived:com.google.calories.bmr:com.google.android.gms:merged'
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const asInt = (v) => (
  typeof v?.intVal === 'number'
    ? v.intVal
    : typeof v?.fpVal === 'number'
    ? Math.round(v.fpVal)
    : 0
);
const asFloat = (v) => (
  typeof v?.fpVal === 'number'
    ? v.fpVal
    : typeof v?.intVal === 'number'
    ? v.intVal
    : 0
);
const tokenHeaders = () => ({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() });

function setupToken() {
  const token =
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '');

  PropertiesService.getScriptProperties().setProperty('TRMNL_TOKEN', token);
  Logger.log('TRMNL_TOKEN=' + token);
}

function resetToken() {
  setupToken();
}

function dateRangeMs_(windowParam) {
  const tz = Session.getScriptTimeZone() || 'America/New_York';
  const now = new Date();
  const p = String(windowParam || '').toLowerCase();

  const start = (p === '24h' || p === '48h' || p === '72h')
    ? new Date(now.getTime() - parseInt(p, 10) * 3600 * 1000)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return {
    startMs: start.getTime(),
    endMs: now.getTime(),
    dateISO: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
    nowHour: Number(Utilities.formatDate(now, tz, 'H'))
  };
}

function listSourceIdsByType_(typeName, preferredFirst = []) {
  const res = UrlFetchApp.fetch(`${FIT_ROOT}/dataSources`, {
    method: 'get',
    headers: tokenHeaders(),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return preferredFirst.slice();

  const json = JSON.parse(res.getContentText());
  const all = (json.dataSource || [])
    .filter(ds => ds?.dataType?.name === typeName)
    .map(ds => ds.dataStreamId);

  const set = new Set(preferredFirst);
  all.forEach(id => set.add(id));
  return Array.from(set);
}

function readRawSum_(dataStreamId, startMs, endMs, numFn) {
  const datasetId = `${startMs * 1e6}-${endMs * 1e6}`;
  const url = `${FIT_ROOT}/dataSources/${encodeURIComponent(dataStreamId)}/datasets/${datasetId}`;

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: tokenHeaders(),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    return { sum: 0, count: 0, err: res.getResponseCode() };
  }

  const json = JSON.parse(res.getContentText());
  let sum = 0;
  let count = 0;

  (json.point || []).forEach(pt => {
    sum += numFn(pt.value?.[0]);
    count++;
  });

  return { sum, count };
}

/**
 * Fallback for Move Minutes when active_minutes sources are empty.
 * Counts non-still / non-unknown activity segments.
 */
function activeFromSegments_(startMs, endMs) {
  const ids = listSourceIdsByType_('com.google.activity.segment', [
    'derived:com.google.activity.segment:com.google.android.gms:merge_activity_segments'
  ]);

  let best = 0;

  ids.forEach(id => {
    const datasetId = `${startMs * 1e6}-${endMs * 1e6}`;
    const url = `${FIT_ROOT}/dataSources/${encodeURIComponent(id)}/datasets/${datasetId}`;

    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: tokenHeaders(),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) return;

    const json = JSON.parse(res.getContentText());
    let minutes = 0;

    (json.point || []).forEach(pt => {
      const activityType = pt.value?.[0]?.intVal;
      if (activityType === 3 || activityType === 4) return; // STILL or UNKNOWN

      const s = Number(pt.startTimeNanos || 0);
      const e = Number(pt.endTimeNanos || 0);

      if (e > s) minutes += (e - s) / 60000000000;
    });

    if (minutes > best) best = minutes;
  });

  return Math.round(best);
}

/**
 * Fallback for Calories when calories.expended is empty.
 * Uses latest BMR kcal/day and prorates by elapsed day fraction.
 */
function latestBmrKcalPerDay_(startMs, endMs) {
  const ids = listSourceIdsByType_('com.google.calories.bmr', [DS.bmrMerged]);
  let latest = 0;

  ids.forEach(id => {
    const datasetId = `${(startMs - 7 * 86400000) * 1e6}-${endMs * 1e6}`;
    const url = `${FIT_ROOT}/dataSources/${encodeURIComponent(id)}/datasets/${datasetId}`;

    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: tokenHeaders(),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) return;

    const json = JSON.parse(res.getContentText());
    (json.point || []).forEach(pt => {
      const v = asFloat(pt.value?.[0]);
      if (v > 0) latest = v;
    });
  });

  return latest;
}

function fetchTotals_(range, wantDebug) {
  const { startMs, endMs } = range;

  const stepIds = listSourceIdsByType_('com.google.step_count.delta', [
    DS.stepsMerged,
    DS.stepsEstimated
  ]);
  const heartIds = listSourceIdsByType_('com.google.heart_minutes', [
    DS.heartMerged
  ]);
  const activeIds = listSourceIdsByType_('com.google.active_minutes', [
    DS.activeMerged
  ]);
  const calIds = listSourceIdsByType_('com.google.calories.expended', [
    DS.caloriesMerged
  ]);

  const aggregateBy = [
    ...stepIds.map(id => ({ dataSourceId: id })),
    ...heartIds.map(id => ({ dataSourceId: id })),
    ...activeIds.map(id => ({ dataSourceId: id })),
    ...calIds.map(id => ({ dataSourceId: id }))
  ];

  const body = {
    aggregateBy,
    bucketByTime: { durationMillis: endMs - startMs },
    startTimeMillis: startMs,
    endTimeMillis: endMs
  };

  const res = UrlFetchApp.fetch(FIT_AGGREGATE_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    headers: tokenHeaders(),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Google Fit error ' + res.getResponseCode() + ': ' + res.getContentText());
  }

  const json = JSON.parse(res.getContentText());
  const agg = {};

  (json.bucket || []).forEach(bucket => {
    (bucket.dataset || []).forEach(ds => {
      const id = ds.dataSourceId || ds.dataType?.name || 'unknown';
      let sum = 0;

      (ds.point || []).forEach(pt => {
        const v = pt.value?.[0];
        if (!v) return;

        if (stepIds.includes(id) || activeIds.includes(id)) {
          sum += asInt(v);
        } else if (heartIds.includes(id) || calIds.includes(id)) {
          sum += asFloat(v);
        }
      });

      if (sum) agg[id] = (agg[id] || 0) + sum;
    });
  });

  // Steps: merged -> estimated -> best device top_level raw
  const stepsMerged = agg[DS.stepsMerged] || 0;
  const stepsEstimated = agg[DS.stepsEstimated] || 0;
  let steps = stepsMerged > 0 ? stepsMerged : (stepsEstimated > 0 ? stepsEstimated : 0);
  let stepsProbe = [];

  if (steps === 0) {
    const top = stepIds.filter(id => id.includes(':top_level'));
    top.forEach(id => {
      const r = readRawSum_(id, startMs, endMs, asInt);
      stepsProbe.push({ id, raw: r });
    });
    const best = stepsProbe.reduce((a, r) => (r.raw.sum > (a?.raw.sum || 0) ? r : a), null);
    steps = best?.raw?.sum || 0;
  }

  // Heart: merged -> best device top_level raw
  let heart = agg[DS.heartMerged] || 0;
  let heartProbe = [];

  if (heart === 0) {
    const top = heartIds.filter(id => id.includes(':top_level'));
    top.forEach(id => {
      const r = readRawSum_(id, startMs, endMs, asFloat);
      heartProbe.push({ id, raw: r });
    });
    const best = heartProbe.reduce((a, r) => (r.raw.sum > (a?.raw.sum || 0) ? r : a), null);
    heart = best?.raw?.sum || 0;
  }

  // Move minutes: merged -> top_level raw -> activity segment fallback
  let active = agg[DS.activeMerged] || 0;
  let activeProbe = [];

  if (active === 0) {
    const top = activeIds.filter(id => id.includes(':top_level'));
    top.forEach(id => {
      const r = readRawSum_(id, startMs, endMs, asInt);
      activeProbe.push({ id, raw: r });
    });
    const best = activeProbe.reduce((a, r) => (r.raw.sum > (a?.raw.sum || 0) ? r : a), null);
    active = best?.raw?.sum || 0;
  }

  if (active === 0) {
    active = activeFromSegments_(startMs, endMs);
  }

  // Calories: merged -> raw -> prorated BMR fallback
  let calories = agg[DS.caloriesMerged] || 0;
  let caloriesProbe = [];

  if (calories === 0) {
    calIds.forEach(id => {
      const r = readRawSum_(id, startMs, endMs, asFloat);
      caloriesProbe.push({ id, raw: r });
    });
    const best = caloriesProbe.reduce((a, r) => (r.raw.sum > (a?.raw.sum || 0) ? r : a), null);
    calories = best?.raw?.sum || 0;
  }

  if (calories === 0) {
    const bmrPerDay = latestBmrKcalPerDay_(startMs, endMs);
    if (bmrPerDay > 0) {
      const fractionOfDay = (endMs - startMs) / 86400000;
      calories = bmrPerDay * fractionOfDay;
    }
  }

  const totals = {
    steps: Math.round(steps),
    heartPoints: Math.round(heart),
    moveMinutes: Math.round(active),
    calories: Math.round(calories)
  };

  const debug = wantDebug ? {
    agg,
    picks: {
      steps: { val: totals.steps, probes: stepsProbe },
      heart: { val: totals.heartPoints, probes: heartProbe },
      active: { val: totals.moveMinutes, probes: activeProbe },
      calories: { val: totals.calories, probes: caloriesProbe }
    },
    range
  } : undefined;

  return wantDebug ? { totals, debug } : { totals };
}

function doGet(e) {
  try {
    const p = e?.parameter || {};

    const expectedToken = PropertiesService.getScriptProperties().getProperty('TRMNL_TOKEN');

    if (!expectedToken) {
      return jsonOutput_({
        error: 'TRMNL_TOKEN is not set. Run setupToken first.'
      });
    }

    if (p.token !== expectedToken) {
      return jsonOutput_({ error: 'Unauthorized' });
    }

    const wantDebug = String(p.debug || '') === '1';
    const range = dateRangeMs_(p.window);
    const { totals, debug } = fetchTotals_(range, wantDebug);

    const goals = {
      steps: Number(p.steps_goal ?? 6500),
      heartPoints: Number(p.heart_goal ?? 20),
      moveMinutes: Number(p.move_goal ?? 60),
      calories: Number(p.cal_goal ?? 2200)
    };

    const progress = {
      steps_pct: clamp01(goals.steps ? totals.steps / goals.steps : 0),
      heart_pct: clamp01(goals.heartPoints ? totals.heartPoints / goals.heartPoints : 0),
      move_pct: clamp01(goals.moveMinutes ? totals.moveMinutes / goals.moveMinutes : 0),
      cal_pct: clamp01(goals.calories ? totals.calories / goals.calories : 0)
    };

    const payload = {
      dateISO: range.dateISO,
      nowHour: range.nowHour,
      totals,
      goals,
      progress
    };

    if (wantDebug) payload.debug = debug;

    return jsonOutput_(payload);
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testFetch() {
  const range = dateRangeMs_();
  const { totals } = fetchTotals_(range, true);
  Logger.log(totals);
}

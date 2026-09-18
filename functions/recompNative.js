const { normalizeAppleHealthPayload, mergeAppleHealthLog, safeTokenMatch } = require("./recompHealth");
const {
  normalizeFoods, normalizeDailyConfirmation, mergeDailyConfirmation,
  normalizeWorkout, normalizePreferences, validDate, number, cleanString,
} = require("./recompNativeData");

const PROFILE_IDS = new Set(["zackdark", "tony"]);
const FIELD_LIMITS = {
  calories: [0, 10000], protein: [0, 1000], water: [0, 20],
  weight: [20, 400], steps: [0, 200000], sleep: [0, 1440],
  exerciseMinutes: [0, 1440], zone2Minutes: [0, 1440],
  carbs: [0, 2000], fat: [0, 1000], fiber: [0, 200], produceServings: [0, 30],
  waist: [20, 300], bodyFat: [0, 75], muscle: [0, 300], visceral: [0, 100],
  hunger: [0, 10], energy: [0, 10],
};

function normalizeNativeEntry(raw) {
  if (!validDate(raw?.date)) throw new Error("invalid-date");
  const fields = {};
  for (const [name, [min, max]] of Object.entries(FIELD_LIMITS)) {
    if (!Object.hasOwn(raw.fields || {}, name)) continue;
    const value = raw.fields[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`invalid-${name}`);
    fields[name] = value;
  }
  if (Object.hasOwn(raw.fields || {}, "notes")) {
    if (typeof raw.fields.notes !== "string" || raw.fields.notes.length > 2000) throw new Error("invalid-notes");
    fields.notes = raw.fields.notes.trim();
  }
  for (const key of ["exerciseDescription", "mood"]) {
    if (Object.hasOwn(raw.fields || {}, key)) fields[key] = cleanString(raw.fields[key], key === "mood" ? 40 : 240, key);
  }
  for (const key of ["workout", "restDay", "sickDay", "vacationMode"]) {
    if (Object.hasOwn(raw.fields || {}, key)) {
      if (typeof raw.fields[key] !== "boolean") throw new Error(`invalid-${key}`);
      fields[key] = raw.fields[key];
    }
  }
  if (!Object.keys(fields).length) throw new Error("no-fields");
  return { date: raw.date, fields };
}

function mergeNativeEntry(current, { date, fields }, profileId, now) {
  const previous = current && typeof current === "object" ? current : {};
  const sources = { ...(previous.sources || {}) };
  for (const name of Object.keys(fields)) sources[name] = "manual";
  return {
    ...previous, ...fields, sources,
    id: previous.id || `${profileId}-${date}`,
    profileId, date,
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
}

function createNativeHandler({ db, root, estimateFood, parseDailyText }) {
  return async (request, response) => {
    const profileId = String(request.method === "GET" ? request.query?.profileId : request.body?.profileId || "");
    if (!PROFILE_IDS.has(profileId)) return response.status(400).json({ error: "invalid-profile" });
    const header = String(request.get("authorization") || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const pairing = (await db.ref(`${root}/nativePairings/${profileId}`).once("value")).val() || {};
    if (!safeTokenMatch(token, pairing.tokenHash)) return response.status(401).json({ error: "invalid-pairing-token" });
    if (request.method === "GET") {
      const peerId = profileId === "tony" ? "zackdark" : "tony";
      const ownLogsRef = db.ref(`${root}/data/logs/${profileId}`);
      const [logs, plan, integration, workouts, healthWorkouts, preferences, peerLogs] = await Promise.all([
        request.query?.export === "1" ? ownLogsRef.once("value") : ownLogsRef.orderByKey().limitToLast(120).once("value"),
        db.ref(`${root}/data/plans/${profileId}`).once("value"),
        db.ref(`${root}/data/integrations/appleHealth/${profileId}`).once("value"),
        db.ref(`${root}/data/workouts/${profileId}`).once("value"),
        db.ref(`${root}/data/healthWorkouts/${profileId}`).once("value"),
        db.ref(`${root}/data/preferences`).once("value"),
        db.ref(`${root}/data/logs/${peerId}`).orderByKey().limitToLast(120).once("value"),
      ]);
      const peerSummary = Object.fromEntries(Object.entries(peerLogs.val() || {}).map(([date, log]) => [date, {
        date, weight: log.weight ?? null, calories: log.calories ?? null,
        protein: log.protein ?? null, steps: log.steps ?? null,
        exerciseMinutes: log.exerciseMinutes ?? null, workout: log.workout === true,
      }]));
      return response.status(200).json({
        profileId, logs: logs.val() || {}, plan: plan.val() || {}, appleHealth: integration.val() || {},
        workouts: workouts.val() || {}, healthWorkouts: healthWorkouts.val() || {},
        preferences: preferences.val() || {}, peerProfileId: peerId, peerLogs: peerSummary,
      });
    }
    if (request.method !== "POST") return response.set("Allow", "GET, POST").status(405).json({ error: "method-not-allowed" });
    const action = request.body?.action;
    if (action === "estimateFood" || action === "parseDailyText") {
      const handler = action === "estimateFood" ? estimateFood : parseDailyText;
      if (!handler) return response.status(503).json({ error: "ai-unavailable" });
      try { return response.status(200).json(await handler(request.body, profileId)); }
      catch (error) { return response.status(error.status || 400).json({ error: error.message || "ai-failed" }); }
    }
    if (request.body?.action === "syncHealth") {
      let payload;
      try { payload = normalizeAppleHealthPayload(request.body.payload); }
      catch (error) { return response.status(400).json({ error: error.message }); }
      if (payload.profileId !== profileId) return response.status(403).json({ error: "profile-mismatch" });
      const syncedAt = new Date().toISOString();
      const workoutUpdates = {};
      for (const day of payload.days) {
        await db.ref(`${root}/data/logs/${profileId}/${day.date}`).transaction(current =>
          mergeAppleHealthLog(current, day, syncedAt, profileId, payload.capturedAt));
        for (const workout of day.workouts) workoutUpdates[`${root}/data/healthWorkouts/${profileId}/${workout.id}`] = {
          ...workout, date: day.date, profileId, syncedAt,
        };
      }
      await db.ref().update({
        ...workoutUpdates,
        [`${root}/data/integrations/appleHealth/${profileId}/paired`]: true,
        [`${root}/data/integrations/appleHealth/${profileId}/lastSyncedAt`]: syncedAt,
        [`${root}/data/integrations/appleHealth/${profileId}/lastCapturedAt`]: payload.capturedAt,
        [`${root}/data/integrations/appleHealth/${profileId}/daysReceived`]: payload.days.length,
      });
      return response.status(200).json({ ok: true, daysReceived: payload.days.length });
    }
    if (action === "addFoods" || action === "confirmDaily") {
      let confirmation;
      try {
        if (action === "addFoods") {
          if (!validDate(request.body.date) || !["breakfast", "lunch", "dinner", "snacks"].includes(request.body.meal)) throw new Error("invalid-meal");
          confirmation = { date: request.body.date, foods: normalizeFoods(request.body.foods).map(food => ({ ...food, meal: request.body.meal })), fields: {} };
        } else confirmation = normalizeDailyConfirmation(request.body);
      } catch (error) { return response.status(400).json({ error: error.message }); }
      const now = new Date().toISOString();
      const result = await db.ref(`${root}/data/logs/${profileId}/${confirmation.date}`).transaction(current =>
        mergeDailyConfirmation(current, confirmation, profileId, now));
      return response.status(200).json({ ok: true, log: result.snapshot.val() });
    }
    if (action === "saveWorkout") {
      let workout;
      try { workout = normalizeWorkout(request.body.workout, profileId); }
      catch (error) { return response.status(400).json({ error: error.message }); }
      const now = new Date().toISOString();
      const workoutRef = db.ref(`${root}/data/workouts/${profileId}/${workout.date}_${workout.type}`);
      await workoutRef.transaction(current => ({ ...current, ...workout, createdAt: current?.createdAt || now, updatedAt: now }));
      await db.ref(`${root}/data/logs/${profileId}/${workout.date}`).transaction(current => mergeNativeEntry(current, {
        date: workout.date, fields: { workout: true, restDay: false },
      }, profileId, now));
      return response.status(200).json({ ok: true });
    }
    if (action === "updatePlan") {
      let target;
      try { target = number(request.body.calorieTarget, 5000, "calorieTarget", 800); }
      catch (error) { return response.status(400).json({ error: error.message }); }
      const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      const now = new Date().toISOString();
      const ref = db.ref(`${root}/data/plans/${profileId}`);
      let changed = false;
      const result = await ref.transaction(current => {
        const previous = current || {};
        const oldTarget = Number(previous.calorieTarget || (profileId === "tony" ? 2100 : 2000));
        if (oldTarget === target) return previous;
        const history = Array.isArray(previous.history) ? previous.history : Object.values(previous.history || {});
        if (history.length && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${history.at(-1).date}T00:00:00Z`) < 7 * 86400000) return;
        changed = true;
        return { ...previous, calorieTarget: target, history: [...history, { from: oldTarget, to: target, date, reason: "manual-native", createdAt: now }] };
      });
      if (!result.committed) return response.status(409).json({ error: "plan-adjustment-too-soon" });
      return response.status(200).json({ ok: true, changed, plan: result.snapshot.val() });
    }
    if (action === "updatePreferences") {
      let next;
      try {
        const ref = db.ref(`${root}/data/preferences`);
        await ref.transaction(current => {
          next = normalizePreferences(request.body.preferences, current || {});
          return next;
        });
      } catch (error) { return response.status(400).json({ error: error.message }); }
      return response.status(200).json({ ok: true, preferences: next });
    }
    let entry;
    try { entry = normalizeNativeEntry(request.body); }
    catch (error) { return response.status(400).json({ error: error.message }); }
    const now = new Date().toISOString();
    const logRef = db.ref(`${root}/data/logs/${profileId}/${entry.date}`);
    const result = await logRef.transaction(current => mergeNativeEntry(current, entry, profileId, now));
    return response.status(200).json({ ok: true, log: result.snapshot.val() });
  };
}

module.exports = { normalizeNativeEntry, mergeNativeEntry, createNativeHandler };

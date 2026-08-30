const crypto = require("crypto");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WORKOUT_ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;

function finiteNumber(value, minimum, maximum) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return undefined;
  return number;
}

function validISODate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizeWorkout(raw) {
  const id = String(raw?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 160);
  if (!WORKOUT_ID_PATTERN.test(id) || !validISODate(raw?.startAt) || !validISODate(raw?.endAt)) return null;
  const output = {
    id,
    activityType: String(raw.activityType || "other").slice(0, 80),
    startAt: new Date(raw.startAt).toISOString(),
    endAt: new Date(raw.endAt).toISOString(),
    source: "appleHealth",
  };
  const durationMinutes = finiteNumber(raw.durationMinutes, 0, 1440);
  const energyKcal = finiteNumber(raw.energyKcal, 0, 20000);
  const distanceKm = finiteNumber(raw.distanceKm, 0, 1000);
  if (durationMinutes !== undefined) output.durationMinutes = durationMinutes;
  if (energyKcal !== undefined) output.energyKcal = energyKcal;
  if (distanceKm !== undefined) output.distanceKm = distanceKm;
  return output;
}

function normalizeDay(raw) {
  if (!DATE_PATTERN.test(String(raw?.date || ""))) return null;
  const output = { date: raw.date };
  const fields = [
    ["steps", 0, 200000],
    ["sleepMinutes", 0, 1440],
    ["weightKg", 20, 400],
    ["bodyFatPercent", 1, 75],
    ["leanBodyMassKg", 10, 300],
    ["activeEnergyKcal", 0, 20000],
  ];
  for (const [key, minimum, maximum] of fields) {
    const value = finiteNumber(raw[key], minimum, maximum);
    if (value !== undefined) output[key] = value;
  }
  output.workouts = (Array.isArray(raw.workouts) ? raw.workouts : [])
    .slice(0, 100)
    .map(normalizeWorkout)
    .filter(Boolean);
  return output;
}

function normalizeAppleHealthPayload(raw) {
  const profileId = String(raw?.profileId || "");
  if (!['zackdark', 'tony'].includes(profileId)) throw new Error("invalid-profile");
  if (!validISODate(raw?.capturedAt)) throw new Error("invalid-captured-at");
  if (!Array.isArray(raw?.days) || raw.days.length < 1 || raw.days.length > 31) throw new Error("invalid-days");
  const days = raw.days.map(normalizeDay).filter(Boolean);
  if (!days.length || days.length !== raw.days.length) throw new Error("invalid-day");
  return {
    profileId,
    capturedAt: new Date(raw.capturedAt).toISOString(),
    timezone: String(raw.timezone || "Asia/Bangkok").slice(0, 80),
    days,
  };
}

function mergeAppleHealthLog(existing, day, syncedAt, profileId, capturedAt = syncedAt) {
  const current = existing && typeof existing === "object" ? existing : {};
  const previousCapture = current.sourceUpdatedAt?.appleHealth;
  if (previousCapture && String(previousCapture) > String(capturedAt)) return current;
  const sources = { ...(current.sources || {}) };
  const next = { ...current };
  const mappings = [
    ["steps", "steps"],
    ["sleepMinutes", "sleep"],
    ["weightKg", "weight"],
    ["bodyFatPercent", "bodyFat"],
    ["leanBodyMassKg", "leanBodyMass"],
    ["activeEnergyKcal", "activeEnergy"],
  ];
  let changed = false;
  for (const [sourceKey, destinationKey] of mappings) {
    if (day[sourceKey] === undefined) continue;
    const canReplace = next[destinationKey] === undefined || sources[destinationKey] === "appleHealth";
    if (canReplace && next[destinationKey] !== day[sourceKey]) {
      next[destinationKey] = day[sourceKey];
      sources[destinationKey] = "appleHealth";
      changed = true;
    }
  }
  if (day.workouts.length && next.workout !== true) {
    next.workout = true;
    sources.workout = "appleHealth";
    changed = true;
  }
  if (!changed) return current;
  return {
    ...next,
    id: current.id || `${profileId}-${day.date}`,
    profileId,
    date: day.date,
    createdAt: current.createdAt || syncedAt,
    updatedAt: syncedAt,
    sources,
    sourceUpdatedAt: { ...(current.sourceUpdatedAt || {}), appleHealth: capturedAt },
  };
}

function hashPairingToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function safeTokenMatch(token, expectedHash) {
  if (typeof token !== "string" || token.length < 32 || typeof expectedHash !== "string") return false;
  const actual = Buffer.from(hashPairingToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  hashPairingToken,
  mergeAppleHealthLog,
  normalizeAppleHealthPayload,
  safeTokenMatch,
};

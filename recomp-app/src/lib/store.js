import { makeInitialLogs, PROFILES } from "../data.js";

export const STORE_KEY = "recomp-health-actual-v3";
export const LEGACY_KEY = "recomp-health-actual-v2";

export const defaultPreferences = {
  morningWeighIn: false,
  proteinReminder: false,
  workoutReminder: false,
  weeklyReview: true,
  workoutDays: [1, 3, 6],
  reminderTimes: { morningWeighIn: "07:00", proteinReminder: "17:00", workoutReminder: "18:00", weeklyReview: "19:00" },
};

export function initialStore() {
  return {
    version: 6,
    logs: { zackdark: makeInitialLogs("zackdark"), tony: makeInitialLogs("tony") },
    workouts: { zackdark: [], tony: [] },
    healthWorkouts: { zackdark: [], tony: [] },
    integrations: { appleHealth: {} },
    preferences: { ...defaultPreferences },
    plans: Object.fromEntries(Object.values(PROFILES).map(profile => [profile.id, { calorieTarget: profile.calorieTarget, history: [] }])),
  };
}

export function loadStore() {
  try {
    const current = JSON.parse(localStorage.getItem(STORE_KEY));
    if (current?.logs) {
      const baseline = initialStore();
      return {
        ...baseline,
        ...current,
        healthWorkouts: { ...baseline.healthWorkouts, ...(current.healthWorkouts || {}) },
        integrations: { ...baseline.integrations, ...(current.integrations || {}) },
        preferences: { ...defaultPreferences, ...current.preferences, reminderTimes: { ...defaultPreferences.reminderTimes, ...(current.preferences?.reminderTimes || {}) } },
        plans: { ...baseline.plans, ...(current.plans || {}) },
      };
    }
  } catch {
    // Corrupt local data falls back to a safe baseline and can later be restored from backup.
  }
  // v2 contained prototype/demo values, so it is deliberately not migrated into the real-data store.
  return initialStore();
}

export function saveStore(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, version: 6 }));
}

export function cleanLogInput(form) {
  const numericFields = ["weight", "calories", "protein", "carbs", "fat", "fiber", "produceServings", "water", "steps", "zone2Minutes", "waist", "bodyFat", "muscle", "visceral", "hunger", "energy"];
  const output = { date: form.date, mood: form.mood || null, notes: form.notes?.trim() || null, workout: Boolean(form.workout), restDay: Boolean(form.restDay), sickDay: Boolean(form.sickDay), vacationMode: Boolean(form.vacationMode) };
  numericFields.forEach(key => {
    if (form[key] !== "" && form[key] !== null && form[key] !== undefined && Number.isFinite(Number(form[key]))) output[key] = Number(form[key]);
  });
  if (form.sleepHours !== "" || form.sleepMinutes !== "") output.sleep = (Number(form.sleepHours) || 0) * 60 + (Number(form.sleepMinutes) || 0);
  const meals = Object.fromEntries(Object.entries(form.meals || {}).map(([key, meal]) => [key, {
    calories: Number(meal.calories) || 0,
    protein: Number(meal.protein) || 0,
    carbs: Number(meal.carbs) || 0,
    fat: Number(meal.fat) || 0,
    fiber: Number(meal.fiber) || 0,
    produceServings: Number(meal.produceServings) || 0,
    items: Array.isArray(meal.items) ? meal.items : [],
  }]).filter(([, meal]) => meal.calories || meal.protein || meal.carbs || meal.fat || meal.fiber || meal.produceServings || meal.items.length));
  if (Object.keys(meals).length) output.meals = meals;
  return output;
}

export function upsertProfileLog(state, profileId, input) {
  const previous = state.logs[profileId] || [];
  const existing = previous.find(log => log.date === input.date) || {};
  const merged = { ...existing, ...input, id: existing.id || `${profileId}-${input.date}`, profileId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
  return {
    ...state,
    logs: { ...state.logs, [profileId]: [...previous.filter(log => log.date !== input.date), merged].sort((a, b) => a.date.localeCompare(b.date)) },
  };
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CSV_FIELDS = ["profileId", "date", "weight", "calories", "protein", "carbs", "fat", "fiber", "produceServings", "water", "steps", "zone2Minutes", "exerciseMinutes", "restingHeartRate", "sleep", "waist", "bodyFat", "muscle", "visceral", "mood", "hunger", "energy", "workout", "restDay", "sickDay", "vacationMode", "notes"];

const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function exportCsv(logsByProfile) {
  const rows = Object.values(logsByProfile).flat().sort((a, b) => a.date.localeCompare(b.date));
  return [CSV_FIELDS.join(","), ...rows.map(row => CSV_FIELDS.map(field => csvCell(row[field])).join(","))].join("\n");
}

function parseCsvLine(line) {
  const result = [];
  let value = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { result.push(value); value = ""; }
    else value += char;
  }
  result.push(value);
  return result;
}

export function importCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV ไม่มีข้อมูลสำหรับนำเข้า");
  const headers = parseCsvLine(lines[0]);
  if (!headers.includes("profileId") || !headers.includes("date")) throw new Error("CSV ต้องมีคอลัมน์ profileId และ date");
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (!PROFILES[row.profileId]) throw new Error(`ไม่รู้จัก profile: ${row.profileId}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`วันที่ไม่ถูกต้อง: ${row.date}`);
    const numericFields = ["weight", "calories", "protein", "carbs", "fat", "fiber", "produceServings", "water", "steps", "zone2Minutes", "exerciseMinutes", "restingHeartRate", "sleep", "waist", "bodyFat", "muscle", "visceral", "hunger", "energy"];
    numericFields.forEach(field => { if (row[field] === "") delete row[field]; else row[field] = Number(row[field]); });
    ["workout", "restDay", "sickDay", "vacationMode"].forEach(field => { row[field] = row[field] === "true"; });
    return row;
  });
}

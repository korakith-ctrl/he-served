const NUTRIENTS = { calories: 10000, protein: 1000, carbs: 2000, fat: 1000, fiber: 200, produceServings: 30 };
const MEALS = new Set(["breakfast", "lunch", "dinner", "snacks"]);

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function number(value, max, name, min = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`invalid-${name}`);
  return value;
}

function cleanString(value, max, name, { required = false } = {}) {
  if (typeof value !== "string" || value.length > max) throw new Error(`invalid-${name}`);
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (required && !text) throw new Error(`invalid-${name}`);
  return text;
}

function normalizeFoods(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 12) throw new Error("invalid-foods");
  return raw.map(food => {
    const result = {
      name: cleanString(food?.name, 120, "food-name", { required: true }),
      serving: cleanString(food?.serving || "1 ส่วน", 160, "serving", { required: true }),
      source: ["native", "food-photo-estimate", "daily-text-estimate", "preset"].includes(food?.source) ? food.source : "native",
    };
    for (const [key, max] of Object.entries(NUTRIENTS)) result[key] = number(food?.[key], max, key);
    if (food.meal != null) {
      if (!MEALS.has(food.meal)) throw new Error("invalid-meal");
      result.meal = food.meal;
    }
    return result;
  });
}

function appendFoods(current, mealKey, foods, profileId, date, now) {
  if (!MEALS.has(mealKey)) throw new Error("invalid-meal");
  const previous = current && typeof current === "object" ? current : {};
  const meals = { ...(previous.meals || {}) };
  const meal = { ...(meals[mealKey] || {}) };
  const items = Array.isArray(meal.items) ? meal.items : Object.values(meal.items || {});
  meal.items = [
    ...items,
    ...foods.map((food, index) => ({ ...food, entryId: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}` })),
  ];
  for (const [key, max] of Object.entries(NUTRIENTS)) {
    const value = Number(meal[key] || 0) + foods.reduce((sum, food) => sum + food[key], 0);
    if (!Number.isFinite(value) || value > max) throw new Error(`invalid-${key}-total`);
    meal[key] = key === "calories" ? Math.round(value) : Math.round(value * 10) / 10;
  }
  meals[mealKey] = meal;
  const totals = {};
  for (const [key, max] of Object.entries(NUTRIENTS)) {
    const total = Object.values(meals).reduce((sum, item) => sum + (Number(item?.[key]) || 0), 0);
    if (total > max) throw new Error(`invalid-${key}-total`);
    totals[key] = key === "calories" ? Math.round(total) : Math.round(total * 10) / 10;
  }
  return {
    ...previous, meals, ...totals,
    id: previous.id || `${profileId}-${date}`, profileId, date,
    createdAt: previous.createdAt || now, updatedAt: now,
    sources: { ...(previous.sources || {}), ...Object.fromEntries(Object.keys(totals).map(key => [key, "manual"])) },
  };
}

function normalizeDailyConfirmation(raw) {
  if (!validDate(raw?.date)) throw new Error("invalid-date");
  const foods = raw.foods?.length ? normalizeFoods(raw.foods) : [];
  if (foods.some(food => !MEALS.has(food.meal))) throw new Error("invalid-meal");
  const fields = {};
  if (raw.waterMentioned === true) fields.water = number(raw.waterLiters, 20, "water");
  if (raw.stepsMentioned === true) fields.steps = number(raw.steps, 200000, "steps");
  if (raw.exerciseMentioned === true) {
    fields.exerciseMinutes = number(raw.exerciseMinutes, 1440, "exerciseMinutes");
    fields.zone2Minutes = number(raw.zone2Minutes, 1440, "zone2Minutes");
    fields.exerciseDescription = cleanString(raw.exerciseDescription || "", 240, "exerciseDescription");
    if (raw.workoutDone === true) { fields.workout = true; fields.restDay = false; }
  }
  if (!foods.length && !Object.keys(fields).length) throw new Error("empty-daily-confirmation");
  return { date: raw.date, foods, fields };
}

function mergeDailyConfirmation(current, confirmation, profileId, now) {
  let next = current && typeof current === "object" ? current : {};
  for (const meal of MEALS) {
    const foods = confirmation.foods.filter(food => food.meal === meal).map(({ meal: _, ...food }) => food);
    if (foods.length) next = appendFoods(next, meal, foods, profileId, confirmation.date, now);
  }
  const sources = { ...(next.sources || {}) };
  for (const key of Object.keys(confirmation.fields)) sources[key] = "manual";
  return {
    ...next, ...confirmation.fields, sources,
    id: next.id || `${profileId}-${confirmation.date}`,
    profileId, date: confirmation.date,
    createdAt: next.createdAt || now, updatedAt: now,
  };
}

function normalizeWorkout(raw, profileId) {
  if (!validDate(raw?.date) || !["A", "B"].includes(raw?.type)) throw new Error("invalid-workout");
  if (!Array.isArray(raw.exercises) || raw.exercises.length < 1 || raw.exercises.length > 20) throw new Error("invalid-exercises");
  const exercises = raw.exercises.map(exercise => {
    const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
    if (sets.length < 1 || sets.length > 12) throw new Error("invalid-sets");
    return {
      name: cleanString(exercise.name, 120, "exercise-name", { required: true }),
      scheme: cleanString(exercise.scheme || "", 40, "exercise-scheme"),
      done: exercise.done === true,
      rir: exercise.rir == null ? null : number(exercise.rir, 10, "rir"),
      sets: sets.map(set => ({
        weight: set.weight == null ? null : number(set.weight, 500, "set-weight"),
        reps: set.reps == null ? null : number(set.reps, 100, "set-reps"),
      })),
    };
  });
  return {
    id: `${profileId}-${raw.date}-${raw.type}`,
    profileId, date: raw.date, type: raw.type,
    durationMinutes: raw.durationMinutes == null ? null : number(raw.durationMinutes, 300, "durationMinutes"),
    exercises,
    completedExercises: exercises.filter(exercise => exercise.done).length,
  };
}

function normalizePreferences(raw, current = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid-preferences");
  const result = { ...current };
  for (const key of ["morningWeighIn", "proteinReminder", "workoutReminder", "weeklyReview"]) {
    if (Object.hasOwn(raw, key)) {
      if (typeof raw[key] !== "boolean") throw new Error(`invalid-${key}`);
      result[key] = raw[key];
    }
  }
  if (Object.hasOwn(raw, "workoutDays")) {
    if (!Array.isArray(raw.workoutDays) || raw.workoutDays.some(value => !Number.isInteger(value) || value < 0 || value > 6)) throw new Error("invalid-workoutDays");
    result.workoutDays = [...new Set(raw.workoutDays)].sort();
  }
  if (Object.hasOwn(raw, "reminderTimes")) {
    if (!raw.reminderTimes || typeof raw.reminderTimes !== "object" || Array.isArray(raw.reminderTimes)) throw new Error("invalid-reminderTimes");
    const times = { ...(current.reminderTimes || {}) };
    for (const [key, value] of Object.entries(raw.reminderTimes)) {
      if (!["morningWeighIn", "proteinReminder", "workoutReminder", "weeklyReview"].includes(key) || typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("invalid-reminderTime");
      times[key] = value;
    }
    result.reminderTimes = times;
  }
  return result;
}

module.exports = { NUTRIENTS, MEALS, validDate, number, cleanString, normalizeFoods, appendFoods, normalizeDailyConfirmation, mergeDailyConfirmation, normalizeWorkout, normalizePreferences };

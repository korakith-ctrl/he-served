const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeFoods, normalizeDailyConfirmation, mergeDailyConfirmation,
  normalizeWorkout, normalizePreferences,
} = require("./recompNativeData");

const food = {
  name: "ข้าวกะเพราไก่", serving: "1 จาน", calories: 650,
  protein: 32, carbs: 75, fat: 24, fiber: 3, produceServings: 0,
};

test("native food confirmation appends to the meal and preserves legacy entries and HealthKit fields", () => {
  const confirmation = normalizeDailyConfirmation({
    date: "2026-09-17", foods: [{ ...food, meal: "lunch" }], waterMentioned: true, waterLiters: 1.5,
  });
  const existing = {
    meals: { lunch: { items: ["ไข่ต้ม"], calories: 140, protein: 12 } },
    steps: 9000, sources: { steps: "appleHealth" }, otherWebField: "kept",
  };
  const merged = mergeDailyConfirmation(existing, confirmation, "tony", "2026-09-17T06:00:00Z");
  assert.equal(merged.meals.lunch.items[0], "ไข่ต้ม");
  assert.equal(merged.meals.lunch.items[1].name, food.name);
  assert.equal(merged.meals.lunch.calories, 790);
  assert.equal(merged.calories, 790);
  assert.equal(merged.water, 1.5);
  assert.equal(merged.steps, 9000);
  assert.equal(merged.sources.steps, "appleHealth");
  assert.equal(merged.otherWebField, "kept");
});

test("native food and daily draft reject invalid quantities and unassigned meals", () => {
  assert.throws(() => normalizeFoods([{ ...food, calories: 50000 }]), /invalid-calories/);
  assert.throws(() => normalizeDailyConfirmation({ date: "2026-09-17", foods: [{ ...food, meal: "unassigned" }] }), /invalid-meal/);
  assert.throws(() => normalizeDailyConfirmation({ date: "2026-09-17", foods: [], waterMentioned: true, waterLiters: 30 }), /invalid-water/);
});

test("workouts are bounded and scoped to the paired profile", () => {
  const session = normalizeWorkout({ date: "2026-09-17", type: "A", durationMinutes: 55, exercises: [
    { name: "Squat", scheme: "3 × 8–12", done: true, rir: 2, sets: [{ weight: 70, reps: 10 }] },
  ] }, "tony");
  assert.equal(session.profileId, "tony");
  assert.equal(session.completedExercises, 1);
  assert.throws(() => normalizeWorkout({ date: "2026-09-17", type: "C", exercises: [] }, "tony"), /invalid-workout/);
});

test("preferences merge only supported fields", () => {
  const merged = normalizePreferences({ workoutDays: [3, 1, 3], weeklyReview: false }, { reminderTimes: { weeklyReview: "19:00" }, keep: true });
  assert.deepEqual(merged.workoutDays, [1, 3]);
  assert.equal(merged.reminderTimes.weeklyReview, "19:00");
  assert.equal(merged.keep, true);
  assert.throws(() => normalizePreferences({ reminderTimes: { weeklyReview: "25:99" } }), /invalid-reminderTime/);
});

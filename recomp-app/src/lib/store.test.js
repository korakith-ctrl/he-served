import test from "node:test";
import assert from "node:assert/strict";
import { cleanLogInput, exportCsv, importCsv, initialStore, restoreProfileLog, upsertProfileLog } from "./store.js";

test("clearing daily fields and the last meal removes previous values", () => {
  const state = initialStore();
  state.logs.tony = [{ date: "2026-09-01", weight: 95, sleep: 480, calories: 400, meals: { lunch: { calories: 400 } }, exerciseMinutes: 20 }];
  const next = upsertProfileLog(state, "tony", cleanLogInput({ date: "2026-09-01", weight: "", calories: "", sleepHours: "", sleepMinutes: "", meals: {} }));
  const log = next.logs.tony[0];
  for (const field of ["weight", "sleep", "calories", "meals"]) assert.equal(log[field], null);
  assert.equal(log.exerciseMinutes, 20);
  assert.equal(Object.hasOwn(cleanLogInput({ date: "2026-09-01" }), "sleep"), false);
});

test("manual edits stop retaining Apple Health ownership for changed fields", () => {
  const state = initialStore();
  state.logs.tony = [{ date: "2026-09-01", steps: 5000, weight: 95, sources: { steps: "appleHealth", weight: "appleHealth" } }];
  const next = upsertProfileLog(state, "tony", { date: "2026-09-01", steps: 6000, weight: 95 });
  assert.equal(next.logs.tony[0].sources.steps, "manual");
  assert.equal(next.logs.tony[0].sources.weight, "appleHealth");
});

test("CSV round trips quoted multiline notes and accepts missing optional columns", () => {
  const log = { profileId: "tony", date: "2026-09-01", weight: 95, notes: 'Lunch, "outside"\nWalk after dinner' };
  const [restored] = importCsv(exportCsv({ tony: [log] }));
  assert.equal(restored.notes, log.notes);
  assert.equal(restored.weight, 95);
  const [minimal] = importCsv("profileId,date,weight\ntony,2026-09-01,95");
  assert.equal(Object.hasOwn(minimal, "sleep"), false);
});

test("CSV rejects invalid dates and non-finite values", () => {
  assert.throws(() => importCsv("profileId,date,weight\ntony,2026-02-30,95"));
  assert.throws(() => importCsv("profileId,date,weight\ntony,2026-09-01,Infinity"));
  assert.throws(() => importCsv("profileId,date,weight\ntony,2026-09-01,abc"));
});

test("initial store keeps real starting weights and per-profile calorie plans", () => {
  const store = initialStore();
  assert.equal(store.logs.zackdark[0].weight, 87.8);
  assert.equal(store.logs.tony[0].weight, 95.5);
  assert.equal(store.plans.zackdark.calorieTarget, 2000);
  assert.equal(store.plans.tony.calorieTarget, 2100);
});

test("meal entries produce persisted meal details without losing totals", () => {
  const preset = { entryId: "chicken-1", id: "protein-chicken-breast", name: "อกไก่สุก ไม่ติดหนัง", serving: "100 g", calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, produceServings: 0, source: "usda" };
  const log = cleanLogInput({
    date: "2026-08-31", calories: 360, protein: 35, carbs: 42, fat: 4.1, fiber: 0.6,
    meals: { lunch: { calories: 360, protein: 35, carbs: 42, fat: 4.1, fiber: 0.6, items: [preset, "legacy item"] } },
  });
  assert.equal(log.calories, 360);
  assert.equal(log.meals.lunch.protein, 35);
  assert.equal(log.meals.lunch.carbs, 42);
  assert.equal(log.meals.lunch.fat, 4.1);
  assert.equal(log.meals.lunch.fiber, 0.6);
  assert.equal(log.meals.lunch.items.length, 2);
  assert.equal(log.meals.lunch.items[0].source, "usda");
});

test("manual update preserves Apple Health-only metrics", () => {
  const store = initialStore();
  store.logs.tony.push({ id: "tony-2026-08-31", profileId: "tony", date: "2026-08-31", steps: 9000, exerciseMinutes: 45, restingHeartRate: 60, sources: { steps: "appleHealth" } });
  const next = upsertProfileLog(store, "tony", { date: "2026-08-31", calories: 2100, protein: 140 });
  const log = next.logs.tony.find(item => item.date === "2026-08-31");
  assert.equal(log.exerciseMinutes, 45);
  assert.equal(log.restingHeartRate, 60);
  assert.equal(log.calories, 2100);
});

test("undo restores only the saved date and keeps other dates", () => {
  const logs = [{ date: "2026-09-15", weight: 80 }, { date: "2026-09-16", weight: 79 }, { date: "2026-09-17", weight: 78 }];
  assert.deepEqual(restoreProfileLog(logs, "2026-09-16", null), [logs[0], logs[2]]);
  assert.deepEqual(restoreProfileLog(logs, "2026-09-16", { date: "2026-09-16", weight: 79.5 }), [logs[0], { date: "2026-09-16", weight: 79.5 }, logs[2]]);
});

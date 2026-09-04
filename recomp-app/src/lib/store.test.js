import test from "node:test";
import assert from "node:assert/strict";
import { cleanLogInput, initialStore, upsertProfileLog } from "./store.js";

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

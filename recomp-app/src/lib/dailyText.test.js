import test from "node:test";
import assert from "node:assert/strict";
import { applyDailyTextEstimate, waterEntryValue } from "./dailyText.js";
import { cleanLogInput } from "./store.js";

const food = { meal: "lunch", name: "กะเพราไก่ไข่ดาว", serving: "1 จาน", calories: 650, protein: 32, carbs: 70, fat: 26, fiber: 3, produceServings: 0.5, quantity: 1 };
const form = { date: "2026-09-16", meals: { breakfast: { calories: 100, protein: 5, carbs: 10, fat: 3, fiber: 0, produceServings: 0, items: [{ entryId: "old", name: "นม" }] }, lunch: { calories: "", protein: "", carbs: "", fat: "", fiber: "", produceServings: "", items: [] }, dinner: { items: [] }, snacks: { items: [] } }, water: 0.5, steps: 3000, exerciseMinutes: "", workout: false, restDay: false };

test("one review adds food to the chosen meal and records water and exercise", () => {
  const estimate = { foods: [food], waterMentioned: true, waterLiters: 1.5, exerciseMentioned: true, exerciseDescription: "เดินเร็ว", exerciseMinutes: 30, zone2Minutes: 30, stepsMentioned: true, steps: 6000, workoutDone: true };
  const next = applyDailyTextEstimate(form, estimate, () => "new");
  assert.equal(next.meals.breakfast.items[0].entryId, "old");
  assert.equal(next.meals.lunch.items[0].entryId, "new");
  assert.equal(next.meals.lunch.items[0].source, "daily-text-estimate");
  assert.equal(next.calories, 750);
  assert.equal(next.water, 1.5);
  assert.equal(next.steps, 6000);
  assert.equal(next.exerciseMinutes, 30);
  assert.equal(next.exerciseDescription, "เดินเร็ว");
  assert.equal(next.workout, true);
  const saved = cleanLogInput(next);
  assert.equal(saved.exerciseMinutes, 30);
  assert.equal(saved.exerciseDescription, "เดินเร็ว");
  assert.equal(saved.meals.lunch.items[0].name, "กะเพราไก่ไข่ดาว");
});

test("missing sections preserve existing values and unassigned food cannot be applied", () => {
  const waterOnly = applyDailyTextEstimate(form, { foods: [], waterMentioned: true, waterLiters: 2, exerciseMentioned: false, stepsMentioned: false });
  assert.equal(waterOnly.water, 2);
  assert.equal(waterOnly.steps, 3000);
  assert.equal(waterOnly.meals.breakfast.items.length, 1);
  assert.throws(() => applyDailyTextEstimate(form, { foods: [{ ...food, meal: "unassigned" }], waterMentioned: false, exerciseMentioned: false, stepsMentioned: false }));
  assert.throws(() => applyDailyTextEstimate(form, { foods: [], waterMentioned: false, exerciseMentioned: false, stepsMentioned: false }));
});

test("water entry distinguishes adding a glass from setting today's total", () => {
  assert.equal(waterEntryValue(1.25, 0.5, "add"), 1.75);
  assert.equal(waterEntryValue(1.25, 2, "total"), 2);
  assert.throws(() => waterEntryValue(19.8, 0.5, "add"));
});

test("water-only review preserves manually entered nutrition totals", () => {
  const manual = { ...form, calories: 1800, protein: 120, meals: { ...form.meals, breakfast: { ...form.meals.breakfast, calories: "", protein: "" } } };
  const next = applyDailyTextEstimate(manual, { foods: [], waterMentioned: true, waterLiters: 2, exerciseMentioned: false, stepsMentioned: false });
  assert.equal(next.calories, 1800);
  assert.equal(next.protein, 120);
  assert.equal(next.water, 2);
});

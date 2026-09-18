import test from "node:test";
import assert from "node:assert/strict";
import { reviewedPhotoFoods, addPhotoFoodsToMeal, prepareFoodPhoto } from "./foodPhoto.js";
import { cleanLogInput } from "./store.js";

const food = { name: "ข้าวผัด", serving: "1 จาน", quantity: 0.5, calories: 600, protein: 20, carbs: 80, fat: 22, fiber: 3, produceServings: 1 };
test("half a photographed portion scales every nutrient once", () => {
  const [entry] = reviewedPhotoFoods([food]);
  assert.equal(entry.calories, 300);
  assert.equal(entry.protein, 10);
  assert.equal(entry.carbs, 40);
  assert.equal(entry.fat, 11);
  assert.equal(entry.fiber, 1.5);
  assert.equal(entry.produceServings, 0.5);
  assert.equal(entry.serving, "1 จาน × 0.5");
  assert.equal(entry.approximate, true);
});
test("batch add preserves existing meal data and survives diary serialization", () => {
  const before = { calories: 100, protein: 5, items: [{ entryId: "old", name: "นม", calories: 100, protein: 5 }] };
  const entries = reviewedPhotoFoods([food, { ...food, name: "อีกจาน", quantity: 1 }]);
  let id = 0;
  const next = addPhotoFoodsToMeal(before, entries, () => `photo-${++id}`);
  assert.equal(before.items.length, 1);
  assert.equal(next.calories, 1000);
  assert.equal(next.protein, 35);
  assert.equal(next.items.length, 3);
  assert.deepEqual(next.items.map(item => item.entryId), ["old", "photo-1", "photo-2"]);
  const saved = cleanLogInput({ date: "2026-09-16", calories: next.calories, meals: { lunch: next } });
  assert.equal(saved.meals.lunch.items[1].source, "photo-estimate");
  assert.equal(saved.meals.lunch.calories, 1000);
  assert.equal(JSON.stringify(saved).includes("imageBase64"), false);
});
test("blank, negative, excessive or invalid review values cannot be added", () => {
  for (const quantity of [0, -1, 11, "", NaN]) assert.throws(() => reviewedPhotoFoods([{ ...food, quantity }]));
  for (const calories of ["", null, -1, Infinity]) assert.throws(() => reviewedPhotoFoods([{ ...food, calories }]));
  assert.throws(() => reviewedPhotoFoods([]));
  assert.throws(() => reviewedPhotoFoods([{ ...food, name: " " }]));
  assert.throws(() => addPhotoFoodsToMeal({ calories: 9900 }, reviewedPhotoFoods([food]), () => "id"));
});
test("oversized and unsupported originals fail before decoding/upload", async () => {
  await assert.rejects(prepareFoodPhoto({ type: "image/jpeg", size: 21 * 1024 * 1024 }));
  await assert.rejects(prepareFoodPhoto({ type: "text/html", size: 100 }));
  await assert.rejects(prepareFoodPhoto({ type: "image/png", size: 0 }));
});

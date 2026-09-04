import test from "node:test";
import assert from "node:assert/strict";
import {
  inventoryConfigurationIssues,
  inventoryUsageSnapshot,
  resolveIngredientAdjustmentsFromOptions,
  resolveLines,
  stockUsageFromSnapshot,
} from "../src/inventory.js";

const ingredients = {
  peace: { id: "peace", name: "Peace", unit: "g", altGroup: "matcha", costPerUnit: 4 },
  nishio: { id: "nishio", name: "Nishio", unit: "g", altGroup: "matcha", costPerUnit: 5 },
  milk: { id: "milk", name: "Milk", unit: "ml", altGroup: "milk", costPerUnit: 1 },
  condensed: { id: "condensed", name: "Condensed", unit: "ml", costPerUnit: 1 },
  evaporated: { id: "evaporated", name: "Evaporated", unit: "ml", costPerUnit: 1 },
  mix: { id: "mix", name: "Milk mix", components: [{ ingredientId: "condensed", ratio: 2 }, { ingredientId: "evaporated", ratio: 1 }] },
};

test("replacement can preserve recipe quantity or use an absolute quantity", () => {
  const menu = { ingredients: [{ ingredientId: "peace", qty: 3 }] };
  const same = resolveIngredientAdjustmentsFromOptions(menu, [{ ingredientId: "nishio", qtyMode: "same" }], ingredients);
  const absolute = resolveIngredientAdjustmentsFromOptions(menu, [{ ingredientId: "nishio", qtyMode: "absolute", qtyValue: 4 }], ingredients);
  assert.deepEqual(resolveLines(menu, same, ingredients), [{ ingredientId: "nishio", qty: 3 }]);
  assert.deepEqual(resolveLines(menu, absolute, ingredients), [{ ingredientId: "nishio", qty: 4 }]);
});

test("legacy qtyPercent remains backward compatible", () => {
  const menu = { ingredients: [{ ingredientId: "peace", qty: 4 }] };
  const rules = resolveIngredientAdjustmentsFromOptions(menu, [{ ingredientId: "nishio", qtyPercent: 25 }], ingredients);
  assert.deepEqual(resolveLines(menu, rules, ingredients), [{ ingredientId: "nishio", qty: 1 }]);
});

test("extra adjustment reaches ingredients inside a mix", () => {
  const menu = { ingredients: [{ ingredientId: "mix", qty: 30 }] };
  const rules = resolveIngredientAdjustmentsFromOptions(menu, [{ extraAdjustments: [{ ingredientId: "condensed", qtyMode: "percent", qtyValue: 50 }] }], ingredients);
  assert.deepEqual(resolveLines(menu, rules, ingredients), [
    { ingredientId: "condensed", qty: 10 },
    { ingredientId: "evaporated", qty: 10 },
  ]);
});

test("absolute adjustment can add an ingredient absent from the base recipe", () => {
  const menu = { ingredients: [{ ingredientId: "peace", qty: 4 }] };
  const rules = resolveIngredientAdjustmentsFromOptions(menu, [{ extraAdjustments: [{ ingredientId: "milk", qtyMode: "absolute", qtyValue: 120 }] }], ingredients);
  assert.equal(rules.issues.length, 0);
  assert.deepEqual(resolveLines(menu, rules, ingredients), [
    { ingredientId: "peace", qty: 4 },
    { ingredientId: "milk", qty: 120 },
  ]);
});

test("invalid percentage adjustment is reported instead of silently ignored", () => {
  const menu = { id: "tea", ingredients: [{ ingredientId: "peace", qty: 4 }], optionGroupIds: ["milk-options"] };
  const groups = [{ id: "milk-options", name: "Milk", choices: [{ id: "whole", label: "Whole", ingredientId: "milk", qtyMode: "same" }] }];
  const issues = inventoryConfigurationIssues(menu, groups, ingredients);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "option_has_no_recipe_source");
});

test("sale usage snapshot round trips independently of later recipes", () => {
  const snapshot = inventoryUsageSnapshot({ nishio: 8, milk: 240 }, ingredients);
  assert.deepEqual(stockUsageFromSnapshot(snapshot), { nishio: 8, milk: 240 });
});

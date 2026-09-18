import test from "node:test";
import assert from "node:assert/strict";
import { caloriesForMenu, formatCalories } from "../src/nutrition.js";

test("nutrition helpers add option calorie deltas to the menu base", () => {
    assert.equal(caloriesForMenu({ kcal: 120 }, [{ kcalDelta: 40 }, { kcalDelta: -10 }]), 150);
    assert.equal(formatCalories(150), "150 kcal");
  });

test("nutrition helpers support legacy calorie field names and empty configuration", () => {
    assert.equal(caloriesForMenu({ calories: 95 }, [{ caloriesDelta: 15 }]), 110);
    assert.equal(caloriesForMenu({ name: "No nutrition yet" }, []), null);
    assert.equal(formatCalories(null), "");
  });

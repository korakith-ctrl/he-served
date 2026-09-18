const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeNativeEntry, mergeNativeEntry, createNativeHandler } = require("./recompNative");
const { hashPairingToken } = require("./recompHealth");

test("native entry keeps untouched Apple Health and meal data", () => {
  const entry = normalizeNativeEntry({ date: "2026-09-17", fields: { water: 2.5, notes: "ดี" } });
  const existing = {
    calories: 650, steps: 9120,
    meals: { lunch: { calories: 650, items: [{ name: "กะเพราไก่" }] } },
    sources: { steps: "appleHealth", calories: "manual" },
  };
  const merged = mergeNativeEntry(existing, entry, "zackdark", "2026-09-17T10:00:00Z");
  assert.equal(merged.steps, 9120);
  assert.equal(merged.calories, 650);
  assert.deepEqual(merged.meals, existing.meals);
  assert.equal(merged.sources.steps, "appleHealth");
  assert.equal(merged.sources.water, "manual");
});

test("native entry rejects invalid dates and impossible values", () => {
  assert.throws(() => normalizeNativeEntry({ date: "2026-02-30", fields: { water: 1 } }), /invalid-date/);
  assert.throws(() => normalizeNativeEntry({ date: "2026-09-17", fields: { water: 25 } }), /invalid-water/);
  assert.throws(() => normalizeNativeEntry({ date: "2026-09-17", fields: { calories: "500" } }), /invalid-calories/);
});

test("native endpoint requires the token for the selected profile", async () => {
  const pairings = {
    "root/nativePairings/zackdark": { tokenHash: hashPairingToken("z".repeat(40)) },
    "root/nativePairings/tony": { tokenHash: hashPairingToken("t".repeat(40)) },
  };
  const db = { ref: path => ({ once: async () => ({ val: () => pairings[path] }) }) };
  const handler = createNativeHandler({ db, root: "root" });
  const response = {
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ method: "GET", query: { profileId: "tony" }, get: () => `Bearer ${"z".repeat(40)}` }, response);
  assert.equal(response.code, 401);
  assert.equal(response.body.error, "invalid-pairing-token");
});

test("native AI only runs after pairing and stays a draft", async () => {
  const token = "t".repeat(40);
  let calls = 0;
  const db = { ref: () => ({ once: async () => ({ val: () => ({ tokenHash: hashPairingToken(token) }) }) }) };
  const handler = createNativeHandler({
    db, root: "root",
    estimateFood: async (body, profileId) => {
      calls += 1;
      assert.equal(profileId, "tony");
      assert.equal(body.description, "กะเพราไก่ไข่ดาว");
      return { isFood: true, foods: [{ name: "กะเพราไก่ไข่ดาว", calories: 600 }] };
    },
  });
  const response = () => ({ status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } });
  const body = { action: "estimateFood", profileId: "tony", description: "กะเพราไก่ไข่ดาว" };
  const denied = response();
  await handler({ method: "POST", body, get: () => "Bearer invalid" }, denied);
  assert.equal(denied.code, 401);
  assert.equal(calls, 0);
  const allowed = response();
  await handler({ method: "POST", body, get: () => `Bearer ${token}` }, allowed);
  assert.equal(allowed.code, 200);
  assert.equal(allowed.body.foods[0].calories, 600);
  assert.equal(calls, 1);
});

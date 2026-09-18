const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDailyLogResult, createDailyLogHandler } = require("./recompDailyLog");

const food = { name: "กะเพราไก่ไข่ดาว", serving: "1 จาน", calories: 650, protein: 32, carbs: 70, fat: 26, fiber: 3, produceServings: 0.5 };
const result = {
  meals: [{ meal: "lunch", foods: [food] }], waterMentioned: true, waterLiters: 1.5,
  exerciseMentioned: true, exerciseDescription: "เดินเร็ว", exerciseMinutes: 30, zone2Minutes: 30,
  stepsMentioned: false, steps: 0, workoutDone: true, assumptions: "ปริมาณอาหารประมาณจากจานทั่วไป",
};
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const response = value => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });

test("separates meal, water and exercise without inventing fields", () => {
  const parsed = normalizeDailyLogResult(result);
  assert.equal(parsed.foods[0].meal, "lunch");
  assert.equal(parsed.foods[0].calories, 650);
  assert.equal(parsed.waterLiters, 1.5);
  assert.equal(parsed.exerciseMinutes, 30);
  assert.equal(parsed.stepsMentioned, false);
  assert.equal(parsed.steps, 0);
});

test("rejects excessive nutrition, hydration and activity values", () => {
  assert.throws(() => normalizeDailyLogResult({ ...result, meals: [{ meal: "invalid", foods: [food] }] }));
  assert.throws(() => normalizeDailyLogResult({ ...result, meals: [{ meal: "lunch", foods: Array(13).fill(food) }] }));
  assert.throws(() => normalizeDailyLogResult({ ...result, waterLiters: 21 }));
  assert.throws(() => normalizeDailyLogResult({ ...result, exerciseMinutes: -1 }));
  assert.throws(() => normalizeDailyLogResult({ ...result, steps: 200001 }));
});

test("requires membership, limits usage and normalizes AI output", async () => {
  let calls = 0;
  const deps = { HttpsError, requireMember: async () => ({ uid: "member" }), rateLimit: async uid => assert.equal(uid, "member"), generate: async () => { calls++; return response(result); } };
  const handler = createDailyLogHandler(deps);
  const parsed = await handler({ data: { description: "กลางวันกินกะเพราไก่ไข่ดาว ดื่มน้ำ 1.5 ลิตร เดินเร็ว 30 นาที" } });
  assert.equal(parsed.foods.length, 1);
  assert.equal(calls, 1);
  await assert.rejects(handler({ data: { description: "สั้น" } }), { code: "invalid-argument" });
  const denied = createDailyLogHandler({ ...deps, requireMember: async () => { throw new HttpsError("permission-denied", "no member"); } });
  await assert.rejects(denied({ data: { description: "กลางวันกินกะเพราไก่ไข่ดาว" } }), { code: "permission-denied" });
  const limited = createDailyLogHandler({ ...deps, rateLimit: async () => { throw new HttpsError("resource-exhausted", "quota"); } });
  await assert.rejects(limited({ data: { description: "กลางวันกินกะเพราไก่ไข่ดาว" } }), { code: "resource-exhausted" });
  assert.equal(calls, 1);
});

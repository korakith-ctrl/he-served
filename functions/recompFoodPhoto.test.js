const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFoodPhotoResult, normalizeFoodPhotoImage, normalizeFoodDescription, shouldTryNextFoodModel, createFoodPhotoHandler } = require("./recompFoodPhoto");
const food = { name: "ข้าวกะเพราไก่", serving: "1 จาน", calories: 550, protein: 25, carbs: 65, fat: 21, fiber: 3, produceServings: 0.5 };
const result = { isFood: true, confidence: "medium", assumptions: "ปริมาณน้ำมันอาจต่างกัน", foods: [food] };
const image = { imageBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"), mimeType: "image/jpeg" };
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const response = value => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });

test("normalizes food estimate without retaining unrelated model output", () => {
  assert.deepEqual(normalizeFoodPhotoResult({ ...result, imageBase64: "do not retain" }), result);
  assert.deepEqual(normalizeFoodPhotoResult({ ...result, isFood: false }).foods, []);
  assert.deepEqual(normalizeFoodPhotoResult({ ...result, foods: [] }).foods, []);
});
test("rejects corrupt nutrition instead of silently undercounting calories", () => {
  for (const value of [-1, Infinity, null, "550", 10001]) {
    assert.throws(() => normalizeFoodPhotoResult({ ...result, foods: [{ ...food, calories: value }] }));
  }
  assert.throws(() => normalizeFoodPhotoResult({ ...result, foods: [{ ...food, calories: 6000 }, { ...food, calories: 6000 }] }));
  assert.throws(() => normalizeFoodPhotoResult({ ...result, foods: Array(13).fill(food) }));
});
test("validates image bytes, MIME, base64 and payload cap", () => {
  assert.equal(normalizeFoodPhotoImage(image.imageBase64, image.mimeType).mimeType, "image/jpeg");
  assert.throws(() => normalizeFoodPhotoImage(Buffer.from("not a photo").toString("base64"), "image/jpeg"));
  assert.throws(() => normalizeFoodPhotoImage(image.imageBase64, "image/png"));
  assert.throws(() => normalizeFoodPhotoImage(image.imageBase64, "text/html"));
  assert.throws(() => normalizeFoodPhotoImage("bad%data", "image/jpeg"));
  assert.throws(() => normalizeFoodPhotoImage("A".repeat(8 * 1024 * 1024), "image/jpeg"));
});
test("accepts a bounded typed food description without treating it as image data", async () => {
  assert.equal(normalizeFoodDescription("  กะเพราไก่ไข่ดาว 1 จาน  "), "กะเพราไก่ไข่ดาว 1 จาน");
  assert.throws(() => normalizeFoodDescription("  "));
  let input;
  const handler = createFoodPhotoHandler({ HttpsError, requireMember: async () => ({ uid: "member-1" }), rateLimit: async () => {}, generate: async value => { input = value; return response(result); } });
  assert.deepEqual(await handler({ data: { description: "กะเพราไก่ไข่ดาว 1 จาน" } }), result);
  assert.deepEqual(input, { description: "กะเพราไก่ไข่ดาว 1 จาน" });
});
test("unauthorized users cannot consume quota or call the model", async () => {
  let touched = false;
  const handler = createFoodPhotoHandler({ HttpsError,
    requireMember: async () => { throw new HttpsError("permission-denied", "members only"); },
    rateLimit: async () => { touched = true; }, generate: async () => { touched = true; },
  });
  await assert.rejects(handler({ data: image }), { code: "permission-denied" });
  assert.equal(touched, false);
});
test("rate limit stops model calls and authorized responses are normalized", async () => {
  let calls = 0;
  const base = { HttpsError, requireMember: async () => ({ uid: "member-1" }), generate: async () => { calls++; return response(result); } };
  const denied = createFoodPhotoHandler({ ...base, rateLimit: async () => { throw new HttpsError("resource-exhausted", "quota"); } });
  await assert.rejects(denied({ data: image }), { code: "resource-exhausted" });
  assert.equal(calls, 0);
  const allowed = createFoodPhotoHandler({ ...base, rateLimit: async uid => assert.equal(uid, "member-1") });
  assert.deepEqual(await allowed({ data: image }), result);
  assert.equal(calls, 1);
});
test("provider failures and incomplete output never become diary entries", async () => {
  for (const [generate, code] of [
    [async () => { throw { response: { status: 429 } }; }, "resource-exhausted"],
    [async () => { throw { code: "ECONNABORTED" }; }, "deadline-exceeded"],
    [async () => ({ candidates: [{ finishReason: "MAX_TOKENS" }] }), "internal"],
    [async () => response({ ...result, foods: [{ ...food, protein: -5 }] }), "internal"],
  ]) {
    const handler = createFoodPhotoHandler({ HttpsError, requireMember: async () => ({ uid: "u" }), rateLimit: async () => {}, generate });
    await assert.rejects(handler({ data: image }), { code });
  }
});
test("tries the next food model for temporary provider errors but not billing failures", () => {
  for (const status of [404, 500, 502, 503, 504]) assert.equal(shouldTryNextFoodModel({ response: { status } }), true);
  for (const code of ["ECONNABORTED", "ETIMEDOUT"]) assert.equal(shouldTryNextFoodModel({ code }), true);
  assert.equal(shouldTryNextFoodModel({ response: { status: 429 } }), false);
  assert.equal(shouldTryNextFoodModel({ response: { status: 400 } }), false);
});

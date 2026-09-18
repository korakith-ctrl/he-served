const test = require("node:test");
const assert = require("node:assert/strict");
const { createNativeAi } = require("./recompNativeAi");

test("native typed food uses server-held key and returns an unsaved estimate", async () => {
  let calls = 0;
  const ai = createNativeAi({
    apiKey: () => "server-only-key",
    foodModel: () => "gemini-3.5-flash",
    rateLimit: async (profileId, category) => {
      assert.equal(profileId, "tony");
      assert.equal(category, "foodPhoto");
    },
    axios: { post: async (url, body, options) => {
      calls += 1;
      assert.match(url, /generateContent$/);
      assert.equal(options.headers["x-goog-api-key"], "server-only-key");
      assert.match(body.contents[0].parts[0].text, /กะเพราไก่ไข่ดาว/);
      return { data: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
        isFood: true, confidence: "medium", assumptions: "จานมาตรฐาน",
        foods: [{ name: "กะเพราไก่ไข่ดาว", serving: "1 จาน", calories: 630,
          protein: 32, carbs: 68, fat: 24, fiber: 2, produceServings: 0.5 }],
      }) }] } }] } };
    } },
  });
  const draft = await ai.estimateFood({ description: "กะเพราไก่ไข่ดาว" }, "tony");
  assert.equal(calls, 1);
  assert.equal(draft.foods[0].calories, 630);
  assert.equal(draft.confidence, "medium");
});

test("native AI quota blocks provider call", async () => {
  const ai = createNativeAi({
    apiKey: () => "key", foodModel: () => "gemini-3.5-flash",
    rateLimit: async () => { throw Object.assign(new Error("quota"), { code: "resource-exhausted" }); },
    axios: { post: async () => { throw new Error("provider must not run"); } },
  });
  await assert.rejects(ai.estimateFood({ description: "กะเพราไก่ไข่ดาว" }, "tony"), error => error.status === 429);
});

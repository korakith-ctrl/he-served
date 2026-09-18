const {
  FOOD_PHOTO_SCHEMA, FOOD_PHOTO_PROMPT, normalizeFoodPhotoResult,
  normalizeFoodPhotoImage, normalizeFoodDescription, shouldTryNextFoodModel,
} = require("./recompFoodPhoto");
const { DAILY_LOG_SCHEMA, DAILY_LOG_PROMPT, normalizeDailyLogResult } = require("./recompDailyLog");

function failure(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createNativeAi({ axios, apiKey, foodModel, rateLimit }) {
  async function checkRateLimit(profileId, category) {
    try { await rateLimit(profileId, category); }
    catch (error) {
      if (error.code === "resource-exhausted") throw failure("ประเมินด้วย AI ได้ 12 ครั้งต่อชั่วโมง กรุณารอก่อนลองใหม่", 429);
      throw failure("ตรวจโควตา AI ไม่สำเร็จ", 503);
    }
  }
  async function generate({ models, prompt, parts, schema, maxOutputTokens = 2048 }) {
    let lastError;
    for (const model of [...new Set(models)]) {
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            systemInstruction: { parts: [{ text: prompt }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json", responseSchema: schema,
              maxOutputTokens, thinkingConfig: { thinkingLevel: "low" },
            },
          },
          { headers: { "x-goog-api-key": apiKey() }, timeout: model.includes("flash-lite") ? 15000 : 22000 },
        );
        const candidate = response.data?.candidates?.[0];
        if (candidate?.finishReason !== "STOP") throw failure("ai-incomplete", 502);
        const text = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text || "").join("");
        return JSON.parse(text);
      } catch (error) {
        lastError = error;
        if (!shouldTryNextFoodModel(error)) break;
      }
    }
    if (lastError?.response?.status === 429) throw failure("AI ใช้งานไม่ได้ชั่วคราวหรือโควตาหมด", 429);
    if (["ECONNABORTED", "ETIMEDOUT"].includes(lastError?.code)) throw failure("ประเมินนานเกินไป กรุณาลองใหม่", 504);
    throw failure("AI ประเมินไม่สำเร็จ กรุณาลองใหม่", 502);
  }

  async function estimateFood(body, profileId) {
    let input;
    try {
      input = body.description
        ? { description: normalizeFoodDescription(body.description) }
        : { image: normalizeFoodPhotoImage(body.imageBase64, body.mimeType) };
    } catch { throw failure("เลือกรูป JPG หรือพิมพ์อาหารให้ชัดเจน", 400); }
    await checkRateLimit(profileId, "foodPhoto");
    const parts = input.description
      ? [{ text: `ประเมินโภชนาการจากรายการที่ผู้ใช้พิมพ์: ${input.description}` }]
      : [{ text: "ประเมินอาหารในภาพนี้" }, { inlineData: input.image }];
    const raw = await generate({
      models: [foodModel(), "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
      prompt: FOOD_PHOTO_PROMPT, parts, schema: FOOD_PHOTO_SCHEMA,
    });
    try { return normalizeFoodPhotoResult(raw); }
    catch { throw failure("ผลประเมินไม่ครบ กรุณาลองใหม่", 502); }
  }

  async function parseDailyText(body, profileId) {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length < 10 || description.length > 2000) throw failure("พิมพ์บันทึก 10–2,000 ตัวอักษร", 400);
    await checkRateLimit(profileId, "dailyText");
    const raw = await generate({
      models: ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
      prompt: DAILY_LOG_PROMPT, parts: [{ text: description }], schema: DAILY_LOG_SCHEMA,
      maxOutputTokens: 4096,
    });
    try { return normalizeDailyLogResult(raw); }
    catch { throw failure("ผลแยกบันทึกไม่ครบ กรุณาลองใหม่", 502); }
  }

  return { estimateFood, parseDailyText };
}

module.exports = { createNativeAi };

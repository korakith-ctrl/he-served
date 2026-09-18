export const FOOD_NUTRIENTS = ["calories", "protein", "carbs", "fat", "fiber", "produceServings"];
const limits = { calories: 10000, protein: 1000, carbs: 2000, fat: 1000, fiber: 200, produceServings: 30 };

export function reviewedPhotoFoods(foods) {
  if (!Array.isArray(foods) || !foods.length || foods.length > 12) throw new Error("เลือกอาหารอย่างน้อย 1 รายการ");
  return foods.map(food => {
    const quantity = Number(food.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10) throw new Error("ปริมาณที่ทานต้องมากกว่า 0 และไม่เกิน 10 เท่า");
    if (!String(food.name || "").trim() || !String(food.serving || "").trim()) throw new Error("กรอกชื่ออาหารและปริมาณในรูปให้ครบ");
    const entry = { name: food.name.trim().slice(0, 120), serving: `${food.serving.trim().slice(0, 160)} × ${quantity}`, source: "photo-estimate", approximate: true };
    for (const key of FOOD_NUTRIENTS) {
      const value = Number(food[key]);
      if (food[key] === "" || food[key] == null || !Number.isFinite(value) || value < 0 || value * quantity > limits[key]) throw new Error("ตรวจสารอาหารอีกครั้ง: ต้องเป็นตัวเลขตั้งแต่ 0 และอยู่ในช่วงที่รองรับ");
      entry[key] = +(value * quantity).toFixed(key === "calories" ? 0 : 1);
    }
    return entry;
  });
}

export function addPhotoFoodsToMeal(meal, entries, createId = () => crypto.randomUUID()) {
  const next = { ...meal, items: [...(meal.items || []), ...entries.map(entry => ({ ...entry, entryId: createId() }))] };
  for (const key of FOOD_NUTRIENTS) {
    const total = (Number(meal[key]) || 0) + entries.reduce((sum, entry) => sum + entry[key], 0);
    if (!Number.isFinite(total) || total < 0 || total > limits[key]) throw new Error("ยอดรวมมื้อนี้เกินช่วงที่รองรับ กรุณาตรวจปริมาณอีกครั้ง");
    next[key] = +total.toFixed(key === "calories" ? 0 : 1);
  }
  return next;
}

export async function prepareFoodPhoto(file) {
  const heic = file && (/^image\/hei[cf](?:-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name || ""));
  if (!file || (!heic && !["image/jpeg", "image/png", "image/webp"].includes(file.type))) throw new Error("เลือกรูปอาหาร JPG, PNG, WebP หรือ HEIC");
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("เลือกรูปขนาดไม่เกิน 20 MB");
  let url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch {
      if (!heic) throw new Error("เปิดรูปนี้ไม่ได้ กรุณาเลือกรูป JPG, PNG หรือ WebP หรือถ่ายใหม่");
      try {
        // Load the decoder only when native HEIC support is unavailable.
        // Conversion stays on the device; only the resized JPEG goes to AI.
        const { heicTo } = await import("heic-to/csp");
        const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
        URL.revokeObjectURL(url);
        url = URL.createObjectURL(jpeg);
        image.src = url;
        await image.decode();
      } catch { throw new Error("แปลงรูป HEIC ไม่สำเร็จ กรุณาลองอีกครั้ง หรือเลือกรูป JPG"); }
    }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("อุปกรณ์นี้เตรียมรูปไม่ได้ กรุณาลองเบราว์เซอร์อื่น");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Re-encoding reduces upload size and removes the original EXIF/location metadata.
    const preview = canvas.toDataURL("image/jpeg", 0.85);
    const imageBase64 = preview.split(",")[1];
    if (!imageBase64 || imageBase64.length > 5 * 1024 * 1024 * 4 / 3) throw new Error("รูปมีขนาดใหญ่เกินไป กรุณาครอปแล้วลองใหม่");
    return { preview, imageBase64, mimeType: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

export function foodPhotoError(error) {
  const messages = {
    "functions/unauthenticated": "กรุณาเข้าสู่ระบบสมาชิกก่อนประเมินรูปอาหาร",
    "functions/permission-denied": "บัญชีนี้ยังไม่ได้เป็นสมาชิก Recomp challenge",
    "functions/unavailable": "เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่",
    "functions/not-found": "ระบบประเมินรูปอาหารยังไม่พร้อมใช้งาน กรุณาลองภายหลัง",
    "functions/deadline-exceeded": "ประเมินนานเกินไป กรุณาลองใหม่",
    "functions/internal": "ระบบ AI ประเมินอาหารยังไม่พร้อม ลองอีกครั้งในอีกสักครู่",
  };
  return messages[error?.code] || error?.message || "ประเมินไม่สำเร็จ กรุณาลองใหม่";
}

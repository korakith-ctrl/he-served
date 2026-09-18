import { FOOD_NUTRIENTS, addPhotoFoodsToMeal, reviewedPhotoFoods } from "./foodPhoto.js";

export const DAILY_MEALS = ["breakfast", "lunch", "dinner", "snacks"];

const bounded = (value, max, label) => {
  if (value === "" || value == null || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > max) throw new Error(`ตรวจ${label}อีกครั้ง`);
  return Number(value);
};

export function waterEntryValue(current, amount, mode = "total") {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0 || value > 20) throw new Error("ตรวจปริมาณน้ำอีกครั้ง");
  const total = mode === "add" ? Number(current || 0) + value : value;
  if (total > 20) throw new Error("ปริมาณน้ำรวมต้องไม่เกิน 20 ลิตร");
  return +total.toFixed(2);
}

export function applyDailyTextEstimate(form, draft, createId = () => crypto.randomUUID()) {
  if (!Array.isArray(draft?.foods) || draft.foods.length > 12) throw new Error("ผลประเมินอาหารไม่ถูกต้อง");
  const hasExercise = draft.exerciseMentioned && (String(draft.exerciseDescription || "").trim() || Number(draft.exerciseMinutes) > 0 || Number(draft.zone2Minutes) > 0 || draft.workoutDone);
  if (!draft.foods.length && !draft.waterMentioned && !hasExercise && !draft.stepsMentioned) throw new Error("ไม่พบรายการที่จะเพิ่ม กรุณาลองพิมพ์ให้ชัดขึ้น");
  const meals = { ...form.meals };
  for (const meal of DAILY_MEALS) {
    const selected = draft.foods.filter(food => food.meal === meal);
    if (!selected.length) continue;
    const entries = reviewedPhotoFoods(selected.map(food => ({ ...food, quantity: food.quantity ?? 1 }))).map(entry => ({ ...entry, source: "daily-text-estimate" }));
    meals[meal] = addPhotoFoodsToMeal(form.meals[meal] || { items: [] }, entries, createId);
  }
  if (draft.foods.some(food => !DAILY_MEALS.includes(food.meal))) throw new Error("เลือกมื้อให้รายการอาหารทุกอย่างก่อนเพิ่ม");
  const totals = Object.fromEntries(FOOD_NUTRIENTS.map(field => {
    const total = Object.values(meals).reduce((sum, meal) => sum + (Number(meal[field]) || 0), 0);
    return [field, total ? +total.toFixed(field === "calories" ? 0 : 1) : ""];
  }));
  const next = { ...form, meals, ...(draft.foods.length ? totals : {}) };
  if (draft.waterMentioned) next.water = bounded(draft.waterLiters, 20, "ปริมาณน้ำ");
  if (draft.stepsMentioned) next.steps = bounded(draft.steps, 200000, "จำนวนก้าว");
  if (draft.exerciseMentioned) {
    const minutes = bounded(draft.exerciseMinutes, 1440, "นาทีออกกำลังกาย");
    const zone2 = bounded(draft.zone2Minutes, 1440, "นาที Zone 2");
    if (minutes) next.exerciseMinutes = minutes;
    if (zone2) next.zone2Minutes = zone2;
    if (String(draft.exerciseDescription || "").trim()) next.exerciseDescription = String(draft.exerciseDescription).trim().slice(0, 240);
    if (draft.workoutDone) { next.workout = true; next.restDay = false; }
  }
  return next;
}

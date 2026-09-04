import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";

export const CHALLENGE_START = "2026-08-30";
export const CHALLENGE_DAYS = 112;
export const MIN_WEEKLY_WEIGH_INS = 4;

export const numeric = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) return fallback;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
};

export const mean = (items, key) => {
  const values = items.map(item => numeric(item?.[key], NaN)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

export const percent = (value, target) => Math.min(100, Math.max(0, numeric(value) / Math.max(1, numeric(target, 1)) * 100));

export function bangkokToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function bangkokGreeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", hourCycle: "h23" }).format(date));
  if (hour < 12) return "GOOD MORNING";
  if (hour < 17) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

export function challengeClock(dateString = bangkokToday()) {
  const elapsed = Math.max(0, differenceInCalendarDays(parseISO(dateString), parseISO(CHALLENGE_START)));
  const cappedElapsed = Math.min(CHALLENGE_DAYS, elapsed);
  const week = Math.min(16, Math.floor(cappedElapsed / 7) + 1);
  const phase = Math.min(4, Math.floor((week - 1) / 4) + 1);
  return { date: dateString, elapsedDays: elapsed, day: Math.min(CHALLENGE_DAYS, elapsed + 1), week, phase, daysRemaining: Math.max(0, CHALLENGE_DAYS - elapsed), complete: elapsed >= CHALLENGE_DAYS };
}

export function dateRangeEnding(anchorDate, days) {
  const end = parseISO(anchorDate);
  return Array.from({ length: days }, (_, index) => format(addDays(subDays(end, days - 1), index), "yyyy-MM-dd"));
}

export function calendarWindow(logs, anchorDate, days = 7, offsetDays = 0) {
  const byDate = new Map(logs.map(log => [log.date, log]));
  const shiftedAnchor = format(subDays(parseISO(anchorDate), offsetDays), "yyyy-MM-dd");
  return dateRangeEnding(shiftedAnchor, days).map(date => byDate.get(date) || { date, missing: true });
}

export function dailyScore(log, profile) {
  if (!log || log.missing) return 0;
  const hasHabitData = [log.calories, log.protein, log.steps, log.water, log.sleep].some(value => value !== null && value !== undefined && value !== "") || log.workout || log.restDay;
  if (!hasHabitData) return 0;
  const calories = numeric(log.calories, NaN);
  const caloriePoints = Number.isFinite(calories) && calories >= profile.calorieTarget * .9 && calories <= profile.calorieTarget * 1.1 ? 25 : 0;
  const proteinPoints = log.protein == null ? 0 : Math.min(25, percent(log.protein, profile.proteinMin) * .25);
  const stepPoints = log.steps == null ? 0 : Math.min(20, percent(log.steps, profile.stepsTarget) * .20);
  const movementPoints = log.workout ? 15 : log.restDay ? 5 : 0;
  const sleepPoints = log.sleep == null ? 0 : Math.min(15, percent(log.sleep, 480) * .15);
  return Math.round(caloriePoints + proteinPoints + stepPoints + movementPoints + sleepPoints);
}

export function consistencyFor(logs, profile, anchorDate, days = 7) {
  const scores = calendarWindow(logs, anchorDate, days).map(log => dailyScore(log, profile));
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / days);
}

export function rollingWeight(logs) {
  const weighted = logs.filter(log => Number.isFinite(numeric(log.weight, NaN))).sort((a, b) => a.date.localeCompare(b.date));
  return weighted.map(item => {
    const window = calendarWindow(weighted, item.date, 7).filter(log => Number.isFinite(numeric(log.weight, NaN)));
    const average = mean(window, "weight");
    return { ...item, label: format(parseISO(item.date), "d MMM"), avg7: window.length >= MIN_WEEKLY_WEIGH_INS ? +average.toFixed(2) : null, availableAvg: average == null ? null : +average.toFixed(2), avg7Samples: window.length };
  });
}

const measured = logs => logs.filter(log => Number.isFinite(numeric(log.weight, NaN)));

export function weightStats(logs, profile, anchorDate = bangkokToday()) {
  const weighted = measured(logs).sort((a, b) => a.date.localeCompare(b.date));
  const latest = weighted.at(-1) || { weight: profile.startWeight, date: CHALLENGE_START };
  const current7 = measured(calendarWindow(logs, anchorDate, 7));
  const previous7 = measured(calendarWindow(logs, anchorDate, 7, 7));
  const prior7 = measured(calendarWindow(logs, anchorDate, 7, 14));
  const avg7 = mean(current7, "weight") ?? numeric(latest.weight, profile.startWeight);
  const previousAvg = previous7.length >= MIN_WEEKLY_WEIGH_INS ? mean(previous7, "weight") : null;
  const priorAvg = prior7.length >= MIN_WEEKLY_WEIGH_INS ? mean(prior7, "weight") : null;
  const hasReliableAverage = current7.length >= MIN_WEEKLY_WEIGH_INS;
  const hasWeeklyComparison = hasReliableAverage && previous7.length >= MIN_WEEKLY_WEIGH_INS;
  const weeklyLoss = hasWeeklyComparison ? previousAvg - avg7 : null;
  const previousLoss = previousAvg == null || priorAvg == null ? null : priorAvg - previousAvg;
  const lost = profile.startWeight - numeric(latest.weight, profile.startWeight);
  const goalDistance = profile.startWeight - profile.goalMax;
  return { latest, avg7, previousAvg, priorAvg, weeklyLoss, previousLoss, lost, progress: Math.min(100, Math.max(0, lost / Math.max(.1, goalDistance) * 100)), consistency: consistencyFor(logs, profile, anchorDate), sampleCount: weighted.length, currentSamples: current7.length, previousSamples: previous7.length, hasFullAverage: hasReliableAverage, hasReliableAverage, hasWeeklyComparison };
}

export function adherenceSummary(logs, profile, anchorDate, workouts = [], healthWorkouts = []) {
  const week = calendarWindow(logs, anchorDate, 7);
  const active = week.filter(log => !log.missing && !log.sickDay && !log.vacationMode);
  const nutrition = active.filter(log => log.calories != null);
  const protein = active.filter(log => log.protein != null);
  const steps = active.filter(log => log.steps != null);
  const sleep = active.filter(log => log.sleep != null);
  const caloriesOnTarget = nutrition.filter(log => numeric(log.calories) >= profile.calorieTarget * .9 && numeric(log.calories) <= profile.calorieTarget * 1.1).length;
  const proteinOnTarget = protein.filter(log => numeric(log.protein) >= profile.proteinMin).length;
  const validDates = new Set(week.map(log => log.date));
  const workoutDates = new Set([
    ...week.filter(log => log.workout).map(log => log.date),
    ...workouts.filter(item => validDates.has(item.date)).map(item => item.date),
    ...healthWorkouts.filter(item => validDates.has(String(item.startAt || "").slice(0, 10))).map(item => String(item.startAt).slice(0, 10)),
  ]);
  const manualZone2 = week.reduce((sum, log) => sum + numeric(log.zone2Minutes), 0);
  const appleExercise = week.reduce((sum, log) => sum + numeric(log.exerciseMinutes), 0);
  return {
    days: week, trackedDays: active.length, excludedDays: week.filter(log => log.sickDay || log.vacationMode).length,
    nutritionDays: nutrition.length, caloriesOnTarget, calorieAdherence: nutrition.length ? caloriesOnTarget / nutrition.length : null, averageCalories: mean(nutrition, "calories"),
    proteinDays: protein.length, proteinOnTarget, proteinAdherence: protein.length ? proteinOnTarget / protein.length : null, averageProtein: mean(protein, "protein"),
    averageSteps: mean(steps, "steps"), averageSleep: mean(sleep, "sleep"), workoutSessions: workoutDates.size,
    exerciseMinutes: Math.max(manualZone2, appleExercise), zone2Minutes: manualZone2,
    fiberAverage: mean(active.filter(log => log.fiber != null), "fiber"), produceAverage: mean(active.filter(log => log.produceServings != null), "produceServings"),
  };
}

export function calorieDecision(logs, profile, anchorDate, workouts = [], healthWorkouts = []) {
  const stats = weightStats(logs, profile, anchorDate);
  const adherence = adherenceSummary(logs, profile, anchorDate, workouts, healthWorkouts);
  const priorAnchor = format(subDays(parseISO(anchorDate), 7), "yyyy-MM-dd");
  const prior = adherenceSummary(logs, profile, priorAnchor, workouts, healthWorkouts);
  const recoveryLogs = calendarWindow(logs, anchorDate, 7).filter(log => !log.missing);
  const hunger = mean(recoveryLogs.filter(log => log.hunger != null), "hunger");
  const energy = mean(recoveryLogs.filter(log => log.energy != null), "energy");
  const highAdherence = adherence.nutritionDays >= 5 && adherence.calorieAdherence >= .8;
  const priorHighAdherence = prior.nutritionDays >= 5 && prior.calorieAdherence >= .8;
  if (!stats.hasWeeklyComparison) return { action: "collect", delta: 0, tone: "blue", title: "เก็บ baseline ให้ครบ", text: `ชั่งอย่างน้อย ${MIN_WEEKLY_WEIGH_INS} วันต่อสัปดาห์ให้ครบ 2 สัปดาห์ ก่อนพิจารณาปรับ Calories` };
  if (stats.previousLoss != null && stats.weeklyLoss > 1 && stats.previousLoss > 1) return { action: "increase", delta: 150, tone: "amber", title: "ลดเร็วเกินไปต่อเนื่อง", text: "ตรวจ recovery และ performance แนะนำเพิ่ม 100–150 kcal หลังยืนยัน" };
  if (stats.weeklyLoss > .9 && ((hunger != null && hunger >= 4) || (energy != null && energy <= 2))) return { action: "increase", delta: 100, tone: "amber", title: "Recovery ต้องมาก่อน", text: "น้ำหนักลงเร็วร่วมกับหิวมากหรือพลังงานต่ำ แนะนำเพิ่ม 100 kcal หลังยืนยัน" };
  if (stats.weeklyLoss >= .4 && stats.weeklyLoss <= .9) return { action: "keep", delta: 0, tone: "green", title: "คงแผนเดิม", text: "อัตราลดอยู่ในช่วงเป้าหมาย รักษา Calories, Protein, Steps และ Workout เดิม" };
  if (stats.previousLoss != null && stats.weeklyLoss < .4 && stats.previousLoss < .4) {
    if (!highAdherence || !priorHighAdherence) return { action: "audit", delta: 0, tone: "blue", title: "ตรวจความครบของอาหารก่อน", text: "น้ำหนักยังช้า แต่ข้อมูล Calories หรือความสม่ำเสมอยังไม่ถึง 80% จึงยังไม่ควรลดอาหาร" };
    return { action: "decrease", delta: -100, tone: "amber", title: "พร้อมปรับเล็กน้อย", text: "ทำตามแผน ≥80% ต่อเนื่อง 2 สัปดาห์แล้ว เสนอให้ลด 100 kcal โดยต้องกดยืนยัน" };
  }
  return { action: "keep", delta: 0, tone: "blue", title: "รักษาแผนและดูอีกสัปดาห์", text: "แนวโน้มยังไม่ต่อเนื่องพอสำหรับการเปลี่ยน Calories" };
}

export function coachingFrom(stats) {
  if (!stats.hasReliableAverage) return { label: "Collecting data", tone: "blue", text: `สัปดาห์นี้มีน้ำหนัก ${stats.currentSamples} วัน เก็บให้ครบอย่างน้อย ${MIN_WEEKLY_WEIGH_INS} วันเพื่อเริ่มดูแนวโน้ม` };
  if (!stats.hasWeeklyComparison) return { label: "Building baseline", tone: "blue", text: "มีค่าเฉลี่ยสัปดาห์แรกแล้ว เก็บอีกหนึ่งสัปดาห์ก่อนประเมินความเร็ว" };
  const current = stats.weeklyLoss;
  const previous = stats.previousLoss;
  if (previous != null && current > 1 && previous > 1) return { label: "Losing too fast", tone: "amber", text: "น้ำหนักลดเร็วต่อเนื่อง ตรวจ recovery, food intake และ training performance" };
  if (previous != null && current < .4 && previous < .4) return { label: "Needs review", tone: "blue", text: "ตรวจ Calories, Steps และ Weekend ก่อนพิจารณาปรับแผน" };
  if (current >= .4 && current <= .9) return { label: "On track", tone: "green", text: "กำลังดี ไม่ต้องปรับ Calories รักษาความสม่ำเสมอต่อไป" };
  if (current > .9) return { label: "Ahead", tone: "amber", text: "สัปดาห์นี้ลดค่อนข้างเร็ว ดู recovery และ performance ต่ออีกหนึ่งสัปดาห์" };
  return { label: "Building trend", tone: "blue", text: "ข้อมูลสัปดาห์นี้ยังไม่ชัด รักษาแผนเดิมโดยไม่รีบลด Calories" };
}

export function filterLogs(logs, range, anchorDate = logs.at(-1)?.date || bangkokToday()) {
  const count = { "7 days": 7, "30 days": 30, "8 weeks": 56, "16 weeks": 112 }[range] || 30;
  const allowed = new Set(dateRangeEnding(anchorDate, count));
  return [...logs].filter(log => allowed.has(log.date)).sort((a, b) => a.date.localeCompare(b.date));
}

export function weeklyReview(logs, profile, anchorDate = bangkokToday(), workouts = [], healthWorkouts = []) {
  const summary = adherenceSummary(logs, profile, anchorDate, workouts, healthWorkouts);
  const weights = measured(summary.days);
  if (!summary.trackedDays && !weights.length) return null;
  return { ...summary, averageWeight: mean(weights, "weight"), weightSamples: weights.length, decision: calorieDecision(logs, profile, anchorDate, workouts, healthWorkouts) };
}

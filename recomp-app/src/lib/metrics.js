import { addDays, differenceInCalendarDays, format, parseISO, subDays } from "date-fns";

export const CHALLENGE_START = "2026-08-30";
export const CHALLENGE_DAYS = 112;

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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function challengeClock(dateString = bangkokToday()) {
  const elapsed = Math.max(0, differenceInCalendarDays(parseISO(dateString), parseISO(CHALLENGE_START)));
  const cappedElapsed = Math.min(CHALLENGE_DAYS, elapsed);
  const week = Math.min(16, Math.floor(cappedElapsed / 7) + 1);
  const phase = Math.min(4, Math.floor((week - 1) / 4) + 1);
  return {
    date: dateString,
    elapsedDays: elapsed,
    day: Math.min(CHALLENGE_DAYS, elapsed + 1),
    week,
    phase,
    daysRemaining: Math.max(0, CHALLENGE_DAYS - elapsed),
    complete: elapsed >= CHALLENGE_DAYS,
  };
}

export function dailyScore(log, profile) {
  if (!log) return 0;
  const hasHabitData = [log.calories, log.protein, log.steps, log.water, log.sleep].some(value => value !== null && value !== undefined && value !== "") || log.workout || log.restDay;
  if (!hasHabitData) return 0;
  const calories = numeric(log.calories, NaN);
  const caloriePoints = Number.isFinite(calories) && calories >= profile.calorieTarget * .9 && calories <= profile.calorieTarget * 1.1 ? 20 : 0;
  const proteinPoints = log.protein == null ? 0 : Math.min(25, percent(log.protein, profile.proteinMin) * .25);
  const stepPoints = log.steps == null ? 0 : Math.min(15, percent(log.steps, profile.stepsTarget) * .15);
  const workoutPoints = log.workout || log.restDay ? 20 : 0;
  const waterPoints = log.water == null ? 0 : Math.min(5, percent(log.water, profile.waterTarget) * .05);
  const sleepPoints = log.sleep == null ? 0 : Math.min(15, percent(log.sleep, 480) * .15);
  return Math.round(caloriePoints + proteinPoints + stepPoints + workoutPoints + waterPoints + sleepPoints);
}

export function dateRangeEnding(anchorDate, days) {
  const end = parseISO(anchorDate);
  return Array.from({ length: days }, (_, index) => format(addDays(subDays(end, days - 1), index), "yyyy-MM-dd"));
}

export function consistencyFor(logs, profile, anchorDate, days = 7) {
  const byDate = new Map(logs.map(log => [log.date, log]));
  const scores = dateRangeEnding(anchorDate, days).map(date => dailyScore(byDate.get(date), profile));
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / days);
}

export function rollingWeight(logs) {
  const weighted = logs.filter(log => numeric(log.weight, NaN)).sort((a, b) => a.date.localeCompare(b.date));
  return weighted.map((item, index) => {
    const window = weighted.slice(Math.max(0, index - 6), index + 1);
    return {
      ...item,
      label: format(parseISO(item.date), "d MMM"),
      avg7: window.length === 7 ? +mean(window, "weight").toFixed(2) : null,
      availableAvg: +mean(window, "weight").toFixed(2),
    };
  });
}

export function weightStats(logs, profile, anchorDate = bangkokToday()) {
  const weighted = logs.filter(log => Number.isFinite(numeric(log.weight, NaN))).sort((a, b) => a.date.localeCompare(b.date));
  const latest = weighted.at(-1) || { weight: profile.startWeight, date: CHALLENGE_START };
  const current7 = weighted.slice(-7);
  const previous7 = weighted.slice(-14, -7);
  const prior7 = weighted.slice(-21, -14);
  const avg7 = mean(current7, "weight") ?? profile.startWeight;
  const previousAvg = previous7.length === 7 ? mean(previous7, "weight") : null;
  const priorAvg = prior7.length === 7 ? mean(prior7, "weight") : null;
  const weeklyLoss = previousAvg == null ? null : previousAvg - avg7;
  const previousLoss = previousAvg == null || priorAvg == null ? null : priorAvg - previousAvg;
  const lost = profile.startWeight - numeric(latest.weight, profile.startWeight);
  const goalDistance = profile.startWeight - profile.goalMax;
  return {
    latest,
    avg7,
    previousAvg,
    priorAvg,
    weeklyLoss,
    previousLoss,
    lost,
    progress: Math.min(100, Math.max(0, lost / Math.max(.1, goalDistance) * 100)),
    consistency: consistencyFor(logs, profile, anchorDate),
    sampleCount: weighted.length,
    hasFullAverage: current7.length === 7,
    hasWeeklyComparison: current7.length === 7 && previous7.length === 7,
  };
}

export function coachingFrom(stats) {
  if (!stats.hasFullAverage) return { label: "Collecting data", tone: "blue", text: "เก็บน้ำหนักให้ครบอย่างน้อย 7 วัน เพื่อเริ่มดูค่าเฉลี่ยที่ลดความผันผวนรายวัน" };
  if (!stats.hasWeeklyComparison) return { label: "Building baseline", tone: "blue", text: "มีค่าเฉลี่ย 7 วันชุดแรกแล้ว เก็บต่ออีกหนึ่งสัปดาห์ก่อนประเมินความเร็ว" };
  const current = stats.weeklyLoss;
  const previous = stats.previousLoss;
  if (previous != null && current > 1 && previous > 1) return { label: "Losing too fast", tone: "amber", text: "น้ำหนักลดเร็วกว่าช่วงเป้าหมายต่อเนื่อง ลองตรวจ recovery, food intake และ training performance" };
  if (previous != null && current < .4 && previous < .4) return { label: "Slightly behind", tone: "blue", text: "ตรวจ Calories, Steps และ Weekend ก่อนพิจารณาปรับ Calories 100–150 kcal โดยต้องยืนยันก่อนเสมอ" };
  if (current >= .5 && current <= .9) return { label: "On track", tone: "green", text: "กำลังดี ไม่ต้องปรับ Calories รักษาความสม่ำเสมอแบบนี้ต่อไป" };
  if (current > .9) return { label: "Ahead", tone: "amber", text: "สัปดาห์นี้ลดค่อนข้างเร็ว ดู recovery และ performance ต่ออีกหนึ่งสัปดาห์" };
  return { label: "Building trend", tone: "blue", text: "ข้อมูลสัปดาห์นี้ยังไม่ชัด รักษาแผนเดิมและดูแนวโน้มต่อโดยไม่รีบปรับ Calories" };
}

export function filterLogs(logs, range) {
  const count = { "7 days": 7, "30 days": 30, "8 weeks": 56, "16 weeks": 112 }[range] || 30;
  return [...logs].sort((a, b) => a.date.localeCompare(b.date)).slice(-count);
}

export function weeklyReview(logs, profile) {
  const recent = [...logs].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  if (recent.length < 7) return null;
  const proteinDays = recent.filter(log => numeric(log.protein) >= profile.proteinMin).length;
  const workouts = recent.filter(log => log.workout).length;
  return {
    averageWeight: mean(recent, "weight"),
    averageCalories: mean(recent.filter(log => log.calories != null), "calories"),
    averageSteps: mean(recent.filter(log => log.steps != null), "steps"),
    averageSleep: mean(recent.filter(log => log.sleep != null), "sleep"),
    proteinDays,
    workouts,
  };
}

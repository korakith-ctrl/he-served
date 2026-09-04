import test from "node:test";
import assert from "node:assert/strict";
import { bangkokGreeting, calorieDecision, dailyScore, rollingWeight, weightStats, weeklyReview } from "./metrics.js";

const profile = { startWeight: 90, goalMax: 80, calorieTarget: 2000, proteinMin: 130, stepsTarget: 9000 };

function makeDay(date, weight, extras = {}) {
  return { date, weight, calories: 2000, protein: 140, steps: 9500, sleep: 480, ...extras };
}

test("weekly averages use calendar windows rather than the last seven entries", () => {
  const logs = [
    makeDay("2026-08-18", 92), makeDay("2026-08-19", 92), makeDay("2026-08-20", 92),
    makeDay("2026-08-21", 92), makeDay("2026-08-22", 92), makeDay("2026-08-23", 92),
    makeDay("2026-08-24", 90), makeDay("2026-08-25", 90), makeDay("2026-08-26", 90), makeDay("2026-08-27", 90),
    makeDay("2026-08-28", 89), makeDay("2026-08-29", 89), makeDay("2026-08-30", 89), makeDay("2026-08-31", 89),
  ];
  const stats = weightStats(logs, profile, "2026-08-31");
  assert.ok(Math.abs(stats.avg7 - 89.4286) < .001);
  assert.ok(Math.abs(stats.previousAvg - 91.7143) < .001);
  assert.ok(Math.abs(stats.weeklyLoss - 2.2857) < .001);
});

test("rolling average never pulls an old measurement across a calendar gap", () => {
  const trend = rollingWeight([makeDay("2026-08-01", 91), makeDay("2026-08-20", 90), makeDay("2026-08-27", 89), makeDay("2026-08-28", 89), makeDay("2026-08-29", 89)]);
  assert.equal(trend.at(-1).avg7, null);
  assert.equal(trend.at(-1).avg7Samples, 3);
});

test("rest day does not receive the same movement score as a workout", () => {
  const base = makeDay("2026-08-31", 90);
  assert.ok(dailyScore({ ...base, workout: true }, profile) > dailyScore({ ...base, restDay: true }, profile));
});

test("calories are reduced only after two slow high-adherence weeks", () => {
  const logs = [];
  for (let day = 1; day <= 21; day += 1) {
    const date = `2026-08-${String(day + 10).padStart(2, "0")}`;
    const weight = day <= 7 ? 90 : day <= 14 ? 89.8 : 89.6;
    logs.push(makeDay(date, weight));
  }
  const decision = calorieDecision(logs, profile, "2026-08-31");
  assert.equal(decision.action, "decrease");
  assert.equal(decision.delta, -100);
});

test("sick and vacation days are excluded from adherence", () => {
  const logs = [
    makeDay("2026-08-25", 90), makeDay("2026-08-26", 90), makeDay("2026-08-27", 90),
    makeDay("2026-08-28", 90, { calories: 5000, sickDay: true }),
    makeDay("2026-08-29", 90, { calories: 5000, vacationMode: true }),
  ];
  const review = weeklyReview(logs, profile, "2026-08-31");
  assert.equal(review.excludedDays, 2);
  assert.equal(review.nutritionDays, 3);
  assert.equal(review.caloriesOnTarget, 3);
});

test("greeting follows Asia/Bangkok time", () => {
  assert.equal(bangkokGreeting(new Date("2026-08-31T01:00:00Z")), "GOOD MORNING");
  assert.equal(bangkokGreeting(new Date("2026-08-31T07:00:00Z")), "GOOD AFTERNOON");
  assert.equal(bangkokGreeting(new Date("2026-08-31T12:00:00Z")), "GOOD EVENING");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hashPairingToken,
  mergeAppleHealthLog,
  normalizeAppleHealthPayload,
  safeTokenMatch,
} = require("./recompHealth");

test("normalizes a valid Apple Health payload", () => {
  const payload = normalizeAppleHealthPayload({
    profileId: "tony",
    capturedAt: "2026-08-30T12:00:00Z",
    timezone: "Asia/Bangkok",
    days: [{
      date: "2026-08-30",
      steps: 9012,
      sleepMinutes: 465,
      weightKg: 95.2,
      activeEnergyKcal: 640,
      workouts: [{
        id: "ABCDEF12-3456",
        activityType: "traditionalStrengthTraining",
        startAt: "2026-08-30T01:00:00Z",
        endAt: "2026-08-30T02:00:00Z",
        durationMinutes: 60,
      }],
    }],
  });
  assert.equal(payload.days[0].steps, 9012);
  assert.equal(payload.days[0].workouts.length, 1);
});

test("rejects out-of-range health values", () => {
  const payload = normalizeAppleHealthPayload({
    profileId: "zackdark",
    capturedAt: "2026-08-30T12:00:00Z",
    days: [{ date: "2026-08-30", steps: 999999, weightKg: 2, workouts: [] }],
  });
  assert.equal(payload.days[0].steps, undefined);
  assert.equal(payload.days[0].weightKg, undefined);
});

test("does not overwrite manually entered values", () => {
  const merged = mergeAppleHealthLog(
    { date: "2026-08-30", profileId: "tony", weight: 95.5, steps: 5000 },
    { date: "2026-08-30", weightKg: 95.2, steps: 9000, sleepMinutes: 450, workouts: [] },
    "2026-08-30T12:00:00Z",
    "tony",
  );
  assert.equal(merged.weight, 95.5);
  assert.equal(merged.steps, 5000);
  assert.equal(merged.sleep, 450);
  assert.equal(merged.sources.sleep, "appleHealth");
});

test("refreshes values previously sourced from Apple Health", () => {
  const merged = mergeAppleHealthLog(
    { date: "2026-08-30", profileId: "tony", steps: 8000, sources: { steps: "appleHealth" } },
    { date: "2026-08-30", steps: 9000, workouts: [] },
    "2026-08-30T12:00:00Z",
    "tony",
  );
  assert.equal(merged.steps, 9000);
});

test("ignores an older Apple Health capture", () => {
  const merged = mergeAppleHealthLog(
    { date: "2026-08-30", profileId: "tony", steps: 9000, sources: { steps: "appleHealth" }, sourceUpdatedAt: { appleHealth: "2026-08-30T13:00:00Z" } },
    { date: "2026-08-30", steps: 8000, workouts: [] },
    "2026-08-30T14:00:00Z",
    "tony",
    "2026-08-30T12:00:00Z",
  );
  assert.equal(merged.steps, 9000);
});

test("pairing token comparison uses its hash", () => {
  const token = "a".repeat(43);
  const hash = hashPairingToken(token);
  assert.equal(safeTokenMatch(token, hash), true);
  assert.equal(safeTokenMatch("b".repeat(43), hash), false);
});

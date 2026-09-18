import test from "node:test";
import assert from "node:assert/strict";
import { formatSleepDuration, sleepDurationParts } from "./format.js";

test("sleep duration rounds fractional HealthKit minutes and carries into the next hour", () => {
  assert.equal(formatSleepDuration(437.34999999999997), "7 ชม. 17 นาที");
  assert.equal(formatSleepDuration(479.7), "8 ชม. 0 นาที");
  assert.deepEqual(sleepDurationParts(479.7), { hours: 8, minutes: 0 });
  assert.equal(formatSleepDuration(null), "—");
});

export function sleepDurationParts(value) {
  if (value == null || value === "") return null;
  const total = Number(value);
  if (!Number.isFinite(total) || total < 0) return null;
  const rounded = Math.round(total);
  return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
}

export function formatSleepDuration(value) {
  const parts = sleepDurationParts(value);
  return parts ? `${parts.hours} ชม. ${parts.minutes} นาที` : "—";
}

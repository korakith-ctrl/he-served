function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function menuCalories(menu) {
  return finiteNumber(menu?.kcal ?? menu?.calories);
}

export function choiceCaloriesDelta(choice) {
  return finiteNumber(choice?.kcalDelta ?? choice?.caloriesDelta ?? choice?.kcalChange);
}

export function caloriesForMenu(menu, options = []) {
  const base = menuCalories(menu);
  const hasDelta = options.some((option) => choiceCaloriesDelta(option) != null);
  if (base == null && !hasDelta) return null;
  const total = (base ?? 0) + options.reduce((sum, option) => sum + (choiceCaloriesDelta(option) ?? 0), 0);
  return Math.max(0, Math.round(total * 10) / 10);
}

export function formatCalories(value) {
  const number = finiteNumber(value);
  if (number == null) return "";
  return `${number % 1 === 0 ? number : number.toFixed(1)} kcal`;
}

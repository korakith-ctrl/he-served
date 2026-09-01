export const WHEEL_SEGMENTS = [
  { id: "free-drink", shortLabel: "ฟรี 1 แก้ว", icon: "☕" },
  { id: "discount-15", shortLabel: "ลด 15.-", icon: "🎟️" },
  { id: "half-price", shortLabel: "ลด 50%", icon: "½" },
  { id: "discount-20", shortLabel: "ลด 20.-", icon: "✨" },
  { id: "discount-30", shortLabel: "ลด 30.-", icon: "🎁" },
  { id: "discount-15", shortLabel: "ลด 15.-", icon: "🎟️" },
  { id: "discount-25", shortLabel: "ลด 25.-", icon: "⭐" },
  { id: "discount-20", shortLabel: "ลด 20.-", icon: "✨" },
];

export function wheelPrizeLabel(prize, freeDrinkCap = 60) {
  if (!prize) return "";
  if (prize.label) return prize.label;
  if (prize.id === "free-drink") return `ฟรี 1 แก้ว มูลค่าไม่เกิน ${Number(freeDrinkCap) || 60} บาท`;
  if (prize.id === "half-price") return "ลด 50% สำหรับเครื่องดื่ม 1 แก้ว";
  const fixedValue = Number(String(prize.id).match(/discount-(\d+)/)?.[1]) || Number(prize.value) || 0;
  return `ลด ${fixedValue} บาท สำหรับเครื่องดื่ม 1 แก้ว`;
}

export function wheelPrizeDiscount(prize, unitPrice, freeDrinkCap = 60) {
  const price = Math.max(0, Number(unitPrice) || 0);
  if (!prize || price <= 0) return 0;
  if (prize.id === "free-drink") return Math.min(price, Number(prize.value) || Number(freeDrinkCap) || 60);
  if (prize.id === "half-price") return Math.round(price * 50) / 100;
  const fixedValue = Number(String(prize.id).match(/discount-(\d+)/)?.[1]) || Number(prize.value) || 0;
  return Math.min(price, fixedValue);
}

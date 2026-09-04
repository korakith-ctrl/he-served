function inferredProductType(item) {
  if (item?.productType === "pass") return "pass";
  if (item?.productType === "food") return "food";
  if (item?.productType === "drink") return "drink";
  return /ขนมปัง|เบเกอรี่|อาหาร|toast|bread|bakery/i.test(item?.category || "") ? "food" : "drink";
}

// Keep old menu/order data compatible: drinks earned beans before this setting
// existed, while food and passes did not.
export function menuEarnsLoyaltyBeans(item) {
  if (typeof item?.earnsLoyaltyBeans === "boolean") return item.earnsLoyaltyBeans;
  return inferredProductType(item) === "drink";
}

export function loyaltyUnitsInOrder(order, menus = []) {
  const menusById = new Map((menus || []).map((menu) => [menu.id, menu]));
  return (order?.items || []).reduce((sum, item) => {
    // The current catalog is authoritative when the menu still exists. The
    // item snapshot keeps deleted menus and historical orders understandable.
    const eligibilitySource = menusById.get(item.menuId) || item;
    return sum + (menuEarnsLoyaltyBeans(eligibilitySource) ? Math.max(0, Number(item.qty) || 0) : 0);
  }, 0);
}

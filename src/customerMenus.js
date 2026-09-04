export function visibleCustomerMenus(allMenus, eventId = null, eventMenuIds = []) {
  if (!allMenus) return allMenus;

  const allowedEventMenus = eventId ? new Set(eventMenuIds) : null;
  return allMenus.filter((menu) => (
    menu?.available !== false
    && (!allowedEventMenus || allowedEventMenus.has(menu.id))
  ));
}

export function removeUnavailableCartLines(cart, visibleMenus) {
  const visibleMenuIds = new Set((visibleMenus || []).map((menu) => menu.id));
  const filtered = (cart || []).filter((line) => (
    (line.menuId === "coffee_pass" && line.promoKind === "coffee-pass-purchase")
    || visibleMenuIds.has(line.menuId)
  ));

  return filtered.length === (cart || []).length ? cart : filtered;
}

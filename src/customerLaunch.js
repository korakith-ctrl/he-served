const CUSTOMER_LAUNCH_STORAGE_KEY = "coffee-shop-customer-launch";
const ROUTE_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function customerPath(shopUid, eventId) {
  const eventQuery = eventId ? `?event=${encodeURIComponent(eventId)}` : "";
  return `/order/${encodeURIComponent(shopUid)}${eventQuery}`;
}

function validRoute(route) {
  return Boolean(
    route
    && ROUTE_VALUE_PATTERN.test(String(route.shopUid || ""))
    && (!route.eventId || ROUTE_VALUE_PATTERN.test(String(route.eventId))),
  );
}

function directCustomerRoute(locationLike) {
  const match = String(locationLike?.pathname || "").match(/^\/order\/([^/]+)\/?$/);
  if (!match) return null;

  let shopUid;
  try {
    shopUid = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  const eventId = new URLSearchParams(String(locationLike?.search || "")).get("event") || null;
  const route = { shopUid, eventId };
  return validRoute(route) ? { ...route, path: customerPath(shopUid, eventId) } : null;
}

function savedCustomerRoute(storage) {
  try {
    const route = JSON.parse(storage?.getItem(CUSTOMER_LAUNCH_STORAGE_KEY) || "null");
    if (!validRoute(route)) return null;
    const eventId = route.eventId || null;
    return { shopUid: route.shopUid, eventId, path: customerPath(route.shopUid, eventId) };
  } catch {
    return null;
  }
}

function saveCustomerRoute(storage, route) {
  try {
    storage?.setItem(CUSTOMER_LAUNCH_STORAGE_KEY, JSON.stringify({
      shopUid: route.shopUid,
      eventId: route.eventId || null,
    }));
  } catch {
    // Browsers can disable localStorage. The current customer URL still works normally.
  }
}

function isStandalone(windowLike) {
  return Boolean(
    windowLike?.matchMedia?.("(display-mode: standalone)")?.matches
    || windowLike?.navigator?.standalone === true,
  );
}

export function resolveCustomerLaunch(windowLike = globalThis.window) {
  const currentRoute = directCustomerRoute(windowLike?.location);
  if (currentRoute) {
    saveCustomerRoute(windowLike?.localStorage, currentRoute);
    return { isCustomerEntry: true, route: currentRoute, restored: false };
  }

  const pathname = String(windowLike?.location?.pathname || "");
  const isCustomerPath = /^\/order(?:\/|$)/.test(pathname);
  const isLegacyInstalledStart = pathname === "/" && isStandalone(windowLike);
  if (!isCustomerPath && !isLegacyInstalledStart) {
    return { isCustomerEntry: false, route: null, restored: false };
  }

  return {
    isCustomerEntry: true,
    route: savedCustomerRoute(windowLike?.localStorage),
    restored: true,
  };
}

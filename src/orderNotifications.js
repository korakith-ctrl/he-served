export const ORDER_NOTIFICATION_PREFERENCE_KEY = "coffee-shop-order-notifications";

export function newPendingOrders(previousOrders = [], nextOrders = []) {
  const knownIds = new Set(previousOrders.map((order) => order?.id).filter(Boolean));
  return nextOrders.filter((order) => order?.id && order.status === "pending" && !knownIds.has(order.id));
}

export function orderNotificationCopy(order = {}) {
  const code = String(order.id || "").slice(-6).toUpperCase() || "ใหม่";
  const itemCount = (order.items || []).reduce((total, item) => total + (Number(item?.qty) || 0), 0);
  const customer = String(order.customerName || "ลูกค้า").trim() || "ลูกค้า";
  const total = Number(order.total) || 0;
  return {
    title: `ออเดอร์ใหม่ #${code}`,
    body: `${customer} · ${itemCount || 1} รายการ · ฿${total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  };
}

export function canUseOrderNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function orderNotificationsAreEnabled() {
  return canUseOrderNotifications()
    && window.Notification.permission === "granted"
    && window.localStorage.getItem(ORDER_NOTIFICATION_PREFERENCE_KEY) === "enabled";
}

export function setOrderNotificationsEnabled(enabled) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORDER_NOTIFICATION_PREFERENCE_KEY, enabled ? "enabled" : "disabled");
}

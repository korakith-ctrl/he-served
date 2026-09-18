/* Handles data-only FCM messages for the owner PWA without third-party scripts. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function account() {
  const cache = await caches.open("he-served-order-push-state");
  const response = await cache.match("/__order_push_account");
  return response ? response.json() : null;
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "ORDER_PUSH_ACCOUNT") return;
  event.waitUntil((async () => {
    const cache = await caches.open("he-served-order-push-state");
    await cache.put("/__order_push_account", new Response(JSON.stringify({ uid: event.data.uid || null })));
    if (!event.data.uid) for (const notification of await self.registration.getNotifications()) notification.close();
    event.ports[0]?.postMessage({ ok: true });
  })());
});

self.addEventListener("push", (event) => event.waitUntil((async () => {
  let payload;
  try { payload = event.data?.json()?.data; } catch { return; }
  if (!payload || payload.type !== "ORDER_PUSH" || (await account())?.uid !== payload.uid) return;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (windows.some((client) => client.visibilityState === "visible")) return;
  await self.registration.showNotification(payload.title || "ออเดอร์ใหม่", {
    body: payload.body || "มีออเดอร์ใหม่เข้าร้าน", icon: "/admin-icon-192.png", tag: payload.tag || "he-served-order",
    data: { uid: payload.uid, orderId: payload.orderId || "" },
  });
})()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    if ((await account())?.uid !== event.notification.data?.uid) return;
    const url = new URL("/admin#orders", self.location.origin);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => new URL(item.url).origin === url.origin);
    if (client) { await client.navigate(url.href); await client.focus(); }
    else await self.clients.openWindow(url.href);
  })());
});

/* FCM data messages are handled here without remote scripts or a second display path. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const state = async () => {
  const cache = await caches.open('clear-kan-push-state');
  const response = await cache.match('/__push_account');
  return response ? response.json() : null;
};
self.addEventListener('message', event => {
  if (event.data?.type !== 'PUSH_ACCOUNT') return;
  event.waitUntil((async () => {
    const cache = await caches.open('clear-kan-push-state');
    await cache.put('/__push_account', new Response(JSON.stringify({ uid:event.data.uid || null })));
    if (!event.data.uid) for (const notification of await self.registration.getNotifications()) notification.close();
    event.ports[0]?.postMessage({ok:true});
  })());
});
self.addEventListener('push', event => event.waitUntil((async () => {
  let payload;
  try { payload = event.data?.json()?.data; } catch { return; }
  if (!payload || (await state())?.uid !== payload.uid) return;
  const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const visible = windows.filter(client => client.visibilityState === 'visible');
  if (visible.length) {
    for (const client of visible) client.postMessage({type:'DEBT_PUSH',notificationId:payload.notificationId,uid:payload.uid,body:payload.body});
    return;
  }
  await self.registration.showNotification(payload.title || 'เคลียร์กัน', {
    body:payload.body || 'มีอัปเดตในรายการของคุณ', icon:'/icon-192.png', tag:payload.tag,
    data:{ notificationId:payload.notificationId, uid:payload.uid },
  });
})()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    if ((await state())?.uid !== event.notification.data?.uid) return;
    const url = new URL('/', self.location.origin);
    url.searchParams.set('notification',event.notification.data?.notificationId || 'inbox');
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client = windows.find(item => new URL(item.url).origin === url.origin);
    if (client) { await client.navigate(url.href); await client.focus(); }
    else await self.clients.openWindow(url.href);
  })());
});

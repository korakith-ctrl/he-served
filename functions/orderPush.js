const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueCreated } = require("firebase-functions/v2/database");

const validInstallationId = (value) => typeof value === "string" && /^[\w-]{1,160}$/.test(value);

function notificationCopy(orderId, order) {
  const code = String(orderId || "").slice(-6).toUpperCase() || "ใหม่";
  const itemCount = (order.items || []).reduce((total, item) => total + (Number(item?.qty) || 0), 0);
  const customer = String(order.customerName || "ลูกค้า").trim() || "ลูกค้า";
  const total = Number(order.total) || 0;
  return {
    title: `ออเดอร์ใหม่ #${code}`,
    body: `${customer} · ${itemCount || 1} รายการ · ฿${total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  };
}

module.exports = ({ admin, db, region }) => {
  const callable = (name, handler) => onCall({ region, maxInstances: 10 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
    return handler(request.auth.uid, request.data || {});
  });

  async function sendToDevices(uid, payload) {
    const members = (await db.ref(`orderPushDeviceMembers/${uid}`).get()).val() || {};
    await Promise.all(Object.keys(members).map(async (installationId) => {
      const deviceRef = db.ref(`orderPushInstallations/${installationId}`);
      const device = (await deviceRef.get()).val();
      if (device?.uid !== uid || !device.token) return;
      try {
        await admin.messaging().send({
          token: device.token,
          data: payload,
          webpush: { headers: { TTL: "86400", Urgency: "high" } },
        });
      } catch (error) {
        if (!["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(error.code)) throw error;
        const removed = await deviceRef.transaction((current) => current?.uid === uid && current?.token === device.token ? null : undefined);
        if (removed.committed) await db.ref(`orderPushDeviceMembers/${uid}/${installationId}`).remove();
      }
    }));
  }

  return {
    registerOrderPushDevice: callable("registerOrderPushDevice", async (uid, data) => {
      if (!validInstallationId(data.installationId) || typeof data.token !== "string" || data.token.length < 40 || data.token.length > 4096) {
        throw new HttpsError("invalid-argument", "ข้อมูลอุปกรณ์ไม่ถูกต้อง");
      }
      const deviceRef = db.ref(`orderPushInstallations/${data.installationId}`);
      const result = await deviceRef.transaction((current) => {
        if (current && current.uid !== uid) return;
        return { uid, token: data.token, label: String(data.label || "Web").slice(0, 80), updatedAt: Date.now() };
      });
      if (!result.committed) throw new HttpsError("failed-precondition", "อุปกรณ์นี้เปิดแจ้งเตือนให้บัญชีอื่นอยู่");
      await db.ref(`orderPushDeviceMembers/${uid}/${data.installationId}`).set(true);
      return { enabled: true };
    }),
    disableOrderPushDevice: callable("disableOrderPushDevice", async (uid, data) => {
      if (!validInstallationId(data.installationId)) throw new HttpsError("invalid-argument", "ข้อมูลอุปกรณ์ไม่ถูกต้อง");
      await db.ref(`orderPushInstallations/${data.installationId}`).transaction((current) => current?.uid === uid ? null : undefined);
      await db.ref(`orderPushDeviceMembers/${uid}/${data.installationId}`).remove();
      return { enabled: false };
    }),
    sendOrderPushTest: callable("sendOrderPushTest", async (uid, data) => {
      if (!validInstallationId(data.installationId)) throw new HttpsError("invalid-argument", "ข้อมูลอุปกรณ์ไม่ถูกต้อง");
      const device = (await db.ref(`orderPushInstallations/${data.installationId}`).get()).val();
      if (device?.uid !== uid) throw new HttpsError("failed-precondition", "กรุณาเปิดการแจ้งเตือนก่อน");
      await admin.messaging().send({
        token: device.token,
        data: { type: "ORDER_PUSH", uid, title: "เปิดแจ้งเตือนออเดอร์แล้ว", body: "อุปกรณ์นี้พร้อมรับออเดอร์ใหม่", tag: "he-served-order-test", orderId: "" },
        webpush: { headers: { TTL: "300", Urgency: "high" } },
      });
      return { sent: true };
    }),
    queueOrderPush: onValueCreated({ region, ref: "/orders/{uid}/{orderId}", retry: true, maxInstances: 10 }, async (event) => {
      const order = event.data.val();
      const { uid, orderId } = event.params;
      if (!order || order.status !== "pending") return;
      // Database event delivery is at-least-once. Claiming the order first keeps a retry
      // from creating a second alert after a transient function failure.
      const deliveryRef = db.ref(`orderPushDeliveries/${uid}/${orderId}`);
      const now = Date.now();
      const claim = await deliveryRef.transaction((current) => {
        if (current?.sentAt || Number(current?.leaseUntil) > now) return;
        return { leaseUntil: now + 2 * 60 * 1000, createdAt: now };
      });
      if (!claim.committed) {
        if (claim.snapshot.val()?.sentAt) return;
        throw new Error("Order push delivery is already in progress");
      }
      const copy = notificationCopy(orderId, order);
      try {
        await sendToDevices(uid, {
          type: "ORDER_PUSH", uid, orderId, title: copy.title, body: copy.body, tag: `he-served-order-${orderId}`,
        });
        await deliveryRef.set({ sentAt: Date.now(), createdAt: now });
      } catch (error) {
        await deliveryRef.remove();
        throw error;
      }
    }),
  };
};

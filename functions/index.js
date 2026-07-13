const axios = require("axios");
const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

admin.initializeApp();
const db = admin.database();

const SLIPOK_API_KEY = defineSecret("SLIPOK_API_KEY");
const SLIPOK_BRANCH_ID = defineString("SLIPOK_BRANCH_ID");

const REGION = "asia-southeast1";

function normalizeThaiPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^66\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^0\d{9}$/.test(digits)) return digits;
  return "";
}

function validOrderDraft(order) {
  return order &&
    typeof order.customerName === "string" && order.customerName.trim().length > 0 && order.customerName.length <= 120 &&
    typeof order.customerPhone === "string" &&
    typeof order.paymentMethod === "string" && ["promptpay", "cash", "thaihelpthai"].includes(order.paymentMethod) &&
    typeof order.pickupDate === "string" &&
    (!order.note || typeof order.note === "string") &&
    Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 100 &&
    order.items.every((item) =>
      item && typeof item.lineId === "string" && typeof item.name === "string" && item.name.length > 0 &&
      Number.isFinite(Number(item.unitPrice)) && Number(item.unitPrice) >= 0 &&
      Number.isInteger(Number(item.qty)) && Number(item.qty) > 0 && Number(item.qty) <= 100
    );
}

// Reward checkout is server-owned: a verified phone token is required, beans are
// deducted once per attempt ID, and retries resume the same deterministic order.
exports.checkoutWithReward = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณายืนยันเบอร์โทรศัพท์ก่อนใช้รางวัล");

  const { shopUid, redemptionAttemptId, selectedLineId, order: draft } = request.data || {};
  if (!shopUid || !/^[A-Za-z0-9_-]{1,128}$/.test(shopUid)) {
    throw new HttpsError("invalid-argument", "ข้อมูลร้านไม่ถูกต้อง");
  }
  if (!redemptionAttemptId || !/^[A-Za-z0-9_-]{16,80}$/.test(redemptionAttemptId)) {
    throw new HttpsError("invalid-argument", "รหัสยืนยันการแลกไม่ถูกต้อง");
  }
  if (!selectedLineId || !validOrderDraft(draft)) {
    throw new HttpsError("invalid-argument", "ข้อมูลออเดอร์ไม่ครบหรือไม่ถูกต้อง");
  }

  const verifiedPhone = normalizeThaiPhone(request.auth.token.phone_number);
  const orderPhone = normalizeThaiPhone(draft.customerPhone);
  if (!verifiedPhone || verifiedPhone !== orderPhone) {
    throw new HttpsError("permission-denied", "เบอร์ที่ยืนยันไม่ตรงกับเบอร์สมาชิกในออเดอร์");
  }

  const selectedLine = draft.items.find((item) => item.lineId === selectedLineId);
  if (!selectedLine) throw new HttpsError("invalid-argument", "ไม่พบเครื่องดื่มที่เลือกแลกรางวัล");

  const settingsSnap = await db.ref(`shops/${shopUid}/settings`).once("value");
  const settings = settingsSnap.val() || {};
  if (settings.acceptingOrders === false) throw new HttpsError("failed-precondition", "ขณะนี้ร้านปิดรับออเดอร์");
  const beanGoal = Math.max(1, Math.floor(Number(settings.loyaltyBeanGoal) || 10));
  const proposedOrderId = db.ref(`orders/${shopUid}`).push().key;
  const customerRef = db.ref(`customers/${shopUid}/${orderPhone}`);
  const now = Date.now();

  const transaction = await customerRef.transaction((current) => {
    if (!current) return undefined;
    const attempts = current.redemptionAttempts || {};
    const existing = attempts[redemptionAttemptId];
    if (existing) return current;
    if ((Number(current.beans) || 0) < beanGoal) return undefined;

    const recentAttempts = Object.fromEntries(
      Object.entries(attempts)
        .sort(([, a], [, b]) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .slice(0, 19)
    );
    return {
      ...current,
      beans: (Number(current.beans) || 0) - beanGoal,
      redeemedCount: (Number(current.redeemedCount) || 0) + 1,
      updatedAt: new Date(now).toISOString(),
      redemptionAttempts: {
        ...recentAttempts,
        [redemptionAttemptId]: { orderId: proposedOrderId, createdAt: now },
      },
    };
  });

  if (!transaction.committed) {
    throw new HttpsError("failed-precondition", "เมล็ดสะสมไม่พอสำหรับแลกรางวัลแล้ว");
  }

  const attempt = transaction.snapshot.child(`redemptionAttempts/${redemptionAttemptId}`).val();
  if (!attempt || !attempt.orderId) {
    throw new HttpsError("internal", "ไม่สามารถยืนยันรายการแลกได้ กรุณาลองใหม่");
  }

  const orderRef = db.ref(`orders/${shopUid}/${attempt.orderId}`);
  const items = draft.items.map(({ lineId, ...item }) => ({
    ...item,
    ...(lineId === selectedLineId ? { freeUnit: true } : {}),
  }));
  const subtotal = draft.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.qty), 0);
  const total = Math.max(0, Math.round((subtotal - Number(selectedLine.unitPrice)) * 100) / 100);
  const orderData = {
    customerUid: request.auth.uid,
    customerName: draft.customerName.trim(),
    customerPhone: draft.customerPhone.trim(),
    note: String(draft.note || "").trim().slice(0, 1000),
    paymentMethod: draft.paymentMethod,
    pickupDate: draft.pickupDate,
    items,
    total,
    redeemedBeans: true,
    beansUsed: beanGoal,
    redemptionAttemptId,
    status: "pending",
    createdAt: new Date(now).toISOString(),
  };

  try {
    const orderTransaction = await orderRef.transaction((current) => current || orderData);
    if (!orderTransaction.committed || !orderTransaction.snapshot.exists()) {
      throw new Error("order transaction was not committed");
    }
    const savedOrder = orderTransaction.snapshot.val();
    return { orderId: attempt.orderId, order: savedOrder };
  } catch (error) {
    logger.error("reward order creation failed after bean reservation", {
      shopUid, orderId: attempt.orderId, redemptionAttemptId, error: error.message,
    });
    throw new HttpsError("unavailable", "สร้างออเดอร์ไม่สำเร็จชั่วคราว กรุณากดยืนยันอีกครั้ง");
  }
});

exports.verifySlip = onCall({ region: REGION, secrets: [SLIPOK_API_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบก่อน");

  const { shopUid, orderId, imageBase64 } = request.data || {};
  if (!shopUid || !orderId || !imageBase64) {
    throw new HttpsError("invalid-argument", "ข้อมูลไม่ครบ");
  }

  const orderRef = db.ref(`orders/${shopUid}/${orderId}`);
  const orderSnap = await orderRef.once("value");
  const order = orderSnap.val();
  if (!order) throw new HttpsError("not-found", "ไม่พบออเดอร์นี้");
  if (order.customerUid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "ไม่มีสิทธิ์ยืนยันออเดอร์นี้");
  }
  if (order.paymentVerified) return { alreadyVerified: true };
  if (order.status !== "pending") {
    throw new HttpsError("failed-precondition", "ออเดอร์นี้ไม่ได้อยู่ในสถานะรอชำระ");
  }

  const testModeSnap = await db.ref(`shops/${shopUid}/settings/slipTestMode`).once("value");
  const testMode = testModeSnap.val() === true;

  let slip;
  let verifiedBy = "slipok-auto";
  if (testMode) {
    slip = { amount: order.total, transRef: `TEST-${Date.now()}` };
    verifiedBy = "slipok-test-mode";
  } else {
    const rawBase64 = imageBase64.includes(",") ? imageBase64.split(",").pop() : imageBase64;
    try {
      const resp = await axios.post(
        `https://api.slipok.com/api/line/apikey/${SLIPOK_BRANCH_ID.value()}`,
        { files: rawBase64, amount: order.total, log: true },
        { headers: { "x-authorization": SLIPOK_API_KEY.value(), "Content-Type": "application/json" } }
      );
      slip = resp.data && resp.data.data;
    } catch (err) {
      const errData = err.response && err.response.data;
      logger.error("slipok verify failed", errData || err.message);
      const code = errData && errData.code;
      if (code === 1012) throw new HttpsError("already-exists", "สลิปนี้เคยถูกใช้ยืนยันไปแล้ว");
      if (code === 1013) throw new HttpsError("failed-precondition", "ยอดเงินในสลิปไม่ตรงกับยอดออเดอร์");
      if (code === 1014) throw new HttpsError("failed-precondition", "สลิปนี้โอนเข้าบัญชีอื่น ไม่ใช่บัญชีร้าน");
      if (code === 1005 || code === 1006 || code === 1007) {
        throw new HttpsError("invalid-argument", "อ่านสลิปไม่ได้ กรุณาถ่ายรูปให้ชัดเจนแล้วลองใหม่");
      }
      throw new HttpsError("internal", "ตรวจสอบสลิปไม่สำเร็จ กรุณาลองใหม่ หรือรอร้านตรวจสอบด้วยตนเอง");
    }
  }

  await orderRef.update({
    status: "paid",
    paymentVerified: true,
    paymentVerifiedAt: Date.now(),
    paymentVerifiedBy: verifiedBy,
    slipRef: slip.transRef || null,
  });

  return { verified: true, amount: slip.amount, transRef: slip.transRef, testMode };
});

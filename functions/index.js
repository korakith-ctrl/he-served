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

  const rawBase64 = imageBase64.includes(",") ? imageBase64.split(",").pop() : imageBase64;

  let slip;
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

  await orderRef.update({
    paymentVerified: true,
    paymentVerifiedAt: Date.now(),
    paymentVerifiedBy: "slipok-auto",
    slipRef: slip.transRef || null,
  });

  return { verified: true, amount: slip.amount, transRef: slip.transRef };
});

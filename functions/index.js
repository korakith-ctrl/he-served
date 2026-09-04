const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const {
  hashPairingToken,
  mergeAppleHealthLog,
  normalizeAppleHealthPayload,
  safeTokenMatch,
} = require("./recompHealth");

admin.initializeApp();
const db = admin.database();

const SLIPOK_API_KEY = defineSecret("SLIPOK_API_KEY");
const SLIPOK_BRANCH_ID = defineString("SLIPOK_BRANCH_ID");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_RECEIPT_MODEL = defineString("GEMINI_RECEIPT_MODEL", { default: "gemini-3.5-flash" });

const REGION = "asia-southeast1";

const RECEIPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    vendorName: { type: "STRING" },
    purchaseDate: { type: "STRING", description: "YYYY-MM-DD, empty when unreadable" },
    receiptNumber: { type: "STRING" },
    grandTotal: { type: "NUMBER" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          rawName: { type: "STRING" },
          ingredientId: { type: "STRING", description: "Exact catalog id, or empty when no confident match" },
          stockQty: { type: "NUMBER", description: "Quantity converted to the catalog base unit" },
          lineTotal: { type: "NUMBER" },
          confidence: { type: "NUMBER", description: "0 to 1" },
          note: { type: "STRING" },
        },
        required: ["rawName", "ingredientId", "stockQty", "lineTotal", "confidence", "note"],
      },
    },
  },
  required: ["vendorName", "purchaseDate", "receiptNumber", "grandTotal", "items"],
};

function normalizeThaiPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^66\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^0\d{9}$/.test(digits)) return digits;
  return "";
}

function isFoodProduct(item) {
  if (item && item.productType === "food") return true;
  if (item && item.productType === "drink") return false;
  return /ขนมปัง|เบเกอรี่|อาหาร|toast|bread|bakery/i.test((item && item.category) || "");
}

function menuEarnsLoyaltyBeans(item) {
  if (typeof (item && item.earnsLoyaltyBeans) === "boolean") return item.earnsLoyaltyBeans;
  return !isFoodProduct(item) && item?.productType !== "pass";
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
      (!item.productType || ["drink", "food"].includes(item.productType)) &&
      Number.isFinite(Number(item.unitPrice)) && Number(item.unitPrice) >= 0 &&
      Number.isInteger(Number(item.qty)) && Number(item.qty) > 0 && Number(item.qty) <= 100
    );
}

function validShopUid(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

// Eight equally-likely slots. Repeated prizes make the odds visible on the wheel
// instead of hiding weights behind an apparently even set of slices.
const LOYALTY_WHEEL_SEGMENTS = [
  { id:"free-drink", value:60 },
  { id:"discount-15", value:15 },
  { id:"half-price", value:50 },
  { id:"discount-20", value:20 },
  { id:"discount-30", value:30 },
  { id:"discount-15", value:15 },
  { id:"discount-25", value:25 },
  { id:"discount-20", value:20 },
];

function loyaltyWheelPrizeLabel(prize, freeDrinkCap = 60) {
  if (prize.id === "free-drink") return `ฟรี 1 แก้ว มูลค่าไม่เกิน ${freeDrinkCap} บาท`;
  if (prize.id === "half-price") return "ลด 50% สำหรับเครื่องดื่ม 1 แก้ว";
  return `ลด ${Number(prize.value) || 0} บาท สำหรับเครื่องดื่ม 1 แก้ว`;
}

function loyaltyWheelDiscount(prize, unitPrice) {
  const price = Math.max(0, Number(unitPrice) || 0);
  if (!prize || price <= 0) return 0;
  if (prize.prizeId === "free-drink" || prize.id === "free-drink") return Math.min(price, Number(prize.value) || 60);
  if (prize.prizeId === "half-price" || prize.id === "half-price") return Math.round(price * 50) / 100;
  return Math.min(price, Math.max(0, Number(prize.value) || 0));
}

function hashPasscode(passcode, salt) {
  return crypto.scryptSync(String(passcode), salt, 32).toString("hex");
}

function normalizedCoffeePassConfig(raw) {
  const configuredPrice = Number(raw && raw.price);
  return {
    name: String(raw && raw.name || "Coffee Pass").trim().slice(0, 120),
    enabled: raw && raw.enabled === true,
    uses: Math.min(100, Math.max(1, Math.floor(Number(raw && (raw.uses ?? raw.days)) || 5))),
    price: Math.max(0, Math.round((Number.isFinite(configuredPrice) ? configuredPrice : 250) * 100) / 100),
    validityDays: Math.min(365, Math.max(1, Math.floor(Number(raw && raw.validityDays) || 30))),
    menuIds: (Array.isArray(raw && raw.menuIds) ? raw.menuIds : Object.values(raw && raw.menuIds || {})).filter(Boolean).slice(0, 500),
  };
}

// Return only the loyalty fields needed by the customer UI. Customer records are no longer
// directly readable from Realtime Database by arbitrary anonymous sessions.
exports.getCustomerSummary = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
  const { shopUid, customerPhone } = request.data || {};
  if (!validShopUid(shopUid)) throw new HttpsError("invalid-argument", "ข้อมูลร้านไม่ถูกต้อง");
  const phone = normalizeThaiPhone(customerPhone);
  if (!phone) throw new HttpsError("invalid-argument", "เบอร์โทรศัพท์ไม่ถูกต้อง");
  const snap = await db.ref(`customers/${shopUid}/${phone}`).once("value");
  if (!snap.exists()) return { beans:0, lifetimeBeans:0, redeemedCount:0, passes:{} };
  const customer = snap.val() || {};
  const passes = {};
  for (const [id, rawPass] of Object.entries(customer.passes || {})) {
    const pass = rawPass || {};
    passes[id] = {
      id, packageName:String(pass.packageName || pass.name || "Coffee Pass").slice(0,120),
      totalUses:Math.max(1,Number(pass.totalUses)||1), remainingUses:Math.max(0,Number(pass.remainingUses)||0),
      purchasedAt:Number(pass.purchasedAt)||0, expiresAt:Number(pass.expiresAt)||0,
      status:String(pass.status || "active"), menuIds:Array.isArray(pass.menuIds) ? pass.menuIds.filter(Boolean).slice(0,500) : [],
    };
  }
  return {
    beans:Math.max(0,Number(customer.beans)||0), lifetimeBeans:Math.max(0,Number(customer.lifetimeBeans)||0),
    redeemedCount:Math.max(0,Number(customer.redeemedCount)||0), passes,
    ...(customer.activeWheelSpin?.attemptId ? { activeWheelSpin: {
      attemptId:String(customer.activeWheelSpin.attemptId),
      prizeId:String(customer.activeWheelSpin.prizeId || ""),
      label:String(customer.activeWheelSpin.label || "").slice(0,120),
      value:Math.max(0,Number(customer.activeWheelSpin.value)||0),
      segmentIndex:Math.max(0,Math.min(7,Number(customer.activeWheelSpin.segmentIndex)||0)),
      beanGoal:Math.max(1,Number(customer.activeWheelSpin.beanGoal)||10),
    } } : {}),
  };
});

// Owner-only loyalty correction. Keeping this server-side makes the adjustment
// atomic, idempotent and independent from browser RTDB cache/rule state.
exports.adjustLoyaltyBeans = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
  const { shopUid, customerPhone, customerName, delta, reason, adjustmentId } = request.data || {};
  if (!validShopUid(shopUid) || request.auth.uid !== shopUid) {
    throw new HttpsError("permission-denied", "เฉพาะเจ้าของร้านเท่านั้นที่ปรับเมล็ดได้");
  }
  const phone = normalizeThaiPhone(customerPhone);
  const amount = Number(delta);
  const cleanReason = String(reason || "").trim().slice(0, 500);
  if (!phone) throw new HttpsError("invalid-argument", "เบอร์โทรศัพท์ลูกค้าไม่ถูกต้อง");
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10000) {
    throw new HttpsError("invalid-argument", "จำนวนเมล็ดต้องเป็นจำนวนเต็ม 1–10,000");
  }
  if (!cleanReason) throw new HttpsError("invalid-argument", "กรุณาระบุเหตุผลในการปรับเมล็ด");
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(String(adjustmentId || ""))) {
    throw new HttpsError("invalid-argument", "รหัสรายการปรับเมล็ดไม่ถูกต้อง");
  }

  const customerRef = db.ref(`customers/${shopUid}/${phone}`);
  const initialSnapshot = await customerRef.once("value");
  const now = new Date().toISOString();
  const initialCustomer = initialSnapshot.val() || {
    phone,
    name: String(customerName || "").trim().slice(0, 120),
    beans: 0,
    lifetimeBeans: 0,
    redeemedCount: 0,
    createdAt: now,
  };
  const transaction = await customerRef.transaction((current) => {
    const customer = current || initialCustomer;
    const adjustments = customer.manualBeanAdjustments || {};
    if (adjustments[adjustmentId]) return customer;
    const previousBeans = Math.max(0, Number(customer.beans) || 0);
    const nextBeans = Math.max(0, previousBeans + amount);
    const appliedDelta = nextBeans - previousBeans;
    const recentAdjustments = Object.fromEntries(
      Object.entries(adjustments)
        .sort(([, a], [, b]) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")))
        .slice(0, 49)
    );
    return {
      ...customer,
      phone,
      name: customer.name || String(customerName || "").trim().slice(0, 120),
      beans: nextBeans,
      updatedAt: now,
      manualBeanAdjustments: {
        ...recentAdjustments,
        [adjustmentId]: { requestedDelta: amount, appliedDelta, reason: cleanReason, actorUid: request.auth.uid, createdAt: now },
      },
    };
  });
  if (!transaction.committed || !transaction.snapshot.exists()) {
    throw new HttpsError("aborted", "ปรับเมล็ดไม่สำเร็จ กรุณาลองใหม่");
  }
  const adjustment = transaction.snapshot.child(`manualBeanAdjustments/${adjustmentId}`).val();
  if (!adjustment) throw new HttpsError("internal", "ไม่พบผลการปรับเมล็ด");
  await db.ref(`auditLogs/${shopUid}/loyalty_${adjustmentId}`).set({
    action: "loyalty_adjustment",
    actorUid: request.auth.uid,
    createdAt: adjustment.createdAt || now,
    details: { phone, requestedDelta: amount, appliedDelta: Number(adjustment.appliedDelta) || 0, reason: cleanReason },
  });
  return { beans: Math.max(0, Number(transaction.snapshot.child("beans").val()) || 0), appliedDelta: Number(adjustment.appliedDelta) || 0 };
});

function coffeePassAllowsMenu(purchasedPass, currentPackage, menuId) {
  const purchasedMenuIds = Array.isArray(purchasedPass && purchasedPass.menuIds)
    ? purchasedPass.menuIds
    : Object.values(purchasedPass && purchasedPass.menuIds || {});
  if (purchasedMenuIds.length === 0 || purchasedMenuIds.includes(menuId)) return true;
  if (!currentPackage) return false;
  const currentMenuIds = Array.isArray(currentPackage.menuIds)
    ? currentPackage.menuIds
    : Object.values(currentPackage.menuIds || {});
  // Package additions also apply to already-purchased passes. Keeping the
  // original snapshot in the union prevents a later removal from taking away
  // an entitlement the customer already paid for.
  return currentMenuIds.length === 0 || currentMenuIds.includes(menuId);
}

async function activateCoffeePassForOrder(shopUid, orderId, order, activatedBy) {
  if (!order || !order.coffeePassPurchase || order.coffeePassServerCreated !== true) throw new HttpsError("failed-precondition", "ออเดอร์ Pass นี้ไม่ได้สร้างโดยระบบ");
  if (order.status === "cancelled") throw new HttpsError("failed-precondition", "ออเดอร์ Pass นี้ถูกยกเลิกแล้ว");
  const phone = normalizeThaiPhone(order.customerPhone);
  if (!phone) throw new HttpsError("failed-precondition", "เบอร์โทรศัพท์ในออเดอร์ไม่ถูกต้อง");
  const purchase = normalizedCoffeePassConfig(order.coffeePassPurchase);
  const activatedAt = Date.now();
  const accountingMonth = new Date(activatedAt).toISOString().slice(0, 7);
  const closingSnap = await db.ref(`accounting/${shopUid}/periodClosings/${accountingMonth}`).once("value");
  if (closingSnap.exists()) throw new HttpsError("failed-precondition", "งวดบัญชีเดือนนี้ถูกปิดแล้ว กรุณาให้ร้านปลดล็อกก่อนเปิดใช้งาน Pass");
  const expiresAt = activatedAt + purchase.validityDays * 24 * 60 * 60 * 1000;
  const passRef = db.ref(`customers/${shopUid}/${phone}/passes/${orderId}`);
  const transaction = await passRef.transaction((current) => current || {
    id: orderId,
    orderId,
    packageName: purchase.name,
    totalUses: purchase.uses,
    remainingUses: purchase.uses,
    price: purchase.price,
    validityDays: purchase.validityDays,
    menuIds: purchase.menuIds,
    status: "active",
    purchasedAt: order.createdAt || new Date(activatedAt).toISOString(),
    activatedAt,
    expiresAt,
    activatedBy,
  });
  await db.ref(`customers/${shopUid}/${phone}`).update({
    phone,
    ...(order.customerName ? { name: String(order.customerName).slice(0, 120) } : {}),
    updatedAt: new Date(activatedAt).toISOString(),
  });
  const paymentAccount = order.paymentMethod === "promptpay" ? "bank" : (["cash", "thaihelpthai"].includes(order.paymentMethod) ? "cash" : "unassigned");
  const accountingRef = db.ref(`accounting/${shopUid}/transactions/pass_${orderId}`);
  await accountingRef.transaction((current) => current || {
    type: "income",
    category: "sales",
    description: `ขาย ${purchase.name}`,
    amount: purchase.price,
    transactionDate: new Date(activatedAt).toISOString().slice(0, 10),
    paymentAccount,
    vendorName: order.customerName || "",
    note: `Pass ${purchase.uses} สิทธิ์ อายุ ${purchase.validityDays} วัน`,
    sourceType: "coffee_pass",
    sourceId: orderId,
    orderId,
    createdAt: new Date(activatedAt).toISOString(),
    updatedAt: new Date(activatedAt).toISOString(),
  });
  return transaction.snapshot.val();
}

// Create the package purchase on the server so customers cannot alter its price,
// number of uses, validity or eligible menu snapshot in the browser.
exports.createCoffeePassOrder = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อนซื้อ Pass");
  const { shopUid, customerName, customerPhone, paymentMethod, passcode, note } = request.data || {};
  if (!validShopUid(shopUid)) throw new HttpsError("invalid-argument", "ข้อมูลร้านไม่ถูกต้อง");
  if (!String(customerName || "").trim() || String(customerName).length > 120) throw new HttpsError("invalid-argument", "กรุณาระบุชื่อ");
  const phone = normalizeThaiPhone(customerPhone);
  if (!phone) throw new HttpsError("invalid-argument", "เบอร์โทรศัพท์ไม่ถูกต้อง");
  if (!["promptpay", "cash", "thaihelpthai"].includes(paymentMethod)) throw new HttpsError("invalid-argument", "วิธีชำระเงินไม่ถูกต้อง");
  if (!/^\d{6}$/.test(String(passcode || ""))) throw new HttpsError("invalid-argument", "กรุณาตั้ง Passcode เป็นตัวเลข 6 หลัก");

  const settingsSnap = await db.ref(`shops/${shopUid}/settings`).once("value");
  const settings = settingsSnap.val() || {};
  if (settings.acceptingOrders === false) throw new HttpsError("failed-precondition", "ขณะนี้ร้านปิดรับออเดอร์");
  const pass = normalizedCoffeePassConfig(settings.coffeePass);
  if (!pass.enabled) throw new HttpsError("failed-precondition", "Pass นี้ปิดขายแล้ว");

  const orderRef = db.ref(`orders/${shopUid}`).push();
  const now = new Date().toISOString();
  const order = {
    customerUid: request.auth.uid,
    customerName: String(customerName).trim(),
    customerPhone: phone,
    note: String(note || "").trim().slice(0, 1000),
    paymentMethod,
    pickupDate: now.slice(0, 10),
    items: [{ menuId: "coffee_pass", name: pass.name, productType: "pass", earnsLoyaltyBeans: false, unitPrice: pass.price, qty: 1, options: [] }],
    total: pass.price,
    coffeePassPurchase: pass,
    coffeePassServerCreated: true,
    status: "pending",
    createdAt: now,
  };
  const salt = crypto.randomBytes(16).toString("hex");
  const secret = {
    passcodeHash: hashPasscode(passcode, salt),
    salt,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: Date.now(),
  };
  await db.ref().update({
    [`orders/${shopUid}/${orderRef.key}`]: order,
    [`coffeePassSecrets/${shopUid}/${orderRef.key}`]: secret,
  });
  return { orderId: orderRef.key, order };
});

exports.activateCoffeePassPurchase = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
  const { shopUid, orderId } = request.data || {};
  if (!validShopUid(shopUid) || request.auth.uid !== shopUid || !orderId) throw new HttpsError("permission-denied", "ไม่มีสิทธิ์เปิดใช้งาน Pass นี้");
  const orderRef = db.ref(`orders/${shopUid}/${orderId}`);
  const snap = await orderRef.once("value");
  const order = snap.val();
  if (!order) throw new HttpsError("not-found", "ไม่พบออเดอร์นี้");
  const pass = await activateCoffeePassForOrder(shopUid, orderId, order, request.auth.uid);
  await orderRef.update({ status: "done", saleRecorded: true, coffeePassActivated: true, completedAt: new Date().toISOString() });
  return { pass };
});

exports.resetCoffeePassPasscode = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
  const { shopUid, customerPhone, passId, newPasscode } = request.data || {};
  if (!validShopUid(shopUid) || request.auth.uid !== shopUid) throw new HttpsError("permission-denied", "เฉพาะเจ้าของร้านเท่านั้นที่รีเซ็ต Passcode ได้");
  const phone = normalizeThaiPhone(customerPhone);
  if (!phone || !passId || !/^\d{6}$/.test(String(newPasscode || ""))) throw new HttpsError("invalid-argument", "ข้อมูล Pass หรือ Passcode 6 หลักไม่ถูกต้อง");
  const passSnap = await db.ref(`customers/${shopUid}/${phone}/passes/${passId}`).once("value");
  if (!passSnap.exists()) throw new HttpsError("not-found", "ไม่พบ Pass นี้ในบัญชีลูกค้า");

  const salt = crypto.randomBytes(16).toString("hex");
  await db.ref(`coffeePassSecrets/${shopUid}/${passId}`).set({
    passcodeHash: hashPasscode(newPasscode, salt),
    salt,
    failedAttempts: 0,
    lockedUntil: 0,
    resetAt: Date.now(),
    resetBy: request.auth.uid,
  });
  return { reset: true };
});

exports.cancelCoffeePass = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
  const { shopUid, customerPhone, passId, reason } = request.data || {};
  if (!validShopUid(shopUid) || request.auth.uid !== shopUid) {
    throw new HttpsError("permission-denied", "เฉพาะเจ้าของร้านเท่านั้นที่ยกเลิก Pass ได้");
  }
  const phone = normalizeThaiPhone(customerPhone);
  const cleanReason = String(reason || "").trim().slice(0, 500);
  if (!phone || !/^[A-Za-z0-9_-]{1,160}$/.test(String(passId || ""))) {
    throw new HttpsError("invalid-argument", "ข้อมูล Coffee Pass ไม่ถูกต้อง");
  }
  if (!cleanReason) throw new HttpsError("invalid-argument", "กรุณาระบุเหตุผลในการยกเลิก Pass");

  const passRef = db.ref(`customers/${shopUid}/${phone}/passes/${passId}`);
  const passSnapshot = await passRef.once("value");
  if (!passSnapshot.exists()) throw new HttpsError("not-found", "ไม่พบ Coffee Pass นี้");
  const initialPass = passSnapshot.val();
  const cancelledAt = new Date().toISOString();
  const transaction = await passRef.transaction((current) => {
    const pass = current || initialPass;
    if (pass.status === "cancelled") return pass;
    const remainingUses = Math.max(0, Number(pass.remainingUses) || 0);
    return {
      ...pass,
      status: "cancelled",
      cancelledRemainingUses: remainingUses,
      remainingUses: 0,
      cancelledAt,
      cancelledBy: request.auth.uid,
      cancellationReason: cleanReason,
      updatedAt: Date.now(),
    };
  });
  if (!transaction.committed || !transaction.snapshot.exists()) {
    throw new HttpsError("aborted", "ยกเลิก Coffee Pass ไม่สำเร็จ กรุณาลองใหม่");
  }
  const cancelledPass = transaction.snapshot.val();
  await db.ref(`auditLogs/${shopUid}/cancel_pass_${passId}`).set({
    action: "coffee_pass_cancelled",
    actorUid: request.auth.uid,
    createdAt: cancelledPass.cancelledAt || cancelledAt,
    details: { phone, passId, packageName: String(cancelledPass.packageName || "Coffee Pass").slice(0, 120), remainingUses: Number(cancelledPass.cancelledRemainingUses) || 0, reason: cleanReason },
  });
  return { cancelled: true, pass: { id:passId, status:"cancelled", remainingUses:0 } };
});

async function verifyCoffeePasscodeAttempt(shopUid, passId, redemptionAttemptId, passcode) {
  const secretRef = db.ref(`coffeePassSecrets/${shopUid}/${passId}`);
  // Warm the complete node before starting the transaction. On a cold Cloud
  // Functions instance, reading only the salt child can leave the transaction's
  // local view of the parent empty and incorrectly abort an existing Pass.
  const secretSnapshot = await secretRef.once("value");
  if (!secretSnapshot.exists()) throw new HttpsError("failed-precondition", "Pass นี้ยังไม่ได้เปิดใช้งานหรือไม่พบ Passcode");
  const initialSecret = secretSnapshot.val();
  const salt = initialSecret.salt || "missing";
  const passcodeAttempt = hashPasscode(passcode, salt);
  const verification = await secretRef.transaction((current) => {
    // RTDB may invoke a transaction once with an empty local cache before it
    // retries with the server value. Use the confirmed snapshot for that first
    // pass instead of aborting a valid transaction.
    const secret = current || initialSecret;
    const currentTime = Date.now();
    const verifiedAttempts = secret.verifiedAttempts || {};
    const failedAttemptIds = secret.failedAttemptIds || {};
    if (verifiedAttempts[redemptionAttemptId]) return secret;
    if (failedAttemptIds[redemptionAttemptId]) return secret;
    if ((Number(secret.lockedUntil) || 0) > currentTime) return secret;
    if (secret.passcodeHash !== passcodeAttempt) {
      const failedAttempts = (Number(secret.failedAttempts) || 0) + 1;
      const recentFailed = Object.fromEntries(Object.entries(failedAttemptIds).slice(-19));
      return {
        ...secret,
        failedAttempts: failedAttempts >= 5 ? 0 : failedAttempts,
        lockedUntil: failedAttempts >= 5 ? currentTime + 15 * 60 * 1000 : 0,
        lastFailedAt: currentTime,
        failedAttemptIds: { ...recentFailed, [redemptionAttemptId]: currentTime },
      };
    }
    const recentVerified = Object.fromEntries(Object.entries(verifiedAttempts).slice(-19));
    return {
      ...secret,
      failedAttempts: 0,
      lockedUntil: 0,
      lastVerifiedAt: currentTime,
      verifiedAttempts: { ...recentVerified, [redemptionAttemptId]: currentTime },
    };
  });
  if (!verification.committed || !verification.snapshot.exists()) throw new HttpsError("failed-precondition", "Pass นี้ยังไม่ได้เปิดใช้งานหรือไม่พบ Passcode");
  const verifiedSecret = verification.snapshot.val();
  if ((Number(verifiedSecret.lockedUntil) || 0) > Date.now()) throw new HttpsError("resource-exhausted", "กรอก Passcode ผิดครบ 5 ครั้ง กรุณารอ 15 นาทีแล้วลองใหม่");
  if (!verifiedSecret.verifiedAttempts?.[redemptionAttemptId]) throw new HttpsError("permission-denied", "Passcode ไม่ถูกต้อง");
}

// Verify as soon as the customer finishes entering six digits. The same attempt
// ID is then reused by redeemCoffeePass so checkout remains idempotent.
exports.verifyCoffeePassPasscode = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อนใช้ Pass");
  const { shopUid, customerPhone, passId, redemptionAttemptId, passcode } = request.data || {};
  if (!validShopUid(shopUid) || !passId || !/^[A-Za-z0-9_-]{16,100}$/.test(redemptionAttemptId || "")) {
    throw new HttpsError("invalid-argument", "ข้อมูลการตรวจสอบ Pass ไม่ถูกต้อง");
  }
  const phone = normalizeThaiPhone(customerPhone);
  if (!phone || !/^\d{6}$/.test(String(passcode || ""))) throw new HttpsError("invalid-argument", "Passcode ต้องเป็นตัวเลข 6 หลัก");
  const passSnap = await db.ref(`customers/${shopUid}/${phone}/passes/${passId}`).once("value");
  const pass = passSnap.val();
  if (!pass || Number(pass.remainingUses) <= 0 || Number(pass.expiresAt) < Date.now() || pass.status === "cancelled") {
    throw new HttpsError("failed-precondition", "Pass นี้หมดอายุหรือไม่มีสิทธิ์คงเหลือแล้ว");
  }
  await verifyCoffeePasscodeAttempt(shopUid, passId, redemptionAttemptId, String(passcode));
  return { valid: true };
});

// Redeem exactly one use. The attempt ID makes retries idempotent, while the
// transaction prevents two devices from spending the final use together.
exports.redeemCoffeePass = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อนใช้ Pass");
  const { shopUid, passId, redemptionAttemptId, customerName, customerPhone, passcode, menuId, options, paymentMethod, pickupDate, note } = request.data || {};
  if (!validShopUid(shopUid) || !passId || !/^[A-Za-z0-9_-]{16,100}$/.test(redemptionAttemptId || "")) {
    throw new HttpsError("invalid-argument", "ข้อมูลการใช้ Pass ไม่ถูกต้อง");
  }
  const phone = normalizeThaiPhone(customerPhone);
  if (!phone) throw new HttpsError("invalid-argument", "เบอร์เจ้าของ Pass ไม่ถูกต้อง");
  if (!/^\d{6}$/.test(String(passcode || ""))) throw new HttpsError("invalid-argument", "Passcode ต้องเป็นตัวเลข 6 หลัก");
  if (!String(customerName || "").trim() || !menuId || typeof pickupDate !== "string") throw new HttpsError("invalid-argument", "ข้อมูลออเดอร์ไม่ครบ");
  if (!["promptpay", "cash", "thaihelpthai"].includes(paymentMethod)) throw new HttpsError("invalid-argument", "วิธีชำระค่าส่วนเพิ่มไม่ถูกต้อง");

  await verifyCoffeePasscodeAttempt(shopUid, passId, redemptionAttemptId, String(passcode));

  const [settingsSnap, menusSnap, optionGroupsSnap] = await Promise.all([
    db.ref(`shops/${shopUid}/settings`).once("value"),
    db.ref(`shops/${shopUid}/menus`).once("value"),
    db.ref(`shops/${shopUid}/optionGroups`).once("value"),
  ]);
  if (settingsSnap.child("acceptingOrders").val() === false) throw new HttpsError("failed-precondition", "ขณะนี้ร้านปิดรับออเดอร์");
  const menu = Object.values(menusSnap.val() || {}).filter(Boolean).find((item) => item.id === menuId);
  if (!menu || menu.available === false || isFoodProduct(menu)) throw new HttpsError("failed-precondition", "เมนูนี้ไม่พร้อมใช้ Pass");
  const currentPackage = settingsSnap.child("coffeePass").exists()
    ? normalizedCoffeePassConfig(settingsSnap.child("coffeePass").val())
    : null;

  const passRef = db.ref(`customers/${shopUid}/${phone}/passes/${passId}`);
  // As with the passcode secret, prime the full record before the transaction
  // so a cold instance cannot mistake an active Pass for a missing one.
  const currentPassSnapshot = await passRef.once("value");
  if (!currentPassSnapshot.exists()) throw new HttpsError("failed-precondition", "ไม่พบ Coffee Pass ในบัญชีลูกค้า");
  const initialPass = currentPassSnapshot.val();
  const proposedOrderId = db.ref(`orders/${shopUid}`).push().key;
  const now = Date.now();
  const transaction = await passRef.transaction((current) => {
    const passRecord = current || initialPass;
    const attempts = passRecord.redemptionAttempts || {};
    if (attempts[redemptionAttemptId]) return passRecord;
    if ((Number(passRecord.expiresAt) || 0) < now || (Number(passRecord.remainingUses) || 0) <= 0 || passRecord.status === "cancelled") return undefined;
    if (!coffeePassAllowsMenu(passRecord, currentPackage, menuId)) return undefined;
    const remainingUses = (Number(passRecord.remainingUses) || 0) - 1;
    return {
      ...passRecord,
      remainingUses,
      status: remainingUses === 0 ? "used" : "active",
      updatedAt: now,
      redemptionAttempts: { ...attempts, [redemptionAttemptId]: { orderId: proposedOrderId, menuId, createdAt: now } },
    };
  });
  if (!transaction.committed) throw new HttpsError("failed-precondition", "Pass หมดอายุ สิทธิ์หมด หรือใช้กับเมนูนี้ไม่ได้แล้ว");
  const pass = transaction.snapshot.val();
  const attempt = pass.redemptionAttempts && pass.redemptionAttempts[redemptionAttemptId];
  if (!attempt || !attempt.orderId) throw new HttpsError("internal", "ไม่สามารถจองสิทธิ์ได้");

  const allowedGroupIds = new Set(Array.isArray(menu.optionGroupIds) ? menu.optionGroupIds : Object.values(menu.optionGroupIds || {}));
  const groups = Object.values(optionGroupsSnap.val() || {}).filter(Boolean);
  const safeOptions = (Array.isArray(options) ? options : []).slice(0, 20).map((requested) => {
    const groupId = String(requested && requested.groupId || "");
    if (!allowedGroupIds.has(groupId)) return null;
    const group = groups.find((candidate) => candidate.id === groupId);
    const choices = group ? (Array.isArray(group.choices) ? group.choices : Object.values(group.choices || {})) : [];
    const choice = choices.filter(Boolean).find((candidate) => candidate.id === requested.choiceId && candidate.enabled !== false);
    if (!choice) return null;
    return {
      groupId,
      groupName: String(group.name || "").slice(0, 200),
      choiceId: String(choice.id),
      label: String(choice.label || "").slice(0, 200),
      priceDelta: Number(choice.priceDelta) || 0,
      ingredientId: choice.ingredientId || null,
      qtyPercent: choice.qtyPercent != null ? Number(choice.qtyPercent) : 100,
      extraAdjustments: Array.isArray(choice.extraAdjustments) ? choice.extraAdjustments.slice(0, 20) : Object.values(choice.extraAdjustments || {}).slice(0, 20),
    };
  }).filter(Boolean);
  const optionTotal = Math.max(0, Math.round(safeOptions.reduce((sum, option) => sum + (Number(option.priceDelta) || 0), 0) * 100) / 100);
  const orderData = {
    customerUid: request.auth.uid,
    customerName: String(customerName).trim().slice(0, 120),
    customerPhone: phone,
    note: String(note || "").trim().slice(0, 1000),
    paymentMethod: optionTotal > 0 ? paymentMethod : "coffee-pass",
    pickupDate,
    items: [{ menuId, name: String(menu.name || "เครื่องดื่ม"), productType: "drink", earnsLoyaltyBeans: menuEarnsLoyaltyBeans(menu), unitPrice: optionTotal, originalUnitPrice: (Number(menu.priceStore) || 0) + optionTotal, qty: 1, options: safeOptions, promoKind: "coffee-pass-redemption", passId }],
    total: optionTotal,
    passRedemption: { passId, redemptionAttemptId, packageName: pass.packageName || "Coffee Pass", optionTotal },
    status: "pending",
    createdAt: new Date(now).toISOString(),
  };
  const orderRef = db.ref(`orders/${shopUid}/${attempt.orderId}`);
  await orderRef.transaction((current) => current || orderData);
  return { orderId: attempt.orderId, order: (await orderRef.once("value")).val(), pass };
});

// Create (or return) one server-owned wheel result. The active result is kept on
// the member record so refreshing or changing devices cannot be used to reroll.
// Beans are deliberately not deducted here: an abandoned checkout should not
// cost the member anything.
exports.spinLoyaltyWheel = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณายืนยันเบอร์โทรศัพท์ก่อนหมุนกงล้อ");
  const { shopUid, customerPhone, redemptionAttemptId } = request.data || {};
  if (!validShopUid(shopUid) || !/^[A-Za-z0-9_-]{16,80}$/.test(String(redemptionAttemptId || ""))) {
    throw new HttpsError("invalid-argument", "ข้อมูลการหมุนกงล้อไม่ถูกต้อง");
  }
  const verifiedPhone = normalizeThaiPhone(request.auth.token.phone_number);
  const phone = normalizeThaiPhone(customerPhone);
  if (!verifiedPhone || verifiedPhone !== phone) {
    throw new HttpsError("permission-denied", "เบอร์ที่ยืนยันไม่ตรงกับเบอร์สมาชิก");
  }

  const settingsSnap = await db.ref(`shops/${shopUid}/settings`).once("value");
  const settings = settingsSnap.val() || {};
  if (settings.acceptingOrders === false) throw new HttpsError("failed-precondition", "ขณะนี้ร้านปิดรับออเดอร์");
  const beanGoal = Math.max(1, Math.floor(Number(settings.loyaltyBeanGoal) || 10));
  const freeDrinkCap = Math.min(60, Math.max(1, Math.round((Number(settings.loyaltyRewardValue) || 60) * 100) / 100));
  const segmentIndex = crypto.randomInt(LOYALTY_WHEEL_SEGMENTS.length);
  const selected = { ...LOYALTY_WHEEL_SEGMENTS[segmentIndex] };
  if (selected.id === "free-drink") selected.value = freeDrinkCap;
  const proposedSpin = {
    attemptId:redemptionAttemptId,
    prizeId:selected.id,
    value:selected.value,
    label:loyaltyWheelPrizeLabel(selected, freeDrinkCap),
    segmentIndex,
    beanGoal,
    createdAt:Date.now(),
  };

  const customerRef = db.ref(`customers/${shopUid}/${phone}`);
  const initialSnapshot = await customerRef.once("value");
  if (!initialSnapshot.exists()) throw new HttpsError("failed-precondition", "ไม่พบบัญชีสมาชิกสำหรับเบอร์นี้");
  const initialCustomer = initialSnapshot.val();
  const transaction = await customerRef.transaction((current) => {
    const customer = current || initialCustomer;
    if (customer.activeWheelSpin?.attemptId && customer.activeWheelSpin?.prizeId) return customer;
    if ((Number(customer.beans) || 0) < beanGoal) return undefined;
    return { ...customer, activeWheelSpin:proposedSpin, updatedAt:new Date().toISOString() };
  });
  if (!transaction.committed) throw new HttpsError("failed-precondition", "เมล็ดสะสมไม่พอสำหรับหมุนกงล้อแล้ว");
  const spin = transaction.snapshot.child("activeWheelSpin").val();
  if (!spin?.attemptId || !spin?.prizeId) throw new HttpsError("internal", "ไม่สามารถบันทึกผลกงล้อได้ กรุณาลองใหม่");
  return {
    redemptionAttemptId:spin.attemptId,
    prizeId:spin.prizeId,
    value:Number(spin.value)||0,
    label:String(spin.label || ""),
    segmentIndex:Number(spin.segmentIndex)||0,
  };
});

// Reward checkout is server-owned: a verified phone token and a previously
// stored wheel result are required, beans are deducted once per attempt ID, and
// retries resume the same deterministic order.
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

  const [settingsSnap, selectedMenuSnap] = await Promise.all([
    db.ref(`shops/${shopUid}/settings`).once("value"),
    db.ref(`shops/${shopUid}/menus`).once("value"),
  ]);
  const settings = settingsSnap.val() || {};
  if (settings.acceptingOrders === false) throw new HttpsError("failed-precondition", "ขณะนี้ร้านปิดรับออเดอร์");
  const selectedMenu = Object.values(selectedMenuSnap.val() || {}).filter(Boolean).find((menu) => menu.id === selectedLine.menuId);
  if (!selectedMenu || isFoodProduct(selectedMenu) || isFoodProduct(selectedLine)) {
    throw new HttpsError("failed-precondition", "รางวัลนี้ใช้แลกได้เฉพาะเครื่องดื่ม");
  }
  const proposedOrderId = db.ref(`orders/${shopUid}`).push().key;
  const customerRef = db.ref(`customers/${shopUid}/${orderPhone}`);
  // Prime the complete customer record before starting the transaction. A cold
  // Cloud Functions instance can invoke the transaction once with an empty
  // local cache; aborting on that first null incorrectly reports that a valid
  // customer with enough beans has insufficient points.
  const customerSnapshot = await customerRef.once("value");
  if (!customerSnapshot.exists()) {
    throw new HttpsError("failed-precondition", "ไม่พบบัญชีสมาชิกสำหรับเบอร์นี้");
  }
  const initialCustomer = customerSnapshot.val();
  const now = Date.now();
  const existingAttempt = initialCustomer.redemptionAttempts?.[redemptionAttemptId];
  const activeSpin = existingAttempt || initialCustomer.activeWheelSpin;
  if (!activeSpin || (activeSpin.attemptId && activeSpin.attemptId !== redemptionAttemptId)) {
    throw new HttpsError("failed-precondition", "กรุณาหมุนกงล้อรับรางวัลก่อนยืนยันสั่งซื้อ");
  }
  const beanGoal = Math.max(1, Math.floor(Number(activeSpin.beanGoal) || Number(settings.loyaltyBeanGoal) || 10));
  const prizeId = String(activeSpin.prizeId || "");
  if (!LOYALTY_WHEEL_SEGMENTS.some((prize) => prize.id === prizeId)) {
    throw new HttpsError("failed-precondition", "ผลรางวัลไม่ถูกต้อง กรุณาติดต่อร้าน");
  }
  const prizeValue = Math.max(0, Number(activeSpin.value) || 0);
  const prizeLabel = String(activeSpin.label || loyaltyWheelPrizeLabel({ id:prizeId, value:prizeValue }, prizeValue)).slice(0,120);
  const proposedRewardDiscount = Math.max(0, Math.round(loyaltyWheelDiscount({ prizeId, value:prizeValue }, selectedLine.unitPrice) * 100) / 100);

  const transaction = await customerRef.transaction((current) => {
    const customer = current || initialCustomer;
    const attempts = customer.redemptionAttempts || {};
    const existing = attempts[redemptionAttemptId];
    if (existing) return customer;
    const currentSpin = customer.activeWheelSpin;
    if (!currentSpin || currentSpin.attemptId !== redemptionAttemptId || currentSpin.prizeId !== prizeId) return undefined;
    if ((Number(customer.beans) || 0) < beanGoal) return undefined;

    const recentAttempts = Object.fromEntries(
      Object.entries(attempts)
        .sort(([, a], [, b]) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .slice(0, 19)
    );
    return {
      ...customer,
      beans: (Number(customer.beans) || 0) - beanGoal,
      redeemedCount: (Number(customer.redeemedCount) || 0) + 1,
      activeWheelSpin: null,
      updatedAt: new Date(now).toISOString(),
      redemptionAttempts: {
        ...recentAttempts,
        [redemptionAttemptId]: { orderId: proposedOrderId, prizeId, prizeValue, prizeLabel, beanGoal, rewardDiscount: proposedRewardDiscount, createdAt: now },
      },
    };
  });

  if (!transaction.committed) {
    throw new HttpsError("failed-precondition", "สิทธิ์กงล้อไม่พร้อมใช้หรือเมล็ดสะสมไม่พอแล้ว");
  }

  const attempt = transaction.snapshot.child(`redemptionAttempts/${redemptionAttemptId}`).val();
  if (!attempt || !attempt.orderId) {
    throw new HttpsError("internal", "ไม่สามารถยืนยันรายการแลกได้ กรุณาลองใหม่");
  }

  const rewardDiscount = Math.max(0, Math.round(Math.min(Number(selectedLine.unitPrice) || 0, Number(attempt.rewardDiscount ?? proposedRewardDiscount) || 0) * 100) / 100);
  const orderRef = db.ref(`orders/${shopUid}/${attempt.orderId}`);
  const items = draft.items.map(({ lineId, ...item }) => ({
    ...item,
    ...(lineId === selectedLineId ? { freeUnit: true, rewardDiscount } : {}),
  }));
  const subtotal = draft.items.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.qty), 0);
  const total = Math.max(0, Math.round((subtotal - rewardDiscount) * 100) / 100);
  const orderData = {
    customerUid: request.auth.uid,
    customerName: draft.customerName.trim(),
    customerPhone: draft.customerPhone.trim(),
    note: String(draft.note || "").trim().slice(0, 1000),
    paymentMethod: total <= 0 ? "reward" : draft.paymentMethod,
    pickupDate: draft.pickupDate,
    items,
    total,
    redeemedBeans: true,
    beansUsed: beanGoal,
    rewardPrizeId: String(attempt.prizeId || prizeId),
    rewardPrizeLabel: String(attempt.prizeLabel || prizeLabel),
    rewardValue: Math.max(0, Number(attempt.prizeValue) || prizeValue),
    rewardDiscount,
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

  if (order.coffeePassPurchase) {
    await activateCoffeePassForOrder(shopUid, orderId, order, verifiedBy);
  }

  await orderRef.update({
    status: order.coffeePassPurchase ? "done" : "paid",
    paymentVerified: true,
    paymentVerifiedAt: Date.now(),
    paymentVerifiedBy: verifiedBy,
    slipRef: slip.transRef || null,
    ...(order.coffeePassPurchase ? { coffeePassActivated: true, saleRecorded: true, completedAt: new Date().toISOString() } : {}),
  });

  return { verified: true, amount: slip.amount, transRef: slip.transRef, testMode };
});

// Owner-only receipt OCR. The image is sent inline to Gemini and is not stored in Firebase.
exports.scanPurchaseReceipt = onCall({ region: REGION, secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อนสแกนใบเสร็จ");
  const { shopUid, imageBase64, mimeType, ingredients } = request.data || {};
  if (!shopUid || request.auth.uid !== shopUid) throw new HttpsError("permission-denied", "ไม่มีสิทธิ์อ่านใบเสร็จของร้านนี้");
  if (!imageBase64 || typeof imageBase64 !== "string" || imageBase64.length > 9_000_000) {
    throw new HttpsError("invalid-argument", "รูปใบเสร็จไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
  }
  if (!Array.isArray(ingredients) || ingredients.length > 500) throw new HttpsError("invalid-argument", "รายการวัตถุดิบไม่ถูกต้อง");

  const catalog = ingredients.map((item) => ({
    id: String(item.id || "").slice(0, 160),
    name: String(item.name || "").slice(0, 200),
    unit: ["g", "ml", "piece"].includes(item.unit) ? item.unit : "piece",
  })).filter((item) => item.id && item.name);
  const prompt = `Read this Thai or English purchase receipt for a coffee shop. Return every purchased product line, excluding subtotal, VAT, discounts and payment lines. Match each product to the supplied inventory catalog only when reasonably confident. Convert package sizes into the matched inventory base unit: g for grams, ml for milliliters, piece for pieces (example: 2 cartons of 12 x 1L milk = 24000 ml). lineTotal is the final amount paid for that line after its line discount. Never invent unreadable values; use empty id, 0 quantity, or 0 price and a short note. Dates in Buddhist Era must be converted to Gregorian YYYY-MM-DD. Catalog: ${JSON.stringify(catalog)}`;
  const rawImage = imageBase64.includes(",") ? imageBase64.split(",").pop() : imageBase64;

  try {
    const requestBody = {
      contents: [{ parts: [
        { text: prompt },
        { inlineData: { mimeType: /^image\/(jpeg|png|webp|heic|heif)$/.test(mimeType || "") ? mimeType : "image/jpeg", data: rawImage } },
      ] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RECEIPT_SCHEMA, temperature: 0.1 },
    };
    // Model availability differs for older/newer API projects. Retry a current
    // lower-cost model only when the configured model itself is unavailable.
    const modelCandidates = [...new Set([GEMINI_RECEIPT_MODEL.value(), "gemini-3.5-flash", "gemini-3.1-flash-lite"])];
    let response;
    let lastModelError;
    for (const model of modelCandidates) {
      try {
        response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          requestBody,
          { headers: { "x-goog-api-key": GEMINI_API_KEY.value(), "Content-Type": "application/json" }, timeout: 55000 }
        );
        break;
      } catch (modelError) {
        lastModelError = modelError;
        if (modelError.response?.status !== 404) throw modelError;
        logger.warn("receipt model unavailable; trying fallback", { model, apiMessage: modelError.response?.data?.error?.message });
      }
    }
    if (!response) throw lastModelError || new Error("no receipt model available");
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("empty model response");
    const parsed = JSON.parse(text);
    return {
      vendorName: String(parsed.vendorName || "").slice(0, 200),
      purchaseDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.purchaseDate || "") ? parsed.purchaseDate : "",
      receiptNumber: String(parsed.receiptNumber || "").slice(0, 120),
      grandTotal: Math.max(0, Number(parsed.grandTotal) || 0),
      items: (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 100).map((item) => ({
        rawName: String(item.rawName || "").slice(0, 240),
        ingredientId: catalog.some((entry) => entry.id === item.ingredientId) ? item.ingredientId : "",
        stockQty: Math.max(0, Number(item.stockQty) || 0),
        lineTotal: Math.max(0, Number(item.lineTotal) || 0),
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
        note: String(item.note || "").slice(0, 240),
      })),
    };
  } catch (error) {
    logger.error("purchase receipt OCR failed", { uid: request.auth.uid, status: error.response?.status, data: error.response?.data, message: error.message });
    if (error.response?.status === 429) throw new HttpsError("resource-exhausted", "ระบบอ่านใบเสร็จกำลังถูกใช้งานมาก กรุณาลองใหม่อีกครั้ง");
    throw new HttpsError("internal", "อ่านใบเสร็จไม่สำเร็จ กรุณาถ่ายใหม่ให้เห็นทั้งใบและตัวหนังสือชัดเจน");
  }
});

// ---------------------------------------------------------------------------
// Clear Kan debt app
// These mutations stay server-side because every debt is shared by two users.

const DEBT_CALL_OPTIONS = { region: REGION, maxInstances: 10, enforceAppCheck: true };

function requiredDebtUser(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
  return {
    uid: request.auth.uid,
    name: String(request.auth.token.name || request.auth.token.email || "ผู้ใช้งาน").trim().slice(0, 120),
    email: String(request.auth.token.email || "").trim().toLowerCase().slice(0, 320),
    authProvider: String(request.auth.token.firebase?.sign_in_provider || "firebase").slice(0, 80),
  };
}

function cleanDebtAmount(value, fieldName = "จำนวนเงิน") {
  const amount = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    throw new HttpsError("invalid-argument", `${fieldName}ไม่ถูกต้อง`);
  }
  return amount;
}

function validDebtId(value) {
  return typeof value === "string" && /^[-A-Za-z0-9_]{8,160}$/.test(value);
}

function validDebtDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function debtParticipant(debt, uid) {
  return Boolean(debt && (debt.creditorUid === uid || debt.debtorUid === uid));
}

function otherDebtUid(debt, uid) {
  if (!debt) return "";
  return debt.creditorUid === uid ? String(debt.debtorUid || "") : String(debt.creditorUid || "");
}

function safeDebtDetails(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

const DEFAULT_DEBT_TERMS = Object.freeze({
  interestAnnualRate: 0,
  lateChargePolicy: "none",
  lateChargeDetail: "ไม่มีค่าปรับผิดนัด",
  allowPartialPayments: true,
  allowEarlyPayment: true,
  paymentAllocation: "selected_or_oldest",
  overpaymentPolicy: "reject",
  paymentReviewDays: 3,
  paymentMethod: "",
  allowDueDateChange: true,
  notificationsAreCourtesy: true,
});

function normalizeDebtTerms(rawTerms = {}, currentTerms = {}) {
  const raw = rawTerms && typeof rawTerms === "object" ? rawTerms : {};
  const current = currentTerms && typeof currentTerms === "object" ? currentTerms : {};
  const value = { ...DEFAULT_DEBT_TERMS, ...current, ...raw };
  const interestAnnualRate = Math.round(Number(value.interestAnnualRate || 0) * 100) / 100;
  if (!Number.isFinite(interestAnnualRate) || interestAnnualRate < 0 || interestAnnualRate > 15) {
    throw new HttpsError("invalid-argument", "อัตราดอกเบี้ยต้องอยู่ระหว่าง 0–15% ต่อปี");
  }
  const paymentReviewDays = Math.floor(Number(value.paymentReviewDays || 3));
  if (!Number.isInteger(paymentReviewDays) || paymentReviewDays < 1 || paymentReviewDays > 30) {
    throw new HttpsError("invalid-argument", "ระยะเวลาตรวจสอบการชำระต้องอยู่ระหว่าง 1–30 วัน");
  }
  const lateChargePolicy = value.lateChargePolicy === "custom" ? "custom" : "none";
  const paymentAllocation = ["selected_or_oldest", "oldest_first"].includes(value.paymentAllocation) ? value.paymentAllocation : "selected_or_oldest";
  const overpaymentPolicy = ["reject", "refund", "credit"].includes(value.overpaymentPolicy) ? value.overpaymentPolicy : "reject";
  return {
    interestAnnualRate,
    lateChargePolicy,
    lateChargeDetail: String(lateChargePolicy === "none" ? "ไม่มีค่าปรับผิดนัด" : value.lateChargeDetail || "").trim().slice(0, 500),
    allowPartialPayments: value.allowPartialPayments !== false,
    allowEarlyPayment: value.allowEarlyPayment !== false,
    paymentAllocation,
    overpaymentPolicy,
    paymentReviewDays,
    paymentMethod: String(value.paymentMethod || "").trim().slice(0, 300),
    allowDueDateChange: value.allowDueDateChange !== false,
    notificationsAreCourtesy: true,
  };
}

function stableDebtValue(value) {
  if (Array.isArray(value)) return value.map(stableDebtValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableDebtValue(value[key])]));
}

function debtAgreementSnapshot(debt, version = 1) {
  return stableDebtValue({
    schemaVersion: 1,
    agreementVersion: version,
    creditor: { uid: debt.creditorUid || "", name: debt.creditorName || "", email: debt.creditorEmail || "" },
    debtor: { uid: debt.debtorUid || "", name: debt.debtorName || "", email: debt.debtorEmail || "" },
    title: debt.title || "",
    note: debt.note || "",
    amount: Number(debt.amount) || 0,
    outstandingStatus: debt.outstandingStatus || "confirmed",
    outstandingAmount: debt.outstandingStatus === "unconfirmed" ? null : Number(debt.outstandingAmount) || 0,
    debtType: debt.debtType || "single",
    dueDateMode: debt.dueDateMode || (debt.dueDate ? "date" : "none"),
    dueDate: debt.dueDate || null,
    installmentPlan: debt.installmentPlan || null,
    installments: debt.installments || null,
    lineItems: debt.lineItems || null,
    terms: normalizeDebtTerms(debt.terms),
  });
}

function debtAgreementDigest(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(stableDebtValue(snapshot))).digest("hex");
}

function debtAcceptance(user, digest, acceptedAt, method) {
  return {
    uid: user.uid,
    name: user.name,
    email: user.email,
    authProvider: user.authProvider || "firebase",
    digest,
    acceptedAt,
    method,
    statement: "ข้าพเจ้าได้อ่าน ตรวจสอบ และยอมรับข้อมูลกับเงื่อนไขของรายการนี้",
  };
}

function agreementVersionRecord(debt, version, acceptances, createdAt) {
  const snapshot = debtAgreementSnapshot(debt, version);
  const digest = debtAgreementDigest(snapshot);
  return {
    version,
    digest,
    snapshot,
    acceptances: safeDebtDetails(acceptances || {}),
    createdAt,
  };
}

function agreementSetDigest(items) {
  return debtAgreementDigest(items.map((item) => ({ debtId: item.debtId, digest: item.digest })).sort((a, b) => a.debtId.localeCompare(b.debtId)));
}

async function createDebtConsentRequest(debtId, debt, user, type, payload, targetId = "") {
  const approverUid = otherDebtUid(debt, user.uid);
  if (!approverUid) throw new HttpsError("failed-precondition", "รายการนี้ยังไม่มีคู่สัญญาอีกฝ่าย");
  const existingSnapshot = await db.ref(`debtConsentRequests/${debtId}`).once("value");
  const duplicate = Object.values(existingSnapshot.val() || {}).some((item) => item?.status === "pending" && item?.type === type && String(item?.targetId || "") === String(targetId || ""));
  if (duplicate) throw new HttpsError("already-exists", "มีคำขอประเภทนี้รออีกฝ่ายตรวจสอบอยู่แล้ว");
  const requestId = db.ref(`debtConsentRequests/${debtId}`).push().key;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const updates = {
    [`debtConsentRequests/${debtId}/${requestId}`]: {
      type,
      targetId: targetId || null,
      payload: safeDebtDetails(payload),
      status: "pending",
      requestedBy: user.uid,
      requestedByName: user.name,
      approverUid,
      baseUpdatedAt: debt.updatedAt || "",
      createdAt: now,
      updatedAt: now,
      expiresAt,
    },
  };
  addDebtAudit(updates, debtId, `${type}_requested`, user, { requestId, targetId: targetId || null });
  addDebtNotification(updates, approverUid, debtId, "consent_requested", "มีคำขอที่ต้องยืนยัน", `${user.name} ส่งคำขอเกี่ยวกับ ${debt.title}`);
  await db.ref().update(updates);
  return { pendingApproval: true, requestId };
}

async function applyApprovedDebtAction(debtId, debt, consent, approver) {
  const now = new Date().toISOString();
  const requesterUid = consent.requestedBy;
  const notifyUid = requesterUid;
  const updates = {};
  if (consent.type === "debt_cancel") {
    const reason = String(consent.payload?.reason || "").slice(0, 500);
    const invitationSnapshot = debt.inviteCode ? await db.ref(`debtInviteCodes/${debt.inviteCode}`).once("value") : null;
    const rawInvitation = invitationSnapshot?.val();
    updates[`debts/${debtId}/status`] = "cancelled";
    updates[`debts/${debtId}/cancelledAt`] = now;
    updates[`debts/${debtId}/cancelledBy`] = requesterUid;
    updates[`debts/${debtId}/cancelledApprovedBy`] = approver.uid;
    updates[`debts/${debtId}/cancellationReason`] = reason;
    updates[`debts/${debtId}/updatedAt`] = now;
    if (rawInvitation && typeof rawInvitation === "object") {
      const remaining = (Array.isArray(rawInvitation.debtIds) ? rawInvitation.debtIds : Object.values(rawInvitation.debtIds || {})).filter((id) => validDebtId(id) && id !== debtId);
      updates[`debtInviteCodes/${debt.inviteCode}`] = remaining.length ? { ...rawInvitation, debtIds: remaining } : null;
    } else if (debt.inviteCode) updates[`debtInviteCodes/${debt.inviteCode}`] = null;
    addDebtAudit(updates, debtId, "debt_cancelled", approver, { reason, requestedBy: requesterUid, mutualConsent: true });
    addDebtNotification(updates, notifyUid, debtId, "consent_accepted", "คำขอยกเลิกได้รับการยืนยัน", `${debt.title} · ${reason}`);
  } else if (consent.type === "outstanding_confirm") {
    const amount = Math.round(Number(consent.payload?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000000 || debt.outstandingStatus !== "unconfirmed") throw new HttpsError("failed-precondition", "ยอดค้างหรือสถานะรายการไม่ถูกต้อง");
    const status = amount > 0 ? "active" : "paid";
    updates[`debts/${debtId}/outstandingAmount`] = amount;
    updates[`debts/${debtId}/outstandingStatus`] = "confirmed";
    updates[`debts/${debtId}/status`] = status;
    updates[`debts/${debtId}/paidAt`] = amount <= 0 ? now : null;
    updates[`debts/${debtId}/outstandingConfirmedAt`] = now;
    updates[`debts/${debtId}/outstandingConfirmedBy`] = requesterUid;
    updates[`debts/${debtId}/outstandingConfirmedApprovedBy`] = approver.uid;
    updates[`debts/${debtId}/updatedAt`] = now;
    const nextDebt = { ...debt, outstandingAmount: amount, outstandingStatus: "confirmed", status, paidAt: amount <= 0 ? now : null, updatedAt: now };
    const version = Math.max(1, Number(debt.agreementVersion) || 1) + 1;
    const requester = { uid: requesterUid, name: consent.requestedByName || "คู่สัญญา", email: "", authProvider: "firebase" };
    const agreement = agreementVersionRecord(nextDebt, version, {}, now);
    agreement.acceptances[requester.uid] = debtAcceptance(requester, agreement.digest, consent.createdAt || now, "outstanding_requester_acceptance");
    agreement.acceptances[approver.uid] = debtAcceptance(approver, agreement.digest, now, "outstanding_approver_acceptance");
    updates[`debts/${debtId}/agreementVersion`] = version;
    updates[`debts/${debtId}/agreementDigest`] = agreement.digest;
    updates[`debts/${debtId}/agreementStatus`] = "accepted";
    updates[`debtAgreementVersions/${debtId}/v_${String(version).padStart(3, "0")}`] = agreement;
    addDebtAudit(updates, debtId, "outstanding_confirmed", approver, { amount, requestedBy: requesterUid, mutualConsent: true, agreementVersion: version });
    addDebtNotification(updates, notifyUid, debtId, "consent_accepted", "ยอดค้างได้รับการยืนยันร่วมกัน", `${debt.title} · ฿${amount.toLocaleString("th-TH")}`);
  } else if (consent.type === "dispute_resolve") {
    const disputeId = String(consent.targetId || "");
    const disputeSnapshot = await db.ref(`debtDisputes/${debtId}/${disputeId}`).once("value");
    if (!disputeSnapshot.exists() || disputeSnapshot.child("status").val() !== "open") throw new HttpsError("failed-precondition", "ข้อโต้แย้งนี้ถูกปิดแล้ว");
    const resolution = String(consent.payload?.resolution || "").slice(0, 1000);
    const nextStatus = debt.outstandingStatus === "unconfirmed" ? "unconfirmed" : Number(debt.outstandingAmount) > 0 ? "active" : "paid";
    updates[`debtDisputes/${debtId}/${disputeId}/status`] = "resolved";
    updates[`debtDisputes/${debtId}/${disputeId}/resolution`] = resolution;
    updates[`debtDisputes/${debtId}/${disputeId}/resolvedAt`] = now;
    updates[`debtDisputes/${debtId}/${disputeId}/resolvedBy`] = requesterUid;
    updates[`debtDisputes/${debtId}/${disputeId}/resolvedApprovedBy`] = approver.uid;
    updates[`debtDisputes/${debtId}/${disputeId}/updatedAt`] = now;
    updates[`debts/${debtId}/status`] = nextStatus;
    updates[`debts/${debtId}/updatedAt`] = now;
    addDebtAudit(updates, debtId, "dispute_resolved", approver, { disputeId, resolution, requestedBy: requesterUid, mutualConsent: true });
    addDebtNotification(updates, notifyUid, debtId, "consent_accepted", "ข้อตกลงยุติข้อโต้แย้งได้รับการยืนยัน", `${debt.title} · ${resolution}`);
  } else if (consent.type === "payment_reverse") {
    const paymentId = String(consent.targetId || "");
    const paymentsSnapshot = await db.ref(`debtPayments/${debtId}`).once("value");
    const payments = paymentsSnapshot.val() || {};
    const payment = payments[paymentId];
    if (!payment || payment.status !== "confirmed") throw new HttpsError("failed-precondition", "ย้อนกลับได้เฉพาะรายการที่ยืนยันแล้ว");
    const laterConfirmed = Object.entries(payments).some(([id, item]) => id !== paymentId && item.status === "confirmed" && String(item.confirmedAt || "") > String(payment.confirmedAt || ""));
    if (laterConfirmed) throw new HttpsError("failed-precondition", "ต้องย้อนรายการชำระล่าสุดก่อน");
    const appliedAmount = Number(payment.appliedAmount) || Number(payment.amount) || 0;
    const excessAmount = Math.max(0, Number(payment.excessAmount) || 0);
    const allocations = payment.allocations || debt.appliedPayments?.[paymentId]?.allocations || {};
    const reason = String(consent.payload?.reason || "").slice(0, 500);
    const debtResult = await db.ref(`debts/${debtId}`).transaction((current) => {
      if (!current || !debtParticipant(current, approver.uid)) return;
      if (current.appliedPayments?.[paymentId]?.reversedAt) return current;
      let installments = current.installments ? JSON.parse(JSON.stringify(current.installments)) : null;
      if (installments) Object.entries(allocations).forEach(([installmentId, allocation]) => {
        if (!installments[installmentId]) return;
        const value = Math.max(0, Number(allocation) || 0);
        installments[installmentId].paidAmount = Math.max(0, Math.round((Number(installments[installmentId].paidAmount || 0) - value) * 100) / 100);
        installments[installmentId].status = installments[installmentId].paidAmount > 0 ? "partial" : "upcoming";
        installments[installmentId].paidAt = null;
      });
      const nextOutstanding = Math.round((Number(current.outstandingAmount || 0) + appliedAmount) * 100) / 100;
      const ordered = Object.values(installments || {}).sort((a, b) => Number(a.sequence) - Number(b.sequence));
      const installmentPlan = installments ? { ...current.installmentPlan, paidInstallments: ordered.filter((item) => item.status === "paid").length, nextInstallmentDueDate: ordered.find((item) => item.status !== "paid")?.dueDate || null } : null;
      return {
        ...current,
        outstandingAmount: nextOutstanding,
        status: "active",
        paidAt: null,
        ...(installments ? { installments, installmentPlan, dueDate: installmentPlan.nextInstallmentDueDate } : {}),
        appliedPayments: { ...(current.appliedPayments || {}), [paymentId]: { ...(current.appliedPayments?.[paymentId] || {}), reversedAt: now, reversedBy: requesterUid, reversedApprovedBy: approver.uid, reversalReason: reason } },
        ...(payment.excessDisposition === "credit" ? { creditBalance: Math.max(0, Math.round((Number(current.creditBalance || 0) - excessAmount) * 100) / 100) } : {}),
        ...(payment.excessDisposition === "refund" ? { refundDue: Math.max(0, Math.round((Number(current.refundDue || 0) - excessAmount) * 100) / 100) } : {}),
        updatedAt: now,
      };
    });
    if (!debtResult.committed) throw new HttpsError("aborted", "ย้อนรายการชำระไม่สำเร็จ");
    updates[`debtPayments/${debtId}/${paymentId}/status`] = "reversed";
    updates[`debtPayments/${debtId}/${paymentId}/reversedAt`] = now;
    updates[`debtPayments/${debtId}/${paymentId}/reversedBy`] = requesterUid;
    updates[`debtPayments/${debtId}/${paymentId}/reversedApprovedBy`] = approver.uid;
    updates[`debtPayments/${debtId}/${paymentId}/reversalReason`] = reason;
    updates[`debtPayments/${debtId}/${paymentId}/updatedAt`] = now;
    updates[`debtClosures/${debtId}`] = null;
    addDebtAudit(updates, debtId, "payment_reversed", approver, { paymentId, amount: appliedAmount, reason, requestedBy: requesterUid, mutualConsent: true });
    addDebtNotification(updates, notifyUid, debtId, "consent_accepted", "คำขอย้อนรายการชำระได้รับการยืนยัน", `${debt.title} ฿${appliedAmount.toLocaleString("th-TH")}`);
  } else {
    throw new HttpsError("invalid-argument", "ประเภทคำขอไม่ถูกต้อง");
  }
  await db.ref().update(updates);
}

function addDebtAudit(updates, debtId, action, user, details = {}) {
  const auditId = db.ref(`debtAuditLogs/${debtId}`).push().key;
  updates[`debtAuditLogs/${debtId}/${auditId}`] = {
    action,
    actorUid: user.uid,
    actorName: user.name,
    details: safeDebtDetails(details),
    createdAt: new Date().toISOString(),
  };
}

function addDebtNotification(updates, uid, debtId, type, title, body) {
  if (!uid) return;
  const notificationId = db.ref(`debtNotifications/${uid}`).push().key;
  updates[`debtNotifications/${uid}/${notificationId}`] = {
    debtId,
    type,
    title: String(title || "แจ้งเตือนรายการหนี้").slice(0, 160),
    body: String(body || "").slice(0, 500),
    createdAt: new Date().toISOString(),
    readAt: null,
  };
}

async function enforceDebtRateLimit(uid, action, limit = 30, windowMs = 60 * 1000) {
  const nowMs = Date.now();
  const result = await db.ref(`debtRateLimits/${uid}/${action}`).transaction((current) => {
    const startedAtMs = Number(current?.startedAtMs) || 0;
    if (!current || nowMs - startedAtMs >= windowMs) return { startedAtMs: nowMs, count: 1, updatedAtMs: nowMs };
    return { ...current, count: (Number(current.count) || 0) + 1, updatedAtMs: nowMs };
  });
  if ((Number(result.snapshot.child("count").val()) || 0) > limit) {
    throw new HttpsError("resource-exhausted", "ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
  }
}

async function requiredDebtForUser(debtId, user) {
  const snapshot = await db.ref(`debts/${debtId}`).once("value");
  const debt = snapshot.val();
  if (!debt) throw new HttpsError("not-found", "ไม่พบรายการหนี้");
  if (!debtParticipant(debt, user.uid)) throw new HttpsError("permission-denied", "ไม่มีสิทธิ์เข้าถึงรายการนี้");
  return debt;
}

function debtInviteCode() {
  return crypto.randomBytes(12).toString("base64url");
}

function addMonthsToDebtDate(dateString, offset) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function buildDebtInstallments({ amount, monthlyAmount, totalInstallments, paidInstallments, firstDueDate }) {
  const installments = {};
  for (let sequence = 1; sequence <= totalInstallments; sequence += 1) {
    const installmentAmount = sequence === totalInstallments
      ? Math.round((amount - monthlyAmount * (totalInstallments - 1)) * 100) / 100
      : monthlyAmount;
    const paid = sequence <= paidInstallments;
    const dueOffset = sequence - paidInstallments - 1;
    installments[`inst_${String(sequence).padStart(3, "0")}`] = {
      sequence,
      amount: installmentAmount,
      paidAmount: paid ? installmentAmount : 0,
      dueDate: addMonthsToDebtDate(firstDueDate, dueOffset),
      status: paid ? "paid" : "upcoming",
      ...(paid ? { importedAsPaid: true } : {}),
    };
  }
  return installments;
}

function normalizedDebtDraft(payload, user, overrides = {}) {
  const creditorName = String(payload.creditorLegalName || user.name || "").trim().slice(0, 120);
  const debtorName = String(payload.debtorName || "").trim().slice(0, 120);
  const title = String(payload.title || "").trim().slice(0, 160);
  const note = String(payload.note || "").trim().slice(0, 1000);
  const dueDate = String(payload.dueDate || "");
  const amount = cleanDebtAmount(payload.amount);
  const debtType = payload.debtType === "installment" ? "installment" : "single";
  const terms = normalizeDebtTerms(payload.terms);
  const outstandingUnconfirmed = overrides.allowUnconfirmedOutstanding === true && payload.outstandingStatus === "unconfirmed";
  const noDueDate = debtType === "single" && (payload.noDueDate === true || payload.dueDateMode === "none" || !dueDate);
  if (!debtorName) throw new HttpsError("invalid-argument", "กรุณาระบุชื่อลูกหนี้");
  if (!title) throw new HttpsError("invalid-argument", "กรุณาระบุชื่อรายการ");
  if (!outstandingUnconfirmed && !noDueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)))) {
    throw new HttpsError("invalid-argument", "วันครบกำหนดไม่ถูกต้อง");
  }

  const lineItems = (Array.isArray(payload.lineItems) ? payload.lineItems : []).slice(0, 100).map((item) => ({
    title: String(item?.title || "").trim().slice(0, 160),
    amount: Math.max(0, Math.round((Number(item?.amount) || 0) * 100) / 100),
  })).filter((item) => item.title && item.amount > 0);

  let outstandingAmount = outstandingUnconfirmed ? null : amount;
  let installmentPlan = null;
  let installments = null;
  if (debtType === "installment") {
    const totalInstallments = Math.floor(Number(payload.totalInstallments));
    const paidInstallments = Math.floor(Number(payload.paidInstallments) || 0);
    const monthlyAmount = cleanDebtAmount(payload.monthlyAmount, "ยอดต่องวด");
    const firstDueDate = String(payload.firstDueDate || dueDate);
    if (!Number.isInteger(totalInstallments) || totalInstallments < 2 || totalInstallments > 120) {
      throw new HttpsError("invalid-argument", "จำนวนงวดต้องอยู่ระหว่าง 2–120 งวด");
    }
    if (!Number.isInteger(paidInstallments) || paidInstallments < 0 || paidInstallments >= totalInstallments) {
      throw new HttpsError("invalid-argument", "จำนวนงวดที่ชำระแล้วไม่ถูกต้อง");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) throw new HttpsError("invalid-argument", "วันครบกำหนดงวดแรกไม่ถูกต้อง");
    const finalAmount = Math.round((amount - monthlyAmount * (totalInstallments - 1)) * 100) / 100;
    if (finalAmount <= 0 || finalAmount > monthlyAmount * 2) {
      throw new HttpsError("invalid-argument", "ยอดรวม จำนวนงวด และยอดต่องวดไม่สอดคล้องกัน");
    }
    installments = buildDebtInstallments({ amount, monthlyAmount, totalInstallments, paidInstallments, firstDueDate });
    outstandingAmount = Math.round(Object.values(installments).filter((item) => item.status !== "paid").reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    installmentPlan = {
      totalInstallments,
      paidInstallments,
      monthlyAmount,
      firstDueDate,
      nextInstallmentDueDate: Object.values(installments).find((item) => item.status !== "paid")?.dueDate || null,
    };
  }

  const now = overrides.now || new Date().toISOString();
  return {
    creditorUid: user.uid,
    creditorName,
    creditorEmail: user.email,
    debtorUid: null,
    debtorName,
    title,
    note,
    amount,
    ...(outstandingUnconfirmed ? { outstandingStatus: "unconfirmed" } : { outstandingAmount }),
    ...(!outstandingUnconfirmed ? {
      dueDateMode: noDueDate ? "none" : "date",
      ...(noDueDate ? {} : { dueDate: debtType === "installment" ? installmentPlan.nextInstallmentDueDate : dueDate }),
    } : {}),
    status: "pending",
    debtType,
    terms,
    ...(installmentPlan ? { installmentPlan, installments } : {}),
    ...(lineItems.length ? { lineItems } : {}),
    ...(payload.source ? { source: String(payload.source).slice(0, 120) } : {}),
    inviteCode: overrides.inviteCode || debtInviteCode(),
    createdAt: now,
    updatedAt: now,
  };
}

exports.createDebt = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "createDebt", 12, 60 * 60 * 1000);
  const payload = request.data || {};
  const directDelivery = payload.deliveryMode === "direct";
  let directDebtor = null;
  if (directDelivery) {
    const debtorEmail = String(payload.debtorEmail || "").trim().toLowerCase().slice(0, 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debtorEmail)) throw new HttpsError("invalid-argument", "กรุณาระบุอีเมลบัญชีลูกหนี้ให้ถูกต้อง");
    try {
      directDebtor = await admin.auth().getUserByEmail(debtorEmail);
    } catch (error) {
      if (error?.code === "auth/user-not-found") throw new HttpsError("not-found", "ไม่พบบัญชีลูกหนี้ด้วยอีเมลนี้ กรุณาตรวจอีเมลหรือใช้ลิงก์เชิญ");
      throw error;
    }
    if (directDebtor.uid === user.uid) throw new HttpsError("failed-precondition", "ไม่สามารถเลือกรายการของตัวเองเป็นลูกหนี้ได้");
  }
  const debtRef = db.ref("debts").push();
  const debtId = debtRef.key;
  const inviteCode = debtInviteCode();
  const now = new Date().toISOString();
  const debt = normalizedDebtDraft(payload, user, { inviteCode, now });
  if (directDebtor) {
    debt.debtorUid = directDebtor.uid;
    debt.debtorName = String(payload.debtorName || directDebtor.displayName || directDebtor.email?.split("@")[0] || "ลูกหนี้").trim().slice(0, 120);
    debt.debtorEmail = directDebtor.email || String(payload.debtorEmail).trim().toLowerCase();
    debt.inviteDelivery = "direct";
    debt.directInviteStatus = "pending";
    delete debt.inviteCode;
  }
  const version = 1;
  const agreement = agreementVersionRecord(debt, version, {}, now);
  agreement.acceptances[user.uid] = debtAcceptance(user, agreement.digest, now, "creditor_created");
  debt.agreementVersion = version;
  debt.agreementDigest = agreement.digest;
  debt.agreementStatus = "awaiting_debtor";
  const updates = {
    [`debts/${debtId}`]: debt,
    [`debtAgreementVersions/${debtId}/v_${String(version).padStart(3, "0")}`]: agreement,
    [`debtMembers/${user.uid}/${debtId}`]: true,
    ...(!directDebtor ? { [`debtInviteCodes/${inviteCode}`]: debtId } : { [`debtMembers/${directDebtor.uid}/${debtId}`]: true }),
  };
  addDebtAudit(updates, debtId, directDebtor ? "direct_invite_sent" : "debt_created", user, { amount: debt.amount, debtType: debt.debtType, deliveryMode: directDebtor ? "direct" : "link" });
  if (directDebtor) addDebtNotification(updates, directDebtor.uid, debtId, "direct_invite_received", "มีคำขอรายการหนี้ใหม่", `${user.name} ส่งรายการ ${debt.title} ฿${debt.amount.toLocaleString("th-TH")} ให้คุณตรวจสอบ`);
  await db.ref().update(updates);
  return directDebtor
    ? { debtId, deliveryMode: "direct", debtorName: debt.debtorName, debtorEmail: debt.debtorEmail }
    : { debtId, inviteCode, deliveryMode: "link" };
});

const PUN_WORKBOOK_DEBTS = [
  { title: "I15 Pro Max", amount: 20000, totalInstallments: 10, paidInstallments: 9, monthlyAmount: 2000 },
  { title: "Japan Ticket", amount: 11560, totalInstallments: 10, paidInstallments: 9, monthlyAmount: 1156 },
  { title: "Crown Hotel", amount: 8040, totalInstallments: 10, paidInstallments: 6, monthlyAmount: 804 },
  { title: "Japan Hotel", amount: 14345, totalInstallments: 10, paidInstallments: 3, monthlyAmount: 1434.5 },
  { title: "Camp All", amount: 1113, totalInstallments: 3, paidInstallments: 2, monthlyAmount: 371 },
  { title: "The Weeked", amount: 3150, totalInstallments: 3, paidInstallments: 2, monthlyAmount: 1050 },
];

const PUN_WORKBOOK_LINE_ITEMS = [
  ["ข้าวสนามบิน", 316.3], ["Taxi สนามบิน", 210.5], ["CJ เขาใหญ่", 167], ["เป็นลาว", 382.5],
  ["หมูกระทะ", 333.5], ["บ้านกันเอง", 430], ["Ikea 39+39+169+29", 276], ["Hotpotman", 603],
  ["Hotpotman", 533], ["เซเว่น+กะเพรา", 90], ["ป๊าโอนให้", 200], ["SF", 105],
  ["Mercure Bangkok", 700], ["ส้มตำเลียบราง", 100], ["ฟิล์มมือถือ", 200], ["ส้มตำเจ๊เป้า", 257.5],
  ["Rays Cafe", 80], ["SF RAMA9", 162], ["Hotpotman 8 ส.ค.", 603], ["ก๋วยจั๊บ", 50],
  ["ตลาด", 120], ["หมาล่า", 99],
].map(([title, amount]) => ({ title, amount }));

exports.initializePunDebts = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  const initializationRef = db.ref("debtInitializations/punWorkbookV1");
  const claimId = crypto.randomBytes(12).toString("base64url");
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const claim = await initializationRef.transaction((current) => {
    if (current?.status === "complete") return current;
    if (current?.status === "processing" && nowMs - (Number(current.startedAtMs) || 0) < 5 * 60 * 1000) return current;
    return { status: "processing", creditorUid: user.uid, creditorName: user.name, claimId, startedAt: now, startedAtMs: nowMs };
  });
  const lock = claim.snapshot.val() || {};
  if (lock.status === "complete") {
    return { created: false, owner: lock.creditorUid === user.uid, debtIds: lock.creditorUid === user.uid ? (lock.debtIds || []) : [] };
  }
  if (lock.claimId !== claimId || lock.creditorUid !== user.uid) return { created: false, owner: false, processing: true };

  const inviteCode = debtInviteCode();
  const firstDueDate = "2026-09-01";
  const debtDrafts = [
    ...PUN_WORKBOOK_DEBTS.map((item) => ({
      ...item,
      debtType: "installment",
      debtorName: "Pun",
      dueDate: firstDueDate,
      firstDueDate,
      note: `นำเข้าจาก Copy of Pun.xlsx · ชำระแล้ว ${item.paidInstallments}/${item.totalInstallments} งวด`,
      source: "pun-workbook-v1",
    })),
    {
      debtType: "single", debtorName: "Pun", title: "หนี้ทบ", amount: 794.63, dueDate: firstDueDate,
      note: "นำเข้าจาก Copy of Pun.xlsx", source: "pun-workbook-v1",
    },
    {
      debtType: "single", debtorName: "Pun", title: "ค่าใช้จ่ายทั่วไป", amount: 6018.3, dueDate: firstDueDate,
      note: "นำเข้าจาก Copy of Pun.xlsx · หมายเหตุที่ยังไม่แปลงเป็นบาท: 2,300 เยน พาส",
      lineItems: PUN_WORKBOOK_LINE_ITEMS, source: "pun-workbook-v1",
    },
    {
      debtType: "single", debtorName: "Pun", title: "ยอดหนี้รวม ณ 2 พ.ค.", amount: 28069,
      outstandingStatus: "unconfirmed",
      note: "ยอดอ้างอิงจาก Copy of Pun.xlsx · ยังไม่กำหนดยอดค้างชำระ จึงยังไม่รวมในยอดภาพรวม",
      source: "pun-workbook-v1",
    },
  ];
  const updates = {};
  const debtIds = [];
  for (const draft of debtDrafts) {
    const debtId = db.ref("debts").push().key;
    const debt = normalizedDebtDraft(draft, user, { inviteCode, now, allowUnconfirmedOutstanding: true });
    const version = 1;
    const agreement = agreementVersionRecord(debt, version, {}, now);
    agreement.acceptances[user.uid] = debtAcceptance(user, agreement.digest, now, "creditor_initialized");
    debt.agreementVersion = version;
    debt.agreementDigest = agreement.digest;
    debt.agreementStatus = "awaiting_debtor";
    debtIds.push(debtId);
    updates[`debts/${debtId}`] = debt;
    updates[`debtAgreementVersions/${debtId}/v_${String(version).padStart(3, "0")}`] = agreement;
    updates[`debtMembers/${user.uid}/${debtId}`] = true;
    addDebtAudit(updates, debtId, "debt_initialized", user, { source: "Copy of Pun.xlsx", amount: debt.amount });
  }
  updates[`debtInviteCodes/${inviteCode}`] = { kind: "batch", debtIds, creditorUid: user.uid, createdAt: now };
  await db.ref().update(updates);
  await initializationRef.set({
    status: "complete", creditorUid: user.uid, creditorName: user.name, inviteCode, debtIds,
    sourceFile: "Copy of Pun.xlsx", completedAt: new Date().toISOString(),
  });
  return { created: true, owner: true, inviteCode, debtIds };
});

exports.getDebtInvitePreview = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "getDebtInvitePreview", 40, 60 * 60 * 1000);
  const inviteCode = String(request.data?.inviteCode || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(inviteCode)) throw new HttpsError("invalid-argument", "ลิงก์เชิญไม่ถูกต้อง");
  const invitationSnapshot = await db.ref(`debtInviteCodes/${inviteCode}`).once("value");
  const rawInvitation = invitationSnapshot.val();
  if (!rawInvitation) throw new HttpsError("not-found", "ลิงก์เชิญหมดอายุหรือถูกใช้แล้ว");
  const invitation = typeof rawInvitation === "string" ? { debtIds: [rawInvitation] } : rawInvitation;
  if ((invitation.claimedBy && invitation.claimedBy !== user.uid) || invitation.declinedBy) throw new HttpsError("not-found", "ลิงก์เชิญหมดอายุหรือถูกใช้แล้ว");
  const debtIds = (Array.isArray(invitation.debtIds) ? invitation.debtIds : Object.values(invitation.debtIds || {})).filter(validDebtId).slice(0, 100);
  const snapshots = await Promise.all(debtIds.map((debtId) => db.ref(`debts/${debtId}`).once("value")));
  const debts = snapshots.map((snapshot) => snapshot.val());
  if (!debtIds.length || debts.some((debt) => !debt)) throw new HttpsError("not-found", "ไม่พบรายการหนี้ในคำเชิญ");
  if (debts.some((debt) => debt.creditorUid === user.uid)) throw new HttpsError("failed-precondition", "เจ้าหนี้ไม่สามารถรับคำเชิญของตัวเองได้");
  const records = debts.map((debt, index) => {
    const version = Math.max(1, Number(debt.agreementVersion) || 1);
    const agreement = agreementVersionRecord(debt, version, {}, debt.createdAt || new Date().toISOString());
    return { debtId: debtIds[index], digest: agreement.digest, agreement };
  });
  return {
    agreementSetDigest: agreementSetDigest(records),
    items: records.map(({ debtId, digest, agreement }, index) => ({
      debtId,
      digest,
      version: agreement.version,
      title: debts[index].title,
      creditorName: debts[index].creditorName,
      debtorName: debts[index].debtorName,
      amount: Number(debts[index].amount) || 0,
      outstandingStatus: debts[index].outstandingStatus || "confirmed",
      outstandingAmount: debts[index].outstandingStatus === "unconfirmed" ? null : Number(debts[index].outstandingAmount) || 0,
      debtType: debts[index].debtType || "single",
      dueDateMode: debts[index].dueDateMode || (debts[index].dueDate ? "date" : "none"),
      dueDate: debts[index].dueDate || null,
      installmentPlan: debts[index].installmentPlan || null,
      terms: agreement.snapshot.terms,
      note: debts[index].note || "",
    })),
  };
});

exports.acceptDebtInvite = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "acceptDebtInvite", 20, 60 * 60 * 1000);
  const inviteCode = String(request.data?.inviteCode || "").trim();
  const consentConfirmed = request.data?.consentConfirmed === true;
  const expectedSetDigest = String(request.data?.agreementSetDigest || "");
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(inviteCode)) throw new HttpsError("invalid-argument", "ลิงก์เชิญไม่ถูกต้อง");
  if (!consentConfirmed || !/^[a-f0-9]{64}$/.test(expectedSetDigest)) throw new HttpsError("failed-precondition", "กรุณาตรวจสอบและยอมรับข้อตกลงฉบับล่าสุด");
  const codeRef = db.ref(`debtInviteCodes/${inviteCode}`);
  const receiptRef = db.ref(`debtInviteAcceptances/${inviteCode}`);
  const existingReceipt = (await receiptRef.once("value")).val();
  if (existingReceipt?.debtorUid === user.uid && Array.isArray(existingReceipt.debtIds) && existingReceipt.debtIds.length) {
    return { debtId: existingReceipt.debtIds[0], debtIds: existingReceipt.debtIds, alreadyAccepted: true };
  }
  const initialInvitationSnapshot = await codeRef.once("value");
  if (!initialInvitationSnapshot.exists()) throw new HttpsError("not-found", "ลิงก์เชิญหมดอายุหรือถูกใช้แล้ว");

  const claimRef = db.ref(`debtInviteClaims/${inviteCode}`);
  const claimStartedAt = new Date().toISOString();
  const claimResult = await claimRef.transaction((current) => {
    const claimedAtMs = Date.parse(current?.claimedAt || "");
    const claimIsFresh = Number.isFinite(claimedAtMs) && Date.now() - claimedAtMs < 5 * 60 * 1000;
    if (current?.uid && current.uid !== user.uid && claimIsFresh) return;
    return { uid: user.uid, claimedAt: current?.uid === user.uid ? current.claimedAt || claimStartedAt : claimStartedAt };
  });
  if (!claimResult.committed || claimResult.snapshot.child("uid").val() !== user.uid) throw new HttpsError("already-exists", "มีผู้ใช้อื่นกำลังยืนยันลิงก์นี้ กรุณาลองใหม่อีกครั้ง");

  try {
    const latestInvitationSnapshot = await codeRef.once("value");
    if (!latestInvitationSnapshot.exists()) throw new HttpsError("not-found", "ลิงก์เชิญหมดอายุหรือถูกใช้แล้ว");
    const rawInvitation = latestInvitationSnapshot.val();
    const invitation = typeof rawInvitation === "string" ? { kind: "single", debtIds: [rawInvitation] } : rawInvitation;
    if ((invitation.claimedBy && invitation.claimedBy !== user.uid) || invitation.declinedBy) throw new HttpsError("already-exists", "รายการนี้มีผู้ยืนยันแล้ว");
    const debtIds = (Array.isArray(invitation.debtIds) ? invitation.debtIds : Object.values(invitation.debtIds || {})).filter(validDebtId).slice(0, 100);
    if (!debtIds.length) throw new HttpsError("not-found", "ไม่พบรายการหนี้ในคำเชิญ");

    const debtSnapshots = await Promise.all(debtIds.map((debtId) => db.ref(`debts/${debtId}`).once("value")));
    const debts = debtSnapshots.map((snapshot) => snapshot.val());
    if (debts.some((debt) => !debt)) throw new HttpsError("not-found", "พบรายการหนี้ไม่ครบถ้วน");
    if (debts.some((debt) => debt.creditorUid === user.uid)) throw new HttpsError("failed-precondition", "เจ้าหนี้ไม่สามารถรับคำเชิญของตัวเองได้");
    if (debts.some((debt) => debt.debtorUid && debt.debtorUid !== user.uid)) throw new HttpsError("already-exists", "บางรายการมีผู้ยืนยันแล้ว");

    const agreementRecords = debts.map((debt, index) => {
      const version = Math.max(1, Number(debt.agreementVersion) || 1);
      const agreement = agreementVersionRecord(debt, version, {}, debt.createdAt || new Date().toISOString());
      return { debtId: debtIds[index], digest: agreement.digest, agreement };
    });
    if (agreementSetDigest(agreementRecords) !== expectedSetDigest) throw new HttpsError("aborted", "ข้อตกลงมีการเปลี่ยนแปลง กรุณาเปิดตรวจสอบอีกครั้ง");

    const now = new Date().toISOString();
    const memberUpdates = {
      [`debtInviteCodes/${inviteCode}`]: null,
      [`debtInviteClaims/${inviteCode}`]: null,
      [`debtInviteAcceptances/${inviteCode}`]: { debtorUid: user.uid, debtIds, acceptedAt: now },
    };
    debtIds.forEach((debtId, index) => {
      const debt = debts[index];
      const agreement = agreementRecords[index].agreement;
      const versionKey = `v_${String(agreement.version).padStart(3, "0")}`;
      memberUpdates[`debts/${debtId}/debtorUid`] = user.uid;
      memberUpdates[`debts/${debtId}/debtorName`] = debt.debtorName || user.name;
      memberUpdates[`debts/${debtId}/debtorEmail`] = user.email;
      memberUpdates[`debts/${debtId}/status`] = debt.outstandingStatus === "unconfirmed" ? "unconfirmed" : Number(debt.outstandingAmount) > 0 ? "active" : "paid";
      memberUpdates[`debts/${debtId}/agreementVersion`] = agreement.version;
      memberUpdates[`debts/${debtId}/agreementDigest`] = agreement.digest;
      memberUpdates[`debts/${debtId}/agreementStatus`] = "accepted";
      memberUpdates[`debts/${debtId}/acceptedAt`] = debt.acceptedAt || now;
      memberUpdates[`debts/${debtId}/updatedAt`] = now;
      memberUpdates[`debtAgreementVersions/${debtId}/${versionKey}/version`] = agreement.version;
      memberUpdates[`debtAgreementVersions/${debtId}/${versionKey}/digest`] = agreement.digest;
      memberUpdates[`debtAgreementVersions/${debtId}/${versionKey}/snapshot`] = agreement.snapshot;
      memberUpdates[`debtAgreementVersions/${debtId}/${versionKey}/createdAt`] = agreement.createdAt;
      memberUpdates[`debtAgreementVersions/${debtId}/${versionKey}/acceptances/${user.uid}`] = debtAcceptance(user, agreement.digest, now, "debtor_invite_acceptance");
      memberUpdates[`debtMembers/${user.uid}/${debtId}`] = true;
      addDebtAudit(memberUpdates, debtId, "invite_accepted", user, { agreementVersion: agreement.version, agreementDigest: agreement.digest });
      addDebtNotification(memberUpdates, debt.creditorUid, debtId, "invite_accepted", "ลูกหนี้ยืนยันรายการแล้ว", `${user.name} ยืนยันรายการ ${debt.title}`);
    });
    await db.ref().update(memberUpdates);
    return { debtId: debtIds[0], debtIds };
  } catch (error) {
    const claimSnapshot = await claimRef.once("value");
    if (claimSnapshot.child("uid").val() === user.uid) await claimRef.remove();
    throw error;
  }
});

exports.acceptDebtAgreement = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "acceptDebtAgreement", 30, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId) || request.data?.consentConfirmed !== true) throw new HttpsError("failed-precondition", "กรุณาอ่านและยอมรับข้อตกลง");
  const debt = await requiredDebtForUser(debtId, user);
  if (!debt.debtorUid) throw new HttpsError("failed-precondition", "ยังไม่มีลูกหนี้เข้าร่วมรายการ");
  if (String(request.data?.expectedUpdatedAt || "") !== String(debt.updatedAt || "")) throw new HttpsError("aborted", "รายการเพิ่งมีการเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง");
  const version = Math.max(1, Number(debt.agreementVersion) || 1);
  const versionKey = `v_${String(version).padStart(3, "0")}`;
  const existingSnapshot = await db.ref(`debtAgreementVersions/${debtId}/${versionKey}`).once("value");
  const existing = existingSnapshot.val();
  const agreement = existing?.snapshot && existing?.digest ? existing : agreementVersionRecord(debt, version, {}, debt.createdAt || new Date().toISOString());
  const now = new Date().toISOString();
  const updates = {
    [`debtAgreementVersions/${debtId}/${versionKey}/version`]: version,
    [`debtAgreementVersions/${debtId}/${versionKey}/digest`]: agreement.digest,
    [`debtAgreementVersions/${debtId}/${versionKey}/snapshot`]: agreement.snapshot,
    [`debtAgreementVersions/${debtId}/${versionKey}/createdAt`]: agreement.createdAt || now,
    [`debtAgreementVersions/${debtId}/${versionKey}/acceptances/${user.uid}`]: debtAcceptance(user, agreement.digest, now, "in_app_explicit_acceptance"),
    [`debts/${debtId}/agreementVersion`]: version,
    [`debts/${debtId}/agreementDigest`]: agreement.digest,
  };
  const acceptanceSnapshot = await db.ref(`debtAgreementVersions/${debtId}/${versionKey}/acceptances`).once("value");
  const acceptedUids = new Set([...Object.keys(acceptanceSnapshot.val() || {}), user.uid]);
  const fullyAccepted = acceptedUids.has(debt.creditorUid) && acceptedUids.has(debt.debtorUid);
  const acceptingDirectInvite = debt.inviteDelivery === "direct" && debt.directInviteStatus === "pending" && debt.status === "pending" && debt.debtorUid === user.uid;
  updates[`debts/${debtId}/agreementStatus`] = fullyAccepted ? "accepted" : "pending_signatures";
  if (acceptingDirectInvite) {
    updates[`debts/${debtId}/status`] = debt.outstandingStatus === "unconfirmed" ? "unconfirmed" : Number(debt.outstandingAmount) > 0 ? "active" : "paid";
    updates[`debts/${debtId}/directInviteStatus`] = "accepted";
    updates[`debts/${debtId}/acceptedAt`] = now;
    updates[`debts/${debtId}/updatedAt`] = now;
  }
  addDebtAudit(updates, debtId, acceptingDirectInvite ? "direct_invite_accepted" : "agreement_accepted", user, { version, digest: agreement.digest });
  addDebtNotification(updates, otherDebtUid(debt, user.uid), debtId, acceptingDirectInvite ? "direct_invite_accepted" : "agreement_accepted", acceptingDirectInvite ? "ลูกหนี้ยืนยันรายการแล้ว" : "อีกฝ่ายยืนยันข้อตกลงแล้ว", `${user.name} ยืนยัน${acceptingDirectInvite ? `รายการ ${debt.title}` : `ข้อตกลงเวอร์ชัน ${version}`}`);
  await db.ref().update(updates);
  return { accepted: true, directInviteAccepted: acceptingDirectInvite, version, digest: agreement.digest, fullyAccepted };
});

exports.declineDirectDebtInvite = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "declineDirectDebtInvite", 20, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const reason = String(request.data?.reason || "").trim().slice(0, 500);
  if (!validDebtId(debtId) || !reason) throw new HttpsError("invalid-argument", "กรุณาระบุเหตุผลที่ไม่ยืนยันรายการ");
  const debt = await requiredDebtForUser(debtId, user);
  if (debt.debtorUid !== user.uid || debt.inviteDelivery !== "direct") throw new HttpsError("permission-denied", "เฉพาะลูกหนี้ที่ได้รับคำขอโดยตรงเท่านั้นที่ปฏิเสธได้");
  if (debt.status !== "pending" || debt.directInviteStatus !== "pending") throw new HttpsError("failed-precondition", "คำขอนี้ถูกดำเนินการแล้ว");
  const now = new Date().toISOString();
  const updates = {
    [`debts/${debtId}/status`]: "declined",
    [`debts/${debtId}/agreementStatus`]: "declined",
    [`debts/${debtId}/directInviteStatus`]: "declined",
    [`debts/${debtId}/declinedAt`]: now,
    [`debts/${debtId}/declineReason`]: reason,
    [`debts/${debtId}/updatedAt`]: now,
  };
  addDebtAudit(updates, debtId, "direct_invite_declined", user, { reason });
  addDebtNotification(updates, debt.creditorUid, debtId, "direct_invite_declined", "ลูกหนี้ไม่ยืนยันรายการ", `${user.name}: ${reason}`);
  await db.ref().update(updates);
  return { declined: true };
});

exports.setDebtOutstandingAmount = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "setDebtOutstandingAmount", 20, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const amount = Math.round(Number(request.data?.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
    throw new HttpsError("invalid-argument", "ยอดค้างชำระต้องอยู่ระหว่าง 0–100,000,000 บาท");
  }
  const now = new Date().toISOString();
  const debtRef = db.ref(`debts/${debtId}`);
  const snapshot = await debtRef.once("value");
  const debt = snapshot.val();
  if (!debt) throw new HttpsError("not-found", "ไม่พบรายการหนี้");
  if (debt.creditorUid !== user.uid) {
    throw new HttpsError("permission-denied", "เฉพาะเจ้าหนี้ของรายการนี้เท่านั้นที่กำหนดยอดค้างได้");
  }
  if (debt.outstandingStatus !== "unconfirmed") {
    return { outstandingAmount: Number(debt.outstandingAmount) || 0, status: debt.status, alreadyConfirmed: true };
  }
  if (debt.debtorUid) return createDebtConsentRequest(debtId, debt, user, "outstanding_confirm", { amount });
  const status = debt.debtorUid ? (amount > 0 ? "active" : "paid") : "pending";
  const updates = {
    [`debts/${debtId}/outstandingAmount`]: amount,
    [`debts/${debtId}/outstandingStatus`]: "confirmed",
    [`debts/${debtId}/status`]: status,
    [`debts/${debtId}/paidAt`]: amount <= 0 ? now : null,
    [`debts/${debtId}/outstandingConfirmedAt`]: now,
    [`debts/${debtId}/outstandingConfirmedBy`]: user.uid,
    [`debts/${debtId}/updatedAt`]: now,
  };
  addDebtAudit(updates, debtId, "outstanding_confirmed", user, { amount });
  addDebtNotification(updates, debt.debtorUid, debtId, "debt_updated", "เจ้าหนี้ยืนยันยอดค้างแล้ว", `${debt.title} มียอดค้าง ฿${amount.toLocaleString("th-TH")}`);
  await db.ref().update(updates);
  return { outstandingAmount: amount, status };
});

exports.submitDebtPayment = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "submitDebtPayment", 30, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const amount = cleanDebtAmount(request.data?.amount, "ยอดชำระ");
  const note = String(request.data?.note || "").trim().slice(0, 300);
  const paymentDate = validDebtDate(request.data?.paymentDate) ? String(request.data.paymentDate) : new Date().toISOString().slice(0, 10);
  const targetInstallmentId = String(request.data?.installmentId || "");
  const proof = request.data?.proof && typeof request.data.proof === "object" ? request.data.proof : null;
  const debtSnapshot = await db.ref(`debts/${debtId}`).once("value");
  const debt = debtSnapshot.val();
  if (!debt || debt.debtorUid !== user.uid) throw new HttpsError("permission-denied", "เฉพาะลูกหนี้ในรายการเท่านั้นที่แจ้งชำระได้");
  if (debt.status !== "active" || Number(debt.outstandingAmount) <= 0) throw new HttpsError("failed-precondition", "รายการนี้ไม่มียอดที่ต้องชำระแล้ว");
  const terms = normalizeDebtTerms(debt.terms);
  if (amount > Number(debt.outstandingAmount) && terms.overpaymentPolicy === "reject") throw new HttpsError("invalid-argument", "ข้อตกลงไม่รับยอดชำระเกินยอดคงเหลือ");
  if (targetInstallmentId && terms.paymentAllocation === "oldest_first") {
    throw new HttpsError("failed-precondition", "ข้อตกลงกำหนดให้ตัดชำระจากงวดเก่าสุดก่อน");
  }
  if (targetInstallmentId) {
    const installment = debt.installments?.[targetInstallmentId];
    if (!installment || installment.status === "paid") throw new HttpsError("invalid-argument", "งวดที่เลือกไม่สามารถชำระได้");
    const installmentRemaining = Math.max(0, Number(installment.amount) - Number(installment.paidAmount || 0));
    if (amount > installmentRemaining) throw new HttpsError("invalid-argument", "ยอดชำระมากกว่ายอดคงเหลือของงวดที่เลือก");
    if (!terms.allowPartialPayments && amount !== installmentRemaining) throw new HttpsError("failed-precondition", "ข้อตกลงกำหนดให้ชำระเต็มจำนวนของงวด");
    if (!terms.allowEarlyPayment && validDebtDate(installment.dueDate) && installment.dueDate > paymentDate) throw new HttpsError("failed-precondition", "ข้อตกลงไม่อนุญาตให้ชำระงวดก่อนกำหนด");
  } else if (!terms.allowPartialPayments) {
    const oldestInstallment = Object.values(debt.installments || {}).sort((a, b) => Number(a.sequence) - Number(b.sequence)).find((item) => item.status !== "paid");
    const requiredAmount = oldestInstallment ? Math.max(0, Math.round((Number(oldestInstallment.amount) - Number(oldestInstallment.paidAmount || 0)) * 100) / 100) : Number(debt.outstandingAmount);
    if (amount !== requiredAmount) throw new HttpsError("failed-precondition", oldestInstallment ? "ข้อตกลงกำหนดให้ชำระเต็มจำนวนของงวดเก่าสุด" : "ข้อตกลงกำหนดให้ชำระเต็มยอดคงเหลือ");
  }
  if (!targetInstallmentId && !terms.allowEarlyPayment && debt.installments) {
    const oldestInstallment = Object.values(debt.installments).sort((a, b) => Number(a.sequence) - Number(b.sequence)).find((item) => item.status !== "paid");
    if (oldestInstallment && validDebtDate(oldestInstallment.dueDate) && oldestInstallment.dueDate > paymentDate) throw new HttpsError("failed-precondition", "ข้อตกลงไม่อนุญาตให้ชำระงวดก่อนกำหนด");
  }
  let cleanProof = null;
  if (proof) {
    const path = String(proof.path || "");
    const expectedPrefix = `debtReceipts/${debtId}/${debt.creditorUid}/${debt.debtorUid}/${user.uid}/`;
    const contentType = String(proof.contentType || "");
    const size = Number(proof.size) || 0;
    if (!path.startsWith(expectedPrefix) || !/^image\/(jpeg|png|webp)$/.test(contentType) || size <= 0 || size > 5 * 1024 * 1024) {
      throw new HttpsError("invalid-argument", "หลักฐานการชำระไม่ถูกต้อง");
    }
    cleanProof = { path, contentType, size, name: String(proof.name || "หลักฐานการชำระ").slice(0, 160) };
  }

  const paymentRef = db.ref(`debtPayments/${debtId}`).push();
  const now = new Date().toISOString();
  const payment = {
    amount,
    note,
    paymentDate,
    ...(targetInstallmentId ? { targetInstallmentId } : {}),
    ...(cleanProof ? { proof: cleanProof } : {}),
    status: "pending",
    reviewDueAt: new Date(Date.now() + terms.paymentReviewDays * 86400000).toISOString(),
    agreementVersion: Number(debt.agreementVersion) || 1,
    agreementDigest: debt.agreementDigest || "",
    submittedBy: user.uid,
    submittedByName: user.name,
    createdAt: now,
    updatedAt: now,
  };
  const updates = { [`debtPayments/${debtId}/${paymentRef.key}`]: payment };
  addDebtAudit(updates, debtId, "payment_submitted", user, { paymentId: paymentRef.key, amount, paymentDate, targetInstallmentId: targetInstallmentId || null, hasProof: Boolean(cleanProof) });
  addDebtNotification(updates, debt.creditorUid, debtId, "payment_submitted", "มีการแจ้งชำระใหม่", `${user.name} แจ้งชำระ ${debt.title} จำนวน ฿${amount.toLocaleString("th-TH")}`);
  await db.ref().update(updates);
  return { paymentId: paymentRef.key };
});

exports.confirmDebtPayment = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "confirmDebtPayment", 60, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const paymentId = String(request.data?.paymentId || "");
  if (!validDebtId(debtId) || !validDebtId(paymentId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");

  const debtRef = db.ref(`debts/${debtId}`);
  const debtSnapshot = await debtRef.once("value");
  const debt = debtSnapshot.val();
  if (!debt || debt.creditorUid !== user.uid) throw new HttpsError("permission-denied", "เฉพาะเจ้าหนี้เท่านั้นที่ยืนยันการรับเงินได้");
  const terms = normalizeDebtTerms(debt.terms);

  const paymentRef = db.ref(`debtPayments/${debtId}/${paymentId}`);
  const paymentSnapshot = await paymentRef.once("value");
  const payment = paymentSnapshot.val();
  if (!payment) throw new HttpsError("not-found", "ไม่พบรายการชำระ");
  if (payment.status === "rejected") throw new HttpsError("failed-precondition", "รายการชำระนี้ถูกปฏิเสธแล้ว");
  if (!["pending", "processing", "confirmed"].includes(payment.status)) throw new HttpsError("failed-precondition", "สถานะการชำระไม่ถูกต้อง");

  const now = new Date().toISOString();
  await paymentRef.transaction((current) => {
    // RTDB can invoke a transaction with an empty local cache on a cold
    // Functions instance. The payment was just read and authorized above, so
    // use that snapshot for the first attempt instead of aborting it as absent.
    const currentPayment = current || payment;
    if (currentPayment.status === "rejected" || currentPayment.status === "confirmed") return currentPayment;
    if (currentPayment.status === "processing" && currentPayment.processedBy !== user.uid) return currentPayment;
    return { ...currentPayment, status: "processing", processedBy: user.uid, updatedAt: now };
  });

  let appliedAmount = 0;
  let allocations = {};
  const debtResult = await debtRef.transaction((current) => {
    // As above, keep the transaction alive when its first local view is empty.
    // The server will compare this snapshot and retry with newer data if the
    // debt changed after the authorization read.
    const currentDebt = current || debt;
    if (currentDebt.creditorUid !== user.uid) return;
    const appliedPayments = currentDebt.appliedPayments || {};
    if (appliedPayments[paymentId]) {
      appliedAmount = Number(appliedPayments[paymentId].amount) || 0;
      allocations = appliedPayments[paymentId].allocations || {};
      return currentDebt;
    }
    const outstanding = Math.max(0, Number(currentDebt.outstandingAmount) || 0);
    appliedAmount = Math.min(outstanding, Number(payment.amount) || 0);
    const excessAmount = Math.max(0, Math.round((Number(payment.amount || 0) - appliedAmount) * 100) / 100);
    const nextOutstanding = Math.round((outstanding - appliedAmount) * 100) / 100;
    let nextInstallments = currentDebt.installments || null;
    let nextInstallmentPlan = currentDebt.installmentPlan || null;
    if (nextInstallments && nextInstallmentPlan) {
      nextInstallments = JSON.parse(JSON.stringify(nextInstallments));
      let unallocated = appliedAmount;
      allocations = {};
      const allEntries = Object.entries(nextInstallments).sort(([, a], [, b]) => Number(a.sequence) - Number(b.sequence));
      const orderedEntries = payment.targetInstallmentId && nextInstallments[payment.targetInstallmentId]
        ? allEntries.filter(([id]) => id === payment.targetInstallmentId)
        : allEntries;
      for (const [installmentId, installment] of orderedEntries) {
        if (unallocated <= 0) break;
        const remaining = Math.max(0, Math.round((Number(installment.amount) - Number(installment.paidAmount || 0)) * 100) / 100);
        if (remaining <= 0) continue;
        const allocation = Math.min(remaining, unallocated);
        installment.paidAmount = Math.round((Number(installment.paidAmount || 0) + allocation) * 100) / 100;
        allocations[installmentId] = allocation;
        unallocated = Math.round((unallocated - allocation) * 100) / 100;
        installment.status = installment.paidAmount >= Number(installment.amount) ? "paid" : "partial";
        installment.lastPaymentId = paymentId;
        if (installment.status === "paid") installment.paidAt = now;
      }
      const ordered = allEntries.map(([, installment]) => installment);
      nextInstallmentPlan = {
        ...nextInstallmentPlan,
        paidInstallments: ordered.filter((installment) => installment.status === "paid").length,
        nextInstallmentDueDate: ordered.find((installment) => installment.status !== "paid")?.dueDate || null,
      };
    }
    return {
      ...currentDebt,
      outstandingAmount: nextOutstanding,
      status: nextOutstanding <= 0 ? "paid" : "active",
      dueDate: nextInstallmentPlan?.nextInstallmentDueDate || currentDebt.dueDate,
      ...(nextInstallments ? { installments: nextInstallments, installmentPlan: nextInstallmentPlan } : {}),
      paidAt: nextOutstanding <= 0 ? now : currentDebt.paidAt || null,
      updatedAt: now,
      appliedPayments: {
        ...appliedPayments,
        [paymentId]: { amount: appliedAmount, excessAmount, allocations, confirmedAt: now, confirmedBy: user.uid },
      },
      ...(excessAmount > 0 && terms.overpaymentPolicy === "credit" ? { creditBalance: Math.round((Number(currentDebt.creditBalance || 0) + excessAmount) * 100) / 100 } : {}),
      ...(excessAmount > 0 && terms.overpaymentPolicy === "refund" ? { refundDue: Math.round((Number(currentDebt.refundDue || 0) + excessAmount) * 100) / 100 } : {}),
    };
  });
  if (!debtResult.committed) {
    await paymentRef.update({ status: "pending", processedBy: null, updatedAt: now });
    throw new HttpsError("aborted", "ยืนยันยอดไม่สำเร็จ กรุณาลองใหม่");
  }
  const confirmUpdates = {
    [`debtPayments/${debtId}/${paymentId}/status`]: "confirmed",
    [`debtPayments/${debtId}/${paymentId}/appliedAmount`]: appliedAmount,
    [`debtPayments/${debtId}/${paymentId}/excessAmount`]: Math.max(0, Math.round((Number(payment.amount || 0) - appliedAmount) * 100) / 100),
    [`debtPayments/${debtId}/${paymentId}/excessDisposition`]: Number(payment.amount || 0) > appliedAmount ? terms.overpaymentPolicy : "none",
    [`debtPayments/${debtId}/${paymentId}/allocations`]: allocations,
    [`debtPayments/${debtId}/${paymentId}/confirmedAt`]: now,
    [`debtPayments/${debtId}/${paymentId}/confirmedBy`]: user.uid,
    [`debtPayments/${debtId}/${paymentId}/updatedAt`]: now,
  };
  addDebtAudit(confirmUpdates, debtId, "payment_confirmed", user, { paymentId, amount: appliedAmount, allocations });
  addDebtNotification(confirmUpdates, debt.debtorUid, debtId, "payment_confirmed", "ยืนยันการชำระแล้ว", `${debt.title} ยืนยันรับเงิน ฿${appliedAmount.toLocaleString("th-TH")}`);
  if (Number(debtResult.snapshot.child("outstandingAmount").val()) <= 0) {
    const closure = stableDebtValue({
      debtId,
      title: debt.title,
      creditorUid: debt.creditorUid,
      debtorUid: debt.debtorUid,
      originalAmount: Number(debt.amount) || 0,
      outstandingAmount: 0,
      agreementVersion: Number(debtResult.snapshot.child("agreementVersion").val()) || 1,
      agreementDigest: debtResult.snapshot.child("agreementDigest").val() || "",
      finalPaymentId: paymentId,
      closedAt: now,
      closedBy: user.uid,
    });
    confirmUpdates[`debtClosures/${debtId}`] = { ...closure, digest: debtAgreementDigest(closure) };
  }
  await db.ref().update(confirmUpdates);
  return { appliedAmount, outstandingAmount: debtResult.snapshot.child("outstandingAmount").val() };
});

exports.rejectDebtPayment = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "rejectDebtPayment", 60, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const paymentId = String(request.data?.paymentId || "");
  if (!validDebtId(debtId) || !validDebtId(paymentId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const debtSnapshot = await db.ref(`debts/${debtId}`).once("value");
  if (!debtSnapshot.exists() || debtSnapshot.child("creditorUid").val() !== user.uid) {
    throw new HttpsError("permission-denied", "เฉพาะเจ้าหนี้เท่านั้นที่ตรวจสอบการชำระได้");
  }
  const now = new Date().toISOString();
  const result = await db.ref(`debtPayments/${debtId}/${paymentId}`).transaction((payment) => {
    if (!payment || payment.status !== "pending") return;
    return { ...payment, status: "rejected", rejectedAt: now, rejectedBy: user.uid, updatedAt: now };
  });
  if (!result.committed) throw new HttpsError("failed-precondition", "รายการนี้ถูกตรวจสอบไปแล้ว");
  const debt = debtSnapshot.val();
  const rejectUpdates = {};
  addDebtAudit(rejectUpdates, debtId, "payment_rejected", user, { paymentId });
  addDebtNotification(rejectUpdates, debt.debtorUid, debtId, "payment_rejected", "รายการชำระไม่ผ่าน", `${debt.title} ถูกปฏิเสธการแจ้งชำระ กรุณาตรวจสอบอีกครั้ง`);
  await db.ref().update(rejectUpdates);
  return { rejected: true };
});

function buildDebtUpdatePatch(debt, rawChanges) {
  const changes = rawChanges && typeof rawChanges === "object" ? rawChanges : {};
  const title = String(changes.title ?? debt.title ?? "").trim().slice(0, 160);
  const debtorName = String(changes.debtorName ?? debt.debtorName ?? "").trim().slice(0, 120);
  const note = String(changes.note ?? debt.note ?? "").trim().slice(0, 1000);
  const amount = cleanDebtAmount(changes.amount ?? debt.amount);
  const terms = normalizeDebtTerms(changes.terms, debt.terms);
  if (!title || !debtorName) throw new HttpsError("invalid-argument", "ชื่อรายการและชื่อลูกหนี้ต้องไม่ว่าง");
  const now = new Date().toISOString();
  const patch = { title, debtorName, note, amount, terms, updatedAt: now };

  if (debt.debtType === "installment") {
    const currentPlan = debt.installmentPlan || {};
    const totalInstallments = Math.floor(Number(changes.totalInstallments ?? currentPlan.totalInstallments));
    const paidInstallments = Math.floor(Number(changes.paidInstallments ?? currentPlan.paidInstallments ?? 0));
    const monthlyAmount = cleanDebtAmount(changes.monthlyAmount ?? currentPlan.monthlyAmount, "ยอดต่องวด");
    const firstDueDate = String(changes.firstDueDate ?? currentPlan.firstDueDate ?? debt.dueDate ?? "");
    if (!Number.isInteger(totalInstallments) || totalInstallments < 2 || totalInstallments > 120) throw new HttpsError("invalid-argument", "จำนวนงวดต้องอยู่ระหว่าง 2–120 งวด");
    if (!Number.isInteger(paidInstallments) || paidInstallments < 0 || paidInstallments >= totalInstallments) throw new HttpsError("invalid-argument", "จำนวนงวดที่ชำระแล้วไม่ถูกต้อง");
    if (!validDebtDate(firstDueDate)) throw new HttpsError("invalid-argument", "วันครบกำหนดงวดถัดไปไม่ถูกต้อง");
    const finalAmount = Math.round((amount - monthlyAmount * (totalInstallments - 1)) * 100) / 100;
    if (finalAmount <= 0 || finalAmount > monthlyAmount * 2) throw new HttpsError("invalid-argument", "ยอดรวม จำนวนงวด และยอดต่องวดไม่สอดคล้องกัน");
    const structuralChanged = amount !== Number(debt.amount) || totalInstallments !== Number(currentPlan.totalInstallments) ||
      paidInstallments !== Number(currentPlan.paidInstallments) || monthlyAmount !== Number(currentPlan.monthlyAmount) || firstDueDate !== currentPlan.firstDueDate;
    if (firstDueDate !== currentPlan.firstDueDate && !terms.allowDueDateChange) throw new HttpsError("failed-precondition", "ข้อตกลงปัจจุบันไม่อนุญาตให้ขอเปลี่ยนวันชำระ");
    const hasAppliedPayments = Object.values(debt.appliedPayments || {}).some((item) => !item?.reversedAt);
    if (structuralChanged && hasAppliedPayments) throw new HttpsError("failed-precondition", "แผนผ่อนที่มีการยืนยันชำระแล้วไม่สามารถเปลี่ยนโครงสร้างได้");
    if (structuralChanged) {
      const installments = buildDebtInstallments({ amount, monthlyAmount, totalInstallments, paidInstallments, firstDueDate });
      const outstandingAmount = Math.round(Object.values(installments).filter((item) => item.status !== "paid").reduce((sum, item) => sum + Number(item.amount), 0) * 100) / 100;
      const nextInstallmentDueDate = Object.values(installments).find((item) => item.status !== "paid")?.dueDate || null;
      Object.assign(patch, {
        installments,
        installmentPlan: { totalInstallments, paidInstallments, monthlyAmount, firstDueDate, nextInstallmentDueDate },
        outstandingAmount,
        dueDate: nextInstallmentDueDate,
        status: debt.debtorUid ? (outstandingAmount > 0 ? "active" : "paid") : "pending",
      });
    }
  } else if (debt.outstandingStatus !== "unconfirmed") {
    const dueDateMode = changes.noDueDate === true || changes.dueDateMode === "none" || (Object.hasOwn(changes, "dueDate") && !changes.dueDate)
      ? "none"
      : "date";
    const dueDate = dueDateMode === "none" ? null : String(changes.dueDate ?? debt.dueDate ?? "");
    const dueDateChanged = dueDateMode !== (debt.dueDateMode || (debt.dueDate ? "date" : "none")) || String(dueDate || "") !== String(debt.dueDate || "");
    if (dueDateChanged && !terms.allowDueDateChange) throw new HttpsError("failed-precondition", "ข้อตกลงปัจจุบันไม่อนุญาตให้ขอเปลี่ยนวันชำระ");
    if (dueDateMode === "date" && !validDebtDate(dueDate)) throw new HttpsError("invalid-argument", "วันครบกำหนดไม่ถูกต้อง");
    const outstandingAmount = Math.round(Number(changes.outstandingAmount ?? debt.outstandingAmount) * 100) / 100;
    if (!Number.isFinite(outstandingAmount) || outstandingAmount < 0 || outstandingAmount > amount) throw new HttpsError("invalid-argument", "ยอดค้างชำระต้องไม่เกินยอดตั้งต้น");
    Object.assign(patch, {
      dueDate,
      dueDateMode,
      outstandingAmount,
      status: debt.debtorUid ? (outstandingAmount > 0 ? "active" : "paid") : "pending",
    });
  }
  return patch;
}

exports.requestDebtUpdate = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "requestDebtUpdate", 30, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const debt = await requiredDebtForUser(debtId, user);
  if (["paid", "cancelled", "declined", "disputed"].includes(debt.status)) throw new HttpsError("failed-precondition", "รายการนี้ไม่สามารถแก้ไขได้ กรุณาย้อนการชำระหรือยุติข้อโต้แย้งก่อน");
  const proposed = buildDebtUpdatePatch(debt, request.data?.changes);
  const now = new Date().toISOString();
  const otherUid = otherDebtUid(debt, user.uid);
  const updates = {};
  if (!debt.debtorUid) {
    Object.entries(proposed).forEach(([key, value]) => { updates[`debts/${debtId}/${key}`] = value; });
    const nextDebt = { ...debt, ...proposed };
    if (proposed.dueDateMode === "none") delete nextDebt.dueDate;
    const version = Math.max(1, Number(debt.agreementVersion) || 1) + 1;
    const agreement = agreementVersionRecord(nextDebt, version, {}, now);
    agreement.acceptances[user.uid] = debtAcceptance(user, agreement.digest, now, "creditor_updated_before_acceptance");
    updates[`debts/${debtId}/agreementVersion`] = version;
    updates[`debts/${debtId}/agreementDigest`] = agreement.digest;
    updates[`debts/${debtId}/agreementStatus`] = "awaiting_debtor";
    updates[`debtAgreementVersions/${debtId}/v_${String(version).padStart(3, "0")}`] = agreement;
    addDebtAudit(updates, debtId, "debt_updated", user, { mode: "direct", fields: Object.keys(proposed), agreementVersion: version, agreementDigest: agreement.digest });
    await db.ref().update(updates);
    return { applied: true };
  }
  const requestId = db.ref(`debtChangeRequests/${debtId}`).push().key;
  updates[`debtChangeRequests/${debtId}/${requestId}`] = {
    status: "pending",
    requestedBy: user.uid,
    requestedByName: user.name,
    requestedByEmail: user.email,
    requestedByAuthProvider: user.authProvider,
    approverUid: otherUid,
    proposed,
    baseUpdatedAt: debt.updatedAt || "",
    createdAt: now,
    updatedAt: now,
  };
  addDebtAudit(updates, debtId, "debt_update_requested", user, { requestId, fields: Object.keys(proposed) });
  addDebtNotification(updates, otherUid, debtId, "change_requested", "มีคำขอแก้ไขรายการ", `${user.name} ขอแก้ไข ${debt.title}`);
  await db.ref().update(updates);
  return { applied: false, requestId };
});

exports.requestDebtPaymentPlan = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "requestDebtPaymentPlan", 20, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const debt = await requiredDebtForUser(debtId, user);
  if (debt.debtorUid !== user.uid) throw new HttpsError("permission-denied", "เฉพาะลูกหนี้เท่านั้นที่เสนอแผนชำระได้");
  if (debt.status !== "active" || debt.outstandingStatus === "unconfirmed" || Number(debt.outstandingAmount) <= 0) {
    throw new HttpsError("failed-precondition", "รายการนี้ยังไม่พร้อมกำหนดแผนชำระ");
  }

  const requestedAmount = cleanDebtAmount(request.data?.amount, "ยอดที่เสนอชำระ");
  const paymentDate = String(request.data?.paymentDate || "");
  const nextDueDate = String(request.data?.nextDueDate || "");
  const note = String(request.data?.note || "").trim().slice(0, 500);
  const today = new Date().toISOString().slice(0, 10);
  if (!validDebtDate(paymentDate) || paymentDate < today) throw new HttpsError("invalid-argument", "วันที่เสนอชำระต้องเป็นวันนี้หรือวันข้างหน้า");

  const now = new Date().toISOString();
  let currentDueAmount = Number(debt.outstandingAmount);
  let rolledAmount = 0;
  let proposed;

  if (debt.installments && Object.keys(debt.installments).length) {
    const installments = JSON.parse(JSON.stringify(debt.installments));
    const orderedEntries = Object.entries(installments).sort(([, a], [, b]) => Number(a.sequence) - Number(b.sequence));
    const targetIndex = orderedEntries.findIndex(([, item]) => item.status !== "paid" && Number(item.amount) > Number(item.paidAmount || 0));
    if (targetIndex < 0) throw new HttpsError("failed-precondition", "ไม่พบงวดที่ยังค้างชำระ");
    const [, target] = orderedEntries[targetIndex];
    const paidAmount = Math.max(0, Number(target.paidAmount || 0));
    currentDueAmount = Math.round((Number(target.amount) - paidAmount) * 100) / 100;
    if (requestedAmount > currentDueAmount) throw new HttpsError("invalid-argument", "ยอดที่เสนอสูงกว่ายอดคงเหลือของงวดปัจจุบัน");
    rolledAmount = Math.round((currentDueAmount - requestedAmount) * 100) / 100;
    if (rolledAmount > 0 && (!validDebtDate(nextDueDate) || nextDueDate <= paymentDate)) {
      throw new HttpsError("invalid-argument", "วันครบกำหนดงวดถัดไปต้องอยู่หลังวันที่เสนอชำระ");
    }

    target.amount = Math.round((paidAmount + requestedAmount) * 100) / 100;
    target.dueDate = paymentDate;
    target.status = paidAmount > 0 ? "partial" : "upcoming";
    if (rolledAmount > 0) {
      const nextEntry = orderedEntries.slice(targetIndex + 1).find(([, item]) => item.status !== "paid");
      if (nextEntry) {
        nextEntry[1].amount = Math.round((Number(nextEntry[1].amount) + rolledAmount) * 100) / 100;
        nextEntry[1].dueDate = nextDueDate;
      } else {
        let sequence = Math.max(0, ...orderedEntries.map(([, item]) => Number(item.sequence) || 0)) + 1;
        let installmentId = `inst_${String(sequence).padStart(3, "0")}`;
        while (installments[installmentId]) {
          sequence += 1;
          installmentId = `inst_${String(sequence).padStart(3, "0")}`;
        }
        installments[installmentId] = { sequence, amount: rolledAmount, paidAmount: 0, dueDate: nextDueDate, status: "upcoming" };
      }
    }
    const normalizedInstallments = Object.values(installments).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    const paidInstallments = normalizedInstallments.filter((item) => item.status === "paid").length;
    proposed = {
      debtType: "installment",
      dueDateMode: "date",
      dueDate: paymentDate,
      installments,
      installmentPlan: {
        ...(debt.installmentPlan || {}),
        totalInstallments: normalizedInstallments.length,
        paidInstallments,
        monthlyAmount: Number(debt.installmentPlan?.monthlyAmount) || requestedAmount,
        firstDueDate: normalizedInstallments.find((item) => item.status !== "paid")?.dueDate || paymentDate,
        nextInstallmentDueDate: paymentDate,
        variableAmounts: true,
      },
      updatedAt: now,
    };
  } else {
    if (requestedAmount > currentDueAmount) throw new HttpsError("invalid-argument", "ยอดที่เสนอสูงกว่ายอดค้างชำระ");
    rolledAmount = Math.round((currentDueAmount - requestedAmount) * 100) / 100;
    if (rolledAmount > 0 && (!validDebtDate(nextDueDate) || nextDueDate <= paymentDate)) {
      throw new HttpsError("invalid-argument", "วันครบกำหนดงวดถัดไปต้องอยู่หลังวันที่เสนอชำระ");
    }
    if (rolledAmount > 0) {
      const installments = {
        inst_001: { sequence: 1, amount: requestedAmount, paidAmount: 0, dueDate: paymentDate, status: "upcoming" },
        inst_002: { sequence: 2, amount: rolledAmount, paidAmount: 0, dueDate: nextDueDate, status: "upcoming" },
      };
      proposed = {
        debtType: "installment",
        dueDateMode: "date",
        dueDate: paymentDate,
        installments,
        installmentPlan: { totalInstallments: 2, paidInstallments: 0, monthlyAmount: requestedAmount, firstDueDate: paymentDate, nextInstallmentDueDate: paymentDate, variableAmounts: true },
        updatedAt: now,
      };
    } else {
      proposed = { dueDateMode: "date", dueDate: paymentDate, updatedAt: now };
    }
  }

  const existingSnapshot = await db.ref(`debtChangeRequests/${debtId}`).once("value");
  const hasPendingPlan = Object.values(existingSnapshot.val() || {}).some((item) => item?.status === "pending" && item?.requestType === "payment_plan");
  if (hasPendingPlan) throw new HttpsError("already-exists", "มีข้อเสนอแผนชำระรอเจ้าหนี้ตรวจสอบอยู่แล้ว");

  const requestId = db.ref(`debtChangeRequests/${debtId}`).push().key;
  const plan = { currentDueAmount, requestedAmount, rolledAmount, paymentDate, nextDueDate: rolledAmount > 0 ? nextDueDate : null, note };
  const updates = {
    [`debtChangeRequests/${debtId}/${requestId}`]: {
      status: "pending",
      requestType: "payment_plan",
      paymentPlan: plan,
      requestedBy: user.uid,
      requestedByName: user.name,
      requestedByEmail: user.email,
      requestedByAuthProvider: user.authProvider,
      approverUid: debt.creditorUid,
      proposed,
      baseUpdatedAt: debt.updatedAt || "",
      createdAt: now,
      updatedAt: now,
    },
  };
  addDebtAudit(updates, debtId, "payment_plan_requested", user, { requestId, ...plan });
  addDebtNotification(updates, debt.creditorUid, debtId, "payment_plan_requested", "ลูกหนี้เสนอแผนชำระ", `${user.name} เสนอชำระ ฿${requestedAmount.toLocaleString("th-TH")} วันที่ ${paymentDate}${rolledAmount > 0 ? ` และเลื่อน ฿${rolledAmount.toLocaleString("th-TH")} ไปงวดถัดไป` : ""}`);
  await db.ref().update(updates);
  return { requestId, plan };
});

exports.respondDebtUpdate = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "respondDebtUpdate", 50, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const requestId = String(request.data?.requestId || "");
  const accepted = request.data?.accepted === true;
  if (!validDebtId(debtId) || !validDebtId(requestId)) throw new HttpsError("invalid-argument", "รหัสคำขอไม่ถูกต้อง");
  const debt = await requiredDebtForUser(debtId, user);
  const requestRef = db.ref(`debtChangeRequests/${debtId}/${requestId}`);
  const requestSnapshot = await requestRef.once("value");
  const changeRequest = requestSnapshot.val();
  if (!changeRequest || changeRequest.status !== "pending") throw new HttpsError("failed-precondition", "คำขอนี้ถูกดำเนินการแล้ว");
  if (changeRequest.approverUid !== user.uid || changeRequest.requestedBy === user.uid) throw new HttpsError("permission-denied", "เฉพาะอีกฝ่ายเท่านั้นที่ตอบคำขอนี้ได้");
  if (accepted && String(changeRequest.baseUpdatedAt || "") !== String(debt.updatedAt || "")) throw new HttpsError("aborted", "รายการถูกเปลี่ยนแปลงหลังสร้างคำขอ กรุณาสร้างคำขอใหม่");
  const now = new Date().toISOString();
  const updates = {
    [`debtChangeRequests/${debtId}/${requestId}/status`]: accepted ? "accepted" : "rejected",
    [`debtChangeRequests/${debtId}/${requestId}/decidedAt`]: now,
    [`debtChangeRequests/${debtId}/${requestId}/decidedBy`]: user.uid,
    [`debtChangeRequests/${debtId}/${requestId}/updatedAt`]: now,
  };
  if (accepted) {
    Object.entries(changeRequest.proposed || {}).forEach(([key, value]) => { updates[`debts/${debtId}/${key}`] = value; });
    if (changeRequest.proposed?.dueDateMode === "none") updates[`debts/${debtId}/dueDate`] = null;
    const nextDebt = { ...debt, ...(changeRequest.proposed || {}) };
    if (changeRequest.proposed?.dueDateMode === "none") delete nextDebt.dueDate;
    const version = Math.max(1, Number(debt.agreementVersion) || 1) + 1;
    const requester = {
      uid: changeRequest.requestedBy,
      name: changeRequest.requestedByName || "คู่สัญญา",
      email: changeRequest.requestedByEmail || "",
      authProvider: changeRequest.requestedByAuthProvider || "firebase",
    };
    const agreement = agreementVersionRecord(nextDebt, version, {}, now);
    agreement.acceptances[requester.uid] = debtAcceptance(requester, agreement.digest, changeRequest.createdAt || now, "change_requester_acceptance");
    agreement.acceptances[user.uid] = debtAcceptance(user, agreement.digest, now, "change_approver_acceptance");
    updates[`debts/${debtId}/agreementVersion`] = version;
    updates[`debts/${debtId}/agreementDigest`] = agreement.digest;
    updates[`debts/${debtId}/agreementStatus`] = "accepted";
    updates[`debtAgreementVersions/${debtId}/v_${String(version).padStart(3, "0")}`] = agreement;
  }
  const paymentPlanRequest = changeRequest.requestType === "payment_plan";
  addDebtAudit(updates, debtId, paymentPlanRequest ? (accepted ? "payment_plan_accepted" : "payment_plan_rejected") : (accepted ? "debt_update_accepted" : "debt_update_rejected"), user, { requestId });
  addDebtNotification(updates, changeRequest.requestedBy, debtId, paymentPlanRequest ? (accepted ? "payment_plan_accepted" : "payment_plan_rejected") : (accepted ? "change_accepted" : "change_rejected"), paymentPlanRequest ? (accepted ? "เจ้าหนี้ยอมรับแผนชำระแล้ว" : "เจ้าหนี้ไม่ยอมรับแผนชำระ") : (accepted ? "คำขอแก้ไขได้รับการยืนยัน" : "คำขอแก้ไขถูกปฏิเสธ"), `${debt.title} · ${user.name}`);
  await db.ref().update(updates);
  return { accepted };
});

exports.cancelDebt = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "cancelDebt", 20, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const reason = String(request.data?.reason || "").trim().slice(0, 500);
  if (!validDebtId(debtId) || !reason) throw new HttpsError("invalid-argument", "กรุณาระบุเหตุผลในการยกเลิก");
  const debt = await requiredDebtForUser(debtId, user);
  if (debt.status === "cancelled") return { cancelled: true };
  if (debt.debtorUid) return createDebtConsentRequest(debtId, debt, user, "debt_cancel", { reason });
  if (debt.creditorUid !== user.uid) throw new HttpsError("permission-denied", "เฉพาะเจ้าหนี้เท่านั้นที่ยกเลิกรายการก่อนมีผู้ยืนยันได้");
  const now = new Date().toISOString();
  const invitationSnapshot = debt.inviteCode ? await db.ref(`debtInviteCodes/${debt.inviteCode}`).once("value") : null;
  const rawInvitation = invitationSnapshot?.val();
  const updates = {
    [`debts/${debtId}/status`]: "cancelled",
    [`debts/${debtId}/cancelledAt`]: now,
    [`debts/${debtId}/cancelledBy`]: user.uid,
    [`debts/${debtId}/cancellationReason`]: reason,
    [`debts/${debtId}/updatedAt`]: now,
  };
  if (rawInvitation && typeof rawInvitation === "object") {
    const remainingDebtIds = (Array.isArray(rawInvitation.debtIds) ? rawInvitation.debtIds : Object.values(rawInvitation.debtIds || {})).filter((id) => validDebtId(id) && id !== debtId);
    updates[`debtInviteCodes/${debt.inviteCode}`] = remainingDebtIds.length ? { ...rawInvitation, debtIds: remainingDebtIds } : null;
  } else if (debt.inviteCode) {
    updates[`debtInviteCodes/${debt.inviteCode}`] = null;
  }
  addDebtAudit(updates, debtId, "debt_cancelled", user, { reason });
  addDebtNotification(updates, debt.debtorUid, debtId, "debt_cancelled", "รายการถูกยกเลิก", `${debt.title} · ${reason}`);
  await db.ref().update(updates);
  return { cancelled: true };
});

exports.archiveDebt = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "archiveDebt", 60, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const debt = await requiredDebtForUser(debtId, user);
  if (!["paid", "cancelled", "declined"].includes(debt.status)) throw new HttpsError("failed-precondition", "เก็บเข้าคลังได้เมื่อชำระครบ ยกเลิก หรือปฏิเสธแล้ว");
  const updates = { [`debtArchives/${user.uid}/${debtId}`]: { archivedAt: new Date().toISOString() } };
  addDebtAudit(updates, debtId, "debt_archived", user);
  await db.ref().update(updates);
  return { archived: true };
});

exports.restoreDebt = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "restoreDebt", 60, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  await requiredDebtForUser(debtId, user);
  const updates = { [`debtArchives/${user.uid}/${debtId}`]: null };
  addDebtAudit(updates, debtId, "debt_restored", user);
  await db.ref().update(updates);
  return { restored: true };
});

exports.revokeDebtInvite = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "revokeDebtInvite", 20, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const debt = await requiredDebtForUser(debtId, user);
  if (debt.creditorUid !== user.uid || debt.debtorUid) throw new HttpsError("failed-precondition", "ยกเลิกลิงก์ได้เฉพาะรายการที่ยังไม่มีลูกหนี้ยืนยัน");
  const invitationSnapshot = await db.ref(`debtInviteCodes/${debt.inviteCode}`).once("value");
  const rawInvitation = invitationSnapshot.val();
  const invitationDebtIds = typeof rawInvitation === "string" ? [rawInvitation] :
    (Array.isArray(rawInvitation?.debtIds) ? rawInvitation.debtIds : Object.values(rawInvitation?.debtIds || {}));
  const affectedDebtIds = invitationDebtIds.filter(validDebtId).length ? invitationDebtIds.filter(validDebtId) : [debtId];
  const now = new Date().toISOString();
  const updates = {
    [`debtInviteCodes/${debt.inviteCode}`]: null,
  };
  affectedDebtIds.forEach((id) => {
    updates[`debts/${id}/status`] = "invite_revoked";
    updates[`debts/${id}/updatedAt`] = now;
    addDebtAudit(updates, id, "invite_revoked", user);
  });
  await db.ref().update(updates);
  return { revoked: true, debtIds: affectedDebtIds };
});

exports.renewDebtInvite = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "renewDebtInvite", 20, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  if (!validDebtId(debtId)) throw new HttpsError("invalid-argument", "รหัสรายการไม่ถูกต้อง");
  const debt = await requiredDebtForUser(debtId, user);
  if (debt.creditorUid !== user.uid || debt.debtorUid) throw new HttpsError("failed-precondition", "สร้างลิงก์ใหม่ได้เฉพาะรายการที่ยังไม่มีลูกหนี้ยืนยัน");
  const memberSnapshot = await db.ref(`debtMembers/${user.uid}`).once("value");
  const memberIds = Object.keys(memberSnapshot.val() || {}).filter(validDebtId).slice(0, 500);
  const memberDebts = await Promise.all(memberIds.map((id) => db.ref(`debts/${id}`).once("value")));
  const affectedDebtIds = memberIds.filter((id, index) => {
    const item = memberDebts[index].val();
    return item && item.creditorUid === user.uid && !item.debtorUid && item.inviteCode === debt.inviteCode && item.status === "invite_revoked";
  });
  if (!affectedDebtIds.includes(debtId)) affectedDebtIds.push(debtId);
  const inviteCode = debtInviteCode();
  const updates = {
    [`debtInviteCodes/${debt.inviteCode}`]: null,
    [`debtInviteCodes/${inviteCode}`]: affectedDebtIds.length > 1 ? { kind: "batch", debtIds: affectedDebtIds, creditorUid: user.uid, createdAt: new Date().toISOString() } : debtId,
  };
  affectedDebtIds.forEach((id) => {
    updates[`debts/${id}/inviteCode`] = inviteCode;
    updates[`debts/${id}/status`] = "pending";
    updates[`debts/${id}/updatedAt`] = new Date().toISOString();
    addDebtAudit(updates, id, "invite_renewed", user);
  });
  await db.ref().update(updates);
  return { inviteCode, debtIds: affectedDebtIds };
});

exports.declineDebtInvite = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "declineDebtInvite", 20, 60 * 60 * 1000);
  const inviteCode = String(request.data?.inviteCode || "").trim();
  const reason = String(request.data?.reason || "ไม่ยืนยันรายการ").trim().slice(0, 500);
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(inviteCode)) throw new HttpsError("invalid-argument", "ลิงก์เชิญไม่ถูกต้อง");
  const inviteRef = db.ref(`debtInviteCodes/${inviteCode}`);
  const claim = await inviteRef.transaction((current) => {
    if (!current || current.claimedBy || current.declinedBy) return;
    const normalized = typeof current === "string" ? { kind: "single", debtIds: [current] } : current;
    return { ...normalized, declinedBy: user.uid, declinedAt: new Date().toISOString() };
  });
  const rawInvitation = claim.snapshot.val();
  if (!claim.committed || !rawInvitation || rawInvitation.declinedBy !== user.uid) throw new HttpsError("not-found", "ลิงก์เชิญหมดอายุหรือถูกใช้แล้ว");
  const invitation = typeof rawInvitation === "string" ? { debtIds: [rawInvitation] } : rawInvitation;
  const debtIds = (Array.isArray(invitation.debtIds) ? invitation.debtIds : Object.values(invitation.debtIds || {})).filter(validDebtId).slice(0, 100);
  const snapshots = await Promise.all(debtIds.map((id) => db.ref(`debts/${id}`).once("value")));
  const debts = snapshots.map((snapshot) => snapshot.val());
  if (!debtIds.length || debts.some((debt) => !debt)) throw new HttpsError("not-found", "ไม่พบรายการในคำเชิญ");
  if (debts.some((debt) => debt.creditorUid === user.uid)) throw new HttpsError("failed-precondition", "เจ้าหนี้ไม่สามารถปฏิเสธคำเชิญของตัวเองได้");
  const now = new Date().toISOString();
  const updates = { [`debtInviteCodes/${inviteCode}`]: null };
  debtIds.forEach((debtId, index) => {
    const debt = debts[index];
    updates[`debts/${debtId}/debtorUid`] = user.uid;
    updates[`debts/${debtId}/debtorName`] = user.name;
    updates[`debts/${debtId}/debtorEmail`] = user.email;
    updates[`debts/${debtId}/status`] = "declined";
    updates[`debts/${debtId}/declinedAt`] = now;
    updates[`debts/${debtId}/declineReason`] = reason;
    updates[`debts/${debtId}/updatedAt`] = now;
    updates[`debtMembers/${user.uid}/${debtId}`] = true;
    addDebtAudit(updates, debtId, "invite_declined", user, { reason });
    addDebtNotification(updates, debt.creditorUid, debtId, "invite_declined", "ลูกหนี้ไม่ยืนยันรายการ", `${debt.title} · ${reason}`);
  });
  await db.ref().update(updates);
  return { declined: true, debtIds };
});

exports.openDebtDispute = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "openDebtDispute", 20, 24 * 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const reason = String(request.data?.reason || "").trim().slice(0, 1000);
  if (!validDebtId(debtId) || !reason) throw new HttpsError("invalid-argument", "กรุณาระบุเหตุผลโต้แย้ง");
  const debt = await requiredDebtForUser(debtId, user);
  if (!debt.debtorUid || ["cancelled", "declined", "paid"].includes(debt.status)) throw new HttpsError("failed-precondition", "รายการนี้ไม่สามารถเปิดข้อโต้แย้งได้");
  const disputeId = db.ref(`debtDisputes/${debtId}`).push().key;
  const now = new Date().toISOString();
  const updates = {
    [`debtDisputes/${debtId}/${disputeId}`]: { status: "open", reason, openedBy: user.uid, openedByName: user.name, createdAt: now, updatedAt: now },
    [`debts/${debtId}/preDisputeStatus`]: debt.status,
    [`debts/${debtId}/status`]: "disputed",
    [`debts/${debtId}/updatedAt`]: now,
  };
  addDebtAudit(updates, debtId, "dispute_opened", user, { disputeId, reason });
  addDebtNotification(updates, otherDebtUid(debt, user.uid), debtId, "dispute_opened", "มีข้อโต้แย้งรายการหนี้", `${user.name}: ${reason}`);
  await db.ref().update(updates);
  return { disputeId };
});

exports.resolveDebtDispute = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "resolveDebtDispute", 30, 24 * 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const disputeId = String(request.data?.disputeId || "");
  const resolution = String(request.data?.resolution || "").trim().slice(0, 1000);
  if (!validDebtId(debtId) || !validDebtId(disputeId) || !resolution) throw new HttpsError("invalid-argument", "ข้อมูลการยุติข้อโต้แย้งไม่ครบถ้วน");
  const debt = await requiredDebtForUser(debtId, user);
  const disputeSnapshot = await db.ref(`debtDisputes/${debtId}/${disputeId}`).once("value");
  const dispute = disputeSnapshot.val();
  if (!dispute || dispute.status !== "open") throw new HttpsError("failed-precondition", "ข้อโต้แย้งนี้ถูกปิดแล้ว");
  return createDebtConsentRequest(debtId, debt, user, "dispute_resolve", { resolution }, disputeId);
});

exports.reverseDebtPayment = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "reverseDebtPayment", 20, 24 * 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const paymentId = String(request.data?.paymentId || "");
  const reason = String(request.data?.reason || "").trim().slice(0, 500);
  if (!validDebtId(debtId) || !validDebtId(paymentId) || !reason) throw new HttpsError("invalid-argument", "กรุณาระบุรายการและเหตุผลในการย้อนชำระ");
  const debt = await requiredDebtForUser(debtId, user);
  const paymentsSnapshot = await db.ref(`debtPayments/${debtId}`).once("value");
  const payments = paymentsSnapshot.val() || {};
  const payment = payments[paymentId];
  if (!payment || payment.status !== "confirmed") throw new HttpsError("failed-precondition", "ย้อนกลับได้เฉพาะรายการที่ยืนยันแล้ว");
  const laterConfirmed = Object.entries(payments).some(([id, item]) => id !== paymentId && item.status === "confirmed" && String(item.confirmedAt || "") > String(payment.confirmedAt || ""));
  if (laterConfirmed) throw new HttpsError("failed-precondition", "ต้องย้อนรายการชำระล่าสุดก่อน");
  return createDebtConsentRequest(debtId, debt, user, "payment_reverse", { reason, amount: Number(payment.appliedAmount) || Number(payment.amount) || 0 }, paymentId);
  /* Legacy direct-apply path retained below for historical source compatibility; mutual consent returns above. */
  const appliedAmount = Number(payment.appliedAmount) || Number(payment.amount) || 0;
  const allocations = payment.allocations || debt.appliedPayments?.[paymentId]?.allocations || {};
  const now = new Date().toISOString();
  const debtResult = await db.ref(`debts/${debtId}`).transaction((current) => {
    if (!current || current.creditorUid !== user.uid) return;
    const applied = current.appliedPayments?.[paymentId];
    if (applied?.reversedAt) return current;
    let installments = current.installments ? JSON.parse(JSON.stringify(current.installments)) : null;
    if (installments) {
      let restored = 0;
      Object.entries(allocations).forEach(([installmentId, allocation]) => {
        if (!installments[installmentId]) return;
        const value = Math.max(0, Number(allocation) || 0);
        installments[installmentId].paidAmount = Math.max(0, Math.round((Number(installments[installmentId].paidAmount || 0) - value) * 100) / 100);
        installments[installmentId].status = installments[installmentId].paidAmount > 0 ? "partial" : "upcoming";
        installments[installmentId].paidAt = null;
        restored += value;
      });
      if (restored <= 0) {
        const candidates = Object.entries(installments).filter(([, item]) => item.lastPaymentId === paymentId).sort(([, a], [, b]) => Number(b.sequence) - Number(a.sequence));
        let remaining = appliedAmount;
        candidates.forEach(([, item]) => {
          const value = Math.min(remaining, Number(item.paidAmount) || 0);
          item.paidAmount = Math.max(0, Math.round((Number(item.paidAmount || 0) - value) * 100) / 100);
          item.status = item.paidAmount > 0 ? "partial" : "upcoming";
          item.paidAt = null;
          remaining = Math.round((remaining - value) * 100) / 100;
        });
      }
    }
    const nextOutstanding = Math.round((Number(current.outstandingAmount || 0) + appliedAmount) * 100) / 100;
    const ordered = Object.values(installments || {}).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    const installmentPlan = installments ? {
      ...current.installmentPlan,
      paidInstallments: ordered.filter((item) => item.status === "paid").length,
      nextInstallmentDueDate: ordered.find((item) => item.status !== "paid")?.dueDate || null,
    } : null;
    return {
      ...current,
      outstandingAmount: nextOutstanding,
      status: "active",
      paidAt: null,
      ...(installments ? { installments, installmentPlan, dueDate: installmentPlan.nextInstallmentDueDate } : {}),
      appliedPayments: {
        ...(current.appliedPayments || {}),
        [paymentId]: { ...(current.appliedPayments?.[paymentId] || {}), reversedAt: now, reversedBy: user.uid, reversalReason: reason },
      },
      updatedAt: now,
    };
  });
  if (!debtResult.committed) throw new HttpsError("aborted", "ย้อนรายการชำระไม่สำเร็จ");
  const updates = {
    [`debtPayments/${debtId}/${paymentId}/status`]: "reversed",
    [`debtPayments/${debtId}/${paymentId}/reversedAt`]: now,
    [`debtPayments/${debtId}/${paymentId}/reversedBy`]: user.uid,
    [`debtPayments/${debtId}/${paymentId}/reversalReason`]: reason,
    [`debtPayments/${debtId}/${paymentId}/updatedAt`]: now,
  };
  addDebtAudit(updates, debtId, "payment_reversed", user, { paymentId, amount: appliedAmount, reason });
  addDebtNotification(updates, debt.debtorUid, debtId, "payment_reversed", "รายการชำระถูกย้อนกลับ", `${debt.title} ฿${appliedAmount.toLocaleString("th-TH")} · ${reason}`);
  await db.ref().update(updates);
  return { reversed: true, outstandingAmount: debtResult.snapshot.child("outstandingAmount").val() };
});

exports.respondDebtConsent = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "respondDebtConsent", 50, 60 * 60 * 1000);
  const debtId = String(request.data?.debtId || "");
  const requestId = String(request.data?.requestId || "");
  const accepted = request.data?.accepted === true;
  if (!validDebtId(debtId) || !validDebtId(requestId)) throw new HttpsError("invalid-argument", "รหัสคำขอไม่ถูกต้อง");
  const debt = await requiredDebtForUser(debtId, user);
  const consentRef = db.ref(`debtConsentRequests/${debtId}/${requestId}`);
  const now = new Date().toISOString();
  const claim = await consentRef.transaction((current) => {
    if (!current || current.status !== "pending" || current.approverUid !== user.uid || current.requestedBy === user.uid) return;
    return { ...current, status: "processing", processingBy: user.uid, updatedAt: now };
  });
  if (!claim.committed) throw new HttpsError("failed-precondition", "คำขอนี้ถูกดำเนินการแล้วหรือคุณไม่มีสิทธิ์ตอบ");
  const consent = claim.snapshot.val();
  if (consent.expiresAt && consent.expiresAt < now) {
    await consentRef.update({ status: "expired", decidedAt: now, updatedAt: now });
    throw new HttpsError("deadline-exceeded", "คำขอนี้หมดอายุแล้ว กรุณาสร้างคำขอใหม่");
  }
  if (!accepted) {
    const updates = {
      [`debtConsentRequests/${debtId}/${requestId}/status`]: "rejected",
      [`debtConsentRequests/${debtId}/${requestId}/decidedAt`]: now,
      [`debtConsentRequests/${debtId}/${requestId}/decidedBy`]: user.uid,
      [`debtConsentRequests/${debtId}/${requestId}/updatedAt`]: now,
    };
    addDebtAudit(updates, debtId, `${consent.type}_rejected`, user, { requestId });
    addDebtNotification(updates, consent.requestedBy, debtId, "consent_rejected", "คำขอไม่ได้รับการยืนยัน", `${debt.title} · ${user.name}`);
    await db.ref().update(updates);
    return { accepted: false };
  }
  if (String(consent.baseUpdatedAt || "") !== String(debt.updatedAt || "")) {
    await consentRef.update({ status: "stale", decidedAt: now, updatedAt: now });
    throw new HttpsError("aborted", "รายการเปลี่ยนแปลงหลังสร้างคำขอ กรุณาตรวจสอบและสร้างคำขอใหม่");
  }
  try {
    await applyApprovedDebtAction(debtId, debt, consent, user);
    await consentRef.update({ status: "accepted", decidedAt: now, decidedBy: user.uid, updatedAt: now });
    return { accepted: true, type: consent.type };
  } catch (error) {
    await consentRef.update({ status: "pending", processingBy: null, updatedAt: new Date().toISOString() });
    throw error;
  }
});

exports.refreshDebtReminders = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  await enforceDebtRateLimit(user.uid, "refreshDebtReminders", 8, 60 * 60 * 1000);
  const memberSnapshot = await db.ref(`debtMembers/${user.uid}`).once("value");
  const notificationsSnapshot = await db.ref(`debtNotifications/${user.uid}`).once("value");
  const existingNotifications = notificationsSnapshot.val() || {};
  const debtIds = Object.keys(memberSnapshot.val() || {}).filter(validDebtId).slice(0, 500);
  const snapshots = await Promise.all(debtIds.map((debtId) => db.ref(`debts/${debtId}`).once("value")));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const updates = {};
  let created = 0;
  snapshots.forEach((snapshot, index) => {
    const debt = snapshot.val();
    if (!debt || debt.debtorUid !== user.uid || debt.status !== "active" || !validDebtDate(debt.dueDate)) return;
    const due = new Date(`${debt.dueDate}T00:00:00Z`);
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (days > 3) return;
    const debtId = debtIds[index];
    const reminderId = `due_${debtId}_${debt.dueDate}`;
    if (existingNotifications[reminderId]) return;
    updates[`debtNotifications/${user.uid}/${reminderId}`] = {
      debtId,
      type: days < 0 ? "overdue" : "due_soon",
      title: days < 0 ? "รายการเกินกำหนด" : days === 0 ? "ครบกำหนดวันนี้" : "ใกล้ถึงวันครบกำหนด",
      body: `${debt.title} · ฿${Number(debt.outstandingAmount || 0).toLocaleString("th-TH")}`,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    created += 1;
  });
  if (created) await db.ref().update(updates);
  return { created };
});

exports.markDebtNotificationRead = onCall(DEBT_CALL_OPTIONS, async (request) => {
  const user = requiredDebtUser(request);
  const notificationId = String(request.data?.notificationId || "");
  if (!validDebtId(notificationId)) throw new HttpsError("invalid-argument", "รหัสแจ้งเตือนไม่ถูกต้อง");
  const ref = db.ref(`debtNotifications/${user.uid}/${notificationId}`);
  const snapshot = await ref.once("value");
  if (!snapshot.exists()) throw new HttpsError("not-found", "ไม่พบการแจ้งเตือน");
  await ref.update({ readAt: new Date().toISOString() });
  return { read: true };
});

const RECOMP_CHALLENGE_ID = "16-week-2026";
const RECOMP_ROOT = `recompChallenges/${RECOMP_CHALLENGE_ID}`;

async function requiredRecompMember(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อน");
  const snapshot = await db.ref(`${RECOMP_ROOT}/members/${request.auth.uid}`).once("value");
  if (!snapshot.exists()) throw new HttpsError("permission-denied", "บัญชีนี้ไม่ได้เป็นสมาชิก Recomp challenge");
  const member = snapshot.val() || {};
  if (!["zackdark", "tony"].includes(member.profileId)) throw new HttpsError("failed-precondition", "สมาชิกยังไม่มี profile ที่ถูกต้อง");
  return { ...member, uid: request.auth.uid };
}

exports.createAppleHealthPairingToken = onCall({ region: REGION }, async (request) => {
  const member = await requiredRecompMember(request);
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  await db.ref(`${RECOMP_ROOT}/appleHealthPairings/${member.profileId}`).set({
    tokenHash: hashPairingToken(token),
    createdAt: now,
    createdBy: member.uid,
  });
  await db.ref(`${RECOMP_ROOT}/data/integrations/appleHealth/${member.profileId}`).update({
    paired: true,
    pairedAt: now,
    lastSyncedAt: null,
  });
  return {
    profileId: member.profileId,
    token,
    endpoint: `https://${REGION}-${process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "he-served"}.cloudfunctions.net/syncAppleHealth`,
  };
});

exports.revokeAppleHealthPairing = onCall({ region: REGION }, async (request) => {
  const member = await requiredRecompMember(request);
  await Promise.all([
    db.ref(`${RECOMP_ROOT}/appleHealthPairings/${member.profileId}`).remove(),
    db.ref(`${RECOMP_ROOT}/data/integrations/appleHealth/${member.profileId}`).update({ paired: false, revokedAt: new Date().toISOString() }),
  ]);
  return { revoked: true, profileId: member.profileId };
});

exports.syncAppleHealth = onRequest({ region: REGION, cors: false, timeoutSeconds: 60 }, async (request, response) => {
  if (request.method !== "POST") {
    response.set("Allow", "POST").status(405).json({ error: "method-not-allowed" });
    return;
  }
  try {
    const payload = normalizeAppleHealthPayload(request.body);
    const authorization = String(request.get("authorization") || "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const pairingSnapshot = await db.ref(`${RECOMP_ROOT}/appleHealthPairings/${payload.profileId}`).once("value");
    const pairing = pairingSnapshot.val() || {};
    if (!safeTokenMatch(token, pairing.tokenHash)) {
      response.status(401).json({ error: "invalid-pairing-token" });
      return;
    }

    const syncedAt = new Date().toISOString();
    let updatedLogs = 0;
    const workoutUpdates = {};
    for (const day of payload.days) {
      const logRef = db.ref(`${RECOMP_ROOT}/data/logs/${payload.profileId}/${day.date}`);
      const transaction = await logRef.transaction((current) => mergeAppleHealthLog(current, day, syncedAt, payload.profileId, payload.capturedAt));
      if (transaction.committed) updatedLogs += 1;
      for (const workout of day.workouts) {
        workoutUpdates[`${RECOMP_ROOT}/data/healthWorkouts/${payload.profileId}/${workout.id}`] = {
          ...workout,
          date: day.date,
          profileId: payload.profileId,
          syncedAt,
        };
      }
    }
    const integrationPath = `${RECOMP_ROOT}/data/integrations/appleHealth/${payload.profileId}`;
    const updates = {
      ...workoutUpdates,
      [`${integrationPath}/paired`]: true,
      [`${integrationPath}/lastSyncedAt`]: syncedAt,
      [`${integrationPath}/lastCapturedAt`]: payload.capturedAt,
      [`${integrationPath}/timezone`]: payload.timezone,
      [`${integrationPath}/daysReceived`]: payload.days.length,
      [`${integrationPath}/workoutsReceived`]: Object.keys(workoutUpdates).length,
    };
    await db.ref().update(updates);
    response.status(200).json({
      ok: true,
      profileId: payload.profileId,
      daysReceived: payload.days.length,
      logsProcessed: updatedLogs,
      workoutsReceived: Object.keys(workoutUpdates).length,
      syncedAt,
    });
  } catch (error) {
    logger.warn("Apple Health sync rejected", { message: error.message });
    response.status(400).json({ error: error.message || "invalid-payload" });
  }
});

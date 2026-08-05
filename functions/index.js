const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

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

async function activateCoffeePassForOrder(shopUid, orderId, order, activatedBy) {
  if (!order || !order.coffeePassPurchase || order.coffeePassServerCreated !== true) throw new HttpsError("failed-precondition", "ออเดอร์ Pass นี้ไม่ได้สร้างโดยระบบ");
  if (order.status === "cancelled") throw new HttpsError("failed-precondition", "ออเดอร์ Pass นี้ถูกยกเลิกแล้ว");
  const phone = normalizeThaiPhone(order.customerPhone);
  if (!phone) throw new HttpsError("failed-precondition", "เบอร์โทรศัพท์ในออเดอร์ไม่ถูกต้อง");
  const purchase = normalizedCoffeePassConfig(order.coffeePassPurchase);
  const activatedAt = Date.now();
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
    items: [{ menuId: "coffee_pass", name: pass.name, productType: "pass", unitPrice: pass.price, qty: 1, options: [] }],
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

async function verifyCoffeePasscodeAttempt(shopUid, passId, redemptionAttemptId, passcode) {
  const secretRef = db.ref(`coffeePassSecrets/${shopUid}/${passId}`);
  const salt = (await secretRef.child("salt").once("value")).val() || "missing";
  const passcodeAttempt = hashPasscode(passcode, salt);
  const verification = await secretRef.transaction((current) => {
    if (!current) return undefined;
    const currentTime = Date.now();
    const verifiedAttempts = current.verifiedAttempts || {};
    const failedAttemptIds = current.failedAttemptIds || {};
    if (verifiedAttempts[redemptionAttemptId]) return current;
    if (failedAttemptIds[redemptionAttemptId]) return current;
    if ((Number(current.lockedUntil) || 0) > currentTime) return current;
    if (current.passcodeHash !== passcodeAttempt) {
      const failedAttempts = (Number(current.failedAttempts) || 0) + 1;
      const recentFailed = Object.fromEntries(Object.entries(failedAttemptIds).slice(-19));
      return {
        ...current,
        failedAttempts: failedAttempts >= 5 ? 0 : failedAttempts,
        lockedUntil: failedAttempts >= 5 ? currentTime + 15 * 60 * 1000 : 0,
        lastFailedAt: currentTime,
        failedAttemptIds: { ...recentFailed, [redemptionAttemptId]: currentTime },
      };
    }
    const recentVerified = Object.fromEntries(Object.entries(verifiedAttempts).slice(-19));
    return {
      ...current,
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

  const passRef = db.ref(`customers/${shopUid}/${phone}/passes/${passId}`);
  const proposedOrderId = db.ref(`orders/${shopUid}`).push().key;
  const now = Date.now();
  const transaction = await passRef.transaction((current) => {
    if (!current) return undefined;
    const attempts = current.redemptionAttempts || {};
    if (attempts[redemptionAttemptId]) return current;
    if ((Number(current.expiresAt) || 0) < now || (Number(current.remainingUses) || 0) <= 0 || current.status === "cancelled") return undefined;
    const eligibleMenus = Array.isArray(current.menuIds) ? current.menuIds : Object.values(current.menuIds || {});
    if (eligibleMenus.length > 0 && !eligibleMenus.includes(menuId)) return undefined;
    const remainingUses = (Number(current.remainingUses) || 0) - 1;
    return {
      ...current,
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
    const choice = choices.filter(Boolean).find((candidate) => candidate.id === requested.choiceId);
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
    items: [{ menuId, name: String(menu.name || "เครื่องดื่ม"), productType: "drink", unitPrice: optionTotal, originalUnitPrice: (Number(menu.priceStore) || 0) + optionTotal, qty: 1, options: safeOptions, promoKind: "coffee-pass-redemption", passId }],
    total: optionTotal,
    passRedemption: { passId, redemptionAttemptId, packageName: pass.packageName || "Coffee Pass", optionTotal },
    status: "pending",
    createdAt: new Date(now).toISOString(),
  };
  const orderRef = db.ref(`orders/${shopUid}/${attempt.orderId}`);
  await orderRef.transaction((current) => current || orderData);
  return { orderId: attempt.orderId, order: (await orderRef.once("value")).val(), pass };
});

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

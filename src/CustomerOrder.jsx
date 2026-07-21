import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth, signInAnonymously, onAuthStateChanged, PhoneAuthProvider, RecaptchaVerifier,
  linkWithCredential, reauthenticateWithCredential, signInWithCredential,
} from "firebase/auth";
import { getDatabase, ref, onValue, get, push, set } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import QRCode from "qrcode";
import generatePayload from "promptpay-qr";
import { firebaseConfig } from "./firebase";
import LoyaltyCard from "./components/loyalty/LoyaltyCard.jsx";
import RewardOtpModal from "./components/loyalty/RewardOtpModal.jsx";
import PromotionTakeover from "./components/promotions/PromotionTakeover.jsx";

// Isolated secondary app so an anonymous customer session never shares
// Auth persistence with the owner dashboard's login on the same device/browser.
const customerApp = getApps().some((a) => a.name === "customer-order")
  ? getApp("customer-order")
  : initializeApp(firebaseConfig, "customer-order");
const auth = getAuth(customerApp);
const db = getDatabase(customerApp);
const functions = getFunctions(customerApp, "asia-southeast1");

const STATUS_TEXT = {
  pending: "รอร้านยืนยันการรับเงิน...",
  paid: "ร้านได้รับเงินแล้ว กำลังเตรียมคิว...",
  preparing: "กำลังเตรียมออเดอร์ของคุณ...",
  ready: "พร้อมรับแล้ว! มารับที่หน้าร้านได้เลย",
  done: "รับออเดอร์เรียบร้อยแล้ว ขอบคุณที่ใช้บริการ",
  cancelled: "ออเดอร์นี้ถูกยกเลิก",
};

// วิธีชำระที่จ่ายหน้าร้านโดยตรง ไม่ต้องสแกน/แนบสลิป — ทำงานเหมือนกันหมด ต่างกันแค่ข้อความที่โชว์ลูกค้า
const PAY_AT_STORE_TEXT = {
  cash: { title: "ชำระเงินสดที่ร้าน", instruction: "กรุณาชำระเงินสดตอนมารับที่ร้าน" },
  thaihelpthai: { title: "ชำระผ่านโครงการไทยช่วยไทยที่ร้าน", instruction: "กรุณาแจ้งพนักงานว่าชำระผ่านโครงการไทยช่วยไทยตอนมารับที่ร้าน" },
};
function isCashLikeMethod(method) {
  return Object.prototype.hasOwnProperty.call(PAY_AT_STORE_TEXT, method);
}

function normalizeThaiPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^66\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^0\d{9}$/.test(digits)) return digits;
  return "";
}

function toThaiE164(value) {
  const normalized = normalizeThaiPhone(value);
  return normalized ? `+66${normalized.slice(1)}` : "";
}

function newRedemptionAttemptId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, "");
  return `reward_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function rewardOtpErrorMessage(error) {
  const code = String(error?.code || "").replace("auth/", "");
  if (["invalid-phone-number", "missing-phone-number"].includes(code)) return "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง";
  if (["invalid-verification-code", "code-expired", "session-expired"].includes(code)) return "รหัส OTP ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่";
  if (["too-many-requests", "quota-exceeded"].includes(code)) return "ส่งรหัสหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (["captcha-check-failed", "missing-app-credential"].includes(code)) return "ตรวจสอบความปลอดภัยไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่";
  return "ยืนยันเบอร์โทรศัพท์ไม่สำเร็จ กรุณาลองใหม่";
}

const COLORS = {
  cream: "#F5F0EA", cream2: "#EDE3D2", surface: "#FFFFFF",
  espresso5: "#063360", espresso4: "#0B4A7A", espresso3: "#3A5570", espresso2: "#7189A3",
  sage: "#CE560D", sageDark: "#A8440A", sageLight: "#F7E0CC",
  gold: "#CE560D", goldLight: "#F7E0CC",
  danger: "#B23A2E", line: "#E2D8C7",
  success: "#2E9E4F", successDark: "#1F7A38", successLight: "#DFF3E3",
  pending: "#B8860B", pendingLight: "#FCEFD1",
};

function RewardTermsSheet({ goal, onClose }) {
  const { mounted, shown } = useSheetTransition(true);
  if (!mounted) return null;
  return (
    <div style={{ ...overlay, opacity: shown ? 1 : 0, transition: "opacity .25s ease" }} onClick={onClose}>
      <div style={{
        ...GLASS_PANEL, borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto",
        transform: shown ? "translateY(0)" : "translateY(100%)", transition: "transform .34s cubic-bezier(.22,1,.36,1)",
      }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="เงื่อนไขการสะสมเมล็ดและรางวัล">
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, margin: "0 0 12px", color: COLORS.espresso5 }}>เงื่อนไขการสะสมเมล็ด</h2>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: COLORS.espresso3, lineHeight: 1.9 }}>
          <li>ได้รับ 1 เมล็ดต่อเครื่องดื่ม 1 แก้วที่สั่งซื้อ ไม่ว่าจะสั่งกี่แก้วในออเดอร์เดียวก็นับครบทุกแก้ว</li>
          <li>ขนมปัง อาหาร และสินค้าอื่นที่ไม่ใช่เครื่องดื่ม ไม่ร่วมสะสมเมล็ดและไม่สามารถใช้เป็นเมนูแลกรางวัลได้</li>
          <li>เมล็ดเข้าบัญชีเมื่อร้านส่งมอบเครื่องดื่มให้คุณเรียบร้อยแล้ว (ไม่ใช่ตอนชำระเงิน)</li>
          <li>สะสมครบ {goal} เมล็ด แลกเครื่องดื่มฟรีได้ 1 แก้ว เลือกได้จากเมนูที่มีในตะกร้าตอนนั้น</li>
          <li>เมล็ดและรางวัลผูกกับเบอร์โทรศัพท์ที่ใช้สั่งซื้อ ไม่มีวันหมดอายุ</li>
        </ul>
        <button type="button" style={{ ...btn, width: "100%", marginTop: 18, textAlign: "center" }} onClick={onClose}>ปิด</button>
      </div>
    </div>
  );
}

const STATUS_ICON = {
  pending: { icon: "clock", color: COLORS.pending, bg: COLORS.pendingLight, anim: "statusPulse 1.6s ease-in-out infinite" },
  paid: { icon: "checks", color: COLORS.espresso4, bg: "rgba(11,74,122,0.14)", anim: "cartBump .5s ease" },
  preparing: { icon: "chef-hat", color: COLORS.sage, bg: COLORS.sageLight, anim: "pulseCup 1.3s ease-in-out infinite" },
  ready: { icon: "bell", color: COLORS.success, bg: COLORS.successLight, anim: "successPop .5s cubic-bezier(.34,1.56,.64,1)" },
  done: { icon: "circle-check", color: COLORS.successDark, bg: COLORS.successLight, anim: "successPop .5s cubic-bezier(.34,1.56,.64,1)" },
  cancelled: { icon: "x", color: COLORS.danger, bg: "rgba(178,58,46,0.14)", anim: "none" },
};

function OrderStatusIcon({ status, size = 20 }) {
  const cfg = STATUS_ICON[status] || STATUS_ICON.pending;
  const boxSize = size + 20;
  return (
    <div style={{
      width: boxSize, height: boxSize, borderRadius: "50%", background: cfg.bg,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <i className={`ti ti-${cfg.icon}`} style={{ fontSize: size, color: cfg.color, animation: cfg.anim, display: "inline-block" }} aria-hidden="true"></i>
    </div>
  );
}

const GLASS_PANEL = {
  background: "rgba(255,255,255,0.42)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.55)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 8px 24px rgba(43,29,20,0.10)",
};

function GlassBackdrop() {
  return (
    <div className="customer-backdrop" style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", background: "linear-gradient(160deg, #F7F1E7, #ECE1CE)" }}>
      <div style={{ position: "absolute", top: "-10%", left: "-10%", width: "55%", height: "45%", borderRadius: "50%", background: "#0B4A7A", opacity: 0.35, filter: "blur(70px)", animation: "blobFloat1 16s ease-in-out infinite" }} />
      <div style={{ position: "absolute", top: "-5%", right: "-12%", width: "45%", height: "40%", borderRadius: "50%", background: "#CE560D", opacity: 0.3, filter: "blur(70px)", animation: "blobFloat2 18s ease-in-out infinite" }} />
      <div style={{ position: "absolute", bottom: "-15%", left: "20%", width: "60%", height: "50%", borderRadius: "50%", background: "#A66F42", opacity: 0.28, filter: "blur(80px)", animation: "blobFloat3 20s ease-in-out infinite" }} />
    </div>
  );
}

function money(n) {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function genLineId() {
  return "line_" + Math.random().toString(36).slice(2, 9);
}

const HOT_DEAL_CATEGORY = "HOT DEAL";

function productTypeOf(item) {
  if (item?.productType === "food") return "food";
  if (item?.productType === "drink") return "drink";
  return /ขนมปัง|เบเกอรี่|อาหาร|toast|bread|bakery/i.test(item?.category || "") ? "food" : "drink";
}

function productUnitLabel(item) {
  return productTypeOf(item) === "food" ? "ชิ้น" : "แก้ว";
}

function singlePromoPrice(promo, menu) {
  if (!menu) return 0;
  const val = promo.discountType === "percent"
    ? menu.priceStore * (1 - (Number(promo.discountValue) || 0) / 100)
    : Number(promo.discountValue) || 0;
  return Math.max(0, Math.round(val * 100) / 100);
}

function splitBundlePrices(promo, menusById) {
  const items = (promo.menuIds || []).map((id) => menusById[id]).filter(Boolean);
  const originalTotal = items.reduce((s, m) => s + m.priceStore, 0);
  const promoTotal = promo.discountType === "percent"
    ? originalTotal * (1 - (Number(promo.discountValue) || 0) / 100)
    : Number(promo.discountValue) || 0;
  const clampedTotal = Math.max(0, Math.round(promoTotal * 100) / 100);
  let allocated = 0;
  return items.map((m, idx) => {
    let price;
    if (idx === items.length - 1) {
      price = clampedTotal - allocated;
    } else {
      price = originalTotal > 0 ? Math.round((m.priceStore / originalTotal) * clampedTotal * 100) / 100 : 0;
      allocated += price;
    }
    return { menuId: m.id, name: m.name, imageUrl: m.imageUrl, unitPrice: Math.max(0, Math.round(price * 100) / 100) };
  });
}

function qtyPromoTotal(promo, menu, qty) {
  if (!menu || qty <= 0) return 0;
  const setSize = Math.max(1, Number(promo.minQty) || 2);
  const sets = Math.floor(qty / setSize);
  const remainder = qty % setSize;
  const setPrice = promo.discountType === "percent"
    ? menu.priceStore * setSize * (1 - (Number(promo.discountValue) || 0) / 100)
    : Number(promo.discountValue) || 0;
  const total = sets * setPrice + remainder * menu.priceStore;
  return Math.max(0, Math.round(total * 100) / 100);
}

function qtyPromoUnitPrice(promo, menu, qty) {
  const total = qtyPromoTotal(promo, menu, qty);
  return qty > 0 ? Math.max(0, Math.round((total / qty) * 100) / 100) : 0;
}

function splitChoicePrices(promo, chosenMenus) {
  const sum = chosenMenus.reduce((s, m) => s + m.priceStore, 0);
  const total = promo.discountType === "percent"
    ? sum * (1 - (Number(promo.discountValue) || 0) / 100)
    : Number(promo.discountValue) || 0;
  const clampedTotal = Math.max(0, Math.round(total * 100) / 100);
  let allocated = 0;
  return chosenMenus.map((m, idx) => {
    let price;
    if (idx === chosenMenus.length - 1) {
      price = clampedTotal - allocated;
    } else {
      price = sum > 0 ? Math.round((m.priceStore / sum) * clampedTotal * 100) / 100 : 0;
      allocated += price;
    }
    return { menuId: m.id, name: m.name, unitPrice: Math.max(0, Math.round(price * 100) / 100) };
  });
}

function promoInWindow(promo) {
  const now = Date.now();
  if (promo.startAt && now < promo.startAt) return false;
  if (promo.endAt && now > promo.endAt) return false;
  return true;
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

function formatPickupDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function loadMyOrderIds(shopUid) {
  try {
    return JSON.parse(localStorage.getItem(`myOrders_${shopUid}`) || "[]");
  } catch {
    return [];
  }
}

function saveMyOrderId(shopUid, orderId) {
  const ids = loadMyOrderIds(shopUid).filter((id) => id !== orderId);
  ids.unshift(orderId);
  localStorage.setItem(`myOrders_${shopUid}`, JSON.stringify(ids.slice(0, 20)));
}

const btn = {
  border: "1px solid rgba(255,255,255,0.6)",
  background: "rgba(255,255,255,0.5)",
  backdropFilter: "blur(14px) saturate(180%)",
  WebkitBackdropFilter: "blur(14px) saturate(180%)",
  color: COLORS.espresso4, borderRadius: 11,
  padding: "9px 14px", fontSize: 13.5, fontWeight: 500, cursor: "pointer",
};
const btnAccent = {
  ...btn, background: COLORS.sage, color: "#fff", borderColor: COLORS.sage, width: "100%",
  backdropFilter: "none", WebkitBackdropFilter: "none",
};
const field = {
  width: "100%", border: "1px solid rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.55)",
  borderRadius: 10, padding: "9px 10px", fontSize: 14, boxSizing: "border-box", marginTop: 4,
};
const overlay = {
  position: "fixed", inset: 0, background: "rgba(43,29,20,0.35)",
  backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
  display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50,
};
const centerWrap = {
  minHeight: "100vh", fontFamily: "'Inter', sans-serif", color: COLORS.espresso4,
  display: "flex", justifyContent: "center", padding: "20px 12px",
  animation: "pageIn .32s cubic-bezier(.22,1,.36,1) both",
};
const centerCard = {
  ...GLASS_PANEL, borderRadius: 20, padding: 20, width: "100%", maxWidth: 420, height: "fit-content",
};

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
  .corder * { box-sizing: border-box; }
  .corder button { font-family: inherit; cursor: pointer; }
  .corder ::-webkit-scrollbar { display: none; }
  .corder { scrollbar-width: none; }
  .offer-carousel { -webkit-overflow-scrolling: touch; }
  .offer-card { transition: transform .25s ease, box-shadow .25s ease; }
  .offer-card:hover { transform: translateY(-2px) scale(1.02); box-shadow: 0 14px 32px rgba(43,29,20,0.18); }
  .offer-card:active { transform: scale(0.98); }
  .offer-arrow-btn { transition: transform .2s ease, background .2s ease; }
  .offer-arrow-btn:hover { transform: scale(1.08); background: #d8f0de; }
  .offer-arrow-btn:active { transform: scale(0.94); }
  .banner-carousel { touch-action: pan-y; }
  .banner-slide { transition: opacity .45s ease; }
  .banner-carousel:focus-visible { outline: 3px solid rgba(6,51,96,.42); outline-offset: 2px; }
  @keyframes offerRipple { 0% { transform: scale(0); opacity: .5; } 100% { transform: scale(2.4); opacity: 0; } }
  .offer-ripple { position: absolute; inset: 0; border-radius: inherit; background: rgba(6,51,96,0.18); animation: offerRipple .5s ease-out; pointer-events: none; }
  .zone-header { transition: box-shadow .25s ease; }
  .zone-icon-btn { transition: transform .25s ease, box-shadow .25s ease; }
  .zone-icon-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.14); }
  .zone-icon-btn:active { transform: translateY(0) scale(0.94); }
  @keyframes pulseCup { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.08); opacity: .75; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes logoReveal {
    0% { opacity: 0; transform: scale(0.55); filter: blur(14px); }
    55% { opacity: 1; transform: scale(1.06); filter: blur(0); }
    75% { transform: scale(0.98); }
    100% { opacity: 1; transform: scale(1); filter: blur(0); }
  }
  @keyframes logoBreathe {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-8px) scale(1.025); }
  }
  @keyframes ringRipple {
    0% { transform: scale(0.55); opacity: 0; }
    18% { opacity: .55; }
    100% { transform: scale(1.9); opacity: 0; }
  }
  @keyframes haloSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes successPop {
    0% { transform: scale(0.4); opacity: 0; }
    60% { transform: scale(1.12); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes checkDraw {
    from { stroke-dashoffset: 48; }
    to { stroke-dashoffset: 0; }
  }
  @keyframes blobFloat1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(6%,-8%) scale(1.1); } }
  @keyframes blobFloat2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-8%,6%) scale(1.06); } }
  @keyframes blobFloat3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(5%,5%) scale(1.12); } }
  @keyframes flyToCart {
    0% { transform: translate(0,0) scale(1); opacity: 1; }
    50% { transform: translate(calc(var(--dx) * 0.6), calc(var(--dy) * 0.5 - 50px)) scale(0.7); opacity: 1; }
    100% { transform: translate(var(--dx), var(--dy)) scale(0.15); opacity: 0; }
  }
  @keyframes cartBump {
    0% { transform: scale(1); }
    40% { transform: scale(1.25); }
    100% { transform: scale(1); }
  }
  @keyframes pageIn {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes statusPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .4; }
  }
  .corder button:active { transform: scale(0.94); }
  html[data-theme="dark"] .corder { color-scheme: dark; color: #E7ECF3 !important; }
  html[data-theme="dark"] .customer-backdrop { background: linear-gradient(160deg, #08111D, #111B28) !important; }
  html[data-theme="dark"] .customer-backdrop > div { opacity: .16 !important; }
  html[data-theme="dark"] .corder input,
  html[data-theme="dark"] .corder select,
  html[data-theme="dark"] .corder textarea { background: rgba(16,26,39,.92) !important; color: #E7ECF3 !important; border-color: #344256 !important; }
  html[data-theme="dark"] .corder [style*="background: rgb(255, 255, 255)"],
  html[data-theme="dark"] .corder [style*="background: rgba(255, 255, 255"] { background: rgba(18,28,41,.88) !important; border-color: rgba(148,163,184,.20) !important; }
  html[data-theme="dark"] .corder [style*="color: rgb(6, 51, 96)"],
  html[data-theme="dark"] .corder [style*="color: rgb(11, 74, 122)"],
  html[data-theme="dark"] .corder [style*="color: rgb(58, 85, 112)"] { color: #E7ECF3 !important; }
  html[data-theme="dark"] .corder [style*="color: rgb(113, 137, 163)"] { color: #A9B5C5 !important; }
  html[data-theme="dark"] .corder [style*="background: rgb(245, 240, 234)"],
  html[data-theme="dark"] .corder [style*="background: rgb(237, 227, 210)"] { background: #111B28 !important; }
  html[data-theme="dark"] .corder .zone-header { background: rgba(15,24,36,.94) !important; border: 1px solid rgba(148,163,184,.16); box-shadow: 0 10px 30px rgba(0,0,0,.28) !important; }
  html[data-theme="dark"] .corder .zone-logo-shell { background: #F8F6F2 !important; border-color: rgba(255,255,255,.16) !important; }
  html[data-theme="dark"] .corder .zone-logo-shell div { color: #163B73 !important; }
  html[data-theme="dark"] .corder .customer-category-nav { background: rgba(15,24,36,.82) !important; border-color: rgba(148,163,184,.16) !important; }
  html[data-theme="dark"] .corder .customer-category-tab { color: #A9B5C5 !important; }
  html[data-theme="dark"] .corder .customer-category-tab.active { background: #26364A !important; color: #F4F7FB !important; box-shadow: 0 3px 10px rgba(0,0,0,.28) !important; }
  html[data-theme="dark"] .corder .customer-option-choice { background: #172333 !important; color: #E7ECF3 !important; border-color: #344256 !important; }
  html[data-theme="dark"] .corder .customer-option-choice.selected { background: rgba(206,86,13,.22) !important; color: #FFF4EA !important; border-color: #E9782F !important; }
  html[data-theme="dark"] .corder .customer-option-choice [style*="color"] { color: #B8C4D2 !important; }
  .closed-order-page {
    min-height: 100vh; min-height: 100dvh; position: relative; isolation: isolate; overflow: hidden;
    display: grid; place-items: center; padding: 28px 18px; color: #F9F5EF;
    background: radial-gradient(circle at 12% 12%, rgba(218,111,40,.22), transparent 31%), radial-gradient(circle at 88% 86%, rgba(56,118,158,.26), transparent 36%), linear-gradient(145deg, #061F39 0%, #082B4F 48%, #0B3D67 100%);
  }
  .closed-order-page::before {
    content: ""; position: absolute; inset: 0; z-index: -2; opacity: .16;
    background-image: radial-gradient(rgba(255,255,255,.9) .7px, transparent .7px); background-size: 22px 22px;
    mask-image: linear-gradient(to bottom, black, transparent 82%); -webkit-mask-image: linear-gradient(to bottom, black, transparent 82%);
  }
  .closed-order-glow { position: absolute; border-radius: 50%; filter: blur(2px); pointer-events: none; animation: closedGlowFloat 9s ease-in-out infinite; }
  .closed-order-panel {
    width: min(100%, 460px); position: relative; overflow: hidden; padding: 26px 24px 22px;
    border: 1px solid rgba(255,255,255,.16); border-radius: 32px; text-align: center;
    background: linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.055));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.17), 0 28px 70px rgba(0,0,0,.28);
    backdrop-filter: blur(24px) saturate(135%); -webkit-backdrop-filter: blur(24px) saturate(135%);
    animation: closedPanelIn .75s cubic-bezier(.22,1,.36,1) both;
  }
  .closed-order-brand {
    display: inline-flex; align-items: center; gap: 10px; max-width: 100%; padding: 7px 12px 7px 7px;
    border: 1px solid rgba(255,255,255,.13); border-radius: 999px; background: rgba(3,18,34,.24);
    animation: closedFadeUp .55s .08s ease both;
  }
  .closed-order-brand-logo { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; overflow: hidden; border-radius: 11px; background: #F8F6F2; }
  .closed-order-art { width: 190px; height: 174px; position: relative; margin: 20px auto 4px; animation: closedFadeUp .65s .14s cubic-bezier(.22,1,.36,1) both; }
  .closed-order-orbit { position: absolute; inset: 3px 12px 0; border: 1px solid rgba(255,255,255,.13); border-radius: 50%; animation: closedOrbitSpin 13s linear infinite; }
  .closed-order-orbit::before, .closed-order-orbit::after {
    content: ""; position: absolute; width: 9px; height: 13px; border-radius: 50%; background: #E6782F;
    box-shadow: inset -2px -2px 0 rgba(84,32,8,.22), 0 0 18px rgba(230,120,47,.48);
  }
  .closed-order-orbit::before { top: 19px; right: 22px; transform: rotate(32deg); }
  .closed-order-orbit::after { bottom: 12px; left: 30px; transform: rotate(-40deg); }
  .closed-order-saucer { position: absolute; left: 40px; bottom: 19px; width: 112px; height: 17px; border-radius: 50%; background: linear-gradient(to bottom, #DDE8ED, #7895A7); box-shadow: 0 12px 25px rgba(0,0,0,.26); }
  .closed-order-cup {
    position: absolute; left: 49px; bottom: 29px; width: 93px; height: 80px; border-radius: 12px 12px 32px 32px;
    background: linear-gradient(135deg, #FFFDFC, #D9E7EC 70%, #B4CBD6); box-shadow: inset 6px 0 8px rgba(255,255,255,.65), 0 14px 22px rgba(0,0,0,.18);
    animation: closedCupBreathe 3.4s ease-in-out infinite;
  }
  .closed-order-cup::before {
    content: ""; position: absolute; left: 5px; right: 5px; top: -7px; height: 17px; border-radius: 50%;
    border: 4px solid #EAF1F3; background: radial-gradient(ellipse, #C97539 0 45%, #64361F 47% 65%, #EAF1F3 67%);
  }
  .closed-order-cup::after { content: ""; position: absolute; right: -29px; top: 16px; width: 36px; height: 40px; border: 9px solid #D9E7EC; border-left: 0; border-radius: 0 28px 28px 0; }
  .closed-order-steam {
    position: absolute; bottom: 111px; width: 14px; height: 54px; border-left: 3px solid rgba(255,255,255,.58);
    border-radius: 50%; filter: blur(.3px); opacity: 0; animation: closedSteam 2.8s ease-in-out infinite;
  }
  .closed-order-steam.s1 { left: 78px; }
  .closed-order-steam.s2 { left: 101px; height: 66px; animation-delay: .8s; }
  .closed-order-steam.s3 { left: 122px; height: 48px; animation-delay: 1.55s; }
  .closed-order-status {
    display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid rgba(244,166,111,.22);
    border-radius: 999px; color: #FFD2B2; background: rgba(206,86,13,.15); font-size: 11px; font-weight: 700; letter-spacing: .06em;
    animation: closedFadeUp .55s .22s ease both;
  }
  .closed-order-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #F18A42; box-shadow: 0 0 0 0 rgba(241,138,66,.55); animation: closedStatusPulse 2s ease-out infinite; }
  .closed-order-title {
    margin: 15px 0 8px; color: #FFFFFF; font-family: 'Space Grotesk', sans-serif; font-size: clamp(26px, 8vw, 36px);
    line-height: 1.08; letter-spacing: -.035em; animation: closedFadeUp .6s .28s ease both;
  }
  .closed-order-copy { max-width: 340px; margin: 0 auto; color: rgba(235,242,248,.72); font-size: 13.5px; line-height: 1.7; animation: closedFadeUp .6s .35s ease both; }
  .closed-order-live {
    display: flex; align-items: center; justify-content: center; gap: 8px; margin: 19px 0 0; padding-top: 17px;
    border-top: 1px solid rgba(255,255,255,.11); color: rgba(224,235,243,.67); font-size: 11.5px; animation: closedFadeUp .6s .42s ease both;
  }
  .closed-order-live i { color: #75B9DD; animation: closedRefresh 4s ease-in-out infinite; }
  .closed-order-button {
    width: 100%; min-height: 48px; margin-top: 14px; border: 1px solid rgba(255,255,255,.2); border-radius: 15px;
    color: #082B4F; background: #F9F5EF; box-shadow: 0 10px 24px rgba(0,0,0,.18); font-size: 13px; font-weight: 700;
    transition: transform .2s ease, box-shadow .2s ease, background .2s ease; animation: closedFadeUp .6s .48s ease both;
  }
  .closed-order-button:hover { transform: translateY(-2px); background: #FFFFFF; box-shadow: 0 14px 28px rgba(0,0,0,.24); }
  .closed-order-button:active { transform: scale(.98) !important; }
  @keyframes closedPanelIn { from { opacity: 0; transform: translateY(26px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes closedFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes closedGlowFloat { 0%, 100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(16px,-18px,0) scale(1.08); } }
  @keyframes closedOrbitSpin { to { transform: rotate(360deg); } }
  @keyframes closedCupBreathe { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-4px) rotate(1deg); } }
  @keyframes closedSteam { 0% { opacity: 0; transform: translate(2px,12px) scaleY(.75); } 30% { opacity: .72; } 100% { opacity: 0; transform: translate(-7px,-18px) scaleY(1.18); } }
  @keyframes closedStatusPulse { 0% { box-shadow: 0 0 0 0 rgba(241,138,66,.5); } 70%, 100% { box-shadow: 0 0 0 7px rgba(241,138,66,0); } }
  @keyframes closedRefresh { 0%, 70%, 100% { transform: rotate(0); } 82% { transform: rotate(180deg); } 94% { transform: rotate(360deg); } }
  @media (max-height: 680px) {
    .closed-order-page { padding-block: 14px; }
    .closed-order-panel { padding-block: 18px; }
    .closed-order-art { height: 142px; margin-top: 12px; }
    .closed-order-saucer { bottom: 2px; }
    .closed-order-cup { bottom: 12px; }
    .closed-order-steam { bottom: 94px; }
    .closed-order-title { margin-top: 11px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .banner-slide { transition-duration: 0ms; }
    .closed-order-page *, .closed-order-page *::before, .closed-order-page *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; }
  }
`;

function useAnimatedNumber(value, duration = 260) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef();

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return display;
}

function AnimatedQty({ value }) {
  return Math.round(useAnimatedNumber(value, 220));
}

function AnimatedMoney({ value }) {
  return money(useAnimatedNumber(value, 280));
}

function useSheetTransition(visible, duration = 300) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let raf;
    let timeout;
    if (visible) {
      setMounted(true);
      raf = requestAnimationFrame(() => setShown(true));
    } else {
      setShown(false);
      timeout = setTimeout(() => setMounted(false), duration);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [visible, duration]);

  return { mounted, shown };
}

function MenuThumb({ imageUrl, size = 60, productType = "drink" }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{
      width: size, height: size, borderRadius: 12, flexShrink: 0, overflow: "hidden",
      background: COLORS.sageLight, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {imageUrl && !failed ? (
        <img src={imageUrl} alt="" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <i className={`ti ti-${productType === "food" ? "bread" : "cup"}`} style={{ fontSize: size * 0.4, color: COLORS.sageDark }} aria-hidden="true"></i>
      )}
    </div>
  );
}

function PromoImageCell({ url }) {
  const [failed, setFailed] = useState(false);
  const ok = url && !failed;
  return (
    <div style={{
      position: "relative", width: "100%", height: "100%", background: COLORS.sageLight,
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
    }}>
      {ok ? (
        <img src={url} alt="" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <i className="ti ti-cup" style={{ fontSize: 16, color: COLORS.sageDark }} aria-hidden="true"></i>
      )}
    </div>
  );
}

function PromoImageGrid({ images, size = 72 }) {
  const list = images || [];
  if (list.length <= 1) return <MenuThumb imageUrl={list[0]} size={size} />;
  const containerStyle = { width: size, height: size, borderRadius: 14, overflow: "hidden", flexShrink: 0, background: COLORS.sageLight };
  if (list.length <= 3) {
    return (
      <div style={{ ...containerStyle, display: "flex", gap: 2 }}>
        {list.map((url, i) => <div key={i} style={{ flex: 1 }}><PromoImageCell url={url} /></div>)}
      </div>
    );
  }
  const shown = list.slice(0, 4);
  const extra = list.length - 4;
  return (
    <div style={{ ...containerStyle, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 2 }}>
      {shown.map((url, i) => {
        const isLast = i === 3 && extra > 0;
        return (
          <div key={i} style={{ position: "relative" }}>
            <PromoImageCell url={url} />
            {isLast && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(11,17,15,0.58)",
                display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: size * 0.2,
              }}>
                +{extra}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OfferCard({ images, label, title, subtitle, priceNode, qty, rippling, onClick, thumbRef }) {
  return (
    <div
      className="offer-card"
      onClick={onClick}
      style={{
        ...GLASS_PANEL,
        display: "flex", alignItems: "center", gap: 14, borderRadius: 18,
        padding: 16, height: 116, position: "relative", cursor: "pointer",
      }}
    >
      <div ref={thumbRef} style={{ flex: "0 0 92px" }}>
        <PromoImageGrid images={images} size={92} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10.5, fontWeight: 600, color: "#F97316", textTransform: "uppercase", letterSpacing: ".03em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{label}</div>
        <div style={{
          fontSize: 16.5, fontWeight: 700, color: COLORS.espresso5, marginTop: 3, lineHeight: 1.2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontSize: 11.5, color: COLORS.espresso2, marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{subtitle}</div>
        )}
        <div style={{ marginTop: 6, fontSize: 13.5 }}>{priceNode}</div>
      </div>
      {qty > 0 && (
        <div style={{
          position: "absolute", top: 10, right: 10, background: COLORS.sage, color: "#fff",
          fontSize: 11, fontWeight: 700, borderRadius: 999, minWidth: 22, height: 22,
          display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px",
        }}>
          <AnimatedQty value={qty} />
        </div>
      )}
      {rippling && <span className="offer-ripple" />}
    </div>
  );
}

function BannerSlide({ url, active, position, total }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (failed) return null;
  return (
    <img
      src={url}
      alt={active ? `แบนเนอร์โปรโมชั่น ${position} จาก ${total}` : ""}
      aria-hidden={!active}
      className="banner-slide"
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
        opacity: active ? 1 : 0,
      }}
      onError={() => setFailed(true)}
    />
  );
}

function BannerCarousel({ images }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pointerStartRef = useRef(null);
  const lastSwipeAtRef = useRef(0);
  const validImages = (images || []).filter(Boolean);
  const key = validImages.join("|");

  const goPrevious = () => setIndex((current) => (current - 1 + validImages.length) % validImages.length);
  const goNext = () => setIndex((current) => (current + 1) % validImages.length);

  useEffect(() => {
    setIndex(0);
  }, [key]);

  useEffect(() => {
    if (validImages.length <= 1 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % validImages.length), 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, key, paused]);

  if (validImages.length === 0) return null;

  return (
    <section
      className="banner-carousel"
      aria-label={`แบนเนอร์โปรโมชั่น ${index + 1} จาก ${validImages.length} แตะเพื่อ${paused ? "เล่นต่อ" : "หยุด"}`}
      aria-roledescription="carousel"
      aria-live="polite"
      tabIndex={validImages.length > 1 ? 0 : undefined}
      onClick={() => {
        if (Date.now() - lastSwipeAtRef.current < 350) return;
        if (validImages.length > 1) setPaused((value) => !value);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); goPrevious(); }
        if (event.key === "ArrowRight") { event.preventDefault(); goNext(); }
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); setPaused((value) => !value); }
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          pointerStartRef.current = event.clientX;
        }
      }}
      onPointerUp={(event) => {
        if (pointerStartRef.current === null || event.pointerType !== "touch") return;
        const distance = event.clientX - pointerStartRef.current;
        pointerStartRef.current = null;
        if (Math.abs(distance) < 35) return;
        lastSwipeAtRef.current = Date.now();
        if (distance > 0) goPrevious(); else goNext();
      }}
      onPointerCancel={() => { pointerStartRef.current = null; }}
      style={{
      margin: "10px 10px 0", borderRadius: 16, overflow: "hidden", position: "relative", height: 84,
      border: "1px solid rgba(255,255,255,0.55)", boxShadow: "0 8px 24px rgba(43,29,20,0.10)", flexShrink: 0,
      cursor: validImages.length > 1 ? "pointer" : "default",
    }}>
      {validImages.map((url, i) => (
        <BannerSlide key={url + i} url={url} active={i === index} position={i + 1} total={validImages.length} />
      ))}
      {validImages.length > 1 && (
        <div aria-hidden="true" style={{ position: "absolute", bottom: 6, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 4, pointerEvents: "none" }}>
          {validImages.length <= 12 ? validImages.map((_, i) => (
              <span key={i} style={{
                width: i === index ? 14 : 5, height: 5, borderRadius: 3,
                background: i === index ? "#fff" : "rgba(255,255,255,0.55)", transition: "width .25s ease",
                boxShadow: "0 1px 3px rgba(0,0,0,.2)",
              }} />
            )) : (
              <span style={{ padding: "2px 7px", borderRadius: 999, color: "#fff", background: "rgba(6,51,96,.58)", fontSize: 9.5, fontWeight: 700 }}>
                {index + 1} / {validImages.length}
              </span>
            )}
        </div>
      )}
    </section>
  );
}

function BrandLogo({ height = 64 }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: height * 0.42, letterSpacing: "-.01em", color: COLORS.espresso5 }}>ZONE 2</div>
        <div style={{ fontSize: height * 0.13, letterSpacing: ".25em", color: COLORS.sage, fontWeight: 600, marginTop: 2 }}>RESERVE BAR</div>
      </div>
    );
  }
  return <img src="/logo.png" alt="Zone 2 Reserve Bar" onError={() => setFailed(true)} style={{ height, width: "auto", display: "block" }} />;
}

function LandingScreen() {
  const ringBase = {
    position: "absolute", inset: 0, borderRadius: "50%",
    animation: "ringRipple 2.6s cubic-bezier(0.2, 0.6, 0.35, 1) infinite",
  };
  return (
    <div className="corder" style={{
      minHeight: "100vh", background: COLORS.cream, overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
    }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ position: "relative", width: 340, height: 340, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          position: "absolute", inset: -60, borderRadius: "50%",
          background: `conic-gradient(from 0deg, transparent 0deg, ${COLORS.sage}22 60deg, transparent 120deg, ${COLORS.espresso5}18 240deg, transparent 300deg)`,
          animation: "haloSpin 9s linear infinite", filter: "blur(2px)",
        }} />
        <div style={{ ...ringBase, border: `1.5px solid ${COLORS.espresso5}` }} />
        <div style={{ ...ringBase, border: `1.5px solid ${COLORS.sage}`, animationDelay: "0.9s" }} />
        <div style={{ ...ringBase, border: `1px solid ${COLORS.espresso5}`, animationDelay: "1.8s" }} />
        <div style={{
          position: "relative", zIndex: 1,
          animation: "logoReveal 1.4s cubic-bezier(0.22, 1, 0.36, 1) both, logoBreathe 3.2s ease-in-out 1.4s infinite",
        }}>
          <BrandLogo height={330} />
        </div>
      </div>
    </div>
  );
}

function ClosedOrderScreen({ shopName, hasOrders, onOpenOrders }) {
  return (
    <main className="corder closed-order-page">
      <style>{GLOBAL_CSS}</style>
      <div className="closed-order-glow" aria-hidden="true" style={{ width: 240, height: 240, top: "-90px", right: "-90px", background: "rgba(225,116,42,.15)" }} />
      <div className="closed-order-glow" aria-hidden="true" style={{ width: 310, height: 310, bottom: "-150px", left: "-130px", background: "rgba(86,161,202,.13)", animationDelay: "-4s" }} />

      <section className="closed-order-panel" aria-labelledby="closed-order-title">
        <div className="closed-order-brand">
          <span className="closed-order-brand-logo"><BrandLogo height={27} /></span>
          <span style={{ display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,.88)", fontSize: 11.5, fontWeight: 600, letterSpacing: ".025em" }}>
            {shopName || "ZONE 2 RESERVE BAR"}
          </span>
        </div>

        <div className="closed-order-art" aria-hidden="true">
          <div className="closed-order-orbit" />
          <span className="closed-order-steam s1" />
          <span className="closed-order-steam s2" />
          <span className="closed-order-steam s3" />
          <div className="closed-order-saucer" />
          <div className="closed-order-cup" />
        </div>

        <div className="closed-order-status"><span className="closed-order-status-dot" /> พักรับออเดอร์ชั่วคราว</div>
        <h1 id="closed-order-title" className="closed-order-title">กำลังเตรียมร้าน<br />ให้พร้อมเสิร์ฟ</h1>
        <p className="closed-order-copy">ตอนนี้ร้านขอพักรับออเดอร์ออนไลน์สักครู่ แล้วกลับมาแวะดูเมนูโปรดของคุณอีกครั้งนะ</p>

        <div className="closed-order-live" role="status">
          <i className="ti ti-refresh" aria-hidden="true" />
          <span>สถานะจะอัปเดตอัตโนมัติเมื่อร้านเปิดรับออเดอร์</span>
        </div>

        {hasOrders && (
          <button type="button" className="closed-order-button" onClick={onOpenOrders}>
            <i className="ti ti-receipt" style={{ fontSize: 16, marginRight: 7, verticalAlign: -2 }} aria-hidden="true" />
            ดูออเดอร์ของฉัน
          </button>
        )}
      </section>
    </main>
  );
}

export default function CustomerOrder({ shopUid }) {
  const [authUid, setAuthUid] = useState(null);
  const [shopName, setShopName] = useState("");
  const [menus, setMenus] = useState(null);
  const [optionGroups, setOptionGroups] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [promptpayId, setPromptpayId] = useState("");
  const [acceptingOrders, setAcceptingOrders] = useState(true);
  const [slipTestMode, setSlipTestMode] = useState(false);
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [bannerImageUrls, setBannerImageUrls] = useState([]);
  const [categoryOrder, setCategoryOrder] = useState([]);
  const [loyaltyBeanGoal, setLoyaltyBeanGoal] = useState(10);
  const [beanRecord, setBeanRecord] = useState(null);
  const [loyaltyStatus, setLoyaltyStatus] = useState("idle"); // idle | loading | loaded | error
  const [loyaltyRetryTick, setLoyaltyRetryTick] = useState(0);
  const beanUnsubRef = useRef(null);
  const [redeemLineId, setRedeemLineId] = useState(null);
  const [redeemMode, setRedeemMode] = useState(false);
  const [rewardOtpOpen, setRewardOtpOpen] = useState(false);
  const [rewardOtpStatus, setRewardOtpStatus] = useState("idle");
  const [rewardOtpCode, setRewardOtpCode] = useState("");
  const [rewardOtpError, setRewardOtpError] = useState("");
  const [rewardOtpResendAt, setRewardOtpResendAt] = useState(0);
  const [rewardVerification, setRewardVerification] = useState(null);
  const [redemptionAttemptId, setRedemptionAttemptId] = useState("");
  const rewardVerificationIdRef = useRef("");
  const rewardRecaptchaRef = useRef(null);
  const [showRewardTerms, setShowRewardTerms] = useState(false);
  const [cart, setCart] = useState([]);
  const [flyItems, setFlyItems] = useState([]);
  const [cartBump, setCartBump] = useState(false);
  const menuThumbRefs = useRef({});
  const cartIconRef = useRef(null);
  const prevCartCountRef = useRef(0);
  const [pickingMenu, setPickingMenu] = useState(null);
  const [pickingPromo, setPickingPromo] = useState(null);
  const [pickingChoicePromo, setPickingChoicePromo] = useState(null);
  const [choiceFlow, setChoiceFlow] = useState(null);
  const [bundleFlow, setBundleFlow] = useState(null);
  const [editingCartLine, setEditingCartLine] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("promptpay");
  const [pickupDate, setPickupDate] = useState(addDays(1));
  const [step, setStep] = useState("menu");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState(null);
  const [successCountdown, setSuccessCountdown] = useState(5);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [myOrders, setMyOrders] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [showCart, setShowCart] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [takeoverPromo, setTakeoverPromo] = useState(null);
  const [hasActiveOrder, setHasActiveOrder] = useState(false);
  const [headerRipple, setHeaderRipple] = useState(false);

  const mainRef = useRef(null);
  const sectionRefs = useRef({});
  const offerCarouselRef = useRef(null);
  const [offerRippleId, setOfferRippleId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 2000);
    return () => clearTimeout(t);
  }, []);

  // ฟัง auth state ตลอด ไม่ใช่ sign-in ครั้งเดียวตอนเปิดหน้า — เบราว์เซอร์บางตัว (เช่น in-app browser ของ LINE,
  // Safari private mode) ล้าง session ที่ persist ไว้กลางคันได้ ถ้า authUid ค้างค่าเก่าไว้ใน state เฉยๆ
  // ตอนกดยืนยันคำสั่งซื้อ auth.uid จริงบนฝั่ง server จะไม่ตรงกับ customerUid ที่ส่งไป ทำให้เจอ PERMISSION_DENIED
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setAuthUid(u.uid);
      } else {
        signInAnonymously(auth).catch((e) => setError("เข้าสู่ระบบไม่สำเร็จ: " + e.message));
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUid) return;
    const unsub1 = onValue(ref(db, `shops/${shopUid}/menus`), (snap) => setMenus(snap.val() || []));
    const unsub2 = onValue(ref(db, `shops/${shopUid}/settings/shopName`), (snap) => setShopName(snap.val() || "ร้านกาแฟ"));
    const unsub3 = onValue(ref(db, `shops/${shopUid}/settings/promptpayId`), (snap) => setPromptpayId(snap.val() || ""));
    const unsub4 = onValue(ref(db, `shops/${shopUid}/optionGroups`), (snap) => setOptionGroups(snap.val() || []));
    const unsub5 = onValue(
      ref(db, `shops/${shopUid}/settings/acceptingOrders`),
      (snap) => setAcceptingOrders(snap.val() !== false),
      (err) => console.error("อ่านสถานะเปิด/ปิดร้านไม่ได้ (เช็คว่า publish database.rules.json ล่าสุดหรือยัง):", err.message)
    );
    const unsub6 = onValue(ref(db, `shops/${shopUid}/settings/slipTestMode`), (snap) => setSlipTestMode(snap.val() === true));
    const unsub7 = onValue(ref(db, `shops/${shopUid}/settings/bannerImageUrl`), (snap) => setBannerImageUrl(snap.val() || ""));
    const unsub7b = onValue(ref(db, `shops/${shopUid}/settings/bannerImageUrls`), (snap) => setBannerImageUrls(snap.val() || []));
    const unsub9 = onValue(ref(db, `shops/${shopUid}/settings/categoryOrder`), (snap) => setCategoryOrder(snap.val() || []));
    const unsub10 = onValue(ref(db, `shops/${shopUid}/settings/loyaltyBeanGoal`), (snap) => setLoyaltyBeanGoal(snap.val() || 10));
    const unsub8 = onValue(ref(db, `shops/${shopUid}/promotions`), (snap) => {
      const list = snap.val() || [];
      setPromotions(list.map((p) => ({
        ...p,
        type: p.type || (p.menuIds && p.menuIds.length > 1 ? "bundle" : "single"),
        minQty: p.minQty || 2,
        chooseCount: p.chooseCount || 2,
      })));
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); unsub7b(); unsub8(); unsub9(); unsub10(); };
  }, [authUid, shopUid]);

  // เช็คเมล็ดสะสมของเบอร์นี้แบบสด — debounce กันยิง query ทุกครั้งที่พิมพ์ และรอให้เบอร์ครบอย่างน้อย 9 หลักก่อน
  // แยกสถานะ loading/error ออกจากตัวข้อมูล เพื่อให้ UI บอกลูกค้าได้ว่ากำลังโหลดอยู่ หรือโหลดไม่สำเร็จ (ไม่ใช่แค่ "ยังไม่มีข้อมูล")
  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 9) { setBeanRecord(null); setLoyaltyStatus("idle"); return; }
    setLoyaltyStatus("loading");
    const t = setTimeout(() => {
      const unsub = onValue(
        ref(db, `customers/${shopUid}/${digits}`),
        (snap) => {
          setBeanRecord(snap.exists() ? snap.val() : { beans: 0, lifetimeBeans: 0, isNew: true });
          setLoyaltyStatus("loaded");
        },
        () => setLoyaltyStatus("error")
      );
      beanUnsubRef.current = unsub;
    }, 400);
    return () => {
      clearTimeout(t);
      if (beanUnsubRef.current) { beanUnsubRef.current(); beanUnsubRef.current = null; }
    };
  }, [phone, shopUid, loyaltyRetryTick]);

  useEffect(() => {
    if (!order) return;
    const unsub = onValue(ref(db, `orders/${shopUid}/${order.id}/status`), (snap) => {
      if (snap.exists()) setOrder((prev) => (prev ? { ...prev, status: snap.val() } : prev));
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  useEffect(() => {
    if (step !== "success") return;
    setSuccessCountdown(5);
    const interval = setInterval(() => {
      setSuccessCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

  useEffect(() => {
    if (step === "success" && successCountdown === 0) {
      resetOrderFlow();
      openMyOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, successCountdown]);

  function resetOrderFlow() {
    setCart([]);
    setName("");
    setPhone("");
    setNote("");
    setPaymentMethod("promptpay");
    setPickupDate(addDays(1));
    setOrder(null);
    setQrDataUrl(null);
    setError("");
    setRedeemLineId(null);
    setRedeemMode(false);
    setRewardVerification(null);
    setRedemptionAttemptId("");
    setRewardOtpOpen(false);
    setRewardOtpStatus("idle");
    setRewardOtpCode("");
  }

  const menusById = useMemo(() => {
    const m = {};
    (menus || []).forEach((x) => { m[x.id] = x; });
    return m;
  }, [menus]);

  const shopNameParts = useMemo(() => {
    const [first, ...rest] = (shopName || "").split(" - ");
    return [first, rest.join(" - ").trim()];
  }, [shopName]);

  const activePromotions = useMemo(() => {
    return (promotions || []).filter((p) => {
      if (p.active === false) return false;
      if (!p.menuIds || p.menuIds.length === 0) return false;
      if (!promoInWindow(p)) return false;
      if (p.type === "choice") {
        const availableCount = p.menuIds.filter((id) => menusById[id] && menusById[id].available !== false).length;
        return availableCount >= (p.chooseCount || 1);
      }
      return p.menuIds.every((id) => menusById[id] && menusById[id].available !== false);
    });
  }, [promotions, menusById]);

  const closePromotionTakeover = useCallback(() => setTakeoverPromo(null), []);

  useEffect(() => {
    if (!splashDone || !acceptingOrders || step !== "menu") return;
    const featuredPromo = activePromotions.find((promo) => promo.showAsPopup === true);
    if (!featuredPromo) return;
    const sessionKey = `promotionTakeover:${shopUid}:${featuredPromo.id}`;
    try {
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, "shown");
    } catch {
      // เปิดต่อได้แม้ browser จำกัด sessionStorage เช่น private/in-app browser บางรุ่น
    }
    setTakeoverPromo(featuredPromo);
  }, [splashDone, acceptingOrders, step, activePromotions, shopUid]);

  const categories = useMemo(() => {
    if (!menus) return [];
    const seen = [];
    for (const m of menus) if (!seen.includes(m.category)) seen.push(m.category);
    const ordered = categoryOrder && categoryOrder.length
      ? [...categoryOrder.filter((c) => seen.includes(c)), ...seen.filter((c) => !categoryOrder.includes(c))]
      : seen;
    return activePromotions.length > 0 ? [HOT_DEAL_CATEGORY, ...ordered] : ordered;
  }, [menus, activePromotions, categoryOrder]);

  useEffect(() => {
    if (categories.length > 0 && !activeCategory) setActiveCategory(categories[0]);
  }, [categories, activeCategory]);

  useEffect(() => {
    if (step !== "menu" || !mainRef.current || categories.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveCategory(visible[0].target.dataset.category);
      },
      { root: mainRef.current, rootMargin: "-10% 0px -75% 0px", threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [step, categories, menus]);

  function scrollToCategory(cat) {
    setActiveCategory(cat);
    sectionRefs.current[cat]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function groupsForMenu(menu) {
    const ids = menu.optionGroupIds || [];
    return optionGroups.filter((g) => ids.includes(g.id));
  }

  function linesForMenu(menuId, promoId = null) {
    return cart.filter((l) => l.menuId === menuId && (l.promoId || null) === promoId);
  }

  function qtyForMenu(menuId, promoId = null) {
    return linesForMenu(menuId, promoId).reduce((s, l) => s + l.qty, 0);
  }

  function spawnFly(refKey, imageUrl) {
    const startEl = menuThumbRefs.current[refKey];
    const startRect = startEl && startEl.getBoundingClientRect();
    if (!startRect) return;
    const cartRect = cartIconRef.current && cartIconRef.current.getBoundingClientRect();
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;
    const endX = cartRect ? cartRect.left + cartRect.width / 2 : 40;
    const endY = cartRect ? cartRect.top + cartRect.height / 2 : window.innerHeight - 40;
    const id = Math.random().toString(36).slice(2);
    setFlyItems((list) => [...list, { id, imageUrl, startX, startY, dx: endX - startX, dy: endY - startY }]);
    setTimeout(() => setFlyItems((list) => list.filter((f) => f.id !== id)), 650);
  }

  function scrollOfferCarousel(dir) {
    const el = offerCarouselRef.current;
    if (!el) return;
    const card = el.firstElementChild;
    const step = card ? card.getBoundingClientRect().width + 14 : el.clientWidth;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  function triggerOfferRipple(id) {
    setOfferRippleId(id);
    setTimeout(() => setOfferRippleId((cur) => (cur === id ? null : cur)), 500);
  }

  function openMenu(menu, promo) {
    if (menu.available === false) return;
    const groups = groupsForMenu(menu);
    const isQty = promo && promo.type === "qty";
    const priceOverride = promo ? (isQty ? qtyPromoUnitPrice(promo, menu, 1) : singlePromoPrice(promo, menu)) : undefined;
    const promoId = promo ? promo.id : null;
    const promoKind = promo ? (isQty ? "qty" : "single") : null;
    const refKey = promo ? "promo_" + menu.id : menu.id;
    if (groups.length === 0) {
      spawnFly(refKey, menu.imageUrl);
      const existing = cart.find((l) => l.menuId === menu.id && l.options.length === 0 && (l.promoId || null) === promoId);
      if (existing) setLineQty(existing.lineId, existing.qty + 1);
      else addToCart(menu, 1, [], priceOverride, promoId, promoKind);
      return;
    }
    setPickingMenu(menu);
    setPickingPromo(promo || null);
  }

  function addToCart(menu, qty, options, priceOverride, promoId, promoKind) {
    const optionDelta = options.reduce((s, o) => s + (o.priceDelta || 0), 0);
    const base = priceOverride !== undefined ? priceOverride : menu.priceStore;
    const unitPrice = base + optionDelta;
    setCart((c) => [...c, {
      lineId: genLineId(), menuId: menu.id, name: menu.name, productType: productTypeOf(menu), unitPrice, originalUnitPrice: menu.priceStore + optionDelta,
      qty, options, promoId: promoId || null, promoGroupId: promoId || null, promoKind: promoKind || null,
    }]);
  }

  function bundleQtyInCart(promo) {
    const first = promo.menuIds[0];
    const line = cart.find((l) => l.menuId === first && l.promoId === promo.id);
    return line ? line.qty : 0;
  }

  function setBundleQty(promo, qty, optionsByMenuId) {
    if (qty <= 0) {
      setCart((c) => c.filter((l) => l.promoId !== promo.id));
      return;
    }
    const prices = splitBundlePrices(promo, menusById);
    setCart((c) => {
      const others = c.filter((l) => l.promoId !== promo.id);
      const newLines = prices.map((p) => {
        const existing = c.find((l) => l.promoId === promo.id && l.menuId === p.menuId);
        const opts = existing ? existing.options : ((optionsByMenuId && optionsByMenuId[p.menuId]) || []);
        const optionDelta = opts.reduce((s, o) => s + (o.priceDelta || 0), 0);
        return {
          lineId: existing ? existing.lineId : genLineId(),
          menuId: p.menuId, name: p.name, productType: productTypeOf(menusById[p.menuId]), unitPrice: p.unitPrice + optionDelta,
          originalUnitPrice: (Number(menusById[p.menuId]?.priceStore) || 0) + optionDelta,
          qty, options: opts, promoId: promo.id, promoGroupId: promo.id, promoKind: "bundle",
        };
      });
      return [...others, ...newLines];
    });
  }

  function addBundle(promo, optionsByMenuId) {
    setBundleQty(promo, bundleQtyInCart(promo) + 1, optionsByMenuId);
  }

  function startBundleFlow(promo) {
    if (bundleQtyInCart(promo) > 0) {
      addBundle(promo);
      return;
    }
    const items = promo.menuIds.map((id) => menusById[id]).filter(Boolean);
    const needsOptions = items.filter((m) => groupsForMenu(m).length > 0);
    if (needsOptions.length === 0) {
      addBundle(promo);
      return;
    }
    setBundleFlow({ promo, queue: needsOptions, index: 0, optionsByMenuId: {} });
  }

  function openTakeoverPromotion(promo) {
    closePromotionTakeover();
    if (promo.type === "choice") {
      setPickingChoicePromo(promo);
      return;
    }
    if (promo.type === "bundle") {
      startBundleFlow(promo);
      return;
    }
    const menu = menusById[promo.menuIds?.[0]];
    if (menu) openMenu(menu, promo);
  }

  function confirmBundleFlowStep(qty, options) {
    if (!bundleFlow) return;
    const menu = bundleFlow.queue[bundleFlow.index];
    const nextOptions = { ...bundleFlow.optionsByMenuId, [menu.id]: options };
    const nextIndex = bundleFlow.index + 1;
    if (nextIndex >= bundleFlow.queue.length) {
      addBundle(bundleFlow.promo, nextOptions);
      setBundleFlow(null);
    } else {
      setBundleFlow({ ...bundleFlow, index: nextIndex, optionsByMenuId: nextOptions });
    }
  }

  function addChoiceSet(promo, chosenMenus, optionsByMenuId) {
    const setId = promo.id + "_" + Math.random().toString(36).slice(2, 8);
    const prices = splitChoicePrices(promo, chosenMenus);
    setCart((c) => [
      ...c,
      ...prices.map((p) => {
        const opts = (optionsByMenuId && optionsByMenuId[p.menuId]) || [];
        const optionDelta = opts.reduce((s, o) => s + (o.priceDelta || 0), 0);
        return {
          lineId: genLineId(), menuId: p.menuId, name: p.name, productType: productTypeOf(menusById[p.menuId]), unitPrice: p.unitPrice + optionDelta, options: opts, qty: 1,
          originalUnitPrice: (Number(menusById[p.menuId]?.priceStore) || 0) + optionDelta,
          promoId: setId, promoKind: "choice", promoGroupId: promo.id,
        };
      }),
    ]);
  }

  function startChoiceFlow(promo, chosenMenus) {
    const needsOptions = chosenMenus.filter((m) => groupsForMenu(m).length > 0);
    if (needsOptions.length === 0) {
      addChoiceSet(promo, chosenMenus);
      return;
    }
    setChoiceFlow({ promo, chosenMenus, queue: needsOptions, index: 0, optionsByMenuId: {} });
  }

  function confirmChoiceFlowStep(qty, options) {
    if (!choiceFlow) return;
    const menu = choiceFlow.queue[choiceFlow.index];
    const nextOptions = { ...choiceFlow.optionsByMenuId, [menu.id]: options };
    const nextIndex = choiceFlow.index + 1;
    if (nextIndex >= choiceFlow.queue.length) {
      addChoiceSet(choiceFlow.promo, choiceFlow.chosenMenus, nextOptions);
      setChoiceFlow(null);
    } else {
      setChoiceFlow({ ...choiceFlow, index: nextIndex, optionsByMenuId: nextOptions });
    }
  }

  function removeLine(lineId) {
    setCart((c) => c.filter((l) => l.lineId !== lineId));
  }

  function removeCartLine(line) {
    if (line.promoKind === "bundle" || line.promoKind === "choice") {
      setCart((c) => c.filter((l) => l.promoId !== line.promoId));
    } else {
      removeLine(line.lineId);
    }
  }

  function canEditLineOptions(line) {
    if (line.promoKind === "bundle" || line.promoKind === "choice") return false;
    const menu = menusById[line.menuId];
    if (!menu) return false;
    return groupsForMenu(menu).length > 0;
  }

  function confirmEditCartLine(line, options) {
    const oldDelta = (line.options || []).reduce((s, o) => s + (o.priceDelta || 0), 0);
    const base = line.unitPrice - oldDelta;
    const newDelta = options.reduce((s, o) => s + (o.priceDelta || 0), 0);
    setCart((c) => c.map((l) => (l.lineId === line.lineId ? { ...l, options, unitPrice: base + newDelta } : l)));
    setEditingCartLine(null);
  }

  function setLineQty(lineId, qty) {
    if (qty <= 0) { removeLine(lineId); return; }
    setCart((c) => c.map((l) => {
      if (l.lineId !== lineId) return l;
      if (l.promoKind === "qty") {
        const menu = menusById[l.menuId];
        const promo = (promotions || []).find((p) => p.id === l.promoId);
        if (menu && promo) {
          const optionDelta = (l.options || []).reduce((s, o) => s + (o.priceDelta || 0), 0);
          return { ...l, qty, unitPrice: qtyPromoUnitPrice(promo, menu, qty) + optionDelta };
        }
      }
      return { ...l, qty };
    }));
  }

  const cartFingerprint = useMemo(
    () => JSON.stringify(cart.map((line) => [line.lineId, line.qty, line.unitPrice])),
    [cart],
  );
  const phoneDigits = normalizeThaiPhone(phone);
  const rewardVerified = Boolean(
    rewardVerification &&
    rewardVerification.phone === phoneDigits &&
    rewardVerification.lineId === redeemLineId &&
    rewardVerification.cartFingerprint === cartFingerprint &&
    rewardVerification.attemptId === redemptionAttemptId,
  );
  const beanGoalMet = (beanRecord?.beans || 0) >= loyaltyBeanGoal;
  const redeemLine = redeemLineId ? cart.find((l) => l.lineId === redeemLineId && productTypeOf(l) === "drink") : null;
  const redeemDiscount = beanGoalMet && redeemLine && rewardVerified ? redeemLine.unitPrice : 0;
  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0) - redeemDiscount;
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const loyaltyCartCount = cart.reduce((sum, line) => sum + (productTypeOf(line) === "drink" ? line.qty : 0), 0);

  // ถ้าเมล็ดไม่พอ/ลบรายการที่เลือกแลกออกจากตะกร้าไปแล้ว ต้องเคลียร์การแลกทิ้งกันตัวเลขค้างผิด
  useEffect(() => {
    if (redeemLineId && (!beanGoalMet || !cart.some((l) => l.lineId === redeemLineId && productTypeOf(l) === "drink"))) {
      setRedeemLineId(null);
      setRewardVerification(null);
      setRedemptionAttemptId("");
    }
    if (!beanGoalMet) setRedeemMode(false);
  }, [redeemLineId, beanGoalMet, cart]);

  useEffect(() => {
    if (cartCount > prevCartCountRef.current) {
      setCartBump(true);
      const t = setTimeout(() => setCartBump(false), 320);
      prevCartCountRef.current = cartCount;
      return () => clearTimeout(t);
    }
    prevCartCountRef.current = cartCount;
  }, [cartCount]);

  useEffect(() => () => {
    rewardRecaptchaRef.current?.clear();
    rewardRecaptchaRef.current = null;
  }, []);

  function clearRewardRecaptcha() {
    rewardRecaptchaRef.current?.clear();
    rewardRecaptchaRef.current = null;
  }

  function closeRewardOtp() {
    clearRewardRecaptcha();
    setRewardOtpOpen(false);
    setRewardOtpStatus("idle");
    setRewardOtpCode("");
    setRewardOtpError("");
    rewardVerificationIdRef.current = "";
  }

  function selectRedeemLine(lineId) {
    setRedeemLineId(lineId);
    setRewardVerification(null);
    setRedemptionAttemptId("");
  }

  function startRewardOtp() {
    if (!redeemLine) {
      setError("กรุณาเลือกเครื่องดื่มที่ต้องการแลกก่อน");
      return;
    }
    if (!toThaiE164(phone)) {
      setError("กรุณากรอกเบอร์โทรศัพท์ไทยให้ถูกต้องก่อนใช้รางวัล");
      return;
    }
    setError("");
    setRewardVerification(null);
    setRedemptionAttemptId(newRedemptionAttemptId());
    setRewardOtpStatus("idle");
    setRewardOtpCode("");
    setRewardOtpError("");
    setRewardOtpOpen(true);
  }

  async function sendRewardOtp() {
    const e164Phone = toThaiE164(phone);
    if (!e164Phone) {
      setRewardOtpError("รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง");
      return;
    }
    setRewardOtpStatus("requesting");
    setRewardOtpError("");
    setRewardOtpCode("");
    try {
      clearRewardRecaptcha();
      const verifier = new RecaptchaVerifier(auth, "reward-otp-recaptcha", {
        size: "invisible",
      });
      rewardRecaptchaRef.current = verifier;
      const provider = new PhoneAuthProvider(auth);
      rewardVerificationIdRef.current = await provider.verifyPhoneNumber(e164Phone, verifier);
      setRewardOtpResendAt(Date.now() + 60000);
      setRewardOtpStatus("code-sent");
    } catch (otpError) {
      clearRewardRecaptcha();
      setRewardOtpStatus("error");
      setRewardOtpError(rewardOtpErrorMessage(otpError));
    }
  }

  async function verifyRewardOtp() {
    if (rewardOtpCode.length !== 6 || !rewardVerificationIdRef.current) return;
    setRewardOtpStatus("verifying");
    setRewardOtpError("");
    try {
      const credential = PhoneAuthProvider.credential(rewardVerificationIdRef.current, rewardOtpCode);
      const currentUser = auth.currentUser;
      let credentialResult;
      if (!currentUser) {
        credentialResult = await signInWithCredential(auth, credential);
      } else if (currentUser.isAnonymous) {
        try {
          credentialResult = await linkWithCredential(currentUser, credential);
        } catch (linkError) {
          if (linkError.code !== "auth/credential-already-in-use") throw linkError;
          credentialResult = await signInWithCredential(auth, credential);
        }
      } else if (normalizeThaiPhone(currentUser.phoneNumber) === phoneDigits) {
        credentialResult = await reauthenticateWithCredential(currentUser, credential);
      } else {
        credentialResult = await signInWithCredential(auth, credential);
      }
      await credentialResult.user.getIdToken(true);
      setRewardVerification({
        phone: phoneDigits,
        lineId: redeemLineId,
        cartFingerprint,
        attemptId: redemptionAttemptId,
      });
      closeRewardOtp();
    } catch (otpError) {
      setRewardOtpStatus("code-sent");
      setRewardOtpError(rewardOtpErrorMessage(otpError));
    }
  }

  async function checkout() {
    setError("");
    if (cart.length === 0) { setError("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; }
    if (!name.trim()) { setError("กรุณาใส่ชื่อ"); return; }
    if (!phone.trim()) { setError("กรุณาใส่เบอร์โทร"); return; }
    if (pickupDate < addDays(1) || pickupDate > addDays(7)) { setError("วันที่รับต้องล่วงหน้าอย่างน้อย 1 วัน และไม่เกิน 7 วัน"); return; }
    if (paymentMethod === "promptpay" && !promptpayId) { setError("ร้านนี้ยังไม่เปิดรับชำระผ่าน QR (ยังไม่ได้ตั้งค่า PromptPay)"); return; }
    if (redeemLine && !rewardVerified) {
      startRewardOtp();
      return;
    }
    setSubmitting(true);
    try {
      // เช็ค session สดๆ ก่อนเขียนจริงเสมอ เผื่อ auth หลุดไปกลางคันโดยที่ authUid ใน state ยังค้างค่าเก่า
      // (พบได้ใน in-app browser บางตัว / private mode ที่ persist auth ไม่เสถียร)
      let uidToUse = auth.currentUser?.uid;
      if (!uidToUse) {
        const cred = await signInAnonymously(auth);
        uidToUse = cred.user.uid;
        setAuthUid(uidToUse);
      }
      const baseOrder = {
        customerUid: uidToUse,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        note: note.trim(),
        paymentMethod,
        pickupDate,
      };
      let orderId;
      let orderData;

      if (redeemLine && rewardVerified) {
        const createRewardOrder = httpsCallable(functions, "checkoutWithReward");
        const response = await createRewardOrder({
          shopUid,
          redemptionAttemptId,
          selectedLineId: redeemLineId,
          order: { ...baseOrder, items: cart },
        });
        orderId = response.data.orderId;
        orderData = response.data.order;
      } else {
        const newRef = push(ref(db, `orders/${shopUid}`));
        orderId = newRef.key;
        orderData = {
          ...baseOrder,
          items: cart.map(({ lineId, ...rest }) => rest),
          total,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        await set(newRef, orderData);
      }

      saveMyOrderId(shopUid, orderId);
      if (paymentMethod === "promptpay") {
        const payload = generatePayload(promptpayId, { amount: orderData.total });
        const url = await QRCode.toDataURL(payload, { width: 260, margin: 1 });
        setQrDataUrl(url);
      } else {
        setQrDataUrl(null);
      }
      setOrder({ id: orderId, ...orderData });
      setStep("pay");
    } catch (e) {
      const isAuthIssue = e.code === "PERMISSION_DENIED" || e.code === "functions/unauthenticated" ||
        e.code === "functions/permission-denied" || /permission_denied/i.test(e.message || "");
      if (e.code === "functions/failed-precondition") {
        setRewardVerification(null);
        setRedeemLineId(null);
      }
      setError(isAuthIssue
        ? "การยืนยันเบอร์สำหรับใช้รางวัลหมดอายุ กรุณายืนยัน OTP อีกครั้ง"
        : "สั่งซื้อไม่สำเร็จ: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!authUid || step !== "menu") return;
    const ids = loadMyOrderIds(shopUid);
    if (ids.length === 0) { setHasActiveOrder(false); return; }
    let cancelled = false;
    Promise.allSettled(ids.map((id) => get(ref(db, `orders/${shopUid}/${id}/status`)))).then((results) => {
      if (cancelled) return;
      const active = results.some((r) => r.status === "fulfilled" && r.value.exists() && r.value.val() !== "done" && r.value.val() !== "cancelled");
      setHasActiveOrder(active);
    });
    return () => { cancelled = true; };
  }, [authUid, shopUid, step]);

  function triggerHeaderRipple() {
    setHeaderRipple(true);
    setTimeout(() => setHeaderRipple(false), 500);
  }

  async function openMyOrders() {
    setError("");
    const ids = loadMyOrderIds(shopUid);
    // Promise.all rejects the whole batch (and silently no-ops the button, since there's
    // no .catch) if even one cached id is denied/gone — allSettled lets the rest through.
    const results = await Promise.allSettled(ids.map((id) => get(ref(db, `orders/${shopUid}/${id}`))));
    const orders = results
      .filter((r) => r.status === "fulfilled" && r.value.exists())
      .map((r) => ({ id: r.value.key, ...r.value.val() }));
    setMyOrders(orders);
    setStep("myorders");
  }

  async function reopenOrder(o) {
    if (o.status === "pending" && o.paymentMethod === "promptpay" && promptpayId) {
      const payload = generatePayload(promptpayId, { amount: o.total });
      const url = await QRCode.toDataURL(payload, { width: 260, margin: 1 });
      setQrDataUrl(url);
    } else {
      setQrDataUrl(null);
    }
    setOrder(o);
    setStep("pay");
  }

  if (!authUid && error) {
    return <div style={centerWrap}><div style={centerCard}>{error}</div></div>;
  }

  if (!authUid || menus === null || !splashDone) {
    return <LandingScreen />;
  }

  if (step === "myorders") {
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <GlassBackdrop />
        <div style={centerCard}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, margin: "4px 0 14px" }}>ออเดอร์ของฉัน</h1>
          {myOrders.length === 0 ? (
            <p style={{ fontSize: 13, color: COLORS.espresso2 }}>ยังไม่มีประวัติการสั่งซื้อจากอุปกรณ์นี้</p>
          ) : (
            myOrders.map((o) => (
              <button key={o.id} onClick={() => reopenOrder(o)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "rgba(255,255,255,0.55)",
                border: "1px solid rgba(255,255,255,0.65)", borderRadius: 12, padding: 12, marginBottom: 8, cursor: "pointer",
              }}>
                <OrderStatusIcon status={o.status} size={18} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{new Date(o.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
                    <span style={{ fontWeight: 600 }}>{money(o.total)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.espresso2, marginTop: 2 }}>{STATUS_TEXT[o.status] || o.status}</div>
                </div>
              </button>
            ))
          )}
          <button style={{ ...btn, marginTop: 8 }} onClick={() => setStep("menu")}>ย้อนกลับ</button>
        </div>
      </div>
    );
  }

  if (step === "success" && order) {
    const shortCode = order.id.slice(-6).toUpperCase();
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <GlassBackdrop />
        <div style={{ ...centerCard, textAlign: "center" }}>
          <div style={{ animation: "successPop .5s cubic-bezier(.34,1.56,.64,1)", margin: "10px auto 4px", width: 84, height: 84 }}>
            <svg viewBox="0 0 52 52" width={84} height={84}>
              <circle cx="26" cy="26" r="24" fill="none" stroke={COLORS.success} strokeWidth="3" />
              <path
                d="M15 27 L23 35 L38 18" fill="none" stroke={COLORS.success} strokeWidth="4"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 48, strokeDashoffset: 48, animation: "checkDraw .5s .35s ease forwards" }}
              />
            </svg>
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, margin: "6px 0 4px", color: COLORS.successDark }}>
            ชำระเงินสำเร็จ
          </h1>
          <p style={{ fontSize: 12, color: COLORS.espresso2, margin: "0 0 4px" }}>เลขที่อ้างอิงออเดอร์</p>
          <p style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: ".04em", margin: "0 0 18px", color: COLORS.espresso5 }}>
            #{shortCode}
          </p>
          <p style={{ fontSize: 12, color: COLORS.espresso2, margin: 0 }}>
            กลับไปหน้าออเดอร์ของฉันใน {successCountdown} วินาที...
          </p>
          <button
            style={{ ...btn, marginTop: 14, width: "100%" }}
            onClick={() => { resetOrderFlow(); openMyOrders(); }}
          >
            ไปที่ออเดอร์ของฉันตอนนี้
          </button>
        </div>
      </div>
    );
  }

  if (step === "pay" && order) {
    const isPending = order.status === "pending";
    const isCash = isCashLikeMethod(order.paymentMethod);
    const payAtStoreText = PAY_AT_STORE_TEXT[order.paymentMethod] || PAY_AT_STORE_TEXT.cash;
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <GlassBackdrop />
        <div style={{ ...centerCard, textAlign: "center" }}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, margin: "4px 0 14px" }}>
            {isPending ? (isCash ? payAtStoreText.title : "สแกนจ่ายผ่าน PromptPay") : "สถานะออเดอร์"}
          </h1>
          {isPending ? (
            isCash ? (
              <div style={{ padding: "10px 0" }}>
                <p style={{ fontSize: 40, margin: 0 }}>💵</p>
                <p style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", margin: "10px 0 4px" }}>{money(order.total)}</p>
                <p style={{ fontSize: 12, color: COLORS.espresso2, margin: "0 0 14px" }}>{payAtStoreText.instruction}</p>
              </div>
            ) : (
              <>
                {qrDataUrl && (
                  <>
                    <img src={qrDataUrl} alt="PromptPay QR" width={220} height={220} style={{ borderRadius: 10, border: `1px solid ${COLORS.line}` }} />
                    <a
                      href={qrDataUrl}
                      download={`promptpay-${order.id.slice(-6)}.png`}
                      style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", margin: "10px 0 0" }}
                    >
                      <i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden="true"></i>บันทึกรูป QR
                    </a>
                  </>
                )}
                <p style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", margin: "14px 0 4px" }}>{money(order.total)}</p>
                <p style={{ fontSize: 12, color: COLORS.espresso2, margin: "0 0 14px" }}>
                  {order.paymentVerified ? "ยืนยันการชำระเงินแล้ว ✅" : `${STATUS_TEXT.pending} (หน้านี้จะอัปเดตอัตโนมัติ)`}
                </p>
                {!order.paymentVerified && (
                  <>
                    {slipTestMode && (
                      <p style={{ fontSize: 11, color: "#9C7530", background: "#F7E9CC", border: "1px solid #E0C489", borderRadius: 8, padding: "6px 9px", margin: "0 0 10px" }}>
                        โหมดทดสอบ: แนบรูปอะไรก็ผ่านทันที ไม่ใช่การตรวจสอบจริง
                      </p>
                    )}
                    <SlipUpload
                      shopUid={shopUid}
                      orderId={order.id}
                      onVerified={() => {
                        setOrder((prev) => (prev ? { ...prev, paymentVerified: true } : prev));
                        setStep("success");
                      }}
                    />
                  </>
                )}
              </>
            )
          ) : (
            <div style={{ padding: "24px 0", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <OrderStatusIcon status={order.status} size={38} />
              <p style={{ fontSize: 16, fontWeight: 600, margin: "12px 0 4px" }}>{STATUS_TEXT[order.status] || order.status}</p>
            </div>
          )}
          {order.pickupDate && (
            <p style={{ fontSize: 12.5, color: COLORS.espresso5, fontWeight: 600, margin: "0 0 10px" }}>
              <i className="ti ti-calendar" style={{ fontSize: 13, marginRight: 4 }} aria-hidden="true"></i>
              วันที่รับ: {formatPickupDate(order.pickupDate)}
            </p>
          )}
          <div style={{ textAlign: "left", marginTop: 10, borderTop: `1px dashed ${COLORS.line}`, paddingTop: 10 }}>
            {order.items.map((i, idx) => (
              <div key={idx} style={{ fontSize: 12.5, marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{i.name} x{i.qty}</span><span>{money(i.unitPrice * i.qty)}</span>
                </div>
                {i.options?.length > 0 && (
                  <div style={{ color: COLORS.espresso2, fontSize: 11 }}>{i.options.map((o) => o.label).join(", ")}</div>
                )}
              </div>
            ))}
          </div>
          <button style={{ ...btn, marginTop: 14, width: "100%" }} onClick={() => { resetOrderFlow(); setStep("menu"); }}>กลับไปหน้าเมนู</button>
        </div>
      </div>
    );
  }

  if (step === "phone") {
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <GlassBackdrop />
        <div style={centerCard}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 500, margin: 0 }}>{shopName}</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 14px" }}>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, margin: 0 }}>สรุปออเดอร์</h1>
            <button style={{ ...btn, fontSize: 12, padding: "5px 10px" }} onClick={() => setShowCart(true)}>
              <i className="ti ti-edit" style={{ fontSize: 13, marginRight: 3 }} aria-hidden="true"></i>แก้ไข
            </button>
          </div>
          {cart.map((l) => (
            <div key={l.lineId} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                <span>{l.name} x{l.qty}</span><span>{money(l.unitPrice * l.qty)}</span>
              </div>
              {l.options.length > 0 && <div style={{ fontSize: 11, color: COLORS.espresso2 }}>{l.options.map((o) => o.label).join(", ")}</div>}
            </div>
          ))}
          {redeemDiscount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: COLORS.sageDark, marginTop: 8 }}>
              <span>แลกเมล็ดรับฟรี 1 แก้ว</span><span>-{money(redeemDiscount)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, borderTop: `1px dashed ${COLORS.line}`, marginTop: 8, paddingTop: 8 }}>
            <span>รวม</span><span>{money(total)}</span>
          </div>

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 16 }}>ชื่อ</label>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อของคุณ" />

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>เบอร์โทรศัพท์</label>
          <input
            style={field}
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setRewardVerification(null);
              setRedemptionAttemptId("");
            }}
            placeholder="08xxxxxxxx"
          />

          <LoyaltyCard
            phone={phone}
            loyaltyStatus={loyaltyStatus}
            beanRecord={beanRecord}
            loyaltyBeanGoal={loyaltyBeanGoal}
            onRetry={() => setLoyaltyRetryTick((t) => t + 1)}
            cart={cart}
            cartCount={loyaltyCartCount}
            redeemMode={redeemMode}
            setRedeemMode={setRedeemMode}
            redeemLineId={redeemLineId}
            setRedeemLineId={selectRedeemLine}
            rewardVerified={rewardVerified}
            onRequestRewardVerification={startRewardOtp}
            onShowRewardTerms={() => setShowRewardTerms(true)}
          />
          {showRewardTerms && <RewardTermsSheet goal={loyaltyBeanGoal} onClose={() => setShowRewardTerms(false)} />}
          <RewardOtpModal
            open={rewardOtpOpen}
            phone={phone}
            status={rewardOtpStatus}
            error={rewardOtpError}
            code={rewardOtpCode}
            resendAvailableAt={rewardOtpResendAt}
            onCodeChange={setRewardOtpCode}
            onSend={sendRewardOtp}
            onVerify={verifyRewardOtp}
            onClose={closeRewardOtp}
          />

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>วิธีชำระเงิน</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {[["promptpay", "พร้อมเพย์ (QR)"], ["cash", "เงินสด"], ["thaihelpthai", "ไทยช่วยไทย"]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPaymentMethod(val)}
                style={{
                  flex: 1, padding: "10px 8px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  border: paymentMethod === val ? `1.5px solid ${COLORS.sage}` : `1px solid ${COLORS.line}`,
                  background: paymentMethod === val ? COLORS.sageLight : "#fff",
                  color: paymentMethod === val ? COLORS.sageDark : COLORS.espresso4,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>วันที่รับ (ล่วงหน้า 1-7 วัน)</label>
          <input
            style={field} type="date" value={pickupDate} min={addDays(1)} max={addDays(7)}
            onChange={(e) => setPickupDate(e.target.value)}
          />

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>โน้ตถึงร้าน (ถ้ามี)</label>
          <textarea
            style={{ ...field, resize: "vertical", minHeight: 60, fontFamily: "inherit" }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {error && <p style={{ fontSize: 12, color: COLORS.danger, margin: "10px 0 0" }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={btn} onClick={() => setStep("menu")}>ย้อนกลับ</button>
            <button style={{ ...btnAccent }} disabled={submitting} onClick={checkout}>
              {submitting ? "กำลังสร้าง QR..." : "ยืนยันสั่งซื้อ"}
            </button>
          </div>
        </div>

        <CartDrawer
          visible={showCart}
          cart={cart}
          total={total}
          onClose={() => setShowCart(false)}
          onSetQty={setLineQty}
          onRemove={removeCartLine}
          canEditOptions={canEditLineOptions}
          onEditOptions={setEditingCartLine}
          onCheckout={() => setShowCart(false)}
        />

        <OptionPickerModal
          visible={!!editingCartLine}
          menu={editingCartLine ? menusById[editingCartLine.menuId] : null}
          groups={editingCartLine ? groupsForMenu(menusById[editingCartLine.menuId]) : []}
          hideQty
          initialOptions={editingCartLine ? editingCartLine.options : undefined}
          onCancel={() => setEditingCartLine(null)}
          onConfirm={(qty, options) => confirmEditCartLine(editingCartLine, options)}
        />
      </div>
    );
  }

  if (!acceptingOrders) {
    return <ClosedOrderScreen shopName={shopName} hasOrders={loadMyOrderIds(shopUid).length > 0} onOpenOrders={openMyOrders} />;
  }

  return (
    <div className="corder" style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Inter', sans-serif", color: COLORS.espresso4, animation: "pageIn .32s cubic-bezier(.22,1,.36,1) both" }}>
      <style>{GLOBAL_CSS}</style>
      <GlassBackdrop />

      {takeoverPromo && (
        <PromotionTakeover
          promo={takeoverPromo}
          imageUrl={takeoverPromo.popupImageUrl || menusById[takeoverPromo.menuIds?.[0]]?.imageUrl || ""}
          onClose={closePromotionTakeover}
          onCta={() => openTakeoverPromotion(takeoverPromo)}
        />
      )}

      {flyItems.map((f) => (
        <div
          key={f.id}
          style={{
            position: "fixed", left: f.startX - 20, top: f.startY - 20, width: 40, height: 40,
            borderRadius: "50%", overflow: "hidden", zIndex: 999, pointerEvents: "none",
            boxShadow: "0 4px 14px rgba(43,29,20,0.3)", border: "2px solid #fff",
            background: f.imageUrl ? `url(${f.imageUrl}) center/cover` : `linear-gradient(135deg, ${COLORS.sage}, ${COLORS.espresso5})`,
            "--dx": `${f.dx}px`, "--dy": `${f.dy}px`,
            animation: "flyToCart .65s cubic-bezier(.3,.8,.4,1) forwards",
          }}
        />
      ))}

      <div className="zone-header" style={{
        margin: "10px 10px 0", height: 74, padding: "0 16px", borderRadius: 28,
        background: "#F8F6F2", boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div className="zone-logo-shell" style={{
            width: 44, height: 44, borderRadius: 14, background: "#fff", border: "1px solid #ECE8E2",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden",
          }}>
            <BrandLogo height={28} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: 1.15, minWidth: 0 }}>
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: "#163B73",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{shopNameParts[0]}</span>
            {shopNameParts[1] && (
              <span style={{
                fontSize: 12, letterSpacing: "0.12em", fontWeight: 500, color: "#7B7B7B", textTransform: "uppercase",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{shopNameParts[1]}</span>
            )}
          </div>
        </div>
        {loadMyOrderIds(shopUid).length > 0 && (
          <button
            className="zone-icon-btn"
            onClick={() => { triggerHeaderRipple(); openMyOrders(); }}
            style={{
              width: 44, height: 44, borderRadius: 22, background: "#fff", border: "1px solid #ECE8E2",
              boxShadow: "0 4px 14px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", flexShrink: 0,
            }}
          >
            <i className="ti ti-receipt" style={{ fontSize: 19, color: "#163B73" }} aria-hidden="true"></i>
            {hasActiveOrder && (
              <span style={{
                position: "absolute", top: 3, right: 3, width: 11, height: 11, borderRadius: "50%",
                background: "#FF7A00", border: "2px solid #fff",
              }} />
            )}
            {headerRipple && <span className="offer-ripple" />}
          </button>
        )}
      </div>

      <BannerCarousel images={bannerImageUrls.length > 0 ? bannerImageUrls : (bannerImageUrl ? [bannerImageUrl] : [])} />

      {menus.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: COLORS.espresso2, fontSize: 13 }}>ร้านยังไม่มีเมนู</div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 10, padding: "10px 10px 0" }}>
          <nav className="customer-category-nav" style={{ ...GLASS_PANEL, width: 88, flexShrink: 0, overflowY: "auto", borderRadius: 16, padding: "8px 0" }}>
            {categories.map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  className={`customer-category-tab${active ? " active" : ""}`}
                  onClick={() => scrollToCategory(cat)}
                  style={{
                    display: "block", width: "calc(100% - 12px)", margin: "0 6px 6px", textAlign: "center", padding: "10px 6px", fontSize: 12.5,
                    lineHeight: 1.3, borderRadius: 11, background: active ? "rgba(255,255,255,0.75)" : "transparent",
                    color: active ? COLORS.espresso5 : COLORS.espresso2, fontWeight: active ? 600 : 500, border: "none",
                    boxShadow: active ? "0 2px 8px rgba(43,29,20,0.10)" : "none",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </nav>

          <main ref={mainRef} style={{ flex: 1, overflowY: "auto", padding: "0 0 100px" }}>
            {categories.map((cat) => (
              <section key={cat} data-category={cat} ref={(el) => { sectionRefs.current[cat] = el; }} style={{ padding: "16px 6px 0" }}>
                {cat === HOT_DEAL_CATEGORY ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 16px 14px" }}>
                      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 22, color: COLORS.espresso5, margin: 0 }}>Today's Offer</h2>
                      <button
                        className="offer-arrow-btn"
                        onClick={() => { triggerOfferRipple("__nav__"); scrollOfferCarousel(1); }}
                        style={{
                          width: 40, height: 40, borderRadius: "50%", background: "#E4F5E8", border: "none",
                          display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", flexShrink: 0,
                        }}
                      >
                        <i className="ti ti-arrow-right" style={{ fontSize: 18, color: COLORS.success }} aria-hidden="true"></i>
                        {offerRippleId === "__nav__" && <span className="offer-ripple" />}
                      </button>
                    </div>

                    <div className="offer-carousel" ref={offerCarouselRef} style={{
                      display: "flex", gap: 14, overflowX: "auto", scrollSnapType: "x mandatory",
                      padding: "2px 16px 10px", margin: "0 -6px",
                    }}>
                      {activePromotions.map((promo) => {
                        let images = [];
                        let label = "";
                        let title = "";
                        let subtitle = null;
                        let priceNode = null;
                        let qty = 0;
                        let onCardClick = () => {};
                        let refKey = "promo_" + promo.id;

                        if (promo.type === "choice") {
                          const pool = promo.menuIds.map((id) => menusById[id]).filter((m) => m && m.available !== false);
                          images = pool.map((m) => m.imageUrl);
                          label = promo.discountType === "percent" ? `เลือกเอง ลด ${promo.discountValue}%` : `เลือก ${promo.chooseCount} จาก ${pool.length}`;
                          title = promo.name || `เลือก ${promo.chooseCount} จาก ${pool.length} รายการ`;
                          subtitle = pool.map((m) => m.name).join(", ");
                          priceNode = (
                            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger }}>
                              {promo.discountType === "percent" ? `ลด ${promo.discountValue}%` : `ชุดละ ${money(promo.discountValue)}`}
                            </span>
                          );
                          onCardClick = () => setPickingChoicePromo(promo);
                        } else if (promo.type === "qty") {
                          const menu = menusById[promo.menuIds[0]];
                          if (!menu) return null;
                          const lines = linesForMenu(menu.id, promo.id);
                          qty = lines.reduce((s, l) => s + l.qty, 0);
                          const setPrice = qtyPromoTotal(promo, menu, promo.minQty);
                          images = [menu.imageUrl];
                          label = `ซื้อครบ ${promo.minQty} ชิ้น ลด ${promo.discountType === "percent" ? promo.discountValue + "%" : ""}`;
                          title = promo.name || menu.name;
                          subtitle = `${money(menu.priceStore)}/ชิ้น`;
                          priceNode = (
                            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                              <span style={{ fontSize: 11.5, color: COLORS.espresso2, textDecoration: "line-through" }}>{money(menu.priceStore * promo.minQty)}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger }}>{money(setPrice)}</span>
                            </span>
                          );
                          onCardClick = () => openMenu(menu, promo);
                          refKey = "promo_" + menu.id;
                        } else if (promo.type === "bundle") {
                          const prices = splitBundlePrices(promo, menusById);
                          const originalTotal = promo.menuIds.reduce((s, id) => s + (menusById[id]?.priceStore || 0), 0);
                          const promoTotal = prices.reduce((s, p) => s + p.unitPrice, 0);
                          qty = bundleQtyInCart(promo);
                          images = promo.menuIds.map((id) => menusById[id]?.imageUrl);
                          label = promo.discountType === "percent" ? `จับคู่ ลด ${promo.discountValue}%` : "จับคู่คอมโบ";
                          title = promo.name || prices.map((p) => p.name).join(" + ");
                          subtitle = prices.map((p) => p.name).join(", ");
                          priceNode = (
                            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                              <span style={{ fontSize: 11.5, color: COLORS.espresso2, textDecoration: "line-through" }}>{money(originalTotal)}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger }}>{money(promoTotal)}</span>
                            </span>
                          );
                          onCardClick = () => startBundleFlow(promo);
                        } else {
                          const menu = menusById[promo.menuIds[0]];
                          if (!menu) return null;
                          const promoPrice = singlePromoPrice(promo, menu);
                          const lines = linesForMenu(menu.id, promo.id);
                          qty = lines.reduce((s, l) => s + l.qty, 0);
                          images = [menu.imageUrl];
                          label = promo.discountType === "percent" ? `HOT DEAL ลด ${promo.discountValue}%` : "HOT DEAL";
                          title = promo.name || menu.name;
                          subtitle = null;
                          priceNode = (
                            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                              <span style={{ fontSize: 11.5, color: COLORS.espresso2, textDecoration: "line-through" }}>{money(menu.priceStore)}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger }}>{money(promoPrice)}</span>
                            </span>
                          );
                          onCardClick = () => openMenu(menu, promo);
                          refKey = "promo_" + menu.id;
                        }

                        return (
                          <OfferCard
                            key={promo.id}
                            images={images}
                            label={label}
                            title={title}
                            subtitle={subtitle}
                            priceNode={priceNode}
                            qty={qty}
                            rippling={offerRippleId === promo.id}
                            onClick={() => { triggerOfferRipple(promo.id); onCardClick(); }}
                            thumbRef={(el) => { menuThumbRefs.current[refKey] = el; }}
                          />
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, color: COLORS.espresso5, margin: "0 0 10px" }}>{cat}</h2>
                    {menus.filter((m) => m.category === cat).map((m) => {
                      const soldOut = m.available === false;
                      const lines = linesForMenu(m.id);
                      const qty = lines.reduce((s, l) => s + l.qty, 0);
                      const singleLine = lines.length === 1 ? lines[0] : null;
                      const canAddDirectly = groupsForMenu(m).length === 0;
                      return (
                        <div key={m.id} onClick={() => !soldOut && !singleLine && openMenu(m)} style={{
                          ...GLASS_PANEL, display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 14, marginBottom: 8,
                          opacity: soldOut ? 0.5 : 1, cursor: soldOut || singleLine ? "default" : "pointer",
                        }}>
                          <div ref={(el) => { menuThumbRefs.current[m.id] = el; }}>
                            <MenuThumb imageUrl={m.imageUrl} productType={productTypeOf(m)} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5 }}>{m.name}</div>
                            <div style={{ fontSize: 13, color: soldOut ? COLORS.danger : COLORS.gold, fontWeight: 600, marginTop: 3 }}>
                              {soldOut ? "หมดวันนี้" : `${money(m.priceStore)} / ${productUnitLabel(m)}`}
                            </div>
                          </div>
                          {singleLine ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => setLineQty(singleLine.lineId, singleLine.qty - 1)} style={{
                                width: 28, height: 28, borderRadius: 9, border: "1px solid rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.6)",
                                color: COLORS.espresso5, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
                              }}>−</button>
                              <span style={{ minWidth: 16, textAlign: "center", fontWeight: 600, color: COLORS.espresso5 }}><AnimatedQty value={qty} /></span>
                              <button
                                onClick={() => { if (canAddDirectly) { spawnFly(m.id, m.imageUrl); setLineQty(singleLine.lineId, singleLine.qty + 1); } else openMenu(m); }}
                                style={{
                                  width: 28, height: 28, borderRadius: 8, border: "none", background: COLORS.espresso5,
                                  color: "#fff", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
                                }}
                              >+</button>
                            </div>
                          ) : (
                            <button
                              disabled={soldOut}
                              onClick={(e) => { e.stopPropagation(); openMenu(m); }}
                              style={{
                                position: "relative", width: 32, height: 32, borderRadius: 9, flexShrink: 0, border: "none",
                                background: soldOut ? COLORS.line : COLORS.espresso5, color: "#fff", fontSize: 18, lineHeight: 1,
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                            >
                              +
                              {qty > 0 && (
                                <span style={{
                                  position: "absolute", top: -6, right: -6, background: COLORS.danger, color: "#fff",
                                  fontSize: 10, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
                                  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                                }}><AnimatedQty value={qty} /></span>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </section>
            ))}
            <p style={{ textAlign: "center", fontSize: 11, color: COLORS.espresso2, margin: "20px 0 4px" }}>
              © HE SERVED CO. 2026
            </p>
          </main>
        </div>
      )}

      {cartCount > 0 && (
        <div style={{
          position: "fixed", left: 16, right: 16, bottom: 16, maxWidth: 420, margin: "0 auto",
          background: "rgba(43,29,20,0.62)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.15)", color: "#fff", borderRadius: 16,
          padding: "12px 14px 12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 8px 24px rgba(43,29,20,0.35)", animation: "fadeIn .2s ease",
        }}>
          <button
            onClick={() => setShowCart(true)}
            style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", color: "#fff", padding: 0 }}
          >
            <div ref={cartIconRef} style={{ position: "relative", animation: cartBump ? "cartBump .32s ease" : "none" }}>
              <i className="ti ti-shopping-bag" style={{ fontSize: 22 }} aria-hidden="true"></i>
              <span style={{
                position: "absolute", top: -8, right: -8, background: COLORS.sage, color: "#fff", fontSize: 10,
                fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
              }}><AnimatedQty value={cartCount} /></span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}><AnimatedMoney value={total} /></span>
            <i className="ti ti-chevron-up" style={{ fontSize: 15, opacity: 0.6 }} aria-hidden="true"></i>
          </button>
          <button
            onClick={() => { setError(""); setStep("phone"); }}
            style={{ background: COLORS.sage, color: "#fff", border: "none", borderRadius: 10, padding: "10px 22px", fontSize: 13.5, fontWeight: 600 }}
          >
            สั่งซื้อ
          </button>
        </div>
      )}

      <CartDrawer
        visible={showCart}
        cart={cart}
        total={total}
        onClose={() => setShowCart(false)}
        onSetQty={setLineQty}
        onRemove={removeCartLine}
        canEditOptions={canEditLineOptions}
        onEditOptions={setEditingCartLine}
        onCheckout={() => { setShowCart(false); setError(""); setStep("phone"); }}
      />

      <OptionPickerModal
        visible={!!pickingMenu || !!editingCartLine}
        menu={editingCartLine ? menusById[editingCartLine.menuId] : pickingMenu}
        groups={editingCartLine ? groupsForMenu(menusById[editingCartLine.menuId]) : (pickingMenu ? groupsForMenu(pickingMenu) : [])}
        hideQty={!!editingCartLine}
        initialOptions={editingCartLine ? editingCartLine.options : undefined}
        onCancel={() => { setPickingMenu(null); setPickingPromo(null); setEditingCartLine(null); }}
        onConfirm={(qty, options) => {
          if (editingCartLine) {
            confirmEditCartLine(editingCartLine, options);
            return;
          }
          const refKey = pickingPromo ? "promo_" + pickingMenu.id : pickingMenu.id;
          spawnFly(refKey, pickingMenu.imageUrl);
          const isQty = pickingPromo && pickingPromo.type === "qty";
          const priceOverride = pickingPromo ? (isQty ? qtyPromoUnitPrice(pickingPromo, pickingMenu, qty) : singlePromoPrice(pickingPromo, pickingMenu)) : undefined;
          addToCart(pickingMenu, qty, options, priceOverride, pickingPromo ? pickingPromo.id : null, pickingPromo ? (isQty ? "qty" : "single") : null);
          setPickingMenu(null);
          setPickingPromo(null);
        }}
      />

      <ChoicePickerModal
        visible={!!pickingChoicePromo}
        promo={pickingChoicePromo}
        menusById={menusById}
        onCancel={() => setPickingChoicePromo(null)}
        onConfirm={(chosenMenus) => {
          startChoiceFlow(pickingChoicePromo, chosenMenus);
          setPickingChoicePromo(null);
        }}
      />

      <OptionPickerModal
        visible={!!choiceFlow}
        menu={choiceFlow ? choiceFlow.queue[choiceFlow.index] : null}
        groups={choiceFlow ? groupsForMenu(choiceFlow.queue[choiceFlow.index]) : []}
        hideQty
        onCancel={() => setChoiceFlow(null)}
        onConfirm={(qty, options) => confirmChoiceFlowStep(qty, options)}
      />

      <OptionPickerModal
        visible={!!bundleFlow}
        menu={bundleFlow ? bundleFlow.queue[bundleFlow.index] : null}
        groups={bundleFlow ? groupsForMenu(bundleFlow.queue[bundleFlow.index]) : []}
        hideQty
        onCancel={() => setBundleFlow(null)}
        onConfirm={(qty, options) => confirmBundleFlowStep(qty, options)}
      />
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const VERIFY_SLIP_ERROR_TEXT = {
  "already-exists": "สลิปนี้เคยถูกใช้ยืนยันไปแล้ว",
  "failed-precondition": "ยอดเงินหรือบัญชีปลายทางในสลิปไม่ตรงกับออเดอร์นี้",
  "invalid-argument": "อ่านสลิปไม่ได้ กรุณาถ่ายรูปให้ชัดเจนแล้วลองใหม่",
};

function SlipUpload({ shopUid, orderId, onVerified }) {
  const [status, setStatus] = useState("idle"); // idle | uploading | error
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setStatus("uploading");
    setErrorMsg("");
    try {
      const dataUrl = await fileToBase64(file);
      const verifySlip = httpsCallable(functions, "verifySlip");
      const res = await verifySlip({ shopUid, orderId, imageBase64: dataUrl });
      if (res.data && (res.data.verified || res.data.alreadyVerified)) {
        onVerified();
      } else {
        setStatus("error");
        setErrorMsg("ยืนยันสลิปไม่สำเร็จ กรุณาลองใหม่ หรือรอร้านตรวจสอบด้วยตนเอง");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(VERIFY_SLIP_ERROR_TEXT[err.code?.split("/").pop()] || "ตรวจสอบสลิปไม่สำเร็จ กรุณาลองใหม่ หรือรอร้านตรวจสอบด้วยตนเอง");
    }
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.6)", borderRadius: 12, padding: "10px 12px", marginBottom: 14, textAlign: "left" }}>
      <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 4px" }}>โอนเงินแล้ว? ยืนยันไวขึ้นได้</p>
      <p style={{ fontSize: 11.5, color: COLORS.espresso2, margin: "0 0 8px" }}>แนบรูปสลิปโอนเงิน ระบบจะเช็คยอดและยืนยันออเดอร์ให้อัตโนมัติ</p>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
      <button
        style={{ ...btn, width: "100%" }}
        disabled={status === "uploading"}
        onClick={() => inputRef.current?.click()}
      >
        {status === "uploading" ? "กำลังตรวจสอบสลิป..." : "แนบรูปสลิป"}
      </button>
      {status === "error" && <p style={{ fontSize: 11.5, color: COLORS.danger, margin: "6px 0 0" }}>{errorMsg}</p>}
    </div>
  );
}

function CartDrawer({ visible, cart, total, onClose, onSetQty, onRemove, onCheckout, canEditOptions, onEditOptions }) {
  const { mounted, shown } = useSheetTransition(visible);
  if (!mounted) return null;
  return (
    <div style={{ ...overlay, opacity: shown ? 1 : 0, transition: "opacity .25s ease" }} onClick={onClose}>
      <div style={{
        ...GLASS_PANEL, borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto",
        transform: shown ? "translateY(0)" : "translateY(100%)", transition: "transform .34s cubic-bezier(.22,1,.36,1)",
      }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, margin: "0 0 14px", color: COLORS.espresso5 }}>ตะกร้าของคุณ</h2>

        {cart.length === 0 ? (
          <p style={{ fontSize: 13, color: COLORS.espresso2 }}>ตะกร้าว่างเปล่า</p>
        ) : (
          cart.map((l) => (
            <div key={l.lineId} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, padding: "10px 0", borderBottom: `1px solid ${COLORS.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5, display: "flex", alignItems: "center", gap: 6 }}>
                  {l.name}
                  {l.promoId && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", background: COLORS.danger, borderRadius: 999, padding: "1px 6px" }}>โปร</span>}
                </div>
                {l.options.length > 0 && <div style={{ fontSize: 11.5, color: COLORS.espresso2, marginTop: 2 }}>{l.options.map((o) => o.label).join(", ")}</div>}
                <div style={{ fontSize: 12.5, color: l.promoId ? COLORS.danger : COLORS.sage, fontWeight: 600, marginTop: 4 }}><AnimatedMoney value={l.unitPrice * l.qty} /></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {l.promoKind === "bundle" || l.promoKind === "choice" ? (
                  <span style={{ fontSize: 12, color: COLORS.espresso2, marginRight: 2 }}>x{l.qty}</span>
                ) : (
                  <>
                    <button style={{ ...btn, padding: "4px 10px" }} onClick={() => onSetQty(l.lineId, l.qty - 1)}>−</button>
                    <span style={{ minWidth: 18, textAlign: "center" }}><AnimatedQty value={l.qty} /></span>
                    <button style={{ ...btn, padding: "4px 10px" }} onClick={() => onSetQty(l.lineId, l.qty + 1)}>+</button>
                  </>
                )}
                {canEditOptions && canEditOptions(l) && (
                  <button style={{ ...btn, padding: "4px 8px" }} onClick={() => onEditOptions(l)} title="แก้ไขตัวเลือก">
                    <i className="ti ti-edit" style={{ fontSize: 14 }} aria-hidden="true"></i>
                  </button>
                )}
                <button style={{ ...btn, padding: "4px 8px", color: COLORS.danger, borderColor: COLORS.danger }} onClick={() => onRemove(l)}>
                  <i className="ti ti-trash" style={{ fontSize: 14 }} aria-hidden="true"></i>
                </button>
              </div>
            </div>
          ))
        )}

        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, marginTop: 14, fontFamily: "'Space Grotesk', sans-serif", color: COLORS.espresso5 }}>
          <span>รวม</span><span><AnimatedMoney value={total} /></span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button style={btn} onClick={onClose}>เลือกเพิ่ม</button>
          <button style={btnAccent} disabled={cart.length === 0} onClick={onCheckout}>ไปต่อ</button>
        </div>
      </div>
    </div>
  );
}

function OptionPickerModal({ menu, groups, visible, onCancel, onConfirm, hideQty, initialOptions }) {
  const { mounted, shown } = useSheetTransition(visible);
  const cachedRef = useRef({ menu, groups });
  if (menu) cachedRef.current = { menu, groups };
  const { menu: cm, groups: cg } = cachedRef.current;

  const [qty, setQty] = useState(1);
  const [selections, setSelections] = useState({});
  const [err, setErr] = useState("");

  useEffect(() => {
    if (menu) {
      setQty(1);
      if (initialOptions && initialOptions.length) {
        const sel = {};
        for (const o of initialOptions) {
          sel[o.groupId] = { id: o.choiceId, label: o.label, note: "", priceDelta: o.priceDelta || 0, ingredientId: o.ingredientId || null, qtyPercent: o.qtyPercent != null ? o.qtyPercent : 100, extraAdjustments: o.extraAdjustments || [], groupId: o.groupId, groupName: o.groupName };
        }
        setSelections(sel);
      } else {
        const defaults = {};
        for (const g of cg) {
          const def = (g.choices || []).find((c) => c.isDefault);
          if (def) defaults[g.id] = { ...def, groupId: g.id, groupName: g.name };
        }
        setSelections(defaults);
      }
      setErr("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.id]);

  function pick(groupId, choice) {
    setSelections((s) => ({ ...s, [groupId]: choice }));
  }

  function confirm() {
    for (const grp of cg) {
      if (grp.required && !selections[grp.id]) {
        setErr(`กรุณาเลือก "${grp.name}"`);
        return;
      }
    }
    const options = cg
      .map((grp) => selections[grp.id])
      .filter(Boolean)
      .map((c) => ({
        groupId: c.groupId, groupName: c.groupName, choiceId: c.id, label: c.label, priceDelta: c.priceDelta || 0,
        ingredientId: c.ingredientId || null, qtyPercent: c.qtyPercent != null ? c.qtyPercent : 100,
        extraAdjustments: c.extraAdjustments || [],
      }));
    onConfirm(hideQty ? 1 : qty, options);
  }

  if (!mounted) return null;
  return (
    <div style={{ ...overlay, opacity: shown ? 1 : 0, transition: "opacity .25s ease" }} onClick={onCancel}>
      <div style={{
        ...GLASS_PANEL, borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto",
        transform: shown ? "translateY(0)" : "translateY(100%)", transition: "transform .34s cubic-bezier(.22,1,.36,1)",
      }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, margin: "0 0 14px" }}>{cm?.name}</h2>

        {cg.map((g) => (
          <div key={g.id} style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>{g.name}</p>
            <p style={{ fontSize: 11, color: COLORS.espresso2, margin: "0 0 8px" }}>{g.required ? "กรุณาเลือก 1 ข้อ" : "เลือกได้ (ไม่บังคับ)"}</p>
            {g.choices.map((c) => {
              const selected = selections[g.id]?.id === c.id;
              return (
                <button
                  key={c.id}
                  className={`customer-option-choice${selected ? " selected" : ""}`}
                  onClick={() => pick(g.id, { ...c, groupId: g.id, groupName: g.name })}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                    textAlign: "left", padding: "9px 12px", marginBottom: 6, borderRadius: 9, cursor: "pointer",
                    border: selected ? `1.5px solid ${COLORS.sage}` : `1px solid ${COLORS.line}`,
                    background: selected ? COLORS.sageLight : "#fff", color: COLORS.espresso4, fontSize: 13,
                  }}
                >
                  <span>
                    <div style={{ fontWeight: 500 }}>{c.label}</div>
                    {c.note && <div style={{ fontSize: 11, color: COLORS.espresso2 }}>{c.note}</div>}
                  </span>
                  <span style={{ fontSize: 12.5, whiteSpace: "nowrap", marginLeft: 8 }}>{c.priceDelta ? `+${c.priceDelta}` : "0"}</span>
                </button>
              );
            })}
          </div>
        ))}

        {!hideQty && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 16px" }}>
            <span style={{ fontSize: 13 }}>จำนวน</span>
            <button style={{ ...btn, padding: "4px 10px" }} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
            <span style={{ minWidth: 18, textAlign: "center" }}><AnimatedQty value={qty} /></span>
            <button style={{ ...btn, padding: "4px 10px" }} onClick={() => setQty((q) => q + 1)}>+</button>
          </div>
        )}

        {err && <p style={{ fontSize: 12, color: COLORS.danger, margin: "10px 0 10px" }}>{err}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn} onClick={onCancel}>ยกเลิก</button>
          <button style={btnAccent} onClick={confirm}>เพิ่มลงตะกร้า</button>
        </div>
      </div>
    </div>
  );
}

function ChoicePickerModal({ promo, menusById, visible, onCancel, onConfirm }) {
  const { mounted, shown } = useSheetTransition(visible);
  const cachedRef = useRef(promo);
  if (promo) cachedRef.current = promo;
  const cp = cachedRef.current;

  const [selected, setSelected] = useState([]);

  useEffect(() => {
    if (promo) setSelected([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promo?.id]);

  if (!mounted || !cp) return null;

  const pool = (cp.menuIds || []).map((id) => menusById[id]).filter((m) => m && m.available !== false);
  const need = cp.chooseCount || 1;

  function toggle(id) {
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= need) return s;
      return [...s, id];
    });
  }

  function confirm() {
    if (selected.length !== need) return;
    const chosen = selected.map((id) => menusById[id]).filter(Boolean);
    onConfirm(chosen);
  }

  return (
    <div style={{ ...overlay, opacity: shown ? 1 : 0, transition: "opacity .25s ease" }} onClick={onCancel}>
      <div style={{
        ...GLASS_PANEL, borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto",
        transform: shown ? "translateY(0)" : "translateY(100%)", transition: "transform .34s cubic-bezier(.22,1,.36,1)",
      }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, margin: "0 0 4px" }}>{cp.name || "เลือกเมนู"}</h2>
        <p style={{ fontSize: 12, color: COLORS.espresso2, margin: "0 0 14px" }}>เลือก {need} รายการจาก {pool.length} รายการ ({selected.length}/{need})</p>

        {pool.map((m) => {
          const isSel = selected.includes(m.id);
          const disabled = !isSel && selected.length >= need;
          return (
            <button
              key={m.id}
              className={`customer-option-choice${isSel ? " selected" : ""}`}
              onClick={() => toggle(m.id)}
              disabled={disabled}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                textAlign: "left", padding: "9px 12px", marginBottom: 6, borderRadius: 9, cursor: disabled ? "default" : "pointer",
                border: isSel ? `1.5px solid ${COLORS.sage}` : `1px solid ${COLORS.line}`,
                background: isSel ? COLORS.sageLight : "#fff", color: COLORS.espresso4, fontSize: 13,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <span style={{ fontWeight: 500 }}>{m.name}</span>
              <span style={{ fontSize: 12.5, whiteSpace: "nowrap", marginLeft: 8 }}>{money(m.priceStore)}</span>
            </button>
          );
        })}

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={btn} onClick={onCancel}>ยกเลิก</button>
          <button style={btnAccent} disabled={selected.length !== need} onClick={confirm}>
            เพิ่มลงตะกร้า ({selected.length}/{need})
          </button>
        </div>
      </div>
    </div>
  );
}

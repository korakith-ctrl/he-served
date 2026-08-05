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
  "coffee-pass": { title: "ใช้สิทธิ์ Coffee Pass แล้ว", instruction: "ไม่ต้องชำระเพิ่ม ระบบหักสิทธิ์นี้เรียบร้อยแล้ว" },
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

const PANTONE_299C = "#00A3E0";
// ตัวเลือก: "minimal-white" (ปัจจุบัน), "zone2-dark" หรือ "legacy"
const CUSTOMER_SPLASH_VARIANT = "minimal-white";
const COLORS = {
  cream: "#F7FCFE", cream2: "#E8F7FC", surface: "#FFFFFF",
  espresso5: "#003B5C", espresso4: "#005B85", espresso3: "#35657D", espresso2: "#718A99",
  sage: PANTONE_299C, sageDark: "#0077A8", sageLight: "#D9F3FC",
  gold: PANTONE_299C, goldLight: "#D9F3FC",
  danger: "#B23A2E", line: "#CDEAF5",
  success: "#2E9E4F", successDark: "#1F7A38", successLight: "#DFF3E3",
  pending: "#B8860B", pendingLight: "#FCEFD1",
};

const SEASONAL_EFFECTS = new Set(["off", "auto", "christmas", "songkran"]);

function bangkokMonthDay(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Bangkok", month: "numeric", day: "numeric",
    }).formatToParts(date);
    return {
      month: Number(parts.find((part) => part.type === "month")?.value),
      day: Number(parts.find((part) => part.type === "day")?.value),
    };
  } catch {
    return { month: date.getMonth() + 1, day: date.getDate() };
  }
}

function resolveSeasonalEffect(setting, date = new Date()) {
  const selected = SEASONAL_EFFECTS.has(setting) ? setting : "auto";
  if (selected !== "auto") return selected;
  const { month, day } = bangkokMonthDay(date);
  if (month === 4 && day >= 12 && day <= 16) return "songkran";
  if ((month === 12 && day >= 20) || (month === 1 && day <= 5)) return "christmas";
  return "off";
}

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
  paid: { icon: "checks", color: COLORS.sageDark, bg: "rgba(0,163,224,0.16)", anim: "cartBump .5s ease" },
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
  background: "rgba(255,255,255,0.82)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(0,163,224,0.14)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 8px 24px rgba(0,91,133,0.10)",
};

function SeasonalEffects({ effect }) {
  if (effect === "off") return null;
  const particles = Array.from({ length: effect === "christmas" ? 26 : 18 }, (_, index) => ({
    left: `${(index * 37 + 7) % 100}%`,
    delay: `${-((index * 1.37) % 12).toFixed(2)}s`,
    duration: `${(effect === "christmas" ? 8 : 5) + (index % 7) * 0.7}s`,
    drift: `${((index % 5) - 2) * 24}px`,
    size: `${effect === "christmas" ? 11 + (index % 5) * 3 : 9 + (index % 4) * 5}px`,
  }));

  return (
    <div className={`seasonal-effects seasonal-effects--${effect}`} aria-hidden="true">
      {particles.map((particle, index) => (
        <span
          key={index}
          className={effect === "christmas" ? "seasonal-snowflake" : "seasonal-water-drop"}
          style={{
            "--season-left": particle.left,
            "--season-delay": particle.delay,
            "--season-duration": particle.duration,
            "--season-drift": particle.drift,
            "--season-size": particle.size,
          }}
        >
          {effect === "christmas" ? (index % 3 === 0 ? "❄" : index % 3 === 1 ? "✦" : "•") : ""}
        </span>
      ))}
      {effect === "songkran" && (
        <>
          <span className="seasonal-water-arc seasonal-water-arc--left" />
          <span className="seasonal-water-arc seasonal-water-arc--right" />
        </>
      )}
    </div>
  );
}

function GlassBackdrop({ seasonalEffect = "off" }) {
  return (
    <>
      <div className="customer-backdrop" style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", background: "linear-gradient(160deg, #FFFFFF, #EDF9FD)" }}>
        <div style={{ position: "absolute", top: "-10%", left: "-10%", width: "55%", height: "45%", borderRadius: "50%", background: PANTONE_299C, opacity: 0.2, filter: "blur(70px)", animation: "blobFloat1 16s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "-5%", right: "-12%", width: "45%", height: "40%", borderRadius: "50%", background: "#74D1EE", opacity: 0.22, filter: "blur(70px)", animation: "blobFloat2 18s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "-15%", left: "20%", width: "60%", height: "50%", borderRadius: "50%", background: "#BFEAF8", opacity: 0.38, filter: "blur(80px)", animation: "blobFloat3 20s ease-in-out infinite" }} />
      </div>
      <SeasonalEffects effect={seasonalEffect} />
    </>
  );
}

function money(n) {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function genLineId() {
  return "line_" + Math.random().toString(36).slice(2, 9);
}

const HOT_DEAL_CATEGORY = "HOT DEAL";
const COFFEE_PASS_CATEGORY = "COFFEE PASS";

function productTypeOf(item) {
  if (item?.productType === "pass") return "pass";
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
  border: "1px solid rgba(0,163,224,0.22)",
  background: "rgba(255,255,255,0.82)",
  backdropFilter: "blur(14px) saturate(180%)",
  WebkitBackdropFilter: "blur(14px) saturate(180%)",
  color: COLORS.espresso4, borderRadius: 11,
  padding: "9px 14px", fontSize: 13.5, fontWeight: 500, cursor: "pointer",
};
const btnAccent = {
  ...btn, background: COLORS.sageDark, color: "#fff", borderColor: COLORS.sageDark, width: "100%",
  backdropFilter: "none", WebkitBackdropFilter: "none",
};
const field = {
  width: "100%", border: "1px solid rgba(0,163,224,0.22)", background: "rgba(255,255,255,0.86)",
  borderRadius: 10, padding: "9px 10px", fontSize: 14, boxSizing: "border-box", marginTop: 4,
};
const overlay = {
  position: "fixed", inset: 0, background: "rgba(0,59,92,0.38)",
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
  .offer-card:hover { transform: translateY(-2px) scale(1.02); box-shadow: 0 14px 32px rgba(0,91,133,0.18); }
  .offer-card:active { transform: scale(0.98); }
  .offer-arrow-btn { transition: transform .2s ease, background .2s ease; }
  .offer-arrow-btn:hover { transform: scale(1.08); background: #C5EDFA; }
  .offer-arrow-btn:active { transform: scale(0.94); }
  .zone2-minimal-splash { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; overflow: hidden; background: #FFFFFF; transition: opacity .5s ease, visibility .5s ease; }
  .zone2-minimal-splash.is-leaving { opacity: 0; visibility: hidden; }
  .zone2-minimal-stage { position: relative; width: clamp(104px, 30vw, 132px); aspect-ratio: 1058 / 1352; }
  .zone2-minimal-mark { position: relative; width: 100%; height: 100%; transform: translate3d(0,0,0); will-change: transform; animation: zone2MinimalLift .9s cubic-bezier(.45,0,.25,1) .52s forwards; }
  .zone2-minimal-mark::before { content: ""; position: absolute; z-index: -1; inset: 18% 5%; border-radius: 50%; background: rgba(0,163,224,.1); filter: blur(30px); opacity: .22; }
  .zone2-minimal-logo-crop { position: absolute; inset: 0; overflow: hidden; }
  .zone2-minimal-logo-crop img { position: absolute; width: 193.57%; height: auto; max-width: none; left: -46.79%; top: -25.74%; display: block; }
  .zone2-minimal-tagline { position: absolute; top: calc(100% + 6px); left: 50%; color: #536F7E; font-family: 'Space Grotesk', sans-serif; font-size: clamp(10px, 3vw, 13px); font-weight: 700; letter-spacing: .18em; line-height: 1; white-space: nowrap; opacity: 0; transform: translate(-50%, 10px); animation: zone2MinimalTextFade .72s ease 1.18s forwards; }
  @keyframes zone2MinimalLift { from { transform: translate3d(0,0,0); } to { transform: translate3d(0,-22px,0); } }
  @keyframes zone2MinimalTextFade { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
  .zone2-splash {
    position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; overflow: hidden;
    color: #F7FBFF; background: radial-gradient(circle at 50% 42%, rgba(17,148,207,.12), transparent 30%), linear-gradient(145deg, #05070A 0%, #0A1017 55%, #05070A 100%);
    transition: opacity .55s ease, visibility .55s ease;
  }
  .zone2-splash.is-leaving { opacity: 0; visibility: hidden; }
  .zone2-splash-ambient { position: absolute; width: 34rem; aspect-ratio: 1; border-radius: 50%; filter: blur(90px); opacity: .12; background: #18A4DC; animation: zone2AmbientFloat 6s ease-in-out infinite alternate; }
  .zone2-splash-ambient.one { top: -18rem; left: -12rem; }
  .zone2-splash-ambient.two { right: -16rem; bottom: -20rem; animation-delay: -3s; }
  .zone2-splash-stage { position: relative; width: min(78vw, 340px); display: flex; flex-direction: column; align-items: center; transform: translateY(-1vh); }
  .zone2-splash-logo-wrap { position: relative; width: 100%; aspect-ratio: 1; display: grid; place-items: center; opacity: 0; transform: translateY(38px) scale(.74) rotate(-3deg); animation: zone2LogoEnter .9s cubic-bezier(.2,.9,.22,1.22) .12s forwards; }
  .zone2-splash-logo { position: relative; z-index: 2; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 18px 24px rgba(0,0,0,.4)); animation: zone2LogoBreathe 2.8s ease-in-out 1.15s infinite; }
  .zone2-splash-logo-glow { position: absolute; inset: 26%; border-radius: 50%; background: #18A4DC; filter: blur(44px); opacity: 0; animation: zone2GlowPop 1.15s ease .35s forwards, zone2GlowPulse 2.8s ease-in-out 1.4s infinite; }
  .zone2-splash-shine { position: absolute; z-index: 3; top: 22%; left: 25%; width: 15%; height: 55%; transform: translateX(-230%) skewX(-18deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent); filter: blur(2px); mix-blend-mode: screen; opacity: 0; animation: zone2ShineSweep 1.15s ease 1.15s forwards; pointer-events: none; }
  .zone2-splash-steam { position: absolute; z-index: 4; top: 4%; left: 50%; width: 52%; height: 26%; transform: translateX(-50%); pointer-events: none; }
  .zone2-splash-steam-line { position: absolute; bottom: 0; width: 15px; height: 74px; border: 4px solid transparent; border-left-color: rgba(255,255,255,.7); border-radius: 50%; opacity: 0; filter: blur(.2px); animation: zone2SteamRise 2.15s ease-in-out infinite; }
  .zone2-splash-steam-line.one { left: 22%; animation-delay: 1.05s; }
  .zone2-splash-steam-line.two { left: 47%; height: 88px; animation-delay: 1.38s; }
  .zone2-splash-steam-line.three { right: 18%; height: 66px; animation-delay: 1.7s; }
  .zone2-splash-brand-copy { margin-top: -13%; text-align: center; opacity: 0; transform: translateY(14px); animation: zone2CopyEnter .55s ease .92s forwards; }
  .zone2-splash-brand { font-size: clamp(1.35rem, 5vw, 1.8rem); font-weight: 850; letter-spacing: .28em; padding-left: .28em; }
  .zone2-splash-tagline { margin-top: .42rem; color: rgba(247,251,255,.58); font-size: .78rem; letter-spacing: .14em; }
  .zone2-splash-loader { display: flex; gap: 7px; margin-top: 1.45rem; opacity: 0; animation: zone2LoaderIn .35s ease 1.25s forwards; }
  .zone2-splash-loader span { width: 7px; height: 7px; border-radius: 50%; background: #18A4DC; box-shadow: 0 0 13px rgba(24,164,220,.36); animation: zone2BeanBounce 1s ease-in-out infinite; }
  .zone2-splash-loader span:nth-child(2) { animation-delay: .14s; }
  .zone2-splash-loader span:nth-child(3) { animation-delay: .28s; }
  @keyframes zone2LogoEnter { 0% { opacity: 0; transform: translateY(38px) scale(.74) rotate(-3deg); } 68% { opacity: 1; transform: translateY(-7px) scale(1.035) rotate(.8deg); } 100% { opacity: 1; transform: translateY(0) scale(1) rotate(0); } }
  @keyframes zone2LogoBreathe { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-4px) scale(1.012); } }
  @keyframes zone2GlowPop { to { opacity: .32; transform: scale(1.28); } }
  @keyframes zone2GlowPulse { 0%,100% { opacity: .25; } 50% { opacity: .42; } }
  @keyframes zone2ShineSweep { 0% { opacity: 0; transform: translateX(-230%) skewX(-18deg); } 25% { opacity: .8; } 100% { opacity: 0; transform: translateX(450%) skewX(-18deg); } }
  @keyframes zone2SteamRise { 0% { opacity: 0; transform: translateY(12px) translateX(0) scale(.75) rotate(7deg); } 25% { opacity: .58; } 72% { opacity: .22; } 100% { opacity: 0; transform: translateY(-55px) translateX(13px) scale(1.15) rotate(-9deg); } }
  @keyframes zone2CopyEnter { to { opacity: 1; transform: translateY(0); } }
  @keyframes zone2LoaderIn { to { opacity: 1; } }
  @keyframes zone2BeanBounce { 0%,60%,100% { transform: translateY(0) scale(1); opacity: .35; } 30% { transform: translateY(-7px) scale(1.1); opacity: 1; } }
  @keyframes zone2AmbientFloat { to { transform: translate3d(28px,18px,0) scale(1.08); } }
  .banner-carousel { touch-action: pan-y; }
  .banner-slide { transition: opacity .45s ease; }
  .banner-carousel:focus-visible { outline: 3px solid rgba(0,163,224,.42); outline-offset: 2px; }
  @keyframes offerRipple { 0% { transform: scale(0); opacity: .5; } 100% { transform: scale(2.4); opacity: 0; } }
  .offer-ripple { position: absolute; inset: 0; border-radius: inherit; background: rgba(0,163,224,0.22); animation: offerRipple .5s ease-out; pointer-events: none; }
  .coffee-pass-buy-border { position: relative; isolation: isolate; overflow: hidden; padding: 2px; border-radius: 14px; background: #FFFFFF; box-shadow: 0 7px 20px rgba(0,59,92,.22); }
  .coffee-pass-buy-border::before { content: ""; position: absolute; z-index: 0; inset: -180%; background: conic-gradient(from 0deg, #FFFFFF 0deg, #74D1EE 58deg, #00A3E0 112deg, #FFFFFF 168deg, #0077A8 230deg, #74D1EE 300deg, #FFFFFF 360deg); animation: coffeePassBorderSpin 2.4s linear infinite; }
  .coffee-pass-buy-border > button { position: relative; z-index: 1; }
  @keyframes coffeePassBorderSpin { to { transform: rotate(360deg); } }
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
  .seasonal-effects { position: fixed; inset: 0; z-index: 12; overflow: hidden; pointer-events: none; contain: strict; }
  .seasonal-snowflake {
    position: absolute; top: -12vh; left: var(--season-left); color: rgba(255,255,255,.96);
    font-size: var(--season-size); line-height: 1; text-shadow: 0 0 5px rgba(0,91,133,.62), 0 1px 1px rgba(0,59,92,.32);
    opacity: .82; will-change: transform; animation: seasonalSnowFall var(--season-duration) var(--season-delay) linear infinite;
  }
  .seasonal-water-drop {
    position: absolute; top: -12vh; left: var(--season-left); width: var(--season-size); height: calc(var(--season-size) * 1.28);
    border: 1px solid rgba(255,255,255,.8); border-radius: 68% 32% 63% 37% / 67% 38% 62% 33%;
    background: linear-gradient(145deg, rgba(255,255,255,.76), rgba(0,163,224,.48) 48%, rgba(0,91,133,.32));
    box-shadow: inset 2px 2px 3px rgba(255,255,255,.5), 0 2px 7px rgba(0,91,133,.2);
    opacity: .68; will-change: transform; animation: seasonalWaterFall var(--season-duration) var(--season-delay) cubic-bezier(.38,.05,.75,.65) infinite;
  }
  .seasonal-water-arc { position: fixed; bottom: -115px; width: 210px; height: 210px; border: 4px solid rgba(0,163,224,.2); border-radius: 50%; box-shadow: 0 0 0 18px rgba(116,209,238,.08), 0 0 0 38px rgba(0,163,224,.045); animation: seasonalWaterPulse 2.8s ease-in-out infinite; }
  .seasonal-water-arc--left { left: -110px; }
  .seasonal-water-arc--right { right: -110px; animation-delay: -1.4s; }
  @keyframes seasonalSnowFall {
    0% { transform: translate3d(0,-8vh,0) rotate(0deg); opacity: 0; }
    12% { opacity: .82; }
    88% { opacity: .82; }
    100% { transform: translate3d(var(--season-drift),120vh,0) rotate(380deg); opacity: 0; }
  }
  @keyframes seasonalWaterFall {
    0% { transform: translate3d(0,-8vh,0) rotate(38deg) scale(.7); opacity: 0; }
    14% { opacity: .68; }
    100% { transform: translate3d(var(--season-drift),122vh,0) rotate(118deg) scale(1); opacity: 0; }
  }
  @keyframes seasonalWaterPulse { 0%,100% { transform: scale(.92); opacity: .52; } 50% { transform: scale(1.1); opacity: .9; } }
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
  html[data-theme="dark"] .customer-backdrop { background: linear-gradient(160deg, #00263A, #003B5C) !important; }
  html[data-theme="dark"] .customer-backdrop > div { opacity: .16 !important; }
  html[data-theme="dark"] .corder input,
  html[data-theme="dark"] .corder select,
  html[data-theme="dark"] .corder textarea { background: rgba(16,26,39,.92) !important; color: #E7ECF3 !important; border-color: #344256 !important; }
  html[data-theme="dark"] .corder [style*="background: rgb(255, 255, 255)"],
  html[data-theme="dark"] .corder [style*="background: rgba(255, 255, 255"] { background: rgba(18,28,41,.88) !important; border-color: rgba(148,163,184,.20) !important; }
  html[data-theme="dark"] .corder [style*="color: rgb(0, 59, 92)"],
  html[data-theme="dark"] .corder [style*="color: rgb(0, 91, 133)"],
  html[data-theme="dark"] .corder [style*="color: rgb(53, 101, 125)"] { color: #E7F7FC !important; }
  html[data-theme="dark"] .corder [style*="color: rgb(113, 138, 153)"] { color: #B7D2DF !important; }
  html[data-theme="dark"] .corder [style*="background: rgb(247, 252, 254)"],
  html[data-theme="dark"] .corder [style*="background: rgb(232, 247, 252)"] { background: #003B5C !important; }
  html[data-theme="dark"] .corder .zone-header { background: rgba(15,24,36,.94) !important; border: 1px solid rgba(148,163,184,.16); box-shadow: 0 10px 30px rgba(0,0,0,.28) !important; }
  html[data-theme="dark"] .corder .zone-logo-shell { background: #FFFFFF !important; border-color: rgba(0,163,224,.28) !important; }
  html[data-theme="dark"] .corder .zone-logo-shell div { color: #003B5C !important; }
  html[data-theme="dark"] .corder .customer-category-nav { background: rgba(15,24,36,.82) !important; border-color: rgba(148,163,184,.16) !important; }
  html[data-theme="dark"] .corder .customer-category-tab { color: #A9B5C5 !important; }
  html[data-theme="dark"] .corder .customer-category-tab.active { background: #00A3E0 !important; color: #FFFFFF !important; box-shadow: 0 5px 14px rgba(0,163,224,.28) !important; }
  html[data-theme="dark"] .corder .customer-option-choice { background: #172333 !important; color: #E7ECF3 !important; border-color: #344256 !important; }
  html[data-theme="dark"] .corder .customer-option-choice.selected { background: rgba(0,163,224,.24) !important; color: #E9F9FE !important; border-color: #00A3E0 !important; }
  html[data-theme="dark"] .corder .customer-option-choice [style*="color"] { color: #B8C4D2 !important; }
  .closed-order-page {
    min-height: 100vh; min-height: 100dvh; position: relative; isolation: isolate; overflow: hidden;
    display: grid; place-items: center; padding: 28px 18px; color: #FFFFFF;
    background: radial-gradient(circle at 12% 12%, rgba(255,255,255,.18), transparent 31%), radial-gradient(circle at 88% 86%, rgba(0,163,224,.30), transparent 36%), linear-gradient(145deg, #003B5C 0%, #006A96 52%, #00A3E0 100%);
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
    background: linear-gradient(145deg, rgba(255,255,255,.18), rgba(255,255,255,.08));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.17), 0 28px 70px rgba(0,0,0,.28);
    backdrop-filter: blur(24px) saturate(135%); -webkit-backdrop-filter: blur(24px) saturate(135%);
    animation: closedPanelIn .75s cubic-bezier(.22,1,.36,1) both;
  }
  .closed-order-brand {
    display: inline-flex; align-items: center; gap: 10px; max-width: 100%; padding: 7px 12px 7px 7px;
    border: 1px solid rgba(255,255,255,.22); border-radius: 999px; background: rgba(0,59,92,.28);
    animation: closedFadeUp .55s .08s ease both;
  }
  .closed-order-brand-logo { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; overflow: hidden; border-radius: 11px; background: #FFFFFF; }
  .closed-order-art { width: 190px; height: 174px; position: relative; margin: 20px auto 4px; animation: closedFadeUp .65s .14s cubic-bezier(.22,1,.36,1) both; }
  .closed-order-orbit { position: absolute; inset: 3px 12px 0; border: 1px solid rgba(255,255,255,.13); border-radius: 50%; animation: closedOrbitSpin 13s linear infinite; }
  .closed-order-orbit::before, .closed-order-orbit::after {
    content: ""; position: absolute; width: 9px; height: 13px; border-radius: 50%; background: #74D1EE;
    box-shadow: inset -2px -2px 0 rgba(0,59,92,.2), 0 0 18px rgba(116,209,238,.55);
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
    display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid rgba(255,255,255,.26);
    border-radius: 999px; color: #FFFFFF; background: rgba(0,163,224,.22); font-size: 11px; font-weight: 700; letter-spacing: .06em;
    animation: closedFadeUp .55s .22s ease both;
  }
  .closed-order-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #FFFFFF; box-shadow: 0 0 0 0 rgba(255,255,255,.55); animation: closedStatusPulse 2s ease-out infinite; }
  .closed-order-title {
    margin: 15px 0 8px; color: #FFFFFF; font-family: 'Space Grotesk', sans-serif; font-size: clamp(26px, 8vw, 36px);
    line-height: 1.08; letter-spacing: -.035em; animation: closedFadeUp .6s .28s ease both;
  }
  .closed-order-copy { max-width: 340px; margin: 0 auto; color: rgba(235,242,248,.72); font-size: 13.5px; line-height: 1.7; animation: closedFadeUp .6s .35s ease both; }
  .closed-order-live {
    display: flex; align-items: center; justify-content: center; gap: 8px; margin: 19px 0 0; padding-top: 17px;
    border-top: 1px solid rgba(255,255,255,.11); color: rgba(224,235,243,.67); font-size: 11.5px; animation: closedFadeUp .6s .42s ease both;
  }
  .closed-order-live i { color: #BFEAF8; animation: closedRefresh 4s ease-in-out infinite; }
  .closed-order-button {
    width: 100%; min-height: 48px; margin-top: 14px; border: 1px solid rgba(255,255,255,.2); border-radius: 15px;
    color: #003B5C; background: #FFFFFF; box-shadow: 0 10px 24px rgba(0,59,92,.2); font-size: 13px; font-weight: 700;
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
  @keyframes closedStatusPulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.5); } 70%, 100% { box-shadow: 0 0 0 7px rgba(255,255,255,0); } }
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
    .zone2-minimal-splash *, .zone2-minimal-splash *::before, .zone2-minimal-splash *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    .zone2-splash *, .zone2-splash *::before, .zone2-splash *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    .coffee-pass-buy-border::before { animation: none; }
    .seasonal-effects { display: none; }
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
          fontSize: 10.5, fontWeight: 700, color: COLORS.sageDark, textTransform: "uppercase", letterSpacing: ".03em",
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
      border: "1px solid rgba(0,163,224,0.16)", boxShadow: "0 8px 24px rgba(0,91,133,0.10)", flexShrink: 0,
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
              <span style={{ padding: "2px 7px", borderRadius: 999, color: "#fff", background: "rgba(0,59,92,.68)", fontSize: 9.5, fontWeight: 700 }}>
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
  // ไฟล์ต้นฉบับเป็น canvas จัตุรัสที่มีพื้นที่โปร่งใสรอบโลโก้ จึง crop ด้วย container
  // เพื่อให้สัญลักษณ์มีขนาดชัดเจนทั้งใน splash และ header โดยไม่แก้คุณภาพไฟล์ต้นฉบับ
  const sourceScale = height / 1352;
  return (
    <span style={{ position: "relative", display: "block", width: 1058 * sourceScale, height, overflow: "hidden", flexShrink: 0 }}>
      <img
        src="/logo-zone2.png"
        alt="Zone 2"
        onError={() => setFailed(true)}
        style={{ position: "absolute", width: 2048 * sourceScale, height: 2048 * sourceScale, left: -495 * sourceScale, top: -348 * sourceScale, display: "block" }}
      />
    </span>
  );
}

// เก็บ Splash เดิมไว้เพื่อสลับกลับได้ทันทีหากต้องการ
function LegacyLandingScreen({ seasonalEffect }) {
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
      <SeasonalEffects effect={seasonalEffect} />
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
          <BrandLogo height={250} />
        </div>
      </div>
    </div>
  );
}

function DarkLandingScreen({ leaving = false }) {
  return (
    <div className="corder">
      <style>{GLOBAL_CSS}</style>
      <div className={`zone2-splash${leaving ? " is-leaving" : ""}`} role="status" aria-label="กำลังเปิดร้าน ZONE 2">
        <div className="zone2-splash-ambient one" aria-hidden="true" />
        <div className="zone2-splash-ambient two" aria-hidden="true" />

        <div className="zone2-splash-stage">
          <div className="zone2-splash-steam" aria-hidden="true">
            <span className="zone2-splash-steam-line one" />
            <span className="zone2-splash-steam-line two" />
            <span className="zone2-splash-steam-line three" />
          </div>

          <div className="zone2-splash-logo-wrap">
            <div className="zone2-splash-logo-glow" />
            <img className="zone2-splash-logo" src="/logo-zone2.png" alt="ZONE 2 Coffee" />
            <div className="zone2-splash-shine" aria-hidden="true" />
          </div>

          <div className="zone2-splash-brand-copy">
            <div className="zone2-splash-brand">ZONE 2</div>
            <div className="zone2-splash-tagline">Coffee in your zone.</div>
          </div>

          <div className="zone2-splash-loader" aria-hidden="true"><span /><span /><span /></div>
        </div>
      </div>
    </div>
  );
}

function LandingScreen({ leaving = false }) {
  return (
    <div className="corder">
      <style>{GLOBAL_CSS}</style>
      <div className={`zone2-minimal-splash${leaving ? " is-leaving" : ""}`} role="status" aria-label="กำลังเปิดร้าน ZONE 2">
        <div className="zone2-minimal-stage" aria-hidden="true">
          <div className="zone2-minimal-mark">
            <span className="zone2-minimal-logo-crop">
              <img src="/logo-zone2.png" alt="" />
            </span>
          </div>
          <div className="zone2-minimal-tagline">CRAFTED FOR PERFORMANCE</div>
        </div>
      </div>
    </div>
  );
}

function ClosedOrderScreen({ shopName, hasOrders, onOpenOrders, seasonalEffect }) {
  return (
    <main className="corder closed-order-page">
      <style>{GLOBAL_CSS}</style>
      <SeasonalEffects effect={seasonalEffect} />
      <div className="closed-order-glow" aria-hidden="true" style={{ width: 240, height: 240, top: "-90px", right: "-90px", background: "rgba(255,255,255,.16)" }} />
      <div className="closed-order-glow" aria-hidden="true" style={{ width: 310, height: 310, bottom: "-150px", left: "-130px", background: "rgba(0,163,224,.2)", animationDelay: "-4s" }} />

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
  const [seasonalEffect, setSeasonalEffect] = useState("auto");
  const [coffeePass, setCoffeePass] = useState({ name: "Coffee Pass", enabled: false, uses: 5, price: 250, validityDays: 30, menuIds: [] });
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
  const [showCoffeePassDetails, setShowCoffeePassDetails] = useState(false);
  const [selectedPassId, setSelectedPassId] = useState("");
  const [passPurchaseCode, setPassPurchaseCode] = useState("");
  const [passPurchaseCodeConfirm, setPassPurchaseCodeConfirm] = useState("");
  const [passRedeemCode, setPassRedeemCode] = useState("");
  const [passRedemptionAttemptId, setPassRedemptionAttemptId] = useState("");
  const [passCodeCheckStatus, setPassCodeCheckStatus] = useState("idle");
  const [passCodeCheckError, setPassCodeCheckError] = useState("");
  const [passExtraPaymentMethod, setPassExtraPaymentMethod] = useState("promptpay");
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
  const [splashMinimumElapsed, setSplashMinimumElapsed] = useState(false);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [takeoverPromo, setTakeoverPromo] = useState(null);
  const [hasActiveOrder, setHasActiveOrder] = useState(false);
  const [headerRipple, setHeaderRipple] = useState(false);

  const mainRef = useRef(null);
  const sectionRefs = useRef({});
  const offerCarouselRef = useRef(null);
  const offerInteractionAtRef = useRef(0);
  const [offerRippleId, setOfferRippleId] = useState(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minimumDuration = reducedMotion ? 350 : (CUSTOMER_SPLASH_VARIANT === "minimal-white" ? 2500 : 2250);
    const t = setTimeout(() => setSplashMinimumElapsed(true), minimumDuration);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!splashMinimumElapsed || !authUid || menus === null) return undefined;
    setSplashLeaving(true);
    const t = setTimeout(() => setSplashDone(true), 560);
    return () => clearTimeout(t);
  }, [splashMinimumElapsed, authUid, menus]);

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
    const unsub11 = onValue(
      ref(db, `shops/${shopUid}/settings/seasonalEffect`),
      (snap) => {
        const value = snap.val();
        setSeasonalEffect(SEASONAL_EFFECTS.has(value) ? value : "auto");
      },
      (err) => console.error("อ่านเอฟเฟกต์เทศกาลไม่ได้ (เช็คว่า deploy database.rules.json ล่าสุดหรือยัง):", err.message)
    );
    const unsub12 = onValue(
      ref(db, `shops/${shopUid}/settings/coffeePass`),
      (snap) => {
        const value = snap.val() || {};
        setCoffeePass({
          name: String(value.name || "Coffee Pass"),
          enabled: value.enabled === true,
          uses: Math.min(100, Math.max(1, Number(value.uses ?? value.days) || 5)),
          price: Math.max(0, Number.isFinite(Number(value.price)) ? Number(value.price) : 250),
          validityDays: Math.min(365, Math.max(1, Number(value.validityDays) || 30)),
          menuIds: (Array.isArray(value.menuIds) ? value.menuIds : Object.values(value.menuIds || {})).filter(Boolean),
        });
      },
      (err) => console.error("อ่านการตั้งค่า Coffee Pass ไม่ได้ (เช็คว่า deploy database.rules.json ล่าสุดหรือยัง):", err.message)
    );
    const unsub8 = onValue(ref(db, `shops/${shopUid}/promotions`), (snap) => {
      const list = snap.val() || [];
      setPromotions(list.map((p) => ({
        ...p,
        type: p.type || (p.menuIds && p.menuIds.length > 1 ? "bundle" : "single"),
        minQty: p.minQty || 2,
        chooseCount: p.chooseCount || 2,
      })));
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); unsub7b(); unsub8(); unsub9(); unsub10(); unsub11(); unsub12(); };
  }, [authUid, shopUid]);

  // เช็คเมล็ดสะสมของเบอร์นี้แบบสด — debounce กันยิง query ทุกครั้งที่พิมพ์ และรอให้เบอร์ครบอย่างน้อย 9 หลักก่อน
  // แยกสถานะ loading/error ออกจากตัวข้อมูล เพื่อให้ UI บอกลูกค้าได้ว่ากำลังโหลดอยู่ หรือโหลดไม่สำเร็จ (ไม่ใช่แค่ "ยังไม่มีข้อมูล")
  useEffect(() => {
    const phoneKey = normalizeThaiPhone(phone);
    if (!phoneKey) { setBeanRecord(null); setLoyaltyStatus("idle"); return; }
    setLoyaltyStatus("loading");
    const t = setTimeout(() => {
      const unsub = onValue(
        ref(db, `customers/${shopUid}/${phoneKey}`),
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
    setSelectedPassId("");
    setPassPurchaseCode("");
    setPassPurchaseCodeConfirm("");
    setPassRedeemCode("");
    setPassRedemptionAttemptId("");
    setPassCodeCheckStatus("idle");
    setPassCodeCheckError("");
    setPassExtraPaymentMethod("promptpay");
  }

  const menusById = useMemo(() => {
    const m = {};
    (menus || []).forEach((x) => { m[x.id] = x; });
    return m;
  }, [menus]);

  const coffeePassEligibleMenus = useMemo(() => (menus || []).filter((menu) =>
    productTypeOf(menu) === "drink" &&
    menu.available !== false &&
    ((coffeePass.menuIds || []).length === 0 || coffeePass.menuIds.includes(menu.id))
  ), [menus, coffeePass.menuIds]);

  const coffeePassBenefit = useMemo(() => {
    const uses = Math.max(1, Number(coffeePass.uses) || 1);
    const passPrice = Math.max(0, Number(coffeePass.price) || 0);
    const eligiblePrices = coffeePassEligibleMenus.map((menu) => Number(menu.priceStore)).filter((price) => price > 0);
    const minMenuPrice = eligiblePrices.length ? Math.min(...eligiblePrices) : 0;
    const maxMenuPrice = eligiblePrices.length ? Math.max(...eligiblePrices) : 0;
    const regularMin = minMenuPrice * uses;
    const regularMax = maxMenuPrice * uses;
    const savingsMin = Math.max(0, regularMin - passPrice);
    const savingsMax = Math.max(0, regularMax - passPrice);
    const savingsPercentMax = regularMax > 0 ? Math.round((savingsMax / regularMax) * 100) : 0;
    return {
      uses,
      passPrice,
      perCup: passPrice / uses,
      regularMin,
      regularMax,
      savingsMin,
      savingsMax,
      savingsPercentMax,
      hasPriceComparison: regularMax > passPrice,
    };
  }, [coffeePass.uses, coffeePass.price, coffeePassEligibleMenus]);

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
    for (const m of menus) {
      if (![HOT_DEAL_CATEGORY, COFFEE_PASS_CATEGORY].includes(m.category) && !seen.includes(m.category)) seen.push(m.category);
    }
    const ordered = categoryOrder && categoryOrder.length
      ? [...categoryOrder.filter((c) => seen.includes(c)), ...seen.filter((c) => !categoryOrder.includes(c))]
      : seen;
    const featured = [];
    if (activePromotions.length > 0) featured.push(HOT_DEAL_CATEGORY);
    const hasCoffeePassMenus = coffeePass.enabled === true && coffeePassEligibleMenus.length > 0;
    if (hasCoffeePassMenus) featured.push(COFFEE_PASS_CATEGORY);
    return [...featured, ...ordered];
  }, [menus, activePromotions, categoryOrder, coffeePass.enabled, coffeePassEligibleMenus]);

  useEffect(() => {
    if (categories.length > 0 && (!activeCategory || !categories.includes(activeCategory))) setActiveCategory(categories[0]);
  }, [categories, activeCategory]);

  // เลื่อนการ์ดโปรโมชันให้ลูกค้าเห็นว่ามีรายการถัดไป โดยเว้นช่วงหลังลูกค้าแตะ/ลากเอง
  // และปิด animation อัตโนมัติตาม accessibility preference ของเครื่อง
  useEffect(() => {
    const carousel = offerCarouselRef.current;
    if (!splashDone || !acceptingOrders || step !== "menu" || activePromotions.length <= 1 || !carousel) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    let timer;
    const markInteraction = () => { offerInteractionAtRef.current = Date.now(); };
    const schedule = (delay = 3600) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const elapsedSinceInteraction = Date.now() - offerInteractionAtRef.current;
        if (elapsedSinceInteraction < 5000) {
          schedule(5000 - elapsedSinceInteraction);
          return;
        }

        if (carousel.scrollWidth > carousel.clientWidth + 2) {
          const firstCard = carousel.firstElementChild;
          const stepWidth = firstCard ? firstCard.getBoundingClientRect().width + 14 : carousel.clientWidth;
          const isAtEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 8;
          carousel.scrollTo({
            left: isAtEnd ? 0 : Math.min(carousel.scrollLeft + stepWidth, carousel.scrollWidth - carousel.clientWidth),
            behavior: "smooth",
          });
        }
        schedule();
      }, delay);
    };

    carousel.addEventListener("pointerdown", markInteraction, { passive: true });
    carousel.addEventListener("wheel", markInteraction, { passive: true });
    schedule();
    return () => {
      window.clearTimeout(timer);
      carousel.removeEventListener("pointerdown", markInteraction);
      carousel.removeEventListener("wheel", markInteraction);
    };
  }, [splashDone, acceptingOrders, step, activePromotions]);

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

  // โปรที่ซื้อได้จากเมนูเดียว (single/qty) ต้องใช้ราคาเดียวกันไม่ว่าลูกค้าจะกดจาก Hot Deal
  // หรือจากหมวดเมนูปกติ ส่วน bundle/choice ยังต้องเข้าผ่านการ์ดโปรเพราะมีขั้นตอนเลือกหลายรายการ
  function bestDirectPromoForMenu(menu, qty = 1) {
    if (!menu) return null;
    const safeQty = Math.max(1, Number(qty) || 1);
    const candidates = activePromotions.filter((promo) =>
      (promo.type === "single" || promo.type === "qty") && promo.menuIds?.[0] === menu.id
    );
    return candidates.reduce((best, promo) => {
      const total = promo.type === "qty"
        ? qtyPromoTotal(promo, menu, safeQty)
        : singlePromoPrice(promo, menu) * safeQty;
      if (!best || total < best.total) return { promo, total };
      // ถ้าราคารวมเท่ากัน ให้โปร single มาก่อนเพื่อให้ราคาโปรเห็นผลตั้งแต่ชิ้นแรก
      if (total === best.total && promo.type === "single" && best.promo.type !== "single") return { promo, total };
      return best;
    }, null)?.promo || null;
  }

  function directLinesForMenu(menuId) {
    return cart.filter((line) => line.menuId === menuId && !["bundle", "choice", "coffee-pass"].includes(line.promoKind));
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
    offerInteractionAtRef.current = Date.now();
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
    if (cart.some((line) => String(line.promoKind || "").startsWith("coffee-pass"))) {
      setError("Coffee Pass ต้องชำระแยกจากรายการปกติ กรุณาชำระแพ็กนี้ก่อนเลือกเมนูอื่น");
      setShowCart(true);
      return;
    }
    const groups = groupsForMenu(menu);
    const effectivePromo = promo || bestDirectPromoForMenu(menu, 1);
    const isQty = effectivePromo && effectivePromo.type === "qty";
    const priceOverride = effectivePromo ? (isQty ? qtyPromoUnitPrice(effectivePromo, menu, 1) : singlePromoPrice(effectivePromo, menu)) : undefined;
    const promoId = effectivePromo ? effectivePromo.id : null;
    const promoKind = effectivePromo ? (isQty ? "qty" : "single") : null;
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
    if (cart.some((line) => String(line.promoKind || "").startsWith("coffee-pass"))) {
      setError("Coffee Pass ต้องชำระแยกจากรายการปกติ กรุณาชำระแพ็กนี้ก่อนเลือกเมนูอื่น");
      setShowCart(true);
      return;
    }
    const optionDelta = options.reduce((s, o) => s + (o.priceDelta || 0), 0);
    const base = priceOverride !== undefined ? priceOverride : menu.priceStore;
    const unitPrice = base + optionDelta;
    setCart((c) => [...c, {
      lineId: genLineId(), menuId: menu.id, name: menu.name, productType: productTypeOf(menu), unitPrice, originalUnitPrice: menu.priceStore + optionDelta,
      qty, options, promoId: promoId || null, promoGroupId: promoId || null, promoKind: promoKind || null,
    }]);
  }

  function buyCoffeePass() {
    if (!coffeePass.enabled) return;
    if (cart.length > 0) {
      setError("กรุณาชำระรายการในตะกร้าเดิมก่อนซื้อ Pass");
      setShowCart(true);
      return;
    }
    setCart([{
      lineId: genLineId(), menuId: "coffee_pass", name: coffeePass.name || "Coffee Pass", productType: "pass",
      unitPrice: coffeePass.price, originalUnitPrice: coffeePass.price, qty: 1, options: [],
      promoId: null, promoGroupId: null, promoKind: "coffee-pass-purchase",
      coffeePass: { ...coffeePass },
    }]);
    setPassPurchaseCode("");
    setPassPurchaseCodeConfirm("");
    setPaymentMethod("promptpay");
    setSelectedPassId("");
    setPassRedeemCode("");
    setPassRedemptionAttemptId("");
    setPassCodeCheckStatus("idle");
    setPassCodeCheckError("");
    setError("");
    setStep("phone");
  }

  function bundleQtyInCart(promo) {
    const first = promo.menuIds[0];
    const line = cart.find((l) => l.menuId === first && l.promoId === promo.id);
    return line ? line.qty : 0;
  }

  function setBundleQty(promo, qty, optionsByMenuId) {
    if (cart.some((line) => String(line.promoKind || "").startsWith("coffee-pass"))) {
      setError("Coffee Pass ต้องชำระแยกจากโปรโมชั่นอื่น");
      setShowCart(true);
      return;
    }
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
    if (cart.some((line) => String(line.promoKind || "").startsWith("coffee-pass"))) {
      setError("Coffee Pass ต้องชำระแยกจากโปรโมชั่นอื่น");
      setShowCart(true);
      return;
    }
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
    if (["bundle", "choice", "coffee-pass"].includes(line.promoKind)) return false;
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
      if (!["bundle", "choice", "coffee-pass"].includes(l.promoKind)) {
        const menu = menusById[l.menuId];
        const promo = bestDirectPromoForMenu(menu, qty);
        if (menu) {
          const optionDelta = (l.options || []).reduce((s, o) => s + (o.priceDelta || 0), 0);
          const promoBase = promo
            ? (promo.type === "qty" ? qtyPromoUnitPrice(promo, menu, qty) : singlePromoPrice(promo, menu))
            : menu.priceStore;
          return {
            ...l,
            qty,
            unitPrice: promoBase + optionDelta,
            originalUnitPrice: menu.priceStore + optionDelta,
            promoId: promo?.id || null,
            promoGroupId: promo?.id || null,
            promoKind: promo ? (promo.type === "qty" ? "qty" : "single") : null,
          };
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
  const customerPasses = Object.entries(beanRecord?.passes || {}).map(([id, raw]) => ({
    ...(raw || {}), id: raw?.id || id,
    menuIds: Array.isArray(raw?.menuIds) ? raw.menuIds : Object.values(raw?.menuIds || {}),
  })).sort((a, b) => (Number(a.expiresAt) || 0) - (Number(b.expiresAt) || 0));
  const activeCustomerPasses = customerPasses.filter((pass) => Number(pass.remainingUses) > 0 && Number(pass.expiresAt) >= Date.now() && pass.status !== "cancelled");
  const redeemDiscount = beanGoalMet && redeemLine && rewardVerified ? redeemLine.unitPrice : 0;
  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0) - redeemDiscount;
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const loyaltyCartCount = cart.reduce((sum, line) => sum + (productTypeOf(line) === "drink" ? line.qty : 0), 0);
  const coffeePassPurchaseLine = cart.find((line) => line.promoKind === "coffee-pass-purchase") || null;
  const passCartLine = !coffeePassPurchaseLine && cart.length === 1 && cart[0].qty === 1 && productTypeOf(cart[0]) === "drink" ? cart[0] : null;
  const compatibleCustomerPasses = passCartLine
    ? activeCustomerPasses.filter((pass) => pass.menuIds.length === 0 || pass.menuIds.includes(passCartLine.menuId))
    : [];
  const selectedCustomerPass = compatibleCustomerPasses.find((pass) => pass.id === selectedPassId) || null;
  const compatiblePassIds = compatibleCustomerPasses.map((pass) => pass.id).join("|");
  const usingCoffeePass = paymentMethod === "coffee-pass" && Boolean(passCartLine && selectedCustomerPass);
  const passOptionTotal = usingCoffeePass
    ? Math.max(0, Math.round((passCartLine.options || []).reduce((sum, option) => sum + (Number(option.priceDelta) || 0), 0) * 100) / 100)
    : 0;
  const passCoveredAmount = usingCoffeePass ? Math.max(0, total - passOptionTotal) : 0;
  const checkoutTotal = usingCoffeePass ? passOptionTotal : total;
  const passPurchaseMismatch = passPurchaseCodeConfirm.length > 0 && !passPurchaseCode.startsWith(passPurchaseCodeConfirm);
  const passPurchaseCodesMatch = /^\d{6}$/.test(passPurchaseCode) && passPurchaseCode === passPurchaseCodeConfirm;

  useEffect(() => {
    if (step !== "phone" || coffeePassPurchaseLine) return;
    if (compatibleCustomerPasses.length > 0) {
      setSelectedPassId((current) => compatibleCustomerPasses.some((pass) => pass.id === current) ? current : compatibleCustomerPasses[0].id);
      setPaymentMethod("coffee-pass");
      setRedeemLineId(null);
      setRedeemMode(false);
      setRewardVerification(null);
      setRedemptionAttemptId("");
      setPassRedeemCode("");
      setPassRedemptionAttemptId(newRedemptionAttemptId());
      setPassCodeCheckStatus("idle");
      setPassCodeCheckError("");
      return;
    }
    setSelectedPassId("");
    setPassRedeemCode("");
    setPassRedemptionAttemptId("");
    setPassCodeCheckStatus("idle");
    setPassCodeCheckError("");
    setPaymentMethod((current) => current === "coffee-pass" ? "promptpay" : current);
    // compatiblePassIds changes only when the loaded phone/pass/cart result changes,
    // so a customer's later manual payment choice is not overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, coffeePassPurchaseLine?.lineId, phoneDigits, cartFingerprint, compatiblePassIds]);

  useEffect(() => {
    if (!usingCoffeePass || passRedeemCode.length !== 6 || !selectedPassId || !passRedemptionAttemptId) {
      if (passCodeCheckStatus !== "idle") setPassCodeCheckStatus("idle");
      return undefined;
    }
    let cancelled = false;
    setPassCodeCheckStatus("checking");
    setPassCodeCheckError("");
    const timer = setTimeout(async () => {
      try {
        const verifyPasscode = httpsCallable(functions, "verifyCoffeePassPasscode");
        await verifyPasscode({
          shopUid,
          customerPhone: phoneDigits,
          passId: selectedPassId,
          redemptionAttemptId: passRedemptionAttemptId,
          passcode: passRedeemCode,
        });
        if (!cancelled) setPassCodeCheckStatus("valid");
      } catch (passcodeError) {
        if (cancelled) return;
        setPassCodeCheckStatus("error");
        setPassCodeCheckError(passcodeError?.message || "Passcode ไม่ถูกต้อง");
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
    // Status is deliberately excluded: it is the output of this verification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingCoffeePass, passRedeemCode, selectedPassId, passRedemptionAttemptId, phoneDigits, shopUid]);

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
    const checkoutPaymentMethod = usingCoffeePass ? passExtraPaymentMethod : paymentMethod;
    if ((!usingCoffeePass || passOptionTotal > 0) && checkoutPaymentMethod === "promptpay" && !promptpayId) { setError("ร้านนี้ยังไม่เปิดรับชำระผ่าน QR (ยังไม่ได้ตั้งค่า PromptPay)"); return; }
    if (coffeePassPurchaseLine && !/^\d{6}$/.test(passPurchaseCode)) { setError("กรุณาตั้ง Passcode เป็นตัวเลข 6 หลัก"); return; }
    if (coffeePassPurchaseLine && passPurchaseCode !== passPurchaseCodeConfirm) { setError("Passcode และรหัสยืนยันไม่ตรงกัน"); return; }
    if (usingCoffeePass && !/^\d{6}$/.test(passRedeemCode)) { setError("กรุณากรอก Passcode 6 หลักของ Pass"); return; }
    if (usingCoffeePass && passCodeCheckStatus !== "valid") { setError(passCodeCheckError || "กรุณารอระบบตรวจสอบ Passcode"); return; }
    if (!usingCoffeePass && redeemLine && !rewardVerified) {
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
        paymentMethod: usingCoffeePass ? "coffee-pass" : paymentMethod,
        pickupDate,
      };
      let orderId;
      let orderData;

      if (usingCoffeePass) {
        const redeemPass = httpsCallable(functions, "redeemCoffeePass");
        const response = await redeemPass({
          shopUid,
          passId: selectedCustomerPass.id,
          redemptionAttemptId: passRedemptionAttemptId,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          passcode: passRedeemCode,
          menuId: passCartLine.menuId,
          options: passCartLine.options,
          paymentMethod: passExtraPaymentMethod,
          pickupDate,
          note: note.trim(),
        });
        orderId = response.data.orderId;
        orderData = response.data.order;
      } else if (coffeePassPurchaseLine) {
        const createPassOrder = httpsCallable(functions, "createCoffeePassOrder");
        const response = await createPassOrder({
          shopUid,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          paymentMethod,
          passcode: passPurchaseCode,
          note: note.trim(),
        });
        orderId = response.data.orderId;
        orderData = response.data.order;
      } else if (redeemLine && rewardVerified) {
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
      if (orderData.paymentMethod === "promptpay") {
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
      if (e.code === "functions/failed-precondition" && !usingCoffeePass) {
        setRewardVerification(null);
        setRedeemLineId(null);
      }
      setError(isAuthIssue && !usingCoffeePass && redeemLine
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

  const activeSeasonalEffect = resolveSeasonalEffect(seasonalEffect);

  if (!authUid && error) {
    return <div style={centerWrap}><div style={centerCard}>{error}</div></div>;
  }

  if (!authUid || menus === null || !splashDone) {
    if (CUSTOMER_SPLASH_VARIANT === "legacy") return <LegacyLandingScreen seasonalEffect={activeSeasonalEffect} />;
    if (CUSTOMER_SPLASH_VARIANT === "zone2-dark") return <DarkLandingScreen leaving={splashLeaving} />;
    return <LandingScreen leaving={splashLeaving} />;
  }

  if (step === "myorders") {
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <GlassBackdrop seasonalEffect={activeSeasonalEffect} />
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
        <GlassBackdrop seasonalEffect={activeSeasonalEffect} />
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
        <GlassBackdrop seasonalEffect={activeSeasonalEffect} />
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
          {order.pickupDate && !order.coffeePassPurchase && (
            <p style={{ fontSize: 12.5, color: COLORS.espresso5, fontWeight: 600, margin: "0 0 10px" }}>
              <i className="ti ti-calendar" style={{ fontSize: 13, marginRight: 4 }} aria-hidden="true"></i>
              {order.coffeePass ? `วันเริ่ม ${order.coffeePass.name || "Coffee Pass"}` : "วันที่รับ"}: {formatPickupDate(order.pickupDate)}
            </p>
          )}
          {order.coffeePassPurchase && (
            <div style={{ margin:"0 0 12px", padding:"9px 10px", borderRadius:10, background:COLORS.sageLight, color:COLORS.espresso4, fontSize:11.5, fontWeight:700, textAlign:"left" }}>
              {order.coffeePassPurchase.uses} สิทธิ์ · อายุ {order.coffeePassPurchase.validityDays} วันหลังยืนยันเงิน · ผูกกับเบอร์ {order.customerPhone}
            </div>
          )}
          {order.coffeePass?.deliveryDates?.length > 0 && (
            <div style={{ margin: "0 0 12px", padding: "9px 10px", borderRadius: 10, background: COLORS.sageLight, textAlign: "left" }}>
              <div style={{ color: COLORS.espresso5, fontSize: 11.5, fontWeight: 700 }}>{order.coffeePass.name || "Coffee Pass"} {order.coffeePass.days} วัน · รับวันละ 1 แก้ว{order.coffeePass.skipWeekends ? " · ข้ามเสาร์–อาทิตย์" : ""}</div>
              <div style={{ marginTop: 5, color: COLORS.espresso3, fontSize: 10.5, lineHeight: 1.6 }}>
                {order.coffeePass.deliveryDates.map((entry) => formatPickupDate(entry.date)).join(" · ")}
              </div>
            </div>
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
        <GlassBackdrop seasonalEffect={activeSeasonalEffect} />
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
          {usingCoffeePass && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: COLORS.sageDark, marginTop: 8 }}>
              <span>Coffee Pass ครอบคลุมค่าเครื่องดื่ม</span><span>-{money(passCoveredAmount)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, borderTop: `1px dashed ${COLORS.line}`, marginTop: 8, paddingTop: 8 }}>
            <span>รวมที่ต้องชำระ</span><span>{money(checkoutTotal)}</span>
          </div>

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 16 }}>ชื่อ</label>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>เบอร์โทรศัพท์</label>
          <input
            style={field}
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setRewardVerification(null);
              setRedemptionAttemptId("");
              setSelectedPassId("");
              setPassRedeemCode("");
              setPassRedemptionAttemptId("");
              setPassCodeCheckStatus("idle");
              setPassCodeCheckError("");
            }}
            placeholder="Phone number"
          />

          {!coffeePassPurchaseLine && !usingCoffeePass && (
            <>
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
            </>
          )}

          {coffeePassPurchaseLine && (
            <div style={{ marginTop:12, padding:"10px 12px", border:`1px solid ${COLORS.line}`, borderRadius:11, background:COLORS.sageLight }}>
              <label style={{ display:"block", color:COLORS.espresso4, fontSize:11.5, fontWeight:700 }}>ตั้ง Passcode 6 หลัก</label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:6 }}>
                <input style={{ ...field, letterSpacing:".2em", textAlign:"center", fontWeight:800 }} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={passPurchaseCode} onChange={(event) => setPassPurchaseCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" />
                <input style={{ ...field, letterSpacing:".2em", textAlign:"center", fontWeight:800, borderColor:passPurchaseMismatch ? COLORS.danger : (passPurchaseCodesMatch ? COLORS.success : COLORS.line) }} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={passPurchaseCodeConfirm} onChange={(event) => setPassPurchaseCodeConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Confirm code" />
              </div>
              {passPurchaseMismatch && <div role="alert" style={{ marginTop:6, color:COLORS.danger, fontSize:11, fontWeight:700 }}>Passcode ไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง</div>}
              {passPurchaseCodesMatch && <div style={{ marginTop:6, color:COLORS.successDark, fontSize:11, fontWeight:700 }}>Passcode ตรงกัน ✓</div>}
              {!passPurchaseMismatch && !passPurchaseCodesMatch && <div style={{ marginTop:6, color:COLORS.espresso2, fontSize:10.5 }}>กรุณาจำรหัสนี้ไว้และไม่บอกรหัสแก่ผู้อื่น</div>}
            </div>
          )}

          {!coffeePassPurchaseLine && passCartLine && loyaltyStatus === "loading" && (
            <div style={{ marginTop:12, color:COLORS.espresso2, fontSize:11 }}>กำลังตรวจสอบ Coffee Pass ของเบอร์นี้...</div>
          )}
          {!coffeePassPurchaseLine && passCartLine && loyaltyStatus === "loaded" && activeCustomerPasses.length > 0 && compatibleCustomerPasses.length === 0 && (
            <div style={{ marginTop:12, padding:"9px 11px", border:`1px solid ${COLORS.line}`, borderRadius:10, background:COLORS.sageLight, color:COLORS.espresso4, fontSize:11 }}>
              พบ Coffee Pass แต่ Pass ที่มีอยู่ใช้กับเมนูนี้ไม่ได้
            </div>
          )}
          {!coffeePassPurchaseLine && activeCustomerPasses.length > 0 && !passCartLine && (
            <div style={{ marginTop:12, padding:"9px 11px", border:`1px solid ${COLORS.line}`, borderRadius:10, background:COLORS.sageLight, color:COLORS.espresso4, fontSize:11 }}>
              Coffee Pass ใช้ได้ครั้งละ 1 แก้ว กรุณาแยกเครื่องดื่มที่ต้องการใช้ Pass เป็นออเดอร์เดี่ยว
            </div>
          )}

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>วิธีชำระเงิน</label>
          <div style={{ display: "flex", flexWrap:"wrap", gap: 8, marginTop: 4 }}>
            {[
              ...(!coffeePassPurchaseLine && compatibleCustomerPasses.length > 0 ? [["coffee-pass", "Coffee Pass"]] : []),
              ["promptpay", "พร้อมเพย์ (QR)"], ["cash", "เงินสด"], ["thaihelpthai", "ไทยช่วยไทย"],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  setPaymentMethod(val);
                  if (val === "coffee-pass") {
                    setRedeemLineId(null);
                    setRedeemMode(false);
                    setRewardVerification(null);
                    setRedemptionAttemptId("");
                    if (!passRedemptionAttemptId) setPassRedemptionAttemptId(newRedemptionAttemptId());
                  }
                }}
                style={{
                  flex: "1 1 42%", padding: "10px 8px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  border: paymentMethod === val ? `1.5px solid ${COLORS.sage}` : `1px solid ${COLORS.line}`,
                  background: paymentMethod === val ? COLORS.sageLight : "#fff",
                  color: paymentMethod === val ? COLORS.sageDark : COLORS.espresso4,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {usingCoffeePass && (
            <div style={{ marginTop:10, padding:"11px 12px", border:`1px solid ${COLORS.sage}`, borderRadius:12, background:COLORS.sageLight }}>
              <div style={{ color:COLORS.espresso5, fontSize:12, fontWeight:800 }}>เลือก Pass ที่จะใช้</div>
              {compatibleCustomerPasses.map((pass) => (
                <button
                  type="button"
                  key={pass.id}
                  onClick={() => {
                    setSelectedPassId(pass.id);
                    setPassRedeemCode("");
                    setPassRedemptionAttemptId(newRedemptionAttemptId());
                    setPassCodeCheckStatus("idle");
                    setPassCodeCheckError("");
                  }}
                  style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginTop:7, padding:"8px 9px", border:selectedPassId === pass.id ? `2px solid ${COLORS.sage}` : `1px solid ${COLORS.line}`, borderRadius:10, background:"#fff", color:COLORS.espresso4, textAlign:"left" }}
                >
                  <span><strong style={{ display:"block", fontSize:11.5 }}>{pass.packageName || "Coffee Pass"}</strong><small style={{ color:COLORS.espresso2 }}>หมดอายุ {new Date(Number(pass.expiresAt)).toLocaleDateString("th-TH")}</small></span>
                  <strong style={{ color:COLORS.sageDark, fontSize:12 }}>{Number(pass.remainingUses) || 0} สิทธิ์</strong>
                </button>
              ))}
              <label style={{ display:"block", color:COLORS.espresso4, fontSize:11.5, fontWeight:700, marginTop:10 }}>Passcode</label>
              <input
                style={{ ...field, marginTop:5, letterSpacing:".28em", textAlign:"center", fontWeight:800, borderColor:passCodeCheckStatus === "error" ? COLORS.danger : (passCodeCheckStatus === "valid" ? COLORS.success : COLORS.line) }}
                type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                value={passRedeemCode}
                onChange={(event) => {
                  setPassRedeemCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setPassRedemptionAttemptId(newRedemptionAttemptId());
                  setPassCodeCheckStatus("idle");
                  setPassCodeCheckError("");
                }}
                placeholder="Enter 6-digit code"
              />
              {passCodeCheckStatus === "checking" && <div style={{ marginTop:6, color:COLORS.espresso2, fontSize:11 }}>กำลังตรวจสอบ Passcode...</div>}
              {passCodeCheckStatus === "valid" && <div style={{ marginTop:6, color:COLORS.successDark, fontSize:11, fontWeight:700 }}>Pass พร้อมใช้งาน ✓</div>}
              {passCodeCheckStatus === "error" && <div role="alert" style={{ marginTop:6, color:COLORS.danger, fontSize:11, fontWeight:700 }}>{passCodeCheckError}</div>}

              {passOptionTotal > 0 && (
                <>
                  <div style={{ marginTop:11, color:COLORS.espresso4, fontSize:11.5, fontWeight:700 }}>ชำระค่า option เพิ่ม {money(passOptionTotal)} บาท</div>
                  <div style={{ display:"flex", gap:7, marginTop:5 }}>
                    {[["promptpay", "พร้อมเพย์"], ["cash", "เงินสด"], ["thaihelpthai", "ไทยช่วยไทย"]].map(([val, label]) => (
                      <button type="button" key={val} onClick={() => setPassExtraPaymentMethod(val)} style={{ flex:1, padding:"8px 5px", borderRadius:8, border:passExtraPaymentMethod === val ? `1.5px solid ${COLORS.sage}` : `1px solid ${COLORS.line}`, background:passExtraPaymentMethod === val ? "#fff" : "rgba(255,255,255,.55)", color:COLORS.espresso4, fontSize:10.5 }}>{label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {!coffeePassPurchaseLine && <><label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>วันที่รับ (ล่วงหน้า 1-7 วัน)</label>
          <input style={field} type="date" value={pickupDate} min={addDays(1)} max={addDays(7)} onChange={(e) => setPickupDate(e.target.value)} /></>}
          {coffeePassPurchaseLine && <div style={{ marginTop:12, padding:"10px 12px", border:`1px solid ${COLORS.line}`, borderRadius:11, background:COLORS.sageLight, color:COLORS.espresso4, fontSize:11.5 }}>Pass จะเริ่มนับอายุและเข้าบัญชีเบอร์นี้หลังร้านยืนยันการชำระเงิน</div>}

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>โน้ตถึงร้าน (ถ้ามี)</label>
          <textarea
            style={{ ...field, resize: "vertical", minHeight: 60, fontFamily: "inherit" }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note to shop (optional)"
          />

          {error && <p style={{ fontSize: 12, color: COLORS.danger, margin: "10px 0 0" }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={btn} onClick={() => setStep("menu")}>ย้อนกลับ</button>
            <button style={{ ...btnAccent }} disabled={submitting || (coffeePassPurchaseLine && !passPurchaseCodesMatch) || (usingCoffeePass && passCodeCheckStatus !== "valid")} onClick={checkout}>
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
    return <ClosedOrderScreen shopName={shopName} hasOrders={loadMyOrderIds(shopUid).length > 0} onOpenOrders={openMyOrders} seasonalEffect={activeSeasonalEffect} />;
  }

  return (
    <div className="corder" style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Inter', sans-serif", color: COLORS.espresso4, animation: "pageIn .32s cubic-bezier(.22,1,.36,1) both" }}>
      <style>{GLOBAL_CSS}</style>
      <GlassBackdrop seasonalEffect={activeSeasonalEffect} />

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
            boxShadow: "0 4px 14px rgba(0,59,92,0.28)", border: "2px solid #fff",
            background: f.imageUrl ? `url(${f.imageUrl}) center/cover` : `linear-gradient(135deg, ${COLORS.sage}, ${COLORS.espresso5})`,
            "--dx": `${f.dx}px`, "--dy": `${f.dy}px`,
            animation: "flyToCart .65s cubic-bezier(.3,.8,.4,1) forwards",
          }}
        />
      ))}

      <div className="zone-header" style={{
        margin: "10px 10px 0", height: 74, padding: "0 16px", borderRadius: 28,
        background: "#FFFFFF", border: "1px solid rgba(0,163,224,.16)", boxShadow: "0 8px 30px rgba(0,91,133,0.10)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div className="zone-logo-shell" style={{
            width: 44, height: 44, borderRadius: 14, background: "#fff", border: `1px solid ${COLORS.line}`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden",
          }}>
            <BrandLogo height={34} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: 1.15, minWidth: 0 }}>
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: COLORS.espresso5,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{shopNameParts[0]}</span>
            {shopNameParts[1] && (
              <span style={{
                fontSize: 12, letterSpacing: "0.12em", fontWeight: 500, color: COLORS.espresso2, textTransform: "uppercase",
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
              width: 44, height: 44, borderRadius: 22, background: "#fff", border: `1px solid ${COLORS.line}`,
              boxShadow: "0 4px 14px rgba(0,91,133,0.08)", display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", flexShrink: 0,
            }}
          >
            <i className="ti ti-receipt" style={{ fontSize: 19, color: COLORS.sageDark }} aria-hidden="true"></i>
            {hasActiveOrder && (
              <span style={{
                position: "absolute", top: 3, right: 3, width: 11, height: 11, borderRadius: "50%",
                background: PANTONE_299C, border: "2px solid #fff",
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
                    lineHeight: 1.3, borderRadius: 11, background: active ? COLORS.sage : "transparent",
                    color: active ? "#FFFFFF" : COLORS.espresso2, fontWeight: active ? 700 : 500, border: "none",
                    boxShadow: active ? "0 5px 14px rgba(0,163,224,0.28)" : "none",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </nav>

          <main ref={mainRef} style={{ flex: 1, overflowY: "auto", padding: "0 0 100px" }}>
            {error && step === "menu" && (
              <div style={{ margin: "10px 12px 0", padding: "9px 11px", border: `1px solid ${COLORS.danger}55`, borderRadius: 10, background: "#FFF2F0", color: COLORS.danger, fontSize: 11.5, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <span>{error}</span>
                <button type="button" onClick={() => setError("")} style={{ border: 0, background: "transparent", color: COLORS.danger, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            )}
            {categories.map((cat) => (
              <section key={cat} data-category={cat} ref={(el) => { sectionRefs.current[cat] = el; }} style={{ padding: "16px 6px 0" }}>
                {cat === COFFEE_PASS_CATEGORY ? (
                  <>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={showCoffeePassDetails}
                      onClick={() => setShowCoffeePassDetails((current) => !current)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setShowCoffeePassDetails((current) => !current); } }}
                      style={{ margin: "0 10px 15px", padding: "18px", borderRadius: 20, color: "#fff", background: "linear-gradient(145deg, #003B5C, #0077A8 62%, #00A3E0)", boxShadow: "0 16px 34px rgba(0,91,133,.2)", position: "relative", overflow: "hidden", cursor:"pointer" }}
                    >
                      <div aria-hidden="true" style={{ position: "absolute", width: 150, height: 150, borderRadius: "50%", right: -55, top: -70, border: "22px solid rgba(255,255,255,.09)" }} />
                      <div style={{ position: "relative" }}>
                        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", opacity: .72 }}>PREPAID COFFEE PACKAGE</div>
                          {coffeePassBenefit.savingsMax > 0 && (
                            <span style={{ padding:"5px 9px", borderRadius:999, background:"#fff", color:COLORS.sageDark, boxShadow:"0 4px 12px rgba(0,59,92,.18)", fontSize:10.5, fontWeight:900, whiteSpace:"nowrap" }}>
                              SAVE UP TO {coffeePassBenefit.savingsPercentMax}%
                            </span>
                          )}
                        </div>
                        <h2 style={{ margin: "5px 0 2px", fontFamily: "'Space Grotesk', sans-serif", fontSize: 25, lineHeight: 1.12 }}>{coffeePass.name || "Coffee Pass"}</h2>
                        <div style={{ fontSize: 14, fontWeight:800, opacity: .95 }}>รับเครื่องดื่ม {coffeePassBenefit.uses} แก้ว ในราคาเดียว</div>

                        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"flex-end", justifyContent:"space-between", gap:"10px 12px", marginTop:14, padding:"12px 13px", border:"1px solid rgba(255,255,255,.2)", borderRadius:14, background:"rgba(255,255,255,.1)" }}>
                          <div style={{ flex:"1 1 125px", minWidth:0 }}>
                            {coffeePassBenefit.hasPriceComparison && (
                              <div style={{ fontSize:10, opacity:.76 }}>
                                ซื้อแยกปกติ{coffeePassBenefit.regularMin !== coffeePassBenefit.regularMax ? "สูงสุด" : ""}
                                <span style={{ marginLeft:4, fontSize:12, fontWeight:700, textDecoration:"line-through" }}>฿{money(coffeePassBenefit.regularMax)}</span>
                              </div>
                            )}
                            <div style={{ marginTop:3, fontSize:9.5, opacity:.76 }}>ราคา Pass ทั้งแพ็ก</div>
                            <strong style={{ display:"block", marginTop:1, fontSize:27, lineHeight:1, whiteSpace:"nowrap" }}>฿{money(coffeePassBenefit.passPrice)}</strong>
                          </div>
                        </div>

                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(68px, 1fr))", gap:6, marginTop:9 }}>
                          {[
                            [money(coffeePassBenefit.perCup), "บาท / แก้ว"],
                            [coffeePassBenefit.uses, "สิทธิ์ทั้งหมด"],
                            [coffeePass.validityDays, "วันใช้งาน"],
                          ].map(([value, label]) => (
                            <div key={label} style={{ padding:"7px 5px", borderRadius:10, background:"rgba(255,255,255,.1)", textAlign:"center" }}>
                              <strong style={{ display:"block", fontSize:13 }}>{value}</strong>
                              <span style={{ display:"block", marginTop:1, fontSize:8.5, opacity:.72 }}>{label}</span>
                            </div>
                          ))}
                        </div>

                        <div style={{ marginTop:12, fontSize:10.5, opacity:.78 }}>เลือกเมนูที่ร่วมรายการได้ตามใจ · จ่ายเพิ่มเฉพาะ option ที่มีราคาเพิ่ม</div>
                        <div style={{ marginTop:14 }}>
                          {coffeePass.enabled ? (
                            <div className="coffee-pass-buy-border">
                              <button type="button" onClick={(event) => { event.stopPropagation(); buyCoffeePass(); }} style={{ width:"100%", padding:"10px 12px", border:0, borderRadius:12, background:"#fff", color:COLORS.sageDark, fontSize:13, fontWeight:900, whiteSpace:"nowrap" }}>
                                ซื้อเลย · ฿{money(coffeePassBenefit.passPrice)}
                              </button>
                            </div>
                          ) : <div style={{ padding:"9px 10px", borderRadius:12, background:"rgba(255,255,255,.15)", textAlign:"center", fontSize:10.5, fontWeight:700 }}>ปิดขายชั่วคราว</div>}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:5, marginTop:13, paddingTop:10, borderTop:"1px solid rgba(255,255,255,.18)", fontSize:10.5, fontWeight:700, opacity:.9 }}>
                          ดูสิทธิประโยชน์และวิธีใช้ <i className={`ti ti-chevron-${showCoffeePassDetails ? "up" : "down"}`} aria-hidden="true" />
                        </div>
                      </div>
                    </div>

                    {showCoffeePassDetails && (
                      <div style={{ ...GLASS_PANEL, margin:"0 10px 14px", padding:14, borderRadius:16 }}>
                        <div style={{ color:COLORS.espresso5, fontSize:14, fontWeight:800 }}>สิทธิประโยชน์</div>
                        <ul style={{ margin:"8px 0 0", paddingLeft:20, color:COLORS.espresso4, fontSize:11.5, lineHeight:1.65 }}>
                          <li>เฉลี่ยเพียง <strong>{money(coffeePassBenefit.perCup)} บาทต่อแก้ว</strong></li>
                          <li>รับเครื่องดื่ม {coffeePass.uses} แก้ว ภายใน {coffeePass.validityDays} วันหลังร้านเปิดใช้งาน</li>
                          <li>ใช้ได้ครั้งละ 1 แก้วกับเมนูที่ร่วมรายการ</li>
                          <li>ตัวเลือกที่มีราคาเพิ่ม ชำระเฉพาะส่วนเพิ่มตามจริง</li>
                        </ul>
                        <div style={{ marginTop:12, color:COLORS.espresso5, fontSize:14, fontWeight:800 }}>เมนูที่ร่วมรายการ</div>
                        <div style={{ marginTop:6, color:COLORS.espresso3, fontSize:11.5, lineHeight:1.55 }}>
                          {coffeePassEligibleMenus.map((menu) => menu.name).join(" · ") || "ยังไม่มีเมนูที่ร่วมรายการ"}
                        </div>
                        {coffeePassBenefit.regularMin !== coffeePassBenefit.regularMax && coffeePassBenefit.savingsMax > 0 && <div style={{ marginTop:5, color:COLORS.espresso2, fontSize:9.5 }}>ยอดประหยัดจริงขึ้นอยู่กับเมนูที่เลือก โดยคำนวณจากราคาปกติปัจจุบัน</div>}
                        <div style={{ marginTop:12, color:COLORS.espresso5, fontSize:14, fontWeight:800 }}>วิธีใช้</div>
                        <ol style={{ margin:"8px 0 0", paddingLeft:20, color:COLORS.espresso4, fontSize:11.5, lineHeight:1.65 }}>
                          <li>เลือกเครื่องดื่มจากเมนูตามปกติ แล้วไปหน้าชำระเงิน</li>
                          <li>กรอกเบอร์โทรศัพท์ที่ใช้ซื้อ Pass</li>
                          <li>ถ้าเมนูใช้สิทธิ์ได้ ระบบจะเลือก Coffee Pass เป็นวิธีชำระหลัก</li>
                          <li>กรอก Passcode ให้ถูกต้อง แล้วกดยืนยันสั่งซื้อ</li>
                        </ol>
                      </div>
                    )}
                  </>
                ) : cat === HOT_DEAL_CATEGORY ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 16px 14px" }}>
                      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 22, color: COLORS.espresso5, margin: 0 }}>Today's Offer</h2>
                      <button
                        className="offer-arrow-btn"
                        onClick={() => { triggerOfferRipple("__nav__"); scrollOfferCarousel(1); }}
                        style={{
                          width: 40, height: 40, borderRadius: "50%", background: COLORS.sageLight, border: "none",
                          display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", flexShrink: 0,
                        }}
                      >
                        <i className="ti ti-arrow-right" style={{ fontSize: 18, color: COLORS.sageDark }} aria-hidden="true"></i>
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
                      const lines = directLinesForMenu(m.id);
                      const qty = lines.reduce((s, l) => s + l.qty, 0);
                      const singleLine = lines.length === 1 ? lines[0] : null;
                      const canAddDirectly = groupsForMenu(m).length === 0;
                      const directPromo = bestDirectPromoForMenu(m, Math.max(1, qty));
                      const directPromoPrice = directPromo?.type === "single" ? singlePromoPrice(directPromo, m) : null;
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
                              {soldOut ? "หมดวันนี้" : directPromoPrice !== null ? (
                                <span style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ color: COLORS.espresso2, fontSize: 11.5, textDecoration: "line-through" }}>{money(m.priceStore)}</span>
                                  <span style={{ color: COLORS.danger }}>{money(directPromoPrice)} / {productUnitLabel(m)}</span>
                                  <span style={{ color: "#fff", background: COLORS.danger, borderRadius: 999, padding: "1px 6px", fontSize: 9.5 }}>ราคาโปร</span>
                                </span>
                              ) : `${money(m.priceStore)} / ${productUnitLabel(m)}`}
                            </div>
                            {!soldOut && directPromo?.type === "qty" && (
                              <div style={{ marginTop: 3, color: COLORS.danger, fontSize: 10.5, fontWeight: 600 }}>
                                ซื้อครบ {directPromo.minQty || 2} {productUnitLabel(m)} ราคา {money(qtyPromoTotal(directPromo, m, directPromo.minQty || 2))}
                              </div>
                            )}
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
          background: "rgba(0,59,92,0.92)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.15)", color: "#fff", borderRadius: 16,
          padding: "12px 14px 12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 24px rgba(0,59,92,0.3)", animation: "fadeIn .2s ease",
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
            style={{ background: COLORS.sage, color: COLORS.espresso5, border: "none", borderRadius: 10, padding: "10px 22px", fontSize: 13.5, fontWeight: 700 }}
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
          const effectivePromo = pickingPromo || bestDirectPromoForMenu(pickingMenu, qty);
          const isQty = effectivePromo && effectivePromo.type === "qty";
          const priceOverride = effectivePromo ? (isQty ? qtyPromoUnitPrice(effectivePromo, pickingMenu, qty) : singlePromoPrice(effectivePromo, pickingMenu)) : undefined;
          addToCart(pickingMenu, qty, options, priceOverride, effectivePromo ? effectivePromo.id : null, effectivePromo ? (isQty ? "qty" : "single") : null);
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
                  {String(l.promoKind || "").startsWith("coffee-pass") ? (
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", background: COLORS.sageDark, borderRadius: 999, padding: "1px 6px" }}>COFFEE PASS</span>
                  ) : l.promoId ? (
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", background: COLORS.danger, borderRadius: 999, padding: "1px 6px" }}>โปร</span>
                  ) : null}
                </div>
                {l.options.length > 0 && <div style={{ fontSize: 11.5, color: COLORS.espresso2, marginTop: 2 }}>{l.options.map((o) => o.label).join(", ")}</div>}
                {l.promoKind === "coffee-pass-purchase" && <div style={{ fontSize: 10.5, color: COLORS.espresso2, marginTop: 3 }}>{l.coffeePass?.uses || 0} สิทธิ์ · อายุ {l.coffeePass?.validityDays || 0} วัน</div>}
                {l.promoKind === "coffee-pass-redemption" && <div style={{ fontSize: 10.5, color: COLORS.espresso2, marginTop: 3 }}>ใช้ {l.passName || "Coffee Pass"} 1 สิทธิ์{l.unitPrice > 0 ? ` · ค่าส่วนเพิ่ม ${money(l.unitPrice)}` : ""}</div>}
                <div style={{ fontSize: 12.5, color: l.promoId ? COLORS.danger : COLORS.sage, fontWeight: 600, marginTop: 4 }}><AnimatedMoney value={l.unitPrice * l.qty} /></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {["bundle", "choice", "coffee-pass-purchase", "coffee-pass-redemption"].includes(l.promoKind) ? (
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

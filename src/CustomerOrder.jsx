import { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, onValue, get, push, set } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import QRCode from "qrcode";
import generatePayload from "promptpay-qr";
import { firebaseConfig } from "./firebase";

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
  preparing: "กำลังชงเครื่องดื่มของคุณ...",
  ready: "พร้อมรับแล้ว! มารับที่หน้าร้านได้เลย",
  cancelled: "ออเดอร์นี้ถูกยกเลิก",
};

const COLORS = {
  cream: "#F5F0EA", cream2: "#EDE3D2", surface: "#FFFFFF",
  espresso5: "#063360", espresso4: "#0B4A7A", espresso3: "#3A5570", espresso2: "#7189A3",
  sage: "#CE560D", sageDark: "#A8440A", sageLight: "#F7E0CC",
  gold: "#CE560D", goldLight: "#F7E0CC",
  danger: "#B23A2E", line: "#E2D8C7",
  success: "#2E9E4F", successDark: "#1F7A38", successLight: "#DFF3E3",
  pending: "#B8860B", pendingLight: "#FCEFD1",
};

const STATUS_ICON = {
  pending: { icon: "clock", color: COLORS.pending, bg: COLORS.pendingLight, anim: "statusPulse 1.6s ease-in-out infinite" },
  paid: { icon: "checks", color: COLORS.espresso4, bg: "rgba(11,74,122,0.14)", anim: "cartBump .5s ease" },
  preparing: { icon: "coffee", color: COLORS.sage, bg: COLORS.sageLight, anim: "pulseCup 1.3s ease-in-out infinite" },
  ready: { icon: "check", color: COLORS.success, bg: COLORS.successLight, anim: "successPop .5s cubic-bezier(.34,1.56,.64,1)" },
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
    <div style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", background: "linear-gradient(160deg, #F7F1E7, #ECE1CE)" }}>
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

const HOT_DEAL_CATEGORY = "ดีลพิเศษ 🔥";

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

function MenuThumb({ imageUrl }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{
      width: 60, height: 60, borderRadius: 12, flexShrink: 0, overflow: "hidden",
      background: COLORS.sageLight, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {imageUrl && !failed ? (
        <img src={imageUrl} alt="" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <i className="ti ti-cup" style={{ fontSize: 24, color: COLORS.sageDark }} aria-hidden="true"></i>
      )}
    </div>
  );
}

function BannerSlide({ url, active }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (failed) return null;
  return (
    <img
      src={url}
      alt=""
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
        opacity: active ? 1 : 0, transition: "opacity .6s ease",
      }}
      onError={() => setFailed(true)}
    />
  );
}

function BannerCarousel({ images }) {
  const [index, setIndex] = useState(0);
  const validImages = (images || []).filter(Boolean);
  const key = validImages.join("|");

  useEffect(() => {
    setIndex(0);
  }, [key]);

  useEffect(() => {
    if (validImages.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % validImages.length), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (validImages.length === 0) return null;

  return (
    <div style={{
      margin: "10px 10px 0", borderRadius: 16, overflow: "hidden", position: "relative", height: 84,
      border: "1px solid rgba(255,255,255,0.55)", boxShadow: "0 8px 24px rgba(43,29,20,0.10)", flexShrink: 0,
    }}>
      {validImages.map((url, i) => (
        <BannerSlide key={url + i} url={url} active={i === index} />
      ))}
      {validImages.length > 1 && (
        <div style={{ position: "absolute", bottom: 6, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 4 }}>
          {validImages.map((_, i) => (
            <span key={i} style={{
              width: i === index ? 14 : 5, height: 5, borderRadius: 3,
              background: i === index ? "#fff" : "rgba(255,255,255,0.55)", transition: "width .25s ease",
            }} />
          ))}
        </div>
      )}
    </div>
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

  const mainRef = useRef(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    signInAnonymously(auth)
      .then((cred) => setAuthUid(cred.user.uid))
      .catch((e) => setError("เข้าสู่ระบบไม่สำเร็จ: " + e.message));
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
    const unsub8 = onValue(ref(db, `shops/${shopUid}/promotions`), (snap) => {
      const list = snap.val() || [];
      setPromotions(list.map((p) => ({
        ...p,
        type: p.type || (p.menuIds && p.menuIds.length > 1 ? "bundle" : "single"),
        minQty: p.minQty || 2,
        chooseCount: p.chooseCount || 2,
      })));
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); unsub7b(); unsub8(); unsub9(); };
  }, [authUid, shopUid]);

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
  }

  const menusById = useMemo(() => {
    const m = {};
    (menus || []).forEach((x) => { m[x.id] = x; });
    return m;
  }, [menus]);

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
    const base = priceOverride !== undefined ? priceOverride : menu.priceStore;
    const unitPrice = base + options.reduce((s, o) => s + (o.priceDelta || 0), 0);
    setCart((c) => [...c, { lineId: genLineId(), menuId: menu.id, name: menu.name, unitPrice, qty, options, promoId: promoId || null, promoKind: promoKind || null }]);
  }

  function bundleQtyInCart(promo) {
    const first = promo.menuIds[0];
    const line = cart.find((l) => l.menuId === first && l.promoId === promo.id);
    return line ? line.qty : 0;
  }

  function setBundleQty(promo, qty) {
    if (qty <= 0) {
      setCart((c) => c.filter((l) => l.promoId !== promo.id));
      return;
    }
    const prices = splitBundlePrices(promo, menusById);
    setCart((c) => {
      const others = c.filter((l) => l.promoId !== promo.id);
      const newLines = prices.map((p) => {
        const existing = c.find((l) => l.promoId === promo.id && l.menuId === p.menuId);
        return {
          lineId: existing ? existing.lineId : genLineId(),
          menuId: p.menuId, name: p.name, unitPrice: p.unitPrice, qty, options: [], promoId: promo.id, promoKind: "bundle",
        };
      });
      return [...others, ...newLines];
    });
  }

  function addBundle(promo) {
    setBundleQty(promo, bundleQtyInCart(promo) + 1);
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
          lineId: genLineId(), menuId: p.menuId, name: p.name, unitPrice: p.unitPrice + optionDelta, options: opts, qty: 1,
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

  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  useEffect(() => {
    if (cartCount > prevCartCountRef.current) {
      setCartBump(true);
      const t = setTimeout(() => setCartBump(false), 320);
      prevCartCountRef.current = cartCount;
      return () => clearTimeout(t);
    }
    prevCartCountRef.current = cartCount;
  }, [cartCount]);

  async function checkout() {
    setError("");
    if (cart.length === 0) { setError("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; }
    if (!name.trim()) { setError("กรุณาใส่ชื่อ"); return; }
    if (!phone.trim()) { setError("กรุณาใส่เบอร์โทร"); return; }
    if (pickupDate < addDays(1) || pickupDate > addDays(7)) { setError("วันที่รับต้องล่วงหน้าอย่างน้อย 1 วัน และไม่เกิน 7 วัน"); return; }
    if (paymentMethod === "promptpay" && !promptpayId) { setError("ร้านนี้ยังไม่เปิดรับชำระผ่าน QR (ยังไม่ได้ตั้งค่า PromptPay)"); return; }
    setSubmitting(true);
    try {
      const newRef = push(ref(db, `orders/${shopUid}`));
      const orderData = {
        customerUid: authUid,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        note: note.trim(),
        paymentMethod,
        pickupDate,
        items: cart.map(({ lineId, ...rest }) => rest),
        total,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await set(newRef, orderData);
      saveMyOrderId(shopUid, newRef.key);
      if (paymentMethod === "promptpay") {
        const payload = generatePayload(promptpayId, { amount: total });
        const url = await QRCode.toDataURL(payload, { width: 260, margin: 1 });
        setQrDataUrl(url);
      } else {
        setQrDataUrl(null);
      }
      setOrder({ id: newRef.key, ...orderData });
      setStep("pay");
    } catch (e) {
      setError("สั่งซื้อไม่สำเร็จ: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function openMyOrders() {
    setError("");
    const ids = loadMyOrderIds(shopUid);
    const results = await Promise.all(ids.map(async (id) => {
      const snap = await get(ref(db, `orders/${shopUid}/${id}`));
      return snap.exists() ? { id, ...snap.val() } : null;
    }));
    setMyOrders(results.filter(Boolean));
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
    const isCash = order.paymentMethod === "cash";
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <GlassBackdrop />
        <div style={{ ...centerCard, textAlign: "center" }}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, margin: "4px 0 14px" }}>
            {isPending ? (isCash ? "ชำระเงินสดที่ร้าน" : "สแกนจ่ายผ่าน PromptPay") : "สถานะออเดอร์"}
          </h1>
          {isPending ? (
            isCash ? (
              <div style={{ padding: "10px 0" }}>
                <p style={{ fontSize: 40, margin: 0 }}>💵</p>
                <p style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", margin: "10px 0 4px" }}>{money(order.total)}</p>
                <p style={{ fontSize: 12, color: COLORS.espresso2, margin: "0 0 14px" }}>กรุณาชำระเงินสดตอนมารับที่ร้าน</p>
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
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, borderTop: `1px dashed ${COLORS.line}`, marginTop: 8, paddingTop: 8 }}>
            <span>รวม</span><span>{money(total)}</span>
          </div>

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 16 }}>ชื่อ</label>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อของคุณ" />

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>เบอร์โทรศัพท์</label>
          <input style={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" />

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>วิธีชำระเงิน</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {[["promptpay", "พร้อมเพย์ (QR)"], ["cash", "เงินสด"]].map(([val, label]) => (
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
            placeholder="เช่น หวานน้อย ไม่ใส่หลอด แยกน้ำแข็ง"
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
      </div>
    );
  }

  if (!acceptingOrders) {
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <GlassBackdrop />
        <div style={{ ...centerCard, textAlign: "center" }}>
          <div style={{ marginBottom: 14 }}><BrandLogo height={54} /></div>
          <p style={{ fontSize: 34, margin: "0 0 10px" }}>🔒</p>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 19, margin: "0 0 8px", color: COLORS.espresso5 }}>ร้านปิดรับออเดอร์ชั่วคราว</h1>
          <p style={{ fontSize: 13, color: COLORS.espresso2 }}>ขออภัย ตอนนี้ร้านยังไม่เปิดรับออเดอร์ผ่านหน้านี้ กรุณาลองใหม่อีกครั้งภายหลัง</p>
          {loadMyOrderIds(shopUid).length > 0 && (
            <button style={{ ...btn, marginTop: 16 }} onClick={openMyOrders}>ดูออเดอร์ของฉัน</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="corder" style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Inter', sans-serif", color: COLORS.espresso4, animation: "pageIn .32s cubic-bezier(.22,1,.36,1) both" }}>
      <style>{GLOBAL_CSS}</style>
      <GlassBackdrop />

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

      <div style={{ ...GLASS_PANEL, margin: "10px 10px 0", borderRadius: 18, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandLogo height={34} />
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, margin: 0, color: COLORS.espresso5 }}>{shopName}</h1>
        </div>
        {loadMyOrderIds(shopUid).length > 0 && (
          <button style={{ ...btn, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.7)", fontSize: 11.5, padding: "6px 10px" }} onClick={openMyOrders}>
            <i className="ti ti-receipt" style={{ fontSize: 13, marginRight: 4 }} aria-hidden="true"></i>ออเดอร์ของฉัน
          </button>
        )}
      </div>

      <BannerCarousel images={bannerImageUrls.length > 0 ? bannerImageUrls : (bannerImageUrl ? [bannerImageUrl] : [])} />

      {menus.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: COLORS.espresso2, fontSize: 13 }}>ร้านยังไม่มีเมนู</div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 10, padding: "10px 10px 0" }}>
          <nav style={{ ...GLASS_PANEL, width: 88, flexShrink: 0, overflowY: "auto", borderRadius: 16, padding: "8px 0" }}>
            {categories.map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
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
                <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, color: COLORS.espresso5, margin: "0 0 10px" }}>{cat}</h2>
                {cat === HOT_DEAL_CATEGORY ? activePromotions.map((promo) => {
                  if (promo.type === "choice") {
                    const pool = promo.menuIds.map((id) => menusById[id]).filter((m) => m && m.available !== false);
                    const displayName = promo.name || `เลือก ${promo.chooseCount} จาก ${pool.length} รายการ`;
                    const priceText = promo.discountType === "percent" ? `ลด ${promo.discountValue}%` : `ชุดละ ${money(promo.discountValue)}`;
                    return (
                      <div key={promo.id} style={{ ...GLASS_PANEL, display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 14, marginBottom: 8 }}>
                        <MenuThumb imageUrl={pool[0]?.imageUrl} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5 }}>{displayName}</div>
                          <div style={{ fontSize: 11.5, color: COLORS.espresso2, margin: "2px 0" }}>{pool.map((m) => m.name).join(", ")}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger, marginTop: 3 }}>{priceText}</div>
                        </div>
                        <button onClick={() => setPickingChoicePromo(promo)} style={{
                          flexShrink: 0, border: "none", background: COLORS.espresso5, color: "#fff",
                          fontSize: 12.5, fontWeight: 600, borderRadius: 9, padding: "9px 12px",
                        }}>เลือกเมนู</button>
                      </div>
                    );
                  }
                  if (promo.type === "qty") {
                    const menu = menusById[promo.menuIds[0]];
                    if (!menu) return null;
                    const lines = linesForMenu(menu.id, promo.id);
                    const qty = lines.reduce((s, l) => s + l.qty, 0);
                    const singleLine = lines.length === 1 ? lines[0] : null;
                    const setPrice = qtyPromoTotal(promo, menu, promo.minQty);
                    return (
                      <div key={promo.id} onClick={() => !singleLine && openMenu(menu, promo)} style={{
                        ...GLASS_PANEL, display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 14, marginBottom: 8,
                        cursor: singleLine ? "default" : "pointer",
                      }}>
                        <div ref={(el) => { menuThumbRefs.current["promo_" + menu.id] = el; }}>
                          <MenuThumb imageUrl={menu.imageUrl} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5 }}>{promo.name || menu.name}</div>
                          <div style={{ fontSize: 13, color: COLORS.gold, fontWeight: 600, marginTop: 3 }}>{money(menu.priceStore)}/ชิ้น</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
                            <span style={{ fontSize: 12, color: COLORS.espresso2, textDecoration: "line-through" }}>{money(menu.priceStore * promo.minQty)}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger }}>ซื้อครบ {promo.minQty} ชิ้น {money(setPrice)}</span>
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
                              onClick={() => setLineQty(singleLine.lineId, singleLine.qty + 1)}
                              style={{
                                width: 28, height: 28, borderRadius: 8, border: "none", background: COLORS.espresso5,
                                color: "#fff", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
                              }}
                            >+</button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); openMenu(menu, promo); }}
                            style={{
                              width: 32, height: 32, borderRadius: 9, flexShrink: 0, border: "none",
                              background: COLORS.espresso5, color: "#fff", fontSize: 18, lineHeight: 1,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >+</button>
                        )}
                      </div>
                    );
                  }
                  if (promo.type === "bundle") {
                    const prices = splitBundlePrices(promo, menusById);
                    const originalTotal = promo.menuIds.reduce((s, id) => s + (menusById[id]?.priceStore || 0), 0);
                    const promoTotal = prices.reduce((s, p) => s + p.unitPrice, 0);
                    const qty = bundleQtyInCart(promo);
                    const displayName = promo.name || prices.map((p) => p.name).join(" + ");
                    const thumbImg = menusById[promo.menuIds[0]]?.imageUrl;
                    return (
                      <div key={promo.id} style={{ ...GLASS_PANEL, display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 14, marginBottom: 8 }}>
                        <MenuThumb imageUrl={thumbImg} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5 }}>{displayName}</div>
                          <div style={{ fontSize: 11.5, color: COLORS.espresso2, margin: "2px 0" }}>{prices.map((p) => p.name).join(" + ")}</div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
                            <span style={{ fontSize: 12, color: COLORS.espresso2, textDecoration: "line-through" }}>{money(originalTotal)}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger }}>{money(promoTotal)}</span>
                          </div>
                        </div>
                        {qty > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <button onClick={() => setBundleQty(promo, qty - 1)} style={{
                              width: 28, height: 28, borderRadius: 9, border: "1px solid rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.6)",
                              color: COLORS.espresso5, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
                            }}>−</button>
                            <span style={{ minWidth: 16, textAlign: "center", fontWeight: 600, color: COLORS.espresso5 }}><AnimatedQty value={qty} /></span>
                            <button onClick={() => setBundleQty(promo, qty + 1)} style={{
                              width: 28, height: 28, borderRadius: 8, border: "none", background: COLORS.espresso5,
                              color: "#fff", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
                            }}>+</button>
                          </div>
                        ) : (
                          <button onClick={() => addBundle(promo)} style={{
                            width: 32, height: 32, borderRadius: 9, flexShrink: 0, border: "none",
                            background: COLORS.espresso5, color: "#fff", fontSize: 18, lineHeight: 1,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>+</button>
                        )}
                      </div>
                    );
                  }
                  const menu = menusById[promo.menuIds[0]];
                  if (!menu) return null;
                  const promoPrice = singlePromoPrice(promo, menu);
                  const lines = linesForMenu(menu.id, promo.id);
                  const qty = lines.reduce((s, l) => s + l.qty, 0);
                  const singleLine = lines.length === 1 ? lines[0] : null;
                  const canAddDirectly = groupsForMenu(menu).length === 0;
                  return (
                    <div key={promo.id} onClick={() => !singleLine && openMenu(menu, promo)} style={{
                      ...GLASS_PANEL, display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderRadius: 14, marginBottom: 8,
                      cursor: singleLine ? "default" : "pointer",
                    }}>
                      <div ref={(el) => { menuThumbRefs.current["promo_" + menu.id] = el; }}>
                        <MenuThumb imageUrl={menu.imageUrl} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5 }}>{promo.name || menu.name}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
                          <span style={{ fontSize: 12, color: COLORS.espresso2, textDecoration: "line-through" }}>{money(menu.priceStore)}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger }}>{money(promoPrice)}</span>
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
                            onClick={() => { if (canAddDirectly) { spawnFly("promo_" + menu.id, menu.imageUrl); setLineQty(singleLine.lineId, singleLine.qty + 1); } else openMenu(menu, promo); }}
                            style={{
                              width: 28, height: 28, borderRadius: 8, border: "none", background: COLORS.espresso5,
                              color: "#fff", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >+</button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); openMenu(menu, promo); }}
                          style={{
                            position: "relative", width: 32, height: 32, borderRadius: 9, flexShrink: 0, border: "none",
                            background: COLORS.espresso5, color: "#fff", fontSize: 18, lineHeight: 1,
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
                }) : menus.filter((m) => m.category === cat).map((m) => {
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
                        <MenuThumb imageUrl={m.imageUrl} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5 }}>{m.name}</div>
                        <div style={{ fontSize: 13, color: soldOut ? COLORS.danger : COLORS.gold, fontWeight: 600, marginTop: 3 }}>
                          {soldOut ? "หมดวันนี้" : money(m.priceStore)}
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
              </section>
            ))}
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
            const oldDelta = (editingCartLine.options || []).reduce((s, o) => s + (o.priceDelta || 0), 0);
            const base = editingCartLine.unitPrice - oldDelta;
            const newDelta = options.reduce((s, o) => s + (o.priceDelta || 0), 0);
            setCart((c) => c.map((l) => (l.lineId === editingCartLine.lineId ? { ...l, options, unitPrice: base + newDelta } : l)));
            setEditingCartLine(null);
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
          sel[o.groupId] = { id: o.choiceId, label: o.label, note: "", priceDelta: o.priceDelta || 0, ingredientId: o.ingredientId || null, groupId: o.groupId, groupName: o.groupName };
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
      .map((c) => ({ groupId: c.groupId, groupName: c.groupName, choiceId: c.id, label: c.label, priceDelta: c.priceDelta || 0, ingredientId: c.ingredientId || null }));
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

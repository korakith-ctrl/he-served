import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, update } from "firebase/database";
import QRCode from "qrcode";
import Login from "./Login.jsx";
import CustomerOrder from "./CustomerOrder.jsx";

const UNITS = { g: "กรัม", ml: "มล.", piece: "ชิ้น" };
const CATEGORIES = [
  { id: "coffee", label: "เมล็ดกาแฟ" },
  { id: "matcha", label: "มัทฉะ" },
  { id: "cocoa_tea", label: "โกโก้ / ชา" },
  { id: "milk", label: "นม" },
  { id: "juice_water", label: "น้ำผลไม้ / น้ำ-น้ำแข็ง" },
  { id: "packaging", label: "บรรจุภัณฑ์" },
];
const CHANNELS = { store: "หน้าร้าน", delivery: "เดลิเวอรี่", online: "สั่งออนไลน์" };

function genId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round4(n) { return Math.round(n * 10000) / 10000; }

function seedIngredients() {
  const rows = [
    ["coffee_pacamara", "Pacamara House Blend", "coffee", "g", 0.84, "bean", 0],
    ["coffee_bluekoff", "Bluekoff A4.5 medium", "coffee", "g", 0.551, "bean", 0],
    ["matcha_peace", "Peace Pure Matcha", "matcha", "g", 4.87, null, 0],
    ["cocoa_powder", "ผงโกโก้", "cocoa_tea", "g", 0.518, null, 0],
    ["thai_tea", "ผงชาไทย", "cocoa_tea", "g", 0.192, null, 0],
    ["jelly_powder", "ผงวุ้น", "cocoa_tea", "piece", 50, null, 0],
    ["whip_powder", "ผงวิปปิ้งครีม", "cocoa_tea", "g", 0.106, null, 0],
    ["syrup", "ไซรัป", "cocoa_tea", "ml", 0.037, null, 0],
    ["milk_fresh", "นมสด (รวม)", "milk", "ml", 0.06, "milk", 0],
    ["milk_oat", "นม Oat Milk", "milk", "ml", 0.047, "milk", 10],
    ["milk_condensed", "นมข้นหวาน", "milk", "ml", 0.0658, null, 0],
    ["milk_evaporated", "นมข้นจืด", "milk", "ml", 0.0597, null, 0],
    ["juice_orange", "น้ำส้มเขียวหวาน Malee", "juice_water", "ml", 0.084, null, 0],
    ["juice_coconut", "น้ำมะพร้าว Cocomax", "juice_water", "ml", 0.075, null, 0],
    ["water", "น้ำเปล่า", "juice_water", "ml", 0.00667, null, 0],
    ["ice", "น้ำแข็ง", "juice_water", "ml", 0.00667, null, 0],
    ["straw_black", "หลอดสีดำ 5mm", "packaging", "piece", 0.29, null, 0],
    ["lid_98", "ฝาแก้ว 98mm", "packaging", "piece", 1.0, null, 0],
    ["wax_paper", "กระดาษไขปิดแก้ว", "packaging", "piece", 0.058, null, 0],
    ["sticker", "สติกเกอร์ปิดแก้ว", "packaging", "piece", 0.56, null, 0],
    ["zipbag_ice", "ถุงซิปใส่น้ำแข็ง", "packaging", "piece", 0.72, null, 0],
    ["zipbag_drink", "ถุงซิปใส่เครื่องดื่ม", "packaging", "piece", 0.72, null, 0],
    ["bag_2c", "ถุงใส่เครื่องดื่ม 2 ช่อง", "packaging", "piece", 1.0, null, 0],
    ["bag_1c", "ถุงใส่เครื่องดื่ม 1 ช่อง", "packaging", "piece", 0.48, null, 0],
    ["tape", "เทปใส", "packaging", "piece", 29, null, 0],
    ["cup_14", "แก้ว 14oz 98mm", "packaging", "piece", 1.6, null, 0],
    ["cup_16", "แก้ว 16oz 98mm", "packaging", "piece", 1.0, null, 0],
  ];
  return rows.map(([id, name, category, unit, costPerUnit, altGroup, altUpcharge]) => ({
    id, name, category, unit, costPerUnit,
    stockQty: 0, lowStockThreshold: unit === "piece" ? 20 : 500,
    altGroup: altGroup || null, altUpcharge: altUpcharge || 0,
  }));
}

function seedMenus() {
  const mk = (name, priceStore, priceDelivery, ings, category) => ({
    id: genId("menu"), name, priceStore, priceDelivery, available: true, category: category || "กาแฟ", imageUrl: "",
    ingredients: ings.map(([ingredientId, qty]) => ({ ingredientId, qty })),
  });
  const pack = [["cup_16", 1], ["lid_98", 1], ["straw_black", 1], ["zipbag_drink", 1], ["sticker", 1]];
  return [
    mk("Iced Americano", 45, 55, [["coffee_bluekoff", 18], ["water", 160], ["ice", 90], ...pack]),
    mk("Iced Orange Americano", 55, 65, [["coffee_bluekoff", 16], ["juice_orange", 90], ["water", 60], ["ice", 90], ...pack]),
    mk("Iced Latte", 50, 60, [["coffee_bluekoff", 18], ["milk_fresh", 110], ["water", 40], ["ice", 90], ...pack]),
    mk("Iced Mocha", 55, 65, [["coffee_bluekoff", 18], ["cocoa_powder", 5], ["milk_fresh", 70], ["milk_condensed", 20], ["milk_evaporated", 20], ["ice", 90], ...pack]),
    mk("Iced Es-Yen", 45, 55, [["coffee_bluekoff", 18], ["milk_fresh", 60], ["milk_condensed", 25], ["milk_evaporated", 25], ["ice", 90], ...pack]),
    mk("Iced Cocoa", 50, 60, [["cocoa_powder", 20], ["milk_fresh", 40], ["milk_condensed", 25], ["milk_evaporated", 25], ["water", 60], ["ice", 90], ...pack], "โกโก้ / ชา"),
    mk("Matcha Latte", 60, 70, [["matcha_peace", 4], ["milk_fresh", 150], ["syrup", 15], ["ice", 90], ...pack], "มัทฉะ"),
  ];
}

function seedPlatforms() {
  return [
    { id: genId("plat"), name: "Grab Food", gpPercent: 30 },
    { id: genId("plat"), name: "LINE MAN", gpPercent: 32 },
    { id: genId("plat"), name: "foodpanda", gpPercent: 30 },
    { id: genId("plat"), name: "Shopee Food", gpPercent: 25 },
  ];
}

function seedOptionGroups() {
  return [
    {
      id: genId("opt"),
      name: "เมล็ดกาแฟ",
      required: true,
      choices: [
        { id: genId("choice"), label: "Classic - Medium Dark", note: "fruity, Caramel, Chocolate, Nutty", priceDelta: 0 },
        { id: genId("choice"), label: "Brazil Blend - Medium", note: "caramel Candy, Rich Milk Chocolate", priceDelta: 20 },
      ],
    },
    {
      id: genId("opt"),
      name: "ระดับความหวาน",
      required: true,
      choices: [
        { id: genId("choice"), label: "หวานปกติ", note: "", priceDelta: 0 },
        { id: genId("choice"), label: "หวาน 50%", note: "", priceDelta: 0 },
        { id: genId("choice"), label: "หวาน 25%", note: "", priceDelta: 0 },
        { id: genId("choice"), label: "ไม่หวาน", note: "", priceDelta: 0 },
      ],
    },
    {
      id: genId("opt"),
      name: "นมที่ใช้",
      required: false,
      choices: [
        { id: genId("choice"), label: "นมสด", note: "", priceDelta: 0 },
        { id: genId("choice"), label: "นม Oat", note: "", priceDelta: 10 },
        { id: genId("choice"), label: "ไม่ใส่นม", note: "", priceDelta: 0 },
      ],
    },
  ];
}

function defaultState() {
  const optionGroups = seedOptionGroups();
  const [beanGroup, sweetnessGroup, milkGroup] = optionGroups;
  const menus = seedMenus();
  for (const m of menus) {
    const hasCoffee = m.ingredients.some((l) => l.ingredientId === "coffee_bluekoff");
    const hasMilk = m.ingredients.some((l) => l.ingredientId === "milk_fresh");
    m.optionGroupIds = [
      ...(hasCoffee ? [beanGroup.id] : []),
      sweetnessGroup.id,
      ...(hasMilk ? [milkGroup.id] : []),
    ];
  }
  return {
    ingredients: seedIngredients(),
    menus,
    sales: [],
    purchases: [],
    settings: { overheadPerCup: 3.1, shopName: "ร้านกาแฟของฉัน", platforms: seedPlatforms(), promptpayId: "", acceptingOrders: true, slipTestMode: false, bannerImageUrl: "", bannerImageUrls: [], categoryOrder: [], defaultPackagingLines: [] },
    optionGroups,
    promotions: [],
  };
}

function normalizeData(raw) {
  return {
    ingredients: raw.ingredients || [],
    menus: (raw.menus || []).map((m) => ({
      ...m, ingredients: m.ingredients || [], optionGroupIds: m.optionGroupIds || [],
      available: m.available ?? true, category: m.category || "อื่นๆ", imageUrl: m.imageUrl || "",
    })),
    sales: raw.sales || [],
    purchases: raw.purchases || [],
    settings: {
      overheadPerCup: raw.settings?.overheadPerCup ?? 3.1,
      shopName: raw.settings?.shopName ?? "ร้านกาแฟของฉัน",
      platforms: raw.settings?.platforms || [],
      promptpayId: raw.settings?.promptpayId || "",
      acceptingOrders: raw.settings?.acceptingOrders ?? true,
      slipTestMode: raw.settings?.slipTestMode ?? false,
      bannerImageUrl: raw.settings?.bannerImageUrl || "",
      bannerImageUrls: raw.settings?.bannerImageUrls || [],
      categoryOrder: raw.settings?.categoryOrder || [],
      defaultPackagingLines: raw.settings?.defaultPackagingLines || [],
    },
    optionGroups: (raw.optionGroups || []).map((g) => ({
      ...g,
      choices: (g.choices || []).map((c) => ({ ...c, ingredientId: c.ingredientId || null, qtyPercent: c.qtyPercent != null ? c.qtyPercent : 100, isDefault: c.isDefault || false })),
    })),
    promotions: (raw.promotions || []).map((p) => ({
      ...p,
      menuIds: p.menuIds || [],
      active: p.active ?? true,
      type: p.type || (p.menuIds && p.menuIds.length > 1 ? "bundle" : "single"),
      minQty: p.minQty || 2,
      chooseCount: p.chooseCount || 2,
      startAt: p.startAt || null,
      endAt: p.endAt || null,
    })),
  };
}

function computePromoPricing(promo, menusById) {
  const items = (promo.menuIds || []).map((id) => menusById[id]).filter(Boolean);
  const originalTotal = items.reduce((s, m) => s + m.priceStore, 0);
  const promoTotal = promo.discountType === "percent"
    ? originalTotal * (1 - (Number(promo.discountValue) || 0) / 100)
    : Number(promo.discountValue) || 0;
  return { items, originalTotal, promoTotal: Math.max(0, Math.round(promoTotal * 100) / 100) };
}

function qtyPromoSetPrice(promo, menu) {
  if (!menu) return 0;
  const setSize = Math.max(1, Number(promo.minQty) || 2);
  const total = promo.discountType === "percent"
    ? menu.priceStore * setSize * (1 - (Number(promo.discountValue) || 0) / 100)
    : Number(promo.discountValue) || 0;
  return Math.max(0, Math.round(total * 100) / 100);
}

function promoActiveWindow(promo) {
  const now = Date.now();
  if (promo.startAt && now < promo.startAt) return "upcoming";
  if (promo.endAt && now > promo.endAt) return "expired";
  return "live";
}

function formatPromoDateTime(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function resolveLines(menu, adjustments) {
  return menu.ingredients.map((line) => {
    const adj = adjustments[line.ingredientId];
    if (!adj) return line;
    const ingredientId = adj.ingredientId || line.ingredientId;
    const qtyPercent = adj.qtyPercent != null ? adj.qtyPercent : 100;
    return { ...line, ingredientId, qty: round4(line.qty * (qtyPercent / 100)) };
  });
}

function calcRecipeCost(menu, ingredientsById, adjustments) {
  const lines = resolveLines(menu, adjustments || {});
  let cost = 0;
  const breakdown = [];
  for (const line of lines) {
    const ing = ingredientsById[line.ingredientId];
    if (!ing) continue;
    const lineCost = ing.costPerUnit * line.qty;
    cost += lineCost;
    breakdown.push({ ...line, name: ing.name, unit: ing.unit, unitCost: ing.costPerUnit, lineCost });
  }
  return { ingredientCost: cost, breakdown };
}

function milkChoiceFor(menu, ingredientsById) {
  const line = menu.ingredients.find((l) => ingredientsById[l.ingredientId] && ingredientsById[l.ingredientId].altGroup);
  if (!line) return null;
  const group = ingredientsById[line.ingredientId].altGroup;
  const options = Object.values(ingredientsById).filter((i) => i.altGroup === group);
  return { originalIngredientId: line.ingredientId, options };
}

function resolveIngredientAdjustmentsFromOptions(menu, options, ingredientsById) {
  const adjustments = {};
  for (const opt of options || []) {
    if (!opt.ingredientId) continue;
    const chosenIng = ingredientsById[opt.ingredientId];
    if (!chosenIng || !chosenIng.altGroup) continue;
    const origLine = menu.ingredients.find((l) => {
      const li = ingredientsById[l.ingredientId];
      return li && li.altGroup === chosenIng.altGroup;
    });
    if (!origLine) continue;
    const qtyPercent = opt.qtyPercent != null ? opt.qtyPercent : 100;
    if (origLine.ingredientId === opt.ingredientId && qtyPercent === 100) continue;
    adjustments[origLine.ingredientId] = { ingredientId: opt.ingredientId, qtyPercent };
  }
  return adjustments;
}

function ingredientPickerOptions(ingredients, currentId) {
  const currentIng = ingredients.find((x) => x.id === currentId);
  const seen = new Set();
  const result = [];
  for (const i of ingredients) {
    if (i.altGroup) {
      if (seen.has(i.altGroup)) continue;
      seen.add(i.altGroup);
      const rep = currentIng && currentIng.altGroup === i.altGroup ? currentIng : i;
      result.push({ value: rep.id, label: rep.altGroup });
    } else {
      result.push({ value: i.id, label: i.name });
    }
  }
  return result;
}

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function playOrderChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.32);
    });
    setTimeout(() => ctx.close(), 700);
  } catch {
    // Web Audio unavailable — silently skip
  }
}

function Icon({ name, size = 18, style }) {
  return <i className={"ti ti-" + name} style={{ fontSize: size, ...style }} aria-hidden="true"></i>;
}

// Buffers the field's own display value locally and only pushes it up to
// parent state once composition ends, so a controlled re-render can't
// interrupt an in-progress Thai tone-mark composition and drop characters.
function TextField({ value, onChange, ...rest }) {
  const [local, setLocal] = useState(value);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) setLocal(value);
  }, [value]);

  return (
    <input
      {...rest}
      value={local}
      onChange={(e) => {
        setLocal(e.target.value);
        if (!composingRef.current) onChange(e.target.value);
      }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        setLocal(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

const TABS = [
  { id: "dashboard", label: "ภาพรวม", icon: "layout-dashboard" },
  { id: "sell", label: "ขายเครื่องดื่ม", icon: "cash-register" },
  { id: "orders", label: "ออเดอร์ลูกค้า", icon: "receipt" },
  { id: "menus", label: "เมนู & สูตร", icon: "cup" },
  { id: "promotions", label: "โปรโมชั่น", icon: "discount" },
  { id: "options", label: "ตัวเลือกเสริม", icon: "list-details" },
  { id: "ingredients", label: "วัตถุดิบ & สต็อก", icon: "box-multiple" },
  { id: "reports", label: "รายงาน", icon: "chart-line" },
  { id: "settings", label: "ตั้งค่า", icon: "settings" },
];

function ShopApp({ uid, user }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches
  );
  const [orders, setOrders] = useState([]);
  const prevPendingCount = useRef(0);
  const isFirstOrdersSnapshot = useRef(true);
  const autoRecordedRef = useRef(new Set());

  const shopRef = ref(db, "shops/" + uid);
  const isFirstSnapshot = useMemo(() => ({ current: true }), [uid]);

  useEffect(() => {
    const unsub = onValue(ref(db, `orders/${uid}`), (snap) => {
      const val = snap.val() || {};
      const list = Object.entries(val).map(([id, o]) => ({ id, ...o }));
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const pendingCount = list.filter((o) => o.status === "pending").length;
      if (!isFirstOrdersSnapshot.current && pendingCount > prevPendingCount.current) {
        playOrderChime();
      }
      prevPendingCount.current = pendingCount;
      isFirstOrdersSnapshot.current = false;
      setOrders(list);
    });
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    const unsub = onValue(shopRef, (snap) => {
      if (snap.exists()) {
        setData(normalizeData(snap.val()));
      } else {
        const seeded = defaultState();
        set(shopRef, seeded).catch((err) => showToast("บันทึกไม่สำเร็จ: " + err.message));
        setData(seeded);
      }
      isFirstSnapshot.current = false;
    }, (err) => {
      showToast("เชื่อมต่อฐานข้อมูลไม่สำเร็จ: " + err.message);
      setData(defaultState());
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!data) return;
    for (const o of orders) {
      if (
        o.status === "paid" &&
        o.paymentVerifiedBy === "slipok-auto" &&
        !o.saleRecorded &&
        !autoRecordedRef.current.has(o.id)
      ) {
        autoRecordedRef.current.add(o.id);
        for (const item of o.items) {
          const upcharge = (item.options || []).reduce((s, x) => s + (x.priceDelta || 0), 0);
          const itemMenu = data.menus.find((m) => m.id === item.menuId);
          const substitutions = itemMenu ? resolveIngredientAdjustmentsFromOptions(itemMenu, item.options, ingredientsById) : {};
          recordSale(item.menuId, item.qty, "online", { upcharge, substitutions, milkLabel: (item.options || []).map((x) => x.label).join(", ") || null });
        }
        update(ref(db, `orders/${uid}/${o.id}`), { saleRecorded: true }).catch(() => {});
        showToast(`สลิปยืนยันอัตโนมัติ: ออเดอร์ ${o.customerName || o.customerPhone} ชำระเงินแล้ว`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, data]);

  useEffect(() => {
    if (!data || isFirstSnapshot.current) return;
    const t = setTimeout(() => {
      set(shopRef, data).catch((err) => showToast("บันทึกไม่สำเร็จ: " + err.message));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  const ingredientsById = useMemo(() => {
    if (!data) return {};
    const m = {};
    for (const ing of data.ingredients) m[ing.id] = ing;
    return m;
  }, [data]);

  if (!data) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#0B4A7A", fontFamily: "sans-serif" }}>
        กำลังโหลดข้อมูลร้าน...
      </div>
    );
  }

  function updateData(fn) {
    setData((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
  }

  function recordSale(menuId, qty, channel, opts) {
    opts = opts || {};
    const menu = data.menus.find((m) => m.id === menuId);
    if (!menu) return;
    const substitutions = opts.substitutions || {};
    const { ingredientCost } = calcRecipeCost(menu, ingredientsById, substitutions);
    const lines = resolveLines(menu, substitutions);
    const overhead = data.settings.overheadPerCup;
    const basePrice = channel === "delivery" ? menu.priceDelivery : menu.priceStore;
    const unitPrice = basePrice + (opts.upcharge || 0);
    const grossRevenue = unitPrice * qty;
    const platform = channel === "delivery" ? data.settings.platforms.find((p) => p.id === opts.platformId) : null;
    const gpPercent = platform ? platform.gpPercent : 0;
    const gpAmount = channel === "delivery" ? round4(grossRevenue * (gpPercent / 100)) : 0;
    const promoDiscount = opts.promoDiscount || 0;
    const netRevenue = grossRevenue - gpAmount - promoDiscount;
    const totalCost = (ingredientCost + overhead) * qty;
    updateData((next) => {
      for (const line of lines) {
        const ing = next.ingredients.find((i) => i.id === line.ingredientId);
        if (ing) ing.stockQty = round4(ing.stockQty - line.qty * qty);
      }
      next.sales.push({
        id: genId("sale"), timestamp: new Date().toISOString(), menuId, menuName: menu.name,
        channel, qty, unitPrice, grossRevenue, gpAmount, gpPercent, promoDiscount, netRevenue,
        totalCost, profit: netRevenue - totalCost,
        platformName: platform ? platform.name : null,
        milkNote: opts.milkLabel || null,
      });
    });
    showToast(`บันทึกการขาย ${menu.name} x${qty} (${channel === "delivery" ? (platform ? platform.name : "เดลิเวอรี่") : "หน้าร้าน"}) แล้ว`);
  }

  const activeTabInfo = TABS.find((t) => t.id === tab);
  const pendingOrderCount = orders.filter((o) => o.status === "pending").length;

  return (
    <div style={{ fontFamily: "var(--f-body)", color: "var(--espresso-4)", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .coffeeapp * { box-sizing: border-box; }
        .coffeeapp button { font-family: inherit; cursor: pointer; }
        .coffeeapp input, .coffeeapp select { font-family: inherit; }
        .cbtn { border: 1px solid var(--line); background: #fff; color: var(--espresso-4); border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 500; transition: background .15s ease, border-color .15s ease; }
        .cbtn:hover { background: var(--cream-2); }
        .cbtn:active { transform: scale(0.97); }
        .cbtn-accent { background: var(--sage); color: #fff; border-color: var(--sage); }
        .cbtn-accent:hover { background: var(--sage-dark); }
        .cbtn-danger { color: var(--danger); border-color: var(--danger-line); background: var(--danger-light); }
        .cbtn-danger:hover { background: var(--danger-line); }
        .cbtn-edit { color: var(--info-dark); border-color: var(--info); background: var(--info-light); }
        .cbtn-edit:hover { background: var(--info); color: #fff; }
        .cfield { border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: 13px; background: #fff; color: var(--espresso-4); width: 100%; }
        .cfield:focus { outline: 2px solid var(--sage); outline-offset: 1px; }
        .navitem { border: none; background: transparent; color: var(--espresso-3); padding: 10px 14px; font-size: 13.5px; font-weight: 500; border-radius: 10px; display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; transition: background .15s ease, color .15s ease; }
        .navitem:hover { background: var(--cream-2); }
        .navitem.active { background: var(--sage-light); color: var(--sage-dark); font-weight: 600; }
        table.cdata { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.cdata th { text-align: left; font-weight: 500; color: var(--espresso-2); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
        table.cdata td { padding: 8px; border-bottom: 1px solid var(--line-soft); }
        .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .table-scroll table.cdata { min-width: 640px; }
        .chpill { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
        @keyframes paidFlash {
          0% { box-shadow: 0 0 0 0 rgba(206,86,13,0); background: var(--surface); }
          15% { box-shadow: 0 0 0 4px var(--sage); background: var(--sage-light); }
          100% { box-shadow: 0 0 0 0 rgba(206,86,13,0); background: var(--surface); }
        }
        .sidebar-toggle { border: none; background: var(--cream-2); color: var(--espresso-3); width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background .15s ease, color .15s ease; }
        .sidebar-toggle:hover { background: var(--sage-light); color: var(--sage-dark); }
        .admin-sidebar { transition: width .18s ease; }
      `}</style>
      <div className="coffeeapp" style={{
        "--cream": "#F4F6F4", "--cream-2": "#EBEFEA", "--surface": "#FFFFFF",
        "--espresso-5": "#063360", "--espresso-4": "#26364A", "--espresso-3": "#5B6B7C", "--espresso-2": "#8B98A5",
        "--sage": "#CE560D", "--sage-dark": "#A8440A", "--sage-light": "#FBEBDD",
        "--gold": "#CE560D", "--gold-dark": "#A8440A", "--gold-light": "#FBEBDD",
        "--info": "#3D6E8C", "--info-dark": "#2C5069", "--info-light": "#E4EDF2",
        "--danger": "#B23A2E", "--danger-line": "#E7CAC5", "--danger-light": "#FAEEEC",
        "--line": "#E4E8E5", "--line-soft": "#EEF1EF",
        "--f-display": "'Fraunces', serif", "--f-body": "'Manrope', 'Inter', sans-serif", "--f-mono": "'IBM Plex Mono', monospace",
        display: "flex", background: "var(--cream)", minHeight: "100vh",
      }}>
        <aside className="admin-sidebar" style={{
          width: sidebarCollapsed ? 68 : 236, flexShrink: 0, background: "#fff", borderRight: "1px solid var(--line)",
          display: "flex", flexDirection: "column", padding: sidebarCollapsed ? "18px 10px" : "18px 14px",
          position: "sticky", top: 0, height: "100vh", overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 18px", justifyContent: sidebarCollapsed ? "center" : "space-between" }}>
            {!sidebarCollapsed && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, background: "var(--sage)", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <Icon name="coffee" size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15, color: "var(--espresso-5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.settings.shopName}</p>
                  <p style={{ margin: 0, fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--espresso-2)" }}>ระบบหลังบ้าน</p>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <div style={{
                width: 34, height: 34, borderRadius: 10, background: "var(--sage)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }} title={data.settings.shopName}>
                <Icon name="coffee" size={18} />
              </div>
            )}
            {!sidebarCollapsed && (
              <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(true)} title="ย่อเมนู">
                <Icon name="chevron-left" size={15} />
              </button>
            )}
          </div>

          {sidebarCollapsed && (
            <button className="sidebar-toggle" style={{ margin: "0 auto 12px" }} onClick={() => setSidebarCollapsed(false)} title="ขยายเมนู">
              <Icon name="chevron-right" size={15} />
            </button>
          )}

          <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto" }}>
            {TABS.map((t) => {
              const pendingCount = t.id === "orders" ? pendingOrderCount : 0;
              return (
                <button
                  key={t.id}
                  className={"navitem" + (tab === t.id ? " active" : "")}
                  onClick={() => setTab(t.id)}
                  title={sidebarCollapsed ? t.label : undefined}
                  style={sidebarCollapsed ? { justifyContent: "center", padding: "10px", position: "relative" } : undefined}
                >
                  <Icon name={t.icon} size={17} />
                  {!sidebarCollapsed && <span style={{ flex: 1 }}>{t.label}</span>}
                  {pendingCount > 0 && (
                    <span style={{
                      background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 600, lineHeight: 1,
                      borderRadius: 999, padding: "3px 6px",
                      ...(sidebarCollapsed ? { position: "absolute", top: 4, right: 4, padding: "2px 5px" } : {}),
                    }}>{sidebarCollapsed ? "" : pendingCount}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {user && (
            <div
              style={{
                marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: sidebarCollapsed ? "0" : "8px 6px",
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
              }}
              title={user.displayName || user.email || ""}
            >
              <div style={{
                width: 28, height: 28, borderRadius: "50%", background: "var(--sage-light)", color: "var(--sage-dark)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 700,
              }}>
                {(user.displayName || user.email || "?").charAt(0).toUpperCase()}
              </div>
              {!sidebarCollapsed && (
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: "var(--espresso-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {user.displayName || user.email}
                  </p>
                  {user.displayName && (
                    <p style={{ margin: 0, fontSize: 10.5, color: "var(--espresso-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user.email}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            className="cbtn"
            style={{ marginTop: 8, width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => signOut(auth)}
            title="ออกจากระบบ"
          >
            <Icon name="logout" size={14} /> {!sidebarCollapsed && "ออกจากระบบ"}
          </button>
        </aside>

        <main style={{ flex: 1, minWidth: 0, padding: "22px 28px 60px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--espresso-2)" }}>{data.settings.shopName}</p>
              <h1 style={{ margin: "2px 0 0", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 24, color: "var(--espresso-5)" }}>{activeTabInfo?.label}</h1>
            </div>
          </div>

          {tab === "dashboard" && <Dashboard data={data} ingredientsById={ingredientsById} setTab={setTab} recordSale={recordSale} />}
          {tab === "sell" && <SellPanel data={data} ingredientsById={ingredientsById} recordSale={recordSale} />}
          {tab === "orders" && <OrdersPanel uid={uid} orders={orders} recordSale={recordSale} showToast={showToast} data={data} ingredientsById={ingredientsById} />}
          {tab === "menus" && <MenusPanel data={data} ingredientsById={ingredientsById} updateData={updateData} showToast={showToast} />}
          {tab === "promotions" && <PromotionsPanel data={data} updateData={updateData} showToast={showToast} />}
          {tab === "ingredients" && <IngredientsPanel data={data} updateData={updateData} showToast={showToast} />}
          {tab === "reports" && <ReportsPanel data={data} />}
          {tab === "options" && <OptionGroupsPanel data={data} updateData={updateData} showToast={showToast} />}
          {tab === "settings" && <SettingsPanel data={data} updateData={updateData} showToast={showToast} uid={uid} />}
        </main>

        {toast && (
          <div style={{
            position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)",
            background: "var(--espresso-5)", color: "#fff", padding: "9px 18px", borderRadius: 10, fontSize: 13, zIndex: 40,
          }}>{toast}</div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px" }}>
      <p style={{ margin: 0, fontSize: 12, color: "var(--espresso-2)" }}>{label}</p>
      <p style={{ margin: "4px 0 0", fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 600, color: accent || "var(--espresso-5)" }}>{value}</p>
      {sub && <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--espresso-2)" }}>{sub}</p>}
    </div>
  );
}

function ChannelPill({ channel }) {
  const style = channel === "delivery"
    ? { background: "var(--gold-light)", color: "var(--gold-dark)" }
    : channel === "online"
    ? { background: "var(--cream-2)", color: "var(--espresso-3)" }
    : { background: "var(--sage-light)", color: "var(--sage-dark)" };
  return <span className="chpill" style={style}>{CHANNELS[channel]}</span>;
}

function Dashboard({ data, ingredientsById, setTab, recordSale }) {
  const today = todayStr();
  const todaySales = data.sales.filter((s) => s.timestamp.slice(0, 10) === today);
  const revenue = todaySales.reduce((a, s) => a + s.netRevenue, 0);
  const cost = todaySales.reduce((a, s) => a + s.totalCost, 0);
  const profit = revenue - cost;
  const cups = todaySales.reduce((a, s) => a + s.qty, 0);

  const lowStock = data.ingredients.filter((i) => i.stockQty <= i.lowStockThreshold);

  const menuCount = {};
  for (const s of data.sales) menuCount[s.menuName] = (menuCount[s.menuName] || 0) + s.qty;
  const topMenus = Object.entries(menuCount).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 22 }}>
        <MetricCard label="ยอดขายวันนี้ (สุทธิ)" value={"฿" + money(revenue)} sub={cups + " แก้ว"} />
        <MetricCard label="ต้นทุนวันนี้" value={"฿" + money(cost)} />
        <MetricCard label="กำไรวันนี้" value={"฿" + money(profit)} accent={profit >= 0 ? "var(--sage-dark)" : "var(--danger)"} />
        <MetricCard label="วัตถุดิบใกล้หมด" value={lowStock.length} accent={lowStock.length ? "var(--gold)" : undefined} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <div>
          <SectionTitle icon="bolt" text="ขายด่วน (หน้าร้าน)" />
          <p style={{ fontSize: 11.5, color: "var(--espresso-2)", margin: "-6px 0 10px" }}>สำหรับขายแบบละเอียด (เลือกช่องทาง/นมทางเลือก) ไปที่แท็บ "ขายเครื่องดื่ม"</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {data.menus.map((m) => (
              <button key={m.id} className="cbtn cbtn-accent" style={{ textAlign: "left", padding: "10px 12px" }}
                onClick={() => recordSale(m.id, 1, "store", {})}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</div>
                <div style={{ fontSize: 11.5, opacity: 0.9 }}>฿{money(m.priceStore)} · แตะเพื่อขาย +1</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle icon="alert-triangle" text="แจ้งเตือนสต็อก" />
          {lowStock.length === 0 ? (
            <EmptyNote text="สต็อกทุกรายการยังเพียงพอ" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lowStock.map((i) => (
                <div key={i.id} style={{ background: "var(--gold-light)", border: "1px solid var(--gold)", borderRadius: 9, padding: "8px 10px", fontSize: 12.5 }}>
                  <strong>{i.name}</strong> เหลือ {i.stockQty} {UNITS[i.unit]}
                </div>
              ))}
              <button className="cbtn" onClick={() => setTab("ingredients")}>ไปเติมสต็อก →</button>
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <SectionTitle icon="trophy" text="เมนูขายดี (สะสม)" />
            {topMenus.length === 0 ? <EmptyNote text="ยังไม่มีข้อมูลการขาย" /> : (
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {topMenus.map(([name, q]) => <li key={name}>{name} — {q} แก้ว</li>)}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--espresso-3)" }}>
      <Icon name={icon} size={15} />
      <span style={{ fontSize: 12.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".03em" }}>{text}</span>
    </div>
  );
}

function EmptyNote({ text }) {
  return <p style={{ fontSize: 12.5, color: "var(--espresso-2)", fontStyle: "italic", margin: 0 }}>{text}</p>;
}

function SellPanel({ data, ingredientsById, recordSale }) {
  const [state, setState] = useState({});

  function get(menuId, key, fallback) {
    return (state[menuId] && state[menuId][key] !== undefined) ? state[menuId][key] : fallback;
  }
  function set(menuId, patch) {
    setState((p) => ({ ...p, [menuId]: { ...p[menuId], ...patch } }));
  }

  function stockOk(menu, substitutions, qty) {
    const lines = resolveLines(menu, substitutions);
    for (const line of lines) {
      const ing = ingredientsById[line.ingredientId];
      if (ing && ing.stockQty < line.qty * qty) return false;
    }
    return true;
  }

  return (
    <div>
      <SectionTitle icon="cash-register" text="บันทึกการขาย — ระบบตัดสต็อกให้อัตโนมัติตามช่องทางและนมที่เลือก" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
        {data.menus.map((menu) => {
          const qty = get(menu.id, "qty", 1);
          const channel = get(menu.id, "channel", "store");
          const milk = milkChoiceFor(menu, ingredientsById);
          const milkSelId = get(menu.id, "milkSel", milk ? milk.originalIngredientId : null);
          const substitutions = milk && milkSelId !== milk.originalIngredientId ? { [milk.originalIngredientId]: { ingredientId: milkSelId, qtyPercent: 100 } } : {};
          const upcharge = milk ? (ingredientsById[milkSelId] ? ingredientsById[milkSelId].altUpcharge : 0) : 0;
          const promo = get(menu.id, "promo", 0);
          const platformId = get(menu.id, "platformId", data.settings.platforms[0]?.id);
          const platform = data.settings.platforms.find((p) => p.id === platformId);
          const { ingredientCost } = calcRecipeCost(menu, ingredientsById, substitutions);
          const ok = stockOk(menu, substitutions, qty);
          const basePrice = channel === "delivery" ? menu.priceDelivery : menu.priceStore;
          const unitPrice = basePrice + upcharge;

          return (
            <div key={menu.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
              <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16, color: "var(--espresso-5)" }}>{menu.name}</div>
              <div style={{ fontSize: 12, color: "var(--espresso-2)", margin: "3px 0 10px" }}>
                ต้นทุนวัตถุดิบ ฿{money(ingredientCost)} · ราคาขาย ฿{money(unitPrice)}
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {Object.entries(CHANNELS).map(([k, label]) => {
                  const disabled = k === "delivery" && data.settings.platforms.length === 0;
                  return (
                    <button key={k} className="cbtn" disabled={disabled} title={disabled ? "เพิ่มแพลตฟอร์มในแท็บตั้งค่าก่อน" : undefined}
                      style={{ flex: 1, padding: "6px 8px", fontSize: 12, opacity: disabled ? 0.5 : 1, background: channel === k ? "var(--sage-light)" : undefined, borderColor: channel === k ? "var(--sage)" : undefined }}
                      onClick={() => !disabled && set(menu.id, { channel: k })}>{label}</button>
                  );
                })}
              </div>

              {milk && (
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--espresso-2)" }}>นม</label>
                  <select className="cfield" value={milkSelId} onChange={(e) => set(menu.id, { milkSel: e.target.value })}>
                    {milk.options.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}{o.altUpcharge ? ` (+฿${o.altUpcharge})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}

              {channel === "delivery" && (
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--espresso-2)" }}>แพลตฟอร์ม</label>
                  <select className="cfield" value={platformId} onChange={(e) => set(menu.id, { platformId: e.target.value })} style={{ marginBottom: 6 }}>
                    {data.settings.platforms.map((p) => <option key={p.id} value={p.id}>{p.name} (GP {p.gpPercent}%)</option>)}
                  </select>
                  <label style={{ fontSize: 11, color: "var(--espresso-2)" }}>ส่วนลดโปรโมชั่น (บาท, ถ้ามี)</label>
                  <input className="cfield" type="number" value={promo} onChange={(e) => set(menu.id, { promo: Number(e.target.value) })} />
                  {platform && <p style={{ fontSize: 10.5, color: "var(--espresso-2)", margin: "3px 0 0" }}>หัก GP {platform.name} {platform.gpPercent}% อัตโนมัติ</p>}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <button className="cbtn" style={{ padding: "4px 10px" }} onClick={() => set(menu.id, { qty: Math.max(1, qty - 1) })}>−</button>
                <span style={{ minWidth: 20, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                <button className="cbtn" style={{ padding: "4px 10px" }} onClick={() => set(menu.id, { qty: qty + 1 })}>+</button>
              </div>
              {!ok && <p style={{ fontSize: 11.5, color: "var(--danger)", margin: "0 0 8px" }}><Icon name="alert-circle" size={13} /> สต็อกวัตถุดิบไม่พอ (ยังขายได้ แต่สต็อกจะติดลบ)</p>}
              <button className="cbtn cbtn-accent" style={{ width: "100%" }} onClick={() => {
                recordSale(menu.id, qty, channel, { substitutions, upcharge, promoDiscount: promo, platformId, milkLabel: milk ? ingredientsById[milkSelId].name : null });
                set(menu.id, { qty: 1, promo: 0 });
              }}>
                ขาย {qty} แก้ว ({channel === "delivery" ? (platform ? platform.name : "เดลิเวอรี่") : "หน้าร้าน"})
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ORDER_STATUS_LABEL = { pending: "รอยืนยัน", paid: "จ่ายแล้ว", preparing: "กำลังทำ", ready: "พร้อมรับ", cancelled: "ยกเลิก" };
const ORDER_STATUS_STYLE = {
  pending: { bg: "var(--gold-light)", color: "var(--gold-dark)" },
  paid: { bg: "var(--info-light)", color: "var(--info-dark)" },
  preparing: { bg: "var(--sage-light)", color: "var(--sage-dark)" },
  ready: { bg: "var(--sage-dark)", color: "#fff" },
  cancelled: { bg: "var(--danger-light)", color: "var(--danger)" },
};
const PAYMENT_METHOD_LABEL = { cash: "เงินสด", promptpay: "พร้อมเพย์" };

function StatusBadge({ status }) {
  const style = ORDER_STATUS_STYLE[status] || { bg: "var(--cream-2)", color: "var(--espresso-3)" };
  return (
    <span className="chpill" style={{ background: style.bg, color: style.color, fontWeight: 600 }}>
      {ORDER_STATUS_LABEL[status] || status}
    </span>
  );
}

function formatPickupDateTH(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function OrderMeta({ paymentMethod, pickupDate, paymentVerified, paymentVerifiedBy }) {
  if (!paymentMethod && !pickupDate) return null;
  const isTestSlip = paymentVerifiedBy === "slipok-test-mode";
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0" }}>
      {paymentMethod && (
        <span className="chpill" style={{ background: "var(--cream-2)", color: "var(--espresso-3)" }}>
          {paymentMethod === "cash" ? <Icon name="cash" size={11} /> : <Icon name="qrcode" size={11} />} {PAYMENT_METHOD_LABEL[paymentMethod] || paymentMethod}
        </span>
      )}
      {pickupDate && (
        <span className="chpill" style={{ background: "var(--cream-2)", color: "var(--espresso-3)" }}>
          <Icon name="calendar" size={11} /> รับ {formatPickupDateTH(pickupDate)}
        </span>
      )}
      {paymentVerified && !isTestSlip && (
        <span className="chpill" style={{ background: "var(--sage-light)", color: "var(--sage-dark)" }}>
          <Icon name="check" size={11} /> ยืนยันสลิปอัตโนมัติแล้ว
        </span>
      )}
      {paymentVerified && isTestSlip && (
        <span className="chpill" style={{ background: "var(--gold-light)", color: "var(--gold-dark)" }}>
          <Icon name="flask" size={11} /> สลิปทดสอบ (ไม่นับยอดขาย)
        </span>
      )}
    </div>
  );
}

function OrderItemLines({ items, note }) {
  return (
    <div style={{ margin: "8px 0", fontSize: 13 }}>
      {items.map((i, idx) => (
        <div key={idx} style={{ marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{i.name} x{i.qty}</span><span>฿{money(i.unitPrice * i.qty)}</span>
          </div>
          {i.options?.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--espresso-2)" }}>{i.options.map((o) => o.label).join(", ")}</div>
          )}
        </div>
      ))}
      {note && (
        <div style={{ marginTop: 6, background: "var(--gold-light)", border: "1px solid var(--gold)", borderRadius: 8, padding: "6px 9px", fontSize: 12 }}>
          <Icon name="message-2" size={12} style={{ marginRight: 4 }} />{note}
        </div>
      )}
    </div>
  );
}

function OrdersPanel({ uid, orders, recordSale, showToast, data, ingredientsById }) {
  const prevStatusRef = useRef({});
  const [justPaidIds, setJustPaidIds] = useState(new Set());

  useEffect(() => {
    const newlyPaid = [];
    for (const o of orders) {
      const prevStatus = prevStatusRef.current[o.id];
      if (prevStatus && prevStatus !== "paid" && o.status === "paid") newlyPaid.push(o.id);
      prevStatusRef.current[o.id] = o.status;
    }
    if (newlyPaid.length === 0) return;
    setJustPaidIds((s) => new Set([...s, ...newlyPaid]));
    const t = setTimeout(() => {
      setJustPaidIds((s) => {
        const next = new Set(s);
        newlyPaid.forEach((id) => next.delete(id));
        return next;
      });
    }, 1800);
    return () => clearTimeout(t);
  }, [orders]);

  function setStatus(order, status) {
    update(ref(db, `orders/${uid}/${order.id}`), { status }).catch((err) => showToast("อัปเดตไม่สำเร็จ: " + err.message));
  }

  function confirmPaid(order) {
    setStatus(order, "paid");
    for (const item of order.items) {
      const upcharge = (item.options || []).reduce((s, o) => s + (o.priceDelta || 0), 0);
      const itemMenu = data.menus.find((m) => m.id === item.menuId);
      const substitutions = itemMenu ? resolveIngredientAdjustmentsFromOptions(itemMenu, item.options, ingredientsById) : {};
      recordSale(item.menuId, item.qty, "online", { upcharge, substitutions, milkLabel: (item.options || []).map((o) => o.label).join(", ") || null });
    }
    showToast(`ยืนยันออเดอร์ ${order.customerName || order.customerPhone} แล้ว บันทึกยอดขายให้อัตโนมัติ`);
  }

  const pending = orders.filter((o) => o.status === "pending");
  const inProgress = orders.filter((o) => o.status === "paid" || o.status === "preparing");
  const history = orders.filter((o) => o.status === "ready" || o.status === "cancelled").slice(0, 20);

  return (
    <div>
      <SectionTitle icon="receipt" text={`ออเดอร์รอยืนยัน (${pending.length})`} />
      {pending.length === 0 ? <EmptyNote text="ยังไม่มีออเดอร์ใหม่" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 24 }}>
          {pending.map((o) => (
            <div key={o.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--espresso-2)" }}>
                <span>{o.customerName ? `${o.customerName} · ${o.customerPhone}` : o.customerPhone}</span>
                <StatusBadge status={o.status} />
              </div>
              <div style={{ fontSize: 11, color: "var(--espresso-2)", marginTop: 2 }}>
                {new Date(o.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
              </div>
              <OrderMeta paymentMethod={o.paymentMethod} pickupDate={o.pickupDate} paymentVerified={o.paymentVerified} paymentVerifiedBy={o.paymentVerifiedBy} />
              <OrderItemLines items={o.items} note={o.note} />
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 14, borderTop: "1px dashed var(--line)", paddingTop: 6, marginBottom: 10 }}>
                <span>รวม</span><span>฿{money(o.total)}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="cbtn cbtn-accent" style={{ flex: 1 }} onClick={() => confirmPaid(o)}>ยืนยันรับเงินแล้ว</button>
                <button className="cbtn cbtn-danger" onClick={() => setStatus(o, "cancelled")} title="ยกเลิกออเดอร์"><Icon name="x" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionTitle icon="cup" text={`กำลังทำ (${inProgress.length})`} />
      {inProgress.length === 0 ? <EmptyNote text="ไม่มีออเดอร์ที่กำลังทำอยู่" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 24 }}>
          {inProgress.map((o) => (
            <div
              key={o.id}
              style={{
                background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14,
                animation: justPaidIds.has(o.id) ? "paidFlash 1.8s ease" : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--espresso-2)" }}>
                <span>{o.customerName ? `${o.customerName} · ${o.customerPhone}` : o.customerPhone}</span>
                <StatusBadge status={o.status} />
              </div>
              <OrderMeta paymentMethod={o.paymentMethod} pickupDate={o.pickupDate} paymentVerified={o.paymentVerified} paymentVerifiedBy={o.paymentVerifiedBy} />
              <OrderItemLines items={o.items} note={o.note} />
              {o.status === "paid" && <button className="cbtn cbtn-accent" style={{ width: "100%" }} onClick={() => setStatus(o, "preparing")}>เริ่มชง</button>}
              {o.status === "preparing" && <button className="cbtn cbtn-accent" style={{ width: "100%" }} onClick={() => setStatus(o, "ready")}>พร้อมรับแล้ว</button>}
            </div>
          ))}
        </div>
      )}

      <SectionTitle icon="history" text="ประวัติล่าสุด" />
      {history.length === 0 ? <EmptyNote text="ยังไม่มีประวัติ" /> : (
        <div className="table-scroll">
          <table className="cdata">
            <thead><tr><th>เวลา</th><th>ลูกค้า</th><th>รายการ</th><th>วันรับ</th><th>ชำระ</th><th>ยอด</th><th>สถานะ</th></tr></thead>
            <tbody>
              {history.map((o) => (
                <tr key={o.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(o.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{o.customerName ? `${o.customerName} · ${o.customerPhone}` : o.customerPhone}</td>
                  <td>{o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatPickupDateTH(o.pickupDate)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{PAYMENT_METHOD_LABEL[o.paymentMethod] || "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>฿{money(o.total)}</td>
                  <td style={{ whiteSpace: "nowrap" }}><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MenusPanel({ data, ingredientsById, updateData, showToast }) {
  const [editing, setEditing] = useState(null);

  function newMenu() {
    const defaultPackaging = (data.settings.defaultPackagingLines || []).map((l) => ({ ...l }));
    setEditing({ id: null, name: "", priceStore: 0, priceDelivery: 0, ingredients: defaultPackaging, optionGroupIds: [], available: true, category: "กาแฟ", imageUrl: "" });
  }

  function saveMenu(menu) {
    menu = { ...menu, category: menu.category.trim() || "อื่นๆ" };
    updateData((next) => {
      if (menu.id) {
        const idx = next.menus.findIndex((m) => m.id === menu.id);
        next.menus[idx] = menu;
      } else {
        next.menus.push({ ...menu, id: genId("menu") });
      }
    });
    setEditing(null);
    showToast("บันทึกเมนูแล้ว");
  }

  function toggleAvailable(menu) {
    updateData((next) => {
      const m = next.menus.find((x) => x.id === menu.id);
      if (m) m.available = !m.available;
    });
  }

  function deleteMenu(id) {
    updateData((next) => { next.menus = next.menus.filter((m) => m.id !== id); });
    showToast("ลบเมนูแล้ว");
  }

  function moveMenu(id, direction) {
    updateData((next) => {
      const menu = next.menus.find((m) => m.id === id);
      if (!menu) return;
      const sameCat = next.menus.filter((m) => m.category === menu.category);
      const idx = sameCat.findIndex((m) => m.id === id);
      const swapWith = direction === "up" ? sameCat[idx - 1] : sameCat[idx + 1];
      if (!swapWith) return;
      const gA = next.menus.findIndex((m) => m.id === id);
      const gB = next.menus.findIndex((m) => m.id === swapWith.id);
      [next.menus[gA], next.menus[gB]] = [next.menus[gB], next.menus[gA]];
    });
  }

  function moveCategory(cat, direction, categories) {
    const order = categories.slice();
    const idx = order.indexOf(cat);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= order.length) return;
    [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
    updateData((next) => { next.settings.categoryOrder = order; });
  }

  const rawCategories = [...new Set(data.menus.map((m) => m.category).filter(Boolean))];
  const orderPref = data.settings.categoryOrder || [];
  const categories = [...orderPref.filter((c) => rawCategories.includes(c)), ...rawCategories.filter((c) => !orderPref.includes(c))];

  if (editing) {
    return <MenuEditor menu={editing} ingredients={data.ingredients} optionGroups={data.optionGroups} categories={categories} onSave={saveMenu} onCancel={() => setEditing(null)} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle icon="cup" text="เมนูทั้งหมด" />
        <button className="cbtn cbtn-accent" onClick={newMenu}><Icon name="plus" size={14} /> เพิ่มเมนู</button>
      </div>

      {categories.length > 1 && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 18 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--espresso-3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: ".03em" }}>ลำดับหมวดหมู่ที่แสดงหน้าลูกค้า</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {categories.map((cat, idx) => (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--cream-2)", borderRadius: 9, padding: "4px 4px 4px 10px" }}>
                <span style={{ fontSize: 12.5 }}>{cat}</span>
                <button className="cbtn" style={{ padding: "3px 6px" }} disabled={idx === 0} onClick={() => moveCategory(cat, "up", categories)} title="ย้ายขึ้น"><Icon name="chevron-up" size={12} /></button>
                <button className="cbtn" style={{ padding: "3px 6px" }} disabled={idx === categories.length - 1} onClick={() => moveCategory(cat, "down", categories)} title="ย้ายลง"><Icon name="chevron-down" size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {categories.map((cat) => {
        const menusInCat = data.menus.filter((m) => m.category === cat);
        return (
          <div key={cat} style={{ marginBottom: 22 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--espresso-3)", margin: "0 0 8px" }}>{cat}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {menusInCat.map((menu, idx) => {
                const { ingredientCost, breakdown } = calcRecipeCost(menu, ingredientsById, {});
                const totalCost = ingredientCost + data.settings.overheadPerCup;
                const marginStore = menu.priceStore > 0 ? ((menu.priceStore - totalCost) / menu.priceStore) * 100 : 0;
                return (
                  <div key={menu.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, fontFamily: "var(--f-mono)", opacity: menu.available ? 1 : 0.6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        {menu.imageUrl && <img src={menu.imageUrl} alt="" width={32} height={32} style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
                        <div>
                          <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16, color: "var(--espresso-5)" }}>{menu.name}</div>
                          <div style={{ fontSize: 10.5, color: "var(--espresso-2)", textTransform: "uppercase", letterSpacing: ".03em" }}>{menu.category}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button className="cbtn" style={{ padding: "4px 6px" }} disabled={idx === 0} onClick={() => moveMenu(menu.id, "up")} title="ย้ายขึ้น"><Icon name="chevron-up" size={12} /></button>
                        <button className="cbtn" style={{ padding: "4px 6px" }} disabled={idx === menusInCat.length - 1} onClick={() => moveMenu(menu.id, "down")} title="ย้ายลง"><Icon name="chevron-down" size={12} /></button>
                        <button className="cbtn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => toggleAvailable(menu)} title={menu.available ? "ปิดขายชั่วคราว" : "เปิดขาย"}>
                          {menu.available ? "เปิดขาย" : "หมด"}
                        </button>
                        <button className="cbtn cbtn-edit" style={{ padding: "4px 8px" }} onClick={() => setEditing(menu)} title="แก้ไขเมนู"><Icon name="edit" size={13} /></button>
                        <button className="cbtn cbtn-danger" style={{ padding: "4px 8px" }} onClick={() => deleteMenu(menu.id)} title="ลบเมนู"><Icon name="trash" size={13} /></button>
                      </div>
                    </div>
                    <div style={{ borderTop: "1px dashed var(--line)", margin: "8px 0", paddingTop: 8, fontSize: 11.5 }}>
                      {breakdown.map((b) => (
                        <div key={b.ingredientId} style={{ display: "flex", justifyContent: "space-between", color: "var(--espresso-3)" }}>
                          <span>{b.name} ×{b.qty}{UNITS[b.unit]}</span><span>฿{money(b.lineCost)}</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--espresso-3)" }}>
                        <span>ต้นทุนแฝง/แก้ว</span><span>฿{money(data.settings.overheadPerCup)}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
                      <span>ต้นทุนรวม/แก้ว</span><span>฿{money(totalCost)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 4 }}>
                      <span><ChannelPill channel="store" /> ฿{money(menu.priceStore)}</span>
                      <span style={{ color: marginStore >= 0 ? "var(--sage-dark)" : "var(--danger)" }}>{money(marginStore)}%</span>
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 2 }}>
                      <span><ChannelPill channel="delivery" /> ฿{money(menu.priceDelivery)}</span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      {data.settings.platforms.map((p) => {
                        const net = menu.priceDelivery * (1 - p.gpPercent / 100);
                        const margin = menu.priceDelivery > 0 ? ((net - totalCost) / menu.priceDelivery) * 100 : 0;
                        return (
                          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--espresso-3)" }}>
                            <span>{p.name} (GP {p.gpPercent}%)</span>
                            <span style={{ color: margin >= 0 ? "var(--sage-dark)" : "var(--danger)" }}>{money(margin)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MenuEditor({ menu, ingredients, optionGroups, categories, onSave, onCancel }) {
  const [form, setForm] = useState({
    ...menu, optionGroupIds: menu.optionGroupIds || [], available: menu.available ?? true,
    category: menu.category || "", imageUrl: menu.imageUrl || "",
  });
  const [imageError, setImageError] = useState(false);

  function toggleOptionGroup(groupId) {
    setForm((f) => {
      const has = f.optionGroupIds.includes(groupId);
      return { ...f, optionGroupIds: has ? f.optionGroupIds.filter((id) => id !== groupId) : [...f.optionGroupIds, groupId] };
    });
  }

  function addLine() {
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { ingredientId: ingredients[0]?.id, qty: 0 }] }));
  }
  function updateLine(idx, patch) {
    setForm((f) => {
      const ingredients2 = f.ingredients.map((l, i) => (i === idx ? { ...l, ...patch } : l));
      return { ...f, ingredients: ingredients2 };
    });
  }
  function removeLine(idx) {
    setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) }));
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <SectionTitle icon="cup" text={menu.id ? "แก้ไขเมนู" : "เมนูใหม่"} />
      <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ชื่อเมนู</label>
      <input className="cfield" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>หมวดหมู่ (โชว์เป็นแท็บในหน้าลูกค้า)</label>
          <input className="cfield" list="menu-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="เช่น กาแฟ, ชาผลไม้" />
          <datalist id="menu-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ลิงก์รูปเมนู (ถ้ามี)</label>
          <input className="cfield" value={form.imageUrl} onChange={(e) => { setForm({ ...form, imageUrl: e.target.value }); setImageError(false); }} placeholder="https://..." />
          <p style={{ fontSize: 10.5, color: "var(--espresso-2)", margin: "3px 0 0", lineHeight: 1.5 }}>
            ต้องเป็นลิงก์รูปโดยตรง (ลงท้าย .jpg/.png ฯลฯ) เช่นจาก imgur.com — ลิงก์แชร์จาก Google Photos ใช้ไม่ได้
          </p>
        </div>
      </div>
      {form.imageUrl && (
        <div style={{ marginBottom: 14 }}>
          <img
            src={form.imageUrl} alt="ตัวอย่างรูป"
            onLoad={() => setImageError(false)} onError={() => setImageError(true)}
            style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)" }}
          />
          {imageError && <p style={{ fontSize: 11, color: "var(--danger)", margin: "4px 0 0" }}>โหลดรูปไม่ขึ้น — ตรวจว่าเป็นลิงก์รูปโดยตรงหรือยัง</p>}
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 14 }}>
        <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} />
        เปิดขายเมนูนี้ (ปิดไว้ถ้าวัตถุดิบหมด ลูกค้าจะสั่งไม่ได้ชั่วคราว)
      </label>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ราคาขายหน้าร้าน (บาท)</label>
          <input className="cfield" type="number" value={form.priceStore} onChange={(e) => setForm({ ...form, priceStore: Number(e.target.value) })} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ราคาขายเดลิเวอรี่ (บาท)</label>
          <input className="cfield" type="number" value={form.priceDelivery} onChange={(e) => setForm({ ...form, priceDelivery: Number(e.target.value) })} />
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--espresso-2)", marginBottom: 6 }}>
        ส่วนผสม (วัตถุดิบที่ตั้ง "กลุ่มทางเลือก" ไว้ เช่น นม/เมล็ดกาแฟ จะรวมเป็นตัวเลือกเดียวในรายการนี้ — ระบบจะตัดสต็อกตามที่ลูกค้าเลือกจริงในตัวเลือกเสริม)
      </p>
      {form.ingredients.map((line, idx) => (
        <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <select className="cfield" value={line.ingredientId} onChange={(e) => updateLine(idx, { ingredientId: e.target.value })}>
            {ingredientPickerOptions(ingredients, line.ingredientId).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input className="cfield" style={{ width: 80 }} type="number" value={line.qty} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} />
          <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removeLine(idx)} title="ลบส่วนผสมนี้"><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="cbtn" onClick={addLine}><Icon name="plus" size={13} /> เพิ่มส่วนผสม</button>

      <p style={{ fontSize: 12, color: "var(--espresso-2)", margin: "16px 0 6px" }}>ตัวเลือกเสริมที่ลูกค้าจะเห็นตอนสั่ง (ตั้งค่ากลุ่มตัวเลือกได้ในแท็บ "ตัวเลือกเสริม")</p>
      {optionGroups.length === 0 ? (
        <EmptyNote text="ยังไม่มีกลุ่มตัวเลือกให้เลือก" />
      ) : (
        optionGroups.map((g) => (
          <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 4 }}>
            <input type="checkbox" checked={form.optionGroupIds.includes(g.id)} onChange={() => toggleOptionGroup(g.id)} />
            {g.name}{g.required ? " (บังคับเลือก)" : ""}
          </label>
        ))
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="cbtn cbtn-accent" onClick={() => onSave(form)}>บันทึกเมนู</button>
        <button className="cbtn" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

function PromotionsPanel({ data, updateData, showToast }) {
  const [editing, setEditing] = useState(null);

  const menusById = useMemo(() => {
    const m = {};
    for (const x of data.menus) m[x.id] = x;
    return m;
  }, [data.menus]);

  function newPromo() {
    setEditing({ id: null, name: "", type: "single", menuIds: [], discountType: "percent", discountValue: 10, minQty: 2, chooseCount: 2, active: true, startAt: null, endAt: null });
  }

  function savePromo(promo) {
    if (promo.menuIds.length === 0) { showToast("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; }
    if (promo.type === "bundle" && promo.menuIds.length < 2) { showToast("โปรจับคู่คอมโบต้องเลือกอย่างน้อย 2 เมนู"); return; }
    if (promo.type === "choice" && promo.menuIds.length < promo.chooseCount) { showToast("จำนวนเมนูในกลุ่มต้องมากกว่าหรือเท่ากับจำนวนที่ให้เลือก"); return; }
    updateData((next) => {
      if (!next.promotions) next.promotions = [];
      if (promo.id) {
        const idx = next.promotions.findIndex((p) => p.id === promo.id);
        next.promotions[idx] = promo;
      } else {
        next.promotions.push({ ...promo, id: genId("promo") });
      }
    });
    setEditing(null);
    showToast("บันทึกโปรโมชั่นแล้ว");
  }

  function toggleActive(promo) {
    updateData((next) => {
      const p = next.promotions.find((x) => x.id === promo.id);
      if (p) p.active = !p.active;
    });
  }

  function deletePromo(id) {
    updateData((next) => { next.promotions = next.promotions.filter((p) => p.id !== id); });
    showToast("ลบโปรโมชั่นแล้ว");
  }

  if (editing) {
    return <PromoEditor promo={editing} menus={data.menus} onSave={savePromo} onCancel={() => setEditing(null)} />;
  }

  const promotions = data.promotions || [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle icon="discount" text="โปรโมชั่น" />
        <button className="cbtn cbtn-accent" onClick={newPromo}><Icon name="plus" size={14} /> เพิ่มโปรโมชั่น</button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--espresso-2)", margin: "-6px 0 14px" }}>
        โปรโมชั่นที่เปิดใช้งานจะแสดงในหมวด "ดีลพิเศษ" อันดับแรกสุดของหน้าลูกค้า พร้อมราคาปกติขีดฆ่าและราคาโปรสีแดง ทำได้ทั้งลดเมนูเดียว จับคู่คอมโบราคาคงที่ ซื้อครบจำนวนลดเพิ่ม หรือให้ลูกค้าเลือกเองจากกลุ่มเมนู
      </p>
      {promotions.length === 0 ? <EmptyNote text='ยังไม่มีโปรโมชั่น กด "เพิ่มโปรโมชั่น" เพื่อเริ่ม' /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {promotions.map((promo) => {
            const type = promo.type || "single";
            const promoWin = promoActiveWindow(promo);
            const typeLabel = type === "bundle" ? `เซ็ตคอมโบ ${promo.menuIds.length} รายการ`
              : type === "qty" ? `ซื้อครบ ${promo.minQty} ชิ้น`
              : type === "choice" ? `เลือก ${promo.chooseCount} จาก ${promo.menuIds.length} รายการ`
              : "โปรเมนูเดี่ยว";
            let priceNode = null;
            if (type === "bundle" || type === "single") {
              const { items, originalTotal, promoTotal } = computePromoPricing(promo, menusById);
              priceNode = (
                <>
                  <div style={{ borderTop: "1px dashed var(--line)", margin: "8px 0", paddingTop: 8, fontSize: 12 }}>
                    {items.map((m) => (
                      <div key={m.id} style={{ display: "flex", justifyContent: "space-between", color: "var(--espresso-3)" }}>
                        <span>{m.name}</span><span>฿{money(m.priceStore)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 13, color: "var(--espresso-2)", textDecoration: "line-through" }}>฿{money(originalTotal)}</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--danger)" }}>฿{money(promoTotal)}</span>
                  </div>
                </>
              );
            } else if (type === "qty") {
              const menu = menusById[promo.menuIds[0]];
              const setPrice = qtyPromoSetPrice(promo, menu);
              priceNode = menu ? (
                <div style={{ marginTop: 6, fontSize: 12.5 }}>
                  <div style={{ color: "var(--espresso-3)" }}>{menu.name} · ฿{money(menu.priceStore)}/ชิ้น</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                    <span style={{ color: "var(--espresso-2)" }}>ปกติ ฿{money(menu.priceStore * promo.minQty)}</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--danger)" }}>ชุดละ ฿{money(setPrice)}</span>
                  </div>
                </div>
              ) : null;
            } else if (type === "choice") {
              const pool = promo.menuIds.map((id) => menusById[id]).filter(Boolean);
              priceNode = (
                <div style={{ marginTop: 6, fontSize: 12.5 }}>
                  <div style={{ color: "var(--espresso-3)" }}>{pool.map((m) => m.name).join(", ")}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "var(--danger)", marginTop: 4 }}>
                    {promo.discountType === "percent" ? `ลด ${promo.discountValue}% จากรายการที่เลือก` : `ราคาชุดละ ฿${money(promo.discountValue)}`}
                  </div>
                </div>
              );
            }
            return (
              <div key={promo.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, opacity: promo.active === false || promoWin === "expired" ? 0.55 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15, color: "var(--espresso-5)" }}>
                      {promo.name || (promo.menuIds.map((id) => menusById[id]?.name).filter(Boolean).join(" + ") || "โปรโมชั่น")}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--espresso-2)", marginTop: 2 }}>
                      {typeLabel} · {type === "qty" || type === "single" || type === "bundle" ? (promo.discountType === "percent" ? `ลด ${promo.discountValue}%` : `ราคาพิเศษ ฿${money(promo.discountValue)}`) : ""}
                    </div>
                    {(promo.startAt || promo.endAt) && (
                      <div style={{ fontSize: 10.5, marginTop: 3, color: promoWin === "expired" ? "var(--danger)" : promoWin === "upcoming" ? "var(--gold-dark)" : "var(--sage-dark)" }}>
                        <Icon name="clock" size={11} style={{ marginRight: 3 }} />
                        {promoWin === "upcoming" ? "เริ่ม " : promoWin === "expired" ? "หมดเขต " : ""}
                        {promo.startAt && promo.endAt ? `${formatPromoDateTime(promo.startAt)} - ${formatPromoDateTime(promo.endAt)}`
                          : promo.startAt ? `เริ่ม ${formatPromoDateTime(promo.startAt)}`
                          : `ถึง ${formatPromoDateTime(promo.endAt)}`}
                        {promoWin === "live" && (promo.startAt || promo.endAt) ? " (กำลังใช้งาน)" : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button className="cbtn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => toggleActive(promo)}>{promo.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"}</button>
                    <button className="cbtn cbtn-edit" style={{ padding: "4px 8px" }} onClick={() => setEditing(promo)} title="แก้ไขโปรโมชั่น"><Icon name="edit" size={13} /></button>
                    <button className="cbtn cbtn-danger" style={{ padding: "4px 8px" }} onClick={() => deletePromo(promo.id)} title="ลบโปรโมชั่น"><Icon name="trash" size={13} /></button>
                  </div>
                </div>
                {priceNode}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PROMO_TYPES = [
  { id: "single", label: "ลดราคาเมนูเดียว" },
  { id: "bundle", label: "จับคู่คอมโบ (ราคาคงที่)" },
  { id: "qty", label: "ซื้อครบจำนวน ลดเพิ่ม" },
  { id: "choice", label: "ให้ลูกค้าเลือกเอง" },
];

function dtLocalValue(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PromoEditor({ promo, menus, onSave, onCancel }) {
  const [form, setForm] = useState({
    type: "single", minQty: 2, chooseCount: 2, startAt: null, endAt: null,
    ...promo, menuIds: promo.menuIds || [],
  });
  const menusById = useMemo(() => {
    const m = {};
    for (const x of menus) m[x.id] = x;
    return m;
  }, [menus]);

  function toggleMenu(id) {
    setForm((f) => {
      if (f.type === "single" || f.type === "qty") return { ...f, menuIds: [id] };
      const has = f.menuIds.includes(id);
      return { ...f, menuIds: has ? f.menuIds.filter((x) => x !== id) : [...f.menuIds, id] };
    });
  }

  function setType(type) {
    setForm((f) => ({ ...f, type, menuIds: type === "single" || type === "qty" ? f.menuIds.slice(0, 1) : f.menuIds }));
  }

  const { items, originalTotal, promoTotal } = computePromoPricing(form, menusById);
  const qtyMenu = form.type === "qty" ? menusById[form.menuIds[0]] : null;
  const qtySetPrice = qtyMenu ? qtyPromoSetPrice(form, qtyMenu) : 0;

  return (
    <div style={{ maxWidth: 480 }}>
      <SectionTitle icon="discount" text={promo.id ? "แก้ไขโปรโมชั่น" : "โปรโมชั่นใหม่"} />

      <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ประเภทโปรโมชั่น</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {PROMO_TYPES.map((t) => (
          <button
            key={t.id}
            className="cbtn"
            style={{
              fontSize: 12, padding: "7px 10px",
              background: form.type === t.id ? "var(--sage-light)" : undefined,
              borderColor: form.type === t.id ? "var(--sage)" : undefined,
              color: form.type === t.id ? "var(--sage-dark)" : undefined,
              fontWeight: form.type === t.id ? 600 : 500,
            }}
            onClick={() => setType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ชื่อโปรโมชั่น (ถ้าเว้นว่างจะใช้ชื่อเมนูต่อกัน)</label>
      <TextField className="cfield" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="เช่น คู่หูสุดคุ้ม" style={{ marginBottom: 12 }} />

      <p style={{ fontSize: 12, color: "var(--espresso-2)", margin: "0 0 6px" }}>
        {form.type === "single" && "เลือกเมนูที่ต้องการลดราคา"}
        {form.type === "bundle" && "เลือกเมนูทั้งหมดที่จะรวมเป็นเซ็ตคอมโบ (อย่างน้อย 2 รายการ)"}
        {form.type === "qty" && "เลือกเมนูที่จะให้ซื้อครบจำนวนแล้วลดราคา"}
        {form.type === "choice" && "เลือกกลุ่มเมนูที่ให้ลูกค้าเลือกเอง (ต้องมีมากกว่าหรือเท่ากับจำนวนที่ให้เลือก)"}
      </p>
      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10, padding: 8, marginBottom: 14 }}>
        {menus.map((m) => (
          <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 4px" }}>
            <input
              type={form.type === "single" || form.type === "qty" ? "radio" : "checkbox"}
              name="promo-menu"
              checked={form.menuIds.includes(m.id)}
              onChange={() => toggleMenu(m.id)}
            />
            {m.name} <span style={{ color: "var(--espresso-2)", fontSize: 11.5 }}>฿{money(m.priceStore)}</span>
          </label>
        ))}
      </div>

      {form.type === "qty" && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ซื้อครบกี่ชิ้นต่อเซ็ต</label>
          <input className="cfield" type="number" min={2} value={form.minQty} onChange={(e) => setForm({ ...form, minQty: Math.max(2, Number(e.target.value)) })} style={{ maxWidth: 120 }} />
        </div>
      )}

      {form.type === "choice" && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ให้ลูกค้าเลือกกี่รายการจากกลุ่มนี้</label>
          <input className="cfield" type="number" min={1} value={form.chooseCount} onChange={(e) => setForm({ ...form, chooseCount: Math.max(1, Number(e.target.value)) })} style={{ maxWidth: 120 }} />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>รูปแบบส่วนลด</label>
          <select className="cfield" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
            <option value="percent">ลดเป็น % จากราคารวม</option>
            <option value="fixed">กำหนดราคาขายตายตัว</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>{form.discountType === "percent" ? "เปอร์เซ็นต์ส่วนลด (%)" : form.type === "qty" ? "ราคาต่อเซ็ต (บาท)" : "ราคาขาย (บาท)"}</label>
          <input className="cfield" type="number" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })} />
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--espresso-2)", margin: "14px 0 6px" }}>กำหนดช่วงเวลาโปรโมชั่น (ไม่บังคับ — เว้นว่างไว้ถ้าไม่ต้องการจำกัดเวลา)</p>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>เริ่ม</label>
          <input
            className="cfield" type="datetime-local"
            value={dtLocalValue(form.startAt)}
            onChange={(e) => setForm({ ...form, startAt: e.target.value ? new Date(e.target.value).getTime() : null })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>สิ้นสุด</label>
          <input
            className="cfield" type="datetime-local"
            value={dtLocalValue(form.endAt)}
            onChange={(e) => setForm({ ...form, endAt: e.target.value ? new Date(e.target.value).getTime() : null })}
          />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "10px 0 14px" }}>
        <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        เปิดใช้งานโปรโมชั่นนี้
      </label>

      {(form.type === "single" || form.type === "bundle") && form.menuIds.length > 0 && (
        <div style={{ background: "var(--sage-light)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, color: "var(--espresso-3)", marginBottom: 4 }}>ตัวอย่างราคาที่ลูกค้าจะเห็น</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--espresso-2)", textDecoration: "line-through" }}>฿{money(originalTotal)}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>฿{money(promoTotal)}</span>
          </div>
        </div>
      )}

      {form.type === "qty" && qtyMenu && (
        <div style={{ background: "var(--sage-light)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, color: "var(--espresso-3)", marginBottom: 4 }}>ตัวอย่างราคาที่ลูกค้าจะเห็น (ซื้อครบ {form.minQty} ชิ้น)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--espresso-2)", textDecoration: "line-through" }}>฿{money(qtyMenu.priceStore * form.minQty)}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>฿{money(qtySetPrice)}</span>
          </div>
        </div>
      )}

      {form.type === "choice" && (
        <p style={{ fontSize: 11.5, color: "var(--espresso-2)", margin: "0 0 16px" }}>
          ลูกค้าจะเลือกเอง {form.chooseCount} รายการจากกลุ่มนี้ตอนสั่งซื้อ ราคาจะคำนวณจาก{form.discountType === "percent" ? `ส่วนลด ${form.discountValue}% ของราคารวมที่เลือก` : `ราคาชุดคงที่ ฿${money(form.discountValue)}`}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="cbtn cbtn-accent" onClick={() => onSave(form)}>บันทึกโปรโมชั่น</button>
        <button className="cbtn" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

function IngredientsPanel({ data, updateData, showToast }) {
  const [restocking, setRestocking] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const blankIng = { name: "", category: "coffee", unit: "g", costPerUnit: 0, stockQty: 0, lowStockThreshold: 100, altGroup: "", altUpcharge: 0 };
  const [newIng, setNewIng] = useState(blankIng);

  function doRestock(id, addQty, totalPaid) {
    updateData((next) => {
      const ing = next.ingredients.find((i) => i.id === id);
      if (!ing) return;
      ing.stockQty = round4(ing.stockQty + addQty);
      if (addQty > 0 && totalPaid > 0) ing.costPerUnit = round4(totalPaid / addQty);
      next.purchases.push({ id: genId("purchase"), timestamp: new Date().toISOString(), ingredientId: id, qtyAdded: addQty, totalCost: totalPaid });
    });
    setRestocking(null);
    showToast("เติมสต็อกแล้ว");
  }

  function addIngredient() {
    if (!newIng.name.trim()) return;
    updateData((next) => { next.ingredients.push({ ...newIng, altGroup: newIng.altGroup || null, id: genId("ing") }); });
    setAdding(false);
    setNewIng(blankIng);
    showToast("เพิ่มวัตถุดิบแล้ว");
  }

  function saveEdit(ing) {
    updateData((next) => {
      const idx = next.ingredients.findIndex((i) => i.id === ing.id);
      next.ingredients[idx] = { ...ing, altGroup: ing.altGroup || null };
    });
    setEditingId(null);
    showToast("บันทึกแล้ว");
  }

  function deleteIngredient(id) {
    updateData((next) => { next.ingredients = next.ingredients.filter((i) => i.id !== id); });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle icon="box-multiple" text="วัตถุดิบ & สต็อก" />
        <button className="cbtn cbtn-accent" onClick={() => setAdding(!adding)}><Icon name="plus" size={14} /> วัตถุดิบใหม่</button>
      </div>

      {adding && <IngredientForm value={newIng} onChange={setNewIng} onSubmit={addIngredient} submitLabel="บันทึก" />}

      {CATEGORIES.map((cat) => {
        const items = data.ingredients.filter((i) => i.category === cat.id);
        if (items.length === 0) return null;
        return (
          <div key={cat.id} style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--espresso-3)", margin: "0 0 6px" }}>{cat.label}</p>
            <div className="table-scroll">
              <table className="cdata">
                <thead><tr><th>รายการ</th><th>สต็อก</th><th>ต้นทุน/หน่วย</th><th>กลุ่มทางเลือก</th><th></th></tr></thead>
                <tbody>
                  {items.map((ing) => (
                    <tr key={ing.id}>
                      <td>{ing.name}</td>
                      <td style={{ whiteSpace: "nowrap", color: ing.stockQty <= ing.lowStockThreshold ? "var(--danger)" : "var(--espresso-4)", fontWeight: ing.stockQty <= ing.lowStockThreshold ? 600 : 400 }}>
                        {ing.stockQty} {UNITS[ing.unit]}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>฿{money(ing.costPerUnit)}/{UNITS[ing.unit]}</td>
                      <td>{ing.altGroup ? `${ing.altGroup}${ing.altUpcharge ? ` (+฿${ing.altUpcharge})` : ""}` : "—"}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="cbtn" style={{ padding: "4px 8px", marginRight: 4 }} onClick={() => setRestocking(ing.id)}>เติมสต็อก</button>
                        <button className="cbtn cbtn-edit" style={{ padding: "4px 8px", marginRight: 4 }} onClick={() => setEditingId(ing.id)} title="แก้ไขวัตถุดิบ"><Icon name="edit" size={12} /></button>
                        <button className="cbtn cbtn-danger" style={{ padding: "4px 8px" }} onClick={() => deleteIngredient(ing.id)} title="ลบวัตถุดิบ"><Icon name="trash" size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <DefaultPackagingSection data={data} updateData={updateData} />

      {restocking && (
        <RestockModal ingredient={data.ingredients.find((i) => i.id === restocking)} onClose={() => setRestocking(null)} onConfirm={doRestock} />
      )}
      {editingId && (
        <EditIngredientModal ingredient={data.ingredients.find((i) => i.id === editingId)} onClose={() => setEditingId(null)} onSave={saveEdit} />
      )}
    </div>
  );
}

function DefaultPackagingSection({ data, updateData }) {
  const packagingIngredients = data.ingredients.filter((i) => i.category === "packaging");
  const lines = data.settings.defaultPackagingLines || [];

  function addLine() {
    updateData((next) => {
      if (!next.settings.defaultPackagingLines) next.settings.defaultPackagingLines = [];
      const firstPkg = next.ingredients.find((i) => i.category === "packaging");
      next.settings.defaultPackagingLines.push({ ingredientId: firstPkg ? firstPkg.id : "", qty: 1 });
    });
  }
  function updateLine(idx, patch) {
    updateData((next) => {
      next.settings.defaultPackagingLines[idx] = { ...next.settings.defaultPackagingLines[idx], ...patch };
    });
  }
  function removeLine(idx) {
    updateData((next) => { next.settings.defaultPackagingLines.splice(idx, 1); });
  }

  if (packagingIngredients.length === 0) return null;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginTop: 8 }}>
      <SectionTitle icon="box" text="บรรจุภัณฑ์เริ่มต้นสำหรับเมนูใหม่" />
      <p style={{ fontSize: 11.5, color: "var(--espresso-2)", margin: "-6px 0 12px" }}>
        ตั้งไว้ครั้งเดียว ระบบจะใส่รายการเหล่านี้ให้อัตโนมัติทุกครั้งที่กด "เพิ่มเมนู" ใหม่ (แก้ไขเพิ่ม/ลบต่อเมนูได้ตามปกติภายหลัง)
      </p>
      {lines.map((line, idx) => (
        <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <select className="cfield" value={line.ingredientId} onChange={(e) => updateLine(idx, { ingredientId: e.target.value })}>
            {packagingIngredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input className="cfield" style={{ width: 80 }} type="number" value={line.qty} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} />
          <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removeLine(idx)} title="ลบรายการนี้"><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="cbtn" onClick={addLine}><Icon name="plus" size={13} /> เพิ่มบรรจุภัณฑ์เริ่มต้น</button>
    </div>
  );
}

function IngredientForm({ value, onChange, onSubmit, submitLabel }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>ชื่อ</label><input className="cfield" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} /></div>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>หมวด</label>
        <select className="cfield" value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>หน่วย</label>
        <select className="cfield" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value })}>
          {Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>ต้นทุน/หน่วย</label><input className="cfield" type="number" value={value.costPerUnit} onChange={(e) => onChange({ ...value, costPerUnit: Number(e.target.value) })} style={{ width: 90 }} /></div>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>สต็อก</label><input className="cfield" type="number" value={value.stockQty} onChange={(e) => onChange({ ...value, stockQty: Number(e.target.value) })} style={{ width: 90 }} /></div>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>แจ้งเตือนต่ำกว่า</label><input className="cfield" type="number" value={value.lowStockThreshold} onChange={(e) => onChange({ ...value, lowStockThreshold: Number(e.target.value) })} style={{ width: 90 }} /></div>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>กลุ่มทางเลือก (เช่น milk)</label><input className="cfield" value={value.altGroup || ""} onChange={(e) => onChange({ ...value, altGroup: e.target.value })} style={{ width: 100 }} placeholder="ไม่มี" /></div>
      <div><label style={{ fontSize: 11, color: "var(--espresso-2)" }}>ส่วนต่างราคา (บาท)</label><input className="cfield" type="number" value={value.altUpcharge} onChange={(e) => onChange({ ...value, altUpcharge: Number(e.target.value) })} style={{ width: 90 }} /></div>
      <button className="cbtn cbtn-accent" onClick={onSubmit}>{submitLabel}</button>
    </div>
  );
}

function EditIngredientModal({ ingredient, onClose, onSave }) {
  const [form, setForm] = useState(ingredient);
  if (!ingredient) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,29,20,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--surface)", borderRadius: 14, padding: 20, width: 340 }}>
        <p style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, margin: "0 0 12px" }}>แก้ไข: {ingredient.name}</p>
        <IngredientForm value={form} onChange={setForm} onSubmit={() => onSave(form)} submitLabel="บันทึกการแก้ไข" />
        <button className="cbtn" onClick={onClose}>ปิด</button>
      </div>
    </div>
  );
}

function RestockModal({ ingredient, onClose, onConfirm }) {
  const [qty, setQty] = useState(0);
  const [total, setTotal] = useState(0);
  if (!ingredient) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,29,20,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--surface)", borderRadius: 14, padding: 20, width: 300 }}>
        <p style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, margin: "0 0 12px" }}>เติมสต็อก: {ingredient.name}</p>
        <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ปริมาณที่ซื้อ ({UNITS[ingredient.unit]})</label>
        <input className="cfield" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ marginBottom: 10 }} />
        <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ราคาที่จ่ายทั้งหมด (บาท)</label>
        <input className="cfield" type="number" value={total} onChange={(e) => setTotal(Number(e.target.value))} style={{ marginBottom: 14 }} />
        <p style={{ fontSize: 11.5, color: "var(--espresso-2)" }}>ต้นทุนต่อหน่วยใหม่จะถูกคำนวณอัตโนมัติ = ราคารวม ÷ ปริมาณ</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cbtn cbtn-accent" onClick={() => onConfirm(ingredient.id, qty, total)}>ยืนยัน</button>
          <button className="cbtn" onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

function ReportsPanel({ data }) {
  const [range, setRange] = useState("today");

  const filtered = useMemo(() => {
    const now = new Date();
    return data.sales.filter((s) => {
      const d = new Date(s.timestamp);
      if (range === "today") return todayStr(d) === todayStr(now);
      if (range === "week") { const diff = (now - d) / 86400000; return diff <= 7; }
      if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return true;
    });
  }, [data.sales, range]);

  const revenue = filtered.reduce((a, s) => a + s.netRevenue, 0);
  const cost = filtered.reduce((a, s) => a + s.totalCost, 0);
  const profit = revenue - cost;
  const gpTotal = filtered.reduce((a, s) => a + s.gpAmount, 0);

  const byChannel = { store: { revenue: 0, profit: 0, cups: 0 }, delivery: { revenue: 0, profit: 0, cups: 0 }, online: { revenue: 0, profit: 0, cups: 0 } };
  const byPlatform = {};
  for (const s of filtered) {
    byChannel[s.channel].revenue += s.netRevenue;
    byChannel[s.channel].profit += s.profit;
    byChannel[s.channel].cups += s.qty;
    if (s.channel === "delivery" && s.platformName) {
      if (!byPlatform[s.platformName]) byPlatform[s.platformName] = { revenue: 0, profit: 0, cups: 0 };
      byPlatform[s.platformName].revenue += s.netRevenue;
      byPlatform[s.platformName].profit += s.profit;
      byPlatform[s.platformName].cups += s.qty;
    }
  }

  const byDay = {};
  for (const s of filtered) {
    const d = s.timestamp.slice(0, 10);
    if (!byDay[d]) byDay[d] = { revenue: 0, cost: 0 };
    byDay[d].revenue += s.netRevenue;
    byDay[d].cost += s.totalCost;
  }
  const days = Object.keys(byDay).sort();
  const maxVal = Math.max(1, ...days.map((d) => byDay[d].revenue));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["today", "วันนี้"], ["week", "7 วันล่าสุด"], ["month", "เดือนนี้"], ["all", "ทั้งหมด"]].map(([k, label]) => (
          <button key={k} className="cbtn" style={{ background: range === k ? "var(--sage-light)" : undefined, borderColor: range === k ? "var(--sage)" : undefined }} onClick={() => setRange(k)}>{label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <MetricCard label="รายได้สุทธิ" value={"฿" + money(revenue)} sub={"หัก GP แล้ว ฿" + money(gpTotal)} />
        <MetricCard label="ต้นทุนรวม" value={"฿" + money(cost)} />
        <MetricCard label="กำไรสุทธิ" value={"฿" + money(profit)} accent={profit >= 0 ? "var(--sage-dark)" : "var(--danger)"} />
        <MetricCard label="จำนวนแก้วที่ขาย" value={filtered.reduce((a, s) => a + s.qty, 0)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div style={{ background: "var(--sage-light)", borderRadius: 12, padding: 14 }}>
          <ChannelPill channel="store" />
          <p style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 600, fontFamily: "var(--f-display)" }}>฿{money(byChannel.store.revenue)}</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--espresso-3)" }}>กำไร ฿{money(byChannel.store.profit)} · {byChannel.store.cups} แก้ว</p>
        </div>
        <div style={{ background: "var(--gold-light)", borderRadius: 12, padding: 14 }}>
          <ChannelPill channel="delivery" />
          <p style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 600, fontFamily: "var(--f-display)" }}>฿{money(byChannel.delivery.revenue)}</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--espresso-3)" }}>กำไร ฿{money(byChannel.delivery.profit)} · {byChannel.delivery.cups} แก้ว</p>
        </div>
        <div style={{ background: "var(--cream-2)", borderRadius: 12, padding: 14 }}>
          <ChannelPill channel="online" />
          <p style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 600, fontFamily: "var(--f-display)" }}>฿{money(byChannel.online.revenue)}</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--espresso-3)" }}>กำไร ฿{money(byChannel.online.profit)} · {byChannel.online.cups} แก้ว</p>
        </div>
      </div>

      {Object.keys(byPlatform).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle icon="truck-delivery" text="แยกตามแพลตฟอร์มเดลิเวอรี่" />
          <div className="table-scroll">
            <table className="cdata">
              <thead><tr><th>แพลตฟอร์ม</th><th>แก้ว</th><th>รายได้สุทธิ</th><th>กำไร</th></tr></thead>
              <tbody>
                {Object.entries(byPlatform).map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td><td>{v.cups}</td><td style={{ whiteSpace: "nowrap" }}>฿{money(v.revenue)}</td>
                    <td style={{ whiteSpace: "nowrap", color: v.profit >= 0 ? "var(--sage-dark)" : "var(--danger)" }}>฿{money(v.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {days.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle icon="chart-bar" text="รายได้สุทธิต่อวัน" />
          <div style={{ display: "flex", alignItems: "end", gap: 6, height: 120, borderBottom: "1px solid var(--line)", padding: "0 4px" }}>
            {days.map((d) => (
              <div key={d} title={d + ": ฿" + money(byDay[d].revenue)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", maxWidth: 26, background: "var(--sage)", borderRadius: "4px 4px 0 0", height: (byDay[d].revenue / maxVal) * 100 }}></div>
                <span style={{ fontSize: 9.5, color: "var(--espresso-2)", writingMode: "vertical-rl" }}>{d.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SectionTitle icon="list" text="ประวัติการขาย" />
      {filtered.length === 0 ? <EmptyNote text="ไม่มีข้อมูลการขายในช่วงนี้" /> : (
        <div className="table-scroll">
          <table className="cdata">
            <thead><tr><th>เวลา</th><th>เมนู</th><th>ช่องทาง</th><th>จำนวน</th><th>รายได้สุทธิ</th><th>ต้นทุน</th><th>กำไร</th></tr></thead>
            <tbody>
              {filtered.slice().reverse().slice(0, 50).map((s) => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(s.timestamp).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{s.menuName}{s.milkNote ? ` (${s.milkNote})` : ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}><ChannelPill channel={s.channel} />{s.platformName ? <span style={{ fontSize: 11, color: "var(--espresso-2)" }}> {s.platformName}</span> : null}</td>
                  <td>{s.qty}</td>
                  <td style={{ whiteSpace: "nowrap" }}>฿{money(s.netRevenue)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>฿{money(s.totalCost)}</td>
                  <td style={{ whiteSpace: "nowrap", color: s.profit >= 0 ? "var(--sage-dark)" : "var(--danger)" }}>฿{money(s.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OptionGroupsPanel({ data, updateData, showToast }) {
  function addGroup() {
    updateData((next) => {
      next.optionGroups.push({ id: genId("opt"), name: "ตัวเลือกใหม่", required: false, choices: [] });
    });
  }
  function removeGroup(groupId) {
    updateData((next) => {
      next.optionGroups = next.optionGroups.filter((g) => g.id !== groupId);
      for (const m of next.menus) m.optionGroupIds = (m.optionGroupIds || []).filter((id) => id !== groupId);
    });
  }
  function patchGroup(groupId, patch) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      if (g) Object.assign(g, patch);
    });
  }
  function addChoice(groupId) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      if (g) g.choices.push({ id: genId("choice"), label: "ตัวเลือกใหม่", note: "", priceDelta: 0, ingredientId: null, qtyPercent: 100, isDefault: false });
    });
  }
  function patchChoice(groupId, choiceId, patch) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      const c = g?.choices.find((x) => x.id === choiceId);
      if (c) Object.assign(c, patch);
    });
  }
  function removeChoice(groupId, choiceId) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      if (g) g.choices = g.choices.filter((c) => c.id !== choiceId);
    });
  }
  function setDefaultChoice(groupId, choiceId) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      if (!g) return;
      for (const c of g.choices) c.isDefault = c.id === choiceId ? !c.isDefault : false;
    });
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <SectionTitle icon="list-details" text="ตัวเลือกเสริมสำหรับลูกค้า (เช่น เมล็ดกาแฟ, ความหวาน, นม)" />
        <button className="cbtn cbtn-accent" onClick={addGroup}><Icon name="plus" size={14} /> เพิ่มกลุ่มตัวเลือก</button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--espresso-2)", margin: "0 0 14px" }}>
        ตั้งค่าที่นี่ครั้งเดียว แล้วไปติ๊กเลือกว่าเมนูไหนใช้กลุ่มตัวเลือกไหนได้ในแท็บ "เมนู & สูตร" ตอนแก้ไขเมนู
        ถ้าตัวเลือกไหนแทนวัตถุดิบ (เช่น เลือกเมล็ด/นมคนละแบบ) ให้เลือก "วัตถุดิบที่ใช้แทน" ระบบจะตัดสต็อกตามที่ลูกค้าเลือกจริงแทนสูตรตั้งต้น
        (วัตถุดิบต้นทางและตัวเลือกต้องตั้ง "กลุ่มทางเลือก" ให้ตรงกันในแท็บวัตถุดิบก่อน)
        เลือกวัตถุดิบเดิมของสูตรแล้วปรับ "% ที่ใช้" ได้ด้วย เช่น กลุ่ม "ความหวาน" เลือกไซรัปแล้วตั้งหวานปกติ 100%, หวานน้อย 50%, ไม่หวาน 0% ระบบจะตัดสต็อกและคิดต้นทุนตามปริมาณจริงที่ใช้
        กดไอคอนดาว ★ เพื่อตั้งตัวเลือกเริ่มต้น ลูกค้าจะไม่ต้องกดเลือกเองถ้าไม่ต้องการเปลี่ยน
      </p>

      {data.optionGroups.length === 0 && <EmptyNote text={'ยังไม่มีกลุ่มตัวเลือก กด "เพิ่มกลุ่มตัวเลือก" เพื่อเริ่ม'} />}

      {data.optionGroups.map((g) => (
        <div key={g.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <input className="cfield" value={g.name} onChange={(e) => patchGroup(g.id, { name: e.target.value })} style={{ flex: 1 }} />
            <label style={{ fontSize: 12, color: "var(--espresso-2)", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={g.required} onChange={(e) => patchGroup(g.id, { required: e.target.checked })} />
              บังคับเลือก
            </label>
            <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removeGroup(g.id)} title="ลบกลุ่มตัวเลือกนี้"><Icon name="trash" size={13} /></button>
          </div>

          {g.choices.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", paddingLeft: 12, flexWrap: "wrap" }}>
              <input className="cfield" value={c.label} onChange={(e) => patchChoice(g.id, c.id, { label: e.target.value })} placeholder="ชื่อตัวเลือก" style={{ flex: 1.2, minWidth: 110 }} />
              <input className="cfield" value={c.note} onChange={(e) => patchChoice(g.id, c.id, { note: e.target.value })} placeholder="คำอธิบาย (ถ้ามี)" style={{ flex: 1.5, minWidth: 110 }} />
              <input className="cfield" type="number" value={c.priceDelta} onChange={(e) => patchChoice(g.id, c.id, { priceDelta: Number(e.target.value) })} style={{ width: 70 }} title="ราคาเพิ่ม (บาท)" />
              <select
                className="cfield"
                style={{ flex: 1.3, minWidth: 150 }}
                value={c.ingredientId || ""}
                onChange={(e) => patchChoice(g.id, c.id, { ingredientId: e.target.value || null })}
                title="วัตถุดิบที่ใช้แทนเมื่อลูกค้าเลือกตัวเลือกนี้"
              >
                <option value="">ไม่ตัดสต็อกแทนวัตถุดิบ</option>
                {data.ingredients.filter((i) => i.altGroup).map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.altGroup})</option>
                ))}
              </select>
              {c.ingredientId && (
                <input
                  className="cfield"
                  type="number"
                  value={c.qtyPercent != null ? c.qtyPercent : 100}
                  onChange={(e) => patchChoice(g.id, c.id, { qtyPercent: Number(e.target.value) })}
                  style={{ width: 66 }}
                  title="ปริมาณที่ใช้ (% ของสูตรตั้งต้น) เช่น หวานน้อยลง 50%, ไม่หวาน 0%"
                />
              )}
              <button
                className="cbtn"
                style={{
                  padding: "6px 8px",
                  background: c.isDefault ? "var(--sage-light)" : undefined,
                  borderColor: c.isDefault ? "var(--sage)" : undefined,
                  color: c.isDefault ? "var(--sage-dark)" : undefined,
                }}
                onClick={() => setDefaultChoice(g.id, c.id)}
                title={c.isDefault ? "เป็นค่าเริ่มต้นอยู่ (กดอีกครั้งเพื่อยกเลิก)" : "ตั้งเป็นค่าเริ่มต้น (ลูกค้าไม่ต้องกดเลือกเอง)"}
              >
                <Icon name="star" size={13} />
              </button>
              <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removeChoice(g.id, c.id)} title="ลบตัวเลือกย่อยนี้"><Icon name="x" size={13} /></button>
            </div>
          ))}
          <button className="cbtn" style={{ marginLeft: 12 }} onClick={() => addChoice(g.id)}><Icon name="plus" size={13} /> เพิ่มตัวเลือกย่อย</button>
        </div>
      ))}
    </div>
  );
}

function SettingsPanel({ data, updateData, showToast, uid }) {
  const [shopName, setShopName] = useState(data.settings.shopName);
  const [overhead, setOverhead] = useState(data.settings.overheadPerCup);
  const [platforms, setPlatforms] = useState(data.settings.platforms);
  const [promptpayId, setPromptpayId] = useState(data.settings.promptpayId || "");
  const [bannerImageUrls, setBannerImageUrls] = useState(
    data.settings.bannerImageUrls && data.settings.bannerImageUrls.length
      ? data.settings.bannerImageUrls
      : (data.settings.bannerImageUrl ? [data.settings.bannerImageUrl] : [])
  );

  function updateBannerUrl(idx, value) {
    setBannerImageUrls((u) => u.map((x, i) => (i === idx ? value : x)));
  }
  function addBannerUrl() {
    setBannerImageUrls((u) => [...u, ""]);
  }
  function removeBannerUrl(idx) {
    setBannerImageUrls((u) => u.filter((_, i) => i !== idx));
  }

  function save() {
    updateData((next) => {
      next.settings.shopName = shopName;
      next.settings.overheadPerCup = Number(overhead);
      next.settings.platforms = platforms;
      next.settings.promptpayId = promptpayId.trim();
      next.settings.bannerImageUrls = bannerImageUrls.map((u) => u.trim()).filter(Boolean);
    });
    showToast("บันทึกการตั้งค่าแล้ว");
  }

  function updatePlatform(idx, patch) {
    setPlatforms((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function addPlatform() {
    setPlatforms((p) => [...p, { id: genId("plat"), name: "แพลตฟอร์มใหม่", gpPercent: 30 }]);
  }
  function removePlatform(idx) {
    setPlatforms((p) => p.filter((_, i) => i !== idx));
  }

  function toggleAcceptingOrders() {
    updateData((next) => {
      next.settings.acceptingOrders = !next.settings.acceptingOrders;
    });
    showToast(data.settings.acceptingOrders ? "ปิดรับออเดอร์ลูกค้าแล้ว" : "เปิดรับออเดอร์ลูกค้าแล้ว");
  }

  function toggleSlipTestMode() {
    updateData((next) => {
      next.settings.slipTestMode = !next.settings.slipTestMode;
    });
    showToast(data.settings.slipTestMode ? "ปิดโหมดทดสอบสลิปแล้ว" : "เปิดโหมดทดสอบสลิปแล้ว");
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <SectionTitle icon="settings" text="ตั้งค่าร้าน" />

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: data.settings.acceptingOrders ? "var(--sage-light)" : "var(--danger-light)",
        border: `1px solid ${data.settings.acceptingOrders ? "var(--sage)" : "var(--danger-line)"}`,
        borderRadius: 12, padding: "12px 14px", marginBottom: 18,
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5, color: data.settings.acceptingOrders ? "var(--sage-dark)" : "var(--danger)" }}>
            {data.settings.acceptingOrders ? "เปิดรับออเดอร์ลูกค้าอยู่" : "ปิดรับออเดอร์ลูกค้าชั่วคราว"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--espresso-2)", marginTop: 2 }}>
            {data.settings.acceptingOrders ? "ลูกค้าสั่งผ่านหน้าเว็บได้ตามปกติ" : "ลูกค้าจะเห็นข้อความว่าร้านปิดรับออเดอร์"}
          </div>
        </div>
        <button
          className={data.settings.acceptingOrders ? "cbtn cbtn-danger" : "cbtn cbtn-accent"}
          onClick={toggleAcceptingOrders}
        >
          {data.settings.acceptingOrders ? "ปิดรับออเดอร์" : "เปิดรับออเดอร์"}
        </button>
      </div>

      <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ชื่อร้าน</label>
      <input className="cfield" value={shopName} onChange={(e) => setShopName(e.target.value)} style={{ marginBottom: 12 }} />
      <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ต้นทุนแฝงต่อแก้ว (ค่าไฟ+ค่าเสื่อมอุปกรณ์, บาท)</label>
      <input className="cfield" type="number" value={overhead} onChange={(e) => setOverhead(e.target.value)} style={{ marginBottom: 18 }} />

      <SectionTitle icon="truck-delivery" text="แพลตฟอร์มเดลิเวอรี่ & % GP" />
      {platforms.map((p, idx) => (
        <div key={p.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input className="cfield" value={p.name} onChange={(e) => updatePlatform(idx, { name: e.target.value })} />
          <input className="cfield" style={{ width: 80 }} type="number" value={p.gpPercent} onChange={(e) => updatePlatform(idx, { gpPercent: Number(e.target.value) })} />
          <span style={{ fontSize: 12, color: "var(--espresso-2)" }}>%</span>
          <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removePlatform(idx)} title="ลบแพลตฟอร์มนี้"><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="cbtn" onClick={addPlatform}><Icon name="plus" size={13} /> เพิ่มแพลตฟอร์ม</button>

      <div style={{ marginTop: 18 }}>
        <SectionTitle icon="qrcode" text="รับออเดอร์ลูกค้า & PromptPay" />
        <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>เบอร์พร้อมเพย์ / เลขบัตรประชาชน (สำหรับ gen QR รับเงิน)</label>
        <input className="cfield" value={promptpayId} onChange={(e) => setPromptpayId(e.target.value)} placeholder="0812345678" style={{ marginBottom: 6 }} />
        <p style={{ fontSize: 11, color: "var(--espresso-2)", margin: "0 0 8px" }}>ใส่แล้วบันทึกก่อน จึงจะใช้หน้าสั่งซื้อลูกค้าได้ หน้าจ่ายเงินจะให้ลูกค้าแนบรูปสลิปเพื่อยืนยันยอดอัตโนมัติ</p>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: data.settings.slipTestMode ? "var(--gold-light)" : "var(--cream-2)",
          border: `1px solid ${data.settings.slipTestMode ? "var(--gold)" : "var(--line)"}`,
          borderRadius: 12, padding: "12px 14px", marginTop: 10,
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: data.settings.slipTestMode ? "var(--gold-dark)" : "var(--espresso-4)" }}>
              โหมดทดสอบสลิป
            </div>
            <div style={{ fontSize: 11, color: "var(--espresso-2)", marginTop: 2 }}>
              {data.settings.slipTestMode
                ? "แนบสลิปอะไรก็ได้แล้วผ่านทันที ไม่เรียก SlipOK จริง (ไม่เสียโควต้า)"
                : "เปิดไว้ตอนทดสอบระบบ เพื่อไม่ให้เสียโควต้า SlipOK จริง"}
            </div>
          </div>
          <button
            className={data.settings.slipTestMode ? "cbtn cbtn-danger" : "cbtn"}
            onClick={toggleSlipTestMode}
          >
            {data.settings.slipTestMode ? "ปิดโหมดทดสอบ" : "เปิดโหมดทดสอบ"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <SectionTitle icon="photo" text="แบนเนอร์โฆษณาหน้าลูกค้า" />
        <p style={{ fontSize: 11, color: "var(--espresso-2)", margin: "-6px 0 10px" }}>
          ใส่ได้หลายรูป ระบบจะเลื่อนสไลด์วนอัตโนมัติที่หน้าลูกค้า แนะนำรูปอัตราส่วนยาว ๆ (เช่น 1200×300px) ไม่ใส่รูปเลยถ้าไม่ต้องการแสดงแบนเนอร์
        </p>
        {bannerImageUrls.map((url, idx) => (
          <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <input className="cfield" value={url} onChange={(e) => updateBannerUrl(idx, e.target.value)} placeholder="https://..." />
              <BannerThumbPreview url={url} />
            </div>
            <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removeBannerUrl(idx)} title="ลบรูปนี้"><Icon name="x" size={13} /></button>
          </div>
        ))}
        <button className="cbtn" onClick={addBannerUrl}><Icon name="plus" size={13} /> เพิ่มรูปแบนเนอร์</button>
      </div>

      <div style={{ marginTop: 6 }}>
        <button className="cbtn cbtn-accent" onClick={save}>บันทึกการตั้งค่า</button>
      </div>

      {uid && <OrderLinkCard uid={uid} />}

      <p style={{ fontSize: 11.5, color: "var(--espresso-2)", marginTop: 20, lineHeight: 1.6 }}>
        ข้อมูลทั้งหมด (วัตถุดิบ เมนู ยอดขาย) ถูกบันทึกไว้อัตโนมัติ และจะยังอยู่เมื่อกลับมาเปิดใหม่ นมสด (รวม) ใช้แทนแบรนด์เฉพาะ — ตัดสต็อกจากยอดรวมนมสด ยกเว้นตอนขายเลือก "นม Oat" ซึ่งจะตัดจากสต็อกนม Oat แยกต่างหาก แต่ละแพลตฟอร์มเดลิเวอรี่หัก GP ตาม % ที่ตั้งไว้ด้านบน
      </p>
    </div>
  );
}

function BannerThumbPreview({ url }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt="ตัวอย่างแบนเนอร์"
      style={{ width: "100%", maxHeight: 70, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", marginTop: 4 }}
      onError={() => setFailed(true)}
    />
  );
}

function OrderLinkCard({ uid }) {
  const [dataUrl, setDataUrl] = useState(null);
  const orderUrl = `${window.location.origin}/order/${uid}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(orderUrl, { width: 220, margin: 1 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => { cancelled = true; };
  }, [orderUrl]);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginTop: 18 }}>
      <SectionTitle icon="link" text="ลิงก์สั่งซื้อสำหรับลูกค้า" />
      <p style={{ fontSize: 12, color: "var(--espresso-2)", margin: "0 0 10px" }}>ปริ้น QR นี้ติดหน้าร้าน ลูกค้าสแกนแล้วสั่ง+จ่ายได้เอง</p>
      {dataUrl && <img src={dataUrl} alt="QR ลิงก์สั่งซื้อ" width={160} height={160} style={{ borderRadius: 8, border: "1px solid var(--line)" }} />}
      <p style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--espresso-3)", wordBreak: "break-all", marginTop: 10 }}>{orderUrl}</p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);

  const orderMatch = window.location.pathname.match(/^\/order\/([^/]+)/);

  useEffect(() => {
    if (orderMatch) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (orderMatch) {
    return <CustomerOrder shopUid={orderMatch[1]} />;
  }

  if (user === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#0B4A7A" }}>
        กำลังโหลด...
      </div>
    );
  }

  if (!user || user.isAnonymous) return <Login />;

  return <ShopApp uid={user.uid} user={user} />;
}

import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, update, push } from "firebase/database";
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

const GLASS = {
  background: "rgba(255,255,255,0.6)",
  backdropFilter: "blur(20px) saturate(160%)",
  WebkitBackdropFilter: "blur(20px) saturate(160%)",
  border: "1px solid rgba(255,255,255,0.7)",
  boxShadow: "0 8px 28px rgba(31,42,68,0.10)",
};
function glass(extra) {
  return { ...GLASS, ...extra };
}

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
    // Firebase คืนอาเรย์ที่มี index ขาดหายเป็นช่องว่าง null ได้ (เช่นลบ element กลางอาเรย์) — กรอง null/undefined
    // ทิ้งก่อนเสมอ ไม่งั้น .map()/for-of ตัวไหนก็ตายเมื่อเจอ element ที่หายไปกลางอาเรย์
    ingredients: (raw.ingredients || []).filter(Boolean).map((i) => ({ ...i, components: i.components || [], unlimited: i.unlimited || false })),
    menus: (raw.menus || []).filter(Boolean).map((m) => ({
      ...m, ingredients: (m.ingredients || []).filter(Boolean), optionGroupIds: (m.optionGroupIds || []).filter(Boolean),
      available: m.available ?? true, category: m.category || "อื่นๆ", imageUrl: m.imageUrl || "",
    })),
    sales: (raw.sales || []).filter(Boolean),
    purchases: (raw.purchases || []).filter(Boolean),
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
    optionGroups: (raw.optionGroups || []).filter(Boolean).map((g) => ({
      ...g,
      choices: (g.choices || []).filter(Boolean).map((c) => ({
        ...c, ingredientId: c.ingredientId || null, qtyPercent: c.qtyPercent != null ? c.qtyPercent : 100, isDefault: c.isDefault || false,
        extraAdjustments: (c.extraAdjustments || []).filter(Boolean).map((a) => ({ ingredientId: a.ingredientId || null, qtyPercent: a.qtyPercent != null ? a.qtyPercent : 100 })),
      })),
    })),
    promotions: (raw.promotions || []).filter(Boolean).map((p) => ({
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

// วัตถุดิบ "ผสม" (เช่น mix milk = นมข้นหวาน:นมจืด 2:1) ไม่มีสต็อกของตัวเอง — กระจายปริมาณลงวัตถุดิบจริง
// ตามสัดส่วน components แบบ recursive เผื่ออนาคตมีวัตถุดิบผสมซ้อนวัตถุดิบผสมอีกที (limit ความลึกกันลูปวนตั้งค่าพลาด)
function expandIngredientLine(ingredientId, qty, ingredientsById, depth) {
  const ing = ingredientsById[ingredientId];
  if (!ing || !ing.components || ing.components.length === 0 || depth > 5) {
    return [{ ingredientId, qty }];
  }
  const totalRatio = ing.components.reduce((s, c) => s + (Number(c.ratio) || 0), 0) || 1;
  return ing.components.flatMap((c) =>
    expandIngredientLine(c.ingredientId, round4(qty * ((Number(c.ratio) || 0) / totalRatio)), ingredientsById, depth + 1)
  );
}

function expandLines(lines, ingredientsById) {
  const merged = {};
  for (const line of lines) {
    for (const leaf of expandIngredientLine(line.ingredientId, line.qty, ingredientsById, 0)) {
      merged[leaf.ingredientId] = round4((merged[leaf.ingredientId] || 0) + leaf.qty);
    }
  }
  return Object.entries(merged).map(([ingredientId, qty]) => ({ ingredientId, qty }));
}

function resolveLines(menu, adjustments, ingredientsById) {
  const lines = menu.ingredients.map((line) => {
    const adj = adjustments[line.ingredientId];
    if (!adj) return line;
    const ingredientId = adj.ingredientId || line.ingredientId;
    const qtyPercent = adj.qtyPercent != null ? adj.qtyPercent : 100;
    return { ...line, ingredientId, qty: round4(line.qty * (qtyPercent / 100)) };
  });
  return expandLines(lines, ingredientsById);
}

function calcRecipeCost(menu, ingredientsById, adjustments) {
  const lines = resolveLines(menu, adjustments || {}, ingredientsById);
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

function groupsForMenu(menu, optionGroups) {
  const ids = menu.optionGroupIds || [];
  return optionGroups.filter((g) => ids.includes(g.id));
}

function defaultOptionsFor(groups) {
  const sel = {};
  for (const g of groups) {
    const def = g.choices.find((c) => c.isDefault);
    if (def) sel[g.id] = { ...def, groupId: g.id, groupName: g.name };
  }
  return sel;
}

// เลือกตัวเลือกแบบเดียวกับที่ลูกค้าเห็น ใช้ทั้งในหน้าขายเครื่องดื่ม (admin) และตอนแก้ไข option ของออเดอร์ที่ลูกค้าสั่งมาแล้ว
function OptionGroupPicker({ groups, selections, onPick }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "var(--espresso-2)" }}>{g.name}{g.required ? " *" : ""}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
            {g.choices.map((c) => {
              const selected = selections[g.id]?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="cbtn"
                  onClick={() => onPick(g, c)}
                  style={{
                    padding: "5px 10px", fontSize: 11.5, fontWeight: selected ? 700 : 500,
                    background: selected ? "var(--sage-light)" : undefined,
                    borderColor: selected ? "var(--sage)" : undefined,
                    color: selected ? "var(--sage-dark)" : undefined,
                  }}
                >
                  {c.label}{c.priceDelta ? ` +฿${c.priceDelta}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

function resolveIngredientAdjustmentsFromOptions(menu, options, ingredientsById) {
  const adjustments = {};
  for (const opt of options || []) {
    // การแทนวัตถุดิบแบบเดิม (ผ่าน "กลุ่มทางเลือก" เช่น สลับชนิดนม) — ปรับได้ทีละ 1 รายการ
    if (opt.ingredientId) {
      const chosenIng = ingredientsById[opt.ingredientId];
      if (chosenIng && chosenIng.altGroup) {
        const origLine = menu.ingredients.find((l) => {
          const li = ingredientsById[l.ingredientId];
          return li && li.altGroup === chosenIng.altGroup;
        });
        if (origLine) {
          const qtyPercent = opt.qtyPercent != null ? opt.qtyPercent : 100;
          if (!(origLine.ingredientId === opt.ingredientId && qtyPercent === 100)) {
            adjustments[origLine.ingredientId] = { ingredientId: opt.ingredientId, qtyPercent };
          }
        }
      }
    }
    // ปรับปริมาณวัตถุดิบอื่นๆ ในสูตรพร้อมกันได้หลายรายการ ไม่ต้องแทนที่ ไม่ต้องตั้งกลุ่มทางเลือก
    // (เช่น ลดความหวานแล้วต้องเพิ่มนมสดชดเชยปริมาณของเหลวในแก้ว)
    for (const extra of opt.extraAdjustments || []) {
      if (!extra.ingredientId) continue;
      const hasLine = menu.ingredients.some((l) => l.ingredientId === extra.ingredientId);
      if (!hasLine) continue;
      const qtyPercent = extra.qtyPercent != null ? extra.qtyPercent : 100;
      adjustments[extra.ingredientId] = { ingredientId: extra.ingredientId, qtyPercent };
    }
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

function Icon({ name, size = 18, style, className }) {
  return <i className={"ti ti-" + name + (className ? " " + className : "")} style={{ fontSize: size, ...style }} aria-hidden="true"></i>;
}

function SidebarLogo({ title, size = 34 }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 10, background: "var(--sage)", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }} title={title}>
        <Icon name="coffee" size={Math.round(size * 0.53)} />
      </div>
    );
  }
  return (
    <img
      src="/logo.png"
      alt={title || "โลโก้ร้าน"}
      title={title}
      onError={() => setFailed(true)}
      style={{ height: size, width: "auto", maxWidth: size * 3.2, objectFit: "contain", flexShrink: 0, display: "block" }}
    />
  );
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
  // เช็คแค่ตอน mount ครั้งเดียวไม่พอ — ถ้าหน้าจอเปลี่ยนขนาดทีหลัง (resize, หมุนแท็บเล็ต) โดยไม่ reload หน้า
  // sidebarCollapsed จะค้างค่าตอน mount ตลอด ทำให้ sidebar เต็มบีบเนื้อหาแคบเกินจนอ่านไม่ออกบนจอมือถือจริง
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    const onChange = (e) => setSidebarCollapsed(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [lastUpdated, setLastUpdated] = useState(null);
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
      setLastUpdated(new Date());
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
          recordSale(item.menuId, item.qty, "online", { upcharge, substitutions, milkLabel: (item.options || []).map((x) => x.label).join(", ") || null, orderId: o.id });
        }
        // สลิปยืนยันอัตโนมัติทำให้ order ค้างที่ status "paid" ซึ่งไม่ใช่หนึ่งใน 4 คอลัมน์ Kanban แล้ว
        // ต้องเลื่อนเข้า "preparing" ทันที เหมือนตอนบาริสต้ากดยืนยันรับเงินสดเอง ไม่งั้นการ์ดจะหายไปจากบอร์ด
        update(ref(db, `orders/${uid}/${o.id}`), { status: "preparing", saleRecorded: true }).catch(() => {});
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

  // ยอดขาย/สถิติที่แสดงผลทุกจุด (ภาพรวม, สถิติในหน้าขาย, รายงาน) นับเฉพาะยอดขายที่ผูกกับออเดอร์ที่ไม่ได้ถูกยกเลิก —
  // กันออเดอร์เก่าที่เคยถูกยกเลิกก่อนจะมีระบบคืนยอด/สต็อกอัตโนมัติ (ยอดขายเก่ายังค้างอยู่ใน data.sales แต่ไม่ควรถูกนับ)
  // ยอดขายที่ไม่มี orderId (บันทึกมาก่อนมีระบบนี้ หรือไม่ผูกกับออเดอร์) ยังคงนับตามเดิม เพราะเช็คสถานะย้อนหลังไม่ได้
  const cancelledOrderIds = useMemo(() => new Set(orders.filter((o) => o.status === "cancelled").map((o) => o.id)), [orders]);
  const dataForDisplay = useMemo(() => {
    if (!data) return data;
    return { ...data, sales: data.sales.filter((s) => !s.orderId || !cancelledOrderIds.has(s.orderId)) };
  }, [data, cancelledOrderIds]);

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
    const lines = resolveLines(menu, substitutions, ingredientsById);
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
        // วัตถุดิบ "ไม่จำกัดสต็อก" (เช่น น้ำประปากรอง/น้ำแข็ง) ไม่ตัดสต็อก — ต้นทุนในสูตรยังคิดตามปกติ
        if (ing && !ing.unlimited) ing.stockQty = round4(ing.stockQty - line.qty * qty);
      }
      next.sales.push({
        id: genId("sale"), timestamp: new Date().toISOString(), menuId, menuName: menu.name,
        channel, qty, unitPrice, grossRevenue, gpAmount, gpPercent, promoDiscount, netRevenue,
        totalCost, profit: netRevenue - totalCost,
        platformName: platform ? platform.name : null,
        milkNote: opts.milkLabel || null,
        note: opts.note || null,
        orderId: opts.orderId || null,
      });
    });
    showToast(`บันทึกการขาย ${menu.name} x${qty} (${channel === "delivery" ? (platform ? platform.name : "เดลิเวอรี่") : "หน้าร้าน"}) แล้ว`);
  }

  // ออเดอร์ที่ขายจากหน้า admin ต้องขึ้นบอร์ด Kanban เหมือนออเดอร์ลูกค้า ไม่งั้นบาริสต้าจะไม่มีการ์ดให้ไล่ทำตามสถานะ
  // จ่ายเงินแล้วที่หน้าร้านตอนกดขาย จึงเข้าคอลัมน์ "กำลังดำเนินการ" ทันที ข้ามสถานะ "รอยืนยัน" (เหมือนสลิปยืนยันอัตโนมัติ)
  function createInstoreOrder(cart, note) {
    const items = cart.map((line) => ({
      menuId: line.menuId, name: line.menuName, unitPrice: line.unitPrice, qty: line.qty, options: line.options,
    }));
    const total = round4(cart.reduce((s, l) => s + l.unitPrice * l.qty - (l.promo || 0), 0));
    const platformNames = [...new Set(cart.filter((l) => l.channel === "delivery" && l.platformName).map((l) => l.platformName))];
    const customerName = platformNames.length > 0 ? platformNames.join(", ") : "ขายหน้าร้าน";
    const newRef = push(ref(db, `orders/${uid}`));
    set(newRef, {
      customerName, customerPhone: "", note: note || "",
      paymentMethod: "cash", pickupDate: new Date().toISOString().slice(0, 10),
      items, total, status: "preparing", createdAt: new Date().toISOString(),
      saleRecorded: true, source: "admin-pos",
    }).catch((err) => showToast("บันทึกออเดอร์ไม่สำเร็จ: " + err.message));
    return newRef.key;
  }

  // ยกเลิกออเดอร์ที่ตัดสต็อก/บันทึกยอดขายไปแล้ว (saleRecorded=true — ผ่าน preparing มาแล้วอย่างน้อยหนึ่งครั้ง แม้จะถูกลากการ์ด
  // กลับมา "รอยืนยัน" ก่อนกดยกเลิกก็ตาม) ต้องคืนสต็อกและลบยอดขายที่ผูกกับออเดอร์นี้ออกด้วย ไม่งั้นยอดขาย/สต็อกจะเพี้ยนค้างอยู่
  // ทั้งที่ออเดอร์ถูกยกเลิกไปแล้ว — ถ้ายังไม่เคยบันทึกยอดขาย (ยังไม่ผ่าน preparing) ก็แค่เปลี่ยนสถานะเฉยๆ เหมือนเดิม
  function cancelOrder(order) {
    if (order.saleRecorded) {
      updateData((next) => {
        const nextIngredientsById = {};
        for (const ing of next.ingredients) nextIngredientsById[ing.id] = ing;
        for (const item of order.items) {
          const itemMenu = next.menus.find((m) => m.id === item.menuId);
          if (!itemMenu) continue;
          const substitutions = resolveIngredientAdjustmentsFromOptions(itemMenu, item.options || [], nextIngredientsById);
          const lines = resolveLines(itemMenu, substitutions, nextIngredientsById);
          for (const line of lines) {
            const ing = next.ingredients.find((i) => i.id === line.ingredientId);
            if (ing && !ing.unlimited) ing.stockQty = round4(ing.stockQty + line.qty * item.qty);
          }
        }
        next.sales = next.sales.filter((s) => s.orderId !== order.id);
      });
    }
    update(ref(db, `orders/${uid}/${order.id}`), { status: "cancelled", saleRecorded: false })
      .catch((err) => showToast("ยกเลิกไม่สำเร็จ: " + err.message));
    showToast(order.saleRecorded ? "ยกเลิกออเดอร์แล้ว คืนสต็อกและตัดยอดขายออกให้อัตโนมัติ" : "ยกเลิกออเดอร์แล้ว");
  }

  const activeTabInfo = TABS.find((t) => t.id === tab);
  const pendingOrderCount = orders.filter((o) => o.status === "pending").length;

  return (
    <div style={{ minHeight: "100vh" }}>
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
        .navitem { border: none; border-left: 3px solid transparent; background: transparent; color: var(--espresso-3); padding: 11px 14px 11px 12px; margin: 1px 0; font-size: 13.5px; font-weight: 500; border-radius: 10px; display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; transition: background .15s ease, color .15s ease, border-color .15s ease; }
        .navitem:hover { background: rgba(37,99,235,.06); color: #1D4ED8; }
        .navitem.active { background: rgba(37,99,235,.08); border-left-color: #2563EB; color: #1D4ED8; font-weight: 700; }
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
        @keyframes pulseBadge {
          0%, 100% { box-shadow: 0 4px 14px rgba(178,58,46,0.35); }
          50% { box-shadow: 0 4px 20px rgba(178,58,46,0.6); }
        }
        .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
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
        fontFamily: "var(--f-body)", color: "var(--espresso-4)",
        display: "flex", minHeight: "100vh",
        background: "radial-gradient(circle at 12% 8%, #FDEBDD 0%, transparent 42%), radial-gradient(circle at 90% 12%, #DCEAE3 0%, transparent 45%), radial-gradient(circle at 50% 100%, #E4EEF5 0%, transparent 55%), var(--cream)",
      }}>
        <aside className="admin-sidebar" style={{
          width: sidebarCollapsed ? 68 : 236, flexShrink: 0, ...glass({ borderRadius: 0, borderRight: "1px solid rgba(255,255,255,0.7)", borderTop: "none", borderBottom: "none", borderLeft: "none" }),
          display: "flex", flexDirection: "column", padding: sidebarCollapsed ? "18px 10px" : "18px 14px",
          position: "sticky", top: 0, height: "100vh", overflow: "hidden", zIndex: 5,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 18px", justifyContent: sidebarCollapsed ? "center" : "space-between" }}>
            <SidebarLogo title={data.settings.shopName} size={sidebarCollapsed ? 30 : 34} />
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

          <nav style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, overflowY: "auto" }}>
            {TABS.map((t, idx) => {
              const pendingCount = t.id === "orders" ? pendingOrderCount : 0;
              // เว้นเส้นบางๆ คั่นกลุ่มเมนู: ปฏิบัติการขายวันนี้ / จัดการร้าน / ข้อมูลเชิงลึก — ไว้ scan สายตาง่ายขึ้น ไม่ผูกกับ data ใดๆ
              const groupBreakBefore = t.id === "menus" || t.id === "reports";
              return (
                <div key={t.id}>
                  {groupBreakBefore && (
                    <div style={{ height: 1, background: "var(--line-soft)", margin: sidebarCollapsed ? "6px 8px" : "8px 6px" }} />
                  )}
                  <button
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
                </div>
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

        <main style={{ flex: 1, minWidth: 0, padding: "20px 28px 60px" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 22,
            ...glass({ borderRadius: 20, padding: "16px 22px" }),
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--espresso-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.settings.shopName}</p>
              <h1 style={{ margin: "2px 0 0", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: "clamp(19px, 5vw, 27px)", color: "var(--espresso-5)", whiteSpace: "nowrap" }}>{activeTabInfo?.label}</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {pendingOrderCount > 0 && (
                <button
                  onClick={() => setTab("orders")}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, background: "var(--danger)", color: "#fff",
                    padding: "8px 16px", borderRadius: 999, fontWeight: 700, fontSize: 13, border: "none",
                    boxShadow: "0 4px 14px rgba(178,58,46,0.35)", animation: "pulseBadge 1.6s ease infinite",
                  }}
                >
                  <Icon name="bell-ringing" size={15} /> {pendingOrderCount} ออเดอร์รอยืนยัน
                </button>
              )}
              <HeaderClock lastUpdated={lastUpdated} />
            </div>
          </div>

          {tab === "dashboard" && <Dashboard data={dataForDisplay} setTab={setTab} />}
          {tab === "sell" && <SellPanel data={dataForDisplay} ingredientsById={ingredientsById} recordSale={recordSale} createInstoreOrder={createInstoreOrder} />}
          {tab === "orders" && <OrdersPanel uid={uid} orders={orders} recordSale={recordSale} cancelOrder={cancelOrder} showToast={showToast} data={data} ingredientsById={ingredientsById} />}
          {tab === "menus" && <MenusPanel data={dataForDisplay} ingredientsById={ingredientsById} updateData={updateData} showToast={showToast} />}
          {tab === "promotions" && <PromotionsPanel data={data} updateData={updateData} showToast={showToast} />}
          {tab === "ingredients" && <IngredientsPanel data={data} updateData={updateData} showToast={showToast} />}
          {tab === "reports" && <ReportsPanel data={dataForDisplay} />}
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

function ChannelPill({ channel }) {
  const style = channel === "delivery"
    ? { background: "var(--gold-light)", color: "var(--gold-dark)" }
    : channel === "online"
    ? { background: "var(--cream-2)", color: "var(--espresso-3)" }
    : { background: "var(--sage-light)", color: "var(--sage-dark)" };
  return <span className="chpill" style={style}>{CHANNELS[channel]}</span>;
}

// โทนสีเฉพาะหน้าภาพรวม (Dashboard) — ระบบสีความหมาย (semantic) แยกจาก --sage/--gold ของแท็บอื่นที่จริงๆ เป็นสีส้มล้วน
// ตามที่ตั้งใจให้หน้านี้ลดการใช้สีส้มลง ใช้น้ำเงินเป็นสีหลักของปุ่ม/สถานะ interactive แทน
const DASH = {
  primary: "#2563EB", primaryDark: "#1D4ED8", primarySoft: "rgba(37,99,235,.08)",
  success: "#16A34A", successSoft: "#EAF7EE",
  warning: "#D97706", warningSoft: "#FFF4E5",
  danger: "#DC2626", dangerSoft: "#FDEBEB",
  caution: "#CA8A04", cautionSoft: "#FEF9E7",
  neutral: "#374151", neutralSoft: "#F3F4F6",
  gray: "#6B7280", border: "#ECE8E2",
};

function DashSectionHeader({ icon, text, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: DASH.neutralSoft, color: DASH.neutral, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={icon} size={14} />
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{text}</span>
      </div>
      {hint && <p style={{ fontSize: 12, color: DASH.gray, margin: "4px 0 0 34px", lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}

function DashKpiCard({ icon, label, value, sub, tone, big }) {
  const tones = {
    primary: { fg: DASH.primaryDark, iconBg: "#fff", iconFg: DASH.primary, bg: DASH.primarySoft, border: "rgba(37,99,235,.18)" },
    success: { fg: DASH.success, iconBg: DASH.successSoft, iconFg: DASH.success, bg: "#fff", border: DASH.border },
    warning: { fg: DASH.warning, iconBg: DASH.warningSoft, iconFg: DASH.warning, bg: "#fff", border: DASH.border },
    danger: { fg: DASH.danger, iconBg: DASH.dangerSoft, iconFg: DASH.danger, bg: "#fff", border: DASH.border },
    neutral: { fg: DASH.neutral, iconBg: DASH.neutralSoft, iconFg: DASH.neutral, bg: "#fff", border: DASH.border },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 16, padding: "18px 20px",
      boxShadow: "0 10px 30px rgba(0,0,0,.05)", display: "flex", flexDirection: "column", justifyContent: "space-between",
      gap: 10, minHeight: 116, transition: "box-shadow 200ms ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: t.iconBg, color: t.iconFg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={icon} size={15} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: DASH.gray }}>{label}</span>
      </div>
      <div>
        <div style={{ fontSize: big ? 32 : 24, fontWeight: 700, color: t.fg, lineHeight: 1.15, fontFamily: "var(--f-body)" }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: DASH.gray, marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function DashStockAlertCard({ ing }) {
  const ratio = ing.stockQty / (ing.lowStockThreshold || 1);
  const tier = ing.stockQty <= 0 ? "critical" : ratio <= 0.5 ? "low" : "normal";
  const tones = {
    critical: { bg: DASH.dangerSoft, color: "#B91C1C", icon: "alert-octagon", label: "วิกฤต" },
    low: { bg: DASH.warningSoft, color: "#B45309", icon: "alert-triangle", label: "ต่ำ" },
    normal: { bg: DASH.cautionSoft, color: "#92702A", icon: "alert-circle", label: "ใกล้หมด" },
  };
  const t = tones[tier];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: t.bg, borderRadius: 12, padding: "9px 12px" }}>
      <Icon name={t.icon} size={15} style={{ color: t.color, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1F2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ing.name}</div>
        <div style={{ fontSize: 11.5, color: t.color, fontWeight: 600 }}>เหลือ {ing.stockQty} {UNITS[ing.unit]}</div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: t.color, background: "rgba(255,255,255,.6)", borderRadius: 999, padding: "2px 8px", flexShrink: 0 }}>{t.label}</span>
    </div>
  );
}

function DashRankCard({ rank, name, qty, maxQty }) {
  const medals = ["🥇", "🥈", "🥉"];
  const barTones = [DASH.primary, "#7C9CF0", "#B7C6F5"];
  const pct = maxQty > 0 ? Math.max(8, Math.round((qty / maxQty) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0" }}>
      <span style={{ fontSize: 19, flexShrink: 0, width: 26, textAlign: "center" }}>{medals[rank] || rank + 1}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13.5, fontWeight: 600, color: "#1F2937", marginBottom: 5 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          <span style={{ color: DASH.gray, fontWeight: 500, fontSize: 12, flexShrink: 0, marginLeft: 8 }}>{qty} แก้ว</span>
        </div>
        <div style={{ height: 7, borderRadius: 999, background: DASH.neutralSoft, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct + "%", borderRadius: 999, background: barTones[rank] || "#C7D2E8", transition: "width 400ms ease" }} />
        </div>
      </div>
    </div>
  );
}

function DashTrendChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 110, padding: "0 2px" }}>
      {days.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 10, color: DASH.gray, fontWeight: 600 }}>{d.value > 0 ? money(d.value) : ""}</span>
          <div title={`฿${money(d.value)}`} style={{
            width: "100%", maxWidth: 30, height: Math.max(4, (d.value / max) * 62), borderRadius: 6,
            background: i === days.length - 1 ? DASH.primary : "#C7D6FB", transition: "height 300ms ease",
          }} />
          <span style={{ fontSize: 10.5, color: DASH.gray }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ data, setTab }) {
  const today = todayStr();
  const todaySales = data.sales.filter((s) => s.timestamp.slice(0, 10) === today);
  const revenue = todaySales.reduce((a, s) => a + s.netRevenue, 0);
  const cost = todaySales.reduce((a, s) => a + s.totalCost, 0);
  const profit = revenue - cost;
  const cups = todaySales.reduce((a, s) => a + s.qty, 0);
  const avgPerCup = cups > 0 ? revenue / cups : 0;

  const lowStock = data.ingredients.filter((i) => !i.unlimited && !(i.components && i.components.length > 0) && i.stockQty <= i.lowStockThreshold);
  const sortedLowStock = [...lowStock].sort((a, b) => (a.stockQty / (a.lowStockThreshold || 1)) - (b.stockQty / (b.lowStockThreshold || 1)));
  const visibleLowStock = sortedLowStock.slice(0, 6);

  const menuCount = {};
  for (const s of data.sales) menuCount[s.menuName] = (menuCount[s.menuName] || 0) + s.qty;
  const topMenus = Object.entries(menuCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topMax = topMenus.length ? topMenus[0][1] : 0;

  // ยอดขายสุทธิ 7 วันล่าสุด (รวม netRevenue ต่อวันจาก data.sales) — เติมพื้นที่ว่างด้านล่างซ้ายด้วยข้อมูลจริงที่มีอยู่แล้ว ไม่ต้องพึ่งข้อมูลใหม่
  const trendDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const value = data.sales.filter((s) => s.timestamp.slice(0, 10) === key).reduce((a, s) => a + s.netRevenue, 0);
    return { label: d.toLocaleDateString("th-TH", { weekday: "short" }), value };
  });

  return (
    <div>
      <style>{`
        .dash-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }
        @media (max-width: 900px) { .dash-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 480px) { .dash-kpi-grid { grid-template-columns: minmax(0, 1fr); } }
        .dash-main-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 20px; align-items: start; }
        @media (max-width: 900px) { .dash-main-grid { grid-template-columns: minmax(0, 1fr); } }
        .dash-col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
        .dash-card { background: #fff; border: 1px solid ${DASH.border}; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,.05); }
        .dash-link-btn { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; color: ${DASH.primary}; font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 6px 0; min-height: 44px; }
        .dash-link-btn:hover { color: ${DASH.primaryDark}; }
      `}</style>

      <div className="dash-kpi-grid">
        <DashKpiCard icon="cash" label="ยอดขายวันนี้ (สุทธิ)" value={"฿" + money(revenue)} sub={`${cups} แก้ว · เฉลี่ย ฿${money(avgPerCup)}/แก้ว`} tone="primary" big />
        <DashKpiCard icon="receipt-2" label="ต้นทุนวันนี้" value={"฿" + money(cost)} tone="neutral" />
        <DashKpiCard icon="trending-up" label="กำไรวันนี้" value={"฿" + money(profit)} tone={profit >= 0 ? "success" : "danger"} />
        <DashKpiCard icon="alert-triangle" label="วัตถุดิบใกล้หมด" value={lowStock.length} sub={lowStock.length ? "ต้องเติมสต็อก" : "สต็อกปกติ"} tone={lowStock.length ? "warning" : "neutral"} />
      </div>

      <div className="dash-main-grid">
        <div className="dash-col">
          <div className="dash-card">
            <DashSectionHeader icon="chart-bar" text="ยอดขายสุทธิ 7 วันล่าสุด" />
            <DashTrendChart days={trendDays} />
          </div>
        </div>

        <div className="dash-col">
          <div className="dash-card">
            <DashSectionHeader icon="alert-triangle" text="แจ้งเตือนสต็อก" />
            {lowStock.length === 0 ? (
              <EmptyNote text="สต็อกทุกรายการยังเพียงพอ" />
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                  {visibleLowStock.map((i) => <DashStockAlertCard key={i.id} ing={i} />)}
                </div>
                {sortedLowStock.length > visibleLowStock.length && (
                  <p style={{ fontSize: 11.5, color: DASH.gray, margin: "0 0 6px" }}>และอีก {sortedLowStock.length - visibleLowStock.length} รายการ</p>
                )}
                <button className="dash-link-btn" onClick={() => setTab("ingredients")}>ไปเติมสต็อก →</button>
              </>
            )}
          </div>

          <div className="dash-card">
            <DashSectionHeader icon="trophy" text="เมนูขายดี (สะสม)" />
            {topMenus.length === 0 ? <EmptyNote text="ยังไม่มีข้อมูลการขาย" /> : (
              <div>{topMenus.map(([name, q], idx) => <DashRankCard key={name} rank={idx} name={name} qty={q} maxQty={topMax} />)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderClock({ lastUpdated }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const updatedSecondsAgo = lastUpdated ? Math.round((now - lastUpdated) / 1000) : null;
  const updatedLabel = updatedSecondsAgo == null ? "" : updatedSecondsAgo < 60 ? "อัปเดตล่าสุดเมื่อสักครู่" : `อัปเดตล่าสุด ${Math.round(updatedSecondsAgo / 60)} นาทีที่แล้ว`;
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25,
      padding: "6px 14px", borderRadius: 12, background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.7)",
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--espresso-5)" }}>
        {now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span style={{ fontSize: 10.5, color: "var(--espresso-2)" }}>
        {now.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })}
      </span>
      {updatedLabel && (
        <span style={{ fontSize: 9.5, color: "#16A34A", fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#16A34A", display: "inline-block" }} />
          {updatedLabel}
        </span>
      )}
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

// พาเลตสีเฉพาะหน้าขายเครื่องดื่ม (POS) — แยกจากธีม sage/espresso ของแอดมินหน้าอื่นๆ ตามที่ตั้งใจให้หน้านี้
// ดูพรีเมียมแบบ POS ร้านกาแฟระดับสูง ไม่กระทบธีมของแท็บอื่น
const POS = {
  primary: "#D85C08", primaryDark: "#C14F06", primarySoft: "#FCE8DA",
  navy: "#163B73", warm: "#FAF7F2", border: "#ECE8E2", gray: "#6B7280",
  chipBg: "#F2EEE7",
};

function Segmented({ options, value, onChange, dense }) {
  return (
    <div style={{ display: "inline-flex", background: POS.chipBg, borderRadius: dense ? 10 : 14, padding: 3, gap: 2, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value} type="button" disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.value)}
            title={o.title}
            style={{
              border: "none", cursor: o.disabled ? "not-allowed" : "pointer",
              padding: dense ? "6px 11px" : "9px 16px", minHeight: dense ? 32 : 44,
              borderRadius: dense ? 8 : 11, fontSize: dense ? 12.5 : 13.5, fontWeight: 600,
              background: active ? "#fff" : "transparent",
              color: active ? POS.navy : "#8B8680",
              boxShadow: active ? "0 2px 6px rgba(0,0,0,0.08)" : "none",
              opacity: o.disabled ? 0.4 : 1,
              transition: "all 200ms ease",
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

function PosProductThumb({ src, size = 84 }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{
      width: size, height: size, borderRadius: 18, flexShrink: 0, overflow: "hidden",
      background: `linear-gradient(135deg, ${POS.primarySoft}, ${POS.warm})`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <Icon name="cup" size={Math.round(size * 0.4)} style={{ color: POS.primary, opacity: 0.6 }} />
      )}
    </div>
  );
}

function PosStatPill({ icon, label, value, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: `1px solid ${POS.border}`, borderRadius: 14, padding: "7px 13px 7px 9px" }}>
      <div style={{
        width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: accent ? POS.primary : POS.chipBg, color: accent ? "#fff" : POS.navy,
      }}><Icon name={icon} size={14} /></div>
      <div>
        <div style={{ fontSize: 10.5, color: POS.gray, fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: POS.navy, lineHeight: 1.3 }}>{value}</div>
      </div>
    </div>
  );
}

// กลุ่มตัวเลือกน้อย (<=3 ชอยส์) แสดงเป็น segmented control กดครั้งเดียวจบ กลุ่มที่มีตัวเลือกเยอะใช้ dropdown แทน
// เพื่อลดจำนวน chip เกลื่อนจอ — ไม่เปลี่ยนโครงสร้างข้อมูล ยังเรียก onPick(group, choice) เหมือนเดิมทุกที่
function PosOptionGroup({ group, selected, onPick }) {
  const compact = group.choices.length <= 3;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 12, color: POS.gray, fontWeight: 600, marginBottom: 5 }}>
        {group.name}{group.required && <span style={{ color: POS.primary }}> *</span>}
      </div>
      {compact ? (
        <Segmented
          dense
          options={group.choices.map((c) => ({ value: c.id, label: c.label + (c.priceDelta ? ` +${c.priceDelta}` : "") }))}
          value={selected?.id}
          onChange={(id) => onPick(group, group.choices.find((c) => c.id === id))}
        />
      ) : (
        <select
          value={selected?.id || ""}
          onChange={(e) => { const c = group.choices.find((x) => x.id === e.target.value); if (c) onPick(group, c); }}
          style={{
            width: "100%", padding: "9px 11px", borderRadius: 12, border: `1px solid ${POS.border}`,
            fontSize: 13.5, background: "#fff", color: POS.navy, fontWeight: 500, cursor: "pointer",
          }}
        >
          <option value="" disabled>เลือก{group.name}</option>
          {group.choices.map((c) => <option key={c.id} value={c.id}>{c.label}{c.priceDelta ? ` (+฿${c.priceDelta})` : ""}</option>)}
        </select>
      )}
    </div>
  );
}

function SellPanel({ data, ingredientsById, recordSale, createInstoreOrder }) {
  const [state, setState] = useState({});
  const [cart, setCart] = useState([]);
  const [cartNote, setCartNote] = useState("");
  // ช่องทางขาย/แพลตฟอร์ม/โปรโมชั่น ยกขึ้นมาเป็นตัวเลือกกลางตัวเดียวเหนือกริดสินค้า แทนที่จะให้ทุกการ์ดมีชุดของตัวเอง
  const [channel, setChannel] = useState("store");
  const [platformId, setPlatformId] = useState(data.settings.platforms[0]?.id || "");
  const [promo, setPromo] = useState(0);
  const [infoFor, setInfoFor] = useState(null);
  const [warnOpen, setWarnOpen] = useState({});
  const [advOpen, setAdvOpen] = useState({});

  function get(menuId, key, fallback) {
    return (state[menuId] && state[menuId][key] !== undefined) ? state[menuId][key] : fallback;
  }
  function set(menuId, patch) {
    setState((p) => ({ ...p, [menuId]: { ...p[menuId], ...patch } }));
  }

  // รวมยอดใช้วัตถุดิบของทุกบรรทัดที่อยู่ในตะกร้าแล้ว เพื่อเช็คสต็อกสะสม ไม่ใช่แค่เช็คทีละแก้วตอนกด "หยิบใส่ตะกร้า"
  function cartIngredientUsage() {
    const usage = {};
    for (const line of cart) {
      const m = data.menus.find((x) => x.id === line.menuId);
      if (!m) continue;
      for (const l of resolveLines(m, line.substitutions, ingredientsById)) {
        usage[l.ingredientId] = (usage[l.ingredientId] || 0) + l.qty * line.qty;
      }
    }
    return usage;
  }

  function stockOk(menu, substitutions, qty) {
    const cartUsage = cartIngredientUsage();
    const lines = resolveLines(menu, substitutions, ingredientsById);
    for (const line of lines) {
      const ing = ingredientsById[line.ingredientId];
      if (ing && ing.unlimited) continue;
      const reserved = cartUsage[line.ingredientId] || 0;
      if (ing && ing.stockQty - reserved < line.qty * qty) return false;
    }
    return true;
  }

  function addToCart(menu, cfg) {
    const { qty, channel, options, platformId, promo } = cfg;
    const optionsArr = Object.values(options);
    const substitutions = resolveIngredientAdjustmentsFromOptions(menu, optionsArr, ingredientsById);
    const upcharge = optionsArr.reduce((s, o) => s + (o.priceDelta || 0), 0);
    const basePrice = channel === "delivery" ? menu.priceDelivery : menu.priceStore;
    const unitPrice = basePrice + upcharge;
    const platform = channel === "delivery" ? data.settings.platforms.find((p) => p.id === platformId) : null;
    const optionsLabel = optionsArr.map((o) => o.label).join(", ") || null;
    setCart((c) => [...c, {
      cartId: genId("cart"), menuId: menu.id, menuName: menu.name, qty, channel,
      platformId: channel === "delivery" ? platformId : null,
      platformName: platform ? platform.name : null,
      options: optionsArr, optionsLabel,
      substitutions, upcharge, unitPrice, promo: channel === "delivery" ? (promo || 0) : 0,
    }]);
    set(menu.id, { qty: 1 });
  }

  function removeFromCart(cartId) {
    setCart((c) => c.filter((l) => l.cartId !== cartId));
  }

  function updateCartQty(cartId, qty) {
    setCart((c) => c.map((l) => (l.cartId === cartId ? { ...l, qty: Math.max(1, qty) } : l)));
  }

  function checkout() {
    const orderId = createInstoreOrder(cart, cartNote.trim());
    for (const line of cart) {
      recordSale(line.menuId, line.qty, line.channel, {
        substitutions: line.substitutions, upcharge: line.upcharge,
        promoDiscount: line.promo, platformId: line.platformId, milkLabel: line.optionsLabel,
        note: cartNote.trim() || null, orderId,
      });
    }
    setCart([]);
    setCartNote("");
    setPromo(0);
  }

  const cartCups = cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.qty - (l.promo || 0), 0);

  const today = todayStr();
  const todaySales = data.sales.filter((s) => s.timestamp.slice(0, 10) === today);
  const todayRevenue = todaySales.reduce((s, x) => s + x.netRevenue, 0);
  const todayOrderCount = todaySales.length;

  const platform = data.settings.platforms.find((p) => p.id === platformId);

  return (
    <div>
      <style>{`
        .pos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 24px; }
        .pos-card {
          position: relative; background: ${POS.warm}; border: 1px solid ${POS.border}; border-radius: 24px;
          padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.06); transition: transform 200ms ease, box-shadow 200ms ease;
          display: flex; flex-direction: column; min-height: 300px;
        }
        .pos-card:hover { transform: translateY(-3px) scale(1.01); box-shadow: 0 16px 40px rgba(0,0,0,.10); }
        .pos-info-btn {
          position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; border-radius: 9px;
          border: 1px solid ${POS.border}; background: #fff; color: ${POS.gray}; display: flex; align-items: center;
          justify-content: center; cursor: pointer; transition: all 200ms ease; z-index: 3;
        }
        .pos-info-btn:hover { background: ${POS.chipBg}; color: ${POS.navy}; }
        .pos-stepper { display: flex; align-items: center; border: 1px solid ${POS.border}; border-radius: 14px; overflow: hidden; background: #fff; }
        .pos-stepper button { width: 38px; height: 46px; border: none; background: #fff; color: ${POS.navy}; font-size: 17px; cursor: pointer; transition: background 200ms ease; }
        .pos-stepper button:hover { background: ${POS.chipBg}; }
        .pos-stepper span { min-width: 26px; text-align: center; font-weight: 700; font-size: 14px; color: ${POS.navy}; }
        .pos-add-btn {
          flex: 1; height: 48px; border-radius: 16px; border: none; background: ${POS.primary}; color: #fff;
          font-size: 14.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;
          cursor: pointer; transition: background 200ms ease, transform 200ms ease;
        }
        .pos-add-btn:hover:not(:disabled) { background: ${POS.primaryDark}; transform: translateY(-1px); }
        .pos-add-btn:active:not(:disabled) { transform: scale(0.97); }
        .pos-add-btn:disabled { background: #E6DFD3; color: #A99C8A; cursor: not-allowed; }
        .pos-warn-btn { display: flex; align-items: center; gap: 5px; width: 100%; text-align: left; border: 1px solid #FBD5B5; background: #FFF4EA; color: #B45309; border-radius: 10px; padding: 6px 10px; font-size: 11.5px; font-weight: 600; cursor: pointer; transition: background 200ms ease; }
        .pos-warn-btn:hover { background: #FEE9D6; }
        .pos-cart { position: sticky; top: 10px; background: ${POS.warm}; border: 1px solid ${POS.border}; border-radius: 24px; padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.06); display: flex; flex-direction: column; max-height: calc(100vh - 40px); }
      `}</style>

      {/* หัวข้อหน้า + สถิติวันนี้ + จำนวนในตะกร้า — ข้อมูลจริงทั้งหมดจาก data.sales/ตะกร้าปัจจุบัน ไม่มีตัวเลขสมมติ */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between",
        background: "#fff", border: `1px solid ${POS.border}`, borderRadius: 22, padding: "16px 20px", marginBottom: 18,
      }}>
        <div>
          <div style={{ fontSize: 13, color: POS.gray, fontWeight: 600 }}>วันนี้</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: POS.navy, marginTop: 2, fontFamily: "var(--f-display)" }}>ขายเครื่องดื่ม</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <PosStatPill icon="receipt" label="ออเดอร์วันนี้" value={`${todayOrderCount} รายการ`} />
          <PosStatPill icon="cash" label="ยอดขายวันนี้" value={`฿${money(todayRevenue)}`} accent />
          <PosStatPill icon="shopping-cart" label="ในตะกร้า" value={`${cartCups} แก้ว`} />
        </div>
      </div>

      {/* ช่องทางขายกลาง — เปลี่ยนตรงนี้ทีเดียว มีผลกับทุกการ์ดที่ยังไม่ได้หยิบใส่ตะกร้า */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <Segmented
          options={Object.entries(CHANNELS).map(([k, label]) => ({
            value: k, label, disabled: k === "delivery" && data.settings.platforms.length === 0,
            title: k === "delivery" && data.settings.platforms.length === 0 ? "เพิ่มแพลตฟอร์มในแท็บตั้งค่าก่อน" : undefined,
          }))}
          value={channel}
          onChange={setChannel}
        />
        {channel === "delivery" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)} style={{
              padding: "9px 12px", borderRadius: 12, border: `1px solid ${POS.border}`, fontSize: 13.5, background: "#fff", color: POS.navy, fontWeight: 500,
            }}>
              {data.settings.platforms.map((p) => <option key={p.id} value={p.id}>{p.name} (GP {p.gpPercent}%)</option>)}
            </select>
            <input
              type="number" placeholder="ส่วนลดโปร (บาท)" value={promo || ""} onChange={(e) => setPromo(Number(e.target.value) || 0)}
              style={{ width: 160, padding: "9px 12px", borderRadius: 12, border: `1px solid ${POS.border}`, fontSize: 13.5 }}
            />
            {platform && <span style={{ fontSize: 11, color: POS.gray }}>หัก GP {platform.gpPercent}% อัตโนมัติ</span>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="pos-grid" style={{ flex: "3 1 600px", minWidth: 0 }}>
          {data.menus.map((menu) => {
            const groups = groupsForMenu(menu, data.optionGroups);
            const qty = get(menu.id, "qty", 1);
            const options = get(menu.id, "options") || defaultOptionsFor(groups);
            const optionsArr = Object.values(options);
            const substitutions = resolveIngredientAdjustmentsFromOptions(menu, optionsArr, ingredientsById);
            const upcharge = optionsArr.reduce((s, o) => s + (o.priceDelta || 0), 0);
            const { ingredientCost } = calcRecipeCost(menu, ingredientsById, substitutions);
            const ok = stockOk(menu, substitutions, qty);
            const basePrice = channel === "delivery" ? menu.priceDelivery : menu.priceStore;
            const unitPrice = basePrice + upcharge;
            const missingRequired = groups.some((g) => g.required && !options[g.id]);
            const margin = unitPrice > 0 ? Math.round(((unitPrice - ingredientCost) / unitPrice) * 100) : 0;
            const primaryGroups = groups.slice(0, 2);
            const advancedGroups = groups.slice(2);
            const showAdvToggle = advancedGroups.length > 0;
            const isAdvOpen = !!advOpen[menu.id];
            const isWarnOpen = !!warnOpen[menu.id];

            function pick(g, c) {
              set(menu.id, { options: { ...options, [g.id]: { ...c, groupId: g.id, groupName: g.name } } });
            }

            return (
              <div key={menu.id} className="pos-card">
                <button className="pos-info-btn" onClick={() => setInfoFor(infoFor === menu.id ? null : menu.id)} title="ต้นทุน/กำไร">
                  <Icon name="info-circle" size={14} />
                </button>
                {infoFor === menu.id && (
                  <div style={{
                    position: "absolute", top: 46, right: 14, zIndex: 5, background: "#fff", border: `1px solid ${POS.border}`,
                    borderRadius: 14, padding: "10px 14px", boxShadow: "0 10px 30px rgba(0,0,0,.14)", fontSize: 12,
                    color: "#374151", display: "flex", flexDirection: "column", gap: 3, minWidth: 170,
                  }}>
                    <div>ต้นทุนวัตถุดิบ: ฿{money(ingredientCost)}</div>
                    <div>ราคาขาย: ฿{money(unitPrice)}</div>
                    <div>กำไรขั้นต้น: {margin}%</div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                  <PosProductThumb src={menu.imageUrl} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: POS.navy, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{menu.name}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: POS.primary, marginTop: 3 }}>฿{money(unitPrice)}</div>
                  </div>
                </div>

                <div style={{ flex: 1 }}>
                  {primaryGroups.map((g) => <PosOptionGroup key={g.id} group={g} selected={options[g.id]} onPick={pick} />)}
                  {showAdvToggle && (
                    <>
                      <button
                        onClick={() => setAdvOpen((p) => ({ ...p, [menu.id]: !p[menu.id] }))}
                        style={{ border: "none", background: "none", color: POS.gray, fontSize: 11.5, fontWeight: 600, padding: "2px 0 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
                      >
                        <Icon name={isAdvOpen ? "chevron-up" : "chevron-down"} size={12} />
                        {isAdvOpen ? "ซ่อนตัวเลือกเพิ่มเติม" : `ตัวเลือกเพิ่มเติม (${advancedGroups.length})`}
                      </button>
                      {isAdvOpen && advancedGroups.map((g) => <PosOptionGroup key={g.id} group={g} selected={options[g.id]} onPick={pick} />)}
                    </>
                  )}
                </div>

                {(!ok || missingRequired) && (
                  <div style={{ marginBottom: 10 }}>
                    <button className="pos-warn-btn" onClick={() => setWarnOpen((p) => ({ ...p, [menu.id]: !p[menu.id] }))}>
                      <Icon name="alert-triangle" size={13} />
                      {!ok && missingRequired ? "สต็อกไม่พอ + เลือกไม่ครบ" : !ok ? "สต็อกไม่พอ" : "เลือกตัวเลือกไม่ครบ"}
                      <Icon name={isWarnOpen ? "chevron-up" : "chevron-down"} size={12} style={{ marginLeft: "auto" }} />
                    </button>
                    {isWarnOpen && (
                      <div style={{ fontSize: 11, color: "#92400E", marginTop: 4, paddingLeft: 4, lineHeight: 1.5 }}>
                        {!ok && <div>สต็อกวัตถุดิบไม่พอ (รวมของในตะกร้าแล้ว ยังหยิบเพิ่มได้ แต่สต็อกจะติดลบ)</div>}
                        {missingRequired && <div>กรุณาเลือกตัวเลือกที่จำเป็นให้ครบก่อนหยิบใส่ตะกร้า</div>}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="pos-stepper">
                    <button onClick={() => set(menu.id, { qty: Math.max(1, qty - 1) })}>−</button>
                    <span>{qty}</span>
                    <button onClick={() => set(menu.id, { qty: qty + 1 })}>+</button>
                  </div>
                  <button
                    className="pos-add-btn" disabled={missingRequired}
                    onClick={() => addToCart(menu, { qty, channel, options, platformId, promo })}
                  >
                    <Icon name="shopping-cart-plus" size={16} /> เพิ่มลงตะกร้า
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pos-cart" style={{ flex: "1 1 300px", maxWidth: 360, minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Icon name="shopping-cart" size={18} style={{ color: POS.primary }} />
            <span style={{ fontWeight: 700, fontSize: 16, color: POS.navy }}>ตะกร้า</span>
            {cartCups > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: POS.navy, background: POS.chipBg, borderRadius: 999, padding: "2px 10px" }}>{cartCups} แก้ว</span>
            )}
          </div>

          {cart.length === 0 ? (
            <EmptyNote text="ยังไม่มีรายการในตะกร้า — กด “เพิ่มลงตะกร้า” จากเมนูด้านซ้าย" />
          ) : (
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 12, paddingRight: 2 }}>
              {cart.map((line) => (
                <div key={line.cartId} style={{ background: "#fff", border: `1px solid ${POS.border}`, borderRadius: 14, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: POS.navy }}>{line.menuName}</span>
                    <button onClick={() => removeFromCart(line.cartId)} style={{ border: "none", background: "none", color: "var(--danger)", cursor: "pointer", padding: 2, flexShrink: 0 }} title="เอาออกจากตะกร้า">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: POS.gray, marginTop: 2 }}>
                    {CHANNELS[line.channel]}{line.platformName ? ` · ${line.platformName}` : ""}{line.optionsLabel ? ` · ${line.optionsLabel}` : ""}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button className="cbtn" style={{ padding: "2px 9px", fontSize: 13 }} onClick={() => updateCartQty(line.cartId, line.qty - 1)}>−</button>
                      <span style={{ minWidth: 16, textAlign: "center", fontSize: 13, fontWeight: 600 }}>{line.qty}</span>
                      <button className="cbtn" style={{ padding: "2px 9px", fontSize: 13 }} onClick={() => updateCartQty(line.cartId, line.qty + 1)}>+</button>
                    </div>
                    <span style={{ fontWeight: 700, fontFamily: "var(--f-body)", fontSize: 14, color: POS.primary }}>฿{money(line.unitPrice * line.qty - (line.promo || 0))}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <label style={{ fontSize: 11, color: POS.gray, marginBottom: 4, fontWeight: 600 }}>หมายเหตุ (ถ้ามี)</label>
          <textarea
            value={cartNote} onChange={(e) => setCartNote(e.target.value)}
            placeholder="เช่น ลูกค้าขอพิเศษ..."
            style={{ resize: "vertical", minHeight: 50, marginBottom: 10, fontFamily: "inherit", padding: "9px 11px", borderRadius: 12, border: `1px solid ${POS.border}`, fontSize: 13.5 }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 700, fontSize: 20, fontFamily: "var(--f-body)", borderTop: `1px solid ${POS.border}`, paddingTop: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: POS.gray }}>รวมทั้งหมด</span><span style={{ color: POS.navy }}>฿{money(cartTotal)}</span>
          </div>
          <button className="pos-add-btn" style={{ width: "100%", opacity: cart.length === 0 ? 0.5 : 1 }} disabled={cart.length === 0} onClick={checkout}>
            <Icon name="check" size={16} /> ยืนยันออเดอร์ / ชำระเงิน
          </button>
        </div>
      </div>
    </div>
  );
}

// เวิร์กโฟลว์การ์ด 4 สถานะหลัก (คอลัมน์ Kanban) — "ยกเลิก" เป็นสถานะพิเศษนอกบอร์ด
const KANBAN_COLUMNS = [
  { id: "pending", label: "รอยืนยัน", icon: "receipt" },
  { id: "preparing", label: "กำลังดำเนินการ", icon: "cup" },
  { id: "ready", label: "พร้อมเสิร์ฟ", icon: "bell" },
  { id: "done", label: "เสร็จ", icon: "circle-check" },
];
const ORDER_STATUS_LABEL = { pending: "รอยืนยัน", paid: "จ่ายแล้ว", preparing: "กำลังดำเนินการ", ready: "พร้อมเสิร์ฟ", done: "เสร็จ", cancelled: "ยกเลิก" };
// สีนำ ข้อความรอง — ให้บาริสต้ามองจากระยะไกลแล้วรู้สถานะทันทีจากสี ไม่ต้องเพ่งอ่านตัวหนังสือ
const STATUS_COLORS = {
  pending: { dot: "#F59E0B", bg: "rgba(245,158,11,0.16)", color: "#B45309" },
  paid: { dot: "#16A34A", bg: "rgba(22,163,74,0.16)", color: "#15803D" },
  preparing: { dot: "#2563EB", bg: "rgba(37,99,235,0.16)", color: "#1D4ED8" },
  ready: { dot: "#7C3AED", bg: "rgba(124,58,237,0.16)", color: "#6D28D9" },
  done: { dot: "#16A34A", bg: "#16A34A", color: "#fff", solid: true },
  cancelled: { dot: "#DC2626", bg: "rgba(220,38,38,0.16)", color: "#B91C1C" },
};
const PAYMENT_METHOD_LABEL = { cash: "เงินสด", promptpay: "พร้อมเพย์", thaihelpthai: "ไทยช่วยไทย" };
// วิธีชำระที่จ่ายหน้าร้านโดยตรง ไม่มีสลิปให้ตรวจสอบ — พฤติกรรมเหมือนเงินสดทุกอย่าง
const CASH_LIKE_PAYMENT_METHODS = new Set(["cash", "thaihelpthai"]);

function StatusBadge({ status, big }) {
  const c = STATUS_COLORS[status] || { dot: "#8B98A5", bg: "var(--cream-2)", color: "var(--espresso-3)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, background: c.bg, color: c.color,
      fontWeight: 700, fontSize: big ? 13.5 : 12, padding: big ? "6px 13px" : "4px 10px", borderRadius: 999,
      whiteSpace: "nowrap",
    }}>
      {!c.solid && <span className="status-dot" style={{ background: c.dot }} />}
      {ORDER_STATUS_LABEL[status] || status}
    </span>
  );
}

function formatPickupDateTH(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function OrderMeta({ paymentMethod, pickupDate, paymentVerified, paymentVerifiedBy, compact }) {
  if (!paymentMethod && !pickupDate) return null;
  const isTestSlip = paymentVerifiedBy === "slipok-test-mode";
  return (
    <div style={{ display: "flex", gap: compact ? 4 : 6, flexWrap: "wrap", margin: compact ? "3px 0" : "6px 0" }}>
      {paymentMethod && (
        <span className="chpill" style={{ background: "var(--cream-2)", color: "var(--espresso-3)", fontWeight: 600, ...(compact ? { padding: "1px 6px", fontSize: 9.5 } : {}) }}>
          {CASH_LIKE_PAYMENT_METHODS.has(paymentMethod) ? <Icon name="cash" size={10} /> : <Icon name="qrcode" size={10} />} {PAYMENT_METHOD_LABEL[paymentMethod] || paymentMethod}
        </span>
      )}
      {pickupDate && (
        <span className="chpill" style={{ background: "var(--cream-2)", color: "var(--espresso-3)", fontWeight: 600, ...(compact ? { padding: "1px 6px", fontSize: 9.5 } : {}) }}>
          <Icon name="calendar" size={10} /> รับ {formatPickupDateTH(pickupDate)}
        </span>
      )}
      {paymentVerified && !isTestSlip && (
        <span className="chpill" style={{ background: "rgba(22,163,74,0.16)", color: "#15803D", fontWeight: 700, ...(compact ? { padding: "1px 6px", fontSize: 9.5 } : {}) }}>
          <Icon name="check" size={10} /> สลิปตรง
        </span>
      )}
      {paymentVerified && isTestSlip && (
        <span className="chpill" style={{ background: "rgba(245,158,11,0.16)", color: "#B45309", fontWeight: 700, ...(compact ? { padding: "1px 6px", fontSize: 9.5 } : {}) }}>
          <Icon name="flask" size={10} /> สลิปทดสอบ
        </span>
      )}
    </div>
  );
}

function OrderItemLines({ items, note, compact, onEditItem }) {
  return (
    <div style={{ margin: compact ? "6px 0" : "10px 0" }}>
      {items.map((i, idx) => (
        <div key={idx} style={{ marginBottom: compact ? 5 : 9, paddingBottom: compact ? 5 : 9, borderBottom: idx < items.length - 1 ? "1px dashed var(--line-soft)" : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: compact ? 5 : 10 }}>
            <span style={{ fontSize: compact ? 11.5 : 16, fontWeight: 700, color: "var(--espresso-5)", lineHeight: 1.25 }}>{i.name} <span style={{ color: "var(--sage-dark)" }}>x{i.qty}</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {onEditItem && !compact && (
                <button
                  onClick={() => onEditItem(idx)}
                  title="แก้ไขตัวเลือกรายการนี้"
                  style={{ border: "none", background: "var(--cream-2)", color: "var(--espresso-3)", borderRadius: 6, padding: "3px 5px", cursor: "pointer", display: "flex" }}
                >
                  <Icon name="edit" size={11} />
                </button>
              )}
              <span style={{ fontSize: compact ? 10.5 : 15, fontWeight: 700, fontFamily: "var(--f-body)", textAlign: "right", whiteSpace: "nowrap" }}>฿{money(i.unitPrice * i.qty)}</span>
            </span>
          </div>
          {i.options?.length > 0 && (
            <div style={{ fontSize: compact ? 10.5 : 13, color: "var(--espresso-3)", marginTop: 3, lineHeight: 1.4 }}>{i.options.map((o) => o.label).join(", ")}</div>
          )}
        </div>
      ))}
      {note && (
        <div style={{ marginTop: 6, background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, padding: compact ? "4px 6px" : "7px 10px", fontSize: compact ? 10.5 : 13, fontWeight: 600, color: "#92400E" }}>
          {!compact && <Icon name="message-2" size={13} style={{ marginRight: 4 }} />}{note}
        </div>
      )}
    </div>
  );
}

const KANBAN_NEXT_LABEL = { pending: "ยืนยันรับเงินแล้ว", preparing: "พร้อมเสิร์ฟ", ready: "เสร็จ / ลูกค้ารับแล้ว" };

function OrdersPanel({ uid, orders, recordSale, cancelOrder, showToast, data, ingredientsById }) {
  const prevStatusRef = useRef({});
  const [justMovedIds, setJustMovedIds] = useState(new Set());
  const [dragId, setDragId] = useState(null);
  const [dragPos, setDragPos] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const dragInfoRef = useRef(null);
  // จอแคบ (เช่น iPad) ให้ทั้ง 4 คอลัมน์อัดพอดีจอโดยไม่ต้องเลื่อนแนวนอน แทนที่จะปล่อยให้ล้นแล้วสกอลล์
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1080px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1080px)");
    const handler = (e) => setCompact(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const changed = [];
    for (const o of orders) {
      const prev = prevStatusRef.current[o.id];
      if (prev && prev !== o.status) changed.push(o.id);
      prevStatusRef.current[o.id] = o.status;
    }
    if (changed.length === 0) return;
    setJustMovedIds((s) => new Set([...s, ...changed]));
    const t = setTimeout(() => {
      setJustMovedIds((s) => {
        const next = new Set(s);
        changed.forEach((id) => next.delete(id));
        return next;
      });
    }, 1400);
    return () => clearTimeout(t);
  }, [orders]);

  function setStatus(order, status) {
    update(ref(db, `orders/${uid}/${order.id}`), { status }).catch((err) => showToast("อัปเดตไม่สำเร็จ: " + err.message));
  }

  // แก้ option ได้เฉพาะตอนออเดอร์ยังไม่ยืนยันจ่ายเงิน (ก่อนตัดสต็อก/บันทึกยอดขาย) กันไม่ให้ตัวเลขสต็อก/ต้นทุนที่บันทึกไปแล้วเพี้ยน
  function saveItemOptions(order, itemIdx, newOptions) {
    const item = order.items[itemIdx];
    const oldDelta = (item.options || []).reduce((s, o) => s + (o.priceDelta || 0), 0);
    const newDelta = newOptions.reduce((s, o) => s + (o.priceDelta || 0), 0);
    const newUnitPrice = round4(item.unitPrice - oldDelta + newDelta);
    const newItems = order.items.map((it, idx) => (idx === itemIdx ? { ...it, options: newOptions, unitPrice: newUnitPrice } : it));
    const newTotal = round4(newItems.reduce((s, it) => s + it.unitPrice * it.qty, 0));
    update(ref(db, `orders/${uid}/${order.id}`), { items: newItems, total: newTotal })
      .then(() => showToast("แก้ไขตัวเลือกออเดอร์แล้ว"))
      .catch((err) => showToast("แก้ไขไม่สำเร็จ: " + err.message));
    setEditingItem(null);
  }

  function confirmPaid(order) {
    // ถ้าเคยบันทึกยอดขายไปแล้ว (ลากการ์ดออกจาก "รอยืนยัน" แล้วลากกลับมาใหม่โดยไม่ได้กดยกเลิก) แค่เปลี่ยนสถานะเฉยๆ
    // ห้ามบันทึกยอดขาย/ตัดสต็อกซ้ำอีกรอบ ไม่งั้นยอดขายจะเพี้ยนสูงเกินจริง
    if (order.saleRecorded) {
      setStatus(order, "preparing");
      showToast(`ยืนยันออเดอร์ ${order.customerName || order.customerPhone} แล้ว`);
      return;
    }
    update(ref(db, `orders/${uid}/${order.id}`), { status: "preparing", saleRecorded: true }).catch((err) => showToast("อัปเดตไม่สำเร็จ: " + err.message));
    for (const item of order.items) {
      const upcharge = (item.options || []).reduce((s, o) => s + (o.priceDelta || 0), 0);
      const itemMenu = data.menus.find((m) => m.id === item.menuId);
      const substitutions = itemMenu ? resolveIngredientAdjustmentsFromOptions(itemMenu, item.options, ingredientsById) : {};
      recordSale(item.menuId, item.qty, "online", { upcharge, substitutions, milkLabel: (item.options || []).map((o) => o.label).join(", ") || null, orderId: order.id });
    }
    showToast(`ยืนยันออเดอร์ ${order.customerName || order.customerPhone} แล้ว บันทึกยอดขายให้อัตโนมัติ`);
  }

  function advance(order) {
    if (order.status === "pending") confirmPaid(order);
    else if (order.status === "preparing") setStatus(order, "ready");
    else if (order.status === "ready") setStatus(order, "done");
  }

  function moveTo(order, colId) {
    if (colId === order.status) return;
    if (order.status === "pending" && (colId === "preparing" || colId === "ready" || colId === "done")) {
      confirmPaid(order);
      if (colId !== "preparing") setTimeout(() => setStatus(order, colId), 0);
    } else {
      setStatus(order, colId);
    }
  }

  const columns = useMemo(() => {
    const map = { pending: [], preparing: [], ready: [], done: [] };
    for (const o of orders) {
      // "paid" ไม่ใช่ 1 ใน 4 สถานะ Kanban แล้ว (รวมเข้ากับ "preparing") — กันไว้เผื่อ order ค้างที่ paid
      // ชั่วคราวจาก race condition ของสลิปยืนยันอัตโนมัติ ไม่ให้การ์ดหายไปจากบอร์ด
      const col = o.status === "paid" ? "preparing" : o.status;
      if (map[col]) map[col].push(o);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return map;
  }, [orders]);

  const today = todayStr();
  const cancelledToday = orders
    .filter((o) => o.status === "cancelled" && new Date(o.createdAt).toISOString().slice(0, 10) === today)
    .slice(0, 20);

  function onCardPointerDown(e, order) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button")) return; // let taps on the card's own buttons work normally, not start a drag
    const card = e.currentTarget;
    card.setPointerCapture(e.pointerId);
    dragInfoRef.current = { id: order.id, pointerId: e.pointerId, moved: false, startX: e.clientX, startY: e.clientY };
    setDragPos({ x: e.clientX, y: e.clientY });
  }

  function onCardPointerMove(e) {
    const info = dragInfoRef.current;
    if (!info) return;
    // small movement threshold before treating this as a drag, so simple taps on the buttons still work
    if (!info.moved && (Math.abs(e.clientX - info.startX) > 6 || Math.abs(e.clientY - info.startY) > 6)) {
      info.moved = true;
      setDragId(info.id);
    }
    if (!info.moved) return;
    setDragPos({ x: e.clientX, y: e.clientY });
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const colEl = el && el.closest("[data-kanban-col]");
    setOverCol(colEl ? colEl.getAttribute("data-kanban-col") : null);
  }

  function onCardPointerUp(e) {
    const info = dragInfoRef.current;
    if (!info) return;
    if (info.moved && overCol) {
      const order = orders.find((o) => o.id === info.id);
      if (order) moveTo(order, overCol);
    }
    dragInfoRef.current = null;
    setDragId(null);
    setDragPos(null);
    setOverCol(null);
  }

  const draggedOrder = dragId ? orders.find((o) => o.id === dragId) : null;

  return (
    <div>
      <SectionTitle icon="layout-kanban" text="บอร์ดออเดอร์ — ลากการ์ดข้ามคอลัมน์เพื่ออัปเดตสถานะ" />
      <div style={{
        display: "grid",
        gridTemplateColumns: compact ? "repeat(4, minmax(150px, 1fr))" : "repeat(4, minmax(260px, 1fr))",
        gap: compact ? 7 : 14, overflowX: "auto", paddingBottom: 8, marginBottom: 26,
      }}>
        {KANBAN_COLUMNS.map((col) => {
          const list = columns[col.id];
          const isOver = overCol === col.id && dragId;
          const c = STATUS_COLORS[col.id];
          return (
            <div
              key={col.id}
              data-kanban-col={col.id}
              style={{
                ...glass({ borderRadius: compact ? 12 : 18, padding: compact ? "7px 5px 9px" : "10px 8px 14px" }),
                outline: isOver ? `2px dashed ${c.dot}` : "2px dashed transparent",
                outlineOffset: -3,
                transition: "outline .12s ease",
                display: "flex", flexDirection: "column", gap: compact ? 6 : 10, minHeight: compact ? 140 : 220, minWidth: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: compact ? "2px 3px 6px" : "3px 8px 8px", borderBottom: "1px solid var(--line-soft)", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: compact ? 4 : 7, fontWeight: 700, fontSize: compact ? 11 : 13.5, color: "var(--espresso-4)", minWidth: 0, overflow: "hidden" }}>
                  <span className="status-dot" style={{ background: c.dot, width: compact ? 7 : 10, height: compact ? 7 : 10, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.label}</span>
                </div>
                <span style={{ fontSize: compact ? 10.5 : 12, fontWeight: 700, color: "var(--espresso-2)", background: "var(--cream-2)", borderRadius: 999, padding: compact ? "1px 6px" : "1px 9px", flexShrink: 0 }}>{list.length}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 10, minHeight: 60 }}>
                {list.length === 0 ? (
                  <p style={{ fontSize: compact ? 10.5 : 12, color: "var(--espresso-2)", textAlign: "center", padding: compact ? "10px 3px" : "18px 6px", fontStyle: "italic", margin: 0 }}>ไม่มีออเดอร์</p>
                ) : list.map((o) => (
                  <div
                    key={o.id}
                    onPointerDown={(e) => onCardPointerDown(e, o)}
                    onPointerMove={onCardPointerMove}
                    onPointerUp={onCardPointerUp}
                    onPointerCancel={onCardPointerUp}
                    style={glass({
                      borderRadius: compact ? 10 : 14, padding: compact ? 7 : 12,
                      borderLeft: `${compact ? 3 : 5}px solid ${c.dot}`,
                      cursor: "grab", touchAction: "none",
                      opacity: dragId === o.id ? 0.35 : 1,
                      animation: justMovedIds.has(o.id) ? "paidFlash 1.4s ease" : undefined,
                    })}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: compact ? 11 : 13, fontWeight: 700, color: "var(--espresso-4)", gap: 4 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customerName ? `${o.customerName} · ${o.customerPhone}` : o.customerPhone}</span>
                      {!compact && <Icon name="grip-vertical" size={14} style={{ color: "var(--espresso-2)", flexShrink: 0 }} />}
                    </div>
                    {!compact && (
                      <div style={{ fontSize: 11, color: "var(--espresso-2)", marginTop: 2 }}>
                        {new Date(o.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    )}
                    <OrderMeta paymentMethod={o.paymentMethod} pickupDate={o.pickupDate} paymentVerified={o.paymentVerified} paymentVerifiedBy={o.paymentVerifiedBy} compact={compact} />
                    <OrderItemLines
                      items={o.items} note={o.note} compact={compact}
                      onEditItem={col.id === "pending" ? (idx) => setEditingItem({ order: o, itemIdx: idx }) : undefined}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 700, fontSize: compact ? 13 : 16, fontFamily: "var(--f-body)", borderTop: "1px dashed var(--line)", paddingTop: compact ? 4 : 7, marginBottom: col.id !== "done" ? (compact ? 6 : 9) : 0 }}>
                      <span style={{ fontSize: compact ? 10.5 : 12, fontWeight: 600, color: "var(--espresso-3)" }}>รวม</span><span>฿{money(o.total)}</span>
                    </div>
                    {col.id !== "done" && (
                      <div style={{ display: "flex", gap: compact ? 4 : 6 }}>
                        <button className="cbtn cbtn-accent" style={{ flex: 1, fontSize: compact ? 10.5 : 12.5, padding: compact ? "6px 4px" : "8px 10px" }} onClick={() => advance(o)}>{compact ? "→ ถัดไป" : KANBAN_NEXT_LABEL[col.id]}</button>
                        <button
                          className="cbtn cbtn-danger" style={{ padding: compact ? "6px 6px" : "8px 9px" }}
                          onClick={() => cancelOrder(o)}
                          title={o.saleRecorded ? "ยกเลิกออเดอร์ (คืนสต็อก/ตัดยอดขายที่บันทึกไปแล้วออกให้)" : "ยกเลิกออเดอร์"}
                        ><Icon name="x" size={13} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {draggedOrder && dragPos && (
        <div style={{
          position: "fixed", left: dragPos.x, top: dragPos.y, transform: "translate(-50%, -50%) rotate(-2deg)",
          zIndex: 100, pointerEvents: "none",
          background: STATUS_COLORS[draggedOrder.status]?.dot || "var(--sage)", color: "#fff",
          padding: "10px 18px", borderRadius: 14, fontWeight: 700, fontSize: 13.5,
          boxShadow: "0 12px 30px rgba(0,0,0,0.25)", whiteSpace: "nowrap",
        }}>
          <Icon name="grip-vertical" size={13} style={{ marginRight: 6 }} />
          {draggedOrder.customerName || draggedOrder.customerPhone} · ฿{money(draggedOrder.total)}
        </div>
      )}

      <SectionTitle icon="ban" text={`ยกเลิกวันนี้ (${cancelledToday.length})`} />
      {cancelledToday.length === 0 ? <EmptyNote text="ไม่มีออเดอร์ที่ถูกยกเลิกวันนี้" /> : (
        <div className="table-scroll">
          <table className="cdata">
            <thead><tr><th>เวลา</th><th>ลูกค้า</th><th>รายการ</th><th>วันรับ</th><th>ชำระ</th><th>ยอด</th><th>สถานะ</th></tr></thead>
            <tbody>
              {cancelledToday.map((o) => (
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

      {editingItem && (
        <EditOrderItemModal
          order={editingItem.order} itemIdx={editingItem.itemIdx} data={data}
          onClose={() => setEditingItem(null)}
          onSave={(newOptions) => saveItemOptions(editingItem.order, editingItem.itemIdx, newOptions)}
        />
      )}
    </div>
  );
}

function EditOrderItemModal({ order, itemIdx, data, onClose, onSave }) {
  const item = order.items[itemIdx];
  const menu = data.menus.find((m) => m.id === item.menuId);
  const groups = menu ? groupsForMenu(menu, data.optionGroups) : [];
  const initial = {};
  for (const o of item.options || []) initial[o.groupId] = o;
  const [selections, setSelections] = useState(initial);

  function pick(g, c) {
    setSelections((s) => ({ ...s, [g.id]: { ...c, groupId: g.id, groupName: g.name } }));
  }

  const missingRequired = groups.some((g) => g.required && !selections[g.id]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,29,20,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 14, padding: 20, width: 340, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <p style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16, margin: "0 0 2px" }}>แก้ไขตัวเลือก: {item.name}</p>
        <p style={{ fontSize: 11.5, color: "var(--espresso-2)", margin: "0 0 14px" }}>ออเดอร์ {order.customerName || order.customerPhone}</p>
        {groups.length === 0 ? (
          <EmptyNote text="เมนูนี้ไม่มีตัวเลือกให้แก้ไข" />
        ) : (
          <OptionGroupPicker groups={groups} selections={selections} onPick={pick} />
        )}
        {missingRequired && <p style={{ fontSize: 11.5, color: "var(--danger)", margin: "4px 0 0" }}><Icon name="alert-circle" size={13} /> กรุณาเลือกตัวเลือกที่จำเป็นให้ครบ</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            className="cbtn cbtn-accent" disabled={missingRequired} style={{ opacity: missingRequired ? 0.5 : 1, cursor: missingRequired ? "not-allowed" : "pointer" }}
            onClick={() => onSave(Object.values(selections))}
          >
            บันทึก
          </button>
          <button className="cbtn" onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ระบบสี "มาร์จิ้น" ของหน้าเมนู & สูตร — เขียว/เหลือง/แดงเป็นสัญลักษณ์สากล (>=60% ดี, 40-60% พอใช้, <40% บาง)
// แยกจากส้ม/กรมท่าของแบรนด์หน้านี้ที่ใช้เฉพาะปุ่มหลัก/สถานะเลือก ไม่ปนกับความหมาย "ดี/แย่" ของตัวเลข
const MNU_MARGIN = {
  good: { color: "#15803D", bg: "#EAF7EE" },
  ok: { color: "#B45309", bg: "#FFF4E5" },
  bad: { color: "#B91C1C", bg: "#FDEBEB" },
};
function marginTier(pct) {
  if (pct >= 60) return "good";
  if (pct >= 40) return "ok";
  return "bad";
}
function menuCostAndMargin(menu, ingredientsById, overheadPerCup) {
  const { ingredientCost, breakdown } = calcRecipeCost(menu, ingredientsById, {});
  const totalCost = ingredientCost + overheadPerCup;
  const margin = menu.priceStore > 0 ? ((menu.priceStore - totalCost) / menu.priceStore) * 100 : 0;
  return { totalCost, margin, breakdown };
}
// เมนู "ใกล้หมด/หมด" อิงจากสูตรฐาน (ไม่รวมตัวเลือกเสริมที่ลูกค้าอาจเลือกภายหลัง) — ข้ามวัตถุดิบผสม/ไม่จำกัดสต็อกเพราะไม่มีสต็อกของตัวเอง
function menuStockFlag(menu, ingredientsById) {
  const lines = resolveLines(menu, {}, ingredientsById);
  let flag = null;
  for (const line of lines) {
    const ing = ingredientsById[line.ingredientId];
    if (!ing || ing.unlimited) continue;
    if (ing.stockQty <= 0) return "out";
    if (ing.stockQty <= ing.lowStockThreshold) flag = flag || "low";
  }
  return flag;
}
function timeAgoTh(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "เมื่อสักครู่";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`;
  return `${Math.round(hrs / 24)} วันที่แล้ว`;
}

function MnuAvailBadge({ available }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 999,
      padding: "3px 9px", background: available ? "#EAF7EE" : "#FDEBEB", color: available ? "#15803D" : "#B91C1C",
    }}>
      <Icon name={available ? "circle-check" : "circle-x"} size={11} /> {available ? "เปิดขาย" : "ปิดขาย"}
    </span>
  );
}

function MnuMarginTag({ pct }) {
  const t = MNU_MARGIN[marginTier(pct)];
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: t.color, background: t.bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
      {pct.toFixed(0)}%
    </span>
  );
}

function MnuStatCard({ icon, label, value, tone }) {
  const tones = {
    primary: { bg: POS.primarySoft, fg: POS.primaryDark, icFg: POS.primary },
    navy: { bg: "#EEF2F8", fg: POS.navy, icFg: POS.navy },
    danger: { bg: "#FDEBEB", fg: "#B91C1C", icFg: "#DC2626" },
    neutral: { bg: "#F3F2EF", fg: "#374151", icFg: "#6B7280" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div style={{ background: t.bg, borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, minHeight: 76 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: "#fff", color: t.icFg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 6px rgba(0,0,0,.06)" }}>
        <Icon name={icon} size={17} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 21, fontWeight: 700, color: t.fg, lineHeight: 1.1, fontFamily: "var(--f-body)" }}>{value}</div>
        <div style={{ fontSize: 11.5, color: t.fg, opacity: .8, marginTop: 2, whiteSpace: "nowrap" }}>{label}</div>
      </div>
    </div>
  );
}

function MenuCardImage({ src, available }) {
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", borderRadius: "20px 20px 0 0", overflow: "hidden", background: `linear-gradient(135deg, ${POS.primarySoft}, ${POS.warm})`, flexShrink: 0 }}>
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="cup" size={34} style={{ color: POS.primary, opacity: .5 }} />
        </div>
      )}
      <div style={{ position: "absolute", top: 10, right: 10 }}><MnuAvailBadge available={available} /></div>
    </div>
  );
}

// เมนูการ์ดแบบ Shopify-style: รูปเต็มความกว้างด้านบน สถานะซ้อนมุม, ชื่อ/ราคา/มาร์จิ้นตรงกลาง, action ด้านล่างไม่เกิน 3 ปุ่ม (ที่เหลืออยู่ในเมนู ⋮)
function MenuCard({ menu, totalCost, margin, stockFlag, selected, selectMode, onToggleSelect, onOpenOverview, onOpenRecipe, moreItems }) {
  return (
    <div className="mnu-card" style={{ opacity: menu.available ? 1 : .72 }}>
      <div className="mnu-card-media" style={{ position: "relative" }}>
        <MenuCardImage src={menu.imageUrl} available={menu.available} />
        <button
          type="button"
          className={"mnu-select-chk" + (selected ? " checked" : "") + (selectMode ? " force-show" : "")}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          aria-label={selected ? "ยกเลิกเลือกเมนูนี้" : "เลือกเมนูนี้"}
          aria-pressed={selected}
        >
          {selected && <Icon name="check" size={13} />}
        </button>
        {stockFlag && (
          <span className="mnu-stock-flag" style={{ background: stockFlag === "out" ? "#FDEBEB" : "#FFF4E5", color: stockFlag === "out" ? "#B91C1C" : "#B45309" }}>
            <Icon name="alert-triangle" size={11} /> {stockFlag === "out" ? "วัตถุดิบหมด" : "วัตถุดิบใกล้หมด"}
          </span>
        )}
      </div>
      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ fontSize: 12, color: "#9C9690", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{menu.category}</div>
        <div style={{ fontSize: 16.5, fontWeight: 700, color: POS.navy, lineHeight: 1.25, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{menu.name}</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>฿{money(menu.priceStore)}</span>
          <MnuMarginTag pct={margin} />
        </div>
        <div style={{ fontSize: 11.5, color: "#9C9690" }}>ต้นทุน ฿{money(totalCost)}/แก้ว · เดลิเวอรี่ ฿{money(menu.priceDelivery)}</div>

        <div className="mnu-card-actions">
          <button className="mnu-act-btn" onClick={onOpenOverview}><Icon name="edit" size={13} /> แก้ไข</button>
          <button className="mnu-act-btn" onClick={onOpenRecipe}><Icon name="list-details" size={13} /> สูตร</button>
          <InvActionsMenu items={moreItems} />
        </div>
      </div>
    </div>
  );
}

// dropdown ค้นหาวัตถุดิบแบบ position:fixed (ไม่โดน overflow ของ panel ตัดขอบ — เจอบั๊กแบบนี้มาก่อนแล้วในหน้าตัวเลือกเสริม/วัตถุดิบ)
function MnuIngredientPicker({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 220 });
  const btnRef = useRef(null);
  const current = options.find((o) => o.value === value);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: Math.max(220, r.width) });
    }
    setQuery("");
    setOpen((o) => !o);
  }
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const filtered = query.trim() ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  return (
    <>
      <button type="button" ref={btnRef} onClick={toggle} className="mnu-combo-btn">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current ? current.label : "เลือกวัตถุดิบ"}</span>
        <Icon name="chevron-down" size={13} style={{ flexShrink: 0, color: "#9CA3AF" }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
          <div style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 91, background: "#fff", borderRadius: 12, boxShadow: "0 16px 40px rgba(0,0,0,.18)", border: `1px solid ${POS.border}`, overflow: "hidden" }}>
            <div style={{ padding: 8, borderBottom: `1px solid ${POS.border}` }}>
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาวัตถุดิบ..." style={{ width: "100%", height: 34, border: `1px solid ${POS.border}`, borderRadius: 8, padding: "0 10px", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto", padding: 4 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "12px 10px", fontSize: 12.5, color: "#9CA3AF" }}>ไม่พบวัตถุดิบ</div>
              ) : filtered.map((o) => (
                <button
                  key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: o.value === value ? POS.primarySoft : "none", color: o.value === value ? POS.primaryDark : "#1F2937", padding: "8px 10px", borderRadius: 8, fontSize: 13, fontWeight: o.value === value ? 700 : 500, cursor: "pointer" }}
                  onMouseEnter={(e) => { if (o.value !== value) e.currentTarget.style.background = "#F5F5F3"; }}
                  onMouseLeave={(e) => { if (o.value !== value) e.currentTarget.style.background = "none"; }}
                >{o.label}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MnuCategoryReorderPopover({ categories, onMove }) {
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false));
  if (categories.length < 2) return null;
  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="inv-icon-btn" onClick={() => setOpen((o) => !o)} title="จัดเรียงหมวดหมู่ที่แสดงหน้าลูกค้า" aria-label="จัดเรียงหมวดหมู่"><Icon name="arrows-sort" size={15} /></button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{ position: "absolute", top: 42, right: 0, zIndex: 61, background: "#fff", border: `1px solid ${POS.border}`, borderRadius: 14, boxShadow: "0 16px 40px rgba(0,0,0,.16)", padding: 10, width: 240 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#9C9690", textTransform: "uppercase", letterSpacing: ".03em", margin: "0 0 8px" }}>ลำดับหมวดหมู่หน้าลูกค้า</p>
            {categories.map((cat, idx) => (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 2px" }}>
                <span style={{ flex: 1, fontSize: 12.5, color: "#1F2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat}</span>
                <button type="button" className="inv-icon-btn" style={{ width: 26, height: 26 }} disabled={idx === 0} onClick={() => onMove(cat, "up")} title="ย้ายขึ้น"><Icon name="chevron-up" size={12} /></button>
                <button type="button" className="inv-icon-btn" style={{ width: 26, height: 26 }} disabled={idx === categories.length - 1} onClick={() => onMove(cat, "down")} title="ย้ายลง"><Icon name="chevron-down" size={12} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MenuBulkBar({ count, categories, onSetAvailable, onDuplicate, onMoveCategory, onDelete, onClear }) {
  const [moveOpen, setMoveOpen] = useState(false);
  useEscape(() => setMoveOpen(false));
  return (
    <div className="mnu-bulk-bar">
      <span style={{ fontSize: 13, fontWeight: 700, color: POS.navy }}>{count} รายการที่เลือก</span>
      <div style={{ flex: 1 }} />
      <button className="mnu-bulk-btn" onClick={() => onSetAvailable(true)}><Icon name="eye" size={13} /> เปิดขาย</button>
      <button className="mnu-bulk-btn" onClick={() => onSetAvailable(false)}><Icon name="eye-off" size={13} /> ปิดขาย</button>
      <button className="mnu-bulk-btn" onClick={onDuplicate}><Icon name="copy" size={13} /> ทำสำเนา</button>
      <div style={{ position: "relative" }}>
        <button className="mnu-bulk-btn" onClick={() => setMoveOpen((o) => !o)}><Icon name="folder" size={13} /> ย้ายหมวดหมู่</button>
        {moveOpen && (
          <>
            <div onClick={() => setMoveOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
            <div style={{ position: "absolute", bottom: 44, right: 0, zIndex: 61, background: "#fff", border: `1px solid ${POS.border}`, borderRadius: 12, boxShadow: "0 16px 40px rgba(0,0,0,.16)", padding: 6, minWidth: 180, maxHeight: 240, overflowY: "auto" }}>
              {categories.length === 0 ? (
                <div style={{ padding: "8px 10px", fontSize: 12, color: "#9CA3AF" }}>ยังไม่มีหมวดหมู่</div>
              ) : categories.map((c) => (
                <button key={c} className="mnu-menu-item" onClick={() => { onMoveCategory(c); setMoveOpen(false); }}>{c}</button>
              ))}
            </div>
          </>
        )}
      </div>
      <button className="mnu-bulk-btn danger" onClick={onDelete}><Icon name="trash" size={13} /> ลบ</button>
      <button className="inv-icon-btn" onClick={onClear} aria-label="ยกเลิกการเลือก"><Icon name="x" size={15} /></button>
    </div>
  );
}

function MenuSidebarWidgets({ topSelling, topMax, lowStockIngredients, recentlyEdited }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="mnu-side-card">
        <div className="mnu-side-title"><Icon name="trophy" size={14} /> เมนูขายดี (สะสม)</div>
        {topSelling.length === 0 ? <EmptyNote text="ยังไม่มีข้อมูลการขาย" /> : topSelling.map(([name, qty], i) => (
          <div key={name} className="mnu-side-rank-row">
            <span className="mnu-side-rank-num">{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600, color: "#1F2937", marginBottom: 4, gap: 6 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                <span style={{ color: "#9C9690", fontWeight: 500, flexShrink: 0 }}>{qty} แก้ว</span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: "#F3F2EF", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${topMax > 0 ? Math.max(8, (qty / topMax) * 100) : 0}%`, background: POS.primary, borderRadius: 999 }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mnu-side-card">
        <div className="mnu-side-title"><Icon name="alert-triangle" size={14} /> วัตถุดิบใกล้หมด</div>
        {lowStockIngredients.length === 0 ? <EmptyNote text="สต็อกทุกรายการยังเพียงพอ" /> : lowStockIngredients.map((ing) => (
          <div key={ing.id} className="mnu-side-stock-row">
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{ing.name}</span>
            <span style={{ fontWeight: 700, color: ing.stockQty <= 0 ? "#B91C1C" : "#B45309", flexShrink: 0 }}>{ing.stockQty <= 0 ? "หมด" : `เหลือ ${fmtQty(ing.stockQty)}`}</span>
          </div>
        ))}
      </div>

      <div className="mnu-side-card">
        <div className="mnu-side-title"><Icon name="clock" size={14} /> แก้ไขล่าสุด</div>
        {recentlyEdited.length === 0 ? <EmptyNote text="ยังไม่มีประวัติการแก้ไข" /> : recentlyEdited.map((m) => (
          <div key={m.id} className="mnu-side-stock-row">
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.name}</span>
            <span style={{ color: "#9C9690", flexShrink: 0 }}>{timeAgoTh(m.updatedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MenusPanel({ data, ingredientsById, updateData, showToast }) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [inspector, setInspector] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  function newMenu() {
    const defaultPackaging = (data.settings.defaultPackagingLines || []).map((l) => ({ ...l }));
    setInspector({ mode: "add", tab: "overview", menu: { id: null, name: "", priceStore: 0, priceDelivery: 0, ingredients: defaultPackaging, optionGroupIds: [], available: true, category: categoryFilter !== "all" ? categoryFilter : "กาแฟ", imageUrl: "" } });
  }

  function saveMenu(menu) {
    const now = new Date().toISOString();
    menu = { ...menu, category: menu.category.trim() || "อื่นๆ" };
    updateData((next) => {
      if (menu.id) {
        const idx = next.menus.findIndex((m) => m.id === menu.id);
        next.menus[idx] = { ...menu, updatedAt: now, createdAt: next.menus[idx].createdAt || now };
      } else {
        next.menus.push({ ...menu, id: genId("menu"), createdAt: now, updatedAt: now });
      }
    });
    setInspector(null);
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
    setConfirmDelete(null);
    setInspector(null);
    showToast("ลบเมนูแล้ว");
  }

  function duplicateMenu(menu) {
    const now = new Date().toISOString();
    updateData((next) => { next.menus.push({ ...menu, id: genId("menu"), name: menu.name + " (สำเนา)", createdAt: now, updatedAt: now }); });
    showToast("ทำสำเนาเมนูแล้ว");
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

  function moveCategory(cat, direction) {
    const order = categories.slice();
    const idx = order.indexOf(cat);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= order.length) return;
    [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
    updateData((next) => { next.settings.categoryOrder = order; });
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); setSelectMode(false); }

  function bulkSetAvailable(value) {
    updateData((next) => { for (const m of next.menus) if (selectedIds.has(m.id)) m.available = value; });
    showToast(value ? "เปิดขายเมนูที่เลือกแล้ว" : "ปิดขายเมนูที่เลือกแล้ว");
  }
  function bulkDuplicate() {
    const now = new Date().toISOString();
    updateData((next) => {
      const toDupe = next.menus.filter((m) => selectedIds.has(m.id));
      for (const m of toDupe) next.menus.push({ ...m, id: genId("menu"), name: m.name + " (สำเนา)", createdAt: now, updatedAt: now });
    });
    showToast("ทำสำเนาเมนูที่เลือกแล้ว");
    clearSelection();
  }
  function bulkMoveCategoryTo(cat) {
    updateData((next) => { for (const m of next.menus) if (selectedIds.has(m.id)) m.category = cat; });
    showToast(`ย้ายไปหมวด "${cat}" แล้ว`);
    clearSelection();
  }
  function bulkDelete() {
    updateData((next) => { next.menus = next.menus.filter((m) => !selectedIds.has(m.id)); });
    showToast("ลบเมนูที่เลือกแล้ว");
    setConfirmBulkDelete(false);
    clearSelection();
  }

  const rawCategories = [...new Set(data.menus.map((m) => m.category).filter(Boolean))];
  const orderPref = data.settings.categoryOrder || [];
  const categories = [...orderPref.filter((c) => rawCategories.includes(c)), ...rawCategories.filter((c) => !orderPref.includes(c))];

  const menuStatsById = useMemo(() => {
    const m = {};
    for (const menu of data.menus) {
      const { totalCost, margin } = menuCostAndMargin(menu, ingredientsById, data.settings.overheadPerCup);
      m[menu.id] = { totalCost, margin, stockFlag: menuStockFlag(menu, ingredientsById) };
    }
    return m;
  }, [data.menus, ingredientsById, data.settings.overheadPerCup]);

  function passesFilters(menu) {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const ingredientNames = menu.ingredients.map((l) => ingredientsById[l.ingredientId]?.name || "").join(" ");
      const hay = `${menu.name} ${menu.category} ${ingredientNames}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (statusFilter === "available" && !menu.available) return false;
    if (statusFilter === "hidden" && menu.available) return false;
    if (statusFilter === "lowstock" && !menuStatsById[menu.id]?.stockFlag) return false;
    return true;
  }
  function sortMenus(list) {
    return [...list].sort((a, b) => {
      if (sortBy === "price") return b.priceStore - a.priceStore;
      if (sortBy === "margin") return (menuStatsById[b.id]?.margin || 0) - (menuStatsById[a.id]?.margin || 0);
      if (sortBy === "category") return a.category.localeCompare(b.category, "th") || a.name.localeCompare(b.name, "th");
      return a.name.localeCompare(b.name, "th");
    });
  }

  const totalMenus = data.menus.length;
  const activeMenus = data.menus.filter((m) => m.available).length;
  const hiddenMenus = totalMenus - activeMenus;
  const lowStockMenus = data.menus.filter((m) => menuStatsById[m.id]?.stockFlag).length;

  const topSelling = useMemo(() => {
    const counts = {};
    for (const s of data.sales) counts[s.menuName] = (counts[s.menuName] || 0) + s.qty;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data.sales]);
  const topMax = topSelling.length ? topSelling[0][1] : 0;

  const recentlyEdited = useMemo(() => {
    return [...data.menus].filter((m) => m.updatedAt).sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : 1)).slice(0, 5);
  }, [data.menus]);

  const lowStockIngredients = useMemo(() => {
    return data.ingredients
      .filter((i) => !i.unlimited && !(i.components && i.components.length) && i.stockQty <= i.lowStockThreshold)
      .sort((a, b) => (a.stockQty / (a.lowStockThreshold || 1)) - (b.stockQty / (b.lowStockThreshold || 1)))
      .slice(0, 5);
  }, [data.ingredients]);

  function moreItemsFor(menu, menusInCat, idx) {
    return [
      ...(menusInCat && idx > 0 ? [{ icon: "chevron-up", label: "เลื่อนขึ้น", onClick: () => moveMenu(menu.id, "up") }] : []),
      ...(menusInCat && idx < menusInCat.length - 1 ? [{ icon: "chevron-down", label: "เลื่อนลง", onClick: () => moveMenu(menu.id, "down") }] : []),
      { icon: menu.available ? "eye-off" : "eye", label: menu.available ? "ปิดขายชั่วคราว" : "เปิดขาย", onClick: () => toggleAvailable(menu) },
      { icon: "copy", label: "ทำสำเนา", onClick: () => duplicateMenu(menu) },
      { icon: "trash", label: "ลบเมนู", danger: true, onClick: () => setConfirmDelete(menu) },
    ];
  }

  const categoryTabOptions = [
    { value: "all", label: `ทั้งหมด (${totalMenus})` },
    ...categories.map((c) => ({ value: c, label: `${c} (${data.menus.filter((m) => m.category === c).length})` })),
  ];
  const groupedView = categoryFilter === "all";
  const catsToRender = groupedView ? categories : [categoryFilter];

  const noFiltersActive = !query.trim() && statusFilter === "all";

  return (
    <div className="mnu-wrap">
      <style>{`
        .mnu-stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
        @media (max-width: 720px) { .mnu-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .mnu-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
        .mnu-search { flex: 1; min-width: 200px; position: relative; display: flex; align-items: center; }
        .mnu-search input { width: 100%; height: 44px; border: 1px solid ${POS.border}; border-radius: 12px; background: #fff; padding: 0 14px 0 38px; font-size: 14px; color: #1F2937; box-sizing: border-box; outline: none; transition: border 160ms, box-shadow 160ms; }
        .mnu-search input:focus { border-color: ${POS.primary}; box-shadow: 0 0 0 3px ${POS.primarySoft}; }
        .mnu-select { height: 44px; border: 1px solid ${POS.border}; border-radius: 12px; background: #fff; padding: 0 32px 0 14px; font-size: 13.5px; font-weight: 600; color: #1F2937; cursor: pointer; outline: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; }
        .mnu-select:focus { border-color: ${POS.primary}; box-shadow: 0 0 0 3px ${POS.primarySoft}; }
        .mnu-btn-primary { display: inline-flex; align-items: center; gap: 7px; height: 44px; padding: 0 18px; border: none; border-radius: 12px; background: ${POS.primary}; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 18px rgba(216,92,8,.28); transition: background 160ms; }
        .mnu-btn-primary:hover { background: ${POS.primaryDark}; }
        .mnu-btn-primary:disabled { opacity: .55; cursor: not-allowed; }
        .mnu-btn-ghost-sel { height: 44px; padding: 0 16px; border: 1px solid ${POS.border}; border-radius: 12px; background: #fff; color: #1F2937; font-size: 13.5px; font-weight: 600; cursor: pointer; }
        .mnu-btn-ghost-sel.active { background: ${POS.primarySoft}; border-color: ${POS.primary}; color: ${POS.primaryDark}; }
        .mnu-cat-nav { margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
        .mnu-cat-scroll { flex: 1; min-width: 0; overflow-x: auto; }
        .mnu-bulk-bar { position: sticky; top: 0; z-index: 15; display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid ${POS.border}; border-radius: 16px; padding: 10px 14px; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(0,0,0,.08); flex-wrap: wrap; }
        .mnu-bulk-btn { display: inline-flex; align-items: center; gap: 5px; height: 38px; padding: 0 12px; border: 1px solid ${POS.border}; border-radius: 9px; background: #fff; color: ${POS.navy}; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .mnu-bulk-btn:hover { background: ${POS.chipBg}; }
        .mnu-bulk-btn.danger { color: #DC2626; border-color: #F3D5D2; }
        .mnu-bulk-btn.danger:hover { background: #FDEBEB; }
        .mnu-menu-item { display: block; width: 100%; text-align: left; border: none; background: none; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: #1F2937; cursor: pointer; min-height: 36px; }
        .mnu-menu-item:hover { background: #F5F5F3; }
        .mnu-shell { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }
        @media (max-width: 1180px) { .mnu-shell { grid-template-columns: minmax(0, 1fr); } }
        .mnu-cat-section { margin-bottom: 26px; }
        .mnu-cat-heading { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: ${POS.navy}; margin: 0 0 12px; }
        .mnu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 18px; }
        .mnu-card { background: #fff; border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,.06); overflow: hidden; display: flex; flex-direction: column; }
        .mnu-card-media { transition: transform 200ms ease; }
        .mnu-card:hover { box-shadow: 0 16px 36px rgba(0,0,0,.12); transition: box-shadow 200ms ease; }
        .mnu-card:hover .mnu-card-media { transform: translateY(-3px); }
        .mnu-select-chk { position: absolute; top: 10px; left: 10px; width: 26px; height: 26px; border-radius: 8px; border: 1.5px solid rgba(255,255,255,.9); background: rgba(255,255,255,.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; opacity: 0; transition: opacity 160ms ease, background 160ms ease, border-color 160ms ease; }
        .mnu-card:hover .mnu-select-chk, .mnu-select-chk.force-show { opacity: 1; }
        .mnu-select-chk.checked { opacity: 1; background: ${POS.primary}; border-color: ${POS.primary}; }
        .mnu-stock-flag { position: absolute; bottom: 10px; left: 10px; display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
        .mnu-card-actions { display: flex; gap: 6px; margin-top: 12px; }
        .mnu-act-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 38px; border: 1px solid ${POS.border}; border-radius: 10px; background: #fff; color: ${POS.navy}; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 140ms ease, border-color 140ms ease; }
        .mnu-act-btn:hover { background: ${POS.chipBg}; }
        .mnu-side-card { background: #fff; border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,.06); padding: 16px; }
        .mnu-side-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: ${POS.navy}; margin-bottom: 12px; }
        .mnu-side-rank-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
        .mnu-side-rank-num { width: 16px; font-size: 11.5px; font-weight: 700; color: #9C9690; flex-shrink: 0; }
        .mnu-side-stock-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: #1F2937; padding: 6px 0; border-bottom: 1px solid #F5F3EF; }
        .mnu-side-stock-row:last-child { border-bottom: none; }
        .mnu-combo-btn { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; height: 40px; border: 1px solid ${POS.border}; border-radius: 10px; background: #fff; padding: 0 10px; font-size: 13px; font-weight: 500; color: #1F2937; cursor: pointer; box-sizing: border-box; }
        .mnu-combo-btn:hover { border-color: ${POS.primary}; }
        .mnu-inspector-overlay { position: fixed; inset: 0; background: rgba(22,20,17,.4); z-index: 70; display: flex; justify-content: flex-end; animation: mnuFade 160ms ease; }
        .mnu-inspector { width: min(560px, 100%); height: 100%; background: #fff; box-shadow: -8px 0 40px rgba(0,0,0,.18); display: flex; flex-direction: column; animation: mnuSlide 240ms cubic-bezier(.2,.8,.2,1); }
        .mnu-insp-head { padding: 18px 22px; border-bottom: 1px solid ${POS.border}; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-shrink: 0; }
        .mnu-insp-tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid ${POS.border}; flex-shrink: 0; overflow-x: auto; }
        .mnu-insp-tab { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 10px 12px; font-size: 12.5px; font-weight: 700; color: #9C9690; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; min-height: 40px; }
        .mnu-insp-tab.active { color: ${POS.primary}; border-bottom-color: ${POS.primary}; }
        .mnu-insp-body { padding: 20px 22px; overflow-y: auto; flex: 1; }
        .mnu-insp-footer { padding: 16px 22px; border-top: 1px solid ${POS.border}; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .mnu-btn-danger-ghost { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; border: 1px solid #F3D5D2; border-radius: 10px; background: #fff; color: #DC2626; font-size: 13px; font-weight: 700; cursor: pointer; }
        .mnu-btn-danger-ghost:hover { background: #FDEBEB; }
        @keyframes mnuFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mnuSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @media (max-width: 760px) {
          .mnu-inspector-overlay { align-items: stretch; }
          .mnu-inspector { width: 100%; height: 100dvh; }
        }
        .mnu-field:focus { border-color: ${POS.primary} !important; box-shadow: 0 0 0 3px ${POS.primarySoft}; }
        .mnu-recipe-table { display: flex; flex-direction: column; gap: 6px; }
        .mnu-recipe-row { display: grid; grid-template-columns: 2fr 84px 56px 84px 36px; gap: 8px; align-items: center; }
        .mnu-recipe-head span { font-size: 10.5px; font-weight: 700; color: #9C9690; text-transform: uppercase; letter-spacing: .03em; }
        .mnu-qty-field { height: 40px; border: 1px solid ${POS.border}; border-radius: 10px; padding: 0 8px; font-size: 13px; box-sizing: border-box; outline: none; }
        .mnu-qty-field:focus { border-color: ${POS.primary}; box-shadow: 0 0 0 3px ${POS.primarySoft}; }
        .mnu-unit-cell { font-size: 12px; color: #9C9690; }
        .mnu-cost-cell { font-size: 12.5px; font-weight: 600; color: #1F2937; text-align: right; }
        @media (max-width: 480px) {
          .mnu-recipe-row { grid-template-columns: 1fr; gap: 4px; padding: 8px 0; border-bottom: 1px solid #F5F3EF; }
          .mnu-recipe-head { display: none; }
        }
        .mnu-price-card { background: #fff; border: 1px solid ${POS.border}; border-radius: 16px; padding: 16px; }
        .mnu-price-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 700; color: ${POS.navy}; margin-bottom: 12px; }
        .mnu-price-card-head span:first-child { display: flex; align-items: center; gap: 6px; }
        .mnu-price-breakdown { display: flex; justify-content: space-between; font-size: 11.5px; color: #9C9690; margin-top: 8px; }
        .mnu-platform-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #FBFAF8; border-radius: 12px; padding: 10px 12px; }
        .mnu-option-row { display: flex; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid #F5F3EF; }
        .mnu-option-row:last-child { border-bottom: none; }
        .mnu-required-chip { font-size: 10px; font-weight: 700; color: #B45309; background: #FFF4E5; border-radius: 999px; padding: 2px 8px; }
        .inv-icon-btn { width: 36px; height: 36px; border: 1px solid ${POS.border}; border-radius: 9px; background: #fff; color: #6B7280; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .inv-icon-btn:hover { background: #F5F5F3; color: #1F2937; }
        .inv-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
        .inv-btn-ghost { height: 40px; padding: 0 16px; border: 1px solid ${POS.border}; border-radius: 10px; background: #fff; color: #1F2937; font-size: 13.5px; font-weight: 600; cursor: pointer; }
        .inv-btn-danger { height: 40px; padding: 0 16px; border: none; border-radius: 10px; background: #DC2626; color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer; }
      `}</style>

      <div className="mnu-stats-grid">
        <MnuStatCard icon="cup" label="เมนูทั้งหมด" value={totalMenus} tone="navy" />
        <MnuStatCard icon="circle-check" label="เปิดขาย" value={activeMenus} tone="primary" />
        <MnuStatCard icon="eye-off" label="ปิดขาย" value={hiddenMenus} tone="neutral" />
        <MnuStatCard icon="alert-triangle" label="วัตถุดิบใกล้หมด/หมด" value={lowStockMenus} tone={lowStockMenus ? "danger" : "neutral"} />
      </div>

      <div className="mnu-toolbar">
        <div className="mnu-search">
          <Icon name="search" size={15} style={{ position: "absolute", left: 13, color: "#9C9690" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาเมนู, หมวดหมู่, วัตถุดิบ..." aria-label="ค้นหาเมนู" />
        </div>
        <select className="mnu-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="กรองตามสถานะ">
          <option value="all">ทุกสถานะ</option>
          <option value="available">เปิดขาย</option>
          <option value="hidden">ปิดขาย</option>
          <option value="lowstock">วัตถุดิบใกล้หมด/หมด</option>
        </select>
        <select className="mnu-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="เรียงลำดับ">
          <option value="name">เรียง: ชื่อ</option>
          <option value="price">เรียง: ราคาสูง→ต่ำ</option>
          <option value="margin">เรียง: มาร์จิ้นสูง→ต่ำ</option>
          <option value="category">เรียง: หมวดหมู่</option>
        </select>
        <button className={"mnu-btn-ghost-sel" + (selectMode ? " active" : "")} onClick={() => { setSelectMode((v) => !v); if (selectMode) clearSelection(); }}>
          <Icon name="checks" size={14} /> เลือกหลายรายการ
        </button>
        <button className="mnu-btn-primary" onClick={newMenu}><Icon name="plus" size={16} /> เพิ่มเมนู</button>
      </div>

      {categories.length > 0 && (
        <div className="mnu-cat-nav">
          <div className="mnu-cat-scroll">
            <Segmented options={categoryTabOptions} value={categoryFilter} onChange={setCategoryFilter} dense />
          </div>
          <MnuCategoryReorderPopover categories={categories} onMove={moveCategory} />
        </div>
      )}

      {selectedIds.size > 0 && (
        <MenuBulkBar
          count={selectedIds.size}
          categories={categories}
          onSetAvailable={bulkSetAvailable}
          onDuplicate={bulkDuplicate}
          onMoveCategory={bulkMoveCategoryTo}
          onDelete={() => setConfirmBulkDelete(true)}
          onClear={clearSelection}
        />
      )}

      <div className="mnu-shell">
        <div>
          {data.menus.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", background: "#fff", borderRadius: 20, boxShadow: "0 8px 24px rgba(0,0,0,.06)" }}>
              <Icon name="cup" size={30} style={{ color: "#9C9690" }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: "#1F2937", margin: "12px 0 2px" }}>ยังไม่มีเมนู</p>
              <p style={{ fontSize: 12.5, color: "#9C9690", margin: "0 0 16px" }}>เริ่มสร้างเมนูแรกของร้าน</p>
              <button className="mnu-btn-primary" style={{ margin: "0 auto" }} onClick={newMenu}><Icon name="plus" size={16} /> เพิ่มเมนู</button>
            </div>
          ) : (
            catsToRender.map((cat) => {
              const menusInCat = data.menus.filter((m) => m.category === cat);
              const visible = sortMenus(menusInCat.filter(passesFilters));
              if (visible.length === 0) return null;
              return (
                <div key={cat} className="mnu-cat-section">
                  {groupedView && <p className="mnu-cat-heading">{cat} <span style={{ color: "#9C9690", fontWeight: 500 }}>({visible.length})</span></p>}
                  <div className="mnu-grid">
                    {visible.map((menu) => {
                      const stat = menuStatsById[menu.id];
                      const idx = menusInCat.findIndex((m) => m.id === menu.id);
                      return (
                        <MenuCard
                          key={menu.id}
                          menu={menu}
                          totalCost={stat.totalCost}
                          margin={stat.margin}
                          stockFlag={stat.stockFlag}
                          selected={selectedIds.has(menu.id)}
                          selectMode={selectMode}
                          onToggleSelect={() => toggleSelect(menu.id)}
                          onOpenOverview={() => setInspector({ mode: "edit", tab: "overview", menu })}
                          onOpenRecipe={() => setInspector({ mode: "edit", tab: "recipe", menu })}
                          moreItems={moreItemsFor(menu, menusInCat, idx)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          {data.menus.length > 0 && catsToRender.every((cat) => sortMenus(data.menus.filter((m) => m.category === cat).filter(passesFilters)).length === 0) && (
            <div style={{ textAlign: "center", padding: "48px 20px", background: "#fff", borderRadius: 20, boxShadow: "0 8px 24px rgba(0,0,0,.06)" }}>
              <Icon name="search-off" size={28} style={{ color: "#9C9690" }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: "#1F2937", margin: "12px 0 2px" }}>ไม่พบเมนูที่ตรงกับเงื่อนไข</p>
              <p style={{ fontSize: 12.5, color: "#9C9690", margin: 0 }}>ลองปรับคำค้นหาหรือตัวกรอง</p>
            </div>
          )}
        </div>

        {noFiltersActive && (
          <MenuSidebarWidgets topSelling={topSelling} topMax={topMax} lowStockIngredients={lowStockIngredients} recentlyEdited={recentlyEdited} />
        )}
      </div>

      {inspector && (
        <MenuInspector
          key={inspector.mode + (inspector.menu.id || "new")}
          mode={inspector.mode}
          initial={inspector.menu}
          initialTab={inspector.tab}
          ingredients={data.ingredients}
          ingredientsById={ingredientsById}
          optionGroups={data.optionGroups}
          categories={categories}
          platforms={data.settings.platforms}
          overheadPerCup={data.settings.overheadPerCup}
          onSave={saveMenu}
          onClose={() => setInspector(null)}
          onDelete={() => setConfirmDelete(inspector.menu)}
        />
      )}

      {confirmDelete && (
        <InvConfirmDialog
          title="ลบเมนูนี้?"
          message={`คุณกำลังจะลบเมนู "${confirmDelete.name}" ออกจากระบบถาวร ลูกค้าจะไม่เห็นเมนูนี้อีก`}
          confirmLabel="ลบเมนู"
          onConfirm={() => deleteMenu(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmBulkDelete && (
        <InvConfirmDialog
          title={`ลบ ${selectedIds.size} เมนูที่เลือก?`}
          message="เมนูที่เลือกทั้งหมดจะถูกลบออกจากระบบถาวร การกระทำนี้ย้อนกลับไม่ได้"
          confirmLabel="ลบทั้งหมด"
          onConfirm={bulkDelete}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}
    </div>
  );
}

function MenuInspector({ mode, initial, initialTab, ingredients, ingredientsById, optionGroups, categories, platforms, overheadPerCup, onSave, onClose, onDelete }) {
  const [form, setForm] = useState({
    ...initial, optionGroupIds: initial.optionGroupIds || [], available: initial.available ?? true,
    category: initial.category || "", imageUrl: initial.imageUrl || "",
  });
  const [tab, setTab] = useState(initialTab || "overview");
  const [imageError, setImageError] = useState(false);
  useEscape(onClose);

  function toggleOptionGroup(groupId) {
    setForm((f) => {
      const has = f.optionGroupIds.includes(groupId);
      return { ...f, optionGroupIds: has ? f.optionGroupIds.filter((id) => id !== groupId) : [...f.optionGroupIds, groupId] };
    });
  }
  function addLine() { setForm((f) => ({ ...f, ingredients: [...f.ingredients, { ingredientId: ingredients[0]?.id, qty: 0 }] })); }
  function updateLine(idx, patch) { setForm((f) => ({ ...f, ingredients: f.ingredients.map((l, i) => (i === idx ? { ...l, ...patch } : l)) })); }
  function removeLine(idx) { setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) })); }

  const canSave = form.name.trim() !== "";
  const { totalCost, margin, breakdown } = menuCostAndMargin(form, ingredientsById, overheadPerCup);

  const TABS = [
    ["overview", "ภาพรวม", "info-circle"],
    ["recipe", "สูตร", "list-details"],
    ["pricing", "ราคา & กำไร", "chart-line"],
    ["options", "ตัวเลือกเสริม", "adjustments"],
  ];

  return (
    <div className="mnu-inspector-overlay" onClick={onClose}>
      <div className="mnu-inspector" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={mode === "add" ? "เพิ่มเมนูใหม่" : "แก้ไขเมนู"}>
        <div className="mnu-insp-head">
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <PosProductThumb src={form.imageUrl} size={44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: POS.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{form.name || (mode === "add" ? "เมนูใหม่" : "แก้ไขเมนู")}</div>
              <div style={{ fontSize: 11.5, color: "#9C9690", marginTop: 1 }}>
                {mode === "add" ? "ยังไม่ได้บันทึก" : (form.updatedAt ? `อัปเดตล่าสุด ${timeAgoTh(form.updatedAt)}` : "ยังไม่เคยแก้ไข")}
              </div>
            </div>
          </div>
          <button className="inv-icon-btn" onClick={onClose} aria-label="ปิด"><Icon name="x" size={18} /></button>
        </div>

        <div className="mnu-insp-tabs">
          {TABS.map(([id, label, icon]) => (
            <button key={id} className={"mnu-insp-tab" + (tab === id ? " active" : "")} onClick={() => setTab(id)}>
              <Icon name={icon} size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="mnu-insp-body">
          {tab === "overview" && <MenuOverviewTab form={form} setForm={setForm} categories={categories} imageError={imageError} setImageError={setImageError} totalCost={totalCost} margin={margin} />}
          {tab === "recipe" && <MenuRecipeTab form={form} ingredients={ingredients} updateLine={updateLine} addLine={addLine} removeLine={removeLine} ingredientsById={ingredientsById} />}
          {tab === "pricing" && <MenuPricingTab form={form} setForm={setForm} totalCost={totalCost} platforms={platforms} />}
          {tab === "options" && <MenuOptionsTab form={form} optionGroups={optionGroups} toggleOptionGroup={toggleOptionGroup} />}
        </div>

        <div className="mnu-insp-footer">
          {mode === "edit" && <button className="mnu-btn-danger-ghost" onClick={onDelete}><Icon name="trash" size={14} /> ลบเมนู</button>}
          <div style={{ flex: 1 }} />
          <button className="inv-btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="mnu-btn-primary" disabled={!canSave} onClick={() => onSave(form)}>{mode === "add" ? "บันทึกเมนู" : "บันทึกการแก้ไข"}</button>
        </div>
      </div>
    </div>
  );
}

function MenuOverviewTab({ form, setForm, categories, imageError, setImageError, totalCost, margin }) {
  const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#9C9690", marginBottom: 6 };
  const field = { width: "100%", height: 44, border: `1px solid ${POS.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 14, color: "#1F2937", boxSizing: "border-box", outline: "none" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <label style={lbl}>ชื่อเมนู</label>
        <input className="mnu-field" style={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น Latte, Thai Tea" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={lbl}>หมวดหมู่ (แสดงเป็นแท็บหน้าลูกค้า)</label>
          <input className="mnu-field" style={field} list="menu-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="เช่น กาแฟ, ชาผลไม้" />
          <datalist id="menu-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label style={lbl}>สถานะ</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 44 }}>
            <OptgToggle checked={form.available} onChange={(v) => setForm({ ...form, available: v })} color={POS.primary} />
            <span style={{ fontSize: 13, fontWeight: 600, color: form.available ? "#15803D" : "#B91C1C" }}>{form.available ? "เปิดขาย" : "ปิดขาย"}</span>
          </div>
        </div>
      </div>
      <div>
        <label style={lbl}>ลิงก์รูปเมนู (ถ้ามี)</label>
        <input className="mnu-field" style={field} value={form.imageUrl} onChange={(e) => { setForm({ ...form, imageUrl: e.target.value }); setImageError(false); }} placeholder="https://..." />
        <p style={{ fontSize: 11, color: "#9C9690", margin: "6px 0 0", lineHeight: 1.5 }}>
          ต้องเป็นลิงก์รูปโดยตรง (ลงท้าย .jpg/.png ฯลฯ) เช่นจาก imgur.com — ลิงก์แชร์จาก Google Photos ใช้ไม่ได้
        </p>
        {form.imageUrl && (
          <div style={{ marginTop: 10 }}>
            <img src={form.imageUrl} alt="ตัวอย่างรูป" onLoad={() => setImageError(false)} onError={() => setImageError(true)} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 14, border: `1px solid ${POS.border}` }} />
            {imageError && <p style={{ fontSize: 11, color: "#DC2626", margin: "6px 0 0" }}>โหลดรูปไม่ขึ้น — ตรวจว่าเป็นลิงก์รูปโดยตรงหรือยัง</p>}
          </div>
        )}
      </div>

      <div style={{ background: "#FBFAF8", border: `1px solid ${POS.border}`, borderRadius: 14, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11.5, color: "#9C9690" }}>ต้นทุน/แก้ว (รวมต้นทุนแฝง)</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1F2937" }}>฿{money(totalCost)}</div>
        </div>
        <MnuMarginTag pct={margin} />
      </div>

      {(form.createdAt || form.updatedAt) && (
        <p style={{ fontSize: 11, color: "#9C9690", margin: 0 }}>
          {form.createdAt && `สร้างเมื่อ ${timeAgoTh(form.createdAt)}`}{form.createdAt && form.updatedAt ? " · " : ""}{form.updatedAt && `แก้ไขล่าสุด ${timeAgoTh(form.updatedAt)}`}
        </p>
      )}
    </div>
  );
}

function MenuRecipeTab({ form, ingredients, updateLine, addLine, removeLine, ingredientsById }) {
  return (
    <div>
      <p style={{ fontSize: 12, color: "#9C9690", margin: "0 0 14px", lineHeight: 1.5 }}>
        วัตถุดิบที่ตั้ง "กลุ่มทางเลือก" ไว้ (เช่น นม/เมล็ดกาแฟ) จะรวมเป็นตัวเลือกเดียวในรายการนี้ — ระบบจะตัดสต็อกตามที่ลูกค้าเลือกจริงในตัวเลือกเสริม
      </p>
      <div className="mnu-recipe-table">
        <div className="mnu-recipe-row mnu-recipe-head">
          <span>วัตถุดิบ</span><span>จำนวน</span><span>หน่วย</span><span style={{ textAlign: "right" }}>ต้นทุน</span><span></span>
        </div>
        {form.ingredients.length === 0 ? (
          <EmptyNote text="ยังไม่มีส่วนผสมในสูตรนี้" />
        ) : form.ingredients.map((line, idx) => {
          const ing = ingredientsById[line.ingredientId];
          const options = ingredientPickerOptions(ingredients, line.ingredientId);
          const lineCost = ing ? ing.costPerUnit * (Number(line.qty) || 0) : 0;
          return (
            <div className="mnu-recipe-row" key={idx}>
              <MnuIngredientPicker options={options} value={line.ingredientId} onChange={(v) => updateLine(idx, { ingredientId: v })} />
              <input className="mnu-qty-field" type="number" min="0" value={line.qty} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} />
              <span className="mnu-unit-cell">{ing ? UNITS[ing.unit] : "—"}</span>
              <span className="mnu-cost-cell">฿{money(lineCost)}</span>
              <button type="button" className="inv-icon-btn" style={{ width: 36, height: 36 }} onClick={() => removeLine(idx)} aria-label="ลบส่วนผสมนี้"><Icon name="x" size={14} /></button>
            </div>
          );
        })}
      </div>
      <button className="inv-btn-ghost" style={{ marginTop: 12 }} onClick={addLine}><Icon name="plus" size={14} /> เพิ่มส่วนผสม</button>
    </div>
  );
}

function MenuPricingTab({ form, setForm, totalCost, platforms }) {
  const marginStore = form.priceStore > 0 ? ((form.priceStore - totalCost) / form.priceStore) * 100 : 0;
  const marginDelivery = form.priceDelivery > 0 ? ((form.priceDelivery - totalCost) / form.priceDelivery) * 100 : 0;
  const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#9C9690", marginBottom: 6 };
  const field = { width: "100%", height: 44, border: `1px solid ${POS.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 14, color: "#1F2937", boxSizing: "border-box", outline: "none" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="mnu-price-card">
        <div className="mnu-price-card-head"><span><Icon name="building-store" size={14} /> หน้าร้าน (Walk-in)</span><MnuMarginTag pct={marginStore} /></div>
        <label style={lbl}>ราคาขาย (บาท)</label>
        <input className="mnu-field" style={field} type="number" min="0" value={form.priceStore} onChange={(e) => setForm({ ...form, priceStore: Number(e.target.value) })} />
        <div className="mnu-price-breakdown"><span>ต้นทุน ฿{money(totalCost)}</span><span>กำไร ฿{money(form.priceStore - totalCost)}/แก้ว</span></div>
      </div>

      <div className="mnu-price-card">
        <div className="mnu-price-card-head"><span><Icon name="truck-delivery" size={14} /> เดลิเวอรี่ (ราคาฐาน)</span><MnuMarginTag pct={marginDelivery} /></div>
        <label style={lbl}>ราคาขาย (บาท)</label>
        <input className="mnu-field" style={field} type="number" min="0" value={form.priceDelivery} onChange={(e) => setForm({ ...form, priceDelivery: Number(e.target.value) })} />
        <div className="mnu-price-breakdown"><span>ต้นทุน ฿{money(totalCost)}</span><span>กำไร ฿{money(form.priceDelivery - totalCost)}/แก้ว</span></div>
      </div>

      {platforms.length > 0 && (
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: "#9C9690", textTransform: "uppercase", letterSpacing: ".03em", margin: "4px 0 8px" }}>หลังหักค่า GP แพลตฟอร์ม (คำนวณจากราคาเดลิเวอรี่ฐาน)</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {platforms.map((p) => {
              const net = form.priceDelivery * (1 - p.gpPercent / 100);
              const netProfit = net - totalCost;
              const pctMargin = form.priceDelivery > 0 ? (netProfit / form.priceDelivery) * 100 : 0;
              return (
                <div key={p.id} className="mnu-platform-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1F2937" }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#9C9690" }}>GP {p.gpPercent}% · สุทธิ ฿{money(net)} · กำไร ฿{money(netProfit)}</div>
                  </div>
                  <MnuMarginTag pct={pctMargin} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuOptionsTab({ form, optionGroups, toggleOptionGroup }) {
  if (optionGroups.length === 0) return <EmptyNote text='ยังไม่มีกลุ่มตัวเลือกให้เลือก (ตั้งค่าได้ในแท็บ "ตัวเลือกเสริม")' />;
  return (
    <div>
      <p style={{ fontSize: 12, color: "#9C9690", margin: "0 0 8px", lineHeight: 1.5 }}>ตัวเลือกเสริมที่ลูกค้าจะเห็นตอนสั่งเมนูนี้</p>
      {optionGroups.map((g) => (
        <label key={g.id} className="mnu-option-row">
          <OptgToggle checked={form.optionGroupIds.includes(g.id)} onChange={() => toggleOptionGroup(g.id)} color={POS.primary} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1F2937", flex: 1 }}>{g.name}</span>
          {g.required && <span className="mnu-required-chip">บังคับเลือก</span>}
        </label>
      ))}
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

  // ลำดับในอาเรย์คือลำดับที่แสดงในหมวด "ดีลพิเศษ" หน้าลูกค้า สลับตำแหน่งกับตัวข้างเคียงแล้วบันทึกทันที
  function movePromo(id, dir) {
    updateData((next) => {
      const list = next.promotions || [];
      const idx = list.findIndex((p) => p.id === id);
      const swapIdx = idx + dir;
      if (idx === -1 || swapIdx < 0 || swapIdx >= list.length) return;
      [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
    });
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
          {promotions.map((promo, idx) => {
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
              <div key={promo.id} style={glass({ borderRadius: 12, padding: 14, opacity: promo.active === false || promoWin === "expired" ? 0.55 : 1 })}>
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
                    <button className="cbtn" disabled={idx === 0} onClick={() => movePromo(promo.id, -1)} title="เลื่อนขึ้น" style={{ padding: "4px 6px", opacity: idx === 0 ? 0.35 : 1, cursor: idx === 0 ? "not-allowed" : "pointer" }}><Icon name="chevron-up" size={13} /></button>
                    <button className="cbtn" disabled={idx === promotions.length - 1} onClick={() => movePromo(promo.id, 1)} title="เลื่อนลง" style={{ padding: "4px 6px", opacity: idx === promotions.length - 1 ? 0.35 : 1, cursor: idx === promotions.length - 1 ? "not-allowed" : "pointer" }}><Icon name="chevron-down" size={13} /></button>
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

// ต้นทุน/หน่วยของวัตถุดิบผสม = ค่าเฉลี่ยถ่วงน้ำหนักจากสัดส่วนวัตถุดิบจริงที่ประกอบขึ้น ไว้แสดงผลเฉยๆ ไม่ได้เก็บ/ตัดสต็อกจากค่านี้ตรงๆ
function compositeCostPerUnit(ing, ingredientsById) {
  const totalRatio = ing.components.reduce((s, c) => s + (Number(c.ratio) || 0), 0) || 1;
  return round4(ing.components.reduce((s, c) => {
    const comp = ingredientsById[c.ingredientId];
    return s + (comp ? comp.costPerUnit * ((Number(c.ratio) || 0) / totalRatio) : 0);
  }, 0));
}

function compositionLabel(ing, ingredientsById) {
  const totalRatio = ing.components.reduce((s, c) => s + (Number(c.ratio) || 0), 0) || 1;
  return ing.components.map((c) => {
    const comp = ingredientsById[c.ingredientId];
    const pct = round4(((Number(c.ratio) || 0) / totalRatio) * 100);
    return `${comp ? comp.name : "?"} ${pct}%`;
  }).join(" + ");
}

// พาเลตสีเฉพาะหน้าวัตถุดิบ & สต็อก (Inventory) — ระบบสีความหมาย (semantic) ใช้น้ำเงินเป็นสีหลัก
// แยกจากธีม sage/espresso ของแท็บอื่น เพื่อให้หน้านี้ดูเป็น enterprise inventory ที่อ่านง่ายในการใช้งานทุกวัน
const INV = {
  primary: "#2563EB", primaryDark: "#1D4ED8", primarySoft: "rgba(37,99,235,.08)",
  success: "#16A34A", successSoft: "#EAF7EE",
  warning: "#D97706", warningSoft: "#FFF4E5",
  danger: "#DC2626", dangerSoft: "#FDECEC",
  gray: "#6B7280", ink: "#111827", border: "#ECE8E2", line: "#F1EFEA",
};

// ปิด overlay ด้วยปุ่ม Escape — ใช้ร่วมกันทุก modal/drawer ของหน้าวัตถุดิบ
function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

// จำนวนสต็อกอ่านง่ายขึ้นด้วยตัวคั่นหลักพัน (คงทศนิยมไว้ถ้ามี เช่น 1805.002)
function fmtQty(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// สไตล์ฟอร์มกลางของหน้าวัตถุดิบ ใช้ร่วมกันในทุก modal ให้หน้าตาเหมือนกันหมด (input/label/โฟกัสวงแหวนน้ำเงิน)
const invLabelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: INV.gray, marginBottom: 6 };
const invFieldStyle = { width: "100%", height: 44, border: `1px solid ${INV.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 15, color: INV.ink, boxSizing: "border-box", outline: "none", transition: "border-color 160ms, box-shadow 160ms" };
const invFocusProps = {
  onFocus: (e) => { e.currentTarget.style.borderColor = INV.primary; e.currentTarget.style.boxShadow = `0 0 0 3px ${INV.primarySoft}`; },
  onBlur: (e) => { e.currentTarget.style.borderColor = INV.border; e.currentTarget.style.boxShadow = "none"; },
};

function invStatus(ing) {
  if (ing.components && ing.components.length > 0) return "composite";
  if (ing.unlimited) return "unlimited";
  if (ing.stockQty <= 0) return "out";
  if (ing.stockQty <= ing.lowStockThreshold) return "low";
  return "normal";
}

function InvStatusBadge({ status }) {
  const map = {
    normal: { bg: INV.successSoft, color: "#15803D", icon: "circle-check", label: "ปกติ" },
    low: { bg: INV.warningSoft, color: "#B45309", icon: "alert-triangle", label: "ใกล้หมด" },
    out: { bg: INV.dangerSoft, color: "#B91C1C", icon: "alert-octagon", label: "หมดสต็อก" },
    composite: { bg: "#F3F4F6", color: "#4B5563", icon: "flask", label: "คำนวณอัตโนมัติ" },
    unlimited: { bg: INV.primarySoft, color: INV.primaryDark, icon: "infinity", label: "ไม่จำกัด" },
  };
  const t = map[status] || map.normal;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: t.bg, color: t.color, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
      <Icon name={t.icon} size={12} /> {t.label}
    </span>
  );
}

function InvStatCard({ icon, label, value, sub, tone }) {
  const tones = {
    primary: { fg: INV.primaryDark, ic: INV.primary, icbg: INV.primarySoft },
    warning: { fg: INV.warning, ic: INV.warning, icbg: INV.warningSoft },
    danger: { fg: INV.danger, ic: INV.danger, icbg: INV.dangerSoft },
    success: { fg: INV.success, ic: INV.success, icbg: INV.successSoft },
    neutral: { fg: INV.ink, ic: INV.gray, icbg: "#F3F4F6" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div style={{ background: "#fff", border: `1px solid ${INV.border}`, borderRadius: 16, padding: "16px 18px", boxShadow: "0 8px 24px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", gap: 10, minHeight: 104 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: t.icbg, color: t.ic, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={icon} size={15} /></div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: INV.gray }}>{label}</span>
      </div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: t.fg, lineHeight: 1.1, fontFamily: "var(--f-body)" }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: INV.gray, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// เมนู "⋮ เพิ่มเติม" — วางกดจาก viewport (position: fixed) กันโดน overflow ของตารางตัดขอบ (เจอบั๊กแบบนี้มาก่อนในหน้าตัวเลือกเสริม)
function InvActionsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 190, window.innerWidth - 198)) });
    }
    setOpen(!open);
  }
  // เมนูลอยด้วย position: fixed — ต้องปิดเมื่อเลื่อนหน้าจอ/กด Escape ไม่งั้นจะค้างลอยผิดตำแหน่ง
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <>
      <button ref={btnRef} className="inv-icon-btn" onClick={toggle} aria-label="ตัวเลือกเพิ่มเติม" aria-haspopup="menu" aria-expanded={open}>
        <Icon name="dots-vertical" size={16} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div role="menu" style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 61, background: "#fff", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,.16)", border: `1px solid ${INV.border}`, padding: 6, minWidth: 190 }}>
            {items.map((it, i) => (
              <button
                key={i} role="menuitem"
                onClick={() => { setOpen(false); it.onClick(); }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", border: "none", background: "none", padding: "9px 10px", borderRadius: 8, fontSize: 13.5, fontWeight: 500, color: it.danger ? INV.danger : INV.ink, cursor: "pointer", textAlign: "left", minHeight: 40 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = it.danger ? INV.dangerSoft : "#F5F5F3")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <Icon name={it.icon} size={15} style={{ color: it.danger ? INV.danger : INV.gray }} /> {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function InvDrawer({ mode, initial, allIngredients, onClose, onSubmit }) {
  const [form, setForm] = useState(initial);
  useEscape(onClose);
  return (
    <div className="inv-drawer-overlay" onClick={onClose}>
      <div className="inv-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={mode === "add" ? "เพิ่มวัตถุดิบใหม่" : "แก้ไขวัตถุดิบ"}>
        <div className="inv-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: INV.ink }}>{mode === "add" ? "เพิ่มวัตถุดิบใหม่" : "แก้ไขวัตถุดิบ"}</div>
            <div style={{ fontSize: 12.5, color: INV.gray, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {mode === "add" ? "กรอกข้อมูลวัตถุดิบและสต็อกตั้งต้น" : form.name}
            </div>
          </div>
          <button className="inv-icon-btn" onClick={onClose} aria-label="ปิด"><Icon name="x" size={18} /></button>
        </div>
        <div className="inv-drawer-body">
          <IngredientForm value={form} onChange={setForm} onSubmit={() => onSubmit(form)} onCancel={onClose} submitLabel={mode === "add" ? "บันทึกวัตถุดิบ" : "บันทึกการแก้ไข"} allIngredients={allIngredients} />
        </div>
      </div>
    </div>
  );
}

function InvConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  useEscape(onCancel);
  const cancelRef = useRef(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 16 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: 380, maxWidth: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }} role="alertdialog" aria-modal="true">
        <div style={{ width: 44, height: 44, borderRadius: 12, background: INV.dangerSoft, color: INV.danger, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><Icon name="trash" size={20} /></div>
        <div style={{ fontSize: 18, fontWeight: 700, color: INV.ink, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: INV.gray, lineHeight: 1.5, marginBottom: 20 }}>{message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button ref={cancelRef} className="inv-btn-ghost" onClick={onCancel}>ยกเลิก</button>
          <button className="inv-btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function IngredientsPanel({ data, updateData, showToast }) {
  const [restocking, setRestocking] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [drawer, setDrawer] = useState(null); // null | { mode: "add" | "edit", initial }
  const [confirmDel, setConfirmDel] = useState(null);
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("invCollapsed") || "{}"); } catch { return {}; }
  });
  const blankIng = { name: "", category: "coffee", unit: "g", costPerUnit: 0, stockQty: 0, lowStockThreshold: 100, altGroup: "", altUpcharge: 0, components: [] };
  const ingredientsById = useMemo(() => {
    const m = {};
    for (const i of data.ingredients) m[i.id] = i;
    return m;
  }, [data.ingredients]);

  function toggleCat(id) {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem("invCollapsed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

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

  function doAdjustStock(id, countedQty) {
    updateData((next) => {
      const ing = next.ingredients.find((i) => i.id === id);
      if (!ing) return;
      ing.stockQty = round4(countedQty);
    });
    setAdjusting(null);
    showToast("ปรับปรุงสต็อกให้ตรงกับที่นับได้แล้ว");
  }

  function addIngredient(v) {
    if (!v.name.trim()) { showToast("กรุณาใส่ชื่อวัตถุดิบ"); return; }
    const components = (v.components || []).filter((c) => c.ingredientId);
    if ((v.components || []).length > 0 && components.length === 0) { showToast("กรุณาเลือกวัตถุดิบในสูตรผสมให้ครบ"); return; }
    updateData((next) => { next.ingredients.push({ ...v, altGroup: v.altGroup || null, components, id: genId("ing") }); });
    setDrawer(null);
    showToast("เพิ่มวัตถุดิบแล้ว");
  }

  function saveEdit(ing) {
    const components = (ing.components || []).filter((c) => c.ingredientId);
    if ((ing.components || []).length > 0 && components.length === 0) { showToast("กรุณาเลือกวัตถุดิบในสูตรผสมให้ครบ"); return; }
    ing = { ...ing, components };
    updateData((next) => {
      const idx = next.ingredients.findIndex((i) => i.id === ing.id);
      next.ingredients[idx] = { ...ing, altGroup: ing.altGroup || null };
    });
    setDrawer(null);
    showToast("บันทึกแล้ว");
  }

  function duplicateIngredient(ing) {
    updateData((next) => {
      next.ingredients.push({ ...ing, id: genId("ing"), name: ing.name + " (สำเนา)" });
    });
    showToast("ทำสำเนาวัตถุดิบแล้ว");
  }

  function deleteIngredient(id) {
    updateData((next) => { next.ingredients = next.ingredients.filter((i) => i.id !== id); });
    setConfirmDel(null);
    showToast("ลบวัตถุดิบแล้ว");
  }

  // ตัวกรอง/ค้นหา/เรียงลำดับ ทำงานทันทีบนข้อมูลจริง (data.ingredients) — ไม่แตะ business logic การตัดสต็อก
  const forcedOpen = query.trim() !== "" || statusFilter !== "all";
  function visibleItems(items) {
    let out = items;
    if (query.trim()) { const q = query.trim().toLowerCase(); out = out.filter((i) => i.name.toLowerCase().includes(q)); }
    if (statusFilter !== "all") out = out.filter((i) => invStatus(i) === statusFilter);
    return [...out].sort((a, b) => {
      if (sortBy === "stock") return (a.stockQty / (a.lowStockThreshold || 1)) - (b.stockQty / (b.lowStockThreshold || 1));
      if (sortBy === "value") return (b.stockQty * b.costPerUnit) - (a.stockQty * a.costPerUnit);
      return a.name.localeCompare(b.name, "th");
    });
  }

  // วัตถุดิบ "จับต้องได้จริง" = ไม่ใช่ของผสม และไม่ใช่ของไม่จำกัด (น้ำประปา/น้ำแข็ง) — ใช้คิดมูลค่าคลัง/แจ้งเตือน
  const tracked = data.ingredients.filter((i) => !(i.components && i.components.length > 0) && !i.unlimited);
  const lowCount = tracked.filter((i) => i.stockQty > 0 && i.stockQty <= i.lowStockThreshold).length;
  const outCount = tracked.filter((i) => i.stockQty <= 0).length;
  const invValue = tracked.reduce((s, i) => s + i.stockQty * i.costPerUnit, 0);
  const catCount = CATEGORIES.filter((c) => data.ingredients.some((i) => i.category === c.id)).length;

  const renderedCats = CATEGORIES
    .filter((c) => catFilter === "all" || catFilter === c.id)
    .map((cat) => {
      const allItems = data.ingredients.filter((i) => i.category === cat.id);
      if (allItems.length === 0) return null;
      const items = visibleItems(allItems);
      if (items.length === 0) return null;
      const isOpen = forcedOpen || !collapsed[cat.id];
      return { cat, allCount: allItems.length, items, isOpen };
    })
    .filter(Boolean);

  return (
    <div className="inv-wrap">
      <style>{`
        .inv-wrap { --pri: ${INV.primary}; }
        .inv-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        .inv-kpi-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin-bottom: 24px; }
        @media (max-width: 1100px) { .inv-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 620px) { .inv-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .inv-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }
        .inv-search { flex: 1; min-width: 200px; position: relative; display: flex; align-items: center; }
        .inv-search input { width: 100%; height: 44px; border: 1px solid ${INV.border}; border-radius: 12px; background: #fff; padding: 0 38px 0 38px; font-size: 14px; color: ${INV.ink}; box-sizing: border-box; outline: none; transition: border 160ms, box-shadow 160ms; }
        .inv-search input:focus { border-color: ${INV.primary}; box-shadow: 0 0 0 3px ${INV.primarySoft}; }
        .inv-clear { position: absolute; right: 8px; width: 26px; height: 26px; border: none; background: #F0EFEC; border-radius: 8px; color: ${INV.gray}; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .inv-select { height: 44px; border: 1px solid ${INV.border}; border-radius: 12px; background: #fff; padding: 0 32px 0 14px; font-size: 13.5px; font-weight: 600; color: ${INV.ink}; cursor: pointer; outline: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; }
        .inv-select:focus { border-color: ${INV.primary}; box-shadow: 0 0 0 3px ${INV.primarySoft}; }
        .inv-btn-primary { display: inline-flex; align-items: center; gap: 7px; height: 44px; padding: 0 18px; border: none; border-radius: 12px; background: ${INV.primary}; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 18px rgba(37,99,235,.28); transition: background 160ms; }
        .inv-btn-primary:hover { background: ${INV.primaryDark}; }
        .inv-btn-ghost { height: 40px; padding: 0 16px; border: 1px solid ${INV.border}; border-radius: 10px; background: #fff; color: ${INV.ink}; font-size: 13.5px; font-weight: 600; cursor: pointer; }
        .inv-btn-danger { height: 40px; padding: 0 16px; border: none; border-radius: 10px; background: ${INV.danger}; color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer; }
        .inv-add-stock { display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 12px; border: 1px solid ${INV.primary}; border-radius: 9px; background: ${INV.primarySoft}; color: ${INV.primaryDark}; font-size: 12.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
        .inv-add-stock:hover { background: rgba(37,99,235,.14); }
        .inv-icon-btn { width: 36px; height: 36px; border: 1px solid ${INV.border}; border-radius: 9px; background: #fff; color: ${INV.gray}; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .inv-icon-btn:hover { background: #F5F5F3; color: ${INV.ink}; }
        .inv-cat { background: #fff; border: 1px solid ${INV.border}; border-radius: 16px; margin-bottom: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.04); }
        .inv-cat-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 14px 18px; border: none; background: none; cursor: pointer; text-align: left; transition: background 140ms ease; }
        .inv-cat-head:hover { background: #FAFAF8; }
        .inv-cat-head .inv-chev { transition: transform 180ms ease; }
        .inv-toolbar-spacer { flex: 1; min-width: 0; }
        .inv-cat-title { font-size: 15px; font-weight: 700; color: ${INV.ink}; }
        .inv-cat-count { font-size: 12px; font-weight: 700; color: ${INV.gray}; background: #F3F4F6; border-radius: 999px; padding: 2px 9px; }
        .inv-table-scroll { overflow-x: auto; }
        .inv-table { width: 100%; border-collapse: collapse; }
        .inv-table th { text-align: left; font-size: 11.5px; font-weight: 700; color: ${INV.gray}; padding: 9px 14px; border-top: 1px solid ${INV.line}; border-bottom: 1px solid ${INV.line}; background: #FBFAF8; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }
        .inv-table td { padding: 12px 14px; border-bottom: 1px solid #F5F3EF; font-size: 13.5px; color: ${INV.ink}; vertical-align: middle; }
        .inv-table tbody tr:last-child td { border-bottom: none; }
        .inv-table tbody tr:hover { background: #FAFAF8; }
        .inv-actions-cell { text-align: right; white-space: nowrap; }
        .inv-row-actions { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
        .inv-drawer-overlay { position: fixed; inset: 0; background: rgba(17,24,39,.35); z-index: 70; display: flex; justify-content: flex-end; animation: invFade 160ms ease; }
        .inv-drawer { width: min(560px, 100%); height: 100%; background: var(--surface, #fff); box-shadow: -8px 0 40px rgba(0,0,0,.18); display: flex; flex-direction: column; animation: invSlide 240ms cubic-bezier(.2,.8,.2,1); }
        .inv-drawer-head { padding: 20px 24px; border-bottom: 1px solid ${INV.border}; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .inv-drawer-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
        @keyframes invFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes invSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes invSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @media (max-width: 560px) {
          .inv-drawer-overlay { align-items: flex-end; }
          .inv-drawer { width: 100%; height: auto; max-height: 92vh; border-radius: 20px 20px 0 0; animation: invSheet 240ms cubic-bezier(.2,.8,.2,1); }
        }
        @media (max-width: 900px) {
          .inv-table thead { display: none; }
          .inv-table, .inv-table tbody, .inv-table tr, .inv-table td { display: block; width: 100%; box-sizing: border-box; }
          .inv-table tr { padding: 6px 4px 10px; border-bottom: 1px solid ${INV.line}; }
          .inv-table tbody tr:last-child { border-bottom: none; }
          .inv-table td { border: none; padding: 5px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
          .inv-table td::before { content: attr(data-label); font-size: 11.5px; color: ${INV.gray}; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
          .inv-table td.inv-actions-cell { justify-content: flex-end; padding-top: 8px; }
          .inv-table td.inv-actions-cell::before { content: none; }
          .inv-table td.inv-name-cell { flex-direction: column; align-items: flex-start; gap: 3px; }
          .inv-table td.inv-name-cell::before { content: none; }
        }
      `}</style>

      <div className="inv-kpi-grid">
        <InvStatCard icon="package" label="วัตถุดิบทั้งหมด" value={data.ingredients.length} sub={`${catCount} หมวดหมู่`} tone="primary" />
        <InvStatCard icon="alert-triangle" label="ใกล้หมด" value={lowCount} sub={lowCount ? "ควรเติมสต็อก" : "อยู่ในเกณฑ์"} tone={lowCount ? "warning" : "neutral"} />
        <InvStatCard icon="alert-octagon" label="หมดสต็อก" value={outCount} sub={outCount ? "ต้องเติมด่วน" : "ไม่มี"} tone={outCount ? "danger" : "neutral"} />
        <InvStatCard icon="coin" label="มูลค่าสต็อก" value={"฿" + money(invValue)} sub="ไม่รวมของไม่จำกัด" tone="neutral" />
        <InvStatCard icon="category" label="หมวดหมู่" value={catCount} sub={`จาก ${CATEGORIES.length} หมวด`} tone="neutral" />
      </div>

      <div className="inv-toolbar">
        <div className="inv-search">
          <Icon name="search" size={15} style={{ position: "absolute", left: 13, color: INV.gray }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาวัตถุดิบ..." aria-label="ค้นหาวัตถุดิบ" />
          {query && <button className="inv-clear" onClick={() => setQuery("")} aria-label="ล้างการค้นหา"><Icon name="x" size={13} /></button>}
        </div>
        <select className="inv-select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="กรองตามหมวด">
          <option value="all">ทุกหมวด</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className="inv-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="กรองตามสถานะ">
          <option value="all">ทุกสถานะ</option>
          <option value="normal">ปกติ</option>
          <option value="low">ใกล้หมด</option>
          <option value="out">หมดสต็อก</option>
          <option value="composite">วัตถุดิบผสม</option>
        </select>
        <select className="inv-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="เรียงลำดับ">
          <option value="name">เรียง: ชื่อ</option>
          <option value="stock">เรียง: สต็อกน้อย→มาก</option>
          <option value="value">เรียง: มูลค่ามาก→น้อย</option>
        </select>
        <div className="inv-toolbar-spacer" />
        <button className="inv-btn-primary" onClick={() => setDrawer({ mode: "add", initial: blankIng })}><Icon name="plus" size={16} /> เพิ่มวัตถุดิบ</button>
      </div>

      {renderedCats.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", background: "#fff", border: `1px solid ${INV.border}`, borderRadius: 16 }}>
          <Icon name="search-off" size={30} style={{ color: INV.gray, opacity: 0.5 }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: INV.ink, margin: "12px 0 2px" }}>ไม่พบวัตถุดิบที่ตรงกับเงื่อนไข</p>
          <p style={{ fontSize: 12.5, color: INV.gray, margin: 0 }}>ลองปรับคำค้นหาหรือตัวกรอง</p>
        </div>
      ) : renderedCats.map(({ cat, allCount, items, isOpen }) => (
        <div key={cat.id} className="inv-cat">
          <button className="inv-cat-head" style={{ borderRadius: isOpen ? "16px 16px 0 0" : 16 }} onClick={() => toggleCat(cat.id)} aria-expanded={isOpen}>
            <Icon name="chevron-right" size={16} className="inv-chev" style={{ color: INV.gray, flexShrink: 0, transform: isOpen ? "rotate(90deg)" : "none" }} />
            <span className="inv-cat-title">{cat.label}</span>
            <span className="inv-cat-count">{items.length < allCount ? `${items.length}/${allCount}` : allCount}</span>
          </button>
          {isOpen && (
            <div className="inv-table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>รายการ</th><th>สต็อก</th><th>หน่วย</th><th>ต้นทุน/หน่วย</th><th>กลุ่มทางเลือก</th><th>สถานะ</th><th style={{ textAlign: "right" }}>จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((ing) => {
                    const isMix = ing.components && ing.components.length > 0;
                    const status = invStatus(ing);
                    const noStock = isMix || ing.unlimited; // ไม่ติดตามจำนวนสต็อก
                    const stockLow = !noStock && ing.stockQty <= ing.lowStockThreshold;
                    return (
                      <tr key={ing.id}>
                        <td className="inv-name-cell" data-label="รายการ">
                          <span style={{ fontWeight: 600 }}>{ing.name}</span>
                          {isMix && (
                            <span style={{ fontSize: 11, color: INV.gray, display: "flex", alignItems: "center", gap: 4 }}>
                              <Icon name="flask" size={11} /> ผสม: {compositionLabel(ing, ingredientsById)}
                            </span>
                          )}
                        </td>
                        <td data-label="สต็อก" style={{ whiteSpace: "nowrap", fontWeight: stockLow ? 700 : 500, color: noStock ? INV.gray : stockLow ? INV.danger : INV.ink }}>
                          {isMix ? "ตัดตามสัดส่วน" : ing.unlimited ? "ไม่จำกัด" : fmtQty(ing.stockQty)}
                        </td>
                        <td data-label="หน่วย" style={{ color: INV.gray, whiteSpace: "nowrap" }}>{isMix ? "—" : UNITS[ing.unit]}</td>
                        <td data-label="ต้นทุน/หน่วย" style={{ whiteSpace: "nowrap" }}><span>฿{money(isMix ? compositeCostPerUnit(ing, ingredientsById) : ing.costPerUnit)}<span style={{ color: INV.gray }}>/{UNITS[ing.unit]}</span></span></td>
                        <td data-label="กลุ่มทางเลือก" style={{ color: ing.altGroup ? INV.ink : INV.gray }}>{ing.altGroup ? `${ing.altGroup}${ing.altUpcharge ? ` (+฿${ing.altUpcharge})` : ""}` : "—"}</td>
                        <td data-label="สถานะ"><InvStatusBadge status={status} /></td>
                        <td className="inv-actions-cell" data-label="">
                          <div className="inv-row-actions">
                            {!noStock && (
                              <button className="inv-add-stock" onClick={() => setRestocking(ing.id)}><Icon name="plus" size={13} /> เติมสต็อก</button>
                            )}
                            <InvActionsMenu
                              items={[
                                ...(!noStock ? [{ icon: "adjustments", label: "ปรับสต็อก (นับจริง)", onClick: () => setAdjusting(ing.id) }] : []),
                                { icon: "edit", label: "แก้ไข", onClick: () => setDrawer({ mode: "edit", initial: ing }) },
                                { icon: "copy", label: "ทำสำเนา", onClick: () => duplicateIngredient(ing) },
                                { icon: "trash", label: "ลบ", danger: true, onClick: () => setConfirmDel(ing) },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 8 }}>
        <DefaultPackagingSection data={data} updateData={updateData} />
      </div>

      {restocking && (
        <RestockModal ingredient={data.ingredients.find((i) => i.id === restocking)} onClose={() => setRestocking(null)} onConfirm={doRestock} />
      )}
      {adjusting && (
        <StockAdjustModal ingredient={data.ingredients.find((i) => i.id === adjusting)} onClose={() => setAdjusting(null)} onConfirm={doAdjustStock} />
      )}
      {drawer && (
        <InvDrawer
          key={drawer.mode + (drawer.initial?.id || "new")}
          mode={drawer.mode}
          initial={drawer.initial}
          allIngredients={data.ingredients}
          onClose={() => setDrawer(null)}
          onSubmit={drawer.mode === "add" ? addIngredient : saveEdit}
        />
      )}
      {confirmDel && (
        <InvConfirmDialog
          title="ลบวัตถุดิบนี้?"
          message={`คุณกำลังจะลบ "${confirmDel.name}" ออกจากคลังถาวร การกระทำนี้ย้อนกลับไม่ได้`}
          confirmLabel="ลบวัตถุดิบ"
          onConfirm={() => deleteIngredient(confirmDel.id)}
          onCancel={() => setConfirmDel(null)}
        />
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
    <div style={{ background: "#fff", border: `1px solid ${INV.border}`, borderRadius: 16, padding: 20, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: "#F3F4F6", color: INV.gray, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="box" size={16} /></div>
        <span style={{ fontSize: 15, fontWeight: 700, color: INV.ink }}>บรรจุภัณฑ์เริ่มต้นสำหรับเมนูใหม่</span>
      </div>
      <p style={{ fontSize: 12, color: INV.gray, margin: "0 0 16px 40px", lineHeight: 1.5 }}>
        ตั้งไว้ครั้งเดียว ระบบจะใส่รายการเหล่านี้ให้อัตโนมัติทุกครั้งที่กด "เพิ่มเมนู" ใหม่ (แก้ไขเพิ่ม/ลบต่อเมนูได้ตามปกติภายหลัง)
      </p>
      {lines.map((line, idx) => (
        <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <select {...invFocusProps} style={{ ...invFieldStyle, flex: 1, height: 42 }} value={line.ingredientId} onChange={(e) => updateLine(idx, { ingredientId: e.target.value })}>
            {packagingIngredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input {...invFocusProps} style={{ ...invFieldStyle, width: 90, height: 42 }} type="number" min="0" value={line.qty} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} />
          <button className="inv-icon-btn" style={{ width: 42, height: 42 }} onClick={() => removeLine(idx)} aria-label="ลบรายการนี้"><Icon name="x" size={15} /></button>
        </div>
      ))}
      <button className="inv-btn-ghost" style={{ height: 40 }} onClick={addLine}><Icon name="plus" size={14} /> เพิ่มบรรจุภัณฑ์เริ่มต้น</button>
    </div>
  );
}

function IngredientForm({ value, onChange, onSubmit, onCancel, submitLabel, allIngredients }) {
  const isMix = value.components && value.components.length > 0;
  const pickable = (allIngredients || []).filter((i) => i.id !== value.id && (!i.components || i.components.length === 0));
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const canSave = value.name.trim() !== "";

  function toggleMix(on) {
    onChange({ ...value, components: on ? [{ ingredientId: "", ratio: 1 }] : [] });
  }
  function setComponent(idx, patch) {
    const components = value.components.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange({ ...value, components });
  }
  function addComponent() {
    onChange({ ...value, components: [...value.components, { ingredientId: "", ratio: 1 }] });
  }
  function removeComponent(idx) {
    onChange({ ...value, components: value.components.filter((_, i) => i !== idx) });
  }

  const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: INV.gray, marginBottom: 5 };
  const field = { width: "100%", height: 42, border: `1px solid ${INV.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 14, color: INV.ink, boxSizing: "border-box", outline: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <style>{`
        .inv-form-field:focus { border-color: ${INV.primary} !important; box-shadow: 0 0 0 3px ${INV.primarySoft}; }
        .inv-form-sec-title { font-size: 12.5px; font-weight: 700; color: ${INV.gray}; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 12px; }
        .inv-form-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 420px) { .inv-form-grid2 { grid-template-columns: 1fr; } }
      `}</style>

      {/* หมวด 1 — ข้อมูลพื้นฐาน */}
      <div>
        <p className="inv-form-sec-title">ข้อมูลพื้นฐาน</p>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>ชื่อวัตถุดิบ</label>
          <input ref={nameRef} className="inv-form-field" style={field} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="เช่น นมสด, เมล็ดกาแฟ" />
        </div>
        <div className="inv-form-grid2">
          <div>
            <label style={lbl}>หมวดหมู่</label>
            <select className="inv-form-field" style={field} value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>หน่วยนับ</label>
            <select className="inv-form-field" style={field} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value })}>
              {Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* หมวด 2 — สต็อก & ต้นทุน (ซ่อนเมื่อเป็นวัตถุดิบผสม เพราะไม่มีสต็อก/ต้นทุนของตัวเอง) */}
      {!isMix && (
        <div>
          <p className="inv-form-sec-title">สต็อก & ต้นทุน</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <OptgToggle checked={!!value.unlimited} onChange={(on) => onChange({ ...value, unlimited: on })} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: INV.ink }}>ไม่จำกัดสต็อก</span>
            <span title="สำหรับของที่มีไม่จำกัด เช่น น้ำประปากรอง/น้ำแข็ง — ระบบจะไม่ตัดสต็อก ไม่นับเข้ามูลค่าคลัง และไม่แจ้งเตือนใกล้หมด (ต้นทุนในสูตรยังคิดตามปกติ)" style={{ display: "inline-flex", cursor: "help", color: INV.gray }}>
              <Icon name="info-circle" size={15} />
            </span>
          </div>
          <div className="inv-form-grid2">
            {!value.unlimited && (
              <>
                <div>
                  <label style={lbl}>สต็อกปัจจุบัน</label>
                  <input className="inv-form-field" style={field} type="number" min="0" value={value.stockQty} onChange={(e) => onChange({ ...value, stockQty: Number(e.target.value) })} />
                </div>
                <div>
                  <label style={lbl}>แจ้งเตือนเมื่อต่ำกว่า</label>
                  <input className="inv-form-field" style={field} type="number" min="0" value={value.lowStockThreshold} onChange={(e) => onChange({ ...value, lowStockThreshold: Number(e.target.value) })} />
                </div>
              </>
            )}
            <div>
              <label style={lbl}>ต้นทุนต่อหน่วย (บาท)</label>
              <input className="inv-form-field" style={field} type="number" min="0" value={value.costPerUnit} onChange={(e) => onChange({ ...value, costPerUnit: Number(e.target.value) })} />
            </div>
            <div>
              <label style={lbl}>ส่วนต่างราคา (บาท)</label>
              <input className="inv-form-field" style={field} type="number" min="0" value={value.altUpcharge} onChange={(e) => onChange({ ...value, altUpcharge: Number(e.target.value) })} />
            </div>
          </div>
        </div>
      )}

      {/* หมวด 3 — ตัวเลือก & สูตรผสม */}
      <div>
        <p className="inv-form-sec-title">ตัวเลือก & สูตรผสม</p>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>กลุ่มทางเลือก (เช่น milk, bean)</label>
          <input className="inv-form-field" style={field} value={value.altGroup || ""} onChange={(e) => onChange({ ...value, altGroup: e.target.value })} placeholder="ไม่มี" />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: isMix ? 12 : 0 }}>
          <OptgToggle checked={isMix} onChange={toggleMix} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: INV.ink }}>วัตถุดิบผสม</span>
          <span title="วัตถุดิบนี้ไม่มีสต็อกของตัวเอง ระบบจะตัดสต็อกจากวัตถุดิบอื่นตามสัดส่วนที่กำหนด (เช่น mix milk = นมข้นหวาน + นมจืด 2:1)" style={{ display: "inline-flex", cursor: "help", color: INV.gray }}>
            <Icon name="info-circle" size={15} />
          </span>
        </div>

        {isMix && (
          <div style={{ background: "#FBFAF8", border: `1px solid ${INV.line}`, borderRadius: 12, padding: 14 }}>
            <p style={{ fontSize: 11.5, color: INV.gray, margin: "0 0 10px", lineHeight: 1.5 }}>
              ใส่เป็นตัวเลขสัดส่วน เช่น 2 กับ 1 = 2:1 (ไม่ต้องรวมเป็น 100) ระบบจะตัดสต็อกวัตถุดิบจริงแต่ละตัวตามสัดส่วนนี้
            </p>
            {value.components.map((c, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <select className="inv-form-field" style={{ ...field, flex: 1, height: 38 }} value={c.ingredientId} onChange={(e) => setComponent(idx, { ingredientId: e.target.value })}>
                  <option value="">— เลือกวัตถุดิบ —</option>
                  {pickable.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <input className="inv-form-field" style={{ ...field, width: 74, height: 38 }} type="number" min="0" value={c.ratio} onChange={(e) => setComponent(idx, { ratio: Number(e.target.value) })} placeholder="สัดส่วน" />
                <button className="inv-icon-btn" style={{ width: 38, height: 38 }} onClick={() => removeComponent(idx)} aria-label="ลบวัตถุดิบในสูตร"><Icon name="x" size={14} /></button>
              </div>
            ))}
            <button className="inv-btn-ghost" style={{ height: 36, fontSize: 12.5 }} onClick={addComponent}><Icon name="plus" size={13} /> เพิ่มวัตถุดิบในสูตร</button>
          </div>
        )}
      </div>

      {/* หมวด 4 — บันทึก */}
      <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
        {onCancel && <button className="inv-btn-ghost" style={{ height: 44, flex: "0 0 auto" }} onClick={onCancel}>ยกเลิก</button>}
        <button className="inv-btn-primary" style={{ flex: 1, justifyContent: "center", opacity: canSave ? 1 : 0.55, cursor: canSave ? "pointer" : "not-allowed" }} disabled={!canSave} onClick={onSubmit}>{submitLabel}</button>
      </div>
    </div>
  );
}

function InvModalShell({ icon, iconTone, title, subtitle, onClose, children }) {
  const tones = {
    primary: { bg: INV.primarySoft, color: INV.primary },
    neutral: { bg: "#F3F4F6", color: INV.gray },
  };
  const t = tones[iconTone] || tones.primary;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} style={{ background: "#fff", borderRadius: 18, padding: 24, width: 380, maxWidth: "100%", boxShadow: "0 24px 64px rgba(0,0,0,.28)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: t.bg, color: t.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={icon} size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: INV.ink }}>{title}</div>
            <div style={{ fontSize: 12.5, color: INV.gray, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>
          </div>
          <button className="inv-icon-btn" onClick={onClose} aria-label="ปิด" style={{ width: 32, height: 32 }}><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RestockModal({ ingredient, onClose, onConfirm }) {
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const qtyRef = useRef(null);
  useEscape(onClose);
  useEffect(() => { qtyRef.current?.focus(); }, []);
  if (!ingredient) return null;
  const qtyNum = Number(qty) || 0;
  const totalNum = Number(total) || 0;
  const valid = qtyNum > 0;
  const newCost = valid && totalNum > 0 ? totalNum / qtyNum : null;
  function submit(e) { e.preventDefault(); if (valid) onConfirm(ingredient.id, qtyNum, totalNum); }
  return (
    <InvModalShell icon="package-import" iconTone="primary" title="เติมสต็อก" subtitle={ingredient.name} onClose={onClose}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 14 }}>
          <label style={invLabelStyle} htmlFor="rs-qty">ปริมาณที่ซื้อ ({UNITS[ingredient.unit]})</label>
          <input id="rs-qty" ref={qtyRef} {...invFocusProps} style={invFieldStyle} type="number" min="0" value={qty} placeholder="0" onChange={(e) => setQty(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={invLabelStyle} htmlFor="rs-total">ราคาที่จ่ายทั้งหมด (บาท)</label>
          <input id="rs-total" {...invFocusProps} style={invFieldStyle} type="number" min="0" value={total} placeholder="ไม่บังคับ" onChange={(e) => setTotal(e.target.value)} />
        </div>
        <div style={{ background: newCost != null ? INV.primarySoft : "#F7F6F3", borderRadius: 10, padding: "10px 12px", marginBottom: 18, fontSize: 12.5, lineHeight: 1.5, color: newCost != null ? INV.primaryDark : INV.gray }}>
          {valid ? (
            <>
              <div>สต็อกใหม่: <b>{fmtQty(ingredient.stockQty)} → {fmtQty(round4(ingredient.stockQty + qtyNum))} {UNITS[ingredient.unit]}</b></div>
              {newCost != null
                ? <div style={{ marginTop: 2 }}>ต้นทุน/หน่วยใหม่: <b>฿{money(newCost)}/{UNITS[ingredient.unit]}</b> (เดิม ฿{money(ingredient.costPerUnit)})</div>
                : <div style={{ marginTop: 2 }}>ใส่ราคารวมเพื่ออัปเดตต้นทุน/หน่วย (เว้นว่างได้ ต้นทุนเดิมคงไว้)</div>}
            </>
          ) : "กรอกปริมาณที่ซื้อเพื่อดูผลลัพธ์"}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="inv-btn-ghost" style={{ height: 44 }} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="inv-btn-primary" style={{ flex: 1, justifyContent: "center", opacity: valid ? 1 : 0.55, cursor: valid ? "pointer" : "not-allowed" }} disabled={!valid}>เพิ่มสต็อก</button>
        </div>
      </form>
    </InvModalShell>
  );
}

function StockAdjustModal({ ingredient, onClose, onConfirm }) {
  const [counted, setCounted] = useState(ingredient ? String(ingredient.stockQty) : "0");
  const inRef = useRef(null);
  useEscape(onClose);
  useEffect(() => { inRef.current?.select(); }, []);
  if (!ingredient) return null;
  const delta = round4((Number(counted) || 0) - ingredient.stockQty);
  function submit(e) { e.preventDefault(); onConfirm(ingredient.id, Number(counted) || 0); }
  return (
    <InvModalShell icon="clipboard-check" iconTone="neutral" title="ปรับปรุงสต็อก (นับจริง)" subtitle={ingredient.name} onClose={onClose}>
      <form onSubmit={submit}>
        <p style={{ fontSize: 12, color: INV.gray, margin: "0 0 16px", lineHeight: 1.5 }}>
          กรอกจำนวนที่นับได้จริงหน้างาน ระบบจะปรับตัวเลขในระบบให้ตรงทันที (ไม่กระทบต้นทุน/หน่วย)
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F7F6F3", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, color: INV.gray }}>สต็อกในระบบปัจจุบัน</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: INV.ink }}>{fmtQty(ingredient.stockQty)} {UNITS[ingredient.unit]}</span>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={invLabelStyle} htmlFor="adj-count">จำนวนที่นับได้จริง ({UNITS[ingredient.unit]})</label>
          <input id="adj-count" ref={inRef} {...invFocusProps} style={invFieldStyle} type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} />
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 18, color: delta === 0 ? INV.gray : delta > 0 ? INV.success : INV.danger }}>
          {delta === 0 ? "ไม่มีการเปลี่ยนแปลง" : `${delta > 0 ? "+" : ""}${fmtQty(delta)} ${UNITS[ingredient.unit]} จากค่าปัจจุบัน`}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="inv-btn-ghost" style={{ height: 44 }} onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="inv-btn-primary" style={{ flex: 1, justifyContent: "center" }}>ยืนยันปรับสต็อก</button>
        </div>
      </form>
    </InvModalShell>
  );
}

// การเทียบยอดกับ "ช่วงก่อนหน้าที่เท่ากัน" — วันนี้เทียบเมื่อวาน, 7 วันล่าสุดเทียบ 7 วันก่อนหน้านั้น, เดือนนี้เทียบเดือนก่อน
// "ทั้งหมด" ไม่มีช่วงก่อนหน้าให้เทียบ จึงคืน null แล้วการ์ด KPI จะไม่แสดงลูกศร
function prevPeriodSales(allSales, range, now) {
  if (range === "all") return null;
  if (range === "today") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return allSales.filter((s) => todayStr(new Date(s.timestamp)) === todayStr(y));
  }
  if (range === "week") {
    return allSales.filter((s) => { const diff = (now - new Date(s.timestamp)) / 86400000; return diff > 7 && diff <= 14; });
  }
  if (range === "month") {
    const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return allSales.filter((s) => { const d = new Date(s.timestamp); return d.getMonth() === pm.getMonth() && d.getFullYear() === pm.getFullYear(); });
  }
  return null;
}

function pctDelta(cur, prev) {
  if (prev == null) return null;
  if (prev === 0) return cur > 0 ? Infinity : 0;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function RepDeltaTag({ delta }) {
  if (delta == null) return null;
  const flat = Math.abs(delta) < 0.5;
  const up = delta > 0;
  const color = flat ? DASH.gray : up ? DASH.success : DASH.danger;
  const bg = flat ? DASH.neutralSoft : up ? DASH.successSoft : DASH.dangerSoft;
  const label = delta === Infinity ? "ใหม่" : `${flat ? "" : up ? "+" : ""}${delta.toFixed(0)}%`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: bg, color, fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "2px 8px" }}>
      {!flat && <Icon name={up ? "arrow-up-right" : "arrow-down-right"} size={11} />}
      {label}
    </span>
  );
}

function RepKpiCard({ icon, label, value, sub, delta, tone, big }) {
  const tones = {
    primary: { fg: DASH.primaryDark, iconBg: "#fff", iconFg: DASH.primary, bg: DASH.primarySoft, border: "rgba(37,99,235,.18)" },
    success: { fg: DASH.success, iconBg: DASH.successSoft, iconFg: DASH.success, bg: "#fff", border: DASH.border },
    danger: { fg: DASH.danger, iconBg: DASH.dangerSoft, iconFg: DASH.danger, bg: "#fff", border: DASH.border },
    neutral: { fg: DASH.neutral, iconBg: DASH.neutralSoft, iconFg: DASH.neutral, bg: "#fff", border: DASH.border },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 16, padding: "18px 20px", boxShadow: "0 10px 30px rgba(0,0,0,.05)", display: "flex", flexDirection: "column", gap: 10, minHeight: 116 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: t.iconBg, color: t.iconFg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={icon} size={15} /></div>
          <span style={{ fontSize: 13, fontWeight: 600, color: DASH.gray }}>{label}</span>
        </div>
        <RepDeltaTag delta={delta} />
      </div>
      <div>
        <div style={{ fontSize: big ? 32 : 24, fontWeight: 700, color: t.fg, lineHeight: 1.15, fontFamily: "var(--f-body)" }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: DASH.gray, marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

const REP_CHANNEL_META = {
  store: { icon: "building-store", color: DASH.primary, bg: DASH.primarySoft },
  delivery: { icon: "truck-delivery", color: "#B45309", bg: DASH.warningSoft },
  online: { icon: "device-mobile", color: DASH.success, bg: DASH.successSoft },
};

function RepChannelCard({ channel, v, totalRevenue }) {
  const meta = REP_CHANNEL_META[channel];
  const share = totalRevenue > 0 ? Math.round((v.revenue / totalRevenue) * 100) : 0;
  return (
    <div style={{ background: "#fff", border: `1px solid ${DASH.border}`, borderRadius: 16, padding: 18, boxShadow: "0 8px 24px rgba(0,0,0,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: meta.bg, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name={meta.icon} size={14} /></div>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}>{CHANNELS[channel]}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: DASH.gray }}>{share}%</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", fontFamily: "var(--f-body)" }}>฿{money(v.revenue)}</div>
      <div style={{ fontSize: 12, color: DASH.gray, marginTop: 3 }}>กำไร ฿{money(v.profit)} · {v.cups} แก้ว</div>
      <div style={{ height: 5, borderRadius: 999, background: DASH.neutralSoft, marginTop: 10, overflow: "hidden" }}>
        <div style={{ height: "100%", width: share + "%", background: meta.color, borderRadius: 999 }} />
      </div>
    </div>
  );
}

// เรียงตามยอดขาย/กำไรเพื่อแยก "พระเอก" (ขายดี+กำไรดี) กับ "ตัวถ่วง" (ขายดีแต่กำไรบาง)
function RepMenuTable({ rows }) {
  const [sortBy, setSortBy] = useState("revenue");
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sortBy] - a[sortBy]), [rows, sortBy]);
  if (rows.length === 0) return <EmptyNote text="ยังไม่มีข้อมูลการขายในช่วงนี้" />;
  const cols = [["revenue", "รายได้"], ["profit", "กำไร"], ["qty", "จำนวน"]];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {cols.map(([k, label]) => (
          <button key={k} onClick={() => setSortBy(k)} style={{
            border: "none", borderRadius: 8, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
            background: sortBy === k ? DASH.primarySoft : "transparent", color: sortBy === k ? DASH.primaryDark : DASH.gray,
          }}>เรียง: {label}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sorted.slice(0, 8).map((r, i) => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 10, alignItems: "center", padding: "8px 4px", borderBottom: i < sorted.length - 1 ? `1px solid ${DASH.neutralSoft}` : "none" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: DASH.gray }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1F2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
              <div style={{ fontSize: 11, color: DASH.gray, marginTop: 1 }}>{r.qty} แก้ว · margin {r.margin.toFixed(0)}%</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1F2937" }}>฿{money(r.revenue)}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: r.profit >= 0 ? DASH.success : DASH.danger }}>กำไร ฿{money(r.profit)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ยอดขายรวมทุกวันในช่วงที่เลือก แจกแจงตาม "ชั่วโมงของวัน" (0-23) เพื่อดูช่วงเวลาขายดี ไว้จัดกะ/เตรียมของล่วงหน้า
function RepHourlyChart({ sales }) {
  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0 }));
    for (const s of sales) buckets[new Date(s.timestamp).getHours()].revenue += s.netRevenue;
    return buckets;
  }, [sales]);
  const active = hourly.filter((h) => h.revenue > 0);
  if (active.length === 0) return <EmptyNote text="ยังไม่มีข้อมูลการขายในช่วงนี้" />;
  const max = Math.max(1, ...hourly.map((h) => h.revenue));
  const peak = hourly.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const start = Math.max(0, Math.min(...active.map((h) => h.hour)) - 1);
  const end = Math.min(23, Math.max(...active.map((h) => h.hour)) + 1);
  const visible = hourly.slice(start, end + 1);
  return (
    <div>
      <p style={{ fontSize: 12, color: DASH.gray, margin: "-4px 0 12px" }}>
        ช่วงขายดีที่สุด: <b style={{ color: "#1F2937" }}>{peak.hour}:00–{peak.hour + 1}:00</b> (฿{money(peak.revenue)})
      </p>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 100 }}>
        {visible.map((h) => (
          <div key={h.hour} title={`${h.hour}:00 · ฿${money(h.revenue)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
            <div style={{
              width: "100%", height: Math.max(3, (h.revenue / max) * 68), borderRadius: 4,
              background: h.hour === peak.hour ? DASH.primary : "#C7D6FB", transition: "height 300ms ease",
            }} />
            <span style={{ fontSize: 9, color: DASH.gray }}>{h.hour}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RepTrendChart({ days, byDay }) {
  const max = Math.max(1, ...days.map((d) => byDay[d].revenue));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: Math.max(2, Math.min(10, 300 / days.length)), height: 110, padding: "0 2px" }}>
      {days.map((d) => (
        <div key={d} title={`${d} · ฿${money(byDay[d].revenue)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
          <div style={{ width: "100%", maxWidth: 30, height: Math.max(3, (byDay[d].revenue / max) * 62), borderRadius: 5, background: "#C7D6FB", transition: "height 300ms ease" }} />
          {days.length <= 14 && <span style={{ fontSize: 9.5, color: DASH.gray, whiteSpace: "nowrap" }}>{d.slice(5)}</span>}
        </div>
      ))}
    </div>
  );
}

function ReportsPanel({ data }) {
  const [range, setRange] = useState("today");
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [historyLimit, setHistoryLimit] = useState(50);
  const now = useMemo(() => new Date(), []);

  useEffect(() => { setHistoryLimit(50); }, [range, search, channelFilter]);

  const filtered = useMemo(() => {
    return data.sales.filter((s) => {
      const d = new Date(s.timestamp);
      if (range === "today") return todayStr(d) === todayStr(now);
      if (range === "week") { const diff = (now - d) / 86400000; return diff >= 0 && diff <= 7; }
      if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return true;
    });
  }, [data.sales, range, now]);

  const prevSales = useMemo(() => prevPeriodSales(data.sales, range, now), [data.sales, range, now]);

  const revenue = filtered.reduce((a, s) => a + s.netRevenue, 0);
  const cost = filtered.reduce((a, s) => a + s.totalCost, 0);
  const profit = revenue - cost;
  const cups = filtered.reduce((a, s) => a + s.qty, 0);
  const gpTotal = filtered.reduce((a, s) => a + s.gpAmount, 0);
  const discountTotal = filtered.reduce((a, s) => a + (s.promoDiscount || 0), 0);
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  const prevStats = useMemo(() => {
    if (!prevSales) return null;
    const pRevenue = prevSales.reduce((a, s) => a + s.netRevenue, 0);
    const pCost = prevSales.reduce((a, s) => a + s.totalCost, 0);
    return { revenue: pRevenue, cost: pCost, profit: pRevenue - pCost, cups: prevSales.reduce((a, s) => a + s.qty, 0) };
  }, [prevSales]);

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

  const menuRows = useMemo(() => {
    const stats = {};
    for (const s of filtered) {
      if (!stats[s.menuName]) stats[s.menuName] = { name: s.menuName, qty: 0, revenue: 0, cost: 0, profit: 0 };
      const m = stats[s.menuName];
      m.qty += s.qty; m.revenue += s.netRevenue; m.cost += s.totalCost; m.profit += s.profit;
    }
    return Object.values(stats).map((m) => ({ ...m, margin: m.revenue > 0 ? (m.profit / m.revenue) * 100 : 0 }));
  }, [filtered]);

  const byDay = {};
  for (const s of filtered) {
    const d = s.timestamp.slice(0, 10);
    if (!byDay[d]) byDay[d] = { revenue: 0, cost: 0 };
    byDay[d].revenue += s.netRevenue;
    byDay[d].cost += s.totalCost;
  }
  const days = Object.keys(byDay).sort();

  const historyRows = useMemo(() => {
    let out = filtered.slice().reverse();
    if (channelFilter !== "all") out = out.filter((s) => s.channel === channelFilter);
    if (search.trim()) { const q = search.trim().toLowerCase(); out = out.filter((s) => s.menuName.toLowerCase().includes(q)); }
    return out;
  }, [filtered, channelFilter, search]);

  const PERIODS = [["today", "วันนี้"], ["week", "7 วันล่าสุด"], ["month", "เดือนนี้"], ["all", "ทั้งหมด"]];

  return (
    <div className="rep-wrap">
      <style>{`
        .rep-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }
        .rep-period-tabs { display: inline-flex; background: #F0EFEC; border-radius: 12px; padding: 3px; gap: 2px; }
        .rep-period-tab { border: none; cursor: pointer; padding: 8px 14px; min-height: 38px; border-radius: 9px; font-size: 13px; font-weight: 600; background: transparent; color: #6B7280; transition: all 160ms ease; }
        .rep-period-tab.active { background: #fff; color: ${DASH.primaryDark}; box-shadow: 0 2px 6px rgba(0,0,0,.08); }
        .rep-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 20px; }
        @media (max-width: 900px) { .rep-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 480px) { .rep-kpi-grid { grid-template-columns: minmax(0, 1fr); } }
        .rep-channel-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
        @media (max-width: 720px) { .rep-channel-grid { grid-template-columns: minmax(0, 1fr); } }
        .rep-card { background: #fff; border: 1px solid ${DASH.border}; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,.05); margin-bottom: 20px; }
        .rep-two-col { display: grid; grid-template-columns: 1.1fr 1fr; gap: 20px; align-items: start; }
        @media (max-width: 900px) { .rep-two-col { grid-template-columns: minmax(0, 1fr); } }
        .rep-search { flex: 1; min-width: 180px; position: relative; display: flex; align-items: center; }
        .rep-search input { width: 100%; height: 40px; border: 1px solid ${DASH.border}; border-radius: 10px; background: #fff; padding: 0 14px 0 36px; font-size: 13.5px; box-sizing: border-box; outline: none; }
        .rep-search input:focus { border-color: ${DASH.primary}; box-shadow: 0 0 0 3px ${DASH.primarySoft}; }
        .rep-select { height: 40px; border: 1px solid ${DASH.border}; border-radius: 10px; background: #fff; padding: 0 30px 0 12px; font-size: 13px; font-weight: 600; color: #1F2937; cursor: pointer; outline: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; }
        .rep-table { width: 100%; border-collapse: collapse; }
        .rep-table th { text-align: left; font-size: 11px; font-weight: 700; color: ${DASH.gray}; padding: 8px 12px; border-bottom: 1px solid ${DASH.neutralSoft}; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }
        .rep-table td { padding: 10px 12px; border-bottom: 1px solid #F5F3EF; font-size: 13px; color: #1F2937; vertical-align: middle; }
        .rep-table tbody tr:last-child td { border-bottom: none; }
        .rep-table tbody tr:hover { background: #FAFAF8; }
        .rep-load-more { display: block; margin: 12px auto 0; height: 38px; padding: 0 20px; border: 1px solid ${DASH.border}; border-radius: 10px; background: #fff; color: #1F2937; font-size: 12.5px; font-weight: 600; cursor: pointer; }
        .rep-load-more:hover { background: #FAFAF8; }
        @media (max-width: 720px) {
          .rep-table.rep-table-cards thead { display: none; }
          .rep-table.rep-table-cards, .rep-table.rep-table-cards tbody, .rep-table.rep-table-cards tr, .rep-table.rep-table-cards td { display: block; width: 100%; box-sizing: border-box; }
          .rep-table.rep-table-cards tr { padding: 8px 4px 12px; border-bottom: 1px solid ${DASH.neutralSoft}; }
          .rep-table.rep-table-cards tbody tr:last-child { border-bottom: none; }
          .rep-table.rep-table-cards td { border: none; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
          .rep-table.rep-table-cards td::before { content: attr(data-label); font-size: 11px; color: ${DASH.gray}; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
          .rep-table.rep-table-cards td.rep-td-menu { flex-direction: column; align-items: flex-start; gap: 2px; }
          .rep-table.rep-table-cards td.rep-td-menu::before { content: none; }
        }
      `}</style>

      <div className="rep-toolbar">
        <div className="rep-period-tabs">
          {PERIODS.map(([k, label]) => (
            <button key={k} className={"rep-period-tab" + (range === k ? " active" : "")} onClick={() => setRange(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="rep-kpi-grid">
        <RepKpiCard icon="cash" label="รายได้สุทธิ" value={"฿" + money(revenue)} sub={`หัก GP ฿${money(gpTotal)} · ส่วนลด ฿${money(discountTotal)}`} delta={prevStats ? pctDelta(revenue, prevStats.revenue) : null} tone="primary" big />
        <RepKpiCard icon="receipt-2" label="ต้นทุนรวม" value={"฿" + money(cost)} delta={prevStats ? pctDelta(cost, prevStats.cost) : null} tone="neutral" />
        <RepKpiCard icon="trending-up" label="กำไรสุทธิ" value={"฿" + money(profit)} sub={`margin ${margin.toFixed(1)}%`} delta={prevStats ? pctDelta(profit, prevStats.profit) : null} tone={profit >= 0 ? "success" : "danger"} />
        <RepKpiCard icon="cup" label="จำนวนแก้วที่ขาย" value={cups} delta={prevStats ? pctDelta(cups, prevStats.cups) : null} tone="neutral" />
      </div>

      <div className="rep-channel-grid">
        {["store", "delivery", "online"].map((ch) => <RepChannelCard key={ch} channel={ch} v={byChannel[ch]} totalRevenue={revenue} />)}
      </div>

      <div className="rep-two-col">
        <div className="rep-card">
          <DashSectionHeader icon="clock" text="ช่วงเวลาขายดี" hint="รวมทุกวันในช่วงที่เลือก แจกแจงตามชั่วโมง — ใช้จัดกะ/เตรียมของล่วงหน้า" />
          <RepHourlyChart sales={filtered} />
        </div>
        <div className="rep-card">
          <DashSectionHeader icon="trophy" text="เมนูขายดี & ทำกำไร" />
          <RepMenuTable rows={menuRows} />
        </div>
      </div>

      {Object.keys(byPlatform).length > 0 && (
        <div className="rep-card">
          <DashSectionHeader icon="truck-delivery" text="แยกตามแพลตฟอร์มเดลิเวอรี่" />
          <div className="table-scroll">
            <table className="rep-table">
              <thead><tr><th>แพลตฟอร์ม</th><th>แก้ว</th><th>รายได้สุทธิ</th><th>กำไร</th></tr></thead>
              <tbody>
                {Object.entries(byPlatform).map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td><td>{v.cups}</td><td style={{ whiteSpace: "nowrap" }}>฿{money(v.revenue)}</td>
                    <td style={{ whiteSpace: "nowrap", color: v.profit >= 0 ? DASH.success : DASH.danger, fontWeight: 600 }}>฿{money(v.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {range !== "today" && days.length > 0 && (
        <div className="rep-card">
          <DashSectionHeader icon="chart-bar" text="รายได้สุทธิต่อวัน" />
          <RepTrendChart days={days} byDay={byDay} />
        </div>
      )}

      <div className="rep-card">
        <DashSectionHeader icon="list" text="ประวัติการขาย" />
        <div className="rep-toolbar" style={{ marginBottom: 14 }}>
          <div className="rep-search">
            <Icon name="search" size={14} style={{ position: "absolute", left: 12, color: DASH.gray }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาเมนู..." aria-label="ค้นหาเมนูในประวัติการขาย" />
          </div>
          <select className="rep-select" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="กรองตามช่องทาง">
            <option value="all">ทุกช่องทาง</option>
            <option value="store">หน้าร้าน</option>
            <option value="delivery">เดลิเวอรี่</option>
            <option value="online">สั่งออนไลน์</option>
          </select>
        </div>
        {historyRows.length === 0 ? <EmptyNote text="ไม่พบรายการที่ตรงกับเงื่อนไข" /> : (
          <>
            <div className="table-scroll">
              <table className="rep-table rep-table-cards">
                <thead><tr><th>เวลา</th><th>เมนู</th><th>ช่องทาง</th><th>จำนวน</th><th>รายได้สุทธิ</th><th>ต้นทุน</th><th>กำไร</th></tr></thead>
                <tbody>
                  {historyRows.slice(0, historyLimit).map((s) => (
                    <tr key={s.id}>
                      <td data-label="เวลา" style={{ whiteSpace: "nowrap" }}>{new Date(s.timestamp).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td className="rep-td-menu" data-label="เมนู">
                        <span style={{ fontWeight: 600 }}>{s.menuName}{s.milkNote ? ` (${s.milkNote})` : ""}</span>
                        {s.note && <span style={{ fontSize: 11, color: "#92400E", display: "flex", alignItems: "center", gap: 3 }}><Icon name="message-2" size={11} />{s.note}</span>}
                      </td>
                      <td data-label="ช่องทาง" style={{ whiteSpace: "nowrap" }}><ChannelPill channel={s.channel} />{s.platformName ? <span style={{ fontSize: 11, color: DASH.gray }}> {s.platformName}</span> : null}</td>
                      <td data-label="จำนวน">{s.qty}</td>
                      <td data-label="รายได้สุทธิ" style={{ whiteSpace: "nowrap" }}>฿{money(s.netRevenue)}</td>
                      <td data-label="ต้นทุน" style={{ whiteSpace: "nowrap" }}>฿{money(s.totalCost)}</td>
                      <td data-label="กำไร" style={{ whiteSpace: "nowrap", color: s.profit >= 0 ? DASH.success : DASH.danger, fontWeight: 600 }}>฿{money(s.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {historyRows.length > historyLimit && (
              <button className="rep-load-more" onClick={() => setHistoryLimit((n) => n + 50)}>โหลดเพิ่ม ({historyRows.length - historyLimit} รายการที่เหลือ)</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// โทนสีเฉพาะหน้าตัวเลือกเสริม — ระบบสีความหมาย (semantic) แยกจากหน้าอื่น ให้ใช้น้ำเงินเป็นสีหลัก
// เขียว/แดง/ส้มมีความหมายตายตัว (สำเร็จ/อันตราย/เตือน) ไม่ใช้สีพร่ำเพรื่อ
const OPTG = {
  primary: "#2563EB", primaryDark: "#1D4ED8", primarySoft: "rgba(37,99,235,.08)",
  danger: "#DC2626", dangerSoft: "#FDEBEB",
  gold: "#D97706", goldSoft: "#FFF4E5",
  border: "#ECE8E2", gray: "#6B7280", ink: "#1F2937", warm: "#FAF7F2",
};

function OptgToggle({ checked, onChange, label, color }) {
  const c = color || OPTG.primary;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
      <span
        role="switch" aria-checked={checked} tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(!checked); } }}
        style={{
          width: 36, height: 21, borderRadius: 999, background: checked ? c : "#D9D4C9",
          position: "relative", transition: "background 200ms ease", flexShrink: 0, outline: "none",
        }}
        onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 3px ${c}33`)}
        onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 17 : 2, width: 17, height: 17, borderRadius: "50%",
          background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left 200ms ease",
        }} />
      </span>
      {label && <span style={{ fontSize: 12.5, fontWeight: 600, color: OPTG.gray }}>{label}</span>}
    </label>
  );
}

function OptgKebab({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="ตัวเลือกเพิ่มเติม"
        style={{
          width: 30, height: 30, borderRadius: 9, border: `1px solid ${OPTG.border}`, background: "#fff",
          color: OPTG.gray, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}
      ><Icon name="dots-vertical" size={15} /></button>
      {open && (
        <div style={{
          position: "absolute", top: 34, right: 0, zIndex: 8, background: "#fff", border: `1px solid ${OPTG.border}`,
          borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.14)", padding: 5, minWidth: 160, display: "flex", flexDirection: "column", gap: 1,
        }}>
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, border: "none", background: "none", textAlign: "left",
                padding: "8px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                color: it.danger ? OPTG.danger : OPTG.ink,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = it.danger ? OPTG.dangerSoft : "#F3F4F6"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            ><Icon name={it.icon} size={13} />{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionGroupsPanel({ data, updateData, showToast }) {
  const [collapsed, setCollapsed] = useState({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState(data.optionGroups[0]?.id || null);
  const groupRefs = useRef({});

  function addGroup() {
    const id = genId("opt");
    updateData((next) => {
      next.optionGroups.push({ id, name: "ตัวเลือกใหม่", required: false, choices: [] });
    });
    setActiveGroupId(id);
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
      if (g) g.choices.push({ id: genId("choice"), label: "ตัวเลือกใหม่", note: "", priceDelta: 0, ingredientId: null, qtyPercent: 100, isDefault: false, extraAdjustments: [] });
    });
  }
  function addExtraAdjustment(groupId, choiceId) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      const c = g?.choices.find((x) => x.id === choiceId);
      if (c) {
        if (!c.extraAdjustments) c.extraAdjustments = [];
        c.extraAdjustments.push({ ingredientId: null, qtyPercent: 100 });
      }
    });
  }
  function patchExtraAdjustment(groupId, choiceId, idx, patch) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      const c = g?.choices.find((x) => x.id === choiceId);
      if (c && c.extraAdjustments[idx]) Object.assign(c.extraAdjustments[idx], patch);
    });
  }
  function removeExtraAdjustment(groupId, choiceId, idx) {
    updateData((next) => {
      const g = next.optionGroups.find((x) => x.id === groupId);
      const c = g?.choices.find((x) => x.id === choiceId);
      if (c) c.extraAdjustments.splice(idx, 1);
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

  function toggleCollapse(groupId) {
    setCollapsed((p) => ({ ...p, [groupId]: !p[groupId] }));
  }
  function jumpTo(groupId) {
    setActiveGroupId(groupId);
    setCollapsed((p) => ({ ...p, [groupId]: false }));
    groupRefs.current[groupId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const totalGroups = data.optionGroups.length;
  const totalOptions = data.optionGroups.reduce((s, g) => s + g.choices.length, 0);
  const requiredGroups = data.optionGroups.filter((g) => g.required).length;
  const defaultOptions = data.optionGroups.reduce((s, g) => s + g.choices.filter((c) => c.isDefault).length, 0);
  const activeGroup = data.optionGroups.find((g) => g.id === activeGroupId) || data.optionGroups[0];

  return (
    <div>
      <style>{`
        .optg-shell { display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start; }
        @media (max-width: 980px) { .optg-shell { grid-template-columns: 1fr; } }
        .optg-card { background: #fff; border: 1px solid ${OPTG.border}; border-radius: 16px; margin-bottom: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.05); }
        .optg-card-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px; }
        .optg-name-input { border: none; background: transparent; font-size: 17px; font-weight: 700; color: ${OPTG.ink}; padding: 4px 6px; border-radius: 8px; flex: 1; min-width: 0; }
        .optg-name-input:focus { outline: 2px solid ${OPTG.primary}; background: #fff; }
        .optg-collapse-btn { width: 30px; height: 30px; border-radius: 9px; border: 1px solid ${OPTG.border}; background: #fff; color: ${OPTG.gray}; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
        .optg-badge { font-size: 11px; font-weight: 700; color: ${OPTG.primaryDark}; background: ${OPTG.primarySoft}; border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
        .optg-body { padding: 0 18px 18px; }
        .optg-row-head { display: grid; grid-template-columns: 1.1fr 1.3fr .7fr 1.3fr 70px 78px; gap: 10px; padding: 0 10px; margin-bottom: 6px; }
        .optg-row-head span { font-size: 11px; font-weight: 700; color: ${OPTG.gray}; text-transform: uppercase; letter-spacing: .03em; }
        @media (max-width: 760px) { .optg-row-head { display: none; } }
        .optg-choice-row { display: grid; grid-template-columns: 1.1fr 1.3fr .7fr 1.3fr 70px 78px; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 12px; transition: background 150ms ease; }
        .optg-choice-row:hover { background: ${OPTG.warm}; }
        @media (max-width: 760px) { .optg-choice-row { grid-template-columns: 1fr; gap: 6px; padding: 10px; border: 1px solid ${OPTG.border}; margin-bottom: 8px; } }
        .optg-input { width: 100%; border: 1px solid transparent; background: #F3F4F6; border-radius: 9px; padding: 7px 10px; font-size: 13px; color: ${OPTG.ink}; transition: background 150ms ease, border-color 150ms ease; }
        .optg-input:focus { outline: none; background: #fff; border-color: ${OPTG.primary}; }
        .optg-fav-btn { width: 30px; height: 30px; border-radius: 9px; border: 1px solid ${OPTG.border}; background: #fff; color: #C9C2B4; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 150ms ease; }
        .optg-fav-btn.active { background: ${OPTG.goldSoft}; border-color: #F2CB8A; color: ${OPTG.gold}; }
        .optg-add-choice { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; border: 1.5px dashed #C7CEDD; background: ${OPTG.primarySoft}; color: ${OPTG.primaryDark}; border-radius: 12px; padding: 10px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 150ms ease; margin-top: 6px; }
        .optg-add-choice:hover { border-color: ${OPTG.primary}; background: rgba(37,99,235,.14); }
        .optg-extra-toggle { border: none; background: none; color: ${OPTG.gray}; font-size: 11.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 4px 6px; }
        .optg-extra-toggle:hover { color: ${OPTG.primaryDark}; }
        .optg-sidebar { position: sticky; top: 10px; display: flex; flex-direction: column; gap: 16px; }
        .optg-side-card { background: #fff; border: 1px solid ${OPTG.border}; border-radius: 16px; padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.05); }
        .optg-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .optg-stat { background: ${OPTG.warm}; border-radius: 12px; padding: 10px 12px; }
        .optg-stat b { display: block; font-size: 22px; font-weight: 700; color: ${OPTG.ink}; }
        .optg-stat span { font-size: 11px; color: ${OPTG.gray}; font-weight: 600; }
        .optg-nav-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; border: none; background: none; text-align: left; padding: 8px 9px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: ${OPTG.ink}; cursor: pointer; }
        .optg-nav-item:hover { background: ${OPTG.warm}; }
        .optg-nav-item.active { background: ${OPTG.primarySoft}; color: ${OPTG.primaryDark}; }
        .optg-preview-choice { padding: 7px 13px; border-radius: 10px; border: 1px solid ${OPTG.border}; background: #fff; font-size: 12.5px; font-weight: 600; color: ${OPTG.ink}; }
        .optg-preview-choice.default { background: ${OPTG.primary}; border-color: ${OPTG.primary}; color: #fff; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: OPTG.ink, fontFamily: "var(--f-display)" }}>ตัวเลือกเสริม</div>
          <div style={{ fontSize: 12.5, color: OPTG.gray, marginTop: 2 }}>ตัวเลือกเสริมสำหรับลูกค้า เช่น เมล็ดกาแฟ ความหวาน นม</div>
        </div>
        <button className="cbtn cbtn-accent" onClick={addGroup}><Icon name="plus" size={14} /> เพิ่มกลุ่มตัวเลือก</button>
      </div>

      <button
        onClick={() => setHelpOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: OPTG.primaryDark, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "10px 0", minHeight: 44 }}
      >
        <Icon name="info-circle" size={14} /> วิธีใช้งาน{helpOpen ? "ซ่อน" : ""}
        <Icon name={helpOpen ? "chevron-up" : "chevron-down"} size={13} />
      </button>
      {helpOpen && (
        <div style={{ background: OPTG.primarySoft, border: `1px solid rgba(37,99,235,.18)`, borderRadius: 14, padding: "14px 16px", fontSize: 12.5, color: OPTG.ink, lineHeight: 1.7, marginBottom: 16 }}>
          ตั้งค่าที่นี่ครั้งเดียว แล้วไปติ๊กเลือกว่าเมนูไหนใช้กลุ่มตัวเลือกไหนได้ในแท็บ "เมนู & สูตร" ตอนแก้ไขเมนู<br />
          ถ้าตัวเลือกไหนแทนวัตถุดิบ (เช่น เลือกเมล็ด/นมคนละแบบ) ให้เลือก "วัตถุดิบเชื่อมโยง" ระบบจะตัดสต็อกตามที่ลูกค้าเลือกจริงแทนสูตรตั้งต้น (วัตถุดิบต้นทางและตัวเลือกต้องตั้ง "กลุ่มทางเลือก" ให้ตรงกันในแท็บวัตถุดิบก่อน)<br />
          เลือกวัตถุดิบเดิมของสูตรแล้วปรับ "% ที่ใช้" ได้ด้วย เช่น กลุ่ม "ความหวาน" เลือกไซรัปแล้วตั้งหวานปกติ 100%, หวานน้อย 50%, ไม่หวาน 0%<br />
          ถ้าตัวเลือกเดียวต้องปรับหลายวัตถุดิบพร้อมกัน ให้กด "ปรับวัตถุดิบอื่นพร้อมกัน" เพิ่มได้ไม่จำกัด ไม่ต้องตั้งกลุ่มทางเลือก<br />
          กดไอคอนดาว ★ เพื่อตั้งตัวเลือกเริ่มต้น ลูกค้าจะไม่ต้องกดเลือกเองถ้าไม่ต้องการเปลี่ยน
        </div>
      )}

      <div className="optg-shell">
        <div style={{ minWidth: 0 }}>
          {data.optionGroups.length === 0 && <EmptyNote text={'ยังไม่มีกลุ่มตัวเลือก กด "เพิ่มกลุ่มตัวเลือก" เพื่อเริ่ม'} />}

          {data.optionGroups.map((g) => {
            const isCollapsed = !!collapsed[g.id];
            return (
              <div key={g.id} className="optg-card" ref={(el) => { groupRefs.current[g.id] = el; }} onClick={() => setActiveGroupId(g.id)}>
                <div className="optg-card-head">
                  <button className="optg-collapse-btn" onClick={(e) => { e.stopPropagation(); toggleCollapse(g.id); }} title={isCollapsed ? "ขยาย" : "ย่อ"}>
                    <Icon name={isCollapsed ? "chevron-down" : "chevron-up"} size={15} />
                  </button>
                  <input className="optg-name-input" value={g.name} onChange={(e) => patchGroup(g.id, { name: e.target.value })} />
                  <span className="optg-badge">{g.choices.length} ตัวเลือก</span>
                  <OptgToggle checked={g.required} onChange={(v) => patchGroup(g.id, { required: v })} label="บังคับเลือก" />
                  <OptgKebab items={[{ icon: "trash", label: "ลบกลุ่มนี้", danger: true, onClick: () => removeGroup(g.id) }]} />
                </div>

                {!isCollapsed && (
                  <div className="optg-body">
                    <div className="optg-row-head">
                      <span>ชื่อตัวเลือก</span><span>คำอธิบาย</span><span>ราคาเพิ่ม</span><span>วัตถุดิบเชื่อมโยง</span><span>ค่าเริ่มต้น</span><span></span>
                    </div>
                    {g.choices.map((c) => (
                      <div key={c.id}>
                        <div className="optg-choice-row">
                          <input className="optg-input" value={c.label} onChange={(e) => patchChoice(g.id, c.id, { label: e.target.value })} placeholder="ชื่อตัวเลือก" />
                          <input className="optg-input" value={c.note} onChange={(e) => patchChoice(g.id, c.id, { note: e.target.value })} placeholder="คำอธิบาย (ถ้ามี)" />
                          <input className="optg-input" type="number" value={c.priceDelta} onChange={(e) => patchChoice(g.id, c.id, { priceDelta: Number(e.target.value) })} title="ราคาเพิ่ม (บาท)" />
                          <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                            <select
                              className="optg-input"
                              value={c.ingredientId || ""}
                              onChange={(e) => patchChoice(g.id, c.id, { ingredientId: e.target.value || null })}
                              title="วัตถุดิบที่ใช้แทนเมื่อลูกค้าเลือกตัวเลือกนี้"
                            >
                              <option value="">ไม่เชื่อมโยง</option>
                              {data.ingredients.filter((i) => i.altGroup).map((i) => (
                                <option key={i.id} value={i.id}>{i.name} ({i.altGroup})</option>
                              ))}
                            </select>
                            {c.ingredientId && (
                              <input
                                className="optg-input"
                                type="number"
                                value={c.qtyPercent != null ? c.qtyPercent : 100}
                                onChange={(e) => patchChoice(g.id, c.id, { qtyPercent: Number(e.target.value) })}
                                style={{ width: 58, flexShrink: 0 }}
                                title="ปริมาณที่ใช้ (% ของสูตรตั้งต้น)"
                              />
                            )}
                          </div>
                          <button
                            className={"optg-fav-btn" + (c.isDefault ? " active" : "")}
                            onClick={() => setDefaultChoice(g.id, c.id)}
                            title={c.isDefault ? "เป็นค่าเริ่มต้นอยู่ (กดอีกครั้งเพื่อยกเลิก)" : "ตั้งเป็นค่าเริ่มต้น"}
                          ><Icon name="star" size={14} /></button>
                          <OptgKebab items={[{ icon: "trash", label: "ลบตัวเลือกนี้", danger: true, onClick: () => removeChoice(g.id, c.id) }]} />
                        </div>

                        {(c.extraAdjustments || []).length > 0 && (
                          <div style={{ marginLeft: 10, paddingLeft: 12, borderLeft: `2px solid ${OPTG.border}` }}>
                            {c.extraAdjustments.map((a, idx) => (
                              <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 11, color: OPTG.gray, whiteSpace: "nowrap" }}>ปรับเพิ่ม:</span>
                                <select
                                  className="optg-input"
                                  style={{ flex: 1, minWidth: 140 }}
                                  value={a.ingredientId || ""}
                                  onChange={(e) => patchExtraAdjustment(g.id, c.id, idx, { ingredientId: e.target.value || null })}
                                >
                                  <option value="">เลือกวัตถุดิบ</option>
                                  {data.ingredients.map((i) => (
                                    <option key={i.id} value={i.id}>{i.name}</option>
                                  ))}
                                </select>
                                <input
                                  className="optg-input"
                                  type="number"
                                  value={a.qtyPercent != null ? a.qtyPercent : 100}
                                  onChange={(e) => patchExtraAdjustment(g.id, c.id, idx, { qtyPercent: Number(e.target.value) })}
                                  style={{ width: 58 }}
                                  title="ปริมาณที่ใช้ (% ของสูตรตั้งต้นของวัตถุดิบนี้ในเมนู)"
                                />
                                <button className="optg-fav-btn" style={{ color: OPTG.danger, borderColor: OPTG.dangerSoft }} onClick={() => removeExtraAdjustment(g.id, c.id, idx)} title="ลบรายการนี้"><Icon name="x" size={13} /></button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button className="optg-extra-toggle" style={{ marginLeft: 10 }} onClick={() => addExtraAdjustment(g.id, c.id)}>
                          <Icon name="plus" size={11} /> ปรับวัตถุดิบอื่นพร้อมกัน
                        </button>
                      </div>
                    ))}
                    <button className="optg-add-choice" onClick={() => addChoice(g.id)}><Icon name="plus" size={14} /> เพิ่มตัวเลือกย่อย</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="optg-sidebar">
          <div className="optg-side-card">
            <div style={{ fontSize: 13, fontWeight: 700, color: OPTG.ink, marginBottom: 12 }}>สรุปภาพรวม</div>
            <div className="optg-stat-grid">
              <div className="optg-stat"><b>{totalGroups}</b><span>กลุ่มทั้งหมด</span></div>
              <div className="optg-stat"><b>{totalOptions}</b><span>ตัวเลือกทั้งหมด</span></div>
              <div className="optg-stat"><b>{requiredGroups}</b><span>กลุ่มบังคับเลือก</span></div>
              <div className="optg-stat"><b>{defaultOptions}</b><span>ตั้งค่าเริ่มต้นแล้ว</span></div>
            </div>
          </div>

          {activeGroup && (
            <div className="optg-side-card">
              <div style={{ fontSize: 13, fontWeight: 700, color: OPTG.ink, marginBottom: 3 }}>ตัวอย่างที่ลูกค้าเห็น</div>
              <div style={{ fontSize: 11.5, color: OPTG.gray, marginBottom: 12 }}>{activeGroup.name}{activeGroup.required ? " (บังคับเลือก)" : ""}</div>
              {activeGroup.choices.length === 0 ? (
                <EmptyNote text="กลุ่มนี้ยังไม่มีตัวเลือกย่อย" />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {activeGroup.choices.map((c) => (
                    <span key={c.id} className={"optg-preview-choice" + (c.isDefault ? " default" : "")}>
                      {c.label || "…"}{c.priceDelta ? ` +฿${c.priceDelta}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {data.optionGroups.length > 1 && (
            <div className="optg-side-card">
              <div style={{ fontSize: 13, fontWeight: 700, color: OPTG.ink, marginBottom: 8 }}>ไปยังกลุ่ม</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.optionGroups.map((g) => (
                  <button key={g.id} className={"optg-nav-item" + (g.id === activeGroupId ? " active" : "")} onClick={() => jumpTo(g.id)}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name || "(ไม่มีชื่อ)"}</span>
                    <span style={{ color: OPTG.gray, fontWeight: 500, flexShrink: 0 }}>{g.choices.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
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
    <div style={glass({ borderRadius: 12, padding: 16, marginTop: 18 })}>
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

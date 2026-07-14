import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, update, push, runTransaction } from "firebase/database";
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
    settings: { overheadPerCup: 3.1, shopName: "ร้านกาแฟของฉัน", platforms: seedPlatforms(), promptpayId: "", acceptingOrders: true, slipTestMode: false, bannerImageUrl: "", bannerImageUrls: [], categoryOrder: [], defaultPackagingLines: [], loyaltyBeanGoal: 10 },
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
    // sales ย้ายไปอยู่โหนดแยก sales/{uid} แล้ว (ดู useEffect ที่ subscribe ใน ShopApp) — เหลือ field นี้ไว้เป็น [] เฉยๆ
    // เพื่อไม่ต้องแก้ shape ของ data ทั้งระบบ ของจริงมาจาก dataForDisplay.sales ที่ override ทับอีกที
    sales: [],
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
      loyaltyBeanGoal: raw.settings?.loyaltyBeanGoal || 10,
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
      showAsPopup: p.showAsPopup === true,
      popupImageUrl: p.popupImageUrl || "",
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
  const date = d instanceof Date ? d : new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { id: "sell", label: "Sell", icon: "cash-register" },
  { id: "orders", label: "Orders", icon: "receipt" },
  { id: "menus", label: "Menu & Recipes", icon: "cup" },
  { id: "promotions", label: "Promotions", icon: "discount" },
  { id: "loyalty", label: "Loyalty Beans", icon: "coffee" },
  { id: "options", label: "Add-on Options", icon: "list-details" },
  { id: "ingredients", label: "Inventory & Stock", icon: "box-multiple" },
  { id: "reports", label: "Reports", icon: "chart-line" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function ShopApp({ uid, user }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches
  );
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesRecords, setSalesRecords] = useState([]);
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

  // เก็บลูกค้า/เมล็ดสะสมแยกโหนดจาก shops/{uid} เหมือน orders — เพราะลูกค้าเขียนแลกเมล็ดตรงจากหน้า QR เอง
  // (คนละ session กับแอดมิน) ถ้าฝากไว้ใน data ก้อนใหญ่ที่ set() ทับทั้งก้อนทุก 400ms จะโดนค่าเก่าทับหายได้
  useEffect(() => {
    const unsub = onValue(ref(db, `customers/${uid}`), (snap) => {
      const val = snap.val() || {};
      setCustomers(Object.values(val));
    });
    return () => unsub();
  }, [uid]);

  // เก็บยอดขายแยกโหนดจาก shops/{uid} ด้วยเหตุผลเดียวกับ customers — เดิม sales อยู่ในก้อนใหญ่ที่ set() ทับทั้งก้อนทุก
  // 400ms ถ้าเปิดแดชบอร์ดพร้อมกัน 2 แท็บ/อุปกรณ์แล้วยืนยันออเดอร์ใกล้ๆ กัน ฝั่งที่เขียนทีหลังจะเอา data เก่าที่ยังไม่เห็น
  // ยอดขายของอีกฝั่งไปเขียนทับ ทำให้ยอดขายหายเงียบๆ (เจอเคสจริงในโปรดักชัน 13 ก.ค. 2569 — ยอดขายหาย 2 รายการ)
  useEffect(() => {
    const unsub = onValue(ref(db, `sales/${uid}`), (snap) => {
      const val = snap.val() || {};
      setSalesRecords(Object.values(val));
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
          const promoDiscount = item.freeUnit && itemMenu ? itemMenu.priceStore + upcharge : 0;
          recordSale(item.menuId, item.qty, "online", { upcharge, substitutions, promoDiscount, milkLabel: (item.options || []).map((x) => x.label).join(", ") || null, orderId: o.id });
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
    return { ...data, sales: salesRecords.filter((s) => !s.orderId || !cancelledOrderIds.has(s.orderId)) };
  }, [data, salesRecords, cancelledOrderIds]);

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
    });
    // ยอดขายเขียนตรงไปโหนด sales/{uid} แยกจาก updateData ข้างบน (ซึ่งยังแก้ next.ingredients ในก้อนใหญ่ตามเดิม) —
    // กัน full-object set() ของ shops/{uid} ทับยอดขายที่เพิ่งเพิ่มหายไปเวลาเปิดแดชบอร์ดพร้อมกันหลายแท็บ (ดู useEffect ที่ subscribe sales/{uid} ด้านบนสำหรับรายละเอียด)
    const saleId = genId("sale");
    set(ref(db, `sales/${uid}/${saleId}`), {
      id: saleId, timestamp: new Date().toISOString(), menuId, menuName: menu.name,
      channel, qty, unitPrice, grossRevenue, gpAmount, gpPercent, promoDiscount, netRevenue,
      totalCost, profit: netRevenue - totalCost,
      platformName: platform ? platform.name : null,
      milkNote: opts.milkLabel || null,
      note: opts.note || null,
      orderId: opts.orderId || null,
    }).catch((err) => showToast("บันทึกยอดขายไม่สำเร็จ: " + err.message));
    showToast(`บันทึกการขาย ${menu.name} x${qty} (${channel === "delivery" ? (platform ? platform.name : "เดลิเวอรี่") : "หน้าร้าน"}) แล้ว`);
  }

  // ออเดอร์ที่ขายจากหน้า admin ต้องขึ้นบอร์ด Kanban เหมือนออเดอร์ลูกค้า ไม่งั้นบาริสต้าจะไม่มีการ์ดให้ไล่ทำตามสถานะ
  // จ่ายเงินแล้วที่หน้าร้านตอนกดขาย จึงเข้าคอลัมน์ "กำลังดำเนินการ" ทันที ข้ามสถานะ "รอยืนยัน" (เหมือนสลิปยืนยันอัตโนมัติ)
  function createInstoreOrder(cart, note, customerPhone) {
    const items = cart.map((line) => ({
      menuId: line.menuId, name: line.menuName, unitPrice: line.unitPrice, qty: line.qty, options: line.options,
    }));
    const total = round4(cart.reduce((s, l) => s + l.unitPrice * l.qty - (l.promo || 0), 0));
    const platformNames = [...new Set(cart.filter((l) => l.channel === "delivery" && l.platformName).map((l) => l.platformName))];
    const customerName = platformNames.length > 0 ? platformNames.join(", ") : "ขายหน้าร้าน";
    const newRef = push(ref(db, `orders/${uid}`));
    set(newRef, {
      customerName, customerPhone: customerPhone || "", note: note || "",
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
      });
      // ลบยอดขายที่ผูกกับออเดอร์นี้ออกจากโหนด sales/{uid} แยกต่างหาก (ดูเหตุผลเดียวกับตอนบันทึกใน recordSale)
      const toRemove = salesRecords.filter((s) => s.orderId === order.id);
      if (toRemove.length > 0) {
        const patch = {};
        for (const s of toRemove) patch[s.id] = null;
        update(ref(db, `sales/${uid}`), patch).catch((err) => showToast("ลบยอดขายไม่สำเร็จ: " + err.message));
      }
    }
    update(ref(db, `orders/${uid}/${order.id}`), {
      status: "cancelled",
      saleRecorded: false,
      cancelledAt: order.cancelledAt || new Date().toISOString(),
      cancelledBy: order.cancelledBy || uid,
    })
      .catch((err) => showToast("ยกเลิกไม่สำเร็จ: " + err.message));
    showToast(order.saleRecorded ? "ยกเลิกออเดอร์แล้ว คืนสต็อกและตัดยอดขายออกให้อัตโนมัติ" : "ยกเลิกออเดอร์แล้ว");
  }

  // ให้เมล็ดสะสมตอนออเดอร์ถึงสถานะ "เสร็จ" (done) เท่านั้น — ไม่ใช่ตอนยืนยันจ่ายเงิน เพราะกว่าจะถึงมือลูกค้าจริงๆ
  // คือตอนรับแก้วที่หน้าร้าน กันเคสยกเลิก/พลาดหลังจ่ายเงินแล้วนับแต้มไปก่อน — เมล็ด 1 แก้ว = 1 หน่วย นับตาม qty รวมในออเดอร์
  function awardLoyaltyBeans(order) {
    const phoneKey = (order.customerPhone || "").replace(/\D/g, "");
    if (!phoneKey) return;
    const cups = (order.items || []).reduce((s, it) => s + (it.qty || 0), 0);
    if (cups <= 0) return;
    runTransaction(ref(db, `customers/${uid}/${phoneKey}`), (cur) => {
      const prev = cur || { phone: phoneKey, name: "", beans: 0, lifetimeBeans: 0, redeemedCount: 0, createdAt: new Date().toISOString() };
      return {
        ...prev,
        phone: phoneKey,
        name: order.customerName && order.customerName !== "ขายหน้าร้าน" ? order.customerName : prev.name || "",
        beans: (prev.beans || 0) + cups,
        lifetimeBeans: (prev.lifetimeBeans || 0) + cups,
        updatedAt: new Date().toISOString(),
      };
    }).catch((err) => showToast("บันทึกเมล็ดสะสมไม่สำเร็จ: " + err.message));
  }

  // แอดมินปรับเมล็ดมือ (เช่น ลูกค้าทำใบเสร็จหาย/ชดเชยกรณีพิเศษ) — บวก/ลบตรงจากค่าปัจจุบัน กันชนกันด้วย transaction เหมือนกัน
  function adjustCustomerBeans(phoneKey, delta, name) {
    runTransaction(ref(db, `customers/${uid}/${phoneKey}`), (cur) => {
      const prev = cur || { phone: phoneKey, name: name || "", beans: 0, lifetimeBeans: 0, redeemedCount: 0, createdAt: new Date().toISOString() };
      return { ...prev, phone: phoneKey, beans: Math.max(0, (prev.beans || 0) + delta), updatedAt: new Date().toISOString() };
    }).then(() => showToast(delta > 0 ? `เพิ่มเมล็ดให้แล้ว +${delta}` : `หักเมล็ดแล้ว ${delta}`))
      .catch((err) => showToast("ปรับเมล็ดไม่สำเร็จ: " + err.message));
  }

  function updateLoyaltyGoal(goal) {
    updateData((next) => { next.settings.loyaltyBeanGoal = Math.max(1, Number(goal) || 10); });
  }

  // ให้เมล็ดย้อนหลังสำหรับออเดอร์ "เสร็จ" เก่าที่มีมาก่อนระบบสะสมเมล็ดจะเปิดใช้งาน (ยังไม่เคยติดแฟลก beansAwarded)
  // ใช้ awardLoyaltyBeans ตัวเดียวกับที่ทำงานสด กันตรรกะนับเมล็ดเพี้ยนไปคนละทางกับของจริง — กดซ้ำได้ปลอดภัย
  // เพราะออเดอร์ที่เคยติดแฟลกไปแล้วจะไม่ถูกนับซ้ำอีก
  const backfillEligibleOrders = orders.filter((o) => o.status === "done" && !o.beansAwarded && (o.customerPhone || "").replace(/\D/g, "").length > 0);
  function backfillLoyaltyBeans() {
    if (backfillEligibleOrders.length === 0) { showToast("ไม่มีออเดอร์เก่าที่ต้องคำนวณเพิ่มแล้ว"); return; }
    for (const o of backfillEligibleOrders) {
      update(ref(db, `orders/${uid}/${o.id}`), { beansAwarded: true }).catch(() => {});
      awardLoyaltyBeans(o);
    }
    showToast(`คำนวณเมล็ดย้อนหลังจาก ${backfillEligibleOrders.length} ออเดอร์เก่าให้แล้ว`);
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
        .navitem { border: none; border-left: 3px solid transparent; background: transparent; color: var(--espresso-3); padding: 11px 14px 11px 12px; margin: 1px 0; font-family: var(--f-body); font-size: 13.5px; font-weight: 500; border-radius: 10px; display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; transition: background .15s ease, color .15s ease, border-color .15s ease; }
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
        // "--sage"/"--gold" ทั้งคู่คือสีส้มแบรนด์ (ดูคอมเมนต์บรรทัดถัดไป) — ต้องมีโทนเขียวแยกต่างหากไว้ใช้กับ
        // สถานะสำเร็จ/เปิดร้าน เพราะใช้สีส้มไม่ได้ (ดูเหมือนคำเตือน ไม่ใช่สถานะปกติ) เลขสีเดียวกับ COLORS.success ใน CustomerOrder.jsx
        "--success": "#2E9E4F", "--success-dark": "#1F7A38", "--success-light": "#DFF3E3",
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
          {tab === "reports" && <ReportsPanel data={dataForDisplay} orders={orders} shopName={data.settings.shopName} showToast={showToast} />}
          {tab === "loyalty" && <LoyaltyPanel customers={customers} orders={orders} loyaltyBeanGoal={data.settings.loyaltyBeanGoal} adjustCustomerBeans={adjustCustomerBeans} updateLoyaltyGoal={updateLoyaltyGoal} showToast={showToast} backfillEligibleCount={backfillEligibleOrders.length} backfillLoyaltyBeans={backfillLoyaltyBeans} />}
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

// ระดับสมาชิกล้อธีมคั่วกาแฟ คำนวณจาก lifetimeBeans (เมล็ดสะสมตลอดกาล ไม่ลดตอนแลกของ) — เรียงจากสูงไปต่ำ
// เพื่อหาระดับปัจจุบันง่ายๆ ด้วย .find() ตัวแรกที่ min ต่ำกว่าหรือเท่ากับที่มี เป็นแค่ป้ายแสดงสถานะ ยังไม่มีสิทธิพิเศษผูกกับระดับ
// สี tier แต่ละระดับผ่าน WCAG AA กับพื้นหลัง bg ของตัวเอง (ทดสอบไว้แล้วตอนออกแบบ badge เดิม) — ไอคอนของแต่ละระดับ
// อยู่ใน ROAST_ICONS (custom SVG set ด้านบน) ไม่ใช้ emoji แล้ว
const LOYALTY_TIERS = [
  { id: "reserve", label: "Reserve", min: 100, color: "#8B5E00", bg: "#FBF0D9" },
  { id: "dark", label: "Dark Roast", min: 50, color: "#3B2410", bg: "#EDE4DA" },
  { id: "medium", label: "Medium Roast", min: 20, color: "#B45309", bg: "#FFF1DE" },
  { id: "light", label: "Light Roast", min: 0, color: "#8A6D3B", bg: "#FAF3E4" },
];
function loyaltyTierFor(lifetimeBeans) {
  return LOYALTY_TIERS.find((t) => (lifetimeBeans || 0) >= t.min) || LOYALTY_TIERS[LOYALTY_TIERS.length - 1];
}
function loyaltyNextTier(lifetimeBeans) {
  const idx = LOYALTY_TIERS.findIndex((t) => t.id === loyaltyTierFor(lifetimeBeans).id);
  return idx > 0 ? LOYALTY_TIERS[idx - 1] : null;
}

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
  const [cartPhone, setCartPhone] = useState("");
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
    const orderId = createInstoreOrder(cart, cartNote.trim(), cartPhone.trim());
    for (const line of cart) {
      recordSale(line.menuId, line.qty, line.channel, {
        substitutions: line.substitutions, upcharge: line.upcharge,
        promoDiscount: line.promo, platformId: line.platformId, milkLabel: line.optionsLabel,
        note: cartNote.trim() || null, orderId,
      });
    }
    setCart([]);
    setCartNote("");
    setCartPhone("");
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

          <label style={{ fontSize: 11, color: POS.gray, marginBottom: 4, fontWeight: 600 }}>เบอร์โทรลูกค้า (ถ้ามี — สะสมเมล็ดให้อัตโนมัติ)</label>
          <input
            value={cartPhone} onChange={(e) => setCartPhone(e.target.value)}
            placeholder="เช่น 0812345678" inputMode="tel"
            style={{ marginBottom: 10, fontFamily: "inherit", padding: "9px 11px", borderRadius: 12, border: `1px solid ${POS.border}`, fontSize: 13.5, width: "100%", boxSizing: "border-box" }}
          />

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

// ===== Custom icon system เฉพาะหน้า "ลูกค้า / เมล็ดสะสม" =====
// เส้น rounded outline + subtle fill บน viewBox 24x24 ทั้งชุด ให้ดูเป็น family เดียวกัน แยกจาก tabler-icons font
// ที่ใช้ทั่วทั้งแอป เพราะหน้านี้ต้องการชุดไอคอนที่ออกแบบเฉพาะแบรนด์ (ดูโจทย์: ห้ามผสมคนละ library/stroke style กัน)
// opacity .18 = ค่ามาตรฐานของ "subtle fill" ประดับ (รูปที่ 2 ที่ซ้อนอยู่ข้างหลัง) ใช้เหมือนกันทุกไอคอนในชุดนี้
// ยกเว้นชุดระดับสมาชิก (Light/Medium/Dark Roast) ที่ opacity ของ fill เมล็ดมีความหมายจริง (สื่อระดับการคั่วเข้ม-อ่อน)
const LOYALTY_ICON_SUBTLE_OPACITY = 0.18;

function LoyaltyIconBase({ size = 20, color, strokeWidth = 1.75, className, "aria-label": ariaLabel, children }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || "currentColor"} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : "true"}
    >
      {children}
    </svg>
  );
}

// 1. ลูกค้า — คนสองคนโค้งมน คนหลังเล็กกว่า/จางกว่าแบบ subtle fill กันดูแข็งเหมือนไอคอนองค์กร
function IconCustomers(props) {
  return (
    <LoyaltyIconBase {...props}>
      <circle cx="9" cy="8.2" r="3" />
      <path d="M3.8 19c0-3.1 2.3-5.3 5.2-5.3s5.2 2.2 5.2 5.3" />
      <circle cx="16.3" cy="8.8" r="2.4" opacity={LOYALTY_ICON_SUBTLE_OPACITY} fill="currentColor" stroke="none" />
      <path d="M15.4 13.3c2.2.4 3.6 2.2 3.8 4.9" opacity={LOYALTY_ICON_SUBTLE_OPACITY * 3} />
    </LoyaltyIconBase>
  );
}

// 2. เมล็ดสะสม — เมล็ดกาแฟทรงรี 2 เมล็ดซ้อนกัน แต่ละเมล็ดมีร่องกลางโค้งชัดเจน (ใช้ทรงรีเอียง+เส้นร่อง ซึ่งเป็นภาษาภาพ
// มาตรฐานของ "เมล็ดกาแฟ" กันสับสนกับเมล็ดพืช/ยาเม็ดที่มักเป็นวงกลม/แคปซูลเรียบไม่มีร่อง)
function IconLoyaltyBeans(props) {
  return (
    <LoyaltyIconBase {...props}>
      <g transform="rotate(-24 15 9)" opacity={LOYALTY_ICON_SUBTLE_OPACITY * 4.5}>
        <ellipse cx="15" cy="9" rx="4.6" ry="3.1" fill="currentColor" stroke="none" />
      </g>
      <g transform="rotate(-24 15 9)">
        <ellipse cx="15" cy="9" rx="4.6" ry="3.1" opacity="0.75" />
        <path d="M15 6.4c-1.4.9-1.4 4.3 0 5.2" opacity="0.75" />
      </g>
      <g transform="rotate(-24 10 15)">
        <ellipse cx="10" cy="15" rx="5.4" ry="3.6" />
        <path d="M10 11.9c-1.6 1-1.6 5.2 0 6.2" />
      </g>
    </LoyaltyIconBase>
  );
}

// 3. รางวัลพร้อมใช้ — แก้วเครื่องดื่ม (ฝาโดม + หลอด กันดูเป็นถังขยะ) + ดาวเล็กที่มุม ไม่ใช้กล่องของขวัญ
function IconRewardReady(props) {
  return (
    <LoyaltyIconBase {...props}>
      <path d="M7.3 9.6h9l-1.1 8.4a2 2 0 0 1-2 1.7h-2.8a2 2 0 0 1-2-1.7l-1.1-8.4Z" />
      <path d="M9.8 13.2h4.6" opacity="0.85" />
      <ellipse cx="11.8" cy="9.6" rx="4.5" ry="1.35" />
      <path d="M14.3 8.6 15.9 5" />
      <path d="M18 3.9l.5 1.2 1.3.2-.9.9.2 1.3-1.1-.6-1.1.6.2-1.3-.9-.9 1.3-.2z" fill="currentColor" opacity={LOYALTY_ICON_SUBTLE_OPACITY * 4.5} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </LoyaltyIconBase>
  );
}

// 4. ลูกค้ากลับมาซื้อซ้ำ — แก้วกาแฟ + ลูกศรวงเดียววนกลับ ตัดรายละเอียดให้เหลือน้อยที่สุดเพื่อให้หัวลูกศรยังชัดตอนย่อเล็ก (16px inline)
function IconRepeatCustomer(props) {
  return (
    <LoyaltyIconBase {...props}>
      <path d="M8.4 11h7.2l-.7 5.8a1.7 1.7 0 0 1-1.7 1.5h-2.4a1.7 1.7 0 0 1-1.7-1.5L8.4 11Z" />
      <path d="M8.1 11 7.7 9.4h8l-.4 1.6" />
      <path d="M17.8 8.6a6 6 0 1 0-.5 5.8" />
      <path d="M19.4 6.4l-1 2.4-2.4-.7" />
    </LoyaltyIconBase>
  );
}

// 5. Light Roast — ต้นอ่อนใบ 2 ใบ เส้นบางเบา สื่อ "อ่อน/เบา" ที่สุดในระดับสมาชิก
function IconRoastLight(props) {
  return (
    <LoyaltyIconBase {...props} strokeWidth={props.strokeWidth || 1.5}>
      <path d="M12 20V11" />
      <path d="M12 13c0-3 2-4.6 5-4.8-.3 3-2.3 4.7-5 4.8Z" opacity="0.9" />
      <path d="M12 15.5c0-2.6-1.8-4-4.4-4.2.3 2.6 2 4.1 4.4 4.2Z" opacity="0.9" />
    </LoyaltyIconBase>
  );
}

// 6. Medium Roast — เมล็ดกาแฟ fill ประมาณครึ่งเดียว (น้ำหนักภาพระดับกลาง แยกจาก Light/Dark ชัดเจน)
function IconRoastMedium(props) {
  return (
    <LoyaltyIconBase {...props}>
      <path d="M6.3 12c0-3.7 2.6-6.6 5.7-6.6S17.7 8.3 17.7 12s-2.6 6.6-5.7 6.6S6.3 15.7 6.3 12Z" />
      <path d="M12 5.4c-3.1 0-5.7 2.9-5.7 6.6 0 1.8.6 3.4 1.6 4.6a6.9 6.9 0 0 0 4.1-11.2Z" fill="currentColor" opacity="0.5" stroke="none" />
      <path d="M9 15.4c.9-2.6 1.7-5.2 2-8.6" opacity="0.9" />
    </LoyaltyIconBase>
  );
}

// 7. Dark Roast — เมล็ดกาแฟ fill มากกว่า Medium แต่ร่องกลางยังต้องเห็นชัด (ไม่ใช่วงกลมดำล้วน)
function IconRoastDark(props) {
  return (
    <LoyaltyIconBase {...props}>
      <path d="M6.3 12c0-3.7 2.6-6.6 5.7-6.6S17.7 8.3 17.7 12s-2.6 6.6-5.7 6.6S6.3 15.7 6.3 12Z" fill="currentColor" opacity="0.82" />
      <path d="M9 15.4c.9-2.6 1.7-5.2 2-8.6" stroke="#fff" strokeOpacity="0.9" />
    </LoyaltyIconBase>
  );
}

// 8. Reserve — ทรงเพชรผสมร่องเมล็ดกาแฟ ให้ความรู้สึกพรีเมียม เรียบง่ายพอใช้ใน badge เล็กได้
function IconReserve(props) {
  return (
    <LoyaltyIconBase {...props}>
      <path d="M12 3.6 18.4 9 12 20.4 5.6 9Z" />
      <path d="M5.6 9h12.8" opacity="0.85" />
      <path d="M9.6 9 12 3.6l2.4 5.4-2.4 11.4Z" opacity={LOYALTY_ICON_SUBTLE_OPACITY * 4.5} fill="currentColor" stroke="none" />
    </LoyaltyIconBase>
  );
}

// 9. ตั้งค่ารางวัล — ตั๋ว/บัตรกำนัลรอยปรุตรงกลาง + เฟืองเล็กที่มุม สื่อ "ตั้งค่าเงื่อนไขรางวัล" ชัดกว่าเฟืองเดี่ยวลอยๆ
function IconRewardSettings(props) {
  return (
    <LoyaltyIconBase {...props}>
      <path d="M3.8 8.4a1.6 1.6 0 0 1 1.6-1.6h9.4a1.6 1.6 0 0 1 1.6 1.6v1a1.4 1.4 0 0 0 0 2.8v1a1.6 1.6 0 0 1-1.6 1.6H5.4A1.6 1.6 0 0 1 3.8 14.2v-1a1.4 1.4 0 0 0 0-2.8Z" />
      <path d="M9.6 6.8v9" strokeDasharray="1.6 2" opacity="0.8" />
      <circle cx="18.2" cy="16.4" r="3.1" opacity={LOYALTY_ICON_SUBTLE_OPACITY * 5.5} fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18.2 14.9v.6M18.2 17.3v.6M16.7 16.4h.6M19.1 16.4h.6M17.2 15.4l.4.4M18.8 17l.4.4M19.2 15.4l-.4.4M17.6 17l-.4.4" strokeWidth="1.2" />
    </LoyaltyIconBase>
  );
}

// 10. เพิ่มลูกค้า — silhouette คนเดียว + เครื่องหมายบวกที่มุม ชัดแต่ไม่แย่งซีนรูปคน
function IconAddCustomer(props) {
  return (
    <LoyaltyIconBase {...props}>
      <circle cx="10" cy="8.4" r="3.4" />
      <path d="M4.4 19.4c0-3.4 2.5-5.8 5.6-5.8 1 0 1.9.2 2.7.7" />
      <circle cx="18" cy="17.2" r="3.4" fill="currentColor" opacity={LOYALTY_ICON_SUBTLE_OPACITY * 2.5} stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 15.6v3.2M16.4 17.2h3.2" strokeWidth="1.5" />
    </LoyaltyIconBase>
  );
}

// 11. ดูรายละเอียดลูกค้า — ลูกศรชี้ขวาในวงกลม ใช้สัญลักษณ์เดียวนี้ให้สม่ำเสมอทุกจุดที่เปิดรายละเอียด
function IconCustomerDetails(props) {
  return (
    <LoyaltyIconBase {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.2 8.4 13.8 12l-3.6 3.6" />
    </LoyaltyIconBase>
  );
}

// 12. ตัวเลือกเพิ่มเติม — จุด 3 จุดแนวตั้ง ระยะห่างเท่ากัน (พื้นที่กดจริงกำหนดที่ปุ่มครอบข้างนอก ไม่ใช่ตัว SVG)
function IconMoreActions(props) {
  return (
    <LoyaltyIconBase {...props} strokeWidth={props.strokeWidth || 2.2}>
      <circle cx="12" cy="5.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.15" fill="currentColor" stroke="none" />
    </LoyaltyIconBase>
  );
}

const ROAST_ICONS = { light: IconRoastLight, medium: IconRoastMedium, dark: IconRoastDark, reserve: IconReserve };

// รายชื่อลูกค้า/เมล็ดสะสม — อ่านจาก customers/{uid} (คนละโหนดจาก data ก้อนใหญ่ ดู awardLoyaltyBeans ว่าทำไม)
// เรียงคนสะสมเยอะสุดขึ้นก่อน ค้นหาด้วยเบอร์/ชื่อได้ ปรับเมล็ดมือได้เผื่อกรณีพิเศษ
function TierBadge({ lifetimeBeans, size }) {
  const tier = loyaltyTierFor(lifetimeBeans);
  const dense = size === "sm";
  const RoastIcon = ROAST_ICONS[tier.id];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, borderRadius: 999, flexShrink: 0,
      fontSize: dense ? 10.5 : 12, padding: dense ? "3px 8px" : "4px 10px", color: tier.color, background: tier.bg,
    }}>
      <RoastIcon size={16} color={tier.color} aria-label={`ระดับ ${tier.label}`} />
      {tier.label}
    </span>
  );
}

function LoyaltyPanel({ customers, orders, loyaltyBeanGoal, adjustCustomerBeans, updateLoyaltyGoal, showToast, backfillEligibleCount, backfillLoyaltyBeans }) {
  const [search, setSearch] = useState("");
  const [goalInput, setGoalInput] = useState(String(loyaltyBeanGoal));
  const [adjustFor, setAdjustFor] = useState(null);
  const [adjustAmount, setAdjustAmount] = useState("1");
  const [confirmBackfill, setConfirmBackfill] = useState(false);
  const [detailFor, setDetailFor] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? customers.filter((c) => c.phone.includes(q) || (c.name || "").toLowerCase().includes(q))
      : customers;
    return [...list].sort((a, b) => (b.beans || 0) - (a.beans || 0));
  }, [customers, search]);

  const totalCustomers = customers.length;
  const totalBeansOut = customers.reduce((s, c) => s + (c.beans || 0), 0);
  const eligibleCount = customers.filter((c) => (c.beans || 0) >= loyaltyBeanGoal).length;
  const tierCounts = useMemo(() => {
    const counts = {};
    for (const t of LOYALTY_TIERS) counts[t.id] = 0;
    for (const c of customers) counts[loyaltyTierFor(c.lifetimeBeans).id]++;
    return counts;
  }, [customers]);

  function saveGoal() {
    updateLoyaltyGoal(goalInput);
    showToast("บันทึกเกณฑ์แลกแล้ว");
  }

  function submitAdjust(sign) {
    const n = Math.max(1, Number(adjustAmount) || 1);
    adjustCustomerBeans(adjustFor.phone, n * sign, adjustFor.name);
    setAdjustFor(null);
    setAdjustAmount("1");
  }

  return (
    <div>
      <style>{`
        .loy-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 18px; }
        @media (max-width: 720px) { .loy-stats { grid-template-columns: 1fr; } }
        .loy-stat { background: #fff; border: 1px solid ${POS.border}; border-radius: 18px; padding: 16px 18px; }
        .loy-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; border: 1px solid ${POS.border}; background: #fff; margin-bottom: 8px; }
        .loy-goal-input { padding: 8px 10px; border-radius: 10px; border: 1px solid ${POS.border}; font-size: 13.5px; width: 80px; font-family: inherit; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--espresso-3)" }}>
        <IconLoyaltyBeans size={16} aria-label="ลูกค้า / เมล็ดสะสม" />
        <span style={{ fontSize: 12.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".03em" }}>ลูกค้า / เมล็ดสะสม</span>
      </div>

      {backfillEligibleCount > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10,
          background: "#FFF4E5", border: "1px solid #FBD5B5", borderRadius: 16, padding: "12px 16px", marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, color: "#92400E" }}>
            <b>พบออเดอร์เก่าที่ทำเสร็จแล้ว {backfillEligibleCount} รายการ</b> ที่มีเบอร์โทรลูกค้า แต่ยังไม่เคยถูกนับเป็นเมล็ดสะสม (เพราะเป็นออเดอร์ก่อนระบบนี้เปิดใช้งาน)
          </div>
          <button className="cbtn cbtn-accent" style={{ padding: "8px 14px", fontSize: 13, flexShrink: 0 }} onClick={() => setConfirmBackfill(true)}>
            คำนวณเมล็ดจากประวัติออเดอร์
          </button>
        </div>
      )}

      <div className="loy-stats">
        <div className="loy-stat" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: POS.chipBg, color: POS.navy, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <IconCustomers size={24} aria-label="ลูกค้าทั้งหมด" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: POS.gray, fontWeight: 600 }}>ลูกค้าทั้งหมด</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: POS.navy, marginTop: 2 }}>{totalCustomers} คน</div>
          </div>
        </div>
        <div className="loy-stat" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "#F7E9DD", color: "#9A4D16", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <IconLoyaltyBeans size={24} aria-label="เมล็ดสะสมค้างอยู่" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: POS.gray, fontWeight: 600 }}>เมล็ดสะสมค้างอยู่ (ยังไม่แลก)</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#9A4D16", marginTop: 2 }}>{totalBeansOut}</div>
          </div>
        </div>
        <div className="loy-stat" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "#E1F2E7", color: "#237A43", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <IconRewardReady size={24} aria-label="พร้อมแลกฟรีตอนนี้" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: POS.gray, fontWeight: 600 }}>พร้อมแลกฟรีตอนนี้</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#237A43", marginTop: 2 }}>{eligibleCount} คน</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {LOYALTY_TIERS.slice().reverse().map((t) => {
          const RoastIcon = ROAST_ICONS[t.id];
          return (
            <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: t.color, background: t.bg, borderRadius: 999, padding: "5px 12px" }}>
              <RoastIcon size={16} color={t.color} aria-label={t.label} />
              {t.label} · {tierCounts[t.id]} คน
            </span>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเบอร์โทร/ชื่อลูกค้า..."
          style={{ padding: "9px 14px", borderRadius: 12, border: `1px solid ${POS.border}`, fontSize: 13.5, minWidth: 220, fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconRewardSettings size={16} color={POS.gray} aria-label="ตั้งค่าเงื่อนไขรางวัล" />
          <span style={{ fontSize: 13, color: POS.gray, fontWeight: 600 }}>สะสมกี่เมล็ดแลกฟรี 1 แก้ว</span>
          <input className="loy-goal-input" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} inputMode="numeric" />
          <button className="cbtn cbtn-accent" style={{ padding: "8px 14px", fontSize: 13 }} onClick={saveGoal}>บันทึก</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyNote text="ยังไม่มีลูกค้าสะสมเมล็ด — เมล็ดจะเริ่มนับอัตโนมัติเมื่อออเดอร์ที่มีเบอร์โทรลูกค้าถูกทำเสร็จ (สถานะ “เสร็จ” บนบอร์ดออเดอร์)" />
      ) : (
        <div>
          {filtered.map((c) => (
            <div key={c.phone} className="loy-row">
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#F7E9DD", color: "#9A4D16", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <IconLoyaltyBeans size={20} aria-label="เมล็ดสะสม" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: POS.navy }}>{c.name || "(ไม่ทราบชื่อ)"} · {c.phone}</span>
                  <TierBadge lifetimeBeans={c.lifetimeBeans} size="sm" />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: POS.gray, marginTop: 1 }}>
                  <span>สะสม {c.beans || 0} / {loyaltyBeanGoal} เมล็ด</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <IconRepeatCustomer size={16} aria-label="ยอดสะสมตลอดกาล" />
                    รวมตลอดกาล {c.lifetimeBeans || 0} เมล็ด
                  </span>
                </div>
              </div>
              {(c.beans || 0) >= loyaltyBeanGoal && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#237A43", background: "#E1F2E7", borderRadius: 999, padding: "4px 10px", flexShrink: 0 }}>
                  <IconRewardReady size={16} aria-label="พร้อมแลกฟรี" />แลกฟรีได้
                </span>
              )}
              <button className="cbtn" style={{ padding: "7px 12px", fontSize: 12.5, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }} onClick={() => setDetailFor(c)} title="ดูรายละเอียดลูกค้า">
                <IconCustomerDetails size={20} aria-label="ดูรายละเอียดลูกค้า" />รายละเอียด
              </button>
              <button className="cbtn" style={{ padding: "7px 12px", fontSize: 12.5, flexShrink: 0 }} onClick={() => setAdjustFor(c)}>ปรับเมล็ด</button>
            </div>
          ))}
        </div>
      )}

      {detailFor && (
        <LoyaltyDetailModal customer={detailFor} orders={orders} loyaltyBeanGoal={loyaltyBeanGoal} onClose={() => setDetailFor(null)} />
      )}

      {adjustFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setAdjustFor(null)}>
          <div style={{ background: "#fff", borderRadius: 18, padding: 22, width: 300 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, color: POS.navy, marginBottom: 4 }}>ปรับเมล็ด — {adjustFor.name || adjustFor.phone}</div>
            <div style={{ fontSize: 12, color: POS.gray, marginBottom: 12 }}>ปัจจุบัน {adjustFor.beans || 0} เมล็ด</div>
            <input
              value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} inputMode="numeric"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 10, border: `1px solid ${POS.border}`, fontSize: 14, marginBottom: 12, fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="cbtn cbtn-accent" style={{ flex: 1, padding: "9px 0" }} onClick={() => submitAdjust(1)}>+ เพิ่ม</button>
              <button className="cbtn cbtn-danger" style={{ flex: 1, padding: "9px 0" }} onClick={() => submitAdjust(-1)}>− หัก</button>
            </div>
          </div>
        </div>
      )}

      {confirmBackfill && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmBackfill(false)}>
          <div style={{ background: "#fff", borderRadius: 18, padding: 22, width: 340 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, color: POS.navy, marginBottom: 8 }}>คำนวณเมล็ดจากประวัติออเดอร์?</div>
            <div style={{ fontSize: 13, color: POS.gray, marginBottom: 16, lineHeight: 1.5 }}>
              จะรวมจำนวนแก้วจากออเดอร์เก่าที่ทำเสร็จแล้ว {backfillEligibleCount} รายการ (ที่มีเบอร์โทรลูกค้า) มาบวกเข้าเมล็ดสะสมของแต่ละคนให้ ทำครั้งเดียวพอ กดซ้ำได้แต่จะไม่นับออเดอร์เดิมซ้ำ
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="cbtn" style={{ flex: 1, padding: "9px 0" }} onClick={() => setConfirmBackfill(false)}>ยกเลิก</button>
              <button className="cbtn cbtn-accent" style={{ flex: 1, padding: "9px 0" }} onClick={() => { backfillLoyaltyBeans(); setConfirmBackfill(false); }}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ไล่ดูออเดอร์ทั้งหมดของเบอร์นี้ ว่านับเป็นเมล็ดไปกี่ออเดอร์ ไม่นับกี่ออเดอร์ (และเพราะอะไร) — ไว้ตรวจสอบเวลาตัวเลขดูไม่ตรงกับที่คาดไว้
// เทียบด้วย "9 หลักท้าย" ด้วย ไม่ใช่แค่ตรงเป๊ะ เผื่อเบอร์เดียวกันถูกบันทึกคนละฟอร์แมต (เช่น มี +66 นำหน้าบางออเดอร์) ทำให้แยกเป็นคนละ key กัน
function LoyaltyDetailModal({ customer, orders, loyaltyBeanGoal, onClose }) {
  const last9 = customer.phone.slice(-9);
  const matches = useMemo(() => {
    return (orders || [])
      .map((o) => ({ order: o, digits: (o.customerPhone || "").replace(/\D/g, "") }))
      .filter((x) => x.digits.slice(-9) === last9 && x.digits.length > 0);
  }, [orders, last9]);

  const exact = matches.filter((x) => x.digits === customer.phone);
  const variants = matches.filter((x) => x.digits !== customer.phone);
  const cupsOf = (o) => (o.items || []).reduce((s, it) => s + (it.qty || 0), 0);
  const countedCups = exact.filter((x) => x.order.status === "done").reduce((s, x) => s + cupsOf(x.order), 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 22, width: 480, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: POS.navy }}>รายละเอียด — {customer.name || "(ไม่ทราบชื่อ)"} · {customer.phone}</span>
          <TierBadge lifetimeBeans={customer.lifetimeBeans} />
        </div>
        <div style={{ fontSize: 12.5, color: POS.gray, marginBottom: 14 }}>
          พบออเดอร์เบอร์นี้ {exact.length} รายการ · นับเป็นเมล็ดแล้ว {countedCups} แก้ว (เฉพาะสถานะ "เสร็จ") · ปัจจุบันมี {customer.beans || 0} เมล็ด
          {(() => {
            const next = loyaltyNextTier(customer.lifetimeBeans);
            return next ? ` · อีก ${next.min - (customer.lifetimeBeans || 0)} เมล็ดถึงระดับ ${next.label}` : " · ถึงระดับสูงสุดแล้ว";
          })()}
        </div>

        {variants.length > 0 && (
          <div style={{ background: "#FFF4E5", border: "1px solid #FBD5B5", borderRadius: 12, padding: "10px 12px", marginBottom: 14, fontSize: 12.5, color: "#92400E" }}>
            <b>พบเบอร์ใกล้เคียงที่บันทึกคนละฟอร์แมต {variants.length} ออเดอร์</b> (9 หลักท้ายตรงกันแต่ไม่ตรงเป๊ะ — อาจมี +66 หรืออักขระอื่นปนมา) ยังไม่ถูกนับรวมให้เพราะระบบถือเป็นคนละเบอร์:
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {variants.map((x) => (
                <div key={x.order.id}>เบอร์ที่บันทึก "{x.order.customerPhone}" ({ORDER_STATUS_LABEL[x.order.status] || x.order.status}, {cupsOf(x.order)} แก้ว)</div>
              ))}
            </div>
            <div style={{ marginTop: 6 }}>ถ้าใช่เบอร์เดียวกันจริง ใช้ปุ่ม "ปรับเมล็ด" เพิ่มจำนวนแก้วจากรายการข้างบนให้เองได้เลย</div>
          </div>
        )}

        {exact.length === 0 ? (
          <EmptyNote text="ไม่พบออเดอร์ที่ตรงเบอร์นี้เป๊ะๆ" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {exact.map((x) => {
              const counted = x.order.status === "done";
              return (
                <div key={x.order.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: `1px solid ${POS.border}`, background: counted ? "#fff" : "#FAFAFA" }}>
                  <div style={{ fontSize: 12.5, color: POS.navy }}>
                    {new Date(x.order.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })} · {cupsOf(x.order)} แก้ว
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 9px", flexShrink: 0,
                    color: counted ? "#15803D" : "#92400E", background: counted ? "#EAF7EE" : "#FFF4E5",
                  }}>
                    {counted ? "นับแล้ว" : `ยังไม่นับ (${ORDER_STATUS_LABEL[x.order.status] || x.order.status})`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <button className="cbtn" style={{ width: "100%", marginTop: 16, padding: "9px 0" }} onClick={onClose}>ปิด</button>
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

function OrderMeta({ paymentMethod, pickupDate, paymentVerified, paymentVerifiedBy, compact, onEditPickupDate }) {
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
        // ต้องเป็น <button> ไม่ใช่ <span> — การ์ดออเดอร์ทั้งใบลากได้ (onCardPointerDown เช็คแค่ e.target.closest("button")
        // ถึงจะไม่เริ่มลาก) ถ้าเป็น span เฉยๆ กดแล้วจะโดนตีความเป็นการเริ่มลากการ์ดแทนที่จะเปิด modal แก้วันที่
        <button
          type="button"
          className="chpill"
          onClick={onEditPickupDate}
          disabled={!onEditPickupDate}
          title={onEditPickupDate ? "แก้ไขวันที่รับ" : undefined}
          style={{
            background: "var(--cream-2)", color: "var(--espresso-3)", fontWeight: 600, border: "none", fontFamily: "inherit",
            display: "inline-flex", alignItems: "center", margin: 0,
            ...(compact ? { padding: "1px 6px", fontSize: 9.5 } : {}),
            ...(onEditPickupDate ? { cursor: "pointer" } : {}),
          }}
        >
          <Icon name="calendar" size={10} /> รับ {formatPickupDateTH(pickupDate)}
          {onEditPickupDate && <Icon name="pencil" size={9} style={{ marginLeft: 2, opacity: 0.7 }} />}
        </button>
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
            <span style={{ fontSize: compact ? 11.5 : 16, fontWeight: 700, color: "var(--espresso-5)", lineHeight: 1.25 }}>
              {i.name} <span style={{ color: "var(--sage-dark)" }}>x{i.qty}</span>
              {i.freeUnit && <span style={{ marginLeft: 5, fontSize: compact ? 9.5 : 11, fontWeight: 700, color: "#B45309", background: "#FFF4E5", borderRadius: 999, padding: "1px 7px" }}>🫘 ฟรี</span>}
            </span>
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

function escapePrintHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildOrderStickerData(order) {
  const stickers = [];
  const totalCups = (order.items || []).reduce((sum, item) => sum + Math.max(1, Number(item.qty) || 1), 0);
  let cupNumber = 0;
  for (const item of order.items || []) {
    const qty = Math.max(1, Number(item.qty) || 1);
    const options = (item.options || []).map((option) => option.label).filter(Boolean).join(" · ");
    for (let unit = 0; unit < qty; unit += 1) {
      cupNumber += 1;
      stickers.push({
        menuName: item.name || "เครื่องดื่ม",
        options,
        note: order.note || "",
        customer: order.customerName || order.customerPhone || "ลูกค้า",
        phone: order.customerName && order.customerPhone ? order.customerPhone : "",
        orderCode: String(order.id || "").slice(-6).toUpperCase(),
        pickupDate: formatPickupDateTH(order.pickupDate),
        cupNumber,
        totalCups,
        freeUnit: item.freeUnit === true,
      });
    }
  }
  return stickers;
}

function openOrderStickerPrint(orderOrOrders, shopName) {
  const ordersToPrint = Array.isArray(orderOrOrders) ? orderOrOrders : [orderOrOrders];
  const stickers = ordersToPrint.flatMap((order) => buildOrderStickerData(order));
  if (stickers.length === 0) throw new Error("ออเดอร์นี้ไม่มีรายการสำหรับพิมพ์");

  const startInput = window.prompt(`กำลังพิมพ์ ${ordersToPrint.length} ออเดอร์ รวม ${stickers.length} ดวง\nเริ่มพิมพ์ที่ดวงลำดับใดบนแผ่น A9? (1-30)`, "1");
  if (startInput === null) return false;
  const startPosition = Number.parseInt(startInput, 10);
  if (!Number.isInteger(startPosition) || startPosition < 1 || startPosition > 30) {
    throw new Error("ตำแหน่งเริ่มต้นต้องเป็นตัวเลข 1-30");
  }

  const pageCount = Math.ceil((startPosition - 1 + stickers.length) / 30);
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const slots = Array.from({ length: 30 }, (_, slotIndex) => {
      const stickerIndex = pageIndex * 30 + slotIndex - (startPosition - 1);
      const sticker = stickers[stickerIndex];
      if (!sticker) return '<div class="slot-wrap"><div class="label label--blank"></div></div>';
      const details = [sticker.options, sticker.freeUnit ? "แลกรางวัลฟรี" : ""].filter(Boolean).join(" · ");
      return `
        <div class="slot-wrap">
          <article class="label">
            <div class="label__top">
              <strong>${escapePrintHtml(sticker.menuName)}</strong>
              <span>${sticker.cupNumber}/${sticker.totalCups}</span>
            </div>
            <div class="label__details">${escapePrintHtml(details || "สูตรปกติ")}</div>
            ${sticker.note ? `<div class="label__note">โน้ต: ${escapePrintHtml(sticker.note)}</div>` : '<div class="label__note label__note--empty">&nbsp;</div>'}
            <div class="label__bottom">
              <span>${escapePrintHtml(sticker.customer)}${sticker.phone ? ` · ${escapePrintHtml(sticker.phone)}` : ""}</span>
              <b>#${escapePrintHtml(sticker.orderCode)}</b>
            </div>
          </article>
        </div>`;
    }).join("");
    return `<section class="sheet">${slots}</section>`;
  }).join("");

  const firstOrderCode = String(ordersToPrint[0]?.id || "").slice(-6).toUpperCase();
  const printTitle = ordersToPrint.length === 1 ? `#${firstOrderCode}` : `${ordersToPrint.length}-orders`;
  const printWindow = window.open("", "_blank", "width=980,height=760");
  if (!printWindow) throw new Error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่");
  printWindow.opener = null;
  printWindow.document.write(`<!doctype html>
    <html lang="th">
      <head>
        <meta charset="utf-8" />
        <title>สติ๊กเกอร์ออเดอร์ ${escapePrintHtml(printTitle)}</title>
        <style>
          @page { size: 168mm 220mm; margin: 0; }
          * { box-sizing: border-box; }
          html, body { width: 168mm; margin: 0; padding: 0; color: #000; background: #fff; font-family: Tahoma, Arial, sans-serif; }
          .sheet {
            display: grid;
            grid-template-columns: repeat(3, 53mm);
            grid-template-rows: repeat(10, 22mm);
            align-content: start;
            width: 168mm;
            height: 219.8mm;
            padding: 0 0 0 1mm;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .sheet:last-child { break-after: auto; page-break-after: auto; }
          .slot-wrap { width: 53mm; height: 22mm; overflow: hidden; }
          .label {
            width: 50mm;
            height: 19mm;
            overflow: hidden;
            padding: .4mm 1.25mm;
            font-size: 6.4pt;
            line-height: 1.08;
          }
          .label__top { display: flex; align-items: baseline; justify-content: space-between; gap: 1mm; }
          .label__top strong { min-width: 0; overflow: hidden; font-size: 8.2pt; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
          .label__top span { flex-shrink: 0; font-weight: 700; }
          .label__details, .label__note { margin-top: .35mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .label__note { font-weight: 700; }
          .label__bottom { display: flex; justify-content: space-between; gap: 1mm; margin-top: .35mm; border-top: .2mm solid #000; padding-top: .35mm; font-size: 5.7pt; }
          .label__bottom span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .label__bottom b { flex-shrink: 0; }
          @media screen {
            body::before { content: "${escapePrintHtml(shopName || "ร้านกาแฟ")} · แผ่น 168 × 220 มม. · ดวง 50 × 19 มม. · Margins: None / Scale: 100%"; display: block; position: fixed; z-index: 2; top: 8px; left: 50%; transform: translateX(-50%); padding: 8px 12px; border-radius: 8px; color: #fff; background: #173b63; font-size: 12px; white-space: nowrap; }
            body { padding: 24px; background: #e7e7e7; }
            .sheet { margin: 24px auto; background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,.16); }
            .label:not(.label--blank) { outline: 1px dashed #aaa; }
          }
        </style>
      </head>
      <body>${pages}<script>window.setTimeout(() => window.print(), 250);<\/script></body>
    </html>`);
  printWindow.document.close();
  return true;
}

const KANBAN_NEXT_LABEL = { pending: "ยืนยันรับเงินแล้ว", preparing: "พร้อมเสิร์ฟ", ready: "เสร็จ / ลูกค้ารับแล้ว" };

function OrdersPanel({ uid, orders, recordSale, cancelOrder, showToast, data, ingredientsById }) {
  const prevStatusRef = useRef({});
  const [justMovedIds, setJustMovedIds] = useState(new Set());
  const [dragId, setDragId] = useState(null);
  const [dragPos, setDragPos] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [editingPickupDate, setEditingPickupDate] = useState(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState(() => new Set());
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

  useEffect(() => {
    const currentIds = new Set(orders.filter((order) => ["pending", "paid", "preparing", "ready", "done"].includes(order.status)).map((order) => order.id));
    setSelectedOrderIds((selected) => {
      const next = new Set([...selected].filter((id) => currentIds.has(id)));
      return next.size === selected.size ? selected : next;
    });
  }, [orders]);

  function setStatus(order, status) {
    // ให้เมล็ดสะสมแค่ครั้งเดียวตอนเข้า "done" ครั้งแรก (กันการ์ดถูกลากออกแล้วลากกลับเข้ามาใหม่นับซ้ำ)
    const awarding = status === "done" && order.status !== "done" && !order.beansAwarded;
    const completing = status === "done" && order.status !== "done";
    const patch = awarding ? { status, beansAwarded: true } : { status };
    if (completing) {
      patch.completedAt = order.completedAt || new Date().toISOString();
      patch.completedBy = order.completedBy || uid;
    }
    update(ref(db, `orders/${uid}/${order.id}`), patch).catch((err) => showToast("อัปเดตไม่สำเร็จ: " + err.message));
    if (awarding) awardLoyaltyBeans(order);
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

  // แก้วันที่รับได้ทุกสถานะ (ไม่ผูกกับสต็อก/ต้นทุนเหมือนตัวเลือกเมนู) — กันเคสลูกค้าใส่วันรับผิดแล้วพนักงานไม่มีทางแก้เลย
  // นอกจากลากการ์ดสลับสถานะไปมาซึ่งไม่ได้ช่วยอะไรและอาจกดโดนปุ่มยกเลิกที่อยู่ติดกันโดยไม่ตั้งใจ
  function savePickupDate(order, newDate) {
    update(ref(db, `orders/${uid}/${order.id}`), { pickupDate: newDate })
      .then(() => showToast("แก้ไขวันที่รับแล้ว"))
      .catch((err) => showToast("แก้ไขไม่สำเร็จ: " + err.message));
    setEditingPickupDate(null);
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
      // แลกเมล็ดฟรี 1 แก้ว — หักรายได้ที่บันทึกออกเท่าราคาแก้วนั้น (1 หน่วย) ไม่งั้นยอดขาย/กำไรจะเพี้ยนสูงเกินจริงทั้งที่ลูกค้าไม่ได้จ่าย
      const promoDiscount = item.freeUnit && itemMenu ? itemMenu.priceStore + upcharge : 0;
      recordSale(item.menuId, item.qty, "online", { upcharge, substitutions, promoDiscount, milkLabel: (item.options || []).map((o) => o.label).join(", ") || null, orderId: order.id });
    }
    showToast(`ยืนยันออเดอร์ ${order.customerName || order.customerPhone} แล้ว บันทึกยอดขายให้อัตโนมัติ`);
  }

  function advance(order) {
    if (order.status === "pending") confirmPaid(order);
    else if (order.status === "preparing") setStatus(order, "ready");
    else if (order.status === "ready") setStatus(order, "done");
  }

  function printOrderStickers(order) {
    try {
      openOrderStickerPrint(order, data.settings.shopName);
    } catch (error) {
      showToast(error.message || "เปิดหน้าพิมพ์สติ๊กเกอร์ไม่สำเร็จ");
    }
  }

  function toggleOrderSelection(orderId) {
    setSelectedOrderIds((selected) => {
      const next = new Set(selected);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleColumnSelection(columnOrders) {
    const orderIds = columnOrders.map((order) => order.id);
    if (orderIds.length === 0) return;
    setSelectedOrderIds((selected) => {
      const next = new Set(selected);
      const allSelected = orderIds.every((orderId) => next.has(orderId));
      for (const orderId of orderIds) {
        if (allSelected) next.delete(orderId);
        else next.add(orderId);
      }
      return next;
    });
  }

  function printSelectedOrderStickers() {
    const selectedOrders = orders.filter((order) => selectedOrderIds.has(order.id) && ["pending", "paid", "preparing", "ready", "done"].includes(order.status));
    if (selectedOrders.length === 0) {
      showToast("กรุณาเลือกออเดอร์ที่ต้องการพิมพ์");
      return;
    }
    try {
      openOrderStickerPrint(selectedOrders, data.settings.shopName);
    } catch (error) {
      showToast(error.message || "เปิดหน้าพิมพ์สติ๊กเกอร์ไม่สำเร็จ");
    }
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

  const [today, setToday] = useState(() => todayStr());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayStr()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const columns = useMemo(() => {
    const map = { pending: [], preparing: [], ready: [], done: [] };
    for (const o of orders) {
      // "paid" ไม่ใช่ 1 ใน 4 สถานะ Kanban แล้ว (รวมเข้ากับ "preparing") — กันไว้เผื่อ order ค้างที่ paid
      // ชั่วคราวจาก race condition ของสลิปยืนยันอัตโนมัติ ไม่ให้การ์ดหายไปจากบอร์ด
      const col = o.status === "paid" ? "preparing" : o.status;
      if (col === "done" && todayStr(new Date(o.completedAt || o.createdAt)) !== today) continue;
      if (map[col]) map[col].push(o);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const aTime = k === "done" ? (a.completedAt || a.createdAt) : a.createdAt;
        const bTime = k === "done" ? (b.completedAt || b.createdAt) : b.createdAt;
        return new Date(bTime) - new Date(aTime);
      });
    }
    return map;
  }, [orders, today]);

  const cancelledToday = orders
    .filter((o) => o.status === "cancelled" && todayStr(new Date(o.cancelledAt || o.createdAt)) === today)
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
  const printableOrders = orders.filter((order) => ["pending", "paid", "preparing", "ready", "done"].includes(order.status));
  const allPrintableSelected = printableOrders.length > 0 && printableOrders.every((order) => selectedOrderIds.has(order.id));

  return (
    <div>
      <SectionTitle icon="layout-kanban" text="บอร์ดออเดอร์ — ลากการ์ดข้ามคอลัมน์เพื่ออัปเดตสถานะ" />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
        margin: "0 0 12px", padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 12, background: "rgba(255,255,255,.55)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--espresso-3)", fontSize: 12.5 }}>
          <button
            type="button"
            className="cbtn"
            onClick={() => setSelectedOrderIds(allPrintableSelected ? new Set() : new Set(printableOrders.map((order) => order.id)))}
            disabled={printableOrders.length === 0}
            style={{ padding: "6px 9px" }}
          >
            <Icon name={allPrintableSelected ? "square-check" : "square"} size={14} />
            <span style={{ marginLeft: 5 }}>{allPrintableSelected ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}</span>
          </button>
          <span>เลือกแล้ว <b>{selectedOrderIds.size}</b> ออเดอร์</span>
        </div>
        <button
          type="button"
          className="cbtn cbtn-accent"
          disabled={selectedOrderIds.size === 0}
          onClick={printSelectedOrderStickers}
          style={{ padding: "7px 12px", opacity: selectedOrderIds.size === 0 ? .5 : 1 }}
        >
          <Icon name="printer" size={14} /> <span style={{ marginLeft: 5 }}>พิมพ์ที่เลือกพร้อมกัน</span>
        </button>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: compact ? "repeat(4, minmax(150px, 1fr))" : "repeat(4, minmax(260px, 1fr))",
        gap: compact ? 7 : 14, overflowX: "auto", paddingBottom: 8, marginBottom: 26,
      }}>
        {KANBAN_COLUMNS.map((col) => {
          const list = columns[col.id];
          const allInColumnSelected = list.length > 0 && list.every((order) => selectedOrderIds.has(order.id));
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
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="cbtn"
                    disabled={list.length === 0}
                    onClick={() => toggleColumnSelection(list)}
                    title={allInColumnSelected ? `ยกเลิกเลือกสถานะ ${col.label}` : `เลือกออเดอร์ทั้งหมดในสถานะ ${col.label}`}
                    aria-label={allInColumnSelected ? `ยกเลิกเลือกสถานะ ${col.label}` : `เลือกสถานะ ${col.label}`}
                    aria-pressed={allInColumnSelected}
                    style={{ display: "grid", width: compact ? 24 : 28, height: compact ? 24 : 28, padding: 0, placeItems: "center" }}
                  >
                    <Icon name={allInColumnSelected ? "square-check" : "square"} size={compact ? 12 : 14} />
                  </button>
                  <span style={{ fontSize: compact ? 10.5 : 12, fontWeight: 700, color: "var(--espresso-2)", background: "var(--cream-2)", borderRadius: 999, padding: compact ? "1px 6px" : "1px 9px" }}>{list.length}</span>
                </div>
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
                      outline: selectedOrderIds.has(o.id) ? "2px solid var(--sage-dark)" : "none",
                      outlineOffset: selectedOrderIds.has(o.id) ? 1 : 0,
                      animation: justMovedIds.has(o.id) ? "paidFlash 1.4s ease" : undefined,
                    })}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: compact ? 11 : 13, fontWeight: 700, color: "var(--espresso-4)", gap: 4 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.customerName ? `${o.customerName} · ${o.customerPhone}` : o.customerPhone}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => toggleOrderSelection(o.id)}
                          title={selectedOrderIds.has(o.id) ? "ยกเลิกเลือกออเดอร์นี้" : "เลือกออเดอร์นี้เพื่อพิมพ์พร้อมกัน"}
                          aria-label={selectedOrderIds.has(o.id) ? "ยกเลิกเลือกออเดอร์" : "เลือกออเดอร์"}
                          aria-pressed={selectedOrderIds.has(o.id)}
                          style={{
                            display: "grid", width: compact ? 26 : 30, height: compact ? 26 : 30, padding: 0, placeItems: "center",
                            border: selectedOrderIds.has(o.id) ? "1px solid var(--sage-dark)" : "1px solid var(--line)", borderRadius: 7,
                            color: selectedOrderIds.has(o.id) ? "#fff" : "var(--espresso-2)", background: selectedOrderIds.has(o.id) ? "var(--sage-dark)" : "rgba(255,255,255,.65)",
                          }}
                        >
                          <Icon name={selectedOrderIds.has(o.id) ? "check" : "plus"} size={12} />
                        </button>
                        {!compact && <Icon name="grip-vertical" size={14} style={{ color: "var(--espresso-2)" }} />}
                      </span>
                    </div>
                    {!compact && (
                      <div style={{ fontSize: 11, color: "var(--espresso-2)", marginTop: 2 }}>
                        {new Date(o.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    )}
                    <OrderMeta paymentMethod={o.paymentMethod} pickupDate={o.pickupDate} paymentVerified={o.paymentVerified} paymentVerifiedBy={o.paymentVerifiedBy} compact={compact} onEditPickupDate={() => setEditingPickupDate(o)} />
                    <OrderItemLines
                      items={o.items} note={o.note} compact={compact}
                      onEditItem={col.id === "pending" ? (idx) => setEditingItem({ order: o, itemIdx: idx }) : undefined}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 700, fontSize: compact ? 13 : 16, fontFamily: "var(--f-body)", borderTop: "1px dashed var(--line)", paddingTop: compact ? 4 : 7, marginBottom: compact ? 6 : 9 }}>
                      <span style={{ fontSize: compact ? 10.5 : 12, fontWeight: 600, color: "var(--espresso-3)" }}>รวม</span><span>฿{money(o.total)}</span>
                    </div>
                    <div style={{ display: "flex", gap: compact ? 4 : 6 }}>
                      <button
                        type="button"
                        className="cbtn"
                        style={{ padding: compact ? "6px" : "8px 10px", flexShrink: 0 }}
                        onClick={() => printOrderStickers(o)}
                        title="พิมพ์สติ๊กเกอร์ A9 สำหรับออเดอร์นี้"
                        aria-label="พิมพ์สติ๊กเกอร์ออเดอร์"
                      >
                        <Icon name="printer" size={13} />{!compact && <span style={{ marginLeft: 4 }}>สติ๊กเกอร์</span>}
                      </button>
                      {col.id !== "done" && (
                        <>
                        <button className="cbtn cbtn-accent" style={{ flex: 1, fontSize: compact ? 10.5 : 12.5, padding: compact ? "6px 4px" : "8px 10px" }} onClick={() => advance(o)}>{compact ? "→ ถัดไป" : KANBAN_NEXT_LABEL[col.id]}</button>
                        <button
                          className="cbtn cbtn-danger" style={{ padding: compact ? "6px 6px" : "8px 9px" }}
                          onClick={() => cancelOrder(o)}
                          title={o.saleRecorded ? "ยกเลิกออเดอร์ (คืนสต็อก/ตัดยอดขายที่บันทึกไปแล้วออกให้)" : "ยกเลิกออเดอร์"}
                        ><Icon name="x" size={13} /></button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ margin: "-18px 0 22px", color: "var(--espresso-2)", fontSize: 11.5 }}>
        คอลัมน์เสร็จแสดงเฉพาะออเดอร์ของวันนี้ · รายการย้อนหลังดูได้ที่ Report → ประวัติออเดอร์
      </p>

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

      {editingPickupDate && (
        <EditPickupDateModal
          order={editingPickupDate}
          onClose={() => setEditingPickupDate(null)}
          onSave={(newDate) => savePickupDate(editingPickupDate, newDate)}
        />
      )}
    </div>
  );
}

function EditPickupDateModal({ order, onClose, onSave }) {
  const [date, setDate] = useState(order.pickupDate);
  useEscape(onClose);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 300 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--espresso-5)", marginBottom: 4 }}>แก้ไขวันที่รับ</div>
        <div style={{ fontSize: 12, color: "var(--espresso-2)", marginBottom: 12 }}>{order.customerName || order.customerPhone}</div>
        <input
          type="date" className="cfield" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ marginBottom: 14 }} autoFocus
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cbtn" style={{ flex: 1, padding: "9px 0" }} onClick={onClose}>ยกเลิก</button>
          <button className="cbtn cbtn-accent" style={{ flex: 1, padding: "9px 0" }} disabled={!date} onClick={() => date && onSave(date)}>บันทึก</button>
        </div>
      </div>
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

const PROMO_TYPES = [
  { id: "single", label: "ลดราคาเมนูเดียว" },
  { id: "bundle", label: "จับคู่คอมโบ (ราคาคงที่)" },
  { id: "qty", label: "ซื้อครบจำนวน ลดเพิ่ม" },
  { id: "choice", label: "ให้ลูกค้าเลือกเอง" },
];

// ป้ายประเภทโปรโมชั่นที่ลูกค้า/แอดมินเห็น — สีต่างกันตามประเภทให้แยกด้วยสายตาได้เร็วในกริดที่มีหลายใบ
const PROMO_TYPE_META = {
  single: { label: "Discount", color: "#B45309", bg: "#FFF4E5" },
  bundle: { label: "Combo", color: "#7C3AED", bg: "#F3EBFE" },
  qty: { label: "Bundle", color: "#0F766E", bg: "#E6F5F3" },
  choice: { label: "Mix & Match", color: "#1D4ED8", bg: "#E8EFFE" },
};

const PROMO_STATUS_META = {
  live: { label: "Live", color: "#15803D", bg: "#EAF7EE", icon: "circle-check" },
  upcoming: { label: "Scheduled", color: "#B45309", bg: "#FFF4E5", icon: "clock" },
  expired: { label: "Expired", color: "#B91C1C", bg: "#FDEBEB", icon: "calendar-x" },
  disabled: { label: "Disabled", color: "#6B7280", bg: "#F3F2EF", icon: "eye-off" },
};

function dtLocalValue(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// สถานะรวม (คำนวณจาก active flag + ช่วงเวลา) ใช้ทั้งแท็บกรอง/badge/สรุปสถิติ ให้เป็นแหล่งความจริงเดียว
function promoStatus(promo) {
  if (promo.active === false) return "disabled";
  return promoActiveWindow(promo);
}

function promoDaysRemaining(promo) {
  if (!promo.endAt) return null;
  const days = Math.ceil((promo.endAt - Date.now()) / 86400000);
  return days;
}

function promoTypeLabel(promo) {
  const type = promo.type || "single";
  if (type === "bundle") return `เซ็ตคอมโบ ${promo.menuIds.length} รายการ`;
  if (type === "qty") return `ซื้อครบ ${promo.minQty} ชิ้น`;
  if (type === "choice") return `เลือก ${promo.chooseCount} จาก ${promo.menuIds.length} รายการ`;
  return "โปรเมนูเดี่ยว";
}

// รวมชื่อเมนูให้อ่านง่ายในพื้นที่จำกัดของการ์ด — โชว์ไม่เกิน 2 ชื่อ ที่เหลือย่อเป็น "+N More"
function promoMenuChipsLabel(menuIds, menusById) {
  const names = menuIds.map((id) => menusById[id]?.name).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} More`;
}

function PromoStatusBadge({ status }) {
  const t = PROMO_STATUS_META[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 9px", background: t.bg, color: t.color, whiteSpace: "nowrap" }}>
      <Icon name={t.icon} size={11} /> {t.label}
    </span>
  );
}

function PromoTypeBadge({ type }) {
  const t = PROMO_TYPE_META[type] || PROMO_TYPE_META.single;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 9px", background: t.bg, color: t.color, whiteSpace: "nowrap" }}>
      {t.label}
    </span>
  );
}

function PromoStatCard({ icon, label, value, tone }) {
  const tones = {
    primary: { bg: POS.primarySoft, fg: POS.primaryDark, icFg: POS.primary },
    navy: { bg: "#EEF2F8", fg: POS.navy, icFg: POS.navy },
    warning: { bg: "#FFF4E5", fg: "#B45309", icFg: "#D97706" },
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

// การ์ดโปรโมชั่น — บนสุด: ชื่อ+ป้ายประเภท/สถานะ, กลาง: สรุปส่วนลด/เมนู/ช่วงเวลา, ล่าง: ราคาก่อน-หลังลด, ท้ายสุด: แก้ไข + เมนู ⋯
function PromoCard({ promo, menusById, priceNode, status, daysRemaining, moreItems, onEdit }) {
  const type = promo.type || "single";
  const displayName = promo.name || (promo.menuIds.map((id) => menusById[id]?.name).filter(Boolean).join(" + ") || "โปรโมชั่น");
  const menuLabel = promoMenuChipsLabel(promo.menuIds, menusById);
  return (
    <div className="promo-card" style={{ opacity: status === "expired" || status === "disabled" ? 0.68 : 1 }}>
      <div style={{ padding: "16px 18px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <PromoTypeBadge type={type} />
            <PromoStatusBadge status={status} />
            {promo.showAsPopup && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 9px", color: "#7C3AED", background: "#F3E8FF", whiteSpace: "nowrap" }}>
                <Icon name="browser" size={11} /> Popup
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: 16.5, fontWeight: 700, color: POS.navy, lineHeight: 1.3, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{displayName}</div>
        <div style={{ fontSize: 12, color: "#9C9690", marginBottom: 10 }}>{promoTypeLabel(promo)}{menuLabel ? ` · ${menuLabel}` : ""}</div>

        {(promo.startAt || promo.endAt) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: status === "expired" ? "#B91C1C" : status === "upcoming" ? "#B45309" : "#6B7280", marginBottom: 10 }}>
            <Icon name="calendar-event" size={13} />
            <span>
              {promo.startAt && promo.endAt ? `${formatPromoDateTime(promo.startAt)} - ${formatPromoDateTime(promo.endAt)}`
                : promo.startAt ? `เริ่ม ${formatPromoDateTime(promo.startAt)}`
                : `ถึง ${formatPromoDateTime(promo.endAt)}`}
            </span>
            {status === "live" && daysRemaining != null && daysRemaining >= 0 && (
              <span style={{ fontWeight: 700, background: daysRemaining <= 2 ? "#FDEBEB" : "#FFF4E5", color: daysRemaining <= 2 ? "#B91C1C" : "#B45309", borderRadius: 999, padding: "1px 7px", flexShrink: 0 }}>
                เหลือ {daysRemaining} วัน
              </span>
            )}
          </div>
        )}

        <div className="promo-price-box">{priceNode}</div>
      </div>

      <div className="promo-card-actions">
        <button className="mnu-act-btn" onClick={onEdit}><Icon name="edit" size={13} /> แก้ไข</button>
        <InvActionsMenu items={moreItems} />
      </div>
    </div>
  );
}

function PromotionsPanel({ data, updateData, showToast }) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("order");
  const [inspector, setInspector] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const menusById = useMemo(() => {
    const m = {};
    for (const x of data.menus) m[x.id] = x;
    return m;
  }, [data.menus]);

  const promotions = data.promotions || [];

  function newPromo() {
    setInspector({ mode: "add", tab: "overview", promo: { id: null, name: "", type: "single", menuIds: [], discountType: "percent", discountValue: 10, minQty: 2, chooseCount: 2, active: true, startAt: null, endAt: null, showAsPopup: false, popupImageUrl: "" } });
  }

  function savePromo(promo) {
    if (promo.menuIds.length === 0) { showToast("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; }
    if (promo.type === "bundle" && promo.menuIds.length < 2) { showToast("โปรจับคู่คอมโบต้องเลือกอย่างน้อย 2 เมนู"); return; }
    if (promo.type === "choice" && promo.menuIds.length < promo.chooseCount) { showToast("จำนวนเมนูในกลุ่มต้องมากกว่าหรือเท่ากับจำนวนที่ให้เลือก"); return; }
    updateData((next) => {
      if (!next.promotions) next.promotions = [];
      const savedPromo = promo.id ? promo : { ...promo, id: genId("promo") };
      if (savedPromo.showAsPopup) {
        next.promotions.forEach((item) => {
          if (item.id !== savedPromo.id) item.showAsPopup = false;
        });
      }
      if (promo.id) {
        const idx = next.promotions.findIndex((p) => p.id === promo.id);
        next.promotions[idx] = savedPromo;
      } else {
        next.promotions.push(savedPromo);
      }
    });
    setInspector(null);
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
    setConfirmDelete(null);
    setInspector(null);
    showToast("ลบโปรโมชั่นแล้ว");
  }

  function duplicatePromo(promo) {
    updateData((next) => {
      if (!next.promotions) next.promotions = [];
      const idx = next.promotions.findIndex((p) => p.id === promo.id);
      const copy = { ...promo, id: genId("promo"), name: (promo.name || "โปรโมชั่น") + " (สำเนา)", active: false, showAsPopup: false };
      next.promotions.splice(idx + 1, 0, copy);
    });
    showToast("ทำสำเนาโปรโมชั่นแล้ว");
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

  const totalCount = promotions.length;
  const statusCounts = useMemo(() => {
    const c = { live: 0, upcoming: 0, expired: 0, disabled: 0 };
    for (const p of promotions) c[promoStatus(p)]++;
    return c;
  }, [promotions]);

  const typeCounts = useMemo(() => {
    const c = { single: 0, bundle: 0, qty: 0, choice: 0 };
    for (const p of promotions) { const t = p.type || "single"; if (c[t] != null) c[t]++; }
    return c;
  }, [promotions]);

  const typeTabOptions = [
    { value: "all", label: `ทั้งหมด (${totalCount})` },
    ...PROMO_TYPES.map((t) => ({ value: t.id, label: `${PROMO_TYPE_META[t.id].label} (${typeCounts[t.id]})` })),
  ];

  function passesFilters(promo) {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const menuNames = promo.menuIds.map((id) => menusById[id]?.name || "").join(" ");
      const hay = `${promo.name || ""} ${menuNames} ${PROMO_TYPE_META[promo.type || "single"].label}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (typeFilter !== "all" && (promo.type || "single") !== typeFilter) return false;
    if (statusFilter !== "all" && promoStatus(promo) !== statusFilter) return false;
    return true;
  }

  const visiblePromotions = useMemo(() => {
    const withIdx = promotions.map((p, idx) => ({ p, idx }));
    const filtered = withIdx.filter(({ p }) => passesFilters(p));
    filtered.sort((a, b) => {
      if (sortBy === "name") return (a.p.name || "").localeCompare(b.p.name || "", "th");
      if (sortBy === "ending") {
        const ae = a.p.endAt || Infinity, be = b.p.endAt || Infinity;
        return ae - be;
      }
      return a.idx - b.idx;
    });
    return filtered.map(({ p, idx }) => ({ promo: p, idx }));
  }, [promotions, query, typeFilter, statusFilter, sortBy, menusById]);

  function moreItemsFor(promo, idx) {
    return [
      ...(idx > 0 && sortBy === "order" ? [{ icon: "chevron-up", label: "เลื่อนขึ้น", onClick: () => movePromo(promo.id, -1) }] : []),
      ...(idx < promotions.length - 1 && sortBy === "order" ? [{ icon: "chevron-down", label: "เลื่อนลง", onClick: () => movePromo(promo.id, 1) }] : []),
      { icon: promo.active === false ? "eye" : "eye-off", label: promo.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน", onClick: () => toggleActive(promo) },
      { icon: "copy", label: "ทำสำเนา", onClick: () => duplicatePromo(promo) },
      { icon: "chart-bar", label: "สถิติการใช้งาน", onClick: () => setInspector({ mode: "edit", tab: "analytics", promo }) },
      { icon: "trash", label: "ลบโปรโมชั่น", danger: true, onClick: () => setConfirmDelete(promo) },
    ];
  }

  return (
    <div className="promo-wrap">
      <style>{`
        .promo-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; }
        .promo-header h2 { margin: 0; font-size: 22px; font-weight: 700; color: ${POS.navy}; }
        .promo-header p { margin: 4px 0 0; font-size: 13px; color: #9C9690; max-width: 480px; line-height: 1.5; }
        .promo-stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        @media (max-width: 720px) { .promo-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .promo-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
        .promo-search { flex: 1; min-width: 200px; position: relative; display: flex; align-items: center; }
        .promo-search input { width: 100%; height: 44px; border: 1px solid ${POS.border}; border-radius: 12px; background: #fff; padding: 0 14px 0 38px; font-size: 14px; color: #1F2937; box-sizing: border-box; outline: none; transition: border 160ms, box-shadow 160ms; }
        .promo-search input:focus { border-color: ${POS.primary}; box-shadow: 0 0 0 3px ${POS.primarySoft}; }
        .promo-select { height: 44px; border: 1px solid ${POS.border}; border-radius: 12px; background: #fff; padding: 0 32px 0 14px; font-size: 13.5px; font-weight: 600; color: #1F2937; cursor: pointer; outline: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; }
        .promo-select:focus { border-color: ${POS.primary}; box-shadow: 0 0 0 3px ${POS.primarySoft}; }
        .promo-btn-primary { display: inline-flex; align-items: center; gap: 7px; height: 44px; padding: 0 18px; border: none; border-radius: 12px; background: ${POS.primary}; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 6px 18px rgba(216,92,8,.28); transition: background 160ms; flex-shrink: 0; }
        .promo-btn-primary:hover { background: ${POS.primaryDark}; }
        .promo-cat-nav { margin-bottom: 18px; overflow-x: auto; }
        .promo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 18px; }
        @media (min-width: 1600px) { .promo-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
        @media (min-width: 1180px) and (max-width: 1599px) { .promo-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
        @media (min-width: 640px) and (max-width: 900px) { .promo-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 639px) { .promo-grid { grid-template-columns: minmax(0, 1fr); } }
        .promo-card { background: #fff; border-radius: 20px; box-shadow: 0 8px 24px rgba(0,0,0,.06); overflow: hidden; display: flex; flex-direction: column; transition: box-shadow 200ms ease; }
        .promo-card:hover { box-shadow: 0 16px 36px rgba(0,0,0,.12); }
        .promo-price-box { background: #FBFAF8; border-radius: 12px; padding: 10px 12px; }
        .promo-card-actions { display: flex; gap: 6px; padding: 0 18px 16px; margin-top: auto; }
        .mnu-act-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 38px; border: 1px solid ${POS.border}; border-radius: 10px; background: #fff; color: ${POS.navy}; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 140ms ease, border-color 140ms ease; }
        .mnu-act-btn:hover { background: ${POS.chipBg}; }
        .inv-icon-btn { width: 36px; height: 36px; border: 1px solid ${POS.border}; border-radius: 9px; background: #fff; color: #6B7280; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .inv-icon-btn:hover { background: #F5F5F3; color: #1F2937; }
        .inv-btn-ghost { height: 40px; padding: 0 16px; border: 1px solid ${POS.border}; border-radius: 10px; background: #fff; color: #1F2937; font-size: 13.5px; font-weight: 600; cursor: pointer; }
        .inv-btn-danger { height: 40px; padding: 0 16px; border: none; border-radius: 10px; background: #DC2626; color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer; }
        .promo-inspector-overlay { position: fixed; inset: 0; background: rgba(22,20,17,.4); z-index: 70; display: flex; justify-content: flex-end; animation: mnuFade 160ms ease; }
        .promo-inspector { width: min(520px, 100%); height: 100%; background: #fff; box-shadow: -8px 0 40px rgba(0,0,0,.18); display: flex; flex-direction: column; animation: mnuSlide 240ms cubic-bezier(.2,.8,.2,1); }
        .promo-insp-head { padding: 18px 22px; border-bottom: 1px solid ${POS.border}; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-shrink: 0; }
        .promo-insp-tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid ${POS.border}; flex-shrink: 0; overflow-x: auto; }
        .promo-insp-tab { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 10px 12px; font-size: 12.5px; font-weight: 700; color: #9C9690; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; min-height: 40px; }
        .promo-insp-tab.active { color: ${POS.primary}; border-bottom-color: ${POS.primary}; }
        .promo-insp-body { padding: 20px 22px; overflow-y: auto; flex: 1; }
        .promo-insp-footer { padding: 16px 22px; border-top: 1px solid ${POS.border}; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .promo-btn-danger-ghost { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; border: 1px solid #F3D5D2; border-radius: 10px; background: #fff; color: #DC2626; font-size: 13px; font-weight: 700; cursor: pointer; }
        .promo-btn-danger-ghost:hover { background: #FDEBEB; }
        @keyframes mnuFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mnuSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @media (max-width: 760px) {
          .promo-inspector-overlay { align-items: stretch; }
          .promo-inspector { width: 100%; height: 100dvh; }
        }
        .promo-field:focus { border-color: ${POS.primary} !important; box-shadow: 0 0 0 3px ${POS.primarySoft}; }
        .promo-type-pill { border: 1px solid ${POS.border}; background: #fff; color: #1F2937; border-radius: 12px; padding: 12px 14px; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; transition: all 160ms ease; }
        .promo-type-pill.active { border-color: ${POS.primary}; background: ${POS.primarySoft}; color: ${POS.primaryDark}; }
        .promo-menu-list { max-height: 260px; overflow-y: auto; border: 1px solid ${POS.border}; border-radius: 12px; padding: 6px; }
        .promo-menu-row { display: flex; align-items: center; gap: 10px; padding: 9px 8px; border-radius: 8px; font-size: 13.5px; min-height: 40px; }
        .promo-menu-row:hover { background: #FAFAF8; }
      `}</style>

      <div className="promo-header">
        <div>
          <h2>Promotions</h2>
          <p>Manage discounts, combo promotions, bundles and marketing campaigns.</p>
        </div>
        <button className="promo-btn-primary" onClick={newPromo}><Icon name="plus" size={16} /> Add Promotion</button>
      </div>

      <div className="promo-stats-grid" style={{ marginBottom: 20 }}>
        <PromoStatCard icon="discount" label="Total" value={totalCount} tone="navy" />
        <PromoStatCard icon="circle-check" label="Active" value={statusCounts.live} tone="primary" />
        <PromoStatCard icon="clock" label="Scheduled" value={statusCounts.upcoming} tone="warning" />
        <PromoStatCard icon="calendar-x" label="Expired" value={statusCounts.expired} tone="neutral" />
      </div>

      <div className="promo-toolbar">
        <div className="promo-search">
          <Icon name="search" size={15} style={{ position: "absolute", left: 13, color: "#9C9690" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาโปรโมชั่น, เมนู, ประเภท..." aria-label="ค้นหาโปรโมชั่น" />
        </div>
        <select className="promo-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="กรองตามสถานะ">
          <option value="all">ทุกสถานะ</option>
          <option value="live">Live</option>
          <option value="upcoming">Scheduled</option>
          <option value="expired">Expired</option>
          <option value="disabled">Disabled</option>
        </select>
        <select className="promo-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="เรียงลำดับ">
          <option value="order">เรียง: ลำดับที่ตั้งไว้</option>
          <option value="name">เรียง: ชื่อ</option>
          <option value="ending">เรียง: ใกล้หมดเขตก่อน</option>
        </select>
      </div>

      <div className="promo-cat-nav">
        <Segmented options={typeTabOptions} value={typeFilter} onChange={setTypeFilter} dense />
      </div>

      {promotions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 20px", background: "#fff", borderRadius: 20, boxShadow: "0 8px 24px rgba(0,0,0,.06)" }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: POS.primarySoft, color: POS.primary, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Icon name="discount" size={30} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#1F2937", margin: "0 0 4px" }}>No promotions yet</p>
          <p style={{ fontSize: 13, color: "#9C9690", margin: "0 0 20px" }}>Create your first campaign</p>
          <button className="promo-btn-primary" style={{ margin: "0 auto" }} onClick={newPromo}><Icon name="plus" size={16} /> Create Promotion</button>
        </div>
      ) : visiblePromotions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", background: "#fff", borderRadius: 20, boxShadow: "0 8px 24px rgba(0,0,0,.06)" }}>
          <Icon name="search-off" size={28} style={{ color: "#9C9690" }} />
          <p style={{ fontSize: 14, fontWeight: 600, color: "#1F2937", margin: "12px 0 2px" }}>ไม่พบโปรโมชั่นที่ตรงกับเงื่อนไข</p>
          <p style={{ fontSize: 12.5, color: "#9C9690", margin: 0 }}>ลองปรับคำค้นหาหรือตัวกรอง</p>
        </div>
      ) : (
        <div className="promo-grid">
          {visiblePromotions.map(({ promo, idx }) => {
            const type = promo.type || "single";
            const status = promoStatus(promo);
            const daysRemaining = promoDaysRemaining(promo);
            let priceNode = null;
            if (type === "bundle" || type === "single") {
              const { items, originalTotal, promoTotal } = computePromoPricing(promo, menusById);
              const savings = Math.max(0, originalTotal - promoTotal);
              priceNode = (
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "#9C9690", textDecoration: "line-through" }}>฿{money(originalTotal)}</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: POS.primary }}>฿{money(promoTotal)}</span>
                  </div>
                  {savings > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#15803D", background: "#EAF7EE", borderRadius: 999, padding: "2px 8px" }}>Save ฿{money(savings)}</span>}
                </div>
              );
            } else if (type === "qty") {
              const menu = menusById[promo.menuIds[0]];
              const setPrice = qtyPromoSetPrice(promo, menu);
              const original = menu ? menu.priceStore * promo.minQty : 0;
              const savings = Math.max(0, original - setPrice);
              priceNode = menu ? (
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "#9C9690", textDecoration: "line-through" }}>฿{money(original)}</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: POS.primary }}>฿{money(setPrice)}</span>
                  </div>
                  {savings > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#15803D", background: "#EAF7EE", borderRadius: 999, padding: "2px 8px" }}>Save ฿{money(savings)}</span>}
                </div>
              ) : null;
            } else if (type === "choice") {
              priceNode = (
                <div style={{ fontSize: 14, fontWeight: 700, color: POS.primary }}>
                  {promo.discountType === "percent" ? `ลด ${promo.discountValue}% จากรายการที่เลือก` : `ราคาชุดละ ฿${money(promo.discountValue)}`}
                </div>
              );
            }
            return (
              <PromoCard
                key={promo.id}
                promo={promo}
                menusById={menusById}
                priceNode={priceNode}
                status={status}
                daysRemaining={daysRemaining}
                moreItems={moreItemsFor(promo, idx)}
                onEdit={() => setInspector({ mode: "edit", tab: "overview", promo })}
              />
            );
          })}
        </div>
      )}

      {inspector && (
        <PromoInspector
          key={inspector.mode + (inspector.promo.id || "new")}
          mode={inspector.mode}
          initial={inspector.promo}
          initialTab={inspector.tab}
          menus={data.menus}
          menusById={menusById}
          onSave={savePromo}
          onClose={() => setInspector(null)}
          onDelete={() => setConfirmDelete(inspector.promo)}
        />
      )}

      {confirmDelete && (
        <InvConfirmDialog
          title="ลบโปรโมชั่นนี้?"
          message={`คุณกำลังจะลบโปรโมชั่น "${confirmDelete.name || "โปรโมชั่นนี้"}" ออกจากระบบถาวร ลูกค้าจะไม่เห็นดีลนี้อีก`}
          confirmLabel="ลบโปรโมชั่น"
          onConfirm={() => deletePromo(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function PromoInspector({ mode, initial, initialTab, menus, menusById, onSave, onClose, onDelete }) {
  const [form, setForm] = useState({
    type: "single", minQty: 2, chooseCount: 2, startAt: null, endAt: null,
    ...initial, menuIds: initial.menuIds || [],
  });
  const [tab, setTab] = useState(initialTab || "overview");
  useEscape(onClose);

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

  const canSave = form.menuIds.length > 0;
  const { originalTotal, promoTotal } = computePromoPricing(form, menusById);
  const qtyMenu = form.type === "qty" ? menusById[form.menuIds[0]] : null;
  const qtySetPrice = qtyMenu ? qtyPromoSetPrice(form, qtyMenu) : 0;

  const TABS = [
    ["overview", "Overview", "info-circle"],
    ["settings", "Popup & Settings", "browser"],
    ["menus", "Menus", "cup"],
    ["pricing", "Pricing", "chart-line"],
    ["schedule", "Schedule", "calendar-event"],
    ["analytics", "Analytics", "chart-bar"],
  ];

  return (
    <div className="promo-inspector-overlay" onClick={onClose}>
      <div className="promo-inspector" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={mode === "add" ? "เพิ่มโปรโมชั่นใหม่" : "แก้ไขโปรโมชั่น"}>
        <div className="promo-insp-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: POS.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {form.name || (mode === "add" ? "โปรโมชั่นใหม่" : "แก้ไขโปรโมชั่น")}
            </div>
            <div style={{ fontSize: 11.5, color: "#9C9690", marginTop: 1 }}>{PROMO_TYPE_META[form.type || "single"].label}</div>
          </div>
          <button className="inv-icon-btn" onClick={onClose} aria-label="ปิด"><Icon name="x" size={18} /></button>
        </div>

        <div className="promo-insp-tabs">
          {TABS.map(([id, label, icon]) => (
            <button key={id} className={"promo-insp-tab" + (tab === id ? " active" : "")} onClick={() => setTab(id)}>
              <Icon name={icon} size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="promo-insp-body">
          {tab === "overview" && <PromoOverviewTab form={form} setForm={setForm} setType={setType} />}
          {tab === "menus" && <PromoMenusTab form={form} menus={menus} toggleMenu={toggleMenu} />}
          {tab === "pricing" && <PromoPricingTab form={form} setForm={setForm} menusById={menusById} originalTotal={originalTotal} promoTotal={promoTotal} qtyMenu={qtyMenu} qtySetPrice={qtySetPrice} />}
          {tab === "schedule" && <PromoScheduleTab form={form} setForm={setForm} />}
          {tab === "analytics" && <PromoAnalyticsTab />}
          {tab === "settings" && <PromoSettingsTab form={form} setForm={setForm} />}
        </div>

        <div className="promo-insp-footer">
          {mode === "edit" && <button className="promo-btn-danger-ghost" onClick={onDelete}><Icon name="trash" size={14} /> ลบโปรโมชั่น</button>}
          <div style={{ flex: 1 }} />
          <button className="inv-btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="promo-btn-primary" disabled={!canSave} style={{ opacity: canSave ? 1 : .55, cursor: canSave ? "pointer" : "not-allowed" }} onClick={() => onSave(form)}>
            {mode === "add" ? "บันทึกโปรโมชั่น" : "บันทึกการแก้ไข"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoOverviewTab({ form, setForm, setType }) {
  const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#9C9690", marginBottom: 6 };
  const field = { width: "100%", height: 44, border: `1px solid ${POS.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 14, color: "#1F2937", boxSizing: "border-box", outline: "none" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <label style={lbl}>ประเภทโปรโมชั่น</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {PROMO_TYPES.map((t) => (
            <button key={t.id} type="button" className={"promo-type-pill" + (form.type === t.id ? " active" : "")} onClick={() => setType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label style={lbl}>ชื่อโปรโมชั่น (ถ้าเว้นว่างจะใช้ชื่อเมนูต่อกัน)</label>
        <TextField className="promo-field" style={field} value={form.name || ""} onChange={(v) => setForm({ ...form, name: v })} placeholder="เช่น คู่หูสุดคุ้ม" />
      </div>
      <p style={{ fontSize: 12, color: "#9C9690", margin: 0, lineHeight: 1.5 }}>
        {form.type === "single" && "เลือกเมนูที่ต้องการลดราคาในแท็บ \"Menus\""}
        {form.type === "bundle" && "เลือกเมนูทั้งหมดที่จะรวมเป็นเซ็ตคอมโบในแท็บ \"Menus\" (อย่างน้อย 2 รายการ)"}
        {form.type === "qty" && "เลือกเมนูที่จะให้ซื้อครบจำนวนแล้วลดราคาในแท็บ \"Menus\""}
        {form.type === "choice" && "เลือกกลุ่มเมนูที่ให้ลูกค้าเลือกเองในแท็บ \"Menus\""}
      </p>
    </div>
  );
}

function PromoMenusTab({ form, menus, toggleMenu }) {
  return (
    <div>
      <p style={{ fontSize: 12, color: "#9C9690", margin: "0 0 10px", lineHeight: 1.5 }}>
        {form.type === "single" && "เลือกเมนูที่ต้องการลดราคา"}
        {form.type === "bundle" && "เลือกเมนูทั้งหมดที่จะรวมเป็นเซ็ตคอมโบ (อย่างน้อย 2 รายการ)"}
        {form.type === "qty" && "เลือกเมนูที่จะให้ซื้อครบจำนวนแล้วลดราคา"}
        {form.type === "choice" && "เลือกกลุ่มเมนูที่ให้ลูกค้าเลือกเอง (ต้องมีมากกว่าหรือเท่ากับจำนวนที่ให้เลือก)"}
      </p>
      <div className="promo-menu-list">
        {menus.length === 0 ? <EmptyNote text="ยังไม่มีเมนูในระบบ" /> : menus.map((m) => (
          <label key={m.id} className="promo-menu-row">
            <input
              type={form.type === "single" || form.type === "qty" ? "radio" : "checkbox"}
              name="promo-menu"
              checked={form.menuIds.includes(m.id)}
              onChange={() => toggleMenu(m.id)}
              style={{ width: 16, height: 16, flexShrink: 0 }}
            />
            <span style={{ flex: 1 }}>{m.name}</span>
            <span style={{ color: "#9C9690", fontSize: 11.5, flexShrink: 0 }}>฿{money(m.priceStore)}</span>
          </label>
        ))}
      </div>
      {form.type === "qty" && (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9C9690", marginBottom: 6 }}>ซื้อครบกี่ชิ้นต่อเซ็ต</label>
          <input className="promo-field" type="number" min={2} value={form.minQty} style={{ width: 120, height: 40, border: `1px solid ${POS.border}`, borderRadius: 10, padding: "0 10px" }} disabled />
        </div>
      )}
      {form.type === "choice" && (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#9C9690", marginBottom: 6 }}>ให้ลูกค้าเลือกกี่รายการจากกลุ่มนี้</label>
          <p style={{ fontSize: 11.5, color: "#9C9690", margin: 0 }}>ตั้งค่าจำนวนได้ในแท็บ "Pricing"</p>
        </div>
      )}
    </div>
  );
}

function PromoPricingTab({ form, setForm, originalTotal, promoTotal, qtyMenu, qtySetPrice }) {
  const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#9C9690", marginBottom: 6 };
  const field = { width: "100%", height: 44, border: `1px solid ${POS.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 14, color: "#1F2937", boxSizing: "border-box", outline: "none" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {form.type === "qty" && (
        <div>
          <label style={lbl}>ซื้อครบกี่ชิ้นต่อเซ็ต</label>
          <input className="promo-field" style={{ ...field, width: 140 }} type="number" min={2} value={form.minQty} onChange={(e) => setForm({ ...form, minQty: Math.max(2, Number(e.target.value)) })} />
        </div>
      )}
      {form.type === "choice" && (
        <div>
          <label style={lbl}>ให้ลูกค้าเลือกกี่รายการจากกลุ่มนี้</label>
          <input className="promo-field" style={{ ...field, width: 140 }} type="number" min={1} value={form.chooseCount} onChange={(e) => setForm({ ...form, chooseCount: Math.max(1, Number(e.target.value)) })} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={lbl}>รูปแบบส่วนลด</label>
          <select className="promo-field" style={field} value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
            <option value="percent">ลดเป็น % จากราคารวม</option>
            <option value="fixed">กำหนดราคาขายตายตัว</option>
          </select>
        </div>
        <div>
          <label style={lbl}>{form.discountType === "percent" ? "เปอร์เซ็นต์ส่วนลด (%)" : form.type === "qty" ? "ราคาต่อเซ็ต (บาท)" : "ราคาขาย (บาท)"}</label>
          <input className="promo-field" style={field} type="number" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })} />
        </div>
      </div>

      {(form.type === "single" || form.type === "bundle") && form.menuIds.length > 0 && (
        <div style={{ background: POS.primarySoft, borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11.5, color: POS.primaryDark, marginBottom: 6, fontWeight: 600 }}>ตัวอย่างราคาที่ลูกค้าจะเห็น</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 14, color: "#9C9690", textDecoration: "line-through" }}>฿{money(originalTotal)}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: POS.primary }}>฿{money(promoTotal)}</span>
          </div>
        </div>
      )}
      {form.type === "qty" && qtyMenu && (
        <div style={{ background: POS.primarySoft, borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11.5, color: POS.primaryDark, marginBottom: 6, fontWeight: 600 }}>ตัวอย่างราคาที่ลูกค้าจะเห็น (ซื้อครบ {form.minQty} ชิ้น)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 14, color: "#9C9690", textDecoration: "line-through" }}>฿{money(qtyMenu.priceStore * form.minQty)}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: POS.primary }}>฿{money(qtySetPrice)}</span>
          </div>
        </div>
      )}
      {form.type === "choice" && (
        <p style={{ fontSize: 12, color: "#9C9690", margin: 0, lineHeight: 1.6 }}>
          ลูกค้าจะเลือกเอง {form.chooseCount} รายการจากกลุ่มนี้ตอนสั่งซื้อ ราคาจะคำนวณจาก{form.discountType === "percent" ? `ส่วนลด ${form.discountValue}% ของราคารวมที่เลือก` : `ราคาชุดคงที่ ฿${money(form.discountValue)}`}
        </p>
      )}
    </div>
  );
}

function PromoScheduleTab({ form, setForm }) {
  const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#9C9690", marginBottom: 6 };
  const field = { width: "100%", height: 44, border: `1px solid ${POS.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 14, color: "#1F2937", boxSizing: "border-box", outline: "none" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 12, color: "#9C9690", margin: 0, lineHeight: 1.5 }}>กำหนดช่วงเวลาโปรโมชั่น (ไม่บังคับ — เว้นว่างไว้ถ้าไม่ต้องการจำกัดเวลา)</p>
      <div>
        <label style={lbl}>เริ่ม</label>
        <input className="promo-field" style={field} type="datetime-local" value={dtLocalValue(form.startAt)} onChange={(e) => setForm({ ...form, startAt: e.target.value ? new Date(e.target.value).getTime() : null })} />
      </div>
      <div>
        <label style={lbl}>สิ้นสุด</label>
        <input className="promo-field" style={field} type="datetime-local" value={dtLocalValue(form.endAt)} onChange={(e) => setForm({ ...form, endAt: e.target.value ? new Date(e.target.value).getTime() : null })} />
      </div>
    </div>
  );
}

function PromoAnalyticsTab() {
  return (
    <div style={{ textAlign: "center", padding: "32px 8px" }}>
      <Icon name="chart-bar" size={26} style={{ color: "#9C9690" }} />
      <p style={{ fontSize: 13.5, fontWeight: 600, color: "#1F2937", margin: "12px 0 4px" }}>ยังไม่มีข้อมูลสถิติ</p>
      <p style={{ fontSize: 12, color: "#9C9690", margin: 0, lineHeight: 1.6, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
        ระบบยังไม่ได้เก็บข้อมูลจำนวนครั้งที่ใช้/ยอดขายแยกรายโปรโมชั่น (ยอดขายที่ผ่านโปรฯ ในปัจจุบันจะรวมอยู่ในยอดขายปกติ)
      </p>
    </div>
  );
}

function PromoSettingsTab({ form, setForm }) {
  const field = { width: "100%", minHeight: 44, border: `1px solid ${POS.border}`, borderRadius: 10, background: "#fff", padding: "0 12px", fontSize: 14, color: "#1F2937", boxSizing: "border-box", outline: "none" };
  const label = { display: "block", fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px" }}>
        <OptgToggle checked={form.active !== false} onChange={(v) => setForm({ ...form, active: v })} color={POS.primary} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1F2937" }}>เปิดใช้งานโปรโมชั่นนี้</span>
      </label>
      <p style={{ fontSize: 12, color: "#9C9690", margin: "8px 0 0", lineHeight: 1.5 }}>
        โปรโมชั่นที่เปิดใช้งานจะแสดงในหมวด "ดีลพิเศษ" อันดับแรกสุดของหน้าลูกค้า พร้อมราคาปกติขีดฆ่าและราคาโปรสีแดง ปิดใช้งานเพื่อซ่อนชั่วคราวโดยไม่ต้องลบ
      </p>

      <div style={{ height: 1, background: POS.border, margin: "20px 0 12px" }} />
      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 4px" }}>
        <span>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "#1F2937" }}>แสดงเป็น Popup หลัง Splash Screen</span>
          <span style={{ display: "block", marginTop: 2, color: "#9C9690", fontSize: 11.5 }}>เลือกได้ครั้งละหนึ่งโปรโมชั่น และแสดงหนึ่งครั้งต่อ session</span>
        </span>
        <OptgToggle checked={form.showAsPopup === true} onChange={(v) => setForm({ ...form, showAsPopup: v })} color={POS.primary} />
      </label>

      {form.showAsPopup && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14, padding: 16, borderRadius: 14, background: "#F7F8FA", border: `1px solid ${POS.border}` }}>
          <div>
            <label style={label}>URL รูป Popup (แนะนำแนวตั้ง 4:5)</label>
            <TextField className="promo-field" style={field} value={form.popupImageUrl || ""} onChange={(v) => setForm({ ...form, popupImageUrl: v })} placeholder="https://..." />
            <span style={{ display: "block", marginTop: 5, color: "#9C9690", fontSize: 11 }}>หากเว้นว่าง ระบบจะใช้รูปของเมนูแรกในโปรโมชั่น</span>
          </div>
          {form.popupImageUrl && (
            <img src={form.popupImageUrl} alt="ตัวอย่าง Promotion Popup" style={{ width: "100%", maxHeight: 230, objectFit: "contain", borderRadius: 12, background: "#E9EDF2" }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#6B7280", fontSize: 11.5, lineHeight: 1.5 }}>
            <Icon name="clock" size={14} style={{ flexShrink: 0 }} /> รูปจะแสดงกลางหน้าสั่งโดยไม่ครอป กดเพื่อเปิดโปรโมชั่น หรือปิดอัตโนมัติใน 5 วินาที
          </div>
        </div>
      )}
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

function ReportsPanel({ data, orders, shopName, showToast }) {
  const [range, setRange] = useState("today");
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [historyLimit, setHistoryLimit] = useState(50);
  const [orderStatusFilter, setOrderStatusFilter] = useState("done");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderHistoryLimit, setOrderHistoryLimit] = useState(50);
  const [historyOrder, setHistoryOrder] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { setHistoryLimit(50); }, [range, search, channelFilter]);
  useEffect(() => { setOrderHistoryLimit(50); }, [range, orderSearch, orderStatusFilter]);

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

  const orderHistoryRows = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return (orders || [])
      .filter((order) => order.status === "done" || order.status === "cancelled")
      .filter((order) => orderStatusFilter === "all" || order.status === orderStatusFilter)
      .filter((order) => {
        const timestamp = order.status === "done"
          ? (order.completedAt || order.createdAt)
          : (order.cancelledAt || order.createdAt);
        const d = new Date(timestamp);
        if (range === "today") return todayStr(d) === todayStr(now);
        if (range === "week") { const diff = (now - d) / 86400000; return diff >= 0 && diff <= 7; }
        if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        return true;
      })
      .filter((order) => {
        if (!q) return true;
        const haystack = [
          order.id,
          order.id?.slice(-6),
          order.customerName,
          order.customerPhone,
          ...(order.items || []).map((item) => item.name),
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const aTime = a.status === "done" ? (a.completedAt || a.createdAt) : (a.cancelledAt || a.createdAt);
        const bTime = b.status === "done" ? (b.completedAt || b.createdAt) : (b.cancelledAt || b.createdAt);
        return new Date(bTime) - new Date(aTime);
      });
  }, [orders, orderStatusFilter, orderSearch, range, now]);

  function printHistoryOrder(order) {
    try {
      openOrderStickerPrint(order, shopName);
    } catch (error) {
      showToast(error.message || "เปิดหน้าพิมพ์สติ๊กเกอร์ไม่สำเร็จ");
    }
  }

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

      <div className="rep-card">
        <DashSectionHeader
          icon="clipboard-list"
          text="ประวัติออเดอร์"
          hint="แยกจากประวัติการขาย: ใช้ตรวจสอบออเดอร์ที่เสร็จแล้วหรือถูกยกเลิก โดยไม่กระทบยอดรายได้และกำไร"
        />
        <div className="rep-toolbar" style={{ marginBottom: 14 }}>
          <div className="rep-period-tabs" aria-label="กรองสถานะประวัติออเดอร์">
            {[["done", "เสร็จแล้ว"], ["cancelled", "ยกเลิก"], ["all", "ทั้งหมด"]].map(([status, label]) => (
              <button
                key={status}
                type="button"
                className={"rep-period-tab" + (orderStatusFilter === status ? " active" : "")}
                onClick={() => setOrderStatusFilter(status)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="rep-search">
            <Icon name="search" size={14} style={{ position: "absolute", left: 12, color: DASH.gray }} />
            <input
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="ค้นหาเลขออเดอร์ ชื่อ เบอร์โทร หรือเมนู..."
              aria-label="ค้นหาประวัติออเดอร์"
            />
          </div>
        </div>

        {orderHistoryRows.length === 0 ? <EmptyNote text="ไม่พบออเดอร์ที่ตรงกับสถานะและช่วงเวลาที่เลือก" /> : (
          <>
            <div className="table-scroll">
              <table className="rep-table rep-table-cards">
                <thead><tr><th>เวลาสิ้นสุด</th><th>ออเดอร์</th><th>ลูกค้า</th><th>รายการ</th><th>ชำระ</th><th>ยอดรวม</th><th>สถานะ</th><th></th></tr></thead>
                <tbody>
                  {orderHistoryRows.slice(0, orderHistoryLimit).map((order) => {
                    const finishedAt = order.status === "done"
                      ? (order.completedAt || order.createdAt)
                      : (order.cancelledAt || order.createdAt);
                    return (
                      <tr key={order.id}>
                        <td data-label="เวลาสิ้นสุด" style={{ whiteSpace: "nowrap" }}>{new Date(finishedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
                        <td data-label="ออเดอร์" style={{ whiteSpace: "nowrap", fontWeight: 700 }}>#{order.id.slice(-6).toUpperCase()}</td>
                        <td data-label="ลูกค้า">
                          <div style={{ fontWeight: 600 }}>{order.customerName || "ไม่ระบุชื่อ"}</div>
                          <div style={{ color: DASH.gray, fontSize: 11 }}>{order.customerPhone || "ไม่มีเบอร์โทร"}</div>
                        </td>
                        <td className="rep-td-menu" data-label="รายการ">
                          <span>{(order.items || []).map((item) => `${item.name} ×${item.qty}`).join(", ") || "-"}</span>
                        </td>
                        <td data-label="ชำระ" style={{ whiteSpace: "nowrap" }}>{PAYMENT_METHOD_LABEL[order.paymentMethod] || "-"}</td>
                        <td data-label="ยอดรวม" style={{ whiteSpace: "nowrap", fontWeight: 600 }}>฿{money(order.total)}</td>
                        <td data-label="สถานะ" style={{ whiteSpace: "nowrap" }}><StatusBadge status={order.status} /></td>
                        <td data-label="จัดการ">
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, whiteSpace: "nowrap" }}>
                            <button type="button" className="cbtn" style={{ padding: "6px 9px" }} onClick={() => setHistoryOrder(order)}>
                              <Icon name="eye" size={13} /> <span style={{ marginLeft: 4 }}>รายละเอียด</span>
                            </button>
                            {order.status === "done" && (
                              <button type="button" className="cbtn" style={{ padding: "6px 9px" }} onClick={() => printHistoryOrder(order)}>
                                <Icon name="printer" size={13} /> <span style={{ marginLeft: 4 }}>พิมพ์ซ้ำ</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {orderHistoryRows.length > orderHistoryLimit && (
              <button className="rep-load-more" onClick={() => setOrderHistoryLimit((n) => n + 50)}>
                โหลดเพิ่ม ({orderHistoryRows.length - orderHistoryLimit} ออเดอร์ที่เหลือ)
              </button>
            )}
          </>
        )}
      </div>

      {historyOrder && (
        <OrderHistoryModal
          order={historyOrder}
          onClose={() => setHistoryOrder(null)}
          onPrint={historyOrder.status === "done" ? () => printHistoryOrder(historyOrder) : null}
        />
      )}
    </div>
  );
}

function OrderHistoryModal({ order, onClose, onPrint }) {
  useEscape(onClose);
  const finishedAt = order.status === "done"
    ? (order.completedAt || order.createdAt)
    : (order.cancelledAt || order.createdAt);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, background: "rgba(17,24,39,.48)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`รายละเอียดออเดอร์ ${order.id.slice(-6).toUpperCase()}`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 100%)", maxHeight: "min(760px, calc(100vh - 36px))", overflowY: "auto", background: "#fff", borderRadius: 18, padding: 20, boxShadow: "0 24px 70px rgba(0,0,0,.24)" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, color: DASH.gray, fontSize: 11 }}>เลขออเดอร์</p>
            <h2 style={{ margin: "2px 0 6px", color: "#111827", fontSize: 20 }}>#{order.id.slice(-6).toUpperCase()}</h2>
            <StatusBadge status={order.status} />
          </div>
          <button type="button" className="cbtn" onClick={onClose} aria-label="ปิดรายละเอียด" style={{ display: "grid", width: 34, height: 34, padding: 0, placeItems: "center" }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            ["ลูกค้า", order.customerName || "ไม่ระบุชื่อ"],
            ["เบอร์โทร", order.customerPhone || "ไม่มีเบอร์โทร"],
            [order.status === "done" ? "เสร็จเมื่อ" : "ยกเลิกเมื่อ", new Date(finishedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })],
            ["วันรับ", formatPickupDateTH(order.pickupDate) || "-"],
            ["ชำระเงิน", PAYMENT_METHOD_LABEL[order.paymentMethod] || "-"],
            ["ยอดรวม", `฿${money(order.total)}`],
          ].map(([label, value]) => (
            <div key={label} style={{ border: `1px solid ${DASH.border}`, borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ color: DASH.gray, fontSize: 10.5, marginBottom: 2 }}>{label}</div>
              <div style={{ color: "#1F2937", fontSize: 13, fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ border: `1px solid ${DASH.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          {(order.items || []).map((item, index) => (
            <div key={`${item.menuId || item.name}-${index}`} style={{ padding: "11px 13px", borderBottom: index < (order.items || []).length - 1 ? `1px solid ${DASH.border}` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5, fontWeight: 700 }}>
                <span>{item.name} ×{item.qty}</span>
                <span style={{ whiteSpace: "nowrap" }}>฿{money((item.unitPrice || 0) * (item.qty || 0))}</span>
              </div>
              {(item.options || []).length > 0 && (
                <div style={{ marginTop: 3, color: DASH.gray, fontSize: 11.5 }}>{item.options.map((option) => option.label).join(" · ")}</div>
              )}
            </div>
          ))}
        </div>

        {order.note && (
          <div style={{ marginBottom: 14, borderRadius: 10, padding: "10px 12px", background: DASH.warningSoft, color: "#92400E", fontSize: 12.5 }}>
            <b>หมายเหตุ:</b> {order.note}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="cbtn" onClick={onClose}>ปิด</button>
          {onPrint && (
            <button type="button" className="cbtn cbtn-accent" onClick={onPrint}>
              <Icon name="printer" size={14} /> <span style={{ marginLeft: 5 }}>พิมพ์สติ๊กเกอร์ซ้ำ</span>
            </button>
          )}
        </div>
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

const KNOWN_DELIVERY_PLATFORMS = ["GrabFood", "LINE MAN", "foodpanda", "ShopeeFood"];

// การ์ดตั้งค่าแบบมาตรฐาน — หัวข้อ 16-18px semibold ตามสเปก ต่างจาก SectionTitle เดิม (ตัวเล็ก uppercase) ที่ใช้เป็น
// หัวข้อรองของแท็บอื่น เพราะบรีฟหน้านี้ต้องการ hierarchy ที่ชัดกว่าเดิมโดยเฉพาะ
function SettingsCard({ icon, title, subtitle, children, style }) {
  return (
    <div className="set-card" style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: subtitle ? 2 : 14 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--cream-2)", color: "var(--sage-dark)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={icon} size={16} />
        </div>
        <div style={{ fontSize: 16.5, fontWeight: 600, color: "var(--espresso-5)" }}>{title}</div>
      </div>
      {subtitle && <div style={{ fontSize: 12.5, color: "var(--espresso-2)", marginBottom: 14, lineHeight: 1.5 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function SettingsField({ label, error, suffix, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--espresso-4)", marginBottom: 5 }}>{label}</label>
      <div style={{ position: "relative" }}>
        {children}
        {suffix && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12.5, color: "var(--espresso-2)", fontWeight: 600, pointerEvents: "none" }}>{suffix}</span>}
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}><Icon name="alert-circle" size={12} />{error}</div>}
    </div>
  );
}

// ไม่มี Accordion สำเร็จรูปในระบบมาก่อน สร้างใหม่แบบง่ายที่สุด — ปิดเป็นค่าเริ่มต้นเสมอตามสเปก
function SettingsAccordion({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="set-card" style={{ padding: 0, overflow: "hidden" }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "16px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--espresso-4)" }}>{title}</span>
        <Icon name="chevron-down" size={16} style={{ color: "var(--espresso-2)", transition: "transform 200ms ease", transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }} />
      </button>
      {open && <div style={{ padding: "0 20px 18px" }}>{children}</div>}
    </div>
  );
}

function BannerThumbPreview({ url, alt }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <div className="set-banner-thumb">
      {url && !failed ? (
        <img src={url} alt={alt || "ตัวอย่างแบนเนอร์"} onError={() => setFailed(true)} />
      ) : (
        <div className="set-banner-thumb-empty"><Icon name="photo" size={20} /></div>
      )}
    </div>
  );
}

function bannerNameFromUrl(url) {
  if (!url) return "ยังไม่ได้ใส่รูป";
  try {
    const clean = url.split("?")[0];
    const parts = clean.split("/");
    return decodeURIComponent(parts[parts.length - 1] || url);
  } catch {
    return url;
  }
}

function BannerCard({ url, index, editing, onEdit, onChange, onDelete, dragProps }) {
  return (
    <div
      className="set-banner-card"
      draggable
      {...dragProps}
    >
      <span className="set-drag-handle" title="ลากเพื่อเรียงลำดับ" aria-label="ลากเพื่อเรียงลำดับ"><Icon name="grip-vertical" size={15} /></span>
      <BannerThumbPreview url={url} alt={`แบนเนอร์ลำดับที่ ${index + 1}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--espresso-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bannerNameFromUrl(url)}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--espresso-2)", marginTop: 1 }}>แนะนำขนาด 1200 × 300 px</div>
        {editing && (
          <input
            className="cfield" autoFocus value={url} onChange={(e) => onChange(e.target.value)}
            placeholder="https://..." style={{ marginTop: 8 }}
          />
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button type="button" className="set-icon-btn" onClick={onEdit} title="เปลี่ยนรูป" aria-label="เปลี่ยนรูป">
          <Icon name="replace" size={15} />
        </button>
        <button type="button" className="set-icon-btn set-icon-btn-danger" onClick={onDelete} title="ลบแบนเนอร์" aria-label="ลบแบนเนอร์">
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}

function OrderLinkCard({ uid }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const orderUrl = `${window.location.origin}/order/${uid}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(orderUrl, { width: 240, margin: 1 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => { cancelled = true; };
  }, [orderUrl]);

  function copyLink() {
    navigator.clipboard.writeText(orderUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function downloadQr() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "qr-order-link.png";
    a.click();
  }

  function printQr() {
    if (!dataUrl) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>QR สั่งซื้อ</title></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><img src="${dataUrl}" style="width:320px;height:320px;" onload="window.print()" /></body></html>`);
    w.document.close();
  }

  return (
    <SettingsCard icon="link" title="ลิงก์สั่งซื้อสำหรับลูกค้า" subtitle="ปริ้น QR นี้ติดหน้าร้าน ลูกค้าสแกนแล้วสั่ง+จ่ายได้เอง">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        {dataUrl
          ? <img src={dataUrl} alt="QR โค้ดลิงก์สั่งซื้อของร้าน" width={180} height={180} style={{ borderRadius: 10, border: "1px solid var(--line)" }} />
          : <div style={{ width: 180, height: 180, borderRadius: 10, background: "var(--cream-2)" }} />}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input className="cfield" readOnly value={orderUrl} style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }} onFocus={(e) => e.target.select()} />
        <button type="button" className="cbtn" style={{ flexShrink: 0, whiteSpace: "nowrap" }} onClick={copyLink}>
          <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a className="cbtn" href={orderUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="external-link" size={13} /> เปิดหน้าร้าน
        </a>
        <button type="button" className="cbtn" onClick={downloadQr}><Icon name="download" size={13} /> ดาวน์โหลด QR</button>
        <button type="button" className="cbtn" onClick={printQr}><Icon name="printer" size={13} /> พิมพ์ QR</button>
      </div>
    </SettingsCard>
  );
}

function SettingsPanel({ data, updateData, showToast, uid }) {
  const s = data.settings;
  const [shopName, setShopName] = useState(s.shopName);
  const [overhead, setOverhead] = useState(String(s.overheadPerCup));
  const [platforms, setPlatforms] = useState(s.platforms);
  const [promptpayId, setPromptpayId] = useState(s.promptpayId || "");
  const originalBannerUrls = s.bannerImageUrls && s.bannerImageUrls.length ? s.bannerImageUrls : (s.bannerImageUrl ? [s.bannerImageUrl] : []);
  const [bannerImageUrls, setBannerImageUrls] = useState(originalBannerUrls);
  const [editingBannerIdx, setEditingBannerIdx] = useState(null);
  const [dragBannerIdx, setDragBannerIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmCloseOrders, setConfirmCloseOrders] = useState(false);
  const [confirmDeletePlatform, setConfirmDeletePlatform] = useState(null);
  const [confirmDeleteBanner, setConfirmDeleteBanner] = useState(null);
  const [addPlatformOpen, setAddPlatformOpen] = useState(false);

  // เบอร์แพลตฟอร์มที่ "เคยถูกบันทึกแล้วจริง" ตอนโหลดหน้า — ใช้ตัดสินว่าลบแล้วต้อง confirm ไหม (แถวที่เพิ่งเพิ่มยังไม่เคยเซฟ ลบตรงๆ ได้เลย)
  const savedPlatformIdsRef = useRef(new Set(s.platforms.map((p) => p.id)));
  const savedBannerUrlsRef = useRef(new Set(originalBannerUrls));

  function updateBannerUrl(idx, value) {
    setBannerImageUrls((u) => u.map((x, i) => (i === idx ? value : x)));
  }
  function addBannerUrl() {
    setBannerImageUrls((u) => [...u, ""]);
    setEditingBannerIdx(bannerImageUrls.length);
  }
  function requestRemoveBanner(idx) {
    const url = bannerImageUrls[idx];
    if (url && savedBannerUrlsRef.current.has(url)) {
      setConfirmDeleteBanner(idx);
    } else {
      setBannerImageUrls((u) => u.filter((_, i) => i !== idx));
    }
  }
  function reorderBanner(from, to) {
    setBannerImageUrls((u) => {
      const next = u.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function updatePlatform(idx, patch) {
    setPlatforms((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function addPlatform(name, gpPercent) {
    setPlatforms((p) => [...p, { id: genId("plat"), name, gpPercent }]);
    setAddPlatformOpen(false);
  }
  function requestRemovePlatform(idx) {
    const plat = platforms[idx];
    if (savedPlatformIdsRef.current.has(plat.id)) {
      setConfirmDeletePlatform(idx);
    } else {
      setPlatforms((p) => p.filter((_, i) => i !== idx));
    }
  }

  function toggleAcceptingOrders() {
    if (s.acceptingOrders) {
      setConfirmCloseOrders(true);
      return;
    }
    updateData((next) => { next.settings.acceptingOrders = true; });
    showToast("เปิดรับออเดอร์ลูกค้าแล้ว");
  }
  function confirmCloseOrdersNow() {
    updateData((next) => { next.settings.acceptingOrders = false; });
    showToast("ปิดรับออเดอร์ลูกค้าแล้ว");
    setConfirmCloseOrders(false);
  }

  function toggleSlipTestMode(next) {
    updateData((d) => { d.settings.slipTestMode = next; });
    showToast(next ? "เปิดโหมดทดสอบสลิปแล้ว" : "ปิดโหมดทดสอบสลิปแล้ว");
  }

  // validation
  const shopNameError = shopName.trim() ? "" : "กรุณาใส่ชื่อร้าน";
  const overheadNum = Number(overhead);
  const overheadError = overhead.trim() === "" || Number.isNaN(overheadNum) || overheadNum < 0 ? "กรอกตัวเลขที่มากกว่าหรือเท่ากับ 0" : "";
  const platformNameCounts = useMemo(() => {
    const counts = {};
    for (const p of platforms) {
      const key = (p.name || "").trim().toLowerCase();
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [platforms]);
  function platformErrorFor(p) {
    if (!p.name.trim()) return "กรุณาใส่ชื่อแพลตฟอร์ม";
    if (platformNameCounts[p.name.trim().toLowerCase()] > 1) return "ชื่อแพลตฟอร์มนี้ซ้ำกับรายการอื่น";
    const gp = Number(p.gpPercent);
    if (p.gpPercent === "" || Number.isNaN(gp) || gp < 0 || gp > 100) return "GP ต้องอยู่ระหว่าง 0-100";
    return "";
  }
  const hasErrors = !!shopNameError || !!overheadError || platforms.some((p) => !!platformErrorFor(p));

  const dirty =
    shopName !== s.shopName ||
    overhead !== String(s.overheadPerCup) ||
    JSON.stringify(platforms) !== JSON.stringify(s.platforms) ||
    promptpayId !== (s.promptpayId || "") ||
    JSON.stringify(bannerImageUrls) !== JSON.stringify(originalBannerUrls);

  useEffect(() => {
    function handler(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function discardChanges() {
    setShopName(s.shopName);
    setOverhead(String(s.overheadPerCup));
    setPlatforms(s.platforms);
    setPromptpayId(s.promptpayId || "");
    setBannerImageUrls(originalBannerUrls);
    setEditingBannerIdx(null);
  }

  // updateData ในระบบนี้เป็น local state update ที่ sync ทันที + debounce เขียน Firebase เบื้องหลัง 400ms (fire-and-forget,
  // error ของการเขียนจริงมี toast กลางระบบดักอยู่แล้วที่ ShopApp) หน้านี้จึงโชว์ loading สั้นๆ กันกดซ้ำ/ให้เห็น feedback
  // ไม่ได้รอผลเขียนจริงจบเป็น promise เพราะ save() เดิมของทั้งระบบไม่เคยมี promise ให้ await อยู่แล้ว
  function save() {
    if (hasErrors || saving) return;
    setSaving(true);
    updateData((next) => {
      next.settings.shopName = shopName.trim();
      next.settings.overheadPerCup = Number(overhead);
      next.settings.platforms = platforms;
      next.settings.promptpayId = promptpayId.trim();
      next.settings.bannerImageUrls = bannerImageUrls.map((u) => u.trim()).filter(Boolean);
    });
    setTimeout(() => {
      setSaving(false);
      showToast("บันทึกการตั้งค่าแล้ว");
    }, 400);
  }

  return (
    <div className="set-wrap">
      <style>{`
        .set-wrap { max-width: 1080px; }
        .set-header { margin-bottom: 20px; }
        .set-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 20px; align-items: start; }
        @media (max-width: 900px) { .set-grid { grid-template-columns: 1fr; } }
        .set-col { display: flex; flex-direction: column; gap: 20px; }
        .set-card { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,.03); }
        .set-status-card { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; border-radius: 16px; padding: 16px 20px; margin-bottom: 20px; }
        .set-icon-btn { width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--line); background: #fff; color: var(--espresso-3); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background 150ms ease, color 150ms ease; }
        .set-icon-btn:hover { background: var(--cream-2); color: var(--espresso-4); }
        .set-icon-btn-danger:hover { background: var(--danger-light); color: var(--danger); }
        .set-platform-row { display: grid; grid-template-columns: 1fr 110px 40px; gap: 8px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--line); }
        .set-platform-row:last-of-type { border-bottom: none; }
        .set-platform-head { display: grid; grid-template-columns: 1fr 110px 40px; gap: 8px; font-size: 11.5px; font-weight: 600; color: var(--espresso-2); text-transform: uppercase; letter-spacing: .03em; padding-bottom: 8px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
        @media (max-width: 560px) {
          .set-platform-head { display: none; }
          .set-platform-row { grid-template-columns: 1fr; gap: 6px; background: var(--cream-2); border-radius: 10px; padding: 10px; margin-bottom: 8px; border-bottom: none; }
          /* บนมือถือปุ่มสำคัญต้องมีพื้นที่กดอย่างน้อย 44px ตามสเปก — .cbtn ปกติเตี้ยกว่านั้นเพราะใช้ร่วมกับหน้าอื่นทั้งระบบ
             จึงบังคับความสูงเฉพาะภายใน .set-wrap ตอนจอแคบ ไม่กระทบปุ่ม .cbtn ของแท็บอื่น */
          .set-wrap .cbtn { min-height: 44px; }
          .set-wrap .set-icon-btn { width: 44px; height: 44px; }
        }
        .set-banner-card { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 8px; background: #fff; cursor: grab; }
        .set-banner-card:active { cursor: grabbing; }
        .set-drag-handle { color: var(--espresso-2); flex-shrink: 0; cursor: grab; touch-action: none; }
        .set-banner-thumb { width: 76px; height: 40px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: var(--cream-2); }
        .set-banner-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .set-banner-thumb-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--espresso-2); }
        .set-alert { display: flex; gap: 8px; align-items: flex-start; background: var(--gold-light); border: 1px solid var(--gold); color: var(--gold-dark); border-radius: 10px; padding: 10px 12px; font-size: 12px; line-height: 1.5; margin-top: 10px; }
        .set-savebar { position: sticky; bottom: 0; margin-top: 24px; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; box-shadow: 0 -4px 20px rgba(0,0,0,.06); z-index: 10; }
        .set-empty { text-align: center; padding: 24px 10px; color: var(--espresso-2); font-size: 12.5px; }
        .cbtn:focus-visible, .set-icon-btn:focus-visible, .cfield:focus-visible { outline: 2px solid var(--sage); outline-offset: 2px; }
        .cbtn:disabled { opacity: .5; cursor: not-allowed; }
        .cbtn:disabled:hover { background: #fff; }
        .cbtn-accent:disabled:hover { background: var(--sage); }
        .inv-btn-ghost { height: 40px; padding: 0 16px; border: 1px solid ${INV.border}; border-radius: 10px; background: #fff; color: ${INV.ink}; font-size: 13.5px; font-weight: 600; cursor: pointer; }
        .inv-btn-danger { height: 40px; padding: 0 16px; border: none; border-radius: 10px; background: ${INV.danger}; color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer; }
      `}</style>

      <div className="set-header">
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--espresso-2)", fontWeight: 600 }}>{data.settings.shopName}</p>
        <h1 style={{ margin: "2px 0 4px", fontSize: 22, fontWeight: 700, color: "var(--espresso-5)", fontFamily: "var(--f-display)" }}>การตั้งค่าร้าน</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--espresso-2)" }}>จัดการข้อมูลร้าน การรับออเดอร์ การชำระเงิน และหน้าสั่งซื้อ</p>
      </div>

      <div className="set-status-card" style={{
        background: s.acceptingOrders ? "var(--success-light)" : "var(--cream-2)",
        border: `1px solid ${s.acceptingOrders ? "var(--success)" : "var(--line)"}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
            background: s.acceptingOrders ? "var(--success-dark)" : "#9CA3AF",
            boxShadow: s.acceptingOrders ? "0 0 0 4px rgba(46,158,79,.18)" : "none",
          }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: s.acceptingOrders ? "var(--success-dark)" : "var(--espresso-4)" }}>
              {s.acceptingOrders ? "กำลังเปิดรับออเดอร์" : "ปิดรับออเดอร์ชั่วคราว"}
            </div>
            <div style={{ fontSize: 12, color: "var(--espresso-2)", marginTop: 1 }}>
              {s.acceptingOrders ? "ลูกค้าสามารถสั่งซื้อผ่านหน้าร้านได้ตามปกติ" : "ลูกค้าจะเห็นข้อความว่าร้านปิดรับออเดอร์ชั่วคราว"}
            </div>
          </div>
        </div>
        <button className={s.acceptingOrders ? "cbtn cbtn-danger" : "cbtn cbtn-accent"} onClick={toggleAcceptingOrders} style={{ flexShrink: 0 }}>
          {s.acceptingOrders ? "ปิดรับออเดอร์" : "เปิดรับออเดอร์"}
        </button>
      </div>

      <div className="set-grid">
        <div className="set-col">
          <SettingsCard icon="building-store" title="ข้อมูลร้านและต้นทุน">
            <SettingsField label="ชื่อร้าน" error={shopNameError}>
              <TextField className="cfield" style={{ height: 42 }} value={shopName} onChange={setShopName} />
            </SettingsField>
            <SettingsField label="ต้นทุนแฝงต่อแก้ว (ค่าไฟ + ค่าเสื่อมอุปกรณ์)" error={overheadError} suffix="บาท">
              <input className="cfield" style={{ height: 42, paddingRight: 44 }} type="number" min="0" step="0.01" value={overhead} onChange={(e) => setOverhead(e.target.value)} />
            </SettingsField>
          </SettingsCard>

          <SettingsCard icon="truck-delivery" title="แพลตฟอร์มเดลิเวอรีและ GP">
            <div className="set-platform-head">
              <span>แพลตฟอร์ม</span><span>GP (%)</span><span></span>
            </div>
            {platforms.map((p, idx) => {
              const err = platformErrorFor(p);
              return (
                <div key={p.id} className="set-platform-row">
                  <div>
                    <TextField className="cfield" style={{ height: 40 }} value={p.name} onChange={(v) => updatePlatform(idx, { name: v })} placeholder="ชื่อแพลตฟอร์ม" />
                    {err && <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 4 }}>{err}</div>}
                  </div>
                  <div style={{ position: "relative" }}>
                    <input
                      className="cfield" style={{ height: 40, paddingRight: 26 }} type="number" min="0" max="100"
                      value={p.gpPercent} onChange={(e) => updatePlatform(idx, { gpPercent: e.target.value === "" ? "" : Number(e.target.value) })}
                    />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--espresso-2)", pointerEvents: "none" }}>%</span>
                  </div>
                  <button className="set-icon-btn set-icon-btn-danger" onClick={() => requestRemovePlatform(idx)} title="ลบแพลตฟอร์ม" aria-label="ลบแพลตฟอร์ม">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              );
            })}
            {platforms.length === 0 && <div className="set-empty">ยังไม่มีแพลตฟอร์มเดลิเวอรี่</div>}
            <button className="cbtn" style={{ marginTop: 12 }} onClick={() => setAddPlatformOpen(true)}>
              <Icon name="plus" size={13} /> เพิ่มแพลตฟอร์ม
            </button>
          </SettingsCard>

          <SettingsCard icon="qrcode" title="การชำระเงินและ PromptPay">
            <SettingsField label="เบอร์พร้อมเพย์ / เลขบัตรประชาชน">
              <TextField className="cfield" style={{ height: 42 }} value={promptpayId} onChange={setPromptpayId} placeholder="0812345678" />
            </SettingsField>
            <p style={{ fontSize: 12, color: "var(--espresso-2)", margin: "-6px 0 16px" }}>ใช้สำหรับสร้าง QR รับเงินในหน้าสั่งซื้อของลูกค้า ต้องบันทึกก่อนจึงจะใช้งานได้</p>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 4 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--espresso-4)" }}>โหมดทดสอบสลิป</div>
                <div style={{ fontSize: 12, color: "var(--espresso-2)", marginTop: 1 }}>
                  {s.slipTestMode ? "เปิดใช้งาน — แนบสลิปอะไรก็ได้แล้วผ่านทันที" : "แนบสลิปจริงต้องผ่านการตรวจสอบ SlipOK"}
                </div>
              </div>
              <OptgToggle checked={s.slipTestMode} onChange={toggleSlipTestMode} color="var(--sage)" />
            </div>
            {s.slipTestMode && (
              <div className="set-alert">
                <Icon name="alert-triangle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>โหมดทดสอบสลิปเปิดอยู่ — ระบบจะไม่ตรวจสอบสลิปจริงผ่าน SlipOK จนกว่าจะปิดโหมดนี้ ใช้เฉพาะตอนทดสอบระบบเท่านั้น</span>
              </div>
            )}
          </SettingsCard>

          <SettingsAccordion title="วิธีคำนวณสต็อกและ GP">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--espresso-3)", lineHeight: 1.8 }}>
              <li>ข้อมูลทั้งหมด (วัตถุดิบ เมนู ยอดขาย) ถูกบันทึกไว้อัตโนมัติ และจะยังอยู่เมื่อกลับมาเปิดใหม่</li>
              <li>"นมสด (รวม)" ใช้แทนแบรนด์เฉพาะ — ตัดสต็อกจากยอดรวมนมสดทุกครั้งที่ขาย</li>
              <li>ยกเว้นตอนขายเลือก "นม Oat" ซึ่งจะตัดจากสต็อกนม Oat แยกต่างหาก ไม่ปนกับนมสด</li>
              <li>แต่ละแพลตฟอร์มเดลิเวอรี่หัก GP ตาม % ที่ตั้งไว้ในการ์ด "แพลตฟอร์มเดลิเวอรีและ GP" ด้านบน</li>
            </ul>
          </SettingsAccordion>
        </div>

        <div className="set-col">
          <OrderLinkCard uid={uid} />

          <SettingsCard icon="photo" title="แบนเนอร์หน้าลูกค้า" subtitle="ใส่ได้หลายรูป ระบบจะเลื่อนสไลด์วนอัตโนมัติที่หน้าลูกค้า ไม่ใส่รูปเลยถ้าไม่ต้องการแสดงแบนเนอร์">
            {bannerImageUrls.length === 0 ? (
              <div className="set-empty">
                <Icon name="photo-off" size={26} style={{ display: "block", margin: "0 auto 8px", color: "var(--espresso-2)" }} />
                ยังไม่มีแบนเนอร์ — ลูกค้าจะไม่เห็นสไลด์โฆษณาที่หน้าสั่งซื้อ
              </div>
            ) : (
              bannerImageUrls.map((url, idx) => (
                <BannerCard
                  key={idx}
                  url={url}
                  index={idx}
                  editing={editingBannerIdx === idx}
                  onEdit={() => setEditingBannerIdx(editingBannerIdx === idx ? null : idx)}
                  onChange={(v) => updateBannerUrl(idx, v)}
                  onDelete={() => requestRemoveBanner(idx)}
                  dragProps={{
                    onDragStart: () => setDragBannerIdx(idx),
                    onDragOver: (e) => e.preventDefault(),
                    onDrop: () => {
                      if (dragBannerIdx !== null && dragBannerIdx !== idx) reorderBanner(dragBannerIdx, idx);
                      setDragBannerIdx(null);
                    },
                  }}
                />
              ))
            )}
            <button className="cbtn" style={{ marginTop: 6 }} onClick={addBannerUrl}>
              <Icon name="plus" size={13} /> เพิ่มแบนเนอร์
            </button>
          </SettingsCard>
        </div>
      </div>

      <div className="set-savebar">
        <div style={{ fontSize: 12.5, color: dirty ? "var(--gold-dark)" : "var(--espresso-2)", fontWeight: dirty ? 600 : 400, display: "flex", alignItems: "center", gap: 6 }}>
          {dirty && <Icon name="alert-circle" size={14} />}
          {dirty ? "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก" : "ไม่มีการเปลี่ยนแปลง"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cbtn" disabled={!dirty || saving} style={{ opacity: !dirty || saving ? 0.5 : 1 }} onClick={discardChanges}>ยกเลิกการเปลี่ยนแปลง</button>
          <button className="cbtn cbtn-accent" disabled={!dirty || hasErrors || saving} style={{ opacity: !dirty || hasErrors || saving ? 0.5 : 1, minWidth: 132 }} onClick={save}>
            {saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
          </button>
        </div>
      </div>

      {addPlatformOpen && (
        <AddPlatformModal
          existingNames={platforms.map((p) => p.name.trim().toLowerCase())}
          onAdd={addPlatform}
          onClose={() => setAddPlatformOpen(false)}
        />
      )}

      {confirmCloseOrders && (
        <InvConfirmDialog
          title="ปิดรับออเดอร์ลูกค้า?"
          message="ลูกค้าจะไม่สามารถสั่งซื้อผ่านหน้าร้านออนไลน์ได้จนกว่าจะเปิดรับออเดอร์อีกครั้ง"
          confirmLabel="ปิดรับออเดอร์"
          onConfirm={confirmCloseOrdersNow}
          onCancel={() => setConfirmCloseOrders(false)}
        />
      )}

      {confirmDeletePlatform !== null && (
        <InvConfirmDialog
          title="ลบแพลตฟอร์มนี้?"
          message={`"${platforms[confirmDeletePlatform]?.name || "แพลตฟอร์มนี้"}" เคยถูกบันทึกไว้แล้ว ลบแล้วออเดอร์เก่าที่ผูกกับแพลตฟอร์มนี้จะยังอยู่ แต่จะเลือกแพลตฟอร์มนี้ตอนขายใหม่ไม่ได้อีก`}
          confirmLabel="ลบแพลตฟอร์ม"
          onConfirm={() => { setPlatforms((p) => p.filter((_, i) => i !== confirmDeletePlatform)); setConfirmDeletePlatform(null); }}
          onCancel={() => setConfirmDeletePlatform(null)}
        />
      )}

      {confirmDeleteBanner !== null && (
        <InvConfirmDialog
          title="ลบแบนเนอร์นี้?"
          message="แบนเนอร์นี้จะหายไปจากสไลด์โฆษณาหน้าลูกค้าทันทีหลังบันทึก"
          confirmLabel="ลบแบนเนอร์"
          onConfirm={() => { setBannerImageUrls((u) => u.filter((_, i) => i !== confirmDeleteBanner)); setConfirmDeleteBanner(null); }}
          onCancel={() => setConfirmDeleteBanner(null)}
        />
      )}
    </div>
  );
}

function AddPlatformModal({ existingNames, onAdd, onClose }) {
  useEscape(onClose);
  const available = KNOWN_DELIVERY_PLATFORMS.filter((n) => !existingNames.includes(n.toLowerCase()));
  const [choice, setChoice] = useState(available[0] || "custom");
  const [customName, setCustomName] = useState("");
  const [gp, setGp] = useState(30);

  const finalName = choice === "custom" ? customName.trim() : choice;
  const isDuplicate = finalName && existingNames.includes(finalName.toLowerCase());
  const gpNum = Number(gp);
  const gpValid = gp !== "" && !Number.isNaN(gpNum) && gpNum >= 0 && gpNum <= 100;
  const canAdd = finalName.length > 0 && !isDuplicate && gpValid;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: 380, maxWidth: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }} role="dialog" aria-modal="true">
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--espresso-5)", marginBottom: 14 }}>เพิ่มแพลตฟอร์มเดลิเวอรี่</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {available.map((name) => (
            <label key={name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--espresso-4)", cursor: "pointer" }}>
              <input type="radio" name="platform-choice" checked={choice === name} onChange={() => setChoice(name)} /> {name}
            </label>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--espresso-4)", cursor: "pointer" }}>
            <input type="radio" name="platform-choice" checked={choice === "custom"} onChange={() => setChoice("custom")} /> อื่นๆ (ระบุชื่อ)
          </label>
          {choice === "custom" && (
            <input className="cfield" style={{ marginTop: 2, marginLeft: 22, width: "calc(100% - 22px)" }} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="ชื่อแพลตฟอร์ม" autoFocus />
          )}
          {isDuplicate && <div style={{ fontSize: 11.5, color: "var(--danger)", marginLeft: 22 }}>มีแพลตฟอร์มชื่อนี้อยู่แล้ว</div>}
        </div>

        <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--espresso-4)", marginBottom: 5 }}>GP (%)</label>
        <div style={{ position: "relative", marginBottom: 6 }}>
          <input className="cfield" style={{ height: 42, paddingRight: 30 }} type="number" min="0" max="100" value={gp} onChange={(e) => setGp(e.target.value === "" ? "" : Number(e.target.value))} />
          <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12.5, color: "var(--espresso-2)" }}>%</span>
        </div>
        {!gpValid && <div style={{ fontSize: 11.5, color: "var(--danger)", marginBottom: 6 }}>GP ต้องอยู่ระหว่าง 0-100</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="inv-btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button className="cbtn cbtn-accent" style={{ height: 40 }} disabled={!canAdd} onClick={() => canAdd && onAdd(finalName, gpNum)}>เพิ่มแพลตฟอร์ม</button>
        </div>
      </div>
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

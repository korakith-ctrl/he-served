import { useState, useEffect, useMemo } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set } from "firebase/database";
import Login from "./Login.jsx";

const UNITS = { g: "กรัม", ml: "มล.", piece: "ชิ้น" };
const CATEGORIES = [
  { id: "coffee", label: "เมล็ดกาแฟ" },
  { id: "matcha", label: "มัทฉะ" },
  { id: "cocoa_tea", label: "โกโก้ / ชา" },
  { id: "milk", label: "นม" },
  { id: "juice_water", label: "น้ำผลไม้ / น้ำ-น้ำแข็ง" },
  { id: "packaging", label: "บรรจุภัณฑ์" },
];
const CHANNELS = { store: "หน้าร้าน", delivery: "เดลิเวอรี่" };

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round4(n) { return Math.round(n * 10000) / 10000; }

function seedIngredients() {
  const rows = [
    ["coffee_pacamara", "Pacamara House Blend", "coffee", "g", 0.84, null, 0],
    ["coffee_bluekoff", "Bluekoff A4.5 medium", "coffee", "g", 0.551, null, 0],
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
  const mk = (name, priceStore, priceDelivery, ings) => ({
    id: uid("menu"), name, priceStore, priceDelivery,
    ingredients: ings.map(([ingredientId, qty]) => ({ ingredientId, qty })),
  });
  const pack = [["cup_16", 1], ["lid_98", 1], ["straw_black", 1], ["zipbag_drink", 1], ["sticker", 1]];
  return [
    mk("Iced Americano", 45, 55, [["coffee_bluekoff", 18], ["water", 160], ["ice", 90], ...pack]),
    mk("Iced Orange Americano", 55, 65, [["coffee_bluekoff", 16], ["juice_orange", 90], ["water", 60], ["ice", 90], ...pack]),
    mk("Iced Latte", 50, 60, [["coffee_bluekoff", 18], ["milk_fresh", 110], ["water", 40], ["ice", 90], ...pack]),
    mk("Iced Mocha", 55, 65, [["coffee_bluekoff", 18], ["cocoa_powder", 5], ["milk_fresh", 70], ["milk_condensed", 20], ["milk_evaporated", 20], ["ice", 90], ...pack]),
    mk("Iced Es-Yen", 45, 55, [["coffee_bluekoff", 18], ["milk_fresh", 60], ["milk_condensed", 25], ["milk_evaporated", 25], ["ice", 90], ...pack]),
    mk("Iced Cocoa", 50, 60, [["cocoa_powder", 20], ["milk_fresh", 40], ["milk_condensed", 25], ["milk_evaporated", 25], ["water", 60], ["ice", 90], ...pack]),
    mk("Matcha Latte", 60, 70, [["matcha_peace", 4], ["milk_fresh", 150], ["syrup", 15], ["ice", 90], ...pack]),
  ];
}

function seedPlatforms() {
  return [
    { id: uid("plat"), name: "Grab Food", gpPercent: 30 },
    { id: uid("plat"), name: "LINE MAN", gpPercent: 32 },
    { id: uid("plat"), name: "foodpanda", gpPercent: 30 },
    { id: uid("plat"), name: "Shopee Food", gpPercent: 25 },
  ];
}

function defaultState() {
  return {
    ingredients: seedIngredients(),
    menus: seedMenus(),
    sales: [],
    purchases: [],
    settings: { overheadPerCup: 3.1, shopName: "ร้านกาแฟของฉัน", platforms: seedPlatforms() },
  };
}

function normalizeData(raw) {
  return {
    ingredients: raw.ingredients || [],
    menus: (raw.menus || []).map((m) => ({ ...m, ingredients: m.ingredients || [] })),
    sales: raw.sales || [],
    purchases: raw.purchases || [],
    settings: {
      overheadPerCup: raw.settings?.overheadPerCup ?? 3.1,
      shopName: raw.settings?.shopName ?? "ร้านกาแฟของฉัน",
      platforms: raw.settings?.platforms || [],
    },
  };
}

function resolveLines(menu, substitutions) {
  return menu.ingredients.map((line) => {
    const subId = substitutions[line.ingredientId];
    return subId ? { ...line, ingredientId: subId } : line;
  });
}

function calcRecipeCost(menu, ingredientsById, substitutions) {
  const lines = resolveLines(menu, substitutions || {});
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

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function Icon({ name, size = 18, style }) {
  return <i className={"ti ti-" + name} style={{ fontSize: size, ...style }} aria-hidden="true"></i>;
}

const TABS = [
  { id: "dashboard", label: "ภาพรวม", icon: "layout-dashboard" },
  { id: "sell", label: "ขายเครื่องดื่ม", icon: "cash-register" },
  { id: "menus", label: "เมนู & สูตร", icon: "cup" },
  { id: "ingredients", label: "วัตถุดิบ & สต็อก", icon: "boxes" },
  { id: "reports", label: "รายงาน", icon: "chart-line" },
  { id: "settings", label: "ตั้งค่า", icon: "settings" },
];

function ShopApp({ uid }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);

  const shopRef = ref(db, "shops/" + uid);
  const isFirstSnapshot = useMemo(() => ({ current: true }), [uid]);

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
      <div style={{ padding: "3rem", textAlign: "center", color: "#5C4A3B", fontFamily: "sans-serif" }}>
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
        id: uid("sale"), timestamp: new Date().toISOString(), menuId, menuName: menu.name,
        channel, qty, unitPrice, grossRevenue, gpAmount, gpPercent, promoDiscount, netRevenue,
        totalCost, profit: netRevenue - totalCost,
        platformName: platform ? platform.name : null,
        milkNote: opts.milkLabel || null,
      });
    });
    showToast(`บันทึกการขาย ${menu.name} x${qty} (${channel === "delivery" ? (platform ? platform.name : "เดลิเวอรี่") : "หน้าร้าน"}) แล้ว`);
  }

  return (
    <div style={{
      fontFamily: "var(--f-body)", color: "var(--espresso-4)", background: "var(--cream)",
      borderRadius: 16, overflow: "hidden", border: "1px solid var(--line)", maxWidth: 980, margin: "0 auto", position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .coffeeapp * { box-sizing: border-box; }
        .coffeeapp button { font-family: inherit; cursor: pointer; }
        .coffeeapp input, .coffeeapp select { font-family: inherit; }
        .cbtn { border: 1px solid var(--line); background: var(--surface); color: var(--espresso-4); border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 500; transition: transform .08s ease, background .15s ease; }
        .cbtn:hover { background: var(--cream-2); }
        .cbtn:active { transform: scale(0.97); }
        .cbtn-accent { background: var(--sage); color: #fff; border-color: var(--sage); }
        .cbtn-accent:hover { background: var(--sage-dark); }
        .cbtn-danger { color: var(--danger); border-color: var(--danger-line); }
        .cfield { border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: 13px; background: var(--surface); color: var(--espresso-4); width: 100%; }
        .cfield:focus { outline: 2px solid var(--sage); outline-offset: 1px; }
        .ctab { border: none; background: transparent; color: var(--espresso-2); padding: 10px 14px; font-size: 13px; font-weight: 500; border-radius: 9px 9px 0 0; display: flex; align-items: center; gap: 6px; }
        .ctab.active { background: var(--cream); color: var(--espresso-5); }
        table.cdata { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.cdata th { text-align: left; font-weight: 500; color: var(--espresso-2); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; padding: 6px 8px; border-bottom: 1px solid var(--line); }
        table.cdata td { padding: 8px; border-bottom: 1px solid var(--line-soft); }
        .chpill { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
      `}</style>
      <div className="coffeeapp" style={{
        "--cream": "#FAF6EE", "--cream-2": "#F1EBDD", "--surface": "#FFFFFF",
        "--espresso-5": "#2B1D14", "--espresso-4": "#3E2C20", "--espresso-3": "#5C4A3B", "--espresso-2": "#8A7A6B",
        "--sage": "#6E8256", "--sage-dark": "#54663F", "--sage-light": "#E4EAD9",
        "--gold": "#C79A45", "--gold-light": "#F6EBD3",
        "--danger": "#A33A3A", "--danger-line": "#D9B8B8", "--danger-light": "#F6E7E7",
        "--line": "#E4DBC9", "--line-soft": "#EFE9DB",
        "--f-display": "'Fraunces', serif", "--f-body": "'Inter', sans-serif", "--f-mono": "'IBM Plex Mono', monospace",
      }}>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/iconfont/tabler-icons.min.css" />

        <Header shopName={data.settings.shopName} onSignOut={() => signOut(auth)} />

        <div style={{ display: "flex", gap: 2, padding: "0 20px", borderBottom: "1px solid var(--line)", overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t.id} className={"ctab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={16} /> {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 20, minHeight: 320 }}>
          {tab === "dashboard" && <Dashboard data={data} ingredientsById={ingredientsById} setTab={setTab} recordSale={recordSale} />}
          {tab === "sell" && <SellPanel data={data} ingredientsById={ingredientsById} recordSale={recordSale} />}
          {tab === "menus" && <MenusPanel data={data} ingredientsById={ingredientsById} updateData={updateData} showToast={showToast} />}
          {tab === "ingredients" && <IngredientsPanel data={data} updateData={updateData} showToast={showToast} />}
          {tab === "reports" && <ReportsPanel data={data} />}
          {tab === "settings" && <SettingsPanel data={data} updateData={updateData} showToast={showToast} />}
        </div>

        {toast && (
          <div style={{
            position: "absolute", bottom: 18, left: "50%", transform: "translateX(-50%)",
            background: "var(--espresso-5)", color: "#fff", padding: "9px 18px", borderRadius: 10, fontSize: 13, zIndex: 40,
          }}>{toast}</div>
        )}
      </div>
    </div>
  );
}

function Header({ shopName, onSignOut }) {
  return (
    <div style={{ padding: "22px 20px 16px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--sage-dark)", fontWeight: 500 }}>ระบบหลังบ้าน</p>
          <h1 style={{ margin: "2px 0 0", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 26, color: "var(--espresso-5)" }}>{shopName}</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="coffee" size={30} style={{ color: "var(--sage)" }} />
          <button className="cbtn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={onSignOut}>
            <Icon name="logout" size={13} /> ออกจากระบบ
          </button>
        </div>
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
  const isDelivery = channel === "delivery";
  return (
    <span className="chpill" style={{
      background: isDelivery ? "var(--gold-light)" : "var(--sage-light)",
      color: isDelivery ? "#7A5A1E" : "var(--sage-dark)",
    }}>{CHANNELS[channel]}</span>
  );
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
          const substitutions = milk && milkSelId !== milk.originalIngredientId ? { [milk.originalIngredientId]: milkSelId } : {};
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

function MenusPanel({ data, ingredientsById, updateData, showToast }) {
  const [editing, setEditing] = useState(null);

  function newMenu() {
    setEditing({ id: null, name: "", priceStore: 0, priceDelivery: 0, ingredients: [] });
  }

  function saveMenu(menu) {
    updateData((next) => {
      if (menu.id) {
        const idx = next.menus.findIndex((m) => m.id === menu.id);
        next.menus[idx] = menu;
      } else {
        next.menus.push({ ...menu, id: uid("menu") });
      }
    });
    setEditing(null);
    showToast("บันทึกเมนูแล้ว");
  }

  function deleteMenu(id) {
    updateData((next) => { next.menus = next.menus.filter((m) => m.id !== id); });
    showToast("ลบเมนูแล้ว");
  }

  if (editing) {
    return <MenuEditor menu={editing} ingredients={data.ingredients} onSave={saveMenu} onCancel={() => setEditing(null)} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle icon="cup" text="เมนูทั้งหมด" />
        <button className="cbtn cbtn-accent" onClick={newMenu}><Icon name="plus" size={14} /> เพิ่มเมนู</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {data.menus.map((menu) => {
          const { ingredientCost, breakdown } = calcRecipeCost(menu, ingredientsById, {});
          const totalCost = ingredientCost + data.settings.overheadPerCup;
          const marginStore = menu.priceStore > 0 ? ((menu.priceStore - totalCost) / menu.priceStore) * 100 : 0;
          return (
            <div key={menu.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, fontFamily: "var(--f-mono)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16, color: "var(--espresso-5)" }}>{menu.name}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="cbtn" style={{ padding: "4px 8px" }} onClick={() => setEditing(menu)}><Icon name="edit" size={13} /></button>
                  <button className="cbtn cbtn-danger" style={{ padding: "4px 8px" }} onClick={() => deleteMenu(menu.id)}><Icon name="trash" size={13} /></button>
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
}

function MenuEditor({ menu, ingredients, onSave, onCancel }) {
  const [form, setForm] = useState(menu);

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
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ราคาขายหน้าร้าน (บาท)</label>
          <input className="cfield" type="number" value={form.priceStore} onChange={(e) => setForm({ ...form, priceStore: Number(e.target.value) })} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "var(--espresso-2)" }}>ราคาขายเดลิเวอรี่ (บาท)</label>
          <input className="cfield" type="number" value={form.priceDelivery} onChange={(e) => setForm({ ...form, priceDelivery: Number(e.target.value) })} />
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--espresso-2)", marginBottom: 6 }}>ส่วนผสม (ถ้าต้องการให้เลือกนมทางเลือกได้ตอนขาย ให้ตั้งค่า "กลุ่มทางเลือก" ของวัตถุดิบนมในแท็บวัตถุดิบ)</p>
      {form.ingredients.map((line, idx) => (
        <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <select className="cfield" value={line.ingredientId} onChange={(e) => updateLine(idx, { ingredientId: e.target.value })}>
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input className="cfield" style={{ width: 80 }} type="number" value={line.qty} onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })} />
          <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removeLine(idx)}><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="cbtn" onClick={addLine}><Icon name="plus" size={13} /> เพิ่มส่วนผสม</button>

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button className="cbtn cbtn-accent" onClick={() => onSave(form)}>บันทึกเมนู</button>
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
      next.purchases.push({ id: uid("purchase"), timestamp: new Date().toISOString(), ingredientId: id, qtyAdded: addQty, totalCost: totalPaid });
    });
    setRestocking(null);
    showToast("เติมสต็อกแล้ว");
  }

  function addIngredient() {
    if (!newIng.name.trim()) return;
    updateData((next) => { next.ingredients.push({ ...newIng, altGroup: newIng.altGroup || null, id: uid("ing") }); });
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
        <SectionTitle icon="boxes" text="วัตถุดิบ & สต็อก" />
        <button className="cbtn cbtn-accent" onClick={() => setAdding(!adding)}><Icon name="plus" size={14} /> วัตถุดิบใหม่</button>
      </div>

      {adding && <IngredientForm value={newIng} onChange={setNewIng} onSubmit={addIngredient} submitLabel="บันทึก" />}

      {CATEGORIES.map((cat) => {
        const items = data.ingredients.filter((i) => i.category === cat.id);
        if (items.length === 0) return null;
        return (
          <div key={cat.id} style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--espresso-3)", margin: "0 0 6px" }}>{cat.label}</p>
            <table className="cdata">
              <thead><tr><th>รายการ</th><th>สต็อก</th><th>ต้นทุน/หน่วย</th><th>กลุ่มทางเลือก</th><th></th></tr></thead>
              <tbody>
                {items.map((ing) => (
                  <tr key={ing.id}>
                    <td>{ing.name}</td>
                    <td style={{ color: ing.stockQty <= ing.lowStockThreshold ? "var(--danger)" : "var(--espresso-4)", fontWeight: ing.stockQty <= ing.lowStockThreshold ? 600 : 400 }}>
                      {ing.stockQty} {UNITS[ing.unit]}
                    </td>
                    <td>฿{money(ing.costPerUnit)}/{UNITS[ing.unit]}</td>
                    <td>{ing.altGroup ? `${ing.altGroup}${ing.altUpcharge ? ` (+฿${ing.altUpcharge})` : ""}` : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="cbtn" style={{ padding: "4px 8px", marginRight: 4 }} onClick={() => setRestocking(ing.id)}>เติมสต็อก</button>
                      <button className="cbtn" style={{ padding: "4px 8px", marginRight: 4 }} onClick={() => setEditingId(ing.id)}><Icon name="edit" size={12} /></button>
                      <button className="cbtn cbtn-danger" style={{ padding: "4px 8px" }} onClick={() => deleteIngredient(ing.id)}><Icon name="trash" size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {restocking && (
        <RestockModal ingredient={data.ingredients.find((i) => i.id === restocking)} onClose={() => setRestocking(null)} onConfirm={doRestock} />
      )}
      {editingId && (
        <EditIngredientModal ingredient={data.ingredients.find((i) => i.id === editingId)} onClose={() => setEditingId(null)} onSave={saveEdit} />
      )}
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

  const byChannel = { store: { revenue: 0, profit: 0, cups: 0 }, delivery: { revenue: 0, profit: 0, cups: 0 } };
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
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
      </div>

      {Object.keys(byPlatform).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle icon="truck-delivery" text="แยกตามแพลตฟอร์มเดลิเวอรี่" />
          <table className="cdata">
            <thead><tr><th>แพลตฟอร์ม</th><th>แก้ว</th><th>รายได้สุทธิ</th><th>กำไร</th></tr></thead>
            <tbody>
              {Object.entries(byPlatform).map(([name, v]) => (
                <tr key={name}>
                  <td>{name}</td><td>{v.cups}</td><td>฿{money(v.revenue)}</td>
                  <td style={{ color: v.profit >= 0 ? "var(--sage-dark)" : "var(--danger)" }}>฿{money(v.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <table className="cdata">
          <thead><tr><th>เวลา</th><th>เมนู</th><th>ช่องทาง</th><th>จำนวน</th><th>รายได้สุทธิ</th><th>ต้นทุน</th><th>กำไร</th></tr></thead>
          <tbody>
            {filtered.slice().reverse().slice(0, 50).map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.timestamp).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>{s.menuName}{s.milkNote ? ` (${s.milkNote})` : ""}</td>
                <td><ChannelPill channel={s.channel} />{s.platformName ? <span style={{ fontSize: 11, color: "var(--espresso-2)" }}> {s.platformName}</span> : null}</td>
                <td>{s.qty}</td>
                <td>฿{money(s.netRevenue)}</td>
                <td>฿{money(s.totalCost)}</td>
                <td style={{ color: s.profit >= 0 ? "var(--sage-dark)" : "var(--danger)" }}>฿{money(s.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SettingsPanel({ data, updateData, showToast }) {
  const [shopName, setShopName] = useState(data.settings.shopName);
  const [overhead, setOverhead] = useState(data.settings.overheadPerCup);
  const [platforms, setPlatforms] = useState(data.settings.platforms);

  function save() {
    updateData((next) => {
      next.settings.shopName = shopName;
      next.settings.overheadPerCup = Number(overhead);
      next.settings.platforms = platforms;
    });
    showToast("บันทึกการตั้งค่าแล้ว");
  }

  function updatePlatform(idx, patch) {
    setPlatforms((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function addPlatform() {
    setPlatforms((p) => [...p, { id: uid("plat"), name: "แพลตฟอร์มใหม่", gpPercent: 30 }]);
  }
  function removePlatform(idx) {
    setPlatforms((p) => p.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <SectionTitle icon="settings" text="ตั้งค่าร้าน" />
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
          <button className="cbtn cbtn-danger" style={{ padding: "6px 8px" }} onClick={() => removePlatform(idx)}><Icon name="x" size={13} /></button>
        </div>
      ))}
      <button className="cbtn" onClick={addPlatform}><Icon name="plus" size={13} /> เพิ่มแพลตฟอร์ม</button>

      <div style={{ marginTop: 18 }}>
        <button className="cbtn cbtn-accent" onClick={save}>บันทึกการตั้งค่า</button>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--espresso-2)", marginTop: 20, lineHeight: 1.6 }}>
        ข้อมูลทั้งหมด (วัตถุดิบ เมนู ยอดขาย) ถูกบันทึกไว้อัตโนมัติ และจะยังอยู่เมื่อกลับมาเปิดใหม่ นมสด (รวม) ใช้แทนแบรนด์เฉพาะ — ตัดสต็อกจากยอดรวมนมสด ยกเว้นตอนขายเลือก "นม Oat" ซึ่งจะตัดจากสต็อกนม Oat แยกต่างหาก แต่ละแพลตฟอร์มเดลิเวอรี่หัก GP ตาม % ที่ตั้งไว้ด้านบน
      </p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  if (user === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif", color: "#5C4A3B" }}>
        กำลังโหลด...
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div style={{ minHeight: "100vh", padding: "24px 12px" }}>
      <ShopApp uid={user.uid} />
    </div>
  );
}

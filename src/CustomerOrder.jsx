import { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, onValue, get, push, set } from "firebase/database";
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

const STATUS_TEXT = {
  pending: "รอร้านยืนยันการรับเงิน...",
  paid: "ร้านได้รับเงินแล้ว กำลังเตรียมคิว...",
  preparing: "กำลังชงเครื่องดื่มของคุณ...",
  ready: "พร้อมรับแล้ว! มารับที่หน้าร้านได้เลย",
  cancelled: "ออเดอร์นี้ถูกยกเลิก",
};

const COLORS = {
  cream: "#FAF6EE", cream2: "#F1EBDD", surface: "#FFFFFF",
  espresso5: "#2B1D14", espresso4: "#3E2C20", espresso3: "#5C4A3B", espresso2: "#8A7A6B",
  sage: "#6E8256", sageDark: "#54663F", sageLight: "#E4EAD9",
  gold: "#C79A45", goldLight: "#F6EBD3",
  danger: "#A33A3A", line: "#E4DBC9",
};

function money(n) {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function genLineId() {
  return "line_" + Math.random().toString(36).slice(2, 9);
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
  border: `1px solid ${COLORS.line}`, background: "#fff", color: COLORS.espresso4, borderRadius: 9,
  padding: "9px 14px", fontSize: 13.5, fontWeight: 500, cursor: "pointer",
};
const btnAccent = { ...btn, background: COLORS.sage, color: "#fff", borderColor: COLORS.sage, width: "100%" };
const field = {
  width: "100%", border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 14,
  boxSizing: "border-box", marginTop: 4,
};
const overlay = {
  position: "fixed", inset: 0, background: "rgba(43,29,20,0.45)", display: "flex",
  alignItems: "flex-end", justifyContent: "center", zIndex: 50,
};
const centerWrap = {
  minHeight: "100vh", background: COLORS.cream, fontFamily: "'Inter', sans-serif", color: COLORS.espresso4,
  display: "flex", justifyContent: "center", padding: "20px 12px",
};
const centerCard = {
  background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: 20, width: "100%", maxWidth: 420,
  height: "fit-content",
};

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
  .corder * { box-sizing: border-box; }
  .corder button { font-family: inherit; cursor: pointer; }
  .corder ::-webkit-scrollbar { display: none; }
  .corder { scrollbar-width: none; }
  @keyframes pulseCup { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.08); opacity: .75; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
`;

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

function LandingScreen({ shopName }) {
  return (
    <div className="corder" style={{
      minHeight: "100vh", background: `linear-gradient(160deg, ${COLORS.espresso5}, ${COLORS.espresso4})`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif", color: "#fff", textAlign: "center", padding: 24,
    }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{
        width: 72, height: 72, borderRadius: "50%", background: "rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18,
        animation: "pulseCup 1.4s ease-in-out infinite",
      }}>
        <i className="ti ti-coffee" style={{ fontSize: 34, color: COLORS.gold }} aria-hidden="true"></i>
      </div>
      <p style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: COLORS.gold, margin: 0, fontWeight: 600 }}>ยินดีต้อนรับสู่</p>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 26, margin: "6px 0 0" }}>{shopName || "ร้านกาแฟ"}</h1>
      <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginTop: 22 }}>กำลังโหลดเมนู...</p>
    </div>
  );
}

export default function CustomerOrder({ shopUid }) {
  const [authUid, setAuthUid] = useState(null);
  const [shopName, setShopName] = useState("");
  const [menus, setMenus] = useState(null);
  const [optionGroups, setOptionGroups] = useState([]);
  const [promptpayId, setPromptpayId] = useState("");
  const [cart, setCart] = useState([]);
  const [pickingMenu, setPickingMenu] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState("menu");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [myOrders, setMyOrders] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);

  const mainRef = useRef(null);
  const sectionRefs = useRef({});

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
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [authUid, shopUid]);

  useEffect(() => {
    if (!order) return;
    const unsub = onValue(ref(db, `orders/${shopUid}/${order.id}/status`), (snap) => {
      if (snap.exists()) setOrder((prev) => (prev ? { ...prev, status: snap.val() } : prev));
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const categories = useMemo(() => {
    if (!menus) return [];
    const seen = [];
    for (const m of menus) if (!seen.includes(m.category)) seen.push(m.category);
    return seen;
  }, [menus]);

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

  function qtyForMenu(menuId) {
    return cart.filter((l) => l.menuId === menuId).reduce((s, l) => s + l.qty, 0);
  }

  function openMenu(menu) {
    if (menu.available === false) return;
    const groups = groupsForMenu(menu);
    if (groups.length === 0) {
      const existing = cart.find((l) => l.menuId === menu.id && l.options.length === 0);
      if (existing) setLineQty(existing.lineId, existing.qty + 1);
      else addToCart(menu, 1, []);
      return;
    }
    setPickingMenu(menu);
  }

  function addToCart(menu, qty, options) {
    const unitPrice = menu.priceStore + options.reduce((s, o) => s + (o.priceDelta || 0), 0);
    setCart((c) => [...c, { lineId: genLineId(), menuId: menu.id, name: menu.name, unitPrice, qty, options }]);
  }

  function removeLine(lineId) {
    setCart((c) => c.filter((l) => l.lineId !== lineId));
  }

  function setLineQty(lineId, qty) {
    if (qty <= 0) { removeLine(lineId); return; }
    setCart((c) => c.map((l) => (l.lineId === lineId ? { ...l, qty } : l)));
  }

  const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  async function checkout() {
    setError("");
    if (cart.length === 0) { setError("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; }
    if (!name.trim()) { setError("กรุณาใส่ชื่อ"); return; }
    if (!phone.trim()) { setError("กรุณาใส่เบอร์โทร"); return; }
    if (!promptpayId) { setError("ร้านนี้ยังไม่เปิดรับชำระผ่าน QR (ยังไม่ได้ตั้งค่า PromptPay)"); return; }
    setSubmitting(true);
    try {
      const newRef = push(ref(db, `orders/${shopUid}`));
      const orderData = {
        customerUid: authUid,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        items: cart.map(({ lineId, ...rest }) => rest),
        total,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await set(newRef, orderData);
      saveMyOrderId(shopUid, newRef.key);
      const payload = generatePayload(promptpayId, { amount: total });
      const url = await QRCode.toDataURL(payload, { width: 260, margin: 1 });
      setQrDataUrl(url);
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
    if (o.status === "pending" && promptpayId) {
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

  if (!authUid || menus === null) {
    return <LandingScreen shopName={shopName} />;
  }

  if (step === "myorders") {
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <div style={centerCard}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>ออเดอร์ของฉัน</h1>
          {myOrders.length === 0 ? (
            <p style={{ fontSize: 13, color: COLORS.espresso2 }}>ยังไม่มีประวัติการสั่งซื้อจากอุปกรณ์นี้</p>
          ) : (
            myOrders.map((o) => (
              <button key={o.id} onClick={() => reopenOrder(o)} style={{
                display: "block", width: "100%", textAlign: "left", background: "#fff", border: `1px solid ${COLORS.line}`,
                borderRadius: 10, padding: 12, marginBottom: 8, cursor: "pointer",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{new Date(o.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span style={{ fontWeight: 600 }}>฿{money(o.total)}</span>
                </div>
                <div style={{ fontSize: 12, color: COLORS.espresso2, marginTop: 2 }}>{STATUS_TEXT[o.status] || o.status}</div>
              </button>
            ))
          )}
          <button style={{ ...btn, marginTop: 8 }} onClick={() => setStep("menu")}>ย้อนกลับ</button>
        </div>
      </div>
    );
  }

  if (step === "pay" && order) {
    const showQr = order.status === "pending";
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <div style={{ ...centerCard, textAlign: "center" }}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>
            {showQr ? "สแกนจ่ายผ่าน PromptPay" : "สถานะออเดอร์"}
          </h1>
          {showQr ? (
            <>
              {qrDataUrl && <img src={qrDataUrl} alt="PromptPay QR" width={220} height={220} style={{ borderRadius: 10, border: `1px solid ${COLORS.line}` }} />}
              <p style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Fraunces', serif", margin: "14px 0 4px" }}>฿{money(order.total)}</p>
              <p style={{ fontSize: 12, color: COLORS.espresso2, margin: "0 0 14px" }}>{STATUS_TEXT.pending} (หน้านี้จะอัปเดตอัตโนมัติ)</p>
            </>
          ) : (
            <div style={{ padding: "24px 0" }}>
              <p style={{ fontSize: 40, margin: 0 }}>{order.status === "ready" ? "✅" : order.status === "cancelled" ? "✖️" : "☕"}</p>
              <p style={{ fontSize: 16, fontWeight: 600, margin: "10px 0 4px" }}>{STATUS_TEXT[order.status] || order.status}</p>
            </div>
          )}
          <div style={{ textAlign: "left", marginTop: 10, borderTop: `1px dashed ${COLORS.line}`, paddingTop: 10 }}>
            {order.items.map((i, idx) => (
              <div key={idx} style={{ fontSize: 12.5, marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{i.name} x{i.qty}</span><span>฿{money(i.unitPrice * i.qty)}</span>
                </div>
                {i.options?.length > 0 && (
                  <div style={{ color: COLORS.espresso2, fontSize: 11 }}>{i.options.map((o) => o.label).join(", ")}</div>
                )}
              </div>
            ))}
          </div>
          <button style={{ ...btn, marginTop: 14, width: "100%" }} onClick={() => { setOrder(null); setStep("menu"); }}>กลับไปหน้าเมนู</button>
        </div>
      </div>
    );
  }

  if (step === "phone") {
    return (
      <div className="corder" style={centerWrap}>
        <style>{GLOBAL_CSS}</style>
        <div style={centerCard}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>สรุปออเดอร์</h1>
          {cart.map((l) => (
            <div key={l.lineId} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                <span>{l.name} x{l.qty}</span><span>฿{money(l.unitPrice * l.qty)}</span>
              </div>
              {l.options.length > 0 && <div style={{ fontSize: 11, color: COLORS.espresso2 }}>{l.options.map((o) => o.label).join(", ")}</div>}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, borderTop: `1px dashed ${COLORS.line}`, marginTop: 8, paddingTop: 8 }}>
            <span>รวม</span><span>฿{money(total)}</span>
          </div>

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 16 }}>ชื่อ</label>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อของคุณ" />

          <label style={{ fontSize: 12, color: COLORS.espresso2, display: "block", marginTop: 12 }}>เบอร์โทรศัพท์</label>
          <input style={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" />

          {error && <p style={{ fontSize: 12, color: COLORS.danger, margin: "10px 0 0" }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button style={btn} onClick={() => setStep("menu")}>ย้อนกลับ</button>
            <button style={{ ...btnAccent }} disabled={submitting} onClick={checkout}>
              {submitting ? "กำลังสร้าง QR..." : "ยืนยันสั่งซื้อ"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="corder" style={{ height: "100vh", display: "flex", flexDirection: "column", background: COLORS.cream, fontFamily: "'Inter', sans-serif", color: COLORS.espresso4 }}>
      <style>{GLOBAL_CSS}</style>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.44.0/iconfont/tabler-icons.min.css" />

      <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${COLORS.line}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: COLORS.surface }}>
        <div>
          <p style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: COLORS.sageDark, fontWeight: 600, margin: 0 }}>สั่งเครื่องดื่มออนไลน์</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 21, margin: "3px 0 0", color: COLORS.espresso5 }}>{shopName}</h1>
        </div>
        {loadMyOrderIds(shopUid).length > 0 && (
          <button style={{ ...btn, fontSize: 11.5, padding: "6px 10px" }} onClick={openMyOrders}>
            <i className="ti ti-receipt" style={{ fontSize: 13, marginRight: 4 }} aria-hidden="true"></i>ออเดอร์ของฉัน
          </button>
        )}
      </div>

      {menus.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: COLORS.espresso2, fontSize: 13 }}>ร้านยังไม่มีเมนู</div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <nav style={{ width: 92, flexShrink: 0, background: COLORS.cream2, overflowY: "auto", borderRight: `1px solid ${COLORS.line}` }}>
            {categories.map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => scrollToCategory(cat)}
                  style={{
                    display: "block", width: "100%", textAlign: "center", padding: "14px 6px", fontSize: 12.5,
                    lineHeight: 1.3, background: active ? COLORS.cream : "transparent", color: active ? COLORS.espresso5 : COLORS.espresso2,
                    fontWeight: active ? 600 : 500, border: "none", borderLeft: active ? `3px solid ${COLORS.sage}` : "3px solid transparent",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </nav>

          <main ref={mainRef} style={{ flex: 1, overflowY: "auto", padding: "4px 14px 100px" }}>
            {categories.map((cat) => (
              <section key={cat} data-category={cat} ref={(el) => { sectionRefs.current[cat] = el; }} style={{ paddingTop: 16 }}>
                <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: COLORS.espresso5, margin: "0 0 10px" }}>{cat}</h2>
                {menus.filter((m) => m.category === cat).map((m) => {
                  const soldOut = m.available === false;
                  const qty = qtyForMenu(m.id);
                  return (
                    <div key={m.id} onClick={() => openMenu(m)} style={{
                      display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${COLORS.line}`,
                      opacity: soldOut ? 0.5 : 1, cursor: soldOut ? "default" : "pointer",
                    }}>
                      <MenuThumb imageUrl={m.imageUrl} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 14, color: COLORS.espresso5 }}>{m.name}</div>
                        <div style={{ fontSize: 13, color: soldOut ? COLORS.danger : COLORS.gold, fontWeight: 600, marginTop: 3 }}>
                          {soldOut ? "หมดวันนี้" : `฿${money(m.priceStore)}`}
                        </div>
                      </div>
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
                          }}>{qty}</span>
                        )}
                      </button>
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
          background: COLORS.espresso5, color: "#fff", borderRadius: 16,
          padding: "12px 14px 12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "0 8px 24px rgba(43,29,20,0.35)", animation: "fadeIn .2s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative" }}>
              <i className="ti ti-shopping-bag" style={{ fontSize: 22 }} aria-hidden="true"></i>
              <span style={{
                position: "absolute", top: -8, right: -8, background: COLORS.danger, color: "#fff", fontSize: 10,
                fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
              }}>{cartCount}</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, fontFamily: "'Fraunces', serif" }}>฿{money(total)}</span>
          </div>
          <button
            onClick={() => { setError(""); setStep("phone"); }}
            style={{ background: COLORS.sage, color: "#fff", border: "none", borderRadius: 10, padding: "10px 22px", fontSize: 13.5, fontWeight: 600 }}
          >
            สั่งซื้อ
          </button>
        </div>
      )}

      {pickingMenu && (
        <OptionPickerModal
          menu={pickingMenu}
          groups={groupsForMenu(pickingMenu)}
          onCancel={() => setPickingMenu(null)}
          onConfirm={(qty, options) => { addToCart(pickingMenu, qty, options); setPickingMenu(null); }}
        />
      )}
    </div>
  );
}

function OptionPickerModal({ menu, groups, onCancel, onConfirm }) {
  const [qty, setQty] = useState(1);
  const [selections, setSelections] = useState({});
  const [err, setErr] = useState("");

  function pick(groupId, choice) {
    setSelections((s) => ({ ...s, [groupId]: choice }));
  }

  function confirm() {
    for (const g of groups) {
      if (g.required && !selections[g.id]) {
        setErr(`กรุณาเลือก "${g.name}"`);
        return;
      }
    }
    const options = groups
      .map((g) => selections[g.id])
      .filter(Boolean)
      .map((c) => ({ groupId: c.groupId, groupName: c.groupName, choiceId: c.id, label: c.label, priceDelta: c.priceDelta || 0 }));
    onConfirm(qty, options);
  }

  return (
    <div style={overlay} onClick={onCancel}>
      <div style={{ background: "#fff", borderRadius: "16px 16px 0 0", padding: 20, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "0 0 14px" }}>{menu.name}</h2>

        {groups.map((g) => (
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
                  <span style={{ fontSize: 12.5, whiteSpace: "nowrap", marginLeft: 8 }}>{c.priceDelta ? `+฿${c.priceDelta}` : "฿0"}</span>
                </button>
              );
            })}
          </div>
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 16px" }}>
          <span style={{ fontSize: 13 }}>จำนวน</span>
          <button style={{ ...btn, padding: "4px 10px" }} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <span style={{ minWidth: 18, textAlign: "center" }}>{qty}</span>
          <button style={{ ...btn, padding: "4px 10px" }} onClick={() => setQty((q) => q + 1)}>+</button>
        </div>

        {err && <p style={{ fontSize: 12, color: COLORS.danger, margin: "0 0 10px" }}>{err}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn} onClick={onCancel}>ยกเลิก</button>
          <button style={btnAccent} onClick={confirm}>เพิ่มลงตะกร้า</button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
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

const wrap = {
  minHeight: "100vh", background: "#FAF6EE", fontFamily: "'Inter', sans-serif", color: "#3E2C20",
  display: "flex", justifyContent: "center", padding: "20px 12px",
};
const card = {
  background: "#fff", border: "1px solid #E4DBC9", borderRadius: 16, padding: 20, width: "100%", maxWidth: 420,
  height: "fit-content",
};
const btn = {
  border: "1px solid #E4DBC9", background: "#fff", color: "#3E2C20", borderRadius: 9,
  padding: "9px 14px", fontSize: 13.5, fontWeight: 500, cursor: "pointer",
};
const btnAccent = { ...btn, background: "#6E8256", color: "#fff", borderColor: "#6E8256", width: "100%" };
const field = {
  width: "100%", border: "1px solid #E4DBC9", borderRadius: 8, padding: "9px 10px", fontSize: 14,
  boxSizing: "border-box", marginTop: 4,
};
const overlay = {
  position: "fixed", inset: 0, background: "rgba(43,29,20,0.45)", display: "flex",
  alignItems: "flex-end", justifyContent: "center", zIndex: 50,
};

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

  function groupsForMenu(menu) {
    const ids = menu.optionGroupIds || [];
    return optionGroups.filter((g) => ids.includes(g.id));
  }

  function openMenu(menu) {
    if (menu.available === false) return;
    const groups = groupsForMenu(menu);
    if (groups.length === 0) {
      addToCart(menu, 1, []);
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
    return <div style={wrap}><div style={card}>{error}</div></div>;
  }

  if (!authUid || menus === null) {
    return <div style={wrap}><div style={card}>กำลังโหลดเมนู...</div></div>;
  }

  if (step === "myorders") {
    return (
      <div style={wrap}>
        <div style={card}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#54663F", fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>ออเดอร์ของฉัน</h1>
          {myOrders.length === 0 ? (
            <p style={{ fontSize: 13, color: "#8A7A6B" }}>ยังไม่มีประวัติการสั่งซื้อจากอุปกรณ์นี้</p>
          ) : (
            myOrders.map((o) => (
              <button key={o.id} onClick={() => reopenOrder(o)} style={{
                display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #E4DBC9",
                borderRadius: 10, padding: 12, marginBottom: 8, cursor: "pointer",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{new Date(o.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span style={{ fontWeight: 600 }}>฿{money(o.total)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#8A7A6B", marginTop: 2 }}>{STATUS_TEXT[o.status] || o.status}</div>
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
      <div style={wrap}>
        <div style={{ ...card, textAlign: "center" }}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#54663F", fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>
            {showQr ? "สแกนจ่ายผ่าน PromptPay" : "สถานะออเดอร์"}
          </h1>
          {showQr ? (
            <>
              {qrDataUrl && <img src={qrDataUrl} alt="PromptPay QR" width={220} height={220} style={{ borderRadius: 10, border: "1px solid #E4DBC9" }} />}
              <p style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Fraunces', serif", margin: "14px 0 4px" }}>฿{money(order.total)}</p>
              <p style={{ fontSize: 12, color: "#8A7A6B", margin: "0 0 14px" }}>{STATUS_TEXT.pending} (หน้านี้จะอัปเดตอัตโนมัติ)</p>
            </>
          ) : (
            <div style={{ padding: "24px 0" }}>
              <p style={{ fontSize: 40, margin: 0 }}>{order.status === "ready" ? "✅" : order.status === "cancelled" ? "✖️" : "☕"}</p>
              <p style={{ fontSize: 16, fontWeight: 600, margin: "10px 0 4px" }}>{STATUS_TEXT[order.status] || order.status}</p>
            </div>
          )}
          <div style={{ textAlign: "left", marginTop: 10, borderTop: "1px dashed #E4DBC9", paddingTop: 10 }}>
            {order.items.map((i, idx) => (
              <div key={idx} style={{ fontSize: 12.5, marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{i.name} x{i.qty}</span><span>฿{money(i.unitPrice * i.qty)}</span>
                </div>
                {i.options?.length > 0 && (
                  <div style={{ color: "#8A7A6B", fontSize: 11 }}>{i.options.map((o) => o.label).join(", ")}</div>
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
      <div style={wrap}>
        <div style={card}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#54663F", fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>สรุปออเดอร์</h1>
          {cart.map((l) => (
            <div key={l.lineId} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                <span>{l.name} x{l.qty}</span><span>฿{money(l.unitPrice * l.qty)}</span>
              </div>
              {l.options.length > 0 && <div style={{ fontSize: 11, color: "#8A7A6B" }}>{l.options.map((o) => o.label).join(", ")}</div>}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, borderTop: "1px dashed #E4DBC9", marginTop: 8, paddingTop: 8 }}>
            <span>รวม</span><span>฿{money(total)}</span>
          </div>

          <label style={{ fontSize: 12, color: "#8A7A6B", display: "block", marginTop: 16 }}>ชื่อ</label>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อของคุณ" />

          <label style={{ fontSize: 12, color: "#8A7A6B", display: "block", marginTop: 12 }}>เบอร์โทรศัพท์</label>
          <input style={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxx" />

          {error && <p style={{ fontSize: 12, color: "#A33A3A", margin: "10px 0 0" }}>{error}</p>}

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
    <div style={wrap}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#54663F", fontWeight: 500, margin: 0 }}>{shopName}</p>
            <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>สั่งเครื่องดื่ม</h1>
          </div>
          {loadMyOrderIds(shopUid).length > 0 && (
            <button style={{ ...btn, fontSize: 12, padding: "6px 10px" }} onClick={openMyOrders}>ออเดอร์ของฉัน</button>
          )}
        </div>

        {menus.length === 0 && <p style={{ fontSize: 13, color: "#8A7A6B" }}>ร้านยังไม่มีเมนู</p>}

        {menus.map((m) => {
          const soldOut = m.available === false;
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #EFE9DB", opacity: soldOut ? 0.5 : 1 }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: "#8A7A6B" }}>{soldOut ? "หมดวันนี้" : `฿${money(m.priceStore)}`}</div>
              </div>
              <button style={btn} disabled={soldOut} onClick={() => openMenu(m)}>{soldOut ? "หมด" : "เพิ่ม"}</button>
            </div>
          );
        })}

        {cart.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: "#5C4A3B", margin: "0 0 8px" }}>ตะกร้าของคุณ</p>
            {cart.map((l) => (
              <div key={l.lineId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginBottom: 6 }}>
                <div>
                  <div>{l.name}{l.options.length > 0 && <span style={{ color: "#8A7A6B", fontSize: 11 }}> ({l.options.map((o) => o.label).join(", ")})</span>}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button style={{ ...btn, padding: "3px 9px" }} onClick={() => setLineQty(l.lineId, l.qty - 1)}>−</button>
                  <span style={{ minWidth: 16, textAlign: "center" }}>{l.qty}</span>
                  <button style={{ ...btn, padding: "3px 9px" }} onClick={() => setLineQty(l.lineId, l.qty + 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p style={{ fontSize: 12, color: "#A33A3A", margin: "10px 0 0" }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, marginTop: 14 }}>
          <span>รวม</span><span>฿{money(total)}</span>
        </div>
        <button style={{ ...btnAccent, marginTop: 12 }} onClick={() => { setError(""); if (cart.length === 0) { setError("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; } setStep("phone"); }}>
          ต่อไป
        </button>
      </div>

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
            <p style={{ fontSize: 11, color: "#8A7A6B", margin: "0 0 8px" }}>{g.required ? "กรุณาเลือก 1 ข้อ" : "เลือกได้ (ไม่บังคับ)"}</p>
            {g.choices.map((c) => {
              const selected = selections[g.id]?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => pick(g.id, { ...c, groupId: g.id, groupName: g.name })}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                    textAlign: "left", padding: "9px 12px", marginBottom: 6, borderRadius: 9, cursor: "pointer",
                    border: selected ? "1.5px solid #6E8256" : "1px solid #E4DBC9",
                    background: selected ? "#E4EAD9" : "#fff", color: "#3E2C20", fontSize: 13,
                  }}
                >
                  <span>
                    <div style={{ fontWeight: 500 }}>{c.label}</div>
                    {c.note && <div style={{ fontSize: 11, color: "#8A7A6B" }}>{c.note}</div>}
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

        {err && <p style={{ fontSize: 12, color: "#A33A3A", margin: "0 0 10px" }}>{err}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn} onClick={onCancel}>ยกเลิก</button>
          <button style={btnAccent} onClick={confirm}>เพิ่มลงตะกร้า</button>
        </div>
      </div>
    </div>
  );
}

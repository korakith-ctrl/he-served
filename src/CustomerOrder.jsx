import { useState, useEffect } from "react";
import { db, auth } from "./firebase";
import { signInAnonymously } from "firebase/auth";
import { ref, onValue, push, set } from "firebase/database";
import QRCode from "qrcode";
import generatePayload from "promptpay-qr";

function money(n) {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export default function CustomerOrder({ shopUid }) {
  const [authUid, setAuthUid] = useState(null);
  const [shopName, setShopName] = useState("");
  const [menus, setMenus] = useState(null);
  const [promptpayId, setPromptpayId] = useState("");
  const [cart, setCart] = useState({});
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState("menu");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);

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
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [authUid, shopUid]);

  useEffect(() => {
    if (!order) return;
    const unsub = onValue(ref(db, `orders/${shopUid}/${order.id}/status`), (snap) => {
      if (snap.exists()) setOrder((prev) => (prev ? { ...prev, status: snap.val() } : prev));
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  function setQty(menuId, qty) {
    setCart((c) => ({ ...c, [menuId]: Math.max(0, qty) }));
  }

  const cartItems = menus ? Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([menuId, qty]) => {
      const m = menus.find((x) => x.id === menuId);
      return m ? { menuId, name: m.name, qty, unitPrice: m.priceStore } : null;
    })
    .filter(Boolean) : [];
  const total = cartItems.reduce((s, i) => s + i.unitPrice * i.qty, 0);

  async function checkout() {
    setError("");
    if (cartItems.length === 0) { setError("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; }
    if (!phone.trim()) { setError("กรุณาใส่เบอร์โทร"); return; }
    if (!promptpayId) { setError("ร้านนี้ยังไม่เปิดรับชำระผ่าน QR (ยังไม่ได้ตั้งค่า PromptPay)"); return; }
    setSubmitting(true);
    try {
      const newRef = push(ref(db, `orders/${shopUid}`));
      const orderData = {
        customerUid: authUid,
        customerPhone: phone.trim(),
        items: cartItems,
        total,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await set(newRef, orderData);
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

  if (error && !menus && step === "menu" && !authUid) {
    return <div style={wrap}><div style={card}>{error}</div></div>;
  }

  if (!authUid || menus === null) {
    return <div style={wrap}><div style={card}>กำลังโหลดเมนู...</div></div>;
  }

  if (step === "pay" && order) {
    const paid = order.status === "paid" || order.status === "done";
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: "center" }}>
          <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#54663F", fontWeight: 500, margin: 0 }}>{shopName}</p>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>สแกนจ่ายผ่าน PromptPay</h1>
          {!paid ? (
            <>
              <img src={qrDataUrl} alt="PromptPay QR" width={220} height={220} style={{ borderRadius: 10, border: "1px solid #E4DBC9" }} />
              <p style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Fraunces', serif", margin: "14px 0 4px" }}>฿{money(order.total)}</p>
              <p style={{ fontSize: 12, color: "#8A7A6B", margin: "0 0 14px" }}>รอร้านยืนยันการรับเงิน... (หน้านี้จะอัปเดตอัตโนมัติ)</p>
            </>
          ) : (
            <div style={{ padding: "24px 0" }}>
              <p style={{ fontSize: 40, margin: 0 }}>✅</p>
              <p style={{ fontSize: 16, fontWeight: 600, margin: "10px 0 4px" }}>ร้านยืนยันรับเงินแล้ว</p>
              <p style={{ fontSize: 12.5, color: "#8A7A6B" }}>ขอบคุณที่อุดหนุนครับ/ค่ะ</p>
            </div>
          )}
          <div style={{ textAlign: "left", marginTop: 10, borderTop: "1px dashed #E4DBC9", paddingTop: 10 }}>
            {order.items.map((i) => (
              <div key={i.menuId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                <span>{i.name} x{i.qty}</span><span>฿{money(i.unitPrice * i.qty)}</span>
              </div>
            ))}
          </div>
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
          {cartItems.map((i) => (
            <div key={i.menuId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
              <span>{i.name} x{i.qty}</span><span>฿{money(i.unitPrice * i.qty)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, borderTop: "1px dashed #E4DBC9", marginTop: 8, paddingTop: 8 }}>
            <span>รวม</span><span>฿{money(total)}</span>
          </div>

          <label style={{ fontSize: 12, color: "#8A7A6B", display: "block", marginTop: 16 }}>เบอร์โทรศัพท์</label>
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
        <p style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#54663F", fontWeight: 500, margin: 0 }}>{shopName}</p>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, margin: "4px 0 14px" }}>สั่งเครื่องดื่ม</h1>

        {menus.length === 0 && <p style={{ fontSize: 13, color: "#8A7A6B" }}>ร้านยังไม่มีเมนู</p>}

        {menus.map((m) => {
          const qty = cart[m.id] || 0;
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #EFE9DB" }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: "#8A7A6B" }}>฿{money(m.priceStore)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button style={{ ...btn, padding: "4px 10px" }} onClick={() => setQty(m.id, qty - 1)}>−</button>
                <span style={{ minWidth: 18, textAlign: "center" }}>{qty}</span>
                <button style={{ ...btn, padding: "4px 10px" }} onClick={() => setQty(m.id, qty + 1)}>+</button>
              </div>
            </div>
          );
        })}

        {error && <p style={{ fontSize: 12, color: "#A33A3A", margin: "10px 0 0" }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, marginTop: 14 }}>
          <span>รวม</span><span>฿{money(total)}</span>
        </div>
        <button style={{ ...btnAccent, marginTop: 12 }} onClick={() => { setError(""); if (cartItems.length === 0) { setError("กรุณาเลือกเมนูอย่างน้อย 1 รายการ"); return; } setStep("phone"); }}>
          ต่อไป
        </button>
      </div>
    </div>
  );
}

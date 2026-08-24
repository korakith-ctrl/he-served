import { useEffect, useMemo, useState } from "react";
import { onValue, push, ref, remove, set, update } from "firebase/database";
import { db } from "./firebase";

const LIABILITY_TYPES = {
  credit_card: { label: "บัตรเครดิต", icon: "▣" },
  home: { label: "สินเชื่อบ้าน", icon: "⌂" },
  car: { label: "สินเชื่อรถ", icon: "◇" },
  personal: { label: "สินเชื่อส่วนบุคคล", icon: "◌" },
  bnpl: { label: "ผ่อนสินค้า / BNPL", icon: "▤" },
  other: { label: "หนี้อื่น", icon: "○" },
};

const EXPENSE_CATEGORIES = ["ที่อยู่อาศัย", "อาหาร", "เดินทาง", "สาธารณูปโภค", "ประกัน", "สมาชิก/แอป", "ครอบครัว", "สุขภาพ", "อื่นๆ"];

function money(value, digits = 0) {
  return Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: 2 });
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function moveMonth(value, amount) {
  const [year, month] = value.split("-").map(Number);
  return monthKey(new Date(year, month - 1 + amount, 1));
}

function monthDate(value, day) {
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${value}-${String(Math.min(Math.max(Number(day || 1), 1), lastDay)).padStart(2, "0")}`;
}

function shortDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function rows(object) {
  return Object.entries(object || {}).map(([id, value]) => ({ id, ...value }));
}

function isFullBalanceCard(item) {
  return item?.type === "credit_card" && item?.cardPaymentMode === "full_balance";
}

function occursInMonth(item, selectedMonth) {
  if (item.active === false) return false;
  if (item.frequency === "once") return String(item.date || "").startsWith(selectedMonth);
  if (item.startMonth && item.startMonth > selectedMonth) return false;
  if (item.endMonth && item.endMonth < selectedMonth) return false;
  return true;
}

function todayKey() {
  const now = new Date();
  return `${monthKey(now)}-${String(now.getDate()).padStart(2, "0")}`;
}

function Modal({ title, eyebrow, onClose, children, wide = false }) {
  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop personal-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal-card personal-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>
          <button className="close" onClick={onClose} aria-label="ปิด">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EntryForm({ kind, initial, selectedMonth, onSave, onClose }) {
  const isIncome = kind === "income";
  const [form, setForm] = useState(() => ({
    name: initial?.name || "",
    amount: initial?.amount || "",
    frequency: initial?.frequency || "monthly",
    dayOfMonth: initial?.dayOfMonth || (isIncome ? "25" : "1"),
    date: initial?.date || `${selectedMonth}-01`,
    category: initial?.category || (isIncome ? "เงินเดือน" : EXPENSE_CATEGORIES[0]),
    note: initial?.note || "",
    active: initial?.active !== false,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || Number(form.amount) <= 0) return setError("กรุณากรอกชื่อและจำนวนเงินให้ครบ");
    setBusy(true);
    try {
      await onSave({ ...form, amount: Number(form.amount), dayOfMonth: Number(form.dayOfMonth || 1), updatedAt: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(err?.message || "บันทึกไม่สำเร็จ");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="wide">ชื่อรายการ<input autoFocus value={form.name} onChange={(e) => change("name", e.target.value)} placeholder={isIncome ? "เช่น เงินเดือนประจำ" : "เช่น ค่าเช่าห้อง"} /></label>
        <label>จำนวนเงินต่อครั้ง<div className="money-input no-prefix"><input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => change("amount", e.target.value)} /></div></label>
        <label>ประเภท<select value={form.category} onChange={(e) => change("category", e.target.value)}>{(isIncome ? ["เงินเดือน", "รายได้เสริม", "ค่าคอมมิชชัน", "โบนัส", "อื่นๆ"] : EXPENSE_CATEGORIES).map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>ความถี่<select value={form.frequency} onChange={(e) => change("frequency", e.target.value)}><option value="monthly">ทุกเดือน</option><option value="once">ครั้งเดียว</option></select></label>
        {form.frequency === "monthly" ? <label>วันที่{isIncome ? "ได้รับ" : "จ่าย"}<input type="number" min="1" max="31" value={form.dayOfMonth} onChange={(e) => change("dayOfMonth", e.target.value)} /></label> : <label>วันที่{isIncome ? "ได้รับ" : "จ่าย"}<input type="date" value={form.date} onChange={(e) => change("date", e.target.value)} /></label>}
        <label className="wide">หมายเหตุ <span className="optional">(ไม่บังคับ)</span><input value={form.note} onChange={(e) => change("note", e.target.value)} /></label>
        <label className="wide personal-check"><input type="checkbox" checked={form.active} onChange={(e) => change("active", e.target.checked)} /><span><strong>นำไปคำนวณในแผนรายเดือน</strong><small>ปิดไว้ได้หากต้องการพักรายการชั่วคราว</small></span></label>
      </div>
      {error && <div className="form-message error">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกรายการ"}</button></div>
    </form>
  );
}

function LiabilityForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    type: initial?.type || "credit_card",
    title: initial?.title || "",
    outstanding: initial?.outstanding || "",
    originalBalance: initial?.originalBalance || "",
    monthlyPayment: initial?.monthlyPayment || "",
    dueDay: initial?.dueDay || "1",
    annualRate: initial?.annualRate || "",
    creditLimit: initial?.creditLimit || "",
    closingDay: initial?.closingDay || "",
    cardPaymentMode: initial?.cardPaymentMode || (initial?.type === "credit_card" ? "fixed" : "full_balance"),
    totalInstallments: initial?.totalInstallments || "",
    paidInstallments: initial?.paidInstallments || "0",
    balloonPayment: initial?.balloonPayment || "",
    note: initial?.note || "",
    active: initial?.active !== false,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const loan = form.type !== "credit_card";
  async function submit(event) {
    event.preventDefault();
    const needsFixedPayment = form.type !== "credit_card" || form.cardPaymentMode === "fixed";
    if (!form.title.trim() || Number(form.outstanding) < 0 || (needsFixedPayment && Number(form.monthlyPayment) <= 0)) return setError(needsFixedPayment ? "กรุณากรอกชื่อ ยอดคงเหลือ และยอดชำระต่อเดือน" : "กรุณากรอกชื่อบัตรและยอดคงเหลือ");
    setBusy(true);
    const numeric = ["outstanding", "originalBalance", "monthlyPayment", "dueDay", "annualRate", "creditLimit", "closingDay", "totalInstallments", "paidInstallments", "balloonPayment"];
    const payload = { ...form, updatedAt: new Date().toISOString() };
    numeric.forEach((key) => { payload[key] = Number(payload[key] || 0); });
    try { await onSave(payload); onClose(); } catch (err) { setError(err?.message || "บันทึกไม่สำเร็จ"); setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <div className="liability-type-grid">
        {Object.entries(LIABILITY_TYPES).map(([key, item]) => <button type="button" key={key} className={form.type === key ? "active" : ""} onClick={() => change("type", key)}><i>{item.icon}</i><span>{item.label}</span></button>)}
      </div>
      <div className="form-grid">
        <label className="wide">ชื่อบัญชีหรือชื่อหนี้<input autoFocus value={form.title} onChange={(e) => change("title", e.target.value)} placeholder={form.type === "credit_card" ? "เช่น KBank Platinum" : "เช่น บ้านหลังหลัก"} /></label>
        {form.type === "credit_card" && <div className="wide card-payment-mode"><span>วิธีชำระบัตร</span><div><button type="button" className={form.cardPaymentMode === "full_balance" ? "active" : ""} onClick={() => change("cardPaymentMode", "full_balance")}><strong>จ่ายเต็มทุกเดือน</strong><small>กรอกยอดใบแจ้งหนี้ใหม่ในแต่ละรอบ</small></button><button type="button" className={form.cardPaymentMode === "fixed" ? "active" : ""} onClick={() => change("cardPaymentMode", "fixed")}><strong>กำหนดยอดคงที่</strong><small>ใช้ยอดวางแผนเท่ากันทุกเดือน</small></button></div></div>}
        <label>ยอดหนี้คงเหลือ<div className="money-input no-prefix"><input type="number" min="0" step="0.01" value={form.outstanding} onChange={(e) => change("outstanding", e.target.value)} /></div></label>
        {(form.type !== "credit_card" || form.cardPaymentMode === "fixed") && <label>ยอดชำระต่อเดือน<div className="money-input no-prefix"><input type="number" min="0" step="0.01" value={form.monthlyPayment} onChange={(e) => change("monthlyPayment", e.target.value)} /></div></label>}
        <label>วันครบกำหนด<input type="number" min="1" max="31" value={form.dueDay} onChange={(e) => change("dueDay", e.target.value)} /></label>
        <label>ดอกเบี้ยต่อปี (%)<input type="number" min="0" step="0.01" value={form.annualRate} onChange={(e) => change("annualRate", e.target.value)} /></label>
        {form.type === "credit_card" ? <>
          <label>วงเงินบัตร<div className="money-input no-prefix"><input type="number" min="0" value={form.creditLimit} onChange={(e) => change("creditLimit", e.target.value)} /></div></label>
          <label>วันตัดรอบ<input type="number" min="1" max="31" value={form.closingDay} onChange={(e) => change("closingDay", e.target.value)} /></label>
        </> : <>
          <label>ยอดเริ่มต้น<div className="money-input no-prefix"><input type="number" min="0" value={form.originalBalance} onChange={(e) => change("originalBalance", e.target.value)} /></div></label>
          <label>จำนวนงวดทั้งหมด<input type="number" min="0" value={form.totalInstallments} onChange={(e) => change("totalInstallments", e.target.value)} /></label>
          <label>จ่ายแล้วกี่งวด<input type="number" min="0" value={form.paidInstallments} onChange={(e) => change("paidInstallments", e.target.value)} /></label>
          {(form.type === "car" || form.type === "other") && <label>ยอดบอลลูนงวดสุดท้าย<div className="money-input no-prefix"><input type="number" min="0" value={form.balloonPayment} onChange={(e) => change("balloonPayment", e.target.value)} /></div></label>}
        </>}
        <label className="wide">หมายเหตุ <span className="optional">(ไม่บังคับ)</span><input value={form.note} onChange={(e) => change("note", e.target.value)} /></label>
        <label className="wide personal-check"><input type="checkbox" checked={form.active} onChange={(e) => change("active", e.target.checked)} /><span><strong>เป็นหนี้ที่กำลังชำระ</strong><small>ยอดชำระจะถูกรวมในกระแสเงินสดรายเดือน</small></span></label>
      </div>
      {form.type === "credit_card" && form.cardPaymentMode === "full_balance" && <div className="liability-preview">หลังสร้างบัตร ให้กด <strong>ใส่ยอดรอบบิล</strong> เพื่อระบุยอดที่ต้องจ่ายของแต่ละเดือน บัตรจะยังเปิดอยู่หลังจ่ายเต็ม</div>}
      {loan && Number(form.totalInstallments) > 0 && <div className="liability-preview">เหลือประมาณ <strong>{Math.max(0, Number(form.totalInstallments) - Number(form.paidInstallments || 0))} งวด</strong></div>}
      {error && <div className="form-message error">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกหนี้"}</button></div>
    </form>
  );
}

function CardStatementForm({ liability, selectedMonth, initial, onSave, onClose }) {
  const [amount, setAmount] = useState(initial?.amount || "");
  const [dueDate, setDueDate] = useState(initial?.dueDate || monthDate(selectedMonth, liability.dueDay));
  const [note, setNote] = useState(initial?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const paidAmount = Number(initial?.paidAmount || 0);
  async function submit(event) {
    event.preventDefault();
    if (Number(amount) <= 0) return setError("กรุณากรอกยอดใบแจ้งหนี้");
    if (Number(amount) < paidAmount) return setError(`ยอดใบแจ้งหนี้ต้องไม่น้อยกว่ายอดที่บันทึกว่าจ่ายแล้ว ${money(paidAmount)}`);
    if (!String(dueDate).startsWith(selectedMonth)) return setError("วันครบกำหนดต้องอยู่ในเดือนที่กำลังจัดการ");
    setBusy(true);
    try { await onSave({ amount: Number(amount), dueDate, note, paidAmount, status: paidAmount >= Number(amount) ? "paid" : paidAmount > 0 ? "partial" : "unpaid" }); onClose(); } catch (err) { setError(err?.message || "บันทึกไม่สำเร็จ"); setBusy(false); }
  }
  return <form onSubmit={submit}>
    <div className="payment-target"><span>ยอดเรียกเก็บ · {monthLabel(selectedMonth)}</span><strong>{liability.title}</strong><small>บัตรนี้ตั้งค่าให้ชำระเต็มจำนวนทุกเดือน</small></div>
    <div className="form-grid">
      <label>ยอดใบแจ้งหนี้<div className="money-input no-prefix"><input autoFocus type="number" min={paidAmount} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div></label>
      <label>วันครบกำหนด<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      <label className="wide">หมายเหตุ <span className="optional">(ไม่บังคับ)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ยอดตามใบแจ้งหนี้ธนาคาร" /></label>
    </div>
    {paidAmount > 0 && <div className="liability-preview">บันทึกว่าจ่ายแล้ว <strong>{money(paidAmount, 2)}</strong> · คงเหลือ <strong>{money(Math.max(0, Number(amount) - paidAmount), 2)}</strong></div>}
    {error && <div className="form-message error">{error}</div>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกยอดรอบบิล"}</button></div>
  </form>;
}

function PaymentForm({ liability, selectedMonth, statement, onSave, onClose }) {
  const statementRemaining = statement ? Math.max(0, Number(statement.amount) - Number(statement.paidAmount || 0)) : 0;
  const [amount, setAmount] = useState(statement ? statementRemaining : liability.monthlyPayment || "");
  const [interest, setInterest] = useState("");
  const [date, setDate] = useState(statement?.dueDate || monthDate(selectedMonth, liability.dueDay));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (Number(amount) <= 0 || Number(interest) > Number(amount)) return setError("กรุณาตรวจสอบยอดชำระและดอกเบี้ย");
    if (statement && Number(amount) > statementRemaining) return setError(`ยอดชำระต้องไม่เกินยอดคงเหลือของรอบบิล ${money(statementRemaining)}`);
    setBusy(true);
    try { await onSave({ amount: Number(amount), interestAmount: statement ? 0 : Number(interest || 0), date, note, statementMonth: statement ? selectedMonth : "" }); onClose(); } catch (err) { setError(err?.message || "บันทึกไม่สำเร็จ"); setBusy(false); }
  }
  const principal = statement ? Number(amount || 0) : Math.max(0, Number(amount || 0) - Number(interest || 0));
  return <form onSubmit={submit}>
    <div className="payment-target"><span>{statement ? `ใบแจ้งหนี้ ${monthLabel(selectedMonth)}` : LIABILITY_TYPES[liability.type]?.label}</span><strong>{liability.title}</strong><small>{statement ? `ต้องชำระเต็ม ${money(statementRemaining)}` : `ยอดคงเหลือ ${money(liability.outstanding)}`}</small></div>
    <div className="form-grid">
      <label>ยอดที่จ่าย<div className="money-input no-prefix"><input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div></label>
      {!statement && <label>ดอกเบี้ย/ค่าธรรมเนียม<div className="money-input no-prefix"><input type="number" min="0" step="0.01" value={interest} onChange={(e) => setInterest(e.target.value)} /></div></label>}
      <label>วันที่ชำระ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>หมายเหตุ<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น หักบัญชีอัตโนมัติ" /></label>
    </div>
    <div className="payment-split"><span>{statement ? "ชำระใบแจ้งหนี้" : "ตัดเงินต้น"}</span><strong>{money(principal, 2)}</strong><small>{statement ? `หลังบันทึก รอบนี้จะเหลือ ${money(Math.max(0, statementRemaining - Number(amount || 0)), 2)}` : `ยอดหนี้ใหม่ประมาณ ${money(Math.max(0, Number(liability.outstanding) - principal), 2)}`}</small></div>
    {error && <div className="form-message error">{error}</div>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังบันทึก…" : "ยืนยันการชำระ"}</button></div>
  </form>;
}

function EmptyPanel({ title, body, action, onAction }) {
  return <div className="personal-empty"><span>◎</span><h3>{title}</h3><p>{body}</p><button className="secondary" onClick={onAction}>+ {action}</button></div>;
}

export default function PersonalFinance({ user, onToast }) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(monthKey());
  const [section, setSection] = useState("overview");
  const [modal, setModal] = useState(null);

  useEffect(() => onValue(ref(db, `personalFinance/${user.uid}`), (snapshot) => {
    setData(snapshot.val() || {});
    setLoadError("");
    setLoading(false);
  }, (error) => {
    setLoadError(error?.message || "ไม่สามารถอ่านข้อมูลการเงินส่วนตัวได้");
    setLoading(false);
  }), [user.uid]);

  const incomes = useMemo(() => rows(data.incomes), [data.incomes]);
  const expenses = useMemo(() => rows(data.expenses), [data.expenses]);
  const liabilities = useMemo(() => rows(data.liabilities).sort((a, b) => Number(b.outstanding) - Number(a.outstanding)), [data.liabilities]);
  const payments = useMemo(() => rows(data.payments).sort((a, b) => String(b.date).localeCompare(String(a.date))), [data.payments]);
  const cardStatements = data.cardStatements || {};
  const monthIncomes = incomes.filter((item) => occursInMonth(item, selectedMonth));
  const monthExpenses = expenses.filter((item) => occursInMonth(item, selectedMonth));
  const monthPayments = payments.filter((item) => String(item.date || "").startsWith(selectedMonth));
  const activeLiabilities = liabilities.filter((item) => item.active !== false && (isFullBalanceCard(item) || Number(item.outstanding) > 0));
  const incomeTotal = monthIncomes.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseTotal = monthExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const plannedAmount = (item) => isFullBalanceCard(item) ? Number(cardStatements[item.id]?.[selectedMonth]?.amount || 0) : Math.min(Number(item.monthlyPayment || 0), Number(item.outstanding || 0));
  const plannedDebtTotal = activeLiabilities.reduce((sum, item) => sum + plannedAmount(item), 0);
  const actualDebtTotal = monthPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const remaining = incomeTotal - expenseTotal - plannedDebtTotal;
  const dti = incomeTotal > 0 ? (plannedDebtTotal / incomeTotal) * 100 : 0;
  const totalOutstanding = liabilities.reduce((sum, item) => sum + Number(item.outstanding || 0), 0);
  const today = todayKey();

  const schedule = useMemo(() => {
    const result = [];
    monthIncomes.forEach((item) => result.push({ id: `income-${item.id}`, date: item.frequency === "once" ? item.date : monthDate(selectedMonth, item.dayOfMonth), name: item.name, amount: Number(item.amount), direction: "in", type: "รายรับ" }));
    monthExpenses.forEach((item) => result.push({ id: `expense-${item.id}`, date: item.frequency === "once" ? item.date : monthDate(selectedMonth, item.dayOfMonth), name: item.name, amount: Number(item.amount), direction: "out", type: item.category }));
    activeLiabilities.forEach((item) => {
      const statement = cardStatements[item.id]?.[selectedMonth];
      const amount = isFullBalanceCard(item) ? Number(statement?.amount || 0) : Math.min(Number(item.monthlyPayment), Number(item.outstanding));
      if (amount <= 0) return;
      result.push({ id: `debt-${item.id}`, date: statement?.dueDate || monthDate(selectedMonth, item.dueDay), name: item.title, amount, direction: "debt", type: isFullBalanceCard(item) ? `บัตรเครดิต · ${statement?.status === "paid" ? "จ่ายแล้ว" : "จ่ายเต็ม"}` : LIABILITY_TYPES[item.type]?.label || "หนี้", liabilityId: item.id });
    });
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }, [monthIncomes, monthExpenses, activeLiabilities, selectedMonth, cardStatements]);

  const warnings = useMemo(() => {
    const result = [];
    if (!incomes.length) result.push({ tone: "info", title: "เพิ่มเงินเดือนหรือรายรับก่อน", body: "ระบบจะคำนวณเงินเหลือและสัดส่วนหนี้ให้คุณได้" });
    if (remaining < 0) result.push({ tone: "danger", title: "แผนเดือนนี้ติดลบ", body: `รายจ่ายมากกว่ารายรับ ${money(Math.abs(remaining))}` });
    if (dti > 40) result.push({ tone: "warn", title: `ภาระหนี้อยู่ที่ ${dti.toFixed(1)}% ของรายรับ`, body: "ลองตรวจยอดชำระหรือจัดลำดับหนี้ดอกเบี้ยสูงก่อน" });
    liabilities.filter((item) => item.type === "credit_card" && Number(item.creditLimit) > 0 && Number(item.outstanding) / Number(item.creditLimit) >= .7).forEach((item) => result.push({ tone: "warn", title: `${item.title} ใช้วงเงินสูง`, body: `ใช้แล้ว ${Math.min(999, Number(item.outstanding) / Number(item.creditLimit) * 100).toFixed(0)}% ของวงเงิน` }));
    const firstIncome = schedule.find((item) => item.direction === "in");
    const dueBeforeIncome = schedule.filter((item) => item.direction !== "in" && (!firstIncome || item.date < firstIncome.date)).reduce((sum, item) => sum + item.amount, 0);
    if (dueBeforeIncome > 0) result.push({ tone: "info", title: `มีเงินออกก่อนรายรับ ${money(dueBeforeIncome)}`, body: "ควรสำรองเงินไว้ก่อนถึงวันครบกำหนด" });
    return result;
  }, [incomes.length, remaining, dti, liabilities, schedule]);

  async function saveEntry(kind, item, initial) {
    const collection = kind === "income" ? "incomes" : "expenses";
    const target = initial?.id ? ref(db, `personalFinance/${user.uid}/${collection}/${initial.id}`) : push(ref(db, `personalFinance/${user.uid}/${collection}`));
    await set(target, { ...item, createdAt: initial?.createdAt || new Date().toISOString() });
    onToast?.("บันทึกรายการแล้ว");
  }

  async function saveLiability(item, initial) {
    const target = initial?.id ? ref(db, `personalFinance/${user.uid}/liabilities/${initial.id}`) : push(ref(db, `personalFinance/${user.uid}/liabilities`));
    await set(target, { ...item, createdAt: initial?.createdAt || new Date().toISOString() });
    onToast?.("บันทึกข้อมูลหนี้แล้ว");
  }

  async function saveCardStatement(liability, statement) {
    const existing = cardStatements[liability.id]?.[selectedMonth];
    const statementMonths = Object.keys(cardStatements[liability.id] || {});
    const isLatest = !statementMonths.length || selectedMonth >= statementMonths.sort().at(-1);
    const changes = {
      [`personalFinance/${user.uid}/cardStatements/${liability.id}/${selectedMonth}`]: { ...statement, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() },
      [`personalFinance/${user.uid}/liabilities/${liability.id}/active`]: true,
      [`personalFinance/${user.uid}/liabilities/${liability.id}/dueDay`]: Number(statement.dueDate.slice(-2)),
      [`personalFinance/${user.uid}/liabilities/${liability.id}/updatedAt`]: new Date().toISOString(),
    };
    if (isLatest) changes[`personalFinance/${user.uid}/liabilities/${liability.id}/outstanding`] = Math.max(0, Number(statement.amount) - Number(statement.paidAmount || 0));
    await update(ref(db), changes);
    onToast?.(`บันทึกยอดรอบบิล ${monthLabel(selectedMonth)} แล้ว`);
  }

  async function savePayment(liability, payment) {
    const target = push(ref(db, `personalFinance/${user.uid}/payments`));
    const principal = Math.max(0, payment.amount - payment.interestAmount);
    const fullBalanceCard = isFullBalanceCard(liability) && payment.statementMonth;
    const statement = fullBalanceCard ? cardStatements[liability.id]?.[payment.statementMonth] : null;
    const statementPaid = Number(statement?.paidAmount || 0) + Number(payment.amount);
    const latestStatementMonth = Object.keys(cardStatements[liability.id] || {}).sort().at(-1);
    const nextOutstanding = fullBalanceCard ? (payment.statementMonth === latestStatementMonth ? Math.max(0, Number(statement?.amount || 0) - statementPaid) : Number(liability.outstanding || 0)) : Math.max(0, Number(liability.outstanding) - principal);
    const changes = {
      [`personalFinance/${user.uid}/payments/${target.key}`]: { ...payment, liabilityId: liability.id, liabilityTitle: liability.title, principalAmount: principal, createdAt: new Date().toISOString() },
      [`personalFinance/${user.uid}/liabilities/${liability.id}/outstanding`]: nextOutstanding,
      [`personalFinance/${user.uid}/liabilities/${liability.id}/active`]: fullBalanceCard ? true : nextOutstanding > 0,
      [`personalFinance/${user.uid}/liabilities/${liability.id}/updatedAt`]: new Date().toISOString(),
    };
    if (fullBalanceCard) {
      changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/paidAmount`] = statementPaid;
      changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/status`] = statementPaid >= Number(statement?.amount || 0) ? "paid" : "partial";
      changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/paidAt`] = statementPaid >= Number(statement?.amount || 0) ? payment.date : null;
      changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/updatedAt`] = new Date().toISOString();
    } else {
      changes[`personalFinance/${user.uid}/liabilities/${liability.id}/paidInstallments`] = Number(liability.paidInstallments || 0) + 1;
    }
    await update(ref(db), changes);
    onToast?.("บันทึกการชำระแล้ว");
  }

  async function deleteItem(path, label) {
    if (!window.confirm(`ลบ${label}นี้หรือไม่? ข้อมูลที่ลบจะเรียกคืนไม่ได้`)) return;
    await remove(ref(db, `personalFinance/${user.uid}/${path}`));
    onToast?.(`ลบ${label}แล้ว`);
  }

  async function deleteLiability(liability) {
    const relatedPayments = payments.filter((item) => item.liabilityId === liability.id);
    const detail = relatedPayments.length ? ` และประวัติชำระ ${relatedPayments.length} รายการ` : "";
    if (!window.confirm(`ลบ ${liability.title}${detail} หรือไม่? ข้อมูลที่ลบจะเรียกคืนไม่ได้`)) return;
    const changes = { [`personalFinance/${user.uid}/liabilities/${liability.id}`]: null, [`personalFinance/${user.uid}/cardStatements/${liability.id}`]: null };
    relatedPayments.forEach((item) => { changes[`personalFinance/${user.uid}/payments/${item.id}`] = null; });
    await update(ref(db), changes);
    onToast?.("ลบหนี้และประวัติที่เกี่ยวข้องแล้ว");
  }

  async function deletePayment(payment) {
    if (!window.confirm("ลบประวัติการชำระนี้และคืนยอดเงินต้นกลับเข้าหนี้หรือไม่?")) return;
    const liability = liabilities.find((item) => item.id === payment.liabilityId);
    if (!liability) {
      await remove(ref(db, `personalFinance/${user.uid}/payments/${payment.id}`));
    } else {
      const changes = {
        [`personalFinance/${user.uid}/payments/${payment.id}`]: null,
        [`personalFinance/${user.uid}/liabilities/${liability.id}/active`]: true,
        [`personalFinance/${user.uid}/liabilities/${liability.id}/updatedAt`]: new Date().toISOString(),
      };
      if (isFullBalanceCard(liability) && payment.statementMonth) {
        const statement = cardStatements[liability.id]?.[payment.statementMonth];
        const nextPaid = Math.max(0, Number(statement?.paidAmount || 0) - Number(payment.amount || 0));
        const latestStatementMonth = Object.keys(cardStatements[liability.id] || {}).sort().at(-1);
        changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/paidAmount`] = nextPaid;
        changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/status`] = nextPaid > 0 ? "partial" : "unpaid";
        changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/paidAt`] = null;
        changes[`personalFinance/${user.uid}/cardStatements/${liability.id}/${payment.statementMonth}/updatedAt`] = new Date().toISOString();
        if (payment.statementMonth === latestStatementMonth) changes[`personalFinance/${user.uid}/liabilities/${liability.id}/outstanding`] = Math.max(0, Number(statement?.amount || 0) - nextPaid);
      } else {
        changes[`personalFinance/${user.uid}/liabilities/${liability.id}/outstanding`] = Number(liability.outstanding || 0) + Number(payment.principalAmount || 0);
        changes[`personalFinance/${user.uid}/liabilities/${liability.id}/paidInstallments`] = Math.max(0, Number(liability.paidInstallments || 0) - 1);
      }
      await update(ref(db), changes);
    }
    onToast?.("ลบประวัติและคืนยอดหนี้แล้ว");
  }

  const maxFlow = Math.max(incomeTotal, expenseTotal + plannedDebtTotal, 1);
  const dailyBudget = remaining > 0 ? remaining / new Date(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0).getDate() : 0;
  const debtStrategies = activeLiabilities.filter((item) => Number(item.outstanding) > 0 || plannedAmount(item) > 0).sort((a, b) => Number(b.annualRate || 0) - Number(a.annualRate || 0));

  if (loading) return <main className="dashboard personal-dashboard"><div className="personal-loading"><div className="loader" /><span>กำลังเปิดข้อมูลส่วนตัว…</span></div></main>;
  if (loadError) return <main className="dashboard personal-dashboard"><div className="personal-load-error"><span>!</span><h2>เปิดข้อมูลการเงินส่วนตัวไม่ได้</h2><p>{loadError}</p><small>ตรวจสอบว่าได้ deploy Realtime Database Rules เวอร์ชันล่าสุดแล้ว</small></div></main>;

  return <main className="dashboard personal-dashboard">
    <section className="personal-head">
      <div><p className="eyebrow">🔒 ข้อมูลนี้เห็นเฉพาะคุณ</p><h1>การเงินของฉัน</h1><p>วางแผนรายรับ รายจ่าย และหนี้ทั้งหมดในที่เดียว</p></div>
      <div className="month-picker"><button onClick={() => setSelectedMonth(moveMonth(selectedMonth, -1))} aria-label="เดือนก่อน">‹</button><strong>{monthLabel(selectedMonth)}</strong><button onClick={() => setSelectedMonth(moveMonth(selectedMonth, 1))} aria-label="เดือนถัดไป">›</button></div>
    </section>

    <nav className="personal-tabs" aria-label="ส่วนการเงินส่วนตัว">
      <button className={section === "overview" ? "active" : ""} onClick={() => setSection("overview")}>ภาพรวม</button>
      <button className={section === "debts" ? "active" : ""} onClick={() => setSection("debts")}>หนี้ของฉัน <i>{activeLiabilities.length}</i></button>
      <button className={section === "cashflow" ? "active" : ""} onClick={() => setSection("cashflow")}>รายรับ–รายจ่าย</button>
    </nav>

    {section === "overview" && <>
      <section className={`personal-hero ${remaining < 0 ? "negative" : ""}`}>
        <div className="personal-hero-copy"><span>เงินเหลือใช้ตามแผนเดือนนี้</span><strong className="amount-highlight">{remaining < 0 ? "−" : ""}{money(Math.abs(remaining))}</strong><p>{remaining >= 0 ? `เฉลี่ยใช้ได้วันละ ${money(dailyBudget)}` : "ควรปรับรายจ่ายหรือยอดชำระให้สมดุล"}</p></div>
        <div className="flow-visual" aria-label="สัดส่วนกระแสเงินสด">
          <div><span>รายรับ</span><i><b style={{ width: `${incomeTotal / maxFlow * 100}%` }} /></i><strong>{money(incomeTotal)}</strong></div>
          <div><span>ค่าใช้จ่าย</span><i><b className="expense" style={{ width: `${expenseTotal / maxFlow * 100}%` }} /></i><strong>{money(expenseTotal)}</strong></div>
          <div><span>ชำระหนี้</span><i><b className="debt" style={{ width: `${plannedDebtTotal / maxFlow * 100}%` }} /></i><strong>{money(plannedDebtTotal)}</strong></div>
        </div>
      </section>

      <section className="personal-kpis">
        <article><span className="kpi-icon income">↓</span><div><small>รายรับทั้งหมด</small><strong>{money(incomeTotal)}</strong><p>{monthIncomes.length} แหล่งรายรับ</p></div></article>
        <article><span className="kpi-icon expense">↑</span><div><small>ค่าใช้จ่ายทั่วไป</small><strong>{money(expenseTotal)}</strong><p>{monthExpenses.length} รายการ</p></div></article>
        <article><span className="kpi-icon debt">%</span><div><small>ภาระหนี้ต่อรายรับ</small><strong>{dti.toFixed(1)}%</strong><p>ต้องจ่าย {money(plannedDebtTotal)}</p></div></article>
        <article><span className="kpi-icon balance">◎</span><div><small>หนี้คงเหลือทั้งหมด</small><strong>{money(totalOutstanding)}</strong><p>{activeLiabilities.length} บัญชีที่กำลังชำระ</p></div></article>
      </section>

      <div className="personal-overview-grid">
        <section className="personal-card schedule-card">
          <div className="personal-section-head"><div><p className="eyebrow">รอบบิลของเดือน</p><h2>เงินเข้าและกำหนดจ่าย</h2></div><button className="text-button" onClick={() => setSection("cashflow")}>ดูทั้งหมด →</button></div>
          {schedule.length ? <div className="personal-schedule">{schedule.slice(0, 7).map((item) => <div key={item.id} className={`${item.direction} ${item.date < today && selectedMonth === monthKey() ? "past" : ""}`}><time><strong>{String(Number(item.date.slice(-2))).padStart(2, "0")}</strong><span>{new Intl.DateTimeFormat("th-TH", { month: "short" }).format(new Date(`${item.date}T12:00:00`))}</span></time><i /><div><strong>{item.name}</strong><span>{item.type}</span></div><b>{item.direction === "in" ? "+" : "−"}{money(item.amount)}</b></div>)}</div> : <EmptyPanel title="ยังไม่มีรอบบิล" body="เพิ่มรายรับ รายจ่าย หรือหนี้ เพื่อสร้างปฏิทินอัตโนมัติ" action="เพิ่มรายรับ" onAction={() => setModal({ type: "income" })} />}
        </section>
        <aside className="personal-card insight-card">
          <div className="personal-section-head"><div><p className="eyebrow">สิ่งที่ควรรู้</p><h2>สัญญาณเดือนนี้</h2></div></div>
          {warnings.length ? <div className="warning-list">{warnings.map((item, index) => <article key={`${item.title}-${index}`} className={item.tone}><i>{item.tone === "danger" ? "!" : item.tone === "warn" ? "△" : "i"}</i><div><strong>{item.title}</strong><p>{item.body}</p></div></article>)}</div> : <div className="all-good"><span>✓</span><strong>แผนเดือนนี้ดูสมดุลดี</strong><p>ยังไม่พบรายการที่ต้องรีบจัดการ</p></div>}
        </aside>
      </div>

      <section className="quick-actions"><button onClick={() => setModal({ type: "income" })}><span>＋</span><strong>เพิ่มรายรับ</strong><small>เงินเดือนหรือรายได้อื่น</small></button><button onClick={() => setModal({ type: "expense" })}><span>−</span><strong>เพิ่มรายจ่าย</strong><small>ประจำหรือครั้งเดียว</small></button><button onClick={() => setModal({ type: "liability" })}><span>▤</span><strong>เพิ่มหนี้</strong><small>บัตร บ้าน รถ และอื่นๆ</small></button></section>
    </>}

    {section === "debts" && <>
      <section className="debt-portfolio-head"><div><span>หนี้คงเหลือทั้งหมด</span><strong className="amount-highlight">{money(totalOutstanding)}</strong></div><dl><div><dt>ชำระตามแผน/เดือน</dt><dd>{money(plannedDebtTotal)}</dd></div><div><dt>จ่ายจริงเดือนนี้</dt><dd>{money(actualDebtTotal)}</dd></div><div><dt>DTI</dt><dd>{dti.toFixed(1)}%</dd></div></dl><button className="primary" onClick={() => setModal({ type: "liability" })}>+ เพิ่มหนี้</button></section>
      {debtStrategies.length > 1 && <section className="strategy-note"><span>↗</span><div><strong>ถ้าต้องการลดดอกเบี้ยรวม ให้เริ่มจาก {debtStrategies[0]?.title}</strong><p>อัตราดอกเบี้ย {money(debtStrategies[0]?.annualRate)}% ต่อปี สูงสุดในรายการของคุณ โดยยังคงจ่ายขั้นต่ำบัญชีอื่นให้ครบ</p></div></section>}
      <section className="liability-list">
        {liabilities.length ? liabilities.map((item) => {
          const type = LIABILITY_TYPES[item.type] || LIABILITY_TYPES.other;
          const fullBalance = isFullBalanceCard(item);
          const statement = cardStatements[item.id]?.[selectedMonth] || null;
          const statementRemaining = statement ? Math.max(0, Number(statement.amount) - Number(statement.paidAmount || 0)) : 0;
          const paidPercent = fullBalance ? (Number(statement?.amount) ? Number(statement?.paidAmount || 0) / Number(statement.amount) * 100 : 0) : item.type === "credit_card" ? (Number(item.creditLimit) ? Math.max(0, 100 - Number(item.outstanding) / Number(item.creditLimit) * 100) : 0) : (Number(item.originalBalance) ? Math.max(0, 100 - Number(item.outstanding) / Number(item.originalBalance) * 100) : Number(item.totalInstallments) ? Number(item.paidInstallments) / Number(item.totalInstallments) * 100 : 0);
          const utilization = Number(item.creditLimit) ? Number(item.outstanding) / Number(item.creditLimit) * 100 : 0;
          return <article className={`liability-card ${item.active === false ? "inactive" : ""}`} key={item.id}>
            <div className={`liability-icon ${item.type}`}>{type.icon}</div>
            <div className="liability-main"><div className="liability-title"><div><span>{type.label}{fullBalance ? " · จ่ายเต็มทุกเดือน" : ""}</span><h3>{item.title}</h3></div><div><strong className="amount-highlight">{money(fullBalance ? statement?.amount : item.outstanding)}</strong><span>{fullBalance ? `ยอดรอบบิล ${monthLabel(selectedMonth)}` : "ยอดคงเหลือ"}</span></div></div>
              <div className="liability-progress"><i><b style={{ width: `${Math.min(100, paidPercent)}%` }} /></i><span>{fullBalance ? !statement ? "ยังไม่ใส่ยอดรอบบิล" : statementRemaining <= 0 ? "จ่ายครบแล้ว" : `เหลือจ่าย ${money(statementRemaining)}` : item.type === "credit_card" && item.creditLimit ? `ใช้วงเงิน ${utilization.toFixed(0)}%` : `ชำระแล้ว ${Math.min(100, paidPercent).toFixed(0)}%`}</span></div>
              <div className="liability-facts">{fullBalance ? <><span>ยอดเรียกเก็บ <strong>{statement ? `${money(statement.amount)}` : "ยังไม่มี"}</strong></span><span>ครบกำหนด <strong>{statement ? shortDate(statement.dueDate) : `วันที่ ${item.dueDay}`}</strong></span></> : <><span>จ่ายเดือนละ <strong>{money(item.monthlyPayment)}</strong></span><span>ครบกำหนดวันที่ <strong>{item.dueDay}</strong></span></>}{Number(item.annualRate) > 0 && <span>ดอกเบี้ย <strong>{money(item.annualRate)}%</strong></span>}{Number(item.totalInstallments) > 0 && <span>เหลือ <strong>{Math.max(0, Number(item.totalInstallments) - Number(item.paidInstallments))} งวด</strong></span>}</div>
            </div>
            <div className={`liability-actions ${fullBalance ? "card-actions" : ""}`}>{fullBalance && <button className="secondary statement-button" onClick={() => setModal({ type: "statement", item, statement })}>{statement ? "แก้ยอดรอบบิล" : "+ ใส่ยอดรอบบิล"}</button>}<button className="primary" disabled={item.active === false || (fullBalance ? !statement || statementRemaining <= 0 : Number(item.outstanding) <= 0)} onClick={() => setModal({ type: "payment", item, statement })}>{fullBalance && statementRemaining <= 0 && statement ? "จ่ายครบแล้ว" : "บันทึกจ่าย"}</button><button className="secondary" onClick={() => setModal({ type: "liability", item })}>แก้ไข</button><button className="icon-delete" aria-label="ลบหนี้" onClick={() => deleteLiability(item)}>×</button></div>
          </article>;
        }) : <EmptyPanel title="ยังไม่มีข้อมูลหนี้ส่วนตัว" body="เพิ่มบัตรเครดิต สินเชื่อบ้าน รถ หรือหนี้อื่น เพื่อดูภาระรวมต่อเดือน" action="เพิ่มหนี้รายการแรก" onAction={() => setModal({ type: "liability" })} />}
      </section>
      {monthPayments.length > 0 && <section className="personal-card payment-history"><div className="personal-section-head"><div><p className="eyebrow">ประวัติเดือนนี้</p><h2>การชำระล่าสุด</h2></div></div>{monthPayments.map((item) => <div className="personal-entry-row" key={item.id}><span className="entry-badge debt">✓</span><div><strong>{item.liabilityTitle}</strong><small>{shortDate(item.date)}{item.statementMonth ? ` · รอบบิล ${monthLabel(item.statementMonth)}` : ` · เงินต้น ${money(item.principalAmount)}`}{Number(item.interestAmount) > 0 ? ` · ดอกเบี้ย ${money(item.interestAmount)}` : ""}</small></div><b>−{money(item.amount)}</b><button className="icon-delete" aria-label="ลบประวัติการชำระ" onClick={() => deletePayment(item)}>×</button></div>)}</section>}
    </>}

    {section === "cashflow" && <div className="cashflow-manage-grid">
      <section className="personal-card manage-card"><div className="personal-section-head"><div><p className="eyebrow">เงินเข้า</p><h2>รายรับ</h2></div><button className="secondary mini" onClick={() => setModal({ type: "income" })}>+ เพิ่ม</button></div>{incomes.length ? incomes.map((item) => <div className={`personal-entry-row ${item.active === false ? "inactive" : ""}`} key={item.id}><span className="entry-badge income">↓</span><div><strong>{item.name}</strong><small>{item.category} · {item.frequency === "monthly" ? `ทุกวันที่ ${item.dayOfMonth}` : shortDate(item.date)}</small></div><b>+{money(item.amount)}</b><button className="edit-link" onClick={() => setModal({ type: "income", item })}>แก้ไข</button><button className="icon-delete" onClick={() => deleteItem(`incomes/${item.id}`, "รายรับ")}>×</button></div>) : <EmptyPanel title="ยังไม่มีรายรับ" body="เริ่มจากเงินเดือนสุทธิที่ได้รับจริง" action="เพิ่มรายรับ" onAction={() => setModal({ type: "income" })} />}</section>
      <section className="personal-card manage-card"><div className="personal-section-head"><div><p className="eyebrow">เงินออกทั่วไป</p><h2>รายจ่าย</h2></div><button className="secondary mini" onClick={() => setModal({ type: "expense" })}>+ เพิ่ม</button></div>{expenses.length ? expenses.map((item) => <div className={`personal-entry-row ${item.active === false ? "inactive" : ""}`} key={item.id}><span className="entry-badge expense">↑</span><div><strong>{item.name}</strong><small>{item.category} · {item.frequency === "monthly" ? `ทุกวันที่ ${item.dayOfMonth}` : shortDate(item.date)}</small></div><b>−{money(item.amount)}</b><button className="edit-link" onClick={() => setModal({ type: "expense", item })}>แก้ไข</button><button className="icon-delete" onClick={() => deleteItem(`expenses/${item.id}`, "รายจ่าย")}>×</button></div>) : <EmptyPanel title="ยังไม่มีรายจ่ายทั่วไป" body="แยกรายจ่ายประจำออกจากยอดชำระหนี้เพื่อไม่ให้นับซ้ำ" action="เพิ่มรายจ่าย" onAction={() => setModal({ type: "expense" })} />}</section>
      <section className="personal-card full-width month-calendar"><div className="personal-section-head"><div><p className="eyebrow">ตามลำดับเวลา</p><h2>ปฏิทินกระแสเงินสด · {monthLabel(selectedMonth)}</h2></div></div>{schedule.length ? <div className="calendar-list">{schedule.map((item) => <div key={item.id} className={item.direction}><time>{shortDate(item.date)}</time><span>{item.name}<small>{item.type}</small></span><strong>{item.direction === "in" ? "+" : "−"}{money(item.amount)}</strong></div>)}</div> : <p className="muted center">ยังไม่มีรายการในเดือนนี้</p>}</section>
    </div>}

    {modal?.type === "income" && <Modal title={modal.item ? "แก้ไขรายรับ" : "เพิ่มรายรับ"} eyebrow="กระแสเงินสด" onClose={() => setModal(null)}><EntryForm kind="income" initial={modal.item} selectedMonth={selectedMonth} onClose={() => setModal(null)} onSave={(item) => saveEntry("income", item, modal.item)} /></Modal>}
    {modal?.type === "expense" && <Modal title={modal.item ? "แก้ไขรายจ่าย" : "เพิ่มรายจ่าย"} eyebrow="กระแสเงินสด" onClose={() => setModal(null)}><EntryForm kind="expense" initial={modal.item} selectedMonth={selectedMonth} onClose={() => setModal(null)} onSave={(item) => saveEntry("expense", item, modal.item)} /></Modal>}
    {modal?.type === "liability" && <Modal title={modal.item ? "แก้ไขข้อมูลหนี้" : "เพิ่มหนี้ของฉัน"} eyebrow="ข้อมูลส่วนตัว" wide onClose={() => setModal(null)}><LiabilityForm initial={modal.item} onClose={() => setModal(null)} onSave={(item) => saveLiability(item, modal.item)} /></Modal>}
    {modal?.type === "statement" && <Modal title={`ยอดรอบบิล ${monthLabel(selectedMonth)}`} eyebrow="บัตรเครดิต · จ่ายเต็ม" onClose={() => setModal(null)}><CardStatementForm liability={modal.item} selectedMonth={selectedMonth} initial={modal.statement} onClose={() => setModal(null)} onSave={(statement) => saveCardStatement(modal.item, statement)} /></Modal>}
    {modal?.type === "payment" && <Modal title="บันทึกการชำระ" eyebrow="อัปเดตยอดหนี้" onClose={() => setModal(null)}><PaymentForm liability={modal.item} selectedMonth={selectedMonth} statement={modal.statement} onClose={() => setModal(null)} onSave={(payment) => savePayment(modal.item, payment)} /></Modal>}
  </main>;
}

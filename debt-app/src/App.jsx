import { useEffect, useMemo, useRef, useState } from "react";
import { animate, AnimatePresence, domAnimation, LazyMotion, m, MotionConfig, useReducedMotion } from "motion/react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { limitToLast, onValue, query, ref } from "firebase/database";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, cloudFunctions, db, storage } from "./firebase";
import AuthScreen from "./AuthScreen";
import BrandMark from "./BrandMark";
import PersonalFinance from "./PersonalFinance";

const call = (name) => httpsCallable(cloudFunctions, name);
const createDebt = call("createDebt");
const acceptDebtInvite = call("acceptDebtInvite");
const getDebtInvitePreview = call("getDebtInvitePreview");
const acceptDebtAgreement = call("acceptDebtAgreement");
const declineDirectDebtInvite = call("declineDirectDebtInvite");
const submitDebtPayment = call("submitDebtPayment");
const confirmDebtPayment = call("confirmDebtPayment");
const rejectDebtPayment = call("rejectDebtPayment");
const initializePunDebts = call("initializePunDebts");
const setDebtOutstandingAmount = call("setDebtOutstandingAmount");
const requestDebtUpdate = call("requestDebtUpdate");
const requestDebtPaymentPlan = call("requestDebtPaymentPlan");
const respondDebtUpdate = call("respondDebtUpdate");
const cancelDebt = call("cancelDebt");
const archiveDebt = call("archiveDebt");
const restoreDebt = call("restoreDebt");
const revokeDebtInvite = call("revokeDebtInvite");
const renewDebtInvite = call("renewDebtInvite");
const declineDebtInvite = call("declineDebtInvite");
const openDebtDispute = call("openDebtDispute");
const resolveDebtDispute = call("resolveDebtDispute");
const reverseDebtPayment = call("reverseDebtPayment");
const refreshDebtReminders = call("refreshDebtReminders");
const markDebtNotificationRead = call("markDebtNotificationRead");
const respondDebtConsent = call("respondDebtConsent");

const DEFAULT_TERMS = {
  interestAnnualRate: "0",
  lateChargePolicy: "none",
  lateChargeDetail: "ไม่มีค่าปรับผิดนัด",
  allowPartialPayments: true,
  allowEarlyPayment: true,
  paymentAllocation: "selected_or_oldest",
  overpaymentPolicy: "reject",
  paymentReviewDays: "3",
  paymentMethod: "",
  allowDueDateChange: true,
};

function cleanTerms(terms = {}) {
  return {
    interestAnnualRate: Number(terms.interestAnnualRate || 0),
    lateChargePolicy: terms.lateChargePolicy === "custom" ? "custom" : "none",
    lateChargeDetail: terms.lateChargePolicy === "custom" ? terms.lateChargeDetail : "ไม่มีค่าปรับผิดนัด",
    allowPartialPayments: terms.allowPartialPayments !== false,
    allowEarlyPayment: terms.allowEarlyPayment !== false,
    paymentAllocation: terms.paymentAllocation || "selected_or_oldest",
    overpaymentPolicy: terms.overpaymentPolicy || "reject",
    paymentReviewDays: Number(terms.paymentReviewDays || 3),
    paymentMethod: terms.paymentMethod || "",
    allowDueDateChange: terms.allowDueDateChange !== false,
  };
}

function termsLines(terms = {}) {
  const value = { ...DEFAULT_TERMS, ...terms };
  const overpayment = { reject: "ไม่รับยอดเกิน", refund: "คืนส่วนเกิน", credit: "เก็บเป็นเครดิต" }[value.overpaymentPolicy] || "ไม่รับยอดเกิน";
  return [
    `ดอกเบี้ย ${Number(value.interestAnnualRate || 0) ? `${Number(value.interestAnnualRate).toLocaleString("th-TH")}% ต่อปี` : "ไม่มี"}`,
    value.lateChargePolicy === "custom" ? `ผิดนัด: ${value.lateChargeDetail || "ตามที่ตกลง"}` : "ไม่มีค่าปรับผิดนัด",
    value.allowPartialPayments !== false ? "ชำระบางส่วนได้" : "ต้องชำระเต็มงวด/เต็มยอด",
    value.allowEarlyPayment !== false ? "ชำระก่อนกำหนดได้" : "ไม่รับชำระก่อนกำหนด",
    `เจ้าหนี้ตรวจยอดภายใน ${Number(value.paymentReviewDays || 3)} วัน`,
    overpayment,
    value.paymentMethod ? `ช่องทางรับเงิน: ${value.paymentMethod}` : "ช่องทางรับเงินตกลงกันโดยตรง",
  ];
}

function consentLabel(item) {
  if (item.type === "debt_cancel") return `ขอยกเลิกรายการ · ${item.payload?.reason || ""}`;
  if (item.type === "payment_reverse") return `ขอย้อนรายการชำระ ฿${money(item.payload?.amount)} · ${item.payload?.reason || ""}`;
  if (item.type === "dispute_resolve") return `ขอยุติข้อโต้แย้ง · ${item.payload?.resolution || ""}`;
  if (item.type === "outstanding_confirm") return `ขอยืนยันยอดค้าง ฿${money(item.payload?.amount)}`;
  return "คำขอจากคู่สัญญา";
}

function money(value) {
  return Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function AnimatedMoney({ value, signed = false }) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(reducedMotion ? Number(value || 0) : 0);
  useEffect(() => {
    if (reducedMotion) {
      setDisplay(Number(value || 0));
      return undefined;
    }
    const controls = animate(display, Number(value || 0), { duration: 0.8, ease: [0.22, 1, 0.36, 1], onUpdate: setDisplay });
    return () => controls.stop();
  }, [value, reducedMotion]);
  const number = Number(display || 0);
  return <>{signed ? number >= 0 ? "+" : "−" : ""}฿{money(Math.abs(number))}</>;
}

function CountdownOrb({ info, direction }) {
  const days = Number(info?.days || 0);
  const progress = info ? days <= 0 ? 100 : Math.max(12, 100 - (Math.min(days, 30) / 30) * 100) : 12;
  return (
    <span className={`countdown-orb ${direction} ${info?.tone || "safe"}`} style={{ "--countdown-progress": `${progress}%` }} aria-hidden="true">
      <span>{days < 0 ? Math.abs(days) : days === 0 ? "!" : days}</span>
      <small>{days < 0 ? "เกิน" : days === 0 ? "วันนี้" : "วัน"}</small>
    </span>
  );
}

function shortDate(value) {
  if (!value) return "ไม่กำหนด";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(`${value}T12:00:00`));
}

function dateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function changeSummary(proposed = {}) {
  const labels = { title: "ชื่อรายการ", debtorName: "ชื่อลูกหนี้", amount: "ยอดตั้งต้น", outstandingAmount: "ยอดค้าง", dueDate: "วันครบกำหนด", dueDateMode: "กำหนดชำระ", note: "หมายเหตุ", terms: "เงื่อนไข" };
  return Object.entries(proposed).filter(([key, value]) => labels[key] && value !== undefined && !(key === "dueDate" && proposed.dueDateMode === "none")).map(([key, value]) => `${labels[key]}: ${["amount", "outstandingAmount"].includes(key) ? `฿${money(value)}` : key === "dueDate" ? shortDate(value) : key === "dueDateMode" ? (value === "none" ? "ไม่มีกำหนด" : shortDate(proposed.dueDate)) : key === "terms" ? termsLines(value).join(", ") : value || "—"}`).join(" · ");
}

function changeRequestSummary(item) {
  if (item.requestType !== "payment_plan") return changeSummary(item.proposed);
  const plan = item.paymentPlan || {};
  const first = `เสนอชำระ ฿${money(plan.requestedAmount)} วันที่ ${shortDate(plan.paymentDate)}`;
  const rollover = Number(plan.rolledAmount) > 0 ? `ยอดที่เหลือ ฿${money(plan.rolledAmount)} ย้ายไป ${shortDate(plan.nextDueDate)}` : "ชำระเต็มยอดงวดนี้";
  return `${first} · ${rollover}${plan.note ? ` · ${plan.note}` : ""}`;
}

function auditActionLabel(action) {
  return ({
    debt_created: "สร้างรายการ", debt_initialized: "นำเข้ารายการ", invite_accepted: "ยืนยันคำเชิญ", invite_declined: "ปฏิเสธคำเชิญ",
    invite_revoked: "ปิดลิงก์เชิญ", invite_renewed: "สร้างลิงก์ใหม่", debt_updated: "แก้ไขรายการ", debt_update_requested: "ขอแก้ไขรายการ",
    debt_update_accepted: "อนุมัติการแก้ไข", debt_update_rejected: "ปฏิเสธการแก้ไข", debt_cancelled: "ยกเลิกรายการ", debt_archived: "เก็บเข้าคลัง",
    debt_restored: "นำกลับจากคลัง", outstanding_confirmed: "ยืนยันยอดค้าง", payment_submitted: "แจ้งชำระ", payment_confirmed: "ยืนยันรับเงิน",
    payment_rejected: "ปฏิเสธการชำระ", payment_reversed: "ย้อนรายการชำระ", dispute_opened: "เปิดข้อโต้แย้ง", dispute_resolved: "ยุติข้อโต้แย้ง",
    debt_cancel_requested: "ขอยกเลิกรายการ", debt_cancel_rejected: "ไม่ยืนยันการยกเลิก",
    payment_reverse_requested: "ขอย้อนรายการชำระ", payment_reverse_rejected: "ไม่ยืนยันการย้อนชำระ",
    dispute_resolve_requested: "ขอยุติข้อโต้แย้ง", dispute_resolve_rejected: "ไม่ยืนยันการยุติข้อโต้แย้ง",
    outstanding_confirm_requested: "ขอยืนยันยอดค้าง", outstanding_confirm_rejected: "ไม่ยืนยันยอดค้าง",
    payment_plan_requested: "เสนอแผนชำระ", payment_plan_accepted: "ยืนยันแผนชำระ", payment_plan_rejected: "ปฏิเสธแผนชำระ",
    direct_invite_sent: "ส่งคำขอโดยตรง", direct_invite_accepted: "ยืนยันคำขอโดยตรง", direct_invite_declined: "ปฏิเสธคำขอโดยตรง",
  })[action] || action;
}

function errorMessage(error) {
  const message = error?.message?.replace(/^FirebaseError:\s*/, "").replace(/^functions\/[^:]+:\s*/, "");
  return message || "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
}

function inviteFromLocation() {
  return new URLSearchParams(window.location.search).get("invite") || "";
}

function initialDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

function todayDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function nextMonthDate(value) {
  const [year, month, day] = String(value || todayDate()).split("-").map(Number);
  const target = new Date(year, month, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  const targetMonth = String(target.getMonth() + 1).padStart(2, "0");
  const targetDay = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${targetMonth}-${targetDay}`;
}

function nextDayDate(value) {
  const date = new Date(`${value || todayDate()}T12:00:00`);
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function calendarDayNumber(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function dueCountdown(dueDate) {
  const dueDay = calendarDayNumber(dueDate);
  const currentDay = calendarDayNumber(todayDate());
  if (dueDay === null || currentDay === null) return null;
  const days = dueDay - currentDay;
  if (days < 0) return { days, label: `เกินกำหนด ${Math.abs(days)} วัน`, tone: "overdue" };
  if (days === 0) return { days, label: "ครบกำหนดวันนี้", tone: "today" };
  if (days <= 3) return { days, label: `เหลือ ${days} วัน`, tone: "urgent" };
  if (days <= 7) return { days, label: `เหลือ ${days} วัน`, tone: "soon" };
  return { days, label: `เหลือ ${days} วัน`, tone: "safe" };
}

function debtDueInfo(debt) {
  if (["paid", "cancelled", "declined", "invite_revoked"].includes(debt.status) || debt.outstandingStatus === "unconfirmed") return null;
  const nextInstallment = Object.values(debt.installments || {})
    .filter((item) => item.status !== "paid" && item.dueDate)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence))[0];
  const dueDate = nextInstallment?.dueDate || (debt.dueDateMode === "none" ? "" : debt.dueDate);
  const countdown = dueCountdown(dueDate);
  if (!countdown) return null;
  const installmentRemaining = nextInstallment ? Math.max(0, Number(nextInstallment.amount) - Number(nextInstallment.paidAmount || 0)) : 0;
  const dueAmount = nextInstallment ? Math.min(installmentRemaining, Number(debt.outstandingAmount) || installmentRemaining) : Number(debt.outstandingAmount) || 0;
  return { ...countdown, dueDate, dueAmount, context: nextInstallment ? `งวดที่ ${nextInstallment.sequence}` : "ยอดคงเหลือ" };
}

const PIE_COLORS = ["#087f72", "#dc5a4d", "#d69b27", "#536d9f", "#8c5aa7", "#2f91b0", "#80933a", "#c66a9b", "#64748b", "#b56b36"];

function buildPaymentSchedule(debts, direction) {
  const groups = new Map();
  const addExpectedPayment = (debt, dueDate, amount, installmentSequence = null) => {
    if (!dueCountdown(dueDate) || amount <= 0) return;
    if (!groups.has(dueDate)) groups.set(dueDate, { dueDate, amount: 0, items: [], people: new Map(), pendingCount: 0, disputedCount: 0 });
    const group = groups.get(dueDate);
    const counterpartyName = direction === "payable" ? debt.creditorName || "เจ้าหนี้" : debt.debtorName || "ลูกหนี้";
    group.amount += amount;
    group.items.push({ debtId: debt.id, counterpartyName, title: debt.title, amount, installmentSequence, status: debt.status });
    if (debt.status === "pending") group.pendingCount += 1;
    if (debt.status === "disputed") group.disputedCount += 1;
    const person = group.people.get(counterpartyName) || { name: counterpartyName, amount: 0, debtId: debt.id, count: 0 };
    person.amount += amount;
    person.count += 1;
    group.people.set(counterpartyName, person);
  };

  debts.filter((debt) => !["paid", "cancelled", "declined", "invite_revoked"].includes(debt.status) && debt.outstandingStatus !== "unconfirmed" && Number(debt.outstandingAmount) > 0).forEach((debt) => {
    const installments = Object.values(debt.installments || {}).filter((item) => item.status !== "paid" && item.dueDate).sort((a, b) => Number(a.sequence) - Number(b.sequence));
    if (installments.length) {
      let remainingDebt = Number(debt.outstandingAmount) || 0;
      installments.forEach((installment) => {
        const remainingInstallment = Math.max(0, Number(installment.amount) - Number(installment.paidAmount || 0));
        const scheduledAmount = Math.min(remainingInstallment, remainingDebt);
        addExpectedPayment(debt, installment.dueDate, scheduledAmount, installment.sequence);
        remainingDebt = Math.max(0, remainingDebt - scheduledAmount);
      });
      return;
    }
    if (debt.dueDateMode !== "none" && debt.dueDate) addExpectedPayment(debt, debt.dueDate, Number(debt.outstandingAmount) || 0);
  });

  const currentDate = todayDate();
  const rows = [...groups.values()].map((group) => ({ ...group, people: [...group.people.values()].sort((a, b) => b.amount - a.amount), countdown: dueCountdown(group.dueDate) }));
  return rows.sort((a, b) => {
    const aOverdue = a.dueDate < currentDate;
    const bOverdue = b.dueDate < currentDate;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return aOverdue ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate);
  });
}

function cashflowPieSegments(items) {
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  let cursor = 0;
  return [...items].sort((a, b) => b.amount - a.amount).map((item, index) => {
    const percent = total > 0 ? (Number(item.amount) / total) * 100 : 0;
    const segment = { ...item, color: PIE_COLORS[index % PIE_COLORS.length], percent, start: cursor, end: cursor + percent };
    cursor += percent;
    return segment;
  });
}

function CashflowScheduleSection({ direction, schedule, expanded, onToggle, onSelect }) {
  const nearest = schedule[0];
  if (!nearest) return null;
  const incoming = direction === "receivable";
  const others = schedule.slice(1);
  const headingId = `${direction}-cashflow-heading`;
  return (
    <m.section className={`cashflow-section ${direction}`} aria-labelledby={headingId} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="cashflow-heading"><div><p className="eyebrow">{incoming ? "ปฏิทินเงินเข้า" : "ปฏิทินเงินออก"}</p><h2 id={headingId}>{incoming ? "วันรับเงินที่ใกล้ที่สุด" : "วันจ่ายเงินที่ใกล้ที่สุด"}</h2></div>{others.length > 0 && <button className="secondary cashflow-other-toggle" aria-expanded={expanded} onClick={onToggle}>{expanded ? "ซ่อนวันอื่นๆ" : `ดูวันอื่นๆ (${others.length})`}</button>}</div>
      <m.button className={`cashflow-card cashflow-primary ${direction} ${nearest.countdown?.tone || "safe"}`} onClick={() => onSelect(nearest.dueDate)} whileHover={{ y: -4 }} whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 360, damping: 28 }}>
        <span className="cashflow-card-glow" aria-hidden="true" />
        <CountdownOrb info={nearest.countdown} direction={direction} />
        <div className="cashflow-date"><div><span>{nearest.countdown?.label}</span><strong>{shortDate(nearest.dueDate)}</strong></div></div>
        <div className="cashflow-total"><small>{incoming ? "ยอดตามแผนที่จะได้รับ" : "ยอดตามแผนที่ต้องจ่าย"}</small><strong><AnimatedMoney value={nearest.amount} /></strong><span>{incoming ? "จาก" : "ให้"} {nearest.people.length} คน · {nearest.items.length} รายการ</span><span className="tap-hint">แตะดูสัดส่วน <UiIcon name="chevron" /></span>{nearest.pendingCount > 0 && <em>รอยืนยัน {nearest.pendingCount} รายการ</em>}{nearest.disputedCount > 0 && <em className="disputed">มีข้อโต้แย้ง {nearest.disputedCount} รายการ</em>}</div>
      </m.button>
      <AnimatePresence initial={false}>{expanded && <m.div className="cashflow-other-list" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }}>{others.map((group, index) => <m.button key={group.dueDate} className={`${direction} ${group.countdown?.tone || "safe"}`} onClick={() => onSelect(group.dueDate)} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }} whileTap={{ scale: 0.98 }}><div><span>{group.countdown?.label}</span><strong>{shortDate(group.dueDate)}</strong><small>{group.items.length} รายการ</small></div><b>฿{money(group.amount)}</b></m.button>)}</m.div>}</AnimatePresence>
    </m.section>
  );
}

function CashflowDetailModal({ group, direction, onClose, onOpenDebt }) {
  if (!group) return null;
  const incoming = direction === "receivable";
  const segments = cashflowPieSegments(group.items);
  const gradient = `conic-gradient(${segments.map((item) => `${item.color} ${item.start}% ${item.end}%`).join(", ")})`;
  return (
    <m.div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <m.div className="modal-card cashflow-detail-modal" initial={{ opacity: 0, y: 32, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }} transition={{ type: "spring", stiffness: 300, damping: 28 }}>
        <div className="modal-header"><div><p className="eyebrow">{incoming ? "รายละเอียดเงินเข้า" : "รายละเอียดเงินออก"}</p><h2>{shortDate(group.dueDate)}</h2></div><button className="close" onClick={onClose}>×</button></div>
        <div className={`cashflow-detail-total ${direction} ${group.countdown?.tone || "safe"}`}><span>{group.countdown?.label}</span><strong>฿{money(group.amount)}</strong><small>{incoming ? "จาก" : "ให้"} {group.people.length} คน · {group.items.length} รายการ</small></div>
        <section className="cashflow-chart-section" aria-label={`กราฟสัดส่วน${incoming ? "ยอดรับ" : "ยอดจ่าย"}`}>
          <m.div className="cashflow-pie" style={{ background: gradient }} role="img" aria-label={segments.map((item) => `${item.title} ${item.percent.toFixed(1)} เปอร์เซ็นต์`).join(", ")} initial={{ opacity: 0, rotate: -70, scale: 0.72 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 180, damping: 20 }}><div><small>รวม</small><strong>{segments.length}</strong><span>รายการ</span></div></m.div>
          <div className="cashflow-chart-copy"><h3>สัดส่วนในงวดนี้</h3><p>แตะรายการเพื่อเปิดรายละเอียดหนี้</p><div className="cashflow-detail-list">{segments.map((item, index) => (
          <m.button key={`${item.debtId}_${item.installmentSequence || "single"}_${index}`} onClick={() => onOpenDebt(item.debtId)} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.14 + index * 0.045 }} whileTap={{ scale: 0.985 }}>
            <i style={{ background: item.color }} aria-hidden="true" /><div><strong>{item.title}</strong><span>{incoming ? "จาก" : "ให้"} {item.counterpartyName}{item.installmentSequence ? ` · งวดที่ ${item.installmentSequence}` : ""}</span>{item.status === "pending" && <em>รอยืนยัน</em>}{item.status === "disputed" && <em className="disputed">มีข้อโต้แย้ง</em>}</div>
            <div className="cashflow-legend-value"><b>฿{money(item.amount)}</b><span>{item.percent < 10 ? item.percent.toFixed(1) : Math.round(item.percent)}%</span></div>
          </m.button>
          ))}</div></div>
        </section>
        <div className="modal-actions"><button className="secondary" onClick={onClose}>ปิด</button></div>
      </m.div>
    </m.div>
  );
}

function statusMeta(debt) {
  if (debt.status === "paid") return { label: "เคลียร์แล้ว", className: "paid" };
  if (debt.status === "pending") return { label: "รอยืนยัน", className: "pending" };
  if (debt.status === "cancelled") return { label: "ยกเลิก", className: "cancelled" };
  if (debt.status === "declined") return { label: "ไม่ยืนยัน", className: "cancelled" };
  if (debt.status === "invite_revoked") return { label: "ปิดลิงก์แล้ว", className: "cancelled" };
  if (debt.status === "disputed") return { label: "มีข้อโต้แย้ง", className: "disputed" };
  if (debt.status === "unconfirmed" || debt.outstandingStatus === "unconfirmed") return { label: "รอตรวจยอด", className: "unconfirmed" };
  if (debtDueInfo(debt)?.days < 0) return { label: "เกินกำหนด", className: "overdue" };
  return { label: "กำลังชำระ", className: "active" };
}

function EmptyState({ tab, onCreate }) {
  return (
    <div className="empty-state">
      <div className="empty-illustration"><span>฿</span></div>
      <h3>{tab === "archived" ? "คลังรายการยังว่าง" : tab === "payable" ? "ยังไม่มีรายการที่ต้องจ่าย" : tab === "receivable" ? "ยังไม่มีรายการที่ต้องรับ" : "เริ่มบันทึกรายการแรก"}</h3>
      <p>{tab === "archived" ? "รายการที่ชำระครบ ยกเลิก หรือปฏิเสธ สามารถเก็บไว้ที่นี่ได้" : "สร้างรายการแล้วส่งลิงก์ให้อีกฝ่ายกดยืนยัน ข้อมูลจะอัปเดตให้ทั้งคู่"}</p>
      {!['payable', 'archived'].includes(tab) && <button className="primary" onClick={onCreate}>+ สร้างรายการหนี้</button>}
    </div>
  );
}

function UiIcon({ name, className = "" }) {
  const paths = {
    incoming: <><path d="M12 3v14" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></>,
    outgoing: <><path d="M12 21V7" /><path d="m7 12 5-5 5 5" /><path d="M5 3h14" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    installments: <><rect x="4" y="4" width="14" height="14" rx="2" /><path d="M8 8h6M8 12h4M8 18v2h12V8h-2" /></>,
    status: <><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5M12 17.5h.01" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    sparkle: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></>,
    wallet: <><path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h11" /><path d="M15 11h6v4h-6a2 2 0 0 1 0-4Z" /></>,
    document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <><path d="M12 5v14M5 12h14" /></>,
  };
  return <svg className={`ui-icon ${className}`} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function DebtCard({ debt, user, onOpen }) {
  const creditor = debt.creditorUid === user.uid;
  const otherName = creditor ? debt.debtorName : debt.creditorName;
  const meta = statusMeta(debt);
  const outstandingUnconfirmed = debt.outstandingStatus === "unconfirmed";
  const paid = outstandingUnconfirmed ? 0 : Math.max(0, Number(debt.amount) - Number(debt.outstandingAmount));
  const percent = debt.amount > 0 ? Math.min(100, Math.round((paid / debt.amount) * 100)) : 0;
  const plan = debt.installmentPlan;
  const dueInfo = debtDueInfo(debt);
  const scheduleText = debt.dueDateMode === "none" || !debt.dueDate ? "ไม่มีกำหนด" : shortDate(debt.dueDate);
  return (
    <m.button layout layoutId={`debt-${debt.id}`} className={`debt-card compact-debt-card ${dueInfo ? `due-${dueInfo.tone}` : ""}`} onClick={() => onOpen(debt)} aria-label={`${debt.title} ${creditor ? "รับจาก" : "จ่ายให้"} ${otherName || "รอระบุ"}`} whileHover={{ y: -3 }} whileTap={{ scale: 0.988 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
      <span className="debt-card-glow" aria-hidden="true" />
      <span className={`role-dot ${creditor ? "creditor" : "debtor"}`} aria-hidden="true"><UiIcon name={creditor ? "incoming" : "outgoing"} /></span>
      <div className="debt-main">
        <div className="debt-topline">
          <div><strong>{debt.title}</strong><span className="card-counterparty"><UiIcon name="user" />{otherName || "รอระบุ"}</span></div>
          <div className="debt-amount"><strong>{outstandingUnconfirmed ? "ยังไม่ระบุ" : `฿${money(debt.outstandingAmount)}`}</strong><span>{outstandingUnconfirmed ? `ยอดอ้างอิง ฿${money(debt.amount)}` : `จาก ฿${money(debt.amount)}`}</span></div>
        </div>
        {!outstandingUnconfirmed && <div className="progress compact-progress" aria-label={`ชำระแล้ว ${percent}%`}><m.span initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} /></div>}
        <div className="card-facts">
          <span className={`card-fact card-status ${meta.className}`}><UiIcon name={meta.className === "overdue" || meta.className === "disputed" ? "alert" : "status"} />{meta.label}</span>
          {outstandingUnconfirmed ? <span className="card-fact"><UiIcon name="alert" />ยังไม่รวมยอด</span> : dueInfo ? <>
            <span className={`card-fact card-due ${dueInfo.tone}`}><UiIcon name="calendar" /><strong>{dueInfo.label}</strong><span>· {shortDate(dueInfo.dueDate)}</span></span>
            <span className="card-fact card-due-amount"><UiIcon name={creditor ? "incoming" : "outgoing"} />{creditor ? "รับ" : "จ่าย"} ฿{money(dueInfo.dueAmount)}</span>
          </> : <span className="card-fact"><UiIcon name="calendar" />{scheduleText}</span>}
          {plan && <span className="card-fact"><UiIcon name="installments" />{plan.paidInstallments}/{plan.totalInstallments} งวด{dueInfo?.context ? ` · ${dueInfo.context}` : ""}</span>}
        </div>
      </div>
      <UiIcon name="chevron" className="card-chevron" />
    </m.button>
  );
}

function TermsEditor({ terms, onChange }) {
  const set = (key, value) => onChange({ ...terms, [key]: value });
  return (
    <details className="terms-editor wide">
      <summary><span><strong>เงื่อนไขระหว่างกัน</strong><small>ดอกเบี้ย การจ่ายบางส่วน และเวลาตรวจยอด</small></span><span>แก้ไข</span></summary>
      <div className="terms-editor-body">
        <div><label>ดอกเบี้ยต่อปี</label><div className="suffix-input"><input type="number" min="0" max="15" step="0.01" value={terms.interestAnnualRate} onChange={(event) => set("interestAnnualRate", event.target.value)} /><span>%</span></div><p className="field-help">ระบบไม่คำนวณเพิ่มอัตโนมัติ และควรตรวจข้อกฎหมายก่อนใช้ดอกเบี้ย</p></div>
        <div><label>ตรวจรายการชำระภายใน</label><div className="suffix-input"><input type="number" min="1" max="30" value={terms.paymentReviewDays} onChange={(event) => set("paymentReviewDays", event.target.value)} /><span>วัน</span></div></div>
        <div><label>ค่าปรับผิดนัด</label><select value={terms.lateChargePolicy} onChange={(event) => set("lateChargePolicy", event.target.value)}><option value="none">ไม่มีค่าปรับ</option><option value="custom">ระบุเป็นข้อความ</option></select></div>
        <div><label>ยอดชำระเกิน</label><select value={terms.overpaymentPolicy} onChange={(event) => set("overpaymentPolicy", event.target.value)}><option value="reject">ไม่รับยอดเกิน</option><option value="refund">คืนส่วนเกิน</option><option value="credit">เก็บเป็นเครดิต</option></select></div>
        {terms.lateChargePolicy === "custom" && <div className="wide"><label>รายละเอียดกรณีผิดนัด</label><input maxLength={500} value={terms.lateChargeDetail} onChange={(event) => set("lateChargeDetail", event.target.value)} placeholder="ระบุวิธีคิดและเงื่อนไขให้ชัดเจน" /></div>}
        <div className="wide"><label>ช่องทางรับเงิน <span className="optional">(ไม่บังคับ)</span></label><input maxLength={300} value={terms.paymentMethod} onChange={(event) => set("paymentMethod", event.target.value)} placeholder="เช่น โอนเข้าบัญชีที่แจ้งในแชตส่วนตัว" /></div>
        <div className="term-checks wide">
          <label><input type="checkbox" checked={terms.allowPartialPayments} onChange={(event) => set("allowPartialPayments", event.target.checked)} /><span><strong>อนุญาตให้ชำระบางส่วน</strong><small>หากปิด ต้องชำระเต็มงวดหรือเต็มยอด</small></span></label>
          <label><input type="checkbox" checked={terms.allowEarlyPayment} onChange={(event) => set("allowEarlyPayment", event.target.checked)} /><span><strong>อนุญาตให้ชำระก่อนกำหนด</strong><small>ไม่มีค่าธรรมเนียมจากระบบ</small></span></label>
          <label><input type="checkbox" checked={terms.allowDueDateChange} onChange={(event) => set("allowDueDateChange", event.target.checked)} /><span><strong>ขอเลื่อนวันชำระได้</strong><small>ต้องให้อีกฝ่ายยืนยันทุกครั้ง</small></span></label>
        </div>
      </div>
    </details>
  );
}

function CreateDebtModal({ user, knownDebtors = [], onClose, onCreated }) {
  const [form, setForm] = useState({ deliveryMode: "direct", knownDebtorUid: "", debtorEmail: "", debtType: "single", creditorLegalName: user?.displayName || user?.email?.split("@")[0] || "", debtorName: "", title: "", amount: "", dueDateMode: "date", dueDate: initialDueDate(), firstDueDate: initialDueDate(), totalInstallments: "", paidInstallments: "0", monthlyAmount: "", note: "", terms: { ...DEFAULT_TERMS } });
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function selectKnownDebtor(uid) {
    const person = knownDebtors.find((item) => item.uid === uid);
    setForm((current) => ({ ...current, knownDebtorUid: uid, debtorEmail: person?.email || "", debtorName: person?.name || current.debtorName }));
  }

  function validate(targetStep = step) {
    let message = "";
    if (targetStep === 1 && (!form.creditorLegalName.trim() || !form.debtorName.trim() || (form.deliveryMode === "direct" && !/^\S+@\S+\.\S+$/.test(form.debtorEmail)))) message = "กรอกชื่อทั้งสองฝ่ายและอีเมลบัญชีลูกหนี้ให้ครบ";
    if (targetStep === 2 && (!form.title.trim() || Number(form.amount) <= 0)) message = "กรอกชื่อรายการและยอดทั้งหมดให้ถูกต้อง";
    if (targetStep === 3 && form.debtType === "single" && form.dueDateMode === "date" && !form.dueDate) message = "เลือกวันครบกำหนด";
    if (targetStep === 3 && form.debtType === "installment" && (Number(form.totalInstallments) < 2 || Number(form.monthlyAmount) <= 0 || !form.firstDueDate)) message = "กรอกจำนวนงวด ยอดต่องวด และวันครบกำหนดให้ครบ";
    setError(message);
    return !message;
  }

  function goTo(nextStep) {
    if (nextStep > step && !validate(step)) return;
    setDirection(nextStep > step ? 1 : -1);
    setStep(nextStep);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (![1, 2, 3].every((item) => validate(item))) return;
    setBusy(true);
    setError("");
    try {
      const result = await createDebt({
        ...form,
        deliveryMode: form.deliveryMode,
        debtorEmail: form.deliveryMode === "direct" ? form.debtorEmail : "",
        amount: Number(form.amount),
        dueDate: form.debtType === "installment" ? form.firstDueDate : form.dueDateMode === "none" ? null : form.dueDate,
        noDueDate: form.debtType === "single" && form.dueDateMode === "none",
        totalInstallments: Number(form.totalInstallments),
        paidInstallments: Number(form.paidInstallments),
        monthlyAmount: Number(form.monthlyAmount),
        terms: cleanTerms(form.terms),
      });
      onCreated(result.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <m.div className="modal-backdrop wizard-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <m.form className="modal-card create-wizard" onSubmit={submit} noValidate initial={{ opacity: 0, y: 36, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }} transition={{ type: "spring", stiffness: 280, damping: 28 }}>
        <div className="modal-header wizard-header"><div><p className="eyebrow">รายการใหม่ · ขั้นตอน {step} จาก 4</p><h2>{["เลือกคู่สัญญา", "รายละเอียดหนี้", "กำหนดการและเงื่อนไข", "ตรวจสอบก่อนส่ง"][step - 1]}</h2></div><button type="button" className="close" onClick={onClose}>×</button></div>
        <ol className="wizard-progress" aria-label="ขั้นตอนการสร้างรายการ">{["คู่สัญญา", "ยอดหนี้", "กำหนดการ", "ตรวจสอบ"].map((label, index) => <li key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""}><button type="button" disabled={index + 1 > step} onClick={() => goTo(index + 1)}><span>{step > index + 1 ? <UiIcon name="check" /> : index + 1}</span><small>{label}</small></button></li>)}</ol>
        <div className="wizard-stage">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <m.div key={step} className="wizard-panel" custom={direction} initial={{ opacity: 0, x: direction * 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: direction * -24 }} transition={{ duration: 0.24 }}>
              {step === 1 && <>
                <div className="wizard-intro"><span><UiIcon name="user" /></span><div><h3>รายการนี้เกิดขึ้นระหว่างใคร?</h3><p>ข้อมูลทั้งสองฝ่ายจะปรากฏในข้อตกลงและประวัติรายการ</p></div></div>
                <fieldset className="delivery-method-field"><legend>วิธีส่งให้ลูกหนี้</legend><div className="delivery-method-toggle" role="radiogroup" aria-label="วิธีส่งให้ลูกหนี้"><button type="button" role="radio" aria-checked={form.deliveryMode === "direct"} className={form.deliveryMode === "direct" ? "active" : ""} onClick={() => set("deliveryMode", "direct")}><UiIcon name="user" /><span><strong>ส่งเข้าบัญชี</strong><small>รู้จักอีเมลของลูกหนี้</small></span></button><button type="button" role="radio" aria-checked={form.deliveryMode === "link"} className={form.deliveryMode === "link" ? "active" : ""} onClick={() => set("deliveryMode", "link")}><UiIcon name="chevron" /><span><strong>ส่งเป็นลิงก์</strong><small>ให้อีกฝ่ายเปิดและยืนยัน</small></span></button></div></fieldset>
                <div className="form-grid wizard-fields"><div><label>ชื่อเจ้าหนี้ในข้อตกลง</label><input maxLength={120} value={form.creditorLegalName} onChange={(event) => set("creditorLegalName", event.target.value)} placeholder="ชื่อ-นามสกุล" /></div><div><label>ชื่อลูกหนี้</label><input maxLength={120} value={form.debtorName} onChange={(event) => set("debtorName", event.target.value)} placeholder="ชื่อที่ต้องการแสดง" /></div>{form.deliveryMode === "direct" && <div className="wide direct-debtor-fields">{knownDebtors.length > 0 && <label><span>เลือกจากคนที่เคยทำรายการด้วย</span><select value={form.knownDebtorUid} onChange={(event) => selectKnownDebtor(event.target.value)}><option value="">เลือกจากรายชื่อเดิม</option>{knownDebtors.map((person) => <option key={person.uid} value={person.uid}>{person.name} · {person.email}</option>)}</select></label>}<label><span>{knownDebtors.length ? "หรือกรอกอีเมลบัญชี" : "อีเมลบัญชีลูกหนี้"}</span><input type="email" value={form.debtorEmail} onChange={(event) => setForm((current) => ({ ...current, knownDebtorUid: "", debtorEmail: event.target.value }))} placeholder="name@example.com" autoComplete="off" /></label><p>ค้นหาด้วยอีเมลที่ตรงกันเท่านั้น ระบบไม่เปิดเผยรายชื่อผู้ใช้อื่น</p></div>}</div>
              </>}
              {step === 2 && <>
                <div className="wizard-intro"><span><UiIcon name="wallet" /></span><div><h3>บันทึกยอดให้เข้าใจตรงกัน</h3><p>ตั้งชื่อสั้น กระชับ และเลือกว่าจะชำระครั้งเดียวหรือแบ่งงวด</p></div></div>
                <div className="debt-type-toggle"><button type="button" className={form.debtType === "single" ? "active" : ""} onClick={() => set("debtType", "single")}><strong>จ่ายครั้งเดียว</strong><span>ยอดเดียวหรือยังไม่กำหนดวัน</span></button><button type="button" className={form.debtType === "installment" ? "active" : ""} onClick={() => set("debtType", "installment")}><strong>ผ่อนรายเดือน</strong><span>แบ่งยอดเป็นหลายงวด</span></button></div>
                <div className="form-grid wizard-fields"><div className="wide"><label>ชื่อรายการ</label><input maxLength={160} value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="เช่น ค่าอาหารและค่าเดินทาง" autoFocus /></div><div className="wide amount-focus"><label>ยอดทั้งหมด</label><div className="money-input"><span>฿</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => set("amount", event.target.value)} placeholder="0.00" /></div></div></div>
              </>}
              {step === 3 && <>
                <div className="wizard-intro"><span><UiIcon name="calendar" /></span><div><h3>{form.debtType === "installment" ? "วางแผนแต่ละงวด" : "กำหนดวันที่คาดว่าจะชำระ"}</h3><p>วันที่นี้ใช้คำนวณ countdown และการแจ้งเตือน</p></div></div>
                <div className="form-grid wizard-fields">{form.debtType === "single" ? <fieldset className="due-date-field wide"><legend>กำหนดชำระ</legend><div className="due-date-toggle" role="radiogroup"><button type="button" role="radio" aria-checked={form.dueDateMode === "date"} className={form.dueDateMode === "date" ? "active" : ""} onClick={() => set("dueDateMode", "date")}><strong>ระบุวันที่</strong><span>ติดตามและแจ้งเตือนอัตโนมัติ</span></button><button type="button" role="radio" aria-checked={form.dueDateMode === "none"} className={form.dueDateMode === "none" ? "active" : ""} onClick={() => set("dueDateMode", "none")}><strong>ไม่มีกำหนด</strong><span>เสนอวันชำระภายหลังได้</span></button></div>{form.dueDateMode === "date" ? <div className="date-control"><label htmlFor="create-due-date">วันครบกำหนด</label><input id="create-due-date" type="date" value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)} /></div> : <p className="field-help">ลูกหนี้ยังเสนอวันที่และยอดที่ต้องการชำระภายหลังได้</p>}</fieldset> : <><div><label>จำนวนงวดทั้งหมด</label><input type="number" min="2" max="120" value={form.totalInstallments} onChange={(event) => set("totalInstallments", event.target.value)} placeholder="เช่น 10" /></div><div><label>ชำระแล้วกี่งวด</label><input type="number" min="0" max={Math.max(0, Number(form.totalInstallments) - 1)} value={form.paidInstallments} onChange={(event) => set("paidInstallments", event.target.value)} /></div><div><label>ยอดต่องวด</label><div className="money-input"><span>฿</span><input type="number" min="0.01" step="0.01" value={form.monthlyAmount} onChange={(event) => set("monthlyAmount", event.target.value)} placeholder={form.amount && form.totalInstallments ? money(Number(form.amount) / Number(form.totalInstallments)) : "0.00"} /></div></div><div><label>ครบกำหนดงวดถัดไป</label><input type="date" value={form.firstDueDate} onChange={(event) => set("firstDueDate", event.target.value)} /></div><button type="button" className="calculate-installment wide" onClick={() => { const count = Number(form.totalInstallments); if (count > 0 && Number(form.amount) > 0) set("monthlyAmount", String(Math.round((Number(form.amount) / count) * 100) / 100)); }}>คำนวณยอดต่องวดจากยอดรวม</button></>}
                  <TermsEditor terms={form.terms} onChange={(value) => set("terms", value)} /><div className="wide"><label>รายละเอียดเพิ่มเติม <span className="optional">(ไม่บังคับ)</span></label><textarea maxLength={1000} value={form.note} onChange={(event) => set("note", event.target.value)} placeholder="รายละเอียดหรือข้อตกลงระหว่างกัน" /></div></div>
              </>}
              {step === 4 && <div className="review-card"><div className="review-orb"><UiIcon name="document" /></div><p className="eyebrow">พร้อมส่งให้อีกฝ่ายตรวจสอบ</p><h3>{form.title}</h3><strong className="review-amount">฿{money(form.amount)}</strong><div className="review-flow"><span>{form.creditorLegalName}</span><UiIcon name="chevron" /><span>{form.debtorName}</span></div><dl><div><dt>ประเภท</dt><dd>{form.debtType === "installment" ? `ผ่อน ${form.totalInstallments} งวด · ฿${money(form.monthlyAmount)}/งวด` : "ชำระครั้งเดียว"}</dd></div><div><dt>กำหนดชำระ</dt><dd>{form.debtType === "installment" ? shortDate(form.firstDueDate) : form.dueDateMode === "none" ? "ไม่มีกำหนด" : shortDate(form.dueDate)}</dd></div><div><dt>วิธีส่ง</dt><dd>{form.deliveryMode === "direct" ? `ส่งเข้า ${form.debtorEmail}` : "สร้างลิงก์ส่วนตัว"}</dd></div><div><dt>ชำระบางส่วน</dt><dd>{form.terms.allowPartialPayments ? "ได้" : "ไม่ได้"}</dd></div></dl><p className="review-notice"><UiIcon name="status" />อีกฝ่ายต้องตรวจสอบและยืนยันก่อนรายการมีผลร่วมกัน</p></div>}
            </m.div>
          </AnimatePresence>
        </div>
        {error && <m.div className="form-message error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>{error}</m.div>}
        <div className="modal-actions wizard-actions"><button type="button" className="secondary" onClick={() => step === 1 ? onClose() : goTo(step - 1)}>{step === 1 ? "ยกเลิก" : "ย้อนกลับ"}</button>{step < 4 ? <button type="button" className="primary" onClick={() => goTo(step + 1)}>ถัดไป <UiIcon name="chevron" /></button> : <button className="primary send-agreement" disabled={busy}>{busy ? "กำลังสร้าง…" : form.deliveryMode === "direct" ? "ส่งคำขอเข้าบัญชี" : "สร้างและรับลิงก์เชิญ"}<UiIcon name="sparkle" /></button>}</div>
      </m.form>
    </m.div>
  );
}

function InviteCreatedModal({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(data.inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <m.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <m.div className="modal-card compact success-modal" initial={{ opacity: 0, y: 32, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ type: "spring", stiffness: 260, damping: 23 }}>
        <m.div className="success-orb" initial={{ rotate: -110, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: .12, type: "spring", stiffness: 250, damping: 16 }}><UiIcon name="check" /></m.div>
        <h2>{data.batch ? "นำเข้ารายการแล้ว" : "สร้างรายการแล้ว"}</h2>
        <p className="center muted">{data.batch ? "บัญชีนี้เป็นเจ้าหนี้ของรายการ Pun ทั้งหมด ส่งลิงก์เดียวนี้ให้ Pun เพื่อยืนยันพร้อมกัน" : "ส่งลิงก์นี้ให้ลูกหนี้เพื่อตรวจสอบและยืนยันรายการ"}</p>
        <div className="invite-link"><span>{data.inviteUrl}</span><button onClick={copy}>{copied ? "คัดลอกแล้ว" : "คัดลอก"}</button></div>
        <p className="security-note">ลิงก์นี้ใช้รับสิทธิ์เข้าถึงรายการ ควรส่งให้อีกฝ่ายเป็นการส่วนตัว</p>
        <button className="primary full" onClick={onClose}>เสร็จสิ้น</button>
      </m.div>
    </m.div>
  );
}

function AcceptInviteModal({ code, onClose, onAccepted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    getDebtInvitePreview({ inviteCode: code }).then((result) => active && setPreview(result.data)).catch((err) => active && setError(errorMessage(err))).finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [code]);
  async function accept() {
    if (!preview || !consent) {
      setError("กรุณาอ่านและยอมรับข้อตกลงก่อนยืนยันรายการ");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await acceptDebtInvite({ inviteCode: code, consentConfirmed: true, agreementSetDigest: preview.agreementSetDigest });
      window.history.replaceState({}, "", window.location.pathname);
      onAccepted(result.data.debtId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function decline() {
    if (!declineReason.trim()) {
      setError("กรุณาระบุเหตุผลที่ไม่ยืนยันรายการ");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await declineDebtInvite({ inviteCode: code, reason: declineReason });
      window.history.replaceState({}, "", window.location.pathname);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <m.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <m.div className="modal-card agreement-modal" initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 280, damping: 27 }}>
        <m.div className="invite-orb" initial={{ rotate: -30, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: .1, type: "spring" }}>↗</m.div>
        <p className="eyebrow center">คำเชิญรายการหนี้</p>
        <h2 className="center">ตรวจสอบก่อนยอมรับข้อตกลง</h2>
        <p className="center muted">ตรวจยอด กำหนดชำระ และเงื่อนไขทุกข้อ การยืนยันจะถูกบันทึกพร้อมบัญชี เวลา เวอร์ชัน และรหัสตรวจสอบเอกสาร</p>
        {!preview && !error && <div className="preview-loading"><div className="loader" /><span>กำลังโหลดข้อตกลงฉบับล่าสุด…</span></div>}
        {preview && <>
          <div className="agreement-preview-list">{preview.items.map((item, index) => <m.article key={item.debtId} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .05 }}>
            <div><strong>{item.title}</strong><span>{item.creditorName} → {item.debtorName}</span></div><strong className="agreement-amount">฿{money(item.outstandingStatus === "unconfirmed" ? item.amount : item.outstandingAmount)}</strong>
            <dl><div><dt>ประเภท</dt><dd>{item.debtType === "installment" ? `ผ่อน ${item.installmentPlan?.totalInstallments || "—"} งวด` : "จ่ายครั้งเดียว"}</dd></div><div><dt>กำหนดชำระ</dt><dd>{item.dueDateMode === "none" ? "ไม่มีกำหนด" : shortDate(item.dueDate)}</dd></div><div><dt>เวอร์ชัน</dt><dd>{item.version}</dd></div></dl>
            <ul>{termsLines(item.terms).map((line) => <li key={line}>{line}</li>)}</ul>
            {item.note && <p>{item.note}</p>}
          </m.article>)}</div>
          <div className="legal-evidence-note"><strong>เกี่ยวกับหลักฐานอิเล็กทรอนิกส์</strong><p>ระบบบันทึกตัวตนจากบัญชี Firebase เวลา ข้อความที่ยอมรับ และ SHA-256 digest แต่ไม่ได้รับรองตัวตนระดับบัตรประชาชนหรือรับประกันผลคดี ควรเก็บหลักฐานการโอนและดำเนินการเรื่องอากรแสตมป์เมื่อกฎหมายกำหนด</p></div>
          <label className="agreement-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><strong>ฉันอ่านและยอมรับข้อตกลงฉบับนี้</strong><small>ข้อมูลยอดหนี้ กำหนดชำระ ดอกเบี้ย ค่าปรับ และวิธีชำระข้างต้นถูกต้อง</small></span></label>
        </>}
        <AnimatePresence>{showDecline && <m.textarea initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 104 }} exit={{ opacity: 0, height: 0 }} value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} maxLength={500} placeholder="เหตุผลที่ยอดหรือรายการไม่ถูกต้อง" />}</AnimatePresence>
        {error && <div className="form-message error">{error}</div>}
        <div className="modal-actions stack-mobile">
          <button className="secondary" onClick={onClose}>ไว้ภายหลัง</button>
          <button className="danger-outline" disabled={busy} onClick={() => showDecline ? decline() : setShowDecline(true)}>{showDecline ? "ยืนยันการปฏิเสธ" : "ไม่ยืนยันรายการ"}</button>
          <button className="primary" disabled={busy || !preview || !consent} onClick={accept}>{busy ? "กำลังดำเนินการ…" : "ยอมรับและเปิดรายการ"}</button>
        </div>
      </m.div>
    </m.div>
  );
}

function EditDebtModal({ debt, onClose, onSaved }) {
  const plan = debt.installmentPlan || {};
  const [form, setForm] = useState({
    title: debt.title || "",
    debtorName: debt.debtorName || "",
    note: debt.note || "",
    amount: String(debt.amount || ""),
    outstandingAmount: debt.outstandingStatus === "unconfirmed" ? "" : String(debt.outstandingAmount ?? ""),
    dueDateMode: debt.dueDateMode === "none" || !debt.dueDate ? "none" : "date",
    dueDate: debt.dueDate || initialDueDate(),
    totalInstallments: String(plan.totalInstallments || ""),
    paidInstallments: String(plan.paidInstallments || "0"),
    monthlyAmount: String(plan.monthlyAmount || ""),
    firstDueDate: plan.firstDueDate || debt.dueDate || initialDueDate(),
    terms: { ...DEFAULT_TERMS, ...(debt.terms || {}), interestAnnualRate: String(debt.terms?.interestAnnualRate || "0"), paymentReviewDays: String(debt.terms?.paymentReviewDays || "3") },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const changes = {
        title: form.title,
        debtorName: form.debtorName,
        note: form.note,
        amount: Number(form.amount),
        terms: cleanTerms(form.terms),
        ...(debt.debtType === "installment" ? {
          totalInstallments: Number(form.totalInstallments),
          paidInstallments: Number(form.paidInstallments),
          monthlyAmount: Number(form.monthlyAmount),
          firstDueDate: form.firstDueDate,
        } : debt.outstandingStatus === "unconfirmed" ? {} : {
          outstandingAmount: Number(form.outstandingAmount),
          dueDateMode: form.dueDateMode,
          dueDate: form.dueDateMode === "none" ? null : form.dueDate,
        }),
      };
      const result = await requestDebtUpdate({ debtId: debt.id, changes });
      onSaved(result.data?.applied ? "แก้ไขรายการแล้ว" : "ส่งคำขอให้อีกฝ่ายอนุมัติแล้ว");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop nested-modal">
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-header"><div><p className="eyebrow">แก้ไขรายการ</p><h2>{debt.debtorUid ? "ส่งคำขอแก้ไข" : "แก้ไขก่อนส่งคำเชิญ"}</h2></div><button type="button" className="close" onClick={onClose}>×</button></div>
        {debt.debtorUid && <div className="approval-notice">หลังอีกฝ่ายรับรายการแล้ว การแก้ไขจะมีผลเมื่ออีกฝ่ายกดยืนยัน</div>}
        <div className="form-grid">
          <div><label>ชื่อลูกหนี้</label><input required value={form.debtorName} onChange={(event) => set("debtorName", event.target.value)} /></div>
          <div><label>ยอดตั้งต้น</label><div className="money-input"><span>฿</span><input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => set("amount", event.target.value)} /></div></div>
          <div className="wide"><label>ชื่อรายการ</label><input required value={form.title} onChange={(event) => set("title", event.target.value)} /></div>
          {debt.debtType === "installment" ? <>
            <div><label>จำนวนงวดทั้งหมด</label><input type="number" min="2" max="120" required value={form.totalInstallments} onChange={(event) => set("totalInstallments", event.target.value)} /></div>
            <div><label>ชำระแล้วกี่งวด</label><input type="number" min="0" required value={form.paidInstallments} onChange={(event) => set("paidInstallments", event.target.value)} /></div>
            <div><label>ยอดต่องวด</label><div className="money-input"><span>฿</span><input type="number" min="0.01" step="0.01" required value={form.monthlyAmount} onChange={(event) => set("monthlyAmount", event.target.value)} /></div></div>
            <div><label>ครบกำหนดงวดถัดไป</label><input type="date" required value={form.firstDueDate} onChange={(event) => set("firstDueDate", event.target.value)} /></div>
          </> : debt.outstandingStatus !== "unconfirmed" && <>
            <div><label>ยอดค้างชำระ</label><div className="money-input"><span>฿</span><input type="number" min="0" step="0.01" required value={form.outstandingAmount} onChange={(event) => set("outstandingAmount", event.target.value)} /></div></div>
            <fieldset className="due-date-field"><legend>กำหนดชำระ</legend><div className="due-date-toggle compact-toggle" role="radiogroup" aria-label="กำหนดวันชำระ"><button type="button" role="radio" aria-checked={form.dueDateMode === "date"} className={form.dueDateMode === "date" ? "active" : ""} onClick={() => set("dueDateMode", "date")}>ระบุวันที่</button><button type="button" role="radio" aria-checked={form.dueDateMode === "none"} className={form.dueDateMode === "none" ? "active" : ""} onClick={() => set("dueDateMode", "none")}>ไม่มีกำหนด</button></div>{form.dueDateMode === "date" ? <input aria-label="วันครบกำหนด" type="date" required value={form.dueDate} onChange={(event) => set("dueDate", event.target.value)} /> : <p className="field-help">ไม่มีการแจ้งเตือนวันครบกำหนด</p>}</fieldset>
          </>}
          <TermsEditor terms={form.terms} onChange={(value) => set("terms", value)} />
          <div className="wide"><label>หมายเหตุ</label><textarea maxLength={1000} value={form.note} onChange={(event) => set("note", event.target.value)} /></div>
        </div>
        {error && <div className="form-message error">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? "กำลังส่ง…" : debt.debtorUid ? "ส่งให้อีกฝ่ายอนุมัติ" : "บันทึกการแก้ไข"}</button></div>
      </form>
    </div>
  );
}

function ProofLink({ proof }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!proof?.path) return undefined;
    let active = true;
    getDownloadURL(storageRef(storage, proof.path)).then((value) => active && setUrl(value)).catch(() => {});
    return () => { active = false; };
  }, [proof?.path]);
  if (!proof?.path) return null;
  return url ? <a className="proof-link" href={url} target="_blank" rel="noreferrer">ดูหลักฐานการชำระ</a> : <span className="proof-link muted">กำลังเปิดหลักฐาน…</span>;
}

function NotificationsPanel({ notifications, onClose, onOpen }) {
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  return (
    <>
      <m.button type="button" className="notification-scrim" aria-label="ปิดการแจ้งเตือน" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <m.div className="notification-panel" role="dialog" aria-label="การแจ้งเตือน" initial={{ opacity: 0, y: -12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ type: "spring", stiffness: 350, damping: 30 }}>
        <div className="notification-header"><div><strong>การแจ้งเตือน</strong>{unreadCount > 0 && <span>{unreadCount} ใหม่</span>}</div><button type="button" aria-label="ปิด" onClick={onClose}>×</button></div>
        <div className="notification-list">{notifications.length ? notifications.slice(0, 30).map((item) => (
          <m.button className={item.readAt ? "" : "unread"} key={item.id} onClick={() => onOpen(item)} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} whileTap={{ scale: 0.99 }}>
            <span className="notification-icon" aria-hidden="true"><UiIcon name="bell" /></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{dateTime(item.createdAt)}</small></div><UiIcon name="chevron" className="notification-chevron" />
          </m.button>
        )) : <p className="notification-empty">ยังไม่มีการแจ้งเตือน</p>}</div>
      </m.div>
    </>
  );
}

function DebtDetailModal({ debt, user, onClose, onToast, onArchived, archived, onRestored }) {
  const [payments, setPayments] = useState([]);
  const [changeRequests, setChangeRequests] = useState([]);
  const [consentRequests, setConsentRequests] = useState([]);
  const [agreementVersions, setAgreementVersions] = useState([]);
  const [closure, setClosure] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayDate());
  const [installmentId, setInstallmentId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [showPaymentPlan, setShowPaymentPlan] = useState(false);
  const [planAmount, setPlanAmount] = useState("");
  const [planPaymentDate, setPlanPaymentDate] = useState(initialDueDate());
  const [planNextDueDate, setPlanNextDueDate] = useState(nextMonthDate(initialDueDate()));
  const [planNote, setPlanNote] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [confirmedOutstanding, setConfirmedOutstanding] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [agreementConsent, setAgreementConsent] = useState(false);
  const [detailTab, setDetailTab] = useState(debt.inviteDelivery === "direct" && debt.directInviteStatus === "pending" && debt.creditorUid !== user.uid ? "agreement" : "overview");
  const [celebration, setCelebration] = useState("");
  const creditor = debt.creditorUid === user.uid;
  const meta = statusMeta(debt);
  const installments = Object.values(debt.installments || {}).sort((a, b) => Number(a.sequence) - Number(b.sequence));
  const dueInfo = debtDueInfo(debt);
  const dueObligation = dueInfo ? (creditor ? `คุณต้องได้รับ ฿${money(dueInfo.dueAmount)} จาก ${debt.debtorName || "ลูกหนี้"}` : `คุณต้องชำระ ฿${money(dueInfo.dueAmount)} ให้ ${debt.creditorName || "เจ้าหนี้"}`) : "";
  const lineItems = Array.isArray(debt.lineItems) ? debt.lineItems : Object.values(debt.lineItems || {});
  const outstandingUnconfirmed = debt.outstandingStatus === "unconfirmed";
  const currentDueAmount = Math.min(Number(debt.outstandingAmount) || 0, Number(dueInfo?.dueAmount) || Number(debt.outstandingAmount) || 0);
  const proposedRollover = Math.max(0, Math.round((currentDueAmount - Number(planAmount || 0)) * 100) / 100);
  const openDispute = disputes.find((item) => item.status === "open");
  const latestAgreement = agreementVersions[0] || null;
  const currentUserAcceptedAgreement = Boolean(latestAgreement?.acceptances?.[user.uid]);

  useEffect(() => onValue(ref(db, `debtPayments/${debt.id}`), (snapshot) => {
    const rows = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value }));
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    setPayments(rows);
  }), [debt.id]);

  useEffect(() => {
    const listeners = [
      onValue(ref(db, `debtChangeRequests/${debt.id}`), (snapshot) => {
        const rows = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setChangeRequests(rows);
      }),
      onValue(ref(db, `debtConsentRequests/${debt.id}`), (snapshot) => {
        const rows = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setConsentRequests(rows);
      }),
      onValue(ref(db, `debtAgreementVersions/${debt.id}`), (snapshot) => {
        const rows = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => Number(b.version) - Number(a.version));
        setAgreementVersions(rows);
      }),
      onValue(ref(db, `debtClosures/${debt.id}`), (snapshot) => setClosure(snapshot.val() || null)),
      onValue(ref(db, `debtDisputes/${debt.id}`), (snapshot) => {
        const rows = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        setDisputes(rows);
      }),
      onValue(query(ref(db, `debtAuditLogs/${debt.id}`), limitToLast(30)), (snapshot) => {
        const rows = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30);
        setAuditLogs(rows);
      }),
    ];
    return () => listeners.forEach((unsubscribe) => unsubscribe());
  }, [debt.id]);

  async function sendPayment(event) {
    event.preventDefault();
    setBusyId("new");
    setError("");
    try {
      let proof = null;
      if (proofFile) {
        if (!/^image\/(jpeg|png|webp)$/.test(proofFile.type) || proofFile.size > 5 * 1024 * 1024) throw new Error("รองรับรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5MB");
        const safeName = proofFile.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
        const path = `debtReceipts/${debt.id}/${debt.creditorUid}/${debt.debtorUid}/${user.uid}/${crypto.randomUUID()}_${safeName}`;
        await uploadBytes(storageRef(storage, path), proofFile, { contentType: proofFile.type });
        proof = { path, contentType: proofFile.type, size: proofFile.size, name: proofFile.name };
      }
      await submitDebtPayment({ debtId: debt.id, amount: Number(amount), note, paymentDate, installmentId, proof });
      setAmount("");
      setNote("");
      setInstallmentId("");
      setProofFile(null);
      setCelebration("ส่งรายการชำระแล้ว");
      window.setTimeout(() => setCelebration(""), 1700);
      onToast("ส่งรายการชำระให้เจ้าหนี้ตรวจสอบแล้ว");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  async function decide(paymentId, accepted) {
    setBusyId(paymentId);
    setError("");
    try {
      if (accepted) await confirmDebtPayment({ debtId: debt.id, paymentId });
      else await rejectDebtPayment({ debtId: debt.id, paymentId });
      if (accepted) {
        setCelebration("ยืนยันรับเงินแล้ว");
        window.setTimeout(() => setCelebration(""), 1700);
      }
      onToast(accepted ? "ยืนยันรับเงินและอัปเดตยอดแล้ว" : "ปฏิเสธรายการชำระแล้ว");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  function openPaymentPlan() {
    const proposedDate = dueInfo?.dueDate && dueInfo.dueDate >= todayDate() ? dueInfo.dueDate : initialDueDate();
    setPlanAmount("");
    setPlanPaymentDate(proposedDate);
    setPlanNextDueDate(nextMonthDate(proposedDate));
    setPlanNote("");
    setShowPaymentPlan(true);
  }

  async function sendPaymentPlan(event) {
    event.preventDefault();
    setBusyId("payment-plan");
    setError("");
    try {
      await requestDebtPaymentPlan({
        debtId: debt.id,
        amount: Number(planAmount),
        paymentDate: planPaymentDate,
        nextDueDate: proposedRollover > 0 ? planNextDueDate : null,
        note: planNote,
      });
      setShowPaymentPlan(false);
      onToast("ส่งข้อเสนอแผนชำระให้เจ้าหนี้แล้ว");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  async function shareInvite() {
    const url = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(debt.inviteCode)}`;
    await navigator.clipboard.writeText(url);
    onToast("คัดลอกลิงก์เชิญแล้ว");
  }

  async function confirmOutstanding(event) {
    event.preventDefault();
    setBusyId("outstanding");
    setError("");
    try {
      const result = await setDebtOutstandingAmount({ debtId: debt.id, amount: Number(confirmedOutstanding) });
      setConfirmedOutstanding("");
      onToast(result.data?.pendingApproval ? "ส่งยอดค้างให้อีกฝ่ายยืนยันแล้ว" : "ยืนยันยอดค้างแล้ว");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  async function respondChange(requestId, accepted) {
    setBusyId(requestId);
    setError("");
    try {
      await respondDebtUpdate({ debtId: debt.id, requestId, accepted });
      onToast(accepted ? "อนุมัติการแก้ไขแล้ว" : "ปฏิเสธการแก้ไขแล้ว");
    } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function respondConsent(requestId, accepted) {
    setBusyId(requestId);
    setError("");
    try {
      await respondDebtConsent({ debtId: debt.id, requestId, accepted });
      onToast(accepted ? "ยืนยันคำขอและบันทึกความยินยอมแล้ว" : "ปฏิเสธคำขอแล้ว");
    } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doCancel() {
    const reason = window.prompt("ระบุเหตุผลในการยกเลิกรายการ");
    if (!reason) return;
    setBusyId("cancel");
    try { const result = await cancelDebt({ debtId: debt.id, reason }); onToast(result.data?.pendingApproval ? "ส่งคำขอยกเลิกให้อีกฝ่ายยืนยันแล้ว" : "ยกเลิกรายการแล้ว"); } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doArchive() {
    setBusyId("archive");
    try { await archiveDebt({ debtId: debt.id }); onArchived(debt.id); onToast("เก็บรายการเข้าคลังแล้ว"); } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doRestore() {
    setBusyId("archive");
    try { await restoreDebt({ debtId: debt.id }); onRestored(debt.id); onToast("นำรายการกลับจากคลังแล้ว"); } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doRevokeInvite() {
    if (!window.confirm("ปิดลิงก์เชิญนี้หรือไม่? หากเป็นลิงก์ชุดจะปิดทั้งชุด")) return;
    setBusyId("invite");
    try { await revokeDebtInvite({ debtId: debt.id }); onToast("ปิดลิงก์เชิญแล้ว"); } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doRenewInvite() {
    setBusyId("invite");
    try {
      const result = await renewDebtInvite({ debtId: debt.id });
      const url = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(result.data.inviteCode)}`;
      await navigator.clipboard.writeText(url);
      onToast("สร้างและคัดลอกลิงก์ใหม่แล้ว");
    } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doDispute() {
    const reason = window.prompt("ระบุเหตุผลหรือยอดที่ไม่ตรงกัน");
    if (!reason) return;
    setBusyId("dispute");
    try { await openDebtDispute({ debtId: debt.id, reason }); onToast("เปิดข้อโต้แย้งแล้ว ระบบหยุดรับการชำระรายการนี้ชั่วคราว"); } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doResolveDispute() {
    if (!openDispute) return;
    const resolution = window.prompt("สรุปข้อตกลงหรือเหตุผลที่ยุติข้อโต้แย้ง");
    if (!resolution) return;
    setBusyId("dispute");
    try { await resolveDebtDispute({ debtId: debt.id, disputeId: openDispute.id, resolution }); onToast("ส่งข้อตกลงยุติข้อโต้แย้งให้อีกฝ่ายยืนยันแล้ว"); } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function doReversePayment(paymentId) {
    const reason = window.prompt("ระบุเหตุผลในการย้อนรายการชำระ");
    if (!reason) return;
    setBusyId(paymentId);
    try { await reverseDebtPayment({ debtId: debt.id, paymentId, reason }); onToast("ส่งคำขอย้อนรายการให้อีกฝ่ายยืนยันแล้ว"); } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  function downloadAgreement() {
    const payload = {
      exportedAt: new Date().toISOString(),
      notice: "ข้อมูลส่งออกจากเคลียร์กัน เป็นบันทึกอิเล็กทรอนิกส์ ไม่ใช่คำรับรองผลทางกฎหมาย",
      debt,
      agreementVersions,
      payments,
      changeRequests,
      consentRequests,
      disputes,
      closure,
      auditLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clear-kan-${debt.id}-agreement.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function acceptCurrentAgreement() {
    if (!agreementConsent) return;
    setBusyId("agreement");
    setError("");
    try {
      const result = await acceptDebtAgreement({ debtId: debt.id, consentConfirmed: true, expectedUpdatedAt: debt.updatedAt || "" });
      setAgreementConsent(false);
      setCelebration("ยืนยันข้อตกลงแล้ว");
      window.setTimeout(() => setCelebration(""), 1700);
      onToast(result.data?.directInviteAccepted ? "ยอมรับและเปิดรายการแล้ว" : "บันทึกการยอมรับข้อตกลงแล้ว");
    } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  async function declineDirectInvite() {
    const reason = window.prompt("ระบุเหตุผลที่ไม่ยืนยันรายการ");
    if (!reason) return;
    setBusyId("direct-invite");
    setError("");
    try {
      await declineDirectDebtInvite({ debtId: debt.id, reason });
      onToast("ปฏิเสธรายการแล้ว");
    } catch (err) { setError(errorMessage(err)); } finally { setBusyId(""); }
  }

  return (
    <m.div className="modal-backdrop detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <m.div layoutId={`debt-${debt.id}`} className="modal-card detail-card" data-active-tab={detailTab} initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.98 }} transition={{ type: "spring", stiffness: 280, damping: 28 }}>
        <div className="modal-header"><div><span className={`status ${meta.className}`}>{meta.label}</span><h2>{debt.title}</h2></div><div className="header-actions">{!["paid", "cancelled", "declined", "disputed"].includes(debt.status) && (debt.status !== "pending" || creditor) && <button className="secondary mini" onClick={() => setShowEdit(true)}>แก้ไข</button>}<button className="close" onClick={onClose}>×</button></div></div>
        <nav className="detail-tabs" aria-label="รายละเอียดรายการ">{[["overview", "ภาพรวม", "wallet"], ["schedule", "กำหนดการ", "calendar"], ["payments", "ชำระเงิน", "incoming"], ["agreement", "ข้อตกลง", "document"]].map(([value, label, icon]) => { const needsAttention = value === "agreement" ? !currentUserAcceptedAgreement || changeRequests.some((item) => item.status === "pending" && item.approverUid === user.uid) || consentRequests.some((item) => item.status === "pending" && item.approverUid === user.uid) : value === "payments" && creditor && payments.some((item) => item.status === "pending"); return <button key={value} className={detailTab === value ? "active" : ""} aria-current={detailTab === value ? "page" : undefined} onClick={() => setDetailTab(value)}><UiIcon name={icon} /><span>{label}</span>{needsAttention && <i aria-label="มีรายการรอดำเนินการ" />}</button>; })}</nav>
        <AnimatePresence>{celebration && <m.div className="celebration-burst" role="status" initial={{ opacity: 0, scale: 0.65, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.86, y: -10 }}><span><UiIcon name="check" /></span><strong>{celebration}</strong><i /><i /><i /></m.div>}</AnimatePresence>
        {debt.inviteDelivery === "direct" && debt.directInviteStatus === "pending" && debt.status === "pending" && !creditor && <div className="direct-invite-banner"><span><UiIcon name="bell" /></span><div><strong>เจ้าหนี้ส่งรายการนี้ให้คุณโดยตรง</strong><p>ตรวจสอบยอด วันชำระ และเงื่อนไขด้านล่าง ก่อนยืนยันเปิดรายการ</p></div><button className="danger-outline" disabled={busyId === "direct-invite"} onClick={declineDirectInvite}>ไม่ยืนยัน</button></div>}
        <div className="detail-hero">
          <div><span>ยอดค้างชำระ</span><strong>{outstandingUnconfirmed ? "ยังไม่ระบุ" : `฿${money(debt.outstandingAmount)}`}</strong></div>
          <dl><div><dt>{outstandingUnconfirmed ? "ยอดอ้างอิง" : "ยอดตั้งต้น"}</dt><dd>฿{money(debt.amount)}</dd></div><div><dt>กำหนดชำระ</dt><dd>{debt.dueDateMode === "none" || !debt.dueDate ? "ไม่มีกำหนด" : shortDate(debt.dueDate)}</dd></div></dl>
        </div>
        {dueInfo && <div className={`detail-due-alert ${dueInfo.tone}`} role="status"><span className="due-alert-number">{dueInfo.days < 0 ? Math.abs(dueInfo.days) : dueInfo.days === 0 ? "!" : dueInfo.days}</span><div><strong>{dueInfo.label}</strong><b>{dueObligation}</b><small>{dueInfo.context} ครบกำหนด {shortDate(dueInfo.dueDate)}</small></div></div>}
        <div className="people-row"><div><small>เจ้าหนี้</small><strong>{debt.creditorName}</strong></div><span>→</span><div><small>ลูกหนี้</small><strong>{debt.debtorName}</strong></div></div>
        {debt.note && <div className="note-box">{debt.note}</div>}
        <section className="terms-summary">
          <div className="section-title-row"><div><h3>เงื่อนไขที่ตกลงร่วมกัน</h3><small>เวอร์ชัน {debt.agreementVersion || 1} · {debt.agreementStatus === "accepted" ? "ทั้งสองฝ่ายยืนยันแล้ว" : debt.debtorUid ? "รอการยืนยันให้ครบทั้งสองฝ่าย" : "รอลูกหนี้ยืนยัน"}</small></div><span className={`status ${debt.agreementStatus === "accepted" ? "paid" : "pending"}`}>{debt.agreementStatus === "accepted" ? "ยืนยันครบ" : "รอยืนยัน"}</span></div>
          <ul>{termsLines(debt.terms).map((line) => <li key={line}>{line}</li>)}</ul>
          {debt.agreementDigest && <code title={debt.agreementDigest}>SHA-256 {debt.agreementDigest.slice(0, 12)}…</code>}
          {debt.debtorUid && !currentUserAcceptedAgreement && <div className="inline-agreement-consent"><label><input type="checkbox" checked={agreementConsent} onChange={(event) => setAgreementConsent(event.target.checked)} /><span>ฉันอ่านและยอมรับข้อตกลงเวอร์ชันนี้</span></label><button className="primary" disabled={!agreementConsent || busyId === "agreement"} onClick={acceptCurrentAgreement}>{busyId === "agreement" ? "กำลังบันทึก…" : debt.inviteDelivery === "direct" && debt.directInviteStatus === "pending" && !creditor ? "ยอมรับและเปิดรายการ" : "บันทึกการยอมรับ"}</button></div>}
        </section>
        {closure && <m.div className="closure-banner" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}><div><strong>ปิดบัญชีหนี้แล้ว</strong><span>ยอดคงเหลือเป็นศูนย์เมื่อ {dateTime(closure.closedAt)}</span></div><code>{String(closure.digest || "").slice(0, 12)}…</code></m.div>}
        {debt.status === "pending" && creditor && debt.inviteDelivery !== "direct" && <div className="invite-actions"><button className="secondary" onClick={shareInvite}>คัดลอกลิงก์เชิญอีกครั้ง</button><button className="danger-outline" disabled={busyId === "invite"} onClick={doRevokeInvite}>ปิดลิงก์</button></div>}
        {debt.status === "invite_revoked" && creditor && <button className="secondary full" disabled={busyId === "invite"} onClick={doRenewInvite}>สร้างลิงก์เชิญใหม่</button>}

        {openDispute && <div className="dispute-banner"><div><strong>รายการนี้มีข้อโต้แย้ง</strong><span>{openDispute.openedByName}: {openDispute.reason}</span></div><button disabled={busyId === "dispute"} onClick={doResolveDispute}>ยุติข้อโต้แย้ง</button></div>}

        {outstandingUnconfirmed && creditor && (
          <form className="outstanding-form" onSubmit={confirmOutstanding}>
            <div><h3>กำหนดยอดค้างภายหลัง</h3><p>ยอดนี้ยังไม่ถูกนำไปรวมในภาพรวม เมื่อทราบยอดจริงแล้วจึงค่อยยืนยัน</p></div>
            <div className="outstanding-fields"><div className="money-input"><span>฿</span><input type="number" min="0" max="100000000" step="0.01" required value={confirmedOutstanding} onChange={(event) => setConfirmedOutstanding(event.target.value)} placeholder="ยอดค้างจริง" /></div><button className="primary" disabled={busyId === "outstanding"}>{busyId === "outstanding" ? "กำลังยืนยัน…" : "ยืนยันยอดค้าง"}</button></div>
          </form>
        )}

        {installments.length > 0 && (
          <section className="installment-section">
            <div className="section-title-row"><h3>แผนผ่อนรายเดือน</h3><span>{debt.installmentPlan?.paidInstallments || 0}/{debt.installmentPlan?.totalInstallments || installments.length} งวด</span></div>
            <div className="installment-list">
              {installments.map((installment) => {
                const remaining = Math.max(0, Number(installment.amount) - Number(installment.paidAmount || 0));
                const installmentDue = installment.status === "paid" ? null : dueCountdown(installment.dueDate);
                const installmentObligation = creditor ? `รับ ฿${money(remaining)} จาก ${debt.debtorName || "ลูกหนี้"}` : `ชำระ ฿${money(remaining)} ให้ ${debt.creditorName || "เจ้าหนี้"}`;
                return <div className={`installment-row ${installment.status} ${installmentDue ? `due-${installmentDue.tone}` : ""}`} key={installment.sequence}><span className="installment-number">{installment.status === "paid" ? "✓" : installment.sequence}</span><div><strong>งวดที่ {installment.sequence}</strong><small>ครบกำหนด {shortDate(installment.dueDate)}</small>{installmentDue && <><b className="installment-obligation">{installmentObligation}</b><b className={`installment-countdown ${installmentDue.tone}`}>{installmentDue.label}</b></>}</div><div className="installment-value"><strong>฿{money(installment.amount)}</strong>{installment.status === "partial" && <small>เหลือ ฿{money(remaining)}</small>}</div><span className={`status ${installment.status === "paid" ? "paid" : installment.status === "partial" ? "pending" : "active"}`}>{installment.status === "paid" ? "ชำระแล้ว" : installment.status === "partial" ? "บางส่วน" : "รอชำระ"}</span></div>;
              })}
            </div>
          </section>
        )}

        {lineItems.length > 0 && (
          <section className="line-items-section">
            <div className="section-title-row"><h3>รายละเอียดรายการ</h3><span>{lineItems.length} รายการ</span></div>
            <div className="line-items-list">{lineItems.map((item, index) => <div key={`${item.title}_${index}`}><span>{item.title}</span><strong>฿{money(item.amount)}</strong></div>)}</div>
          </section>
        )}

        {changeRequests.length > 0 && (
          <section className="change-section">
            <div className="section-title-row"><h3>คำขอแก้ไข</h3><span>{changeRequests.filter((item) => item.status === "pending").length} รายการรอดำเนินการ</span></div>
            <div className="change-list">{changeRequests.slice(0, 5).map((item) => (
              <div className="change-row" key={item.id}>
                <div><strong>{item.requestType === "payment_plan" ? `${item.requestedByName} เสนอแผนชำระ` : `${item.requestedByName} ขอแก้ไขรายการ`}</strong><p>{changeRequestSummary(item)}</p><small>{dateTime(item.createdAt)} · {item.status === "pending" ? "รออนุมัติ" : item.status === "accepted" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว"}</small></div>
                {item.status === "pending" && item.approverUid === user.uid && <div className="change-actions"><button disabled={busyId === item.id} onClick={() => respondChange(item.id, false)}>ปฏิเสธ</button><button disabled={busyId === item.id} onClick={() => respondChange(item.id, true)}>อนุมัติ</button></div>}
              </div>
            ))}</div>
          </section>
        )}

        {consentRequests.length > 0 && (
          <section className="change-section consent-section">
            <div className="section-title-row"><h3>คำขอที่ต้องยืนยันร่วมกัน</h3><span>{consentRequests.filter((item) => item.status === "pending").length} รายการรอดำเนินการ</span></div>
            <div className="change-list">{consentRequests.slice(0, 8).map((item) => (
              <div className="change-row" key={item.id}>
                <div><strong>{item.requestedByName}</strong><p>{consentLabel(item)}</p><small>{dateTime(item.createdAt)} · {item.status === "pending" ? `รออีกฝ่ายยืนยัน · หมดอายุ ${shortDate(String(item.expiresAt || "").slice(0, 10))}` : item.status === "accepted" ? "ยืนยันร่วมกันแล้ว" : item.status === "rejected" ? "ไม่ได้รับการยืนยัน" : "คำขอสิ้นสุดแล้ว"}</small></div>
                {item.status === "pending" && item.approverUid === user.uid && <div className="change-actions"><button disabled={busyId === item.id} onClick={() => respondConsent(item.id, false)}>ปฏิเสธ</button><button disabled={busyId === item.id} onClick={() => respondConsent(item.id, true)}>ยืนยัน</button></div>}
              </div>
            ))}</div>
          </section>
        )}

        {!creditor && debt.status === "active" && Number(debt.outstandingAmount) > 0 && (
          <section className="payment-plan-card">
            {!showPaymentPlan ? <div className="payment-plan-intro"><span className="payment-plan-icon"><UiIcon name="calendar" /></span><div><h3>{debt.dueDateMode === "none" || !debt.dueDate ? "กำหนดแผนชำระ" : "ต้องการแบ่งจ่ายงวดนี้?"}</h3><p>เลือกยอดและวันที่ที่ต้องการ เสนอให้เจ้าหนี้อนุมัติก่อนเปลี่ยนกำหนดเดิม</p></div><button type="button" className="secondary" onClick={openPaymentPlan}>เสนอแผน</button></div> :
            <form className="payment-plan-form" onSubmit={sendPaymentPlan}>
              <div className="section-title-row"><div><h3>เสนอแผนชำระ</h3><small>ยอดงวดปัจจุบัน ฿{money(currentDueAmount)}</small></div><button type="button" className="close-plan" aria-label="ปิด" onClick={() => setShowPaymentPlan(false)}>×</button></div>
              <div className="payment-plan-fields">
                <label><span>ยอดที่จะชำระ</span><div className="money-input"><span>฿</span><input type="number" min="0.01" max={currentDueAmount} step="0.01" required value={planAmount} onChange={(event) => setPlanAmount(event.target.value)} placeholder="เช่น 1,000" /></div></label>
                <label><span>วันที่จะชำระ</span><input type="date" min={todayDate()} required value={planPaymentDate} onChange={(event) => { setPlanPaymentDate(event.target.value); if (planNextDueDate <= event.target.value) setPlanNextDueDate(nextMonthDate(event.target.value)); }} /></label>
                {proposedRollover > 0 && <label><span>กำหนดยอดที่เหลือ</span><input type="date" min={nextDayDate(planPaymentDate)} required value={planNextDueDate} onChange={(event) => setPlanNextDueDate(event.target.value)} /></label>}
                <label className="plan-note"><span>เหตุผลหรือหมายเหตุ <em>(ไม่บังคับ)</em></span><input maxLength={500} value={planNote} onChange={(event) => setPlanNote(event.target.value)} placeholder="เช่น ขอแบ่งจ่ายในเดือนนี้" /></label>
              </div>
              <AnimatePresence>{Number(planAmount) > 0 && <m.div className="payment-plan-preview" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}><m.div initial={{ x: 18 }} animate={{ x: 0 }}><UiIcon name="calendar" /><span>{shortDate(planPaymentDate)}</span><strong>฿{money(planAmount)}</strong></m.div>{proposedRollover > 0 && <m.div initial={{ x: -18 }} animate={{ x: 0 }}><UiIcon name="installments" /><span>{shortDate(planNextDueDate)}</span><strong>฿{money(proposedRollover)}</strong></m.div>}</m.div>}</AnimatePresence>
              <p className="payment-plan-help">นี่เป็นข้อเสนอ ยังไม่ถือว่าชำระเงิน และกำหนดใหม่จะมีผลเมื่อเจ้าหนี้อนุมัติ</p>
              <div className="payment-plan-actions"><button type="button" className="secondary" onClick={() => setShowPaymentPlan(false)}>ยกเลิก</button><button className="primary" disabled={busyId === "payment-plan"}>{busyId === "payment-plan" ? "กำลังส่ง…" : "ส่งข้อเสนอให้เจ้าหนี้"}</button></div>
            </form>}
          </section>
        )}

        {!creditor && debt.status === "active" && Number(debt.outstandingAmount) > 0 && (
          <form className="payment-form" onSubmit={sendPayment}>
            <h3>แจ้งเงินที่โอนแล้ว</h3>
            <div className="payment-fields extended">
              <div className="money-input"><span>฿</span><input type="number" min="0.01" max={(debt.terms?.overpaymentPolicy || "reject") === "reject" ? debt.outstandingAmount : undefined} step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={debt.installmentPlan ? money(Math.min(Number(debt.installmentPlan.monthlyAmount), Number(debt.outstandingAmount))) : "จำนวนเงิน"} /></div>
              <input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              {installments.length > 0 && <select value={installmentId} onChange={(event) => setInstallmentId(event.target.value)}><option value="">ตัดงวดเก่าสุดอัตโนมัติ</option>{Object.entries(debt.installments || {}).filter(([, item]) => item.status !== "paid").sort(([, a], [, b]) => Number(a.sequence) - Number(b.sequence)).map(([id, item]) => <option value={id} key={id}>งวดที่ {item.sequence} · เหลือ ฿{money(Number(item.amount) - Number(item.paidAmount || 0))}</option>)}</select>}
              <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="หมายเหตุ (ถ้ามี)" />
              <label className="proof-input"><span>{proofFile ? proofFile.name : "แนบสลิป (ไม่บังคับ)"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProofFile(event.target.files?.[0] || null)} /></label>
              <button className="primary" disabled={busyId === "new"}>{busyId === "new" ? "กำลังอัปโหลดและส่ง…" : "ส่งให้ตรวจสอบ"}</button>
            </div>
          </form>
        )}

        <section className="timeline-section">
          <h3>ประวัติการชำระ</h3>
          {payments.length === 0 ? <p className="muted no-payments">ยังไม่มีรายการชำระ</p> : payments.map((payment) => (
            <div className="payment-row" key={payment.id}>
              <div className={`payment-state ${payment.status}`}>{payment.status === "confirmed" ? "✓" : ["rejected", "reversed"].includes(payment.status) ? "×" : "…"}</div>
              <div className="payment-copy"><strong>฿{money(payment.amount)}</strong><span>{payment.note || "แจ้งชำระเงิน"} · ชำระ {shortDate(payment.paymentDate)} · {dateTime(payment.createdAt)}{payment.status === "pending" && payment.reviewDueAt ? ` · ควรตรวจภายใน ${dateTime(payment.reviewDueAt)}` : ""}{Number(payment.excessAmount) > 0 ? ` · ส่วนเกิน ฿${money(payment.excessAmount)} (${payment.excessDisposition === "refund" ? "รอคืน" : "เครดิต"})` : ""}</span><ProofLink proof={payment.proof} /></div>
              <span className={`status ${payment.status === "confirmed" ? "paid" : ["rejected", "reversed"].includes(payment.status) ? "cancelled" : "pending"}`}>{payment.status === "confirmed" ? "ยืนยันแล้ว" : payment.status === "rejected" ? "ไม่ผ่าน" : payment.status === "reversed" ? "ย้อนแล้ว" : "รอตรวจสอบ"}</span>
              {creditor && payment.status === "pending" && <div className="payment-actions"><button disabled={busyId === payment.id} onClick={() => decide(payment.id, false)}>ปฏิเสธ</button><button disabled={busyId === payment.id} onClick={() => decide(payment.id, true)}>ยืนยัน</button></div>}
              {payment.status === "confirmed" && <div className="payment-actions"><button className="danger-text" disabled={busyId === payment.id} onClick={() => doReversePayment(payment.id)}>ขอย้อนรายการชำระ</button></div>}
            </div>
          ))}
        </section>

        {auditLogs.length > 0 && <details className="audit-section"><summary>ประวัติการเปลี่ยนแปลง ({auditLogs.length})</summary><div className="audit-list">{auditLogs.map((item) => <div key={item.id}><span>{item.actorName || "ระบบ"} · {auditActionLabel(item.action)}</span><small>{dateTime(item.createdAt)}</small></div>)}</div></details>}

        <div className="record-actions">
          <button className="secondary" onClick={downloadAgreement}>ดาวน์โหลดหลักฐานข้อตกลง</button>
          {debt.debtorUid && !["cancelled", "declined", "paid"].includes(debt.status) && !openDispute && <button className="secondary" disabled={busyId === "dispute"} onClick={doDispute}>แจ้งยอดไม่ตรง/เปิดข้อโต้แย้ง</button>}
          {(creditor || debt.debtorUid) && !["cancelled", "declined"].includes(debt.status) && <button className="danger-outline" disabled={busyId === "cancel"} onClick={doCancel}>{debt.debtorUid ? "ขอยกเลิกรายการ" : "ยกเลิกรายการ"}</button>}
          {!archived && ["paid", "cancelled", "declined"].includes(debt.status) && <button className="secondary" disabled={busyId === "archive"} onClick={doArchive}>เก็บเข้าคลัง</button>}
          {archived && <button className="secondary" disabled={busyId === "archive"} onClick={doRestore}>นำกลับจากคลัง</button>}
        </div>
        {error && <div className="form-message error">{error}</div>}
        {showEdit && <EditDebtModal debt={debt} onClose={() => setShowEdit(false)} onSaved={onToast} />}
      </m.div>
    </m.div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [workspaceMode, setWorkspaceMode] = useState(() => inviteFromLocation() ? "shared" : localStorage.getItem("clear-kan-workspace") || "shared");
  const [debtsById, setDebtsById] = useState({});
  const [tab, setTab] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [createdInvite, setCreatedInvite] = useState(null);
  const [inviteCode, setInviteCode] = useState(inviteFromLocation());
  const [selectedId, setSelectedId] = useState("");
  const [toast, setToast] = useState("");
  const [archives, setArchives] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [expandedCashflow, setExpandedCashflow] = useState("");
  const [selectedCashflowKey, setSelectedCashflowKey] = useState(null);
  const initializationAttemptedRef = useRef("");
  const remindersAttemptedRef = useRef("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user || initializationAttemptedRef.current === user.uid) return;
    initializationAttemptedRef.current = user.uid;
    initializePunDebts().then((result) => {
      if (!result.data?.created || !result.data?.inviteCode) return;
      const data = result.data;
      setCreatedInvite({
        ...data,
        batch: true,
        inviteUrl: `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(data.inviteCode)}`,
      });
      setToast("นำเข้ารายการจาก Pun.xlsx เรียบร้อยแล้ว");
      window.setTimeout(() => setToast(""), 2600);
    }).catch((error) => {
      setToast(`นำเข้าข้อมูลตั้งต้นไม่สำเร็จ: ${errorMessage(error)}`);
      window.setTimeout(() => setToast(""), 3200);
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setArchives({});
      setNotifications([]);
      return undefined;
    }
    const unsubscribeArchives = onValue(ref(db, `debtArchives/${user.uid}`), (snapshot) => setArchives(snapshot.val() || {}));
    const unsubscribeNotifications = onValue(query(ref(db, `debtNotifications/${user.uid}`), limitToLast(50)), (snapshot) => {
      const rows = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      setNotifications(rows);
    });
    if (remindersAttemptedRef.current !== user.uid) {
      remindersAttemptedRef.current = user.uid;
      refreshDebtReminders().catch(() => {});
    }
    return () => { unsubscribeArchives(); unsubscribeNotifications(); };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setDebtsById({});
      return undefined;
    }
    let debtUnsubscribers = [];
    const memberRef = ref(db, `debtMembers/${user.uid}`);
    const unsubscribeMembers = onValue(memberRef, (snapshot) => {
      debtUnsubscribers.forEach((unsubscribe) => unsubscribe());
      debtUnsubscribers = [];
      const ids = Object.keys(snapshot.val() || {});
      setDebtsById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.includes(id))));
      ids.forEach((id) => {
        const unsubscribe = onValue(ref(db, `debts/${id}`), (debtSnapshot) => {
          setDebtsById((current) => {
            if (!debtSnapshot.exists()) {
              const next = { ...current };
              delete next[id];
              return next;
            }
            return { ...current, [id]: { id, ...debtSnapshot.val() } };
          });
        });
        debtUnsubscribers.push(unsubscribe);
      });
    });
    return () => {
      unsubscribeMembers();
      debtUnsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [user]);

  const debts = useMemo(() => Object.values(debtsById).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [debtsById]);
  const knownDebtors = useMemo(() => {
    const people = new Map();
    debts.filter((debt) => debt.creditorUid === user?.uid && debt.debtorUid && debt.debtorEmail).forEach((debt) => {
      people.set(debt.debtorUid, { uid: debt.debtorUid, name: debt.debtorName || debt.debtorEmail.split("@")[0], email: debt.debtorEmail });
    });
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [debts, user?.uid]);
  const excludedFinancialStatuses = ["pending", "cancelled", "declined", "invite_revoked"];
  const receivableDebts = debts.filter((debt) => debt.creditorUid === user?.uid && !excludedFinancialStatuses.includes(debt.status));
  const payableDebts = debts.filter((debt) => debt.debtorUid === user?.uid && !excludedFinancialStatuses.includes(debt.status));
  const receivable = receivableDebts.reduce((sum, debt) => sum + (debt.outstandingStatus === "unconfirmed" ? 0 : Number(debt.outstandingAmount || 0)), 0);
  const payable = payableDebts.reduce((sum, debt) => sum + (debt.outstandingStatus === "unconfirmed" ? 0 : Number(debt.outstandingAmount || 0)), 0);
  const unconfirmedReceivable = receivableDebts.filter((debt) => debt.outstandingStatus === "unconfirmed").reduce((sum, debt) => sum + Number(debt.amount || 0), 0);
  const unconfirmedPayable = payableDebts.filter((debt) => debt.outstandingStatus === "unconfirmed").reduce((sum, debt) => sum + Number(debt.amount || 0), 0);
  const receivableSchedule = buildPaymentSchedule(receivableDebts, "receivable");
  const payableSchedule = buildPaymentSchedule(payableDebts, "payable");
  const selectedCashflowSchedule = selectedCashflowKey?.direction === "payable" ? payableSchedule : receivableSchedule;
  const selectedCashflow = selectedCashflowKey ? selectedCashflowSchedule.find((group) => group.dueDate === selectedCashflowKey.dueDate) || null : null;
  const visibleDebts = debts.filter((debt) => {
    const archived = Boolean(archives[debt.id]);
    if (tab === "archived") return archived;
    if (archived) return false;
    return tab === "all" || (tab === "receivable" ? debt.creditorUid === user?.uid : debt.debtorUid === user?.uid);
  });
  const selectedDebt = debtsById[selectedId];
  const activeDebtCount = debts.filter((debt) => !archives[debt.id] && !["paid", "cancelled", "declined"].includes(debt.status)).length;
  const overlayOpen = Boolean(showCreate || createdInvite || inviteCode || selectedCashflow || selectedDebt || showNotifications);

  useEffect(() => {
    if (!overlayOpen) return undefined;
    const scrollPosition = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previousBody = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    const previousRootOverscroll = root.style.overscrollBehavior;
    body.style.position = "fixed";
    body.style.top = `-${scrollPosition}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    return () => {
      body.style.position = previousBody.position;
      body.style.top = previousBody.top;
      body.style.width = previousBody.width;
      body.style.overflow = previousBody.overflow;
      root.style.overscrollBehavior = previousRootOverscroll;
      window.scrollTo(0, scrollPosition);
    };
  }, [overlayOpen]);

  if (user === undefined) return <div className="app-loading" role="status" aria-live="polite" aria-label="กำลังเปิดเคลียร์กัน">
    <div className="splash-ambient splash-ambient-one" aria-hidden="true" />
    <div className="splash-ambient splash-ambient-two" aria-hidden="true" />
    <main className="splash-stage">
      <div className="splash-logo-scene" aria-hidden="true"><i /><i /><BrandMark className="splash-mark" /></div>
      <div className="splash-wordmark"><strong>เคลียร์กัน</strong><span>จัดการเรื่องเงินให้ชัดเจนระหว่างกัน</span></div>
      <div className="splash-progress" role="progressbar" aria-label="กำลังโหลด"><i /></div>
      <p>กำลังเตรียมพื้นที่ของคุณ</p>
    </main>
    <div className="splash-trust"><UiIcon name="status" /><span>ข้อมูลส่วนตัวของคุณได้รับการปกป้อง</span></div>
  </div>;
  if (!user) return <AuthScreen hasInvite={Boolean(inviteCode)} />;

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function changeWorkspace(mode) {
    setWorkspaceMode(mode);
    setShowNotifications(false);
    localStorage.setItem("clear-kan-workspace", mode);
  }

  function openSharedDebtFromFinance(debtId) {
    changeWorkspace("shared");
    setSelectedId(debtId);
  }

  async function openNotification(item) {
    if (!item.readAt) markDebtNotificationRead({ notificationId: item.id }).catch(() => {});
    if (item.debtId && debtsById[item.debtId]) setSelectedId(item.debtId);
    setShowNotifications(false);
  }

  return (
    <LazyMotion features={domAnimation}>
    <MotionConfig reducedMotion="user">
    <m.div className="app-shell aurora-app" onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`); event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <m.header className="topbar" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <div className="brand"><BrandMark /><span>เคลียร์กัน</span></div>
        <div className="user-area"><div className="notification-wrap"><button className="notification-button" aria-label={`การแจ้งเตือน${notifications.some((item) => !item.readAt) ? `ที่ยังไม่ได้อ่าน ${notifications.filter((item) => !item.readAt).length} รายการ` : ""}`} aria-expanded={showNotifications} onClick={() => setShowNotifications((value) => !value)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{notifications.some((item) => !item.readAt) && <i>{notifications.filter((item) => !item.readAt).length}</i>}</button></div><div className="user-copy"><strong>{user.displayName || user.email?.split("@")[0]}</strong><span>{user.email}</span></div><div className="avatar">{(user.displayName || user.email || "ค").charAt(0).toUpperCase()}</div><button className="logout" onClick={() => signOut(auth)}>ออกจากระบบ</button></div>
      </m.header>
      <AnimatePresence>{showNotifications && <NotificationsPanel notifications={notifications} onClose={() => setShowNotifications(false)} onOpen={openNotification} />}</AnimatePresence>

      <nav className="workspace-switch" aria-label="เลือกพื้นที่ทำงาน">
        <button className={workspaceMode === "shared" ? "active" : ""} onClick={() => changeWorkspace("shared")}><span>⇄</span><div><strong>เคลียร์กับคนอื่น</strong><small>ข้อตกลงระหว่างบุคคล</small></div></button>
        <button className={workspaceMode === "personal" ? "active" : ""} onClick={() => changeWorkspace("personal")}><span>◉</span><div><strong>การเงินของฉัน</strong><small>รายรับ รายจ่าย และหนี้ส่วนตัว</small></div><i>ส่วนตัว</i></button>
      </nav>

      {workspaceMode === "shared" ? <main className="dashboard">
        <m.section className="aurora-dashboard-hero" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}>
          <span className="aurora-blob blob-one" aria-hidden="true" /><span className="aurora-blob blob-two" aria-hidden="true" />
          <div className="hero-copy"><p className="eyebrow"><UiIcon name="sparkle" /> พื้นที่การเงินระหว่างเรา</p><h1>ทุกยอดชัดเจน<br /><em>ทุกข้อตกลงเบาใจ</em></h1><p>เห็นเงินเข้า เงินออก และวันสำคัญในมุมเดียว</p><m.button className="primary create-button" onClick={() => setShowCreate(true)} whileHover={{ scale: 1.025 }} whileTap={{ scale: 0.97 }}><UiIcon name="plus" />สร้างรายการใหม่</m.button></div>
          <div className={`net-spotlight ${receivable - payable >= 0 ? "positive" : "negative"}`}><small>ยอดสุทธิของคุณ</small><strong><AnimatedMoney value={receivable - payable} signed /></strong><p>{receivable - payable >= 0 ? "คุณเป็นเจ้าหนี้สุทธิ" : "คุณเป็นลูกหนี้สุทธิ"}</p></div>
        </m.section>

        <m.section className="summary-dock" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.12 } } }}>
          <m.article className="summary-chip receive" variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}><span className="summary-icon"><UiIcon name="incoming" /></span><div><small>ต้องได้รับ</small><strong><AnimatedMoney value={receivable} /></strong><p>{receivableDebts.filter((debt) => debt.status !== "paid").length} รายการ{unconfirmedReceivable > 0 ? ` · รอตรวจ ฿${money(unconfirmedReceivable)}` : ""}</p></div></m.article>
          <m.article className="summary-chip pay" variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}><span className="summary-icon"><UiIcon name="outgoing" /></span><div><small>ต้องจ่าย</small><strong><AnimatedMoney value={payable} /></strong><p>{payableDebts.filter((debt) => debt.status !== "paid").length} รายการ{unconfirmedPayable > 0 ? ` · รอตรวจ ฿${money(unconfirmedPayable)}` : ""}</p></div></m.article>
          <m.article className="summary-chip active-count" variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}><span className="summary-icon"><UiIcon name="history" /></span><div><small>กำลังติดตาม</small><strong>{activeDebtCount}</strong><p>รายการที่ยังต้องดำเนินการ</p></div></m.article>
        </m.section>

        <CashflowScheduleSection direction="receivable" schedule={receivableSchedule} expanded={expandedCashflow === "receivable"} onToggle={() => setExpandedCashflow((value) => value === "receivable" ? "" : "receivable")} onSelect={(dueDate) => setSelectedCashflowKey({ direction: "receivable", dueDate })} />
        <CashflowScheduleSection direction="payable" schedule={payableSchedule} expanded={expandedCashflow === "payable"} onToggle={() => setExpandedCashflow((value) => value === "payable" ? "" : "payable")} onSelect={(dueDate) => setSelectedCashflowKey({ direction: "payable", dueDate })} />

        <m.section className="list-section" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="list-heading"><div><p className="eyebrow">รายการของฉัน</p><h2>{tab === "archived" ? "คลังรายการ" : "รายการทั้งหมด"}</h2></div><div className="tabs"><button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>ทั้งหมด</button><button className={tab === "receivable" ? "active" : ""} onClick={() => setTab("receivable")}>ต้องรับ</button><button className={tab === "payable" ? "active" : ""} onClick={() => setTab("payable")}>ต้องจ่าย</button><button className={tab === "archived" ? "active" : ""} onClick={() => setTab("archived")}>คลัง</button></div></div>
          <div className="debt-list">{visibleDebts.length ? visibleDebts.map((debt) => <DebtCard key={debt.id} debt={debt} user={user} onOpen={(item) => setSelectedId(item.id)} />) : <EmptyState tab={tab} onCreate={() => setShowCreate(true)} />}</div>
        </m.section>
      </main> : <PersonalFinance user={user} onToast={showToast} sharedReceivables={receivableDebts} sharedPayables={payableDebts} onOpenSharedDebt={openSharedDebtFromFinance} />}

      <AnimatePresence>{workspaceMode === "shared" && showCreate && <CreateDebtModal user={user} knownDebtors={knownDebtors} onClose={() => setShowCreate(false)} onCreated={(data) => { setShowCreate(false); if (data.deliveryMode === "direct") { setSelectedId(data.debtId); showToast(`ส่งคำขอให้ ${data.debtorName} แล้ว`); } else setCreatedInvite({ ...data, inviteUrl: `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(data.inviteCode)}` }); }} />}</AnimatePresence>
      <AnimatePresence>{createdInvite && <InviteCreatedModal data={createdInvite} onClose={() => setCreatedInvite(null)} />}</AnimatePresence>
      {inviteCode && <AcceptInviteModal code={inviteCode} onClose={() => setInviteCode("")} onAccepted={(debtId) => { setInviteCode(""); setSelectedId(debtId); showToast("ยืนยันรายการเรียบร้อยแล้ว"); }} />}
      <AnimatePresence>{selectedCashflow && <CashflowDetailModal group={selectedCashflow} direction={selectedCashflowKey.direction} onClose={() => setSelectedCashflowKey(null)} onOpenDebt={(debtId) => { setSelectedCashflowKey(null); setSelectedId(debtId); }} />}</AnimatePresence>
      <AnimatePresence>{selectedDebt && <DebtDetailModal debt={selectedDebt} user={user} archived={Boolean(archives[selectedDebt.id])} onClose={() => setSelectedId("")} onToast={showToast} onArchived={() => setSelectedId("")} onRestored={() => setSelectedId("")} />}</AnimatePresence>
      <AnimatePresence>{toast && <m.div className="toast" initial={{ opacity: 0, y: 18, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }}>{toast}</m.div>}</AnimatePresence>
    </m.div>
    </MotionConfig>
    </LazyMotion>
  );
}

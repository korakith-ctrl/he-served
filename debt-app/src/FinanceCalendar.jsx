import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import "./finance-calendar.css";

const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const money = (value) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(Number(value) || 0);
const monthTitle = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(Date.UTC(y, m - 1, 15)));
};
const dateTitle = (date) => new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(`${date}T12:00:00+07:00`));
const dayNumber = (date) => Number(date.slice(-2));
const isIncome = (row) => row.direction === "income" || row.kind === "income" || row.type === "income";
const isPending = (row) => row.status === "pending" || row.status === "processing";
const titleOf = (row) => row.title || row.name || row.description || row.label || "รายการ";
const sourceLabels = { manual: "บันทึกเอง", personalPayment: "ชำระหนี้ส่วนตัว", sharedPayment: "รายการระหว่างบุคคล", personal_debt: "หนี้ส่วนตัว", shared_debt: "หนี้ระหว่างบุคคล", income_plan: "แผนรายรับ", expense_plan: "แผนรายจ่าย" };
const methodLabels = { cash: "เงินสด", transfer: "โอน", other: "อื่นๆ" };
const statusLabels = { pending: "รอยืนยัน", processing: "กำลังดำเนินการ", planned: "รอตามแผน", partial: "ชำระบางส่วน", paid: "ชำระแล้ว", unpaid: "ยังไม่ชำระ", confirmed: "ยืนยันแล้ว" };
const metaOf = (row) => [row.category, methodLabels[row.method] || row.method, row.sourceLabel || sourceLabels[row.sourceKind] || sourceLabels[row.source] || row.source, row.statusLabel || statusLabels[row.status] || (isPending(row) ? "รอยืนยัน" : "")].filter(Boolean).join(" · ");
function Detail({ day, mode, onOpenEntry, onAddAtDate, today, onClose }) {
  if (!day) return <div className="fc-detail-placeholder"><CalendarDays size={22}/><span>เลือกวันที่เพื่อดูรายละเอียด</span></div>;
  const actual = mode === "actual";
  const regular = actual ? day.actualRows || [] : day.planRows || [];
  const pending = actual ? day.pendingRows || [] : [];
  const sections = actual ? [
    { label: "รายรับ", rows: regular.filter(isIncome), income: true },
    { label: "รายจ่ายทั่วไป", rows: regular.filter((r) => !isIncome(r) && !r.debtExpense && r.sourceKind !== "personalPayment" && r.sourceKind !== "sharedPayment" && r.kind !== "debt" && r.type !== "debt") },
    { label: "ชำระหนี้", rows: regular.filter((r) => !isIncome(r) && (r.debtExpense || r.sourceKind === "personalPayment" || r.sourceKind === "sharedPayment" || r.kind === "debt" || r.type === "debt")) },
    { label: "รอยืนยัน · ไม่รวมยอดจริง", rows: pending, pending: true },
  ] : [{ label: "รายการตามแผน", rows: regular }];
  const totals = day[mode] || {};
  return <div className="fc-detail-content">
    <header className="fc-detail-heading"><div><p className="fc-eyebrow">{actual ? "รายการจริง" : "แผน"}</p><h3>{dateTitle(day.date)}</h3></div><button className="fc-close" aria-label="ปิดรายละเอียด" onClick={onClose}><X size={18}/></button></header>
    <div className="fc-day-summary"><div><span>{actual ? "รับจริง" : "เงินเข้าตามแผน"}</span><strong className="fc-income">+{money(totals.income)}</strong></div><div><span>{actual ? "จ่ายจริง" : "ภาระจ่ายคงเหลือ"}</span><strong className="fc-expense">−{money(totals.totalExpense ?? totals.expense)}</strong></div><div><span>{actual ? "สุทธิวันนี้" : "สุทธิตามแผน"}</span><strong className={(totals.net || 0) >= 0 ? "fc-income" : "fc-expense"}>{(totals.net || 0) >= 0 ? "+" : "−"}{money(Math.abs(totals.net || 0))}</strong></div></div>
    <div className="fc-detail-sections">{sections.filter((s) => s.rows.length).map((section) => <section key={section.label}><h4>{section.label}{section.pending && <span> · {section.rows.length} รายการ</span>}</h4>{section.rows.map((row, index) => {
      const income = isIncome(row); const amount = Number(row.amount ?? row.value ?? 0); const planRow = !actual;
      const planStatus = row.statusLabel || statusLabels[row.status] || (row.status ? String(row.status) : "");
      const planDetails = planRow ? [
        row.plannedAmount != null && `ยอดเต็ม ${money(row.plannedAmount)}`,
        row.actualAmount != null && `ชำระแล้ว ${money(row.actualAmount)}`,
        row.remainingAmount != null && `คงเหลือ ${money(row.remainingAmount)}`,
        planStatus,
      ].filter(Boolean).join(" · ") : "";
      return <button type="button" className="fc-entry" key={row.key || row.id || `${section.label}-${index}`} onClick={() => onOpenEntry?.(row)}><span className={`fc-entry-mark ${income ? "is-income" : "is-expense"}`} aria-hidden="true">{income ? "+" : "−"}</span><span className="fc-entry-copy"><strong>{titleOf(row)}</strong><small>{metaOf(row) || (section.pending ? "รอยืนยัน" : "")}</small>{planDetails && <small className="fc-plan-metadata">{planDetails}</small>}</span><b className={income ? "fc-income" : "fc-expense"}>{income ? "+" : "−"}{money(planRow ? (row.remainingAmount ?? amount) : amount)} <span aria-hidden="true">›</span></b></button>;
    })}</section>)}{!sections.some((s) => s.rows.length) && <div className="fc-empty"><strong>ยังไม่มีรายการในวันนี้</strong><span>{actual ? "เพิ่มรายการเพื่อเริ่มบันทึกเงินจริง" : "ยังไม่มีแผนในวันนี้"}</span></div>}</div>
    {actual && <button className="fc-add" disabled={day.date > today} onClick={() => onAddAtDate?.(day.date)}><Plus size={16}/> บันทึกรายการในวันนี้</button>}
  </div>;
}

export default function FinanceCalendar({ month, mode = "actual", data, today, onMonthChange, onModeChange, onOpenEntry, onAddAtDate }) {
  const days = data?.days || [];
  const [selectedDate, setSelectedDate] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const keepSelectionOnMonthChange = useRef(false);
  useEffect(() => {
    if (keepSelectionOnMonthChange.current) {
      keepSelectionOnMonthChange.current = false;
      return;
    }
    setSelectedDate(null);
    setMobileOpen(false);
  }, [month]);
  const selected = days.find((day) => day.date === selectedDate) || null;
  const totals = data?.totals || {};
  const [year, monthNum] = month.split("-").map(Number);
  const summary = mode === "actual" ? totals.actual || totals : totals.plan || totals;
  const go = (delta) => { const date = new Date(Date.UTC(year, monthNum - 1 + delta, 1)); onMonthChange?.(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`); };
  const selectDay = (day) => { if (!day.inMonth) { keepSelectionOnMonthChange.current = true; onMonthChange?.(day.date.slice(0, 7)); } setSelectedDate(day.date); setMobileOpen(true); };
  const compact = (n) => { const v = Number(n) || 0; const abs = Math.abs(v); return abs >= 1000000 ? `${(abs / 1000000).toFixed(1).replace(/\.0$/, "")}m` : abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : money(abs); };
  const amountLine = (day, key, sign, label) => { const amount = day[mode]?.[key] || 0; return amount ? <span className={`fc-amount ${key === "income" ? "fc-income" : "fc-expense"}`}><span className="fc-amount-label">{label} </span><span className="fc-full-amount">{sign}{money(amount)}</span><span className="fc-short-amount">{sign}{compact(amount)}</span></span> : null; };
  return <section className="fc-calendar" aria-label="ปฏิทินการเงิน">
    <header className="fc-top"><div><p className="fc-eyebrow">ปฏิทินเงินเข้า–ออก</p><h2>{monthTitle(month)}</h2></div><nav className="fc-month-nav" aria-label="เลือกเดือน"><button aria-label="เดือนก่อน" onClick={() => go(-1)}><ChevronLeft size={18}/></button><button aria-label="เดือนถัดไป" onClick={() => go(1)}><ChevronRight size={18}/></button></nav></header>
    <div className="fc-controls"><div className="fc-switch" role="group" aria-label="เลือกข้อมูลปฏิทิน"><button className={mode === "actual" ? "active" : ""} aria-pressed={mode === "actual"} onClick={() => onModeChange?.("actual")}>รายการจริง</button><button className={mode === "plan" ? "active" : ""} aria-pressed={mode === "plan"} onClick={() => onModeChange?.("plan")}>แผน</button></div><p className="fc-month-caption">รวมในเดือนปฏิทิน</p></div>
    <div className="fc-summary" aria-label={`สรุป${mode === "actual" ? "รายการจริง" : "แผน"}เดือน${monthTitle(month)}`}><div><span>{mode === "actual" ? "รับจริง" : "เงินเข้าตามแผน"}</span><strong className="fc-income">+{money(summary.income)}</strong></div><div><span>{mode === "actual" ? "จ่ายจริง" : "ภาระจ่ายคงเหลือ"}</span><strong className="fc-expense">−{money(summary.totalExpense ?? summary.expense)}</strong></div><div><span>{mode === "actual" ? "สุทธิ" : "สุทธิตามแผน"}</span><strong className={(summary.net || 0) >= 0 ? "fc-income" : "fc-expense"}>{(summary.net || 0) >= 0 ? "+" : "−"}{money(Math.abs(summary.net || 0))}</strong></div>{mode === "actual" && totals.pendingCount > 0 && <div className="fc-pending-total"><span>รอยืนยัน</span><strong>{totals.pendingCount} รายการ</strong><small>ไม่รวมยอดจริง</small></div>}</div>
    <div className="fc-layout"><div className="fc-grid-wrap"><div className="fc-weekdays" aria-hidden="true">{WEEKDAYS.map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}</div><div className="fc-grid" aria-label={`ปฏิทินเดือน${monthTitle(month)}`}>
      {days.map((day) => { const stat = day[mode] || {}; const isSelected = selectedDate === day.date; const isToday = day.date === today; const label = `${dateTitle(day.date)}${stat.income ? `, รับ ${money(stat.income)} บาท` : ""}${(stat.totalExpense ?? stat.expense) ? `, จ่าย ${money(stat.totalExpense ?? stat.expense)} บาท` : ""}${mode === "actual" && day.pendingRows?.length ? `, รอยืนยัน ${day.pendingRows.length} รายการ` : ""}`;
        return <button type="button" aria-label={label} aria-pressed={isSelected} className={`fc-day ${day.inMonth ? "" : "is-outside"} ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`} key={day.date} onClick={() => selectDay(day)}><span className="fc-day-number">{dayNumber(day.date)}</span><span className="fc-day-values">{amountLine(day, "income", "+", "รับ")}{amountLine(day, "totalExpense", "−", "จ่าย") || amountLine(day, "expense", "−", "จ่าย")}</span>{mode === "actual" && day.pendingCount > 0 && <span className="fc-pending-dot"><i aria-hidden="true">●</i> <span>รอยืนยัน {day.pendingCount}</span></span>}</button>;
      })}
    </div></div><aside className="fc-desktop-detail" aria-live="polite"><Detail day={selected} mode={mode} onOpenEntry={onOpenEntry} onAddAtDate={onAddAtDate} today={today} onClose={() => setSelectedDate(null)}/></aside></div>
    {mobileOpen && selected && <div className="fc-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMobileOpen(false)}><div className="fc-mobile-sheet" role="dialog" aria-modal="true" aria-label={`รายละเอียด ${dateTitle(selected.date)}`}><Detail day={selected} mode={mode} onOpenEntry={onOpenEntry} onAddAtDate={onAddAtDate} today={today} onClose={() => setMobileOpen(false)}/></div></div>}
  </section>;
}

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, CirclePlus, Pencil, Trash2, X } from "lucide-react";
import "./daily-cashflow.css";

const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const readableDate = (s) => s ? new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${s}T12:00:00`)) : "";
const categories = { income: ["เงินเดือน", "รายได้เสริม", "ค่าคอมมิชชัน", "โบนัส", "อื่นๆ"], expense: ["ที่อยู่อาศัย", "อาหาร", "เดินทาง", "สาธารณูปโภค", "ประกัน", "สมาชิก/แอป", "ครอบครัว", "สุขภาพ", "อื่นๆ"] };
const methodLabels = { cash: "เงินสด", transfer: "โอน", other: "อื่นๆ" };
const sourceLabel = (item) => item.source === "manual" ? "บันทึกเอง" : ["personal_debt", "personalPayment"].includes(item.source) ? "ชำระหนี้ของฉัน" : "รายการระหว่างบุคคล";

export default function DailyCashflowPanel({ cycle, transactions = [], onSave, onDelete, onOpenSource, onPayPersonalDebt, onOpenSharedDebt, plans = [], today }) {
  const todayValue = today || localDate();
  const start = cycle?.start || cycle?.from || "0000-01-01";
  const end = cycle?.end || cycle?.to || todayValue;
  const [filters, setFilters] = useState({ direction: "all", category: "all", source: "all", from: start, to: end });
  useEffect(() => { setFilters((current) => ({ ...current, from: start, to: end })); }, [start, end]);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const filtered = useMemo(() => transactions.filter((t) => {
    const kind = t.direction === "debt" ? "expense" : t.direction;
    return t.date >= filters.from && t.date <= filters.to
      && (filters.direction === "all" || kind === filters.direction)
      && (filters.category === "all" || t.category === filters.category)
      && (filters.source === "all" || t.source === filters.source || (filters.source === "personal_debt" && t.source === "personalPayment") || (filters.source === "shared_debt" && t.source === "sharedPayment"));
  }).sort((a, b) => b.date.localeCompare(a.date) || String(b.key || b.id).localeCompare(String(a.key || a.id))), [transactions, filters]);
  const totals = useMemo(() => filtered.reduce((acc, t) => {
    const pending = t.status === "pending";
    const direction = t.direction === "debt" ? "expense" : t.direction;
    if (pending) { acc.pending += Number(t.amount || 0); return acc; }
    if (direction === "income") acc.income += Number(t.amount || 0);
    else acc.expense += Number(t.amount || 0);
    return acc;
  }, { income: 0, expense: 0, pending: 0 }), [filtered]);
  const grouped = useMemo(() => filtered.reduce((acc, t) => ((acc[t.date] ||= []).push(t), acc), {}), [filtered]);
  const categoryOptions = [...new Set([...categories.income, ...categories.expense, ...plans.map((p) => p.category).filter(Boolean), ...transactions.map((t) => t.category).filter(Boolean)])];

  function openNew(direction = "expense") { if (start > todayValue) return; const defaultDate = todayValue > end ? end : todayValue; setError(""); setEditor({ kind: "new", initial: { direction, amount: "", date: defaultDate, title: "", category: categories[direction][0], method: "", note: "", planRef: "", occurrenceDate: defaultDate, completesOccurrence: false } }); }
  function openEdit(item) { setError(""); setEditor({ kind: "edit", initial: { ...item, planRef: typeof item.planRef === "object" ? item.planRef?.id || "" : item.planRef || "", occurrenceDate: (typeof item.planRef === "object" ? item.planRef?.occurrenceDate : item.occurrenceDate) || item.date, completesOccurrence: Boolean(typeof item.planRef === "object" ? item.planRef?.completesOccurrence : item.completesOccurrence) } }); }
  async function save(event) {
    event.preventDefault(); const f = editor.initial;
    if (!f.title.trim() || !Number.isFinite(Number(f.amount)) || Number(f.amount) <= 0 || !f.date || f.date > todayValue) { setError(f.date > todayValue ? "วันที่รายการต้องไม่เกินวันนี้" : "กรุณากรอกชื่อรายการและจำนวนเงินให้ถูกต้อง"); return; }
    setBusy(true); setError("");
    const plan = plans.find((p) => p.id === f.planRef);
    const entry = { direction: f.direction, amount: Number(f.amount), date: f.date, title: f.title.trim(), category: f.category, method: f.method, note: f.note, planRef: f.planRef ? { kind: plan?.kind || f.direction, id: f.planRef, occurrenceDate: f.occurrenceDate || f.date, completesOccurrence: Boolean(f.completesOccurrence) } : null, ...(plan ? { planName: plan.name } : {}) };
    try { await onSave?.(entry, editor.kind === "edit" ? editor.original || transactions.find((t) => t.id === f.id || t.key === f.key) : null); setEditor(null); }
    catch (e) { setError(e?.message || "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setBusy(false); }
  }
  async function removeItem(item) {
    setDeleteBusy(item.key || item.id); setDeleteError("");
    try { await onDelete?.(item); } catch (e) { setDeleteError(e?.message || "ลบรายการไม่สำเร็จ"); } finally { setDeleteBusy(""); }
  }
  const update = (key, value) => setEditor((current) => ({ ...current, initial: { ...current.initial, [key]: value } }));
  const setFilter = (key, value) => setFilters((old) => ({ ...old, [key]: value }));
  const planSelection = (id) => { const plan = plans.find((p) => p.id === id); if (!plan) return update("planRef", ""); setEditor((cur) => ({ ...cur, initial: { ...cur.initial, planRef: id, direction: plan.kind, title: plan.name || cur.initial.title, category: plan.category || cur.initial.category, amount: plan.amount ?? cur.initial.amount, occurrenceDate: plan.occurrenceDate || plan.date || cur.initial.date } })); };
  return <section className="dc-panel" aria-labelledby="dc-title">
    <header className="dc-heading"><div><p className="dc-eyebrow">เงินจริง · {cycle?.label || `${readableDate(start)} – ${readableDate(end)}`}</p><h2 id="dc-title">บันทึกประจำวัน</h2>{start > todayValue && <p className="dc-future-note">รอบนี้ยังไม่เริ่ม เลือกรอบปัจจุบันหรือรอบก่อนเพื่อบันทึกเงินจริง</p>}</div><div className="dc-quick"><button className="dc-add dc-income" disabled={start > todayValue} onClick={() => openNew("income")}><CirclePlus size={16}/> รับเงิน</button><button className="dc-add" disabled={start > todayValue} onClick={() => openNew("expense")}><CirclePlus size={16}/> จ่ายเงิน</button>{onPayPersonalDebt && <button className="dc-route" onClick={onPayPersonalDebt}>ชำระหนี้ของฉัน</button>}{onOpenSharedDebt && <button className="dc-route" onClick={onOpenSharedDebt}>จ่าย/รับกับคนอื่น</button>}</div></header>
    <div className="dc-summary" aria-label="ยอดรวมในช่วงที่เลือก"><div><span>รับจริง</span><strong className="dc-positive">+{fmt(totals.income)}</strong><small>บาท</small></div><div><span>จ่ายจริง</span><strong className="dc-negative">−{fmt(totals.expense)}</strong><small>บาท</small></div><div className="dc-net"><span>สุทธิ</span><strong className={totals.income - totals.expense >= 0 ? "dc-positive" : "dc-negative"}>{totals.income - totals.expense >= 0 ? "+" : "−"}{fmt(Math.abs(totals.income - totals.expense))}</strong><small>บาท</small></div>{totals.pending > 0 && <div><span>รอยืนยัน</span><strong>{fmt(totals.pending)}</strong><small>บาท · ไม่นับในยอดจริง</small></div>}</div>
    <div className="dc-filters" aria-label="ตัวกรองรายการ"><label>ประเภท<select value={filters.direction} onChange={(e) => setFilter("direction", e.target.value)}><option value="all">ทั้งหมด</option><option value="income">รายรับ</option><option value="expense">รายจ่าย</option></select></label><label>หมวดหมู่<select value={filters.category} onChange={(e) => setFilter("category", e.target.value)}><option value="all">ทุกหมวด</option>{categoryOptions.map((c) => <option key={c}>{c}</option>)}</select></label><label>แหล่งข้อมูล<select value={filters.source} onChange={(e) => setFilter("source", e.target.value)}><option value="all">ทั้งหมด</option><option value="manual">บันทึกเอง</option><option value="personal_debt">ชำระหนี้ของฉัน</option><option value="shared_debt">รายการระหว่างบุคคล</option></select></label><label><span className="dc-visually-hidden">ตั้งแต่วันที่</span><input aria-label="ตั้งแต่วันที่" type="date" value={filters.from} max={todayValue} onChange={(e) => setFilter("from", e.target.value)} /></label><span className="dc-date-sep">ถึง</span><label><span className="dc-visually-hidden">ถึงวันที่</span><input aria-label="ถึงวันที่" type="date" value={filters.to} max={todayValue} onChange={(e) => setFilter("to", e.target.value)} /></label></div>
    {deleteError && <p className="dc-error" role="alert">{deleteError}</p>}
    {Object.keys(grouped).length === 0 ? <div className="dc-empty"><CalendarDays size={25}/><strong>ยังไม่มีรายการในช่วงนี้</strong><span>เพิ่มรายรับหรือรายจ่ายเพื่อเริ่มบันทึกเงินจริง</span></div> : <div className="dc-days">{Object.entries(grouped).map(([date, items]) => { const dayIncome = items.filter((x) => x.status !== "pending" && x.direction === "income").reduce((s, x) => s + Number(x.amount || 0), 0); const dayExpense = items.filter((x) => x.status !== "pending" && x.direction !== "income").reduce((s, x) => s + Number(x.amount || 0), 0); return <section className="dc-day" key={date}><header><h3>{readableDate(date)}</h3><span>รับ +{fmt(dayIncome)} <i>·</i> จ่าย −{fmt(dayExpense)}</span></header>{items.map((item) => { const income = item.direction === "income"; const manual = item.source === "manual"; const key = item.key || item.id; return <article className="dc-row" key={key}>
      <span className={`dc-icon ${income ? "in" : "out"}`}>{income ? <ArrowDownLeft size={17}/> : <ArrowUpRight size={17}/>}</span><button className="dc-item-main" onClick={() => manual ? openEdit(item) : onOpenSource?.(item)}><strong>{item.title || "รายการ"}</strong><span>{[item.category, methodLabels[item.method] || item.method, sourceLabel(item)].filter(Boolean).join(" · ")}{item.status === "pending" ? " · รอยืนยัน" : ""}</span></button><strong className={`dc-row-amount ${income ? "dc-positive" : "dc-negative"}`}>{income ? "+" : "−"}{fmt(item.amount)}</strong>{manual && <div className="dc-row-actions"><button aria-label={`แก้ไข ${item.title}`} title="แก้ไข" onClick={() => openEdit(item)}><Pencil size={14}/></button><button aria-label={`ลบ ${item.title}`} title="ลบ" disabled={deleteBusy === key} onClick={() => removeItem(item)}><Trash2 size={14}/></button></div>}
    </article>; })}</section>; })}</div>}
    {editor && <div className="dc-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && setEditor(null)}><div className="dc-modal" role="dialog" aria-modal="true" aria-labelledby="dc-form-title"><header><div><p className="dc-eyebrow">บันทึกเงินจริง</p><h2 id="dc-form-title">{editor.kind === "edit" ? "แก้ไขรายการ" : "เพิ่มรายการ"}</h2></div><button className="dc-close" aria-label="ปิดหน้าต่าง" onClick={() => !busy && setEditor(null)}><X size={18}/></button></header><form onSubmit={save}>
      <div className="dc-direction" role="group" aria-label="ประเภทรายการ"><button type="button" className={editor.initial.direction === "income" ? "selected income" : ""} onClick={() => setEditor((current) => ({ ...current, initial: { ...current.initial, direction: "income", planRef: "", category: categories.income[0] } }))}>รับเงิน</button><button type="button" className={editor.initial.direction === "expense" ? "selected" : ""} onClick={() => setEditor((current) => ({ ...current, initial: { ...current.initial, direction: "expense", planRef: "", category: categories.expense[0] } }))}>จ่ายเงิน</button></div>
      <label>ชื่อรายการ<input autoFocus maxLength={100} value={editor.initial.title || ""} onChange={(e) => update("title", e.target.value)} placeholder="เช่น ค่าอาหาร" required /></label>
      <div className="dc-form-grid"><label>จำนวนเงิน (บาท)<input type="number" min="0.01" step="0.01" inputMode="decimal" value={editor.initial.amount} onChange={(e) => update("amount", e.target.value)} required /></label><label>วันที่<input type="date" value={editor.initial.date || todayValue} max={todayValue} onChange={(e) => update("date", e.target.value)} required /></label>
      <label>หมวดหมู่<select value={editor.initial.category || "อื่นๆ"} onChange={(e) => update("category", e.target.value)}>{[...new Set([...categories[editor.initial.direction], editor.initial.category].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}</select></label><label>ช่องทาง <span>(ไม่บังคับ)</span><select value={editor.initial.method || ""} onChange={(e) => update("method", e.target.value)}><option value="">ไม่ระบุ</option><option value="cash">เงินสด</option><option value="transfer">โอน</option><option value="other">อื่นๆ</option></select></label></div>
      <label>อ้างอิงแผน <span>(ไม่บังคับ)</span><select value={editor.initial.planRef || ""} onChange={(e) => planSelection(e.target.value)}><option value="">ไม่ผูกกับแผน</option>{plans.filter((p) => p.active !== false && p.kind === editor.initial.direction).map((p) => <option key={p.id} value={p.id}>{p.name} · {fmt(p.amount)} บาท</option>)}</select></label>
      {editor.initial.planRef && <div className="dc-occurrence"><label>วันที่รอบแผน<input type="date" value={editor.initial.occurrenceDate || editor.initial.date} onChange={(e) => update("occurrenceDate", e.target.value)} /></label><label className="dc-check"><input type="checkbox" checked={Boolean(editor.initial.completesOccurrence)} onChange={(e) => update("completesOccurrence", e.target.checked)}/> ครบรอบของแผนนี้แล้ว</label></div>}
      <label>หมายเหตุ <span>(ไม่บังคับ)</span><textarea rows="2" maxLength={500} value={editor.initial.note || ""} onChange={(e) => update("note", e.target.value)} /></label>{error && <p className="dc-error" role="alert">{error}</p>}<footer><button type="button" className="dc-cancel" disabled={busy} onClick={() => setEditor(null)}>ยกเลิก</button><button className="dc-submit" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกรายการ"}</button></footer>
    </form></div></div>}
  </section>;
}

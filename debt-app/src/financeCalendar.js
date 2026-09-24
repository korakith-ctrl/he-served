const DAY = 86400000;
const cents = (value) => Math.round((Number(value) || 0) * 100);
const money = (value) => value / 100;
const rows = (value) => Array.isArray(value) ? value : Object.entries(value || {}).map(([id, item]) => ({ id, ...item }));
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const moveDay = (date, amount) => new Date(Date.parse(`${date}T12:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
const monthDay = (month, day) => {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(Number(day) || 1, 1), last)).padStart(2, "0")}`;
};
const isActive = (item) => item.active !== false;
const okShared = (item) => !["unconfirmed", "settled", "cancelled", "canceled", "archived", "paid", "declined", "invite_revoked"].includes(item.outstandingStatus) && !["settled", "cancelled", "canceled", "archived", "paid", "declined", "invite_revoked"].includes(item.status);

function keysFor(item, source, index) {
  const id = item.id || item.paymentId || item.transactionId || `row-${index}`;
  return { key: `${source}:${item.debtId ? `${item.debtId}:` : ""}${id}`, sourceId: item.paymentId || item.id || id };
}
function totals() { return { income: 0, expense: 0, debtExpense: 0, totalExpense: 0, net: 0 }; }
function addActual(t, row) {
  const amount = cents(row.amount);
  if (row.direction === "income") t.income += amount;
  else if (row.sourceKind !== "manual") t.debtExpense += amount;
  else t.expense += amount;
}
function materialize(t) {
  return { income: money(t.income), expense: money(t.expense), debtExpense: money(t.debtExpense), totalExpense: money(t.expense + t.debtExpense), net: money(t.income - t.expense - t.debtExpense) };
}
function planTotals(planRows) {
  let income = 0, expense = 0, debtExpense = 0;
  for (const row of planRows) {
    const amount = cents(row.amount);
    if (!amount) continue;
    if (row.direction === "income") income += amount;
    else if (row.sourceKind === "personal_debt" || row.sourceKind === "shared_debt") debtExpense += amount;
    else expense += amount;
  }
  return materialize({ income, expense, debtExpense });
}
function planRow({ key, sourceKind, sourceId, direction, date, title, plannedAmount, actualAmount = 0, remainingAmount, status = "planned", category = "", liabilityId, debtId }) {
  const planned = cents(plannedAmount), actual = cents(actualAmount);
  const remaining = remainingAmount == null ? Math.max(0, planned - actual) : cents(remainingAmount);
  return { key, sourceKind, ...(sourceId ? { sourceId } : {}), direction, date, title: title || "รายการ", plannedAmount: money(planned), actualAmount: money(actual), remainingAmount: money(remaining), amount: money(remaining), status, category, ...(liabilityId ? { liabilityId } : {}), ...(debtId ? { debtId } : {}) };
}

/** Build a Sunday-start calendar for one Gregorian calendar month. Dates are date-only Asia/Bangkok values. */
export function buildFinanceCalendar({ month, manualTransactions = [], personalPayments = [], sharedPayments = [], incomes = [], expenses = [], liabilities = [], cardStatements = {}, sharedReceivables = [], sharedPayables = [], payday = 1 } = {}) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new TypeError("month must be YYYY-MM");
  const monthStart = `${month}-01`;
  const [year, mon] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const cellCount = Math.max(35, Math.ceil((firstWeekday + count) / 7) * 7);
  const start = moveDay(monthStart, -firstWeekday);
  const dayMap = new Map();
  for (let i = 0; i < cellCount; i++) {
    const date = moveDay(start, i);
    dayMap.set(date, { date, inMonth: date.slice(0, 7) === month, actual: { income: 0, expense: 0, debtExpense: 0, totalExpense: 0, net: 0, pendingCount: 0 }, plan: totals(), actualRows: [], pendingRows: [], planRows: [] });
  }
  const actualSeen = new Set();
  const pendingSeen = new Set();
  const actualByOccurrence = new Map();
  const addActualRow = (row) => {
    if (!validDate(row.date) || !(cents(row.amount) > 0) || !["income", "expense"].includes(row.direction)) return;
    if (actualSeen.has(row.key)) return;
    actualSeen.add(row.key);
    row.amount = money(cents(row.amount));
    row.source = row.sourceKind;
    if (row.planRef?.id) {
      const key = `${row.planRef.kind}:${row.planRef.id}:${row.planRef.occurrenceDate || row.date}`;
      const agg = actualByOccurrence.get(key) || { amount: 0, complete: false };
      agg.amount += cents(row.amount); agg.complete ||= row.planRef.completesOccurrence === true;
      actualByOccurrence.set(key, agg);
    }
    if (!dayMap.has(row.date)) return;
    const day = dayMap.get(row.date);
    day.actualRows.push(row);
    const accum = { income: cents(day.actual.income), expense: cents(day.actual.expense), debtExpense: cents(day.actual.debtExpense) };
    addActual(accum, row);
    Object.assign(day.actual, materialize(accum));
  };
  rows(manualTransactions).forEach((item, index) => {
    const { key, sourceId } = keysFor(item, "manual", index);
    addActualRow({ key, sourceKind: "manual", sourceId, date: item.date, direction: item.direction, amount: item.amount, title: item.title || item.name || "รายการ", category: item.category || "อื่นๆ", method: item.method || "", liabilityId: item.liabilityId, debtId: item.debtId, status: item.status || "confirmed", planRef: item.planRef || null });
  });
  rows(personalPayments).forEach((item, index) => {
    if (["pending", "processing", "reversed", "cancelled", "canceled"].includes(item.status)) return;
    const { key, sourceId } = keysFor(item, "personalPayment", index);
    addActualRow({ key, sourceKind: "personalPayment", sourceId, date: item.date || item.paymentDate, direction: "expense", amount: item.amount, title: item.title || item.liabilityTitle || "ชำระหนี้ของฉัน", category: "ชำระหนี้", method: item.method || "", liabilityId: item.liabilityId, debtId: item.liabilityId, status: item.status || "confirmed" });
  });
  rows(sharedPayments).forEach((item, index) => {
    const date = item.paymentDate || item.date;
    const direction = ["income", "receivable"].includes(item.direction) ? "income" : "expense";
    const { key, sourceId } = keysFor(item, "sharedPayment", index);
    if (["pending", "processing"].includes(item.status)) {
      if (!pendingSeen.has(key) && validDate(date) && dayMap.has(date) && cents(item.amount) > 0) {
        pendingSeen.add(key);
        dayMap.get(date).pendingRows.push({ key, sourceKind: "sharedPayment", sourceId, date, direction, amount: money(cents(item.amount)), title: item.title || "ชำระหนี้ระหว่างบุคคล", category: item.category || "เคลียร์กับคนอื่น", method: item.method || "", debtId: item.debtId, status: item.status });
      }
      return;
    }
    if (item.status !== "confirmed") return;
    addActualRow({ key, sourceKind: "sharedPayment", sourceId, date, direction, amount: item.amount, title: item.title || "ชำระหนี้ระหว่างบุคคล", category: item.category || "เคลียร์กับคนอื่น", method: item.method || "", debtId: item.debtId, status: item.status || "confirmed" });
  });

  const addPlan = (options) => {
    const row = planRow(options);
    if (validDate(row.date) && dayMap.has(row.date)) dayMap.get(row.date).planRows.push(row);
  };
  for (const [kind, source] of [["income", incomes], ["expense", expenses]]) for (const [index, item] of rows(source).entries()) {
    if (!isActive(item)) continue;
    const date = item.frequency === "once" ? item.date : item.frequency === "monthly" ? monthDay(month, item.dayOfMonth) : null;
    if (!validDate(date) || date.slice(0, 7) !== month || (item.startMonth && month < item.startMonth) || (item.endMonth && month > item.endMonth)) continue;
    const id = item.id || `row-${index}`;
    const fulfilled = actualByOccurrence.get(`${kind}:${id}:${date}`) || { amount: 0, complete: false };
    addPlan({ key: `${kind}:${id}:${date}`, sourceKind: `${kind}_plan`, sourceId: id, direction: kind, date, title: item.name || item.title || "รายการ", plannedAmount: item.amount, actualAmount: fulfilled.amount / 100, remainingAmount: (fulfilled.complete ? 0 : Math.max(0, cents(item.amount) - fulfilled.amount)) / 100, status: fulfilled.complete || fulfilled.amount >= cents(item.amount) ? "paid" : fulfilled.amount ? "partial" : "planned", category: item.category || "" });
  }
  for (const [liabilityIndex, liability] of rows(liabilities).entries()) {
    if (!isActive(liability)) continue;
    const id = liability.id || `liability-${liabilityIndex}`;
    const fullCard = liability.type === "credit_card" && liability.cardPaymentMode === "full_balance";
    if (fullCard) {
      for (const [statementMonth, statement] of Object.entries(cardStatements[id] || {})) {
        const remain = Math.max(0, cents(statement.amount) - cents(statement.paidAmount));
        if (!remain || !validDate(statement.dueDate) || statement.dueDate.slice(0, 7) !== month) continue;
        addPlan({ key: `cardStatement:${id}:${statementMonth}`, sourceKind: "personal_debt", sourceId: statementMonth, direction: "expense", date: statement.dueDate, title: liability.title || "บัตรเครดิต", plannedAmount: statement.amount, actualAmount: statement.paidAmount || 0, remainingAmount: remain / 100, status: remain < cents(statement.amount) ? "partial" : "planned", category: "ชำระบัตรเครดิต", liabilityId: id });
      }
      continue;
    }
    if (Number(liability.outstanding ?? liability.outstandingAmount) <= 0) continue;
    const date = liability.dueDay ? monthDay(month, liability.dueDay) : liability.dueDate;
    if (!validDate(date) || date.slice(0, 7) !== month) continue;
    const paid = rows(personalPayments).filter((p) => p.liabilityId === id && !["pending", "processing", "reversed", "cancelled", "canceled"].includes(p.status) && (p.date || p.paymentDate)?.slice(0, 7) === month).reduce((sum, p) => sum + cents(p.amount), 0);
    const balance = cents(liability.outstanding ?? liability.outstandingAmount);
    const planned = liability.monthlyPayment ? Math.min(balance + paid, cents(liability.monthlyPayment)) : balance + paid;
    const remain = liability.monthlyPayment ? Math.min(balance, Math.max(0, cents(liability.monthlyPayment) - paid)) : balance;
    if (!remain) continue;
    addPlan({ key: `personalDebt:${id}:${date}`, sourceKind: "personal_debt", sourceId: id, direction: "expense", date, title: liability.title || "หนี้ส่วนตัว", plannedAmount: planned / 100, actualAmount: Math.min(planned, paid) / 100, remainingAmount: remain / 100, status: paid ? "partial" : "planned", category: "ชำระหนี้", liabilityId: id });
  }
  for (const [sourceKind, source, direction] of [["shared_debt", sharedReceivables, "income"], ["shared_debt", sharedPayables, "expense"]]) for (const [debtIndex, debt] of rows(source).entries()) {
    if (!okShared(debt) || debt.outstandingStatus === "unconfirmed" || !(Number(debt.outstandingAmount) > 0)) continue;
    const debtId = debt.id || `shared-${debtIndex}`;
    const installments = rows(debt.installments).filter((i) => i.status !== "paid" && i.status !== "cancelled" && validDate(i.dueDate)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (installments.length) {
      let cap = cents(debt.outstandingAmount);
      for (const [i, installment] of installments.entries()) {
        const amount = Math.min(cap, Math.max(0, cents(installment.amount) - cents(installment.paidAmount)));
        cap -= amount;
        if (!amount || installment.dueDate.slice(0, 7) !== month) continue;
        const id = installment.id || installment.sequence || installment.dueDate || i;
        addPlan({ key: `${sourceKind}:${debtId}:${id}`, sourceKind, sourceId: id, direction, date: installment.dueDate, title: debt.title || "หนี้ระหว่างบุคคล", plannedAmount: installment.amount, actualAmount: installment.paidAmount || 0, remainingAmount: amount / 100, status: installment.paidAmount ? "partial" : "planned", category: "เคลียร์กับคนอื่น", debtId });
      }
    } else if (debt.dueDateMode !== "none" && validDate(debt.dueDate) && debt.dueDate.slice(0, 7) === month) {
      addPlan({ key: `${sourceKind}:${debtId}:${debt.dueDate}`, sourceKind, sourceId: debtId, direction, date: debt.dueDate, title: debt.title || "หนี้ระหว่างบุคคล", plannedAmount: debt.outstandingAmount, category: "เคลียร์กับคนอื่น", debtId });
    }
  }
  const days = [...dayMap.values()];
  for (const day of days) {
    day.actualRows.sort((a, b) => a.key.localeCompare(b.key));
    day.pendingRows.sort((a, b) => a.key.localeCompare(b.key));
    day.pendingCount = day.pendingRows.length;
    day.actual.pendingCount = day.pendingCount;
    day.planRows.sort((a, b) => a.key.localeCompare(b.key));
    day.plan = planTotals(day.planRows);
  }
  const inMonthDays = days.filter((d) => d.inMonth);
  const sum = (mode) => {
    const accum = { income: 0, expense: 0, debtExpense: 0 };
    for (const day of inMonthDays) for (const row of day[`${mode}Rows`]) {
      const amount = cents(mode === "actual" ? row.amount : row.amount);
      if (row.direction === "income") accum.income += amount;
      else if (mode === "actual" ? row.sourceKind !== "manual" : ["personal_debt", "shared_debt"].includes(row.sourceKind)) accum.debtExpense += amount;
      else accum.expense += amount;
    }
    return materialize(accum);
  };
  return { month, days, totals: { actual: sum("actual"), plan: sum("plan"), pendingCount: days.filter((d) => d.inMonth).reduce((total, d) => total + d.pendingCount, 0) } };
}

const toCents = (value) => Math.round((Number(value) || 0) * 100);
const fromCents = (value) => value / 100;
const entries = (value) => Array.isArray(value) ? value : Object.entries(value || {}).map(([id, item]) => ({ id, ...item }));
const validDate = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);

function monthDate(month, day) {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(year, m, 0).getDate();
  return `${month}-${String(Math.min(Math.max(Number(day) || 1, 1), last)).padStart(2, "0")}`;
}
function shiftMonth(month, delta) {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getCycle(cycle, payday = 1) {
  if (cycle?.start && cycle?.end) return { start: cycle.start, end: cycle.end };
  const month = cycle?.selectedMonth || cycle?.month;
  if (!month) throw new TypeError("cycle requires start/end or selectedMonth");
  const start = monthDate(month, payday);
  const next = monthDate(shiftMonth(month, 1), payday);
  return { start, end: addDays(next, -1) };
}
function makeTransaction(item, source, direction, defaults = {}) {
  const date = item.date || item.paymentDate;
  if (!validDate(date) || !["income", "expense"].includes(direction) || !(Number(item.amount) > 0)) return null;
  const id = item.id || item.paymentId || "unknown";
  return {
    ...defaults,
    id: `${source}:${id}`,
    sourceKey: `${source}:${id}`,
    source,
    sourceId: defaults.sourceId || id,
    date,
    direction,
    amount: fromCents(toCents(item.amount)),
    title: item.title || item.name || item.liabilityTitle || item.debtTitle || (source === "personalPayment" ? "ชำระหนี้ของฉัน" : "รายการ"),
    category: item.category || (source === "personalPayment" ? "ชำระหนี้" : "อื่นๆ"),
    method: item.method || "",
    note: item.note || "",
    planRef: item.planRef || null,
    countsAsDebtPayment: source === "personalPayment" || source === "sharedPayment",
    status: item.status || "confirmed",
  };
}

/** Merge all money movements that count as actuals. Shared payments count only after confirmation. */
export function normalizeDailyTransactions({ manualTransactions = [], personalPayments = [], sharedPayments = [] } = {}) {
  const result = [];
  for (const item of entries(manualTransactions)) {
    const tx = makeTransaction(item, "manual", item.direction);
    if (tx) result.push(tx);
  }
  for (const item of entries(personalPayments)) {
    const tx = makeTransaction(item, "personalPayment", "expense", { liabilityId: item.liabilityId });
    if (tx) result.push(tx);
  }
  for (const item of entries(sharedPayments)) {
    if (item.status !== "confirmed") continue;
    const direction = item.direction === "income" || item.direction === "receivable" ? "income" : "expense";
    const paymentId = item.paymentId || item.id || "unknown";
    const tx = makeTransaction({ ...item, id: `${item.debtId || "debt"}:${paymentId}` }, "sharedPayment", direction, { debtId: item.debtId, sourceId: paymentId });
    if (tx) result.push(tx);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.sourceKey.localeCompare(b.sourceKey));
}
export const mergeDailyTransactions = normalizeDailyTransactions;

function inCycle(date, cycle) { return date >= cycle.start && date <= cycle.end; }
function addTotals(target, tx) {
  const cents = toCents(tx.amount);
  if (tx.direction === "income") target.incomeCents += cents;
  else if (tx.countsAsDebtPayment) target.debtExpenseCents += cents;
  else target.expenseCents += cents;
}
function materializeTotals(t) {
  const income = fromCents(t.incomeCents), expense = fromCents(t.expenseCents), debtExpense = fromCents(t.debtExpenseCents);
  return { income, expense, debtExpense, totalExpense: fromCents(t.expenseCents + t.debtExpenseCents), net: fromCents(t.incomeCents - t.expenseCents - t.debtExpenseCents) };
}

/** Build actual ledger summaries and remaining scheduled plan/debt amounts for one salary cycle. */
export function buildDailyCashflow({ manualTransactions = [], personalPayments = [], sharedPayments = [], debts = [], cycle, plans = {}, liabilities = [], cardStatements = {}, payday = 1 } = {}) {
  const bounds = getCycle(cycle, payday);
  const allTransactions = normalizeDailyTransactions({ manualTransactions, personalPayments, sharedPayments });
  const transactions = allTransactions.filter((t) => inCycle(t.date, bounds));
  const totalsAcc = { incomeCents: 0, expenseCents: 0, debtExpenseCents: 0 };
  const dayMap = {};
  transactions.forEach((tx) => {
    addTotals(totalsAcc, tx);
    const day = dayMap[tx.date] ||= { date: tx.date, incomeCents: 0, expenseCents: 0, debtExpenseCents: 0 };
    addTotals(day, tx);
  });
  const dayTotals = Object.fromEntries(Object.entries(dayMap).map(([date, value]) => [date, { date, ...materializeTotals(value) }]));
  const actualByOccurrence = new Map();
  allTransactions.forEach((tx) => {
    if (!tx.planRef?.id) return;
    const key = `${tx.planRef.kind}:${tx.planRef.id}:${tx.planRef.occurrenceDate || tx.date}`;
    const old = actualByOccurrence.get(key) || { cents: 0, complete: false };
    old.cents += toCents(tx.amount);
    old.complete ||= tx.planRef.completesOccurrence === true;
    actualByOccurrence.set(key, old);
  });
  const forecast = { planOccurrences: [], debtObligations: [], remainingIncome: 0, remainingExpense: 0, remainingDebt: 0 };
  for (const [kind, source] of [["income", plans.incomes || plans.income], ["expense", plans.expenses || plans.expense]]) {
    for (const item of entries(source)) {
      if (item.active === false) continue;
      let occurrenceDate;
      if (item.frequency === "once") occurrenceDate = item.date;
      else if (item.frequency === "monthly") {
        const [ym] = bounds.start.split("-");
        const startMonth = bounds.start.slice(0, 7), endMonth = bounds.end.slice(0, 7);
        const candidate = Number(item.dayOfMonth || 1) >= Number(payday) ? monthDate(startMonth, item.dayOfMonth) : monthDate(endMonth, item.dayOfMonth);
        occurrenceDate = candidate;
      } else continue;
      if (!validDate(occurrenceDate) || !inCycle(occurrenceDate, bounds)) continue;
      const occurrenceMonth = occurrenceDate.slice(0, 7);
      if ((item.startMonth && occurrenceMonth < item.startMonth) || (item.endMonth && occurrenceMonth > item.endMonth)) continue;
      const actual = actualByOccurrence.get(`${kind}:${item.id}:${occurrenceDate}`);
      const planned = toCents(item.amount);
      const remaining = actual?.complete ? 0 : Math.max(0, planned - (actual?.cents || 0));
      const row = { id: item.id, kind, title: item.name || item.title || "รายการ", date: occurrenceDate, plannedAmount: fromCents(planned), actualAmount: fromCents(actual?.cents || 0), remainingAmount: fromCents(remaining) };
      forecast.planOccurrences.push(row);
      if (kind === "income") forecast.remainingIncome += row.remainingAmount;
      else forecast.remainingExpense += row.remainingAmount;
    }
  }
  // Scheduled debt burden is the amount still unpaid, so recorded payments are never added back as full balances.
  for (const liability of entries(liabilities)) {
    if (liability.active === false) continue;
    if (liability.type === "credit_card" && liability.cardPaymentMode === "full_balance") {
      for (const [statementMonth, statement] of Object.entries(cardStatements[liability.id] || {})) {
        if (!validDate(statement.dueDate) || !inCycle(statement.dueDate, bounds)) continue;
        const remaining = Math.max(0, toCents(statement.amount) - toCents(statement.paidAmount));
        if (remaining) forecast.debtObligations.push({ id: `${liability.id}:${statementMonth}`, title: liability.title, date: statement.dueDate, amount: fromCents(remaining), kind: "cardStatement" });
      }
    } else {
      const balance = Math.max(0, toCents(liability.outstanding) || toCents(liability.outstandingAmount));
      const cyclePaid = entries(personalPayments).filter((payment) => payment.liabilityId === liability.id && validDate(payment.date) && inCycle(payment.date, bounds)).reduce((sum, payment) => sum + toCents(payment.amount), 0);
      const amount = liability.monthlyPayment ? Math.min(balance, Math.max(0, toCents(liability.monthlyPayment) - cyclePaid)) : balance;
      let dueDate = liability.dueDate;
      if (liability.dueDay) {
        const dueMonth = Number(liability.dueDay) >= Number(payday) ? bounds.start.slice(0, 7) : bounds.end.slice(0, 7);
        dueDate = monthDate(dueMonth, liability.dueDay);
      }
      if (amount && validDate(dueDate) && inCycle(dueDate, bounds)) forecast.debtObligations.push({ id: liability.id, title: liability.title, date: dueDate, amount: fromCents(amount), kind: "liability" });
    }
  }
  // Shared debts contribute only their next unpaid installment (or dated balance), capped by outstanding amount.
  for (const debt of entries(debts)) {
    if (["unconfirmed", "settled", "cancelled", "canceled", "archived"].includes(debt.outstandingStatus) || ["settled", "cancelled", "canceled", "archived"].includes(debt.status) || !(Number(debt.outstandingAmount) > 0)) continue;
    const installments = entries(debt.installments).filter((i) => i.status !== "paid" && validDate(i.dueDate)).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    let cap = toCents(debt.outstandingAmount);
    if (installments.length) {
      for (const installment of installments) {
        const amount = Math.min(cap, Math.max(0, toCents(installment.amount) - toCents(installment.paidAmount)));
        cap -= amount;
        if (amount && inCycle(installment.dueDate, bounds)) forecast.debtObligations.push({ id: `${debt.id}:${installment.id || installment.sequence || installment.dueDate}`, debtId: debt.id, title: debt.title, date: installment.dueDate, amount: fromCents(amount), kind: "sharedInstallment" });
      }
    } else if (debt.dueDateMode !== "none" && validDate(debt.dueDate) && inCycle(debt.dueDate, bounds)) {
      forecast.debtObligations.push({ id: debt.id, debtId: debt.id, title: debt.title, date: debt.dueDate, amount: fromCents(cap), kind: "sharedDebt" });
    }
  }
  forecast.debtObligations.sort((a, b) => a.date.localeCompare(b.date));
  forecast.remainingIncome = fromCents(toCents(forecast.remainingIncome));
  forecast.remainingExpense = fromCents(toCents(forecast.remainingExpense));
  forecast.remainingDebt = fromCents(forecast.debtObligations.reduce((sum, item) => sum + toCents(item.amount), 0));
  return { cycle: bounds, transactions, totals: materializeTotals(totalsAcc), dayTotals, forecast };
}

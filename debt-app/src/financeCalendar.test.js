import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceCalendar } from "./financeCalendar.js";

const day = (calendar, date) => calendar.days.find((item) => item.date === date);

test("calendar is Sunday-start, includes adjacent dates, and totals only the requested month", () => {
  const result = buildFinanceCalendar({ month: "2026-09", manualTransactions: [
    { id: "before", date: "2026-08-31", amount: 70, direction: "income" },
    { id: "inside", date: "2026-09-30", amount: 19.995, direction: "income" },
    { id: "after", date: "2026-10-01", amount: 40, direction: "expense" },
  ] });
  assert.equal(result.days.length, 35);
  assert.equal(result.days[0].date, "2026-08-30");
  assert.equal(result.days[0].inMonth, false);
  assert.equal(result.days.at(-1).date, "2026-10-03");
  assert.equal(day(result, "2026-09-30").actual.income, 20);
  assert.deepEqual(result.totals.actual, { income: 20, expense: 0, debtExpense: 0, totalExpense: 0, net: 20 });
});

test("rejects impossible Gregorian dates", () => {
  const result = buildFinanceCalendar({ month: "2026-02", manualTransactions: [
    { id: "impossible", date: "2026-02-30", amount: 50, direction: "income" },
    { id: "valid", date: "2026-02-28", amount: 1.25, direction: "income" },
  ] });
  assert.equal(result.totals.actual.income, 1.25);
  assert.equal(day(result, "2026-02-28").actualRows.length, 1);
});

test("four-week February still renders a five-week calendar grid", () => {
  const result = buildFinanceCalendar({ month: "2026-02" });
  assert.equal(result.days.length, 35);
  assert.equal(result.days[0].date, "2026-02-01");
  assert.equal(result.days.at(-1).date, "2026-03-07");
});

test("actual rows separate ordinary expense and debt, and pending or reversed payments do not affect totals", () => {
  const result = buildFinanceCalendar({ month: "2026-09",
    manualTransactions: [{ id: "m1", date: "2026-09-08", amount: 10.105, direction: "expense", title: "อาหาร", method: "cash" }],
    personalPayments: [
      { id: "p1", liabilityId: "loan", date: "2026-09-08", amount: 20.005, liabilityTitle: "สินเชื่อ" },
      { id: "p2", date: "2026-09-08", amount: 500, status: "reversed" },
    ],
    sharedPayments: [
      { paymentId: "s1", debtId: "d1", paymentDate: "2026-09-08", amount: 30, status: "confirmed", direction: "receivable" },
      { paymentId: "s2", debtId: "d1", paymentDate: "2026-09-08", amount: 40, status: "pending", direction: "receivable" },
      { paymentId: "s3", debtId: "d1", paymentDate: "2026-09-08", amount: 50, status: "reversed", direction: "payable" },
    ],
  });
  const selected = day(result, "2026-09-08");
  assert.deepEqual(selected.actualRows.map((row) => row.source).sort(), ["manual", "personalPayment", "sharedPayment"]);
  assert.equal(selected.actualRows.find((row) => row.source === "manual").sourceId, "m1");
  assert.equal(selected.actualRows.find((row) => row.source === "personalPayment").liabilityId, "loan");
  assert.equal(selected.actual.income, 30);
  assert.equal(selected.actual.expense, 10.11);
  assert.equal(selected.actual.debtExpense, 20.01);
  assert.equal(selected.actual.totalExpense, 30.12);
  assert.equal(selected.actual.pendingCount, 1);
  assert.equal(selected.pendingRows[0].amount, 40);
  assert.equal(result.totals.actual.net, -0.12);
});

test("plans include recurring and once items, subtract linked actuals, and preserve source identifiers", () => {
  const result = buildFinanceCalendar({ month: "2026-09",
    incomes: [{ id: "salary", name: "Salary", amount: 30000, frequency: "monthly", dayOfMonth: 25 }],
    expenses: [
      { id: "rent", name: "Rent", amount: 8000, frequency: "monthly", dayOfMonth: 1 },
      { id: "trip", name: "Trip", amount: 3000, frequency: "once", date: "2026-09-12" },
    ],
    manualTransactions: [{ id: "partial", date: "2026-09-02", amount: 5000, direction: "expense", planRef: { kind: "expense", id: "rent", occurrenceDate: "2026-09-01" } }],
  });
  const rent = day(result, "2026-09-01").planRows[0];
  assert.equal(rent.sourceKind, "expense_plan");
  assert.equal(rent.sourceId, "rent");
  assert.equal(rent.plannedAmount, 8000);
  assert.equal(rent.actualAmount, 5000);
  assert.equal(rent.remainingAmount, 3000);
  assert.equal(rent.amount, 3000);
  assert.equal(day(result, "2026-09-12").planRows[0].sourceKind, "expense_plan");
  assert.equal(day(result, "2026-09-25").planRows[0].direction, "income");
  assert.deepEqual(result.totals.plan, { income: 30000, expense: 6000, debtExpense: 0, totalExpense: 6000, net: 24000 });
});

test("debt plans use remaining statement, personal installment, and unpaid shared installment values", () => {
  const result = buildFinanceCalendar({ month: "2026-09",
    liabilities: [
      { id: "card", title: "Card", type: "credit_card", cardPaymentMode: "full_balance" },
      { id: "loan", title: "Loan", outstanding: 9000, monthlyPayment: 4000, dueDay: 9 },
    ],
    cardStatements: { card: { "2026-08": { amount: 5000, paidAmount: 1500, dueDate: "2026-09-03" } } },
    personalPayments: [{ id: "part", liabilityId: "loan", date: "2026-09-09", amount: 1200 }],
    sharedReceivables: [{ id: "r", title: "Friend owes me", outstandingAmount: 700, installments: { i1: { id: "i1", dueDate: "2026-09-14", amount: 700, paidAmount: 200 } } }],
    sharedPayables: [{ id: "p", title: "I owe friend", outstandingAmount: 500, dueDate: "2026-09-20", dueDateMode: "single" }],
  });
  const flat = result.days.flatMap((d) => d.planRows);
  assert.equal(flat.find((row) => row.liabilityId === "card").amount, 3500);
  assert.equal(flat.find((row) => row.liabilityId === "loan").amount, 2800);
  assert.equal("debtId" in flat.find((row) => row.liabilityId === "loan"), false);
  assert.equal(flat.find((row) => row.debtId === "r").amount, 500);
  assert.equal(flat.find((row) => row.debtId === "r").direction, "income");
  assert.equal(flat.find((row) => row.debtId === "p").amount, 500);
  assert.equal(flat.filter((row) => row.sourceKind === "shared_debt").length, 2);
  assert.equal(result.totals.plan.debtExpense, 6800);
  assert.equal(result.totals.plan.income, 500);
});

test("personal debt plan does not subtract a payment twice from an updated balance", () => {
  const result = buildFinanceCalendar({ month: "2026-09",
    liabilities: [{ id: "loan", title: "Loan", outstanding: 2800, monthlyPayment: 4000, dueDay: 9 }],
    personalPayments: [{ id: "part", liabilityId: "loan", date: "2026-09-09", amount: 1200 }],
  });
  const loan = day(result, "2026-09-09").planRows[0];
  assert.equal(loan.plannedAmount, 4000);
  assert.equal(loan.actualAmount, 1200);
  assert.equal(loan.remainingAmount, 2800);
});

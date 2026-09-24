import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyCashflow, normalizeDailyTransactions } from "./dailyCashflow.js";

test("unified actual ledger uses stable source keys, sorts dates, and excludes pending/reversed shared payments", () => {
  const rows = normalizeDailyTransactions({
    manualTransactions: [{ id: "m1", date: "2026-09-24", amount: 10.105, direction: "expense", title: "Snack" }],
    personalPayments: [{ id: "p1", date: "2026-09-23", amount: 20, liabilityTitle: "Card" }],
    sharedPayments: [
      { id: "s1", debtId: "d1", paymentDate: "2026-09-22", amount: 30, status: "confirmed", direction: "receivable" },
      { id: "s2", paymentDate: "2026-09-22", amount: 40, status: "pending", direction: "receivable" },
      { id: "s3", paymentDate: "2026-09-22", amount: 50, status: "reversed", direction: "receivable" },
    ],
  });
  assert.deepEqual(rows.map((r) => r.sourceKey), ["sharedPayment:d1:s1", "personalPayment:p1", "manual:m1"]);
  assert.equal(rows[0].direction, "income");
  assert.equal(rows[2].amount, 10.11);
});

test("cycle totals separate ordinary expenses from debt, and group actual amounts by day", () => {
  const result = buildDailyCashflow({
    cycle: { start: "2026-09-25", end: "2026-10-24" },
    manualTransactions: [
      { id: "i", date: "2026-09-25", amount: 29500, direction: "income" },
      { id: "e", date: "2026-09-25", amount: 100, direction: "expense" },
    ],
    personalPayments: [{ id: "p", date: "2026-09-25", amount: 1500 }],
    sharedPayments: [{ id: "s", paymentDate: "2026-09-24", amount: 700, direction: "receivable", status: "confirmed" }],
  });
  assert.deepEqual(result.totals, { income: 29500, expense: 100, debtExpense: 1500, totalExpense: 1600, net: 27900 });
  assert.equal(result.transactions.length, 3);
  assert.equal(result.dayTotals["2026-09-25"].net, 27900);
});

test("monthly and once plan forecasts honor partial fulfillment and completesOccurrence", () => {
  const result = buildDailyCashflow({
    cycle: { start: "2026-09-25", end: "2026-10-24" }, payday: 25,
    plans: {
      expenses: [
        { id: "rent", name: "Rent", amount: 8000, frequency: "monthly", dayOfMonth: 1 },
        { id: "trip", name: "Trip", amount: 3000, frequency: "once", date: "2026-10-05" },
      ],
      incomes: [{ id: "salary", name: "Salary", amount: 30000, frequency: "monthly", dayOfMonth: 25 }],
    },
    manualTransactions: [
      { id: "r1", date: "2026-10-01", amount: 5000, direction: "expense", planRef: { kind: "expense", id: "rent", occurrenceDate: "2026-10-01", completesOccurrence: false } },
      { id: "t1", date: "2026-10-05", amount: 2000, direction: "expense", planRef: { kind: "expense", id: "trip", occurrenceDate: "2026-10-05", completesOccurrence: true } },
    ],
  });
  assert.equal(result.forecast.planOccurrences.find((x) => x.id === "rent").remainingAmount, 3000);
  assert.equal(result.forecast.planOccurrences.find((x) => x.id === "trip").remainingAmount, 0);
  assert.equal(result.forecast.remainingIncome, 30000);
  assert.equal(result.forecast.remainingExpense, 3000);
});

test("forecast uses statement remaining and unpaid shared installment without counting payments twice", () => {
  const result = buildDailyCashflow({
    cycle: { start: "2026-09-25", end: "2026-10-24" },
    liabilities: [
      { id: "cc", title: "Card", type: "credit_card", cardPaymentMode: "full_balance" },
      { id: "loan", title: "Loan", outstanding: 10000, monthlyPayment: 4000, dueDate: "2026-10-04" },
    ],
    cardStatements: { cc: { "2026-09": { amount: 5000, paidAmount: 1500, dueDate: "2026-10-02" } } },
    debts: [{ id: "d1", title: "Friend", outstandingAmount: 900, installments: { i1: { amount: 800, paidAmount: 300, dueDate: "2026-10-06" } } }],
    personalPayments: [{ id: "p1", date: "2026-10-02", amount: 1500, liabilityId: "cc" }],
  });
  assert.equal(result.forecast.remainingDebt, 8000);
  assert.deepEqual(result.forecast.debtObligations.map((x) => x.amount).sort((a, b) => a - b), [500, 3500, 4000]);
});

test("partial loan payment reduces this cycle's remaining installment", () => {
  const result = buildDailyCashflow({
    cycle: { start: "2026-09-25", end: "2026-10-24" }, payday: 25,
    liabilities: [{ id: "loan", title: "Loan", outstanding: 8500, monthlyPayment: 4000, dueDay: 4 }],
    personalPayments: [{ id: "part", liabilityId: "loan", date: "2026-10-02", amount: 1500 }],
  });
  assert.equal(result.totals.debtExpense, 1500);
  assert.equal(result.forecast.remainingDebt, 2500);
});

test("an early payment linked to a later plan occurrence reduces that plan only", () => {
  const result = buildDailyCashflow({
    cycle: { start: "2026-09-25", end: "2026-10-24" }, payday: 25,
    plans: { expenses: [{ id: "rent", amount: 8000, frequency: "monthly", dayOfMonth: 1 }] },
    manualTransactions: [{ id: "early", date: "2026-09-24", direction: "expense", amount: 8000, planRef: { kind: "expense", id: "rent", occurrenceDate: "2026-10-01", completesOccurrence: true } }],
  });
  assert.equal(result.totals.expense, 0);
  assert.equal(result.forecast.remainingExpense, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { newPendingOrders, orderNotificationCopy } from "../src/orderNotifications.js";

test("newPendingOrders only returns pending orders absent from the previous snapshot", () => {
  const previous = [{ id: "old", status: "pending" }, { id: "paid", status: "paid" }];
  const next = [
    { id: "old", status: "pending" },
    { id: "paid", status: "pending" },
    { id: "new-pending", status: "pending" },
    { id: "new-ready", status: "ready" },
  ];

  assert.deepEqual(newPendingOrders(previous, next).map((order) => order.id), ["new-pending"]);
});

test("orderNotificationCopy formats a compact Thai order notification", () => {
  assert.deepEqual(orderNotificationCopy({
    id: "order_abcdef", customerName: "มะลิ", total: 95, items: [{ qty: 2 }, { qty: 1 }],
  }), {
    title: "ออเดอร์ใหม่ #ABCDEF",
    body: "มะลิ · 3 รายการ · ฿95.00",
  });
});

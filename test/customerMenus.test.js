import test from "node:test";
import assert from "node:assert/strict";
import { removeUnavailableCartLines, visibleCustomerMenus } from "../src/customerMenus.js";

const menus = [
  { id: "open", name: "เมนูเปิดขาย", available: true },
  { id: "legacy", name: "เมนูข้อมูลเก่า" },
  { id: "closed", name: "เมนูปิดขาย", available: false },
];

test("customer menu list completely hides menus closed by admin", () => {
  assert.deepEqual(visibleCustomerMenus(menus).map((menu) => menu.id), ["open", "legacy"]);
});

test("event menu list requires both event access and an open menu", () => {
  assert.deepEqual(
    visibleCustomerMenus(menus, "event_1", ["open", "closed"]).map((menu) => menu.id),
    ["open"],
  );
});

test("closed menu is removed from a saved cart while a pass purchase is preserved", () => {
  const cart = [
    { lineId: "1", menuId: "open" },
    { lineId: "2", menuId: "closed" },
    { lineId: "3", menuId: "coffee_pass", promoKind: "coffee-pass-purchase" },
  ];

  assert.deepEqual(removeUnavailableCartLines(cart, visibleCustomerMenus(menus)).map((line) => line.lineId), ["1", "3"]);
});

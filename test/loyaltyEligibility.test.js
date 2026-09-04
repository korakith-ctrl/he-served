import test from "node:test";
import assert from "node:assert/strict";
import { loyaltyUnitsInOrder, menuEarnsLoyaltyBeans } from "../src/loyaltyEligibility.js";

test("legacy menus keep the old drink and food loyalty defaults", () => {
  assert.equal(menuEarnsLoyaltyBeans({ productType: "drink" }), true);
  assert.equal(menuEarnsLoyaltyBeans({ productType: "food" }), false);
});

test("an explicit menu setting overrides the product type default", () => {
  assert.equal(menuEarnsLoyaltyBeans({ productType: "drink", earnsLoyaltyBeans: false }), false);
  assert.equal(menuEarnsLoyaltyBeans({ productType: "food", earnsLoyaltyBeans: true }), true);
});

test("order loyalty units follow the current menu setting", () => {
  const order = { items: [
    { menuId: "coffee", productType: "drink", earnsLoyaltyBeans: true, qty: 2 },
    { menuId: "toast", productType: "food", earnsLoyaltyBeans: false, qty: 3 },
  ] };
  const menus = [
    { id: "coffee", productType: "drink", earnsLoyaltyBeans: false },
    { id: "toast", productType: "food", earnsLoyaltyBeans: true },
  ];
  assert.equal(loyaltyUnitsInOrder(order, menus), 3);
});

test("deleted menus fall back to the eligibility saved on the order item", () => {
  const order = { items: [{ menuId: "deleted", productType: "drink", earnsLoyaltyBeans: false, qty: 4 }] };
  assert.equal(loyaltyUnitsInOrder(order), 0);
});

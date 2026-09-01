import test from "node:test";
import assert from "node:assert/strict";
import { WHEEL_SEGMENTS, wheelPrizeDiscount, wheelPrizeLabel } from "../src/components/loyalty/wheelPrizes.js";

test("wheel exposes eight honest, equally likely slots", () => {
  assert.equal(WHEEL_SEGMENTS.length, 8);
  assert.equal(WHEEL_SEGMENTS.filter((prize) => prize.id === "discount-15").length, 2);
  assert.equal(WHEEL_SEGMENTS.filter((prize) => prize.id === "discount-20").length, 2);
});

test("free drink and fixed prizes never discount above the drink price", () => {
  assert.equal(wheelPrizeDiscount({ id:"free-drink", value:60 }, 75), 60);
  assert.equal(wheelPrizeDiscount({ id:"free-drink", value:60 }, 45), 45);
  assert.equal(wheelPrizeDiscount({ id:"discount-30", value:30 }, 20), 20);
});

test("half-price prize calculates to satang precision", () => {
  assert.equal(wheelPrizeDiscount({ id:"half-price", value:50 }, 65), 32.5);
  assert.equal(wheelPrizeLabel({ id:"half-price" }), "ลด 50% สำหรับเครื่องดื่ม 1 แก้ว");
});

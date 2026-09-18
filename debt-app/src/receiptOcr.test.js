import assert from "node:assert/strict";
import test from "node:test";
import { defaultReceiptItemIndexes, normalizeDebtReceiptOcr, receiptNote, selectedReceiptItems, validateReceiptImage } from "./receiptOcr.js";

test("normalizes the scanDebtReceipt callable contract", () => {
  const result = normalizeDebtReceiptOcr({
    merchantName: "ร้านทดสอบ",
    receiptDate: "2026-09-12",
    receiptNumber: "R-001",
    totalAmount: 245.5,
    suggestedTitle: "ค่าอาหารร้านทดสอบ",
    suggestedNote: "หารกับเพื่อน 2 คน",
    lineItems: [{ title: "อาหารกลางวัน", amount: 200, quantity: 2, unitPrice: 100, note: "ไม่เผ็ด", confidence: 0.95 }, { title: "น้ำ", amount: 45.5, confidence: 0.6 }],
  });
  assert.deepEqual(result, {
    merchantName: "ร้านทดสอบ", title: "ค่าอาหารร้านทดสอบ", amount: 245.5,
    receiptDate: "2026-09-12", receiptNumber: "R-001", suggestedNote: "หารกับเพื่อน 2 คน",
    items: [{ title: "อาหารกลางวัน", amount: 200, info: "จำนวน 2 · ราคา/หน่วย ฿100 · ไม่เผ็ด", confidence: 0.95 }, { title: "น้ำ", amount: 45.5, info: "", confidence: 0.6 }], confidence: 0,
  });
});

test("rejects unsupported receipt files and makes a useful receipt note", () => {
  assert.equal(validateReceiptImage({ type: "application/pdf", size: 100 }), "รองรับรูป JPG, PNG หรือ WebP เท่านั้น");
  assert.equal(validateReceiptImage({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 }), "รูปใบเสร็จต้องมีขนาดไม่เกิน 5MB");
  assert.equal(receiptNote("R-001", "ร้านทดสอบ"), "อ้างอิงใบเสร็จ (ร้าน: ร้านทดสอบ · เลขที่ใบเสร็จ: R-001)");
});

test("calculates the draft amount from selected receipt lines only", () => {
  const result = { amount: 999, items: [{ title: "A", amount: 120.25 }, { title: "B", amount: 80 }, { title: "C", amount: 0 }] };
  assert.deepEqual(selectedReceiptItems(result, [1]), { items: [{ title: "B", amount: 80 }], amount: 80 });
  assert.deepEqual(selectedReceiptItems(result, [2]), { items: [{ title: "C", amount: 0 }], amount: 0 });
  assert.deepEqual(selectedReceiptItems({ amount: 999, items: [] }, []), { items: [], amount: 999 });
});

test("only clearly read item names are selected by default", () => {
  const items = [
    { title: "ข้าว", amount: 60, confidence: 0.92 },
    { title: "น้?", amount: 20, confidence: 0.9 },
    { title: "ขนม", amount: 30, confidence: 0.62 },
  ];
  assert.deepEqual(defaultReceiptItemIndexes(items), [0]);
});

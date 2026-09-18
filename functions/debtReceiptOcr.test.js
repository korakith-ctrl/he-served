const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_IMAGE_BYTES,
  normalizeDebtReceiptImage,
  normalizeDebtReceiptResult,
} = require("./debtReceiptOcr");

test("receipt image accepts a supported matching data URL and strips its prefix", () => {
  const image = normalizeDebtReceiptImage("data:image/png;base64,aGVsbG8=", "image/png");
  assert.deepEqual(image, { data: "aGVsbG8=", mimeType: "image/png" });
});

test("receipt image rejects spoofed types, malformed base64, and oversized images", () => {
  assert.throws(() => normalizeDebtReceiptImage("aGVsbG8=", "image/gif"), /unsupported-mime/);
  assert.throws(() => normalizeDebtReceiptImage("data:image/jpeg;base64,aGVsbG8=", "image/png"), /mime-mismatch/);
  assert.throws(() => normalizeDebtReceiptImage("not base64", "image/jpeg"), /invalid-image/);
  const tooLarge = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1).toString("base64");
  assert.throws(() => normalizeDebtReceiptImage(tooLarge, "image/webp"), /image-too-large/);
});

test("receipt OCR output is bounded, date-checked, and stays an editable draft", () => {
  const result = normalizeDebtReceiptResult({
    merchantName: " ร้านทดสอบ\u0000 ",
    receiptDate: "2026-02-31",
    receiptNumber: " A-123 ",
    totalAmount: "120.129",
    suggestedTitle: "",
    suggestedNote: "  ใบเสร็จ A-123  ",
    lineItems: [
      { title: " ชานม ", amount: "55.555", quantity: 2, unitPrice: 27.777, confidence: 2, note: "  " },
      { title: "", amount: 9 },
    ],
  });
  assert.equal(result.merchantName, "ร้านทดสอบ");
  assert.equal(result.receiptDate, "");
  assert.equal(result.totalAmount, 120.13);
  assert.equal(result.suggestedTitle, "ร้านทดสอบ");
  assert.equal(result.lineItems.length, 1);
  assert.deepEqual(result.lineItems[0], { title: "ชานม", amount: 55.56, quantity: 2, unitPrice: 27.78, confidence: 1, note: "" });
});

test("receipt OCR suppresses very uncertain item names", () => {
  const result = normalizeDebtReceiptResult({
    lineItems: [
      { title: "ชื่อที่โมเดลเดา", amount: 50, confidence: 0.3 },
      { title: "กาแฟ", amount: 60, confidence: 0.8 },
    ],
  });
  assert.deepEqual(result.lineItems.map((item) => item.title), ["กาแฟ"]);
});

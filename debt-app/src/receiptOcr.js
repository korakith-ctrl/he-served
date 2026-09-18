const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateReceiptImage(file) {
  if (!file) return "กรุณาเลือกรูปใบเสร็จ";
  if (!RECEIPT_IMAGE_TYPES.has(file.type)) return "รองรับรูป JPG, PNG หรือ WebP เท่านั้น";
  if (file.size <= 0 || file.size > MAX_RECEIPT_BYTES) return "รูปใบเสร็จต้องมีขนาดไม่เกิน 5MB";
  return "";
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    reader.onload = () => {
      const value = String(reader.result || "");
      const base64 = value.includes(",") ? value.split(",").slice(1).join(",") : value;
      if (!base64) reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
      else resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function cleanText(value, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

function isoDate(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function itemInfo(item) {
  const details = [];
  const quantity = Number(item?.quantity);
  const unitPrice = validAmount(item?.unitPrice);
  const note = cleanText(item?.note, 240);
  if (Number.isFinite(quantity) && quantity > 0) details.push(`จำนวน ${quantity}`);
  if (unitPrice) details.push(`ราคา/หน่วย ฿${unitPrice.toLocaleString("th-TH")}`);
  if (note) details.push(note);
  return details.join(" · ").slice(0, 300);
}

/** Normalize the callable response so UI changes stay resilient to incomplete OCR. */
export function normalizeDebtReceiptOcr(payload) {
  const data = payload?.data || payload || {};
  const merchantName = cleanText(data.merchantName, 120);
  const items = (Array.isArray(data.lineItems) ? data.lineItems : [])
    .map((item) => ({
      title: cleanText(item?.title, 160),
      amount: validAmount(item?.amount),
      info: itemInfo(item),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
    }))
    .filter((item) => item.title || item.amount);
  const firstItem = items.find((item) => item.title)?.title || "";
  const amount = validAmount(data.totalAmount) || items.reduce((sum, item) => sum + item.amount, 0);
  const title = cleanText(data.suggestedTitle, 160) || (merchantName && firstItem ? `${merchantName} · ${firstItem}` : merchantName || firstItem);
  const receiptNumber = cleanText(data.receiptNumber, 120);
  const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));
  return { merchantName, title, amount: Math.round(amount * 100) / 100, receiptDate: isoDate(data.receiptDate), receiptNumber, suggestedNote: cleanText(data.suggestedNote, 500), items, confidence };
}

export function defaultReceiptItemIndexes(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({ item, index }))
    .filter(({ item }) => item.amount > 0 && item.confidence >= 0.75 && !item.title.includes("?"))
    .map(({ index }) => index);
}

export function selectedReceiptItems(result, selectedIndexes) {
  const items = Array.isArray(result?.items) ? result.items : [];
  if (!items.length) return { items: [], amount: validAmount(result?.amount) };
  const selected = new Set(Array.isArray(selectedIndexes) ? selectedIndexes : []);
  const chosenItems = items.filter((_, index) => selected.has(index));
  const amount = chosenItems.reduce((sum, item) => sum + validAmount(item?.amount), 0);
  return { items: chosenItems, amount: Math.round(amount * 100) / 100 };
}

export function receiptNote(receiptNumber, merchantName) {
  const parts = [];
  if (merchantName) parts.push(`ร้าน: ${merchantName}`);
  if (receiptNumber) parts.push(`เลขที่ใบเสร็จ: ${receiptNumber}`);
  return parts.length ? `อ้างอิงใบเสร็จ (${parts.join(" · ")})` : "";
}

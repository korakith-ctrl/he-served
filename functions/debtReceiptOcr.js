const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const DEBT_RECEIPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    merchantName: { type: "STRING" },
    receiptDate: { type: "STRING", description: "YYYY-MM-DD, or empty when unreadable" },
    receiptNumber: { type: "STRING" },
    totalAmount: { type: "NUMBER", description: "Final amount paid, in THB when the receipt is in baht" },
    suggestedTitle: { type: "STRING", description: "A short, editable Thai debt title based only on readable receipt information" },
    suggestedNote: { type: "STRING", description: "A short, editable Thai note with receipt metadata only when readable" },
    lineItems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Exact verbatim item text visible on the receipt; never translate, expand abbreviations, correct spelling, or infer a product name" },
          amount: { type: "NUMBER", description: "Final total for this entire line after quantity and line discount, not the per-unit price" },
          quantity: { type: "NUMBER" },
          unitPrice: { type: "NUMBER" },
          confidence: { type: "NUMBER", description: "0 to 1 confidence that every character in title was read correctly" },
          note: { type: "STRING" },
        },
        required: ["title", "amount", "quantity", "unitPrice", "confidence", "note"],
      },
    },
  },
  required: ["merchantName", "receiptDate", "receiptNumber", "totalAmount", "suggestedTitle", "suggestedNote", "lineItems"],
};

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function cleanMoney(value) {
  const amount = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(amount) && amount >= 0 && amount <= 100000000 ? amount : 0;
}

function cleanNumber(value, max = 1000000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? Math.round(number * 1000) / 1000 : 0;
}

// Callable requests have a finite payload budget. Validate the original base64
// string before handing it to the model; never persist or log receipt pixels.
function normalizeDebtReceiptImage(imageBase64, mimeType) {
  const normalizedMimeType = String(mimeType || "").toLowerCase();
  if (!SUPPORTED_MIME_TYPES.has(normalizedMimeType)) throw new Error("unsupported-mime");
  if (typeof imageBase64 !== "string") throw new Error("invalid-image");
  const dataUrl = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(imageBase64);
  if (dataUrl && dataUrl[1].toLowerCase() !== normalizedMimeType) throw new Error("mime-mismatch");
  const data = dataUrl ? dataUrl[2] : imageBase64;
  if (!data || data.length > MAX_BASE64_CHARS || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("invalid-image");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  if (Math.floor(data.length * 3 / 4) - padding > MAX_IMAGE_BYTES) throw new Error("image-too-large");
  return { data, mimeType: normalizedMimeType };
}

function normalizeDebtReceiptResult(parsed) {
  const merchantName = cleanText(parsed?.merchantName, 200);
  const receiptDate = isValidDate(parsed?.receiptDate) ? parsed.receiptDate : "";
  const receiptNumber = cleanText(parsed?.receiptNumber, 120);
  const totalAmount = cleanMoney(parsed?.totalAmount);
  const lineItems = (Array.isArray(parsed?.lineItems) ? parsed.lineItems : []).slice(0, 100).map((item) => {
    const confidence = Math.min(1, Math.max(0, Number(item?.confidence) || 0));
    return {
      // Suppress very uncertain names instead of passing a likely invention to
      // the debt draft. Moderately uncertain text remains visible for review.
      title: confidence >= 0.5 ? cleanText(item?.title, 160) : "",
      amount: cleanMoney(item?.amount),
      quantity: cleanNumber(item?.quantity),
      unitPrice: cleanMoney(item?.unitPrice),
      confidence,
      note: cleanText(item?.note, 240),
    };
  }).filter((item) => item.title);
  const suggestedTitle = cleanText(parsed?.suggestedTitle, 160) || merchantName || "รายการจากใบเสร็จ";
  const suggestedNote = cleanText(parsed?.suggestedNote, 500);
  return { merchantName, receiptDate, receiptNumber, totalAmount, suggestedTitle, suggestedNote, lineItems };
}

const debtReceiptPrompt = `Transcribe this Thai or English receipt conservatively to prepare an editable debt draft. Item title is OCR evidence: copy the exact characters visibly printed on the receipt. Never translate, paraphrase, expand an abbreviation, correct spelling, substitute a familiar product, or infer a missing word from context. If one or two characters are unclear, put ? at those exact positions and lower confidence. If most of a name is unclear, omit that line entirely. Do not reconstruct clipped or blurred text. Return merchant name, receipt date (convert Buddhist Era to Gregorian YYYY-MM-DD), receipt number, final total, and readable purchased product/service lines only. For each line, amount must be the final total of the whole line after quantity and any line-level discount; unitPrice is the price of one unit. Do not put a per-unit price in amount when quantity is greater than one. Exclude subtotal, VAT, service charge, receipt-wide discounts, payment method and change lines. For unreadable numeric values return 0; never guess. Confidence must represent confidence that every character in title is correct, not confidence about the receipt overall. suggestedTitle and suggestedNote must use only clearly readable text. Do not return addresses, phone numbers, tax IDs, card/bank details, QR data, or other personal data. The result is a draft and must be reviewed before creating a debt.`;

module.exports = {
  DEBT_RECEIPT_SCHEMA,
  MAX_IMAGE_BYTES,
  SUPPORTED_MIME_TYPES,
  debtReceiptPrompt,
  normalizeDebtReceiptImage,
  normalizeDebtReceiptResult,
};

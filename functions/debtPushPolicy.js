const DEFAULTS = { reminders: true, activity: true, reminderTime: '09:00', quietStart: '21:00', quietEnd: '08:00', pausedUntil: 0, showSensitivePreview: false };
const timeValid = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function localClock(now = Date.now()) {
  const iso = new Date(now + 7 * 3600000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
function quiet(prefs, time) {
  const { quietStart: a, quietEnd: b } = { ...DEFAULTS, ...prefs };
  return a === b ? false : a < b ? time >= a && time < b : time >= a || time < b;
}
function reminders(debt, payments, date) {
  if (debt?.status !== 'active' || !debt.debtorUid || Number(debt.outstandingAmount) <= 0) return [];
  const rows = debt.installments ? Object.entries(debt.installments).sort((a,b) => a[1].sequence-b[1].sequence).map(([id,x]) => ({ id, ...x, remaining: Math.max(0, Number(x.amount)-Number(x.paidAmount || 0)) })) : [{ id: 'once', dueDate: debt.dueDate, remaining: Number(debt.outstandingAmount) }];
  for (const p of Object.values(payments || {})) {
    if (!['pending', 'processing'].includes(p.status)) continue;
    let left = Number(p.amount) || 0;
    for (const row of rows) {
      if (p.targetInstallmentId && p.targetInstallmentId !== row.id) continue;
      const applied = Math.min(left, row.remaining); row.remaining -= applied; left -= applied;
    }
  }
  return rows.flatMap(row => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate || '') || row.remaining <= 0) return [];
    const days = Math.round((Date.parse(row.dueDate)-Date.parse(date))/86400000);
    if (![3,0,-1].includes(days)) return [];
    return [{ installmentId: row.id, dueDate: row.dueDate, stage: String(days), remaining: row.remaining, title: days === 3 ? 'ใกล้ถึงวันชำระแล้ว' : days === 0 ? 'วันนี้มีรายการครบกำหนด' : 'ตรวจสอบสถานะการชำระ' }];
  });
}
module.exports = { DEFAULTS, timeValid, localClock, quiet, reminders };

const FIRED_KEY = "recomp-reminders-fired-v1";

export function notificationSupport() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export async function requestReminderPermission() {
  if (!notificationSupport()) return "unsupported";
  return Notification.requestPermission();
}

function localDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function firedMap() {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch { return {}; }
}

function minutes(value) {
  const [hour, minute] = String(value || "").split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

async function show(title, body, tag) {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, { body, tag, icon: "/icon.svg", badge: "/icon.svg", data: { url: "/#log" } });
}

export function startReminderScheduler({ getState, onDue }) {
  if (!notificationSupport()) return () => {};
  const check = async () => {
    if (Notification.permission !== "granted") return;
    const state = getState();
    const { year, month, day, hour, minute, weekday } = localDateParts();
    const today = `${year}-${month}-${day}`;
    const time = `${hour}:${minute}`;
    const log = state.logs?.find(item => item.date === today) || {};
    const reminders = [
      { key: "morningWeighIn", title: "ชั่งน้ำหนักตอนเช้า", body: "ใช้เวลาไม่ถึงหนึ่งนาที และช่วยให้ค่าเฉลี่ยสัปดาห์แม่นขึ้น", due: log.weight == null },
      { key: "proteinReminder", title: "เช็กโปรตีนวันนี้", body: `วันนี้บันทึก ${Math.round(Number(log.protein) || 0)} / ${state.profile.proteinMin} g`, due: Number(log.protein || 0) < state.profile.proteinMin },
      { key: "workoutReminder", title: "Workout ตามแผนวันนี้", body: "เปิด Workout tracker แล้วบันทึกเฉพาะเซตที่ทำจริง", due: state.preferences.workoutDays.includes(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(weekday)) && !log.workout },
      { key: "weeklyReview", title: "Weekly Review พร้อมแล้ว", body: "ดูแนวโน้ม 7 วันและแผนที่ควรทำต่อในสัปดาห์หน้า", due: weekday === "Sun" },
    ];
    const fired = firedMap();
    for (const reminder of reminders) {
      const scheduled = state.preferences.reminderTimes?.[reminder.key];
      const id = `${state.profile.id}:${today}:${reminder.key}`;
      const scheduledMinutes = minutes(scheduled);
      const delay = scheduledMinutes == null ? null : minutes(time) - scheduledMinutes;
      if (!state.preferences[reminder.key] || !reminder.due || delay == null || delay < 0 || delay > 15 || fired[id]) continue;
      await show(reminder.title, reminder.body, id);
      fired[id] = new Date().toISOString();
      localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
      onDue?.(reminder.title);
    }
  };
  check();
  const timer = window.setInterval(check, 30_000);
  return () => window.clearInterval(timer);
}

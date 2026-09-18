const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onValueCreated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { DEFAULTS, timeValid, localClock, quiet, reminders } = require('./debtPushPolicy');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const validId = s => typeof s === 'string' && /^[\w-]{1,160}$/.test(s);
module.exports = ({ admin, db, options, requiredUser, rateLimit }) => {
  const api = {};
  const callable = (name, fn) => onCall(options, async request => {
    const { uid } = requiredUser(request);
    await rateLimit(uid, name, name === 'sendDebtPushTest' ? 3 : name === 'refreshDebtReminders' ? 8 : 60, 3600000);
    return fn(uid, request.data || {});
  });
  api.registerDebtPushDevice = callable('registerDebtPushDevice', async (uid, data) => {
    if (!validId(data.installationId) || typeof data.token !== 'string' || data.token.length < 40 || data.token.length > 4096) throw new HttpsError('invalid-argument', 'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
    const device = db.ref(`debtPushInstallations/${data.installationId}`);
    const result = await device.transaction(current => {
      if (current && current.uid !== uid) return;
      return { uid, token: data.token, label: String(data.label || 'Web').slice(0,80), updatedAt: Date.now() };
    });
    if (!result.committed) throw new HttpsError('failed-precondition', 'กรุณาปิดแจ้งเตือนของบัญชีเดิมก่อน');
    await db.ref(`debtPushDeviceMembers/${uid}/${data.installationId}`).set(true);
    await db.ref(`debtPushPreferences/${uid}`).transaction(p => p || DEFAULTS);
    return { enabled: true };
  });
  api.disableDebtPushDevice = callable('disableDebtPushDevice', async (uid, data) => {
    if (!validId(data.installationId)) throw new HttpsError('invalid-argument', 'ข้อมูลอุปกรณ์ไม่ถูกต้อง');
    await db.ref(`debtPushInstallations/${data.installationId}`).transaction(p => p?.uid === uid ? null : undefined);
    await db.ref(`debtPushDeviceMembers/${uid}/${data.installationId}`).remove();
    return { enabled: false };
  });
  api.getDebtPushDevices = callable('getDebtPushDevices', async uid => {
    const ids = Object.keys((await db.ref(`debtPushDeviceMembers/${uid}`).get()).val() || {});
    const devices = await Promise.all(ids.map(async id => {
      const d = (await db.ref(`debtPushInstallations/${id}`).get()).val();
      return d?.uid === uid ? { id, label: d.label, updatedAt: d.updatedAt } : null;
    }));
    return { devices: devices.filter(Boolean), preferences: { ...DEFAULTS, ...(await db.ref(`debtPushPreferences/${uid}`).get()).val() } };
  });
  api.updateDebtPushPreferences = callable('updateDebtPushPreferences', async (uid, data) => {
    const p = {};
    for (const key of ['reminders','activity','showSensitivePreview']) {
      if (typeof data[key] !== 'boolean') throw new HttpsError('invalid-argument', 'ค่าการแจ้งเตือนไม่ถูกต้อง');
      p[key] = data[key];
    }
    for (const key of ['reminderTime','quietStart','quietEnd']) {
      if (!timeValid(data[key])) throw new HttpsError('invalid-argument', 'เวลาไม่ถูกต้อง');
      p[key] = data[key];
    }
    if (!Number.isFinite(data.pausedUntil) || data.pausedUntil < 0 || data.pausedUntil > Date.now()+8*86400000) throw new HttpsError('invalid-argument', 'ช่วงพักไม่ถูกต้อง');
    p.pausedUntil = data.pausedUntil;
    await db.ref(`debtPushPreferences/${uid}`).set(p);
    return p;
  });
  async function send(uid, id, notification, tag, ttl, sensitive = false) {
    const members = (await db.ref(`debtPushDeviceMembers/${uid}`).get()).val() || {};
    for (const installationId of Object.keys(members)) {
      const deviceRef = db.ref(`debtPushInstallations/${installationId}`);
      const d = (await deviceRef.get()).val();
      if (d?.uid !== uid) continue;
      const delivery = db.ref(`debtPushDeliveries/${hash(`${uid}:${tag}:${installationId}`)}`);
      const claim = await delivery.transaction(v => v?.sentAt || v?.leaseUntil > Date.now() ? undefined : { leaseUntil: Date.now()+120000, expiresAt: Date.now()+7*86400000 });
      if (!claim.committed) {
        if (claim.snapshot.val()?.sentAt) continue;
        throw new Error('Delivery lease is active');
      }
      try {
        await admin.messaging().send({ token: d.token, data: { notificationId: id, uid, title: sensitive ? notification.title : 'เคลียร์กัน', body: sensitive ? notification.body : notification.generic || 'มีอัปเดตในรายการของคุณ เปิดดูรายละเอียดในเคลียร์กัน', tag }, webpush: { headers: { TTL: String(ttl), Urgency: 'normal' } } });
        await delivery.set({ sentAt: Date.now(), expiresAt: Date.now()+7*86400000 });
      } catch (error) {
        if (['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(error.code)) {
          const removed = await deviceRef.transaction(v => v?.uid === uid && v?.token === d.token ? null : undefined);
          if (removed.committed) await db.ref(`debtPushDeviceMembers/${uid}/${installationId}`).remove();
          else { await delivery.remove(); throw error; }
          await delivery.set({ sentAt: Date.now(), expiresAt: Date.now()+7*86400000 });
        } else { await delivery.remove(); throw error; }
      }
    }
  }
  api.sendDebtPushTest = callable('sendDebtPushTest', async (uid, data) => {
    if (!validId(data.installationId)) throw new HttpsError('invalid-argument','ข้อมูลอุปกรณ์ไม่ถูกต้อง');
    const d = (await db.ref(`debtPushInstallations/${data.installationId}`).get()).val();
    if (d?.uid !== uid) throw new HttpsError('failed-precondition','กรุณาเปิดการแจ้งเตือนก่อน');
    await admin.messaging().send({ token: d.token, data: { uid, title:'เคลียร์กัน', body:'เปิดการแจ้งเตือนเรียบร้อยแล้ว', tag:'clear-kan-test', notificationId:'' }, webpush:{ headers:{ TTL:'300' } } });
    return { sent: true };
  });
  api.queueDebtPush = onValueCreated({ region: options.region, ref: '/debtNotifications/{uid}/{id}', retry: true, maxInstances: 10 }, async event => {
    const n = event.data.val();
    if (['due_soon','overdue'].includes(n.type)) return; // Scheduler sends one daily summary.
    const {uid,id} = event.params;
    if ((await db.ref(`debtPushEventReceipts/${hash(`${uid}:${id}`)}`).get()).exists()) return;
    if (!(await db.ref(`debtPushDeviceMembers/${uid}`).get()).exists()) return;
    const created = Date.parse(n.createdAt);
    if (!Number.isFinite(created) || created+86400000 < Date.now()) return;
    await db.ref(`debtPushOutbox/${hash(`${uid}:${id}`)}`).transaction(v => v || { uid, id, nextAt: created+60000, expiresAt: created+86400000, attempts: 0 });
  });
  async function eligible(uid, n) {
    if (!n || n.readAt) return false;
    const d = (await db.ref(`debts/${n.debtId}`).get()).val();
    return d && [d.debtorUid,d.creditorUid].includes(uid) && !(await db.ref(`debtArchives/${uid}/${n.debtId}`).get()).exists();
  }
  async function generateReminders(uid, now = Date.now()) {
    const {date} = localClock(now);
    const ids = Object.keys((await db.ref(`debtMembers/${uid}`).get()).val() || {});
    const results = [];
    for (const debtId of ids) {
      const debt = (await db.ref(`debts/${debtId}`).get()).val();
      if (debt?.debtorUid !== uid || (await db.ref(`debtArchives/${uid}/${debtId}`).get()).exists()) continue;
      const payments = (await db.ref(`debtPayments/${debtId}`).get()).val();
      for (const r of reminders(debt, payments, date)) {
        const id = `push_due_${hash(`${uid}:${debtId}:${r.installmentId}:${r.dueDate}:${r.stage}`)}`;
        const n = { debtId, ...r, type: r.stage === '-1' ? 'overdue' : 'due_soon', title:r.title, body:`${debt.title} · ฿${r.remaining.toLocaleString('th-TH')}`, createdAt:new Date(now).toISOString(), readAt:null };
        await db.ref(`debtNotifications/${uid}/${id}`).transaction(v => v || n);
        const current = (await db.ref(`debtNotifications/${uid}/${id}`).get()).val();
        if (!current.readAt) results.push({id, ...n});
      }
    }
    return results;
  }
  api.refreshDebtReminders = callable('refreshDebtReminders', async uid => ({ created: (await generateReminders(uid)).length }));
  api.dispatchDebtPush = onSchedule({ schedule:'every 1 minutes', timeZone:'Asia/Bangkok', region: options.region, maxInstances:1, timeoutSeconds:540 }, async () => {
    const now = Date.now(), clock = localClock(now);
    const lease = db.ref('debtPushWorkerLease');
    const leaseId = crypto.randomUUID();
    const acquired = await lease.transaction(v => v?.until > now ? undefined : {id:leaseId,until:now+600000});
    if (!acquired.committed) return;
    try {
    const pending = (await db.ref('debtPushOutbox').orderByChild('nextAt').endAt(now).limitToFirst(200).get()).val() || {};
    const groups = {};
    for (const [key,job] of Object.entries(pending)) (groups[job.uid] ||= []).push({key,...job});
    for (const [uid,jobs] of Object.entries(groups)) {
      const p = { ...DEFAULTS, ...(await db.ref(`debtPushPreferences/${uid}`).get()).val() };
      const ready = [];
      for (const job of jobs) {
        const path = db.ref(`debtPushOutbox/${job.key}`);
        if (job.expiresAt <= now || !p.activity || p.pausedUntil > now) { await path.remove(); continue; }
        if (quiet(p, clock.time)) { await path.update({ nextAt:now+60000 }); continue; }
        const n = (await db.ref(`debtNotifications/${uid}/${job.id}`).get()).val();
        if (!await eligible(uid,n)) { await path.remove(); continue; }
        ready.push({...job,n});
      }
      if (!ready.length) continue;
      const batches = {};
      const newBatch = hash(ready.filter(j => !j.batch).map(j => j.key).sort().join(':'));
      for (const job of ready) {
        const batch = job.batch || newBatch;
        await db.ref(`debtPushOutbox/${job.key}`).update({ batch });
        (batches[batch] ||= []).push(job);
      }
      for (const [batch,items] of Object.entries(batches)) {
        try {
          const single = items.length === 1;
          await send(uid, single ? items[0].id : '', {
            ...items[0].n,
            generic: single ? undefined : 'มีหลายรายการอัปเดต เปิดดูในเคลียร์กัน',
          }, `activity-${batch}`, Math.max(1,Math.floor((Math.min(...items.map(j => j.expiresAt))-now)/1000)), p.showSensitivePreview && single);
          for (const job of items) {
            await db.ref(`debtPushEventReceipts/${job.key}`).set({expiresAt:job.expiresAt+86400000});
            await db.ref(`debtPushOutbox/${job.key}`).remove();
          }
        } catch {
          for (const job of items) await db.ref(`debtPushOutbox/${job.key}`).transaction(v => v ? {...v, attempts:v.attempts+1, nextAt:now+Math.min(3600000,60000*2**Math.min(v.attempts,6))} : undefined);
        }
      }
    }
    // Paginated preference scan; only accounts that opted in have preferences.
    let cursor = '';
    while (true) {
      let query = db.ref('debtPushPreferences').orderByKey().limitToFirst(100);
      if (cursor) query = query.startAfter(cursor);
      const page = (await query.get()).val() || {};
      const entries = Object.entries(page);
      if (!entries.length) break;
      for (const [uid,raw] of entries) {
        const p = {...DEFAULTS,...raw};
        if (!p.reminders || p.pausedUntil > now || clock.time < p.reminderTime || quiet(p,clock.time)) continue;
        const sent = db.ref(`debtPushDaily/${uid}`);
        if ((await sent.get()).val() === clock.date) continue;
        if (!(await db.ref(`debtPushDeviceMembers/${uid}`).get()).exists()) continue;
        const rows = await generateReminders(uid,now);
        if (!rows.length) continue;
        try {
          await send(uid,rows.length === 1 ? rows[0].id : '', {title:'รายการที่ต้องเคลียร์วันนี้',body:`มี ${rows.length} รายการให้ตรวจสอบ`,generic:'มีรายการถึงช่วงเตือนชำระ เปิดดูรายละเอียดในเคลียร์กัน'}, `reminder-${clock.date}`,7200,p.showSensitivePreview);
          await sent.set(clock.date);
        } catch { /* Stable delivery keys allow retry on next scheduled run. */ }
      }
      cursor = entries.at(-1)[0];
      if (entries.length < 100) break;
    }
    const receipts = (await db.ref('debtPushEventReceipts').orderByChild('expiresAt').endAt(now).limitToFirst(500).get()).val() || {};
    await Promise.all(Object.keys(receipts).map(id => db.ref(`debtPushEventReceipts/${id}`).remove()));
    const expired = (await db.ref('debtPushDeliveries').orderByChild('expiresAt').endAt(now).limitToFirst(500).get()).val() || {};
    await Promise.all(Object.keys(expired).map(id => db.ref(`debtPushDeliveries/${id}`).remove()));
    } finally { await lease.transaction(v => v?.id === leaseId ? null : undefined); }
  });
  return api;
};

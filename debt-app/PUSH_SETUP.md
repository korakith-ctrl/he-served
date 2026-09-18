# เปิดใช้ Push Notification ของเคลียร์กัน

โค้ดประกอบด้วยหน้าตั้งค่าในกระดิ่ง, Service Worker, API จัดการอุปกรณ์, คิว FCM และ scheduled function ตรวจรายการในเวลาประเทศไทย ยังต้องตั้งค่าและ deploy ก่อนรับ Push จริง

## ตั้งค่า Firebase และเว็บ

1. ใน Firebase project ของเคลียร์กัน เปิด Project settings → Cloud Messaging → Web Push certificates สร้างหรือใช้ key pair เดิม แล้วนำ **public key** ใส่ `VITE_FIREBASE_VAPID_KEY` ใน environment ของ Vercel project `clear-kan-debt-app` และ `.env.local` เมื่อต้องทดสอบในเครื่อง ห้ามใช้ private key ในตัวแปร `VITE_*`
2. ตั้งค่า Firebase ชุดอื่นตาม `.env.example` รวม `VITE_FIREBASE_MESSAGING_SENDER_ID` และ `VITE_FIREBASE_APPCHECK_SITE_KEY` ให้ตรง project เดียวกัน ต้องเปิด FCM Registration API และ Cloud Messaging API และตั้ง App Check สำหรับโดเมนที่ใช้งาน
3. ตรวจ region ของ Realtime Database ให้ตรง `queueDebtPush` ซึ่งเริ่มต้นใช้ `asia-southeast1` ตาม Functions เดิม ถ้า database อยู่ region อื่น ให้เปลี่ยน `region` ของ trigger นี้ให้ตรงฐานข้อมูลก่อน deploy; callable และ scheduler ใช้ region เดิมได้
4. Deploy Database Rules และเฉพาะ Functions ที่เกี่ยวข้องจากโฟลเดอร์หลัก:

```sh
npx firebase-tools deploy --project he-served --only database,functions:registerDebtPushDevice,functions:disableDebtPushDevice,functions:getDebtPushDevices,functions:updateDebtPushPreferences,functions:sendDebtPushTest,functions:queueDebtPush,functions:dispatchDebtPush,functions:refreshDebtReminders
```

5. Build และ deploy เว็บจาก `debt-app` ตามกระบวนการ Vercel เดิม ตรวจว่า `/debt-push-sw.js` ตอบ JavaScript จริง มี Cache-Control: no-cache และไม่ถูก rewrite เป็น HTML ใช้ HTTPS
6. เข้าสู่ระบบ → กระดิ่ง → เปิดการแจ้งเตือน → อนุญาต → ตั้งค่าการแจ้งเตือน → ส่งทดสอบบนอุปกรณ์นี้ บน iPhone/iPad ต้องเพิ่มไปยัง Home Screen และเปิดแอปจากไอคอนก่อน

Scheduled function ต้องใช้ project ที่รองรับ Cloud Functions/Cloud Scheduler และการเรียกใช้งานมีค่าใช้จ่ายตาม Firebase/Google Cloud ของ project

## พฤติกรรมที่พัฒนาแล้ว

- ใช้กล่อง `debtNotifications` เดิม ทั้ง callable และ scheduler ใช้กติกางวดชุดเดียวกัน เตือนก่อน 3 วัน วันครบกำหนด และหลัง 1 วัน; ไม่เตือนยอดที่ปิดแล้ว ไม่มีกำหนด หรือยอดที่แจ้งชำระรอตรวจครบงวด
- เตือนวันชำระรวมสูงสุดหนึ่ง Push ต่อบัญชีต่อวัน ส่งตามเวลาและช่วงพักที่ตั้งไว้; ใช้ Asia/Bangkok
- เหตุการณ์คู่สัญญารออย่างน้อย 60 วินาทีและรวมรายการที่พร้อมส่งในรอบเดียวกัน; scheduler ทำงานทุกนาที จึงไม่ได้ส่งแบบทันทีวินาทีต่อวินาที
- บนอุปกรณ์ที่เปิดแอปอยู่แสดงข้อความในแอป เบื้องหลังแสดงผ่าน `showNotification` จาก FCM data message เส้นทางเดียว ไม่ใช้ Firebase background display ซ้ำ
- กด Push เดี่ยวเปิดรายการหนี้หลังตรวจสิทธิ์; Push รวมเปิดกล่องแจ้งเตือน การเข้าถึง payment/request ย่อยยังผ่านรายละเอียดหนี้เดิม
- จัดการหมวด เวลา ช่วงพัก พัก 7 วัน รายละเอียดบนหน้าจอล็อก และปิดอุปกรณ์แต่ละเครื่องได้ สถานะเปิดสำเร็จต้องลงทะเบียน server แล้ว
- API บังคับ Auth/App Check/rate limit เก็บ token ไว้ใน path ที่ client อ่านไม่ได้; ปิดการผูกและ subscription เมื่อออกจากระบบ พร้อมเก็บ uid ที่อนุญาตไว้ใน Service Worker เพื่อกันข้อความค้างจากบัญชีเก่า
- คิวมี retry/backoff, delivery lease, worker lease, receipt กัน trigger ซ้ำ และการเก็บกวาด receipt ที่หมดอายุ การส่งยังเป็น at-least-once: หาก process หยุดหลัง FCM รับข้อความแต่ก่อนบันทึกผล ยังมีโอกาสซ้ำได้ ใช้ tag เดิมเพื่อลดการแสดงซ้ำ

## โครงสร้างข้อมูลจริง

- `debtPushPreferences/{uid}`: การตั้งค่าระดับบัญชี
- `debtPushInstallations/{installationId}`: เจ้าของ token และ metadata อุปกรณ์
- `debtPushDeviceMembers/{uid}/{installationId}`: ดัชนีอุปกรณ์ของบัญชี
- `debtPushOutbox/{eventHash}`: งานรอส่งพร้อม nextAt, expiresAt, attempts และ batch
- `debtPushDeliveries/{deliveryHash}`: lease/ผลส่งต่ออุปกรณ์
- `debtPushEventReceipts/{eventHash}`: ป้องกัน event trigger ที่กลับมาซ้ำหลังลบงานแล้ว
- `debtPushDaily/{uid}`: วันที่ส่งสรุปวันชำระล่าสุด
- `debtPushWorkerLease`: ป้องกัน scheduled invocations ซ้อนกัน

ทุก path ใหม่เป็น server-only และอ่าน metadata/ตั้งค่าผ่าน callable; ใส่ index สำหรับคิวและวันหมดอายุไว้ใน Database Rules แล้ว

รุ่นนี้สแกน preferences เป็นหน้าละ 100 บัญชี และโหลดรายการของสมาชิกโดยตรง ยังไม่ได้สร้างดัชนีวันครบกำหนดตามข้อเสนอใน NOTIFICATIONS_DESIGN.md สำหรับข้อมูลจำนวนมากควรเปลี่ยนไปใช้ดัชนี/แบ่งงาน scheduler ก่อนขยายจำนวนผู้ใช้ คิวประมวลผลสูงสุด 200 เหตุการณ์ต่อรอบ

## ตรวจสอบ

```sh
npm --prefix functions test
node --test debt-app/test/*.test.cjs
npm --prefix debt-app run build
```

การทดสอบอัตโนมัติครอบคลุมกติกาเวลา/งวด, การชำระรอตรวจ, privacy, batch/retry, สิทธิ์อุปกรณ์ และ Service Worker ผ่าน mock ไม่มีการส่ง FCM จริงและไม่ได้แทนการทดสอบ Firebase Emulator หรือมือถือจริง

ก่อนเปิดใช้งานให้ทดสอบ Android Chrome และ iPhone Home Screen: foreground/background, กดเปิดรายการหลัง login, ปฏิเสธสิทธิ์แล้วเปิดใหม่, สองบัญชีบนเครื่องเดียว, หลายอุปกรณ์, offline/logout, ช่วงพัก และข้อความที่อ่านก่อนส่ง Push ไม่สามารถรับประกันเวลาส่งถึงจากระบบปฏิบัติการได้

อ้างอิง: [Firebase FCM setup](https://firebase.google.com/docs/cloud-messaging/web/get-started), [การรับข้อความ](https://firebase.google.com/docs/cloud-messaging/web/receive-messages), [WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

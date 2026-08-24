# เคลียร์กัน — Debt App

เว็บเจ้าหนี้–ลูกหนี้ที่ deploy แยกจากแอปร้านกาแฟ แต่ใช้ Firebase Project เดียวกัน

รายการจ่ายครั้งเดียวเลือกได้ทั้งแบบระบุวันครบกำหนดและแบบ **ไม่มีกำหนดชำระ**; รายการแบบไม่มีกำหนดจะไม่ถูกนำไปสร้างการแจ้งเตือนวันครบกำหนด

แอปมีพื้นที่ **การเงินของฉัน** แยกจากข้อตกลงระหว่างบุคคล สำหรับบันทึกรายรับ รายจ่าย บัตรเครดิต สินเชื่อบ้าน รถ และหนี้ส่วนตัว พร้อมคำนวณกระแสเงินสดรายเดือน, DTI, รอบบิล และประวัติการชำระ ข้อมูลส่วนนี้เก็บใต้ `personalFinance/{uid}` และกฎฐานข้อมูลอนุญาตเฉพาะเจ้าของบัญชีเท่านั้น

บัตรเครดิตรองรับโหมด **จ่ายเต็มทุกเดือน** โดยเก็บยอดใบแจ้งหนี้แยกตามบัตรและเดือนใต้ `cardStatements/{liabilityId}/{yyyy-mm}` ยอดดังกล่าวจะเข้ากระแสเงินสดของเดือนนั้น และบัตรจะไม่ถูกปิดเมื่อชำระยอดรอบบิลครบ

ยอด **ต้องได้รับ** จากข้อตกลงระหว่างบุคคลจะเชื่อมเข้าพื้นที่การเงินส่วนตัวอัตโนมัติตามวันครบกำหนดของยอดครั้งเดียวหรือแต่ละงวด เพื่อใช้เป็นรายรับคาดการณ์ของเดือนนั้น โดยยังสามารถเปิดกลับไปยังรายการต้นทางได้

## รันในเครื่อง

1. คัดลอกค่าจาก `.env.local` ของโปรเจกต์หลักมาใส่ `debt-app/.env.local`
2. รันคำสั่ง:

```bash
cd debt-app
npm install
npm run dev
```

## Backend ที่ต้อง deploy

แอปใช้ callable functions ต่อไปนี้จาก `functions/index.js`:

- `createDebt`
- `getDebtInvitePreview` / `acceptDebtInvite` / `acceptDebtAgreement`
- `submitDebtPayment`
- `confirmDebtPayment`
- `rejectDebtPayment`
- `initializePunDebts`
- `setDebtOutstandingAmount`
- `requestDebtUpdate` / `respondDebtUpdate`
- `cancelDebt` / `archiveDebt` / `restoreDebt`
- `revokeDebtInvite` / `renewDebtInvite` / `declineDebtInvite`
- `openDebtDispute` / `resolveDebtDispute`
- `reverseDebtPayment` / `respondDebtConsent`
- `refreshDebtReminders` / `markDebtNotificationRead`

จากโฟลเดอร์หลักให้ deploy Functions และ Realtime Database Rules:

```bash
firebase deploy --only functions,database,storage
```

## Deploy เป็น Vercel Project แยก

1. สร้าง Project ใหม่ใน Vercel จาก Git repository เดียวกับแอปร้าน
2. ตั้ง **Root Directory** เป็น `debt-app`
3. Framework Preset เลือก **Vite**
4. เพิ่ม Environment Variables ชุดเดียวกับโปรเจกต์ร้านกาแฟ
   และ `VITE_FIREBASE_APPCHECK_SITE_KEY` สำหรับ reCAPTCHA Enterprise/App Check
5. Deploy แล้วนำ production domain ที่ได้ไปเพิ่มใน Firebase Console:
   **Authentication → Settings → Authorized domains**
6. ใน Vercel Project ใหม่ ไปที่ **Settings → Domains** แล้วผูกโดเมนหรือ subdomain สำหรับแอปนี้

ไฟล์ `vercel.json` รองรับ client-side routing และ refresh หน้าเว็บโดยตรงแล้ว

## Security

- Callable functions ของแอปหนี้บังคับ Firebase App Check และจำกัด `maxInstances`
- การเขียนข้อมูลหนี้ทั้งหมดผ่าน Cloud Functions พร้อม rate limit และ audit log
- สลิปชำระรองรับเฉพาะ JPG, PNG หรือ WebP ขนาดไม่เกิน 5MB และอ่านได้เฉพาะคู่สัญญา
- ข้อตกลงเก็บ version, SHA-256 digest, ตัวตนจาก Firebase และการกดยอมรับของคู่สัญญาแต่ละฝ่าย
- การเปลี่ยนยอดตั้งต้น ยกเลิกหนี้ แก้ข้อพิพาท และย้อนรายการรับชำระหลังเข้าร่วมแล้วต้องได้รับความยินยอมจากอีกฝ่าย

## การใช้เป็นหลักฐาน

ระบบช่วยเก็บหลักฐานอิเล็กทรอนิกส์และประวัติการยอมรับ แต่ไม่ได้รับรองว่าจะใช้บังคับคดีได้ในทุกกรณี อ่านข้อจำกัดและรายการที่ควรตรวจสอบก่อนใช้งานจริงได้ที่ [LEGAL_NOTICE.md](./LEGAL_NOTICE.md)

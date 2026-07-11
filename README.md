# ระบบหลังบ้านร้านกาแฟ — คู่มือทำให้ออนไลน์ฟรี

แอปนี้เก็บข้อมูลบน Firebase (ฟรี) และ deploy เป็นเว็บไซต์จริงด้วย Vercel (ฟรี)
ทำตามลำดับด้านล่าง ใช้เวลาประมาณ 20-30 นาที

---

## ขั้นตอนที่ 1: สร้างโปรเจกต์ Firebase (เก็บข้อมูล)

1. ไปที่ https://console.firebase.google.com แล้วล็อกอินด้วย Google account
2. กด **Add project** ตั้งชื่อ เช่น `my-coffee-shop` แล้วกด Continue จนเสร็จ (ปิด Google Analytics ก็ได้ ไม่จำเป็น)
3. ในเมนูซ้าย ไปที่ **Build > Authentication** กด **Get started**
   - เลือกแท็บ **Sign-in method** กด **Email/Password** แล้วเปิดใช้งาน (Enable) กด Save
4. ในเมนูซ้าย ไปที่ **Build > Firestore Database** กด **Create database**
   - เลือก **Start in production mode** แล้วเลือก location ที่ใกล้ที่สุด (เช่น `asia-southeast1`) กด Enable
5. ไปที่แท็บ **Rules** ของ Firestore แล้วลบของเดิมทิ้ง วางเนื้อหาจากไฟล์ `firestore.rules` ที่แนบมาด้วยแทน แล้วกด **Publish**
6. กลับไปหน้า Project overview กดไอคอนรูปเฟือง > **Project settings**
   - เลื่อนลงมาที่ "Your apps" กดไอคอน **</>** (Web) เพื่อสร้างเว็บแอป ตั้งชื่ออะไรก็ได้ กด Register app
   - จะเห็นโค้ด `firebaseConfig = {...}` **คัดลอกค่าทั้งหมดเก็บไว้** จะใช้ในขั้นตอนที่ 3

---

## ขั้นตอนที่ 2: อัปโหลดโค้ดขึ้น GitHub

1. ไปที่ https://github.com กด **New repository** ตั้งชื่อ เช่น `coffee-shop-manager` เลือก Private หรือ Public ก็ได้ กด Create repository
2. ในเครื่องของคุณ เปิด terminal ไปที่โฟลเดอร์นี้ (โฟลเดอร์ที่มีไฟล์ package.json) แล้วรัน:
   ```
   git init
   git add .
   git commit -m "coffee shop manager"
   git branch -M main
   git remote add origin https://github.com/<ชื่อบัญชีคุณ>/coffee-shop-manager.git
   git push -u origin main
   ```
   (ไฟล์ `.env` จะไม่ถูกอัปโหลดเพราะอยู่ใน `.gitignore` แล้ว ปลอดภัย)

---

## ขั้นตอนที่ 3: Deploy ด้วย Vercel (ฟรี)

1. ไปที่ https://vercel.com กด **Sign up** แล้วเลือก **Continue with GitHub** เพื่อเชื่อมบัญชี
2. กด **Add New... > Project** เลือก repo `coffee-shop-manager` ที่เพิ่ง push ไป กด **Import**
3. ในหน้า Configure Project เลื่อนลงมาที่ **Environment Variables** ใส่ค่าจาก `firebaseConfig` ที่คัดลอกไว้ในขั้นตอนที่ 1 ทีละตัว (ชื่อซ้ายต้องตรงเป๊ะ):

   | Name | Value |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | ค่า apiKey |
   | `VITE_FIREBASE_AUTH_DOMAIN` | ค่า authDomain |
   | `VITE_FIREBASE_PROJECT_ID` | ค่า projectId |
   | `VITE_FIREBASE_STORAGE_BUCKET` | ค่า storageBucket |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | ค่า messagingSenderId |
   | `VITE_FIREBASE_APP_ID` | ค่า appId |

4. กด **Deploy** รอประมาณ 1-2 นาที เสร็จแล้วจะได้ลิงก์เว็บ เช่น `https://coffee-shop-manager.vercel.app` — เปิดจากมือถือหรือคอมที่ไหนก็ได้ ฟรีตลอดไป (ในระดับการใช้งานร้านเล็ก ๆ)

---

## ขั้นตอนที่ 4: สร้างบัญชีร้านของคุณ

1. เปิดลิงก์เว็บที่ได้จาก Vercel
2. หน้าแรกจะเป็นหน้า **เข้าสู่ระบบ** — กด "ยังไม่มีบัญชี? สมัครใหม่" ใส่อีเมล+รหัสผ่านของคุณ กด **สมัครบัญชี**
3. ระบบจะพาเข้าแอปทันที พร้อมข้อมูลตั้งต้น (วัตถุดิบ/เมนู) ให้แก้ไขต่อได้เลย

**สำคัญ (ความปลอดภัย):** กฎ Firestore ที่ตั้งไว้ (`firestore.rules`) ล็อกให้แต่ละบัญชีเห็นเฉพาะข้อมูลร้านของตัวเองอยู่แล้ว ต่อให้มีคนอื่นสมัครบัญชีใหม่ในเว็บนี้ ก็จะเห็นแค่ร้านของเขาเอง (เริ่มจากข้อมูลตั้งต้นเปล่า ๆ) ไม่เห็นข้อมูลร้านคุณ — ถ้าอยากปิดไม่ให้คนอื่นสมัครบัญชีในเว็บได้เลย ให้ไปที่ Firebase Console > Authentication > Sign-in method > Email/Password แล้วปิดเฉพาะช่องทาง "สมัครสมาชิกเอง" หรือลบปุ่มสมัครออกจาก `src/Login.jsx` ทีหลังได้

---

## ทดสอบก่อน deploy จริง (ทางเลือก)

ถ้าอยากลองรันในเครื่องก่อน:
```
npm install
cp .env.example .env.local
# แก้ .env.local ใส่ค่า firebaseConfig ให้ครบ
npm run dev
```
เปิด http://localhost:5173

---

## ข้อจำกัดที่ควรรู้

- แผนฟรีของ Firebase (Spark plan) และ Vercel (Hobby plan) เพียงพอสำหรับร้านกาแฟร้านเดียวสบาย ๆ — จะมีค่าใช้จ่ายก็ต่อเมื่อมีการอ่าน/เขียนข้อมูลปริมาณสูงมากในระดับหลักหมื่นครั้งต่อวันขึ้นไป
- ข้อมูลทั้งร้าน (วัตถุดิบ เมนู ประวัติขาย) เก็บเป็นเอกสารเดียวใน Firestore ต่อบัญชี ถ้าในอนาคตมีประวัติการขายสะสมหลายหมื่นรายการ อาจต้องแยกเก็บ "ประวัติการขาย" เป็นคอลเลกชันย่อยเพื่อประสิทธิภาพที่ดีขึ้น — ทักมาได้เมื่อถึงจุดนั้น
- ตอนนี้รองรับ 1 บัญชีต่อร้าน (เจ้าของร้านคนเดียวใช้) ถ้าต้องการให้พนักงานหลายคน login แยกกันแต่ดูข้อมูลร้านเดียวกัน ต้องปรับโครงสร้างสิทธิ์เพิ่มเติม

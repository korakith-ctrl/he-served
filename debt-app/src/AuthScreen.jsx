import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "./firebase";
import BrandMark from "./BrandMark";

const provider = new GoogleAuthProvider();

function authError(code) {
  if (["auth/invalid-credential", "auth/wrong-password"].includes(code)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (code === "auth/user-not-found") return "ไม่พบบัญชีนี้";
  if (code === "auth/email-already-in-use") return "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ";
  if (code === "auth/weak-password") return "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
  if (code === "auth/popup-closed-by-user") return "หน้าต่างเข้าสู่ระบบถูกปิดก่อนดำเนินการเสร็จ";
  return "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง";
}

export default function AuthScreen({ hasInvite }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signup") await createUserWithEmailAndPassword(auth, email.trim(), password);
      else await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(authError(err.code));
    } finally {
      setBusy(false);
    }
  }

  async function signInGoogle() {
    setBusy(true);
    setError("");
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(authError(err.code));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError("กรอกอีเมลก่อนขอลิงก์ตั้งรหัสผ่านใหม่");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว");
    } catch (err) {
      setError(authError(err.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="brand brand-light"><BrandMark /><span>เคลียร์กัน</span></div>
        <p className="eyebrow">SHARED DEBT NOTE</p>
        <h1>เรื่องเงินชัดเจน<br />ความสัมพันธ์ก็เบาลง</h1>
        <p className="story-copy">บันทึกยอดร่วมกัน ติดตามการจ่าย และเก็บหลักฐานไว้ในที่เดียว</p>
        <div className="story-card">
          <span className="story-icon">✓</span>
          <div><strong>เห็นข้อมูลชุดเดียวกัน</strong><small>ทุกการเปลี่ยนแปลงมีสถานะให้ทั้งสองฝ่ายตรวจสอบ</small></div>
        </div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="brand mobile-brand"><BrandMark /><span>เคลียร์กัน</span></div>
          {hasInvite && <div className="invite-notice">คุณได้รับคำเชิญให้ตรวจสอบรายการหนี้ เข้าสู่ระบบเพื่อเปิดรายการ</div>}
          <p className="eyebrow">{mode === "login" ? "ยินดีต้อนรับกลับ" : "เริ่มต้นใช้งาน"}</p>
          <h2>{mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชีใหม่"}</h2>
          <p className="muted">ใช้บัญชี Firebase เดียวกับแอปร้านกาแฟได้</p>

          <label>อีเมล</label>
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
          <label>รหัสผ่าน</label>
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" />

          {error && <div className="form-message error" role="alert">{error}</div>}
          {notice && <div className="form-message success" role="status">{notice}</div>}

          <button className="primary full" disabled={busy}>{busy ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}</button>
          {mode === "login" && <button type="button" className="text-button" onClick={resetPassword} disabled={busy}>ลืมรหัสผ่าน?</button>}

          <div className="or"><span />หรือ<span /></div>
          <button type="button" className="google-button" onClick={signInGoogle} disabled={busy}>
            <span className="google-g">G</span> ดำเนินการต่อด้วย Google
          </button>
          <button type="button" className="switch-auth" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setNotice(""); }}>
            {mode === "login" ? "ยังไม่มีบัญชี? สร้างบัญชี" : "มีบัญชีแล้ว? เข้าสู่ระบบ"}
          </button>
        </form>
      </section>
    </main>
  );
}

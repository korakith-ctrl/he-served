import { useState } from "react";
import { auth } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";

const googleProvider = new GoogleAuthProvider();

export default function Login() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(errorText(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function submitGoogle() {
    setError("");
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(errorText(err.code));
    } finally {
      setLoading(false);
    }
  }

  function errorText(code) {
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
    if (code === "auth/user-not-found") return "ไม่พบบัญชีนี้ ลองสมัครใหม่ก่อน";
    if (code === "auth/email-already-in-use") return "อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน";
    if (code === "auth/weak-password") return "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)";
    if (code === "auth/popup-closed-by-user") return "ปิดหน้าต่างล็อกอินก่อนเสร็จสิ้น";
    return "เกิดข้อผิดพลาด: " + code;
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#FAF6EE", fontFamily: "'Inter', sans-serif", color: "#3E2C20",
    }}>
      <form onSubmit={submit} style={{
        background: "#fff", border: "1px solid #E4DBC9", borderRadius: 16, padding: 28, width: 320,
      }}>
        <p style={{ margin: "0 0 2px", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#54663F", fontWeight: 500 }}>ระบบหลังบ้าน</p>
        <h1 style={{ margin: "0 0 18px", fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 24 }}>
          {mode === "login" ? "เข้าสู่ระบบ" : "สมัครบัญชีร้าน"}
        </h1>

        <label style={{ fontSize: 12, color: "#8A7A6B" }}>อีเมล</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", border: "1px solid #E4DBC9", borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 12, boxSizing: "border-box" }} />

        <label style={{ fontSize: 12, color: "#8A7A6B" }}>รหัสผ่าน</label>
        <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", border: "1px solid #E4DBC9", borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 14, boxSizing: "border-box" }} />

        {error && <p style={{ fontSize: 12, color: "#A33A3A", margin: "0 0 12px" }}>{error}</p>}

        <button type="submit" disabled={loading} style={{
          width: "100%", background: "#6E8256", color: "#fff", border: "none", borderRadius: 9,
          padding: "10px 0", fontSize: 13, fontWeight: 500, marginBottom: 10, cursor: "pointer",
        }}>
          {loading ? "กำลังดำเนินการ..." : mode === "login" ? "เข้าสู่ระบบ" : "สมัครบัญชี"}
        </button>

        <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} style={{
          width: "100%", background: "transparent", border: "none", color: "#8A7A6B", fontSize: 12, cursor: "pointer",
        }}>
          {mode === "login" ? "ยังไม่มีบัญชี? สมัครใหม่ (ทำครั้งเดียวตอนตั้งร้าน)" : "มีบัญชีแล้ว? เข้าสู่ระบบ"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#E4DBC9" }} />
          <span style={{ fontSize: 11, color: "#8A7A6B" }}>หรือ</span>
          <div style={{ flex: 1, height: 1, background: "#E4DBC9" }} />
        </div>

        <button type="button" onClick={submitGoogle} disabled={loading} style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          background: "#fff", color: "#3E2C20", border: "1px solid #E4DBC9", borderRadius: 9,
          padding: "10px 0", fontSize: 13, fontWeight: 500, cursor: "pointer",
        }}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3c-7.6 0-14.2 4.3-17.7 10.7z"/>
            <path fill="#4CAF50" d="M24 45c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.4C29.6 36.5 27 37.4 24 37.4c-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.7 40.6 16.3 45 24 45z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.4C41.4 35.9 45 30.4 45 24c0-1.2-.1-2.4-.4-3.5z"/>
          </svg>
          {mode === "login" ? "เข้าสู่ระบบด้วย Google" : "สมัครด้วย Google"}
        </button>
      </form>
    </div>
  );
}

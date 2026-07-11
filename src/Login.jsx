import { useState } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";

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

  function errorText(code) {
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
    if (code === "auth/user-not-found") return "ไม่พบบัญชีนี้ ลองสมัครใหม่ก่อน";
    if (code === "auth/email-already-in-use") return "อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน";
    if (code === "auth/weak-password") return "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)";
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
      </form>
    </div>
  );
}

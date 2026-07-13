import { useEffect, useRef, useState } from "react";

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 7) return digits;
  return `${digits.slice(0, 2)}X-XXX-${digits.slice(-4)}`;
}

export default function RewardOtpModal({
  open,
  phone,
  status,
  error,
  code,
  resendAvailableAt,
  onCodeChange,
  onSend,
  onVerify,
  onClose,
}) {
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (open && status === "code-sent") inputRef.current?.focus();
  }, [open, status]);

  if (!open) return null;

  const secondsLeft = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));
  const busy = status === "requesting" || status === "verifying";

  return (
    <div className="reward-otp-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        className="reward-otp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-otp-title"
        aria-describedby="reward-otp-description"
      >
        <button type="button" className="reward-otp-close" aria-label="ปิด" disabled={busy} onClick={onClose}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>

        <span className="reward-otp-icon" aria-hidden="true">
          <i className="ti ti-shield-lock" />
        </span>
        <h2 id="reward-otp-title">ยืนยันการใช้รางวัล</h2>

        {status === "idle" || status === "requesting" || status === "error" ? (
          <>
            <p id="reward-otp-description">
              เราจะส่งรหัส 6 หลักไปที่ <strong>{maskPhone(phone)}</strong>
            </p>
            <button type="button" className="reward-otp-primary" disabled={busy} onClick={onSend}>
              {status === "requesting" ? "กำลังส่งรหัส..." : "ส่งรหัส OTP"}
            </button>
          </>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); onVerify(); }}>
            <p id="reward-otp-description">
              กรอกรหัสที่ส่งไปยัง <strong>{maskPhone(phone)}</strong>
            </p>
            <input
              ref={inputRef}
              className="reward-otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-label="รหัส OTP 6 หลัก"
              disabled={busy}
              placeholder="000000"
            />
            <button type="submit" className="reward-otp-primary" disabled={busy || code.length !== 6}>
              {status === "verifying" ? "กำลังยืนยัน..." : "ยืนยันและใช้รางวัล"}
            </button>
            <button
              type="button"
              className="reward-otp-resend"
              disabled={busy || secondsLeft > 0}
              onClick={onSend}
            >
              {secondsLeft > 0 ? `ส่งรหัสอีกครั้งใน ${secondsLeft} วินาที` : "ส่งรหัสอีกครั้ง"}
            </button>
          </form>
        )}

        {error && <p className="reward-otp-error" role="alert">{error}</p>}
        <button type="button" className="reward-otp-skip" disabled={busy} onClick={onClose}>
          ไม่ใช้รางวัลตอนนี้
        </button>
        <div id="reward-otp-recaptcha" />
      </section>
    </div>
  );
}

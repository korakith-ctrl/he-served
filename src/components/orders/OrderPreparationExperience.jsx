import { useEffect, useRef, useState } from "react";
import "./order-preparation.css";

const PHASE_BY_STATUS = {
  pending: {
    id: "queued",
    eyebrow: "ORDER RECEIVED",
    title: "ส่งออเดอร์ถึงร้านแล้ว",
    detail: "ใบออเดอร์ของคุณอยู่ในคิว บาริสต้าจะตรวจสอบและยืนยันเร็ว ๆ นี้",
    icon: "receipt",
  },
  paid: {
    id: "accepted",
    eyebrow: "BARISTA CONFIRMED",
    title: "บาริสต้ารับออเดอร์แล้ว",
    detail: "กำลังเตรียมแก้ว วัตถุดิบ และอุปกรณ์สำหรับออเดอร์ของคุณ",
    icon: "checks",
  },
  preparing: {
    id: "accepted",
    eyebrow: "BARISTA CONFIRMED",
    title: "บาริสต้ารับออเดอร์แล้ว",
    detail: "กำลังเตรียมแก้ว วัตถุดิบ และอุปกรณ์สำหรับออเดอร์ของคุณ",
    icon: "checks",
  },
  ready: {
    id: "brewing",
    eyebrow: "CRAFTING YOUR DRINK",
    title: "กำลังทำเครื่องดื่มของคุณ",
    detail: "บาริสต้ากำลังชงและเก็บรายละเอียดให้ตรงกับออเดอร์",
    icon: "coffee",
  },
  done: {
    id: "complete",
    eyebrow: "READY FOR PICKUP",
    title: "เครื่องดื่มพร้อมแล้ว",
    detail: "แจ้งเลขออเดอร์นี้กับพนักงานเพื่อรับเครื่องดื่มได้เลย",
    icon: "circle-check",
  },
  cancelled: {
    id: "cancelled",
    eyebrow: "ORDER UPDATE",
    title: "ออเดอร์นี้ถูกยกเลิก",
    detail: "กรุณาติดต่อร้านหากต้องการสอบถามรายละเอียดเพิ่มเติม",
    icon: "x",
  },
};

const PREPARATION_VIDEO = "/order-preparation/espresso-brewing.mp4";
const PREPARATION_POSTER = "/order-preparation/espresso-brewing-poster.jpg";

function countItems(items) {
  return (items || []).reduce((sum, item) => sum + Math.max(1, Number(item?.qty) || 1), 0);
}

function heroItemLabel(items) {
  const entries = (items || []).filter(Boolean);
  if (entries.length === 0) return "เครื่องดื่มของคุณ";
  const first = entries[0];
  const total = countItems(entries);
  return total > Math.max(1, Number(first.qty) || 1)
    ? `${first.name} และอีก ${total - Math.max(1, Number(first.qty) || 1)} รายการ`
    : first.name;
}

export default function OrderPreparationExperience({ order, shopName, compact = false }) {
  const videoRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const phase = PHASE_BY_STATUS[order?.status] || PHASE_BY_STATUS.pending;
  const shortCode = String(order?.id || "").slice(-6).toUpperCase();
  const itemCount = countItems(order?.items);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener?.("change", updatePreference);
    return () => media.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const shouldPlay = phase.id === "brewing" && !reducedMotion;
    if (shouldPlay) {
      video.play().catch(() => {});
      return;
    }
    video.pause();
    if (phase.id === "complete" && Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.duration * 0.84);
    } else if (phase.id !== "complete") {
      video.currentTime = 0;
    }
  }, [phase.id, reducedMotion]);

  function settleVideoFrame() {
    const video = videoRef.current;
    if (!video || phase.id !== "complete" || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, video.duration * 0.84);
  }

  return (
    <section
      className={`order-preparation order-preparation--${phase.id}${compact ? " order-preparation--compact" : ""}`}
      aria-live="polite"
      aria-label={phase.title}
    >
      <div className="order-preparation__visual">
        <video
          ref={videoRef}
          className="order-preparation__video"
          src={PREPARATION_VIDEO}
          poster={PREPARATION_POSTER}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          onLoadedMetadata={settleVideoFrame}
        />
        <div className="order-preparation__grade" aria-hidden="true" />
        <div className="order-preparation__scan" aria-hidden="true" />
        <div className="order-preparation__steam" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="order-preparation__topline">
          <span className="order-preparation__live-dot" aria-hidden="true" />
          <span>{phase.id === "complete" ? "พร้อมรับ" : phase.id === "cancelled" ? "หยุดรายการ" : "อัปเดตสดจากร้าน"}</span>
        </div>

        <div className="order-preparation__ticket" aria-hidden="true">
          <span>ORDER</span>
          <strong>#{shortCode}</strong>
          <small>{itemCount} {itemCount === 1 ? "ITEM" : "ITEMS"}</small>
        </div>

        <div className="order-preparation__caption">
          <span className="order-preparation__eyebrow">{phase.eyebrow}</span>
          <strong>{heroItemLabel(order?.items)}</strong>
        </div>

        {phase.id === "complete" && (
          <div className="order-preparation__complete-mark" aria-hidden="true">
            <i className="ti ti-check" />
          </div>
        )}
      </div>

      <div className="order-preparation__copy">
        <span className="order-preparation__status-icon" aria-hidden="true">
          <i className={`ti ti-${phase.icon}`} />
        </span>
        <div>
          <p>{shopName}</p>
          <h2>{phase.title}</h2>
          <span>{phase.detail}</span>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import "./order-preparation.css";

const PHASE_BY_STATUS = {
  pending: {
    id: "queued",
    step: 0,
    eyebrow: "ORDER RECEIVED",
    title: "ใบออเดอร์เข้าคิวแล้ว",
    detail: "ร้านได้รับรายการของคุณแล้ว บาริสต้าจะตรวจสอบและเริ่มเตรียมอุปกรณ์เร็ว ๆ นี้",
    action: "กำลังพิมพ์ใบออเดอร์",
    icon: "receipt",
  },
  paid: {
    id: "accepted",
    step: 1,
    eyebrow: "PREP & TAMP",
    title: "บาริสต้ากำลังเตรียมช็อต",
    detail: "กำลังตวง เกลี่ย และแทมป์กาแฟให้แน่นสม่ำเสมอก่อนเริ่มสกัด",
    action: "เตรียมผงกาแฟ",
    icon: "checks",
  },
  preparing: {
    id: "accepted",
    step: 1,
    eyebrow: "PREP & TAMP",
    title: "บาริสต้ากำลังเตรียมช็อต",
    detail: "กำลังตวง เกลี่ย และแทมป์กาแฟให้แน่นสม่ำเสมอก่อนเริ่มสกัด",
    action: "เตรียมผงกาแฟ",
    icon: "checks",
  },
  ready: {
    id: "brewing",
    step: 2,
    eyebrow: "ESPRESSO EXTRACTION",
    title: "กำลังชงเครื่องดื่มของคุณ",
    detail: "เอสเปรสโซกำลังถูกสกัด ก่อนประกอบเครื่องดื่มและเก็บรายละเอียดขั้นสุดท้าย",
    action: "กำลังสกัดกาแฟ",
    icon: "coffee",
  },
  done: {
    id: "complete",
    step: 3,
    eyebrow: "READY FOR PICKUP",
    title: "ปิดฝาและพร้อมรับแล้ว",
    detail: "เครื่องดื่มเสร็จเรียบร้อย แจ้งเลขออเดอร์นี้กับพนักงานเพื่อรับได้เลย",
    action: "พร้อมรับที่เคาน์เตอร์",
    icon: "circle-check",
  },
  cancelled: {
    id: "cancelled",
    step: -1,
    eyebrow: "ORDER UPDATE",
    title: "ออเดอร์นี้ถูกยกเลิก",
    detail: "กรุณาติดต่อร้านหากต้องการสอบถามรายละเอียดเพิ่มเติม",
    action: "หยุดรายการแล้ว",
    icon: "x",
  },
};

const MEDIA_BY_PHASE = {
  queued: {
    poster: "/order-preparation/prepare-portafilter-poster.jpg",
  },
  accepted: {
    video: "/order-preparation/prepare-portafilter.mp4",
    poster: "/order-preparation/prepare-portafilter-poster.jpg",
    loop: true,
  },
  brewing: {
    video: "/order-preparation/espresso-brewing.mp4",
    poster: "/order-preparation/espresso-brewing-poster.jpg",
    loop: true,
    action: "กำลังสกัดกาแฟ",
    eyebrow: "ESPRESSO EXTRACTION",
  },
  complete: {
    video: "/order-preparation/finish-takeaway.mp4",
    poster: "/order-preparation/finish-takeaway-poster.jpg",
    loop: false,
  },
  cancelled: {
    poster: "/order-preparation/espresso-brewing-poster.jpg",
  },
};

const BREWING_FINISH_MEDIA = {
  iced: {
    video: "/order-preparation/finish-iced.mp4",
    poster: "/order-preparation/finish-iced-poster.jpg",
    action: "กำลังเทนมและประกอบแก้วเย็น",
    eyebrow: "ICE, MILK & FINISH",
  },
  milk: {
    video: "/order-preparation/finish-latte.mp4",
    poster: "/order-preparation/finish-latte-poster.jpg",
    action: "กำลังเทนมและแต่งหน้าเครื่องดื่ม",
    eyebrow: "MILK POUR & FINISH",
  },
};

const SCENE_STEPS = [
  { label: "รับออเดอร์", icon: "receipt" },
  { label: "เตรียมช็อต", icon: "coffee" },
  { label: "กำลังชง", icon: "droplet" },
  { label: "พร้อมรับ", icon: "cup" },
];

function countItems(items) {
  return (items || []).reduce((sum, item) => sum + Math.max(1, Number(item?.qty) || 1), 0);
}

function heroItemLabel(items) {
  const entries = (items || []).filter(Boolean);
  if (entries.length === 0) return "เครื่องดื่มของคุณ";
  const first = entries[0];
  const firstQty = Math.max(1, Number(first.qty) || 1);
  const total = countItems(entries);
  return total > firstQty ? `${first.name} และอีก ${total - firstQty} รายการ` : first.name;
}

function brewingFinishMedia(items) {
  const menuText = (items || []).map((item) => `${item?.name || ""} ${item?.category || ""}`).join(" ").toLowerCase();
  if (/iced|ice|cold|เย็น|น้ำแข็ง|โซดา|soda/.test(menuText)) return BREWING_FINISH_MEDIA.iced;
  if (/latte|ลาเต้|cappuccino|คาปู|mocha|มอคค่า|milk|นม|flat\s*white/.test(menuText)) return BREWING_FINISH_MEDIA.milk;
  return null;
}

export default function OrderPreparationExperience({ order, shopName, compact = false, intro = false }) {
  const videoRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [showIntro, setShowIntro] = useState(intro);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [completeReveal, setCompleteReveal] = useState(false);
  const phase = PHASE_BY_STATUS[order?.status] || PHASE_BY_STATUS.pending;
  const mediaSequence = useMemo(() => {
    const baseMedia = MEDIA_BY_PHASE[phase.id];
    if (phase.id !== "brewing") return [baseMedia];
    const finishMedia = brewingFinishMedia(order?.items);
    return finishMedia ? [{ ...baseMedia, loop:false }, finishMedia] : [baseMedia];
  }, [phase.id, order?.items]);
  const media = mediaSequence[sceneIndex % mediaSequence.length];
  const shortCode = String(order?.id || "").slice(-6).toUpperCase();
  const itemCount = countItems(order?.items);
  const sceneKey = `${phase.id}-${media.video || media.poster}`;

  useEffect(() => {
    const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!motionPreference) return undefined;
    const updatePreference = () => setReducedMotion(motionPreference.matches);
    updatePreference();
    motionPreference.addEventListener?.("change", updatePreference);
    return () => motionPreference.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!intro) return undefined;
    setShowIntro(true);
    const timer = window.setTimeout(() => setShowIntro(false), reducedMotion ? 450 : 1250);
    return () => window.clearTimeout(timer);
  }, [intro, order?.id, reducedMotion]);

  useEffect(() => {
    setSceneIndex(0);
    setCompleteReveal(phase.id === "complete" && reducedMotion);
  }, [phase.id, order?.id, reducedMotion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reducedMotion) return;
    video.currentTime = 0;
    video.play().catch(() => {});
  }, [sceneKey, reducedMotion]);

  const progressLabel = useMemo(() => phase.step < 0
    ? "ออเดอร์ถูกยกเลิก"
    : `${phase.title} ขั้นที่ ${phase.step + 1} จาก ${SCENE_STEPS.length}`,
  [phase]);

  function handleSceneEnded() {
    if (phase.id === "brewing" && mediaSequence.length > 1) {
      setSceneIndex((current) => (current + 1) % mediaSequence.length);
      return;
    }
    if (phase.id === "complete") setCompleteReveal(true);
  }

  return (
    <section
      className={`order-preparation order-preparation--${phase.id}${compact ? " order-preparation--compact" : ""}`}
      aria-live="polite"
      aria-label={progressLabel}
    >
      <div className="order-preparation__visual">
        {media.video && !reducedMotion ? (
          <video
            key={sceneKey}
            ref={videoRef}
            className="order-preparation__video order-preparation__scene-enter"
            src={media.video}
            poster={media.poster}
            muted
            loop={media.loop}
            playsInline
            autoPlay
            preload="metadata"
            aria-hidden="true"
            tabIndex={-1}
            onEnded={handleSceneEnded}
          />
        ) : (
          <img
            key={sceneKey}
            className="order-preparation__video order-preparation__scene-enter"
            src={media.poster}
            alt=""
            aria-hidden="true"
          />
        )}

        <div className="order-preparation__grade" aria-hidden="true" />
        <div className="order-preparation__scan" aria-hidden="true" />

        {phase.id === "queued" && (
          <div className="order-preparation__printer" aria-hidden="true">
            <div className="order-preparation__printer-body">
              <span className="order-preparation__printer-light" />
              <span className="order-preparation__printer-slot" />
            </div>
            <div className="order-preparation__printed-ticket">
              <span>{shopName}</span>
              <strong>ORDER #{shortCode}</strong>
              <i />
              <small>{itemCount} {itemCount === 1 ? "ITEM" : "ITEMS"}</small>
              <i />
              <b>RECEIVED</b>
            </div>
          </div>
        )}

        <div className="order-preparation__topline">
          <span className="order-preparation__live-dot" aria-hidden="true" />
          <span>{media.action || phase.action}</span>
        </div>

        {phase.id !== "queued" && (
          <div className="order-preparation__ticket" aria-hidden="true">
            <span>ORDER</span>
            <strong>#{shortCode}</strong>
            <small>{itemCount} {itemCount === 1 ? "ITEM" : "ITEMS"}</small>
          </div>
        )}

        <div className="order-preparation__caption">
          <span className="order-preparation__eyebrow">{media.eyebrow || phase.eyebrow}</span>
          <strong>{heroItemLabel(order?.items)}</strong>
        </div>

        {phase.id === "complete" && completeReveal && (
          <div className="order-preparation__complete-mark" aria-hidden="true">
            <i className="ti ti-check" />
          </div>
        )}

        {showIntro && (
          <div className="order-preparation__success-intro" role="status">
            <svg viewBox="0 0 58 58" aria-hidden="true">
              <circle cx="29" cy="29" r="26" />
              <path d="M17 30 L25 38 L42 20" />
            </svg>
            <strong>ส่งคำสั่งซื้อแล้ว</strong>
            <span>กำลังส่งใบออเดอร์ให้บาริสต้า</span>
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

      {phase.step >= 0 && (
        <ol className="order-preparation__steps" aria-label="ขั้นตอนการเตรียมออเดอร์">
          {SCENE_STEPS.map((step, index) => {
            const reached = index <= phase.step;
            const active = index === phase.step;
            return (
              <li key={step.label} className={`${reached ? "is-reached" : ""}${active ? " is-active" : ""}`} aria-current={active ? "step" : undefined}>
                <span><i className={`ti ti-${step.icon}`} aria-hidden="true" /></span>
                <small>{step.label}</small>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

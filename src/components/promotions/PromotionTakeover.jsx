import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./promotion-takeover.css";

const DISPLAY_SECONDS = 5;

export default function PromotionTakeover({ promo, imageUrl, onClose, onCta }) {
  const [secondsLeft, setSecondsLeft] = useState(DISPLAY_SECONDS);
  const [imageFailed, setImageFailed] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, DISPLAY_SECONDS - Math.floor((Date.now() - startedAt) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(timer);
        onClose();
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const title = promo.name || "โปรโมชั่นพิเศษ";

  return createPortal(
    <div className="promotion-takeover" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="promotion-takeover__visual" onClick={onCta} aria-label={`เปิด${title}`}>
        {imageUrl && !imageFailed ? (
          <img
            className="promotion-takeover__image"
            src={imageUrl}
            alt=""
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="promotion-takeover__placeholder" aria-hidden="true">
            <i className="ti ti-discount-2" />
          </span>
        )}
      </button>

      <button
        ref={closeRef}
        type="button"
        className="promotion-takeover__close"
        onClick={onClose}
        aria-label="ปิดโปรโมชั่น"
      >
        <span className="promotion-takeover__countdown" aria-hidden="true">{secondsLeft}</span>
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}

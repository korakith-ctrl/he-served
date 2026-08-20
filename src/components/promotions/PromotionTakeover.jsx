import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./promotion-takeover.css";

const PROMOTION_DISPLAY_SECONDS = 5;
const AD_DISPLAY_SECONDS = 8;

export default function PromotionTakeover({ promo, imageUrl, variant = "promotion", onClose, onCta }) {
  const [imageFailed, setImageFailed] = useState(false);
  const closeRef = useRef(null);
  const isAd = variant === "ad";

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const seconds = isAd ? AD_DISPLAY_SECONDS : PROMOTION_DISPLAY_SECONDS;
    const timer = window.setTimeout(onClose, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [isAd, onClose]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const title = promo.title || promo.name || (isAd ? "ข่าวสารจากทางร้าน" : "โปรโมชั่นพิเศษ");
  const description = isAd ? String(promo.description || "") : "";
  const hasCta = isAd ? Boolean(String(promo.ctaUrl || "").trim()) : true;
  const ctaLabel = String(promo.ctaLabel || "ดูเพิ่มเติม");

  return createPortal(
    <div className="promotion-takeover" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`promotion-takeover__card${isAd ? " is-ad" : ""}`}>
        {hasCta ? (
          <button type="button" className="promotion-takeover__visual" onClick={onCta} aria-label={`เปิด${title}`}>
            {imageUrl && !imageFailed ? (
              <img className="promotion-takeover__image" src={imageUrl} alt="" onError={() => setImageFailed(true)} />
            ) : (
              <span className="promotion-takeover__placeholder" aria-hidden="true">
                <i className={`ti ti-${isAd ? "speakerphone" : "discount-2"}`} />
              </span>
            )}
          </button>
        ) : (
          <div className="promotion-takeover__visual" aria-hidden="true">
            {imageUrl && !imageFailed ? (
              <img className="promotion-takeover__image" src={imageUrl} alt="" onError={() => setImageFailed(true)} />
            ) : (
              <span className="promotion-takeover__placeholder"><i className="ti ti-speakerphone" /></span>
            )}
          </div>
        )}

        {isAd && (
          <div className="promotion-takeover__content">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
            {hasCta && (
              <button type="button" className="promotion-takeover__cta" onClick={onCta}>
                {ctaLabel}<i className="ti ti-arrow-up-right" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <button
          ref={closeRef}
          type="button"
          className="promotion-takeover__close"
          onClick={onClose}
          aria-label={isAd ? "ปิดโฆษณา" : "ปิดโปรโมชั่น"}
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

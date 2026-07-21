import { useEffect, useMemo, useRef, useState } from "react";
import CoffeeBeanIcon from "./CoffeeBeanIcon.jsx";
import CoffeeBeanProgress from "./CoffeeBeanProgress.jsx";
import "./loyalty.css";

const LOYALTY_TIERS = [
  { id: "reserve", label: "Reserve", min: 100 },
  { id: "dark", label: "Dark Roast", min: 50 },
  { id: "medium", label: "Medium Roast", min: 20 },
  { id: "light", label: "Light Roast", min: 0 },
];

function loyaltyTierFor(lifetimeBeans) {
  const lifetime = Math.max(0, Number(lifetimeBeans) || 0);
  return LOYALTY_TIERS.find((tier) => lifetime >= tier.min) || LOYALTY_TIERS.at(-1);
}

function SproutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="loyalty-sprout" aria-hidden="true" focusable="false">
      <path d="M12 20v-8" />
      <path d="M12 13c-4.6 0-7-2.4-7-6.8 4.7 0 7 2.35 7 6.8Z" />
      <path d="M12 10.5c.25-4.1 2.6-6.1 7-6.1 0 4.15-2.35 6.1-7 6.1Z" />
    </svg>
  );
}

function CardShell({ children, state = "default", className = "", live = false }) {
  return (
    <section
      className={`loyalty-card loyalty-card--${state} ${className}`.trim()}
      aria-label="สะสมเมล็ดรับเครื่องดื่มฟรี"
      {...(live ? { "aria-live": "polite" } : {})}
    >
      {children}
    </section>
  );
}

function CardHeader({ pending = 0 }) {
  return (
    <div className="loyalty-card__header">
      <div className="loyalty-card__title-group">
        <span className="loyalty-card__medallion" aria-hidden="true">
          <CoffeeBeanIcon status="earned" size={21} />
        </span>
        <h2 className="loyalty-card__title">สะสมเมล็ดรับเครื่องดื่มฟรี</h2>
      </div>
      {pending > 0 && <span className="loyalty-card__badge">+{pending} เมล็ด</span>}
    </div>
  );
}

function MembershipRow({ tier }) {
  return (
    <div className="loyalty-membership" aria-label={`ระดับสมาชิก ${tier.label}`}>
      <span className="loyalty-membership__icon"><SproutIcon /></span>
      <span className="loyalty-membership__copy">
        <span className="loyalty-membership__eyebrow">ระดับสมาชิก</span>
        <strong>{tier.label}</strong>
      </span>
    </div>
  );
}

function LoyaltySkeleton() {
  return (
    <CardShell className="loyalty-card--skeleton" live>
      <span className="loyalty-skeleton loyalty-skeleton--header" />
      <span className="loyalty-skeleton loyalty-skeleton--reward" />
      <span className="loyalty-skeleton loyalty-skeleton--beans" />
      <span className="loyalty-skeleton loyalty-skeleton--member" />
      <span className="sr-only">กำลังโหลดข้อมูลสมาชิก</span>
    </CardShell>
  );
}

export default function LoyaltyCard({
  phone,
  loyaltyStatus,
  beanRecord,
  loyaltyBeanGoal,
  onRetry,
  cart,
  cartCount,
  redeemMode,
  setRedeemMode,
  redeemLineId,
  setRedeemLineId,
  rewardVerified,
  onRequestRewardVerification,
  onShowRewardTerms,
}) {
  const digits = phone.replace(/\D/g, "");
  const target = Math.max(1, Math.floor(Number(loyaltyBeanGoal) || 10));
  const earned = Math.max(0, Math.floor(Number(beanRecord?.beans) || 0));
  // The existing checkout rule awards one pending bean per drink in this cart.
  const pending = Math.max(0, Math.floor(Number(cartCount) || 0));
  const remaining = Math.max(target - earned - pending, 0);
  const rewardReady = earned >= target;
  const rewardEligibleCart = cart.filter((line) => line.productType !== "food");
  const tier = loyaltyTierFor(beanRecord?.lifetimeBeans);
  const recordPhone = String(beanRecord?.phone || "").replace(/\D/g, "");
  const recordIdentity = recordPhone || (beanRecord?.isNew ? `new:${digits}` : digits);
  const recordMatchesMember = Boolean(beanRecord) && (beanRecord.isNew || !recordPhone || recordPhone === digits);
  const previousEarnedRef = useRef(earned);
  const previousRecordRef = useRef(recordIdentity);
  const [animatedIndexes, setAnimatedIndexes] = useState([]);
  const [announcement, setAnnouncement] = useState("");

  const animationKey = useMemo(
    () => `loyalty-earned:${digits}:${earned}:${target}`,
    [digits, earned, target],
  );

  useEffect(() => {
    const previousEarned = previousEarnedRef.current;
    const recordChanged = previousRecordRef.current !== recordIdentity;
    previousEarnedRef.current = earned;
    previousRecordRef.current = recordIdentity;
    if (recordChanged || earned <= previousEarned) return undefined;

    let alreadyPlayed = false;
    try {
      alreadyPlayed = sessionStorage.getItem(animationKey) === "1";
      if (!alreadyPlayed) sessionStorage.setItem(animationKey, "1");
    } catch {
      // Animation remains an optional enhancement when storage is unavailable.
    }
    if (alreadyPlayed) return undefined;

    const first = Math.min(previousEarned, target);
    const last = Math.min(earned, target);
    setAnimatedIndexes(Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index));
    setAnnouncement(
      previousEarned < target && earned >= target
        ? "คุณมีรางวัลเครื่องดื่มฟรี 1 แก้วพร้อมใช้"
        : `ได้รับ ${earned - previousEarned} เมล็ด ตอนนี้คุณมี ${earned} จาก ${target} เมล็ด`,
    );
    const timer = window.setTimeout(() => setAnimatedIndexes([]), 520);
    return () => window.clearTimeout(timer);
  }, [animationKey, earned, recordIdentity, target]);

  if (digits.length < 9) {
    return (
      <CardShell state="empty">
        <CardHeader />
        <p className="loyalty-card__primary">กรอกเบอร์โทรศัพท์เพื่อสะสมเมล็ด</p>
        <p className="loyalty-card__helper">คะแนนและรางวัลจะผูกกับเบอร์โทรศัพท์ของคุณ</p>
      </CardShell>
    );
  }

  if (loyaltyStatus === "loading") return <LoyaltySkeleton />;

  if (loyaltyStatus === "error" && !recordMatchesMember) {
    return (
      <CardShell state="error" live>
        <CardHeader />
        <p className="loyalty-card__primary">ไม่สามารถโหลดข้อมูลสมาชิกได้</p>
        <p className="loyalty-card__helper">คุณยังสั่งซื้อและชำระเงินต่อได้ตามปกติ</p>
        <button type="button" className="loyalty-button loyalty-button--quiet" onClick={onRetry}>ลองอีกครั้ง</button>
      </CardShell>
    );
  }

  if (!beanRecord) return null;

  const redeemLine = redeemLineId ? rewardEligibleCart.find((line) => line.lineId === redeemLineId) : null;

  return (
    <CardShell state={rewardReady ? "reward" : "default"}>
      <CardHeader pending={pending} />
      {loyaltyStatus === "error" && (
        <p className="loyalty-card__notice">ข้อมูลอาจยังไม่เป็นปัจจุบัน แต่คุณสั่งซื้อต่อได้ตามปกติ</p>
      )}

      <div className="loyalty-card__status" aria-live="polite">
        {rewardReady ? (
          <>
            <p className="loyalty-card__primary loyalty-card__primary--reward">คุณมีรางวัลพร้อมใช้!</p>
            <p className="loyalty-card__reward-copy">รับเครื่องดื่มฟรี 1 แก้ว</p>
          </>
        ) : (
          <>
            <p className="loyalty-card__primary">
              {beanRecord.isNew && earned === 0
                ? "เริ่มสะสมเมล็ดจากออเดอร์นี้ได้เลย"
                : `อีก ${remaining} เมล็ด รับฟรี 1 แก้ว`}
            </p>
            <span className="sr-only">{announcement}</span>
          </>
        )}
      </div>

      <CoffeeBeanProgress earned={earned} pending={pending} target={target} animatedIndexes={animatedIndexes} />

      <div className="loyalty-card__labels" aria-hidden="true">
        <span><strong>{earned}</strong> เมล็ด</span>
        <span className="loyalty-card__pending-label">{pending > 0 ? `+${pending} รอยืนยัน` : "ไม่มีรอยืนยัน"}</span>
        <span>เป้าหมาย <strong>{target}</strong></span>
      </div>
      <p className="loyalty-card__helper">คะแนนจะเข้าเมื่อได้รับเครื่องดื่ม</p>

      {rewardReady && (
        <div className="loyalty-redeem">
          {!redeemMode ? (
            <div className="loyalty-redeem__actions">
              <button
                type="button"
                className="loyalty-button loyalty-button--reward"
                disabled={rewardEligibleCart.length === 0}
                onClick={() => setRedeemMode(true)}
              >
                ใช้รางวัลกับออเดอร์นี้
              </button>
              <button type="button" className="loyalty-button loyalty-button--quiet" onClick={() => setRedeemMode(false)}>
                เก็บไว้ใช้ครั้งถัดไป
              </button>
            </div>
          ) : (
            <fieldset className="loyalty-redeem__choices">
              <legend>เลือกแก้วที่อยากแลกฟรี</legend>
              {rewardEligibleCart.map((line) => (
                <label key={line.lineId}>
                  <input
                    type="radio"
                    name="redeemLine"
                    checked={redeemLineId === line.lineId}
                    onChange={() => setRedeemLineId(line.lineId)}
                  />
                  <span>{line.name}</span>
                </label>
              ))}
              {redeemLine && !rewardVerified && (
                <button type="button" className="loyalty-button loyalty-button--reward" onClick={onRequestRewardVerification}>
                  ยืนยัน OTP เพื่อใช้รางวัล
                </button>
              )}
              {redeemLine && rewardVerified && (
                <p className="loyalty-redeem__verified" role="status">
                  <i className="ti ti-shield-check" aria-hidden="true" /> ยืนยันเบอร์แล้ว รางวัลจะถูกใช้เมื่อยืนยันสั่งซื้อ
                </p>
              )}
              <div className="loyalty-redeem__actions">
                {redeemLine && (
                  <button type="button" className="loyalty-button loyalty-button--quiet" onClick={() => setRedeemLineId(null)}>
                    ไม่แลกแล้ว
                  </button>
                )}
                <button
                  type="button"
                  className="loyalty-button loyalty-button--quiet"
                  onClick={() => { setRedeemMode(false); setRedeemLineId(null); }}
                >
                  ย้อนกลับ
                </button>
              </div>
            </fieldset>
          )}
          {rewardEligibleCart.length === 0 && <p className="loyalty-card__helper">เพิ่มเครื่องดื่มลงตะกร้าก่อนใช้รางวัล ขนมปังและอาหารไม่ร่วมรายการ</p>}
        </div>
      )}

      <div className="loyalty-card__footer">
        <MembershipRow tier={tier} />
        <button type="button" className="loyalty-terms" onClick={onShowRewardTerms}>ดูเงื่อนไขรางวัล</button>
      </div>
    </CardShell>
  );
}

import CoffeeBeanIcon from "./CoffeeBeanIcon.jsx";

function normalizeCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export default function CoffeeBeanProgress({ earned, pending, target, animatedIndexes = [] }) {
  const safeTarget = Math.max(1, normalizeCount(target));
  const safeEarned = Math.min(safeTarget, normalizeCount(earned));
  const safePending = Math.min(safeTarget - safeEarned, normalizeCount(pending));
  const ariaText = `สะสมแล้ว ${safeEarned} เมล็ด และมี ${safePending} เมล็ดรอยืนยัน จากเป้าหมาย ${safeTarget} เมล็ด`;

  if (safeTarget > 15) {
    const earnedPercent = (safeEarned / safeTarget) * 100;
    const projectedPercent = ((safeEarned + safePending) / safeTarget) * 100;
    return (
      <div
        className="bean-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTarget}
        aria-valuenow={safeEarned}
        aria-valuetext={ariaText}
      >
        <div className="bean-progress-bar__track" aria-hidden="true">
          <span className="bean-progress-bar__pending" style={{ width: `${projectedPercent}%` }} />
          <span className="bean-progress-bar__earned" style={{ width: `${earnedPercent}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="bean-progress"
      style={{ "--bean-count": safeTarget }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeTarget}
      aria-valuenow={safeEarned}
      aria-valuetext={ariaText}
    >
      {Array.from({ length: safeTarget }, (_, index) => {
        const status = index < safeEarned
          ? "earned"
          : index < safeEarned + safePending
            ? "pending"
            : "empty";
        return (
          <CoffeeBeanIcon
            key={index}
            status={status}
            animate={animatedIndexes.includes(index)}
            className="bean-progress__bean"
          />
        );
      })}
    </div>
  );
}

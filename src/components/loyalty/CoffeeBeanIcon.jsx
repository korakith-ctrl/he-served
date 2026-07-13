export default function CoffeeBeanIcon({
  status = "empty",
  size = 24,
  className = "",
  animate = false,
  label,
  decorative = true,
}) {
  const accessibilityProps = decorative
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": label || `เมล็ดสถานะ ${status}` };

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`coffee-bean coffee-bean--${status}${animate ? " coffee-bean--animate" : ""} ${className}`.trim()}
      focusable="false"
      {...accessibilityProps}
    >
      <g transform="rotate(-30 12 12)">
        <path
          className="coffee-bean__body"
          d="M12 2.5C6.8 2.5 3.25 6.45 3.25 12S6.8 21.5 12 21.5 20.75 17.55 20.75 12 17.2 2.5 12 2.5Z"
        />
        <path
          className="coffee-bean__groove"
          d="M14.8 3.4c.75 3.25-.75 5.75-3.6 8.25-2.75 2.4-3.8 5.05-2.85 8.8"
        />
        <path className="coffee-bean__highlight" d="M8.1 5.3c-1.3.9-2.2 2.2-2.55 3.75" />
      </g>
    </svg>
  );
}

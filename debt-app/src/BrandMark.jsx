export default function BrandMark({ className = "" }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <rect x="3" y="3" width="58" height="58" rx="16" fill="#244B3E" />
        <text x="29" y="44" fill="#FAF9F5" fontFamily="'Noto Sans Thai', system-ui, sans-serif" fontSize="37" fontWeight="500" textAnchor="middle">ค</text>
        <path d="m41 43 4 4 8-9" fill="none" stroke="#D9E7C5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

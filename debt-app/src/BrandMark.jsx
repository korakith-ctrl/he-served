export default function BrandMark({ className = "" }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id="clear-kan-brand" x1="8" y1="6" x2="57" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#16B8A2" />
            <stop offset=".52" stopColor="#087E73" />
            <stop offset="1" stopColor="#625FD0" />
          </linearGradient>
          <radialGradient id="clear-kan-glow" cx="0" cy="0" r="1" gradientTransform="translate(16 11) rotate(48) scale(47)">
            <stop stopColor="#FFFFFF" stopOpacity=".28" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="3" y="3" width="58" height="58" rx="18" fill="url(#clear-kan-brand)" />
        <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#clear-kan-glow)" stroke="#fff" strokeOpacity=".22" />
        <circle cx="46.5" cy="16.5" r="4.2" fill="#B8FFF0" />
        <circle cx="16" cy="48" r="3" fill="#FFB3A8" />
        <text x="32" y="44" fill="#fff" fontFamily="'Noto Sans Thai', system-ui, sans-serif" fontSize="37" fontWeight="800" textAnchor="middle">ค</text>
        <path d="m43.5 43.5 4.5 4.5 7-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

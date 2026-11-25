export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`logo-spin ${className}`} aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#0e1015" stroke="#2e3646" />
      <path
        d="M16 7 23.5 9.8v5.8c0 4.6-3.2 8.1-7.5 9.3-4.3-1.2-7.5-4.7-7.5-9.3V9.8z"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="m12.8 16 2.3 2.3 4.1-4.6" fill="none" stroke="#fafafa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

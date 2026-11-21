export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="#111318" stroke="#1f2430" />
      <path
        d="M16 7 23.5 9.8v5.8c0 4.6-3.2 8.1-7.5 9.3-4.3-1.2-7.5-4.7-7.5-9.3V9.8z"
        fill="none"
        stroke="#f3f5f8"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="m12.8 16 2.3 2.3 4.1-4.6" fill="none" stroke="#f3f5f8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

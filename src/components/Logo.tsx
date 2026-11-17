export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="#09090b" stroke="#27272a" />
      <path
        d="M16 6.5 24 9.5v6.2c0 4.9-3.4 8.6-8 9.8-4.6-1.2-8-4.9-8-9.8V9.5z"
        fill="none"
        stroke="#fafafa"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m12.5 16 2.5 2.5 4.5-5" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

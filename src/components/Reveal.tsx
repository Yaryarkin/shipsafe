import type { CSSProperties, ElementType, ReactNode } from "react";

const MAX_STAGGER = 8;

interface RevealProps {
  children: ReactNode;
  /** Position in the stagger sequence (0 first). Capped, so long lists never wait. */
  index?: number;
  className?: string;
  as?: ElementType;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/** Wraps one element in the view reveal (short fade and slide, staggered by `index`). */
export function Reveal({ children, index = 0, className = "", as: Tag = "div", ...rest }: RevealProps) {
  const style = { "--i": Math.min(Math.max(index, 0), MAX_STAGGER) } as CSSProperties;
  return (
    <Tag className={`reveal ${className}`} style={style} {...rest}>
      {children}
    </Tag>
  );
}

/** For elements that already carry their own classes: `className="reveal …" style={revealStyle(3)}`. */
export function revealStyle(index: number): CSSProperties {
  return { "--i": Math.min(Math.max(index, 0), MAX_STAGGER) } as CSSProperties;
}

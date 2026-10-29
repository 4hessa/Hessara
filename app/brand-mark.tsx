import type { CSSProperties } from "react";

type BrandTone = "slate" | "inverse" | "inherit";
type BrandMarkProps = {
  className?: string;
  size?: number | string;
  tone?: BrandTone;
  /** Omit for a decorative symbol beside an already named link or wordmark. */
  label?: string;
};

/** One accurately traced SVG silhouette, tinted with the surrounding brand ink. */
export function BrandMark({ className = "", size, tone = "inherit", label }: BrandMarkProps) {
  const style = size === undefined ? undefined : { "--brand-mark-size": typeof size === "number" ? `${size}px` : size } as CSSProperties;
  return <span className={`hessara-brand-mark ${className}`.trim()} data-brand-tone={tone} style={style}
    role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** Keep links and their navigation semantics at the call site. */
export function BrandLockup({ className = "", markClassName = "", tone = "slate" }: {
  className?: string;
  markClassName?: string;
  tone?: BrandTone;
}) {
  return <span className={`hessara-brand-lockup ${className}`.trim()} data-brand-tone={tone} dir="ltr">
    <BrandMark className={markClassName} />
    <strong className="hessara-brand-name" lang="en" dir="ltr">HESSARA</strong>
  </span>;
}

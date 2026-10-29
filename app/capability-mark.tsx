import "./capability-mark.css";

type CapabilityMarkProps = {
  serviceId: string;
  className?: string;
  compact?: boolean;
};

// Original capability diagrams, not third-party logos or fictional characters.
const patterns = [
  <g key="layers"><path d="m24 47 40-22 40 22-40 22Z" /><path d="m24 64 40 22 40-22M24 81l40 22 40-22" /><path d="M64 25v44" /></g>,
  <g key="flow"><rect x="19" y="23" width="28" height="28" rx="4" /><rect x="81" y="77" width="28" height="28" rx="4" /><path d="M47 37h24v54h10M19 91h30M95 23v28M80 37h30" /><circle cx="49" cy="91" r="5" /></g>,
  <g key="structure"><path d="M24 24h80v80H24zM24 50h80M50 24v80M78 50v54M50 78h54" /><path d="M32 36h10M60 36h34M32 64h10M32 89h10" /></g>,
  <g key="context"><rect x="24" y="24" width="62" height="62" rx="4" /><rect x="42" y="42" width="62" height="62" rx="4" /><path d="M54 61h28M54 74h38M54 87h18" /></g>,
  <g key="precision"><path d="M23 45V23h22M83 23h22v22M105 83v22H83M45 105H23V83M44 64h40M64 44v40" /><path d="m42 95 53-53M33 86l53-53" /></g>,
];

export function CapabilityMark({ serviceId, className = "", compact = false }: CapabilityMarkProps) {
  const index = [...serviceId].reduce((value, character) => value + character.charCodeAt(0), 0) % patterns.length;
  return <div className={`capability-mark${compact ? " capability-mark--compact" : ""} ${className}`.trim()} data-capability={serviceId} aria-hidden="true">
    <svg viewBox="0 0 128 128" width="128" height="128" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {patterns[index]}
    </svg>
  </div>;
}

type SectionIconProps = { section: string };

/** A consistent, two-tone set drawn for the four primary product sections. */
export function SectionIcon({ section }: SectionIconProps) {
  return (
    <svg
      className="section-illustration"
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {section === "llms" && (
        <>
          <path d="m16 4 12 6-12 6L4 10Z" fill="var(--dust)" />
          <path d="m4 16 12 6 12-6M4 22l12 6 12-6" />
        </>
      )}
      {section === "benchmarks" && (
        <>
          <path d="M6 6v21h21" />
          <rect x="10" y="15" width="4" height="8" rx="1.2" fill="var(--dust)" stroke="none" />
          <rect x="17" y="10" width="4" height="13" rx="1.2" fill="var(--dust)" stroke="none" />
          <path d="M26 6v17M9 10l6-4 6 1 5-3" />
        </>
      )}
      {section === "tools" && (
        <>
          <rect x="5" y="5" width="9" height="9" rx="2.5" fill="var(--dust)" />
          <rect x="18" y="5" width="9" height="9" rx="2.5" />
          <rect x="5" y="18" width="9" height="9" rx="2.5" />
          <path d="M22.5 19v7m-3.5-3.5h7" />
        </>
      )}
      {section === "method" && (
        <>
          <path d="M12 7H8a2 2 0 0 0-2 2v17a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4" />
          <rect x="12" y="4" width="8" height="6" rx="2" fill="var(--dust)" />
          <path d="m11 19 3.5 3.5L21 16" />
        </>
      )}
    </svg>
  );
}

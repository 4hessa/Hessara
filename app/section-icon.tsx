type SectionIconProps = { section: string };

/** Small, filled illustrations in Hessara's pearl, sage and rose palette. */
export function SectionIcon({ section }: SectionIconProps) {
  return (
    <svg className="section-illustration" width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
      {section === "llms" && (
        <>
          <path d="m20 5 15 8-15 8L5 13Z" fill="#c8b6d5" />
          <path d="M5 13v7l15 8v-7Z" fill="#8b7098" />
          <path d="m20 21 15-8v7l-15 8Z" fill="#aa92b8" />
          <path d="m5 25 15 8 15-8v5l-15 8-15-8Z" fill="#72938e" />
          <path d="m5 20 15 8 15-8v5l-15 8-15-8Z" fill="#c1d9d2" />
          <path d="m14 13 6-3 6 3-6 3Z" fill="#fff8ef" />
          <path d="m10 15 6 3" stroke="#e4d8eb" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {section === "benchmarks" && (
        <>
          <rect x="8" y="6" width="25" height="31" rx="5" fill="#c4a0a4" />
          <rect x="6" y="5" width="25" height="30" rx="4" fill="#ead4ce" />
          <path d="M10 12h17v19H10Z" fill="#fff9f0" />
          <rect x="13" y="3" width="11" height="7" rx="2.5" fill="#96758b" />
          <path d="m12 17 2 2 3-4m-5 10 2 2 3-4" stroke="#698f84" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 18h3m-3 8h3" stroke="#baa6b6" strokeWidth="2" strokeLinecap="round" />
          <path d="m28 21 4-3 4 4-4 3-1 8-4 2-1-4 3-3Z" fill="#b18b91" />
          <path d="m32 20 2 2" stroke="#f5e5de" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {section === "tools" && (
        <>
          <path d="M14 14V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v5" stroke="#5e7f77" strokeWidth="3.5" />
          <path d="m29 5 3 1-3 11-3-1Z" fill="#b395ab" />
          <path d="m9 7 4-1 3 13-4 1Z" fill="#d2a7a5" />
          <rect x="4" y="14" width="32" height="21" rx="5" fill="#8fb1a8" />
          <path d="M4 24h32v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" fill="#658c82" />
          <path d="M5 19h30v5H5Z" fill="#bcd8cf" />
          <rect x="10" y="21" width="4" height="7" rx="1.5" fill="#f8eee2" />
          <rect x="26" y="21" width="4" height="7" rx="1.5" fill="#f8eee2" />
          <path d="M17 30h6" stroke="#bdd6cd" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {section === "method" && (
        <>
          <path d="m20 3 14 6v11c0 8-7 14-14 18C13 34 6 28 6 20V9Z" fill="#a4879e" />
          <path d="m20 6 11 5v9c0 6-5 11-11 15-6-4-11-9-11-15v-9Z" fill="#d8c4d7" />
          <path d="M20 6v29c6-4 11-9 11-15v-9Z" fill="#c3a9c4" />
          <circle cx="20" cy="19" r="8" fill="#f8f0e7" />
          <path d="m16 19 3 3 5-6" stroke="#6b8f83" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m11 12 4-2" stroke="#f3e7ee" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * The few small line icons the app uses, drawn inline so nothing is fetched.
 * Decorative: whatever they sit beside says the same thing in words.
 */

const PATHS = {
  logo: null,
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  compare: (
    <>
      <rect x="3.5" y="4" width="7" height="16" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="16" rx="1.5" />
      <path d="M6 9h2M6 12.5h2M16 9h2M16 12.5h2" />
    </>
  ),
};

export default function Icon({ name, size = 16 }) {
  if (name === 'logo') {
    return (
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path
          d="M10 8.5h8.5l3.5 3.5v11.5a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"
          fill="var(--sheet)"
        />
        <path
          d="M12 15.5h7M12 18.5h7M12 21.5h4"
          stroke="var(--accent)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

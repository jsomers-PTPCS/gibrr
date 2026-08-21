// Two speech-bubble outlines, mirrored — one upper-left with its tail
// pointing down-left, one lower-right with its tail pointing down-right
// (a true horizontal mirror of the first, not just a second bubble).
// Smaller than a single-bubble mark would be, with real margin around
// both, so the pair reads clearly instead of filling the frame edge to
// edge.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="gibrr-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--primary-bright)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      {/* upper-left bubble, tail down-left */}
      <rect
        x="4"
        y="4"
        width="12"
        height="8"
        rx="4"
        stroke="url(#gibrr-logo-gradient)"
        strokeWidth="2"
      />
      <path d="M 7 12 L 10 12 L 5 16.5 Z" fill="url(#gibrr-logo-gradient)" />
      {/* lower-right bubble, tail down-right — mirror of the first */}
      <rect
        x="16"
        y="16"
        width="12"
        height="8"
        rx="4"
        stroke="url(#gibrr-logo-gradient)"
        strokeWidth="2"
      />
      <path d="M 25 24 L 22 24 L 27 28.5 Z" fill="url(#gibrr-logo-gradient)" />
    </svg>
  );
}

// A solid (filled) speech-bubble glyph — used instead of the 💬 emoji,
// which renders as a hollow/outline bubble in most emoji fonts. Fills
// with currentColor so it inherits the surrounding link's color.
export function MessageIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.76 1.44 5.22 3.7 6.85-.12.98-.5 2.32-1.53 3.65a.5.5 0 0 0 .5.8c2.15-.45 3.77-1.32 4.77-1.98A12.6 12.6 0 0 0 12 19.6c5.52 0 10-3.94 10-8.8S17.52 2 12 2z" />
    </svg>
  );
}

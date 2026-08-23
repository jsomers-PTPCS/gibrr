// Plain inline SVGs, not emoji — an emoji glyph (🔁🔖💬🗑️) is a
// full-color character real fonts render on their own terms; it never
// respects a CSS `color`, so there's no way to actually tint one a
// "faded purple." These are simple stroke-based icons using
// `currentColor` instead, so the surrounding button's color (see
// PostItem.tsx's icon-button styling) is what actually paints them.
// Each optionally renders "filled" for a toggled-on state (boosted/
// bookmarked) instead of changing color, so the on/off signal survives
// without breaking the single, consistent icon color the rest of the
// post's action row uses.

import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

// Loops' (app/loops/page.tsx) own "heart-tap" like — the rest of the
// app's post score uses VoteButtons' up/down arrows instead, but a
// TikTok-style feed's single heart-tap convention doesn't have an
// existing icon of its own yet. Same filled-for-on-state convention as
// BookmarkIcon.
export function HeartIcon({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <Icon {...props} fill={filled ? "currentColor" : "none"}>
      <path d="M12 21s-6.7-4.2-9.3-8.3C.9 9.6 2 5.9 5.5 5.1c2-.5 3.9.4 5 2 .1.1.3.1.4 0 1.1-1.6 3-2.5 5-2 3.5.8 4.6 4.5 2.8 7.6C18.7 16.8 12 21 12 21Z" />
    </Icon>
  );
}

// A rounded-square "reels" play glyph — Nav.tsx's icon-only link to
// /loops, distinct from BoostIcon's repeat-arrows (already "Echo" on
// every post) so the two don't read as the same action.
export function LoopsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function BoostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M17 2 21 6 17 10" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22 3 18 7 14" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Icon>
  );
}

export function BookmarkIcon({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <Icon {...props} fill={filled ? "currentColor" : "none"}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

export function CommentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4h16v12H8l-4 4Z" />
    </Icon>
  );
}

export function EditIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Icon>
  );
}

export function FlagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 22V3" />
      <path d="M4 4h13l-2 4 2 4H4" />
    </Icon>
  );
}

// Nav.tsx's bottom tab bar (mobile only) — Home tab.
export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10" />
    </Icon>
  );
}

// Nav.tsx's bottom tab bar (mobile only) — Circles ("/g") tab. Two
// overlapping heads, distinct from Avatar's single-person glyph.
export function CirclesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="9" r="3.5" />
      <circle cx="16" cy="11" r="3" />
      <path d="M3.5 19c.6-3 3-5 5.5-5s4.9 2 5.5 5" />
      <path d="M14.5 14.3c2 .3 3.7 2 4.2 4.4" />
    </Icon>
  );
}

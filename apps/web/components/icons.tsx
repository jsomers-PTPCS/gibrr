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

// Loops' (app/loops/page.tsx) dedicated mute toggle — a speaker with
// sound waves when unmuted, a speaker with an X when muted.
export function MuteIcon({ muted = false, ...props }: SVGProps<SVGSVGElement> & { muted?: boolean }) {
  return (
    <Icon {...props}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M16 9l6 6M22 9l-6 6" />
      ) : (
        <>
          <path d="M17.5 8.5a5 5 0 0 1 0 7" />
          <path d="M20 6a9 9 0 0 1 0 12" />
        </>
      )}
    </Icon>
  );
}

// Loops' (app/loops/page.tsx) center-of-screen "paused" overlay — the
// standard tap-to-play triangle every video app shows once a viewer
// pauses in place.
export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M8 5v14l11-7-11-7Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

// PostItem.tsx's "Translate this" button — a plain globe, since a
// literal "A/文" glyph doesn't read cleanly at icon size.
export function TranslateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.5 5.8 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.8-3.5-9s1-6.5 3.5-9Z" />
    </Icon>
  );
}

// Loops' (app/loops/page.tsx) share button — opens a menu of external
// share targets plus an in-app Whisper, replacing the old plain
// "↗ view original" link.
export function ShareIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.6l6.8-3.9M8.6 13.4l6.8 3.9" />
    </Icon>
  );
}

// PageInfo.tsx's "what does this page do" toggle — the dot is a
// zero-length line, not a small circle: stroke-linecap: round on the
// shared Icon wrapper turns that into a filled dot without needing a
// separate fill: currentColor override the way a real <circle> would
// (the wrapper sets fill: none at the svg root).
export function InfoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </Icon>
  );
}

// Nav.tsx's mobile top-right Federated link — three connected nodes,
// a network glyph standing in for "every other server this instance
// knows about" rather than the single-globe TranslateIcon already uses
// (that one means "translate," a different concept that happens to
// also render as a globe elsewhere in this file).
export function FederatedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="17" r="2.5" />
      <circle cx="19" cy="17" r="2.5" />
      <path d="M12 7.5v3M10.3 12.8 6.7 15M13.7 12.8l3.6 2.2" />
    </Icon>
  );
}

// app/federated/page.tsx's LongformCard "Read full article" button —
// opens the real page on its origin site, in a new tab.
export function ExternalLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </Icon>
  );
}

// LongformCard's "Subscribe" button — a mail glyph since a Ghost
// subscription is a newsletter signup, not a follow.
export function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <polyline points="22 6 12 13 2 6" />
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

// Nav.tsx / BottomTabBar.tsx notifications bell — filled for the
// unread-present state, same on/off-without-a-color-change convention as
// BoostIcon/BookmarkIcon.
export function BellIcon({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <Icon {...props} fill={filled ? "currentColor" : "none"}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>
  );
}

// BookwyrmTab.tsx's star rating — rendered twice per star (outline,
// then a width-clipped filled copy) to draw BookWyrm's half-star
// increments precisely, rather than swapping in a separate half-star
// glyph.
export function StarIcon({ filled = false, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) {
  return (
    <Icon {...props} fill={filled ? "currentColor" : "none"}>
      <polygon points="12 2.5 15.1 8.8 22 9.8 17 14.6 18.2 21.5 12 18.2 5.8 21.5 7 14.6 2 9.8 8.9 8.8 12 2.5" />
    </Icon>
  );
}

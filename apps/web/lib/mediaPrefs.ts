// Client-only preference (no server column exists for it — see
// lib/theme.ts's dark/light toggle for the same localStorage-only
// precedent) controlling whether sensitive/NSFW media renders blurred.
// "blur" is always the safe default: PostItem.tsx starts every post
// blurred and only relaxes to unblurred, in an effect, once this has
// actually been read — never the other way around.
export type SensitiveMediaDisplay = "blur" | "show";

const SENSITIVE_MEDIA_KEY = "gibrr-sensitive-media";

export function getSensitiveMediaDisplay(): SensitiveMediaDisplay {
  if (typeof localStorage === "undefined") return "blur";
  return localStorage.getItem(SENSITIVE_MEDIA_KEY) === "show" ? "show" : "blur";
}

export function setSensitiveMediaDisplay(value: SensitiveMediaDisplay) {
  localStorage.setItem(SENSITIVE_MEDIA_KEY, value);
}

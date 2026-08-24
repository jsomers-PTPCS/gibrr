const TRANSLATE_TARGET_KEY = "gibrr-translate-target";

// Same plain-localStorage posture as lib/theme.ts's own preference — a
// per-device UI convenience, not something worth a server round trip or
// an account-wide setting. Defaults to the browser's own language
// (just the primary subtag — LibreTranslate's codes are bare "es"/"fr",
// not "es-MX") the first time anyone hits Translate, then remembers
// whatever they actually picked from then on.
export function getPreferredTranslateTarget(): string {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(TRANSLATE_TARGET_KEY);
  if (stored) return stored;
  return (navigator.language || "en").split("-")[0].toLowerCase();
}

export function setPreferredTranslateTarget(code: string) {
  localStorage.setItem(TRANSLATE_TARGET_KEY, code);
}

import { logger } from "../logger.js";

// Self-hosted only (docker-compose.prod.yml's libretranslate service) —
// LibreTranslate's own public hosted API needs a paid key, and pointing
// at some other public instance without permission isn't this app's
// call to make. Unset entirely disables the feature rather than falling
// back to anything, same "opt-in, gracefully absent" posture SMTP and
// the Explore-server OAuth tokens already have.
function baseUrl(): string | null {
  return process.env.LIBRETRANSLATE_URL || null;
}

export function translationConfigured(): boolean {
  return baseUrl() !== null;
}

export interface TranslateLanguage {
  code: string;
  name: string;
}

let languageCache: { languages: TranslateLanguage[]; fetchedAt: number } | null = null;
const LANGUAGE_CACHE_TTL_MS = 60 * 60 * 1000;

// Only ever as many languages as LT_LOAD_ONLY actually loaded (see
// docker-compose.prod.yml) — asking to translate into one this instance
// didn't load 400s, so the frontend's picker is populated from this
// rather than a hardcoded list that could drift from what's really
// available.
export async function getTranslateLanguages(): Promise<TranslateLanguage[] | null> {
  const url = baseUrl();
  if (!url) return null;

  if (languageCache && Date.now() - languageCache.fetchedAt < LANGUAGE_CACHE_TTL_MS) {
    return languageCache.languages;
  }

  try {
    const response = await fetch(`${url}/languages`);
    if (!response.ok) return null;
    const json = (await response.json()) as unknown;
    if (!Array.isArray(json)) return null;
    const languages = json
      .map((entry) =>
        typeof entry === "object" && entry && typeof (entry as { code?: unknown }).code === "string"
          ? { code: (entry as { code: string }).code, name: String((entry as { name?: unknown }).name ?? (entry as { code: string }).code) }
          : null,
      )
      .filter((entry): entry is TranslateLanguage => entry !== null);
    languageCache = { languages, fetchedAt: Date.now() };
    return languages;
  } catch (err) {
    logger.warn({ err }, "libretranslate languages fetch failed");
    return null;
  }
}

// Auto-detects the source language (LibreTranslate's own "auto" option)
// rather than requiring the caller to know it — a post's real language
// isn't tracked anywhere on the Post model. Returns null on any failure
// (service unreachable, still downloading its language models on first
// boot, an unsupported target) rather than throwing, so a post's own
// render never breaks over a translation being unavailable.
export async function translateText(text: string, target: string): Promise<string | null> {
  const url = baseUrl();
  if (!url || !text.trim()) return null;

  try {
    const response = await fetch(`${url}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: "auto", target, format: "text" }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { translatedText?: unknown };
    return typeof json.translatedText === "string" ? json.translatedText : null;
  } catch (err) {
    logger.warn({ err, target }, "libretranslate translate request failed");
    return null;
  }
}

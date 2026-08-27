import { discoverActor } from "./remoteActor.js";
import { sanitizeDescriptionHtml } from "./descriptionHtml.js";
import { logger } from "../logger.js";

// BookWyrm has no site-wide "what's trending" endpoint (confirmed via
// its own routing when Explore-server support for other platforms was
// researched — see federation/exploreDispatch.ts's sibling fetchers),
// but a specific, already-known user's outbox is a real, public, paginated
// OrderedCollection — confirmed live against bookwyrm.social. This is
// the read-a-known-person's-activity half of BookWyrm support, not a
// server-discovery feature.
export interface BookwyrmActivityItem {
  // The item's own AP id — also the human-browsable page on the
  // BookWyrm instance (confirmed live: unlike Ghost, BookWyrm doesn't
  // separate a machine id from a human url for these).
  id: string;
  contentHtml: string;
  bookTitle: string | null;
  bookCoverUrl: string;
  publishedAt: string;
  // Full review title, e.g. `Review of "Radiant Star": Leckie's Study
  // of Provincial Life` — only text reviews (AP type "Article") carry
  // this; reading-status notes and bare star ratings don't.
  reviewName: string | null;
  // 0-5 in 0.5 increments, confirmed live as a plain top-level `rating`
  // number on both bare ratings (AP id path `/reviewrating/`) and text
  // reviews (`/review/`) — null when the item carries no rating at all.
  rating: number | null;
  // True for a "started reading" status note specifically (not "wants
  // to read" or "finished reading") — used to pin what's currently
  // being read to the top of the tab.
  isCurrentlyReading: boolean;
}

// BookWyrm's auto-generated reading-status notes lead with the
// account's own display name in plain text, e.g. "mouse started
// reading <book>" — confirmed live. That's redundant noise on a tab
// that's already scoped to one person's profile, so it's stripped
// before the content ever reaches the client; review/rating content
// never has this prefix (confirmed live) so the pattern only ever
// matches the notes it's meant for.
const READING_STATUS_RE =
  /^[\s\S]*?(?=\b(?:started reading|finished reading|wants? to read|stopped reading|is currently reading)\b)/i;

function stripLeadingName(content: string): string {
  const stripped = content.replace(READING_STATUS_RE, "");
  if (stripped === content) return content;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/activity+json" } });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err, url }, "bookwyrm activity fetch failed");
    return null;
  }
}

// Fetches a BookWyrm user's recent reading activity — "started
// reading"/"finished reading" notices, comments, quotations, bare
// star ratings, and full text reviews. All of those (confirmed live
// across every kind) carry the book's cover as an `attachment`
// Document; a plain social reply in the same outbox never does. That
// presence, not the item's URL-path naming (which isn't part of the
// AP object itself), is what's used below to tell "book stuff" apart
// from everything else a BookWyrm outbox also contains. The AP
// `type` isn't uniform, though (confirmed live): reading-status
// notes, bare ratings, and comments/quotations all arrive as "Note",
// but a full text review arrives as "Article" — both are accepted
// below, since excluding "Article" (the previous behavior) silently
// dropped every full-text review.
export async function fetchBookwyrmActivity(
  handle: string,
  limit = 20,
): Promise<BookwyrmActivityItem[] | null> {
  const actor = await discoverActor(handle);
  if (!actor?.outbox) return null;

  const outbox = await fetchJson(actor.outbox);
  const firstPageUrl = typeof outbox?.first === "string" ? outbox.first : null;
  if (!firstPageUrl) return null;

  const page = await fetchJson(firstPageUrl);
  const items = Array.isArray(page?.orderedItems) ? (page!.orderedItems as Record<string, unknown>[]) : null;
  if (!items) return null;

  const results: BookwyrmActivityItem[] = [];
  for (const item of items) {
    if (results.length >= limit) break;
    if (
      (item.type !== "Note" && item.type !== "Article") ||
      typeof item.id !== "string" ||
      typeof item.content !== "string"
    ) {
      continue;
    }

    const attachments = Array.isArray(item.attachment) ? item.attachment : [];
    const cover = attachments.find(
      (a) => typeof a === "object" && a !== null && typeof (a as { url?: unknown }).url === "string",
    ) as { url: string; name?: unknown } | undefined;
    if (!cover) continue;

    results.push({
      id: item.id,
      contentHtml: sanitizeDescriptionHtml(stripLeadingName(item.content)),
      bookTitle: typeof cover.name === "string" ? cover.name : null,
      // The cover URL comes straight off BookWyrm's own attachment —
      // no proxying or re-hosting — so it's always current with
      // whatever edition/cover the account has picked there.
      bookCoverUrl: cover.url,
      publishedAt: typeof item.published === "string" ? item.published : new Date().toISOString(),
      reviewName: typeof item.name === "string" ? item.name : null,
      rating: typeof item.rating === "number" ? item.rating : null,
      isCurrentlyReading: /\bstarted reading\b/i.test(item.content),
    });
  }

  // Whatever's currently being read belongs at the top of the tab;
  // Array#sort is stable, so newest-first order is otherwise
  // untouched within each group.
  results.sort((a, b) => Number(b.isCurrentlyReading) - Number(a.isCurrentlyReading));
  return results;
}

import Parser from "rss-parser";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { createLocalActor, localDomain } from "./localActor.js";
import { toPlainText } from "./plainText.js";

const FETCH_TIMEOUT_MS = 10_000;

function newParser() {
  return new Parser({
    timeout: FETCH_TIMEOUT_MS,
    // Reddit's own per-subreddit .rss (this feature's whole reason to
    // exist, per the feature request) 403s a generic or missing
    // User-Agent outright — confirmed live, and its error message
    // explicitly asks for "something unique and descriptive" instead.
    // A real, identifiable UA is also just good citizenship for any
    // other feed host doing the same kind of bot-filtering.
    headers: { "User-Agent": `Gibrr/1.0 (+https://${localDomain()})` },
  });
}

// A feed's title has no format constraint at all (emoji, punctuation,
// arbitrary length) — usernames do (createLocalActor has no validation
// of its own, but every *other* local actor's username goes through
// registerSchema's ^[a-zA-Z0-9_]+$, 3-32 chars, so this pseudo-actor
// should look the same to anything that renders a handle). "rss_"
// prefixed so it reads unmistakably as a feed, not a person, in an
// @mention or a handle search — collisions (two feeds titled the same)
// resolved with a numeric suffix.
async function uniqueUsernameFor(title: string): Promise<string> {
  const domain = localDomain();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = `rss_${slug}`.slice(0, 28) || "rss_feed";

  let candidate = base;
  let suffix = 1;
  // Small, bounded loop — collisions on a feed *title* are rare, and
  // this only ever runs once per genuinely new feed URL (findOrCreateRssFeed
  // checks for an existing row by url first).
  while (await prisma.actor.findUnique({ where: { username_domain: { username: candidate, domain } } })) {
    candidate = `${base}_${suffix}`.slice(0, 32);
    suffix += 1;
  }
  return candidate;
}

function validateFeedUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported URL scheme: ${parsed.protocol}`);
  }
  return parsed;
}

// Shared, per-URL resource — the first person to listen to a given feed
// pays for the parse + the one-time pseudo-actor creation; everyone
// after that just adds their own RssSubscription row to the same
// RssFeed. Throws (caller's job to turn that into a 422) if the URL
// doesn't parse as a real feed at all — same "fail loud, not with an
// empty success" posture POST /communities/lookup-remote's handle
// validation already has.
export async function findOrCreateRssFeed(url: string) {
  validateFeedUrl(url);

  const existing = await prisma.rssFeed.findUnique({ where: { url } });
  if (existing) return existing;

  const parsed = await newParser().parseURL(url);
  const title = parsed.title?.trim() || new URL(url).host;
  const username = await uniqueUsernameFor(title);

  return prisma.$transaction(async (tx) => {
    const actor = await createLocalActor(tx, {
      username,
      type: "Service",
      displayName: title,
      summary: parsed.description ? toPlainText(parsed.description) : undefined,
    });
    return tx.rssFeed.create({ data: { url, title, actorId: actor.id } });
  });
}

// Fetches a feed's current items and caches each as a real Post
// (authored as the feed's own pseudo-actor, deduped by remoteId the
// same way any other cached federated content is) linked via
// RssCachedPost so GET /feed's RSS branch (routes/posts.ts) knows which
// feed a given cached post came from. Best-effort per item — one bad
// item (missing link, unparseable date) doesn't sink the rest of the
// feed's batch.
export async function sweepFeed(feed: { id: string; url: string; actorId: string }): Promise<void> {
  let parsed: Parser.Output<Record<string, unknown>>;
  try {
    parsed = await newParser().parseURL(feed.url);
  } catch (err) {
    logger.warn({ err, url: feed.url }, "rss sweep failed to fetch/parse feed");
    return;
  }

  for (const item of parsed.items ?? []) {
    const link = item.link ?? item.guid;
    if (!link) continue;
    try {
      const body = toPlainText(item.contentSnippet || item.content || item.summary || "");
      const createdAt = item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : new Date();

      const post = await prisma.post.upsert({
        where: { remoteId: link },
        create: {
          remoteId: link,
          title: item.title?.trim() || null,
          body,
          authorActorId: feed.actorId,
          communityId: null,
          createdAt,
        },
        update: {},
        select: { id: true },
      });

      await prisma.rssCachedPost.upsert({
        where: { postId: post.id },
        create: { feedId: feed.id, postId: post.id },
        update: {},
      });
    } catch (err) {
      logger.warn({ err, link, feedUrl: feed.url }, "rss sweep failed to cache an item");
    }
  }

  await prisma.rssFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: new Date() } });
}

// Same "only bother polling what someone actually cares about" shape as
// federation/exploreSweep.ts's runExploreSweep.
export async function runRssSweep(): Promise<void> {
  const feeds = await prisma.rssFeed.findMany({ where: { subscriptions: { some: {} } } });
  for (const feed of feeds) {
    await sweepFeed(feed);
  }
}

export function startRssSweep(intervalMs = 10 * 60_000): void {
  runRssSweep().catch((err) => console.error("[rssFeeds] initial sweep failed:", err));
  setInterval(() => {
    runRssSweep().catch((err) => console.error("[rssFeeds] sweep failed:", err));
  }, intervalMs);
}

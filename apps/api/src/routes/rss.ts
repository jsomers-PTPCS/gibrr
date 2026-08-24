import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { findOrCreateRssFeed, sweepFeed } from "../federation/rssFeeds.js";

export const rssRouter = Router();

const subscribeSchema = z.object({ url: z.string().url() });

function serializeSubscription(sub: { id: string; feed: { id: string; url: string; title: string | null } }) {
  return { id: sub.id, feedId: sub.feed.id, url: sub.feed.url, title: sub.feed.title };
}

// GET /rss/subscriptions -> the viewer's own listened-to feeds.
rssRouter.get("/rss/subscriptions", requireAuth, async (req, res) => {
  const subs = await prisma.rssSubscription.findMany({
    where: { actorId: req.actor!.id },
    include: { feed: { select: { id: true, url: true, title: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(subs.map(serializeSubscription));
});

// POST /rss/subscriptions { url } -> self-service (any user, not just
// the Host — see RssFeed's own comment on why this differs from
// ExploreServer). Find-or-create the shared feed resource, then this
// viewer's own subscription to it; fires an immediate one-off sweep
// (same "don't make them wait for the next interval tick" reasoning as
// POST /explore/:domain/subscribe) so listening to a feed shows content
// right away instead of up to 10 minutes later.
rssRouter.post("/rss/subscriptions", requireAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let feed;
  try {
    feed = await findOrCreateRssFeed(parsed.data.url);
  } catch {
    return res.status(422).json({ error: "couldn't read that as an RSS or Atom feed" });
  }

  const existing = await prisma.rssSubscription.findUnique({
    where: { actorId_feedId: { actorId: req.actor!.id, feedId: feed.id } },
  });
  if (existing) return res.status(409).json({ error: "already listening to this feed" });

  const subscription = await prisma.rssSubscription.create({
    data: { actorId: req.actor!.id, feedId: feed.id },
  });

  void sweepFeed(feed);

  res.status(201).json(serializeSubscription({ id: subscription.id, feed }));
});

// DELETE /rss/subscriptions/:id -> stop listening. Only removes the
// viewer's own subscription row — the shared RssFeed and whatever it's
// already cached stay in place for any other subscriber.
rssRouter.delete("/rss/subscriptions/:id", requireAuth, async (req, res) => {
  const existing = await prisma.rssSubscription.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }
  await prisma.rssSubscription.delete({ where: { id: existing.id } });
  res.status(204).end();
});

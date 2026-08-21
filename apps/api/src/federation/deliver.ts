import type { Actor, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { signRequest, computeDigest } from "./httpSignature.js";
import { actorIri, isLocalActor } from "./localActor.js";
import { isDomainBlocked } from "./domainBlocks.js";

// The raw signed-POST attempt, shared by deliverActivity's immediate
// try and deliveryQueue.ts's retry sweep — the sweep calls this
// directly (not deliverActivity) so a repeated failure updates the
// existing OutboundDelivery row instead of enqueueing a duplicate one.
// Returns success/failure rather than throwing; the caller decides what
// happens next (log and move on for a first attempt, adjust the retry
// row's attempts/backoff for a sweep retry).
export async function attemptDelivery(
  from: Pick<Actor, "username" | "domain" | "privateKey">,
  inboxUrl: string,
  activity: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!from.privateKey || !inboxUrl) return { ok: false, error: "missing private key or inbox URL" };

  try {
    const target = new URL(inboxUrl);
    const date = new Date().toUTCString();
    const body = Buffer.from(JSON.stringify(activity));
    const digest = computeDigest(body);
    const { signature } = signRequest({
      method: "POST",
      url: inboxUrl,
      headers: { host: target.host, date, digest },
      keyId: `${actorIri(from)}#main-key`,
      privateKey: from.privateKey,
      signedHeaders: ["(request-target)", "host", "date", "digest"],
    });

    const response = await fetch(inboxUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        Date: date,
        Digest: digest,
        Signature: signature,
      },
      body,
    });
    if (!response.ok) {
      return { ok: false, error: `responded ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Queues a failed delivery for retry — this app's in-process substitute
// for a real job queue (see the OutboundDelivery model's own comment).
// First retry 1 minute out; deliveryQueue.ts's sweep owns the rest of
// the backoff schedule as attempts accumulate.
async function scheduleRetry(from: Actor, inboxUrl: string, activity: Record<string, unknown>, error: string) {
  await prisma.outboundDelivery.create({
    data: {
      actorId: from.id,
      inboxUrl,
      activity: activity as Prisma.InputJsonValue,
      nextAttemptAt: new Date(Date.now() + 60_000),
      lastError: error,
    },
  });
}

// Signed delivery — tries once immediately, exactly like this function
// always has, so the common case (a reachable inbox) is unchanged; on
// failure, instead of only logging and giving up, queues a retry
// (scheduleRetry) so a briefly-down follower's inbox doesn't silently
// miss the activity forever. Never throws, so a single unreachable
// remote inbox never breaks the local action (creating a post, voting,
// etc.) that triggered it.
export async function deliverActivity(
  from: Actor,
  inboxUrl: string,
  activity: Record<string, unknown>,
): Promise<void> {
  if (!from.privateKey || !inboxUrl) return;

  // Never sends to (or queues a retry for) a blocked domain — the
  // outbound half of instance-level defederation, see DomainBlock's
  // comment. deliveryQueue.ts's retry sweep applies the same check for
  // rows that were already queued before a block was added.
  try {
    if (await isDomainBlocked(new URL(inboxUrl).host)) {
      console.log(`[deliver] skipped ${activity.type} to ${inboxUrl} — domain blocked`);
      return;
    }
  } catch {
    // Unparseable inboxUrl — attemptDelivery below will fail on it too.
  }

  const result = await attemptDelivery(from, inboxUrl, activity);
  if (!result.ok) {
    console.error(`[deliver] failed to deliver ${activity.type} to ${inboxUrl}: ${result.error}`);
    await scheduleRetry(from, inboxUrl, activity, result.error);
  }
}

// A signed GET, for dereferencing actors/objects on instances running
// "authorized fetch" / secure mode, where even a plain lookup must carry a
// valid Signature or gets rejected. Falls back to an unsigned GET when
// `signAs` has no private key (nothing to sign with) — works against any
// instance that doesn't require it, which is most of them.
export async function signedGet(
  url: string,
  signAs: Pick<Actor, "username" | "domain" | "privateKey"> | undefined,
  accept = "application/activity+json",
): Promise<Response> {
  if (!signAs?.privateKey) {
    return fetch(url, { headers: { Accept: accept } });
  }

  const target = new URL(url);
  const date = new Date().toUTCString();
  const { signature } = signRequest({
    method: "GET",
    url,
    headers: { host: target.host, date },
    keyId: `${actorIri(signAs)}#main-key`,
    privateKey: signAs.privateKey,
  });

  return fetch(url, { headers: { Accept: accept, Date: date, Signature: signature } });
}

// Delivers to every accepted follower's inbox — skips local followers
// entirely (they read straight from the DB, nothing to deliver) and any
// remote follower we don't have a usable inbox URL for.
export async function deliverToFollowers(from: Actor, activity: Record<string, unknown>): Promise<void> {
  const follows = await prisma.follow.findMany({
    where: { followingId: from.id, state: "accepted" },
    include: { follower: true },
  });
  const remoteFollowers = follows
    .map((f) => f.follower)
    .filter((actor) => !isLocalActor(actor) && actor.inboxUrl);

  await Promise.allSettled(remoteFollowers.map((actor) => deliverActivity(from, actor.inboxUrl, activity)));
}

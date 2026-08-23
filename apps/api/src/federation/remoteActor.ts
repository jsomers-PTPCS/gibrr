import type { Actor, ActorType } from "@prisma/client";
import { prisma } from "../db.js";
import { schemeFor } from "./urls.js";
import { signedGet } from "./deliver.js";
import { isDomainBlocked } from "./domainBlocks.js";
import { toDescriptionHtml } from "./descriptionHtml.js";
import { logger } from "../logger.js";

export interface RemoteActorPayload {
  id: string;
  type?: string;
  preferredUsername?: string;
  name?: string;
  summary?: string;
  inbox?: string;
  outbox?: string;
  publicKey?: { publicKeyPem?: string };
  // Already-absolute URLs on a remote actor, unlike the relative
  // /uploads/... paths a local actor's avatarImageUrl/headerImageUrl
  // hold — see lib/api.ts's assetUrl() fix on the frontend, which passes
  // an already-absolute URL through instead of re-prefixing it.
  icon?: { url?: string };
  image?: { url?: string };
}

type SignAs = Pick<Actor, "username" | "domain" | "privateKey">;

// `signAs`, when given, signs the request — required to dereference
// actors/objects on instances running "authorized fetch" / secure mode,
// which reject unsigned GETs outright. Webfinger itself is left unsigned
// (it's meant to be publicly, anonymously fetchable per spec — real
// instances don't gate it behind authorized fetch).
export async function fetchRemoteActor(
  actorIri: string,
  signAs?: SignAs,
): Promise<RemoteActorPayload | null> {
  const response = await signedGet(actorIri, signAs);
  if (!response.ok) return null;
  return (await response.json()) as RemoteActorPayload;
}

// Generic counterpart to fetchRemoteActor — for dereferencing an
// arbitrary AP object (a Note we don't already host, referenced by an
// incoming Announce whose `object` is just an IRI, not embedded). Same
// signed-GET as actor lookups, works against authorized-fetch instances
// the same way.
export async function fetchRemoteObject(
  iri: string,
  signAs?: SignAs,
): Promise<Record<string, unknown> | null> {
  const response = await signedGet(iri, signAs);
  if (!response.ok) return null;
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    // A 200 doesn't guarantee a real AP JSON body — confirmed live: a
    // Ghost blog permalink returns 200 text/html regardless of Accept,
    // which previously 500'd every caller (resolveAndCacheRemotePost,
    // inbox processing, GET /posts/resolve) instead of the graceful
    // "couldn't resolve this" every other failure mode here already gets.
    logger.warn({ err, iri }, "remote object fetch returned a non-JSON body");
    return null;
  }
}

// Given a fediverse handle ("user@domain"), webfinger-discovers the
// actor's IRI on that domain, then fetches the actor object itself.
export async function discoverActor(handle: string, signAs?: SignAs): Promise<RemoteActorPayload | null> {
  const [username, domain] = handle.split("@");
  if (!username || !domain) return null;
  // Refuses to start a *new* relationship with a blocked domain —
  // follow, mention, remote-group join, relay subscribe all resolve a
  // handle through here first. An already-cached actor from a domain
  // blocked after the fact isn't purged (see DomainBlock's comment) but
  // nothing new gets discovered from it either.
  if (await isDomainBlocked(domain)) return null;

  const resource = `acct:${username}@${domain}`;
  const webfingerUrl = `${schemeFor(domain)}://${domain}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`;

  const response = await fetch(webfingerUrl, { headers: { Accept: "application/jrd+json" } });
  if (!response.ok) return null;
  const jrd = (await response.json()) as { links?: { rel?: string; type?: string; href?: string }[] };

  const link = jrd.links?.find(
    (l) => l.rel === "self" && (l.type === "application/activity+json" || l.type === "application/ld+json"),
  );
  if (!link?.href) return null;

  return fetchRemoteActor(link.href, signAs);
}

// Caches (or refreshes) a remote actor in our Actor table so we have a
// local id/inboxUrl to work with — used both for accepting an incoming
// activity and for following someone we just discovered. `type` is only
// set on first insert, not on refresh — an actor's Person/Group identity
// doesn't change, so there's no reason to let a re-fetch flip it.
export async function upsertRemoteActor(remote: RemoteActorPayload) {
  const url = new URL(remote.id);
  const username = remote.preferredUsername ?? url.pathname.split("/").pop() ?? remote.id;
  // Application/Service preserved (not collapsed to Person) — real relay
  // software self-reports as one or the other; everything else defaults
  // to Person, unchanged from before.
  const type: ActorType =
    remote.type === "Group" || remote.type === "Application" || remote.type === "Service"
      ? remote.type
      : "Person";

  // A real actor's summary is Mastodon-flavored HTML, not plain text —
  // sanitized down to the same safe subset (and, incidentally, the same
  // pipeline) a remote group's description already goes through, so it's
  // safe for the profile page to render with dangerouslySetInnerHTML
  // instead of showing the raw tags as text.
  const summary = remote.summary ? toDescriptionHtml(remote.summary) : remote.summary;

  return prisma.actor.upsert({
    where: { username_domain: { username, domain: url.host } },
    create: {
      username,
      domain: url.host,
      type,
      displayName: remote.name,
      summary,
      avatarImageUrl: remote.icon?.url ?? null,
      headerImageUrl: remote.image?.url ?? null,
      publicKey: remote.publicKey?.publicKeyPem ?? "",
      inboxUrl: remote.inbox ?? "",
      outboxUrl: remote.outbox ?? "",
    },
    update: {
      displayName: remote.name,
      summary,
      avatarImageUrl: remote.icon?.url ?? null,
      headerImageUrl: remote.image?.url ?? null,
      publicKey: remote.publicKey?.publicKeyPem ?? "",
      inboxUrl: remote.inbox ?? "",
      outboxUrl: remote.outbox ?? "",
    },
  });
}

import type { Actor, Prisma, ActorType } from "@prisma/client";
import { prisma } from "../db.js";
import { generateActorKeyPair } from "./keys.js";
import { originFor } from "./urls.js";

// Username for this instance's own system actor — see
// getOrCreateInstanceActor below. Deliberately contains a dot: POST
// /auth/register's username schema (routes/auth.ts) only ever allows
// `^[a-zA-Z0-9_]+$`, so this can never collide with a real registered
// account without any extra reserved-word check needed.
const INSTANCE_ACTOR_USERNAME = "relay.actor";

export function localDomain(): string {
  return process.env.DOMAIN ?? `localhost:${process.env.PORT ?? 4000}`;
}

// This instance controls the keypair only for actors it created — remote
// actors (cached from webfinger/inbox activity) never have one. Domain
// comparison would work too, but this is the same signal privateKey's own
// nullability already encodes, so it doubles as documentation of why
// privateKey is nullable.
export function isLocalActor(actor: Pick<Actor, "domain">): boolean {
  return actor.domain === localDomain();
}

export function actorIri(actor: Pick<Actor, "username" | "domain">): string {
  return `${originFor(actor.domain)}/users/${actor.username}`;
}

// avatarImageUrl/headerImageUrl on a local actor are always our own
// relative /uploads/... paths (see routes/profileImage.ts) — never called
// for a remote actor, whose image URLs are already absolute. Passes an
// already-absolute value through unchanged rather than re-prefixing it —
// defensive, not just theoretical: testing two "instances" against one
// shared dev Postgres means an inbox delivery's re-upsert of the sender's
// own actor (for signature verification) can collapse onto that actor's
// real row across both "servers," which would otherwise double-prefix
// this field on every round trip. Real deployments never share a
// database, so this can't happen there, but the check is free.
export function absoluteAssetUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${originFor(localDomain())}${path}`;
}

// The full ActivityPub Actor object — shared by GET /users/:username and
// the Update(Actor) activity delivered on a profile/group edit
// (federation/activities.ts's updateActorActivity), so the two can't
// drift apart. icon/image (avatar/header) are included only when an
// image was actually uploaded — the built-in presets (imagePresets.ts)
// are frontend-only SVG data URIs with no real URL to federate, a
// disclosed gap rather than something worth inventing a workaround for.
export function createActorObject(actor: Actor): Record<string, unknown> {
  const actorUrl = actorIri(actor);
  return {
    "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
    id: actorUrl,
    type: actor.type,
    preferredUsername: actor.username,
    name: actor.displayName ?? actor.username,
    summary: actor.summary ?? "",
    inbox: actor.inboxUrl,
    outbox: actor.outboxUrl,
    followers: `${actorUrl}/followers`,
    following: `${actorUrl}/following`,
    endpoints: { sharedInbox: `${originFor(localDomain())}/inbox` },
    publicKey: {
      id: `${actorUrl}#main-key`,
      owner: actorUrl,
      publicKeyPem: actor.publicKey,
    },
    ...(actor.avatarImageUrl
      ? { icon: { type: "Image", url: absoluteAssetUrl(actor.avatarImageUrl) } }
      : {}),
    ...(actor.headerImageUrl
      ? { image: { type: "Image", url: absoluteAssetUrl(actor.headerImageUrl) } }
      : {}),
  };
}

interface CreateLocalActorParams {
  username: string;
  type: ActorType;
  displayName?: string;
  summary?: string;
}

// Shared by user registration, community creation, and the seed script:
// every local actor (person or group) needs a keypair and the same
// inbox/outbox URL shape, matching what routes/actor.ts serves.
export function createLocalActor(
  tx: Prisma.TransactionClient,
  { username, type, displayName, summary }: CreateLocalActorParams,
) {
  const domain = localDomain();
  const { publicKey, privateKey } = generateActorKeyPair();
  const actorUrl = `${originFor(domain)}/users/${username}`;

  return tx.actor.create({
    data: {
      username,
      domain,
      type,
      displayName,
      summary,
      publicKey,
      privateKey,
      inboxUrl: `${actorUrl}/inbox`,
      outboxUrl: `${actorUrl}/outbox`,
    },
  });
}

// This instance's own system actor — sends/receives relay subscription
// Follows (routes/admin.ts's relay endpoints) on the instance's behalf
// rather than any one person's, matching how real relay software
// expects to be followed by an instance-level actor, not a specific
// user. Lazily created on first use rather than seeded at migration
// time, matching this app's existing on-demand patterns (e.g. no seed
// data required for admin). type: "Service" means every existing
// Person/Group-scoped query (search's actor results, GET /admin/users
// via LocalUser, community listings) already excludes it naturally —
// it has no LocalUser row (never a real login) and doesn't match any
// `type: "Person"` or `type: "Group"` filter anywhere in this app.
export async function getOrCreateInstanceActor(): Promise<Actor> {
  const domain = localDomain();
  const existing = await prisma.actor.findUnique({
    where: { username_domain: { username: INSTANCE_ACTOR_USERNAME, domain } },
  });
  if (existing) return existing;

  return prisma.$transaction((tx) =>
    createLocalActor(tx, { username: INSTANCE_ACTOR_USERNAME, type: "Service" }),
  );
}

// The private key signs outgoing federation requests and calendarExportToken
// is a bearer credential for GET /calendar/export/:token.ics — neither may
// reach a client via a generic actor serialization. calendarExportToken is
// only ever returned by the dedicated /calendar/export-token endpoints.
export function toPublicActor(
  actor: Actor,
): Omit<Actor, "privateKey" | "calendarExportToken"> {
  const { privateKey: _privateKey, calendarExportToken: _calendarExportToken, ...publicActor } =
    actor;
  return publicActor;
}

import type { Actor, Prisma, ActorType } from "@prisma/client";
import { generateActorKeyPair } from "./keys.js";

export function localDomain(): string {
  return process.env.DOMAIN ?? `localhost:${process.env.PORT ?? 4000}`;
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
  const actorUrl = `http://${domain}/users/${username}`;

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

// The private key signs outgoing federation requests and must never reach
// a client — strip it before any actor is serialized into an API response.
export function toPublicActor(actor: Actor): Omit<Actor, "privateKey"> {
  const { privateKey: _privateKey, ...publicActor } = actor;
  return publicActor;
}

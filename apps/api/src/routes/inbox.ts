import { Router } from "express";
import { prisma } from "../db.js";
import { verifySignedRequest } from "../federation/httpSignature.js";

export const inboxRouter = Router();

// POST /users/:username/inbox -> federation entrypoint for incoming activities.
// Verifies the sender's HTTP signature, then handles the small subset of
// activity types this scaffold understands (Follow). Anything else is
// accepted (202) and logged, but not yet processed.
inboxRouter.post("/users/:username/inbox", async (req, res) => {
  const targetActor = await prisma.actor.findFirst({
    where: { username: req.params.username },
  });
  if (!targetActor) return res.status(404).json({ error: "not found" });

  const activity = req.body;
  const actorIri: string | undefined =
    typeof activity?.actor === "string" ? activity.actor : activity?.actor?.id;
  if (!activity?.type || !actorIri) {
    return res.status(400).json({ error: "invalid activity" });
  }

  const remoteActor = await fetchRemoteActor(actorIri);
  if (!remoteActor?.publicKey?.publicKeyPem) {
    return res.status(401).json({ error: "could not resolve sender key" });
  }

  const verified = verifySignedRequest({ req, publicKey: remoteActor.publicKey.publicKeyPem });
  if (!verified) {
    return res.status(401).json({ error: "invalid signature" });
  }

  if (activity.type === "Follow") {
    const remote = await upsertRemoteActor(remoteActor);
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: remote.id, followingId: targetActor.id } },
      create: { followerId: remote.id, followingId: targetActor.id, state: "accepted" },
      update: { state: "accepted" },
    });
    console.log(`[inbox] ${remoteActor.id} followed ${targetActor.username}`);
  } else {
    console.log(`[inbox] received unhandled activity type: ${activity.type}`);
  }

  res.status(202).end();
});

async function fetchRemoteActor(actorIri: string) {
  const response = await fetch(actorIri, {
    headers: { Accept: "application/activity+json" },
  });
  if (!response.ok) return null;
  return (await response.json()) as {
    id: string;
    preferredUsername?: string;
    inbox?: string;
    outbox?: string;
    publicKey?: { publicKeyPem?: string };
  };
}

async function upsertRemoteActor(remote: {
  id: string;
  preferredUsername?: string;
  inbox?: string;
  outbox?: string;
  publicKey?: { publicKeyPem?: string };
}) {
  const url = new URL(remote.id);
  const username = remote.preferredUsername ?? url.pathname.split("/").pop() ?? remote.id;

  return prisma.actor.upsert({
    where: { username_domain: { username, domain: url.host } },
    create: {
      username,
      domain: url.host,
      publicKey: remote.publicKey?.publicKeyPem ?? "",
      inboxUrl: remote.inbox ?? "",
      outboxUrl: remote.outbox ?? "",
    },
    update: {
      publicKey: remote.publicKey?.publicKeyPem ?? "",
      inboxUrl: remote.inbox ?? "",
      outboxUrl: remote.outbox ?? "",
    },
  });
}

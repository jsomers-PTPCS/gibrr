import { Router } from "express";
import { prisma } from "../db.js";

export const actorRouter = Router();

// GET /users/:username -> ActivityPub Actor object
actorRouter.get("/users/:username", async (req, res) => {
  const domain = req.hostname === "localhost" ? req.get("host") : req.hostname;
  const actor = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: domain ?? undefined },
  });
  if (!actor) return res.status(404).json({ error: "not found" });

  const actorUrl = `http://${actor.domain}/users/${actor.username}`;

  res.set("Content-Type", "application/activity+json");
  res.json({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: actorUrl,
    type: actor.type,
    preferredUsername: actor.username,
    name: actor.displayName ?? actor.username,
    summary: actor.summary ?? "",
    inbox: actor.inboxUrl,
    outbox: actor.outboxUrl,
    publicKey: {
      id: `${actorUrl}#main-key`,
      owner: actorUrl,
      publicKeyPem: actor.publicKey,
    },
  });
});

// GET /users/:username/outbox -> empty collection for now (posting comes later)
actorRouter.get("/users/:username/outbox", async (req, res) => {
  const domain = req.hostname === "localhost" ? req.get("host") : req.hostname;
  const actor = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: domain ?? undefined },
  });
  if (!actor) return res.status(404).json({ error: "not found" });

  res.set("Content-Type", "application/activity+json");
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: actor.outboxUrl,
    type: "OrderedCollection",
    totalItems: 0,
    orderedItems: [],
  });
});

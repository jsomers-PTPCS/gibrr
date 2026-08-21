import { Router } from "express";
import { prisma } from "../db.js";
import { actorIri } from "../federation/localActor.js";

export const webfingerRouter = Router();

// GET /.well-known/webfinger?resource=acct:username@domain
webfingerRouter.get("/.well-known/webfinger", async (req, res) => {
  const resource = req.query.resource;
  if (typeof resource !== "string" || !resource.startsWith("acct:")) {
    return res.status(400).json({ error: "invalid or missing resource parameter" });
  }

  const [username, domain] = resource.slice("acct:".length).split("@");
  if (!username || !domain) {
    return res.status(400).json({ error: "resource must be acct:user@domain" });
  }

  const actor = await prisma.actor.findUnique({
    where: { username_domain: { username, domain } },
  });
  if (!actor) return res.status(404).json({ error: "not found" });

  const actorUrl = actorIri(actor);

  res.set("Content-Type", "application/jrd+json");
  res.json({
    subject: resource,
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actorUrl,
      },
    ],
  });
});

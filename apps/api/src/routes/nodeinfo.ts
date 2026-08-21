import { Router } from "express";
import { prisma } from "../db.js";
import { localDomain } from "../federation/localActor.js";
import { originFor } from "../federation/urls.js";

export const nodeinfoRouter = Router();

// GET /.well-known/nodeinfo -> points to the 2.0 document below. Some
// federation tooling/instances check this to identify what software a
// peer runs before deciding how to treat it — standard discovery, not
// something anything in this app currently reads itself.
nodeinfoRouter.get("/.well-known/nodeinfo", (_req, res) => {
  res.json({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
        href: `${originFor(localDomain())}/nodeinfo/2.0`,
      },
    ],
  });
});

nodeinfoRouter.get("/nodeinfo/2.0", async (_req, res) => {
  const [users, localPosts] = await Promise.all([
    prisma.actor.count({ where: { domain: localDomain(), type: "Person" } }),
    prisma.post.count({ where: { author: { domain: localDomain() } } }),
  ]);

  res.set("Content-Type", "application/json; profile=\"http://nodeinfo.diaspora.software/ns/schema/2.0#\"");
  res.json({
    version: "2.0",
    software: { name: "gibrr", version: "0.1.0" },
    protocols: ["activitypub"],
    services: { outbound: [], inbound: [] },
    usage: { users: { total: users }, localPosts },
    openRegistrations: true,
    metadata: {},
  });
});

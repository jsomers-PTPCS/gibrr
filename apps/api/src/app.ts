import cors from "cors";
import express from "express";
import { healthRouter } from "./routes/health.js";
import { webfingerRouter } from "./routes/webfinger.js";
import { actorRouter } from "./routes/actor.js";
import { inboxRouter } from "./routes/inbox.js";

export function createApp() {
  const app = express();

  // The web app runs on a different origin in dev (localhost:3000 vs
  // localhost:4000); browsers enforce CORS on that fetch regardless of curl
  // working fine. Federation requests (server-to-server) aren't affected by
  // CORS at all, so this only matters for the web client.
  app.use(cors());

  // ActivityPub payloads arrive as application/activity+json (or ld+json),
  // not the plain application/json express.json() parses by default.
  app.use(
    express.json({
      type: ["application/json", "application/activity+json", "application/ld+json"],
    }),
  );

  app.use(healthRouter);
  app.use(webfingerRouter);
  app.use(actorRouter);
  app.use(inboxRouter);

  return app;
}

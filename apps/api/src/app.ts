import "express-async-errors";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { healthRouter } from "./routes/health.js";
import { webfingerRouter } from "./routes/webfinger.js";
import { actorRouter } from "./routes/actor.js";
import { inboxRouter } from "./routes/inbox.js";
import { authRouter } from "./routes/auth.js";
import { setupRouter } from "./routes/setup.js";
import { communitiesRouter } from "./routes/communities.js";
import { postsRouter } from "./routes/posts.js";
import { profileRouter } from "./routes/profile.js";
import { commentsRouter } from "./routes/comments.js";
import { profileImageRouter } from "./routes/profileImage.js";
import { conversationsRouter } from "./routes/conversations.js";
import { searchRouter } from "./routes/search.js";
import { calendarRouter } from "./routes/calendar.js";
import { friendsRouter } from "./routes/friends.js";
import { familyRouter } from "./routes/family.js";
import { photosRouter } from "./routes/photos.js";
import { followsRouter } from "./routes/follows.js";
import { blocksRouter } from "./routes/blocks.js";
import { reportsRouter } from "./routes/reports.js";
import { directoryLinksRouter } from "./routes/directoryLinks.js";
import { customEmojiRouter } from "./routes/customEmoji.js";
import { nodeinfoRouter } from "./routes/nodeinfo.js";
import { adminRouter } from "./routes/admin.js";
import { antennasRouter } from "./routes/antennas.js";
import { exploreRouter } from "./routes/explore.js";
import { UPLOADS_DIR } from "./uploads.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // The exact bytes received, captured before JSON parsing — inbox.ts
      // needs this to verify a signed request's Digest header, since a
      // signature can be valid while covering only headers, not the body.
      rawBody?: Buffer;
    }
  }
}

export function createApp() {
  const app = express();

  // Real deployments sit behind a reverse proxy (Caddy/nginx terminating
  // TLS) — without this, express-rate-limit refuses to start (it treats a
  // present X-Forwarded-For as spoofable when the app hasn't explicitly
  // opted into trusting it) and req.ip would resolve to the proxy's
  // address for every request instead of the real client's. "1" trusts
  // exactly one hop, matching the single reverse-proxy topology docker
  // deploy/ sets up — not a bare `true`, which would trust the whole chain.
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // The web app runs on a different origin in dev (localhost:3000 vs
  // localhost:4000); browsers enforce CORS on that fetch regardless of curl
  // working fine. Federation requests (server-to-server) aren't affected by
  // CORS at all, so this only matters for the web client. Sessions ride on
  // a cookie, which requires an explicit origin + credentials, not "*".
  app.use(
    cors({
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      credentials: true,
    }),
  );
  // CSP off: this is a pure JSON API, no HTML rendered here to protect.
  // CORP relaxed to cross-origin: /uploads/* images must stay loadable
  // by the separate-origin web app and by remote federated servers
  // fetching avatar/header images.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(pinoHttp({ logger }));
  app.use(cookieParser());

  // ActivityPub payloads arrive as application/activity+json (or ld+json),
  // not the plain application/json express.json() parses by default.
  app.use(
    express.json({
      type: ["application/json", "application/activity+json", "application/ld+json"],
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
  );

  // Uploaded profile images — filenames are server-generated UUIDs (see
  // uploads.ts), so this is just serving already-safe static files.
  app.use("/uploads", express.static(UPLOADS_DIR));

  app.use(healthRouter);
  app.use(webfingerRouter);
  app.use(actorRouter);
  app.use(inboxRouter);
  app.use(authRouter);
  app.use(setupRouter);
  app.use(communitiesRouter);
  app.use(postsRouter);
  app.use(profileRouter);
  app.use(commentsRouter);
  app.use(profileImageRouter);
  app.use(conversationsRouter);
  app.use(searchRouter);
  app.use(calendarRouter);
  app.use(friendsRouter);
  app.use(familyRouter);
  app.use(photosRouter);
  app.use(followsRouter);
  app.use(blocksRouter);
  app.use(reportsRouter);
  app.use(directoryLinksRouter);
  app.use(customEmojiRouter);
  app.use(nodeinfoRouter);
  app.use(antennasRouter);
  app.use(exploreRouter);
  app.use(adminRouter);

  // Last resort: express-async-errors (imported above) forwards any
  // rejected promise from an async route handler here instead of it
  // hanging/crashing unhandled — without that import this would never
  // be reached for the async bugs that matter most.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    req.log?.error({ err }, "unhandled request error");
    if (res.headersSent) return;
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}

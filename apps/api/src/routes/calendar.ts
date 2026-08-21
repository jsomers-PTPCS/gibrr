import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import {
  testConnection,
  fetchUpcomingEvents,
  testIcsUrl,
  fetchUpcomingEventsFromIcsUrl,
} from "../calendarClient.js";
import { buildIcsFeed } from "../icsWriter.js";
import { localDomain } from "../federation/localActor.js";
import { originFor } from "../federation/urls.js";

export const calendarRouter = Router();

// Mirrors calendarClient.ts's constants — small local duplication rather
// than exporting/importing, same call already made elsewhere in this repo
// (e.g. the About-field key lists between frontend/backend).
const MAX_EVENTS = 20;
const WINDOW_DAYS = 30;

const connectSchema = z.object({
  serverUrl: z.string().url(),
  username: z.string().min(1).max(200),
  appPassword: z.string().min(1).max(500),
  calendarPath: z.string().max(500).optional(),
});

// POST /calendar/connect -> verifies the connection actually works before
// storing anything (see calendarClient.testConnection) — bad credentials
// or an unreachable server fail here, not on every later event fetch.
// Also switches provider back to "caldav" — this row represents one
// connected calendar at a time, whichever the caller most recently
// connected.
calendarRouter.post("/calendar/connect", requireAuth, async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    await testConnection(parsed.data);
  } catch {
    return res
      .status(400)
      .json({ error: "could not connect — check the URL, username, and password" });
  }

  await prisma.calendarConnection.upsert({
    where: { actorId: req.actor!.id },
    create: { actorId: req.actor!.id, provider: "caldav", ...parsed.data },
    update: { provider: "caldav", ...parsed.data },
  });

  res.json({ connected: true });
});

const icalConnectSchema = z.object({
  icalUrl: z.string().url(),
});

// POST /calendar/connect/ical -> zero-setup alternative to CalDAV: any
// plain .ics feed URL (e.g. Google Calendar's own "Secret address in iCal
// format" from its settings, or Outlook/Apple's calendar links). Same
// "verify before saving" and "never surface raw remote content" rules as
// the CalDAV path — see calendarClient.ts.
calendarRouter.post("/calendar/connect/ical", requireAuth, async (req, res) => {
  const parsed = icalConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    await testIcsUrl(parsed.data.icalUrl);
  } catch {
    return res
      .status(400)
      .json({ error: "could not read that URL as an iCal feed — check the link" });
  }

  await prisma.calendarConnection.upsert({
    where: { actorId: req.actor!.id },
    create: { actorId: req.actor!.id, provider: "ical", serverUrl: parsed.data.icalUrl },
    update: {
      provider: "ical",
      serverUrl: parsed.data.icalUrl,
      username: null,
      appPassword: null,
      calendarPath: null,
    },
  });

  res.json({ connected: true });
});

// GET /calendar/status -> connection metadata only, never tokens/passwords
// (matches the write-only convention LocalUser.passwordHash already
// uses). An "ical" serverUrl often embeds a bearer secret in the path
// itself (e.g. Google's private feed link) — treated the same way, never
// returned after the initial connect.
calendarRouter.get("/calendar/status", requireAuth, async (req, res) => {
  const connection = await prisma.calendarConnection.findUnique({
    where: { actorId: req.actor!.id },
    select: { provider: true, serverUrl: true, calendarPath: true },
  });
  if (!connection) return res.json({ connected: false });
  res.json({
    connected: true,
    ...connection,
    serverUrl: connection.provider === "ical" ? undefined : connection.serverUrl,
  });
});

calendarRouter.delete("/calendar/connection", requireAuth, async (req, res) => {
  await prisma.calendarConnection.deleteMany({ where: { actorId: req.actor!.id } });
  res.status(204).end();
});

interface CalendarEventOut {
  summary: string;
  start: string;
  end: string;
  location: string | null;
  postId?: string;
}

// Best-effort — a broken/stale external connection shouldn't blank out
// local event-posts, which are a fully independent, reliable source.
// Failures are logged server-side only; the client never sees why an
// external fetch failed (same "no raw remote content" rule as elsewhere).
async function fetchExternalEvents(
  connection: NonNullable<Awaited<ReturnType<typeof prisma.calendarConnection.findUnique>>>,
): Promise<CalendarEventOut[]> {
  try {
    if (connection.provider === "ical") {
      return await fetchUpcomingEventsFromIcsUrl(connection.serverUrl!);
    }
    return await fetchUpcomingEvents({
      serverUrl: connection.serverUrl!,
      username: connection.username!,
      appPassword: connection.appPassword!,
      calendarPath: connection.calendarPath ?? undefined,
    });
  } catch (err) {
    console.error(`calendar: external fetch failed for connection ${connection.id}:`, err);
    return [];
  }
}

// POST /calendar/save/:postId -> add an event post to the caller's own
// calendar. Deliberately independent of authorship — anyone can save
// anyone else's event post (posts are already fully public in this app).
// Idempotent: saving something already saved is just a no-op success.
calendarRouter.post("/calendar/save/:postId", requireAuth, async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.postId } });
  if (!post) return res.status(404).json({ error: "not found" });
  if (!post.eventStart) return res.status(400).json({ error: "post is not an event" });

  await prisma.calendarEventSave.upsert({
    where: { actorId_postId: { actorId: req.actor!.id, postId: post.id } },
    create: { actorId: req.actor!.id, postId: post.id },
    update: {},
  });

  res.json({ saved: true });
});

// DELETE /calendar/save/:postId -> remove an event from the caller's own
// calendar. Idempotent whether or not it was saved.
calendarRouter.delete("/calendar/save/:postId", requireAuth, async (req, res) => {
  await prisma.calendarEventSave.deleteMany({
    where: { actorId: req.actor!.id, postId: req.params.postId },
  });
  res.status(204).end();
});

// GET /calendar/events/:username -> merges event posts this actor has
// added to their own calendar (CalendarEventSave — independent of who
// authored them) with whichever external connection is present, if any.
// Gated by the same opt-in visibility mechanism as the rest of the About
// section (aboutVisibility.calendarEvents), except the owner always sees
// their own events regardless of the toggle.
calendarRouter.get("/calendar/events/:username", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const isOwner = req.actor?.id === actor.id;
  if (!isOwner) {
    const visibility = (actor.aboutVisibility as Record<string, boolean> | null) ?? {};
    if (visibility.calendarEvents !== true) {
      return res.status(403).json({ error: "not visible" });
    }
  }

  const now = new Date();
  const future = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [saves, connection] = await Promise.all([
    prisma.calendarEventSave.findMany({
      where: { actorId: actor.id, post: { eventStart: { gte: now, lte: future } } },
      orderBy: { post: { eventStart: "asc" } },
      take: MAX_EVENTS,
      select: {
        post: {
          select: { id: true, title: true, eventStart: true, eventEnd: true, eventLocation: true },
        },
      },
    }),
    prisma.calendarConnection.findUnique({ where: { actorId: actor.id } }),
  ]);

  const localEvents: CalendarEventOut[] = saves.map(({ post }) => ({
    // Post.title is nullable at the DB level now (federated timeline
    // content has none), but nothing ever marks federated content as a
    // calendar event — this fallback is just satisfying the type, not a
    // real-world case.
    summary: post.title ?? "Untitled event",
    start: post.eventStart!.toISOString(),
    end: (post.eventEnd ?? new Date(post.eventStart!.getTime() + 60 * 60 * 1000)).toISOString(),
    location: post.eventLocation,
    postId: post.id,
  }));

  const externalEvents = connection ? await fetchExternalEvents(connection) : [];

  const events = [...localEvents, ...externalEvents]
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_EVENTS);

  res.json(events);
});

function exportUrl(token: string): string {
  return `${originFor(localDomain())}/calendar/export/${token}.ics`;
}

// GET /calendar/export-token -> the caller's current export link, if
// they've generated one. Never returns the bare token separately from
// the URL (one less thing for the frontend to reassemble).
calendarRouter.get("/calendar/export-token", requireAuth, async (req, res) => {
  const actor = await prisma.actor.findUnique({
    where: { id: req.actor!.id },
    select: { calendarExportToken: true },
  });
  res.json({ url: actor?.calendarExportToken ? exportUrl(actor.calendarExportToken) : null });
});

// POST /calendar/export-token -> generates (or replaces) the caller's
// export token. Calling this again always issues a new one, immediately
// invalidating any previously-issued link — the only way to revoke one
// that's leaked.
calendarRouter.post("/calendar/export-token", requireAuth, async (req, res) => {
  const token = crypto.randomBytes(24).toString("hex");
  await prisma.actor.update({
    where: { id: req.actor!.id },
    data: { calendarExportToken: token },
  });
  res.json({ url: exportUrl(token) });
});

const MAX_EXPORT_EVENTS = 500;

// GET /calendar/export/:token.ics -> the token itself is the auth (same
// bearer-secret-URL pattern as Google's/CalDAV's own "secret address" —
// see the iCal-connect flow above); no session required. Exports only
// this actor's locally-saved events (CalendarEventSave), not anything
// pulled in from an external connection — see the plan for this feature
// for why. Deliberately doesn't distinguish "bad token" from "revoked"
// from "never existed" — all just a plain 404.
calendarRouter.get("/calendar/export/:token.ics", async (req, res) => {
  const actor = await prisma.actor.findUnique({
    where: { calendarExportToken: req.params.token },
  });
  if (!actor) return res.status(404).end();

  const saves = await prisma.calendarEventSave.findMany({
    where: { actorId: actor.id },
    orderBy: { post: { eventStart: "asc" } },
    take: MAX_EXPORT_EVENTS,
    select: {
      post: {
        select: { id: true, title: true, eventStart: true, eventEnd: true, eventLocation: true },
      },
    },
  });

  const events = saves.map(({ post }) => ({
    id: post.id,
    title: post.title ?? "Untitled event",
    start: post.eventStart!,
    end: post.eventEnd ?? new Date(post.eventStart!.getTime() + 60 * 60 * 1000),
    location: post.eventLocation,
  }));

  const feed = buildIcsFeed(`${actor.username}'s Gibrr calendar`, events);

  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Content-Disposition", `inline; filename="gibrr-${actor.username}.ics"`);
  res.send(feed);
});

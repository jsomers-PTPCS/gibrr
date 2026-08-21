import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import { saveProcessedImage } from "../uploads.js";
import {
  testConnection as testImmichConnection,
  fetchAlbums as fetchImmichAlbums,
  fetchAssetBytes as fetchImmichAssetBytes,
} from "../immichClient.js";

export const photosRouter = Router();

// Memory storage — same pattern as routes/profileImage.ts. 15MB cap (a
// bit more generous than the 8MB profile-image cap since these are
// meant to be full photos, not just avatars).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const PHOTO_FULL_SPEC = { width: 2048, height: 2048, fit: "inside" as const };
const PHOTO_THUMB_SPEC = { width: 400, height: 400, fit: "cover" as const };

const visibilitySchema = z.enum(["public", "private"]);

// Album visibility gates whether the album is visible at all; photo
// visibility only narrows further within an already-visible album — see
// the plan for this feature.
function isAlbumVisibleTo(album: { visibility: string; actorId: string }, viewerId?: string): boolean {
  return album.visibility === "public" || album.actorId === viewerId;
}

function isPhotoVisible(photo: { visibility: string | null }, isOwner: boolean): boolean {
  return isOwner || photo.visibility !== "private";
}

const createAlbumSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  visibility: visibilitySchema.default("private"),
});

photosRouter.post("/albums", requireAuth, async (req, res) => {
  const parsed = createAlbumSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const album = await prisma.album.create({ data: { actorId: req.actor!.id, ...parsed.data } });
  res.status(201).json(album);
});

// GET /albums/:username -> album list with a cover thumbnail + photo
// count; non-owners only see public albums.
photosRouter.get("/albums/:username", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const isOwner = req.actor?.id === actor.id;
  const albums = await prisma.album.findMany({
    where: { actorId: actor.id, ...(isOwner ? {} : { visibility: "public" }) },
    orderBy: { createdAt: "desc" },
    include: {
      photos: { take: 1, orderBy: { createdAt: "desc" }, select: { thumbnailUrl: true } },
      _count: { select: { photos: true } },
    },
  });

  res.json(
    albums.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      visibility: a.visibility,
      createdAt: a.createdAt,
      coverUrl: a.photos[0]?.thumbnailUrl ?? null,
      photoCount: a._count.photos,
    })),
  );
});

// GET /albums/:username/:albumId -> album detail + photos. A private
// album 404s for non-owners (not 403 — doesn't confirm/deny existence
// any differently than a bad ID would). Within a visible album, photos
// explicitly marked "private" are filtered out for non-owners.
photosRouter.get("/albums/:username/:albumId", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const album = await prisma.album.findUnique({
    where: { id: req.params.albumId },
    include: { photos: { orderBy: { createdAt: "desc" } } },
  });
  if (!album || album.actorId !== actor.id) {
    return res.status(404).json({ error: "not found" });
  }

  const isOwner = req.actor?.id === actor.id;
  if (!isAlbumVisibleTo(album, req.actor?.id)) {
    return res.status(404).json({ error: "not found" });
  }

  const photos = album.photos.filter((p) => isPhotoVisible(p, isOwner));

  res.json({
    id: album.id,
    title: album.title,
    description: album.description,
    visibility: album.visibility,
    photos: photos.map((p) => ({
      id: p.id,
      imageUrl: p.imageUrl,
      thumbnailUrl: p.thumbnailUrl,
      caption: p.caption,
      visibility: p.visibility,
    })),
  });
});

const updateAlbumSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  visibility: visibilitySchema.optional(),
});

photosRouter.patch("/albums/:albumId", requireAuth, async (req, res) => {
  const parsed = updateAlbumSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const album = await prisma.album.findUnique({ where: { id: req.params.albumId } });
  if (!album || album.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }

  const updated = await prisma.album.update({ where: { id: album.id }, data: parsed.data });
  res.json(updated);
});

// Removes the DB rows only — no cleanup of the underlying files under
// uploads/, matching routes/profileImage.ts's existing behavior (it
// never deletes a replaced avatar/header/background either).
photosRouter.delete("/albums/:albumId", requireAuth, async (req, res) => {
  const album = await prisma.album.findUnique({ where: { id: req.params.albumId } });
  if (!album || album.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }

  await prisma.photo.deleteMany({ where: { albumId: album.id } });
  await prisma.album.delete({ where: { id: album.id } });
  res.status(204).end();
});

// POST /albums/:albumId/photos (multipart: image, caption?, visibility?)
// -> runs the upload through the same saveProcessedImage validation/
// re-encoding pipeline routes/profileImage.ts already uses, twice (full
// + thumbnail).
photosRouter.post(
  "/albums/:albumId/photos",
  requireAuth,
  upload.single("image"),
  async (req, res) => {
    const album = await prisma.album.findUnique({ where: { id: req.params.albumId } });
    if (!album || album.actorId !== req.actor!.id) {
      return res.status(404).json({ error: "not found" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "missing image file" });
    }

    const captionParsed = z.string().max(500).optional().safeParse(req.body.caption || undefined);
    const visibilityParsed = visibilitySchema.optional().safeParse(req.body.visibility || undefined);
    if (!captionParsed.success || !visibilityParsed.success) {
      return res.status(400).json({ error: "invalid caption or visibility" });
    }

    let imageUrl: string;
    let thumbnailUrl: string;
    try {
      [imageUrl, thumbnailUrl] = await Promise.all([
        saveProcessedImage(req.file.buffer, PHOTO_FULL_SPEC),
        saveProcessedImage(req.file.buffer, PHOTO_THUMB_SPEC),
      ]);
    } catch {
      return res.status(400).json({ error: "could not process image — is it a valid image file?" });
    }

    const photo = await prisma.photo.create({
      data: {
        albumId: album.id,
        actorId: req.actor!.id,
        imageUrl,
        thumbnailUrl,
        caption: captionParsed.data,
        visibility: visibilityParsed.data,
      },
    });

    res.status(201).json(photo);
  },
);

const updatePhotoSchema = z.object({
  caption: z.string().max(500).optional(),
  visibility: visibilitySchema.nullable().optional(),
});

photosRouter.patch("/photos/:photoId", requireAuth, async (req, res) => {
  const parsed = updatePhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const photo = await prisma.photo.findUnique({ where: { id: req.params.photoId } });
  if (!photo || photo.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }

  const updated = await prisma.photo.update({ where: { id: photo.id }, data: parsed.data });
  res.json(updated);
});

photosRouter.delete("/photos/:photoId", requireAuth, async (req, res) => {
  const photo = await prisma.photo.findUnique({ where: { id: req.params.photoId } });
  if (!photo || photo.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }

  await prisma.photo.delete({ where: { id: photo.id } });
  res.status(204).end();
});

// --- Immich (optional external source) ---

const immichConnectSchema = z.object({
  serverUrl: z.string().url(),
  apiKey: z.string().min(1).max(500),
});

photosRouter.post("/photos/immich/connect", requireAuth, async (req, res) => {
  const parsed = immichConnectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    await testImmichConnection(parsed.data);
  } catch {
    return res
      .status(400)
      .json({ error: "could not connect — check the server URL and API key" });
  }

  await prisma.immichConnection.upsert({
    where: { actorId: req.actor!.id },
    create: { actorId: req.actor!.id, ...parsed.data },
    update: { ...parsed.data },
  });

  res.json({ connected: true });
});

// Registered before GET /photos/immich/:username so "status" isn't
// swallowed as a username.
photosRouter.get("/photos/immich/status", requireAuth, async (req, res) => {
  const connection = await prisma.immichConnection.findUnique({
    where: { actorId: req.actor!.id },
    select: { serverUrl: true },
  });
  res.json(connection ? { connected: true, serverUrl: connection.serverUrl } : { connected: false });
});

photosRouter.delete("/photos/immich/connection", requireAuth, async (req, res) => {
  await prisma.immichConnection.deleteMany({ where: { actorId: req.actor!.id } });
  res.status(204).end();
});

// GET /photos/immich/:username -> album list from that actor's connected
// Immich server, gated by aboutVisibility.immichPhotos for non-owners —
// one flag for the whole connection, not per-album (Immich albums aren't
// rows in our DB — see the plan for this feature).
photosRouter.get("/photos/immich/:username", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const isOwner = req.actor?.id === actor.id;
  if (!isOwner) {
    const visibility = (actor.aboutVisibility as Record<string, boolean> | null) ?? {};
    if (visibility.immichPhotos !== true) {
      return res.status(403).json({ error: "not visible" });
    }
  }

  const connection = await prisma.immichConnection.findUnique({ where: { actorId: actor.id } });
  if (!connection) return res.status(404).json({ error: "no Immich connection" });

  try {
    const albums = await fetchImmichAlbums(connection);
    res.json(albums);
  } catch {
    res.status(502).json({ error: "could not fetch albums from Immich" });
  }
});

// GET /photos/immich/:username/asset/:assetId?variant=thumbnail|original
// -> proxies image bytes. The API key never reaches the browser — only
// this route ever calls Immich with it. Content-Type is checked before
// anything is streamed back, closing the generic "relay arbitrary bytes
// from an attacker-controlled response" proxy-abuse pattern.
photosRouter.get("/photos/immich/:username/asset/:assetId", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const isOwner = req.actor?.id === actor.id;
  if (!isOwner) {
    const visibility = (actor.aboutVisibility as Record<string, boolean> | null) ?? {};
    if (visibility.immichPhotos !== true) {
      return res.status(403).json({ error: "not visible" });
    }
  }

  const connection = await prisma.immichConnection.findUnique({ where: { actorId: actor.id } });
  if (!connection) return res.status(404).json({ error: "no Immich connection" });

  const variant = req.query.variant === "original" ? "original" : "thumbnail";

  try {
    const { contentType, body } = await fetchImmichAssetBytes(connection, req.params.assetId, variant);
    if (!contentType.startsWith("image/")) {
      return res.status(502).json({ error: "unexpected response from Immich" });
    }
    res.set("Content-Type", contentType);
    res.send(body);
  } catch {
    res.status(502).json({ error: "could not fetch that asset from Immich" });
  }
});

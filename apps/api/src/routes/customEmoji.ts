import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/session.js";
import { saveProcessedImage } from "../uploads.js";

export const customEmojiRouter = Router();

// Not folded into routes/admin.ts — same reasoning as
// routes/directoryLinks.ts: a public read (the reaction picker needs
// this list without requiring login) alongside admin-only writes.

// Memory storage — same pattern as routes/profileImage.ts, re-encoded
// by sharp before it ever touches disk (uploads.ts's saveProcessedImage).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// GET /custom-emoji -> public, no auth — the reaction picker's source
// for this instance's emoji, alongside the ~24 built-in unicode ones.
customEmojiRouter.get("/custom-emoji", async (_req, res) => {
  const emoji = await prisma.customEmoji.findMany({ orderBy: { shortcode: "asc" } });
  res.json(emoji);
});

const shortcodeSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9_]+$/, "shortcode may only contain lowercase letters, numbers, and underscores");

// POST /custom-emoji (multipart: shortcode, image) -> admin only.
// 128x128 "inside" (not "cover") — emoji artwork usually isn't square,
// and cropping it would cut off the actual image, unlike an
// avatar/header where filling the box is the point.
customEmojiRouter.post(
  "/custom-emoji",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    const parsed = shortcodeSchema.safeParse(req.body.shortcode);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (!req.file) return res.status(400).json({ error: "image is required" });

    const existing = await prisma.customEmoji.findUnique({ where: { shortcode: parsed.data } });
    if (existing) return res.status(409).json({ error: "that shortcode is already in use" });

    let imageUrl: string;
    try {
      imageUrl = await saveProcessedImage(req.file.buffer, { width: 128, height: 128, fit: "inside" });
    } catch {
      return res.status(400).json({ error: "that doesn't look like a valid image" });
    }

    const emoji = await prisma.customEmoji.create({ data: { shortcode: parsed.data, imageUrl } });
    res.status(201).json(emoji);
  },
);

customEmojiRouter.delete("/custom-emoji/:id", requireAuth, requireAdmin, async (req, res) => {
  await prisma.customEmoji.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

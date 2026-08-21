import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db.js";
import { toPublicActor } from "../federation/localActor.js";
import { requireAuth } from "../auth/session.js";
import { saveProcessedImage } from "../uploads.js";
import { updateActorActivity } from "../federation/activities.js";
import { deliverToFollowers } from "../federation/deliver.js";

export const profileImageRouter = Router();

// Memory storage — the buffer never touches disk until it's been decoded
// and re-encoded by sharp (see uploads.ts). 8MB cap on the raw upload.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const RESIZE_SPECS = {
  avatar: { width: 400, height: 400, fit: "cover" as const },
  header: { width: 1200, height: 300, fit: "cover" as const },
  background: { width: 1920, height: 1920, fit: "inside" as const },
};

const ACTOR_FIELD = {
  avatar: "avatarImageUrl",
  header: "headerImageUrl",
  background: "backgroundImageUrl",
} as const;

// Uploading a real image means "use this instead of a built-in preset" —
// clear the corresponding preset field in the same update, mirroring the
// opposite direction handled in routes/profile.ts.
const PRESET_FIELD = {
  avatar: "avatarPreset",
  header: "headerPreset",
  background: "backgroundPreset",
} as const;

const typeSchema = z.enum(["avatar", "header", "background"]);

// POST /profile/image (multipart/form-data: `type`, `image`) — the one
// non-JSON endpoint in this API. `type` picks the resize spec and which
// Actor column gets updated; the actual validation that the upload *is* an
// image happens inside saveProcessedImage (sharp decodes it or rejects
// it), not here — the client-declared type/field name are never trusted.
profileImageRouter.post("/profile/image", requireAuth, upload.single("image"), async (req, res) => {
  const parsedType = typeSchema.safeParse(req.body.type);
  if (!parsedType.success) {
    return res.status(400).json({ error: "type must be avatar, header, or background" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "missing image file" });
  }

  let imageUrl: string;
  try {
    imageUrl = await saveProcessedImage(req.file.buffer, RESIZE_SPECS[parsedType.data]);
  } catch {
    return res.status(400).json({ error: "could not process image — is it a valid image file?" });
  }

  const field = ACTOR_FIELD[parsedType.data];
  const presetField = PRESET_FIELD[parsedType.data];
  const actor = await prisma.actor.update({
    where: { id: req.actor!.id },
    data: { [field]: imageUrl, [presetField]: null },
  });

  void deliverToFollowers(actor, updateActorActivity(actor));

  res.json({ actor: toPublicActor(actor) });
});

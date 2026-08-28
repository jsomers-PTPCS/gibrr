import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { vapidPublicKey, pushConfigured } from "../federation/webPush.js";

export const pushRouter = Router();

// GET /push/vapid-public-key -> the instance's VAPID public key, which
// the browser needs to create a subscription. 404 when the instance has
// no VAPID keypair configured — the frontend treats that as "push isn't
// available here" and hides the toggle, same as an unconfigured
// LibreTranslate hides the Translate button.
pushRouter.get("/push/vapid-public-key", (_req, res) => {
  const key = vapidPublicKey();
  if (!key) return res.status(404).json({ error: "push not configured" });
  res.json({ key });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// POST /push/subscribe -> register (or re-register) this browser for
// push. Keyed on the endpoint URL, which is unique per browser+origin:
// re-subscribing the same device updates its row, and switching accounts
// on that device moves the row to the new actor rather than leaving a
// stale one that would double-deliver.
pushRouter.post("/push/subscribe", requireAuth, async (req, res) => {
  if (!pushConfigured()) return res.status(404).json({ error: "push not configured" });

  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { endpoint, keys } = parsed.data;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, actorId: req.actor!.id },
    update: { p256dh: keys.p256dh, auth: keys.auth, actorId: req.actor!.id },
  });

  res.status(201).json({ subscribed: true });
});

// POST /push/unsubscribe -> drop this browser's subscription. Idempotent;
// takes just the endpoint (the browser has it from getSubscription()).
pushRouter.post("/push/unsubscribe", requireAuth, async (req, res) => {
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, actorId: req.actor!.id },
  });
  res.status(204).end();
});

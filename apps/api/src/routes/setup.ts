import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { createLocalActor, toPublicActor } from "../federation/localActor.js";
import { hashPassword } from "../federation/passwords.js";
import { establishSession } from "../auth/session.js";
import { authRateLimit, sendVerificationEmail } from "./auth.js";

export const setupRouter = Router();

// A fresh instance has zero LocalUser rows — that's the signal the
// frontend uses to route a first-time visitor to /setup instead of
// /register, and that this route uses to refuse running a second time.
async function needsSetup(): Promise<boolean> {
  return (await prisma.localUser.count()) === 0;
}

setupRouter.get("/setup/status", async (_req, res) => {
  res.json({ needsSetup: await needsSetup() });
});

const setupSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "username may only contain letters, numbers, and underscores"),
  email: z.string().email(),
  password: z.string().min(8),
});

setupRouter.post("/setup", authRateLimit, async (req, res) => {
  if (!(await needsSetup())) {
    return res.status(409).json({ error: "setup already completed" });
  }

  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { username, email, password } = parsed.data;

  const existingUsername = await prisma.actor.findFirst({ where: { username } });
  if (existingUsername) return res.status(409).json({ error: "username taken" });

  const passwordHash = await hashPassword(password);
  const localUser = await prisma.$transaction(async (tx) => {
    const actor = await createLocalActor(tx, { username, type: "Person" });
    return tx.localUser.create({
      data: { actorId: actor.id, email, passwordHash, isAdmin: true },
      include: { actor: true },
    });
  });

  await establishSession(req, res, localUser.id);
  await sendVerificationEmail(localUser.id, localUser.email);

  res.status(201).json({
    actor: toPublicActor(localUser.actor),
    email: localUser.email,
    isAdmin: localUser.isAdmin,
    emailVerified: false,
  });
});

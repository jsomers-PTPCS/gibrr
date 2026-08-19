import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { createLocalActor, toPublicActor } from "../federation/localActor.js";
import { hashPassword, verifyPassword } from "../federation/passwords.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  setSessionCookie,
} from "../auth/session.js";

export const authRouter = Router();

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "username may only contain letters, numbers, and underscores"),
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { username, email, password } = parsed.data;

  const [existingUsername, existingEmail] = await Promise.all([
    prisma.actor.findFirst({ where: { username } }),
    prisma.localUser.findUnique({ where: { email } }),
  ]);
  if (existingUsername) return res.status(409).json({ error: "username taken" });
  if (existingEmail) return res.status(409).json({ error: "email already registered" });

  const passwordHash = await hashPassword(password);

  const localUser = await prisma.$transaction(async (tx) => {
    const actor = await createLocalActor(tx, { username, type: "Person" });
    return tx.localUser.create({
      data: { actorId: actor.id, email, passwordHash },
      include: { actor: true },
    });
  });

  const session = await createSession(localUser.id);
  setSessionCookie(res, session.id);

  res.status(201).json({ actor: toPublicActor(localUser.actor), email: localUser.email });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const localUser = await prisma.localUser.findUnique({
    where: { email },
    include: { actor: true },
  });
  if (!localUser || !(await verifyPassword(password, localUser.passwordHash))) {
    return res.status(401).json({ error: "invalid email or password" });
  }

  const session = await createSession(localUser.id);
  setSessionCookie(res, session.id);

  res.json({ actor: toPublicActor(localUser.actor), email: localUser.email });
});

authRouter.post("/auth/logout", async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof sessionId === "string") {
    await destroySession(sessionId);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json({ actor: toPublicActor(req.actor!), email: req.localUser?.email });
});

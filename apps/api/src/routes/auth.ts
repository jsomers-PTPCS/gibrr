import crypto from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { createLocalActor, toPublicActor } from "../federation/localActor.js";
import { hashPassword, verifyPassword } from "../federation/passwords.js";
import { sendEmail } from "../federation/mailer.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  destroySessionAndAdvance,
  establishSession,
  loadSessionPool,
  requireAuth,
  setSessionCookie,
} from "../auth/session.js";
import {
  generateTwoFactorSecret,
  twoFactorQrCodeDataUrl,
  verifyTwoFactorToken,
  generateBackupCodes,
  findMatchingBackupCode,
} from "../auth/twoFactor.js";

export const authRouter = Router();

// Applied only to the credential/token endpoints below — not
// /auth/logout or /auth/me, which don't need it. Same
// express-rate-limit already used for the inbox (routes/inbox.ts).
// Exported for routes/setup.ts, the first-run admin setup flow, which
// shares this same credential-endpoint rate limit.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many attempts, try again later" },
});

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

// Exported for routes/setup.ts — same verification-email logic as
// regular registration.
export async function sendVerificationEmail(localUserId: string, email: string) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.localUser.update({
    where: { id: localUserId },
    data: { emailVerificationToken: token, emailVerificationExpiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
  });
  const link = `${webOrigin()}/verify-email?token=${token}`;
  await sendEmail(email, "Verify your Gibrr email", `Confirm your email address:\n\n${link}\n\nThis link expires in 24 hours.`);
}

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "username may only contain letters, numbers, and underscores"),
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post("/auth/register", authRateLimit, async (req, res) => {
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

  await establishSession(req, res, localUser.id);
  await sendVerificationEmail(localUser.id, localUser.email);

  res.status(201).json({
    actor: toPublicActor(localUser.actor),
    email: localUser.email,
    isAdmin: localUser.isAdmin,
    emailVerified: false,
    twoFactorEnabled: false,
  });
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/auth/login", authRateLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const identifier = parsed.data.emailOrUsername.trim();
  const { password } = parsed.data;

  // "@" is disallowed in usernames (registerSchema's regex) but
  // required in emails, so this split is unambiguous.
  const localUser = await prisma.localUser.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { actor: { username: identifier } },
    include: { actor: true },
  });
  if (!localUser || !(await verifyPassword(password, localUser.passwordHash))) {
    return res.status(401).json({ error: "invalid email/username or password" });
  }
  if (localUser.suspended) {
    return res.status(403).json({ error: "account suspended" });
  }

  // Password alone is never enough for a 2FA-enabled account — no
  // Session row (and so no cookie) gets created until POST
  // /auth/2fa/challenge proves the second factor too. The challenge
  // row is the only thing that exists in between.
  if (localUser.twoFactorEnabled) {
    const challenge = await prisma.twoFactorChallenge.create({
      data: { localUserId: localUser.id, expiresAt: new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS) },
    });
    return res.json({ requiresTwoFactor: true, challengeId: challenge.id });
  }

  await establishSession(req, res, localUser.id);

  res.json({
    actor: toPublicActor(localUser.actor),
    email: localUser.email,
    isAdmin: localUser.isAdmin,
    emailVerified: localUser.emailVerified,
    twoFactorEnabled: false,
  });
});

const twoFactorChallengeSchema = z.object({
  challengeId: z.string().min(1),
  // A 6-digit TOTP code or a backup code (routes/auth.ts's own
  // findMatchingBackupCode) — either is accepted here, distinguished by
  // matching against the right store rather than by format, since a
  // backup code intentionally isn't purely numeric.
  token: z.string().min(1),
});

// POST /auth/2fa/challenge -> the second half of a 2FA-enabled login.
// Rate-limited the same as /auth/login itself — a stolen password
// shouldn't let an attacker brute-force the remaining 6-digit code
// either.
authRouter.post("/auth/2fa/challenge", authRateLimit, async (req, res) => {
  const parsed = twoFactorChallengeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const challenge = await prisma.twoFactorChallenge.findUnique({
    where: { id: parsed.data.challengeId },
    include: { localUser: { include: { actor: true } } },
  });
  if (!challenge || challenge.expiresAt < new Date()) {
    return res.status(401).json({ error: "invalid or expired challenge" });
  }
  const localUser = challenge.localUser;
  if (!localUser.twoFactorEnabled || !localUser.twoFactorSecret) {
    // 2FA was disabled after this challenge was issued — nothing left
    // to verify against; treat the same as an expired challenge rather
    // than a 500.
    await prisma.twoFactorChallenge.delete({ where: { id: challenge.id } });
    return res.status(401).json({ error: "invalid or expired challenge" });
  }

  const token = parsed.data.token.trim();
  const validTotp = verifyTwoFactorToken(token, localUser.twoFactorSecret);
  const backupCodeIndex = validTotp ? -1 : await findMatchingBackupCode(token, localUser.twoFactorBackupCodes);

  if (!validTotp && backupCodeIndex === -1) {
    return res.status(401).json({ error: "invalid code" });
  }

  if (backupCodeIndex !== -1) {
    const remaining = [...localUser.twoFactorBackupCodes];
    remaining.splice(backupCodeIndex, 1);
    await prisma.localUser.update({ where: { id: localUser.id }, data: { twoFactorBackupCodes: remaining } });
  }

  await prisma.twoFactorChallenge.delete({ where: { id: challenge.id } });
  await establishSession(req, res, localUser.id);

  res.json({
    actor: toPublicActor(localUser.actor),
    email: localUser.email,
    isAdmin: localUser.isAdmin,
    emailVerified: localUser.emailVerified,
    twoFactorEnabled: localUser.twoFactorEnabled,
  });
});

authRouter.post("/auth/logout", async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof sessionId === "string") {
    // Auto-advances to another pooled account if one remains, rather
    // than always dropping all the way out to the login screen.
    await destroySessionAndAdvance(req, res, sessionId);
  } else {
    clearSessionCookie(res);
  }
  res.status(204).end();
});

// GET /auth/sessions -> every account signed in on this browser (the
// account switcher's account list). Reflects the pool cookie only —
// no requireAuth, since it can't reveal anything beyond what's already
// in this browser's own cookies.
authRouter.get("/auth/sessions", async (req, res) => {
  const activeId = req.cookies?.[SESSION_COOKIE];
  const pool = await loadSessionPool(req);

  res.json(
    pool.map((s) => ({
      actor: toPublicActor(s.localUser.actor),
      isAdmin: s.localUser.isAdmin,
      current: s.id === activeId,
    })),
  );
});

const switchAccountSchema = z.object({ actorId: z.string().min(1) });

// POST /auth/switch -> moves the *active* cookie to an already-pooled
// session. No password check — by design, this can only ever land on
// an account this browser already has a valid session for.
authRouter.post("/auth/switch", async (req, res) => {
  const parsed = switchAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid actorId" });

  const pool = await loadSessionPool(req);
  const target = pool.find((s) => s.localUser.actor.id === parsed.data.actorId);
  if (!target) return res.status(404).json({ error: "that account isn't signed in on this browser" });

  setSessionCookie(res, target.id);

  res.json({
    actor: toPublicActor(target.localUser.actor),
    email: target.localUser.email,
    isAdmin: target.localUser.isAdmin,
    emailVerified: target.localUser.emailVerified,
    twoFactorEnabled: target.localUser.twoFactorEnabled,
  });
});

// DELETE /auth/sessions/:actorId -> sign out of one pooled account
// without touching the others. Auto-advances the active cookie the
// same way logout does if the removed account was the active one.
authRouter.delete("/auth/sessions/:actorId", async (req, res) => {
  const pool = await loadSessionPool(req);
  const target = pool.find((s) => s.localUser.actor.id === req.params.actorId);
  if (!target) return res.status(404).json({ error: "that account isn't signed in on this browser" });

  await destroySessionAndAdvance(req, res, target.id);
  res.status(204).end();
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json({
    actor: toPublicActor(req.actor!),
    email: req.localUser?.email,
    isAdmin: req.localUser?.isAdmin ?? false,
    emailVerified: req.localUser?.emailVerified ?? false,
    twoFactorEnabled: req.localUser?.twoFactorEnabled ?? false,
  });
});

// POST /auth/2fa/setup -> generates a new secret and starts (or
// restarts) enrollment. Stored immediately but twoFactorEnabled stays
// false until POST /auth/2fa/enable proves the app was actually scanned
// — so calling this again (e.g. the user closed the QR code before
// finishing) just replaces the pending secret, no lockout risk since
// nothing is enforced yet.
authRouter.post("/auth/2fa/setup", requireAuth, async (req, res) => {
  if (req.localUser!.twoFactorEnabled) {
    return res.status(409).json({ error: "two-factor is already enabled — disable it first to re-enroll" });
  }
  const secret = generateTwoFactorSecret();
  await prisma.localUser.update({ where: { id: req.localUser!.id }, data: { twoFactorSecret: secret } });

  const accountName = `${req.actor!.username}@${req.actor!.domain}`;
  const qrCodeDataUrl = await twoFactorQrCodeDataUrl(accountName, secret);
  res.json({ secret, qrCodeDataUrl });
});

const enableTwoFactorSchema = z.object({ token: z.string().min(1) });

// POST /auth/2fa/enable { token } -> proves the authenticator app was
// set up correctly (a valid current code) before actually turning
// enforcement on, then issues one-time backup codes — shown here in
// plaintext exactly once, never retrievable again afterward (only
// their bcrypt hashes persist).
authRouter.post("/auth/2fa/enable", requireAuth, async (req, res) => {
  const parsed = enableTwoFactorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (!req.localUser!.twoFactorSecret) {
    return res.status(400).json({ error: "call POST /auth/2fa/setup first" });
  }
  if (!verifyTwoFactorToken(parsed.data.token.trim(), req.localUser!.twoFactorSecret)) {
    return res.status(400).json({ error: "invalid code" });
  }

  const { plaintext, hashed } = await generateBackupCodes();
  await prisma.localUser.update({
    where: { id: req.localUser!.id },
    data: { twoFactorEnabled: true, twoFactorBackupCodes: hashed },
  });

  res.json({ enabled: true, backupCodes: plaintext });
});

const disableTwoFactorSchema = z.object({ password: z.string().min(1) });

// POST /auth/2fa/disable { password } -> re-checks the password (a
// sensitive change, same reasoning routes/profile.ts-adjacent
// security-relevant actions elsewhere in this app re-verify identity
// rather than trusting the session alone) before turning enforcement
// off and wiping both the secret and any remaining backup codes.
authRouter.post("/auth/2fa/disable", requireAuth, async (req, res) => {
  const parsed = disableTwoFactorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (!(await verifyPassword(parsed.data.password, req.localUser!.passwordHash))) {
    return res.status(401).json({ error: "incorrect password" });
  }

  await prisma.localUser.update({
    where: { id: req.localUser!.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
  });
  res.status(204).end();
});

const verifyEmailSchema = z.object({ token: z.string().min(1) });

authRouter.post("/auth/verify-email", authRateLimit, async (req, res) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid token" });

  const localUser = await prisma.localUser.findUnique({ where: { emailVerificationToken: parsed.data.token } });
  if (!localUser || !localUser.emailVerificationExpiresAt || localUser.emailVerificationExpiresAt < new Date()) {
    return res.status(400).json({ error: "invalid or expired token" });
  }

  await prisma.localUser.update({
    where: { id: localUser.id },
    data: { emailVerified: true, emailVerificationToken: null, emailVerificationExpiresAt: null },
  });
  res.status(204).end();
});

authRouter.post("/auth/resend-verification", requireAuth, async (req, res) => {
  if (req.localUser!.emailVerified) return res.status(204).end();
  await sendVerificationEmail(req.localUser!.id, req.localUser!.email);
  res.status(204).end();
});

const forgotPasswordSchema = z.object({ email: z.string().email() });

authRouter.post("/auth/forgot-password", authRateLimit, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid email" });

  const localUser = await prisma.localUser.findUnique({ where: { email: parsed.data.email } });
  // Always 200 regardless of whether the account exists — otherwise this
  // endpoint becomes a way to enumerate registered emails.
  if (localUser) {
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.localUser.update({
      where: { id: localUser.id },
      data: { passwordResetToken: token, passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
    });
    const link = `${webOrigin()}/reset-password?token=${token}`;
    await sendEmail(
      localUser.email,
      "Reset your Gibrr password",
      `Reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore it.`,
    );
  }
  res.status(200).json({ ok: true });
});

const resetPasswordSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });

authRouter.post("/auth/reset-password", authRateLimit, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const localUser = await prisma.localUser.findUnique({ where: { passwordResetToken: parsed.data.token } });
  if (!localUser || !localUser.passwordResetExpiresAt || localUser.passwordResetExpiresAt < new Date()) {
    return res.status(400).json({ error: "invalid or expired token" });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.localUser.update({
      where: { id: localUser.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpiresAt: null },
    }),
    // A credential change invalidates every existing session, local and
    // otherwise — not just the device the reset happened on.
    prisma.session.deleteMany({ where: { localUserId: localUser.id } }),
  ]);
  res.status(204).end();
});

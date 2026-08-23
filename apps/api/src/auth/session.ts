import type { NextFunction, Request, Response } from "express";
import type { Actor, LocalUser } from "@prisma/client";
import { prisma } from "../db.js";

export const SESSION_COOKIE = "gibrr_session";
// Every other account signed in on this browser — lets Nav's account
// switcher (GET /auth/sessions, POST /auth/switch) move the *active*
// cookie between already-authenticated sessions without a password
// prompt each time. Just a list of session IDs; cookie-parser's
// built-in "j:"-prefixed JSON cookie support serializes/parses it as a
// plain array automatically, no manual JSON.stringify/parse needed.
export const SESSION_POOL_COOKIE = "gibrr_session_pool";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_POOLED_SESSIONS = 5;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
      localUser?: LocalUser;
    }
  }
}

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  // Only https carries this cookie in production (NODE_ENV=production);
  // local dev over plain http still needs it sent, so it's off there.
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_TTL_MS,
};

function readPool(req: Request): string[] {
  const pool = req.cookies?.[SESSION_POOL_COOKIE];
  return Array.isArray(pool) ? pool.filter((id): id is string => typeof id === "string") : [];
}

function writePool(res: Response, pool: string[]) {
  if (pool.length === 0) {
    res.clearCookie(SESSION_POOL_COOKIE);
  } else {
    res.cookie(SESSION_POOL_COOKIE, pool, cookieOptions);
  }
}

export function setSessionCookie(res: Response, sessionId: string) {
  res.cookie(SESSION_COOKIE, sessionId, cookieOptions);
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE);
}

// The one entry point every sign-in path (register, login, setup) goes
// through — creates the DB session, makes it active, and adds it to
// the pool cookie so it shows up in the account switcher. Oldest
// pooled session is evicted past MAX_POOLED_SESSIONS.
export async function establishSession(req: Request, res: Response, localUserId: string) {
  const session = await prisma.session.create({
    data: { localUserId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });

  setSessionCookie(res, session.id);

  const pool = readPool(req).filter((id) => id !== session.id);
  pool.push(session.id);
  while (pool.length > MAX_POOLED_SESSIONS) pool.shift();
  writePool(res, pool);

  return session;
}

// Destroys one session (DB row + pool cookie entry). If it was the
// active session, promotes the next pooled one as active instead of
// leaving the browser fully signed out when other accounts are still
// available — used by both logout and "sign out of this account" in
// the switcher.
export async function destroySessionAndAdvance(req: Request, res: Response, sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });

  const pool = readPool(req).filter((id) => id !== sessionId);
  writePool(res, pool);

  const activeId = req.cookies?.[SESSION_COOKIE];
  if (activeId !== sessionId) return; // some other account was removed, active one is untouched

  const next = pool[pool.length - 1];
  if (next) {
    setSessionCookie(res, next);
  } else {
    clearSessionCookie(res);
  }
}

interface ResolvedSession {
  id: string;
  expiresAt: Date;
  localUser: LocalUser & { actor: Actor };
}

async function resolveSessionId(sessionId: string): Promise<ResolvedSession | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { localUser: { include: { actor: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  // A suspension takes effect immediately, not just on the next login —
  // an already-issued session for a suspended account stops working here.
  if (session.localUser.suspended) return null;

  return session;
}

async function loadSession(req: Request) {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof sessionId !== "string") return null;
  return resolveSessionId(sessionId);
}

// Resolves every pooled session ID to its account, silently dropping
// stale ones (expired/suspended/deleted) — a stale ID just falls out
// of the switcher's list on next read rather than erroring.
export async function loadSessionPool(req: Request): Promise<ResolvedSession[]> {
  const ids = readPool(req);
  const resolved = await Promise.all(ids.map(resolveSessionId));
  return resolved.filter((s): s is ResolvedSession => s !== null);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await loadSession(req);
  if (!session) {
    return res.status(401).json({ error: "not authenticated" });
  }

  req.localUser = session.localUser;
  req.actor = session.localUser.actor;
  next();
}

// Like requireAuth, but for public endpoints that want to know the caller's
// identity when present (e.g. to report "myVote") without requiring it —
// continues either way instead of 401ing.
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const session = await loadSession(req);
  if (session) {
    req.localUser = session.localUser;
    req.actor = session.localUser.actor;
  }
  next();
}

// Instance-wide admin gate — separate from the per-community
// owner/admin/moderator/member roles on CommunityMembership. Chain after
// requireAuth (routes/admin.ts mounts everything behind both).
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.localUser?.isAdmin) {
    return res.status(403).json({ error: "admin access required" });
  }
  next();
}

import type { NextFunction, Request, Response } from "express";
import type { Actor, LocalUser } from "@prisma/client";
import { prisma } from "../db.js";

export const SESSION_COOKIE = "astrion_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
      localUser?: LocalUser;
    }
  }
}

export async function createSession(localUserId: string) {
  const session = await prisma.session.create({
    data: { localUserId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return session;
}

export async function destroySession(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export function setSessionCookie(res: Response, sessionId: string) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof sessionId !== "string") {
    return res.status(401).json({ error: "not authenticated" });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { localUser: { include: { actor: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ error: "not authenticated" });
  }

  req.localUser = session.localUser;
  req.actor = session.localUser.actor;
  next();
}

import { z } from "zod";
import { prisma } from "../db.js";

// Domains are stored lowercase, trimmed — so a lookup for "Example.COM "
// matches a block entered as "example.com" without a second, redundant
// normalization step at every call site.
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

// A real hostname shape (labels of letters/digits/hyphens joined by
// dots, at least one dot so a bare typo'd single word gets rejected up
// front) with an optional :port for local dev domains like
// "localhost:4000". This can only catch gross typos — missing dots,
// spaces, invalid characters — not a legitimate-looking misspelling of
// a real domain ("mastadon.social" is a perfectly valid hostname shape,
// just the wrong one); that class of error needs a live reachability
// check instead (routes/admin.ts's explore-server add, routes/ghost.ts's
// self-service add-a-blog). Shared here so both reuse the exact same
// shape check rather than two copies of the same regex drifting apart.
const DOMAIN_SHAPE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+(:[0-9]+)?$/;
export const domainShapeSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(DOMAIN_SHAPE, "doesn't look like a real domain (check for typos)");

export async function isDomainBlocked(domain: string): Promise<boolean> {
  const block = await prisma.domainBlock.findUnique({ where: { domain: normalizeDomain(domain) } });
  return Boolean(block);
}

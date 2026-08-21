import { prisma } from "../db.js";

// Domains are stored lowercase, trimmed — so a lookup for "Example.COM "
// matches a block entered as "example.com" without a second, redundant
// normalization step at every call site.
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

export async function isDomainBlocked(domain: string): Promise<boolean> {
  const block = await prisma.domainBlock.findUnique({ where: { domain: normalizeDomain(domain) } });
  return Boolean(block);
}

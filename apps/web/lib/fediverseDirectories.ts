// External discovery links — there's no crawled index of the fediverse
// (no server has one, including this one), so "browse the wider
// fediverse" means linking out to independent, third-party directory
// sites rather than anything Gibrr itself can query. Admin-managed
// (routes/directoryLinks.ts) — this file only holds the shared type and
// a client-side safety net, not the data itself.
export interface FediverseDirectoryLink {
  id: string;
  name: string;
  url: string;
  description: string;
  category: "people" | "servers" | "developer";
}

// Guards against the same site ever showing up twice in one render —
// the backend already 409s on a duplicate url at write time, this is
// defense in depth against stale client state, not the primary check.
export function dedupeDirectoriesByUrl(links: FediverseDirectoryLink[]): FediverseDirectoryLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

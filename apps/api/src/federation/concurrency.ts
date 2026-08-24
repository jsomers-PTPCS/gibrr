// Runs `fn` over `items`, at most `limit` in flight at once. Confirmed
// live to matter, not just theoretical: routes/explore.ts's live feeds
// (Loops, Longform) each fan a check out across every ExploreServer —
// at the curated list's current size (1600+, most added in bulk via
// the FediDB sync) an unbounded Promise.all of that many concurrent
// outbound fetches took over 10 seconds for one request even before
// accounting for slower/unreachable domains. Order of results matches
// `items`, same as Promise.all.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

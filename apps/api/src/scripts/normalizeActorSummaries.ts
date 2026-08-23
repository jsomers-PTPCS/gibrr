// One-off backfill: apps/api/src/routes/profile.ts and
// federation/remoteActor.ts now normalize Actor.summary through
// toDescriptionHtml on every write (plain local bios get promoted to
// paragraph HTML; a remote actor's real HTML gets sanitized down to a
// safe subset) — same treatment routes/communities.ts already gives
// group descriptions. Rows written before that fix still hold whatever
// was stored before it (plain text with no <p> wrapper, or an
// unsanitized remote actor's raw HTML), which is why bios were
// rendering as literal tag text on the profile page. Safe to run more
// than once — toDescriptionHtml is idempotent, so an already-normalized
// row is simply skipped (no-op update).
//
//   pnpm normalize-actor-summaries
import { prisma } from "../db.js";
import { toDescriptionHtml } from "../federation/descriptionHtml.js";

async function main() {
  const actors = await prisma.actor.findMany({
    where: { summary: { not: null } },
    select: { id: true, username: true, domain: true, summary: true },
  });

  let updated = 0;
  for (const actor of actors) {
    if (!actor.summary) continue;
    const normalized = toDescriptionHtml(actor.summary);
    if (normalized === actor.summary) continue;
    await prisma.actor.update({ where: { id: actor.id }, data: { summary: normalized } });
    updated += 1;
  }

  console.log(`normalized ${updated} of ${actors.length} actor summaries`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

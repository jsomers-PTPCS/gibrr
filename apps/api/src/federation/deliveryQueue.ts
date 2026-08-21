import { prisma } from "../db.js";
import { attemptDelivery } from "./deliver.js";
import { isDomainBlocked } from "./domainBlocks.js";

// Delay before each successive retry, in minutes — index 0 is the delay
// already used when the row was first created (federation/deliver.ts's
// scheduleRetry hardcodes that same 1-minute first delay; keep the two
// in sync if this changes). Once `attempts` reaches this array's length
// with no success, the row is given up on (status: "failed") rather
// than retried forever.
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];

// Runs one pass over every due retry — called on a setInterval
// (startDeliveryRetrySweep) rather than via a real job queue, since this
// app has no separate worker process or broker (Redis, etc.) to run one
// against; a periodic in-process sweep over Postgres is the honest
// substitute at this app's scale. Calls attemptDelivery directly, not
// deliverActivity — deliverActivity would enqueue a *new* row on
// failure, duplicating this one instead of updating it.
export async function runDueDeliveries(): Promise<void> {
  const due = await prisma.outboundDelivery.findMany({
    where: { status: "pending", nextAttemptAt: { lte: new Date() } },
    include: { actor: true },
  });

  for (const delivery of due) {
    // A row queued before its target domain was blocked — drop it
    // outright rather than let it keep retrying (or count against the
    // backoff cap) against a domain we now refuse to talk to.
    let blocked = false;
    try {
      blocked = await isDomainBlocked(new URL(delivery.inboxUrl).host);
    } catch {
      // Unparseable inboxUrl — let the existing attemptDelivery failure
      // path below handle it, same as before this check existed.
    }
    if (blocked) {
      await prisma.outboundDelivery.delete({ where: { id: delivery.id } });
      console.log(`[deliveryQueue] dropped queued delivery to ${delivery.inboxUrl} — domain now blocked`);
      continue;
    }

    const result = await attemptDelivery(
      delivery.actor,
      delivery.inboxUrl,
      delivery.activity as Record<string, unknown>,
    );

    if (result.ok) {
      await prisma.outboundDelivery.delete({ where: { id: delivery.id } });
      console.log(`[deliveryQueue] retry succeeded for ${delivery.inboxUrl}`);
      continue;
    }

    const attempts = delivery.attempts + 1;
    if (attempts >= BACKOFF_MINUTES.length) {
      await prisma.outboundDelivery.update({
        where: { id: delivery.id },
        data: { attempts, status: "failed", lastError: result.error },
      });
      console.log(`[deliveryQueue] gave up on ${delivery.inboxUrl} after ${attempts} attempts`);
    } else {
      await prisma.outboundDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          nextAttemptAt: new Date(Date.now() + BACKOFF_MINUTES[attempts] * 60_000),
          lastError: result.error,
        },
      });
    }
  }
}

// Starts the in-process retry sweep — called once from index.ts after
// app.listen. Interval, not a precise schedule: a retry due at minute 3
// might fire anywhere in the following 60-second window, which is fine
// for a background retry, not a user-facing guarantee.
export function startDeliveryRetrySweep(intervalMs = 60_000): void {
  setInterval(() => {
    runDueDeliveries().catch((err) => console.error("[deliveryQueue] sweep failed:", err));
  }, intervalMs);
}

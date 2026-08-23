import { prisma } from "./db.js";
import { logger } from "./logger.js";

const HEARTBEAT_ID = 1;
const HEARTBEAT_INTERVAL_MS = 30_000;

// A gap since the last recorded heartbeat longer than this means the
// process wasn't running to write one — real downtime, whether from a
// crash or a deploy restart, not just this-process's own uptime. Well
// above the heartbeat interval so ordinary timer jitter or a brief GC
// pause never falsely trips it; short enough to still register a real
// outage rather than only very long ones. Deliberately NOT tuned to
// "ignore quick deploys" — a deploy really is downtime, brief as it may
// be, and this stat is meant to be honest about that, not to flatter it.
const DOWNTIME_THRESHOLD_MS = 5 * 60_000;

// Runs once at startup, before the server starts accepting requests.
// Detects whether this process is picking up after a real gap (the
// previous instance's last heartbeat is older than the threshold) and,
// if so, records "downtime just ended, right now". A fresh install with
// no heartbeat row yet has never had a detected downtime, so its own
// creation moment is the honest baseline — "since install", in effect.
export async function recordStartupAndDetectDowntime(): Promise<void> {
  const now = new Date();
  const existing = await prisma.instanceHeartbeat.findUnique({ where: { id: HEARTBEAT_ID } });

  if (!existing) {
    await prisma.instanceHeartbeat.create({
      data: { id: HEARTBEAT_ID, lastAliveAt: now, lastDowntimeAt: now },
    });
    return;
  }

  const gapMs = now.getTime() - existing.lastAliveAt.getTime();
  await prisma.instanceHeartbeat.update({
    where: { id: HEARTBEAT_ID },
    data: {
      lastAliveAt: now,
      ...(gapMs > DOWNTIME_THRESHOLD_MS ? { lastDowntimeAt: now } : {}),
    },
  });
}

// Keeps lastAliveAt fresh while the process runs — same in-process
// setInterval sweep pattern as federation/deliveryQueue.ts's retry sweep
// and federation/exploreSweep.ts, not a separate worker/broker.
export function startHeartbeat(intervalMs = HEARTBEAT_INTERVAL_MS): void {
  setInterval(() => {
    prisma.instanceHeartbeat
      .update({ where: { id: HEARTBEAT_ID }, data: { lastAliveAt: new Date() } })
      .catch((err) => logger.warn({ err }, "heartbeat update failed"));
  }, intervalMs);
}

export async function getLastDowntimeAt(): Promise<Date | null> {
  const row = await prisma.instanceHeartbeat.findUnique({ where: { id: HEARTBEAT_ID } });
  return row?.lastDowntimeAt ?? null;
}

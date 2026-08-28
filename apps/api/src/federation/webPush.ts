import webpush from "web-push";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

// Web Push (RFC 8030/8291) — an OS-level notification on a phone/desktop
// even when the Gibrr tab is closed, layered on top of the in-app
// Notification rows. Opt-in per device (routes/push.ts), fired from
// federation/notifications.ts's notify() right after the row is written.
//
// Needs a VAPID keypair (one identity for this whole instance, not
// per-user) in the environment — generate one with
// `npx web-push generate-vapid-keys`. Unset ⇒ the whole feature is off:
// the subscribe endpoint 404s and notify() skips the push, exactly the
// same "unconfigured integration just disables itself" posture as SMTP
// and LibreTranslate.
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
// The VAPID "subject" — a mailto: or https: URL a push service can use to
// contact the instance operator about problems. Falls back to the API
// origin so a missing env var doesn't disable an otherwise-working setup.
const subject =
  process.env.VAPID_SUBJECT ??
  (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : "https://localhost");

let configured = false;
if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  logger.info("web push configured");
}

export function pushConfigured(): boolean {
  return configured;
}

export function vapidPublicKey(): string | null {
  return configured ? publicKey! : null;
}

export interface PushPayload {
  title: string;
  body: string;
  // Where notificationclick should navigate (a path, resolved against the
  // web origin by the service worker).
  url: string;
  // Coalesces repeat pushes in the OS tray — a second "X liked your post"
  // replaces the first rather than stacking.
  tag?: string;
}

// Sends `payload` to every registered device for a local actor. Prunes
// any subscription the push service reports as gone (404/410) — the
// browser silently drops these when permission is revoked or the app is
// uninstalled, and there's no other signal that it happened.
export async function sendPushToActor(actorId: string, payload: PushPayload): Promise<void> {
  if (!configured) return;

  const subs = await prisma.pushSubscription.findMany({ where: { actorId } });
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const stale: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          stale.push(sub.id);
        } else {
          logger.warn({ err, actorId, endpoint: sub.endpoint }, "web push send failed");
        }
      }
    }),
  );

  if (stale.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: stale } } });
  }
}

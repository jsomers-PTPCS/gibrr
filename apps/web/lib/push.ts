import {
  getVapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
  ApiError,
  type PushSubscriptionInput,
} from "./api";

// Web Push enrolment for the current browser/device. The API's
// federation/webPush.ts does the sending; this is just the browser side:
// permission prompt -> PushManager.subscribe -> hand the subscription to
// routes/push.ts.

export type PushState =
  // this browser can't do web push at all (no SW / no PushManager — e.g.
  // iOS Safari that isn't an installed PWA)
  | "unsupported"
  // the instance has no VAPID keypair configured
  | "unavailable"
  | "denied"
  | "subscribed"
  | "unsubscribed";

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function readSubscriptionJSON(): Promise<PushSubscriptionInput | null> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

// Current state for this device, without prompting for anything.
export async function getPushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  try {
    await getVapidPublicKey();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return "unavailable";
    // network/other — assume available, let the toggle try
  }
  if (Notification.permission === "denied") return "denied";
  const existing = await readSubscriptionJSON();
  return existing ? "subscribed" : "unsubscribed";
}

// Prompts for permission (if needed), subscribes, and registers with the
// API. Returns the resulting state.
export async function enablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";

  let key: string;
  try {
    key = (await getVapidPublicKey()).key;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return "unavailable";
    throw err;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "unsubscribed";

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // applicationServerKey accepts the base64url VAPID key as a string
    // directly (per the Push API spec) — no manual Uint8Array decode.
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "unsubscribed";
  await savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return "subscribed";
}

// Unsubscribes this device and tells the API to forget it.
export async function disablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await deletePushSubscription(endpoint).catch(() => {});
  }
  return "unsubscribed";
}

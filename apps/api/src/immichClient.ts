import { withTimeout } from "./calendarClient.js";

// Thin wrapper around Immich's REST API (x-api-key header auth). Written
// against Immich's documented API shape — NOT exercised against a live
// Immich server in this environment (no network access to one here). See
// the plan for this feature: every call below is timeout-bounded and
// catch-and-generalized specifically so a version mismatch in the exact
// endpoint/field shape fails as a clean "could not connect" rather than
// crashing — but the actual endpoint paths should be verified against a
// real Immich instance before relying on this in production.

const TIMEOUT_MS = 10_000;

interface ImmichCredentials {
  serverUrl: string;
  apiKey: string;
}

export interface ImmichAlbum {
  id: string;
  title: string;
  assetCount: number;
  thumbnailAssetId: string | null;
}

function apiUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, "")}/api${path}`;
}

function headers(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, Accept: "application/json" };
}

// Verifies the server is reachable and the API key is accepted — called
// at connect time so a bad key/URL fails immediately instead of silently
// saving something that will just fail on every later fetch.
export async function testConnection(creds: ImmichCredentials): Promise<void> {
  try {
    const res = await withTimeout(
      fetch(apiUrl(creds.serverUrl, "/albums"), { headers: headers(creds.apiKey) }),
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error("request failed");
  } catch {
    throw new Error("could not connect to Immich — check the server URL and API key");
  }
}

export async function fetchAlbums(creds: ImmichCredentials): Promise<ImmichAlbum[]> {
  try {
    const res = await withTimeout(
      fetch(apiUrl(creds.serverUrl, "/albums"), { headers: headers(creds.apiKey) }),
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error("request failed");
    const data = (await res.json()) as Array<{
      id: string;
      albumName?: string;
      assetCount?: number;
      assets?: unknown[];
      albumThumbnailAssetId?: string | null;
    }>;
    return data.map((album) => ({
      id: album.id,
      title: album.albumName ?? "Untitled album",
      assetCount: album.assetCount ?? album.assets?.length ?? 0,
      thumbnailAssetId: album.albumThumbnailAssetId ?? null,
    }));
  } catch {
    throw new Error("could not fetch albums from Immich");
  }
}

// Proxies raw asset bytes — never returned to a client except by the
// dedicated proxy route, which checks the content-type before streaming
// anything back (see routes/photos.ts).
export async function fetchAssetBytes(
  creds: ImmichCredentials,
  assetId: string,
  variant: "thumbnail" | "original",
): Promise<{ contentType: string; body: Buffer }> {
  try {
    const path = variant === "original" ? `/assets/${assetId}/original` : `/assets/${assetId}/thumbnail`;
    const res = await withTimeout(
      fetch(apiUrl(creds.serverUrl, path), { headers: headers(creds.apiKey) }),
      TIMEOUT_MS,
    );
    if (!res.ok) throw new Error("request failed");
    const contentType = res.headers.get("content-type") ?? "";
    const body = Buffer.from(await res.arrayBuffer());
    return { contentType, body };
  } catch {
    throw new Error("could not fetch that asset from Immich");
  }
}

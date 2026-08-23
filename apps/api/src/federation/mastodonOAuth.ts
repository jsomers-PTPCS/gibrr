import { originFor } from "./urls.js";
import { logger } from "../logger.js";

// Mastodon-API OAuth2 app-registration + Authorization Code flow, used to
// get a *user*-scoped access token for servers whose public timeline
// requires authentication (see mastodonExplore.ts's own comment on why
// that's now the common case for Pixelfed — a client_credentials/app-only
// token isn't enough there, only a real user logging in and clicking
// Authorize is). Each function is a plain unauthenticated (until the
// token step) REST call against the target server's own documented
// endpoints, same posture as mastodonExplore.ts's fetchStatuses.

export interface RegisteredOAuthApp {
  clientId: string;
  clientSecret: string;
}

export async function registerOAuthApp(domain: string, redirectUri: string): Promise<RegisteredOAuthApp | null> {
  try {
    const response = await fetch(`${originFor(domain)}/api/v1/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "Gibrr Explore",
        redirect_uris: redirectUri,
        scopes: "read",
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { client_id?: string; client_secret?: string };
    if (!json.client_id || !json.client_secret) return null;
    return { clientId: json.client_id, clientSecret: json.client_secret };
  } catch (err) {
    logger.warn({ err, domain }, "oauth app registration failed");
    return null;
  }
}

export function buildAuthorizeUrl(domain: string, clientId: string, redirectUri: string, state: string): string {
  const url = new URL(`${originFor(domain)}/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(
  domain: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${originFor(domain)}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
        scope: "read",
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch (err) {
    logger.warn({ err, domain }, "oauth token exchange failed");
    return null;
  }
}

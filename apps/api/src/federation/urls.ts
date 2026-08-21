// http only for local dev/testing (running Gibrr instances against each
// other on localhost with different ports/DOMAINs); every real deployment
// — local or remote — is https. Centralized here so local URL minting
// (actor IRIs, object IRIs) and outbound requests to *other* domains use
// exactly the same rule and can't drift apart.
export function schemeFor(domain: string): "http" | "https" {
  const host = domain.split(":")[0];
  return host === "localhost" || host === "127.0.0.1" ? "http" : "https";
}

export function originFor(domain: string): string {
  return `${schemeFor(domain)}://${domain}`;
}

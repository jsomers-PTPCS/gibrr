import { createSign, createVerify } from "node:crypto";
import type { IncomingMessage } from "node:http";

// Minimal HTTP Signatures (draft-cavage) helpers, enough to sign outgoing
// federation requests and verify incoming inbox POSTs. Full negotiation of
// signature algorithms/headers is deferred — this covers the rsa-sha256 case
// used by Mastodon, Lemmy, and Friendica today.

interface SignParams {
  method: string;
  url: string;
  headers: Record<string, string>;
  keyId: string;
  privateKey: string;
}

export function signRequest({ method, url, headers, keyId, privateKey }: SignParams): {
  signature: string;
  signedHeaders: string[];
} {
  const target = new URL(url);
  const signedHeaders = ["(request-target)", "host", "date"];
  const requestTarget = `${method.toLowerCase()} ${target.pathname}${target.search}`;

  const signingString = signedHeaders
    .map((header) =>
      header === "(request-target)"
        ? `(request-target): ${requestTarget}`
        : `${header}: ${headers[header]}`,
    )
    .join("\n");

  const signer = createSign("RSA-SHA256");
  signer.update(signingString);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64");

  const header = `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders.join(" ")}",signature="${signature}"`;
  return { signature: header, signedHeaders };
}

interface VerifyParams {
  req: Pick<IncomingMessage, "method" | "url" | "headers">;
  publicKey: string;
}

export function verifySignedRequest({ req, publicKey }: VerifyParams): boolean {
  const sigHeader = req.headers["signature"];
  if (!sigHeader || typeof sigHeader !== "string") return false;

  const parsed = Object.fromEntries(
    [...sigHeader.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  if (!parsed.headers || !parsed.signature) return false;

  const signedHeaders = parsed.headers.split(" ");
  const requestTarget = `${(req.method ?? "").toLowerCase()} ${req.url}`;

  const signingString = signedHeaders
    .map((header) =>
      header === "(request-target)"
        ? `(request-target): ${requestTarget}`
        : `${header}: ${req.headers[header]}`,
    )
    .join("\n");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingString);
  verifier.end();

  try {
    return verifier.verify(publicKey, Buffer.from(parsed.signature, "base64"));
  } catch {
    return false;
  }
}

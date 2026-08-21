import { createHash, createSign, createVerify } from "node:crypto";
import type { IncomingMessage } from "node:http";

// RFC 3230 / draft-cavage's Digest header — a body-integrity check
// independent of, but usually included in, the signed-headers set. A
// Signature can be perfectly valid while covering only headers; without
// this, a MITM could swap the body freely as long as it leaves the signed
// headers alone.
export function computeDigest(body: Buffer): string {
  return `SHA-256=${createHash("sha256").update(body).digest("base64")}`;
}

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
  // Defaults to the minimum any implementation accepts. POST deliveries
  // with a body additionally pass ["(request-target)", "host", "date",
  // "digest"] — see federation/deliver.ts — so the signature also covers
  // body integrity, not just headers.
  signedHeaders?: string[];
}

export function signRequest({
  method,
  url,
  headers,
  keyId,
  privateKey,
  signedHeaders = ["(request-target)", "host", "date"],
}: SignParams): {
  signature: string;
  signedHeaders: string[];
} {
  const target = new URL(url);
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
  // The exact bytes Express received, before JSON parsing — needed to
  // recompute the digest independently of whatever the Digest header
  // claims. Omit for a bodyless request (GET); a POST verified without it
  // only proves the headers weren't tampered with, not the body.
  rawBody?: Buffer;
}

export function verifySignedRequest({ req, publicKey, rawBody }: VerifyParams): boolean {
  const sigHeader = req.headers["signature"];
  if (!sigHeader || typeof sigHeader !== "string") return false;

  const parsed = Object.fromEntries(
    [...sigHeader.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  if (!parsed.headers || !parsed.signature) return false;

  // A signature can be mathematically valid while only covering headers —
  // if the sender also sent a Digest, it must actually match the body we
  // received, or a tampered/mismatched body would sail through untouched.
  const digestHeader = req.headers["digest"];
  if (rawBody && typeof digestHeader === "string" && digestHeader !== computeDigest(rawBody)) {
    return false;
  }

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

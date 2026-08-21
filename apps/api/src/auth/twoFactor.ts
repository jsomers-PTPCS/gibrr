import crypto from "node:crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import bcrypt from "bcryptjs";

const ISSUER = "Gibrr";
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_SALT_ROUNDS = 10;

export function generateTwoFactorSecret(): string {
  return authenticator.generateSecret();
}

// otpauth:// URI a real authenticator app (Google Authenticator, Aegis,
// 1Password, etc.) scans as a QR code — accountName is what shows next
// to the issuer inside the app, so a user with multiple accounts on
// this instance (or multiple instances) can tell entries apart.
export async function twoFactorQrCodeDataUrl(accountName: string, secret: string): Promise<string> {
  const uri = authenticator.keyuri(accountName, ISSUER, secret);
  return QRCode.toDataURL(uri);
}

export function verifyTwoFactorToken(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    // otplib throws on a malformed token (non-numeric, wrong length)
    // rather than just returning false — same "clearly not a match"
    // outcome either way.
    return false;
  }
}

// Plaintext codes are returned exactly once (POST /auth/2fa/enable's
// response) and never stored or logged again — only their bcrypt
// hashes persist, same one-way posture as the account password itself.
export async function generateBackupCodes(): Promise<{ plaintext: string[]; hashed: string[] }> {
  const plaintext = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(5).toString("hex"),
  );
  const hashed = await Promise.all(plaintext.map((code) => bcrypt.hash(code, BACKUP_CODE_SALT_ROUNDS)));
  return { plaintext, hashed };
}

// Checks `code` against every stored hash, returning the index of the
// first match (so the caller can remove exactly that one — a backup
// code is single-use, consumed by removing it from the array rather
// than flagging it) or -1 if none match.
export async function findMatchingBackupCode(code: string, hashedCodes: string[]): Promise<number> {
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(code, hashedCodes[i])) return i;
  }
  return -1;
}

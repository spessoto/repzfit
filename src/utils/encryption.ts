/**
 * Field-level encryption for sensitive data (LGPD compliance).
 *
 * Algorithm : AES-256-GCM (authenticated encryption)
 * Key source: FIELD_ENCRYPTION_KEY env var (32-byte hex string = 64 hex chars)
 * HMAC source: FIELD_HMAC_SECRET env var (32-byte hex string = 64 hex chars)
 *
 * Stored format: "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 * Plaintext (legacy / not yet migrated): stored without the "v1:" prefix
 *
 * Fallback behaviour:
 *   - decrypt() returns the value as-is when it does not start with "v1:"
 *     so old plaintext rows remain readable until the migration script runs.
 *   - When FIELD_ENCRYPTION_KEY is not set, encrypt() returns the plaintext
 *     and decrypt() returns the value as-is. This lets the app boot in
 *     environments that have not yet added the key (local dev without .env).
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGO    = "aes-256-gcm";
const IV_LEN  = 12;  // 96-bit IV recommended for GCM

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

let _encKey: Buffer | null = null;
let _hmacSecret: Buffer | null = null;

function getEncKey(): Buffer | null {
  if (_encKey) return _encKey;
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error("FIELD_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
  }
  _encKey = Buffer.from(hex, "hex");
  return _encKey;
}

function getHmacSecret(): Buffer | null {
  if (_hmacSecret) return _hmacSecret;
  const hex = process.env.FIELD_HMAC_SECRET;
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error("FIELD_HMAC_SECRET must be exactly 64 hex characters (32 bytes)");
  }
  _hmacSecret = Buffer.from(hex, "hex");
  return _hmacSecret;
}

// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypts a string value.
 * Returns "v1:<iv>:<tag>:<ciphertext>" (all base64).
 * Returns the plaintext unchanged if the encryption key is not configured.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const key = getEncKey();
  if (!key) return plaintext; // graceful no-op when key not configured

  const iv         = randomBytes(IV_LEN);
  const cipher     = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag    = cipher.getAuthTag();

  return `${VERSION}:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypts a value produced by encrypt().
 * Returns plaintext unchanged when:
 *   - the value does not start with "v1:" (legacy plaintext — not yet migrated)
 *   - the encryption key is not configured
 * Returns null for null/undefined input.
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null) return null;

  // Legacy plaintext — not yet encrypted; return as-is
  if (!ciphertext.startsWith(`${VERSION}:`)) return ciphertext;

  const key = getEncKey();
  if (!key) return ciphertext; // key not available — return raw (will look garbled but won't crash)

  const parts = ciphertext.split(":");
  if (parts.length !== 4) {
    throw new Error(`decrypt: malformed ciphertext (expected 4 parts, got ${parts.length})`);
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const iv      = Buffer.from(ivB64,  "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data    = Buffer.from(dataB64,"base64");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/**
 * Encrypts a number (stored as its string representation).
 * Returns null for null/undefined/NaN.
 */
export function encryptNumber(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return encrypt(String(value));
}

/**
 * Decrypts a field that was stored via encryptNumber().
 * Returns null if the stored value is null or cannot be parsed as a finite number.
 */
export function decryptNumber(ciphertext: string | null | undefined): number | null {
  const plain = decrypt(ciphertext);
  if (plain == null) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// HMAC for deterministic lookup (Fase 3)
// ---------------------------------------------------------------------------

/**
 * Computes HMAC-SHA256(value, FIELD_HMAC_SECRET).
 * Returns a 64-character hex string (256-bit hash).
 * Returns null when value is null/undefined or the secret is not configured.
 *
 * Use this to generate lookup columns (whatsapp_hash, phone_hash) that
 * allow exact-match queries without exposing the plaintext value.
 */
export function hmacHash(value: string | null | undefined): string | null {
  if (value == null) return null;
  const secret = getHmacSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// isEncrypted guard
// ---------------------------------------------------------------------------

/** Returns true if the string looks like a value encrypted by this module. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

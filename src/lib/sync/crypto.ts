/**
 * Encryption of the gist (FR-19.6) with the browser's Web Crypto API.
 *
 * - The key comes from the user's passphrase through PBKDF2 (SHA-256, a
 *   random 16-byte salt kept in the gist). It is created non-extractable, so
 *   the device can keep it (in IndexedDB) and use it, but never read it back.
 * - The list is encrypted with AES-256-GCM and a fresh random 12-byte IV on
 *   every write. GCM also authenticates, so a wrong key or a damaged file is
 *   detected instead of producing garbage.
 * - The gist file is an envelope: a few plain fields that let the app find
 *   its gist and derive the key, and the encrypted data.
 */

/**
 * PBKDF2 rounds (OWASP's figure for PBKDF2-HMAC-SHA256). The only count a gist
 * file may use, so a file can't make a device derive a weak key.
 */
export const KDF_ITERATIONS = 600_000;

/** Salt and IV lengths in bytes; a file with any other length is refused. */
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** The largest gist file accepted, in characters (5 MB; far above 10,000 tasks). */
export const MAX_FILE_CHARS = 5 * 1024 * 1024;

/** The shortest passphrase accepted for a new gist or Change Passphrase (fix 4, 2026-11-13). */
export const MIN_PASSPHRASE = 12;

/** The gist file's contents: plain metadata around the encrypted list. */
export interface Envelope {
  app: 'mytasks';
  format: 1;
  /** When the list was written; shown when several gists are found. */
  updatedAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  /** The encrypted list, base64. */
  data: string;
}

/** The data could not be decrypted: wrong key, or a damaged file. */
export class DecryptError extends Error {
  constructor() {
    super('The gist could not be decrypted.');
  }
}

const text = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** How many bytes a base64 string decodes to, or -1 when it isn't valid base64. */
function base64Bytes(b64: string): number {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return -1;
  try {
    return atob(b64).length;
  } catch {
    return -1;
  }
}

/** A new random salt, base64. */
export function newSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** The AES key for a passphrase and salt. */
export async function deriveKey(passphrase: string, salt: string, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', text.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt `plaintext` into an envelope. */
export async function seal(
  key: CryptoKey,
  kdf: { salt: string; iterations: number },
  plaintext: string,
  updatedAt: string,
): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, text.encode(plaintext)));
  return {
    app: 'mytasks',
    format: 1,
    updatedAt,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(data),
  };
}

/** Decrypt an envelope. Throws DecryptError for a wrong key or damaged data. */
export async function unseal(key: CryptoKey, env: Envelope): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(env.cipher.iv) },
      key,
      fromBase64(env.data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new DecryptError();
  }
}

/**
 * Parse a gist file into an envelope, or null when it is not one of ours or
 * fails a check: larger than MAX_FILE_CHARS, an iteration count other than
 * KDF_ITERATIONS, a salt or IV of the wrong length, or data that isn't base64.
 */
export function parseEnvelope(content: string): Envelope | null {
  if (content.length > MAX_FILE_CHARS) return null;
  let x: unknown;
  try {
    x = JSON.parse(content);
  } catch {
    return null;
  }
  const e = x as Partial<Envelope> | null;
  const ok =
    !!e &&
    e.app === 'mytasks' &&
    e.format === 1 &&
    typeof e.updatedAt === 'string' &&
    e.kdf?.name === 'PBKDF2' &&
    e.kdf.hash === 'SHA-256' &&
    e.kdf.iterations === KDF_ITERATIONS &&
    typeof e.kdf.salt === 'string' &&
    base64Bytes(e.kdf.salt) === SALT_BYTES &&
    e.cipher?.name === 'AES-GCM' &&
    typeof e.cipher.iv === 'string' &&
    base64Bytes(e.cipher.iv) === IV_BYTES &&
    typeof e.data === 'string' &&
    base64Bytes(e.data) > 0;
  return ok ? (e as Envelope) : null;
}

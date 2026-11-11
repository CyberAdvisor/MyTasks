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

/** PBKDF2 rounds for new keys (OWASP's figure for PBKDF2-HMAC-SHA256). */
export const KDF_ITERATIONS = 600_000;

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

/** A new random salt, base64. */
export function newSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
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
  const iv = crypto.getRandomValues(new Uint8Array(12));
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

/** Parse a gist file into an envelope, or null when it is not one of ours. */
export function parseEnvelope(content: string): Envelope | null {
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
    Number.isInteger(e.kdf.iterations) &&
    e.kdf.iterations > 0 &&
    typeof e.kdf.salt === 'string' &&
    e.cipher?.name === 'AES-GCM' &&
    typeof e.cipher.iv === 'string' &&
    typeof e.data === 'string';
  return ok ? (e as Envelope) : null;
}

/**
 * Identifier helpers.
 *
 * UUID v7 (RFC 9562): a 48-bit millisecond timestamp followed by random bits,
 * so ids sort by creation time. Used for every record (design doc, Section 4).
 */

/** Generate a UUID v7 string. `now` is injectable for tests. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Bytes 0-5: big-endian 48-bit timestamp in milliseconds.
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  // Version 7 in the high nibble of byte 6; RFC variant in byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Current time as an ISO timestamp. Wrapped so tests can stub it. */
export function nowIso(): string {
  return new Date().toISOString();
}

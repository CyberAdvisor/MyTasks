/**
 * Small per-device UI flags kept in localStorage (a collapsed section, a
 * hidden sidebar). Storage can be unavailable in some contexts, so failures
 * are harmless: the flag is just not remembered.
 */

/** Read a remembered flag. */
export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Remember a flag. */
export function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* not remembered; harmless */
  }
}

/** Read a remembered number, or null when none is saved. */
export function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Remember a number. */
export function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* not remembered; harmless */
  }
}

/** Read a remembered text value, or null when none is saved. */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remember a text value, or forget it when null. */
export function writeText(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* not remembered; harmless */
  }
}

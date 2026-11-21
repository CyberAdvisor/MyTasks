/**
 * Hand a file the app made to the user: the share sheet in the installed
 * iPhone and iPad app, where a download has nowhere to go, otherwise an
 * ordinary download. Used by Save Backup (FR-12.8) and Archive (FR-12.11).
 * Whether the file was then kept is up to the browser and the user.
 */
import { saveMethod } from './backup';
import { detectBrowser, isStandalone } from './pwa/platform';

/** 'shared' (the share sheet took it), 'downloaded', or 'dismissed' (the share sheet was closed). */
export type SaveResult = 'shared' | 'downloaded' | 'dismissed';

export async function saveFile(file: File): Promise<SaveResult> {
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (saveMethod(detectBrowser(), isStandalone(), canShare) === 'share') {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'dismissed';
      throw e;
    }
    return 'shared';
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

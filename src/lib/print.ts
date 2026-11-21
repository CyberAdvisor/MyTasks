/**
 * Print the page being shown (FR-12.5): the browser's print dialog, or, in
 * the installed iPhone and iPad app, where Safari ignores the print command,
 * an explanation instead (App.svelte). src/print.css decides what goes on
 * paper. Used by Print… in the ⋯ and right-click menus and by Cmd/Ctrl+P.
 */
import { canPrint, detectBrowser, isStandalone } from './pwa/platform';
import { ui } from './state/ui.svelte';

export function printPage(): void {
  if (canPrint(detectBrowser(), isStandalone())) window.print();
  else ui.printUnavailable = true;
}

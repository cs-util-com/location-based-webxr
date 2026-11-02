/**
 * Keeping the focus inside a modal dialog of the desktop editor (M4a
 * review #12): while a dialog shows, the rest of the page is `inert` -
 * not focusable, not clickable, hidden from assistive technology - so Tab
 * cycles within the dialog (and the browser's own controls) instead of
 * walking into the map and the rail behind it. The page's dialogs are
 * `hidden`-toggled backdrops, not `<dialog>` elements, so `inert` gives
 * them what `showModal()` would without changing their markup or styles.
 *
 * @see page-inert.ts.md
 */

/** A part of the page (structural, so the unit tests run in node). */
export interface InertPart {
  inert: boolean;
}

/**
 * Make each of `parts` inert; the returned function gives back exactly the
 * ones this call made inert (a part inert already stays so), once.
 */
export function holdPageInert(parts: readonly InertPart[]): () => void {
  const taken = parts.filter((part) => !part.inert);
  for (const part of taken) part.inert = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const part of taken) part.inert = false;
  };
}

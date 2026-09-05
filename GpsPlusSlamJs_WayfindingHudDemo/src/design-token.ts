/**
 * Reads a design-system token (a CSS custom property on the root element) so
 * WebGL objects can wear the same colours as the vendored `design.css`.
 *
 * The HUD's procedural indicators are tinted in the framework, which cannot
 * see any stylesheet; the demo therefore hands it the LIVE `--accent`, and a
 * re-tuned token moves the indicators with the CSS. When the sheet is absent
 * (jsdom, a page without the vendored copy) the reader returns `undefined` so
 * the caller OMITS the option and the framework default applies — an empty
 * string must never reach `THREE.Color`, which reads it as black.
 */

/** The slice of `window` the reader needs; injectable for tests. */
export interface TokenView {
  readonly document: { readonly documentElement: Element };
  readonly getComputedStyle: (element: Element) => CSSStyleDeclaration;
}

export function readCssToken(
  name: string,
  view: TokenView | undefined = globalThis.window,
): string | undefined {
  if (!name.startsWith("--")) {
    // A bare property name would read a REGULAR property of the root element
    // and hand back whatever it computes to — silently wrong, so refuse.
    throw new TypeError(
      `readCssToken: expected a custom property name (--…), got ${name}`,
    );
  }
  if (view === undefined) return undefined;
  const value = view
    .getComputedStyle(view.document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value === "" ? undefined : value;
}

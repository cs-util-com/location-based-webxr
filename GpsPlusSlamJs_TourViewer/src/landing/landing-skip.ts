/**
 * Whether a page load opens at the setup instead of the landing: a device
 * that used the setup before (a stored storage choice or a stored last
 * link) skips the landing it has already read. The page applies this in a
 * classic inline script right after the stage's markup (`index.html`,
 * `#landing-skip`), before the first paint, since a module would run too
 * late; `landing-skip.test.ts` holds that copy to this rule.
 *
 * @see landing-skip.ts.md
 */

/** The stored values that make a device a returning one: the storage
 *  choice (`tour-host.ts`; a deselected tile stores "") and the last link
 *  opened (`wizard.ts`). */
export const RETURNING_KEYS = [
  "tour-viewer.wizard.host",
  "tour-viewer.wizard.last-url",
] as const;

export interface LandingSkipInput {
  /** `body[data-mode]`, as the first-paint script set it. */
  readonly mode: string | undefined;
  /** The stored values of `RETURNING_KEYS`, null where nothing is stored. */
  readonly stored: readonly (string | null)[];
  /** `location.hash`: a link to a place in the page goes there instead. */
  readonly hash: string;
  /** The navigation entry's `type`; undefined where the browser has none. */
  readonly navigationType: string | undefined;
}

/**
 * True when the page should open scrolled to the setup: a creator's page,
 * a returning device, no hash, and a plain navigation. On a reload or
 * back/forward the browser restores its own scroll position instead, and a
 * browser that reports no navigation type opens at the top (a first visit's
 * view is the safe one to be wrong with).
 */
export function skipsLanding(input: LandingSkipInput): boolean {
  const returning = input.stored.some(
    (value) => typeof value === "string" && value !== "",
  );
  return (
    input.mode === "creator" &&
    returning &&
    input.hash === "" &&
    input.navigationType === "navigate"
  );
}

/**
 * Puts the stage back at the top after the page's own scripts changed the
 * layout around it (`main.ts` reveals the stage's map and step card, and
 * the landing's pictures mount above it), while the skip still holds: the
 * inline script marks `<html data-landing-skip="applied">` when it
 * skipped, and `"moved"` on the reader's first wheel, touch, key or
 * pointer input, after which the page is the reader's.
 */
export function reassertLandingSkip(doc: Document): void {
  if (doc.documentElement.dataset["landingSkip"] !== "applied") return;
  doc
    .getElementById("setup-stage")
    ?.scrollIntoView({ block: "start", behavior: "instant" });
}

/** What `holdLandingSkip` watches: the landing above the stage, and the
 *  stage with the parts `main.ts` reveals in it. */
const HELD = ["landing", "setup-stage", "setup-map", "setup-card"] as const;

/**
 * Keeps a skipped page at the setup while its layout settles: the parts
 * above and in the stage appear at their own pace (the stage's parts once
 * `main.ts` has run, the landing's pictures when their chunk arrives, the
 * AR check's lines), and the browser's scroll anchoring may follow a node
 * inside the stage rather than the stage itself. Puts the stage back now
 * and on every resize of those parts, until the reader's first input
 * (`data-landing-skip="moved"`); does nothing for a page that did not
 * skip. Without ResizeObserver it puts the stage back once.
 */
export function holdLandingSkip(
  doc: Document,
  Observer: typeof ResizeObserver | undefined = globalThis.ResizeObserver,
): void {
  if (doc.documentElement.dataset["landingSkip"] !== "applied") return;
  reassertLandingSkip(doc);
  if (Observer === undefined) return;
  const watch = new Observer(() => {
    if (doc.documentElement.dataset["landingSkip"] !== "applied") {
      watch.disconnect();
      return;
    }
    reassertLandingSkip(doc);
  });
  for (const id of HELD) {
    const node = doc.getElementById(id);
    if (node !== null) watch.observe(node);
  }
}

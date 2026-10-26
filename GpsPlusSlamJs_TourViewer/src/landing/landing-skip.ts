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
import { HOST_KEY } from "../tour-host.js";
import { WIZARD_LAST_URL_KEY } from "../wizard.js";

/** The stored values that make a device a returning one: the storage
 *  choice (`tour-host.ts`; a deselected tile stores "") and the last link
 *  opened (`wizard.ts`). */
export const RETURNING_KEYS = [HOST_KEY, WIZARD_LAST_URL_KEY] as const;

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
 * layout around it (`main.ts` reveals the stage's step card, and the
 * landing's pictures mount above it), while the skip still holds: the
 * inline script marks `<html data-landing-skip="applied">` when it
 * skipped; `"moved"` once the reader moved the page, `"released"` once
 * the hold ended (`holdLandingSkip`).
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

/** How long the hold lasts after the landing's parts settled: a part's
 *  own late layout (a picture's first frame, a font) lands within it. */
const HOLD_GRACE_MS = 1000;

/** A scroll by less than this is the hold's own position read back
 *  (sub-pixel rounding), not the reader's. */
const OWN_SCROLL_PX = 1;

/** The window slice the hold reads. */
interface HoldView {
  readonly scrollY: number;
  addEventListener(type: "scroll", listener: () => void): void;
  removeEventListener(type: "scroll", listener: () => void): void;
  setTimeout(handler: () => void, ms: number): unknown;
}

export interface HoldOptions {
  /** Settles (either way) once the landing's parts have mounted or
   *  failed (`mountLanding().ready`); the hold ends `graceMs` after.
   *  Without it the hold ends only with the reader. */
  readonly until?: PromiseLike<unknown>;
  readonly graceMs?: number;
  /** `ResizeObserver`; undefined puts the stage back once only. */
  readonly Observer?: typeof ResizeObserver | undefined;
  readonly view?: HoldView;
}

/**
 * Keeps a skipped page at the setup while its layout settles: the parts
 * above and in the stage appear at their own pace (the stage's step card
 * once `main.ts` has run, the landing's pictures when their chunk arrives,
 * the AR check's lines), and the browser's scroll anchoring may follow a
 * node inside the stage rather than the stage itself. Puts the stage back
 * now and on every resize of those parts. It ends, for good:
 * - on the reader's first wheel, touch, key or pointer input (the inline
 *   script marks `"moved"`),
 * - on a scroll to a position the hold did not set (`"moved"`): a
 *   scrollbar drag or a screen reader's browse mode sends none of those
 *   inputs, and
 * - `graceMs` after `until` settled (`"released"`).
 * Does nothing for a page that did not skip. Because `main.ts` runs its
 * wiring synchronously, the stage's parts are revealed before `until`
 * can settle.
 */
export function holdLandingSkip(
  doc: Document,
  options: HoldOptions = {},
): void {
  const mark = doc.documentElement.dataset;
  if (mark["landingSkip"] !== "applied") return;
  const view: HoldView = options.view ?? window;
  const Observer =
    "Observer" in options ? options.Observer : globalThis.ResizeObserver;
  let setY = view.scrollY;
  let watch: ResizeObserver | undefined;

  const end = (as: "moved" | "released"): void => {
    if (mark["landingSkip"] === "applied") mark["landingSkip"] = as;
    watch?.disconnect();
    view.removeEventListener("scroll", onScroll);
  };
  const putBack = (): void => {
    if (mark["landingSkip"] !== "applied") {
      end("released");
      return;
    }
    reassertLandingSkip(doc);
    setY = view.scrollY;
  };
  function onScroll(): void {
    if (mark["landingSkip"] !== "applied") {
      end("released");
      return;
    }
    if (Math.abs(view.scrollY - setY) > OWN_SCROLL_PX) end("moved");
  }

  putBack();
  view.addEventListener("scroll", onScroll);
  if (Observer !== undefined) {
    watch = new Observer(putBack);
    for (const id of HELD) {
      const node = doc.getElementById(id);
      if (node !== null) watch.observe(node);
    }
  }
  const grace = options.graceMs ?? HOLD_GRACE_MS;
  const ended = (): void => {
    view.setTimeout(() => {
      end("released");
    }, grace);
  };
  options.until?.then(ended, ended);
}

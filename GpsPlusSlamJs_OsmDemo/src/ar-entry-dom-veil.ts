import { smoothstep } from "./easing.js";
import { ENTRY_VEIL_COLOUR } from "./ar-entry-veil.js";

/**
 * An opaque DOM layer over the AR overlay root, for the window a MESH cannot
 * cover.
 *
 * **WHY A SECOND VEIL EXISTS AT ALL.** `ar-entry-veil.ts` puts an inside-out
 * sphere in the scene and it works — a field session confirmed the black and
 * the fade on a real phone. What it cannot do is cover the gap between
 * `navigator.xr.requestSession` RESOLVING and the first `renderer.render`.
 * Immersive compositing has begun by then, so the passthrough camera is already
 * on screen, and in an `alpha-blend` session a framebuffer that has not been
 * drawn IS the camera image. No mesh helps, because there is no rendered scene
 * yet.
 *
 * The reported symptom was exactly that: black with "Finding your position…",
 * then **a flash of camera**, then black again, then the correct fade. The
 * reporter diagnosed it as the sphere being built too late; it is not — there
 * is no `await` between `initAR` resolving and the mesh being added.
 *
 * **WHY THE DOM CAN DO IT.** `#ar-root` is the session's `domOverlay` root, and
 * the browser composites that subtree over the camera and the WebGL layer
 * **whether or not WebGL drew anything**. That is also why `.ar-entry-wait`,
 * which has no background of its own, shows up as text over live camera on any
 * frame that skipped `renderer.render` — the frame loop has two early returns
 * that do exactly that.
 *
 * So this element is inserted BEFORE the session is requested, and once a frame
 * has actually been drawn with the mesh veil in it, it FADES rather than
 * vanishing (DEC-L1) — the seventeenth session still saw a flash of camera at
 * the instant of the hard cut, and the fade covers every candidate cause of it.
 *
 * @see ar-entry-dom-veil.ts.md
 */

/** The class the stylesheet paints; kept in one place for the e2e to query. */
export const ENTRY_DOM_VEIL_CLASS = "ar-entry-dom-veil";

/**
 * How long the veil takes to fade out once {@link entryFadeMayStart} opens
 * (DEC-L1, retimed by DEC-M1).
 *
 * **3 → 2 BY DEC-M1**, and the seconds it lost were not deleted: they moved
 * into {@link ENTRY_DOM_VEIL_HOLD_S}, where the eighteenth field session asked
 * for them. *"Die ersten zwei Sekunden muss da einfach erstmal nur dieser Text
 * stehen und überhaupt kein Alpha passieren … und erst nach zwei Sekunden fängt
 * er dann an rauszufaden, was dann nochmal zwei Sekunden dauert."*
 *
 * **Rejected: starting the fade when the element is inserted.** That is the
 * literal reading of the earlier request, and it is the one variant that can
 * fail — insertion happens BEFORE `requestSession`, so a slow permission grant
 * would finish the fade while the consent dialog is still up.
 */
export const ENTRY_DOM_VEIL_FADE_S = 2;

/**
 * How long the veil stays fully opaque before it may begin fading (DEC-M1).
 *
 * **THE HOLD LIVES IN THE GATE, NOT IN THE CURVE, and that is a correction the
 * cold review made** (finding 3). The first draft of DEC-M1 also gave
 * {@link domVeilAlpha} a plateau of the same length, which composes to a 6 s
 * black screen rather than the 4 s the timeline promises — and puts one number
 * in two places that must agree, the shape this module's own colour derivation
 * exists to avoid.
 *
 * So the curve is a plain fade and this is a precondition of starting it.
 */
export const ENTRY_DOM_VEIL_HOLD_S = 2;

/**
 * How long the veil will wait for a session that never becomes ready (DEC-M1).
 *
 * **A CEILING, NOT A BUDGET**, exactly like `DESCENT_ESTIMATE_WAIT_S`: an
 * opaque full-screen layer with no exit condition is the lid this module calls
 * strictly worse than having no veil at all, and a device that never gets a fix
 * would otherwise sit behind a black screen forever.
 *
 * ⚠️ **EIGHT SECONDS IS A GUESS, and the cold review was right that its first
 * justification was circular** — "twice the 4 s the sequence costs when warm"
 * reasons from the plan's own numbers rather than from a measurement. What is
 * recorded elsewhere in this demo is that a full refresh can be *"three rings,
 * a worker mesh build, up to 18 s"*, so on a slow start this ceiling may well
 * be the normal path — which would make the entry a near-fixed 8 s black
 * screen, an outcome DEC-M1 explicitly rejected in its literal form.
 *
 * It ships anyway, because every alternative is another guess and a longer
 * black screen is the failure that gets worse the longer you wait. DEC-M1a is
 * the other half: the entry stamps how long each condition actually took, so
 * the next field session returns a measurement instead of an impression.
 */
export const ENTRY_READY_MAX_WAIT_S = 8;

/** What the entry knows about its own readiness on this frame. */
export interface EntryFadeGate {
  /** Seconds since the session's first frame. */
  readonly waitedS: number;
  /**
   * Whether the framework's alignment has left identity, i.e. at least one GPS
   * solve has landed.
   *
   * **THE M2 CONDITION.** Until it is true the city is drawn in the AR
   * session's own origin frame — *"wrong place, arbitrary rotation"*, in
   * `gps-registration.ts`'s words about the bug it was written to fix — so
   * uncovering shows a correctly-placed, wrongly-rotated city.
   *
   * Not weakened by the alignment lerper: the framework applies the FIRST
   * target instantly rather than animating out of identity, so "not identity"
   * means a fully-applied solve rather than a half-rotated city.
   */
  readonly aligned: boolean;
  /**
   * Whether the AR entry rebuild has settled.
   *
   * The city is re-fetched and re-meshed on entry because the AR datum is baked
   * into its vertices; until that settles, what is on screen was built for the
   * desktop datum.
   */
  readonly contentReady: boolean;
}

/**
 * Whether the veil may begin fading on this frame.
 *
 * **Monotone in `waitedS` by construction**, which is the property the driver
 * depends on: it latches the fade's start on the first frame this returns true,
 * so a gate that could go false again would re-opaque a veil mid-fade.
 *
 * **A non-finite `waitedS` collapses to "not yet"** — the rule `descentMayStart`
 * follows, and the opposite of {@link domVeilAlpha}'s. The inputs are different
 * kinds of thing: there it is an opacity, where the safe answer is "no veil";
 * here it is a clock, and a `NaN` reading that opened the gate would uncover the
 * camera on the strength of a number that means nothing. `+Infinity` is the one
 * exception and opens, because it is a real "long past the ceiling".
 */
export function entryFadeMayStart(gate: EntryFadeGate): boolean {
  if (Number.isNaN(gate.waitedS)) return false;
  if (gate.waitedS >= ENTRY_READY_MAX_WAIT_S) return true;
  if (!gate.aligned || !gate.contentReady) return false;
  return gate.waitedS >= ENTRY_DOM_VEIL_HOLD_S;
}

/**
 * The veil's opacity `s` seconds into the fade, `[0,1]`.
 *
 * `1` at and before 0, easing to exactly `0` at {@link ENTRY_DOM_VEIL_FADE_S}
 * and staying there. Pure, so the curve is testable without a session, a
 * renderer or a clock — which is the deciding argument for driving this from
 * the frame loop rather than from a CSS animation, since jsdom runs no
 * animations and the degenerate inputs below are where the lid comes from.
 *
 * **EVERY NON-FINITE READING COLLAPSES TO 0, never to 1.** An opaque layer left
 * over a live session is a lid on the passthrough — `ar-entry-veil.ts` records
 * that as strictly worse than having no veil at all — and a `NaN` resolving to
 * opaque would also stop the driver ever reaching its removal condition, so the
 * veil would outlive the entry with no error raised anywhere.
 *
 * ⚠️ **This is deliberately NOT `ar-entry-veil.ts`'s `setAlpha` rule**, which
 * clamps `+Infinity` UP to 1. There the input is an opacity and "as opaque as
 * possible" is a real request; here it is elapsed time, so an infinite reading
 * means the fade is long over. The rule followed here is `entryVeilAlpha`'s:
 * every degenerate input resolves to "no veil".
 *
 * ⚠️ And it is NOT {@link entryFadeMayStart}'s rule either, which is one file
 * down: that one takes a clock too, but its unsafe direction is the opposite —
 * a `NaN` that opened the gate would uncover the camera on the strength of a
 * reading that means nothing.
 */
export function domVeilAlpha(elapsedS: number): number {
  if (!Number.isFinite(elapsedS)) return 0;
  // BEFORE THE FADE, not "unusable": the driver latches the start on the frame
  // it first evaluates this, so 0 is the ordinary first reading and a negative
  // one could only come from a clock that ran backwards. Both mean "the fade
  // has not begun", and the session's own teardown removes the element if it
  // somehow never does.
  if (elapsedS <= 0) return 1;
  if (elapsedS >= ENTRY_DOM_VEIL_FADE_S) return 0;
  return 1 - smoothstep(elapsedS / ENTRY_DOM_VEIL_FADE_S);
}

/**
 * `ENTRY_VEIL_COLOUR` as CSS, so the two veils are indistinguishable.
 *
 * Derived rather than written twice: the whole effect depends on the handover
 * being invisible, and two hex literals that must match is the shape this repo
 * has been bitten by before.
 */
export function entryDomVeilColour(): string {
  return `#${ENTRY_VEIL_COLOUR.toString(16).padStart(6, "0")}`;
}

export interface ArEntryDomVeil {
  readonly element: HTMLElement;
  /**
   * Fade it, `[0,1]`. Clamped; anything unusable collapses to 0.
   *
   * Separate from {@link remove} on purpose: the caller drives the alpha every
   * frame and removes the element only once it reaches 0, so a fade that stops
   * being driven leaves a partially transparent layer rather than a lid.
   */
  setAlpha(alpha: number): void;
  /** Idempotent: safe to call from several exit paths and from the frame hook. */
  remove(): void;
}

/**
 * Insert the veil into `container`, which must be the `domOverlay` root.
 *
 * `aria-hidden`, because it carries no information — the "Finding your
 * position…" line is the accessible status and is a separate element with
 * `role="status"`. A second announced node would make a screen reader say
 * nothing twice.
 */
export function createArEntryDomVeil(container: HTMLElement): ArEntryDomVeil {
  const element = document.createElement("div");
  element.className = ENTRY_DOM_VEIL_CLASS;
  element.setAttribute("aria-hidden", "true");
  element.style.background = entryDomVeilColour();
  container.append(element);

  let removed = false;
  return {
    element,
    setAlpha(alpha: number): void {
      // NON-FINITE COLLAPSES TO 0, never to 1 — the same direction
      // `domVeilAlpha` fails in, and for the same reason.
      //
      // AND CLAMPED RATHER THAN PASSED THROUGH. A CSS `opacity` outside [0,1]
      // is an invalid declaration, which the browser DROPS — restoring the
      // element to fully opaque. That is the lid again, arriving by the one
      // path that looks harmless.
      const safe = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
      element.style.opacity = String(safe);
    },
    remove(): void {
      if (removed) return;
      removed = true;
      element.remove();
    },
  };
}

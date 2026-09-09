/**
 * The creator's guided setup (guided-setup plan §2.7): the steps as
 * collapsible sections, one open at a time, advanced by the events of the
 * flow - a tour opened (→ print), the code hung (→ measure). Also owns the
 * two step-1/step-2 controls that have no other home: the starter zip
 * download for a creator without a recording, and the "open as a visitor"
 * link that is the tester's way into the visitor path (DEC-N1, plan review
 * #13).
 *
 * FOUR steps since the flow rework (second testing session, F10): the
 * download and the replace instructions were steps 5 and 6, and they are
 * not setup steps - they describe what happens at the end of step 4, on
 * the phone, so they moved into step 4 itself. Step 4 also became a real
 * disclosure (F4), which brings the one rule this module now has to
 * enforce: it holds the DOM-overlay root, so it must not be collapsed
 * while an AR session is live (see `openStep`).
 *
 * The reached step is remembered per hosted url, and the last opened url
 * itself (M6, plan §2.7): after a reload (the AR session, the print
 * dialog) the link is prefilled and Open returns to the step the creator
 * reached instead of step 1. The store is injected (`localStorage` in
 * production) and every access is guarded - blocked site data or a
 * sandboxed context must not break the setup (a private window has a
 * working, session-scoped store and needs no guard).
 *
 * The DOM surface is structural so the unit tests pass plain objects (this
 * package's unit tests run in node, no jsdom); the e2e suite drives the
 * real page.
 */

import type { ViewerMode } from "./mode.js";

/**
 * The steps, in order. Four since the flow rework (F10): the download and
 * the replace instructions used to be steps 5 and 6, and they are not setup
 * steps - they describe the END of step 4, which happens on the phone.
 *
 * `measure` IS collapsible now (F4), but it wraps `#ar-root`, the
 * DOM-overlay root, so collapsing it mid-session would `display: none` the
 * overlay. `openStep` refuses to while a session is live; see there.
 */
export const WIZARD_STEPS = ["host", "print", "hang", "measure"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/**
 * Steps a previous version of this page could store, mapped to where their
 * work happens now (F10). Applied to the RAW stored string, BEFORE parsing:
 * `parseWizardStep` rejects anything outside `WIZARD_STEPS`, so a remap
 * placed after it could never fire and every creator who had reached step 5
 * would silently restart at step 2.
 *
 * Both land on `measure` for the same reason the old `finish → measure`
 * remap did: the rebuilt zip lives only in the page that made it, so after
 * a reload there is nothing to download and measuring again is the honest
 * place to resume.
 */
const LEGACY_STEP_REMAP: Readonly<Record<string, WizardStep>> = {
  finish: "measure",
  replace: "measure",
};

/** A stored step name, with the retired names mapped forward. */
export function remapLegacyStep(raw: string | null): string | null {
  if (raw === null) return null;
  return LEGACY_STEP_REMAP[raw] ?? raw;
}

/** A collapsible step (`<details>`), structurally. The optional listener
 *  is the real element's; a creator opening a second step by hand closes
 *  the others through it (M2 review #12). */
interface StepNode {
  open: boolean;
  addEventListener?(type: "toggle", listener: () => void): void;
}

export interface WizardDom {
  /** Every collapsible step by name. `measure` is among them since the
   *  flow rework (F4) - and is the one the AR-session rule protects. */
  steps: Partial<Record<WizardStep, StepNode>>;
  /** "I hung it - continue" in step 3. */
  hangDone: ClickableNode;
  /** "Download an empty starter zip" in step 1. */
  starterButton: ButtonNode;
  /** The `?qr=` launch link in step 2. */
  visitorLink: LinkNode;
  /** The AR section, scrolled into view when step 4 opens. The same
   *  element as `steps.measure`, reached through a second field because
   *  scrolling and disclosing are different capabilities and the unit
   *  tests give each its own fake. */
  measureSection?: { scrollIntoView(options?: { block: "start" }): void };
}

interface ClickableNode {
  addEventListener(type: "click", listener: () => void): void;
}
type ButtonNode = ClickableNode &
  Pick<HTMLButtonElement, "disabled" | "textContent">;
type LinkNode = Pick<HTMLAnchorElement, "href" | "hidden">;

/** Where the reached step is remembered (per hosted url). */
export interface WizardStepStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The storage key for a hosted url's reached step. */
export function wizardStepKey(url: string): string {
  return `tour-viewer.wizard.${url}`;
}

/** The storage key for the last url a creator opened. */
const WIZARD_LAST_URL_KEY = "tour-viewer.wizard.last-url";

/**
 * The browser's step store, or undefined where reaching for it throws.
 * `localStorage` is a GETTER, and `typeof` still runs it: with site data
 * blocked, in a sandboxed frame or a WebView with DOM storage off the get
 * throws, and at module top level that blanked the whole page for a
 * visitor who had just scanned a code (M6 review #1).
 */
export function stepStoreOrUndefined(
  read: () => WizardStepStore | undefined = () => globalThis.localStorage,
): WizardStepStore | undefined {
  try {
    return read() ?? undefined;
  } catch {
    return undefined;
  }
}

/** A remembered step, or null for anything unreadable. */
export function parseWizardStep(value: string | null): WizardStep | null {
  return (WIZARD_STEPS as readonly string[]).includes(value ?? "")
    ? (value as WizardStep)
    : null;
}

export interface Wizard {
  /** Open one step, collapse the others; remembered for the open tour. */
  openStep(step: WizardStep): void;
  /** Open one step WITHOUT collapsing the others, and without remembering
   *  it. For the one case where a step must be reachable while the
   *  creator's attention belongs somewhere else: AR refuses to start
   *  because the printed size is empty, the message says so in step 4, and
   *  the field to fix it is in step 2. Collapsing step 4 there would take
   *  the message away with it (M3 milestone review #2). */
  revealStep(step: WizardStep): void;
  /** The last url a creator opened on this device, for the link input. */
  rememberedTourUrl(): string | null;
  /** A tour opened: the launch link becomes usable and a step opens. Which
   *  step: the one this creator last reached with THIS tour, else `prefer`
   *  when the caller knows where the creator is standing (step 4's own
   *  "paste the link" form does), else the print step. */
  presentTour(url: string, options?: { prefer?: WizardStep }): void;
  /** A code was generated: the link carries the PRINTED payload (the
   *  measured shortest form and the code-number token), so the tester's
   *  way in decodes what a real scan decodes (M2 review #10). */
  presentLaunchUrl(launchUrl: string): void;
}

/** The launch link for `url`, relative to the page (the landing's `?qr=`
 *  forward is not needed when the viewer itself is the origin). */
export function visitorLaunchHref(url: string): string {
  return `?qr=${encodeURIComponent(url)}`;
}

/** The printed launch URL's query, re-homed on the viewer's own origin:
 *  `https://gps.csutil.com/?qr=~blob&n=2` → `?qr=~blob&n=2`. A URL without
 *  a `qr` parameter is not a launch link and yields null. */
export function launchHrefFromPrintedUrl(launchUrl: string): string | null {
  try {
    const parsed = new URL(launchUrl);
    if (!parsed.searchParams.has("qr")) return null;
    return parsed.search;
  } catch {
    return null;
  }
}

/** The starter button's labels through its async cycle (async-UI rule). */
export const STARTER_LABELS = {
  idle: "Optional: download an empty starter zip",
  busy: "Preparing…",
  done: "Starter zip downloaded",
  cancelled: "Not saved - tap to try again",
  failed: "Could not build the starter zip",
} as const;

export function wireWizard(deps: {
  mode: ViewerMode;
  dom: WizardDom;
  /** Builds the starter archive (an empty manifest). */
  packStarter: () => Promise<Blob>;
  /** Offers the blob; resolves false when the user dismissed a save picker. */
  download: (blob: Blob, filename: string) => Promise<boolean>;
  /** Label-revert timer, injectable for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** The step store (`localStorage`); undefined = no persistence. */
  stepStore?: WizardStepStore;
  /** Whether an AR session is live right now. Step 4 holds the DOM-overlay
   *  root, so while this is true the wizard must not collapse it. */
  arSessionActive?: () => boolean;
}): Wizard {
  const { mode, dom, packStarter, download, stepStore } = deps;
  const arSessionActive = deps.arSessionActive ?? (() => false);
  /** The hosted url the remembered step belongs to (set by presentTour). */
  let tourUrl: string | null = null;
  /** A step opened by `revealStep`, awaiting its own queued `toggle`. */
  let revealed: WizardStep | null = null;

  function remember(step: WizardStep): void {
    // A visitor never writes a creator's key (M6 review #11), whatever
    // calls openStep on the visitor page later.
    if (mode !== "creator" || tourUrl === null || stepStore === undefined)
      return;
    try {
      stepStore.setItem(wizardStepKey(tourUrl), step);
    } catch {
      // Blocked site data: the setup still works, nothing is remembered.
    }
  }

  function rememberUrl(url: string): void {
    if (stepStore === undefined) return;
    try {
      stepStore.setItem(WIZARD_LAST_URL_KEY, url);
    } catch {
      // As above.
    }
  }

  function remembered(url: string): WizardStep | null {
    if (stepStore === undefined) return null;
    try {
      // The remap runs on the raw string: see LEGACY_STEP_REMAP for why it
      // cannot sit on the other side of the parse.
      return parseWizardStep(
        remapLegacyStep(stepStore.getItem(wizardStepKey(url))),
      );
    } catch {
      return null;
    }
  }

  function rememberedTourUrl(): string | null {
    if (stepStore === undefined) return null;
    try {
      return stepStore.getItem(WIZARD_LAST_URL_KEY);
    } catch {
      return null;
    }
  }
  const schedule = deps.setTimeout ?? setTimeout;
  const cancel =
    deps.clearTimeout ??
    ((handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  function openStep(step: WizardStep): void {
    // THE ONE HARD RULE (M3 review #2). Step 4 holds `#ar-root`, and a
    // collapsed <details> renders nothing, so closing step 4 during a
    // session destroys the DOM overlay the creator is looking through.
    // Hiding the summary stops a tap and the keyboard; it does NOT stop
    // the four places that assign `open` directly - the print panel does
    // it on `beforeprint`, so a Ctrl+P was enough. Nothing else on the
    // page is reachable mid-session anyway, so the only correct move is
    // to keep step 4 open and change nothing else.
    if (arSessionActive()) {
      const measure = dom.steps.measure;
      if (measure !== undefined) measure.open = true;
      return;
    }
    for (const name of WIZARD_STEPS) {
      const node = dom.steps[name];
      if (node !== undefined) node.open = name === step;
    }
    remember(step);
    if (step === "measure") {
      // Step 4 is the tall one and its body is the AR section: opening it
      // from the bottom of step 3 would otherwise leave the creator
      // looking at the summary row alone.
      dom.measureSection?.scrollIntoView({ block: "start" });
    }
  }

  if (mode === "creator") openStep("host");
  dom.visitorLink.hidden = true;
  // The idle label lives in the constant, not only in the markup: it used
  // to be applied ONLY by the revert timer, so renaming it left the old
  // words on screen until after the creator's first click (M3 review #12).
  dom.starterButton.textContent = STARTER_LABELS.idle;

  // One step open at a time also when the creator opens one BY HAND: a
  // second summary tap closes the others. CREATOR ONLY (M3 review #10):
  // on the visitor page `visitor-screen.ts` opens step 4 to make the AR
  // section the screen, and a listener here would turn that into
  // `openStep("measure")` and scroll the consent copy - the one screen a
  // visitor has to read - off the top before they ever see it.
  if (mode === "creator") {
    for (const name of WIZARD_STEPS) {
      const node = dom.steps[name];
      node?.addEventListener?.("toggle", () => {
        if (!node.open) return;
        // A step this module revealed on purpose (see `revealStep`) must
        // not be treated as a creator's tap - the collapse that follows is
        // the whole thing it was avoiding. `toggle` is queued, so the flag
        // is cleared here rather than at the assignment.
        if (revealed === name) {
          revealed = null;
          return;
        }
        openStep(name);
      });
    }
  }

  dom.hangDone.addEventListener("click", () => {
    openStep("measure");
  });

  /** The starter label's revert timer; cleared on a re-click so the first
   *  run's revert cannot overwrite a second run's label. */
  let starterRevert: unknown = null;
  dom.starterButton.addEventListener("click", () => {
    if (starterRevert !== null) cancel(starterRevert);
    starterRevert = null;
    dom.starterButton.disabled = true;
    dom.starterButton.textContent = STARTER_LABELS.busy;
    packStarter()
      .then((blob) => download(blob, "tour.zip"))
      .then(
        (saved) => {
          dom.starterButton.textContent = saved
            ? STARTER_LABELS.done
            : STARTER_LABELS.cancelled;
        },
        () => {
          dom.starterButton.textContent = STARTER_LABELS.failed;
        },
      )
      .finally(() => {
        dom.starterButton.disabled = false;
        starterRevert = schedule(() => {
          starterRevert = null;
          dom.starterButton.textContent = STARTER_LABELS.idle;
        }, 3000);
      });
  });

  return {
    openStep,
    revealStep: (step) => {
      const node = dom.steps[step];
      if (node === undefined || node.open) return;
      // Assigning `open` fires `toggle`, and this module's own listener
      // turns any toggle into `openStep` - which collapses everything else,
      // i.e. exactly what this function exists not to do. So the step is
      // marked as opened BY US, and the listener lets that one through.
      // No `remember` either: the creator did not go here, they were sent.
      revealed = step;
      node.open = true;
    },
    rememberedTourUrl,
    presentTour: (url, options) => {
      dom.visitorLink.href = visitorLaunchHref(url);
      dom.visitorLink.hidden = false;
      if (mode !== "creator") return;
      tourUrl = url;
      rememberUrl(url);
      // Land where the creator got to with this tour (a reload after the
      // AR session, a return from the print dialog). Failing that, where
      // the CALLER says the creator is standing: step 4's own "paste the
      // link" form opens the tour from step 4, and without this the page
      // would answer by jumping to step 2 and collapsing step 4 - undoing
      // the very thing the form exists to do (M3 review #1). A remembered
      // step still wins: it is evidence about this creator and this tour.
      openStep(remembered(url) ?? options?.prefer ?? "print");
    },
    presentLaunchUrl: (launchUrl) => {
      const href = launchHrefFromPrintedUrl(launchUrl);
      if (href === null) return;
      dom.visitorLink.href = href;
      dom.visitorLink.hidden = false;
    },
  };
}

/**
 * The creator's guided setup (guided-setup plan §2.7): the steps as
 * collapsible sections, one open at a time, advanced by the events of the
 * flow - a tour opened (→ print), the code hung (→ measure), the zip
 * rebuilt (→ finish, then replace). Also owns the two step-1/step-2
 * controls that have no other home: the starter zip download for a creator
 * without a recording, and the "open as a visitor" link that is the
 * tester's way into the visitor path (DEC-N1, plan review #13).
 *
 * The reached step is remembered per hosted url (M6, plan §2.7): a reload
 * after the AR session, or a return from the print dialog, lands on the
 * step the creator reached instead of step 1. The store is injected
 * (`localStorage` in production) and every access is guarded - a private
 * window or blocked site data must not break the setup.
 *
 * The DOM surface is structural so the unit tests pass plain objects (this
 * package's unit tests run in node, no jsdom); the e2e suite drives the
 * real page.
 */

import type { ViewerMode } from "./mode.js";

/** The steps, in order. `measure` is not collapsible: it wraps `#ar-root`,
 *  the DOM-overlay root, which must stay rendered in both modes. */
export const WIZARD_STEPS = [
  "host",
  "print",
  "hang",
  "measure",
  "finish",
  "replace",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** A collapsible step (`<details>`), structurally. The optional listener
 *  is the real element's; a creator opening a second step by hand closes
 *  the others through it (M2 review #12). */
interface StepNode {
  open: boolean;
  addEventListener?(type: "toggle", listener: () => void): void;
}

export interface WizardDom {
  /** Every collapsible step by name (`measure` has none). */
  steps: Partial<Record<WizardStep, StepNode>>;
  /** "I hung it - continue" in step 3. */
  hangDone: ClickableNode;
  /** "Download an empty starter zip" in step 1. */
  starterButton: ButtonNode;
  /** The `?qr=` launch link in step 2. */
  visitorLink: LinkNode;
  /** The AR section, scrolled into view when step 4 opens (it has no
   *  collapsible node of its own). */
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

/** A remembered step, or null for anything unreadable. */
export function parseWizardStep(value: string | null): WizardStep | null {
  return (WIZARD_STEPS as readonly string[]).includes(value ?? "")
    ? (value as WizardStep)
    : null;
}

export interface Wizard {
  /** Open one step, collapse the others; remembered for the open tour. */
  openStep(step: WizardStep): void;
  /** A tour opened: the launch link becomes usable and the print step opens. */
  presentTour(url: string): void;
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
  idle: "Download an empty starter zip",
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
}): Wizard {
  const { mode, dom, packStarter, download, stepStore } = deps;
  /** The hosted url the remembered step belongs to (set by presentTour). */
  let tourUrl: string | null = null;

  function remember(step: WizardStep): void {
    if (tourUrl === null || stepStore === undefined) return;
    try {
      stepStore.setItem(wizardStepKey(tourUrl), step);
    } catch {
      // A private window or blocked site data: the setup still works.
    }
  }

  function remembered(url: string): WizardStep | null {
    if (stepStore === undefined) return null;
    try {
      return parseWizardStep(stepStore.getItem(wizardStepKey(url)));
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
    for (const name of WIZARD_STEPS) {
      const node = dom.steps[name];
      if (node !== undefined) node.open = name === step;
    }
    remember(step);
    if (step === "measure") {
      // Nothing opens for step 4 (the AR section is always rendered), so
      // the page would only get shorter - bring the section into view.
      dom.measureSection?.scrollIntoView({ block: "start" });
    }
  }

  if (mode === "creator") openStep("host");
  dom.visitorLink.hidden = true;

  // One step open at a time also when the creator opens one BY HAND: a
  // second summary tap closes the others.
  for (const name of WIZARD_STEPS) {
    const node = dom.steps[name];
    node?.addEventListener?.("toggle", () => {
      if (node.open) openStep(name);
    });
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
    presentTour: (url) => {
      dom.visitorLink.href = visitorLaunchHref(url);
      dom.visitorLink.hidden = false;
      tourUrl = url;
      // Land where the creator got to with this tour (a reload after the
      // AR session, a return from the print dialog); step 2 for a new one.
      if (mode === "creator") openStep(remembered(url) ?? "print");
    },
    presentLaunchUrl: (launchUrl) => {
      const href = launchHrefFromPrintedUrl(launchUrl);
      if (href === null) return;
      dom.visitorLink.href = href;
      dom.visitorLink.hidden = false;
    },
  };
}

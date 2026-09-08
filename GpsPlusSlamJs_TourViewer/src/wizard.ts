/**
 * The creator's guided setup (guided-setup plan §2.7): the steps as
 * collapsible sections, one open at a time, advanced by the events of the
 * flow - a tour opened (→ print), the code hung (→ measure), the zip
 * rebuilt (→ finish, then replace). Also owns the two step-1/step-2
 * controls that have no other home: the starter zip download for a creator
 * without a recording, and the "open as a visitor" link that is the
 * tester's way into the visitor path (DEC-N1, plan review #13).
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

/** A collapsible step (`<details>`), structurally. */
interface StepNode {
  open: boolean;
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
}

interface ClickableNode {
  addEventListener(type: "click", listener: () => void): void;
}
type ButtonNode = ClickableNode &
  Pick<HTMLButtonElement, "disabled" | "textContent">;
type LinkNode = Pick<HTMLAnchorElement, "href" | "hidden">;

export interface Wizard {
  /** Open one step, collapse the others. */
  openStep(step: WizardStep): void;
  /** A tour opened: the launch link becomes usable and the print step opens. */
  presentTour(url: string): void;
}

/** The launch link for `url`, relative to the page (the landing's `?qr=`
 *  forward is not needed when the viewer itself is the origin). */
export function visitorLaunchHref(url: string): string {
  return `?qr=${encodeURIComponent(url)}`;
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
}): Wizard {
  const { mode, dom, packStarter, download } = deps;
  const schedule = deps.setTimeout ?? setTimeout;

  function openStep(step: WizardStep): void {
    for (const name of WIZARD_STEPS) {
      const node = dom.steps[name];
      if (node !== undefined) node.open = name === step;
    }
  }

  if (mode === "creator") openStep("host");
  dom.visitorLink.hidden = true;

  dom.hangDone.addEventListener("click", () => {
    openStep("measure");
  });

  dom.starterButton.addEventListener("click", () => {
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
        schedule(() => {
          dom.starterButton.textContent = STARTER_LABELS.idle;
        }, 3000);
      });
  });

  return {
    openStep,
    presentTour: (url) => {
      dom.visitorLink.href = visitorLaunchHref(url);
      dom.visitorLink.hidden = false;
      if (mode === "creator") openStep("print");
    },
  };
}

/**
 * The non-immersive screens of viewing mode (plan VC2, VC3, VC15).
 *
 * Plain DOM builders, no store and no framework imports — the sequencing
 * lives in `viewing-app.ts`. Each returns a handle with `destroy()`, the same
 * mount/destroy discipline every component view already uses.
 *
 * Every screen is a child of the AR container (the element handed to
 * `initAR`), because under WebXR DOM Overlay only that element's subtree is
 * composited over the camera feed — a sibling would vanish the moment the
 * session starts (framework `webxr-session.ts.md`, "DOM-Overlay / HUD
 * stacking invariant").
 */

export interface Screen {
  destroy(): void;
}

function panel(testId: string): HTMLElement {
  const element = document.createElement("section");
  element.className = "panel";
  element.dataset.testid = testId;
  return element;
}

function heading(text: string): HTMLElement {
  const node = document.createElement("h2");
  node.textContent = text;
  return node;
}

function paragraph(text: string, className?: string): HTMLElement {
  const node = document.createElement("p");
  node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

export function mountLoadingScreen(root: HTMLElement, message: string): Screen {
  const element = panel("viewing-loading");
  element.append(heading("Opening tour…"), paragraph(message, "status-banner"));
  root.appendChild(element);
  return {
    destroy() {
      element.remove();
    },
  };
}

export interface ErrorScreenOptions {
  readonly title: string;
  readonly detail: string;
  /** Omitted for failures no retry can fix (e.g. a damaged tour file). */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

export function mountErrorScreen(
  root: HTMLElement,
  options: ErrorScreenOptions,
): Screen {
  const element = panel("viewing-error");
  element.append(
    heading(options.title),
    paragraph(options.detail, "error-banner"),
  );
  if (options.onRetry) {
    const retry = document.createElement("button");
    retry.textContent = options.retryLabel ?? "Try again";
    retry.dataset.testid = "viewing-retry";
    retry.addEventListener("click", () => options.onRetry?.());
    element.appendChild(retry);
  }
  root.appendChild(element);
  return {
    destroy() {
      element.remove();
    },
  };
}

export interface TourEntryScreenOptions {
  readonly tourName: string;
  readonly tourDescription: string;
  readonly waypointCount: number;
  readonly visitedCount: number;
  readonly onEnterAr: () => void;
  readonly onRestartTour: () => void;
  /** Walk the tour in the desktop preview instead of in AR. */
  readonly onEnterPreview: () => void;
  /** Where the 2D map (component 7) is mounted — kept across screens. */
  readonly mapHost: HTMLElement;
}

export interface TourEntryScreen extends Screen {
  /** AR availability / permission feedback, in place, without remounting. */
  setArStatus(message: string, tone: "info" | "error"): void;
  setEnterArEnabled(enabled: boolean): void;
  /** Remove Enter AR altogether (the visitor is too far away for it to work);
   *  the preview button then becomes the primary action. */
  setEnterArVisible(visible: boolean): void;
  setEnterArLabel(label: string): void;
  /** Show/hide the desktop-preview entry (plan VC25). */
  setPreviewOffered(offered: boolean): void;
  /** Shown once the background cache warm has finished (plan VC11). */
  markOfflineReady(): void;
}

export function mountTourEntryScreen(
  root: HTMLElement,
  options: TourEntryScreenOptions,
): TourEntryScreen {
  const element = panel("viewing-entry");

  const title = heading(options.tourName);
  // An empty description is valid; skip the row rather than render a blank one.
  const description =
    options.tourDescription === ""
      ? undefined
      : paragraph(options.tourDescription);
  const summary = paragraph(
    options.visitedCount > 0
      ? `${options.waypointCount} stops · ${options.visitedCount} already visited`
      : `${options.waypointCount} stops`,
    "tour-summary",
  );
  summary.dataset.testid = "viewing-tour-summary";

  // Name and stop count share one row so the count doesn't cost a line of
  // its own.
  const titleRow = document.createElement("div");
  titleRow.className = "tour-title-row";
  titleRow.append(title, summary);

  const offline = paragraph("", "success-banner");
  offline.dataset.testid = "viewing-offline-ready";
  offline.hidden = true;

  const enterAr = document.createElement("button");
  enterAr.className = "primary";
  enterAr.textContent = "Enter AR";
  enterAr.dataset.testid = "viewing-enter-ar";
  enterAr.addEventListener("click", () => options.onEnterAr());

  const status = paragraph("", "status-banner");
  status.dataset.testid = "viewing-ar-status";
  status.hidden = true;

  // Kept out of the DOM until offered, so a phone that can run AR never shows
  // a second, weaker way in.
  const preview = document.createElement("button");
  preview.className = "secondary";
  preview.textContent = "Preview here";
  preview.dataset.testid = "viewing-enter-preview";
  preview.addEventListener("click", () => options.onEnterPreview());

  const restart = document.createElement("button");
  restart.textContent = "Restart tour";
  restart.dataset.testid = "viewing-restart";
  restart.hidden = options.visitedCount === 0;
  restart.addEventListener("click", () => options.onRestartTour());

  element.append(
    titleRow,
    ...(description === undefined ? [] : [description]),
    options.mapHost,
    enterAr,
    status,
    offline,
    restart,
  );
  root.appendChild(element);

  return {
    setArStatus(message, tone) {
      status.hidden = message === "";
      status.textContent = message;
      status.className = tone === "error" ? "error-banner" : "status-banner";
    },
    setEnterArEnabled(enabled) {
      enterAr.disabled = !enabled;
    },
    setEnterArVisible(visible) {
      enterAr.hidden = !visible;
      preview.className = visible ? "secondary" : "primary";
    },
    setEnterArLabel(label) {
      enterAr.textContent = label;
    },
    setPreviewOffered(offered) {
      if (offered) {
        if (preview.parentElement === null) status.after(preview);
      } else {
        preview.remove();
      }
    },
    markOfflineReady() {
      offline.hidden = false;
      offline.textContent = "Offline-ready — the whole tour is on this device.";
    },
    destroy() {
      // The map host is owned by the caller and outlives this screen.
      if (options.mapHost.parentElement === element) {
        options.mapHost.remove();
      }
      element.remove();
    },
  };
}

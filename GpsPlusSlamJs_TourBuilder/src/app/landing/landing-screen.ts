/**
 * Root-URL entry screen (Goal-2 composition). Mounted by `main.ts` whenever
 * `resolveAppMode` resolves to Authoring (no `?tour=`, contract D13) — the
 * moment before that decision used to jump straight into the onboarding
 * gate. Offers the ways a cold visit to the bare URL can continue:
 *
 * - **Create your own tour** — the primary action, since the only reason to
 *   land on the bare root URL is to author (a real tour visitor almost
 *   always arrives already carrying `?tour=` from a shared link/QR and
 *   never sees this screen at all) — swaps into the existing
 *   `mountAuthoringApp` flow (onboarding gate → tools → export).
 * - **Try the demo tour** and **I have a tour link** — one "open an existing
 *   tour" card, two rows. The demo row navigates. The link row is the
 *   fallback for a `?tour=` link that reached the visitor as plain,
 *   unclickable text (a screenshot, a printed sign) instead of a live
 *   hyperlink/QR: paste it and go. Reuses
 *   `prepareHostedZipUrl`/`buildTourUrl`, the exact pair the share panel
 *   used to build that same link (`pack-and-share-panel.ts`).
 */
import { mountAuthoringApp } from "../authoring/authoring-app.js";
import { swapScreen } from "../screen-transition.js";
import { buildTourUrl } from "../../components/packaging/core/build-tour-url.js";
import { prepareHostedZipUrl } from "../../components/shared/hosted-zip-url.js";
import { buildLabeledField } from "../../components/shared/labeled-field.js";
import { ICONS } from "../../components/shared/icons.js";

/**
 * A real, publicly-shared tour, offered so a visitor who lands on the root
 * URL can see a finished tour instead of only the authoring tool. Hosted on
 * the tour creator's own OneDrive share, not this repo.
 */
const DEMO_TOUR_URL =
  "https://my.microsoftpersonalcontent.com/personal/339942fd8b9cbd18/_layouts/15/download.aspx?share=IQCA5LWk0FVsQI4yCdiTHSqBAexdK1msWdmNSotvGQ1QmRw";

export interface LandingScreenDeps {
  /** Follows a computed viewing-mode URL. Defaults to a real page navigation
   *  (`location.href = url`); injectable so tests can observe the computed
   *  URL instead of navigating jsdom. */
  readonly navigate?: (url: string) => void;
}

/** Mounts the landing screen into `root`. */
export function mountLandingScreen(
  root: HTMLElement,
  deps: LandingScreenDeps = {},
): { destroy(): void } {
  const navigate = deps.navigate ?? ((url: string) => (location.href = url));
  const host = document.createElement("div");
  host.className = "landing";
  root.appendChild(host);

  const heading = document.createElement("h1");
  heading.className = "landing-title";
  heading.textContent = "TourBuilder";
  const tagline = document.createElement("p");
  tagline.className = "landing-tagline";
  tagline.textContent =
    "Make location-based tours that support audio, text and visuals or open an existing tour.";
  host.append(heading, tagline);

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "primary landing-action";
  createButton.dataset["testid"] = "landing-create-tour";
  createButton.innerHTML = `${ICONS.route}<span><strong>Create your own tour</strong><small>Walk to a spot you want and drop a waypoint</small></span>`;
  host.append(createButton);

  // ── "Open a tour" — one card holding both ways to open an existing tour:
  // the demo row (navigates) and the link row (expands in place to reveal the
  // paste field) ──
  const linkSection = document.createElement("div");
  linkSection.className = "landing-link-section";

  const linkButton = document.createElement("button");
  linkButton.type = "button";
  linkButton.className = "landing-action";
  linkButton.dataset["testid"] = "landing-open-link-form";
  linkButton.innerHTML = `${ICONS.link}<span><strong>I have a tour link</strong><small>Paste a share link someone sent you</small></span><span class="landing-action-chevron">${ICONS.chevron}</span>`;
  linkButton.setAttribute("aria-expanded", "false");
  linkButton.setAttribute("aria-controls", "landing-link-body");

  // The body animates its grid row from 0fr to 1fr (exact content height,
  // unlike a `max-height` guess; `hidden` can't transition at all), and
  // `inert` keeps the collapsed field/button out of the tab order.
  const linkBody = document.createElement("div");
  linkBody.className = "landing-link-body";
  linkBody.id = "landing-link-body";
  linkBody.inert = true;
  const linkForm = document.createElement("div");
  linkForm.className = "landing-link-form";
  const linkClip = document.createElement("div");
  linkClip.className = "landing-link-clip";
  linkClip.append(linkForm);
  linkBody.append(linkClip);

  const linkInput = document.createElement("input");
  linkInput.type = "url";
  linkInput.autocomplete = "off";
  linkInput.setAttribute("enterkeyhint", "go");
  linkInput.dataset["testid"] = "landing-tour-link";
  linkInput.placeholder = "Paste the tour link";
  const linkField = buildLabeledField(
    "OneDrive / Dropbox link",
    linkInput,
    "landing-tour-link",
  );

  const goButton = document.createElement("button");
  goButton.type = "submit";
  goButton.className = "primary";
  goButton.dataset["testid"] = "landing-go";
  goButton.textContent = "Open";

  const linkStatus = document.createElement("p");
  linkStatus.dataset["testid"] = "landing-link-status";
  // A <form> so Enter / the phone keyboard's Go key submits. `noValidate`:
  // keep our own inline error instead of the browser's `type="url"` bubble.
  const linkRow = document.createElement("form");
  linkRow.className = "landing-link-row";
  linkRow.noValidate = true;
  linkRow.append(linkField, goButton);
  linkForm.append(linkRow, linkStatus);

  const demoLink = document.createElement("a");
  demoLink.className = "landing-action";
  demoLink.dataset["testid"] = "view-demo-tour";
  demoLink.href = `${location.pathname}?tour=${encodeURIComponent(DEMO_TOUR_URL)}`;
  demoLink.innerHTML = `${ICONS.pin}<span><strong>Try the demo tour</strong><small>See a finished tour, no setup needed</small></span><span class="landing-action-chevron">${ICONS.chevron}</span>`;

  linkSection.append(demoLink, linkButton, linkBody);
  host.append(linkSection);

  linkButton.addEventListener("click", () => {
    const open = !linkSection.classList.contains("landing-link-section-open");
    linkSection.classList.toggle("landing-link-section-open", open);
    linkButton.setAttribute("aria-expanded", String(open));
    linkBody.inert = !open;
    if (open) linkInput.focus({ preventScroll: true });
  });

  linkRow.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = linkInput.value.trim();
    linkStatus.textContent = "";
    linkStatus.dataset["state"] = "";
    linkField.classList.remove("field-error");

    // Already a full share link (has its own `?tour=`) — follow it as-is
    // rather than double-wrapping it in another `?tour=`.
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      linkStatus.textContent = "That doesn't look like a link.";
      linkStatus.dataset["state"] = "error";
      linkField.classList.add("field-error");
      return;
    }
    if (target.searchParams.has("tour")) {
      navigate(target.toString());
      return;
    }

    // Otherwise treat it as a raw hosted tour.zip URL, same as pasted into
    // the author's own share panel.
    const prepared = prepareHostedZipUrl(raw, import.meta.env.DEV);
    try {
      navigate(
        buildTourUrl(`${location.origin}${location.pathname}`, prepared.url),
      );
    } catch {
      linkStatus.textContent = "That doesn't look like a link.";
      linkStatus.dataset["state"] = "error";
      linkField.classList.add("field-error");
    }
  });

  // Dev/instructor escape hatch, not a visitor path — shown only in dev or
  // with `?dev` on the deployed build: the component gallery
  // that lists every component's own standalone demo (billboard, proximity,
  // map, …). Kept visually quiet — a plain link, not a third action button
  // — so it never competes with the two real entry points above.
  //
  // The gallery moves between dev and the deployed GitHub Pages build, so
  // this can't be one static relative href: in dev, Vite serves this screen
  // nested under `/src/app/` and the gallery sits two levels up at the
  // served root (`index.html`). The Pages workflow promotes the composed
  // app's own `index.html` to the site root and relocates the gallery to
  // `/gallery/` (`.github/workflows/deploy-tourbuilder-pages.yml`) — from
  // that root, `../../index.html` clamps back to the app itself instead of
  // reaching the gallery.
  const componentsLink = document.createElement("a");
  componentsLink.className = "landing-dev-link";
  componentsLink.dataset["testid"] = "landing-view-components";
  componentsLink.href = import.meta.env.DEV ? "../../index.html" : "/gallery/";
  componentsLink.textContent = "View separate components";
  if (import.meta.env.DEV || new URLSearchParams(location.search).has("dev")) {
    host.append(componentsLink);
  }

  createButton.addEventListener("click", () => {
    swapScreen(host, () => {
      mountAuthoringApp(root);
    });
  });

  return {
    destroy() {
      host.remove();
    },
  };
}

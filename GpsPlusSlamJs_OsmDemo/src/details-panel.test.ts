/**
 * @vitest-environment jsdom
 *
 * The details panel's FEATURE mode (W12).
 *
 * WHY THIS TEST EXISTS AT ALL, given the panel had none. Cell mode is driven by
 * `explanationTree`, which is thoroughly tested on its own, so the panel was a
 * thin renderer over a well-covered model. Feature mode has no such model — it is
 * three strings and a link — so the panel is the only place its behaviour lives.
 *
 * The link is the part with a scar. The demo's provenance links shipped inside a
 * Leaflet tooltip, which is non-interactive by default, so the advertised core
 * debugging affordance had never been clickable — under a green e2e that asserted
 * the link's presence. Asserting an element exists is not asserting it works, so
 * the href is checked for what it actually points at.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DetailsPanel } from "./details-panel.js";

const MARKER = {
  feature: "node/4242",
  kind: "amenity=cafe",
  label: "Café Schmitz",
};

function panelIn(): {
  panel: DetailsPanel;
  container: HTMLElement;
  onClose: () => void;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const onClose = vi.fn();
  return {
    panel: new DetailsPanel({ container, onClose }),
    container,
    onClose,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("DetailsPanel.renderFeature", () => {
  it("shows the label and the kind, and becomes visible", () => {
    const { panel, container } = panelIn();
    panel.renderFeature(MARKER);

    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain("Café Schmitz");
    expect(container.textContent).toContain("amenity=cafe");
  });

  it("links to the element on openstreetmap.org", () => {
    // The whole point of the demo: any surprising thing on screen can be traced
    // to a real object in one click. `node/4242` is already the path form
    // openstreetmap.org expects, so it appends directly.
    const { panel, container } = panelIn();
    panel.renderFeature(MARKER);

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "https://www.openstreetmap.org/node/4242",
    );
    // `target=_blank` without `rel=noreferrer` hands the opened page a handle to
    // this one via `window.opener`.
    expect(link?.getAttribute("rel")).toBe("noreferrer");
  });

  it("closes through the same callback cell mode uses", () => {
    // One panel, one close button, one way out. A second close path is a second
    // thing that can be left wired to the wrong action.
    const { panel, container, onClose } = panelIn();
    panel.renderFeature(MARKER);

    container.querySelector<HTMLButtonElement>(".panel-close")?.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("replaces cell content rather than appending to it", () => {
    // The two modes share one container, so rendering one after the other must
    // not leave the previous mode's nodes behind — a panel showing a cell
    // explanation under a POI heading is a confidently wrong answer.
    const { panel, container } = panelIn();
    panel.renderFeature(MARKER);
    panel.renderFeature({ ...MARKER, label: "Bäckerei", feature: "node/7" });

    expect(container.textContent).toContain("Bäckerei");
    expect(container.textContent).not.toContain("Café Schmitz");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("escapes a label rather than letting it become markup", () => {
    // Tag values are untrusted: anyone can edit OSM. `textContent` is what makes
    // this safe, and the assertion is here so a later "improvement" to
    // `innerHTML` fails loudly.
    const { panel, container } = panelIn();
    panel.renderFeature({ ...MARKER, label: "<img src=x onerror=alert(1)>" });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("clear() hides it again", () => {
    const { panel, container } = panelIn();
    panel.renderFeature(MARKER);
    panel.clear();

    expect(container.hidden).toBe(true);
    expect(container.textContent).toBe("");
  });
});

describe("DetailsPanel.renderUnavailable", () => {
  /**
   * WHY THESE TESTS MATTER. This mode exists because the alternative — hiding
   * the panel — is the exact silence DEC-7 reveals sub-threshold cells to
   * remove: indistinguishable from a click that missed. So "it is VISIBLE and it
   * names the cell" is the whole contract, and it is easy to lose by reusing
   * `clear()` for a case that merely looks similar from the caller's side.
   */
  it("stays visible and names the cell it cannot explain", () => {
    const { panel, container } = panelIn();
    panel.renderUnavailable("87283472bffffff");

    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain("87283472bffffff");
  });

  it("replaces a previous answer rather than appending to it", () => {
    // The same rule every other mode follows. A "no explanation" note left
    // underneath the previous cell's argument is two contradictory answers to
    // one question, which is worse than either alone.
    const { panel, container } = panelIn();
    panel.renderFeature(MARKER);
    panel.renderUnavailable("87283472bffffff");

    expect(container.textContent).not.toContain(MARKER.label);
    expect(container.querySelectorAll(".panel-header")).toHaveLength(1);
  });

  it("closes through the same callback the other modes use", () => {
    // One dismissal path, or the panel becomes undismissable in one mode — and
    // this is the mode a user is most likely to want gone.
    const { panel, container, onClose } = panelIn();
    panel.renderUnavailable("87283472bffffff");
    container.querySelector<HTMLButtonElement>(".panel-close")?.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("escapes a cell id rather than letting it become markup", () => {
    // The id reaches here from the worker; treated as data like every other
    // string in this file.
    const { panel, container } = panelIn();
    panel.renderUnavailable("<img src=x onerror=alert(1)>");

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

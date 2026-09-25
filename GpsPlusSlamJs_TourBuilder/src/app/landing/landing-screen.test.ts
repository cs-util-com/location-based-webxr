/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("gps-plus-slam-app-framework/sensors", () => ({
  checkCameraPermission: () =>
    Promise.resolve({ supported: true, granted: null }),
  checkGeolocationPermission: () =>
    Promise.resolve({ supported: true, granted: null }),
  requestCameraPermission: () =>
    Promise.resolve({ supported: true, granted: true }),
  requestGeolocationPermission: () =>
    Promise.resolve({ supported: true, granted: true }),
  startGpsWatch: () => undefined,
  stopGpsWatch: () => undefined,
}));

import { mountLandingScreen } from "./landing-screen.js";

function setup(navigate = vi.fn()) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const screen = mountLandingScreen(root, { navigate });
  return { root, screen, navigate };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mountLandingScreen", () => {
  it("titles the page with the app name and a tagline", () => {
    const { root } = setup();
    expect(root.querySelector("h1")!.textContent).toBe("TourBuilder");
    expect(root.querySelector(".landing-tagline")!.textContent).not.toBe("");
  });

  it("groups the demo link and the link toggle in one card", () => {
    const { root } = setup();
    const card = root.querySelector(".landing-link-section")!;
    expect(card.querySelector('[data-testid="view-demo-tour"]')).not.toBeNull();
    expect(
      card.querySelector('[data-testid="landing-open-link-form"]'),
    ).not.toBeNull();
  });

  it("renders the create-tour action, the link form (collapsed), the demo chip, and the components link", () => {
    const { root } = setup();

    expect(
      root.querySelector('[data-testid="landing-create-tour"]'),
    ).not.toBeNull();

    const linkBody = root.querySelector<HTMLElement>(".landing-link-body")!;
    expect(linkBody.inert).toBe(true);

    const demoLink = root.querySelector<HTMLAnchorElement>(
      '[data-testid="view-demo-tour"]',
    )!;
    expect(new URL(demoLink.href).searchParams.get("tour")).toMatch(
      /^https:\/\/my\.microsoftpersonalcontent\.com\//,
    );

    const componentsLink = root.querySelector<HTMLAnchorElement>(
      '[data-testid="landing-view-components"]',
    )!;
    expect(componentsLink.getAttribute("href")).toBe("../../index.html");
  });

  it("reveals the paste-link form only after its own toggle is clicked", () => {
    const { root } = setup();
    const linkBody = root.querySelector<HTMLElement>(".landing-link-body")!;
    const toggle = root.querySelector<HTMLButtonElement>(
      '[data-testid="landing-open-link-form"]',
    )!;

    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="landing-open-link-form"]',
      )!
      .click();
    expect(linkBody.inert).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="landing-open-link-form"]',
      )!
      .click();
    expect(linkBody.inert).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("follows a pasted full share link (its own `?tour=`) unchanged", () => {
    const { root, navigate } = setup();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="landing-open-link-form"]',
      )!
      .click();

    const input = root.querySelector<HTMLInputElement>(
      '[data-testid="landing-tour-link"]',
    )!;
    input.value = "https://example.com/app/?tour=https%3A%2F%2Fhost%2Ftour.zip";
    root
      .querySelector<HTMLButtonElement>('[data-testid="landing-go"]')!
      .click();

    expect(navigate).toHaveBeenCalledWith(
      "https://example.com/app/?tour=https%3A%2F%2Fhost%2Ftour.zip",
    );
  });

  it("submits the pasted link on Enter (form submit), not only on a button click", () => {
    const { root, navigate } = setup();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="landing-open-link-form"]',
      )!
      .click();
    const input = root.querySelector<HTMLInputElement>(
      '[data-testid="landing-tour-link"]',
    )!;
    input.value = "https://example.com/app/?tour=https%3A%2F%2Fhost%2Ft.zip";

    input.form!.requestSubmit();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(input.getAttribute("enterkeyhint")).toBe("go");
    expect(root.querySelector('[data-testid="landing-go"]')!.textContent).toBe(
      "Open",
    );
  });

  it("wraps a pasted raw hosted-zip URL into a `?tour=` link, same as the author's share panel", () => {
    const { root, navigate } = setup();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="landing-open-link-form"]',
      )!
      .click();

    const input = root.querySelector<HTMLInputElement>(
      '[data-testid="landing-tour-link"]',
    )!;
    input.value = "https://example.com/tour.zip";
    root
      .querySelector<HTMLButtonElement>('[data-testid="landing-go"]')!
      .click();

    expect(navigate).toHaveBeenCalledTimes(1);
    const url = new URL(navigate.mock.calls[0]![0] as string);
    expect(url.searchParams.get("tour")).toBe("https://example.com/tour.zip");
  });

  it("rejects unparsable input without navigating", () => {
    const { root, navigate } = setup();
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="landing-open-link-form"]',
      )!
      .click();

    const input = root.querySelector<HTMLInputElement>(
      '[data-testid="landing-tour-link"]',
    )!;
    input.value = "not a url";
    root
      .querySelector<HTMLButtonElement>('[data-testid="landing-go"]')!
      .click();

    expect(navigate).not.toHaveBeenCalled();
    const status = root.querySelector<HTMLElement>(
      '[data-testid="landing-link-status"]',
    )!;
    expect(status.dataset["state"]).toBe("error");
  });

  it("swaps into the real authoring flow when Create your own tour is clicked", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        state: "suspended" | "running" = "suspended";
        resume() {
          this.state = "running";
          return Promise.resolve();
        }
      },
    );
    const { root } = setup();

    root
      .querySelector<HTMLButtonElement>('[data-testid="landing-create-tour"]')!
      .click();

    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid="grant-access"]')).not.toBeNull();
    });
    expect(
      root.querySelector('[data-testid="landing-create-tour"]'),
    ).toBeNull();
  });
});

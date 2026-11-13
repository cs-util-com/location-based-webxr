// @vitest-environment jsdom
/**
 * Why these tests matter: the slider is how a lined-up visitor takes the
 * blend over. It must be found by role, start where the fade-in is, tell
 * the part every move, never move the thumb under the visitor's finger,
 * and leave nothing behind.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildThenNowSlider, firstSentence } from "./then-now-slider.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildThenNowSlider", () => {
  it("shows the year, the first sentence and the share, and hears moves", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const changed = vi.fn();
    const slider = buildThenNowSlider(
      host,
      { year: "1902", caption: "Market day. The stalls are gone." },
      0.55,
      changed,
    );
    const group = host.querySelector("[role=group]");
    expect(group?.getAttribute("aria-label")).toBe("Then and now");
    expect(group?.textContent).toContain("1902");
    expect(group?.textContent).toContain("Market day.");
    expect(group?.textContent).not.toContain("stalls");
    const input = host.querySelector<HTMLInputElement>("input[type=range]");
    expect(input?.value).toBe("55");
    if (input === null) throw new Error("no slider");
    input.value = "80";
    input.dispatchEvent(new Event("input"));
    expect(changed).toHaveBeenCalledWith(0.8);
    slider.set(0.2);
    expect(input.value).toBe("20");
    slider.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("does not move the thumb under the visitor's finger", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const slider = buildThenNowSlider(host, {}, 0.3, () => undefined);
    const input = host.querySelector<HTMLInputElement>("input[type=range]");
    input?.focus();
    slider.set(0.9);
    expect(input?.value).toBe("30");
  });

  it("clamps a share outside 0 to 1 and reads a broken one as today", () => {
    const host = document.createElement("div");
    const slider = buildThenNowSlider(host, {}, 4, () => undefined);
    const input = host.querySelector<HTMLInputElement>("input[type=range]");
    expect(input?.value).toBe("100");
    slider.set(Number.NaN);
    expect(input?.value).toBe("0");
  });
});

describe("firstSentence", () => {
  it("keeps the first sentence and cuts a long one at a word", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence(undefined)).toBe("");
    const long = firstSentence("word ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(110);
    expect(long.endsWith("…")).toBe(true);
  });
});

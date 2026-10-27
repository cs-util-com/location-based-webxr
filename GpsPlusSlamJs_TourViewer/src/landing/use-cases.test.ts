import { describe, expect, it } from "vitest";

import { USE_CASES } from "./use-case-data.js";
import { mountUseCases } from "./use-cases.js";

/** The two members of an element the mount touches; no DOM in node. */
function fakeHost() {
  const host = {
    innerHTML: "<p>placeholder</p>",
    cleared: 0,
    replaceChildren() {
      host.innerHTML = "";
      host.cleared += 1;
    },
  };
  return host;
}

describe("mountUseCases", () => {
  // Why: the page's mount point holds a placeholder until the section's
  // chunk arrives; mounting replaces it with the whole section.
  it("replaces the host's content with the section", () => {
    const host = fakeHost();
    mountUseCases(host as unknown as HTMLElement);
    expect(host.innerHTML).toMatch(/^<section class="uc"/);
    expect(host.innerHTML).not.toContain("placeholder");
    expect(host.innerHTML).toContain(USE_CASES[0]?.title);
  });

  // Why: destroy is called by the page when it tears the landing down, and
  // may be called twice; the second call must be harmless.
  it("empties the host on destroy, once", () => {
    const host = fakeHost();
    const mounted = mountUseCases(host as unknown as HTMLElement);
    mounted.destroy();
    mounted.destroy();
    expect(host.innerHTML).toBe("");
    expect(host.cleared).toBe(1);
  });

  it("refuses a missing host", () => {
    expect(() => mountUseCases(null as unknown as HTMLElement)).toThrow(
      TypeError,
    );
  });
});

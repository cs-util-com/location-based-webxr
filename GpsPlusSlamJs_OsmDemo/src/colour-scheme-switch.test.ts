/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import {
  AR_REASON,
  attachColourSchemeSwitch,
  type ColourSchemeSwitch,
} from "./colour-scheme-switch.js";
import {
  COLOUR_SCHEME_NAMES,
  colourSchemeBuildFailure,
  type ColourSchemeName,
} from "./colour-schemes.js";

/**
 * A second scheme to switch to. S4 ships the table with "today" only, so the
 * tests add an option the table does not know through a cast where they need
 * a switch; once the table has more (S5) they use its second entry.
 */
function setup(): {
  select: HTMLSelectElement;
  status: HTMLElement;
  choose: ReturnType<typeof vi.fn>;
  control: ColourSchemeSwitch;
  other: ColourSchemeName | undefined;
} {
  document.body.innerHTML =
    '<select id="s"></select><span id="t" role="status"></span>';
  const select = document.getElementById("s") as HTMLSelectElement;
  const status = document.getElementById("t") as HTMLElement;
  const choose = vi.fn();
  const control = attachColourSchemeSwitch({
    select,
    status,
    initial: "today",
    choose,
  });
  return { select, status, choose, control, other: COLOUR_SCHEME_NAMES[1] };
}

function pick(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

describe("attachColourSchemeSwitch", () => {
  it("lists every scheme by its label and shows the initial one", () => {
    // Why this test matters: the dropdown is the owner's comparison tool
    // (D5); a scheme missing from it cannot be rated.
    const { select, status } = setup();
    expect([...select.options].map((o) => o.value)).toEqual([
      ...COLOUR_SCHEME_NAMES,
    ]);
    expect(select.options[0]?.textContent).toBe("Today");
    expect(select.value).toBe("today");
    expect(select.disabled).toBe(false);
    expect(status.textContent).toBe("");
  });

  it("ignores a value outside the table and re-picking the chosen scheme", () => {
    // Why this test matters: only the table's names may reach the store;
    // a tampered option must not start a switch that can never finish.
    const { select, choose } = setup();
    const rogue = document.createElement("option");
    rogue.value = "neon";
    select.append(rogue);
    pick(select, "neon");
    pick(select, "today");
    expect(choose).not.toHaveBeenCalled();
    expect(select.value).toBe("today");
  });
});

describe("a switch (needs a second scheme)", () => {
  it.runIf(COLOUR_SCHEME_NAMES.length > 1)(
    "is in progress until a mesh BUILT in the chosen scheme is drawn",
    () => {
      // Why this test matters: the root CLAUDE.md asks the final state to
      // reflect the durable end state; a full mesh from a pass still in
      // flight with the old scheme must not end the switch (plan 4.4).
      const { select, status, choose, control, other } = setup();
      const name = other as ColourSchemeName;
      pick(select, name);
      expect(choose).toHaveBeenCalledWith(name);
      expect(select.disabled).toBe(true);
      expect(status.textContent).toMatch(/^Applying .+\.\.\.$/);
      control.meshDrawn("today");
      expect(select.disabled).toBe(true);
      expect(control.pending()).toBe(name);
      control.meshDrawn(name);
      expect(select.disabled).toBe(false);
      expect(status.textContent).toBe("");
      expect(control.pending()).toBeUndefined();
    },
  );

  it.runIf(COLOUR_SCHEME_NAMES.length > 1)(
    "reverts only when the chosen scheme's own build failed",
    () => {
      // Why this test matters: an Overpass error or another scheme's failure
      // says nothing about this choice and must leave it (plan 4.4); its own
      // failure returns the select and the store to what is drawn.
      const { select, choose, control, other } = setup();
      const name = other as ColourSchemeName;
      pick(select, name);
      control.failed("Overpass answered 429");
      control.failed(colourSchemeBuildFailure("today", "boom"));
      expect(control.pending()).toBe(name);
      control.failed(colourSchemeBuildFailure(name, "boom"));
      expect(control.pending()).toBeUndefined();
      expect(select.value).toBe("today");
      expect(select.disabled).toBe(false);
      expect(choose).toHaveBeenLastCalledWith("today");
    },
  );

  it.runIf(COLOUR_SCHEME_NAMES.length > 1)(
    "drops the wait on AR entry, whose pass builds the default",
    () => {
      // Why this test matters: AR builds today's colours (D9), so the echo
      // would never come and the select would stay disabled after AR.
      const { select, status, control, other } = setup();
      pick(select, other as ColourSchemeName);
      control.setArActive(true);
      expect(control.pending()).toBeUndefined();
      expect(status.textContent).toBe("");
      control.setArActive(false);
      expect(select.disabled).toBe(false);
    },
  );
});

describe("AR", () => {
  it("disables the select with its reason, and restores it on exit", () => {
    // Why this test matters: D9; a select that looks live in AR would invite
    // a choice AR then ignores.
    const { select, control } = setup();
    control.setArActive(true);
    expect(select.disabled).toBe(true);
    expect(select.title).toBe(AR_REASON);
    control.setArActive(false);
    expect(select.disabled).toBe(false);
    expect(select.title).toBe("");
  });

  it("ignores failures while nothing is pending and keeps the store's choice shown", () => {
    // Why this test matters: an ordinary build error must not dispatch a
    // scheme change behind the user's back.
    const { select, choose, control } = setup();
    control.failed(colourSchemeBuildFailure("today", "boom"));
    control.meshDrawn("not-a-scheme");
    control.show("today");
    expect(choose).not.toHaveBeenCalled();
    expect(select.value).toBe("today");
  });
});

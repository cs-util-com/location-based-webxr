/**
 * The setup map sticker's size knob.
 *
 * Why these tests matter: the page ships one sticker size; `?mapSize=`
 * picks another so sizes can be compared on a phone without a build. The
 * knob must never show without the parameter (it is a developer's tool,
 * not part of the page), must ignore a value it does not know rather than
 * leave the sticker without a size, and a choice in it must survive a
 * reload (it rewrites the parameter) without touching the other ones.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAP_SIZE,
  MAP_SIZES,
  readMapSize,
  wireMapSize,
  withMapSize,
} from "./map-size.js";

describe("readMapSize", () => {
  it("is the page's size, with no knob, when the URL does not ask", () => {
    expect(readMapSize("")).toEqual({ size: DEFAULT_MAP_SIZE, knob: false });
    expect(readMapSize("?nocache=1&debug=1")).toEqual({
      size: DEFAULT_MAP_SIZE,
      knob: false,
    });
  });

  it("takes every known size, and shows the knob", () => {
    for (const size of MAP_SIZES) {
      expect(readMapSize(`?nocache=1&mapSize=${size}`)).toEqual({
        size,
        knob: true,
      });
    }
  });

  it("falls back to the page's size for an empty or unknown value, knob shown", () => {
    for (const value of ["", "huge", "L", "s ", "0"]) {
      expect(readMapSize(`?mapSize=${encodeURIComponent(value)}`)).toEqual({
        size: DEFAULT_MAP_SIZE,
        knob: true,
      });
    }
  });
});

describe("withMapSize", () => {
  it("rewrites only the size parameter, keeping the others in order", () => {
    expect(withMapSize("?nocache=1&mapSize=s&debug=1", "xl")).toBe(
      "?nocache=1&mapSize=xl&debug=1",
    );
    expect(withMapSize("", "m")).toBe("?mapSize=m");
  });
});

/** A structural select: what the knob reads and writes. */
function fakeDom() {
  const listeners: (() => void)[] = [];
  const select = {
    value: "",
    options: [] as { value: string; label: string }[],
    addEventListener: (_type: "change", fn: () => void) => {
      listeners.push(fn);
    },
  };
  const stage = { dataset: {} as Record<string, string | undefined> };
  const replaced: string[] = [];
  let mounted = 0;
  return {
    stage,
    select,
    replaced,
    mounted: () => mounted,
    change(value: string) {
      select.value = value;
      for (const fn of listeners) fn();
    },
    deps(search: string) {
      return {
        stage,
        search,
        mountKnob: (sizes: readonly string[], current: string) => {
          mounted += 1;
          select.options = sizes.map((value) => ({ value, label: value }));
          select.value = current;
          return select;
        },
        replaceSearch: (next: string) => {
          replaced.push(next);
        },
      };
    },
  };
}

describe("index.html", () => {
  // Why: the page's size is the CSS fallback, painted before any script
  // runs; the module's default must name that same size, and every size
  // the knob offers must have a rule, or picking it would change nothing.
  const html = readFileSync(
    fileURLToPath(new URL("../index.html", import.meta.url)),
    "utf8",
  );
  it("falls back to the default size, and defines every size", () => {
    expect(html).toContain(`--sticker: var(--sticker-${DEFAULT_MAP_SIZE});`);
    for (const size of MAP_SIZES) {
      expect(html).toContain(`--sticker-${size}: min(`);
      expect(html).toContain(`.setup-stage[data-map-size="${size}"]`);
    }
  });
});

describe("wireMapSize", () => {
  it("leaves the page's size to the CSS and mounts nothing without the parameter", () => {
    const dom = fakeDom();
    wireMapSize(dom.deps("?nocache=1"));
    expect(dom.stage.dataset.mapSize).toBeUndefined();
    expect(dom.mounted()).toBe(0);
  });

  it("sets the asked size on the stage and mounts the knob at it", () => {
    const dom = fakeDom();
    wireMapSize(dom.deps("?mapSize=s"));
    expect(dom.stage.dataset.mapSize).toBe("s");
    expect(dom.mounted()).toBe(1);
    expect(dom.select.value).toBe("s");
    expect(dom.select.options.map((o) => o.value)).toEqual([...MAP_SIZES]);
  });

  it("a choice resizes the sticker and is written into the URL", () => {
    const dom = fakeDom();
    wireMapSize(dom.deps("?nocache=1&mapSize=s"));
    dom.change("xl");
    expect(dom.stage.dataset.mapSize).toBe("xl");
    expect(dom.replaced).toEqual(["?nocache=1&mapSize=xl"]);
  });

  it("ignores a value that is not a size", () => {
    const dom = fakeDom();
    wireMapSize(dom.deps("?mapSize=m"));
    dom.change("giant");
    expect(dom.stage.dataset.mapSize).toBe("m");
    expect(dom.replaced).toEqual([]);
  });
});

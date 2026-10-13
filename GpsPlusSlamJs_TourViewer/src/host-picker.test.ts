/**
 * The host tiles of step 1 (polish round M2, A6/A7).
 *
 * Why these tests matter: the host is the context every later step reads,
 * so the tiles must store the choice, show that host's own steps, offer
 * the starter zip only where a host needs a file before it gives a link,
 * and hand over to step 2 with one tap. A stored choice must come back
 * selected after a reload; a store that throws must not break the tiles.
 */
import { describe, expect, it } from "vitest";

import { wireHostPicker } from "./host-picker.js";
import { TOUR_HOSTS, hostSteps, readTourHost } from "./tour-host.js";

/** A minimal element: the module creates tiles and list items through
 *  `createElement`, so the fake keeps the children it is given. */
class FakeNode {
  children: FakeNode[] = [];
  textContent = "";
  hidden = false;
  type = "";
  className = "";
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor(readonly tagName: string) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = nodes;
  }
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

/** A list item's words: its text runs and links in order. */
function textOf(node: FakeNode): string {
  return node.children.length === 0
    ? node.textContent
    : node.children.map(textOf).join("");
}

function memoryStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

function setup(store?: ReturnType<typeof memoryStore>) {
  const dom = {
    tiles: new FakeNode("div"),
    steps: new FakeNode("ol"),
    starter: new FakeNode("button"),
    continueButton: new FakeNode("button"),
  };
  dom.steps.hidden = true;
  dom.starter.hidden = true;
  dom.continueButton.hidden = true;
  const continued: string[] = [];
  wireHostPicker({
    dom,
    store,
    createElement: (tag) => new FakeNode(tag),
    onContinue: (host) => continued.push(host),
  });
  const tile = (id: string) => {
    const found = dom.tiles.children.find((t) => t.dataset.host === id);
    if (found === undefined) throw new Error(`no tile ${id}`);
    return found;
  };
  return { dom, continued, tile };
}

describe("wireHostPicker", () => {
  // PR #585 review: `role="radio"` promised arrow keys and one tab stop
  // the tiles never had, and a radio cannot be un-chosen - which a second
  // tap does (P6). Toggle buttons in a group say what they are.
  it("renders one toggle tile per host, in the module's order, none pressed on a first visit", () => {
    const { dom } = setup(memoryStore());
    expect(dom.tiles.children.map((t) => t.dataset.host)).toEqual(
      TOUR_HOSTS.map((h) => h.id),
    );
    expect(dom.tiles.children.map((t) => t.textContent)).toEqual(
      TOUR_HOSTS.map((h) => h.label),
    );
    for (const t of dom.tiles.children) {
      expect(t.getAttribute("role")).toBeNull();
      expect(t.getAttribute("aria-pressed")).toBe("false");
    }
    expect(dom.steps.hidden).toBe(true);
    expect(dom.starter.hidden).toBe(true);
    expect(dom.continueButton.hidden).toBe(true);
  });

  it("a tap stores the host, checks only that tile and lists its own steps", () => {
    const store = memoryStore();
    const { dom, tile } = setup(store);
    tile("dropbox").fire("click");
    expect(readTourHost(store)).toBe("dropbox");
    expect(
      dom.tiles.children.map((t) => t.getAttribute("aria-pressed")),
    ).toEqual(["false", "true", "false", "false", "false"]);
    expect(dom.steps.hidden).toBe(false);
    expect(dom.steps.children.map(textOf)).toEqual([...hostSteps("dropbox")]);
    expect(dom.continueButton.hidden).toBe(false);
  });

  it("offers the starter zip for a cloud host and not for an own server", () => {
    const { dom, tile } = setup(memoryStore());
    tile("drive").fire("click");
    expect(dom.starter.hidden).toBe(false);
    tile("own").fire("click");
    expect(dom.starter.hidden).toBe(true);
  });

  it("brings a stored choice back selected after a reload", () => {
    const store = memoryStore({ "tour-viewer.wizard.host": "github" });
    const { dom, tile } = setup(store);
    expect(tile("github").getAttribute("aria-pressed")).toBe("true");
    expect(dom.steps.children).toHaveLength(hostSteps("github").length);
    expect(dom.continueButton.hidden).toBe(false);
  });

  it("Continue hands the chosen host to the next step", () => {
    const { dom, continued, tile } = setup(memoryStore());
    tile("onedrive").fire("click");
    dom.continueButton.fire("click");
    expect(continued).toEqual(["onedrive"]);
  });

  it("Continue without a choice does nothing", () => {
    const { dom, continued } = setup(memoryStore());
    dom.continueButton.fire("click");
    expect(continued).toEqual([]);
  });

  it("works without a store, and with one that throws: the choice holds for the page", () => {
    const throwing = {
      items: new Map<string, string>(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    for (const store of [undefined, throwing]) {
      const { dom, continued, tile } = setup(store);
      tile("drive").fire("click");
      expect(dom.steps.hidden).toBe(false);
      dom.continueButton.fire("click");
      expect(continued).toEqual(["drive"]);
    }
  });
});

describe("a second tap deselects (prototype verdict P6)", () => {
  // Why: the owner tapped Google Drive twice and expected to be back where
  // they started - the text shown before a choice. The stored choice goes
  // too, or a reload would bring back a host they just let go of.
  it("a tap on the chosen host clears the choice, its steps and the store", () => {
    const store = memoryStore();
    const { dom, tile } = setup(store);
    tile("drive").fire("click");
    tile("drive").fire("click");
    expect(
      dom.tiles.children.map((t) => t.getAttribute("aria-pressed")),
    ).toEqual(["false", "false", "false", "false", "false"]);
    expect(dom.steps.hidden).toBe(true);
    expect(dom.starter.hidden).toBe(true);
    expect(dom.continueButton.hidden).toBe(true);
    expect(readTourHost(store)).toBeNull();
  });

  it("a tap on another host still switches to it", () => {
    const store = memoryStore();
    const { tile } = setup(store);
    tile("drive").fire("click");
    tile("github").fire("click");
    expect(readTourHost(store)).toBe("github");
  });
});

describe("the host's name opens the host (r820 feedback R2)", () => {
  it("renders it as a link opening in a new tab", () => {
    const { dom, tile } = setup(memoryStore());
    tile("drive").fire("click");
    const links = dom.steps.children
      .flatMap((li) => li.children)
      .filter((node) => node.tagName === "a");
    expect(links).toHaveLength(1);
    const [link] = links;
    expect(link?.textContent).toBe("Google Drive");
    expect(link?.getAttribute("href")).toBe("https://drive.google.com/");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
  });
});

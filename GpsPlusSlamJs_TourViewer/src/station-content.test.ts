import { describe, expect, it, vi } from "vitest";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Texture,
  type Object3D,
} from "three";

import {
  contentStatus,
  createStationContent,
  type ContentPart,
  type RenderedPart,
  type StationContentDeps,
} from "./station-content.js";

/**
 * Why these tests matter (visitor plan 2026-10-18-2349 §3, M2):
 * only the present station's content may stand in the scene, so a 100-station
 * walk draws one station; its textures must be freed once it fades out, and
 * a decode that lands after the visitor walked on must never appear. Each
 * test names the behaviour it can fail on.
 */

const FADE = 400;

/** A part that places one textured plane, its texture and render spied. */
function planePart(kind: ContentPart["kind"] = "content") {
  const textures: Texture[] = [];
  const disposed: Texture[] = [];
  const part: ContentPart & { renders: number } = {
    kind,
    renders: 0,
    render(parent) {
      part.renders += 1;
      const texture = new Texture();
      texture.dispose = () => {
        disposed.push(texture);
      };
      textures.push(texture);
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ map: texture }),
      );
      parent.add(mesh);
      return Promise.resolve({
        count: 1,
        skipped: [],
        dispose: () => {
          parent.remove(mesh);
          mesh.material.map?.dispose();
          mesh.material.dispose();
          mesh.geometry.dispose();
        },
      });
    },
  };
  return { part, textures, disposed };
}

/** A part whose render waits until `release` is called. */
function pendingPart() {
  let release: () => void = () => undefined;
  let disposed = 0;
  const part: ContentPart = {
    kind: "content",
    render(parent) {
      return new Promise<RenderedPart>((resolve) => {
        release = () => {
          const object = new Group();
          object.name = "late";
          parent.add(object);
          resolve({
            count: 1,
            skipped: [],
            dispose: () => {
              disposed += 1;
              parent.remove(object);
            },
          });
        };
      });
    },
  };
  return {
    part,
    release: () => {
      release();
    },
    disposed: () => disposed,
  };
}

function harness(over: Partial<StationContentDeps> = {}) {
  const scene = new Group();
  const clock = { ms: 1000 };
  const content = createStationContent({
    scene,
    now: () => clock.ms,
    fadeMs: FADE,
    ...over,
  });
  const names = () => scene.children.map((c) => c.name);
  const opacityOf = (id: string): number | null => {
    const group = scene.children.find(
      (c) => c.name === `station-content:${id}`,
    );
    if (group === undefined) return null;
    let found: number | null = null;
    group.traverse((o: Object3D) => {
      const m = (o as Mesh).material as MeshBasicMaterial | undefined;
      if (m !== undefined && found === null) found = m.opacity;
    });
    return found;
  };
  /** Advance the clock and let pending renders settle. */
  const at = async (ms: number) => {
    clock.ms = ms;
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    content.update(clock.ms);
  };
  return { scene, clock, content, names, opacityOf, at };
}

describe("station content: one side table, drawn by presence", () => {
  it("renders and mounts only the shown station; another station's parts are never rendered", async () => {
    const h = harness();
    const a = planePart();
    const b = planePart();
    h.content.setPart("a", "items", a.part);
    h.content.setPart("b", "items", b.part);
    await h.at(1000);
    // Nothing is shown before presence says so.
    expect(h.names()).toEqual([]);
    expect(a.part.renders + b.part.renders).toBe(0);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    expect(h.names()).toEqual(["station-content:a"]);
    expect(a.part.renders).toBe(1);
    expect(b.part.renders).toBe(0);
  });

  it("fades in over the fade time, and an opaque plane is opaque again at the end", async () => {
    const h = harness();
    const a = planePart();
    h.content.setPart("a", "items", a.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    expect(h.opacityOf("a")).toBe(0);
    await h.at(1000 + FADE / 2);
    expect(h.opacityOf("a")).toBeCloseTo(0.5, 6);
    await h.at(1000 + FADE);
    expect(h.opacityOf("a")).toBe(1);
    const mesh = h.scene.children[0]!.children[0] as Mesh;
    expect((mesh.material as MeshBasicMaterial).transparent).toBe(false);
  });

  it("fades out on leaving, then leaves the scene and frees its textures", async () => {
    const h = harness();
    const a = planePart();
    h.content.setPart("a", "items", a.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(2000);
    h.content.show(new Set());
    await h.at(2000 + FADE / 2);
    // Still in the scene, half faded, its texture held.
    expect(h.names()).toEqual(["station-content:a"]);
    expect(h.opacityOf("a")).toBeCloseTo(0.5, 6);
    expect(a.disposed).toHaveLength(0);
    await h.at(2000 + FADE);
    expect(h.names()).toEqual([]);
    expect(a.disposed).toEqual(a.textures);
  });

  it("drops a render that lands after the station was left: nothing enters the scene and the late result is disposed", async () => {
    const h = harness();
    const late = pendingPart();
    h.content.setPart("a", "items", late.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    h.content.show(new Set());
    await h.at(1100);
    late.release();
    await h.at(1200);
    await h.at(5000);
    expect(h.names()).toEqual([]);
    expect(late.disposed()).toBe(1);
  });

  it("keeps one station in the scene at a time: the next waits until the last has faded out", async () => {
    const h = harness();
    const a = planePart();
    const b = planePart();
    h.content.setPart("a", "items", a.part);
    h.content.setPart("b", "items", b.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(2000);
    h.content.show(new Set(["b"]));
    await h.at(2000 + FADE / 2);
    // b is decoded meanwhile, but waits off the scene.
    expect(b.part.renders).toBe(1);
    expect(h.names()).toEqual(["station-content:a"]);
    await h.at(2000 + FADE);
    expect(h.names()).toEqual(["station-content:b"]);
    expect(h.opacityOf("b")).toBe(0);
    await h.at(2000 + 2 * FADE);
    expect(h.opacityOf("b")).toBe(1);
  });

  it("a return during the fade-out fades back in without rendering again", async () => {
    const h = harness();
    const a = planePart();
    h.content.setPart("a", "items", a.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(2000);
    h.content.show(new Set());
    await h.at(2000 + FADE / 4);
    h.content.show(new Set(["a"]));
    await h.at(2000 + FADE / 2);
    expect(h.opacityOf("a")).toBeCloseTo(1, 6);
    expect(a.part.renders).toBe(1);
    expect(a.disposed).toHaveLength(0);
  });

  it("a return after the fade-out renders again (the textures were freed)", async () => {
    const h = harness();
    const a = planePart();
    h.content.setPart("a", "items", a.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    h.content.show(new Set());
    await h.at(1000 + FADE);
    h.content.show(new Set(["a"]));
    await h.at(1000 + FADE);
    expect(a.part.renders).toBe(2);
    expect(h.names()).toEqual(["station-content:a"]);
  });

  it("shows every station at once when all are shown (the override)", async () => {
    const h = harness();
    for (const id of ["a", "b", "c"])
      h.content.setPart(id, "items", planePart().part);
    h.content.show(new Set(["a", "b", "c"]));
    await h.at(1000);
    expect([...h.names()].sort()).toEqual([
      "station-content:a",
      "station-content:b",
      "station-content:c",
    ]);
  });

  it("renders a part added to a shown station into its group, at the group's opacity", async () => {
    const h = harness();
    h.content.setPart("a", "items", planePart().part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(1000 + FADE / 2);
    const walk = planePart("capture-spots");
    h.content.setPart("a", "walk", walk.part);
    // Settled, with no frame since: the new plane must not flash at its
    // own full opacity until the next update.
    await new Promise((r) => setTimeout(r, 0));
    expect(walk.part.renders).toBe(1);
    const group = h.scene.children[0]!;
    const opacities: number[] = [];
    group.traverse((o) => {
      const m = (o as Mesh).material as MeshBasicMaterial | undefined;
      if (m !== undefined) opacities.push(m.opacity);
    });
    expect(opacities).toHaveLength(2);
    for (const o of opacities) expect(o).toBeCloseTo(0.5, 6);
  });

  it("disposes a part that is replaced or removed", async () => {
    const h = harness();
    const first = planePart();
    h.content.setPart("a", "items", first.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    const second = planePart();
    h.content.setPart("a", "items", second.part);
    await h.at(1000);
    expect(first.disposed).toEqual(first.textures);
    expect(second.part.renders).toBe(1);
    h.content.setPart("a", "items", null);
    await h.at(1000);
    expect(second.disposed).toEqual(second.textures);
    // A station with no parts left draws nothing.
    expect(h.names()).toEqual([]);
  });

  it("renders one part at a time, so showing every station does not decode them all at once", async () => {
    const h = harness();
    let running = 0;
    let most = 0;
    const slow = (): ContentPart => ({
      kind: "content",
      async render() {
        running += 1;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
        return { count: 0, skipped: [], dispose: () => undefined };
      },
    });
    for (const id of ["a", "b", "c", "d"])
      h.content.setPart(id, "items", slow());
    h.content.show(new Set(["a", "b", "c", "d"]));
    await new Promise((r) => setTimeout(r, 30));
    expect(most).toBe(1);
  });

  it("counts what stands for the shown stations, per kind", async () => {
    const h = harness();
    expect(h.content.has("content")).toBe(false);
    const skipping: ContentPart = {
      kind: "content",
      render: () =>
        Promise.resolve({ count: 2, skipped: ["x"], dispose: () => undefined }),
    };
    h.content.setPart("a", "items", skipping);
    h.content.setPart("a", "walk", planePart("capture-spots").part);
    h.content.setPart("b", "items", planePart().part);
    expect(h.content.has("content")).toBe(true);
    expect(h.content.shown("content")).toEqual({ count: 0, skipped: [] });
    h.content.show(new Set(["a"]));
    await h.at(1000);
    expect(h.content.shown("content")).toEqual({ count: 2, skipped: ["x"] });
    expect(h.content.shown("capture-spots")).toEqual({ count: 1, skipped: [] });
    // Left: it no longer counts, though it still fades out.
    h.content.show(new Set());
    expect(h.content.shown("content")).toEqual({ count: 0, skipped: [] });
  });

  it("a fade starts when the station is left, however long since the last frame", async () => {
    const h = harness();
    h.content.setPart("a", "items", planePart().part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(2000);
    // No update for three seconds, then the visitor leaves.
    h.clock.ms = 5000;
    h.content.show(new Set());
    await h.at(5000 + FADE / 2);
    expect(h.opacityOf("a")).toBeCloseTo(0.5, 6);
  });

  it("tells the status line the shown stations' items: none before any, then a count that is 0 away from every station", async () => {
    const h = harness();
    expect(contentStatus(null)).toEqual({ kind: "none" });
    expect(contentStatus(h.content)).toEqual({ kind: "none" });
    h.content.setPart("a", "walk", planePart("capture-spots").part);
    // Walk photos are not the tour's items.
    expect(contentStatus(h.content)).toEqual({ kind: "none" });
    h.content.setPart("a", "items", {
      kind: "content",
      render: () =>
        Promise.resolve({ count: 3, skipped: ["x"], dispose: () => undefined }),
    });
    expect(contentStatus(h.content)).toEqual({
      kind: "placed",
      count: 0,
      skipped: 0,
    });
    h.content.show(new Set(["a"]));
    await h.at(1000);
    expect(contentStatus(h.content)).toEqual({
      kind: "placed",
      count: 3,
      skipped: 1,
    });
  });

  it("reports each kept render with its station, once", async () => {
    const onMounted = vi.fn();
    const h = harness({ onMounted });
    h.content.setPart("a", "items", planePart().part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(2000);
    expect(onMounted).toHaveBeenCalledTimes(1);
    expect(onMounted.mock.calls[0]![0]).toBe("a");
    expect(onMounted.mock.calls[0]![1]).toMatchObject({ count: 1 });
  });

  it("dispose takes everything out, frees it, and ignores later calls", async () => {
    const h = harness();
    const a = planePart();
    const late = pendingPart();
    h.content.setPart("a", "items", a.part);
    h.content.setPart("b", "items", late.part);
    h.content.show(new Set(["a", "b"]));
    await h.at(1000);
    h.content.dispose();
    expect(h.names()).toEqual([]);
    expect(a.disposed).toEqual(a.textures);
    late.release();
    await h.at(2000);
    expect(late.disposed()).toBe(1);
    h.content.setPart("c", "items", planePart().part);
    h.content.show(new Set(["c"]));
    await h.at(3000);
    expect(h.names()).toEqual([]);
  });

  it("a render that throws leaves that part out and the station still shows the rest", async () => {
    const onFailed = vi.fn();
    const h = harness({ onFailed });
    h.content.setPart("a", "items", {
      kind: "content",
      render: () => Promise.reject(new Error("broken")),
    });
    h.content.setPart("a", "walk", planePart("capture-spots").part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    expect(h.names()).toEqual(["station-content:a"]);
    expect(h.content.shown("capture-spots").count).toBe(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0]![0]).toBe("a");
  });
});

describe("station content: failures and fades", () => {
  // Why these tests matter: a part that cannot be built must not be rebuilt
  // on every entry; a throwing mount callback must not strand a station in
  // "loading"; a settled fade must not keep rewriting every material each
  // frame; and nothing shows while no shown station holds a part.

  it("a part that throws is tried once per table: enter, leave, enter again builds it no more, leaks nothing, and says so once", async () => {
    const onFailed = vi.fn();
    const h = harness({ onFailed });
    let attempts = 0;
    h.content.setPart("a", "items", {
      kind: "content",
      render: () => {
        attempts += 1;
        return Promise.reject(new Error("broken"));
      },
    });
    const walk = planePart("capture-spots");
    h.content.setPart("a", "walk", walk.part);
    for (let round = 0; round < 2; round += 1) {
      h.content.show(new Set(["a"]));
      await h.at(1000 + round * 10 * FADE);
      await h.at(1000 + round * 10 * FADE + FADE);
      h.content.show(new Set());
      await h.at(1000 + round * 10 * FADE + 3 * FADE);
    }
    expect(attempts).toBe(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
    // The healthy part rendered on each entry and freed each time.
    expect(walk.part.renders).toBe(2);
    expect(walk.disposed).toEqual(walk.textures);
  });

  it("a mount callback that throws still lets the station enter", async () => {
    const h = harness({
      onMounted: () => {
        throw new Error("log failed");
      },
    });
    h.content.setPart("a", "items", planePart().part);
    h.content.show(new Set(["a"]));
    await h.at(1000).catch(() => undefined);
    await h.at(1000);
    expect(h.names()).toEqual(["station-content:a"]);
  });

  it("writes no material once a fade has settled", async () => {
    const h = harness();
    const a = planePart();
    h.content.setPart("a", "items", a.part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(1000 + FADE);
    const mesh = h.scene.children[0]!.children[0] as Mesh;
    const material = mesh.material as MeshBasicMaterial;
    let writes = 0;
    let own = material.opacity;
    Object.defineProperty(material, "opacity", {
      get: () => own,
      set: (v: number) => {
        writes += 1;
        own = v;
      },
    });
    await h.at(1000 + 2 * FADE);
    await h.at(1000 + 3 * FADE);
    expect(writes).toBe(0);
  });

  it("showsAny: false while no shown station holds a part, true once one does", () => {
    const h = harness();
    h.content.setPart("a", "items", planePart().part);
    expect(h.content.showsAny()).toBe(false);
    h.content.show(new Set(["b"]));
    expect(h.content.showsAny()).toBe(false);
    h.content.show(new Set(["a"]));
    expect(h.content.showsAny()).toBe(true);
    h.content.show(new Set());
    expect(h.content.showsAny()).toBe(false);
  });
});

describe("station content: stale failures, the one-at-a-time rule, late parts", () => {
  it("a render that fails after its station was left is not marked failed: shown again, it is built again", async () => {
    // Why: a render that stops because its station was left (a long
    // decode told `alive()` is false) may throw on the way out. That says
    // nothing about the part, so it must not be left out for good.
    const onFailed = vi.fn();
    const h = harness({ onFailed });
    let attempts = 0;
    let fail: (() => void) | null = null;
    h.content.setPart("a", "items", {
      kind: "content",
      render: (parent) => {
        attempts += 1;
        if (attempts === 1) {
          return new Promise<RenderedPart>((_resolve, reject) => {
            fail = () => {
              reject(new Error("stopped"));
            };
          });
        }
        return planePart().part.render(parent, () => true);
      },
    });
    h.content.show(new Set(["a"]));
    await h.at(1000);
    h.content.show(new Set());
    fail!();
    await h.at(1100);
    expect(onFailed).not.toHaveBeenCalled();
    h.content.show(new Set(["a"]));
    await h.at(1200);
    expect(attempts).toBe(2);
  });

  it("a station whose parts all failed before enters only once the station leaving is gone", async () => {
    // Why: such a station settles at once, inside `show`, before `show`
    // has marked the stations after it in the table as leaving - it
    // entered beside a station that was about to fade out.
    const h = harness();
    // "b" first in the table: `show` reaches it before "a".
    h.content.setPart("b", "items", {
      kind: "content",
      render: () => Promise.reject(new Error("broken")),
    });
    h.content.setPart("a", "items", planePart().part);
    h.content.show(new Set(["b"]));
    await h.at(1000);
    h.content.show(new Set());
    await h.at(1000 + 2 * FADE);
    h.content.show(new Set(["a"]));
    await h.at(3000);
    await h.at(3000 + FADE);
    expect(h.names()).toEqual(["station-content:a"]);
    // Back to "b" (built from nothing now): it waits for "a" to go.
    h.content.show(new Set(["b"]));
    expect(h.names()).toEqual(["station-content:a"]);
    await h.at(4000 + FADE);
    expect(h.names()).toEqual(["station-content:b"]);
  });

  it("a part added to a station that waits to enter is waited for, and the station fades in from 0 with it", async () => {
    // Why: a station that rendered its parts waits off the scene while the
    // last one fades out. A part added then rendered uncounted, so the
    // station entered without it and it popped in later at whatever
    // opacity the fade had reached.
    const h = harness();
    h.content.setPart("a", "items", planePart().part);
    h.content.setPart("b", "items", planePart().part);
    h.content.show(new Set(["a"]));
    await h.at(1000);
    await h.at(1000 + FADE);
    h.content.show(new Set(["b"]));
    await h.at(1000 + FADE + FADE / 2);
    // "b" rendered and waits for "a" to fade out.
    expect(h.names()).toEqual(["station-content:a"]);
    const late = pendingPart();
    h.content.setPart("b", "late", late.part);
    await h.at(1000 + 2 * FADE);
    expect(h.names()).toEqual([]);
    late.release();
    await h.at(1000 + 2 * FADE + 1);
    expect(h.names()).toEqual(["station-content:b"]);
    expect(h.opacityOf("b")).toBe(0);
  });
});

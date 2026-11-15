// @vitest-environment jsdom
/**
 * Why these tests matter: a note's disc is how a visitor finds and opens
 * it. A disc that vanished when its note faced away would hide that there
 * is something on the far side; discs piled on one another could not be
 * tapped apart; a title shown for every note would cover the model; and a
 * disc left on the page after its model went would open a note of
 * nothing.
 */
import * as THREE from "three";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mountModelView, type TourModelBlock } from "./model-views.js";
import {
  createNoteMarkers,
  layoutNoteMarkers,
  NOTE_MIN_GAP_PX,
  NOTE_MIN_OPACITY,
  NOTE_OCCLUDED_DIM,
  NOTE_OCCLUSION_INTERVAL_S,
  NOTE_OCCLUSION_SLACK_SHARE,
  NOTE_COVER_MAX_TRIANGLES,
  NOTE_COVER_TESTS_PER_FRAME,
  coverTargetOf,
  noteHidden,
  noteKey,
  noteOpacity,
  notesOnScreen,
  type NoteOnScreen,
} from "./note-markers.js";

const screen = { width: 400, height: 800 };

function note(
  key: string,
  x: number,
  y: number,
  extra: Partial<NoteOnScreen> = {},
): NoteOnScreen {
  return {
    key,
    surface: { x, y: y + 30 },
    marker: { x, y },
    behind: false,
    facing: 1,
    distanceM: 5,
    occluded: false,
    ...extra,
  };
}

describe("layoutNoteMarkers", () => {
  // Why: a note facing away fades but never below 0.22, so the visitor
  // still sees a note is there.
  it("fades a note that faces away, never below its floor", () => {
    expect(noteOpacity(1)).toBe(1);
    expect(noteOpacity(0.3)).toBe(1);
    expect(noteOpacity(-1)).toBe(NOTE_MIN_OPACITY);
    expect(noteOpacity(0.05)).toBeGreaterThan(NOTE_MIN_OPACITY);
    expect(noteOpacity(0.05)).toBeLessThan(1);
    expect(noteOpacity(Number.NaN)).toBe(NOTE_MIN_OPACITY);
  });

  // Why: the chosen page dims a disc whose point the model's own body
  // hides (its ray test), so a visitor reads which notes are on the side
  // they see; it still never fades below the floor, and a hidden note
  // never takes the title from one in plain view.
  it("dims a note the model hides, never below its floor, and never labels it", () => {
    expect(noteOpacity(1, true)).toBeCloseTo(NOTE_OCCLUDED_DIM, 9);
    expect(noteOpacity(1, true)).toBeLessThan(noteOpacity(1, false));
    expect(noteOpacity(-1, true)).toBe(NOTE_MIN_OPACITY);
    const [hidden, seen] = layoutNoteMarkers(
      [note("hidden", 200, 360, { occluded: true }), note("seen", 330, 160)],
      screen,
      null,
    );
    expect(hidden!.opacity).toBeCloseTo(NOTE_OCCLUDED_DIM, 9);
    expect(hidden!.label).toBe(false);
    expect(seen!.label).toBe(true);
  });

  // Why: two discs closer than a fingertip are pushed apart until they
  // can be tapped apart; their leaders keep the true points.
  it("pushes discs apart to the smallest gap, leaders on the true points", () => {
    const [a, b] = layoutNoteMarkers(
      [note("a", 200, 300), note("b", 210, 300)],
      screen,
      null,
    );
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThanOrEqual(
      NOTE_MIN_GAP_PX - 1e-9,
    );
    expect(a!.surfaceX).toBe(200);
    expect(b!.surfaceX).toBe(210);
  });

  // Why: one title at a time - the open note's, or else the note nearest
  // the screen's centre that faces the visitor within 16 m.
  it("labels the open note, or else the facing note nearest the centre", () => {
    const notes = [
      note("near", 210, 370),
      note("far", 50, 100),
      note("away", 200, 360, { facing: -0.5 }),
    ];
    const free = layoutNoteMarkers(notes, screen, null);
    expect(free.filter((p) => p.label).map((p) => p.key)).toEqual(["near"]);
    const opened = layoutNoteMarkers(notes, screen, "far");
    expect(opened.filter((p) => p.label).map((p) => p.key)).toEqual(["far"]);
    const distant = layoutNoteMarkers(
      [note("near", 200, 360, { distanceM: 30 })],
      screen,
      null,
    );
    expect(distant[0]!.label).toBe(false);
  });

  // Why: a note behind the camera or off the screen has no disc; one just
  // past the edge (within the slack) is shown, held where the whole disc
  // can be tapped.
  it("hides a note behind the camera or off the screen", () => {
    const placed = layoutNoteMarkers(
      [
        note("behind", 200, 300, { behind: true }),
        note("left", -100, 300),
        note("edge", -10, 300),
        note("nan", Number.NaN, 300),
      ],
      screen,
      null,
    );
    expect(placed.map((p) => p.on)).toEqual([false, false, true, false]);
    expect(placed[2]!.x).toBe(14);
    expect(placed[2]!.y).toBe(300);
  });
});

/** A hotspots model with two notes at the origin, its front facing +z. */
function hotspots() {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  const block = {
    id: "bell",
    kind: "model",
    view: "hotspots",
    asset: "bell",
    sizeM: 1,
    createdAtIso: "2026-10-28T12:00:00.000Z",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    annotations: [
      { position: [0, 0, 0.5], normal: [0, 0, 1], title: "Front" },
      { position: [0, 0, -0.5], normal: [0, 0, -1], title: "Back" },
    ],
  } as TourModelBlock;
  return mountModelView(model, block, 1);
}

/** A hotspots model of two 1 m boxes, one at the origin and one 3 m
 *  behind it, each with a note on its front face (facing +z). */
function twoParts() {
  const model = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  back.position.z = -3;
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), back);
  model.updateMatrixWorld(true);
  const block = {
    id: "pair",
    kind: "model",
    view: "hotspots",
    asset: "pair",
    sizeM: 1,
    createdAtIso: "2026-10-28T12:00:00.000Z",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    annotations: [
      { position: [0, 0, 0.5], normal: [0, 0, 1], title: "Near" },
      { position: [0, 0, -2.5], normal: [0, 0, 1], title: "Far" },
    ],
  } as TourModelBlock;
  return mountModelView(model, block, 1);
}

/** A hotspots model: a 1 m box with `count` notes in a row across its
 *  front face, the whole under `parent` (scaled for a folder). */
function rowOfNotes(count: number, parent = new THREE.Group()) {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  parent.add(model);
  parent.updateMatrixWorld(true);
  const block = {
    id: "row",
    kind: "model",
    view: "hotspots",
    asset: "row",
    sizeM: 1,
    createdAtIso: "2026-10-28T12:00:00.000Z",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    annotations: Array.from({ length: count }, (_, i) => ({
      position: [-0.45 + (0.9 * i) / Math.max(1, count - 1), 0, 0.5],
      normal: [0, 0, 1],
      title: `Note ${i}`,
    })),
  } as TourModelBlock;
  return mountModelView(model, block, 1);
}

/** Every ray cast at `mesh`, by its direction's x (rounded), so a test
 *  can tell which note it was for. */
function countRays(mesh: THREE.Mesh): number[] {
  const seen: number[] = [];
  const own = mesh.raycast.bind(mesh);
  mesh.raycast = (raycaster, hits) => {
    seen.push(Math.round(raycaster.ray.direction.x * 1e4));
    own(raycaster, hits);
  };
  return seen;
}

/** A mesh of `count` loose triangles (no index). */
function triangles(count: number): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(count * 9), 3),
  );
  return new THREE.Mesh(geometry);
}

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(60, 0.5, 0.05, 100);
  c.position.set(0, 0, 5);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
}

describe("notesOnScreen", () => {
  // Why: the front note faces the visitor at the screen's centre; the
  // back one faces away.
  it("projects each note and measures how it faces the camera", () => {
    const [front, back] = notesOnScreen([hotspots()], camera(), screen);
    expect(front!.key).toBe(noteKey("bell", 0));
    expect(front!.surface.x).toBeCloseTo(200, 6);
    expect(front!.surface.y).toBeCloseTo(400, 6);
    expect(front!.facing).toBeCloseTo(1, 6);
    expect(front!.distanceM).toBeCloseTo(4.5, 6);
    expect(back!.facing).toBeCloseTo(-1, 6);
    expect(front!.behind).toBe(false);
    // The box's own body hides the back note's point, not the front's.
    expect(front!.occluded).toBe(false);
    expect(back!.occluded).toBe(true);
  });

  // Why: facing and hiding are two tests. A note facing the visitor on a
  // part behind another part is hidden though it faces them; the dim
  // comes from the ray, not from the normal.
  it("finds a note that faces the visitor but sits behind another part", () => {
    const [front, hidden] = notesOnScreen([twoParts()], camera(), screen);
    expect(hidden!.facing).toBeCloseTo(1, 6);
    expect(hidden!.occluded).toBe(true);
    expect(front!.occluded).toBe(false);
  });

  // Why: a note's point sits ON the surface, so the ray to it ends on that
  // surface; the slack (a share of the model's size) keeps that end from
  // counting as a cover, and an authored point a little inside the
  // surface too. Swept over slacks from 0.5 % to 5 % of a 1 m model: the
  // visible note is never hidden and the covered one always is.
  it("keeps a note on the near surface visible and a covered one hidden, over slacks", () => {
    const view = twoParts();
    const eye = new THREE.Vector3(0, 0, 5);
    const [front, hidden] = view.notePoints();
    for (const share of [0.005, 0.01, NOTE_OCCLUSION_SLACK_SHARE, 0.05]) {
      expect(
        noteHidden(view.model, eye, front!.surface, share),
        String(share),
      ).toBe(false);
      expect(
        noteHidden(view.model, eye, hidden!.surface, share),
        String(share),
      ).toBe(true);
    }
    // A point 1 cm inside the near face still reads as seen at 2 %.
    const inside = front!.surface.clone().setZ(0.49);
    expect(noteHidden(view.model, eye, inside, 0.02)).toBe(false);
  });

  // Why: over any eye outside a box, the point where the ray from the
  // eye enters the box is seen and the point where it leaves is hidden,
  // at every slack from 0.5 % to 5 % of its size.
  it("sees where a ray enters a box and not where it leaves, from any eye", () => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    box.updateMatrixWorld(true);
    const bounds = new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5),
    );
    const unit = fc.double({ min: -1, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        unit,
        unit,
        unit,
        fc.double({ min: 2, max: 30, noNaN: true }),
        fc.double({ min: 0.005, max: 0.05, noNaN: true }),
        (x, y, z, distance, slack) => {
          const dir = new THREE.Vector3(x, y, z);
          fc.pre(dir.length() > 0.1);
          const eye = dir.normalize().multiplyScalar(distance);
          const toward = eye.clone().negate().normalize();
          const enter = new THREE.Ray(eye, toward).intersectBox(
            bounds,
            new THREE.Vector3(),
          );
          const far = eye.clone().addScaledVector(toward, 2 * distance);
          const leave = new THREE.Ray(
            far,
            toward.clone().negate(),
          ).intersectBox(bounds, new THREE.Vector3());
          if (enter === null || leave === null) return;
          expect(noteHidden(box, eye, enter, slack)).toBe(false);
          expect(noteHidden(box, eye, leave, slack)).toBe(true);
        },
      ),
      { seed: 7, numRuns: 200 },
    );
  });

  // Why: the slack is a share of the model's size as it is drawn; a
  // folder that draws a 1 m model ten times larger draws its surface's
  // small offsets ten times larger too. A point 5 cm (drawn) inside the
  // near face must read as seen, as it does unscaled at 5 mm.
  it("scales the slack with the size the model is drawn at", () => {
    const folder = new THREE.Group();
    folder.scale.setScalar(10);
    const view = rowOfNotes(1, folder);
    const own = view.notes[0] as unknown as { position: number[] };
    own.position[2] = 0.495;
    const c = new THREE.PerspectiveCamera(60, 0.5, 0.05, 200);
    c.position.set(0, 0, 40);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld(true);
    const [seen] = notesOnScreen([view], c, screen);
    expect(seen!.occluded).toBe(false);
  });

  // Why: a big model's triangles cost the ray its frame on a phone. Up
  // to the cap the whole model is cast against; over it, its coarsest
  // level when it has levels, else no ray at all (the facing fade stays).
  it("casts at the model up to the triangle cap, at its coarsest level over it, else not at all", () => {
    const small = new THREE.Group().add(triangles(NOTE_COVER_MAX_TRIANGLES));
    expect(coverTargetOf(small)).toBe(small);
    const big = new THREE.Group().add(triangles(NOTE_COVER_MAX_TRIANGLES + 1));
    expect(coverTargetOf(big)).toBeNull();
    const lod = new THREE.LOD();
    const coarse = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    lod.addLevel(triangles(NOTE_COVER_MAX_TRIANGLES + 1), 0);
    lod.addLevel(coarse, 50);
    const levelled = new THREE.Group().add(lod);
    expect(coverTargetOf(levelled)).toBe(coarse);
    // Indexed geometry counts its index, not its vertices.
    const indexed = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 60, 60, 60));
    expect(coverTargetOf(new THREE.Group().add(indexed))).toBeNull();
  });

  // Why: over the cap the ray is skipped, never guessed: the note reads
  // as unhidden and the facing fade still dims it.
  it("leaves a note over the cap unhidden by any ray, its facing still read", () => {
    const view = rowOfNotes(1);
    view.model.add(triangles(NOTE_COVER_MAX_TRIANGLES));
    const back = view.notes[0] as unknown as {
      position: number[];
      normal: number[];
    };
    back.position[2] = -0.5;
    back.normal[2] = -1;
    const [note] = notesOnScreen([view], camera(), screen);
    expect(note!.occluded).toBe(false);
    expect(note!.facing).toBeLessThan(-0.9);
  });
});

describe("createNoteMarkers", () => {
  function dom() {
    const layer = document.createElement("div");
    Object.defineProperty(layer, "clientWidth", { value: 400 });
    Object.defineProperty(layer, "clientHeight", { value: 800 });
    const leaders = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    document.body.append(layer, leaders);
    return { layer, leaders };
  }

  // Why: each note is one button on the overlay (a tap on it is never an
  // AR select) that opens its note; the discs go with their model.
  it("keeps one button per note that opens it, and removes them with the model", () => {
    const d = dom();
    const opened: number[] = [];
    const markers = createNoteMarkers(d, (_h, i) => opened.push(i));
    const view = hotspots();
    markers.sync([view], camera(), null, 1 / 60);
    const buttons = d.layer.querySelectorAll("button.note-marker");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Note 1: Front");
    expect(buttons[0]!.textContent).toContain("Front");
    expect((buttons[0] as HTMLButtonElement).hidden).toBe(false);
    expect(d.leaders.querySelectorAll("line")).toHaveLength(4);
    (buttons[1] as HTMLButtonElement).click();
    expect(opened).toEqual([1]);
    markers.sync([view], camera(), noteKey("bell", 0), 1 / 60);
    expect(buttons[0]!.classList.contains("open")).toBe(true);
    expect(buttons[0]!.classList.contains("labelled")).toBe(true);
    // No camera: every disc hidden, none removed.
    markers.sync([view], null, null, 1 / 60);
    expect((buttons[0] as HTMLButtonElement).hidden).toBe(true);
    markers.sync([], camera(), null, 1 / 60);
    expect(d.layer.querySelectorAll("button")).toHaveLength(0);
    expect(d.leaders.querySelectorAll("g")).toHaveLength(0);
  });

  // Why (a PR review finding): the fade eased a fixed share per call, so
  // at 120 Hz the discs faded in twice as fast as at 60 Hz. Per second it
  // must be the same at any frame rate, and a quarter per frame at 60 Hz.
  it("fades a disc in at the same pace per second at 60 and 120 Hz", () => {
    const fadeAfter = (hz: number, frames: number): number => {
      const d = dom();
      const markers = createNoteMarkers(d, () => undefined);
      const view = hotspots();
      for (let i = 0; i < frames; i++) {
        markers.sync([view], camera(), null, 1 / hz);
      }
      const button = d.layer.querySelector("button.note-marker");
      return Number((button as HTMLButtonElement).style.opacity);
    };
    expect(fadeAfter(60, 1)).toBeCloseTo(0.25, 3);
    for (const seconds of [0.05, 0.1, 0.2]) {
      expect(fadeAfter(120, seconds * 120)).toBeCloseTo(
        fadeAfter(60, seconds * 60),
        3,
      );
    }
  });

  // Why: the ray test walks the model's triangles, which costs on a big
  // file. A frame casts at most NOTE_COVER_TESTS_PER_FRAME rays, the
  // longest-waiting note first, so with more notes than frames in an
  // interval none is starved; a note is tested at most once per interval.
  it("spreads the cover tests, one a frame, and reaches every note", () => {
    for (const count of [2, 5, 20]) {
      const d = dom();
      const markers = createNoteMarkers(d, () => undefined);
      const view = rowOfNotes(count);
      const rays = countRays(view.model.children[0] as THREE.Mesh);
      const frame = 1 / 60;
      const frames = 2 * count + 30;
      let last = 0;
      for (let i = 0; i < frames; i++) {
        markers.sync([view], camera(), null, frame);
        expect(rays.length - last, String(count)).toBeLessThanOrEqual(
          NOTE_COVER_TESTS_PER_FRAME,
        );
        last = rays.length;
      }
      // The first round reaches every note once.
      expect(new Set(rays.slice(0, count)).size, String(count)).toBe(count);
      // And no note more often than once per interval.
      for (const x of new Set(rays)) {
        expect(rays.filter((r) => r === x).length).toBeLessThanOrEqual(
          Math.ceil((frames * frame) / NOTE_OCCLUSION_INTERVAL_S) + 1,
        );
      }
    }
  });

  // Why: a note behind the visitor or off the screen shows no disc, so
  // a ray for it is cost for nothing.
  it("casts no ray for a note behind the camera or off the screen", () => {
    const d = dom();
    const markers = createNoteMarkers(d, () => undefined);
    const view = rowOfNotes(3);
    const rays = countRays(view.model.children[0] as THREE.Mesh);
    const away = camera();
    away.lookAt(0, 0, 10);
    away.updateMatrixWorld(true);
    const aside = camera();
    aside.lookAt(10, 0, 5);
    aside.updateMatrixWorld(true);
    for (let i = 0; i < 30; i++) {
      markers.sync([view], i % 2 === 0 ? away : aside, null, 1 / 60);
    }
    const [n] = notesOnScreen([view], away, screen);
    expect(n!.behind).toBe(true);
    expect(rays).toHaveLength(0);
  });
});

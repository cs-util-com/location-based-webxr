import { beforeEach, describe, expect, it } from "vitest";
import {
  Box3,
  PerspectiveCamera,
  Vector3,
  type Mesh,
  type MeshStandardMaterial,
} from "three";
import { CHAPTER_COUNT } from "../chapters";
import {
  buildClayWorld,
  SKYLINE_CENTER,
  SKYLINE_TOWER_POS,
  VIGNETTE_ANCHORS,
  WORLD_NODE,
} from "./clay-world";
import { buildDotPerson } from "./dot-person";
import { buildMarkerPair } from "./markers";
import { buildPhoneFrame } from "./phone-frame";
import { VIGNETTE_NODE } from "./use-case-vignettes";
import {
  buildIntroTimeline,
  buildStoryTimeline,
  CHAPTER_DURATION_MS,
  chapterEndTime,
  createStoryStage,
  syncStage,
  type StoryStage,
} from "./story-timeline";

// Why this test matters: the story timeline is scrubbed by scroll progress,
// so nothing ever "plays" during tests or CI — the only way to catch a
// broken chapter is to seek the timeline and assert the scene actually
// changed. These tests pin the core promises: the scrub covers all
// chapters, cameras move, the raw marker jitters while the fused one holds
// still (the product message!), and seeking back restores the start state.

function makeStage(): StoryStage {
  return createStoryStage({
    world: buildClayWorld("low"),
    person: buildDotPerson(),
    markers: buildMarkerPair(),
    phone: buildPhoneFrame(),
    camera: new PerspectiveCamera(55, 16 / 9),
  });
}

describe("buildStoryTimeline", () => {
  let stage: StoryStage;

  beforeEach(() => {
    stage = makeStage();
  });

  // Why this test matters: PR #191 review (gemini, "high") claimed the QR
  // accuracy ring stays invisible because "opacity" is tweened on the Mesh
  // rather than its material. Empirically the in-project anime.js timeline
  // DOES drive the material (0.85 at the beat's peak, no dead expando on the
  // mesh) and the collapse tween eases the group scale — but raw anime on a
  // bare Mesh behaves differently, so this pin guards the ring's visibility
  // contract against an anime upgrade ever changing target resolution.
  it("fades the QR accuracy ring in via its material opacity during the QR beat", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(1600); // between the fade-in (ends 1500) and fade-out (1890)
    const snapRing = stage.world.getObjectByName(WORLD_NODE.snapRing)!;
    const ringMesh = snapRing.children[0] as Mesh & { opacity?: number };
    const material = ringMesh.material as MeshStandardMaterial;
    // The renderer reads the MATERIAL's opacity — that is what must animate.
    expect(material.opacity).toBeGreaterThan(0.5);
    // No dead expando on the mesh (the failure mode the review predicted).
    expect(ringMesh.opacity).toBeUndefined();
    // And the ring is mid-collapse (scale tween live at this seek).
    expect(snapRing.scale.x).toBeLessThan(3);
    expect(snapRing.scale.x).toBeGreaterThan(0.06);
  });

  it("covers every chapter with the fixed per-chapter duration", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    expect(timeline.duration).toBe(CHAPTER_COUNT * CHAPTER_DURATION_MS);
    expect(chapterEndTime(2)).toBe(3 * CHAPTER_DURATION_MS - 1);
  });

  it("opens far out and keeps flying through the whole hero window (round-12 R12-1)", () => {
    // The story must start with a sense of the WHOLE world and the
    // camera must never stand still — it immediately approaches the QR.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(1);
    expect(stage.camera.position.length()).toBeGreaterThan(45);
    timeline.seek(600);
    const midWindow = stage.camera.position.clone();
    timeline.seek(950);
    // Still moving LATE in the hero window (no settled dead zone).
    expect(stage.camera.position.distanceTo(midWindow)).toBeGreaterThan(0.5);
  });

  it("flies the gallery journey past the campus and arrives at the castle for the CTA (round-11)", () => {
    // The maintainer's brainstorm: the gallery chapter is a use-case
    // JOURNEY (city sweep → campus flyover → castle), and the CTA is an
    // ARRIVAL — the camera rests at the castle instead of returning to
    // the start framing.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const heroPos = stage.camera.position.clone();

    // Round-15 timing anchors — the whole pre-castle stretch moved
    // EARLIER: the camera must be SETTLED on the tower while the
    // works-anywhere copy is still leaving (≈4800, "in dem Moment schon
    // komplett auf dem Turm platziert"), must NOT linger there, and must
    // already be AT the tents by ~10 % into the gallery window (5150,
    // "wenn der 'What will you build'-Textblock zu ~10 % zu sehen ist,
    // dass man dann schon bei den drei Zelten ist"). The castle leg is
    // deliberately untouched — round-15 called that part "super so".
    timeline.seek(4800);
    syncStage(stage);
    // Portrait follow-up: the camera stays FARTHER back now (park + tower
    // both in frame instead of a hard tower zoom), so the "at the city"
    // bound is looser than the old 32.
    expect(stage.camera.position.distanceTo(SKYLINE_CENTER)).toBeLessThan(42);

    timeline.seek(5150); // already at the tents, very early in the gallery
    syncStage(stage);
    expect(
      stage.camera.position.distanceTo(VIGNETTE_ANCHORS.campus),
    ).toBeLessThan(34);

    // Round-14: the camp pose is an APPROACH pose ON the travel axis (the
    // fly-OVER happens just after, early in the castle leg) — sitting
    // right on top of the tents put them below the landscape frustum.
    // What actually matters (tents visible, left of the copy panel) is
    // pinned by the R14-2 framing test below; this stays a loose "still
    // at the camp" bound across the dwell.
    timeline.seek(5450);
    syncStage(stage);
    expect(
      stage.camera.position.distanceTo(VIGNETTE_ANCHORS.campus),
    ).toBeLessThan(34);

    timeline.seek(6000); // arrival must be COMPLETE (resting) at CTA start
    syncStage(stage);
    const arrived = stage.camera.position.clone();
    expect(arrived.distanceTo(VIGNETTE_ANCHORS.castle)).toBeLessThan(30);
    timeline.seek(6650);
    syncStage(stage);
    expect(stage.camera.position.distanceTo(arrived)).toBeLessThan(0.8);

    timeline.seek(chapterEndTime(5)); // gallery end: already resting at castle
    syncStage(stage);
    expect(
      stage.camera.position.distanceTo(VIGNETTE_ANCHORS.castle),
    ).toBeLessThan(30);

    timeline.seek(chapterEndTime(6)); // CTA: resting at the castle
    syncStage(stage);
    expect(
      stage.camera.position.distanceTo(VIGNETTE_ANCHORS.castle),
    ).toBeLessThan(30);
    // No return-to-start: the arrival is the point.
    expect(stage.camera.position.distanceTo(heroPos)).toBeGreaterThan(30);
    // And the camera actually LOOKS at the castle.
    expect(
      stage.lookTarget.distanceTo(
        VIGNETTE_ANCHORS.castle.clone().add(new Vector3(0, 2.5, 0)),
      ),
    ).toBeLessThan(8);
  });

  it("focuses the city sweep on the TV tower and keeps its red pin in frame on a landscape phone (round-13 R13-2)", () => {
    // Round-13 device test: the sweep was "viel zu nah an der Stadt dran"
    // — the red marker above the tower left the frame exactly when the
    // camera flew over to it. The framing must aim at the tower's TOP
    // (not the whole-city average) and stay far enough back that the pin
    // is comfortably inside the frustum on a LANDSCAPE phone (fov 55 is
    // vertical, so landscape is the tightest vertical viewport).
    const stage = createStoryStage({
      world: buildClayWorld("low"),
      person: buildDotPerson(),
      markers: buildMarkerPair(),
      phone: buildPhoneFrame(),
      camera: new PerspectiveCamera(55, 915 / 412),
    });
    const timeline = buildStoryTimeline(stage, () => {});
    const pin = stage.world.getObjectByName("ar-skyline-pin");
    expect(pin).toBeDefined();

    // The CITY MOMENT — round-15 moved it EARLIER and made it BRIEF: the
    // camera is settled on the tower from ~4750 and swings away at 4850
    // ("gar nicht bei dem Turm verweilen, sondern viel früher auf dem
    // Turm sein und dann sofort weiter schwenken Richtung Zelte"). The
    // pin must sit inside the frame with margin (|ndc| < 0.85) across
    // that hold; asserting it past the swing would contradict R14-1/R15.
    for (const t of [4750, 4850]) {
      timeline.seek(t);
      syncStage(stage);
      stage.camera.lookAt(stage.lookTarget);
      stage.camera.updateMatrixWorld(true);
      stage.world.updateWorldMatrix(true, true);
      const pinCenter = new Box3().setFromObject(pin!).getCenter(new Vector3());
      const ndc = pinCenter.project(stage.camera);
      expect(Math.abs(ndc.x), `pin ndc.x at ${t}`).toBeLessThan(0.85);
      expect(Math.abs(ndc.y), `pin ndc.y at ${t}`).toBeLessThan(0.85);
      expect(ndc.z, `pin behind camera at ${t}`).toBeLessThan(1);
    }

    // The look target sits ON the tower (x/z), at a MID height — portrait
    // follow-up: lowered from the tower top (y18) so the tower rises into
    // the upper frame and the park shows below; still well above the
    // ground-average city height, and the pin stays in frame (above).
    timeline.seek(4800);
    syncStage(stage);
    expect(
      Math.hypot(
        stage.lookTarget.x - SKYLINE_TOWER_POS.x,
        stage.lookTarget.z - SKYLINE_TOWER_POS.z,
      ),
    ).toBeLessThan(2);
    expect(stage.lookTarget.y).toBeGreaterThan(5);
    expect(stage.lookTarget.y).toBeLessThan(14);
  });

  it("pops the campus arrows one by one over the camp and spawns the castle ghost on approach (round-13 R13-4)", () => {
    // Round-13: the vignettes' AR overlays must not sit pre-built in the
    // scene — the arrows pop up one after another ("nach und nach plopp
    // plopp plopp") WHILE the camera flies over the tents, and the ghost
    // spawns in while flying toward the castle. Both must be COMPLETE by
    // the castle arrival so chapter end states (reduced motion) stay
    // whole compositions.
    const timeline = buildStoryTimeline(stage, () => {});
    const arrowGroup = stage.world.getObjectByName(VIGNETTE_NODE.campusArrows);
    const ghost = stage.world.getObjectByName(VIGNETTE_NODE.ghost);
    expect(arrowGroup).toBeDefined();
    expect(ghost).toBeDefined();
    const arrows = arrowGroup!.children;
    const ghostParts = ghost!.children;
    expect(arrows.length).toBeGreaterThanOrEqual(3);
    expect(ghostParts.length).toBeGreaterThanOrEqual(2);

    timeline.seek(4800); // settled on the tower: nothing has popped yet
    for (const arrow of arrows) {
      expect(arrow.scale.x).toBeLessThan(0.01);
    }
    for (const part of ghostParts) {
      expect(part.scale.x).toBeLessThan(0.01);
    }

    // Portrait feedback: the gallery box rises and covers the tents very
    // fast, so the arrows start as the box is only ~10 % visible (~5100)
    // and ALL stand by the time it is ~50 % visible — a very tight, fast
    // stagger. They are still down through the approach.
    timeline.seek(5000); // approaching the tents: nothing up yet
    for (const arrow of arrows) {
      expect(arrow.scale.x).toBeLessThan(0.01);
    }

    // Mid-spawn (~5160): the quick stagger is under way.
    timeline.seek(5160);
    const onRun = arrows.filter((a) => a.scale.x > 0.5).length;
    expect(onRun).toBeGreaterThan(0);
    expect(onRun).toBeLessThan(arrows.length); // …still staggering

    timeline.seek(5300); // all four already stand (fast spawn)
    for (const arrow of arrows) {
      expect(arrow.scale.x).toBeGreaterThan(0.9);
    }

    // Round-14 R14-4: the ghost tower may only fade in AFTER the camp is
    // behind us, while flying at the castle — not while still over the
    // tents.
    timeline.seek(5650);
    for (const part of ghostParts) {
      expect(part.scale.x).toBeLessThan(0.01);
    }

    timeline.seek(5820); // flying at the castle: ghost mid-spawn
    const spawned = ghostParts.filter((p) => p.scale.x > 0.5).length;
    expect(spawned).toBeGreaterThan(0);
    expect(spawned).toBeLessThan(ghostParts.length);

    timeline.seek(5990); // arrival: the ghost stands complete
    for (const part of ghostParts) {
      expect(part.scale.x).toBeGreaterThan(0.9);
    }

    // Scrubbing back re-hides everything (explicit {from,to} contract).
    timeline.seek(4500);
    for (const arrow of arrows) {
      expect(arrow.scale.x).toBeLessThan(0.01);
    }
    for (const part of ghostParts) {
      expect(part.scale.x).toBeLessThan(0.01);
    }
  });

  it("flies ALONG the travel direction over the camp and reaches the castle head-on (round-14 R14-1/R14-4)", () => {
    // Round-14 device test: over the tents the camera "bleibt halt so
    // seitlich" — it looked sideways AT the camp instead of along its own
    // flight path, so the tents read as a fly-by rather than a fly-over
    // and the castle appeared late. The journey must now look where it
    // is GOING: at the camp the view direction aligns with the
    // camp→castle travel axis, so the camera flies straight over the
    // tents and on into the castle.
    const timeline = buildStoryTimeline(stage, () => {});
    const travel = VIGNETTE_ANCHORS.castle
      .clone()
      .sub(VIGNETTE_ANCHORS.campus)
      .setY(0)
      .normalize();

    timeline.seek(5450); // over/at the camp
    syncStage(stage);
    const atCamp = stage.lookTarget
      .clone()
      .sub(stage.camera.position)
      .setY(0)
      .normalize();
    expect(atCamp.dot(travel)).toBeGreaterThan(0.6);

    // Still heading that way mid castle-approach (a straight run, not a
    // sideways drift).
    timeline.seek(5700);
    syncStage(stage);
    const toCastle = stage.lookTarget
      .clone()
      .sub(stage.camera.position)
      .setY(0)
      .normalize();
    expect(toCastle.dot(travel)).toBeGreaterThan(0.6);
  });

  // NOTE: round-14's "push the camp LEFT of the landscape copy panel" pin
  // is deliberately GONE — round-16 supersedes it. That pin encoded a
  // compromise (shove the tents to a frame edge to dodge a panel) which
  // is precisely what the round-16 device shot rejected: it cost the
  // framing of the tents and cut the AR arrows off. The requirement below
  // — camp centred-ish and every arrow on screen, in BOTH orientations —
  // is the honest replacement, and the pull-back that achieves it happens
  // to make the camp small enough that the panels no longer swallow it.
  it("frames the CAMP CENTRE with its AR arrows visible, in both orientations (round-16)", () => {
    // Round-16 device shot: over the camp the camera sat too CLOSE and
    // aimed PAST the tents (the castle ended up centred, one tent loomed
    // over the bottom edge, and the blue AR arrows were cut off at the
    // frame edge). The maintainer: "the camera should look more on the
    // center of the tents and be further away so that also the ar overlay
    // arrows are visible."
    //
    // So the thing to pin is exactly that: every arrow — and the camp
    // itself — inside the frustum with margin, in BOTH orientations,
    // across the camp dwell.
    for (const [label, aspect] of [
      ["landscape", 915 / 412],
      ["portrait", 412 / 915],
    ] as const) {
      const stage2 = createStoryStage({
        world: buildClayWorld("low"),
        person: buildDotPerson(),
        markers: buildMarkerPair(),
        phone: buildPhoneFrame(),
        camera: new PerspectiveCamera(55, aspect),
      });
      const timeline = buildStoryTimeline(stage2, () => {});
      const arrowGroup = stage2.world.getObjectByName(
        VIGNETTE_NODE.campusArrows,
      );
      expect(arrowGroup).toBeDefined();

      for (const t of [5200, 5400]) {
        timeline.seek(t);
        syncStage(stage2);
        stage2.camera.lookAt(stage2.lookTarget);
        stage2.camera.updateMatrixWorld(true);
        stage2.world.updateWorldMatrix(true, true);

        // The camp centre is genuinely FRAMED (not shoved to an edge).
        const camp = VIGNETTE_ANCHORS.campus
          .clone()
          .setY(1.5)
          .project(stage2.camera);
        expect(camp.z, `${label} ${t}: camp behind camera`).toBeLessThan(1);
        expect(Math.abs(camp.x), `${label} ${t}: camp x`).toBeLessThan(0.65);
        expect(Math.abs(camp.y), `${label} ${t}: camp y`).toBeLessThan(0.65);

        // …and EVERY AR arrow is on screen with margin.
        arrowGroup!.children.forEach((arrow, i) => {
          const ndc = arrow
            .getWorldPosition(new Vector3())
            .project(stage2.camera);
          expect(ndc.z, `${label} ${t}: arrow ${i} behind camera`).toBeLessThan(
            1,
          );
          expect(Math.abs(ndc.x), `${label} ${t}: arrow ${i} x`).toBeLessThan(
            0.9,
          );
          expect(Math.abs(ndc.y), `${label} ${t}: arrow ${i} y`).toBeLessThan(
            0.9,
          );
        });
      }
    }
  });

  it("has the castle in frame EARLY on the approach, on a landscape phone (round-14 R14-4)", () => {
    // The maintainer wants to "die Burg schon was früher sehen" and watch
    // the ghost tower fade in while flying at it — so the castle must be
    // inside the frustum well before the arrival settles.
    const landscape = createStoryStage({
      world: buildClayWorld("low"),
      person: buildDotPerson(),
      markers: buildMarkerPair(),
      phone: buildPhoneFrame(),
      camera: new PerspectiveCamera(55, 915 / 412),
    });
    const timeline = buildStoryTimeline(landscape, () => {});
    timeline.seek(5700); // mid-approach, long before the 5980 arrival
    syncStage(landscape);
    landscape.camera.lookAt(landscape.lookTarget);
    landscape.camera.updateMatrixWorld(true);
    const ndc = VIGNETTE_ANCHORS.castle
      .clone()
      .setY(3)
      .project(landscape.camera);
    expect(Math.abs(ndc.x)).toBeLessThan(0.9);
    expect(Math.abs(ndc.y)).toBeLessThan(0.9);
    expect(ndc.z).toBeLessThan(1); // in front of the camera
  });

  it("opens the portal INTERIOR while far out and closes it before the city; the frame never moves (round-14 R14-10, golden-hour rebuild)", () => {
    // Since the golden-hour rebuild the monument frame stands
    // permanently — the timeline only pops the bright interior world.
    const timeline = buildStoryTimeline(stage, () => {});
    const frame = stage.world.getObjectByName("forest-portal");
    expect(frame).toBeDefined();
    const portal = frame!.getObjectByName("portal-interior");
    expect(portal).toBeDefined();

    timeline.seek(3900); // works-anywhere copy only entering: still closed
    expect(portal!.scale.x).toBeLessThan(0.01);

    timeline.seek(4650); // box a big part of the screen: portal open
    expect(portal!.scale.x).toBeGreaterThan(0.9);

    timeline.seek(5200); // camera has turned to the city: closed again
    expect(portal!.scale.x).toBeLessThan(0.01);

    // Scrub back re-closes it (explicit {from,to} contract).
    timeline.seek(3900);
    expect(portal!.scale.x).toBeLessThan(0.01);

    // The monument frame stays full-scale through the whole story.
    for (const t of [0, 3900, 4650, 5200, 7000]) {
      timeline.seek(t);
      expect(frame!.scale.x, `frame @${t}`).toBeCloseTo(1);
    }
  });

  it("pops the parkour blocks in during works-anywhere (round-14 R14-12)", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    const blocks = stage.world.getObjectByName("parkour-blocks");
    expect(blocks).toBeDefined();
    const parts = blocks!.children;
    expect(parts.length).toBeGreaterThanOrEqual(3);

    timeline.seek(3800); // before: all hidden
    for (const b of parts) {
      expect(b.scale.x).toBeLessThan(0.01);
    }
    timeline.seek(4100); // works-anywhere: staggering in
    const up = parts.filter((b) => b.scale.x > 0.5).length;
    expect(up).toBeGreaterThan(0);
    timeline.seek(4700); // all standing
    for (const b of parts) {
      expect(b.scale.x).toBeGreaterThan(0.9);
    }
    // Scrub back re-hides them.
    timeline.seek(3800);
    for (const b of parts) {
      expect(b.scale.x).toBeLessThan(0.01);
    }
  });

  it("moves the camera between chapters when scrubbed", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const heroPos = stage.camera.position.clone();
    timeline.seek(chapterEndTime(1)); // end of QR chapter
    expect(stage.camera.position.distanceTo(heroPos)).toBeGreaterThan(1);
  });

  it("keeps the GPS rings still and reveals the averaging connectors during fusion", () => {
    // Round-2 R8: instead of wandering rings, the fusion chapter shows
    // STATIC scattered readings and draws connector lines whose meeting
    // point is the red pin — "average the scatter" as a picture. Neither
    // the rings nor the pin may move.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const rawStart = stage.markers.raw.position.clone();
    const fusedStart = stage.markers.fused.position.clone();
    expect(stage.markers.connectors.scale.x).toBeLessThan(0.01);

    const fusionStart = 2 * CHAPTER_DURATION_MS;
    for (let i = 1; i <= 8; i++) {
      timeline.seek(fusionStart + (i * CHAPTER_DURATION_MS) / 10);
      expect(stage.markers.raw.position.distanceTo(rawStart)).toBeLessThan(
        1e-6,
      );
      expect(stage.markers.fused.position.distanceTo(fusedStart)).toBeLessThan(
        1e-6,
      );
    }
    timeline.seek(chapterEndTime(2));
    expect(stage.markers.connectors.scale.x).toBeGreaterThan(0.9);
  });

  it("shrinks the accuracy ring UNDER the bouncing person and fades it out with the landing", () => {
    // Round-2 R6 set the collapse; round-8 Z1 re-timed it: the ring used
    // to be gone BEFORE the person arrived (dead stretch while
    // scrolling). Now it fades in late, shrinks WHILE the person bounces
    // on it, and disappears as the bouncing settles. All seek-driven;
    // scrubbing back restores the pre-drop sky position (covered by the
    // scrub-path-independence property).
    const timeline = buildStoryTimeline(stage, () => {});
    const ring = stage.world.getObjectByName(WORLD_NODE.snapRing);
    expect(ring).toBeDefined();
    const ringMaterial = (ring?.children[0] as Mesh | undefined)
      ?.material as MeshStandardMaterial;
    expect(ringMaterial).toBeDefined();

    timeline.seek(50);
    syncStage(stage);
    expect(stage.person.position.y).toBeGreaterThan(5); // still in the sky
    expect(stage.person.scale.x).toBeLessThan(0.01);

    timeline.seek(1250); // early in the chapter: ring NOT visible yet (Z1)
    expect(ringMaterial.opacity).toBeLessThan(0.1);

    timeline.seek(1450); // faded in, still LARGE (pre-drop)
    expect(ringMaterial.opacity).toBeGreaterThan(0.5);
    expect(ring?.scale.x ?? 0).toBeGreaterThan(2);

    timeline.seek(1700); // mid-bounce: visible AND mid-shrink (Z1 overlap)
    syncStage(stage);
    expect(ringMaterial.opacity).toBeGreaterThan(0.5);
    expect(ring?.scale.x ?? 0).toBeGreaterThan(0.2);
    expect(ring?.scale.x ?? 99).toBeLessThan(2.5);
    expect(stage.person.scale.x).toBeCloseTo(1, 2); // person already down here

    timeline.seek(chapterEndTime(1)); // QR chapter done: bounce settled…
    syncStage(stage);
    expect(ring?.scale.x ?? 99).toBeLessThan(0.2); // collapsed = precise fix
    expect(ringMaterial.opacity).toBeLessThan(0.1); // …and the ring is gone
    expect(stage.person.position.y).toBeCloseTo(0, 2); // landed
    expect(stage.person.scale.x).toBeCloseTo(1, 2);
  });

  it("walks the dot-person along the path as the story progresses", () => {
    // Contract: after every seek the render loop calls syncStage — anime
    // fires onUpdate BEFORE tween values apply, so deriving person
    // placement inside the callback would lag one seek behind.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    syncStage(stage);
    const start = stage.person.position.clone();
    timeline.seek(chapterEndTime(2));
    syncStage(stage);
    expect(stage.person.position.distanceTo(start)).toBeGreaterThan(3);
    // Walking means staying on the ground.
    expect(stage.person.position.y).toBeCloseTo(0, 3);
  });

  it("reveals the AR content + phone during the dive", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const phoneScaleBefore = stage.phone.scale.x;
    timeline.seek(chapterEndTime(3)); // end of dive
    expect(stage.phone.scale.x).toBeGreaterThan(phoneScaleBefore);
    // The AR content must be fully in place while looking through the
    // phone window (round-1 feedback: overlays live in the WORLD now).
    const arContent = stage.world.getObjectByName(WORLD_NODE.arContent);
    expect(arContent?.scale.x ?? 0).toBeGreaterThan(0.9);
  });

  it("sequences the dive (round-4 V2 + round-5 W2/W3): camera settles at the LEFT shoulder, phone launches WITH the person fade, AR appears with the phone's arrival", () => {
    // Round-4 set the dramaturgy (camera in close → phone → AR); round-5
    // refined it: the camera stops beside the LEFT shoulder instead of
    // above the head, and the phone must launch the MOMENT the person
    // starts fading (the round-4 gap — person long gone, empty frame,
    // phone arrives late — was explicitly flagged). AR still waits for
    // the phone's arrival.
    const timeline = buildStoryTimeline(stage, () => {});
    const arContent = stage.world.getObjectByName(WORLD_NODE.arContent);

    timeline.seek(3510); // just after the person fade begins (3480)
    syncStage(stage);
    expect(stage.person.scale.x).toBeLessThan(1); // fading out...
    expect(stage.phone.scale.x).toBeGreaterThan(0.05); // ...phone launching

    timeline.seek(3550); // camera-settle time (framing tweens = 55% window)
    syncStage(stage);
    const offsetX = stage.camera.position.x - stage.person.position.x;
    const offsetZ = stage.camera.position.z - stage.person.position.z;
    expect(Math.hypot(offsetX, offsetZ)).toBeLessThan(1.0); // in close
    expect(stage.camera.position.y).toBeLessThan(1.7); // shoulder, not overhead
    // On the person's LEFT: left = up × walking direction = (tz, 0, -tx).
    const tangent = stage.curve.getTangentAt(0.5);
    expect(offsetX * tangent.z + offsetZ * -tangent.x).toBeGreaterThan(0.25);

    timeline.seek(3700); // phone mid-flight
    expect(stage.person.scale.x).toBeLessThan(0.01); // person gone
    expect(stage.phone.scale.x).toBeGreaterThan(0.1);
    expect(arContent?.scale.x ?? 99).toBeLessThan(0.05); // AR still waiting

    timeline.seek(chapterEndTime(3)); // phone at target
    expect(stage.phone.scale.x).toBeGreaterThan(0.9);
    expect(arContent?.scale.x ?? 0).toBeGreaterThan(0.9); // faded in with it
  });

  it("grows the phone monotonically — no overshoot-and-shrink (round-7 Y4)", () => {
    // Round-7 feedback: the frame briefly filled the screen, then visibly
    // SHRANK again — the outBack scale-in overshoots ~10 % past the final
    // size and settles back. The scale must never decrease while the
    // phone is on its way in.
    const timeline = buildStoryTimeline(stage, () => {});
    let previous = 0;
    for (let t = 3480; t <= chapterEndTime(3); t += 5) {
      timeline.seek(t);
      expect(stage.phone.scale.x).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = stage.phone.scale.x;
    }
  });

  it("hides the person inside the phone view and restores them on the pull-back", () => {
    // Once the camera is "inside" the phone view the person disappears
    // (you cannot see yourself through your own phone) and returns on the
    // pull-back. (The round-2 R10 arm raise was removed in round-5 W1.)
    const timeline = buildStoryTimeline(stage, () => {});

    timeline.seek(2999); // just before the dive: walking, fully visible
    expect(stage.person.scale.x).toBeCloseTo(1, 2);

    timeline.seek(chapterEndTime(3)); // inside the phone view
    expect(stage.person.scale.x).toBeLessThan(0.01);

    timeline.seek(chapterEndTime(4)); // pulled back out
    expect(stage.person.scale.x).toBeCloseTo(1, 2);
  });

  it("notifies the render loop on every scrub update", () => {
    let updates = 0;
    const timeline = buildStoryTimeline(stage, () => {
      updates++;
    });
    timeline.seek(1234);
    expect(updates).toBeGreaterThan(0);
  });

  it("scrubbing back to the start restores the hero framing", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const heroPos = stage.camera.position.clone();
    timeline.seek(chapterEndTime(4));
    timeline.seek(50);
    expect(stage.camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
  });
});

describe("buildIntroTimeline", () => {
  it("is a short, finite auto-intro that ends on the hero framing", () => {
    const stage = makeStage();
    const story = buildStoryTimeline(stage, () => {});
    story.seek(0);
    const heroPos = stage.camera.position.clone();

    const intro = buildIntroTimeline(stage, () => {});
    expect(intro.duration).toBeGreaterThan(500);
    expect(intro.duration).toBeLessThan(4000);
    intro.seek(intro.duration);
    // The intro must hand over seamlessly: its end state is the story's
    // hero framing (otherwise the first scroll would jump-cut).
    expect(stage.camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
    // The person stays hidden through the intro — they enter the story by
    // sky-dropping at the QR chapter (round-2 R6).
    expect(stage.person.scale.x).toBeLessThan(0.01);
  });
});

describe("createStoryStage", () => {
  it("stacks rings, connectors and pin on ONE anchor and places the person at the walk start", () => {
    const stage = makeStage();
    // Round-2 R5: pin and ring group share the anchor — the rings scatter
    // via their internal offsets, whose average is the pin.
    expect(
      stage.markers.raw.position.distanceTo(stage.markers.fused.position),
    ).toBeLessThan(0.01);
    expect(
      stage.markers.connectors.position.distanceTo(
        stage.markers.fused.position,
      ),
    ).toBeLessThan(0.01);
    expect(stage.person.position.length()).toBeGreaterThan(0); // on the path, not at origin
    // Lens target starts at the world center so the hero framing looks at
    // the miniature world.
    expect(stage.lookTarget).toBeInstanceOf(Vector3);
  });

  it("anchors the phone so its SCREEN fills the mobile viewport at final size (round-7 Y4, supersedes round-5 W4)", () => {
    // Round-7 feedback: AR objects (markers, label, arrows) must never be
    // visible OUTSIDE the phone screen on phones — impossible in reality.
    // So at the anchor distance the 0.82×1.72 screen plane must cover the
    // FULL mobile-portrait width, and the frame's outer edge (bars up to
    // ±0.95) must reach past the frustum's top/bottom so the remainder is
    // frame, not world. (Round-5 W4's "frame fits entirely with margin"
    // pin is deliberately gone — visible edge bars + the glass screen now
    // carry the "this is a phone" message instead.)
    const stage = makeStage();
    const distance = Math.abs(stage.phone.position.z);
    const halfHeight =
      Math.tan(((stage.camera.fov / 2) * Math.PI) / 180) * distance;
    const halfWidthPortrait = halfHeight * (412 / 915);
    // Screen half-width 0.41 covers the portrait frustum width…
    expect(0.41 - Math.abs(stage.phone.position.x)).toBeGreaterThanOrEqual(
      halfWidthPortrait,
    );
    // …and the frame reaches past the viewport's top/bottom edge.
    expect(0.95 - Math.abs(stage.phone.position.y)).toBeGreaterThanOrEqual(
      halfHeight,
    );
  });
});

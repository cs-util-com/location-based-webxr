/**
 * Why these tests matter: a free item is the owner of its station's world,
 * not a step of a story. A character stands from arrival, on every return
 * and beside others; his voice obeys the visitor's one voice channel; and
 * walking away pauses him and his return carries on. All of that happens
 * without a story, so nothing else in the viewer would notice if it broke.
 */
import { Object3D } from "three";
import { describe, expect, it } from "vitest";

import type { TourFreeCharacter } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { createFreeItems, type FreeItemsDeps } from "./free-items.js";
import type { NarrationPlayer } from "./narration-player.js";
import { withFreeBlocks } from "./test-support/station-content.js";
import { createVoiceFocus } from "./voice-focus.js";
import type { CharacterVoice } from "./character-look.js";

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] } as const;

function character(
  id: string,
  extra: Partial<TourFreeCharacter> = {},
): TourFreeCharacter {
  return {
    id,
    kind: "character",
    view: "speak",
    name: id,
    image: `${id}-image`,
    caption: `Hello from ${id}`,
    voice: `${id}-voice`,
    pose: POSE,
    ...extra,
  } as TourFreeCharacter;
}

/** A stage as the host drives it, with what a test reads. */
function fakeStage() {
  const part = new Object3D();
  return {
    shown: [] as { stationId: string; view: string | undefined }[],
    voices: [] as (readonly [CharacterVoice, number | undefined])[],
    released: 0,
    cleared: 0,
    bubbles: 0,
    faced: 0,
    part,
    standing: false,
    showCharacter(
      stationId: string,
      _image: Blob,
      _onWaiting?: () => void,
      look?: { view: string },
    ) {
      this.shown.push({ stationId, view: look?.view });
      this.standing = true;
      return Promise.resolve();
    },
    setVoice(voice: CharacterVoice, ms?: number) {
      this.voices.push([voice, ms]);
    },
    release() {
      this.released += 1;
      this.standing = false;
    },
    clear() {
      this.cleared += 1;
      this.standing = false;
    },
    characterTapTargets() {
      return this.standing ? [this.part] : [];
    },
    toggleBubble() {
      this.bubbles += 1;
    },
    faceVisitor() {
      this.faced += 1;
    },
    follow: () => undefined,
  };
}

/** A player whose file ends when the test says so. */
function fakePlayer(deps: {
  load(): Promise<Blob>;
  onError?(e: unknown): void;
}) {
  const listeners = new Set<() => void>();
  let wanted = false;
  let at = 0;
  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  return {
    load: deps.load,
    fail(error: unknown) {
      wanted = false;
      notify();
      deps.onError?.(error);
    },
    finish() {
      wanted = false;
      at = 1000;
      notify();
    },
    advance(ms: number) {
      at = ms;
      notify();
    },
    disposed: false,
    nowMs: () => at,
    durationMs: () => 1000,
    playing: () => wanted,
    play() {
      wanted = true;
      notify();
    },
    pause() {
      wanted = false;
      notify();
    },
    seek(ms: number) {
      at = ms;
      notify();
    },
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      this.disposed = true;
    },
  } satisfies NarrationPlayer & Record<string, unknown>;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function make(
  blocks: readonly TourFreeCharacter[] = [character("ann")],
  over: Partial<FreeItemsDeps> = {},
) {
  const base = { id: "gate", title: "Gate", children: [] };
  const station = { ...base, ...withFreeBlocks(base, blocks as never) };
  let tour: ReturnType<FreeItemsDeps["tour"]> = withTour(station as never);
  const stages: ReturnType<typeof fakeStage>[] = [];
  const players: ReturnType<typeof fakePlayer>[] = [];
  const failures: string[] = [];
  const focus = createVoiceFocus();
  let hit: string | null = null;
  const seen: Map<string, Object3D>[] = [];
  const free = createFreeItems({
    tour: () => tour,
    characters: () => new Map(),
    assets: () =>
      new Map(
        blocks.flatMap((b): [string, unknown][] => [
          [b.image, { id: b.image, path: `${b.image}.png`, kind: "image" }],
          ...(b.voice === undefined
            ? []
            : ([
                [
                  b.voice,
                  { id: b.voice, path: `${b.voice}.ogg`, kind: "audio" },
                ],
              ] as [string, unknown][])),
        ]),
      ) as never,
    loadAsset: () => Promise.resolve(new Blob(["x"])),
    makeStage: () => {
      const stage = fakeStage();
      stages.push(stage);
      return stage;
    },
    focus,
    checkPicture: () => Promise.resolve(null),
    pick: (targets) => {
      seen.push(new Map(targets));
      return hit;
    },
    sayFailure: (text) => failures.push(text),
    makePlayer: (deps) => {
      const player = fakePlayer(deps);
      players.push(player);
      return player;
    },
    ...over,
  });
  const here = (id: string) => id === "gate";
  const away = () => false;
  return {
    free,
    focus,
    stages,
    players,
    failures,
    seen,
    here,
    away,
    /** A tap on the stage holding `stage`'s figure. */
    tap(stage: ReturnType<typeof fakeStage>) {
      seen.length = 0;
      hit = null;
      free.tapped(null);
      const key = [...(seen[0] ?? new Map<string, Object3D>())].find(
        ([, part]) => part === stage.part,
      )?.[0];
      hit = key ?? null;
      return free.tapped(null);
    },
    closeTour() {
      tour = null;
    },
    reopen(next: ReturnType<FreeItemsDeps["tour"]>) {
      tour = next;
    },
  };
}

function withTour(station: never): ReturnType<FreeItemsDeps["tour"]> {
  return { stations: [station] };
}

describe("createFreeItems", () => {
  // Why: the owner's rule: a free character stands as a figure from arrival,
  // and several may stand in one station. None of them depends on a story.
  it("stands every free character of a station from arrival, none elsewhere", async () => {
    const { free, stages, here, away } = make([
      character("ann"),
      character("bob", { view: "popup" }),
    ]);
    free.follow(away);
    expect(stages.flatMap((s) => s.shown)).toEqual([]);
    free.follow(here);
    await settle();
    expect(stages.flatMap((s) => s.shown)).toEqual([
      { stationId: "gate", view: "speak" },
      { stationId: "gate", view: "popup" },
    ]);
    // One stage each: a stage holds one thing at a time.
    expect(new Set(stages).size).toBe(2);
    free.follow(here);
    await settle();
    expect(stages.flatMap((s) => s.shown)).toHaveLength(2);
  });

  // Why: he stands on every return, not once like a story's figure that was
  // let go, and leaving frees what he holds.
  it("lets him go on leaving and stands him again on every return", async () => {
    const { free, stages, here, away } = make();
    free.follow(here);
    await settle();
    free.follow(away);
    expect(stages[0]!.released).toBe(1);
    free.follow(here);
    await settle();
    expect(stages[0]!.shown).toHaveLength(2);
  });

  it("says when he cannot be shown, and tries again only on a return", async () => {
    const { free, failures, here, away } = make([character("ann")], {
      loadAsset: () => Promise.reject(new Error("broken")),
    });
    free.follow(here);
    free.follow(here);
    await settle();
    expect(failures).toEqual(["ann could not be shown here."]);
    free.follow(away);
    free.follow(here);
    await settle();
    expect(failures).toHaveLength(2);
  });

  // Why: a load that lands after he was left must not stand him in a station
  // the visitor has walked out of.
  it("drops a figure whose file lands after the visitor left", async () => {
    const { free, stages, here, away } = make();
    free.follow(here);
    free.follow(away);
    await settle();
    expect(stages[0]!.shown).toEqual([]);
  });

  // Why: a tap plays him, a tap while he speaks stops him and leaves him off
  // until tapped, and he tells his look so its ring follows.
  it("a tap plays his voice, and a tap while he speaks stops it for good", async () => {
    const t = make();
    t.free.follow(t.here);
    await settle();
    const stage = t.stages[0]!;
    expect(t.tap(stage)).toBe(true);
    const player = t.players[0]!;
    expect(player.playing()).toBe(true);
    expect(stage.voices.at(-1)).toEqual(["speaking", 1000]);
    player.advance(400);
    t.tap(stage);
    expect(player.playing()).toBe(false);
    expect(player.nowMs()).toBe(0);
    expect(stage.voices.at(-1)).toEqual(["idle", undefined]);
    expect(t.focus.running()).toBeNull();
    t.free.follow(t.here);
    expect(player.playing()).toBe(false);
  });

  it("a voice that runs out marks him heard, one that never played does not", async () => {
    const t = make();
    t.free.follow(t.here);
    await settle();
    const stage = t.stages[0]!;
    t.tap(stage);
    const player = t.players[0]!;
    player.finish();
    expect(stage.voices.at(-1)).toEqual(["spoken", undefined]);
    expect(t.focus.running()).toBeNull();

    player.seek(0);
    t.tap(stage);
    player.fail(new Error("no"));
    expect(stage.voices.at(-1)).toEqual(["idle", undefined]);
    expect(t.failures).toEqual(["The voice could not be played here."]);
  });

  // Why: one voice is heard: tapping a second figure pauses the first, and
  // the first carries on when the second ends.
  it("a tap on another figure pauses the first, which carries on after", async () => {
    const t = make([character("ann"), character("bob")]);
    t.free.follow(t.here);
    await settle();
    t.tap(t.stages[0]!);
    t.tap(t.stages[1]!);
    const [ann, bob] = t.players;
    expect(ann!.playing()).toBe(false);
    expect(bob!.playing()).toBe(true);
    expect(t.stages[0]!.voices.at(-1)).toEqual(["idle", undefined]);
    bob!.finish();
    expect(ann!.playing()).toBe(true);
    expect(t.stages[0]!.voices.at(-1)?.[0]).toBe("speaking");
  });

  // Why: "walking away pauses every free voice, and they carry on at
  // return"; a voice the visitor stopped himself must not come back.
  it("walking away pauses his voice and his return carries on from there", async () => {
    const t = make();
    t.free.follow(t.here);
    await settle();
    const stage = t.stages[0]!;
    t.tap(stage);
    const player = t.players[0]!;
    player.advance(400);
    t.free.follow(t.away);
    expect(player.playing()).toBe(false);
    expect(t.focus.running()).toBeNull();
    t.free.follow(t.here);
    expect(player.playing()).toBe(true);
    expect(player.nowMs()).toBe(400);
    expect(stage.voices.at(-1)).toEqual(["speaking", 600]);

    await settle();
    t.tap(stage);
    t.free.follow(t.away);
    t.free.follow(t.here);
    expect(player.playing()).toBe(false);
  });

  // Why: no waiting line: coming back while another voice runs leaves him
  // paused at his place, and a tap takes him up from there.
  it("stays paused at a return while another voice runs, and a tap continues", async () => {
    const t = make();
    t.free.follow(t.here);
    await settle();
    t.tap(t.stages[0]!);
    const player = t.players[0]!;
    player.advance(400);
    t.free.follow(t.away);
    t.focus.tapped({
      hold: () => undefined,
      carryOn: () => undefined,
      stop: () => undefined,
    });
    t.free.follow(t.here);
    expect(player.playing()).toBe(false);
    await settle();
    t.tap(t.stages[0]!);
    expect(player.playing()).toBe(true);
    expect(player.nowMs()).toBe(400);
  });

  it("the bubble view shuts its bubble and plays nothing; no voice plays nothing", async () => {
    const t = make([
      character("ann", { view: "bubble" }),
      { ...character("bob"), voice: undefined } as never,
    ]);
    t.free.follow(t.here);
    await settle();
    expect(t.tap(t.stages[0]!)).toBe(true);
    expect(t.stages[0]!.bubbles).toBe(1);
    expect(t.tap(t.stages[1]!)).toBe(true);
    expect(t.players).toEqual([]);
  });

  it("takes no tap that hits none of them, and casts nothing while none stands", async () => {
    const t = make();
    expect(t.free.tapped(null)).toBe(false);
    expect(t.seen).toEqual([]);
    t.free.follow(t.here);
    await settle();
    expect(t.free.tapped(null)).toBe(false);
    expect(t.seen[0]?.size).toBe(1);
  });

  it("turns standing figures to the visitor", async () => {
    const t = make();
    t.free.follow(t.here);
    await settle();
    t.free.faceVisitor([1, 2, 3]);
    expect(t.stages[0]!.faced).toBe(1);
  });

  // Why: a session's end clears the stage and the channel; the next session
  // starts him afresh, and another tour's figures never meet the old ones.
  it("stop clears everything, and a new tour starts afresh", async () => {
    const t = make();
    t.free.follow(t.here);
    await settle();
    t.tap(t.stages[0]!);
    t.free.stop();
    expect(t.stages[0]!.cleared).toBe(1);
    expect(t.players[0]!.disposed).toBe(true);
    expect(t.focus.running()).toBeNull();
    t.free.follow(t.here);
    await settle();
    expect(t.stages).toHaveLength(2);

    t.closeTour();
    t.free.follow(t.here);
    expect(t.stages[1]!.cleared).toBe(1);
    expect(t.stages).toHaveLength(2);
  });

  it("stands nothing while no tour is open", () => {
    const t = make();
    t.closeTour();
    t.free.follow(t.here);
    expect(t.stages).toEqual([]);
  });
});

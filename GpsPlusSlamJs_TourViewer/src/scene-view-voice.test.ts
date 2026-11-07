/**
 * Why this test matters: a story's clip plays through the page's `<video>`,
 * not the sound channel, so the voice channel hears of it only through the
 * view. A clip that starts must take the channel, a re-play after a hold
 * must not be swallowed by the step's own "already playing" guard, and
 * leaving the step must give the channel back, or a paused free voice would
 * never carry on.
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it, vi } from "vitest";

import { createSceneView, type SceneViewDom } from "./scene-view.js";
import { stationContent, storyOf } from "./test-support/station-content.js";

function element() {
  return { hidden: true, textContent: "", src: "", alt: "" };
}

function harness() {
  const video = {
    ...element(),
    poster: "",
    onended: null as (() => void) | null,
    onplay: null as (() => void) | null,
    onerror: null,
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
  const dom = {
    panel: element(),
    title: element(),
    description: element(),
    speaker: element(),
    text: element(),
    status: element(),
    image: element(),
    stationImage: element(),
    video,
    choices: { replaceChildren: vi.fn() },
    continueButton: element(),
    playNext: element(),
  } as unknown as SceneViewDom;
  const videoVoice = { started: vi.fn(), ended: vi.fn() };
  const view = createSceneView({
    dom,
    assets: new Map([
      ["clip", { id: "clip", path: "clip.mp4", kind: "video" }],
    ]) as never,
    loadAsset: () => Promise.resolve(new Blob(["x"])),
    audio: { play: () => Promise.resolve(), stop: () => undefined },
    stage: {
      showCharacter: () => Promise.resolve(),
      showModel: () => Promise.resolve(),
      clear: () => undefined,
    },
    checkPicture: () => Promise.resolve(null),
    createChoiceButton: () => ({}) as Node,
    schedule: () => () => undefined,
    objectUrls: { create: () => "blob:x", revoke: () => undefined },
    onStoryEnd: () => undefined,
    videoVoice,
  });
  return { view, video, videoVoice };
}

const STATION = {
  id: "s",
  ...stationContent([
    storyOf("film", [
      {
        id: "clip-step",
        kind: "video",
        view: "card",
        video: "clip",
        transcript: "The gate opens at dawn.",
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      },
    ]),
  ]),
} as unknown as TourStation;

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a story's clip in the voice channel", () => {
  it("takes the channel each time it starts, and gives it back with the step", async () => {
    const { view, video, videoVoice } = harness();
    view.offer(STATION);
    await settle();
    videoVoice.ended.mockClear();
    video.onplay?.();
    video.onplay?.();
    expect(videoVoice.started).toHaveBeenCalledTimes(2);
    video.onended?.();
    expect(videoVoice.ended).toHaveBeenCalledTimes(1);
    view.continueTapped();
    expect(videoVoice.ended.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives the channel back when the clip cannot play", async () => {
    const { view, video, videoVoice } = harness();
    view.offer(STATION);
    await settle();
    videoVoice.ended.mockClear();
    (video as unknown as { onerror: () => void }).onerror();
    expect(videoVoice.ended).toHaveBeenCalledTimes(1);
  });
});

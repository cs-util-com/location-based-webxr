// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createCameraControl, type CameraDeps } from "./camera-control";

function fakeStream() {
  const track = { stop: vi.fn() };
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
    track,
  };
}

function setup(getUserMedia: CameraDeps["getUserMedia"]) {
  const video = document.createElement("video");
  video.play = vi.fn(() => Promise.resolve());
  const deps = {
    getUserMedia,
    log: vi.fn(),
    fail: vi.fn(),
    changed: vi.fn(),
  };
  return { video, deps, cam: createCameraControl(video, deps) };
}

// Why these tests matter: the camera must never run beside a timed run (it
// costs the CPU and GPU being measured), and a second tap must not open a
// second stream. Both views of the page share this one implementation.
describe("createCameraControl", () => {
  it("opens one stream for two taps and stops it", async () => {
    const { stream, track } = fakeStream();
    const gum = vi.fn(() => Promise.resolve(stream));
    const { cam, deps, video } = setup(gum);
    const [a, b] = await Promise.all([cam.start(), cam.start()]);
    expect([a, b]).toEqual(["on", "on"]);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBe(stream);
    expect(cam.on()).toBe(true);
    cam.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(deps.changed.mock.calls).toEqual([[true], [false]]);
  });

  it("stops a stream that arrives after a stop", async () => {
    const { stream, track } = fakeStream();
    let release: (s: MediaStream) => void = () => undefined;
    const gum = vi.fn(
      () =>
        new Promise<MediaStream>((r) => {
          release = r;
        }),
    );
    const { cam } = setup(gum);
    const started = cam.start();
    cam.stop();
    release(stream);
    expect(await started).toBe("stopped");
    expect(track.stop).toHaveBeenCalled();
    expect(cam.on()).toBe(false);
  });

  it("reports a refused camera and tries again on the next tap", async () => {
    const gum = vi.fn(() => Promise.reject(new Error("denied")));
    const { cam, deps } = setup(gum);
    expect(await cam.start()).toBe("failed");
    expect(deps.fail).toHaveBeenCalledWith("camera", expect.any(Error));
    expect(await cam.start()).toBe("failed");
    expect(gum).toHaveBeenCalledTimes(2);
  });

  // Why: a stop while the permission prompt is still open, then a start
  // again (leaving and re-entering the run screen), must open a new stream;
  // handing back the old start would resolve "stopped" and leave the
  // camera off on the run screen.
  it("starts again after a stop that came during a pending start", async () => {
    const first = fakeStream();
    const second = fakeStream();
    const releases: ((s: MediaStream) => void)[] = [];
    const gum = vi.fn(
      () =>
        new Promise<MediaStream>((r) => {
          releases.push(r);
        }),
    );
    const { cam, video } = setup(gum);
    const old = cam.start();
    cam.stop();
    const again = cam.start();
    expect(gum).toHaveBeenCalledTimes(2);
    releases[0]!(first.stream);
    expect(await old).toBe("stopped");
    expect(first.track.stop).toHaveBeenCalled();
    releases[1]!(second.stream);
    expect(await again).toBe("on");
    expect(video.srcObject).toBe(second.stream);
    // The old start settling must not forget the new one: a tap while the
    // second runs gets "on" without a third stream.
    expect(await cam.start()).toBe("on");
    expect(gum).toHaveBeenCalledTimes(2);
  });
});

// Why this test matters: each photo records what the camera reports; the
// control hands out the running track's report and none when it is off.
describe("the camera report", () => {
  it("reports the running track, and null when the camera is off", async () => {
    const { stream, track } = fakeStream();
    Object.assign(track, { getSettings: () => ({ zoom: 2, deviceId: "x" }) });
    const { cam } = setup(() => Promise.resolve(stream));
    expect(cam.report()).toBeNull();
    await cam.start();
    expect(cam.report()).toEqual({ zoom: 2 });
    cam.stop();
    expect(cam.report()).toBeNull();
  });

  // Why: the report describes the camera; a stream whose first track is
  // not the video one (an audio track listed first) must still report
  // the video track's settings.
  it("reports the video track, whatever the stream lists first", async () => {
    const audio = { stop: vi.fn(), getSettings: () => ({ zoom: 9 }) };
    const video = { stop: vi.fn(), getSettings: () => ({ zoom: 2 }) };
    const stream = {
      getTracks: () => [audio, video],
      getVideoTracks: () => [video],
    } as unknown as MediaStream;
    const { cam } = setup(() => Promise.resolve(stream));
    await cam.start();
    expect(cam.report()).toEqual({ zoom: 2 });
  });
});

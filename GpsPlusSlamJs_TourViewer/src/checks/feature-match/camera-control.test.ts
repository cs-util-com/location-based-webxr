// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createCameraControl, type CameraDeps } from "./camera-control";

function fakeStream() {
  const track = { stop: vi.fn() };
  return {
    stream: { getTracks: () => [track] } as unknown as MediaStream,
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
});

import { describe, expect, it, vi } from "vitest";

import { buildPack, runDrip } from "./drip.mjs";

// Why this test matters: this is the one function that can actually publish.
// Its defaults therefore have to be the safe ones, and "safe" has to hold
// even when several things are misconfigured at once — the accident happens
// when someone passes --post with a half-set-up channel table, not when
// everything is as intended.

const NOW = 1_800_000_000_000;
const ORIGIN = "https://gps.csutil.com";

const channels = {
  bluesky: { autonomy: "auto", minIntervalMs: 1000 },
  x: { autonomy: "manual", minIntervalMs: 1000 },
};

const item = (o = {}) => ({
  id: "i1",
  channel: "bluesky",
  status: "approved",
  queuedAt: NOW - 1000,
  title: "Why outdoor WebXR drifts",
  slug: "why-outdoor-webxr-drifts",
  ...o,
});

describe("runDrip", () => {
  it("does not post unless explicitly told to", async () => {
    const send = vi.fn();

    const result = await runDrip({
      queue: [item()],
      history: {},
      now: NOW,
      channels,
      transports: { bluesky: send },
      // no `post` — the default must be the safe one
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.posted).toEqual([]);
    expect(result.packs).toHaveLength(1);
  });

  it("posts when told to, on a channel that has graduated", async () => {
    const send = vi.fn();

    const result = await runDrip({
      queue: [item()],
      history: {},
      now: NOW,
      channels,
      transports: { bluesky: send },
      post: true,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.posted).toEqual(["i1"]);
  });

  it("still refuses to post a review-only channel, even with --post", async () => {
    // Belt: the autonomy level outranks the flag.
    const send = vi.fn();

    const result = await runDrip({
      queue: [item({ id: "x1", channel: "x" })],
      history: {},
      now: NOW,
      channels,
      transports: { x: send },
      post: true,
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.packs[0].channel).toBe("x");
  });

  it("produces a pack rather than posting when a transport is missing", async () => {
    // Braces: an 'auto' channel with no sender must not look like a success.
    const result = await runDrip({
      queue: [item()],
      history: {},
      now: NOW,
      channels,
      transports: {},
      post: true,
    });

    expect(result.posted).toEqual([]);
    expect(result.packs).toHaveLength(1);
  });

  it("refuses to run at all on an unusable channel table", async () => {
    await expect(
      runDrip({
        queue: [],
        history: {},
        now: NOW,
        channels: { broken: { autonomy: "auto" } },
      }),
    ).rejects.toThrow(/minIntervalMs/);
  });

  it("explains every held item in the log", async () => {
    const lines = [];
    await runDrip({
      queue: [item({ id: "held", status: "draft" })],
      history: {},
      now: NOW,
      channels,
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).toMatch(/held:.*held.*not approved/i);
  });
});

describe("buildPack", () => {
  it("gives X a prefilled composer link and warns about media", () => {
    const pack = buildPack(item({ channel: "x", text: "Short post" }), {
      origin: ORIGIN,
    });

    expect(pack.instructions.join(" ")).toContain("x.com/intent/post");
    expect(pack.instructions.join(" ")).toMatch(/media|image/i);
  });

  it("gives Medium the import steps, not an API payload", () => {
    const pack = buildPack(item({ channel: "medium" }), { origin: ORIGIN });

    expect(pack.payload).toBeUndefined();
    expect(pack.instructions.join(" ")).toMatch(/import/i);
  });

  it("tells a human posting to a community to check its rules first", () => {
    const pack = buildPack(item({ channel: "reddit" }), { origin: ORIGIN });

    expect(pack.instructions.join(" ")).toMatch(/self-promotion rules/i);
  });

  it("builds a real API payload for dev.to, carrying the canonical link", () => {
    const pack = buildPack(item({ channel: "devto", tags: ["webxr"] }), {
      origin: ORIGIN,
    });

    expect(pack.payload.article.canonical_url).toBe(
      `${ORIGIN}/blog/why-outdoor-webxr-drifts/`,
    );
  });

  it("falls back to a hand-send instruction for a channel it does not know", () => {
    const pack = buildPack(item({ channel: "linkedin" }), { origin: ORIGIN });

    expect(pack.instructions.join(" ")).toMatch(/by hand/i);
  });
});

import { describe, expect, it } from "vitest";

import type { DeviceInfo } from "./bench-report";
import type { ResultEntry } from "./feature-match-slice";
import {
  LOG_FILE,
  RUN_FRAMES_FORMAT,
  runZipFiles,
  shotFile,
  SUMMARY_FILE,
  type RunZipInput,
} from "./run-zip";
import {
  EMPTY_PLAN,
  planReducer,
  type PhotoMeta,
  type RunPlan,
} from "./run-plan";

const device = { userAgent: "test", model: null } as unknown as DeviceInfo;

const photoOf = (id: string, greyMean = 120): PhotoMeta => ({
  id,
  width: 640,
  height: 480,
  source: { width: 1920, height: 1080 },
  greyMean,
  greySd: 40.123,
});

const shoot = (plan: RunPlan, shots: [string, string][]): RunPlan =>
  shots.reduce(
    (p, [shot, id]) =>
      planReducer(p, { type: "photo", shot, photo: photoOf(id) }),
    plan,
  );

const pngs = new Map<string, Blob>();
const png = (id: string): Blob => {
  const b = pngs.get(id) ?? new Blob([id], { type: "image/png" });
  pngs.set(id, b);
  return b;
};

const input = (
  plan: RunPlan,
  results: Readonly<Record<string, ResultEntry>> = {},
  matches: Readonly<Record<string, string>> = {},
): RunZipInput => ({
  plan,
  session: "s1",
  results,
  device,
  captureMaxLongEdge: 1280,
  summary: "SUMMARY",
  log: "LOG\n",
  photo: (id) => Promise.resolve(png(id)),
  matches: (key) => Promise.resolve(matches[key]),
});

const BASE: [string, string][] = [
  ["light-s1/L1", "a1"],
  ["light-s1/L2", "a2"],
  ["flat-s1/F1", "f1"],
  ["flat-s1/F2", "f2"],
];

const json = (files: { path: string; data: Blob | string }[], path: string) => {
  const f = files.find((x) => x.path === path);
  if (typeof f?.data !== "string") {
    throw new Error(`no text file ${path}`);
  }
  return JSON.parse(f.data) as Record<string, unknown>;
};

describe("the run zip from storage", () => {
  // Why: the zip is what the PC reads. Each shot goes in once, every
  // ready pair gets a folder with its frames JSON only, and the summary
  // and log close it; an unready pair has no folder.
  it("holds each shot once and a frames JSON per ready pair", async () => {
    const files = await runZipFiles(input(shoot(EMPTY_PLAN, BASE)));
    expect(files.map((f) => f.path)).toEqual([
      "shots/light-s1/L1-t1.png",
      "shots/light-s1/L2-t1.png",
      "shots/flat-s1/F1-t1.png",
      "shots/flat-s1/F2-t1.png",
      "pairs/light-s1/L1-L2/feature-match-frames.json",
      "pairs/flat-s1/F1-F2/feature-match-frames.json",
      "pairs/flat-s1/F1-T0/feature-match-frames.json",
      "pairs/flat-s1/F1-T90/feature-match-frames.json",
      "pairs/flat-s1/F1-T180/feature-match-frames.json",
      SUMMARY_FILE,
      LOG_FILE,
    ]);
    expect(files[0]!.data).toBe(png("a1"));
    expect(files.at(-2)!.data).toBe("SUMMARY");
    expect(files.at(-1)!.data).toBe("LOG\n");
  });

  // Why: the PC rebuilds the rotation squares from the crop and the turn
  // and finds each frame by its shot file; the fields are the format.
  it("writes the frames JSON format 2 with crop and turn for the rotation pairs", async () => {
    const files = await runZipFiles(input(shoot(EMPTY_PLAN, BASE)));
    const turn = json(files, "pairs/flat-s1/F1-T90/feature-match-frames.json");
    expect(turn).toEqual({
      format: RUN_FRAMES_FORMAT,
      pair: "t90",
      pairLabel: "rotation: centre square turned 90 deg",
      derivedPair: "flat-s1/F1-T90",
      kind: "turn90",
      spot: 1,
      axis: "rot",
      control: false,
      controlFor: [],
      session: "s1",
      lightCheck: null,
      captureMaxLongEdge: 1280,
      frames: [
        {
          name: "A",
          shot: "flat-s1/F1",
          take: 1,
          file: "shots/flat-s1/F1-t1.png",
          width: 640,
          height: 480,
          sourceWidth: 1920,
          sourceHeight: 1080,
          greyMean: 120,
          greySd: 40.12,
          crop: { x: 80, y: 0, side: 480 },
        },
        {
          name: "B",
          shot: "flat-s1/F2",
          take: 1,
          file: "shots/flat-s1/F2-t1.png",
          width: 640,
          height: 480,
          sourceWidth: 1920,
          sourceHeight: 1080,
          greyMean: 120,
          greySd: 40.12,
          crop: { x: 80, y: 0, side: 480 },
        },
      ],
      turn: { degrees: 90, direction: "cw" },
      device,
    });
    // The PC reader may rely on the field order; toEqual ignores it.
    expect(Object.keys(turn)).toEqual([
      "format",
      "pair",
      "pairLabel",
      "derivedPair",
      "kind",
      "spot",
      "axis",
      "control",
      "controlFor",
      "session",
      "lightCheck",
      "captureMaxLongEdge",
      "frames",
      "turn",
      "device",
    ]);
    expect(Object.keys((turn.frames as Record<string, unknown>[])[0]!)).toEqual(
      [
        "name",
        "shot",
        "take",
        "file",
        "width",
        "height",
        "sourceWidth",
        "sourceHeight",
        "greyMean",
        "greySd",
        "crop",
      ],
    );
    const t0 = json(files, "pairs/flat-s1/F1-T0/feature-match-frames.json");
    expect([t0.pair, t0.control, t0.controlFor]).toEqual(["t0", true, ["rot"]]);
    const light = json(files, "pairs/light-s1/L1-L2/feature-match-frames.json");
    expect(light.lightCheck).toBe("ok");
    expect("turn" in light).toBe(false);
    expect(
      (light.frames as Record<string, unknown>[]).some((f) => "crop" in f),
    ).toBe(false);
  });

  // Why: a matches JSON exists only for a pair the phone measured; a
  // failed or pending pair has none, so the PC measures it.
  it("adds a matches JSON only for a pair with a finished result", async () => {
    const plan = shoot(EMPTY_PLAN, BASE);
    const done = "light-s1/L1-L2@a1+a2";
    const failed = "flat-s1/F1-F2@f1+f2";
    const files = await runZipFiles(
      input(
        plan,
        {
          [done]: { status: "done", text: "ok", persisted: true },
          [failed]: { status: "failed", text: "e", persisted: true },
        },
        { [done]: "MATCHES\n", [failed]: "never\n" },
      ),
    );
    const matches = files.filter((f) => f.path.endsWith("matches.json"));
    expect(matches).toEqual([
      {
        path: "pairs/light-s1/L1-L2/feature-match-matches.json",
        data: "MATCHES\n",
      },
    ]);
  });

  // Why: after a retake the zip holds the new take only, and the pair
  // JSON names it; an old take would be measured as the new one.
  it("names the current take only after a retake", async () => {
    const plan = shoot(shoot(EMPTY_PLAN, BASE), [["flat-s1/F2", "f2b"]]);
    const files = await runZipFiles(input(plan));
    const paths = files.map((f) => f.path);
    expect(paths).toContain(shotFile("flat-s1/F2", 2));
    expect(paths).not.toContain(shotFile("flat-s1/F2", 1));
    expect(files.find((f) => f.path === shotFile("flat-s1/F2", 2))!.data).toBe(
      png("f2b"),
    );
    const pair = json(files, "pairs/flat-s1/F1-F2/feature-match-frames.json");
    expect((pair.frames as { file: string }[])[1]!.file).toBe(
      "shots/flat-s1/F2-t2.png",
    );
  });

  // Why: a photo neither storage nor memory holds must fail the zip with
  // its name, not ship a zip with a hole.
  it("fails with the photo's name when a photo cannot be read", async () => {
    const files = runZipFiles({
      ...input(shoot(EMPTY_PLAN, BASE)),
      photo: (id) =>
        id === "f2"
          ? Promise.reject(new Error(`the photo ${id} is not stored`))
          : Promise.resolve(png(id)),
    });
    await expect(files).rejects.toThrow("the photo f2 is not stored");
  });
});

// Why this test matters: the desk reads the camera's focus distance and
// zoom per frame from the frames JSON; a frame without a report has none.
describe("the camera report in the frames JSON", () => {
  it("carries a frame's camera report after its grey values", async () => {
    const camera = { focusDistance: 0.42, zoom: 1 };
    const plan = planReducer(shoot(EMPTY_PLAN, BASE), {
      type: "photo",
      shot: "light-s1/L2",
      photo: { ...photoOf("a3"), camera },
    });
    const files = await runZipFiles(input(plan));
    const frames = json(files, "pairs/light-s1/L1-L2/feature-match-frames.json")
      .frames as Record<string, unknown>[];
    expect(frames[0]).not.toHaveProperty("camera");
    expect(frames[1]!.camera).toEqual(camera);
    expect(Object.keys(frames[1]!).slice(-2)).toEqual(["greySd", "camera"]);
  });
});

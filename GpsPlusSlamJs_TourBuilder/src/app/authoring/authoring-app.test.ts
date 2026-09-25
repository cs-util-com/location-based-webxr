/**
 * Composed-flow test for Authoring mode (plan
 * `plans/2026-08-14-authoring-composition-plan.md`, AC7/AC14). Mocks only
 * the framework's four permission functions (+ the GPS watch that lives in
 * the same module) and `AudioContext` — everything else is the REAL
 * onboarding gate, the REAL `createAuthoringStore`, the REAL authoring
 * session/view, and the REAL `packTour`. This is the first proof the pieces
 * are actually wired together, not just individually correct (TASK.md §2.4).
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateTour } from "../../store/validate-tour.js";
import track from "../../components/authoring/demo-track.json" with { type: "json" };

interface PermissionStatus {
  supported: boolean;
  granted: boolean | null;
  error?: string;
}

interface GpsPosition {
  lat: number;
  lon: number;
  altitude: number | null;
  accuracy: number;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

let onGpsPosition: ((position: GpsPosition) => void) | null = null;
let geolocationOutcome: "granted" | "denied" = "granted";

vi.mock("gps-plus-slam-app-framework/sensors", () => ({
  checkCameraPermission: (): Promise<PermissionStatus> =>
    Promise.resolve({ supported: true, granted: null }),
  checkGeolocationPermission: (): Promise<PermissionStatus> =>
    Promise.resolve({ supported: true, granted: null }),
  requestCameraPermission: (): Promise<PermissionStatus> =>
    Promise.resolve({ supported: true, granted: true }),
  requestGeolocationPermission: (): Promise<PermissionStatus> =>
    geolocationOutcome === "granted"
      ? Promise.resolve({ supported: true, granted: true })
      : Promise.resolve({
          supported: true,
          granted: false,
          error: "Location access denied.",
        }),
  startGpsWatch: (onPosition: (position: GpsPosition) => void): void => {
    onGpsPosition = onPosition;
  },
  stopGpsWatch: (): void => {
    onGpsPosition = null;
  },
}));

const downloadBlobMock = vi.fn().mockResolvedValue(true);
vi.mock("gps-plus-slam-app-framework/storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadZip: downloadBlobMock,
}));

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
}

function toGpsPosition(
  sample: { lat: number; lon: number; altitude: number },
  timestamp: number,
): GpsPosition {
  return {
    lat: sample.lat,
    lon: sample.lon,
    altitude: sample.altitude,
    accuracy: 5,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    timestamp,
  };
}

/** Every ZIP local-file-header's compression method (0 = store, 8 = deflate). */
function localHeaderMethods(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const methods: number[] = [];
  let offset = 0;
  while (
    offset + 30 <= bytes.length &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    methods.push(view.getUint16(offset + 8, true));
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return methods;
}

async function completeOnboarding(root: HTMLElement): Promise<void> {
  const grantButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="grant-access"]',
  )!;
  grantButton.click();

  const startButton = await vi.waitFor(() => {
    const button = root.querySelector<HTMLButtonElement>(
      '[data-testid="start"]',
    )!;
    expect(button.disabled).toBe(false);
    return button;
  });
  startButton.click();
  await vi.waitFor(() => {
    expect(root.querySelector('[data-testid="drop-waypoint"]')).not.toBeNull();
  });
}

describe("Authoring mode composed flow", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    geolocationOutcome = "granted";
    onGpsPosition = null;
    downloadBlobMock.mockClear();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.unstubAllGlobals();
  });

  it("wires onboarding -> authoring tools -> pack into a valid, store-mode tour.zip", async () => {
    // Slower than the 5s default — real Leaflet init + several async hops
    // (onboarding, session wiring, packTour) all run for real, not faked.
    const { mountAuthoringApp } = await import("./authoring-app.js");
    mountAuthoringApp(root);

    await completeOnboarding(root);

    // Real Task 1 walk fix (from the authoring component's own replay
    // fixture) so dropWaypoint() has a real position to drop at.
    onGpsPosition!(toGpsPosition(track.track[0]!, Date.now()));

    root
      .querySelector<HTMLButtonElement>('[data-testid="drop-waypoint"]')!
      .click();
    const waypointCard = await vi.waitFor(() => {
      const card = root.querySelector<HTMLElement>(
        '[data-testid^="waypoint-"]',
      );
      expect(card).not.toBeNull();
      return card!;
    });
    const waypointId = waypointCard.dataset["testid"]!.replace("waypoint-", "");

    const audioInput = root.querySelector<HTMLInputElement>(
      `[data-testid="asset-audio-${waypointId}"]`,
    )!;
    const audioFile = new File(["fake audio bytes"], "story.mp3", {
      type: "audio/mpeg",
    });
    Object.defineProperty(audioInput, "files", {
      value: [audioFile],
      configurable: true,
    });
    audioInput.dispatchEvent(new Event("change", { bubbles: true }));

    root.querySelector<HTMLButtonElement>('[data-testid="export"]')!.click();

    await vi.waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledOnce();
    });

    const [packedBlob, filename] = downloadBlobMock.mock.calls[0] as [
      Blob,
      string,
    ];
    expect(filename).toBe("tour.zip");

    const bytes = new Uint8Array(await packedBlob.arrayBuffer());
    const methods = localHeaderMethods(bytes);
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((m) => m === 0)).toBe(true); // store, never deflate

    const { unzipSync } = await import("fflate");
    const files = unzipSync(bytes);
    expect(files["tour.json"]).toBeDefined();
    const tourJsonText = new TextDecoder().decode(files["tour.json"]);
    const tour = validateTour(JSON.parse(tourJsonText));
    expect(tour.waypoints).toHaveLength(1);
    expect(tour.waypoints[0]!.content.audio).toBeDefined();
    const assetEntry = tour.assets.find(
      (a) => a.id === tour.waypoints[0]!.content.audio,
    )!;
    expect(files[assetEntry.filename]).toBeDefined();
  }, 15000);

  it("AC14: a denied permission keeps Start disabled and never mounts authoring tools", async () => {
    geolocationOutcome = "denied";
    const { mountAuthoringApp } = await import("./authoring-app.js");
    mountAuthoringApp(root);

    root
      .querySelector<HTMLButtonElement>('[data-testid="grant-access"]')!
      .click();

    await vi.waitFor(() => {
      const explanation = root.querySelector('[data-testid="explanation-gps"]');
      expect(explanation).not.toBeNull();
    });

    const startButton = root.querySelector<HTMLButtonElement>(
      '[data-testid="start"]',
    )!;
    expect(startButton.disabled).toBe(true);
    expect(root.querySelector('[data-testid="drop-waypoint"]')).toBeNull();
  });

  it("keeps the author on the authoring screen with an inline error if packing fails", async () => {
    downloadBlobMock.mockRejectedValueOnce(new Error("disk full"));
    const { mountAuthoringApp } = await import("./authoring-app.js");
    mountAuthoringApp(root);

    await completeOnboarding(root);
    onGpsPosition!(toGpsPosition(track.track[0]!, Date.now()));
    root
      .querySelector<HTMLButtonElement>('[data-testid="drop-waypoint"]')!
      .click();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-testid^="waypoint-"]')).not.toBeNull();
    });

    const exportButton = root.querySelector<HTMLButtonElement>(
      '[data-testid="export"]',
    )!;
    exportButton.click();

    await vi.waitFor(() => {
      expect(
        root.querySelector('[data-testid="export-status"]')?.textContent,
      ).toBe("disk full");
    });
    expect(exportButton.disabled).toBe(false);
    // Never navigated away — the export screen (and its Export button) is
    // still the one in the DOM, not the pack-and-share panel.
    expect(root.querySelector('[data-testid="export"]')).not.toBeNull();
  });
});

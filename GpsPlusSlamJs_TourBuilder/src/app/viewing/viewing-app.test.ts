/**
 * Screen-flow tests for Viewing mode (plan VC2, VC3, VC13, VC14, VC15).
 *
 * The REAL onboarding gate (9), the REAL viewing store (3), the real screens
 * and the real error mapping run here. Substituted: the framework's permission
 * functions and `AudioContext` (no Web Audio in Node), the AR controller and
 * `startArScene` (no WebXR/WebGL), Leaflet (no tiles), and `openRemoteTour` —
 * the loader's own integration suite already drives it against a real
 * range-serving fixture server, and the composed-flow replay e2e
 * (`viewing-replay.e2e.test.ts`) drives the real loader end to end. What is
 * asserted here is the sequencing and the failure states, which is what this
 * file owns.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TourLoadError } from "../../components/cloud-loader/core/errors.js";
import type { AssetProvider, Tour } from "../../store/types.js";
import { mountViewingApp, type ViewingAppDeps } from "./viewing-app.js";
import type { ProgressStorage } from "./progress-store.js";
import type { VisitorFix } from "./start-distance.js";

interface PermissionStatus {
  supported: boolean;
  granted: boolean | null;
  error?: string;
}

vi.mock("gps-plus-slam-app-framework/sensors", () => ({
  checkCameraPermission: (): Promise<PermissionStatus> =>
    Promise.resolve({ supported: true, granted: null }),
  checkGeolocationPermission: (): Promise<PermissionStatus> =>
    Promise.resolve({ supported: true, granted: null }),
  requestCameraPermission: (): Promise<PermissionStatus> =>
    Promise.resolve({ supported: true, granted: true }),
  requestGeolocationPermission: (): Promise<PermissionStatus> =>
    Promise.resolve({ supported: true, granted: true }),
  startGpsWatch: (): void => {},
  stopGpsWatch: (): void => {},
}));

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
}

const TOUR: Tour = {
  id: "tour-castle",
  name: "Castle walk",
  description: "Three stops around the old wall.",
  assets: [],
  waypoints: [
    {
      id: "wp-gate",
      position: { lat: 48.0, lon: 11.0 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: {},
    },
    {
      id: "wp-tower",
      position: { lat: 48.001, lon: 11.001 },
      prefetchRadius: 25,
      activeRadius: 10,
      content: {},
    },
  ],
  breadcrumb: [],
};

const noopAssetProvider: AssetProvider = {
  getAssetUrl: () => Promise.reject(new Error("not used")),
  release: () => {},
};

function fakeStorage(seed: Record<string, string> = {}): ProgressStorage {
  const data: Record<string, string> = { ...seed };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

type ControllerStatus =
  "checking" | "unsupported" | "ready" | "error" | "running";

function fakeController(
  options: {
    status?: ControllerStatus;
    enableResult?: { ok: boolean; error?: string };
  } = {},
) {
  let status: ControllerStatus = options.status ?? "ready";
  const listeners = new Set<() => void>();
  let capturedOnSessionEnd: (() => void) | null = null;
  const enable = vi.fn(
    (config: {
      callbacks?: { onSessionEnd?: () => void };
      isolationOptions?: {
        enableDomOverlay?: boolean;
        enableCameraAccess?: boolean;
        enableDepthSensingFeature?: boolean;
        enableCameraTextureAcquisition?: boolean;
      };
      container?: HTMLElement;
    }) => {
      capturedOnSessionEnd = config.callbacks?.onSessionEnd ?? null;
      const result = options.enableResult ?? { ok: true };
      if (result.ok) status = "running";
      return Promise.resolve(result);
    },
  );
  return {
    controller: {
      getState: () => ({
        status,
        ...(status === "error" ? { error: "boom" } : {}),
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      refreshSupport: () => Promise.resolve(),
      enable,
      disable: vi.fn(() => Promise.resolve()),
    },
    enable,
    endSessionExternally: () => capturedOnSessionEnd?.(),
  };
}

function fakeMap() {
  return {
    setGpsPosition: vi.fn(),
    render: vi.fn(),
    setWaypoints: vi.fn(),
    toggle: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn(() => true),
    resize: vi.fn(),
    getLeafletMap: vi.fn(() => null),
    destroy: vi.fn(),
  };
}

type FakeOsmBuildingsStatus = "idle" | "loading" | "loaded" | "failed" | "off";

function fakePreviewSession(
  options: {
    osmBuildingsStatus?: FakeOsmBuildingsStatus;
    /** Records "subscribe"/"unsubscribe" and (via `dispose`) "dispose". */
    callOrder?: string[];
  } = {},
) {
  const domElement = document.createElement("canvas");
  let osmStatus: FakeOsmBuildingsStatus =
    options.osmBuildingsStatus ?? "loading";
  const osmListeners = new Set<(status: FakeOsmBuildingsStatus) => void>();
  const emitOsmStatus = (next: FakeOsmBuildingsStatus): void => {
    osmStatus = next;
    for (const listener of [...osmListeners]) listener(next);
  };
  const callOrder = options.callOrder;
  return {
    runtime: {
      getArWorldGroup: () => ({}) as never,
      getCamera: () => ({}) as never,
      getXrSession: () => null,
      getXrReferenceSpace: () => null,
      enableArWorldGroupAlignment: () => ({ dispose: vi.fn() }),
      registerFrameUpdate: () => vi.fn(),
      selectAlignmentMatrix: () => [1],
      selectZeroReference: () => ({ lat: 48, lon: 11 }),
    },
    seams: {
      createAnchor: vi.fn(),
      toWorld: vi.fn(),
      getUserWorldPos: vi.fn(),
    },
    frame: { toWorld: vi.fn(), toCoord: vi.fn(), origin: { lat: 48, lon: 11 } },
    domElement,
    getPose: () => ({ x: 0, z: 0, headingRad: 0 }),
    setAutopilot: vi.fn(),
    isAutopilot: () => false,
    getOsmBuildingsStatus: vi.fn(() => osmStatus),
    onOsmBuildingsStatusChange: vi.fn(
      (callback: (status: FakeOsmBuildingsStatus) => void) => {
        osmListeners.add(callback);
        callOrder?.push("subscribe");
        return () => {
          osmListeners.delete(callback);
          callOrder?.push("unsubscribe");
        };
      },
    ),
    setOsmBuildingsEnabled: vi.fn((enabled: boolean) => {
      emitOsmStatus(enabled ? "loading" : "off");
    }),
    // Test-only escape hatch to simulate a status arriving asynchronously.
    _emitOsmStatus: emitOsmStatus,
    // The session owns its canvas and takes it back on dispose, exactly as
    // the real one does.
    dispose: vi.fn(() => {
      callOrder?.push("dispose");
      domElement.remove();
    }),
  };
}

function testDeps(
  overrides: Partial<ViewingAppDeps> = {},
): Partial<ViewingAppDeps> {
  return {
    createPreviewSession: vi.fn(() => fakePreviewSession()),
    openRemoteTour: vi.fn(() =>
      Promise.resolve({
        tour: TOUR,
        assetProvider: noopAssetProvider,
        cacheWarming: Promise.resolve(),
      }),
    ),
    createTourMap: () => fakeMap(),
    createAudioContext: () => new FakeAudioContext() as unknown as AudioContext,
    startArScene: vi.fn(() => ({
      scene: {} as never,
      dispose: vi.fn(),
    })),
    progressStorage: fakeStorage(),
    // Most tests are not about distance: no fix, so the entry screen behaves
    // exactly as it did before the start-distance gate existed.
    locateVisitor: vi.fn(() => ({
      result: Promise.resolve(null),
      cancel: vi.fn(),
    })),
    ...overrides,
  };
}

/** A `locateVisitor` whose answer the test delivers when it chooses. */
function controllableLocate() {
  const settlers: Array<(fix: VisitorFix | null) => void> = [];
  const cancel = vi.fn();
  const locateVisitor = vi.fn(() => ({
    result: new Promise<VisitorFix | null>((resolve) => {
      settlers.push(resolve);
    }),
    cancel,
  }));
  return {
    locateVisitor: locateVisitor as unknown as ViewingAppDeps["locateVisitor"],
    calls: locateVisitor,
    cancel,
    settle: (fix: VisitorFix | null) => settlers.at(-1)!(fix),
  };
}

/** End tour now asks for confirmation: click the button, then confirm. */
function endTour(root: HTMLElement): void {
  (query(root, "viewing-end-tour") as HTMLButtonElement).click();
  (query(root, "viewing-end-tour-confirm") as HTMLButtonElement).click();
}

function query(root: HTMLElement, testId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

async function completeOnboarding(root: HTMLElement): Promise<void> {
  const grant = await vi.waitFor(() => {
    const button = query(root, "grant-access") as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    return button!;
  });
  grant.click();
  const start = await vi.waitFor(() => {
    const button = query(root, "start") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    return button;
  });
  start.click();
  await vi.waitFor(() => {
    expect(query(root, "viewing-entry")).not.toBeNull();
  });
}

describe("Viewing mode screen flow", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the tour, then gates, then offers Enter AR", async () => {
    const deps = testDeps();
    const { controller } = fakeController();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...deps,
      createController: () => controller as never,
    });

    // The loader runs BEFORE the gate (TASK.md §2.4 order).
    expect(query(root, "viewing-loading")).not.toBeNull();
    expect(query(root, "grant-access")).toBeNull();

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);

    expect(query(root, "viewing-entry")!.textContent).toContain("Castle walk");
    expect(query(root, "viewing-tour-summary")!.textContent).toContain(
      "2 stops",
    );
    expect(
      (query(root, "viewing-enter-ar") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows a no-link screen and never mounts the gate without ?tour=", async () => {
    const { controller } = fakeController();

    mountViewingApp(root, "", {
      ...testDeps(),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "viewing-error")).not.toBeNull();
    });
    expect(query(root, "grant-access")).toBeNull();
    expect(query(root, "viewing-retry")).toBeNull();
  });

  it("surfaces a blocked link with a retry that re-opens the tour", async () => {
    const openRemoteTour = vi
      .fn()
      .mockRejectedValueOnce(new TourLoadError("cors", "blocked"))
      .mockResolvedValueOnce({
        tour: TOUR,
        assetProvider: noopAssetProvider,
        cacheWarming: Promise.resolve(),
      });
    const { controller } = fakeController();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        openRemoteTour:
          openRemoteTour as unknown as ViewingAppDeps["openRemoteTour"],
      }),
      createController: () => controller as never,
    });

    const retry = await vi.waitFor(() => {
      const button = query(root, "viewing-retry");
      expect(button).not.toBeNull();
      return button as HTMLButtonElement;
    });
    retry.click();

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    expect(openRemoteTour).toHaveBeenCalledTimes(2);
  });

  it("offers no retry for a damaged tour file — retrying cannot fix it", async () => {
    const { controller } = fakeController();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        openRemoteTour: vi
          .fn()
          .mockRejectedValue(
            new TourLoadError("invalid-tour-json", "bad json"),
          ) as unknown as ViewingAppDeps["openRemoteTour"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "viewing-error")).not.toBeNull();
    });
    expect(query(root, "viewing-error")!.textContent).toContain("damaged");
    expect(query(root, "viewing-retry")).toBeNull();
  });

  it("keeps the map usable and says so honestly when AR is unsupported", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const map = fakeMap();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createTourMap: (() =>
          map) as unknown as ViewingAppDeps["createTourMap"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);

    expect(
      (query(root, "viewing-enter-ar") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(query(root, "viewing-ar-status")!.textContent).toContain(
      "not available",
    );
    expect(map.show).toHaveBeenCalled();
  });

  it("reports a failed AR start inline and stays retryable", async () => {
    const { controller } = fakeController({
      enableResult: { ok: false, error: "Location access denied." },
    });
    const startArScene = vi.fn();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        startArScene: startArScene as unknown as ViewingAppDeps["startArScene"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    (query(root, "viewing-enter-ar") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(query(root, "viewing-ar-status")!.textContent).toContain("denied");
    });
    expect(startArScene).not.toHaveBeenCalled();
    expect(
      (query(root, "viewing-enter-ar") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("enters AR with the DOM overlay enabled and the app container as its root", async () => {
    const { controller, enable } = fakeController();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps(),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    (query(root, "viewing-enter-ar") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(query(root, "viewing-hud")).not.toBeNull();
    });
    const config = enable.mock.calls[0]![0];
    expect(config.isolationOptions?.enableDomOverlay).toBe(true);
    // The viewing app never primes the depth/camera-access permission probe
    // (only `requestDepth: true` does, per enable-gps-ar.ts's contract), so it
    // must not leave these framework defaults (both `true`) turned on: a real
    // device rejects the immersive-ar session outright with "the specified
    // session config is not supported" when an un-primed permission-gated
    // feature is requested.
    expect(config.isolationOptions?.enableCameraAccess).toBe(false);
    expect(config.isolationOptions?.enableDepthSensingFeature).toBe(false);
    expect(config.isolationOptions?.enableCameraTextureAcquisition).toBe(false);
    // The HUD must be a DESCENDANT of the element handed to initAR, or WebXR
    // DOM Overlay will not composite it over the camera feed.
    expect(config.container?.contains(query(root, "viewing-hud"))).toBe(true);
  });

  it("returns to the entry screen with progress intact when the session ends externally", async () => {
    const { controller, endSessionExternally } = fakeController();
    const startArScene = vi.fn(() => ({
      scene: {} as never,
      dispose: vi.fn(),
    }));
    const storage = fakeStorage({
      "tour:tour-castle": '{"visited":["wp-gate"]}',
    });

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        startArScene: startArScene as unknown as ViewingAppDeps["startArScene"],
        progressStorage: storage,
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    // Progress restored from a previous visit (VC14).
    expect(query(root, "viewing-tour-summary")!.textContent).toContain(
      "1 already visited",
    );

    (query(root, "viewing-enter-ar") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(query(root, "viewing-hud")).not.toBeNull();
    });

    endSessionExternally();

    await vi.waitFor(() => {
      expect(query(root, "viewing-entry")).not.toBeNull();
    });
    // Still the same tour, still the same progress — not a cold restart.
    expect(query(root, "viewing-tour-summary")!.textContent).toContain(
      "1 already visited",
    );
    expect(query(root, "viewing-hud")).toBeNull();

    // Re-entering builds a FRESH scene, which is what re-seeds every zone to
    // IDLE (component 8 dispatches initZones on mount) while visited ids
    // survive — a waypoint the visitor is standing next to must be re-crossed,
    // not silently already ACTIVE.
    // The entry screen re-checks how far the visitor is from the start, so
    // Enter AR is briefly held back before it enables again.
    await vi.waitFor(() => {
      expect(
        (query(root, "viewing-enter-ar") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    (query(root, "viewing-enter-ar") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(startArScene).toHaveBeenCalledTimes(2);
    });
  });

  it("offers a desktop preview when AR is unavailable, and runs the real scene in it", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const preview = fakePreviewSession();
    const createPreviewSession = vi.fn(() => preview);
    const startArScene = vi.fn((_options: unknown) => ({
      scene: {} as never,
      dispose: vi.fn(),
    }));

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
        startArScene: startArScene as unknown as ViewingAppDeps["startArScene"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);

    const enterPreview = query(root, "viewing-enter-preview");
    expect(enterPreview).not.toBeNull();
    enterPreview!.click();

    await vi.waitFor(() => {
      expect(query(root, "viewing-hud")).not.toBeNull();
    });
    // The same component-8 scene the phone runs — only the runtime differs.
    const options = startArScene.mock.calls[0]![0] as {
      runtime: unknown;
      seams: unknown;
    };
    expect(options.runtime).toBe(preview.runtime);
    expect(options.seams).toBe(preview.seams);
    // The preview canvas lives inside the app container, under the HUD.
    expect(preview.domElement.parentElement).not.toBeNull();

    // Ending the preview tears the session down and returns to the entry.
    endTour(root);
    await vi.waitFor(() => {
      expect(query(root, "viewing-entry")).not.toBeNull();
    });
    expect(preview.dispose).toHaveBeenCalled();
    expect(preview.domElement.parentElement).toBeNull();
  });

  it("hides the desktop preview on a device that can actually run AR", async () => {
    const { controller } = fakeController({ status: "ready" });

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps(),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);

    expect(query(root, "viewing-enter-preview")).toBeNull();
  });

  it("offers the preview on any device when the link asks for it", async () => {
    const { controller } = fakeController({ status: "ready" });

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({ forcePreview: true }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);

    expect(query(root, "viewing-enter-preview")).not.toBeNull();
  });

  it("keeps the map following the walker through the preview", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const map = fakeMap();
    let report: ((position: { lat: number; lon: number }) => void) | undefined;
    const createPreviewSession = vi.fn(
      (options: { onPositionChange?: (p: unknown) => void }) => {
        report = options.onPositionChange;
        return fakePreviewSession();
      },
    );

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createTourMap: (() =>
          map) as unknown as ViewingAppDeps["createTourMap"],
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    query(root, "viewing-enter-preview")!.click();

    await vi.waitFor(() => {
      expect(query(root, "viewing-hud")).not.toBeNull();
    });
    report!({ lat: 48.5, lon: 11.5 });
    expect(map.setGpsPosition).toHaveBeenCalledWith(48.5, 11.5);
  });

  it("the Map button reflects the map's open/closed state", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const preview = fakePreviewSession();
    const createPreviewSession = vi.fn(() => preview);

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    query(root, "viewing-enter-preview")!.click();
    await vi.waitFor(() => {
      expect(query(root, "viewing-map-toggle")).not.toBeNull();
    });

    const mapButton = query(root, "viewing-map-toggle") as HTMLButtonElement;
    // The session shell opens the map, so the button starts pressed.
    expect(mapButton.getAttribute("aria-pressed")).toBe("true");
    expect(mapButton.getAttribute("aria-label")).toBe("Hide map");

    mapButton.click();
    expect(mapButton.getAttribute("aria-pressed")).toBe("false");
    expect(mapButton.getAttribute("aria-label")).toBe("Show map");

    mapButton.click();
    expect(mapButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the OSM buildings toggle in the preview HUD, labelled from the layer's initial status", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const preview = fakePreviewSession({ osmBuildingsStatus: "loading" });
    const createPreviewSession = vi.fn(() => preview);

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    query(root, "viewing-enter-preview")!.click();

    await vi.waitFor(() => {
      expect(query(root, "viewing-osm-buildings-toggle")).not.toBeNull();
    });
    // Applied from getOsmBuildingsStatus() immediately, without waiting for
    // an onOsmBuildingsStatusChange event.
    expect(
      query(root, "viewing-osm-buildings-toggle")!.getAttribute("aria-label"),
    ).toBe("Loading buildings…");
  });

  it("updates the buildings label as the layer's status changes, and raises a notice on failure", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const preview = fakePreviewSession({ osmBuildingsStatus: "loading" });
    const createPreviewSession = vi.fn(() => preview);

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    query(root, "viewing-enter-preview")!.click();
    await vi.waitFor(() => {
      expect(query(root, "viewing-osm-buildings-toggle")).not.toBeNull();
    });

    preview._emitOsmStatus("loaded");
    expect(
      query(root, "viewing-osm-buildings-toggle")!.getAttribute("aria-label"),
    ).toBe("Hide buildings");
    expect(query(root, "viewing-hud-notice")!.hidden).toBe(true);

    preview._emitOsmStatus("failed");
    expect(
      query(root, "viewing-osm-buildings-toggle")!.getAttribute("aria-label"),
    ).toBe("Buildings failed — tap to retry");
    expect(query(root, "viewing-hud-notice")!.hidden).toBe(false);
  });

  it("derives the toggle click's target enabled value from the current status", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const preview = fakePreviewSession({ osmBuildingsStatus: "off" });
    const createPreviewSession = vi.fn(() => preview);

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    query(root, "viewing-enter-preview")!.click();
    await vi.waitFor(() => {
      expect(query(root, "viewing-osm-buildings-toggle")).not.toBeNull();
    });

    // Currently "off" -> click enables.
    (query(root, "viewing-osm-buildings-toggle") as HTMLButtonElement).click();
    expect(preview.setOsmBuildingsEnabled).toHaveBeenLastCalledWith(true);

    // Now "loading" (setOsmBuildingsEnabled(true) drove the fake to that
    // status) -> click disables.
    (query(root, "viewing-osm-buildings-toggle") as HTMLButtonElement).click();
    expect(preview.setOsmBuildingsEnabled).toHaveBeenLastCalledWith(false);

    // Now "off" again -> click re-enables (also the retry path from "failed").
    (query(root, "viewing-osm-buildings-toggle") as HTMLButtonElement).click();
    expect(preview.setOsmBuildingsEnabled).toHaveBeenLastCalledWith(true);
  });

  it("does not show the buildings toggle in the real AR (phone) HUD", async () => {
    const { controller } = fakeController();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps(),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    (query(root, "viewing-enter-ar") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(query(root, "viewing-hud")).not.toBeNull();
    });
    expect(query(root, "viewing-osm-buildings-toggle")).toBeNull();
  });

  it("unsubscribes the OSM buildings status listener before preview.dispose() on leavePreview()", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const callOrder: string[] = [];
    const preview = fakePreviewSession({ callOrder });
    const createPreviewSession = vi.fn(() => preview);

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    query(root, "viewing-enter-preview")!.click();
    await vi.waitFor(() => {
      expect(query(root, "viewing-hud")).not.toBeNull();
    });

    endTour(root);
    await vi.waitFor(() => {
      expect(query(root, "viewing-entry")).not.toBeNull();
    });

    expect(callOrder).toEqual(["subscribe", "unsubscribe", "dispose"]);
  });

  it("clears stored progress on Restart tour", async () => {
    const storage = fakeStorage({
      "tour:tour-castle": '{"visited":["wp-gate"]}',
    });
    const { controller } = fakeController();

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({ progressStorage: storage }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    (query(root, "viewing-restart") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(query(root, "viewing-tour-summary")!.textContent).toBe("2 stops");
    });
    expect(storage.getItem("tour:tour-castle")).toBeNull();
  });
});

// The tour's start is its first stop here (no breadcrumb): 48.0 N, 11.0 E.
const AT_START: VisitorFix = { lat: 48.0, lon: 11.0, accuracy: 5 };
/** ~100 m north of the start. */
const HUNDRED_M_AWAY: VisitorFix = { lat: 48.0009, lon: 11.0, accuracy: 5 };
const OTHER_CONTINENT: VisitorFix = {
  lat: 40.7128,
  lon: -74.006,
  accuracy: 20,
};

describe("Start-distance gate on the entry screen", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function openEntry(
    locate: ReturnType<typeof controllableLocate>,
    controllerStatus: ControllerStatus = "ready",
    depOverrides: Partial<ViewingAppDeps> = {},
  ) {
    const { controller } = fakeController({ status: controllerStatus });
    const deps = testDeps({
      locateVisitor: locate.locateVisitor,
      ...depOverrides,
    });
    const app = mountViewingApp(root, "https://host.example/tour.zip", {
      ...deps,
      createController: () => controller as never,
    });
    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    return { app, deps };
  }

  const enterAr = () => query(root, "viewing-enter-ar") as HTMLButtonElement;
  const status = () => query(root, "viewing-ar-status")!;
  const previewButton = () => query(root, "viewing-enter-preview");

  it("holds Enter AR back while it checks how far the visitor is", async () => {
    const locate = controllableLocate();
    await openEntry(locate);

    await vi.waitFor(() => {
      expect(locate.calls).toHaveBeenCalledTimes(1);
    });
    expect(enterAr().disabled).toBe(true);
    expect(status().textContent).toContain("Checking how far you are");
  });

  it("near the start: plain Enter AR, no notice, no second button", async () => {
    const locate = controllableLocate();
    await openEntry(locate);
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalled());

    locate.settle(AT_START);

    await vi.waitFor(() => {
      expect(enterAr().disabled).toBe(false);
    });
    expect(enterAr().hidden).toBe(false);
    expect(status().hidden).toBe(true);
    expect(previewButton()).toBeNull();
  });

  it("50–300 m away: offers both, and says how far", async () => {
    const locate = controllableLocate();
    await openEntry(locate);
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalled());

    locate.settle(HUNDRED_M_AWAY);

    await vi.waitFor(() => {
      expect(previewButton()).not.toBeNull();
    });
    expect(enterAr().hidden).toBe(false);
    expect(enterAr().disabled).toBe(false);
    expect(status().textContent).toBe("The start of this tour is 100 m away.");
  });

  it("over 300 m away: takes AR away and makes Preview here the way in", async () => {
    const locate = controllableLocate();
    await openEntry(locate);
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalled());

    locate.settle(OTHER_CONTINENT);

    await vi.waitFor(() => {
      expect(enterAr().hidden).toBe(true);
    });
    expect(previewButton()!.className).toContain("primary");
    expect(previewButton()!.textContent).toBe("Preview here");
    expect(status().textContent).toContain("Preview it from here");
  });

  it("never takes AR away without a fix", async () => {
    const locate = controllableLocate();
    await openEntry(locate);
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalled());

    locate.settle(null);

    await vi.waitFor(() => {
      expect(enterAr().disabled).toBe(false);
    });
    expect(enterAr().hidden).toBe(false);
    expect(previewButton()).toBeNull();
    expect(status().hidden).toBe(true);
  });

  it("does not even look for the visitor where AR is unsupported", async () => {
    const locate = controllableLocate();
    await openEntry(locate, "unsupported");

    expect(locate.calls).not.toHaveBeenCalled();
    expect(previewButton()).not.toBeNull();
    expect(enterAr().disabled).toBe(true);
  });

  it("Preview here from far away starts the preview", async () => {
    const locate = controllableLocate();
    const createPreviewSession = vi.fn(() => fakePreviewSession());
    await openEntry(locate, "ready", {
      createPreviewSession:
        createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
    });
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalled());
    locate.settle(OTHER_CONTINENT);
    await vi.waitFor(() => expect(previewButton()).not.toBeNull());

    previewButton()!.click();

    await vi.waitFor(() => {
      expect(createPreviewSession).toHaveBeenCalledTimes(1);
    });
  });

  it("checks again when the visitor comes back from the preview", async () => {
    const locate = controllableLocate();
    await openEntry(locate);
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalledTimes(1));
    locate.settle(OTHER_CONTINENT);
    await vi.waitFor(() => expect(previewButton()).not.toBeNull());
    previewButton()!.click();
    await vi.waitFor(() => {
      expect(query(root, "viewing-end-tour")).not.toBeNull();
    });

    endTour(root);

    await vi.waitFor(() => {
      expect(locate.calls).toHaveBeenCalledTimes(2);
    });
    expect(enterAr().disabled).toBe(true); // locating again
  });

  it("stops looking when the visitor leaves the entry screen", async () => {
    const locate = controllableLocate();
    const { app } = await openEntry(locate);
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalled());

    app.destroy();

    expect(locate.cancel).toHaveBeenCalled();
  });

  it("ignores a fix that arrives after the screen has gone", async () => {
    const locate = controllableLocate();
    const { app } = await openEntry(locate);
    await vi.waitFor(() => expect(locate.calls).toHaveBeenCalled());
    app.destroy();

    expect(() => locate.settle(OTHER_CONTINENT)).not.toThrow();
  });
});

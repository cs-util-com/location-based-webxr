/**
 * `FakeSceneAdapter` — the recording stand-in for the rendering layer.
 *
 * This is the reason the port exists (plan A20). TourBuilder has no browser
 * runner and no WebGL, so with a plain core/view split the code that decides
 * *when a knight appears* could not be tested at all. Against this fake, the
 * real store, the real proximity driver and the real orchestrator run
 * unmodified in Node, and every scene effect becomes an assertable call record.
 *
 * It is intentionally a little more than a spy: it tracks anchoring, template
 * and clone lifetimes so the leak and ordering invariants (plan §10) can be
 * asserted directly rather than reconstructed from a log.
 */

import { Vector3 } from "three";

import type { TourCoord } from "../../../store/types.js";
import { createListenerSet } from "../core/listener-set.js";
import type {
  WayfindingTarget,
  SceneAdapter,
  TapHit,
  TemplateHandle,
  VisualHandle,
  WaypointHandle,
} from "./scene-adapter.js";

export interface FakeCall {
  readonly kind: string;
  readonly id: string;
}

export interface FakeSceneAdapterOptions {
  /** World position per waypoint id; a missing entry means "not anchored yet". */
  readonly positions?: Readonly<Record<string, Vector3>> | undefined;
  /** Asset ids whose `buildTemplate` should reject (corrupt-asset tests). */
  readonly failingAssets?: ReadonlySet<string> | undefined;
  /** Resolve `buildTemplate` manually instead of immediately. */
  readonly manualParse?: boolean | undefined;
  readonly audioReady?: boolean | undefined;
}

export interface FakeSceneAdapter extends SceneAdapter {
  readonly calls: readonly FakeCall[];
  /** Live clones — must be empty after `dispose()`. */
  readonly liveVisuals: ReadonlySet<string>;
  /** Live parsed templates — must be empty after `dispose()`. */
  readonly liveTemplates: ReadonlySet<string>;
  /** Currently visible waypoint ids. */
  readonly visible: ReadonlySet<string>;
  readonly pickTargetIds: readonly string[];
  readonly orbCount: number;
  readonly wayfindingTarget: WayfindingTarget | null;
  readonly activeWaypointPositions: readonly Vector3[];
  setUserPosition(position: Vector3 | null): void;
  setAnchored(waypointId: string, anchored: boolean): void;
  /** Fire a tap as if the ray source had reported one. */
  emitTap(hit: TapHit): void;
  emitAudioEnded(): void;
  /** Settle a pending `buildTemplate` (only with `manualParse`). */
  settleParse(url: string): void;
  readonly audioLog: readonly string[];
  readonly transcriptLog: readonly string[];
}

export function createFakeSceneAdapter(
  options: FakeSceneAdapterOptions = {},
): FakeSceneAdapter {
  const calls: FakeCall[] = [];
  const liveVisuals = new Set<string>();
  const liveTemplates = new Set<string>();
  const visible = new Set<string>();
  const audioLog: string[] = [];
  const transcriptLog: string[] = [];
  const unanchored = new Set<string>();
  const tapListeners = createListenerSet<[TapHit]>();
  const audioEndListeners = createListenerSet<[]>();
  const pendingParses = new Map<
    string,
    { resolve: (t: TemplateHandle) => void; reject: (e: Error) => void }
  >();
  /** Which waypoint each clone belongs to, so `visible` can be keyed by waypoint. */
  const visualOwner = new Map<string, string>();

  let userPosition: Vector3 | null = null;
  let pickTargetIds: string[] = [];
  let orbCount = 0;
  let wayfindingTarget: WayfindingTarget | null = null;
  let activeWaypointPositions: readonly Vector3[] = [];
  let nextVisualId = 0;
  let nextTemplateId = 0;

  const record = (kind: string, id: string): void => {
    calls.push({ kind, id });
  };

  const adapter: FakeSceneAdapter = {
    get calls() {
      return calls;
    },
    get liveVisuals() {
      return liveVisuals;
    },
    get liveTemplates() {
      return liveTemplates;
    },
    get visible() {
      return visible;
    },
    get pickTargetIds() {
      return pickTargetIds;
    },
    get orbCount() {
      return orbCount;
    },
    get wayfindingTarget() {
      return wayfindingTarget;
    },
    get activeWaypointPositions() {
      return activeWaypointPositions;
    },
    get audioLog() {
      return audioLog;
    },
    get transcriptLog() {
      return transcriptLog;
    },

    createWaypointRoot(id: string, _coord: TourCoord): WaypointHandle {
      record("createWaypointRoot", id);
      return { waypointId: id };
    },
    destroyWaypointRoot(handle: WaypointHandle): void {
      record("destroyWaypointRoot", handle.waypointId);
    },
    isAnchored(handle: WaypointHandle): boolean {
      if (unanchored.has(handle.waypointId)) return false;
      return (options.positions?.[handle.waypointId] ?? null) !== null;
    },
    getWorldPosition(handle: WaypointHandle): Vector3 | null {
      return options.positions?.[handle.waypointId] ?? null;
    },
    toWorldPositions(
      coords: readonly TourCoord[],
    ): readonly (Vector3 | null)[] {
      // The fake treats lat as +X metres and lon as +Z metres. Real geo math is
      // the framework's job (contract §2.5.1); here only relative distance matters.
      return coords.map((c) => new Vector3(c.lat, 0, c.lon));
    },
    getUserPosition(): Vector3 | null {
      return userPosition;
    },
    setOrbCoords(coords: readonly (TourCoord | null)[]): void {
      orbCount = coords.filter((c) => c !== null).length;
    },
    setWayfindingTarget(target: WayfindingTarget | null): void {
      wayfindingTarget = target;
    },
    setActiveWaypointPositions(positions: readonly Vector3[]): void {
      activeWaypointPositions = positions;
    },

    buildTemplate(
      kind: "model" | "sprite",
      url: string,
    ): Promise<TemplateHandle> {
      record("buildTemplate", url);
      if (options.failingAssets?.has(url) === true) {
        return Promise.reject(new Error(`corrupt asset: ${url}`));
      }
      const make = (): TemplateHandle => {
        const template = { templateId: `${kind}-${nextTemplateId++}` };
        liveTemplates.add(template.templateId);
        return template;
      };
      if (options.manualParse !== true) return Promise.resolve(make());
      return new Promise<TemplateHandle>((resolve, reject) => {
        pendingParses.set(url, {
          resolve: () => {
            resolve(make());
          },
          reject,
        });
      });
    },
    disposeTemplate(template: TemplateHandle): void {
      record("disposeTemplate", template.templateId);
      liveTemplates.delete(template.templateId);
    },
    instantiate(
      handle: WaypointHandle,
      _template: TemplateHandle,
      _hasAudio?: boolean,
    ): VisualHandle {
      record("instantiate", handle.waypointId);
      const visual = { visualId: `v${nextVisualId++}` };
      liveVisuals.add(visual.visualId);
      visualOwner.set(visual.visualId, handle.waypointId);
      return visual;
    },
    buildFallbackVisual(
      handle: WaypointHandle,
      _hasAudio?: boolean,
      showMarker = true,
    ): VisualHandle {
      record(
        showMarker ? "buildFallbackVisual" : "buildFallbackVisual:noMarker",
        handle.waypointId,
      );
      const visual = { visualId: `fallback-${nextVisualId++}` };
      liveVisuals.add(visual.visualId);
      visualOwner.set(visual.visualId, handle.waypointId);
      return visual;
    },
    releaseVisual(visual: VisualHandle): void {
      record("releaseVisual", visual.visualId);
      liveVisuals.delete(visual.visualId);
      const owner = visualOwner.get(visual.visualId);
      if (owner !== undefined) visible.delete(owner);
      visualOwner.delete(visual.visualId);
    },
    setVisible(visual: VisualHandle, isVisible: boolean): void {
      const owner = visualOwner.get(visual.visualId) ?? visual.visualId;
      record(isVisible ? "show" : "hide", owner);
      if (isVisible) visible.add(owner);
      else visible.delete(owner);
    },

    showTranscript(
      handle: WaypointHandle,
      text: string,
      centered = false,
    ): void {
      transcriptLog.push(
        `show:${handle.waypointId}:${text.slice(0, 12)}${centered ? ":centered" : ""}`,
      );
    },
    hideTranscript(handle: WaypointHandle): void {
      transcriptLog.push(`hide:${handle.waypointId}`);
    },
    disposeTranscript(handle: WaypointHandle): void {
      transcriptLog.push(`dispose:${handle.waypointId}`);
    },
    pageTranscript(
      handle: WaypointHandle,
      _uv?: { readonly u: number; readonly v: number },
    ): void {
      transcriptLog.push(`page:${handle.waypointId}`);
    },

    playAudio(handle: WaypointHandle, url: string): void {
      audioLog.push(`play:${handle.waypointId}:${url}`);
    },
    pauseAudio(): void {
      audioLog.push("pause");
    },
    resumeAudio(): void {
      audioLog.push("resume");
    },
    stopAudio(): void {
      audioLog.push("stop");
    },
    seekAudio(handle: WaypointHandle, fraction: number): void {
      audioLog.push(`seek:${handle.waypointId}:${fraction}`);
    },
    isAudioReady(): boolean {
      return options.audioReady ?? true;
    },

    setPickTargets(handles: readonly WaypointHandle[]): void {
      pickTargetIds = handles.map((h) => h.waypointId);
    },
    onTap(listener: (hit: TapHit) => void): () => void {
      return tapListeners.add(listener);
    },
    onAudioEnded(listener: () => void): () => void {
      return audioEndListeners.add(listener);
    },

    update(): void {
      /* no view work to do */
    },
    dispose(): void {
      record("dispose", "adapter");
    },

    setUserPosition(position: Vector3 | null): void {
      userPosition = position;
    },
    setAnchored(waypointId: string, anchored: boolean): void {
      if (anchored) unanchored.delete(waypointId);
      else unanchored.add(waypointId);
    },
    emitTap(hit: TapHit): void {
      tapListeners.emit(hit);
    },
    emitAudioEnded(): void {
      audioEndListeners.emit();
    },
    settleParse(url: string): void {
      pendingParses.get(url)?.resolve({ templateId: "unused" });
      pendingParses.delete(url);
    },
  };

  return adapter;
}

/** Counting `AssetProvider` — the ref-count-zero invariant is asserted on this. */
export interface CountingAssetProvider {
  getAssetUrl(id: string): Promise<string>;
  release(id: string): void;
  /** Outstanding references per asset id. Every entry must be 0 after dispose. */
  readonly counts: ReadonlyMap<string, number>;
  readonly outstanding: number;
}

export function createCountingAssetProvider(
  failing: ReadonlySet<string> = new Set(),
): CountingAssetProvider {
  const counts = new Map<string, number>();
  return {
    getAssetUrl(id: string): Promise<string> {
      if (failing.has(id)) {
        // Contract D14b: a rejection never increments — releasing it would be a
        // double-release, which is exactly what this provider would catch.
        return Promise.reject(new Error(`missing asset: ${id}`));
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
      return Promise.resolve(`blob:${id}`);
    },
    release(id: string): void {
      const next = (counts.get(id) ?? 0) - 1;
      if (next < 0) throw new Error(`double release of ${id}`);
      counts.set(id, next);
    },
    counts,
    get outstanding() {
      let total = 0;
      for (const count of counts.values()) total += count;
      return total;
    },
  };
}

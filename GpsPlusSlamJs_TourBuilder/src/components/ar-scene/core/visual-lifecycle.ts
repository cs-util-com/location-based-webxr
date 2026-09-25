/**
 * Per-waypoint visual lifecycle — the generation-guarded state machine that
 * makes the PREFETCH load safe (plan A6/A7).
 *
 * `PREFETCHING` starts an asynchronous chain: `getAssetUrl` (a byte-range fetch
 * over a mobile network) then `parseAsync` (a GLTF parse). Both are slow, and
 * the visitor keeps walking. By the time a load resolves the waypoint may have
 * dropped back to `IDLE`, bounced back into `PREFETCHING`, or already reached
 * `ACTIVE`. Getting this wrong leaks asset-provider ref-counts (the blob then
 * never revokes) or attaches a knight to a waypoint the visitor left behind.
 *
 * The guard is a **generation counter**, bumped on every entry to `IDLE` and on
 * teardown. A load captures the generation it started in; on resolve, a
 * mismatch means "discard, do not attach". The machine is pure — it returns
 * intents and performs nothing, so every race is an ordinary unit test.
 *
 * Two rules worth stating outright:
 * - **`ACTIVE` may arrive before the load resolves.** Component 4 guarantees
 *   `PREFETCHING` gets at least one tick before `ACTIVE` (contract D15) — it
 *   does not guarantee the fetch finished. So `show` on a not-yet-loaded visual
 *   records `wantVisible` and the attach step honours it, rather than blocking
 *   or dropping the knight forever.
 * - **Only a RESOLVED `getAssetUrl` may be released** (contract D14b: a
 *   rejection never incremented the ref-count, so releasing it is a
 *   double-release). Hence `loadFailed` emits no `discard`.
 *
 * @see plans/2026-07-31-ar-scene-plan.md §5.1
 */

type LoadState = "none" | "loading" | "loaded" | "failed";

export interface VisualLifecycleState {
  /** Bumped on every teardown; stale loads compare against it. */
  readonly generation: number;
  readonly load: LoadState;
  /** The waypoint is ACTIVE — show as soon as something exists to show. */
  readonly wantVisible: boolean;
  /** Something is currently attached and visible in the scene. */
  readonly visible: boolean;
}

export type LifecycleIntent =
  /** Begin the fetch+parse chain, tagged with the generation to compare later. */
  | { readonly kind: "startLoad"; readonly generation: number }
  /** The load landed for the current generation: attach it (still invisible). */
  | { readonly kind: "attach" }
  /** The load landed too late: dispose it and release its asset ref. */
  | { readonly kind: "discard" }
  /** Nothing usable will arrive: put up the procedural fallback marker. */
  | { readonly kind: "fallback" }
  | { readonly kind: "show" }
  | { readonly kind: "hide" }
  /** Drop the clone, release every asset ref, dispose the transcript. */
  | { readonly kind: "teardown" };

export interface LifecycleResult {
  readonly state: VisualLifecycleState;
  readonly intents: readonly LifecycleIntent[];
}

export function initialLifecycleState(): VisualLifecycleState {
  return { generation: 0, load: "none", wantVisible: false, visible: false };
}

/** `IDLE → PREFETCHING`: start the load, unless one is already in flight or done. */
export function onBuild(state: VisualLifecycleState): LifecycleResult {
  if (state.load !== "none") {
    // Re-entering PREFETCHING while loading, or with the model still warm from
    // a previous approach, must not fire a second `getAssetUrl` — the ref-count
    // balance is ours to keep, not the provider's to deduplicate.
    return { state, intents: [] };
  }
  return {
    state: { ...state, load: "loading" },
    intents: [{ kind: "startLoad", generation: state.generation }],
  };
}

/** `PREFETCHING → ACTIVE`: show now if we can, otherwise remember that we want to. */
export function onShow(state: VisualLifecycleState): LifecycleResult {
  const next = { ...state, wantVisible: true };
  if (state.load !== "loaded" && state.load !== "failed") {
    return { state: next, intents: [] };
  }
  if (state.visible) return { state: next, intents: [] };
  return { state: { ...next, visible: true }, intents: [{ kind: "show" }] };
}

/** `ACTIVE → PREFETCHING`: hide, but keep the parsed model warm (contract §2.5). */
export function onHide(state: VisualLifecycleState): LifecycleResult {
  const next = { ...state, wantVisible: false };
  if (!state.visible) return { state: next, intents: [] };
  return { state: { ...next, visible: false }, intents: [{ kind: "hide" }] };
}

/**
 * `PREFETCHING → IDLE` (and disposal): bump the generation so any in-flight load
 * self-discards on resolve, and tear down whatever exists.
 */
export function onTeardown(state: VisualLifecycleState): LifecycleResult {
  const next: VisualLifecycleState = {
    generation: state.generation + 1,
    load: "none",
    wantVisible: false,
    visible: false,
  };
  if (state.load === "none") return { state: next, intents: [] };
  return { state: next, intents: [{ kind: "teardown" }] };
}

/** The fetch+parse chain resolved. Attach only if it is still wanted. */
export function onLoadResolved(
  state: VisualLifecycleState,
  generation: number,
): LifecycleResult {
  if (generation !== state.generation || state.load !== "loading") {
    return { state, intents: [{ kind: "discard" }] };
  }
  const loaded: VisualLifecycleState = { ...state, load: "loaded" };
  if (!loaded.wantVisible) {
    return { state: loaded, intents: [{ kind: "attach" }] };
  }
  return {
    state: { ...loaded, visible: true },
    intents: [{ kind: "attach" }, { kind: "show" }],
  };
}

/**
 * The chain rejected (missing/corrupt asset, contract D14b). Soft-fail: the
 * waypoint keeps its anchor, still counts for proximity and progress, and gets a
 * procedural fallback marker so the visitor is not staring at empty space. No
 * `discard` — a rejected `getAssetUrl` never took a ref-count.
 */
export function onLoadFailed(
  state: VisualLifecycleState,
  generation: number,
): LifecycleResult {
  if (generation !== state.generation || state.load !== "loading") {
    return { state, intents: [] };
  }
  const failed: VisualLifecycleState = { ...state, load: "failed" };
  const intents: LifecycleIntent[] = [{ kind: "fallback" }];
  if (failed.wantVisible) {
    intents.push({ kind: "show" });
    return { state: { ...failed, visible: true }, intents };
  }
  return { state: failed, intents };
}

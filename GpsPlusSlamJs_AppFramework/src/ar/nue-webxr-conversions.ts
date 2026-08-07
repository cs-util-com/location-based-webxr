/**
 * NUE↔WebXR component conversions — the framework's curated re-export of the
 * library's canonical implementations.
 *
 * The framework keeps GPS-world content in the **NUE** convention
 * (X=North, Y=Up, Z=East); WebXR reports poses in its own (X=East, Y=Up,
 * Z=South). `gps-plus-slam-js` owns the canonical component-wise swizzles, and
 * this module simply re-exports them so consumer apps reach them through the
 * framework instead of taking a direct dependency on the library. The recorder,
 * for one, declares only `gps-plus-slam-app-framework` and has no other direct
 * library import — that boundary is deliberate.
 *
 * Same idiom as `utils/fused-path.ts` (re-exports `fusedGpsFromOdom`) and
 * `state/gps-event-coordinator.ts` (re-exports `eulerToQuaternion`): the module
 * that owns the concept re-exports the library's implementation rather than
 * restating it.
 *
 * **This is a pass-through, not a wrapper.** It deliberately does NOT widen the
 * parameter types. The predecessors (`nuePositionToWebXR` /
 * `nueQuaternionToWebXR` in `webxr-session.ts`) accepted `readonly number[]`
 * and `as`-cast it back to a tuple — an unchecked cast that would have accepted
 * a wrong-length array silently. Callers already hold `Vector3`/`Quaternion`
 * (that is what `StoreSubscriberDeps.onNewOdomPose` hands them), so the
 * widening was never needed. Do not re-introduce it.
 *
 * Matrix form of the same basis change lives in
 * {@link ./webxr-nue-basis.ts | webxr-nue-basis.ts}, which stays
 * dependency-light (three only) on purpose — the library's transitive graph
 * must not reach the modules that import it for the matrix alone.
 */

export { nueToWebXR, nueQuaternionToWebXR } from 'gps-plus-slam-js';

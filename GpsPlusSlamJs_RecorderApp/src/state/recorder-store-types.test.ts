/**
 * Raw sensor types — type-identity regression tests.
 *
 * Why these tests matter: recorder modules import the library types
 * (`RawDeviceOrientation`, `RawGpsPoint`, `RecordGpsEventPayload`) from
 * `gps-plus-slam-app-framework/state`. As part of dropping the recorder
 * app's direct `gps-plus-slam-js` dependency
 * (see `2026-05-05-recorder-app-drop-direct-core-dep-plan.md` §2.2.1),
 * that subpath is the recorder's curated route to the library types.
 * (Historically `recorder-store.ts` re-exported them; the barrel was
 * removed once the boundary migration finished — consumers now import
 * from the `state` subpath directly.)
 *
 * ⚠️ **THE ORIGIN CHECK BELOW NO LONGER DISCRIMINATES, and pretending
 * otherwise would be worse than saying so.** The framework exports a
 * second `RawDeviceOrientation` from its `sensors/gps.ts`, reachable via
 * the root barrel, and this file existed because the two had different
 * shapes: the library's angles were non-nullable, the framework's were
 * nullable. A consumer accidentally routed through the root barrel would
 * flip from one to the other, and this test would catch it.
 *
 * On 2026-08-31 the library's angles became `number | null` too, because
 * substituting `0` for an absent reading was a silent bug — `0` is a legal
 * heading meaning "facing north". The two types are now structurally
 * identical, so `toEqualTypeOf` cannot tell them apart and the import-route
 * guard is gone. What remains below is a shape assertion, which is still
 * worth having and is no longer what the file's title claims.
 *
 * The durable fix is to stop having two: the framework's `sensors/gps.ts`
 * type should alias the library's. Not done here — it is a public API
 * change to the framework, unrelated to the defect this change set fixes.
 * Recorded in
 * `GpsPlusSlamJs_Docs/docs/2026-08-31-1620-compass-absence-representable-plan.md`.
 */

import { describe, it, expectTypeOf } from 'vitest';
import type {
  RawDeviceOrientation,
  RawGpsPoint,
  RecordGpsEventPayload,
} from 'gps-plus-slam-app-framework/state';

describe('framework/state raw sensor library types', () => {
  it('RawDeviceOrientation carries absence per axis', () => {
    // CHANGED 2026-08-31 from asserting non-nullable angles. That assertion
    // was correct and its rationale is now obsolete: a producer with no
    // reading had to substitute 0, and 0 means "facing north, flat and
    // level", so the recording could not distinguish the two. The null is the
    // fix, and this pins that it survives the re-export.
    expectTypeOf<RawDeviceOrientation['alpha']>().toEqualTypeOf<
      number | null
    >();
    expectTypeOf<RawDeviceOrientation['beta']>().toEqualTypeOf<number | null>();
    expectTypeOf<RawDeviceOrientation['gamma']>().toEqualTypeOf<
      number | null
    >();
    // `absolute` stays a plain boolean - "is alpha magnetic-north relative",
    // which is a fact about the reading rather than a reading itself.
    expectTypeOf<RawDeviceOrientation['absolute']>().toEqualTypeOf<boolean>();
  });

  it('RawGpsPoint exposes the library latitude/longitude shape', () => {
    expectTypeOf<RawGpsPoint['latitude']>().toEqualTypeOf<number>();
    expectTypeOf<RawGpsPoint['longitude']>().toEqualTypeOf<number>();
  });

  it('RecordGpsEventPayload carries a RawGpsPoint', () => {
    expectTypeOf<RecordGpsEventPayload>().toHaveProperty('rawGpsPoint');
  });
});

# compass-influence-mapping.ts

## Purpose

One 0..1 "compass influence" number → the SET of library settings that together mean "the compass has this much say". Shared behaviour with a contract (root reuse rule, DEC-H3), deep-imported as `gps-plus-slam-app-framework/utils/compass-influence-mapping` by every app with a compass-influence slider: the OSM demo (since 2026-08-20; the module moved out of it on 2026-09-02) and the recorder's in-recording field wheel (2026-09-02). Not re-exported through the `utils` barrel, by the same rule as `escape-html`.

## Public API

- `CompassExperiments` — the app's experimental compass options: `rotationPriorEnabled`, `trustGateMode`, `pairSelectionEnabled`, `trustToleranceDeg`, `webXRConsistencyEnabled`. **The app owns their defaults**; this module exports none (the demo keeps its `ramp` / 15° defaults locally, the recorder passes its own).
- `CompassSettings` — the seven dispatches: `rotationPriorEnabled`, `coldStartOverrideEnabled`, `voteWeight`, `trustGateMode`, `pairSelectionEnabled`, `trustToleranceDeg`, `webXRConsistencyEnabled`, each named after its library setter in the field docs.
- `compassSettingsFor(influence, experiments)` → `CompassSettings` — clamps into [0, 1] (asymmetric in effect: −0.5 → silent, 1.5 → FULL), collapses a non-finite input to silence, returns `silentCompassSettings` at 0 and otherwise passes the weight through with the experiments applied and the cold-start flag set to the OPPOSITE of the prior.
- `silentCompassSettings(experiments)` → the only combination that genuinely silences the compass: prior OFF, cold-start OFF, weight 0, pair selection OFF, consistency OFF; the gate mode and tolerance carry the app's values because they are inert without a prior.

## Invariants & assumptions

- **Zero is three settings.** At weight 0 the steady-state weight is `1 − observability` (a full override at low observability) and a prior switched off falls through to the default-ON cold-start override with the identical curve. Only prior OFF + cold-start OFF + weight 0 is silent, and no experiment toggle may reintroduce a switch at zero: "GPS only" is the control arm of every comparison made with the slider.
- **The cold-start flag flips with the prior.** With the prior on it is inert but `false` is the honest statement of which stage drives; with the prior off it must be `true`, or "prior off" means "no compass at all" instead of "the validated Stage 0 baseline".
- **Experiments are required, not defaulted.** The demo's defaults (`ramp`, 15°) were decisions for that app at its 0.8 default weight; exporting them here would make them every consumer's defaults by accident (cold-review finding 14 on the rotation-first search plan).
- The mapping produces settings only; dispatching them (seven actions, order irrelevant because every one writes an independent state field and the library derives the config from the final state) is the app's job.

## Example

```ts
import { compassSettingsFor } from 'gps-plus-slam-app-framework/utils/compass-influence-mapping';

const s = compassSettingsFor(slider.value, myExperiments);
store.dispatch(setCompassRotationPriorEnabled(s.rotationPriorEnabled));
store.dispatch(setColdStartOverrideEnabled(s.coldStartOverrideEnabled));
store.dispatch(setCompassVoteWeight(s.voteWeight));
// ... and the other four.
```

## Tests

`compass-influence-mapping.test.ts` — the three-setting zero, silence regardless of experiments, the app's gate/tolerance carried at zero, cold-start OFF while the prior is on and ON when it is off, pass-through of the weight and every experiment, the asymmetric clamp, non-finite → silent. The demo's own tests keep covering its defaults and its readout text; the recorder's wheel tests cover the dispatch side.

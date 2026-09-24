# A — commands and immediate controls (THROWAWAY)

Open `/a-commands/` using the [shared runner](../README.md).

## Design

`createCommands(now?)` returns a closure with `setGpsPosition`,
`setLocationSource`, `setTimeSource`, atomic `setInputs`, `refresh`, state/input
readers and lifecycle methods. Each source command preserves the other source.
The closure owns the latest live fix and source selection. The browser host owns
GPS acquisition and timers. Run the shared test suite to exercise the same contract
as the other prototypes.

```ts
const model = createCommands();
// Forward the existing framework callback here:
model.setGpsPosition(frameworkFix);
model.setTimeSource({ mode: 'fixed', instant: new Date('2026-06-21T12:00:00Z') });
// Later replay: both values change before one calculation/publication.
model.setInputs({
  location: { mode: 'fixed', latitudeDeg: 52.52, longitudeDeg: 13.405 },
  time: { mode: 'fixed', instant: new Date('2026-06-21T12:00:00Z') },
});
```

## Strengths

- Source-specific intent is explicit; hosts do not need to rebuild the other input.
- Immediate feedback makes toggles and UTC scrubbing easy to understand.
- A single atomic path underlies convenience commands and paired replay.
- Location caching, subscriptions and disposal stay behind a small reusable facade.

## Weaknesses

- More public methods than configuration-only B.
- Immediate editing can publish transient invalid states while typing.
- A caller could mistakenly replay by calling two setters; documentation must
  identify atomic `setInputs` as the paired-update operation.

## Task 1 replay fit

Good: replay maps each recorded location/instant pair to `setInputs`. Fixed mode
does not read wall time, and backward/repeated pairs are deterministic. Recording
loading, seek policy and pacing remain outside the model. This implementation is
reference material only, not production code awaiting promotion.

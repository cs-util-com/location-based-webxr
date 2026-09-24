# B — atomic configuration and draft/apply (THROWAWAY)

Open `/b-configuration/` using the [shared runner](../README.md).

## Design

`createConfiguration(now?)` exposes one `configure(completeSelection)` operation,
`ingestGps`, `refresh`, readers and lifecycle methods. Events update an immutable
internal model through a small reducer, then evaluate the selected inputs. The
panel owns drafts; Apply submits a complete location/time pair once.

```ts
const model = createConfiguration();
model.configure({
  location: { mode: 'fixed', latitudeDeg: 52.52, longitudeDeg: 13.405 },
  time: { mode: 'fixed', instant: new Date('2026-06-21T12:00:00Z') },
});
// A one-source change requires host composition:
model.configure({ ...model.configuration(), time: { mode: 'real' } });
```

## Strengths

- Atomic configuration is the normal update operation, helpful for replay.
- Draft/apply avoids publishing every incomplete keystroke.
- The event reducer makes cache/lifecycle changes explicit and inspectable.

## Weaknesses

- Single-source changes require reconstructing a complete selection.
- UI maintains drafts as well as effective selection, with explicit dirty feedback.
- A slider changes the draft without immediate solar feedback; Apply adds a step.
- Live GPS/real time can continue updating while drafts are pending. Wording must
  distinguish unchanged selection from a frozen output.
- Applying the form creates manual coordinates and clears fixture-only recorded
  location metadata. Fixture stepping submits complete metadata separately.

## Task 1 replay fit

Very good: one configure call per recorded pair naturally preserves atomicity.
Replay bypasses UI drafts. No real-clock reads in fixed/fixed mode. The design's
main tradeoff is manual-control usability and host composition, not determinism.
Keep this code disposable even if its API informs later implementation.

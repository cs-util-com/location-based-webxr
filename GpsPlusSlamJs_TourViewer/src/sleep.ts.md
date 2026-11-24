# sleep.ts

## Purpose

The Tour Viewer's one `sleep`: a promise that resolves after a number of milliseconds. A pure one-liner may exist once per package; this is that copy, so a second one does not grow in another file.

## Public API

- `sleep(ms)` -> `Promise<void>`.

## Invariants and defensive measures

- Uses `setTimeout`, so it waits at least `ms` and longer when the tab is throttled; callers that measure time read the clock themselves.

## Example

```ts
await sleep(400);
```

## Tests

`sleep.test.ts`: resolves only after the time has passed (fake timers).

## Used by

- `characters/maker-main.ts`
- `checks/feature-match/worker-spike.ts`

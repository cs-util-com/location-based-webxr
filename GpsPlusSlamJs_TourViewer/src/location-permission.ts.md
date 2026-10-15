# location-permission.ts

## Purpose

The location permission the Tour Viewer's `enable()` asks for, settled
without waiting for a GPS fix (QR-first plan 2026-10-14-0445, M1b-1 review
#1). The framework's own requester fetches a position (high accuracy, no
cache, 10 s) and calls anything but a fix a failure, so a visitor indoors who
had allowed location could never start AR ("AR could not start. Tap Try
again." on every tap) - worse off than one who had declined (codes alone).

## Public API

- `locationPermissionWithoutFix({ query, request }): () => Promise<PermissionStatus>`
  - `query()` - the browser's permission state (`seams.queryGeolocationPermission`).
  - `request()` - the framework's requester (`requestGeolocationPermission`,
    or the e2e fakes' stand-in): it prompts while the browser still asks.
  - The result: `{ supported: true, granted: true }` at once when the query
    reads `"granted"` (no fix is fetched); otherwise the request's result,
    except that `granted: null` with the API present (a timeout, no position)
    becomes `granted: true` - only `PERMISSION_DENIED` (`granted: false`)
    refuses. A missing Geolocation API (`supported: false`) passes through.
    A throwing query falls back to the request.

## Invariants & assumptions

- Wired in `main.ts` around whatever requester `seams.controllerDeps` has
  (the framework's default in production), so the e2e fakes exercise it too.
- A granted permission with no fix starts AR: the session's GPS watch picks
  up the first fix whenever it comes, and a scanned code places the tour
  meanwhile (M1's zero from the code).
- Not addressed: a slow PROMPT (state "prompt" or "unknown") still runs the
  framework's request inside the tap; the visitor screen's location tap
  exists to settle the permission before that tap.

## Examples

```ts
const arController = createEnableGpsArController({
  ...seams.controllerDeps,
  requestGeolocationPermission: locationPermissionWithoutFix({
    query: () => seams.queryGeolocationPermission(),
    request:
      seams.controllerDeps.requestGeolocationPermission ??
      requestGeolocationPermission,
  }),
});
```

## Tests

`location-permission.test.ts` - a granted permission answers without a fix;
a timeout counts as granted; a refusal and a missing API pass through; a
throwing query falls back to the request. The e2e
`ar-mode.spec.js` "a visitor who allowed location but gets no fix starts AR"
drives it through the page with the fakes' requester returning
`granted: null`.

# qr-launch-hosts.ts

## Purpose

One-line: the hosts whose printed QR codes are ours.

## Public API

- `QR_LAUNCH_HOSTS: readonly string[]`

## Invariants & assumptions

- **One list, two uses, deliberately**: it gates every network request a
  scanned code could trigger, and it gates minting. Splitting them would let a
  code be anchored that the app would refuse to fetch, or the reverse.
- `localhost` is present for development. It costs nothing in production — a
  printed code cannot name a visitor's own machine in a way that resolves to
  anything but their own machine — and leaving it out would make every dev
  build silently ignore its own test codes.
- Matching is exact on the parsed hostname; see `qr-code-origin.ts.md` in the
  framework for what that does and does not defend against.

## Tests

Covered through `qr-level-zip-contributor.test.ts` (a foreign code refused)
and the framework's own `qr-code-origin.test.ts`.

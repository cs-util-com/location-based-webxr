# start-aux-server.mjs - the local tools' server

- Purpose: one place that starts `serve.mjs` for the design system's local
  tools (`shoot-3d.mjs`, `measure-globe.mjs`) on the aux port 5198, bound to
  127.0.0.1 (docs/dev-server-ports.md). Its readiness line and port are a
  contract, so it lives once (DEC-H3), not copied per tool.
- Public API: `AUX_PORT` (5198); `startAuxServer(port?)` resolves with the
  child process once serve.mjs prints "design system served", and rejects
  when it exits first. The caller kills the child when done.
- Invariants: never reuses a server left running (a phone round's
  `pnpm run serve` is on 4173).
- Tests: none of its own; both tools exercise it on every run.

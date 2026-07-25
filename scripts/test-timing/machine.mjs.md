> **Mirror of the GpsPlusSlamJs pilot** — see `README.md` in this directory; fix pure-module bugs upstream first.

# machine.mjs — anonymized machine identity for timing recordings

- Purpose: pure builders for the machine fingerprint and human-readable label stored in the versioned `docs/test-timings.md`. The raw hostname must never appear there (privacy leak, [followups §4](../../docs/2026-07-02-0253-test-timing-implementation-followups.md)) — both builders replace it with the first 8 hex chars of its sha256.
- Public API:
  - `anonymizeHostname(hostname)` → 8 lowercase hex chars (`sha256(hostname).slice(0, 8)`). Deterministic, so same-machine history comparison keeps working across runs.
  - `machineFingerprint(hostname, cpuModel, cores)` → `host-hash|cpu-slug|cores` (plan §5; the cpu slug is `[^a-zA-Z0-9]+`→`-`, trimmed, max 40 chars).
  - `machineLabel(hostname, cpuModel, cores)` → `host-hash (cpuModel, N threads)` for the md header — same hash as the fingerprint so header and JSON entries stay correlatable.
- Invariants & assumptions:
  - The host slot of both outputs is exactly the hash — never the input (property-tested). CPU model and core count stay readable by design: they carry the "are these seconds comparable?" signal, and a CPU model is not personally identifying.
  - This is **pseudonymization, not strong anonymity**: the hash is unsalted, so a common hostname (`MSI`, `DESKTOP-…`) is dictionary-guessable from the 8 chars. Good enough to keep plain hostnames out of the repo; re-evaluate (e.g. salt) before the Phase-2 public package ships defaults.
  - Changing the hash function or prefix length breaks same-machine continuity with the recorded history — existing entries in `docs/test-timings.md` would all show `baseline reset` (the 2026-07-10 introduction migrated `MSI` → `f936c64e` in place to avoid exactly that).
  - Inputs are not validated (module-internal, callers pass `os.hostname()`/`os.cpus()` values); a non-string hostname throws from `createHash().update()`.
- Examples: `machineFingerprint('MSI', '11th Gen Intel(R) Core(TM) i7-1185G7 @ 3.00GHz', 8)` → `'f936c64e|11th-Gen-Intel-R-Core-TM-i7-1185G7-3-00G|8'`.
- Tests: [machine.test.mjs](machine.test.mjs) (pinned `MSI` hash so the migrated history keeps matching, format examples), [machine.property.test.mjs](machine.property.test.mjs) (hash always 8 hex chars for arbitrary strings; host slot of fingerprint/label is exactly the hash).

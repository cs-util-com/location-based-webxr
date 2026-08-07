/**
 * Regenerates `src/rules/default-rules.ts` from the published Google Sheet.
 *
 * Run with `pnpm run import:rule-table`. Deliberately manual: the snapshot is a
 * checked-in artefact, and its whole purpose is to be a version someone chose
 * and reviewed rather than whatever the sheet happened to say at build time.
 *
 * Emits a `.ts` module, not JSON: an ESM JSON import needs import attributes,
 * which need `module: nodenext`, and this package targets ES2022. Same reason
 * `polygon-features.ts` is a module.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWD-aZgPzMYThZhVNkUomlhjq88MU9XnumlmFw4nYiiHB0VavFAtVrWKWjbB-nrjCsXo--CoWZW47k/pub?gid=0&single=true&output=csv";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "rules",
  "default-rules.ts",
);

const response = await fetch(CSV_URL, {
  headers: { "User-Agent": "gps-plus-slam-osm import-rule-table" },
});
if (!response.ok) {
  console.error(`Fetch failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const csv = (await response.text()).replace(/\r\n?/g, "\n");

// Sanity checks before overwriting a checked-in file. The failure this guards
// against is committing a Google login page as the rule table: it is valid text,
// it contains commas, and it would silently score every cell at the identity.
const lines = csv.split("\n");
const header = lines[0] ?? "";
if (!header.startsWith("id,")) {
  console.error(
    `Refusing to write: first line does not look like the sheet header.\nGot: ${header.slice(0, 200)}`,
  );
  process.exit(1);
}
if (csv.length < 10_000) {
  console.error(
    `Refusing to write: response is only ${csv.length} bytes, far below the expected ~98 KB.`,
  );
  process.exit(1);
}

const version = new Date().toISOString().slice(0, 10);
const rowEstimate = lines.filter((line) =>
  /^[a-z][a-z0-9_:]*_/.test(line),
).length;

const module = `/**
 * Checked-in snapshot of the published affordance rule sheet.
 *
 * GENERATED — do not hand-edit. Regenerate with \`pnpm run import:rule-table\`.
 *
 * Source: ${CSV_URL}
 * Captured: ${version}
 * Bytes: ${csv.length}
 * Rule-looking rows: ~${rowEstimate}
 *
 * **Why this file exists.** The rule table is fetched at runtime by owner
 * decision (plan §2.1), which makes it a live, unversioned, externally-editable
 * network dependency. This snapshot is the floor under that: tests are
 * deterministic and offline, a first run with no network still produces sensible
 * results, and \`checkDrift\` has something to compare a fetched table against.
 *
 * It is **vendored data, not a dependency** — a table we own and version, which
 * is categorically different from executing someone else's code (§4.2).
 *
 * Stored as raw CSV rather than a pre-parsed object on purpose: the parser is
 * then exercised by every test that uses the snapshot, so a parser regression
 * cannot hide behind pre-digested data.
 */

/** ISO date on which the snapshot was captured. */
export const DEFAULT_RULE_TABLE_VERSION = ${JSON.stringify(version)};

/** The published sheet, verbatim. */
export const DEFAULT_RULE_TABLE_CSV = ${JSON.stringify(csv)};
`;

writeFileSync(OUT, module, "utf8");
console.log(
  `Wrote ${OUT}\n  ${csv.length} bytes, ~${rowEstimate} rule rows, version ${version}`,
);

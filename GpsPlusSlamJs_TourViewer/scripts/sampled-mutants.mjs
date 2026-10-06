#!/usr/bin/env node
// A sampled mutation pass (code book refactor plan M1, M1 review #6): apply
// each hand-made text mutant from a JSON list to its file, run the listed
// unit tests, and report killed / survived per region. The original text is
// restored from memory after every mutant and in a `finally`, never through
// git. See sampled-mutants.mjs.md.
//
//   node scripts/sampled-mutants.mjs scripts/creator-setup.mutants.json
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listPath = process.argv[2];
if (listPath === undefined) {
  console.error("usage: node scripts/sampled-mutants.mjs <mutants.json>");
  process.exit(2);
}
/** @type {{ tests: string[]; mutants: { name: string; region: string; file: string; from: string; to: string; expected?: "equivalent" | "known-gap"; why?: string }[] }} */
const list = JSON.parse(readFileSync(resolve(packageDir, listPath), "utf8"));

/** @type {Map<string, string>} */
const originals = new Map();
const results = [];
try {
  for (const m of list.mutants) {
    const path = resolve(packageDir, m.file);
    if (!originals.has(path)) originals.set(path, readFileSync(path, "utf8"));
    const original = /** @type {string} */ (originals.get(path));
    const at = original.indexOf(m.from);
    if (at < 0 || original.indexOf(m.from, at + 1) >= 0) {
      results.push({ ...m, outcome: at < 0 ? "missing" : "ambiguous" });
      console.log(`${results.at(-1).outcome.padEnd(10)}${m.region}: ${m.name}`);
      continue;
    }
    writeFileSync(path, original.replace(m.from, m.to));
    let outcome = "survived";
    try {
      execSync(`pnpm run test:unit ${list.tests.join(" ")}`, {
        cwd: packageDir,
        stdio: "pipe",
        env: { ...process.env, GATE_SLOT_DIR: "off" },
      });
    } catch {
      outcome = "killed";
    } finally {
      writeFileSync(path, original);
    }
    // A mutant judged equivalent, or a known gap (`expected`, with `why`),
    // is reported as such when it survives; it does not fail the run.
    const label =
      outcome === "survived" && m.expected !== undefined ? m.expected : outcome;
    results.push({ ...m, outcome: label });
    console.log(`${label.padEnd(11)}${m.region}: ${m.name}`);
  }
} finally {
  for (const [path, text] of originals) writeFileSync(path, text);
}

const byRegion = new Map();
for (const r of results) {
  const row = byRegion.get(r.region) ?? {
    killed: 0,
    survived: 0,
    accepted: 0,
    other: 0,
  };
  if (r.outcome === "killed") row.killed += 1;
  else if (r.outcome === "survived") row.survived += 1;
  else if (r.outcome === "equivalent" || r.outcome === "known-gap")
    row.accepted += 1;
  else row.other += 1;
  byRegion.set(r.region, row);
}
console.log(
  "\nregion: killed / survived / equivalent-or-known-gap / missing-or-ambiguous",
);
for (const [region, row] of byRegion) {
  console.log(
    `  ${region}: ${row.killed} / ${row.survived} / ${row.accepted} / ${row.other}`,
  );
}
const survived = results.filter((r) => r.outcome === "survived").length;
const accepted = results.filter(
  (r) => r.outcome === "equivalent" || r.outcome === "known-gap",
).length;
const broken = results.filter(
  (r) => r.outcome === "missing" || r.outcome === "ambiguous",
).length;
console.log(
  `total: ${results.length - survived - broken - accepted} killed, ${survived} survived, ${accepted} equivalent or known gaps, ${broken} not applied`,
);
process.exitCode = survived > 0 || broken > 0 ? 1 : 0;

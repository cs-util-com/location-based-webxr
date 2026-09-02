/**
 * Vendor design.css into the apps that adopted it.
 *
 * WHY A COPY AND NOT A DEPENDENCY (DEC-L2-3, adoption plan §4). A
 * workspace dependency would put this package into the apps' dependency
 * graph, and `test:changed` runs a changed package PLUS its dependents -
 * so every taste tweak here would run every consuming app's gate, minutes
 * of TypeScript checking that cannot see a CSS regression. The catalog's
 * gate is seconds-cheap on purpose. A verbatim copy keeps it that way and
 * pins each app to the revision it chose to sync. The precedent, with the
 * same reasoning, is tests/repo-config/escape-html-copies.test.js.
 *
 * WHAT MAKES THE COPY SAFE. tests/repo-config/design-css-copies.test.js
 * fails the root gate when any app's copy differs from this file by a
 * byte (CRLF-normalised), when an app links the sheet without holding a
 * copy, or when it holds a copy it never links.
 *
 * Usage (from GpsPlusSlamJs_DesignSystem/):
 *   pnpm run vendor                 # refresh every app that already holds a copy
 *   pnpm run vendor -- <AppDir>     # add an app (first copy), then refresh all
 *
 * The app list is NOT hard-coded here or in the guard: both derive it from
 * the filesystem (every GpsPlusSlamJs_<app>/design.css), so there is one
 * source of truth - the copies themselves.
 */
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = join(here, "design.css");

const adding = process.argv.slice(2).filter((a) => !a.startsWith("-"));
for (const app of adding) {
  const dir = join(root, app);
  if (!existsSync(join(dir, "index.html"))) {
    console.error(`vendor: ${app} is not an app directory (no index.html)`);
    process.exit(2);
  }
}

const holders = readdirSync(root)
  .filter(
    (d) => /^GpsPlusSlamJs_/.test(d) && d !== "GpsPlusSlamJs_DesignSystem",
  )
  .filter((d) => existsSync(join(root, d, "design.css")));
const targets = [...new Set([...holders, ...adding])].sort();

if (targets.length === 0) {
  console.log(
    "vendor: no app holds a copy yet - pass an app directory to add one",
  );
  process.exit(0);
}
for (const app of targets) {
  const dest = join(root, app, "design.css");
  copyFileSync(source, dest);
  console.log(`vendor: ${app}/design.css  (${statSync(dest).size} bytes)`);
}

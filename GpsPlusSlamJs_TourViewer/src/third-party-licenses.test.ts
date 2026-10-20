/**
 * Why these tests matter: the deployed app is a bundle of other people's
 * code, and their licences ask for their notices to travel with every
 * copy - MIT and BSD the copyright and permission notice, the Apache
 * License 2.0 its text (section 4(a)), the package's NOTICE file (4(d))
 * and a statement that a changed copy was changed (4(b)). A production
 * build keeps no licence comment (measured: none survive the minifier), so
 * the app ships each bundled package's own licence file, verbatim, under
 * `public/third-party-licenses/`, which the build copies into the site.
 *
 * The list is derived from the builds' module ids
 * (`test-support/bundled-packages.ts`), never kept by hand: a new
 * dependency, or a dependency's dependency, that reaches the bundle fails
 * here until its licence ships and the NOTICE names it.
 *
 * The project's own packages (`gps-plus-slam-*`) are not third-party and
 * carry their own licence and NOTICE.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import {
  appModuleIds,
  bundledPackages,
  globeEntryModuleIds,
} from "./test-support/bundled-packages.js";

const LICENCES = new URL("../public/third-party-licenses/", import.meta.url);

/** A package's shipped file name stem: `@scope/name` as `scope-name`. */
const slug = (p: string) => p.replace(/^@/, "").replace("/", "-");

/** Where the app ships a package's licence file and its NOTICE file. */
const shippedLicence = (p: string) =>
  new URL(`${slug(p)}-LICENSE.txt`, LICENCES);
const shippedNotice = (p: string) => new URL(`${slug(p)}-NOTICE.txt`, LICENCES);

/** The project's own packages: not third-party. */
const firstParty = (p: string) => p.startsWith("gps-plus-slam");

/** A package's own licence file, by the names packages use (any case:
 *  `LICENSE`, `LICENSE.md`, `license`, `LICENCE.txt`, ...), or null. */
function ownFile(dir: string, stem: RegExp): string | null {
  const name = readdirSync(dir).find((f) => stem.test(f));
  return name === undefined ? null : `${dir}/${name}`;
}
const LICENCE_FILE = /^licen[cs]e(\.(txt|md))?$/i;
const NOTICE_FILE = /^notice(\.(txt|md))?$/i;

/** The workspace's patched packages, name to patch file (`name@version: path`). */
function patchedPackages(): Map<string, string> {
  const yaml = readFileSync(
    new URL("../../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  const block = /^patchedDependencies:\n((?:[ \t]+.*\n?)*)/m.exec(yaml)?.[1];
  const patched = new Map<string, string>();
  for (const line of (block ?? "").split("\n")) {
    const m = /^\s+["']?((?:@[^/@]+\/)?[^@"'\s]+)@[^:]+:\s*(\S+)/.exec(line);
    if (m) patched.set(m[1]!, m[2]!);
  }
  return patched;
}

/** The NOTICE's entry for a package: from its "(npm: <name>," to the next
 *  list item, or "" when it has none. */
function noticeEntry(notice: string, p: string): string {
  const at = notice.indexOf(`(npm: ${p},`);
  if (at < 0) return "";
  const next = notice.indexOf("\n- ", at);
  return notice.slice(at, next < 0 ? undefined : next);
}

const sameText = (a: string, b: string) =>
  a.replaceAll("\r\n", "\n").trim() === b.replaceAll("\r\n", "\n").trim();

describe("the third-party licences the app ships", () => {
  /** Every third-party package either build bundles, with its directory. */
  let bundled: Map<string, string>;
  const notice = readFileSync(new URL("../NOTICE", import.meta.url), "utf8");

  beforeAll(async () => {
    const ids = [...(await appModuleIds()), ...(await globeEntryModuleIds())];
    bundled = new Map(
      [...bundledPackages(ids)].filter(([p]) => !firstParty(p)),
    );
  }, 180_000);

  it("finds the bundle's packages: the app's own and the globe's", () => {
    // A build that silently bundled nothing would pass every check below.
    for (const p of [
      "three",
      "leaflet",
      "@zip.js/zip.js",
      "3d-tiles-renderer",
    ]) {
      expect(bundled.has(p), p).toBe(true);
    }
  });

  it("every bundled package has a licence file of its own", () => {
    // Its own failure, legibly: a package without one cannot be shipped
    // by copying, and needs a decision (its licence text from elsewhere).
    const without = [...bundled]
      .filter(([, dir]) => ownFile(dir, LICENCE_FILE) === null)
      .map(([p]) => p);
    expect(without).toEqual([]);
  });

  it("ships every bundled package's licence file verbatim", () => {
    const unshipped = [...bundled]
      .filter(([p, dir]) => {
        const own = ownFile(dir, LICENCE_FILE);
        return (
          own !== null &&
          (!existsSync(shippedLicence(p)) ||
            !sameText(
              readFileSync(shippedLicence(p), "utf8"),
              readFileSync(own, "utf8"),
            ))
        );
      })
      .map(([p]) => p);
    expect(unshipped).toEqual([]);
  });

  it("ships a bundled package's NOTICE file verbatim (Apache 2.0, 4(d))", () => {
    const unshipped = [...bundled]
      .filter(([p, dir]) => {
        const own = ownFile(dir, NOTICE_FILE);
        return (
          own !== null &&
          (!existsSync(shippedNotice(p)) ||
            !sameText(
              readFileSync(shippedNotice(p), "utf8"),
              readFileSync(own, "utf8"),
            ))
        );
      })
      .map(([p]) => p);
    expect(unshipped).toEqual([]);
  });

  it("ships nothing for a package the app no longer bundles", () => {
    const expected = new Set([
      // The app's own NOTICE ships beside the licences (checked below).
      "NOTICE.txt",
      ...[...bundled].flatMap(([p, dir]) => [
        `${slug(p)}-LICENSE.txt`,
        ...(ownFile(dir, NOTICE_FILE) === null
          ? []
          : [`${slug(p)}-NOTICE.txt`]),
      ]),
    ]);
    const stale = readdirSync(LICENCES).filter((f) => !expected.has(f));
    expect(stale).toEqual([]);
  });

  it("names every bundled package in the NOTICE", () => {
    // Named as the NOTICE names a package: "(npm: <name>,".
    const missing = [...bundled.keys()].filter(
      (p) => !notice.includes(`(npm: ${p},`),
    );
    expect(missing).toEqual([]);
  });

  it("says, per patched bundled package, that its copy is modified and by which patch (Apache 2.0, 4(b))", () => {
    const patched = patchedPackages();
    expect(patched.has("3d-tiles-renderer")).toBe(true);
    const unsaid = [...bundled.keys()].filter((p) => {
      const patch = patched.get(p);
      if (patch === undefined) return false;
      const entry = noticeEntry(notice, p);
      return !/\bmodified\b/i.test(entry) || !entry.includes(patch);
    });
    expect(unsaid).toEqual([]);
  });
});

describe("the build tools' own modules", () => {
  // Why: a build's virtual modules (ids starting with "\0") belong to no
  // npm package, so the licence checks above never see them. The known
  // ones are a few lines of runtime the build tools emit into every build
  // (`test-support/bundled-packages.ts` says why no licence ships for
  // them); an unknown one may be a plugin's library inlined under a
  // virtual id, and must fail until someone decides.
  it("accepts the known ones", () => {
    expect(
      bundledPackages([
        "\0vite/preload-helper.js",
        "\0vite/modulepreload-polyfill.js",
        "\0rolldown/runtime.js",
      ]).size,
    ).toBe(0);
  });

  it("fails on a virtual module it does not know", () => {
    expect(() => bundledPackages(["\0some-plugin/inlined-lib.js"])).toThrow(
      /some-plugin\/inlined-lib\.js/,
    );
  });
});

describe("the NOTICE the app ships", () => {
  // Why: the NOTICE (with the 3d-tiles-renderer "MODIFIED" statement,
  // Apache 2.0 4(b)) sits beside the source; only public/ reaches the
  // site, so a copy ships there and must not drift from it.
  it("ships the package's NOTICE verbatim", () => {
    const shipped = new URL("NOTICE.txt", LICENCES);
    expect(existsSync(shipped)).toBe(true);
    expect(
      sameText(
        readFileSync(shipped, "utf8"),
        readFileSync(new URL("../NOTICE", import.meta.url), "utf8"),
      ),
    ).toBe(true);
  });
});

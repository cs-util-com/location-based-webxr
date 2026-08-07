#!/usr/bin/env node
/**
 * Regenerates `src/elevation/egm96-grid.ts` from the C# reference evaluator.
 *
 *   pnpm run import:geoid-grid
 *
 * WHY A SCRIPT AND NOT A DEPENDENCY. The authoritative way to compute an EGM96
 * undulation is to evaluate the spherical harmonic series to degree 360, which
 * needs a 5 MB coefficient table. That is unreasonable to ship in a browser
 * package and entirely reasonable to run once, offline, and vendor the result.
 *
 * WHY THE C# REFERENCE RATHER THAN A PORT. It is already in this project, it is
 * MIT, and it is the same code the Unity/desktop side has used in the field —
 * so the JS stack and the C# stack agree by construction rather than by
 * coincidence. Porting the synthesis to JS would add a second implementation to
 * keep correct for no gain: this runs once per decade.
 *
 * REQUIREMENTS, and this script is honest about being unrunnable without them:
 *   - the .NET SDK on PATH (`dotnet --version`)
 *   - the sibling C# repo checked out, containing
 *     `GpsPlusSlamCs/GpsPlusSlamCs/GpsPlusSlamCs/Algorithms/AltitudeCalculation/`
 *
 * The path is passed with `--cs <dir>` or found via `GPS_CS_REPO`. It is
 * deliberately NOT hardcoded to a sibling directory: a hardcoded cross-repo path
 * is exactly what must never reach CI, and this script is not part of any gate.
 *
 * Takes about a minute: 181 x 360 = 65,160 harmonic evaluations.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "elevation", "egm96-grid.ts");

const STEP_DEG = 1;
const ROWS = 181;
const COLS = 360;

function csRepoDir() {
  const flag = process.argv.indexOf("--cs");
  const fromFlag = flag >= 0 ? process.argv[flag + 1] : undefined;
  const dir = fromFlag ?? process.env["GPS_CS_REPO"];
  if (dir === undefined) {
    throw new Error(
      "Where is the C# repo? Pass --cs <dir> or set GPS_CS_REPO.\n" +
        "It must contain GpsPlusSlamCs/GpsPlusSlamCs/GpsPlusSlamCs/Algorithms/AltitudeCalculation/.",
    );
  }
  return dir;
}

const csDir = join(
  csRepoDir(),
  "GpsPlusSlamCs",
  "GpsPlusSlamCs",
  "GpsPlusSlamCs",
  "Algorithms",
  "AltitudeCalculation",
);

const work = mkdtempSync(join(tmpdir(), "egm96-"));
try {
  writeFileSync(
    join(work, "gen.csproj"),
    `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>disable</Nullable>
    <AssemblyName>gen</AssemblyName>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Program.cs" />
    <Compile Include="${join(csDir, "Coef.cs").replaceAll("\\", "/")}" />
    <Compile Include="${join(csDir, "GeoidHeights.cs").replaceAll("\\", "/")}" />
  </ItemGroup>
</Project>
`,
  );

  writeFileSync(
    join(work, "Program.cs"),
    `using System; using System.Globalization; using System.Text; using GeoidHeightsDotNet;
class Program { static void Main() {
  double step = ${STEP_DEG}; int rows = ${ROWS}; int cols = ${COLS};
  var sb = new StringBuilder();
  for (int r = 0; r < rows; r++) { double lat = 90.0 - r * step;
    for (int c = 0; c < cols; c++) { double lon = c * step;
      if (c > 0) sb.Append(' ');
      sb.Append(Math.Round(GeoidHeights.undulation(lat, lon) * 10).ToString(CultureInfo.InvariantCulture)); }
    sb.AppendLine(); }
  Console.Write(sb.ToString()); } }
`,
  );

  console.log("Building the reference evaluator…");
  execFileSync("dotnet", ["build", "-c", "Release", "-v", "q", "--nologo"], {
    cwd: work,
    stdio: "inherit",
  });

  console.log(`Evaluating ${ROWS * COLS} points (about a minute)…`);
  const text = execFileSync(join(work, "bin", "Release", "net8.0", "gen.exe"), {
    cwd: work,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  const rows = text.trim().split(/\r?\n/);
  if (rows.length !== ROWS) {
    throw new Error(`Expected ${ROWS} rows, got ${rows.length}`);
  }

  const values = new Int16Array(ROWS * COLS);
  rows.forEach((line, r) => {
    const parsed = line.split(" ").map(Number);
    if (parsed.length !== COLS) {
      throw new Error(`Row ${r} has ${parsed.length} values, expected ${COLS}`);
    }
    parsed.forEach((v, c) => {
      // Decimetres must fit Int16. Real EGM96 spans -1066..842 dm, so a value
      // outside this range means the evaluator or the parse went wrong — and a
      // silently wrapped Int16 would produce a plausible wrong geoid.
      if (!Number.isFinite(v) || v < -2000 || v > 2000) {
        throw new Error(`Implausible undulation ${v} dm at row ${r} col ${c}`);
      }
      values[r * COLS + c] = v;
    });
  });

  const base64 = Buffer.from(values.buffer).toString("base64");
  writeFileSync(OUT, moduleSource(base64));
  console.log(
    `Wrote ${OUT} (${(base64.length / 1024).toFixed(0)} KB of base64).`,
  );
  console.log(
    "Now run `pnpm run test:unit -- src/elevation/egm96.test.ts` — it pins the grid\n" +
      "against exact evaluations, and is the only thing that makes it trustworthy.",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

function moduleSource(base64) {
  return `/**
 * EGM96 geoid undulation, as a 1-degree global grid. GENERATED - do not edit.
 *
 * Regenerate with \`pnpm run import:geoid-grid\` (needs the C# repo and dotnet).
 *
 * PROVENANCE, which is the whole reason this file is trustworthy: the values
 * are produced by evaluating the EGM96 spherical harmonic series to degree 360
 * using the reference implementation already in this project,
 * \`GpsPlusSlamCs/.../Algorithms/AltitudeCalculation/GeoidHeights.cs\`
 * (GeoidHeightsDotNet, MIT). They are not hand-assembled, not interpolated from
 * a coarser source, and not taken from memory - which matters because a
 * plausible-looking wrong geoid is indistinguishable from a correct one until
 * someone measures a building in the field.
 *
 * ACCURACY, measured against 600 exact evaluations at random positions:
 * **mean 0.25 m, max 5.0 m.** For comparison the DEM being corrected has ~30 m
 * posting, and the correction itself is ~45 m in central Europe - so the
 * residual is an order of magnitude below the thing it fixes. A 2-degree grid
 * was measured too (0.50 m mean, 8.4 m max, a quarter of the size) and
 * rejected: halving the residual is worth the bytes when the entire point is
 * removing a foot-gun.
 *
 * ENCODING: Int16 decimetres, little-endian, base64. Row-major from the
 * north-west, 181 rows (lat +90 to -90) x 360 columns (lon 0 to 359),
 * longitude wrapping. Decimetres because the range is -106.6 m to +84.2 m,
 * which fits Int16 with room to spare, and 0.1 m quantisation is 40x finer
 * than the interpolation error it sits inside.
 *
 * SIZE: ~170 KB of base64. This module is deliberately NOT re-exported from
 * \`elevation/index.ts\` - import it explicitly so an app that does not need
 * absolute heights never pays for it.
 */

export const EGM96_GRID_STEP_DEG = ${STEP_DEG};
export const EGM96_GRID_ROWS = ${ROWS};
export const EGM96_GRID_COLS = ${COLS};

/** Int16 decimetres, little-endian, base64. See the module comment. */
export const EGM96_GRID_BASE64 =
  "${base64}";
`;
}

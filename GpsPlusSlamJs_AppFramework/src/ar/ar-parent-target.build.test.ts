/**
 * Why this test matters: the synthetic world jump (`?devWorldJumpM`,
 * `?devWorldJumpDeg`) moves every anchored object on purpose, and the
 * deferral switch (`?anchors=0`) lets every correction jump in view. Neither
 * may reach a visitor, so their URL readers have to vanish from a production build.
 * This bundles the binding's module the way an app's production build sees
 * it (`import.meta.env.DEV` false, minified) and asserts the reader is gone;
 * the same build with `DEV` true is the control that it would be found.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'dev-world-jump-build-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

interface RolldownOutput {
  output: { type: string; code?: string }[];
}
interface Rolldown {
  rolldown(options: Record<string, unknown>): Promise<{
    generate(options: Record<string, unknown>): Promise<RolldownOutput>;
    close(): Promise<void>;
  }>;
}

async function loadRolldown(): Promise<Rolldown> {
  // rolldown is tsdown's bundler; resolved through it, not a dependency here.
  const require = createRequire(import.meta.url);
  const fromTsdown = createRequire(require.resolve('tsdown'));
  return (await import(
    pathToFileURL(fromTsdown.resolve('rolldown')).href
  )) as Rolldown;
}

/** Bare imports stay imports: only this package's code is checked. */
const external = (id: string): boolean =>
  !id.startsWith('.') && !/^[A-Za-z]:|^[\\/]/.test(id);

async function run(
  rolldown: Rolldown['rolldown'],
  options: Record<string, unknown>,
  minify: boolean
): Promise<string> {
  const build = await rolldown({ external, logLevel: 'silent', ...options });
  try {
    const { output } = await build.generate({ format: 'es', minify });
    return output.map((chunk) => chunk.code ?? '').join('\n');
  } finally {
    await build.close();
  }
}

/**
 * The two steps a visitor's bundle goes through: this package's build (TS
 * to plain JS, `import.meta.env` kept as written), then the app's
 * production build, which replaces `import.meta.env` and minifies.
 */
async function bundle(dev: boolean): Promise<string> {
  const { rolldown } = await loadRolldown();
  const packageJs = await run(
    rolldown,
    {
      input: resolve(
        projectRoot,
        'src/visualization/ar-world-group-alignment.ts'
      ),
    },
    false
  );
  const file = join(scratch, `package-${dev}.mjs`);
  writeFileSync(file, packageJs);
  return run(
    rolldown,
    {
      input: file,
      transform: {
        define: {
          'import.meta.env.DEV': JSON.stringify(dev),
          'import.meta.env': JSON.stringify({ DEV: dev, PROD: !dev }),
        },
      },
    },
    true
  );
}

/** The deferral switch's URL parameter name as a string literal. */
const ANCHORS_PARAM = /["'`]anchors["'`]/;

describe('the dev readers in a production build', () => {
  it('is dropped when import.meta.env.DEV is false', async () => {
    const code = await bundle(false);
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toContain('devWorldJump');
    expect(code).not.toMatch(ANCHORS_PARAM);
  });

  it('is present when import.meta.env.DEV is true (control)', async () => {
    const code = await bundle(true);
    expect(code).toContain('devWorldJump');
    expect(code).toMatch(ANCHORS_PARAM);
  });
});

/**
 * Test-only: fast-check generators of tour content, shared by every
 * package's property tests (the framework's and the Tour Viewer's), so a
 * property about blocks or stories is always run against the same,
 * deliberately hostile, picture of the format:
 *
 * - texts at and across every cap, counted as the reader counts them
 *   (`tourTextCount`): plain letters, combining marks, surrogate pairs,
 *   CJK, whitespace runs inside and padding outside (which the count
 *   ignores and the reader keeps);
 * - ids up to their 64-character limit, block ids that collide with asset
 *   ids (separate namespaces) and with step ids;
 * - valid version 4 blocks of every kind in every view this reader draws,
 *   free ones in a world view, story ones in any;
 * - stations' contents: free and story blocks, shows, choices whose
 *   options jump or continue, quizzes of every answer type;
 * - whole version 4 manifests of one to four stations, block ids unique
 *   across the tour.
 *
 * `fast-check` is NOT bundled into the built file (`neverBundle` in
 * `config/tsdown.config.ts`): it is imported as a bare specifier and
 * resolved from the consumer's own devDependency. No production module
 * imports this file.
 *
 * @see tour-arbitraries.ts.md
 */

import fc from 'fast-check';

import {
  TOUR_BLOCK_TEXT_RULES,
  TOUR_BLOCK_VIEWS,
  TOUR_MODEL_ANIMATION_RULES,
  TOUR_MODEL_MAX_NOTES,
  TOUR_MODEL_MAX_SECTIONS,
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
  TOUR_MODEL_NOTE_RULES,
  TOUR_MODEL_SECTION_RULES,
  TOUR_MODEL_SPACE_MAX,
  TOUR_MODEL_WORLD_VIEWS,
  TOUR_PICTURE_MAX_WIDTH_M,
  TOUR_PICTURE_MIN_WIDTH_M,
  type TourBlockKind,
  type TourTextRule,
} from '../ar/tour-blocks.js';

/** The assets every generated block names: one or two of each kind, with
 *  ids the block id generator also produces (they may collide). */
export const TOUR_ARBITRARY_ASSETS = [
  { id: 'gate', path: 'content/gate.jpg', width: 800, height: 600 },
  { id: 'knight', path: 'content/knight.png', width: 512, height: 1024 },
  { id: 'voice', path: 'content/voice.mp3' },
  { id: 'arch', path: 'content/arch.glb' },
  { id: 'clip', path: 'content/clip.mp4' },
] as const;

const IMAGE_ASSETS = ['gate', 'knight'] as const;

/** Text pieces and what each costs in the count: a letter, a precomposed
 *  letter, a letter's combining mark (its own code point), a surrogate
 *  pair (one code point, two UTF-16 units), a CJK character. */
const GLYPHS = ['a', 'Z', 'é', '́', '\u{1F600}', '\u{20000}', '水', '7'];
/** Whitespace a run may be made of (each run counts as one space). */
const SPACES = [' ', '\t', '\n', ' ', '　', '\r\n'];

/** How many counted units to build: biased to the boundaries. */
function countIn(min: number, max: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constant(min),
    fc.constant(max),
    fc.constant(Math.max(min, max - 1)),
    fc.integer({ min, max })
  );
}

interface TextShape {
  /** Indices into GLYPHS, cycled; a negative entry is a space. */
  readonly pattern: readonly number[];
  readonly runs: readonly number[];
  readonly pad: readonly [number, number];
}

const textShape: fc.Arbitrary<TextShape> = fc.record({
  pattern: fc.array(fc.integer({ min: -2, max: GLYPHS.length - 1 }), {
    minLength: 1,
    maxLength: 12,
  }),
  runs: fc.array(fc.integer({ min: 0, max: SPACES.length - 1 }), {
    minLength: 1,
    maxLength: 4,
  }),
  pad: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 })),
});

/** A text counting exactly `n` code points after trimming and collapsing:
 *  never a space first, last or beside another; each space written as a
 *  whitespace run; padded outside. */
function codePointText(n: number, shape: TextShape): string {
  const out: string[] = [];
  let previousSpace = true;
  for (let i = 0; i < n; i++) {
    const g = shape.pattern[i % shape.pattern.length]!;
    const space: boolean = g < 0 && !previousSpace && i !== n - 1;
    if (space) {
      const run = SPACES[shape.runs[i % shape.runs.length]!]!;
      out.push(run === ' ' ? ' ' : ` ${run}`);
    } else {
      // A surrogate pair is one code point: the count is unchanged.
      out.push(g < 0 ? 'a' : GLYPHS[g]!);
    }
    previousSpace = space;
  }
  return ' '.repeat(shape.pad[0]) + out.join('') + '\n'.repeat(shape.pad[1]);
}

/** A text of exactly `n` UTF-16 units, its first unit not whitespace (so
 *  never blank); whitespace inside counts as written. */
function utf16Text(n: number, shape: TextShape): string {
  let out = '';
  let i = 0;
  while (out.length < n) {
    const g = shape.pattern[i % shape.pattern.length]!;
    let piece = g < 0 && out.length > 0 ? ' ' : GLYPHS[Math.max(0, g)]!;
    if (out.length + piece.length > n) piece = 'a';
    out += piece;
    i++;
  }
  return out;
}

/**
 * A text for `rule`: counting 1 to its cap (`over` false; biased to 1, the
 * cap and one under it), or one to three over its cap (`over` true), in
 * the rule's own unit.
 */
export function tourTextArbitrary(
  rule: TourTextRule,
  options: { readonly over?: boolean } = {}
): fc.Arbitrary<string> {
  const n =
    options.over === true
      ? fc.integer({ min: rule.max + 1, max: rule.max + 3 })
      : countIn(1, rule.max);
  return fc
    .tuple(n, textShape)
    .map(([count, shape]) =>
      rule.unit === 'utf16'
        ? utf16Text(count, shape)
        : codePointText(count, shape)
    );
}

/** Ids: short ones from a small pool (so they collide across namespaces,
 *  asset ids among them), and ones at the 64-character limit. */
export const tourIdArbitrary: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('gate', 'clip', 'a', 'b', 'c', 'st0', 'x-1', 'Y_2'),
  fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/),
  fc.stringMatching(/^[A-Za-z0-9_-]{64}$/)
);

// JSON has no -0: a generated -0 would read back as 0.
const coordinate = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true }).map((x) => (x === 0 ? 0 : x));

/** A unit quaternion about Up (yaw only): exact through a JSON round trip
 *  and the reader's renormalisation. */
const yawRotation = fc
  .double({ min: 0, max: Math.PI * 2, noNaN: true })
  .map((t): [number, number, number, number] => [
    0,
    Math.sin(t / 2),
    0,
    Math.cos(t / 2),
  ]);

/** A local pose in a station's frame. */
export const tourLocalPoseArbitrary = fc.record({
  position: fc.tuple(
    coordinate(-500, 500),
    coordinate(-50, 50),
    coordinate(-500, 500)
  ),
  rotation: yawRotation,
});

const iso = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

const optionalText = (rule: TourTextRule) =>
  fc.option(tourTextArbitrary(rule), { nil: undefined });

/** Only the keys whose value is not undefined (a JSON file has no
 *  undefined; a generated record must read back equal). */
function defined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== undefined)
  );
}

const r = TOUR_BLOCK_TEXT_RULES;

/** Each kind's own fields for a block in `view`. */
const KIND_FIELDS: Record<
  TourBlockKind,
  (view: string) => fc.Arbitrary<Record<string, unknown>>
> = {
  shortText: () =>
    fc.record({
      caption: tourTextArbitrary(r.shortText.caption),
      description: optionalText(r.shortText.description),
    }),
  longText: () =>
    fc.record({
      title: tourTextArbitrary(r.longText.title),
      body: tourTextArbitrary(r.longText.body),
    }),
  picture: () =>
    fc.record({
      image: fc.constantFrom(...IMAGE_ASSETS),
      title: optionalText(r.picture.title),
      caption: optionalText(r.picture.caption),
      alt: optionalText(r.picture.alt),
      widthM: fc.double({
        min: TOUR_PICTURE_MIN_WIDTH_M,
        max: TOUR_PICTURE_MAX_WIDTH_M,
        noNaN: true,
      }),
    }),
  video: () =>
    fc.record({
      video: fc.constant('clip'),
      transcript: tourTextArbitrary(r.video.transcript),
      title: optionalText(r.video.title),
      poster: fc.option(fc.constantFrom(...IMAGE_ASSETS), { nil: undefined }),
    }),
  audio: () =>
    fc.record({
      audio: fc.constant('voice'),
      transcript: tourTextArbitrary(r.audio.transcript),
      title: optionalText(r.audio.title),
    }),
  model: (view) =>
    fc.record({
      asset: fc.constant('arch'),
      sizeM:
        view === 'stage'
          ? fc.constant(undefined)
          : (TOUR_MODEL_WORLD_VIEWS as readonly string[]).includes(view)
            ? modelSize
            : fc.option(modelSize, { nil: undefined }),
      title: optionalText(r.model.title),
      animation: fc.option(tourModelAnimationArbitrary, { nil: undefined }),
      annotations: fc.option(
        fc.array(tourModelNoteArbitrary, {
          minLength: 1,
          maxLength: TOUR_MODEL_MAX_NOTES,
        }),
        { nil: undefined }
      ),
      sections: fc.option(
        fc.array(tourModelSectionArbitrary, {
          minLength: 1,
          maxLength: TOUR_MODEL_MAX_SECTIONS,
        }),
        { nil: undefined }
      ),
    }),
  character: () =>
    fc.record({
      name: tourTextArbitrary(r.character.name),
      image: fc.constantFrom(...IMAGE_ASSETS),
      caption: tourTextArbitrary(r.character.caption),
      voice: fc.option(fc.constant('voice'), { nil: undefined }),
    }),
};

/** A point in a model's own space, within the bound; with `direction`,
 *  never zero. */
export function tourModelVectorArbitrary(
  direction = false
): fc.Arbitrary<[number, number, number]> {
  // JSON writes -0 as 0, so a file never holds one.
  const c = fc
    .double({
      min: -TOUR_MODEL_SPACE_MAX,
      max: TOUR_MODEL_SPACE_MAX,
      noNaN: true,
      noDefaultInfinity: true,
    })
    .map((x) => (x === 0 ? 0 : x));
  const v = fc.tuple(c, c, c);
  return direction ? v.filter(([x, y, z]) => x !== 0 || y !== 0 || z !== 0) : v;
}

/** A valid model note. */
export const tourModelNoteArbitrary = fc
  .record({
    position: tourModelVectorArbitrary(),
    normal: tourModelVectorArbitrary(true),
    title: tourTextArbitrary(TOUR_MODEL_NOTE_RULES.title),
    text: optionalText(TOUR_MODEL_NOTE_RULES.text),
  })
  .map((note) => defined(note));

/** A valid model section. */
export const tourModelSectionArbitrary = fc.record({
  name: tourTextArbitrary(TOUR_MODEL_SECTION_RULES.name),
  position: tourModelVectorArbitrary(),
  normal: tourModelVectorArbitrary(true),
});

/** A valid model clip. */
export const tourModelAnimationArbitrary = fc.record({
  name: tourTextArbitrary(TOUR_MODEL_ANIMATION_RULES.name),
  autoplay: fc.boolean(),
});

const modelSize = fc.double({
  min: TOUR_MODEL_MIN_SIZE_M,
  max: TOUR_MODEL_MAX_SIZE_M,
  noNaN: true,
});

/** The views a free block may stand in, per kind (none: story only). */
export const TOUR_FREE_VIEWS: Readonly<
  Record<TourBlockKind, readonly string[]>
> = {
  shortText: ['pin'],
  longText: [],
  picture: ['plane'],
  video: [],
  audio: [],
  model: TOUR_MODEL_WORLD_VIEWS,
  character: [],
};

const KINDS = Object.keys(TOUR_BLOCK_VIEWS) as TourBlockKind[];

/**
 * A valid version 4 block (a plain JSON record) with id `id`: a free one in
 * a world view of its kind, a story one in any view of its kind.
 */
export function tourBlockArbitrary(
  id: string,
  placement: 'free' | 'story',
  kinds: readonly TourBlockKind[] = KINDS
): fc.Arbitrary<Record<string, unknown>> {
  const allowed =
    placement === 'free'
      ? kinds.filter((k) => TOUR_FREE_VIEWS[k].length > 0)
      : kinds;
  return fc
    .constantFrom(...allowed)
    .chain((kind) => {
      const views =
        placement === 'free' ? TOUR_FREE_VIEWS[kind] : TOUR_BLOCK_VIEWS[kind];
      return fc.constantFrom(...views).map((view) => ({ kind, view }));
    })
    .chain(({ kind, view }) =>
      fc
        .record({
          fields: KIND_FIELDS[kind](view),
          pose: tourLocalPoseArbitrary,
          createdAtIso: fc.option(iso, { nil: undefined }),
        })
        .map(({ fields, pose, createdAtIso }) =>
          defined({ id, kind, view, pose, createdAtIso, ...defined(fields) })
        )
    );
}

const advanceArbitrary = fc.oneof(
  fc.constant({ mode: 'tap' }),
  fc.double({ min: 0.1, max: 60, noNaN: true }).map((afterS) => ({
    mode: 'auto',
    afterS,
  }))
);

const quizAnswerArbitrary = fc.oneof(
  fc.constant({
    type: 'single',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    correct: 'b',
  }),
  fc.constant({
    type: 'multiple',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    correct: ['a', 'c'],
  }),
  fc.constant({ type: 'text', salt: 's1', sha256: ['0'.repeat(64)] }),
  fc.constant({ type: 'code', salt: 's2', sha256: ['f'.repeat(64)] }),
  fc.constant({ type: 'number', value: 1850, tolerance: 5, unit: 'year' })
);

const quizActionArbitrary = fc
  .record({
    points: fc.integer({ min: 0, max: 100 }),
    answer: quizAnswerArbitrary,
  })
  .map(({ points, answer }) => ({
    kind: 'quiz',
    question: 'How old is it?',
    points,
    answer,
  }));

/** Sizes of a generated station content (swept by the properties). */
export interface TourStationContentSize {
  readonly maxBlocks?: number;
  readonly maxExtraSteps?: number;
}

interface ContentPlan {
  readonly blocks: readonly { id: string; story: boolean }[];
  readonly stepIds: readonly string[];
  readonly extras: readonly ('choice' | 'quiz')[];
  readonly order: readonly number[];
}

function contentPlan(size: TourStationContentSize): fc.Arbitrary<ContentPlan> {
  const maxBlocks = size.maxBlocks ?? 6;
  const maxExtra = size.maxExtraSteps ?? 3;
  return fc
    .record({
      blocks: fc.uniqueArray(
        fc.record({ id: tourIdArbitrary, story: fc.boolean() }),
        { maxLength: maxBlocks, selector: (b) => b.id }
      ),
      extras: fc.array(fc.constantFrom('choice' as const, 'quiz' as const), {
        maxLength: maxExtra,
      }),
    })
    .chain(({ blocks, extras }) => {
      const steps = blocks.filter((b) => b.story).length + extras.length;
      return fc
        .record({
          stepIds: fc.uniqueArray(tourIdArbitrary, {
            minLength: steps,
            maxLength: steps,
          }),
          order: fc.shuffledSubarray(
            Array.from({ length: steps }, (_, i) => i),
            { minLength: steps, maxLength: steps }
          ),
        })
        .map(({ stepIds, order }) => ({ blocks, stepIds, extras, order }));
    });
}

function choiceAction(
  stepIds: readonly string[],
  gotos: readonly (number | null)[]
): Record<string, unknown> {
  return {
    kind: 'choice',
    prompt: 'Where next?',
    options: gotos.map((g, i) =>
      defined({
        id: `o${String(i)}`,
        label: `Option ${String(i)}`,
        goto:
          g === null || stepIds.length === 0
            ? undefined
            : stepIds[g % stepIds.length],
      })
    ),
  };
}

/**
 * A valid version 4 station content `{ blocks, steps }` as JSON records:
 * free blocks in a world view, story blocks each shown by at least one
 * `show` step, and choices (options jumping to a step or continuing) and
 * quizzes among the shows, in a shuffled order.
 */
export function tourStationContentArbitrary(
  size: TourStationContentSize = {}
): fc.Arbitrary<{
  blocks: Record<string, unknown>[];
  steps: Record<string, unknown>[];
}> {
  return contentPlan(size).chain((plan) => {
    const blocks = fc.tuple(
      ...plan.blocks.map((b) =>
        tourBlockArbitrary(b.id, b.story ? 'story' : 'free')
      )
    );
    const extras = fc.tuple(
      ...plan.extras.map((kind) =>
        kind === 'quiz'
          ? quizActionArbitrary
          : fc
              .array(fc.option(fc.nat(), { nil: null }), {
                minLength: 2,
                maxLength: 4,
              })
              .map((gotos) => choiceAction(plan.stepIds, gotos))
      )
    );
    const advances = fc.array(advanceArbitrary, {
      minLength: plan.stepIds.length,
      maxLength: plan.stepIds.length,
    });
    return fc.tuple(blocks, extras, advances).map(([bs, xs, adv]) => {
      const actions: Record<string, unknown>[] = [
        ...plan.blocks
          .filter((b) => b.story)
          .map((b) => ({ kind: 'show', block: b.id })),
        ...xs,
      ];
      const steps = plan.order.map((a, i) => ({
        id: plan.stepIds[i]!,
        action: actions[a]!,
        advance: adv[i]!,
      }));
      return { blocks: [...bs], steps };
    });
  });
}

// --- manifests ----------------------------------------------------------

const geoArbitrary = fc.record({
  lat: coordinate(-89, 89),
  lon: coordinate(-179, 179),
  alt: coordinate(-400, 8000),
  headingDeg: coordinate(0, 359.9),
});

/** `content` with every block id another station already uses renamed
 *  (`s<station>b<index>`, suffixed until no block of the tour has it), and
 *  the `show` steps naming it with it: block ids are unique across the
 *  tour. */
function withTourUniqueBlockIds(
  content: {
    blocks: Record<string, unknown>[];
    steps: Record<string, unknown>[];
  },
  station: number,
  used: Set<string>
): { blocks: Record<string, unknown>[]; steps: Record<string, unknown>[] } {
  const own = new Set(content.blocks.map((b) => b.id as string));
  const taken = (id: string) => used.has(id) || own.has(id);
  const renamed = new Map<string, string>();
  const blocks = content.blocks.map((block, i) => {
    const id = block.id as string;
    if (!used.has(id)) return block;
    let fresh = `s${String(station)}b${String(i)}`;
    while (taken(fresh)) fresh += '_';
    own.add(fresh);
    renamed.set(id, fresh);
    return { ...block, id: fresh };
  });
  for (const block of blocks) used.add(block.id as string);
  const steps = content.steps.map((step) => {
    const action = step.action as Record<string, unknown>;
    const to =
      action.kind === 'show' ? renamed.get(action.block as string) : undefined;
    return to === undefined
      ? step
      : { ...step, action: { ...action, block: to } };
  });
  return { blocks, steps };
}

/**
 * A version 4 `tour.json` (a JSON record) of one to four stations, each
 * with a generated content ({@link tourStationContentArbitrary}: free and
 * story blocks of every kind, shows, choices and quizzes), block ids
 * unique across the tour, order fixed or any, assets
 * {@link TOUR_ARBITRARY_ASSETS}.
 */
export function tourManifestArbitrary(
  size: TourStationContentSize = {}
): fc.Arbitrary<Record<string, unknown>> {
  return fc
    .integer({ min: 1, max: 4 })
    .chain((n) =>
      fc.record({
        stations: fc.tuple(
          ...Array.from({ length: n }, (_, i) =>
            fc.record({
              content: tourStationContentArbitrary(size),
              geo: geoArbitrary,
              title: fc.option(fc.stringMatching(/^[A-Za-z]{1,12}$/), {
                nil: undefined,
              }),
              index: fc.constant(i),
            })
          )
        ),
        order: fc.constantFrom('fixed', 'any'),
        title: fc.option(fc.stringMatching(/^[A-Za-z ]{1,20}$/), {
          nil: undefined,
        }),
      })
    )
    .map(({ stations, order, title }) => {
      const used = new Set<string>();
      return defined({
        version: 4,
        title,
        order,
        assets: TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a })),
        stations: stations.map(({ content, geo, title: name, index }) => {
          const unique = withTourUniqueBlockIds(content, index, used);
          return defined({
            id: `s${String(index)}`,
            title: name,
            geo,
            activateRadiusM: 30,
            foundRadiusM: 20,
            hint: 'arrow',
            blocks: unique.blocks,
            steps: unique.steps,
          });
        }),
      });
    });
}

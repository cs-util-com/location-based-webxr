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
 *   ids (separate namespaces);
 * - valid blocks of every kind in every view this reader draws, free ones
 *   in a world view, story ones in any;
 * - children lists: stories (titled, possibly empty, holding blocks in any
 *   view, choices jumping back or forward inside the story, and quizzes of
 *   every answer type) and free blocks in a world view, in a shuffled order;
 * - whole manifests of one to four stations, child ids unique across the
 *   tour.
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
  TOUR_AUDIO_MAX_RADIUS_M,
  TOUR_AUDIO_MAX_REACH_M,
  TOUR_AUDIO_MIN_RADIUS_M,
  TOUR_AUDIO_MIN_REACH_M,
  TOUR_MODEL_MAX_SECTIONS,
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_DIRECTION_LENGTH,
  TOUR_MODEL_MIN_SIZE_M,
  TOUR_MODEL_NOTE_RULES,
  TOUR_MODEL_SECTION_RULES,
  TOUR_MODEL_SPACE_MAX,
  TOUR_CHARACTER_VIEWS,
  TOUR_MODEL_WORLD_VIEWS,
  TOUR_PICTURE_MAX_WIDTH_M,
  TOUR_PICTURE_MIN_WIDTH_M,
  type TourBlockKind,
  type TourTextRule,
} from '../ar/tour-blocks.js';
import { TOUR_STORY_TITLE_RULE } from '../ar/tour-story.js';

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
  audio: (view) =>
    fc
      .record({
        audio: fc.constant('voice'),
        transcript: tourTextArbitrary(r.audio.transcript),
        title: optionalText(r.audio.title),
        // Required in their own view, kept (optional) in every other.
        radiusM:
          view === 'spot'
            ? audioRadius
            : fc.option(audioRadius, { nil: undefined }),
        reach: audioReaches(view === 'zone'),
        volume:
          view === 'zone'
            ? audioVolume
            : fc.option(audioVolume, { nil: undefined }),
      })
      .map(({ reach, ...fields }) => ({ ...fields, ...reach })),
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
 *  never shorter than `TOUR_MODEL_MIN_DIRECTION_LENGTH` (too short to
 *  normalise, refused as zero). */
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
  return direction
    ? v.filter(
        ([x, y, z]) => Math.hypot(x, y, z) >= TOUR_MODEL_MIN_DIRECTION_LENGTH
      )
    : v;
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

const audioRadius = fc.double({
  min: TOUR_AUDIO_MIN_RADIUS_M,
  max: TOUR_AUDIO_MAX_RADIUS_M,
  noNaN: true,
});
const audioReach = fc.double({
  min: TOUR_AUDIO_MIN_REACH_M,
  max: TOUR_AUDIO_MAX_REACH_M,
  noNaN: true,
});
/** An ambient zone's reach (`maxM`, required when `required`) and its
 *  optional inner calm (`minM`): within the reach bounds, and below
 *  `maxM` when both stand, as the reader asks. */
function audioReaches(
  required: boolean
): fc.Arbitrary<{ maxM: number | undefined; minM: number | undefined }> {
  return fc
    .record({
      maxM: required ? audioReach : fc.option(audioReach, { nil: undefined }),
      calm: fc.option(
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        { nil: undefined }
      ),
    })
    .map(({ maxM, calm }) => {
      if (calm === undefined) return { maxM, minM: undefined };
      const top = maxM ?? TOUR_AUDIO_MAX_REACH_M;
      const minM =
        TOUR_AUDIO_MIN_REACH_M + calm * (top - TOUR_AUDIO_MIN_REACH_M);
      // A reach at the floor leaves no room for a calm below it.
      return {
        maxM,
        minM: maxM === undefined || minM < maxM ? minM : undefined,
      };
    });
}
const audioVolume = fc.double({ min: 0, max: 1, noNaN: true });

const modelSize = fc.double({
  min: TOUR_MODEL_MIN_SIZE_M,
  max: TOUR_MODEL_MAX_SIZE_M,
  noNaN: true,
});

/** The views a free block may stand in, per kind. Written out, not taken
 *  from the format: a property test holds the two together. */
export const TOUR_FREE_VIEWS: Readonly<
  Record<TourBlockKind, readonly string[]>
> = {
  shortText: ['pin'],
  longText: ['lectern', 'reading'],
  picture: ['plane'],
  video: ['card'],
  audio: ['spot', 'zone'],
  model: TOUR_MODEL_WORLD_VIEWS,
  character: TOUR_CHARACTER_VIEWS,
};

const KINDS = Object.keys(TOUR_BLOCK_VIEWS) as TourBlockKind[];

/**
 * A valid version 5 block (a plain JSON record) with id `id`: a free one in
 * a world view of its kind, a story one in any view of its kind.
 */
export function tourBlockArbitrary(
  id: string,
  placement: 'free' | 'story',
  kinds: readonly TourBlockKind[] = KINDS
): fc.Arbitrary<Record<string, unknown>> {
  return fc
    .constantFrom(...kinds)
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

function choiceAction(
  childIds: readonly string[],
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
          g === null || childIds.length === 0
            ? undefined
            : childIds[g % childIds.length],
      })
    ),
  };
}

// --- a station's children ----------------------------------------------

/** How a story block moves on: every mode this reader knows. */
const storyAdvanceArbitrary = fc.oneof(
  advanceArbitrary,
  fc.constant({ mode: 'lineEnd' })
);

/** Sizes of a generated children list (swept by the properties). */
export interface TourStationChildrenSize {
  readonly maxStories?: number;
  readonly maxFreeBlocks?: number;
  readonly maxStoryChildren?: number;
}

type StoryChildKind = 'block' | 'choice' | 'quiz';

interface ChildrenPlan {
  /** Each story's children kinds, in order. */
  readonly stories: readonly (readonly StoryChildKind[])[];
  readonly freeBlocks: number;
  /** Indices into stories-then-free-blocks: the station's order. */
  readonly order: readonly number[];
  /** One id per story, free block and story child, all unique. */
  readonly ids: readonly string[];
}

function childrenPlan(
  size: TourStationChildrenSize
): fc.Arbitrary<ChildrenPlan> {
  return fc
    .record({
      stories: fc.array(
        fc.array(fc.constantFrom<StoryChildKind>('block', 'choice', 'quiz'), {
          maxLength: size.maxStoryChildren ?? 5,
        }),
        { maxLength: size.maxStories ?? 4 }
      ),
      freeBlocks: fc.integer({ min: 0, max: size.maxFreeBlocks ?? 4 }),
    })
    .chain(({ stories, freeBlocks }) => {
      const top = stories.length + freeBlocks;
      const count = top + stories.reduce((n, s) => n + s.length, 0);
      return fc
        .record({
          order: fc.shuffledSubarray(
            Array.from({ length: top }, (_, i) => i),
            { minLength: top, maxLength: top }
          ),
          ids: fc.uniqueArray(tourIdArbitrary, {
            minLength: count,
            maxLength: count,
          }),
        })
        .map(({ order, ids }) => ({ stories, freeBlocks, order, ids }));
    });
}

function storyChildArbitrary(
  kind: StoryChildKind,
  id: string,
  storyIds: readonly string[]
): fc.Arbitrary<Record<string, unknown>> {
  if (kind === 'quiz') return quizActionArbitrary.map((q) => ({ id, ...q }));
  if (kind === 'choice') {
    return fc
      .array(fc.option(fc.nat(), { nil: null }), { minLength: 2, maxLength: 4 })
      .map((gotos) => ({ id, ...choiceAction(storyIds, gotos) }));
  }
  return fc
    .tuple(tourBlockArbitrary(id, 'story'), storyAdvanceArbitrary)
    .map(([block, advance]) => ({ ...block, advance }));
}

/**
 * A valid children list as JSON records: stories (titled, each
 * with its own blocks in any view, choices whose options jump to a child
 * of the same story, back or forward, or continue, and quizzes; possibly
 * empty) and free blocks in a world view, in a shuffled order, so free
 * blocks may come before, between or after the stories. Every id in the
 * list is unique.
 */
export function tourStationChildrenArbitrary(
  size: TourStationChildrenSize = {}
): fc.Arbitrary<Record<string, unknown>[]> {
  return childrenPlan(size).chain((plan) => {
    let next = 0;
    const take = (): string => plan.ids[next++]!;
    const stories = plan.stories.map((kinds) => {
      const id = take();
      const childIds = kinds.map(take);
      return fc
        .record({
          title: tourTextArbitrary(TOUR_STORY_TITLE_RULE),
          children: fc.tuple(
            ...kinds.map((kind, i) =>
              storyChildArbitrary(kind, childIds[i]!, childIds)
            )
          ),
        })
        .map(({ title, children }) => ({
          id,
          kind: 'story',
          title,
          children: [...children],
        }));
    });
    const free = Array.from({ length: plan.freeBlocks }, () =>
      tourBlockArbitrary(take(), 'free')
    );
    return fc
      .tuple(...stories, ...free)
      .map((top) => plan.order.map((i) => top[i]!));
  });
}

// --- manifests ----------------------------------------------------------

const geoArbitrary = fc.record({
  lat: coordinate(-89, 89),
  lon: coordinate(-179, 179),
  alt: coordinate(-400, 8000),
  headingDeg: coordinate(0, 359.9),
});

/** `children` with every id another station already uses renamed
 *  (`s<station>c<n>`, suffixed until no child of the tour has it), and the
 *  gotos naming it with it: child ids are unique across the tour. */
function withTourUniqueChildIds(
  children: readonly Record<string, unknown>[],
  station: number,
  used: Set<string>
): Record<string, unknown>[] {
  const kidsOf = (child: Record<string, unknown>) =>
    child.kind === 'story' ? (child.children as Record<string, unknown>[]) : [];
  const own = new Set(
    children.flatMap((c) => [c, ...kidsOf(c)]).map((c) => c.id as string)
  );
  let n = 0;
  const fresh = (id: string): string => {
    if (!used.has(id)) return id;
    let next = `s${String(station)}c${String(n++)}`;
    while (used.has(next) || own.has(next)) next += '_';
    own.add(next);
    return next;
  };
  const unique = children.map((child) => {
    if (child.kind !== 'story') {
      return { ...child, id: fresh(child.id as string) };
    }
    const kids = kidsOf(child);
    const renamed = new Map(
      kids.map((k) => [k.id as string, fresh(k.id as string)])
    );
    return {
      ...child,
      id: fresh(child.id as string),
      children: kids.map((kid) => {
        const id = renamed.get(kid.id as string);
        if (kid.kind !== 'choice') return { ...kid, id };
        const options = kid.options as { goto?: string }[];
        return {
          ...kid,
          id,
          options: options.map((o) =>
            o.goto === undefined ? o : { ...o, goto: renamed.get(o.goto) }
          ),
        };
      }),
    };
  });
  for (const child of unique) {
    for (const c of [child, ...kidsOf(child)]) used.add(c.id as string);
  }
  return unique;
}

/**
 * A `tour.json` (a JSON record) of one to four stations, each with
 * generated children ({@link tourStationChildrenArbitrary}), child ids
 * unique across the tour, order fixed or any, assets
 * {@link TOUR_ARBITRARY_ASSETS}.
 */
export function tourManifestArbitrary(
  size: TourStationChildrenSize = {
    maxStories: 2,
    maxFreeBlocks: 3,
    maxStoryChildren: 4,
  }
): fc.Arbitrary<Record<string, unknown>> {
  return fc
    .integer({ min: 1, max: 4 })
    .chain((n) =>
      fc.record({
        stations: fc.tuple(
          ...Array.from({ length: n }, (_, i) =>
            fc.record({
              children: tourStationChildrenArbitrary(size),
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
        version: 5,
        title,
        order,
        assets: TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a })),
        stations: stations.map(({ children, geo, title: name, index }) =>
          defined({
            id: `s${String(index)}`,
            title: name,
            geo,
            activateRadiusM: 30,
            foundRadiusM: 20,
            hint: 'arrow',
            children: withTourUniqueChildIds(children, index, used),
          })
        ),
      });
    });
}

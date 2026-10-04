/**
 * Why this test matters: the creator's phone writes stations and the
 * visitor's phone reads them, different builds days apart. Two properties
 * make that safe beyond the hand-written examples: every well-formed set of
 * assets and stations survives a JSON round trip unchanged (so a parsed
 * tour can be written back without drift), and breaking any ONE reference
 * - an asset a block names, a step a choice jumps to - is refused rather
 * than reaching a renderer as a dangling id.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseTourAssets, parseTourStations } from './tour-stations';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ASSETS = [
  { id: 'img', path: 'content/img.png', width: 10, height: 20 },
  { id: 'snd', path: 'content/snd.ogg' },
  { id: 'mdl', path: 'content/mdl.glb' },
  { id: 'vid', path: 'content/vid.webm' },
];

const words = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}$/);

/** One block that references only the fixed assets above. */
const block = fc.oneof(
  words.map((text) => ({ kind: 'text', text })),
  words.map((caption) => ({ kind: 'image', asset: 'img', caption })),
  words.map((caption) => ({
    kind: 'character',
    name: 'Knight',
    image: 'img',
    voice: 'snd',
    caption,
  })),
  words.map((transcript) => ({ kind: 'audio', asset: 'snd', transcript })),
  words.map((transcript) => ({ kind: 'video', asset: 'vid', transcript })),
  fc.constant({ kind: 'model', asset: 'mdl' }),
  fc.integer({ min: 0, max: 100 }).map((points) => ({
    kind: 'quiz',
    question: 'Q?',
    points,
    answer: {
      type: 'single',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correct: 'b',
    },
  }))
);

const advance = fc.oneof(
  fc.constant({ mode: 'tap' }),
  fc.double({ min: 0.1, max: 60, noNaN: true }).map((afterS) => ({
    mode: 'auto',
    afterS,
  }))
);

/** A station of 1-5 steps; the last step may be a choice back to the
 *  first two (a scene choice always targets steps of its own station). */
const station = (id: string) =>
  fc
    .record({
      blocks: fc.array(fc.record({ block, advance }), {
        minLength: 2,
        maxLength: 5,
      }),
      activate: fc.double({ min: 1, max: 200, noNaN: true }),
      ratio: fc.double({ min: 0.01, max: 1, noNaN: true }),
      choice: fc.boolean(),
    })
    .map(({ blocks, activate, ratio, choice }) => {
      const steps: Record<string, unknown>[] = blocks.map((b, i) => ({
        id: `st${String(i)}`,
        ...b,
      }));
      if (choice) {
        steps.push({
          id: 'pick',
          block: {
            kind: 'choice',
            prompt: 'Which?',
            options: [
              { id: 'x', label: 'X', goto: 'st0' },
              { id: 'y', label: 'Y', goto: 'st1' },
            ],
          },
          advance: { mode: 'tap' },
        });
      }
      return {
        id,
        anchor: { geo: { lat: 47, lon: 8, alt: 400, headingDeg: 10 } },
        activateRadiusM: activate,
        foundRadiusM: activate * ratio,
        hint: 'arrow',
        steps,
      };
    });

const stations = fc
  .integer({ min: 1, max: 4 })
  .chain((n) =>
    fc.tuple(...Array.from({ length: n }, (_, i) => station(`s${String(i)}`)))
  );

function parseAll(data: unknown) {
  const assets = parseTourAssets(ASSETS, { objectIds: new Set(), fail });
  return parseTourStations(data, { assets, fail });
}

describe('tour stations (properties)', () => {
  it('every well-formed station set survives a JSON round trip unchanged', () => {
    fc.assert(
      fc.property(stations, (data) => {
        const parsed = parseAll(data);
        expect(parseAll(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
      }),
      { numRuns: 150 }
    );
  });

  it('breaking any one asset reference is refused', () => {
    fc.assert(
      fc.property(stations, fc.nat(), (data, pick) => {
        const copy = JSON.parse(JSON.stringify(data)) as {
          steps: { block: Record<string, unknown> }[];
        }[];
        const media = copy.flatMap((s) =>
          s.steps.filter((st) => 'asset' in st.block || 'image' in st.block)
        );
        fc.pre(media.length > 0);
        const target = media[pick % media.length]!.block;
        if ('asset' in target) target['asset'] = 'missing';
        else target['image'] = 'missing';
        expect(() => parseAll(copy)).toThrow(Invalid);
      }),
      { numRuns: 150 }
    );
  });

  it('a choice jumping to a step that does not exist is refused', () => {
    fc.assert(
      fc.property(
        stations,
        fc.stringMatching(/^[a-z]{3,8}$/),
        (data, ghost) => {
          const copy = JSON.parse(JSON.stringify(data)) as {
            steps: {
              id: string;
              block: { kind: string; options?: { goto: string }[] };
            }[];
          }[];
          const choice = copy
            .flatMap((s) => s.steps)
            .find((st) => st.block.kind === 'choice');
          fc.pre(
            choice !== undefined && !ghost.startsWith('st') && ghost !== 'pick'
          );
          choice.block.options![0]!.goto = ghost;
          expect(() => parseAll(copy)).toThrow(
            /must name a step of this station/
          );
        }
      ),
      { numRuns: 150 }
    );
  });
});

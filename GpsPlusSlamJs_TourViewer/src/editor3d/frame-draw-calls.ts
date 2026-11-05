/**
 * The draw calls of a whole frame that renders several passes. three.js
 * resets `renderer.info` at every `render` by default, so after a frame
 * of passes it holds only the last one's calls; this counter turns the
 * automatic reset off, resets at a frame's start and keeps the total at
 * its end.
 *
 * @see frame-draw-calls.ts.md
 */

/** The part of `WebGLRenderer.info` the counter reads and writes. */
export interface RenderInfo {
  autoReset: boolean;
  reset(): void;
  readonly render: { readonly calls: number };
}

export interface FrameDrawCalls {
  /** At a frame's start, before its first render. */
  begin(): void;
  /** At a frame's end, after its last render. */
  end(): void;
  /** The last finished frame's draw calls (0 before the first). */
  calls(): number;
  /** The calls of the frame under way so far (between `begin` and
   *  `end`): a pass's own calls are the difference across it. */
  now(): number;
  /** The automatic reset back as it was. */
  dispose(): void;
}

export function createFrameDrawCalls(info: RenderInfo): FrameDrawCalls {
  const autoReset = info.autoReset;
  info.autoReset = false;
  let last = 0;
  return {
    begin() {
      info.reset();
    },
    end() {
      last = info.render.calls;
    },
    calls: () => last,
    now: () => info.render.calls,
    dispose() {
      info.autoReset = autoReset;
    },
  };
}

# trainer-choice.ts

## Purpose

Reads which trainer the splat trainer page runs from its address, so the
practice trainer is never a silent default.

## Public API

- `trainerChoiceFrom(search) -> { trainer, gpu, pace, lost }`
  - `trainer`: `practice` or `gpu` for exactly that value of `trainer`,
    else `unavailable`.
  - `gpu`: `integrated` or `no-webgpu` when asked for, else `ready`; the
    practice trainer's probe reports it (the real probe ignores it).
  - `pace`: `parsePace` of `pace` - a speed-up, 1 for anything that is
    not a positive finite number.
  - `lost`: the stretch (1-based) whose first try loses the graphics card
    in the practice run, from `lost=<n>` with `n` a positive whole number;
    null otherwise (the e2e of a lost card uses it).

## Examples

- `/tour/splat/` - the unavailable trainer: the page reads recordings and
  says it cannot make the splat yet.
- `/tour/splat/?trainer=gpu` - the real trainer on the graphics card.
- `/tour/splat/?trainer=practice&pace=20` - a practice run, twenty times
  faster than its normal pace.
- `/tour/splat/?trainer=practice&gpu=integrated` - the built-in graphics
  warning.

## Tests

`trainer-choice.test.ts`: the default, the GPU trainer only for the exact
value, the flags, and unknown values
falling back (never NaN), and `lost` refusing anything but a positive
whole number.

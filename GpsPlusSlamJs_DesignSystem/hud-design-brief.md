# AR HUD design brief - a paste-anywhere prompt for generating UI mockups

**How to use this file.** Paste everything from `--- BEGIN PROMPT ---` to
`--- END PROMPT ---` into any chat interface (claude.ai, ChatGPT, Gemini, a
local model, or a Claude Code session). Before pasting, do two substitutions:

1. Replace `{{DIRECTION}}` with one direction card from §A below.
2. Replace `{{TRACK}}` with either `TRACK A` or `TRACK B` from §B below.

Run it once per combination. Five exploratory directions times two tracks is
ten divergent mockups. **D6 is different**: it is the settled house language,
for generating NEW screens and components inside the established design rather
than alternatives to it - the normal mode now that the language has stabilised.
For a D6 round, paste **§C (the token reference)** into the chat along with the
prompt: it is the token contract, including what each token must never be used
for. (A source check in the package fails if §C names a token that no longer
exists in `styles.css`.)
**Run each in a FRESH conversation.** If you ask one conversation for several
mockups, each one is conditioned on the last and they converge on a house style,
which defeats the point.

Optionally attach reference screenshots to the chat before sending. The prompt
tells the model what to do with them.

Related: the plan this came from lives in the private docs repo
(`GpsPlusSlamJs_Docs/docs/2026-08-26-0432-hud-design-system-and-variant-playground-plan.md`).

---

## §A - The five direction cards

Paste exactly one of these in place of `{{DIRECTION}}`.

**D1 - HAIRLINE INSTRUMENT.** One-pixel lines and nothing else. No filled
panels. Boundaries are drawn with corner ticks and short rules rather than
closed rectangles. Numerals in a monospaced face, labels in small caps. Chrome
occupies under 10 percent of the screen area. Nothing is rounded. The design
should read as a measuring instrument etched onto glass.

**D2 - PLATED FIELD UNIT.** Every readable thing sits on an opaque dark plate
with a hard edge. Labels are heavy weight, uppercase, tight tracking. Colour is
near-monochrome with exactly one accent used only for state. Corners are cut at
45 degrees, never rounded. The design should read as ruggedised equipment: it
should look like it still works in rain.

**D3 - TERMINAL.** Monospace everywhere, including labels. The whole HUD is
built from text and box-drawing characters. One phosphor colour (choose amber or
green, not both) on near-black. Boxes are drawn with characters or with rules
that align to a character grid. A subtle scanline texture is allowed. The design
should read as a serial console that happens to be floating in the world.

**D4 - GLYPH MINIMAL.** Almost no text chrome. Numbers are large and the labels
that explain them are tiny or replaced by glyphs. Enormous negative space.
At most two type sizes. Controls are icon-only with generous touch targets. The
design should read as something built for a glance, not a read.

**D5 - DENSE TELEMETRY.** Maximum information density. Small type, tabular
alignment, values right-aligned on a decimal, rows grouped by rules. Everything
visible at once, nothing collapsed. The design should read as an aircraft
multi-function display: intimidating on first look, fast once learned.

**D6 - THE HOUSE LANGUAGE (settled, 2026-08-27).** Reproduce this language
exactly; invent only what it does not pin down. Surfaces: dark desaturated
translucent slate, a 160deg gradient from rgb(52 58 80 / 0.35) to
rgb(20 24 36 / 0.35) - the low alpha and low saturation are the point, they
keep the camera's own colour alive behind the panel. NO borders anywhere:
edges are carried by a dual "raise" shadow (2px 2px 2px black at 0.46 plus
-2px -2px 2px white at 0.3); the inset twin of that shadow is used only where
carving is the honest shape (slider groove, pressed buttons). TWO semantic colors on one ration: the orange accent #f2971f carries
SIGNATURE and ENGAGED (a 5px full-height strip flush with each panel's right
edge, cropped by the panel's rounded overflow; engaged/decisive states; small
marker dots which always wear a thin white outline), and the brand red
#ef4444 (--danger) carries the FAILURE family only (degraded readouts, warn
badges, lost progress, failure dots). Red and orange are close in hue, so
color never solely carries the distinction: every failure site also speaks
through words or shape (STALE text, a hatch, a corner dot, a badge pill).
Never use the red for engaged, decorative or brand purposes.
Rounded geometry: 14px panels, 10px buttons, 14px rounded-SQUARE icon buttons
(44px, never circles), 999px pills. One text voice everywhere: uppercase,
0.08em tracking, weight 500, Corbel-first system stack (its old-style figures
are deliberate). Sliders are an 18px carved groove with a translucent-white
pill thumb riding flush inside it. Toasts are translucent white
(rgb 255 255 255 / 0.65), borderless, dark text. World-anchored annotations
are plateless: white text with a THREE-layer black text-shadow halo
(near-opaque 2px core, 5px mid ring, 14px soft pool), a diamond outline
marker or a thin leader line to an accent dot; under prefers-contrast: more
the halo is swapped for a surface plate. Plates carry a faint 160deg
border-box edge gradient (bright top-left fading to near-nothing) - lighting
reinforcement, not an outline; the raise shadow still owns the boundary. A modal is the
one sanctioned world-dimming moment: a rgb(10 12 18 / 0.35) full-screen veil
behind a panel that is DARKER than the ordinary surfaces (the same gradient
hues at 0.75 alpha - a modal is read, not glanced past), actions stacked
full-width with the decisive action last and wearing the accent. State grammar: lifecycle states ride `data-state="..."` (kebab-case
enumerations), semantic variants ride `data-tone="..."`, and pressed/expanded
truth rides the ARIA attributes (`aria-pressed`, `aria-expanded`) which the
CSS styles directly. Surfaces near-solidify under
prefers-reduced-transparency / prefers-contrast; every animation
honors prefers-reduced-motion. The design should read as
the same instrument family as the reference screenshots, extended.

---

## §B - The two tracks

**TRACK A - unconstrained.** Delete the whole block titled "LEGIBILITY RULES"
from the prompt before sending. Design purely for the look. (With D6, TRACK A
is the normal choice: the house language already embodies its own legibility
decisions, and the rules block contradicts some of them on purpose - e.g. its
70-percent plates versus the house 35-percent translucency.)

**TRACK B - hardened.** Keep the "LEGIBILITY RULES" block. Everything else is
identical.

The point of running both is to see what each rule actually costs, side by side,
rather than arguing about it.

---

## §C - D6 token reference (the contract, with anti-uses)

Every visual value in the system reaches CSS through one of these. When
generating in-language (D6), use these names; never invent a value-named
primitive (no `--orange-500`). A source check in the package keeps this list
honest against `styles.css`.

- **Neutral poles**: `--ink` #fff (draws everything) · `--paper` #232838
  (page ground - demo only, a real HUD's ground is the camera).
- **Surfaces** (glanced, translucent on purpose): `--surface`,
  `--surface-hi` → `--surface-lo` via `--surface-gradient` (160deg, 0.35
  alpha - never raise it for taste; read surfaces have their own token) ·
  `--surface-read-gradient` (0.75, the modal - surfaces that are READ) ·
  `--surface-inverse` (the toast's translucent white) · `--surface-knob`
  (slider pill) · `--veil` (modal backdrop ONLY - the one sanctioned
  world-dimming moment) · `--cone` (radar view cone) · `--edge-gradient`
  (plate rim lighting - never a border color).
- **Accent & state**: `--accent` #f2971f with `--ink-on-accent` ·
  `--accent-signature` (the plate strip) · `--state-engaged` (on/active/
  decisive) · `--danger` #ef4444 with `--ink-on-danger` · `--state-warn`
  (the failure family - never decoration, never engaged) · `--hatch` (dark
  stripes so lost never speaks through color alone) · `--ring` (quiet gray:
  radar rim, located pin hole).
- **Shadows** (the edge language - borders do not exist): `--raise`,
  `--raise-big` (hover), `--raise-light` (light elements: toast, pill) ·
  `--carve`, `--carve-deep` (ONLY where carving is honest: slider groove,
  pressed buttons) · `--shadow-pressed` (pairs with `--carve-deep`) ·
  `--halo-text`, `--halo-drop`, `--halo-ring` (plateless legibility - one
  decision, three forms; tune here, nowhere else).
- **Type & voice**: `--font-ui` (Corbel-first; old-style figures are
  deliberate) · `--font-num` (= ui, one voice) · `--size-hint` 12 /
  `--size-body` 14 / `--size-read` 16 · `--weight-body` = `--weight-strong`
  = 500 (flattened on purpose; emphasis comes from accent, never weight) ·
  `--case-ui` + `--tracking-ui` (the uppercase voice, applied at the atom
  boundary - never put it on body).
- **Geometry**: `--space-1..4` (4/8/12/16) · `--radius` 14 (panels, icon
  buttons) · `--radius-small` 10 (buttons) · `--radius-pill` · `--strip`
  (the signature strip width - plate's right edge only) · `--groove` 18
  (slider channel = thumb = switch knob) · `--line` 0.5 / `--line-strong` 2 ·
  `--tap` 44 (touch floor).
- **Motion** ("calm instrument": motion communicates STATE, never
  decorates - short distances, opacity-first, no bounce): `--t-fast`
  120ms (direct response: press, drag, knob) · `--t-state` 250ms
  (indirect changes: engage fill, tone, exits) · `--t-enter` 400ms
  (arrivals rise/settle - slow on purpose over a moving camera) ·
  `--ease-out` (arrivals settle) · `--ease-in` (exits accelerate
  away). Transient by default: a LOOP is allowed only while a state is
  ongoing-and-unresolved (locating); ambient loops cost frames on a
  phone already running camera + 3D. A warn state flashes ONCE on
  onset (brightness settle), never repeatedly.

---

--- BEGIN PROMPT ---

You are designing a heads-up display that is overlaid on a live phone camera
feed during an augmented-reality session. Produce ONE self-contained HTML file.

**You have no access to any repository, codebase, design system, image or file
beyond what is written in this message (plus any images explicitly attached to
this chat). Everything you need is below. Do not ask for more context, do not
assume a component library exists, and do not reference files. Invent nothing
about the content: the strings and controls are specified verbatim.**

## What this HUD is for

The user is standing outdoors holding a phone in portrait orientation. The phone
camera shows the real street. On top of that camera image, the app draws a 3D
model of the surrounding city (buildings, terrain, points of interest from
OpenStreetMap) and tries to line it up with the real world using GPS plus visual
tracking of the camera image.

That alignment is imperfect and drifts. This HUD is the instrument that shows
how well it is going and lets the user correct it, in daylight, while walking.
So behind your HUD there is not just a camera image: there are also rendered
buildings, which are themselves large, geometric, and often light grey. Your
design cannot rely on the background being photographic or busy.

Nobody reads this HUD for pleasure. It is glanced at between looking at the
world. Treat every element as competing for a fraction of a second.

## Layout map

Portrait, 390 x 844 CSS pixels. Approximate positions, which you may refine:

```
+------------------------------------------+
|  [readout]                               |  <- top left, below a safe area
|   42 draws / 812,345 tri · 30 fps        |     of about 40px
|   alt 105.3 m (+0.5) · world floor 0.42 m|
|   gps ±6.0 m · 40 m from anchor      [+] |
|                                          |
|                                          |
|                                          |
|            (camera + 3D city)            |
|                                          |
|                                          |
|            [ toast, transient ]          |  <- floats over everything
|                                          |
|            [−]  0 m  [+]                 |  <- elevation nudge
|      ====O========  compass 0.55         |  <- slider + value
|            ~15–30 fixes to show          |  <- hint
|                                          |
|            [ AR ]            [gear]      |  <- bottom action row,
+------------------------------------------+     above a safe area of ~34px
```

The bottom cluster is thumb territory. The top readout is not: it is read, not
touched, apart from its expand control.

## What the numbers mean, and which ones matter

You are designing a hierarchy, so you need to know what is important. Ranked:

1. **`gps ±6.0 m · 40 m from anchor`** - how accurate the position fix is, and
   how far the user has walked from the point where alignment was established.
   This is the number that tells the user whether to trust what they are seeing.
   Most important.
2. **`alt 105.3 m (+0.5) · world floor 0.42 m`** - the altitude GPS reported,
   and where the app decided the ground is. When these disagree, the city model
   floats or sinks. Second most important, and the reason the elevation nudge
   control exists.
3. **`gps age 3 s`, and its degraded form `gps age 42 s — STALE`** - how fresh
   the fix is. Normally ignorable, critical when it goes stale. **The degraded
   state must be impossible to miss even though the normal state is quiet.**
   This is the hardest single design problem on the screen.
4. **`42 draws / 812,345 tri · 30 fps`** - rendering cost and frame rate.
   Developer instrumentation. Least important, and a candidate for de-emphasis.

The compass slider trades off two sources of heading: the phone magnetometer
(fast, but wrong near metal and buildings) against GPS movement (slow, but
unbiased). `compass 0.00 — GPS only` and `compass 1.00 — full` are the ends.
The user drags it while watching the city model rotate, so the value readout and
the world are read together.

## The screen you are designing

Reproduce this exact content. The strings are real, taken from the running app,
so use them verbatim rather than inventing placeholder text.

**1. A collapsible measurement readout, top left.**

Collapsed, it shows these lines:

```
42 draws / 812,345 tri · 30 fps
alt 105.3 m (+0.5) · world floor 0.42 m
gps ±6.0 m · 40 m from anchor
```

Expanded, it adds lines of the same shape, for example:

```
alt accuracy ±3.5 m
gps age 3 s
```

and can show a degraded state, for example `gps age 42 s — STALE`, which must be
visually distinct from a normal line.

It has a single expand/collapse control labelled `+` when collapsed and `−` when
expanded. Show BOTH states in your file, side by side.

Accessibility contract, which is deliberate and must be preserved: **the numeric
lines carry `aria-hidden="true"`** because they change twice a second forever
and announcing that makes the page unusable with a screen reader. **The
expand/collapse control is a real `<button>` and is NOT hidden**, and it needs an
accessible name. Do not "fix" this by announcing the numbers.

**2. A compass influence slider, bottom centre.**

A range input from 0 to 1 in steps of 0.05, with `aria-label="Compass influence
on heading"`. Beside it a value readout showing one of:

```
compass 0.00 — GPS only
compass 0.55
compass 1.00 — full
```

and below it a hint line showing either `waiting for a GPS fix` or
`~15–30 fixes to show`. The value readout is a polite live region. Show the
slider in its disabled state (before a GPS fix) and its enabled state.

**3. An elevation nudge control, bottom centre.**

A `−` button, a value, a `+` button. The value reads `0 m`, `+2 m`, `−4 m` and
so on. Both buttons need accessible names such as "Raise the map by 2 m".

**4. A bottom action row** containing a primary action button labelled `AR`, and
a settings gear button. Show the primary button in three states: normal,
disabled, and active.

**5. A toast** that appears over everything for a few seconds, showing a short
message such as `Re-observed from here`.

## Required deliverables in the one file

- **The screen**, laid out for a 390 x 844 CSS pixel phone viewport, over the
  background (see below).
- **A primitive sheet below it**, showing each reusable element in isolation and
  in every state: button (normal, hover, active, disabled, focus-visible),
  toggle, slider (disabled, enabled, mid-drag), collapsible panel (open,
  closed), status readout (normal, degraded), and the frame or container
  treatment.
- **A background switcher.** Four buttons that swap what is behind the HUD, so
  the design can be judged against the range of things a camera actually sees.
  Approximate them with CSS gradients, no external images:
  - `WHITE WALL` - flat near-white, around #f2f0ec
  - `BLOWN SKY` - vertical gradient from pure white to pale blue, mostly white
  - `FOLIAGE` - busy mid-to-dark green, high local contrast, use overlapping
    radial gradients so it is genuinely noisy rather than flat
  - `NIGHT STREET` - near-black with a few small bright warm highlights

## Design system requirements

- **Define a token layer first**, as CSS custom properties on `:root`: colours,
  hairline width, plate opacity, type scale, spacing scale, corner treatment,
  motion durations. Give them names that describe their role, not their value.
- **No literal values anywhere below the token block.** Every colour, size,
  radius, border width and duration in a component rule must be `var(--token)`.
  If you need a new value, add a token for it. This is the single most important
  structural requirement: it is what lets the result become a real design system
  rather than one pretty page.
  (The canonical `index.html` interprets this pragmatically: repeated or
  load-bearing values are tokens; a one-off piece of component-local geometry
  may stay literal. Mirror that judgement rather than tokenising every number.)
- Use `@layer reset, tokens, frame, component, state, utility` for cascade
  order.
- No framework, no build step, no external requests of any kind: no CDN scripts,
  no external stylesheets, no web fonts, no remote images. System font stacks
  only. Everything inline in the one file.
- Interactive states must be real CSS (`:hover`, `:active`, `:disabled`,
  `:focus-visible`), not screenshots of states.
- Every control must be keyboard reachable with a visible focus indicator, and
  must have an accessible name.

## LEGIBILITY RULES

_(Delete this entire block for TRACK A. Keep it for TRACK B.)_

This HUD sits over a live camera feed that you do not control. It can be a white
wall, an overexposed sky, or a dark street, and it moves. These rules exist
because platform guidance and the AR legibility literature agree on them:

- **Never use `backdrop-filter`.** In a WebXR DOM overlay the HUD is composited
  as a separate surface in front of the camera, so it has no read access to the
  pixels behind it. `backdrop-filter` works in a desktop browser and does
  nothing on the device. Frosted glass is not available here. Do not simulate it
  either.
- **Anything that must be READ sits on a plate.** A solid or high-alpha dark
  backing, 70 percent black or more. The research result is blunt: a solid
  billboard behind text is the most legible treatment and the most immune to
  background distraction. (The house language deliberately runs GLANCED
  surfaces at 0.35 alpha and reserves the 0.75 backing for read surfaces like
  the modal; it hedges the difference with the three-layer halo and a
  prefers-reduced-transparency mode. That is a decided trade, not an
  oversight - do not "fix" the house alphas to satisfy this rule.)
- **Do not combine a plate and an outline on the same element.** Each works
  alone; together they are worse than either.
- **A hairline may never be the sole carrier of a boundary or a state.** A white
  1px line over an overexposed sky has a contrast ratio of 1:1. If a hairline
  defines an edge, give it a wider dark under-stroke beneath it (for example a
  1px white stroke drawn over a 3px near-black stroke, which is most easily done
  as inline SVG with two paths). Otherwise something else must carry the
  boundary.
- **No Light or Thin font weights.** Minimum weight is Regular; prefer Medium
  for anything small. Thin vertical strokes visibly vibrate when the camera
  moves.
- **Minimum text size 14px**, and 18px or larger for anything read at a glance.
- **Sentence case, not uppercase**, for anything that is read rather than
  scanned. Uppercase is measurably slower to read.
- **Touch targets at least 44px**, and prefer larger, because the user is
  walking.
- **Contrast targets**: 4.5:1 for text, and 3:1 for the boundary of any control,
  measured against the WORST of the four backgrounds, not the best.

## How to pick your design direction

{{DIRECTION}}

Before you write any code, do this and show your working:

1. List three candidate treatments for the axes the direction card does NOT pin
   down, along with a rough probability for each, where the probability is how
   likely a competent designer would be to produce that treatment given this
   brief.
2. Pick the LOWEST-probability candidate that still fully satisfies the
   direction card and, if you are on TRACK B, the legibility rules.
3. Then design.

The point is a genuinely distinct result, not a safe one. Five of these are
being generated and compared, and the failure mode is five variations of the
same design.

## If reference images are attached

Read them for visual language only: stroke weights, corner treatment, how much
of the screen is chrome versus content, the colour relationships, the motion
vocabulary. Do not copy their layout, and do not copy any content from them.
This screen's content is specified above and is not negotiable.

## Output

One HTML file, complete and self-contained, in a single code block. No
commentary before it beyond the direction-selection working above. At the very
top of the file, a comment block listing:

- the direction card you were given,
- the track (A or B),
- the treatment you selected in step 2 and the two you rejected,
- and any place where you had to break one of the rules above, with the reason.

That last item matters more than the design. If a rule made the direction
impossible, say so plainly rather than quietly ignoring it.

--- END PROMPT ---

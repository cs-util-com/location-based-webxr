# import-plan.ts

**Purpose:** which file of one drop (or one pick) goes where; pure, it reads names only.

## Public API

- `planImport(names)`: an `ImportPlan` whose indexes refer to `names`:
  - `imports`: one `PlannedImport { primary, format, parts }` per `.gltf` (`parts`: every loose companion and picture of the drop, which the converter may use) and per `.zip` (`parts` empty: a zip carries its own);
  - `held`: the pictures, when the drop holds a loose `.gltf`: added on their own only once its models are done and none carries them (`model-import-runner.ts`);
  - `plain`: files taken as they are (a `.glb`, a sound, a video, a picture when no loose model could name it);
  - `refused`: a companion dropped with no loose model, with words (`refusal.loneModelPart` for `.bin` and `.mtl`, `refusal.lonePictureKind` for `.tga` and `.bmp`);
  - `unknown`: files neither the import nor the tour knows (the page says so in its own words).

## Invariants

- Every file is claimed exactly once: as an import's primary, plain, held, refused, unknown, or (a companion) only as a part.
- A zip's model never takes the drop's loose files: a zip is one model's folder.

## Tests

`import-plan.test.ts`: the cases above, and a property that every file is claimed once and pictures are held only for a loose model.

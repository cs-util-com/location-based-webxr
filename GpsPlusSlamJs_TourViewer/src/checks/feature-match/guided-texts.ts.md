# guided-texts.ts

## Purpose

The words per shot of the photo test, shared by both views (the guided view and the cockpit): a short title, the change after the scene's previous shot, how to take the shot, the diagram kind, what the shot's pair measures and what spoils it, and each scene's setup; plus the note after a shot's light check and the line that says what a retake costs. Plain text, set as text.

## Public API

- `ShotWords { title, change, capture, diagram, purpose, avoid }`: `change` is empty on a scene's first shot; `diagram` is a `DiagramKind` of `guided-diagram.ts`.
- `SHOT_WORDS: Record<ShotKey, ShotWords>`: one entry per shot key of `scenes.ts` (L1-L4, F1-F6, D1-D3, X1, X2).
- `SCENE_INTRO: Record<SceneKind, string>`: the guided view's "New scene" banner, what the scene asks of the tester.
- `SCENE_SETUP: Record<SceneKind, string>`: where a scene's first shot is taken from; shown on every shot of the scene.
- `ShotCard` and `shotCard(shot)`: the shot's words plus its scene's `setup`.
- `LIGHT_NOTE: Record<ShotLight, string>`: one line per light check result; every failed one says what to retake (an almost black L1: go back to L1).
- `STORE_CHIP_TEXT`: the guided chip while photos are not stored ("not stored on this phone: download soon").
- `OTHER_TAB_TEXT`: "This test is open in another tab: this one takes no photo. Close the other tab, then reload this one." The tab lock is asked once at load (`holdTabLock` with `ifAvailable`), so a refused tab stays refused after the other closes; a reload is the way back. Waiting for the lock instead was not chosen: the refused tab's plan was read at its load and is stale by then, so taking over would need the whole store read again, which a reload does. Said by both views, and by a refused photo's note in a tab that does not hold the run.
- `retakeText(key, pairs)`: "Retaking F1 redoes 7 measurements." (singular for one); the cockpit's retake hint.

## Invariants

- Plain English, plain hyphens, no markup.
- L1 is taken with the light on; L3 and L4 dim the light in their change step, without moving the phone.
- Titles are unique per shot.

## Example

```ts
const c = shotCard(shot); // a shot of the flat scene
// c.setup === SCENE_SETUP.flat
```

## Tests

`guided-texts.test.ts`: every shot has a title, purpose, avoid line and known diagram; a change on every later shot and none on a first shot; the light order of L1, L3 and L4; unique titles; the scene's setup added to the card; a retake asked for on every failed light check; the retake line with its singular.

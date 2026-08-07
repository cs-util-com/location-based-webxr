# `event-instant.ts`

## Purpose

Converts between the geo-event picker's two `<input>` boxes and a local instant.

## Public API

- `toDateValue(at: Date): string` — `yyyy-mm-dd` in LOCAL time, zero-padded.
- `toTimeValue(at: Date): string` — `hh:mm` in LOCAL time, zero-padded.
- `parseLocalInstant(date: string, time: string): number | undefined` — the
  epoch ms the two boxes denote, or `undefined` when either is empty,
  malformed, out of range, or names a day that does not exist.

## Invariants & assumptions

- **LOCAL time, explicitly (DEC-G1).** The demo already used the device's zone,
  implicitly, by passing `Date.now()`. The picker makes that explicit; it does
  not change which zone is meant.
  - **Accepted cost:** two devices in different zones asking for "18:00" get
    different absolute instants and therefore different events. Cross-tab
    determinism is unaffected — two tabs share a zone.
- **`new Date(y, m, d, hh, mm)`, never `Date.parse` of a joined string.** By
  spec, `"2026-08-07T18:00"` parses as local while `"2026-08-07"` parses as UTC
  — same engine, same shape, different meaning. A refactor to the "simpler"
  form moves every picked event by the device's offset, silently, and looks
  correct to anyone testing at UTC+0.
- **CALENDAR roll-over is rejected.** `new Date(2026, 1, 31)` is 3 March. A
  browser without `type="date"` renders a text field, so "2026-02-31" is typable
  and would otherwise search a day the dialog never displayed.
- **The CLOCK's own gap is accepted, and the asymmetry is deliberate.** In a
  spring-forward hour `new Date(y, m, d, 2, 30)` is 03:30 local; the date fields
  still match, so the calendar check passes it through. Rejecting it would
  answer a time the `<input type="time">` itself offered with "pick a date and a
  time first", which is a worse lie than the shift — and it is not silent, since
  the button and the marker both show the RESOLVED slot, so the user sees 03:45
  rather than the 02:30 they asked for. That is the contract quarter-hour
  rounding already has: you name an instant, the app shows you the slot.
- **Seconds are parsed and discarded.** Some browsers append `:00`. The event
  grid is quarter-hourly, so seconds are precision the answer cannot carry.
- **`undefined` is a real return, not an error path to swallow.** Falling back
  to "now" would run a search for a time the user did not ask for while the
  dialog showed the one they did.

## Examples

```ts
dateInput.value = toDateValue(new Date());
timeInput.value = toTimeValue(new Date());

const requested = parseLocalInstant(dateInput.value, timeInput.value);
if (requested !== undefined) void findGeoEvent(requested);
```

## Tests

`event-instant.test.ts` — the zero-padding both inputs need, a round-trip over
five instants including both DST changeovers, the local-vs-UTC trap stated
explicitly, the optional seconds field, empty and malformed boxes, the
roll-over rejection (with a leap day as the counter-example), and out-of-range
components. Written against the runner's own zone, because "the boxes and the
instant agree in whatever zone the device is in" is the property under test.
